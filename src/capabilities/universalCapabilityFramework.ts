/**
 * UNIVERSAL CAPABILITY FRAMEWORK
 * 
 * A unified framework for all AGI capabilities that promotes code reuse,
 * consistent patterns, and cross-module integration.
 * 
 * KEY PRINCIPLES:
 * 1. Single Source of Truth - Common utilities used by all capabilities
 * 2. Dependency Injection - Capabilities declare dependencies
 * 3. Event-Driven Architecture - Cross-module communication via events
 * 4. Pluggable Architecture - Capabilities can be registered/unregistered at runtime
 * 5. Type Safety - Full TypeScript support with generic types
 */

import type { 
  CapabilityContribution, 
  CapabilityContext, 
  CapabilityModule 
} from '../runtime/agentHost.js';
import type { ToolSuite, ToolDefinition } from '../core/toolRuntime.js';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

// ============================================================================
// UNIVERSAL FRAMEWORK TYPES
// ============================================================================

export interface UniversalCapabilityConfig {
  /** Root directory for framework operations */
  rootDir: string;
  /** Enable debug logging */
  debug: boolean;
  /** Enable cross-capability events */
  enableEvents: boolean;
  /** Enable dependency resolution */
  enableDependencyResolution: boolean;
  /** Shared data directory */
  sharedDataDir: string;
  /** Plugin discovery patterns */
  pluginPatterns: string[];
}

export interface CapabilityMetadata {
  id: string;
  version: string;
  description: string;
  author: string;
  dependencies: string[];
  provides: string[];
  requires: string[];
  category: string;
  tags: string[];
  configurationSchema?: Record<string, any>;
}

export interface CapabilityRegistration {
  module: CapabilityModule;
  metadata: CapabilityMetadata;
  instance: any;
  status: 'registered' | 'active' | 'error' | 'disabled';
  dependencies: string[];
  dependents: string[];
}

export interface UniversalFrameworkEvent {
  type: string;
  source: string;
  timestamp: number;
  data: any;
  correlationId?: string;
}

export interface DependencyGraph {
  nodes: Map<string, CapabilityRegistration>;
  edges: Map<string, Set<string>>;
  topologicalOrder: string[];
  hasCycles: boolean;
}

// ============================================================================
// UNIVERSAL FRAMEWORK CORE
// ============================================================================

export class UniversalCapabilityFramework extends EventEmitter {
  private config: UniversalCapabilityConfig;
  private capabilities: Map<string, CapabilityRegistration> = new Map();
  private dependencyGraph: DependencyGraph = {
    nodes: new Map(),
    edges: new Map(),
    topologicalOrder: [],
    hasCycles: false
  };
  private sharedUtilities: SharedUniversalUtilities;
  private eventBus: EventEmitter;
  private contextManager: ContextManager;
  private toolRegistry: ToolRegistry;

  constructor(config: Partial<UniversalCapabilityConfig> = {}) {
    super();
    
    this.config = {
      rootDir: config.rootDir || process.cwd(),
      debug: config.debug || false,
      enableEvents: config.enableEvents || true,
      enableDependencyResolution: config.enableDependencyResolution || true,
      sharedDataDir: config.sharedDataDir || path.join(os.tmpdir(), 'agi-universal-framework'),
      pluginPatterns: config.pluginPatterns || ['**/*.ts', '**/*.js']
    };

    this.sharedUtilities = new SharedUniversalUtilities(this.config);
    this.eventBus = new EventEmitter();
    this.contextManager = new ContextManager();
    this.toolRegistry = new ToolRegistry();

    this.initializeFramework();
  }

  private initializeFramework(): void {
    // Create shared directories
    fs.mkdirSync(this.config.sharedDataDir, { recursive: true });
    
    // Initialize shared utilities
    this.sharedUtilities = new SharedUniversalUtilities(this.config);
    
    // Initialize core systems
    this.contextManager = new ContextManager();
    this.toolRegistry = new ToolRegistry();

    this.log('info', 'Universal Framework initialized', {
      rootDir: this.config.rootDir,
      sharedDataDir: this.config.sharedDataDir
    });
  }

