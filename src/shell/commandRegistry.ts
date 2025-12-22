/**
 * Command Registry - Slash Command Management
 *
 * Provides a registry for slash commands with:
 * - Command registration and discovery
 * - Help text generation
 * - Category organization
 * - Command execution delegation
 *
 * Usage:
 * ```typescript
 * const registry = new CommandRegistry();
 *
 * registry.register({
 *   name: '/help',
 *   aliases: ['/?'],
 *   description: 'Show help information',
 *   category: 'navigation',
 *   handler: async (context) => {
 *     context.showHelp();
 *   },
 * });
 *
 * await registry.execute('/help', '', context);
 * ```
 */

import { logDebug } from '../utils/debugLogger.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export type CommandCategory =
  | 'navigation'      // Help, exit, etc.
  | 'model'           // Model/provider selection
  | 'context'         // Context management
  | 'session'         // Session/history management
  | 'tools'           // Tool management
  | 'development'     // Dev/test commands
  | 'security'        // Secrets, permissions
  | 'advanced'        // Advanced features
  | 'learning'        // Learning system
  | 'ui';             // UI/display settings

export interface CommandContext {
  /** The shell instance for accessing shell methods */
  shell: unknown;
  /** Current input/arguments */
  input: string;
  /** Raw command string */
  rawCommand: string;
}

export interface CommandDefinition {
  /** Primary command name (e.g., '/help') */
  name: string;
  /** Alternative names for the command */
  aliases?: string[];
  /** Short description for help text */
  description: string;
  /** Category for organization */
  category: CommandCategory;
  /** Whether command is async */
  async?: boolean;
  /** Whether command is hidden from help */
  hidden?: boolean;
  /** Usage example */
  usage?: string;
  /** Handler function */
  handler: (context: CommandContext) => void | Promise<void>;
}

export interface CommandMatch {
  command: CommandDefinition;
  matchedName: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Command Registry
// ═══════════════════════════════════════════════════════════════════════════════

export class CommandRegistry {
  private commands = new Map<string, CommandDefinition>();
  private aliasMap = new Map<string, string>();

  /**
   * Register a command
   */
  register(command: CommandDefinition): this {
    // Normalize command name
    const name = this.normalizeName(command.name);
    this.commands.set(name, command);

    // Register aliases
    if (command.aliases) {
      for (const alias of command.aliases) {
        const normalizedAlias = this.normalizeName(alias);
        this.aliasMap.set(normalizedAlias, name);
      }
    }

    return this;
  }

  /**
   * Register multiple commands
   */
  registerAll(commands: CommandDefinition[]): this {
    for (const command of commands) {
      this.register(command);
    }
    return this;
  }

  /**
   * Find a command by name or alias
   */
  find(commandName: string): CommandMatch | null {
    const normalized = this.normalizeName(commandName);

    // Direct match
    const direct = this.commands.get(normalized);
    if (direct) {
      return { command: direct, matchedName: commandName };
    }

    // Alias match
    const aliasTarget = this.aliasMap.get(normalized);
    if (aliasTarget) {
      const command = this.commands.get(aliasTarget);
      if (command) {
        return { command, matchedName: commandName };
      }
    }

    return null;
  }

  /**
   * Check if a command exists
   */
  has(commandName: string): boolean {
    return this.find(commandName) !== null;
  }

  /**
   * Execute a command
   */
  async execute(commandName: string, input: string, shell: unknown): Promise<boolean> {
    const match = this.find(commandName);
    if (!match) {
      return false;
    }

    const context: CommandContext = {
      shell,
      input,
      rawCommand: commandName,
    };

    try {
      await Promise.resolve(match.command.handler(context));
      return true;
    } catch (error) {
      logDebug(`Error executing command ${commandName}:`, error);
      return false;
    }
  }

  /**
   * Get all commands in a category
   */
  getByCategory(category: CommandCategory): CommandDefinition[] {
    return Array.from(this.commands.values()).filter(
      (cmd) => cmd.category === category && !cmd.hidden
    );
  }

  /**
   * Get all categories with their commands
   */
  getAllCategories(): Map<CommandCategory, CommandDefinition[]> {
    const categories = new Map<CommandCategory, CommandDefinition[]>();

    for (const command of this.commands.values()) {
      if (command.hidden) continue;

      const existing = categories.get(command.category) || [];
      existing.push(command);
      categories.set(command.category, existing);
    }

    return categories;
  }

  /**
   * Get all registered commands
   */
  getAll(): CommandDefinition[] {
    return Array.from(this.commands.values());
  }

  /**
   * Get all visible commands (excluding hidden)
   */
  getVisible(): CommandDefinition[] {
    return Array.from(this.commands.values()).filter((cmd) => !cmd.hidden);
  }

