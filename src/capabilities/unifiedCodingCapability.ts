/**
 * UNIFIED CODING CAPABILITY
 *
 * A lean, consolidated capability module that provides all essential
 * tools for an AI coding assistant in a single, coherent interface.
 *
 * Consolidates: Filesystem, Edit, Bash, Search, Git, Web
 */

import type { CapabilityContribution, CapabilityContext, CapabilityModule } from '../runtime/agentHost.js';
import type { ToolSuite, ToolDefinition } from '../core/toolRuntime.js';
import type { JSONSchemaObject, JSONSchemaString } from '../core/types.js';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// ============================================================================
// TYPES
// ============================================================================

export interface UnifiedCodingOptions {
  workingDir?: string;
  enableGit?: boolean;
  enableWeb?: boolean;
  enableBash?: boolean;
  maxFileSize?: number;
  timeout?: number;
}

// ============================================================================
// SCHEMA HELPERS
// ============================================================================

function stringProp(description: string, enumValues?: readonly string[]): JSONSchemaString {
  const prop: JSONSchemaString = {
    type: 'string' as const,
    description,
  };
  if (enumValues) {
    return { ...prop, enum: enumValues };
  }
  return prop;
}

function objectSchema(
  properties: Record<string, JSONSchemaString>,
  required: string[]
): JSONSchemaObject {
  return {
    type: 'object' as const,
    properties,
    required,
  };
}

// ============================================================================
// UNIFIED CODING CAPABILITY MODULE
// ============================================================================

export class UnifiedCodingCapabilityModule implements CapabilityModule {
  readonly id = 'unified-coding';
  private readonly options: Required<UnifiedCodingOptions>;

  constructor(options: UnifiedCodingOptions = {}) {
    this.options = {
      workingDir: options.workingDir ?? process.cwd(),
      enableGit: options.enableGit ?? true,
      enableWeb: options.enableWeb ?? true,
      enableBash: options.enableBash ?? true,
      maxFileSize: options.maxFileSize ?? 10 * 1024 * 1024, // 10MB
      timeout: options.timeout ?? 30000, // 30s
    };
  }

  async create(_context: CapabilityContext): Promise<CapabilityContribution> {
    return {
      id: this.id,
      description: 'Unified coding assistant tools',
      toolSuite: this.buildToolSuite(),
    };
  }

  private buildToolSuite(): ToolSuite {
    const tools: ToolDefinition<Record<string, unknown>>[] = [];

    // === FILESYSTEM TOOLS ===
    tools.push(this.createReadFileTool());
    tools.push(this.createWriteFileTool());
    tools.push(this.createListFilesTool());
    tools.push(this.createFileExistsTool());

    // === EDIT TOOLS ===
    tools.push(this.createEditFileTool());
    tools.push(this.createSearchReplaceTool());

    // === SEARCH TOOLS ===
    tools.push(this.createGrepTool());
    tools.push(this.createGlobTool());

    // === BASH TOOLS ===
    if (this.options.enableBash) {
      tools.push(this.createBashTool());
    }

    // === GIT TOOLS ===
    if (this.options.enableGit) {
      tools.push(this.createGitTool());
    }

    // === WEB TOOLS ===
    if (this.options.enableWeb) {
      tools.push(this.createWebFetchTool());
    }

    return {
      id: 'unified-coding-tools',
      description: 'Unified coding assistant tools for file operations, editing, search, and execution',
      tools,
    };
  }

  // ============================================================================
  // FILESYSTEM TOOLS
  // ============================================================================

  private createReadFileTool(): ToolDefinition<{ path: string; encoding?: string }> {
    return {
      name: 'read_file',
      description: 'Read the contents of a file. Returns the file content as a string.',
      parameters: objectSchema(
        {
          path: stringProp('Absolute or relative path to the file'),
          encoding: stringProp('File encoding (default: utf-8)'),
        },
        ['path']
      ),
      handler: async (args) => {
        try {
          const filePath = this.resolvePath(args.path);
          const stat = fs.statSync(filePath);

          if (stat.size > this.options.maxFileSize) {
            return `Error: File too large (${stat.size} bytes). Max: ${this.options.maxFileSize} bytes`;
          }

          const content = fs.readFileSync(filePath, { encoding: (args.encoding as BufferEncoding) ?? 'utf-8' });
          return content;
        } catch (error) {
          return `Error reading file: ${(error as Error).message}`;
        }
      },
    };
  }