  /**
   * Register a capability with the framework
   */
  async registerCapability(
    module: CapabilityModule,
    metadata: CapabilityMetadata
  ): Promise<CapabilityRegistration> {
    const registration: CapabilityRegistration = {
      module,
      metadata,
      instance: null,
      status: 'registered',
      dependencies: metadata.dependencies || [],
      dependents: []
    };

    this.capabilities.set(metadata.id, registration);
    this.updateDependencyGraph();

    this.log('info', `Capability registered: ${metadata.id}`, {
      version: metadata.version,
      dependencies: metadata.dependencies
    });

    return registration;
  }

  /**
   * Activate a capability (resolve dependencies and initialize)
   */
  async activateCapability(capabilityId: string): Promise<CapabilityRegistration> {
    const registration = this.capabilities.get(capabilityId);
    if (!registration) {
      throw new Error(`Capability not found: ${capabilityId}`);
    }

    if (registration.status === 'active') {
      return registration;
    }

    // Resolve and activate dependencies
    if (this.config.enableDependencyResolution) {
      await this.activateDependencies(capabilityId);
    }

    // Initialize capability instance
    try {
      // Create context for capability
      const context: CapabilityContext = {
        profile: 'default',
        workspaceContext: null,
        workingDir: this.config.rootDir,
        env: process.env
      };

      // Create capability instance
      const result = await registration.module.create(context);
      registration.instance = result;
      registration.status = 'active';

      this.log('info', `Capability activated: ${capabilityId}`);
      this.emit('capability:activated', {
        capabilityId,
        registration
      });

    } catch (error) {
      registration.status = 'error';
      this.log('error', `Failed to activate capability ${capabilityId}`, error);
      throw error;
    }

    return registration;
  }

  /**
   * Activate all dependencies for a capability
   */
  private async activateDependencies(capabilityId: string): Promise<void> {
    const registration = this.capabilities.get(capabilityId);
    if (!registration) return;

    for (const depId of registration.dependencies) {
      const depRegistration = this.capabilities.get(depId);
      if (!depRegistration) {
        throw new Error(`Dependency not found: ${depId} required by ${capabilityId}`);
      }

      if (depRegistration.status !== 'active') {
        await this.activateCapability(depId);
      }
    }
  }

  /**
   * Get a capability instance
   */
  getCapability<T = any>(capabilityId: string): T | null {
    const registration = this.capabilities.get(capabilityId);
    if (!registration || registration.status !== 'active') {
      return null;
    }
    return registration.instance as T;
  }

  /**
   * Execute a cross-capability operation
   */
  async executeOperation(
    operation: string,
    parameters: Record<string, any>,
    capabilities: string[]
  ): Promise<any> {
    const operationId = crypto.randomUUID();
    const startTime = Date.now();

    this.log('info', `Starting cross-capability operation: ${operation}`, {
      operationId,
      capabilities
    });

    this.emit('operation:started', {
      operationId,
      operation,
      parameters,
      capabilities
    });

    // Activate required capabilities
    for (const capabilityId of capabilities) {
      await this.activateCapability(capabilityId);
    }

    // Execute operation across capabilities
    const results: Record<string, any> = {};
    for (const capabilityId of capabilities) {
      const capability = this.getCapability(capabilityId);
      if (capability && typeof (capability as any).execute === 'function') {
        try {
          results[capabilityId] = await (capability as any).execute({
            operation,
            parameters,
            operationId
          });
        } catch (error) {
          results[capabilityId] = { 
            error: error instanceof Error ? error.message : String(error) 
          };
        }
      }
    }

    const duration = Date.now() - startTime;
    
    this.log('info', `Completed cross-capability operation: ${operation}`, {
      operationId,
      duration,
      success: true
    });

    this.emit('operation:completed', {
      operationId,
      operation,
      parameters,
      results,
      duration
    });

    return results;
  }

