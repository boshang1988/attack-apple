/**
 * Hot Reload System for AGI Core
 *
 * Enables seamless version transitions by:
 * 1. Detecting when a new version is available
 * 2. Hot-swapping modules where possible
 * 3. Gracefully restarting when full reload is needed
 * 4. Preserving state across reloads
 *
 * Integrated with the self-upgrade system for continuous improvement.
 */

import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, writeFileSync, mkdirSync, watchFile, unwatchFile } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { exec as execCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { getSelfUpgrade, type UpgradeSessionState, type RLUpgradeContext } from './selfUpgrade.js';

const execAsync = promisify(execCallback);

// ============================================================================
// TYPES
// ============================================================================

export interface HotReloadConfig {
  /** Enable automatic version checking */
  autoCheck?: boolean;
  /** Check interval in ms (default: 5 minutes) */
  checkInterval?: number;
  /** Enable hot-swap where possible (default: true) */
  enableHotSwap?: boolean;
  /** Logger function */
  logger?: (message: string) => void;
  /** Working directory */
  workingDir?: string;
}

export interface HotReloadState {
  /** Current version */
  currentVersion: string;
  /** Last check timestamp */
  lastCheck: number;
  /** Pending reload */
  pendingReload: boolean;
  /** Modules that can be hot-swapped */
  hotSwappableModules: string[];
  /** State to preserve across reload */
  preservedState: Record<string, unknown>;
}

export type HotReloadEventType =
  | 'hotReload:check'
  | 'hotReload:available'
  | 'hotReload:swap'
  | 'hotReload:restart'
  | 'hotReload:complete'
  | 'hotReload:error';

export interface HotReloadEvent {
  type: HotReloadEventType;
  timestamp: number;
  data?: Record<string, unknown>;
}

export interface ReloadStrategy {
  /** Whether hot-swap is possible */
  canHotSwap: boolean;
  /** Modules that need full reload */
  requiresRestart: string[];
  /** Modules that can be hot-swapped */
  hotSwappable: string[];
  /** Estimated downtime */
  estimatedDowntimeMs: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const STATE_FILE = join(homedir(), '.agi', 'hot-reload-state.json');
const DEFAULT_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Modules that can be hot-swapped without restart
const HOT_SWAPPABLE_MODULES = [
  'ui/theme',
  'ui/layout',
  'core/preferences',
  'shell/commandRegistry',
];

// Core modules that require full restart
const RESTART_REQUIRED_MODULES = [
  'core/agiCore',
  'core/selfUpgrade',
  'core/updateChecker',
  'headless/interactiveShell',
  'bin/agi',
];

// ============================================================================
// HOT RELOAD CLASS
// ============================================================================

export class HotReload extends EventEmitter {
  private config: Required<HotReloadConfig>;
  private state: HotReloadState;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private watchingFiles: string[] = [];

  constructor(config: HotReloadConfig = {}) {
    super();
    this.config = {
      autoCheck: config.autoCheck ?? false,
      checkInterval: config.checkInterval ?? DEFAULT_CHECK_INTERVAL,
      enableHotSwap: config.enableHotSwap ?? true,
      logger: config.logger ?? console.log,
      workingDir: config.workingDir ?? process.cwd(),
    };

    this.state = this.loadState();

    // Start auto-check if enabled
    if (this.config.autoCheck) {
      this.startAutoCheck();
    }
  }

  // ==========================================================================
  // STATE MANAGEMENT
  // ==========================================================================

  private loadState(): HotReloadState {
    try {
      if (existsSync(STATE_FILE)) {
        return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
      }
    } catch {
      // Start fresh
    }
    return {
      currentVersion: '0.0.0',
      lastCheck: 0,
      pendingReload: false,
      hotSwappableModules: HOT_SWAPPABLE_MODULES,
      preservedState: {},
    };
  }

  private saveState(): void {
    try {
      const dir = dirname(STATE_FILE);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
    } catch {
      // Best-effort
    }
  }

  // ==========================================================================
  // VERSION CHECKING
  // ==========================================================================

  /**
   * Start automatic version checking
   */
  startAutoCheck(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
    }
    this.checkTimer = setInterval(() => {
      this.checkForUpdates().catch(() => {});
    }, this.config.checkInterval);
  }

  /**
   * Stop automatic version checking
   */
  stopAutoCheck(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  /**
   * Check for available updates
   */
  async checkForUpdates(): Promise<{ available: boolean; version?: string; strategy?: ReloadStrategy }> {
    this.emitEvent('hotReload:check', {});
    this.state.lastCheck = Date.now();
    this.saveState();

    try {
      const selfUpgrade = getSelfUpgrade();
      const versionInfo = await selfUpgrade.checkForUpdates();

      if (versionInfo.updateAvailable) {
        const strategy = await this.determineReloadStrategy(versionInfo.current, versionInfo.latest);
        this.state.pendingReload = true;
        this.saveState();

        this.emitEvent('hotReload:available', {
          currentVersion: versionInfo.current,
          latestVersion: versionInfo.latest,
          strategy,
        });

        return {
          available: true,
          version: versionInfo.latest,
          strategy,
        };
      }

      return { available: false };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.emitEvent('hotReload:error', { error: errorMessage });
      return { available: false };
    }
  }

  /**
   * Determine the best reload strategy for a version update
   */
  async determineReloadStrategy(currentVersion: string, targetVersion: string): Promise<ReloadStrategy> {
    // For major version bumps, always require restart
    const currentMajor = parseInt(currentVersion.split('.')[0] || '0', 10);
    const targetMajor = parseInt(targetVersion.split('.')[0] || '0', 10);

    if (targetMajor > currentMajor) {
      return {
        canHotSwap: false,
        requiresRestart: RESTART_REQUIRED_MODULES,
        hotSwappable: [],
        estimatedDowntimeMs: 3000,
      };
    }

    // For minor/patch updates, check what changed
    try {
      const { stdout } = await execAsync(
        `npm view deepseek-coder-cli@${targetVersion} dist.tarball`,
        { timeout: 10000 }
      );

      // If we can't determine changes, assume restart needed
      if (!stdout.trim()) {
        return {
          canHotSwap: false,
          requiresRestart: RESTART_REQUIRED_MODULES,
          hotSwappable: [],
          estimatedDowntimeMs: 2000,
        };
      }

      // For now, assume patch updates can be hot-swapped for UI modules
      const currentMinor = parseInt(currentVersion.split('.')[1] || '0', 10);
      const targetMinor = parseInt(targetVersion.split('.')[1] || '0', 10);

      if (targetMinor === currentMinor) {
        // Patch update - try hot-swap
        return {
          canHotSwap: this.config.enableHotSwap,
          requiresRestart: [],
          hotSwappable: HOT_SWAPPABLE_MODULES,
          estimatedDowntimeMs: 500,
        };
      }

      // Minor update - partial hot-swap
      return {
        canHotSwap: this.config.enableHotSwap,
        requiresRestart: RESTART_REQUIRED_MODULES.slice(0, 2),
        hotSwappable: HOT_SWAPPABLE_MODULES,
        estimatedDowntimeMs: 1500,
      };
    } catch {
      return {
        canHotSwap: false,
        requiresRestart: RESTART_REQUIRED_MODULES,
        hotSwappable: [],
        estimatedDowntimeMs: 2000,
      };
    }
  }

  // ==========================================================================
  // HOT RELOAD EXECUTION
  // ==========================================================================

  /**
   * Perform hot reload with state preservation
   */
  async performHotReload(options: {
    preserveState?: Record<string, unknown>;
    rlContext?: RLUpgradeContext;
    activeEdits?: string[];
  } = {}): Promise<{ success: boolean; strategy: 'hot-swap' | 'restart'; error?: string }> {
    const updateCheck = await this.checkForUpdates();

    if (!updateCheck.available || !updateCheck.strategy) {
      return { success: false, strategy: 'hot-swap', error: 'No update available' };
    }

    const strategy = updateCheck.strategy;

    // Preserve state
    if (options.preserveState) {
      this.state.preservedState = {
        ...this.state.preservedState,
        ...options.preserveState,
      };
      this.saveState();
    }

    // Save RL context if provided
    if (options.rlContext) {
      const selfUpgrade = getSelfUpgrade();
      selfUpgrade.saveRLCheckpoint(options.rlContext);
    }

    // Save active edits
    if (options.activeEdits && options.activeEdits.length > 0) {
      const selfUpgrade = getSelfUpgrade();
      selfUpgrade.saveActiveEdits(options.activeEdits);
    }

    if (strategy.canHotSwap && strategy.hotSwappable.length > 0 && strategy.requiresRestart.length === 0) {
      // Attempt hot-swap
      try {
        await this.hotSwapModules(strategy.hotSwappable);
        this.state.pendingReload = false;
        this.saveState();
        this.emitEvent('hotReload:swap', { modules: strategy.hotSwappable });
        return { success: true, strategy: 'hot-swap' };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.config.logger(`Hot-swap failed, falling back to restart: ${errorMessage}`);
      }
    }

    // Full restart required
    return this.performFullRestart(options);
  }

  /**
   * Hot-swap specific modules without restart
   */
  private async hotSwapModules(modules: string[]): Promise<void> {
    for (const modulePath of modules) {
      try {
        // Clear module from cache
        const fullPath = join(this.config.workingDir, 'dist', modulePath + '.js');
        if (typeof require !== 'undefined' && require.cache) {
          delete require.cache[fullPath];
        }

        // Dynamic import to reload
        await import(fullPath + `?t=${Date.now()}`);
        this.config.logger(`Hot-swapped: ${modulePath}`);
      } catch (error) {
        throw new Error(`Failed to hot-swap ${modulePath}: ${error}`);
      }
    }
  }

  /**
   * Perform full restart with state preservation
   */
  private async performFullRestart(options: {
    preserveState?: Record<string, unknown>;
    rlContext?: RLUpgradeContext;
    activeEdits?: string[];
  } = {}): Promise<{ success: boolean; strategy: 'restart'; error?: string }> {
    this.emitEvent('hotReload:restart', { reason: 'full-reload-required' });

    const selfUpgrade = getSelfUpgrade({
      workingDir: this.config.workingDir,
      logger: this.config.logger,
      autoRestart: true,
      sessionState: {
        workingDir: this.config.workingDir,
        fromVersion: this.state.currentVersion,
        timestamp: Date.now(),
        activeEdits: options.activeEdits,
        rlContext: options.rlContext,
      },
    });

    const result = await selfUpgrade.npmInstallFresh();

    if (result.success) {
      this.state.pendingReload = false;
      this.state.currentVersion = result.toVersion || this.state.currentVersion;
      this.saveState();
      this.emitEvent('hotReload:complete', { version: result.toVersion });
      return { success: true, strategy: 'restart' };
    }

    return { success: false, strategy: 'restart', error: result.error };
  }

  // ==========================================================================
  // FILE WATCHING
  // ==========================================================================

  /**
   * Watch for local file changes (development mode)
   */
  watchFiles(files: string[]): void {
    // Unwatch existing
    this.unwatchFiles();

    for (const file of files) {
      if (existsSync(file)) {
        watchFile(file, { interval: 1000 }, () => {
          this.config.logger(`File changed: ${file}`);
          this.emit('fileChange', { file });
        });
        this.watchingFiles.push(file);
      }
    }
  }

  /**
   * Stop watching files
   */
  unwatchFiles(): void {
    for (const file of this.watchingFiles) {
      unwatchFile(file);
    }
    this.watchingFiles = [];
  }

  // ==========================================================================
  // STATE PRESERVATION
  // ==========================================================================

  /**
   * Preserve state for reload
   */
  preserveState(key: string, value: unknown): void {
    this.state.preservedState[key] = value;
    this.saveState();
  }

  /**
   * Get preserved state
   */
  getPreservedState<T>(key: string): T | undefined {
    return this.state.preservedState[key] as T | undefined;
  }

  /**
   * Clear preserved state
   */
  clearPreservedState(): void {
    this.state.preservedState = {};
    this.saveState();
  }

  // ==========================================================================
  // EVENT EMITTING
  // ==========================================================================

  private emitEvent(type: HotReloadEventType, data?: Record<string, unknown>): void {
    const event: HotReloadEvent = {
      type,
      timestamp: Date.now(),
      data,
    };
    this.emit(type, event);
    this.emit('hotReload', event);
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  /**
   * Cleanup resources
   */
  dispose(): void {
    this.stopAutoCheck();
    this.unwatchFiles();
    this.removeAllListeners();
  }

  // ==========================================================================
  // STATIC UTILITIES
  // ==========================================================================

  /**
   * Check if we should resume from a hot reload
   */
  static shouldResume(): boolean {
    try {
      if (!existsSync(STATE_FILE)) return false;
      const state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as HotReloadState;
      return Object.keys(state.preservedState || {}).length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Get preserved state from previous session
   */
  static getResumeState(): Record<string, unknown> | null {
    try {
      if (!existsSync(STATE_FILE)) return null;
      const state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as HotReloadState;
      return state.preservedState || null;
    } catch {
      return null;
    }
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

let hotReloadInstance: HotReload | null = null;

export function getHotReload(config?: HotReloadConfig): HotReload {
  if (!hotReloadInstance || config) {
    hotReloadInstance = new HotReload(config);
  }
  return hotReloadInstance;
}

export function resetHotReload(): void {
  if (hotReloadInstance) {
    hotReloadInstance.dispose();
  }
  hotReloadInstance = null;
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Quick check and reload if update available
 */
export async function checkAndReload(options: {
  preserveState?: Record<string, unknown>;
  rlContext?: RLUpgradeContext;
  logger?: (message: string) => void;
} = {}): Promise<boolean> {
  const hotReload = getHotReload({ logger: options.logger });
  const result = await hotReload.performHotReload(options);
  return result.success;
}

/**
 * Enable auto-checking for updates
 */
export function enableAutoCheck(intervalMs?: number): void {
  const hotReload = getHotReload({
    autoCheck: true,
    checkInterval: intervalMs,
  });
  hotReload.startAutoCheck();
}

/**
 * Disable auto-checking for updates
 */
export function disableAutoCheck(): void {
  const hotReload = getHotReload();
  hotReload.stopAutoCheck();
}
