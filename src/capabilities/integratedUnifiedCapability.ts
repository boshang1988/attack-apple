/**
 * INTEGRATED UNIFIED CAPABILITY MODULE
 * 
 * The ultimate integration module that unifies ALL capabilities from the README
 * into a single, cohesive framework using the Universal Capability Framework.
 * 
 * This module serves as the single source of truth for all AGI capabilities,
 * promoting maximum code reuse and consistent patterns across the entire codebase.
 */

import type { CapabilityContribution, CapabilityContext } from '../runtime/agentHost.js';
import { BaseCapabilityModule, BaseCapabilityOptions, ToolSuiteBuilder, SharedUtilities } from './baseCapability.js';
import { UniversalCapabilityFramework } from './universalCapabilityFramework.js';
import { UniversalCapabilityFactory } from './universalCapabilityFramework.js';

// Import all README capabilities
import { MultiProviderAICapability } from './readmeIntegration.js';
import { AlphaZeroSelfPlayCapability } from './readmeIntegration.js';
import { TaoSuiteCapability } from './readmeIntegration.js';
import { KineticOpsCapability } from './readmeIntegration.js';
import { EnhancedGitCapability } from './readmeIntegration.js';
import { WebToolsCapability } from './readmeIntegration.js';
import { MilitaryCapabilitiesIntegrator } from './readmeIntegration.js';

// Import universal core capabilities
import { UniversalFilesystemCapability } from './universalCapabilityFramework.js';
import { UniversalBashCapability } from './universalCapabilityFramework.js';
import { UniversalSearchCapability } from './universalCapabilityFramework.js';
import { UniversalEditCapability } from './universalCapabilityFramework.js';

// Import existing military capabilities for integration
import { EliteCryptoMilitaryCapabilityModule } from './eliteCryptoMilitaryCapability.js';
import { UnifiedMilitaryCapabilityModule } from './unifiedMilitaryCapability.js';
import { UniversalSecurityCapabilityModule } from './universalSecurityCapability.js';
import { MaxOffensiveUkraineCapabilityModule } from './maxOffensiveUkraineCapability.js';
import { OffensiveDestructionCapabilityModule } from './offensiveDestructionCapability.js';

// Import self-update capability
import { SelfUpdateCapability } from './selfUpdateSystem.js';

// Import CNO capabilities
import {
  NetworkReconnaissanceCapability,
  CommandControlCapability,
  SituationalAwarenessCapability,
  CNOUnifiedCapability
} from './cnoCapability.js';

// Import Chinese CNO integration capabilities
import {
  ChineseCnoIntegrationModule,
  ChineseCnoIntegration,
  CHINESE_APT_DATABASE
} from './chineseCnoIntegration.js';

// ============================================================================
// INTEGRATED UNIFIED CAPABILITY CONFIGURATION
// ============================================================================

export interface IntegratedUnifiedCapabilityOptions extends BaseCapabilityOptions {
  /** Enable universal framework integration */
  enableUniversalFramework: boolean;
  /** Enable README capabilities integration */
  enableReadmeCapabilities: boolean;
  /** Enable military capabilities integration */
  enableMilitaryIntegration: boolean;
  /** Enable CNO (网络作战) capabilities */
  enableCNOCapabilities: boolean;
  /** Enable Chinese CNO enhancement capabilities */
  enableChineseCnoEnhancements: boolean;
  /** Enable cross-module communication */
  enableCrossModuleCommunication: boolean;
  /** Unified working directory */
  unifiedWorkingDir?: string;
  /** Framework configuration */
  frameworkConfig?: Partial<{
    rootDir: string;
    debug: boolean;
    enableEvents: boolean;
    enableDependencyResolution: boolean;
    sharedDataDir: string;
  }>;
}

// ============================================================================
// INTEGRATED UNIFIED CAPABILITY MODULE
// ============================================================================

export class IntegratedUnifiedCapabilityModule extends BaseCapabilityModule {
  readonly id = 'capability.integrated-unified';
  protected declare readonly options: IntegratedUnifiedCapabilityOptions;
  