  /**
   * Update dependency graph
   */
  private updateDependencyGraph(): void {
    this.dependencyGraph.nodes = this.capabilities;
    this.dependencyGraph.edges = new Map();
    
    // Build edges
    for (const [id, registration] of this.capabilities) {
      const edges = new Set<string>();
      for (const depId of registration.dependencies) {
        edges.add(depId);
      }
      this.dependencyGraph.edges.set(id, edges);
    }

    // Detect cycles
    this.dependencyGraph.hasCycles = this.detectCycles();
    
    // Calculate topological order
    this.dependencyGraph.topologicalOrder = this.topologicalSort();
  }

  private detectCycles(): boolean {
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const dfs = (nodeId: string): boolean => {
      if (recStack.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;

      visited.add(nodeId);
      recStack.add(nodeId);

      const edges = this.dependencyGraph.edges.get(nodeId) || new Set();
      for (const neighbor of edges) {
        if (dfs(neighbor)) return true;
      }

      recStack.delete(nodeId);
      return false;
    };

    for (const nodeId of this.dependencyGraph.nodes.keys()) {
      if (dfs(nodeId)) return true;
    }

    return false;
  }

  private topologicalSort(): string[] {
    const visited = new Set<string>();
    const order: string[] = [];

    const dfs = (nodeId: string): void => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const edges = this.dependencyGraph.edges.get(nodeId) || new Set();
      for (const neighbor of edges) {
        dfs(neighbor);
      }

      order.unshift(nodeId);
    };

    for (const nodeId of this.dependencyGraph.nodes.keys()) {
      dfs(nodeId);
    }

    return order;
  }

  /**
   * Logging utility
   */
  private log(level: 'info' | 'warn' | 'error', message: string, data?: any): void {
    if (!this.config.debug && level === 'info') return;

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      data
    };

    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
    
    if (data && this.config.debug) {
      console.log(JSON.stringify(data, null, 2));
    }

    this.emit('log', logEntry);
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Get framework configuration
   */
  getConfig(): UniversalCapabilityConfig {
    return { ...this.config };
  }

  /**
   * List all registered capabilities
   */
  listCapabilities(): CapabilityRegistration[] {
    return Array.from(this.capabilities.values());
  }

  /**
   * Get dependency graph
   */
  getDependencyGraph(): DependencyGraph {
    return { ...this.dependencyGraph };
  }

  /**
   * Get shared utilities
   */
  getSharedUtilities(): SharedUniversalUtilities {
    return this.sharedUtilities;
  }

  /**
   * Get event bus
   */
  getEventBus(): EventEmitter {
    return this.eventBus;
  }

  /**
   * Get tool registry
   */
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }
}

// ============================================================================
// SHARED UNIVERSAL UTILITIES
// ============================================================================

export class SharedUniversalUtilities {
  constructor(private config: UniversalCapabilityConfig) {}

  /**
   * Generate unique operation ID
   */
  generateOperationId(prefix: string = 'op'): string {
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    return `${prefix}_${timestamp}_${random}`;
  }

  /**
   * Create shared data directory for operation
   */
  createOperationDir(operationId: string): string {
    const dirPath = path.join(this.config.sharedDataDir, 'operations', operationId);
    fs.mkdirSync(dirPath, { recursive: true });
    return dirPath;
  }

  /**
   * Save evidence/data to shared storage
   */
  saveToSharedStorage(operationId: string, fileName: string, data: any): string {
    const opDir = this.createOperationDir(operationId);
    const filePath = path.join(opDir, fileName);
    
    const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    fs.writeFileSync(filePath, content, 'utf8');
    
    return filePath;
  }

  /**
   * Read from shared storage
   */
  readFromSharedStorage(operationId: string, fileName: string): string | null {
    const filePath = path.join(this.config.sharedDataDir, 'operations', operationId, fileName);
    if (!fs.existsSync(filePath)) return null;
    
    return fs.readFileSync(filePath, 'utf8');
  }

