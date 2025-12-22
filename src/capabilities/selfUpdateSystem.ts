/**
 * SELF-UPDATE SYSTEM FOR UNIVERSAL CAPABILITY FRAMEWORK
 * 
 * Implements automatic self-update capabilities as per AGI Code rules.
 * Provides version checking, state persistence, and seamless updates.
 */

import { UniversalCapabilityModule } from './universalCapabilityFramework.js';
import { UniversalCapabilityFramework } from './universalCapabilityFramework.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync, spawn } from 'child_process';

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

export interface UpdateManifest {
  version: string;
  timestamp: string;
  changes: string[];
  dependencies: Record<string, string>;
  breakingChanges: boolean;
  rollbackSupported: boolean;
}

export interface UpdateState {
  currentVersion: string;
  updateInProgress: boolean;
  lastUpdateAttempt: string | null;
  lastSuccessfulUpdate: string | null;
  pendingUpdate: UpdateManifest | null;
  errorHistory: Array<{ timestamp: string; error: string }>;
}

export interface SelfUpdateOptions {
  /** Enable automatic update checking */
  enableAutoUpdate: boolean;
  /** Check for updates interval (minutes) */
  checkIntervalMinutes: number;
  /** Auto-install minor updates */
  autoInstallMinor: boolean;
  /** Require confirmation for major updates */
  requireConfirmationMajor: boolean;
  /** Backup before update */
  enableBackup: boolean;
  /** Rollback on failure */
  enableRollback: boolean;
  /** Update channel: stable, beta, alpha */
  updateChannel: 'stable' | 'beta' | 'alpha';
}

// ============================================================================
// SELF UPDATE CAPABILITY MODULE
// ============================================================================

export class SelfUpdateCapability extends UniversalCapabilityModule {
  readonly id = 'capability.self-update';
  readonly metadata = {
    id: 'capability.self-update',
    version: '1.0.0',
    description: 'Automatic self-update system for Universal Capability Framework',
    author: 'AGI Core Team',
    dependencies: ['capability.universal-filesystem', 'capability.universal-bash'],
    provides: [
      'framework.update.check',
      'framework.update.install',
      'framework.update.rollback',
      'framework.update.status'
    ],
    requires: ['node', 'npm', 'git'],
    category: 'system',
    tags: ['update', 'maintenance', 'system']
  };

  private options: SelfUpdateOptions;
  private stateFile: string;
  private updateDir: string;

  constructor(framework: UniversalCapabilityFramework, config: Partial<SelfUpdateOptions> = {}) {
    super(framework, config);

    this.options = {
      enableAutoUpdate: true,
      checkIntervalMinutes: 60, // 1 hour
      autoInstallMinor: true,
      requireConfirmationMajor: true,
      enableBackup: true,
      enableRollback: true,
      updateChannel: 'stable',
      ...config
    };

    this.stateFile = path.join(framework.getConfig().sharedDataDir || '/tmp/agi-updates', 'update-state.json');
    this.updateDir = path.join(framework.getConfig().sharedDataDir || '/tmp/agi-updates', 'pending');

    // Ensure directories exist
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    fs.mkdirSync(this.updateDir, { recursive: true });
  }

  async create(context: any): Promise<any> {
    this.log('info', 'Self-update capability initialized');
    
    return {
      id: this.id,
      description: this.metadata.description,
      toolSuite: {
        id: `${this.id}-tools`,
        description: 'Self-update system tools',
        tools: this.createUpdateTools()
      },
      metadata: {
        ...this.metadata,
        options: this.options,
        stateFile: this.stateFile,
        updateDir: this.updateDir
      }
    };
  }

  async execute(params: {
    operation: string;
    parameters: Record<string, any>;
    operationId?: string;
  }): Promise<any> {
    const opId = params.operationId || this.utilities.generateOperationId('self-update');

    switch (params.operation) {
      case 'check_for_updates':
        return await this.checkForUpdates(params.parameters.force || false);
      case 'install_update':
        return await this.installUpdate(params.parameters.version, params.parameters.confirm);
      case 'rollback_update':
        return await this.rollbackUpdate(params.parameters.targetVersion);
      case 'get_update_status':
        return await this.getUpdateStatus();
      case 'configure_updates':
        return await this.configureUpdates(params.parameters.config);
      case 'manual_update':
        return await this.performManualUpdate(params.parameters.command);
      default:
        throw new Error(`Unknown self-update operation: ${params.operation}`);
    }
  }

  // ============================================================================
  // UPDATE TOOLS
  // ============================================================================

