/**
 * LEAN CODING AGENT
 *
 * A streamlined, unified coding assistant that consolidates all
 * capabilities into a single, efficient agent architecture.
 *
 * Features:
 * - Unified tool suite (filesystem, edit, search, bash, git, web)
 * - Context management with auto-pruning
 * - Loop detection and recovery
 * - Multi-provider support
 * - Streaming responses
 */

import { AgentRuntime, type AgentCallbacks } from './core/agent.js';
import { ContextManager } from './core/contextManager.js';
import { ToolRuntime } from './core/toolRuntime.js';
import { createUnifiedCodingCapability, type UnifiedCodingOptions } from './capabilities/unifiedCodingCapability.js';
import type { LLMProvider } from './core/types.js';

// ============================================================================
// TYPES
// ============================================================================

export interface LeanAgentConfig {
  /** LLM provider instance */
  provider: LLMProvider;
  /** Working directory for file operations */
  workingDir?: string;
  /** System prompt for the agent */
  systemPrompt?: string;
  /** Capability options */
  capabilities?: UnifiedCodingOptions;
  /** Context window size for pruning */
  contextWindowSize?: number;
  /** Provider ID for tracking */
  providerId?: string;
  /** Model ID for tracking */
  modelId?: string;
  /** Event callbacks */
  callbacks?: AgentCallbacks;
}

export interface LeanAgentResponse {
  content: string;
  toolsUsed: string[];
  tokensUsed?: number;
  elapsedMs?: number;
}

// ============================================================================
// LEAN AGENT
// ============================================================================

export class LeanAgent {
  private runtime: AgentRuntime;
  private toolRuntime: ToolRuntime;
  private config: LeanAgentConfig;
  private toolsUsed: string[] = [];
  private initialized = false;

  constructor(config: LeanAgentConfig) {
    this.config = config;

    // Create tool runtime
    this.toolRuntime = new ToolRuntime();

    // Create context manager
    const contextManager = new ContextManager({
      maxTokens: config.contextWindowSize ?? 128000,
      targetTokens: Math.floor((config.contextWindowSize ?? 128000) * 0.85),
    });

    // Build system prompt
    const systemPrompt = config.systemPrompt ?? this.getDefaultSystemPrompt();

    // Create agent runtime
    this.runtime = new AgentRuntime({
      provider: config.provider,
      toolRuntime: this.toolRuntime,
      systemPrompt,
      contextManager,
      providerId: config.providerId ?? 'unknown',
      modelId: config.modelId ?? 'unknown',
      workingDirectory: config.workingDir ?? process.cwd(),
      callbacks: {
        ...config.callbacks,
        onToolExecution: (name, isStart) => {
          if (isStart) {
            this.toolsUsed.push(name);
          }
          config.callbacks?.onToolExecution?.(name, isStart);
        },
      },
    });

    // Initialize capability asynchronously
    this.initializeCapability();
  }

  private async initializeCapability(): Promise<void> {
    if (this.initialized) return;

    // Initialize unified coding capability
    const capability = createUnifiedCodingCapability({
      workingDir: this.config.workingDir ?? process.cwd(),
      ...this.config.capabilities,
    });

    // Build and register tool suite
    const contribution = await capability.create({
      profile: 'default',
      workspaceContext: null,
      workingDir: this.config.workingDir ?? process.cwd(),
      env: process.env,
    });

    if (contribution.toolSuite) {
      this.toolRuntime.registerSuite(contribution.toolSuite);
    }
    if (contribution.toolSuites) {
      for (const suite of contribution.toolSuites) {
        this.toolRuntime.registerSuite(suite);
      }
    }

    this.initialized = true;
  }

  /**
   * Send a message to the agent and get a response
   */
  async chat(message: string, streaming = true): Promise<LeanAgentResponse> {
    // Ensure initialized
    await this.initializeCapability();

    this.toolsUsed = [];
    const startTime = Date.now();

    const content = await this.runtime.send(message, streaming);

    return {
      content,
      toolsUsed: [...this.toolsUsed],
      elapsedMs: Date.now() - startTime,
    };
  }

  /**
   * Request cancellation of current operation
   */
  cancel(): void {
    this.runtime.requestCancellation();
  }

  /**
   * Check if agent is currently processing
   */
  isRunning(): boolean {
    return this.runtime.isRunning();
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    this.runtime.clearHistory();
    this.toolRuntime.clearToolHistory();
  }

  /**
   * Get conversation history
   */
  getHistory() {
    return this.runtime.getHistory();
  }

  private getDefaultSystemPrompt(): string {
    return `You are a skilled coding assistant with access to file system operations, code editing, search, and command execution tools.

Your capabilities:
- read_file: Read file contents
- write_file: Create or overwrite files
- list_files: List directory contents
- file_exists: Check if files exist
- edit_file: Make precise edits to existing files
- search_replace: Search and replace text in files
- grep: Search for patterns in files
- glob: Find files by pattern
- bash: Execute shell commands
- git: Git operations (status, diff, commit, etc.)
- web_fetch: Fetch content from URLs

Guidelines:
1. Always read files before editing to understand context
2. Make minimal, focused changes
3. Test your changes when possible
4. Explain what you're doing and why
5. Handle errors gracefully

Working directory: ${this.config.workingDir ?? process.cwd()}`;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createLeanAgent(config: LeanAgentConfig): LeanAgent {
  return new LeanAgent(config);
}

export default LeanAgent;