  private createWriteFileTool(): ToolDefinition<{ path: string; content: string; createDirs?: string }> {
    return {
      name: 'write_file',
      description: 'Write content to a file. Creates the file if it does not exist.',
      parameters: objectSchema(
        {
          path: stringProp('Absolute or relative path to the file'),
          content: stringProp('Content to write to the file'),
          createDirs: stringProp('Create parent directories if they do not exist (default: true)'),
        },
        ['path', 'content']
      ),
      handler: async (args) => {
        try {
          const filePath = this.resolvePath(args.path);

          if (args.createDirs !== 'false') {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
              fs.mkdirSync(dir, { recursive: true });
            }
          }

          fs.writeFileSync(filePath, args.content, 'utf-8');
          return `Successfully wrote ${args.content.length} characters to ${filePath}`;
        } catch (error) {
          return `Error writing file: ${(error as Error).message}`;
        }
      },
    };
  }

  private createListFilesTool(): ToolDefinition<{ path: string; recursive?: string; pattern?: string }> {
    return {
      name: 'list_files',
      description: 'List files in a directory. Optionally filter by pattern and recurse into subdirectories.',
      parameters: objectSchema(
        {
          path: stringProp('Directory path to list'),
          recursive: stringProp('Recurse into subdirectories (default: false)'),
          pattern: stringProp('Glob pattern to filter files (e.g., "*.ts")'),
        },
        ['path']
      ),
      handler: async (args) => {
        try {
          const dirPath = this.resolvePath(args.path);
          const files = this.listDirectory(dirPath, args.recursive === 'true', args.pattern);
          return files.join('\n');
        } catch (error) {
          return `Error listing files: ${(error as Error).message}`;
        }
      },
    };
  }

  private createFileExistsTool(): ToolDefinition<{ path: string }> {
    return {
      name: 'file_exists',
      description: 'Check if a file or directory exists.',
      parameters: objectSchema(
        {
          path: stringProp('Path to check'),
        },
        ['path']
      ),
      handler: async (args) => {
        const filePath = this.resolvePath(args.path);
        const exists = fs.existsSync(filePath);
        if (exists) {
          const stat = fs.statSync(filePath);
          return `Exists: ${stat.isDirectory() ? 'directory' : 'file'}`;
        }
        return 'Does not exist';
      },
    };
  }

  // ============================================================================
  // EDIT TOOLS
  // ============================================================================

  private createEditFileTool(): ToolDefinition<{ path: string; oldText: string; newText: string }> {
    return {
      name: 'edit_file',
      description: 'Edit a file by replacing specific text. The oldText must match exactly.',
      parameters: objectSchema(
        {
          path: stringProp('Path to the file to edit'),
          oldText: stringProp('Exact text to find and replace'),
          newText: stringProp('Text to replace with'),
        },
        ['path', 'oldText', 'newText']
      ),
      handler: async (args) => {
        try {
          const filePath = this.resolvePath(args.path);
          const content = fs.readFileSync(filePath, 'utf-8');

          if (!content.includes(args.oldText)) {
            return `Error: Could not find the specified text in ${filePath}`;
          }

          const newContent = content.replace(args.oldText, args.newText);
          fs.writeFileSync(filePath, newContent, 'utf-8');

          return `Successfully edited ${filePath}`;
        } catch (error) {
          return `Error editing file: ${(error as Error).message}`;
        }
      },
    };
  }

  private createSearchReplaceTool(): ToolDefinition<{ path: string; search: string; replace: string; regex?: string; global?: string }> {
    return {
      name: 'search_replace',
      description: 'Search and replace text in a file. Supports regex patterns.',
      parameters: objectSchema(
        {
          path: stringProp('Path to the file'),
          search: stringProp('Text or regex pattern to search for'),
          replace: stringProp('Replacement text'),
          regex: stringProp('Treat search as regex (default: false)'),
          global: stringProp('Replace all occurrences (default: true)'),
        },
        ['path', 'search', 'replace']
      ),
      handler: async (args) => {
        try {
          const filePath = this.resolvePath(args.path);
          const content = fs.readFileSync(filePath, 'utf-8');

          let pattern: string | RegExp;
          if (args.regex === 'true') {
            const flags = args.global !== 'false' ? 'g' : '';
            pattern = new RegExp(args.search, flags);
          } else {
            pattern = args.global !== 'false'
              ? new RegExp(this.escapeRegex(args.search), 'g')
              : args.search;
          }

          const newContent = content.replace(pattern, args.replace);
          const matchCount = (content.match(pattern instanceof RegExp ? pattern : new RegExp(this.escapeRegex(args.search), 'g')) || []).length;

          fs.writeFileSync(filePath, newContent, 'utf-8');
          return `Replaced ${matchCount} occurrence(s) in ${filePath}`;
        } catch (error) {
          return `Error in search/replace: ${(error as Error).message}`;
        }
      },
    };
  }

  // ============================================================================
  // SEARCH TOOLS
  // ============================================================================

  private createGrepTool(): ToolDefinition<{ pattern: string; path?: string; filePattern?: string; contextLines?: string }> {
    return {
      name: 'grep',
      description: 'Search for a pattern in files. Returns matching lines with file names and line numbers.',
      parameters: objectSchema(
        {
          pattern: stringProp('Regex pattern to search for'),
          path: stringProp('Directory or file to search in (default: working directory)'),
          filePattern: stringProp('Filter files by glob pattern (e.g., "*.ts")'),
          contextLines: stringProp('Number of context lines around matches (default: 0)'),
        },
        ['pattern']
      ),
      handler: async (args) => {
        try {
          const searchPath = this.resolvePath(args.path ?? '.');
          const results: string[] = [];

          const files = fs.statSync(searchPath).isDirectory()
            ? this.listDirectory(searchPath, true, args.filePattern)
            : [searchPath];

          // Use regex without 'g' flag for test() to avoid lastIndex issues
          const regex = new RegExp(args.pattern, 'i');
          const contextLines = parseInt(args.contextLines ?? '0', 10) || 0;
          const matchedLineSet = new Set<string>(); // Prevent duplicate context lines

          for (const file of files.slice(0, 100)) { // Limit to 100 files
            try {
              // Skip binary files by checking for null bytes
              const buffer = fs.readFileSync(file);
              if (buffer.includes(0)) continue; // Binary file

              const content = buffer.toString('utf-8');
              // Skip very large files
              if (content.length > 1024 * 1024) continue; // > 1MB

              const lines = content.split('\n');
              const fileMatches: number[] = [];

              // First pass: find all matching line numbers
              for (let i = 0; i < lines.length; i++) {
                if (regex.test(lines[i])) {
                  fileMatches.push(i);
                }
              }

              // Second pass: output with context, avoiding duplicates
              for (const matchIdx of fileMatches) {
                const start = Math.max(0, matchIdx - contextLines);
                const end = Math.min(lines.length - 1, matchIdx + contextLines);

                for (let j = start; j <= end; j++) {
                  const lineKey = `${file}:${j}`;
                  if (!matchedLineSet.has(lineKey)) {
                    matchedLineSet.add(lineKey);
                    const prefix = j === matchIdx ? '>' : ' ';
                    results.push(`${file}:${j + 1}:${prefix} ${lines[j]}`);
                  }
                }
                if (contextLines > 0 && matchIdx < fileMatches[fileMatches.length - 1]) {
                  results.push('--');
                }
              }
            } catch {
              // Skip unreadable files
            }

            // Stop if we have enough results
            if (results.length > 500) break;
          }

          return results.length > 0
            ? results.slice(0, 500).join('\n')
            : 'No matches found';
        } catch (error) {
          return `Error in grep: ${(error as Error).message}`;
        }
      },
    };
  }

  private createGlobTool(): ToolDefinition<{ pattern: string; path?: string }> {
    return {
      name: 'glob',
      description: 'Find files matching a glob pattern.',
      parameters: objectSchema(
        {
          pattern: stringProp('Glob pattern (e.g., "**/*.ts", "src/**/*.js")'),
          path: stringProp('Base directory (default: working directory)'),
        },
        ['pattern']
      ),
      handler: async (args) => {
        try {
          const basePath = this.resolvePath(args.path ?? '.');
          const files = this.listDirectory(basePath, true, args.pattern);
          return files.length > 0
            ? files.slice(0, 200).join('\n')
            : 'No files found matching pattern';
        } catch (error) {
          return `Error in glob: ${(error as Error).message}`;
        }
      },
    };
  }

  // ============================================================================
  // BASH TOOL
  // ============================================================================

  private createBashTool(): ToolDefinition<{ command: string; timeout?: string; cwd?: string }> {
    return {
      name: 'bash',
      description: 'Execute a bash command and return the output. Use for running builds, tests, git commands, etc.',
      parameters: objectSchema(
        {
          command: stringProp('The command to execute'),
          timeout: stringProp('Timeout in milliseconds (default: 30000)'),
          cwd: stringProp('Working directory for the command'),
        },
        ['command']
      ),
      handler: async (args) => {
        return new Promise((resolve) => {
          try {
            const timeout = parseInt(args.timeout ?? String(this.options.timeout), 10);
            const cwd = args.cwd ? this.resolvePath(args.cwd) : this.options.workingDir;

            const result = execSync(args.command, {
              cwd,
              timeout,
              encoding: 'utf-8',
              maxBuffer: 10 * 1024 * 1024,
              stdio: ['pipe', 'pipe', 'pipe'],
            });

            resolve(result.trim() || '(no output)');
          } catch (error: unknown) {
            const execError = error as { stdout?: string; stderr?: string; message: string };
            const stdout = execError.stdout ?? '';
            const stderr = execError.stderr ?? '';
            resolve(`Error: ${execError.message}\nStdout: ${stdout}\nStderr: ${stderr}`);
          }
        });
      },
    };
  }

  // ============================================================================
  // GIT TOOL
  // ============================================================================

  private createGitTool(): ToolDefinition<{ operation: string; args?: string }> {
    return {
      name: 'git',
      description: 'Execute git operations. Supports: status, diff, log, add, commit, push, pull, branch, checkout, merge, stash',
      parameters: objectSchema(
        {
          operation: stringProp(
            'Git operation',
            ['status', 'diff', 'log', 'add', 'commit', 'push', 'pull', 'branch', 'checkout', 'merge', 'stash', 'reset', 'fetch']
          ),
          args: stringProp('Additional arguments for the git command'),
        },
        ['operation']
      ),
      handler: async (args) => {
        try {
          const command = `git ${args.operation}${args.args ? ' ' + args.args : ''}`;
          const result = execSync(command, {
            cwd: this.options.workingDir,
            encoding: 'utf-8',
            timeout: this.options.timeout,
          });
          return result.trim() || '(no output)';
        } catch (error: unknown) {
          const execError = error as { stderr?: string; message: string };
          return `Git error: ${execError.stderr || execError.message}`;
        }
      },
    };
  }

  // ============================================================================
  // WEB TOOL
  // ============================================================================

  private createWebFetchTool(): ToolDefinition<{ url: string; method?: string; headers?: string }> {
    return {
      name: 'web_fetch',
      description: 'Fetch content from a URL. Useful for downloading documentation or API responses.',
      parameters: objectSchema(
        {
          url: stringProp('URL to fetch'),
          method: stringProp('HTTP method (default: GET)'),
          headers: stringProp('JSON string of headers'),
        },
        ['url']
      ),
      handler: async (args) => {
        try {
          const headers: Record<string, string> = args.headers ? JSON.parse(args.headers) : {};
          const response = await fetch(args.url, {
            method: args.method ?? 'GET',
            headers,
          });

          if (!response.ok) {
            return `HTTP ${response.status}: ${response.statusText}`;
          }

          const contentType = response.headers.get('content-type') ?? '';
          if (contentType.includes('application/json')) {
            const json = await response.json();
            return JSON.stringify(json, null, 2);
          }

          const text = await response.text();
          return text.slice(0, 50000); // Limit response size
        } catch (error) {
          return `Fetch error: ${(error as Error).message}`;
        }
      },
    };
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  private resolvePath(inputPath: string): string {
    if (path.isAbsolute(inputPath)) {
      return inputPath;
    }
    return path.resolve(this.options.workingDir, inputPath);
  }

  private listDirectory(dir: string, recursive: boolean, pattern?: string): string[] {
    const results: string[] = [];
    const regex = pattern ? this.globToRegex(pattern) : null;

    const walk = (currentDir: string) => {
      try {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);

          // Skip hidden files and common ignore patterns
          if (entry.name.startsWith('.') || entry.name === 'node_modules') {
            continue;
          }

          if (entry.isDirectory()) {
            if (recursive) {
              walk(fullPath);
            }
          } else {
            if (!regex || regex.test(entry.name) || regex.test(fullPath)) {
              results.push(fullPath);
            }
          }
        }
      } catch {
        // Skip unreadable directories
      }
    };

    walk(dir);
    return results;
  }

  private globToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(escaped, 'i');
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

// ============================================================================
// FACTORY & CONVENIENCE EXPORTS
// ============================================================================

export function createUnifiedCodingCapability(options?: UnifiedCodingOptions): UnifiedCodingCapabilityModule {
  return new UnifiedCodingCapabilityModule(options);
}

export default UnifiedCodingCapabilityModule;