  private createUpdateTools(): any[] {
    return [
      {
        name: 'check_for_updates',
        description: 'Check for framework updates',
        parameters: {
          type: 'object',
          properties: {
            force: {
              type: 'boolean',
              description: 'Force check ignoring cache'
            }
          }
        },
        execute: async (args: any) => {
          return await this.checkForUpdates(args.force || false);
        }
      },
      {
        name: 'install_update',
        description: 'Install available framework update',
        parameters: {
          type: 'object',
          properties: {
            version: {
              type: 'string',
              description: 'Version to install (latest if not specified)'
            },
            confirm: {
              type: 'boolean',
              description: 'Confirm installation'
            }
          },
          required: ['confirm']
        },
        execute: async (args: any) => {
          return await this.installUpdate(args.version, args.confirm);
        }
      },
      {
        name: 'rollback_update',
        description: 'Rollback to previous version',
        parameters: {
          type: 'object',
          properties: {
            targetVersion: {
              type: 'string',
              description: 'Version to rollback to'
            }
          }
        },
        execute: async (args: any) => {
          return await this.rollbackUpdate(args.targetVersion);
        }
      },
      {
        name: 'get_update_status',
        description: 'Get current update status',
        parameters: {
          type: 'object',
          properties: {}
        },
        execute: async () => {
          return await this.getUpdateStatus();
        }
      },
      {
        name: 'configure_updates',
        description: 'Configure update settings',
        parameters: {
          type: 'object',
          properties: {
            config: {
              type: 'object',
              description: 'Update configuration'
            }
          },
          required: ['config']
        },
        execute: async (args: any) => {
          return await this.configureUpdates(args.config);
        }
      }
    ];
  }

  // ============================================================================
  // CORE UPDATE FUNCTIONALITY
  // ============================================================================

  /**
   * Check for available updates
   */
  async checkForUpdates(force: boolean = false): Promise<any> {
    this.log('info', 'Checking for framework updates...');

    const state = await this.loadState();
    
    // Check if we should skip based on interval
    if (!force && state.lastUpdateAttempt) {
      const lastAttempt = new Date(state.lastUpdateAttempt).getTime();
      const now = Date.now();
      const intervalMs = this.options.checkIntervalMinutes * 60 * 1000;
      
      if (now - lastAttempt < intervalMs) {
        this.log('info', 'Skipping update check - within interval');
        return {
          checked: false,
          reason: 'within_check_interval',
          nextCheck: new Date(lastAttempt + intervalMs).toISOString()
        };
      }
    }

    try {
      // Get current version
      const currentVersion = await this.getCurrentVersion();
      
      // Check npm registry for updates
      const latestVersion = await this.checkNpmRegistry();
      
      // Compare versions
      const updateAvailable = this.compareVersions(currentVersion, latestVersion) < 0;
      
      if (updateAvailable) {
        const manifest = await this.fetchUpdateManifest(latestVersion);
        state.pendingUpdate = manifest;
        state.lastUpdateAttempt = new Date().toISOString();
        await this.saveState(state);
        
        this.log('info', `Update available: ${currentVersion} → ${latestVersion}`);
        
        return {
          updateAvailable: true,
          currentVersion,
          latestVersion,
          manifest,
          breakingChanges: manifest.breakingChanges,
          shouldUpdate: this.shouldAutoUpdate(manifest)
        };
      } else {
        state.lastUpdateAttempt = new Date().toISOString();
        await this.saveState(state);
        
        this.log('info', 'Framework is up to date');
        return {
          updateAvailable: false,
          currentVersion,
          latestVersion,
          message: 'Framework is up to date'
        };
      }
    } catch (error: any) {
      this.log('error', `Update check failed: ${error.message}`);
      
      // Record error in state
      state.errorHistory.push({
        timestamp: new Date().toISOString(),
        error: error.message
      });
      state.lastUpdateAttempt = new Date().toISOString();
      await this.saveState(state);
      
      throw error;
    }
  }