  /**
   * Generate help text for all commands
   */
  generateHelpText(): string {
    const lines: string[] = ['Available commands:', ''];

    const categories = this.getAllCategories();
    const categoryOrder: CommandCategory[] = [
      'navigation',
      'model',
      'context',
      'session',
      'tools',
      'development',
      'security',
      'learning',
      'advanced',
      'ui',
    ];

    for (const category of categoryOrder) {
      const commands = categories.get(category);
      if (!commands || commands.length === 0) continue;

      lines.push(`${this.formatCategoryName(category)}:`);

      for (const cmd of commands.sort((a, b) => a.name.localeCompare(b.name))) {
        const aliases = cmd.aliases?.length ? ` (${cmd.aliases.join(', ')})` : '';
        lines.push(`  ${cmd.name}${aliases} - ${cmd.description}`);
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Generate compact help text (just command names)
   */
  generateCompactHelp(): string {
    const commands = this.getVisible()
      .map((cmd) => cmd.name)
      .sort();
    return commands.join('  ');
  }

  /**
   * Normalize command name
   */
  private normalizeName(name: string): string {
    return name.toLowerCase().trim();
  }

  /**
   * Format category name for display
   */
  private formatCategoryName(category: CommandCategory): string {
    const names: Record<CommandCategory, string> = {
      navigation: '📍 Navigation',
      model: '🤖 Model Selection',
      context: '📁 Context Management',
      session: '💾 Session Management',
      tools: '🔧 Tools',
      development: '🛠 Development',
      security: '🔐 Security',
      advanced: '⚡ Advanced',
      learning: '🧠 Learning',
      ui: '🎨 UI/Display',
    };
    return names[category] || category;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Built-in Commands Factory
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a standard set of commands for the shell
 *
 * This is meant to be extended/customized by the shell implementation
 */
export function createBaseCommands(): CommandDefinition[] {
  return [
    // Navigation
    {
      name: '/help',
      aliases: ['/?'],
      description: 'Show help information',
      category: 'navigation',
      handler: (ctx) => {
        const shell = ctx.shell as { showHelp?: () => void };
        shell.showHelp?.();
      },
    },
    {
      name: '/exit',
      aliases: ['/quit', '/q'],
      description: 'Exit the shell',
      category: 'navigation',
      handler: (ctx) => {
        const shell = ctx.shell as { shutdown?: () => void };
        shell.shutdown?.();
      },
    },

    // Model
    {
      name: '/model',
      description: 'Show model selection menu',
      category: 'model',
      handler: (ctx) => {
        const shell = ctx.shell as { showModelMenu?: () => void };
        shell.showModelMenu?.();
      },
    },
    {
      name: '/providers',
      description: 'Show configured providers',
      category: 'model',
      handler: (ctx) => {
        const shell = ctx.shell as { showConfiguredProviders?: () => void };
        shell.showConfiguredProviders?.();
      },
    },

    // Context
    {
      name: '/context',
      description: 'Refresh workspace context',
      category: 'context',
      async: true,
      handler: async (ctx) => {
        const shell = ctx.shell as { refreshWorkspaceContextCommand?: (input: string) => Promise<void> };
        await shell.refreshWorkspaceContextCommand?.(ctx.input);
      },
    },

    // Session
    {
      name: '/sessions',
      description: 'Session management',
      category: 'session',
      async: true,
      handler: async (ctx) => {
        const shell = ctx.shell as { handleSessionCommand?: (input: string) => Promise<void> };
        await shell.handleSessionCommand?.(ctx.input);
      },
    },

    // Tools
    {
      name: '/tools',
      description: 'Show available tools',
      category: 'tools',
      handler: (ctx) => {
        const shell = ctx.shell as { showToolsMenu?: () => void };
        shell.showToolsMenu?.();
      },
    },
    {
      name: '/mcp',
      description: 'Show MCP server status',
      category: 'tools',
      async: true,
      handler: async (ctx) => {
        const shell = ctx.shell as { showMcpStatus?: () => Promise<void> };
        await shell.showMcpStatus?.();
      },
    },

    // Development
    {
      name: '/doctor',
      description: 'Run diagnostics',
      category: 'development',
      handler: (ctx) => {
        const shell = ctx.shell as { runDoctor?: () => void };
        shell.runDoctor?.();
      },
    },
    {
      name: '/checks',
      description: 'Run repository checks',
      category: 'development',
      async: true,
      handler: async (ctx) => {
        const shell = ctx.shell as { runRepoChecksCommand?: () => Promise<void> };
        await shell.runRepoChecksCommand?.();
      },
    },

    // Security
    {
      name: '/secrets',
      description: 'Manage API keys and secrets',
      category: 'security',
      handler: (ctx) => {
        const shell = ctx.shell as { showSecretsMenu?: () => void };
        shell.showSecretsMenu?.();
      },
    },

    // Learning
    {
      name: '/learn',
      description: 'Show learning system status',
      category: 'learning',
      handler: (ctx) => {
        const shell = ctx.shell as { showLearningStatus?: (input: string) => void };
        shell.showLearningStatus?.(ctx.input);
      },
    },

    // UI
    {
      name: '/shortcuts',
      aliases: ['/keys'],
      description: 'Show keyboard shortcuts',
      category: 'ui',
      handler: (ctx) => {
        const shell = ctx.shell as { handleShortcutsCommand?: () => void };
        shell.handleShortcutsCommand?.();
      },
    },
    {
      name: '/thinking',
      description: 'Toggle thinking/reasoning display',
      category: 'ui',
      handler: (ctx) => {
        const shell = ctx.shell as { handleThinkingCommand?: (input: string) => void };
        shell.handleThinkingCommand?.(ctx.input);
      },
    },

    // Advanced - Dual RL Tournament
    {
      name: '/upgrade',
      aliases: ['/up'],
      description: 'Run repo upgrade with dual RL tournament mode',
      category: 'advanced',
      usage: '/upgrade [dual|tournament] [scope:path] [--validate] [--parallel-variants] [--continue-on-failure] <direction>',
      async: true,
      handler: async (ctx) => {
        const shell = ctx.shell as { runRepoUpgradeCommand?: (args: string[]) => Promise<void> };
        const args = ctx.input.split(/\s+/).filter(Boolean);
        await shell.runRepoUpgradeCommand?.(args);
      },
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Singleton Registry Instance
// ═══════════════════════════════════════════════════════════════════════════════

let globalRegistry: CommandRegistry | null = null;

export function getCommandRegistry(): CommandRegistry {
  if (!globalRegistry) {
    globalRegistry = new CommandRegistry();
    globalRegistry.registerAll(createBaseCommands());
  }
  return globalRegistry;
}

export function resetCommandRegistry(): void {
  globalRegistry = null;
}