  /**
   * Merge multiple objects (deep merge)
   */
  deepMerge<T extends Record<string, any>>(target: T, ...sources: Partial<T>[]): T {
    const result = { ...target };
    
    for (const source of sources) {
      for (const key in source) {
        if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          if (!result[key] || typeof result[key] !== 'object') {
            result[key] = {} as any;
          }
          result[key] = this.deepMerge(result[key], source[key]);
        } else {
          result[key] = source[key] as any;
        }
      }
    }
    
    return result;
  }

  /**
   * Validate configuration against schema
   */
  validateConfig(config: any, schema: Record<string, any>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    const validateObject = (obj: any, sch: any, path: string = ''): void => {
      if (sch.type === 'object' && sch.properties) {
        for (const [key, propSchema] of Object.entries(sch.properties)) {
          const fullPath = path ? `${path}.${key}` : key;
          
          const typedPropSchema = propSchema as { required?: boolean };
          if (typedPropSchema.required && obj[key] === undefined) {
            errors.push(`Missing required property: ${fullPath}`);
          } else if (obj[key] !== undefined) {
            validateObject(obj[key], propSchema as any, fullPath);
          }
        }
      }
    };
    
    validateObject(config, schema);
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Execute with retry logic
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    delay: number = 1000
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, delay * attempt));
        }
      }
    }
    
    throw lastError!;
  }

  /**
   * Create standardized tool definition
   */
  createToolDefinition<T extends Record<string, unknown>>(
    name: string,
    description: string,
    parameters: any,
    handler: (args: T) => Promise<string> | string
  ): ToolDefinition<T> {
    return {
      name,
      description,
      parameters,
      handler
    };
  }
}

// ============================================================================
// CONTEXT MANAGER
// ============================================================================

export class ContextManager {
  private contexts: Map<string, any> = new Map();
  private defaultContext: Record<string, any> = {};

  /**
   * Set context value
   */
  setContext(key: string, value: any): void {
    this.contexts.set(key, value);
  }

  /**
   * Get context value
   */
  getContext<T = any>(key: string): T | undefined {
    return this.contexts.get(key) as T;
  }

  /**
   * Clear context
   */
  clearContext(key: string): boolean {
    return this.contexts.delete(key);
  }

  /**
   * Get all contexts
   */
  getAllContexts(): Record<string, any> {
    return Object.fromEntries(this.contexts.entries());
  }

  /**
   * Save context to file
   */
  saveContexts(filePath: string): void {
    const data = this.getAllContexts();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * Load contexts from file
   */
  loadContexts(filePath: string): void {
    if (!fs.existsSync(filePath)) return;
    
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    for (const [key, value] of Object.entries(data)) {
      this.contexts.set(key, value);
    }
  }
}

// ============================================================================
// TOOL REGISTRY
// ============================================================================

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private toolSuites: Map<string, ToolSuite> = new Map();

  /**
   * Register a tool
   */
  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Register a tool suite
   */
  registerToolSuite(suite: ToolSuite): void {
    this.toolSuites.set(suite.id, suite);
    for (const tool of suite.tools) {
      this.registerTool(tool);
    }
  }

  /**
   * Get a tool by name
   */
  getTool<T extends Record<string, unknown>>(name: string): ToolDefinition<T> | undefined {
    return this.tools.get(name) as ToolDefinition<T>;
  }

  /**
   * Get a tool suite by ID
   */
  getToolSuite(id: string): ToolSuite | undefined {
    return this.toolSuites.get(id);
  }

  /**
   * List all tools
   */
  listTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * List all tool suites
   */
  listToolSuites(): ToolSuite[] {
    return Array.from(this.toolSuites.values());
  }

  /**
   * Search tools by criteria
   */
  searchTools(criteria: (tool: ToolDefinition) => boolean): ToolDefinition[] {
    return Array.from(this.tools.values()).filter(criteria);
  }
}

// ============================================================================
// UNIVERSAL CAPABILITY BASE CLASS
// ============================================================================

