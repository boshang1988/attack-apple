/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { ToolDefinition } from '../core/toolRuntime.js';
import { buildError } from '../core/errors.js';
import { parallelMap } from '../utils/asyncUtils.js';
import { recordFileRead } from './fileReadTracker.js';

// Maximum file size to read (10MB) to prevent memory exhaustion
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const DEFAULT_SEARCH_HEAD_LIMIT = 50;

interface FormattedReadResult {
  filePath?: string;
  output: string;
}

export function createFileTools(workingDir: string): ToolDefinition[] {
  return [
    {
      name: 'read_file',
      description: 'Read the contents of a file at the specified path. Returns content with line numbers. CRITICAL: ALWAYS use this tool BEFORE using Edit tool to get exact text including whitespace. Copy text directly from this output to old_string parameter in Edit. For large files, use offset and limit to read specific portions.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The file path (relative to working directory or absolute)',
            minLength: 1,
          },
          offset: {
            type: 'number',
            description: 'Line number to start reading from (1-based). Defaults to 1.',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of lines to read. Defaults to entire file (max 2000 lines for large files).',
          },
        },
        required: ['path'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const result = await readFileWithLineNumbers(workingDir, args['path'], args['offset'], args['limit']);
        return result.output;
      },
    },
    {
      name: 'read_files',
      description: 'Read multiple files in parallel with line numbers. Use this to avoid sequential read bottlenecks when inspecting several files.',
      parameters: {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'string',
              minLength: 1,
            },
            description: 'List of file paths to read (relative or absolute)',
          },
          offset: {
            type: 'number',
            description: 'Optional starting line for all files (1-based).',
          },
          limit: {
            type: 'number',
            description: 'Optional max lines to read for each file.',
          },
          concurrency: {
            type: 'number',
            description: 'Maximum number of files to read concurrently (default: 5, max: 10).',
          },
        },
        required: ['paths'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const pathsArg = args['paths'];
        if (!Array.isArray(pathsArg) || pathsArg.length === 0) {
          return 'Error: paths must be a non-empty array of file paths.';
        }

        const sanitizedPaths = pathsArg
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean);

        if (sanitizedPaths.length === 0) {
          return 'Error: paths must contain at least one valid string path.';
        }

        const concurrencyArg = typeof args['concurrency'] === 'number' ? Math.floor(args['concurrency']) : 5;
        const concurrency = Math.min(Math.max(concurrencyArg, 1), 10);
        const offsetArg = args['offset'];
        const limitArg = args['limit'];

        const results = await parallelMap(
          sanitizedPaths,
          async (path) => readFileWithLineNumbers(workingDir, path, offsetArg, limitArg),
          concurrency
        );

        const header = `Read ${results.length} file${results.length === 1 ? '' : 's'} in parallel (max ${concurrency} concurrent):`;
        const body = results.map((result) => result.output).join('\n\n---\n\n');
        return [header, body].join('\n\n');
      },
    },
    {
      name: 'list_files',
      description: 'List files and directories at the specified path',
      cacheable: true,
      cacheTtlMs: 4000, // short TTL to avoid stale listings while cutting redundant calls
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The directory path (defaults to current working directory)',
            minLength: 1,
          },
          recursive: {
            type: 'boolean',
            description: 'Whether to list files recursively',
          },
        },
        additionalProperties: false,
      },
      handler: async (args) => {
        const pathArg = args['path'];
        const requestedPath = normalizePathContext(pathArg);
        let resolvedPath: string | undefined;
        try {
          const dirPath =
            pathArg !== undefined && pathArg !== null ? resolveFilePath(workingDir, pathArg) : workingDir;
          resolvedPath = dirPath;
          const recursive = args['recursive'] === true;

          if (!existsSync(dirPath)) {
            return `Error: Directory not found: ${dirPath}`;
          }

          const files = listFilesRecursive(dirPath, recursive ? 5 : 1, workingDir);
          return `Directory: ${dirPath}\n\n${files.join('\n')}`;
        } catch (error: any) {
          return buildError('listing files', error, { path: requestedPath, resolvedPath });
        }
      },
    },
    {
      name: 'search_files',
      description: 'Search for files matching a pattern (supports glob patterns)',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'The search pattern (e.g., "*.ts", "src/**/*.js")',
            minLength: 1,
          },
          path: {
            type: 'string',
            description: 'The directory to search in (defaults to current working directory)',
            minLength: 1,
          },
          head_limit: {
            type: 'number',
            description: `Maximum number of files to return. Defaults to ${DEFAULT_SEARCH_HEAD_LIMIT}.`,
          },
        },
        required: ['pattern'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const pathArg = args['path'];
        const requestedPath = normalizePathContext(pathArg);
        const patternArg = args['pattern'];
        const requestedPattern = typeof patternArg === 'string' ? patternArg : undefined;
        let resolvedPath: string | undefined;
        try {
          const pattern = typeof patternArg === 'string' && patternArg.trim() ? patternArg : null;
          if (!pattern) {
            return 'Error: pattern must be a non-empty string.';
          }
          const headLimitArg = args['head_limit'];
          const headLimit =
            typeof headLimitArg === 'number' && Number.isFinite(headLimitArg) && headLimitArg > 0
              ? Math.floor(headLimitArg)
              : DEFAULT_SEARCH_HEAD_LIMIT;
          const searchPath =
            pathArg !== undefined && pathArg !== null ? resolveFilePath(workingDir, pathArg) : workingDir;
          resolvedPath = searchPath;
          const results = searchFilesGlob(searchPath, pattern).sort();
          if (results.length === 0) {
            return `No files found matching pattern: ${pattern}`;
          }
          const limited = results.slice(0, headLimit);
          const truncated = results.length > headLimit;
          const headerParts = [
            `Found ${results.length} file${results.length === 1 ? '' : 's'} matching "${pattern}"`,
            truncated ? `showing first ${headLimit}` : null,
          ].filter(Boolean);

          let output = `${headerParts.join(' ')}:\n\n${limited.map((f) => relative(workingDir, f)).join('\n')}`;

          if (truncated) {
            output += `\n\n... [${results.length - headLimit} more files truncated. Use head_limit parameter to see more]`;
          }

          return output;
        } catch (error: any) {
          return buildError('searching files', error, {
            path: requestedPath,
            resolvedPath,
            pattern: requestedPattern,
          });
        }
      },
    },
  ];
}