  private framework: UniversalCapabilityFramework | null = null;
  private capabilities: Map<string, any> = new Map();
  private unifiedToolSuite: any = null;

  constructor(options: Partial<IntegratedUnifiedCapabilityOptions> = {}) {
    const baseOptions: BaseCapabilityOptions = {
      workingDir: options.workingDir || process.cwd(),
      debug: options.debug || false,
      enableEvidence: true,
      authorization: 'full',
      emergencyOverride: true
    };

    super(baseOptions);

    this.options = {
      enableUniversalFramework: true,
      enableReadmeCapabilities: true,
      enableMilitaryIntegration: true,
      enableCNOCapabilities: true,
      enableChineseCnoEnhancements: true,
      enableCrossModuleCommunication: true,
      unifiedWorkingDir: options.workingDir || process.cwd(),
      ...options,
      ...baseOptions
    } as IntegratedUnifiedCapabilityOptions;

    this.initializeUnifiedFramework();
  }

  private initializeUnifiedFramework(): void {
    if (!this.options.enableUniversalFramework) return;

    // Create universal framework configuration
    const frameworkConfig = {
      rootDir: this.options.unifiedWorkingDir || this.options.workingDir,
      debug: this.options.debug || false,
      enableEvents: this.options.enableCrossModuleCommunication,
      enableDependencyResolution: true,
      sharedDataDir: '/tmp/agi-integrated-unified',
      ...this.options.frameworkConfig
    };

    this.framework = new UniversalCapabilityFramework(frameworkConfig);
    this.registerAllCapabilities();
  }

  private registerAllCapabilities(): void {
    if (!this.framework) return;

    // Register capability types with factory
    UniversalCapabilityFactory.registerCapability('universal-filesystem', UniversalFilesystemCapability);
    UniversalCapabilityFactory.registerCapability('universal-bash', UniversalBashCapability);
    UniversalCapabilityFactory.registerCapability('universal-search', UniversalSearchCapability);
    UniversalCapabilityFactory.registerCapability('universal-edit', UniversalEditCapability);
    UniversalCapabilityFactory.registerCapability('self-update', SelfUpdateCapability);
    
    if (this.options.enableReadmeCapabilities) {
      UniversalCapabilityFactory.registerCapability('multi-provider-ai', MultiProviderAICapability);
      UniversalCapabilityFactory.registerCapability('alpha-zero-self-play', AlphaZeroSelfPlayCapability);
      UniversalCapabilityFactory.registerCapability('tao-suite', TaoSuiteCapability);
      UniversalCapabilityFactory.registerCapability('kinetic-ops', KineticOpsCapability);
      UniversalCapabilityFactory.registerCapability('enhanced-git', EnhancedGitCapability);
      UniversalCapabilityFactory.registerCapability('web-tools', WebToolsCapability);
      UniversalCapabilityFactory.registerCapability('military-integrator', MilitaryCapabilitiesIntegrator);
    }

    // Register CNO (网络作战) capabilities
    if (this.options.enableCNOCapabilities) {
      UniversalCapabilityFactory.registerCapability('cno-reconnaissance', NetworkReconnaissanceCapability);
      UniversalCapabilityFactory.registerCapability('cno-command-control', CommandControlCapability);
      UniversalCapabilityFactory.registerCapability('cno-situational-awareness', SituationalAwarenessCapability);
      UniversalCapabilityFactory.registerCapability('cno-unified', CNOUnifiedCapability);
    }

    // Register Chinese CNO enhancement capabilities
    // Note: Temporarily disabled due to compatibility issues with UniversalCapabilityFactory
    // if (this.options.enableChineseCnoEnhancements) {
    //   UniversalCapabilityFactory.registerCapability('chinese-cno-enhancement', ChineseCnoEnhancementModule);
    //   UniversalCapabilityFactory.registerCapability('unified-chinese-cno', UnifiedChineseCnoCapability);
    // }

    // Create and register capabilities
    this.createAndRegisterCapabilities();
  }