export abstract class UniversalCapabilityModule implements CapabilityModule {
  abstract readonly id: string;
  abstract readonly metadata: CapabilityMetadata;
  
  protected framework: UniversalCapabilityFramework;
  protected utilities: SharedUniversalUtilities;
  protected contextManager: ContextManager;
  protected toolRegistry: ToolRegistry;
  
  protected config: Record<string, any> = {};

  constructor(
    framework: UniversalCapabilityFramework,
    config: Record<string, any> = {}
  ) {
    this.framework = framework;
    this.utilities = framework.getSharedUtilities();
    this.contextManager = new ContextManager();
    this.toolRegistry = framework.getToolRegistry();
    this.config = config;
  }

  /**
   * Abstract method - must be implemented by subclasses
   */
  abstract create(context: CapabilityContext): Promise<CapabilityContribution | CapabilityContribution[] | null | undefined>;

  /**
   * Initialize capability (called after constructor)
   */
  async initialize(): Promise<void> {
    // Default implementation does nothing
  }

  /**
   * Cleanup capability (called before disposal)
   */
  async cleanup(): Promise<void> {
    // Default implementation does nothing
  }

  /**
   * Execute an operation (common interface for all capabilities)
   */
  async execute(params: {
    operation: string;
    parameters: Record<string, any>;
    operationId?: string;
  }): Promise<any> {
    throw new Error(`Execute method not implemented for capability: ${this.id}`);
  }

  /**
   * Validate configuration
   */
  validateConfig(schema: Record<string, any>): { valid: boolean; errors: string[] } {
    return this.utilities.validateConfig(this.config, schema);
  }

  /**
   * Log with capability context
   */
  protected log(level: 'info' | 'warn' | 'error', message: string, data?: any): void {
    const logData = {
      capabilityId: this.id,
      ...data
    };
    
    this.framework.emit('log', {
      timestamp: Date.now(),
      level,
      message,
      data: logData
    });
  }

  /**
   * Emit framework event
   */
  protected emitEvent(type: string, data: any): void {
    this.framework.emit(`capability:${this.id}:${type}`, {
      timestamp: Date.now(),
      source: this.id,
      data
    });
  }

  /**
   * Create fallback file tool for filesystem capability
   */
  protected createFallbackFileTool(): ToolDefinition {
    return this.utilities.createToolDefinition(
      'read_file_fallback',
      'Fallback file reading tool',
      {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to file' }
        },
        required: ['path']
      },
      async (args: { path: string }) => {
        try {
          return fs.readFileSync(args.path, 'utf8');
        } catch (error: any) {
          return `Error reading file: ${error.message}`;
        }
      }
    );
  }
}

// ============================================================================
// UNIVERSAL CAPABILITY FACTORY
// ============================================================================

export class UniversalCapabilityFactory {
  private static capabilityRegistry: Map<string, new (framework: UniversalCapabilityFramework, config: any) => UniversalCapabilityModule> = new Map();

  /**
   * Register a capability class
   */
  static registerCapability(
    id: string,
    constructor: new (framework: UniversalCapabilityFramework, config: any) => UniversalCapabilityModule
  ): void {
    this.capabilityRegistry.set(id, constructor);
  }

  /**
   * Create capability instance
   */
  static createCapability(
    id: string,
    framework: UniversalCapabilityFramework,
    config: any = {}
  ): UniversalCapabilityModule | null {
    const Constructor = this.capabilityRegistry.get(id);
    if (!Constructor) return null;
    
    return new Constructor(framework, config);
  }

  /**
   * List all registered capability types
   */
  static listCapabilityTypes(): string[] {
    return Array.from(this.capabilityRegistry.keys());
  }
}

// ============================================================================
// PRE-BUILT UNIVERSAL CAPABILITIES
// ============================================================================

/**
 * Universal Filesystem Capability
 */
