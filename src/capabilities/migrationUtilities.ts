/**
 * MIGRATION UTILITIES FOR UNIVERSAL CAPABILITY FRAMEWORK
 * 
 * Utilities to help migrate existing capabilities to the Universal Capability Framework.
 * These tools provide automated migration, compatibility layers, and validation.
 */

import type { CapabilityContribution, CapabilityContext } from '../runtime/agentHost.js';
import type { ToolDefinition, ToolSuite } from '../core/toolRuntime.js';
import { UniversalCapabilityModule } from './universalCapabilityFramework.js';
import { UniversalCapabilityFramework } from './universalCapabilityFramework.js';
import { UniversalCapabilityFactory } from './universalCapabilityFramework.js';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// TYPES FOR MIGRATION
// ============================================================================

export interface LegacyCapability {
  id: string;
  name: string;
  description: string;
  tools?: ToolDefinition[];
  toolSuite?: ToolSuite;
  metadata?: Record<string, any>;
  create?(context: CapabilityContext): Promise<CapabilityContribution>;
  execute?(params: any): Promise<any>;
}

export interface MigrationReport {
  legacyCapability: LegacyCapability;
  migratedCapability: any;
  success: boolean;
  errors: string[];
  warnings: string[];
  migrationTime: number;
  compatibilityScore: number; // 0-100
}

export interface MigrationOptions {
  /** Preserve original capability alongside migrated version */
  preserveOriginal: boolean;
  /** Generate compatibility layer */
  generateCompatibilityLayer: boolean;
  /** Validate migration results */
  validateMigration: boolean;
  /** Output directory for migration artifacts */
  outputDir: string;
  /** Log level for migration process */
  logLevel: 'silent' | 'info' | 'debug';
}

// ============================================================================
// CAPABILITY MIGRATOR
// ============================================================================

export class CapabilityMigrator {
  private framework: UniversalCapabilityFramework;
  private options: MigrationOptions;

  constructor(framework: UniversalCapabilityFramework, options: Partial<MigrationOptions> = {}) {
    this.framework = framework;
    this.options = {
      preserveOriginal: true,
      generateCompatibilityLayer: true,
      validateMigration: true,
      outputDir: '/tmp/agi-migration',
      logLevel: 'info',
      ...options
    };

    // Create output directory
    fs.mkdirSync(this.options.outputDir, { recursive: true });
  }

  /**
   * Migrate a legacy capability to UniversalCapabilityModule
   */
  async migrateCapability(legacyCapability: LegacyCapability): Promise<MigrationReport> {
    const startTime = Date.now();
    const report: MigrationReport = {
      legacyCapability,
      migratedCapability: null,
      success: false,
      errors: [],
      warnings: [],
      migrationTime: 0,
      compatibilityScore: 0
    };

    try {
      this.log('info', `Starting migration of capability: ${legacyCapability.id}`);

      // Step 1: Analyze legacy capability
      const analysis = this.analyzeLegacyCapability(legacyCapability);
      report.compatibilityScore = analysis.compatibilityScore;
      
      if (analysis.warnings.length > 0) {
        report.warnings.push(...analysis.warnings);
      }

      // Step 2: Generate migrated capability class
      const migratedClass = this.generateMigratedCapability(legacyCapability, analysis);
      
      // Step 3: Create instance
      const migratedInstance = new migratedClass(this.framework, {
        legacyCapabilityId: legacyCapability.id,
        migrationTimestamp: new Date().toISOString()
      });

      report.migratedCapability = migratedInstance;

      // Step 4: Validate migration
      if (this.options.validateMigration) {
        const validation = await this.validateMigration(legacyCapability, migratedInstance);
        if (!validation.success) {
          report.errors.push(...validation.errors);
          throw new Error(`Migration validation failed: ${validation.errors.join(', ')}`);
        }
      }

      // Step 5: Generate compatibility layer if requested
      if (this.options.generateCompatibilityLayer) {
        await this.generateCompatibilityLayer(legacyCapability, migratedInstance, report);
      }

      // Step 6: Save migration artifacts
      await this.saveMigrationArtifacts(legacyCapability, migratedInstance, report);

      report.success = true;
      this.log('info', `✅ Successfully migrated capability: ${legacyCapability.id}`);
      this.log('info', `   Compatibility score: ${report.compatibilityScore}/100`);

    } catch (error: any) {
      report.errors.push(error.message);
      this.log('error', `❌ Failed to migrate capability ${legacyCapability.id}: ${error.message}`);
    } finally {
      report.migrationTime = Date.now() - startTime;
    }

    return report;
  }

