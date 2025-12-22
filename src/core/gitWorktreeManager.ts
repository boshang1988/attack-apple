/**
 * GitWorktreeManager - Manages git worktrees for multi-variant RL execution.
 *
 * Provides lifecycle management for isolated workspaces where competing agents
 * can make independent changes without interference. Supports:
 * - Git worktree creation (preferred) with automatic cleanup
 * - Filesystem copy fallback for non-git repos
 * - Cross-variant diff tracking
 * - Branch isolation for parallel execution
 */

import { exec as execCallback, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { promisify } from 'node:util';
import type { UpgradeVariant } from './repoUpgradeOrchestrator.js';

const exec = promisify(execCallback);

export interface WorktreeInfo {
  variant: UpgradeVariant;
  path: string;
  type: 'worktree' | 'copy' | 'original';
  branch?: string;
  commit?: string;
  createdAt: number;
}

export interface WorktreeManagerOptions {
  /** Base working directory (the original repo) */
  baseDir: string;
  /** Session ID for naming worktrees */
  sessionId?: string;
  /** Skip directories when creating filesystem copies */
  skipDirs?: string[];
  /** Create isolated branches for each variant */
  createBranches?: boolean;
  /** Branch prefix for variant branches */
  branchPrefix?: string;
}

export interface VariantDiff {
  variant: UpgradeVariant;
  filesChanged: string[];
  insertions: number;
  deletions: number;
  diff: string;
}

export interface CrossVariantComparison {
  primary: VariantDiff;
  refiner?: VariantDiff;
  commonFiles: string[];
  conflictingFiles: string[];
}

const DEFAULT_SKIP_DIRS = [
  'node_modules',
  '.turbo',
  '.next',
  'coverage',
  'dist',
  '.git',
  '.cache',
  '__pycache__',
  '.pytest_cache',
  'build',
  'target',
];

export class GitWorktreeManager {
  private readonly baseDir: string;
  private readonly sessionId: string;
  private readonly skipDirs: string[];
  private readonly createBranches: boolean;
  private readonly branchPrefix: string;
  private readonly worktrees: Map<UpgradeVariant, WorktreeInfo> = new Map();
  private isGitRepo: boolean | null = null;
  private baseCommit: string | null = null;

  constructor(options: WorktreeManagerOptions) {
    this.baseDir = options.baseDir;
    this.sessionId = options.sessionId ?? `rl-${Date.now()}`;
    this.skipDirs = options.skipDirs ?? DEFAULT_SKIP_DIRS;
    this.createBranches = options.createBranches ?? true;
    this.branchPrefix = options.branchPrefix ?? 'agi-upgrade';
  }

  /**
   * Initialize the manager and detect git repo status.
   */
  async initialize(): Promise<void> {
    try {
      await exec('git rev-parse --is-inside-work-tree', { cwd: this.baseDir });
      this.isGitRepo = true;
      const { stdout } = await exec('git rev-parse HEAD', { cwd: this.baseDir });
      this.baseCommit = stdout.trim();
    } catch {
      this.isGitRepo = false;
    }

    // Register primary workspace (original directory)
    this.worktrees.set('primary', {
      variant: 'primary',
      path: this.baseDir,
      type: 'original',
      commit: this.baseCommit ?? undefined,
      createdAt: Date.now(),
    });
  }

  /**
   * Create an isolated workspace for a variant.
   */
  async createVariantWorkspace(variant: UpgradeVariant): Promise<WorktreeInfo> {
    if (variant === 'primary') {
      return this.worktrees.get('primary')!;
    }

    const existing = this.worktrees.get(variant);
    if (existing) {
      return existing;
    }

    const targetDir = mkdtempSync(join(tmpdir(), `agi-${variant}-`));

    if (this.isGitRepo) {
      const worktreeCreated = await this.createGitWorktree(variant, targetDir);
      if (worktreeCreated) {
        return this.worktrees.get(variant)!;
      }
    }

    // Fallback to filesystem copy
    await this.createFilesystemCopy(variant, targetDir);
    return this.worktrees.get(variant)!;
  }

  /**
   * Create a git worktree for the variant.
   */
  private async createGitWorktree(variant: UpgradeVariant, targetDir: string): Promise<boolean> {
    try {
      const branchName = this.createBranches
        ? `${this.branchPrefix}/${variant}/${this.sessionId}`
        : undefined;

      if (branchName) {
        // Create worktree with new branch
        await exec(
          `git worktree add -b "${branchName}" "${targetDir}" HEAD`,
          { cwd: this.baseDir, maxBuffer: 4 * 1024 * 1024 }
        );
      } else {
        // Create detached worktree
        await exec(
          `git worktree add --detach "${targetDir}"`,
          { cwd: this.baseDir, maxBuffer: 4 * 1024 * 1024 }
        );
      }

      const { stdout: commit } = await exec('git rev-parse HEAD', { cwd: targetDir });

      this.worktrees.set(variant, {
        variant,
        path: targetDir,
        type: 'worktree',
        branch: branchName,
        commit: commit.trim(),
        createdAt: Date.now(),
      });

      return true;
    } catch (error) {
      // Clean up partial worktree if creation failed
      try {
        await exec(`git worktree remove "${targetDir}" --force`, { cwd: this.baseDir });
      } catch {
        // Ignore cleanup errors
      }
      return false;
    }
  }

  /**
   * Create a filesystem copy for non-git repos or when worktree fails.
   */
  private async createFilesystemCopy(variant: UpgradeVariant, targetDir: string): Promise<void> {
    const skipSet = new Set(this.skipDirs.map(d => join(this.baseDir, d)));

    cpSync(this.baseDir, targetDir, {
      recursive: true,
      filter: (src) => {
        // Skip configured directories
        for (const skip of skipSet) {
          if (src === skip || src.startsWith(skip + '/')) {
            return false;
          }
        }
        return true;
      },
    });

    this.worktrees.set(variant, {
      variant,
      path: targetDir,
      type: 'copy',
      createdAt: Date.now(),
    });
  }

  /**
   * Get the workspace path for a variant.
   */
  getWorkspacePath(variant: UpgradeVariant): string | undefined {
    return this.worktrees.get(variant)?.path;
  }

  /**
   * Get all workspace roots as a record.
   */
  getWorkspaceRoots(): Partial<Record<UpgradeVariant, string>> {
    const roots: Partial<Record<UpgradeVariant, string>> = {};
    for (const [variant, info] of this.worktrees) {
      roots[variant] = info.path;
    }
    return roots;
  }

  /**
   * Get info about a variant's workspace.
   */
  getWorktreeInfo(variant: UpgradeVariant): WorktreeInfo | undefined {
    return this.worktrees.get(variant);
  }

  /**
   * Compute diff for a variant's changes since base commit.
   */
  async getVariantDiff(variant: UpgradeVariant): Promise<VariantDiff | null> {
    const info = this.worktrees.get(variant);
    if (!info) return null;

    if (info.type === 'original' || !this.isGitRepo) {
      // For original or non-git, compute diff against saved state
      return this.computeNonGitDiff(variant);
    }

    try {
      const { stdout: diffStat } = await exec(
        `git diff --stat ${this.baseCommit}..HEAD`,
        { cwd: info.path, maxBuffer: 4 * 1024 * 1024 }
      );

      const { stdout: diffContent } = await exec(
        `git diff ${this.baseCommit}..HEAD`,
        { cwd: info.path, maxBuffer: 8 * 1024 * 1024 }
      );

      const { stdout: files } = await exec(
        `git diff --name-only ${this.baseCommit}..HEAD`,
        { cwd: info.path }
      );

      const filesChanged = files.trim().split('\n').filter(Boolean);
      const statMatch = diffStat.match(/(\d+) insertions?\(\+\).*?(\d+) deletions?\(-\)/);
      const insertions = statMatch ? parseInt(statMatch[1] ?? '0', 10) : 0;
      const deletions = statMatch ? parseInt(statMatch[2] ?? '0', 10) : 0;

      return {
        variant,
        filesChanged,
        insertions,
        deletions,
        diff: diffContent,
      };
    } catch {
      return null;
    }
  }

  /**
   * Compute diff for non-git repos by tracking file changes.
   */
  private async computeNonGitDiff(_variant: UpgradeVariant): Promise<VariantDiff | null> {
    // For non-git repos, return empty diff (would need snapshot comparison)
    return {
      variant: _variant,
      filesChanged: [],
      insertions: 0,
      deletions: 0,
      diff: '',
    };
  }

  /**
   * Compare changes between primary and refiner variants.
   */
  async compareVariants(): Promise<CrossVariantComparison | null> {
    const primaryDiff = await this.getVariantDiff('primary');
    const refinerDiff = await this.getVariantDiff('refiner');

    if (!primaryDiff) return null;

    const primaryFiles = new Set(primaryDiff.filesChanged);
    const refinerFiles = new Set(refinerDiff?.filesChanged ?? []);

    const commonFiles: string[] = [];
    const allFiles = new Set([...primaryFiles, ...refinerFiles]);

    for (const file of allFiles) {
      if (primaryFiles.has(file) && refinerFiles.has(file)) {
        commonFiles.push(file);
      }
    }

    // Detect conflicting changes (same file, different content)
    const conflictingFiles: string[] = [];
    for (const file of commonFiles) {
      const primaryPath = join(this.worktrees.get('primary')!.path, file);
      const refinerPath = join(this.worktrees.get('refiner')?.path ?? '', file);

      if (existsSync(primaryPath) && existsSync(refinerPath)) {
        try {
          const primaryContent = readFileSync(primaryPath, 'utf8');
          const refinerContent = readFileSync(refinerPath, 'utf8');
          if (primaryContent !== refinerContent) {
            conflictingFiles.push(file);
          }
        } catch {
          // Ignore read errors
        }
      }
    }

    return {
      primary: primaryDiff,
      refiner: refinerDiff ?? undefined,
      commonFiles,
      conflictingFiles,
    };
  }

  /**
   * Apply the winning variant's changes to the primary workspace.
   */
  async applyWinnerChanges(winner: UpgradeVariant): Promise<boolean> {
    if (winner === 'primary') {
      // Primary already has its changes in place
      return true;
    }

    const winnerInfo = this.worktrees.get(winner);
    const primaryInfo = this.worktrees.get('primary');

    if (!winnerInfo || !primaryInfo) return false;

    if (this.isGitRepo && winnerInfo.type === 'worktree' && winnerInfo.branch) {
      // Merge winner branch into primary
      try {
        await exec(`git merge --no-ff "${winnerInfo.branch}" -m "Apply ${winner} changes"`, {
          cwd: primaryInfo.path,
        });
        return true;
      } catch {
        // Fall through to file copy
      }
    }

    // Copy changed files from winner to primary
    const diff = await this.getVariantDiff(winner);
    if (!diff) return false;

    for (const file of diff.filesChanged) {
      const srcPath = join(winnerInfo.path, file);
      const destPath = join(primaryInfo.path, file);

      if (existsSync(srcPath)) {
        try {
          const content = readFileSync(srcPath);
          writeFileSync(destPath, content);
        } catch {
          // Continue with other files
        }
      }
    }

    return true;
  }

  /**
   * Clean up all created worktrees and copies.
   */
  async cleanup(): Promise<void> {
    for (const [variant, info] of this.worktrees) {
      if (variant === 'primary' || info.type === 'original') {
        continue;
      }

      try {
        if (info.type === 'worktree') {
          // Remove git worktree
          await exec(`git worktree remove "${info.path}" --force`, {
            cwd: this.baseDir,
          });

          // Delete branch if we created one
          if (info.branch) {
            try {
              await exec(`git branch -D "${info.branch}"`, { cwd: this.baseDir });
            } catch {
              // Branch may not exist or may be checked out elsewhere
            }
          }
        } else {
          // Remove filesystem copy
          rmSync(info.path, { recursive: true, force: true });
        }
      } catch {
        // Best effort cleanup
        try {
          rmSync(info.path, { recursive: true, force: true });
        } catch {
          // Ignore
        }
      }
    }

    // Clear all non-primary entries
    for (const variant of this.worktrees.keys()) {
      if (variant !== 'primary') {
        this.worktrees.delete(variant);
      }
    }
  }

  /**
   * Run a command in a specific variant's workspace.
   */
  async runInWorkspace(
    variant: UpgradeVariant,
    command: string,
    options?: { timeout?: number }
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const info = this.worktrees.get(variant);
    if (!info) {
      throw new Error(`Workspace not found for variant: ${variant}`);
    }

    return new Promise((resolve) => {
      const child = spawn('bash', ['-c', command], {
        cwd: info.path,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: options?.timeout ?? 120000,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      });

      child.on('error', (error) => {
        resolve({ stdout, stderr: error.message, exitCode: 1 });
      });
    });
  }

  /**
   * Get status summary of all workspaces.
   */
  getStatusSummary(): string {
    const parts: string[] = [];
    for (const [variant, info] of this.worktrees) {
      const typeIcon = info.type === 'worktree' ? 'W' : info.type === 'copy' ? 'C' : 'O';
      parts.push(`${variant}[${typeIcon}]:${basename(info.path)}`);
    }
    return parts.join(' | ');
  }

  /**
   * Check if git worktrees are available.
   */
  get supportsWorktrees(): boolean {
    return this.isGitRepo === true;
  }

  /**
   * Get the base commit that all variants started from.
   */
  get baseCommitHash(): string | null {
    return this.baseCommit;
  }
}