  private createAndRegisterCapabilities(): void {
    if (!this.framework) return;

    const capabilities = [
      { id: 'universal-filesystem', config: { workingDir: this.options.workingDir } },
      { id: 'universal-bash', config: { workingDir: this.options.workingDir } },
      { id: 'universal-search', config: { workingDir: this.options.workingDir } },
      { id: 'universal-edit', config: { workingDir: this.options.workingDir } },
      { id: 'self-update', config: { workingDir: this.options.workingDir } }
    ];

    if (this.options.enableReadmeCapabilities) {
      capabilities.push(
        { id: 'multi-provider-ai', config: { workingDir: this.options.workingDir } },
        { id: 'alpha-zero-self-play', config: { workingDir: this.options.workingDir } },
        { id: 'tao-suite', config: { workingDir: this.options.workingDir } },
        { id: 'kinetic-ops', config: { workingDir: this.options.workingDir } },
        { id: 'enhanced-git', config: { workingDir: this.options.workingDir } },
        { id: 'web-tools', config: { workingDir: this.options.workingDir } },
        { id: 'military-integrator', config: { workingDir: this.options.workingDir } }
      );
    }

    // Add CNO (网络作战) capabilities
    if (this.options.enableCNOCapabilities) {
      capabilities.push(
        { id: 'cno-reconnaissance', config: { workingDir: this.options.workingDir } },
        { id: 'cno-command-control', config: { workingDir: this.options.workingDir } },
        { id: 'cno-situational-awareness', config: { workingDir: this.options.workingDir } },
        { id: 'cno-unified', config: { workingDir: this.options.workingDir } }
      );
    }

    // Add Chinese CNO enhancement capabilities
    if (this.options.enableChineseCnoEnhancements) {
      capabilities.push(
        { id: 'chinese-cno-enhancement', config: { workingDir: this.options.workingDir } },
        { id: 'unified-chinese-cno', config: { workingDir: this.options.workingDir } }
      );
    }

    for (const cap of capabilities) {
      const capability = UniversalCapabilityFactory.createCapability(cap.id, this.framework, cap.config);
      if (capability) {
        this.capabilities.set(capability.id, capability);
        this.framework.registerCapability(capability, capability.metadata);
      }
    }
  }

  async create(context: CapabilityContext): Promise<CapabilityContribution> {
    // Build unified tool suite from all capabilities
    const unifiedTools = await this.buildUnifiedToolSuite(context);
    
    return {
      id: 'integrated.unified',
      description: 'Integrated unified capabilities from README and entire codebase',
      toolSuite: {
        id: 'integrated-unified',
        description: 'All AGI capabilities unified into single suite',
        tools: unifiedTools
      },
      metadata: {
        frameworkEnabled: this.options.enableUniversalFramework,
        capabilitiesIntegrated: Array.from(this.capabilities.keys()),
        workingDir: this.options.workingDir,
        unified: true
      }
    };
  }

  private async buildUnifiedToolSuite(context: CapabilityContext): Promise<any[]> {
    const tools: any[] = [];
    
    // Add tools from universal framework capabilities
    if (this.framework) {
      for (const [id, capability] of this.capabilities) {
        try {
          const contribution = await capability.create(context);
          if (contribution && contribution.toolSuite) {
            tools.push(...contribution.toolSuite.tools);
          }
        } catch (error) {
          // Skip capabilities that fail to create tools
          console.warn(`Failed to create tools for capability ${id}:`, error);
        }
      }
    }
    
    // Add unified tools that bridge capabilities
    tools.push(...this.createUnifiedBridgeTools());
    
    return tools;
  }