  /**
   * Analyze a legacy capability for migration compatibility
   */
  private analyzeLegacyCapability(capability: LegacyCapability): {
    hasTools: boolean;
    hasToolSuite: boolean;
    hasCreateMethod: boolean;
    hasExecuteMethod: boolean;
    compatibilityScore: number;
    warnings: string[];
  } {
    const analysis = {
      hasTools: !!capability.tools && capability.tools.length > 0,
      hasToolSuite: !!capability.toolSuite,
      hasCreateMethod: typeof capability.create === 'function',
      hasExecuteMethod: typeof capability.execute === 'function',
      compatibilityScore: 0,
      warnings: [] as string[]
    };

    let score = 0;
    const maxScore = 100;

    // Check for required methods
    if (analysis.hasCreateMethod) score += 40;
    if (analysis.hasExecuteMethod) score += 30;
    if (analysis.hasTools || analysis.hasToolSuite) score += 30;

    analysis.compatibilityScore = score;

    // Generate warnings
    if (!analysis.hasCreateMethod) {
      analysis.warnings.push('Legacy capability missing create() method - will need manual implementation');
    }
    if (!analysis.hasExecuteMethod) {
      analysis.warnings.push('Legacy capability missing execute() method - will need manual implementation');
    }
    if (!analysis.hasTools && !analysis.hasToolSuite) {
      analysis.warnings.push('Legacy capability has no tools - empty capability will be created');
    }

    return analysis;
  }

  /**
   * Generate migrated capability class
   */
  private generateMigratedCapability(
    legacyCapability: LegacyCapability, 
    analysis: ReturnType<typeof this.analyzeLegacyCapability>
  ): new (framework: UniversalCapabilityFramework, config: any) => UniversalCapabilityModule {
    
    const legacyId = legacyCapability.id;
    const migratedId = this.generateMigratedId(legacyId);

    // Create dynamic class
    class MigratedCapability extends UniversalCapabilityModule {
      readonly id = migratedId;
      readonly metadata = {
        id: migratedId,
        version: '1.0.0',
        description: `Migrated from ${legacyCapability.name}`,
        author: 'Migration Utility',
        dependencies: [],
        provides: this.extractProvidedCapabilities(legacyCapability),
        requires: [],
        category: 'migrated',
        tags: ['migrated', 'legacy', legacyId],
        originalCapability: {
          id: legacyId,
          name: legacyCapability.name,
          description: legacyCapability.description
        }
      };

      private legacyCapability: LegacyCapability;

      constructor(framework: UniversalCapabilityFramework, config: any) {
        super(framework, config);
        this.legacyCapability = legacyCapability;
      }

      async create(context: CapabilityContext): Promise<CapabilityContribution> {
        // Try to use legacy create method if available
        if (analysis.hasCreateMethod && this.legacyCapability.create) {
          try {
            const legacyContribution = await this.legacyCapability.create(context);
            return this.transformLegacyContribution(legacyContribution);
          } catch (error) {
            this.log('warn', `Legacy create() method failed: ${error}`);
          }
        }

        // Fallback: generate from tools/toolSuite
        return this.generateContributionFromLegacy(context);
      }

      async execute(params: { operation: string; parameters: Record<string, any> }): Promise<any> {
        // Try to use legacy execute method if available
        if (analysis.hasExecuteMethod && this.legacyCapability.execute) {
          try {
            return await this.legacyCapability.execute(params);
          } catch (error) {
            this.log('warn', `Legacy execute() method failed: ${error}`);
          }
        }

        // Fallback: generic execution
        return {
          operation: params.operation,
          parameters: params.parameters,
          migratedFrom: legacyId,
          timestamp: new Date().toISOString(),
          note: 'Executed via migration compatibility layer'
        };
      }

      private extractProvidedCapabilities(capability: LegacyCapability): string[] {
        const provides: string[] = [];
        const baseId = legacyId.replace(/^capability\./, '');
        
        provides.push(`${baseId}.basic`);
        
        if (capability.tools && capability.tools.length > 0) {
          provides.push(`${baseId}.tools`);
        }
        
        if (capability.toolSuite) {
          provides.push(`${baseId}.toolSuite`);
        }
        
        return provides;
      }

      private transformLegacyContribution(legacyContribution: any): CapabilityContribution {
        return {
          id: migratedId,
          description: legacyCapability.description || `Migrated capability: ${legacyId}`,
          toolSuite: legacyContribution.toolSuite || {
            id: `${migratedId}-tools`,
            description: `Tools migrated from ${legacyId}`,
            tools: legacyCapability.tools || []
          },
          metadata: {
            ...legacyContribution.metadata,
            migrated: true,
            originalId: legacyId,
            migrationTimestamp: new Date().toISOString()
          }
        };
      }

      private generateContributionFromLegacy(context: CapabilityContext): CapabilityContribution {
        const tools = legacyCapability.tools || [];
        const toolSuite = legacyCapability.toolSuite;

        return {
          id: migratedId,
          description: legacyCapability.description || `Migrated capability: ${legacyId}`,
          toolSuite: toolSuite || {
            id: `${migratedId}-tools`,
            description: `Tools migrated from ${legacyId}`,
            tools
          },
          metadata: {
            workingDir: context.workingDir,
            migrated: true,
            originalId: legacyId,
            toolsCount: tools.length,
            migrationTimestamp: new Date().toISOString()
          }
        };
      }

      protected log(level: 'info' | 'warn' | 'error', message: string, data?: any): void {
        // Use the framework's log method from UniversalCapabilityModule
        super.log(level, message, data);
      }
    }

    return MigratedCapability as any;
  }