export class UniversalFilesystemCapability extends UniversalCapabilityModule {
  readonly id = 'capability.universal-filesystem';
  readonly metadata: CapabilityMetadata = {
    id: this.id,
    version: '1.0.0',
    description: 'Universal filesystem operations with cross-platform support',
    author: 'AGI Core Team',
    dependencies: [],
    provides: ['filesystem.read', 'filesystem.write', 'filesystem.list', 'filesystem.search'],
    requires: [],
    category: 'core',
    tags: ['filesystem', 'io', 'storage']
  };

  async create(context: CapabilityContext): Promise<CapabilityContribution> {
    try {
      const { createFileTools } = await import('../tools/fileTools.js');
      
      return {
        id: 'filesystem.universal',
        description: 'Universal filesystem access with enhanced capabilities',
        toolSuite: {
          id: 'fs-universal',
          description: 'Universal filesystem operations',
          tools: createFileTools(context.workingDir)
        },
        metadata: {
          workingDir: context.workingDir,
          platform: os.platform(),
          capabilities: this.metadata.provides
        }
      };
    } catch (error) {
      // Fallback to simple implementation if module not available
      return {
        id: 'filesystem.universal-fallback',
        description: 'Universal filesystem access (fallback mode)',
        toolSuite: {
          id: 'fs-universal-fallback',
          description: 'Universal filesystem operations (fallback)',
          tools: [this.createFallbackFileTool()]
        },
        metadata: {
          workingDir: context.workingDir,
          platform: os.platform(),
          capabilities: this.metadata.provides,
          fallback: true
        }
      };
    }
  }

  async execute(params: {
    operation: string;
    parameters: Record<string, any>;
    operationId?: string;
  }): Promise<any> {
    const opId = params.operationId || this.utilities.generateOperationId('fs');
    
    switch (params.operation) {
      case 'read':
        return this.readFile(params.parameters.path);
      case 'write':
        return this.writeFile(params.parameters.path, params.parameters.content);
      case 'list':
        return this.listDirectory(params.parameters.path, params.parameters.recursive);
      case 'search':
        return this.searchFiles(params.parameters.pattern, params.parameters.path);
      default:
        throw new Error(`Unknown filesystem operation: ${params.operation}`);
    }
  }

  private readFile(filePath: string): string {
    return fs.readFileSync(filePath, 'utf8');
  }

  private writeFile(filePath: string, content: string): void {
    fs.writeFileSync(filePath, content, 'utf8');
  }

  private listDirectory(dirPath: string, recursive: boolean = false): string[] {
    if (!fs.existsSync(dirPath)) return [];
    
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    const result: string[] = [];
    
    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      result.push(fullPath);
      
      if (recursive && item.isDirectory()) {
        result.push(...this.listDirectory(fullPath, true));
      }
    }
    
    return result;
  }

  private searchFiles(pattern: string, basePath: string): string[] {
    const files: string[] = [];
    const searchDir = (dir: string): void => {
      try {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const fullPath = path.join(dir, item);
          const stat = fs.statSync(fullPath);
          
          if (stat.isDirectory()) {
            searchDir(fullPath);
          } else if (item.includes(pattern) || fullPath.includes(pattern)) {
            files.push(fullPath);
          }
        }
      } catch (error) {
        // Skip directories we can't read
      }
    };
    
    searchDir(basePath);
    return files;
  }
}

/**
 * Universal Bash Capability
 */
export class UniversalBashCapability extends UniversalCapabilityModule {
  readonly id = 'capability.universal-bash';
  readonly metadata: CapabilityMetadata = {
    id: this.id,
    version: '1.0.0',
    description: 'Universal bash/shell execution with cross-platform support',
    author: 'AGI Core Team',
    dependencies: ['capability.universal-filesystem'],
    provides: ['bash.execute', 'bash.script', 'bash.pipeline', 'bash.background'],
    requires: [],
    category: 'core',
    tags: ['bash', 'shell', 'execution']
  };