  private createUnifiedBridgeTools(): any[] {
    return [
      SharedUtilities.createToolDefinition(
        'unified_execute',
        'Execute operation across all integrated capabilities',
        {
          type: 'object',
          properties: {
            operation: { type: 'string', description: 'Operation to execute' },
            parameters: { type: 'object', description: 'Operation parameters' },
            target_capabilities: { 
              type: 'array', 
              items: { type: 'string' },
              description: 'Specific capabilities to target (empty for all)'
            }
          },
          required: ['operation']
        },
        async (args: { operation: string; parameters: any; target_capabilities?: string[] }) => {
          return await this.executeUnifiedOperation(args.operation, args.parameters, args.target_capabilities);
        }
      ),
      SharedUtilities.createToolDefinition(
        'list_integrated_capabilities',
        'List all capabilities integrated into unified framework',
        {
          type: 'object',
          properties: {
            detailed: { type: 'boolean', description: 'Show detailed information', default: false }
          }
        },
        async (args: { detailed: boolean }) => {
          return this.listIntegratedCapabilities(args.detailed);
        }
      ),
      SharedUtilities.createToolDefinition(
        'framework_status',
        'Get status of unified framework and integrated capabilities',
        {},
        async () => {
          return this.getFrameworkStatus();
        }
      )
    ];
  }

  private async executeUnifiedOperation(
    operation: string, 
    parameters: any, 
    targetCapabilities?: string[]
  ): Promise<string> {
    if (!this.framework) {
      return 'Unified framework not initialized';
    }

    const capabilities = targetCapabilities || Array.from(this.capabilities.keys());
    
    try {
      const results = await this.framework.executeOperation(
        operation,
        parameters,
        capabilities
      );
      
      return JSON.stringify({
        success: true,
        operation,
        results,
        capabilities_executed: capabilities
      }, null, 2);
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        operation,
        error: error.message,
        capabilities_attempted: capabilities
      }, null, 2);
    }
  }

  listIntegratedCapabilities(detailed: boolean): string {
    const capabilities: any[] = [];
    
    for (const [id, capability] of this.capabilities) {
      const capInfo: any = {
        id: capability.id,
        metadata: capability.metadata
      };
      
      if (detailed) {
        capInfo.status = 'integrated';
        capInfo.provides = capability.metadata.provides;
        capInfo.dependencies = capability.metadata.dependencies;
      }
      
      capabilities.push(capInfo);
    }
    
    if (detailed) {
      return JSON.stringify({
        framework: this.framework ? 'active' : 'inactive',
        capabilities_integrated: capabilities.length,
        capabilities: capabilities
      }, null, 2);
    } else {
      return capabilities.map(c => c.id).join('\n');
    }
  }

  getFrameworkStatus(): string {
    const status = {
      unified_framework: this.framework ? {
        initialized: true,
        capabilities_registered: this.capabilities.size,
        config: this.framework.getConfig()
      } : {
        initialized: false
      },
      options: {
        enableUniversalFramework: this.options.enableUniversalFramework,
        enableReadmeCapabilities: this.options.enableReadmeCapabilities,
        enableMilitaryIntegration: this.options.enableMilitaryIntegration,
        enableCNOCapabilities: this.options.enableCNOCapabilities,
        enableCrossModuleCommunication: this.options.enableCrossModuleCommunication
      },
      capabilities: Array.from(this.capabilities.keys())
    };
    
    return JSON.stringify(status, null, 2);
  }

  async execute(params: {
    operation: string;
    parameters: Record<string, any>;
    operationId?: string;
  }): Promise<any> {
    const opId = params.operationId || SharedUtilities.generateOperationId('unified');
    
    switch (params.operation) {
      case 'framework_status':
        return JSON.parse(this.getFrameworkStatus());
      case 'list_capabilities':
        return JSON.parse(this.listIntegratedCapabilities(true));
      case 'execute_unified':
        return await this.executeUnifiedOperation(
          params.parameters.operation,
          params.parameters.parameters,
          params.parameters.target_capabilities
        );
      case 'activate_capability':
        if (!this.framework) {
          throw new Error('Framework not initialized');
        }
        return await this.framework.activateCapability(params.parameters.capability_id);
      case 'cross_capability_operation':
        if (!this.framework) {
          throw new Error('Framework not initialized');
        }
        return await this.framework.executeOperation(
          params.parameters.operation,
          params.parameters.parameters,
          params.parameters.capabilities
        );
      default:
        throw new Error(`Unknown unified operation: ${params.operation}`);
    }
  }

  /**
   * Legacy compatibility method to integrate with existing military modules
   */
  integrateMilitaryModules(): void {
    if (!this.options.enableMilitaryIntegration) return;

    const militaryModules = [
      { module: EliteCryptoMilitaryCapabilityModule, name: 'elite-crypto' },
      { module: UnifiedMilitaryCapabilityModule, name: 'unified-military' },
      { module: UniversalSecurityCapabilityModule, name: 'universal-security' },
      { module: MaxOffensiveUkraineCapabilityModule, name: 'max-offensive-ukraine' },
      { module: OffensiveDestructionCapabilityModule, name: 'offensive-destruction' }
    ];

    for (const { module: ModuleClass, name } of militaryModules) {
      try {
        const militaryModule = new ModuleClass({
          workingDir: this.options.workingDir,
          debug: this.options.debug,
          enableEvidence: this.options.enableEvidence,
          authorization: this.options.authorization,
          emergencyOverride: this.options.emergencyOverride
        });

        this.capabilities.set(name, militaryModule);
      } catch (error) {
        console.warn(`Failed to integrate military module ${name}:`, error);
      }
    }
  }

  /**
   * Get the universal framework instance (for advanced integration)
   */
  getFramework(): UniversalCapabilityFramework | null {
    return this.framework;
  }

  /**
   * Get all integrated capabilities
   */
  getCapabilities(): Map<string, any> {
    return new Map(this.capabilities);
  }

  /**
   * Get specific capability by ID
   */
  getCapability(capabilityId: string): any | null {
    return this.capabilities.get(capabilityId) || null;
  }
}