  /**
   * Generate compatibility layer for legacy code
   */
  private async generateCompatibilityLayer(
    legacyCapability: LegacyCapability,
    migratedCapability: UniversalCapabilityModule,
    report: MigrationReport
  ): Promise<void> {
    const compatibilityCode = this.generateCompatibilityCode(legacyCapability, migratedCapability);
    const filePath = path.join(this.options.outputDir, `${legacyCapability.id}.compatibility.ts`);
    
    fs.writeFileSync(filePath, compatibilityCode, 'utf8');
    
    report.warnings.push(`Compatibility layer generated at: ${filePath}`);
    this.log('info', `📄 Compatibility layer generated: ${filePath}`);
  }

  /**
   * Generate TypeScript code for compatibility layer
   */
  private generateCompatibilityCode(
    legacyCapability: LegacyCapability,
    migratedCapability: UniversalCapabilityModule
  ): string {
    const legacyId = legacyCapability.id;
    const migratedId = migratedCapability.id;
    const className = this.generateClassName(legacyId);
    
    return `/**
 * COMPATIBILITY LAYER: ${legacyId}
 * 
 * Generated by Universal Capability Framework Migration Utility
 * Date: ${new Date().toISOString()}
 * 
 * This file provides backward compatibility for code using the legacy
 * ${legacyId} capability. It wraps the migrated capability in the
 * Universal Capability Framework.
 */

import { UniversalCapabilityFramework } from '../capabilities/universalCapabilityFramework.js';
import { UniversalCapabilityFactory } from '../capabilities/universalCapabilityFramework.js';

/**
 * Legacy ${legacyId} compatibility wrapper
 */
export class ${className} {
  private migratedCapability: any;
  private framework: UniversalCapabilityFramework;

  constructor(config: any = {}) {
    // Initialize framework
    this.framework = new UniversalCapabilityFramework({
      rootDir: config.workingDir || process.cwd(),
      debug: config.debug || false,
      enableEvents: true,
      enableDependencyResolution: true
    });

    // Get migrated capability
    this.migratedCapability = UniversalCapabilityFactory.createCapability(
      '${this.getFactoryId(migratedId)}',
      this.framework,
      {
        legacyCapabilityId: '${legacyId}',
        ...config
      }
    );
  }

  /**
   * Get capability ID
   */
  get id(): string {
    return '${legacyId}';
  }

  /**
   * Get migrated capability ID
   */
  get migratedId(): string {
    return '${migratedId}';
  }

  /**
   * Create capability contribution (legacy compatibility)
   */
  async create(context: any): Promise<any> {
    if (!this.migratedCapability) {
      throw new Error('Migrated capability not initialized');
    }
    
    return await this.migratedCapability.create(context);
  }

  /**
   * Execute operation (legacy compatibility)
   */
  async execute(params: any): Promise<any> {
    if (!this.migratedCapability) {
      throw new Error('Migrated capability not initialized');
    }
    
    return await this.migratedCapability.execute(params);
  }

  /**
   * Get tools (legacy compatibility)
   */
  get tools(): any[] {
    // Return empty array - tools are now managed by framework
    return [];
  }

  /**
   * Get tool suite (legacy compatibility)
   */
  get toolSuite(): any {
    // Return minimal tool suite for compatibility
    return {
      id: '${legacyId}-compatibility',
      description: 'Compatibility layer for ${legacyId}',
      tools: []
    };
  }

  /**
   * Migration helper: check if capability is migrated
   */
  static isMigrated(): boolean {
    return true;
  }

  /**
   * Migration helper: get migration info
   */
  static getMigrationInfo(): any {
    return {
      legacyId: '${legacyId}',
      migratedId: '${migratedId}',
      migrationDate: '${new Date().toISOString()}',
      frameworkVersion: '1.0.0',
      compatibility: true
    };
  }
}

/**
 * Factory function for backward compatibility
 */
export function create${this.generateFactoryName(legacyId)}(config?: any): ${className} {
  return new ${className}(config);
}

/**
 * Default export for backward compatibility
 */
export default ${className};
`;
  }