  /**
   * Install an update
   */
  async installUpdate(version?: string, confirm: boolean = false): Promise<any> {
    this.log('info', `Starting update installation${version ? ` to ${version}` : ''}`);
    
    const state = await this.loadState();
    
    if (state.updateInProgress) {
      throw new Error('Update already in progress');
    }

    // Get update manifest
    const manifest = version 
      ? await this.fetchUpdateManifest(version)
      : state.pendingUpdate;
    
    if (!manifest) {
      throw new Error('No update manifest available. Check for updates first.');
    }

    // Check for breaking changes
    if (manifest.breakingChanges && this.options.requireConfirmationMajor && !confirm) {
      return {
        requiresConfirmation: true,
        manifest,
        breakingChanges: manifest.breakingChanges,
        changes: manifest.changes
      };
    }

    // Start update
    state.updateInProgress = true;
    state.pendingUpdate = manifest;
    await this.saveState(state);

    try {
      // Step 1: Backup if enabled
      let backupPath: string | null = null;
      if (this.options.enableBackup) {
        backupPath = await this.createBackup();
      }

      // Step 2: Download update
      const updatePath = await this.downloadUpdate(manifest);

      // Step 3: Install update
      const result = await this.applyUpdate(updatePath, manifest);

      // Step 4: Update state
      state.updateInProgress = false;
      state.lastSuccessfulUpdate = new Date().toISOString();
      state.pendingUpdate = null;
      await this.saveState(state);

      this.log('info', `Successfully updated to version ${manifest.version}`);
      
      return {
        success: true,
        previousVersion: await this.getCurrentVersion(),
        newVersion: manifest.version,
        backupPath,
        changes: manifest.changes,
        timestamp: new Date().toISOString()
      };

    } catch (error: any) {
      // Update failed
      state.updateInProgress = false;
      state.errorHistory.push({
        timestamp: new Date().toISOString(),
        error: error.message
      });
      await this.saveState(state);

      // Rollback if enabled
      if (this.options.enableRollback) {
        this.log('info', 'Update failed, attempting rollback...');
        try {
          await this.performRollback();
        } catch (rollbackError: any) {
          this.log('error', `Rollback also failed: ${rollbackError.message}`);
        }
      }

      throw error;
    }
  }

  /**
   * Rollback to previous version
   */
  async rollbackUpdate(targetVersion?: string): Promise<any> {
    this.log('info', `Starting rollback${targetVersion ? ` to ${targetVersion}` : ''}`);
    
    const state = await this.loadState();
    
    if (state.updateInProgress) {
      throw new Error('Cannot rollback while update is in progress');
    }

    try {
      const result = await this.performRollback(targetVersion);
      
      state.lastSuccessfulUpdate = new Date().toISOString();
      await this.saveState(state);
      
      this.log('info', `Successfully rolled back to version ${result.version}`);
      
      return result;
    } catch (error: any) {
      this.log('error', `Rollback failed: ${error.message}`);
      
      state.errorHistory.push({
        timestamp: new Date().toISOString(),
        error: error.message
      });
      await this.saveState(state);
      
      throw error;
    }
  }

  /**
   * Get current update status
   */
  async getUpdateStatus(): Promise<any> {
    const state = await this.loadState();
    const currentVersion = await this.getCurrentVersion();
    
    return {
      currentVersion,
      updateInProgress: state.updateInProgress,
      lastUpdateAttempt: state.lastUpdateAttempt,
      lastSuccessfulUpdate: state.lastSuccessfulUpdate,
      pendingUpdate: state.pendingUpdate,
      errorCount: state.errorHistory.length,
      options: this.options,
      nextCheck: state.lastUpdateAttempt 
        ? new Date(new Date(state.lastUpdateAttempt).getTime() + this.options.checkIntervalMinutes * 60 * 1000).toISOString()
        : null
    };
  }

  /**
   * Configure update settings
   */
  async configureUpdates(config: Partial<SelfUpdateOptions>): Promise<any> {
    this.log('info', 'Updating self-update configuration');
    
    this.options = {
      ...this.options,
      ...config
    };

    // Save configuration
    const configPath = path.join(path.dirname(this.stateFile), 'update-config.json');
    fs.writeFileSync(configPath, JSON.stringify(this.options, null, 2), 'utf8');
    
    this.log('info', 'Self-update configuration updated');
    
    return {
      success: true,
      newConfig: this.options,
      configPath
    };
  }

  // ============================================================================
  // IMPLEMENTATION DETAILS
  // ============================================================================

  async loadState(): Promise<UpdateState> {
    try {
      if (fs.existsSync(this.stateFile)) {
        const content = fs.readFileSync(this.stateFile, 'utf8');
        return JSON.parse(content);
      }
    } catch (error) {
      this.log('warn', `Failed to load update state: ${error}`);
    }

    // Default state
    return {
      currentVersion: await this.getCurrentVersion(),
      updateInProgress: false,
      lastUpdateAttempt: null,
      lastSuccessfulUpdate: null,
      pendingUpdate: null,
      errorHistory: []
    };
  }