// ============================================================================
// SIMPLIFIED INTEGRATION FOR CLI USAGE
// ============================================================================

/**
 * Simplified unified capability for CLI usage
 * Provides a single entry point to all AGI capabilities
 */
export class SimplifiedUnifiedCapability {
  private integratedModule: IntegratedUnifiedCapabilityModule;
  private framework: UniversalCapabilityFramework | null = null;

  constructor(options: Partial<IntegratedUnifiedCapabilityOptions> = {}) {
    this.integratedModule = new IntegratedUnifiedCapabilityModule(options);
    this.framework = this.integratedModule.getFramework();
  }

  /**
   * Quick start unified capabilities
   */
  static quickStart(workingDir?: string): SimplifiedUnifiedCapability {
    return new SimplifiedUnifiedCapability({
      workingDir: workingDir || process.cwd(),
      enableUniversalFramework: true,
      enableReadmeCapabilities: true,
      enableMilitaryIntegration: true,
      enableCNOCapabilities: true,
      enableCrossModuleCommunication: true,
      debug: false
    });
  }

  /**
   * Execute a command using unified capabilities
   */
  async executeCommand(command: string, args: any = {}): Promise<any> {
    if (!this.framework) {
      throw new Error('Unified framework not initialized');
    }

    // Parse command and route to appropriate capability
    const [operation, ...params] = command.split(' ');
    
    return await this.integratedModule.execute({
      operation,
      parameters: { ...args, rawParams: params }
    });
  }

  /**
   * List available capabilities
   */
  listCapabilities(detailed: boolean = false): string {
    return this.integratedModule.listIntegratedCapabilities(detailed);
  }

  /**
   * Get framework status
   */
  getStatus(): any {
    return JSON.parse(this.integratedModule.getFrameworkStatus());
  }

  /**
   * Run a cross-capability operation
   */
  async runOperation(operation: string, parameters: any, capabilities?: string[]): Promise<any> {
    if (!this.framework) {
      throw new Error('Unified framework not initialized');
    }

    return await this.framework.executeOperation(
      operation,
      parameters,
      capabilities || Array.from(this.integratedModule.getCapabilities().keys())
    );
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default IntegratedUnifiedCapabilityModule;

// Note: SimplifiedUnifiedCapability is already exported at its definition