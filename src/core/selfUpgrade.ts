/**
 * Self-Upgrade System for AGI Core
 *
 * Provides the ability to:
 * 1. npm install a fresh version of the CLI
 * 2. Launch a new CLI instance
 * 3. Continue work seamlessly after upgrade
 * 4. Integrate with edits, builds, tests, and RL scoring
 *
 * This module enables true self-improvement through version updates
 * while maintaining session continuity.
 */

import { exec as execCallback, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';

const execAsync = promisify(execCallback);

// ============================================================================
// TYPES
// ============================================================================

export interface SelfUpgradeConfig {
  /** Package name to upgrade (default: deepseek-coder-cli) */
  packageName?: string;
  /** Whether to run in global mode (default: true) */
  global?: boolean;
  /** Working directory for session resumption */
  workingDir?: string;
  /** Custom logger function */
  logger?: (message: string) => void;
  /** Timeout for npm operations in ms (default: 5 minutes) */
  timeout?: number;
  /** Whether to automatically restart after upgrade */
  autoRestart?: boolean;
  /** Session state to preserve across upgrade */
  sessionState?: UpgradeSessionState;
}

export interface UpgradeSessionState {
  /** Current working directory */
  workingDir: string;
  /** Pending tasks to continue */
  pendingTasks?: string[];
  /** Last user prompt */
  lastPrompt?: string;
  /** Context summary for resumption */
  contextSummary?: string;
  /** Current version before upgrade */
  fromVersion: string;
  /** Target version after upgrade */
  toVersion?: string;
  /** Timestamp of upgrade initiation */
  timestamp: number;
  /** RL iteration context if applicable */
  rlContext?: RLUpgradeContext;
  /** Files being edited before upgrade */
  activeEdits?: string[];
  /** Build state before upgrade */
  buildState?: BuildState;
  /** Test state before upgrade */
  testState?: TestState;
}

export interface RLUpgradeContext {
  /** Current iteration number */
  iteration: number;
  /** Current agent variant */
  variant: 'primary' | 'refiner';
  /** Objective being worked on */
  objective: string;
  /** Current score before upgrade */
  currentScore: number;
  /** Files modified so far */
  filesModified: string[];
}

export interface BuildState {
  /** Whether build was successful */
  success: boolean;
  /** Build output/errors */
  output?: string;
  /** Build command used */
  command?: string;
}

export interface TestState {
  /** Number of tests passed */
  passed: number;
  /** Number of tests failed */
  failed: number;
  /** Test output */
  output?: string;
  /** Test command used */
  command?: string;
}

export interface UpgradeResult {
  /** Whether upgrade was successful */
  success: boolean;
  /** Previous version */
  fromVersion: string;
  /** New version (if successful) */
  toVersion?: string;
  /** Error message if failed */
  error?: string;
  /** Whether CLI was restarted */
  restarted: boolean;
  /** Duration of upgrade in ms */
  durationMs: number;
  /** RL score impact (if applicable) */
  rlScoreImpact?: number;
}

export interface VersionInfo {
  /** Current installed version */
  current: string;
  /** Latest available version */
  latest: string;
  /** Whether update is available */
  updateAvailable: boolean;
  /** Release notes URL */
  releaseNotesUrl?: string;
}

export type UpgradeEventType =
  | 'upgrade:start'
  | 'upgrade:download'
  | 'upgrade:install'
  | 'upgrade:complete'
  | 'upgrade:error'
  | 'upgrade:restart'
  | 'upgrade:resume'
  | 'upgrade:rl-checkpoint';

export interface UpgradeEvent {
  type: UpgradeEventType;
  timestamp: number;
  data?: Record<string, unknown>;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_PACKAGE_NAME = 'deepseek-coder-cli';
const DEFAULT_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const SESSION_STATE_FILE = join(homedir(), '.agi', 'upgrade-session.json');
const UPGRADE_LOG_FILE = join(homedir(), '.agi', 'upgrade-log.json');
const RL_CHECKPOINT_FILE = join(homedir(), '.agi', 'rl-checkpoint.json');

// ============================================================================
// SELF-UPGRADE CLASS
// ============================================================================

export class SelfUpgrade extends EventEmitter {
  private config: Required<Omit<SelfUpgradeConfig, 'sessionState'>> & { sessionState?: UpgradeSessionState };
  private upgradeInProgress = false;
  private childProcess: ChildProcess | null = null;

  constructor(config: SelfUpgradeConfig = {}) {
    super();
    this.config = {
      packageName: config.packageName ?? DEFAULT_PACKAGE_NAME,
      global: config.global ?? true,
      workingDir: config.workingDir ?? process.cwd(),
      logger: config.logger ?? console.log,
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
      autoRestart: config.autoRestart ?? true,
      sessionState: config.sessionState,
    };
  }

  // ==========================================================================
  // VERSION CHECKING
  // ==========================================================================

  /**
   * Check for available updates
   */
  async checkForUpdates(): Promise<VersionInfo> {
    const current = await this.getCurrentVersion();
    const latest = await this.getLatestVersion();

    return {
      current,
      latest,
      updateAvailable: this.compareVersions(latest, current) > 0,
      releaseNotesUrl: `https://github.com/anthropics/claude-code/releases/tag/v${latest}`,
    };
  }

  /**
   * Get currently installed version
   */
  async getCurrentVersion(): Promise<string> {
    // Method 1: Try to read from global node_modules package.json
    try {
      const { stdout: prefix } = await execAsync('npm config get prefix', { timeout: 5000 });
      const globalPrefix = prefix.trim();
      const pkgJsonPath = join(globalPrefix, 'lib', 'node_modules', this.config.packageName, 'package.json');
      if (existsSync(pkgJsonPath)) {
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
        if (pkgJson.version) {
          return pkgJson.version;
        }
      }
    } catch {
      // Fall through to next method
    }

    // Method 2: Try npm list with proper parsing
    try {
      const { stdout } = await execAsync(`npm list -g ${this.config.packageName} --depth=0 --json`, {
        timeout: 10000,
      });
      const result = JSON.parse(stdout);
      // Check multiple possible locations in the JSON structure
      const version =
        result.dependencies?.[this.config.packageName]?.version ||
        result.devDependencies?.[this.config.packageName]?.version ||
        result.version;
      if (version && version !== '0.0.0') {
        return version;
      }
    } catch {
      // Fall through to next method
    }

    // Method 3: Try parsing npm list text output
    try {
      const { stdout } = await execAsync(`npm list -g ${this.config.packageName} --depth=0`, {
        timeout: 10000,
      });
      // Output format: "└── agi-core-cli@1.1.44" or similar
      const match = stdout.match(new RegExp(`${this.config.packageName}@([\\d.]+)`));
      if (match?.[1]) {
        return match[1];
      }
    } catch {
      // Fall through
    }

    return '0.0.0';
  }

  /**
   * Get latest available version from npm registry
   */
  async getLatestVersion(): Promise<string> {
    try {
      const { stdout } = await execAsync(`npm view ${this.config.packageName} version`, {
        timeout: 10000,
      });
      return stdout.trim();
    } catch {
      return '0.0.0';
    }
  }

  /**
   * Compare two semver versions
   * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.replace(/^v/, '').split('.').map(Number);
    const parts2 = v2.replace(/^v/, '').split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }
    return 0;
  }

  // ==========================================================================
  // UPGRADE EXECUTION
  // ==========================================================================

  /**
   * Perform npm install of fresh version
   */
  async npmInstallFresh(version?: string): Promise<UpgradeResult> {
    if (this.upgradeInProgress) {
      return {
        success: false,
        fromVersion: await this.getCurrentVersion(),
        error: 'Upgrade already in progress',
        restarted: false,
        durationMs: 0,
      };
    }

    this.upgradeInProgress = true;
    const startTime = Date.now();
    const fromVersion = await this.getCurrentVersion();

    this.emitEvent('upgrade:start', { fromVersion, targetVersion: version || 'latest' });

    try {
      // Save session state before upgrade
      if (this.config.sessionState) {
        this.saveSessionState({
          ...this.config.sessionState,
          fromVersion,
          toVersion: version,
          timestamp: Date.now(),
        });
      }

      // Build install command
      const globalFlag = this.config.global ? '-g ' : '';
      const versionSpec = version ? `@${version}` : '@latest';
      const command = `npm install ${globalFlag}${this.config.packageName}${versionSpec}`;

      this.config.logger(`Installing ${this.config.packageName}${versionSpec}...`);
      this.emitEvent('upgrade:download', { command });

      // Execute npm install
      await execAsync(command, {
        timeout: this.config.timeout,
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          npm_config_loglevel: 'warn',
        },
      });

      this.emitEvent('upgrade:install', { success: true });

      const toVersion = await this.getLatestVersion();
      const durationMs = Date.now() - startTime;

      // Log upgrade
      this.logUpgrade({
        success: true,
        fromVersion,
        toVersion,
        durationMs,
        timestamp: Date.now(),
      });

      this.config.logger(`Upgrade complete: ${fromVersion} -> ${toVersion}`);
      this.emitEvent('upgrade:complete', { fromVersion, toVersion, durationMs });

      // Auto-restart if configured
      if (this.config.autoRestart) {
        await this.launchNewInstance();
        return {
          success: true,
          fromVersion,
          toVersion,
          restarted: true,
          durationMs,
        };
      }

      return {
        success: true,
        fromVersion,
        toVersion,
        restarted: false,
        durationMs,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.config.logger(`Upgrade failed: ${errorMessage}`);
      this.emitEvent('upgrade:error', { error: errorMessage });

      return {
        success: false,
        fromVersion,
        error: errorMessage,
        restarted: false,
        durationMs: Date.now() - startTime,
      };
    } finally {
      this.upgradeInProgress = false;
    }
  }

  /**
   * Launch a new CLI instance and optionally continue work
   */
  async launchNewInstance(resumeSession = true): Promise<boolean> {
    try {
      const cliPath = process.argv[1] || 'agi';
      const args: string[] = [];

      // Add resume flag if we have session state
      if (resumeSession && this.hasPendingSession()) {
        args.push('--resume');
      }

      // Add working directory
      if (this.config.workingDir) {
        args.push('--cwd', this.config.workingDir);
      }

      this.config.logger('Launching new CLI instance...');
      this.emitEvent('upgrade:restart', { cliPath, args });

      // Spawn new process
      this.childProcess = spawn(process.execPath, [cliPath, ...args], {
        detached: true,
        stdio: 'inherit',
        cwd: this.config.workingDir,
        env: {
          ...process.env,
          AGI_UPGRADED: 'true',
          AGI_UPGRADE_FROM: await this.getCurrentVersion(),
          AGI_RESUME_SESSION: resumeSession ? 'true' : 'false',
        },
      });

      // Unref to allow parent to exit
      if (this.childProcess.unref) {
        this.childProcess.unref();
      }

      // Exit current process after short delay
      setTimeout(() => {
        process.exit(0);
      }, 500);

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.config.logger(`Failed to launch new instance: ${errorMessage}`);
      return false;
    }
  }

  // ==========================================================================
  // SESSION MANAGEMENT
  // ==========================================================================

  /**
   * Save session state for resumption after upgrade
   */
  saveSessionState(state: UpgradeSessionState): void {
    try {
      const dir = dirname(SESSION_STATE_FILE);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(SESSION_STATE_FILE, JSON.stringify(state, null, 2));
    } catch {
      // Best-effort
    }
  }

  /**
   * Load session state after upgrade
   */
  loadSessionState(): UpgradeSessionState | null {
    try {
      if (!existsSync(SESSION_STATE_FILE)) {
        return null;
      }
      const raw = readFileSync(SESSION_STATE_FILE, 'utf8');
      return JSON.parse(raw) as UpgradeSessionState;
    } catch {
      return null;
    }
  }

  /**
   * Clear session state after successful resumption
   */
  clearSessionState(): void {
    try {
      if (existsSync(SESSION_STATE_FILE)) {
        rmSync(SESSION_STATE_FILE);
      }
    } catch {
      // Best-effort
    }
  }

  /**
   * Check if there's a pending session to resume
   */
  hasPendingSession(): boolean {
    const state = this.loadSessionState();
    if (!state || !state.timestamp) return false;
    // Session valid if less than 24 hours old
    const maxAge = 24 * 60 * 60 * 1000;
    return Date.now() - state.timestamp < maxAge;
  }

  // ==========================================================================
  // RL INTEGRATION
  // ==========================================================================

  /**
   * Save RL checkpoint before upgrade (for RL scoring continuity)
   */
  saveRLCheckpoint(context: RLUpgradeContext): void {
    try {
      const dir = dirname(RL_CHECKPOINT_FILE);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(RL_CHECKPOINT_FILE, JSON.stringify({
        ...context,
        checkpointTime: Date.now(),
      }, null, 2));
      this.emitEvent('upgrade:rl-checkpoint', { context });
    } catch {
      // Best-effort
    }
  }

  /**
   * Load RL checkpoint after upgrade
   */
  loadRLCheckpoint(): RLUpgradeContext | null {
    try {
      if (!existsSync(RL_CHECKPOINT_FILE)) {
        return null;
      }
      const raw = readFileSync(RL_CHECKPOINT_FILE, 'utf8');
      const data = JSON.parse(raw);
      // Checkpoint valid if less than 1 hour old
      if (Date.now() - data.checkpointTime > 60 * 60 * 1000) {
        return null;
      }
      return data as RLUpgradeContext;
    } catch {
      return null;
    }
  }

  /**
   * Clear RL checkpoint after successful resumption
   */
  clearRLCheckpoint(): void {
    try {
      if (existsSync(RL_CHECKPOINT_FILE)) {
        rmSync(RL_CHECKPOINT_FILE);
      }
    } catch {
      // Best-effort
    }
  }

  /**
   * Calculate RL score impact from upgrade
   * Positive impact if upgrade improves capability
   */
  calculateRLScoreImpact(preUpgrade: RLUpgradeContext, postUpgradeSuccess: boolean): number {
    if (!postUpgradeSuccess) {
      return -0.1; // Penalty for failed upgrade attempt
    }

    // Base positive impact for successful upgrade
    let impact = 0.05;

    // Bonus for upgrading during active RL iteration
    if (preUpgrade.iteration > 0) {
      impact += 0.02;
    }

    // Bonus if files were modified (upgrade during active work)
    if (preUpgrade.filesModified.length > 0) {
      impact += 0.01 * Math.min(preUpgrade.filesModified.length, 5);
    }

    return impact;
  }

  // ==========================================================================
  // BUILD/TEST INTEGRATION
  // ==========================================================================

  /**
   * Upgrade with build verification
   */
  async upgradeWithBuildCheck(version?: string, buildCommand = 'npm run build'): Promise<UpgradeResult & { buildSuccess: boolean }> {
    const result = await this.npmInstallFresh(version);

    if (!result.success) {
      return { ...result, buildSuccess: false };
    }

    // Run build to verify upgrade didn't break anything
    try {
      await execAsync(buildCommand, {
        cwd: this.config.workingDir,
        timeout: this.config.timeout,
      });
      return { ...result, buildSuccess: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.config.logger(`Post-upgrade build failed: ${errorMessage}`);
      return { ...result, buildSuccess: false };
    }
  }

  /**
   * Upgrade with test verification
   */
  async upgradeWithTestCheck(version?: string, testCommand = 'npm test'): Promise<UpgradeResult & { testState: TestState }> {
    const result = await this.npmInstallFresh(version);

    if (!result.success) {
      return { ...result, testState: { passed: 0, failed: 0 } };
    }

    // Run tests to verify upgrade
    try {
      const { stdout, stderr } = await execAsync(testCommand, {
        cwd: this.config.workingDir,
        timeout: this.config.timeout,
      });
      const output = stdout + stderr;
      const passed = this.parseTestCount(output, 'pass');
      const failed = this.parseTestCount(output, 'fail');

      return {
        ...result,
        testState: { passed, failed, output, command: testCommand },
      };
    } catch (error) {
      const output = error instanceof Error ? (error as any).stdout + (error as any).stderr : '';
      const passed = this.parseTestCount(output, 'pass');
      const failed = this.parseTestCount(output, 'fail');

      return {
        ...result,
        testState: { passed, failed, output, command: testCommand },
      };
    }
  }

  /**
   * Full upgrade with build and test verification
   */
  async upgradeWithFullVerification(
    version?: string,
    buildCommand = 'npm run build',
    testCommand = 'npm test'
  ): Promise<UpgradeResult & { buildSuccess: boolean; testState: TestState }> {
    const result = await this.npmInstallFresh(version);

    if (!result.success) {
      return { ...result, buildSuccess: false, testState: { passed: 0, failed: 0 } };
    }

    // Run build
    let buildSuccess = false;
    try {
      await execAsync(buildCommand, {
        cwd: this.config.workingDir,
        timeout: this.config.timeout,
      });
      buildSuccess = true;
    } catch {
      this.config.logger('Post-upgrade build failed');
    }

    // Run tests
    let testState: TestState = { passed: 0, failed: 0 };
    try {
      const { stdout, stderr } = await execAsync(testCommand, {
        cwd: this.config.workingDir,
        timeout: this.config.timeout,
      });
      const output = stdout + stderr;
      testState = {
        passed: this.parseTestCount(output, 'pass'),
        failed: this.parseTestCount(output, 'fail'),
        output,
        command: testCommand,
      };
    } catch (error) {
      const output = error instanceof Error ? (error as any).stdout + (error as any).stderr : '';
      testState = {
        passed: this.parseTestCount(output, 'pass'),
        failed: this.parseTestCount(output, 'fail'),
        output,
        command: testCommand,
      };
    }

    return { ...result, buildSuccess, testState };
  }

  private parseTestCount(output: string, type: 'pass' | 'fail'): number {
    const match = output.match(new RegExp(`(\\d+)\\s*${type}`, 'i'));
    return match ? parseInt(match[1], 10) : 0;
  }

  // ==========================================================================
  // EDIT INTEGRATION
  // ==========================================================================

  /**
   * Save active edits before upgrade for continuity
   */
  saveActiveEdits(files: string[]): void {
    const state = this.loadSessionState() || {
      workingDir: this.config.workingDir,
      fromVersion: '0.0.0',
      timestamp: Date.now(),
    };

    this.saveSessionState({
      ...state,
      activeEdits: files,
    });
  }

  /**
   * Get active edits to resume after upgrade
   */
  getActiveEdits(): string[] {
    const state = this.loadSessionState();
    return state?.activeEdits || [];
  }

  // ==========================================================================
  // LOGGING
  // ==========================================================================

  private logUpgrade(entry: {
    success: boolean;
    fromVersion: string;
    toVersion?: string;
    durationMs: number;
    timestamp: number;
    error?: string;
  }): void {
    try {
      const dir = dirname(UPGRADE_LOG_FILE);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      let logs: typeof entry[] = [];
      if (existsSync(UPGRADE_LOG_FILE)) {
        try {
          logs = JSON.parse(readFileSync(UPGRADE_LOG_FILE, 'utf8'));
        } catch {
          logs = [];
        }
      }

      logs.push(entry);
      // Keep last 100 entries
      if (logs.length > 100) {
        logs = logs.slice(-100);
      }

      writeFileSync(UPGRADE_LOG_FILE, JSON.stringify(logs, null, 2));
    } catch {
      // Best-effort
    }
  }

  private emitEvent(type: UpgradeEventType, data?: Record<string, unknown>): void {
    const event: UpgradeEvent = {
      type,
      timestamp: Date.now(),
      data,
    };
    this.emit(type, event);
    this.emit('upgrade', event);
  }

  // ==========================================================================
  // STATIC UTILITIES
  // ==========================================================================

  /**
   * Check if this process was started after an upgrade
   */
  static wasUpgraded(): boolean {
    return process.env['AGI_UPGRADED'] === 'true';
  }

  /**
   * Get the version we upgraded from
   */
  static getUpgradeFromVersion(): string | null {
    return process.env['AGI_UPGRADE_FROM'] || null;
  }

  /**
   * Check if we should resume a session
   */
  static shouldResumeSession(): boolean {
    return process.env['AGI_RESUME_SESSION'] === 'true';
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

let selfUpgradeInstance: SelfUpgrade | null = null;

export function getSelfUpgrade(config?: SelfUpgradeConfig): SelfUpgrade {
  if (!selfUpgradeInstance || config) {
    selfUpgradeInstance = new SelfUpgrade(config);
  }
  return selfUpgradeInstance;
}

export function resetSelfUpgrade(): void {
  selfUpgradeInstance = null;
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Quick upgrade to latest version with session continuity
 */
export async function upgradeToLatest(options: {
  autoRestart?: boolean;
  workingDir?: string;
  logger?: (message: string) => void;
} = {}): Promise<UpgradeResult> {
  const upgrade = getSelfUpgrade({
    autoRestart: options.autoRestart ?? true,
    workingDir: options.workingDir,
    logger: options.logger,
  });
  return upgrade.npmInstallFresh();
}

/**
 * Upgrade with full verification (build + tests)
 */
export async function upgradeAndVerify(options: {
  version?: string;
  buildCommand?: string;
  testCommand?: string;
  workingDir?: string;
  logger?: (message: string) => void;
} = {}): Promise<UpgradeResult & { buildSuccess: boolean; testState: TestState }> {
  const upgrade = getSelfUpgrade({
    workingDir: options.workingDir,
    logger: options.logger,
    autoRestart: false, // Don't auto-restart, let caller decide after verification
  });
  return upgrade.upgradeWithFullVerification(
    options.version,
    options.buildCommand,
    options.testCommand
  );
}

/**
 * Save current work state for upgrade resumption
 */
export function saveUpgradeState(state: Omit<UpgradeSessionState, 'timestamp' | 'fromVersion'>): void {
  const upgrade = getSelfUpgrade();
  upgrade.getCurrentVersion().then((fromVersion) => {
    upgrade.saveSessionState({
      ...state,
      fromVersion,
      timestamp: Date.now(),
    });
  });
}

/**
 * Resume work after upgrade
 */
export function resumeAfterUpgrade(): UpgradeSessionState | null {
  const upgrade = getSelfUpgrade();
  const state = upgrade.loadSessionState();
  if (state) {
    upgrade.clearSessionState();
  }
  return state;
}
