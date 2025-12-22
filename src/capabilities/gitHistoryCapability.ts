import type { CapabilityContribution, CapabilityContext, CapabilityModule } from '../runtime/agentHost.js';
import { execSync } from 'node:child_process';

const MAX_OUTPUT = 5000;

export class GitHistoryCapabilityModule implements CapabilityModule {
  readonly id = 'capability.git-history';

  async create(context: CapabilityContext): Promise<CapabilityContribution> {
    const workingDir = context.workingDir;

    return {
      id: 'git-history.tools',
      description: 'Git history search and file restoration',
      toolSuite: {
        id: 'git-history',
        description: 'Search git history for commits, file changes, and deleted content',
        tools: [
          {
            name: 'GitHistory',
            description: 'Search git history for commits, file changes, and deleted content. Use mode="log" for commit history, mode="search" to find commits by content, mode="show" to view a specific commit, mode="deleted" to find deleted files.',
            parameters: {
              type: 'object',
              properties: {
                mode: {
                  type: 'string',
                  enum: ['log', 'search', 'show', 'deleted', 'blame', 'diff'],
                  description: 'Search mode: log (commit history), search (find by content), show (view commit), deleted (find deleted files), blame (line history), diff (compare)',
                },
                query: {
                  type: 'string',
                  description: 'Search query - commit hash for show, search text for search, file path for blame/log',
                },
                path: {
                  type: 'string',
                  description: 'File or directory path to filter results',
                },
                limit: {
                  type: 'number',
                  description: 'Max results to return (default: 10)',
                },
              },
              required: ['mode'],
            },
            handler: async (args: Record<string, unknown>) => {
              const mode = args['mode'] as string;
              const query = (args['query'] as string) || '';
              const filePath = (args['path'] as string) || '';
              const limit = Math.min((args['limit'] as number) || 10, 50);

              try {
                let cmd: string;
                let result: string;

                switch (mode) {
                  case 'log':
                    cmd = `git log --oneline -n ${limit}${filePath ? ` -- "${filePath}"` : ''}`;
                    result = execSync(cmd, { cwd: workingDir, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
                    break;

                  case 'search':
                    if (!query) return 'Error: query required for search mode';
                    cmd = `git log --oneline -n ${limit} --all -S "${query.replace(/"/g, '\\"')}"`;
                    result = execSync(cmd, { cwd: workingDir, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
                    if (!result.trim()) {
                      cmd = `git log --oneline -n ${limit} --all --grep="${query.replace(/"/g, '\\"')}"`;
                      result = execSync(cmd, { cwd: workingDir, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
                    }
                    break;

                  case 'show':
                    if (!query) return 'Error: query (commit hash) required for show mode';
                    cmd = `git show --stat --name-only ${query}`;
                    result = execSync(cmd, { cwd: workingDir, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
                    break;

                  case 'deleted':
                    cmd = query
                      ? `git log --all --full-history --diff-filter=D --name-only --oneline -n ${limit} -- "*${query}*"`
                      : `git log --all --full-history --diff-filter=D --name-only --oneline -n ${limit}`;
                    result = execSync(cmd, { cwd: workingDir, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
                    break;

                  case 'blame':
                    if (!filePath) return 'Error: path required for blame mode';
                    cmd = `git blame --line-porcelain "${filePath}" | head -200`;
                    result = execSync(cmd, { cwd: workingDir, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
                    break;

                  case 'diff':
                    if (query) {
                      cmd = `git diff ${query}${filePath ? ` -- "${filePath}"` : ''}`;
                    } else {
                      cmd = `git diff HEAD${filePath ? ` -- "${filePath}"` : ''}`;
                    }
                    result = execSync(cmd, { cwd: workingDir, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
                    break;

                  default:
                    return `Unknown mode: ${mode}`;
                }

                if (!result.trim()) {
                  return `No results found for ${mode} mode${query ? ` with query "${query}"` : ''}`;
                }

                if (result.length > MAX_OUTPUT) {
                  return result.slice(0, MAX_OUTPUT) + `\n... [truncated, ${result.length - MAX_OUTPUT} more chars]`;
                }

                return result;
              } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                return `Git error: ${msg}`;
              }
            },
          },
          {
            name: 'GitRestore',
            description: 'Restore a file from git history. Use to recover deleted files or previous versions.',
            parameters: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'File path to restore',
                },
                commit: {
                  type: 'string',
                  description: 'Commit hash to restore from (use HEAD~1 for previous, or specific hash)',
                },
                preview: {
                  type: 'boolean',
                  description: 'If true, show content without restoring',
                },
              },
              required: ['path'],
            },
            handler: async (args: Record<string, unknown>) => {
              const filePath = args['path'] as string;
              const commit = (args['commit'] as string) || 'HEAD~1';
              const preview = args['preview'] === true;

              if (!filePath) return 'Error: path required';

              try {
                if (preview) {
                  const cmd = `git show "${commit}:${filePath}"`;
                  const result = execSync(cmd, { cwd: workingDir, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
                  if (result.length > MAX_OUTPUT) {
                    return result.slice(0, MAX_OUTPUT) + `\n... [truncated]`;
                  }
                  return result;
                } else {
                  const cmd = `git checkout "${commit}" -- "${filePath}"`;
                  execSync(cmd, { cwd: workingDir, encoding: 'utf-8' });
                  return `Restored ${filePath} from ${commit}`;
                }
              } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                return `Git restore error: ${msg}`;
              }
            },
          },
        ],
      },
    };
  }
}