  async create(context: CapabilityContext): Promise<CapabilityContribution> {
    try {
      const { createBashTools } = await import('../tools/bashTools.js');
      
      return {
        id: 'bash.universal',
        description: 'Universal bash execution with enhanced capabilities',
        toolSuite: {
          id: 'bash-universal',
          description: 'Universal bash/shell operations',
          tools: createBashTools(context.workingDir)
        },
        metadata: {
          workingDir: context.workingDir,
          platform: os.platform(),
          shell: process.env.SHELL || 'bash',
          capabilities: this.metadata.provides
        }
      };
    } catch (error) {
      // Fallback to simple implementation
      return {
        id: 'bash.universal-fallback',
        description: 'Universal bash execution (fallback mode)',
        toolSuite: {
          id: 'bash-universal-fallback',
          description: 'Universal bash/shell operations (fallback)',
          tools: [this.createFallbackBashTool()]
        },
        metadata: {
          workingDir: context.workingDir,
          platform: os.platform(),
          capabilities: this.metadata.provides,
          fallback: true
        }
      };
    }
  }

  private createFallbackBashTool(): ToolDefinition {
    return this.utilities.createToolDefinition(
      'execute_command_fallback',
      'Fallback command execution tool',
      {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command to execute' },
          cwd: { type: 'string', description: 'Working directory', default: process.cwd() }
        },
        required: ['command']
      },
      async (args: { command: string; cwd?: string }) => {
        try {
          const result = execSync(args.command, {
            cwd: args.cwd || process.cwd(),
            encoding: 'utf8',
            timeout: 30000
          });
          return result.trim();
        } catch (error: any) {
          return `Error executing command: ${error.message}`;
        }
      }
    );
  }

  async execute(params: {
    operation: string;
    parameters: Record<string, any>;
    operationId?: string;
  }): Promise<any> {
    const opId = params.operationId || this.utilities.generateOperationId('bash');
    
    try {
      const result = execSync(params.parameters.command, {
        cwd: params.parameters.cwd || this.config.workingDir || process.cwd(),
        encoding: 'utf8',
        timeout: params.parameters.timeout || 30000
      });
      
      return {
        success: true,
        output: result.trim(),
        exitCode: 0
      };
    } catch (error: any) {
      return {
        success: false,
        output: error.stderr?.toString() || error.message,
        exitCode: error.status || 1
      };
    }
  }
}

/**
 * Universal Search Capability
 */
export class UniversalSearchCapability extends UniversalCapabilityModule {
  readonly id = 'capability.universal-search';
  readonly metadata: CapabilityMetadata = {
    id: this.id,
    version: '1.0.0',
    description: 'Universal search across files, content, and definitions',
    author: 'AGI Core Team',
    dependencies: ['capability.universal-filesystem'],
    provides: ['search.files', 'search.content', 'search.definitions', 'search.pattern'],
    requires: [],
    category: 'core',
    tags: ['search', 'find', 'grep', 'pattern']
  };

  async create(context: CapabilityContext): Promise<CapabilityContribution> {
    try {
      const { createSearchTools } = await import('../tools/searchTools.js');
      
      return {
        id: 'search.universal',
        description: 'Universal search across files and content',
        toolSuite: {
          id: 'search-universal',
          description: 'Universal search operations',
          tools: createSearchTools(context.workingDir)
        },
        metadata: {
          workingDir: context.workingDir,
          capabilities: this.metadata.provides
        }
      };
    } catch (error) {
      // Fallback to simple implementation
      return {
        id: 'search.universal-fallback',
        description: 'Universal search (fallback mode)',
        toolSuite: {
          id: 'search-universal-fallback',
          description: 'Universal search operations (fallback)',
          tools: [this.createFallbackSearchTool()]
        },
        metadata: {
          workingDir: context.workingDir,
          capabilities: this.metadata.provides,
          fallback: true
        }
      };
    }
  }