  /**
   * Save migration artifacts
   */
  private async saveMigrationArtifacts(
    legacyCapability: LegacyCapability,
    migratedCapability: UniversalCapabilityModule,
    report: MigrationReport
  ): Promise<void> {
    const artifactsDir = path.join(this.options.outputDir, 'artifacts', legacyCapability.id);
    fs.mkdirSync(artifactsDir, { recursive: true });

    // Save migration report
    const reportPath = path.join(artifactsDir, 'migration_report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

    // Save capability analysis
    const analysisPath = path.join(artifactsDir, 'capability_analysis.json');
    const analysis = this.analyzeLegacyCapability(legacyCapability);
    fs.writeFileSync(analysisPath, JSON.stringify(analysis, null, 2), 'utf8');

    // Save migrated capability metadata
    const metadataPath = path.join(artifactsDir, 'migrated_metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(migratedCapability.metadata, null, 2), 'utf8');

    this.log('info', `📁 Migration artifacts saved to: ${artifactsDir}`);
  }

  /**
   * Validate migration results
   */
  private async validateMigration(
    legacyCapability: LegacyCapability,
    migratedCapability: UniversalCapabilityModule
  ): Promise<{ success: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Basic validation
    if (!migratedCapability.id) {
      errors.push('Migrated capability missing id');
    }

    if (!migratedCapability.metadata) {
      errors.push('Migrated capability missing metadata');
    }

    // Validate create method exists
    if (typeof migratedCapability.create !== 'function') {
      errors.push('Migrated capability missing create() method');
    }

    // Validate execute method exists
    if (typeof migratedCapability.execute !== 'function') {
      errors.push('Migrated capability missing execute() method');
    }

    // Try to create contribution (basic test)
    try {
      const testContext = { 
        profile: 'default' as any,
        workspaceContext: null,
        workingDir: process.cwd(),
        env: process.env
      };
      const contribution = await migratedCapability.create(testContext);
      
      // Handle both single contribution and array of contributions
      const contributions = Array.isArray(contribution) ? contribution : [contribution];
      
      for (const contrib of contributions) {
        if (contrib && contrib.id) {
          // At least one contribution has an id, that's sufficient
          break;
        }
      }
      
      // Check if we found at least one valid contribution
      const hasValidContribution = contributions.some(contrib => contrib && contrib.id);
      if (!hasValidContribution) {
        errors.push('No valid contribution with id found');
      }
    } catch (error: any) {
      errors.push(`Create method test failed: ${error.message}`);
    }

    return {
      success: errors.length === 0,
      errors
    };
  }

  /**
   * Generate a migrated ID from legacy ID
   */
  private generateMigratedId(legacyId: string): string {
    // Convert legacy ID to migrated format
    if (legacyId.startsWith('capability.')) {
      return `migrated.${legacyId.substring(11)}`;
    }
    return `migrated.${legacyId}`;
  }

  /**
   * Generate class name from ID
   */
  private generateClassName(id: string): string {
    const parts = id.split('.');
    return parts.map(part => 
      part.charAt(0).toUpperCase() + part.slice(1)
    ).join('') + 'Capability';
  }

  /**
   * Generate factory name from ID
   */
  private generateFactoryName(id: string): string {
    const className = this.generateClassName(id);
    return className.replace('Capability', '');
  }

  /**
   * Get factory ID from migrated ID
   */
  private getFactoryId(migratedId: string): string {
    // Extract base name for factory registration
    const parts = migratedId.split('.');
    return parts[parts.length - 1]; // Last part
  }

  /**
   * Log message with level
   */
  private log(level: 'info' | 'warn' | 'error', message: string): void {
    if (this.options.logLevel !== 'silent') {
      console.log(`[${level.toUpperCase()}] Migration: ${message}`);
    }
  }

  /**
   * Batch migrate multiple capabilities
   */
  async migrateCapabilities(capabilities: LegacyCapability[]): Promise<MigrationReport[]> {
    this.log('info', `Starting batch migration of ${capabilities.length} capabilities`);
    
    const reports: MigrationReport[] = [];
    const successful: string[] = [];
    const failed: string[] = [];

    for (const capability of capabilities) {
      try {
        const report = await this.migrateCapability(capability);
        reports.push(report);
        
        if (report.success) {
          successful.push(capability.id);
        } else {
          failed.push(capability.id);
        }
      } catch (error: any) {
        failed.push(capability.id);
        this.log('error', `Failed to migrate ${capability.id}: ${error.message}`);
      }
    }

    // Generate summary report
    const summary = {
      total: capabilities.length,
      successful: successful.length,
      failed: failed.length,
      successRate: (successful.length / capabilities.length) * 100,
      successfulCapabilities: successful,
      failedCapabilities: failed,
      totalMigrationTime: reports.reduce((sum, r) => sum + r.migrationTime, 0),
      averageCompatibilityScore: reports.reduce((sum, r) => sum + r.compatibilityScore, 0) / reports.length
    };

    const summaryPath = path.join(this.options.outputDir, 'migration_summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

    this.log('info', `📊 Migration Summary:`);
    this.log('info', `   Total: ${summary.total}`);
    this.log('info', `   Successful: ${summary.successful}`);
    this.log('info', `   Failed: ${summary.failed}`);
    this.log('info', `   Success Rate: ${summary.successRate.toFixed(1)}%`);
    this.log('info', `   Avg Compatibility: ${summary.averageCompatibilityScore.toFixed(1)}/100`);

    return reports;
  }

  /**
   * Analyze directory for legacy capabilities
   */
  analyzeDirectory(dirPath: string): {
    capabilities: LegacyCapability[];
    totalFiles: number;
    compatibleFiles: number;
    analysis: Record<string, any>;
  } {
    this.log('info', `Analyzing directory: ${dirPath}`);
    
    const capabilities: LegacyCapability[] = [];
    const analysis: Record<string, any> = {};
    
    // This would normally scan files and detect capability patterns
    // For now, return mock analysis
    
    return {
      capabilities,
      totalFiles: 0,
      compatibleFiles: 0,
      analysis
    };
  }
}

// ============================================================================
// MIGRATION HELPERS
// ============================================================================

/**
 * Create a migration-ready framework instance
 */
export function createMigrationFramework(config?: any): UniversalCapabilityFramework {
  return new UniversalCapabilityFramework({
    rootDir: process.cwd(),
    debug: true,
    enableEvents: true,
    enableDependencyResolution: true,
    sharedDataDir: '/tmp/agi-migration-framework',
    ...config
  });
}

/**
 * Register migrated capabilities with factory
 */
export function registerMigratedCapabilities(
  framework: UniversalCapabilityFramework,
  migratedClasses: Array<new (framework: UniversalCapabilityFramework, config: any) => UniversalCapabilityModule>
): void {
  migratedClasses.forEach((CapabilityClass, index) => {
    const instance = new CapabilityClass(framework, {});
    const factoryId = `migrated-${index}-${instance.id}`;
    
    UniversalCapabilityFactory.registerCapability(factoryId, CapabilityClass);
    
    console.log(`✅ Registered migrated capability: ${instance.id} as ${factoryId}`);
  });
}

/**
 * Generate migration report from results
 */
export function generateMigrationReport(results: MigrationReport[]): string {
  const total = results.length;
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const avgScore = results.reduce((sum, r) => sum + r.compatibilityScore, 0) / total;
  const avgTime = results.reduce((sum, r) => sum + r.migrationTime, 0) / total;

  const report = `
# MIGRATION REPORT

## Summary
- **Total Capabilities**: ${total}
- **Successful**: ${successful} (${((successful / total) * 100).toFixed(1)}%)
- **Failed**: ${failed} (${((failed / total) * 100).toFixed(1)}%)
- **Average Compatibility Score**: ${avgScore.toFixed(1)}/100
- **Average Migration Time**: ${avgTime.toFixed(0)}ms

## Successful Migrations
${results.filter(r => r.success).map(r => `- ${r.legacyCapability.id} → ${r.migratedCapability?.id || 'unknown'} (${r.compatibilityScore}/100)`).join('\n')}

## Failed Migrations
${results.filter(r => !r.success).map(r => `- ${r.legacyCapability.id}: ${r.errors.join(', ')}`).join('\n')}

## Recommendations
${generateRecommendations(results)}
`;

  return report;
}

/**
 * Generate recommendations based on migration results
 */
function generateRecommendations(results: MigrationReport[]): string {
  const recommendations: string[] = [];
  
  const lowScore = results.filter(r => r.compatibilityScore < 50);
  if (lowScore.length > 0) {
    recommendations.push(`**${lowScore.length} capabilities have low compatibility (<50%).** Consider manual refactoring for these.`);
  }
  
  const highScore = results.filter(r => r.compatibilityScore >= 80);
  if (highScore.length > 0) {
    recommendations.push(`**${highScore.length} capabilities have high compatibility (≥80%).** These can be migrated automatically.`);
  }
  
  const withWarnings = results.filter(r => r.warnings.length > 0);
  if (withWarnings.length > 0) {
    recommendations.push(`**${withWarnings.length} capabilities have warnings.** Review these before production deployment.`);
  }
  
  if (recommendations.length === 0) {
    recommendations.push('All capabilities migrated successfully. Ready for production deployment.');
  }
  
  return recommendations.join('\n\n');
}

// ============================================================================
// QUICK MIGRATION UTILITY
// ============================================================================

/**
 * Quick migration utility for common patterns
 */
export async function quickMigrate(
  legacyCapability: LegacyCapability,
  options?: Partial<MigrationOptions>
): Promise<MigrationReport> {
  const framework = createMigrationFramework();
  const migrator = new CapabilityMigrator(framework, options);
  
  return await migrator.migrateCapability(legacyCapability);
}

/**
 * Quick batch migration
 */
export async function quickBatchMigrate(
  capabilities: LegacyCapability[],
  options?: Partial<MigrationOptions>
): Promise<MigrationReport[]> {
  const framework = createMigrationFramework();
  const migrator = new CapabilityMigrator(framework, options);
  
  return await migrator.migrateCapabilities(capabilities);
}