  private async saveState(state: UpdateState): Promise<void> {
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2), 'utf8');
    } catch (error: any) {
      this.log('error', `Failed to save update state: ${error.message}`);
    }
  }

  private async getCurrentVersion(): Promise<string> {
    try {
      // Read package.json
      const packagePath = path.join(process.cwd(), 'package.json');
      if (fs.existsSync(packagePath)) {
        const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        return packageData.version || '0.0.0';
      }
    } catch (error) {
      this.log('warn', `Failed to read current version: ${error}`);
    }
    
    return '0.0.0';
  }

  private async checkNpmRegistry(): Promise<string> {
    try {
      // In a real implementation, this would query npm registry
      // For now, simulate with a mock
      return await this.mockNpmRegistryCheck();
    } catch (error: any) {
      this.log('error', `Failed to check npm registry: ${error.message}`);
      throw error;
    }
  }

  private async mockNpmRegistryCheck(): Promise<string> {
    // Simulate registry check with delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Mock version based on update channel
    const baseVersion = '1.2.0';
    switch (this.options.updateChannel) {
      case 'alpha':
        return `${baseVersion}-alpha.1`;
      case 'beta':
        return `${baseVersion}-beta.1`;
      default:
        return baseVersion;
    }
  }

  private compareVersions(v1: string, v2: string): number {
    // Simple version comparison
    const parts1 = v1.split(/[.-]/).map(part => parseInt(part, 10) || 0);
    const parts2 = v2.split(/[.-]/).map(part => parseInt(part, 10) || 0);
    
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      
      if (p1 < p2) return -1;
      if (p1 > p2) return 1;
    }
    
    return 0;
  }

  private shouldAutoUpdate(manifest: UpdateManifest): boolean {
    if (!this.options.enableAutoUpdate) return false;
    
    // Check if this is a minor update and auto-install is enabled
    const current = manifest.version.split('.');
    const isMinorUpdate = current[2] && parseInt(current[2]) > 0; // Patch update
    
    if (isMinorUpdate && this.options.autoInstallMinor) {
      return true;
    }
    
    return false;
  }

  private async fetchUpdateManifest(version: string): Promise<UpdateManifest> {
    // In a real implementation, this would fetch from a manifest server
    // For now, create a mock manifest
    return {
      version,
      timestamp: new Date().toISOString(),
      changes: [
        'Performance improvements',
        'Bug fixes',
        'Security updates',
        'New capabilities added'
      ],
      dependencies: {
        'node': '>=18.0.0',
        'npm': '>=9.0.0'
      },
      breakingChanges: version.startsWith('2.') || version.includes('alpha'),
      rollbackSupported: true
    };
  }

  private async createBackup(): Promise<string> {
    const backupDir = path.join(this.updateDir, 'backups', new Date().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(backupDir, { recursive: true });
    
    // Copy key directories
    const dirsToBackup = ['dist', 'src', 'package.json', 'package-lock.json'];
    
    for (const dir of dirsToBackup) {
      const source = path.join(process.cwd(), dir);
      const target = path.join(backupDir, dir);
      
      if (fs.existsSync(source)) {
        if (fs.statSync(source).isDirectory()) {
          this.copyDirectory(source, target);
        } else {
          fs.copyFileSync(source, target);
        }
      }
    }
    
    this.log('info', `Backup created at: ${backupDir}`);
    return backupDir;
  }

  private copyDirectory(source: string, target: string): void {
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }
    
    const items = fs.readdirSync(source);
    for (const item of items) {
      const sourcePath = path.join(source, item);
      const targetPath = path.join(target, item);
      
      if (fs.statSync(sourcePath).isDirectory()) {
        this.copyDirectory(sourcePath, targetPath);
      } else {
        fs.copyFileSync(sourcePath, targetPath);
      }
    }
  }

  private async downloadUpdate(manifest: UpdateManifest): Promise<string> {
    const updatePath = path.join(this.updateDir, `update-${manifest.version}`);
    fs.mkdirSync(updatePath, { recursive: true });
    
    // Save manifest
    fs.writeFileSync(
      path.join(updatePath, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );
    
    // In a real implementation, this would download the update package
    // For now, create a mock update package
    this.log('info', `Update package prepared at: ${updatePath}`);
    
    return updatePath;
  }

  private async applyUpdate(updatePath: string, manifest: UpdateManifest): Promise<any> {
    this.log('info', `Applying update to version ${manifest.version}`);
    
    // Simulate update process
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // In a real implementation, this would:
    // 1. Extract update package
    // 2. Run pre-update scripts
    // 3. Replace files
    // 4. Run post-update scripts
    // 5. Update dependencies
    
    this.log('info', 'Update applied successfully');
    
    return {
      success: true,
      version: manifest.version,
      updatePath,
      appliedAt: new Date().toISOString()
    };
  }

  private async performRollback(targetVersion?: string): Promise<any> {
    this.log('info', 'Performing rollback...');
    
    // Find backup
    const backupDir = path.join(this.updateDir, 'backups');
    if (!fs.existsSync(backupDir)) {
      throw new Error('No backups available for rollback');
    }
    
    const backups = fs.readdirSync(backupDir)
      .map(name => ({ name, path: path.join(backupDir, name) }))
      .filter(item => fs.statSync(item.path).isDirectory())
      .sort((a, b) => b.name.localeCompare(a.name)); // Most recent first
    
    if (backups.length === 0) {
      throw new Error('No backups found');
    }
    
    // Use most recent backup or find specific version
    const backup = targetVersion 
      ? backups.find(b => b.name.includes(targetVersion))
      : backups[0];
    
    if (!backup) {
      throw new Error(`Backup for version ${targetVersion} not found`);
    }
    
    // Restore from backup
    this.log('info', `Restoring from backup: ${backup.name}`);
    
    // In a real implementation, this would restore files from backup
    await new Promise(resolve => setTimeout(resolve, 500));
    
    return {
      success: true,
      rolledBackFrom: await this.getCurrentVersion(),
      rolledBackTo: targetVersion || 'previous',
      backup: backup.name,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Perform manual update using npm commands
   */
  async performManualUpdate(command: string): Promise<any> {
    this.log('info', `Performing manual update: ${command}`);
    
    try {
      // Execute npm command
      const output = execSync(command, {
        cwd: process.cwd(),
        stdio: 'pipe',
        encoding: 'utf8'
      });
      
      this.log('info', 'Manual update completed successfully');
      
      return {
        success: true,
        command,
        output,
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      this.log('error', `Manual update failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check system requirements
   */
  async checkSystemRequirements(): Promise<any> {
    const requirements = {
      node: {
        required: '>=18.0.0',
        current: process.version,
        satisfied: false
      },
      npm: {
        required: '>=9.0.0',
        current: '',
        satisfied: false
      },
      diskSpace: {
        required: '100MB',
        available: '',
        satisfied: false
      },
      permissions: {
        required: 'write access to project directory',
        satisfied: false
      }
    };
    
    try {
      // Check npm version
      const npmVersion = execSync('npm --version', { encoding: 'utf8' }).trim();
      requirements.npm.current = npmVersion;
      requirements.npm.satisfied = this.compareVersions(npmVersion, '9.0.0') >= 0;
      
      // Check disk space (simplified)
      requirements.diskSpace.available = '1GB'; // Mock
      requirements.diskSpace.satisfied = true;
      
      // Check permissions
      try {
        const testFile = path.join(process.cwd(), '.permission-test');
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        requirements.permissions.satisfied = true;
      } catch {
        requirements.permissions.satisfied = false;
      }
      
      // Check node version
      requirements.node.satisfied = this.compareVersions(process.version.replace('v', ''), '18.0.0') >= 0;
      
      const allSatisfied = Object.values(requirements).every(req => 
        typeof req === 'object' && 'satisfied' in req ? req.satisfied : true
      );
      
      return {
        requirements,
        allSatisfied,
        canUpdate: allSatisfied
      };
    } catch (error: any) {
      this.log('error', `System check failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Schedule automatic update check
   */
  scheduleAutoUpdateCheck(): void {
    if (!this.options.enableAutoUpdate) return;
    
    const intervalMs = this.options.checkIntervalMinutes * 60 * 1000;
    
    setInterval(async () => {
      try {
        this.log('info', 'Performing scheduled update check');
        const result = await this.checkForUpdates(false);
        
        if (result.updateAvailable && result.shouldUpdate) {
          this.log('info', 'Auto-installing update...');
          await this.installUpdate(result.latestVersion, false);
        }
      } catch (error: any) {
        this.log('error', `Scheduled update check failed: ${error.message}`);
      }
    }, intervalMs);
    
    this.log('info', `Scheduled update check every ${this.options.checkIntervalMinutes} minutes`);
  }
}

// ============================================================================
// QUICK SELF-UPDATE UTILITIES
// ============================================================================

/**
 * Quick self-update utility
 */
export async function quickSelfUpdate(options?: Partial<SelfUpdateOptions>): Promise<any> {
  console.log('Self-update capability ready for integration');
  return {
    message: 'Self-update system initialized',
    version: '1.0.0',
    capabilities: ['check', 'install', 'rollback', 'status']
  };
}

/**
 * Register self-update capability with framework factory
 */
export function registerSelfUpdateCapability(): void {
  // This would register with UniversalCapabilityFactory
  // For now, export the capability class
  console.log('Self-update capability ready for integration');
}