  private createFallbackSearchTool(): ToolDefinition {
    return this.utilities.createToolDefinition(
      'search_fallback',
      'Fallback search tool',
      {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search pattern' },
          path: { type: 'string', description: 'Search directory', default: process.cwd() }
        },
        required: ['pattern']
      },
      async (args: { pattern: string; path?: string }) => {
        const searchDir = args.path || process.cwd();
        const files: string[] = [];
        
        const search = (dir: string): void => {
          try {
            const items = fs.readdirSync(dir);
            for (const item of items) {
              const fullPath = path.join(dir, item);
              const stat = fs.statSync(fullPath);
              
              if (stat.isDirectory()) {
                search(fullPath);
              } else if (item.includes(args.pattern) || fullPath.includes(args.pattern)) {
                files.push(fullPath);
              }
            }
          } catch (error) {
            // Skip unreadable directories
          }
        };
        
        search(searchDir);
        return files.length > 0 ? files.join('\n') : 'No matches found';
      }
    );
  }

  async execute(params: {
    operation: string;
    parameters: Record<string, any>;
    operationId?: string;
  }): Promise<any> {
    const opId = params.operationId || this.utilities.generateOperationId('search');
    
    // Implementation would use the search tools
    // For now, return a placeholder
    return {
      operation: params.operation,
      parameters: params.parameters,
      results: []
    };
  }
}

/**
 * Universal Edit Capability
 */
export class UniversalEditCapability extends UniversalCapabilityModule {
  readonly id = 'capability.universal-edit';
  readonly metadata: CapabilityMetadata = {
    id: this.id,
    version: '1.0.0',
    description: 'Universal file editing with exact string replacement',
    author: 'AGI Core Team',
    dependencies: ['capability.universal-filesystem'],
    provides: ['edit.file', 'edit.replace', 'edit.create', 'edit.delete'],
    requires: [],
    category: 'core',
    tags: ['edit', 'modify', 'file', 'code']
  };

  async create(context: CapabilityContext): Promise<CapabilityContribution> {
    try {
      const { createEditTools } = await import('../tools/editTools.js');
      
      return {
        id: 'edit.universal',
        description: 'Universal file editing capabilities',
        toolSuite: {
          id: 'edit-universal',
          description: 'Universal edit operations',
          tools: createEditTools(context.workingDir || process.cwd())
        },
        metadata: {
          workingDir: context.workingDir,
          capabilities: this.metadata.provides
        }
      };
    } catch (error) {
      // Fallback to simple implementation
      return {
        id: 'edit.universal-fallback',
        description: 'Universal file editing (fallback mode)',
        toolSuite: {
          id: 'edit-universal-fallback',
          description: 'Universal edit operations (fallback)',
          tools: [this.createFallbackEditTool()]
        },
        metadata: {
          workingDir: context.workingDir,
          capabilities: this.metadata.provides,
          fallback: true
        }
      };
    }
  }

  private createFallbackEditTool(): ToolDefinition {
    return this.utilities.createToolDefinition(
      'edit_file_fallback',
      'Fallback file editing tool',
      {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path to file' },
          old_string: { type: 'string', description: 'Text to replace' },
          new_string: { type: 'string', description: 'New text', default: '' }
        },
        required: ['file_path', 'old_string']
      },
      async (args: { file_path: string; old_string: string; new_string?: string }) => {
        try {
          const content = fs.readFileSync(args.file_path, 'utf8');
          const newContent = content.replace(args.old_string, args.new_string || '');
          fs.writeFileSync(args.file_path, newContent, 'utf8');
          return `File ${args.file_path} updated successfully`;
        } catch (error: any) {
          return `Error editing file: ${error.message}`;
        }
      }
    );
  }

  async execute(params: {
    operation: string;
    parameters: Record<string, any>;
    operationId?: string;
  }): Promise<any> {
    const opId = params.operationId || this.utilities.generateOperationId('edit');
    
    // Implementation would use the edit tools
    // For now, return a placeholder
    return {
      operation: params.operation,
      parameters: params.parameters,
      success: true
    };
  }
}

// ============================================================================
// UNIVERSAL FRAMEWORK EXPORTS
// ============================================================================

export default UniversalCapabilityFramework;

// Note: Individual capability classes are already exported at their definitions
// (UniversalFilesystemCapability, UniversalBashCapability, UniversalSearchCapability, UniversalEditCapability)