function resolveFilePath(workingDir: string, path: unknown): string {
  const validated = validatePathArg(path);
  return validated.startsWith('/') ? validated : join(workingDir, validated);
}

function validatePathArg(path: unknown): string {
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error('Path must be a non-empty string.');
  }
  return path.trim();
}

function normalizePathContext(path: unknown): string | undefined {
  if (path === undefined || path === null) {
    return undefined;
  }
  try {
    return String(path);
  } catch {
    return '(unprintable)';
  }
}

function listFilesRecursive(dir: string, maxDepth: number, baseDir: string, currentDepth = 0): string[] {
  if (currentDepth >= maxDepth) {
    return [];
  }

  const ignoredDirs = new Set(['.git', 'node_modules', 'dist', '.next', 'build', 'coverage']);
  const results: string[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (ignoredDirs.has(entry.name)) {
        continue;
      }

      const fullPath = join(dir, entry.name);
      const indent = '  '.repeat(currentDepth);

      if (entry.isDirectory()) {
        results.push(`${indent}${entry.name}/`);
        results.push(...listFilesRecursive(fullPath, maxDepth, baseDir, currentDepth + 1));
      } else {
        const stats = statSync(fullPath);
        const size = formatFileSize(stats.size);
        results.push(`${indent}${entry.name} ${size}`);
      }
    }
  } catch (error) {
    // Ignore filesystem errors; best-effort file listing only.
  }

  return results;
}

function searchFilesGlob(dir: string, pattern: string): string[] {
  const results: string[] = [];
  const regex = globToRegex(pattern);

  function search(currentDir: string) {
    const ignoredDirs = new Set(['.git', 'node_modules', 'dist', '.next', 'build', 'coverage']);

    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (ignoredDirs.has(entry.name)) {
          continue;
        }

        const fullPath = join(currentDir, entry.name);

        if (entry.isDirectory()) {
          search(fullPath);
        } else if (regex.test(fullPath)) {
          results.push(fullPath);
        }
      }
    } catch (error) {
      // Ignore directory read errors and continue scanning.
    }
  }

  search(dir);
  return results;
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.');
  return new RegExp(escaped);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

async function readFileWithLineNumbers(
  workingDir: string,
  pathArg: unknown,
  offsetArg: unknown,
  limitArg: unknown
): Promise<FormattedReadResult> {
  const requestedPath = normalizePathContext(pathArg);
  let resolvedPath: string | undefined;

  try {
    const filePath = resolveFilePath(workingDir, pathArg);
    resolvedPath = filePath;
    if (!existsSync(filePath)) {
      return { filePath, output: `Error: File not found: ${filePath}` };
    }

    const fileStats = await stat(filePath);
    if (fileStats.size > MAX_FILE_SIZE) {
      return {
        filePath,
        output: `Error: File too large (${formatFileSize(fileStats.size)}). Maximum allowed: ${formatFileSize(MAX_FILE_SIZE)}. Use offset and limit parameters to read specific portions.`,
      };
    }

    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const totalLines = lines.length;

    const { offset, startLine, endLine } = normalizeReadWindow(totalLines, offsetArg, limitArg);
    const selectedLines = lines.slice(startLine, endLine);

    const numberedLines = selectedLines.map((line, idx) => {
      const lineNum = String(startLine + idx + 1).padStart(6);
      return `${lineNum}\t${line}`;
    });

    const showingRange = startLine > 0 || endLine < totalLines;
    const rangeInfo = showingRange
      ? ` (lines ${offset}-${endLine} of ${totalLines})`
      : ` (${totalLines} lines)`;

    // Track this read for "Read Before Edit" enforcement
    recordFileRead(
      filePath,
      content,
      showingRange ? { start: startLine + 1, end: endLine } : undefined
    );

    return {
      filePath,
      output: `File: ${filePath}${rangeInfo}\n\n${numberedLines.join('\n')}`,
    };
  } catch (error: any) {
    return { filePath: resolvedPath, output: buildError('reading file', error, { path: requestedPath, resolvedPath }) };
  }
}

function normalizeReadWindow(totalLines: number, offsetArg: unknown, limitArg: unknown): {
  offset: number;
  startLine: number;
  endLine: number;
} {
  const offset = typeof offsetArg === 'number' ? Math.max(1, Math.floor(offsetArg)) : 1;
  const defaultLimit = totalLines > 2000 ? 2000 : totalLines;
  const limit = typeof limitArg === 'number' ? Math.max(1, Math.floor(limitArg)) : defaultLimit;

  const startLine = offset - 1;
  const endLine = Math.min(startLine + limit, totalLines);

  return { offset, startLine, endLine };
}
