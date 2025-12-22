/**
 * UnifiedUIRenderer - Claude Code style minimalist terminal UI.
 *
 * Goals:
 * - Single event pipeline for everything (prompt → thought → tool/build/test → response).
 * - Pinned status/meta only (never in scrollback).
 * - Scrollback only shows events; no duplicate status like "Working on your request" or "Ready for prompts".
 * - Streaming: first chunk sets a one-line banner; remainder streams naturally (optional).
 * - Collapsible-like summaries: we format a compact heading with an ellipsis indicator, but avoid ctrl+o hints.
 */

import * as readline from 'node:readline';
import { EventEmitter } from 'node:events';
import { homedir } from 'node:os';
import chalk from 'chalk';
import { theme, spinnerFrames, getToolColor } from './theme.js';
import { isPlainOutputMode } from './outputMode.js';
import { AnimatedSpinner, ThinkingIndicator, ContextMeter, disposeAnimations } from './animatedStatus.js';
import {
  clampPercentage,
  getContextColor,
} from './uiConstants.js';
import { formatInlineText } from './richText.js';
import { initializeInputProtection, getInputProtection, type InputProtection } from '../core/inputProtection.js';

// UI helper methods for security components
export function createBanner(title: string, subtitle?: string): string {
  const lines: string[] = [];
  lines.push(chalk.cyan('╔' + '═'.repeat(68) + '╗'));
  lines.push(chalk.cyan('║ ') + chalk.cyan.bold(title.padEnd(66)) + chalk.cyan(' ║'));
  if (subtitle) {
    lines.push(chalk.cyan('║ ') + chalk.white(subtitle.padEnd(66)) + chalk.cyan(' ║'));
  }
  lines.push(chalk.cyan('╚' + '═'.repeat(68) + '╝'));
  return lines.join('\n');
}

export function formatProgress(phase: string, step: number, totalSteps: number): string {
  const percentage = Math.round((step / totalSteps) * 100);
  const progressBar = '█'.repeat(Math.floor(percentage / 5)) + '░'.repeat(20 - Math.floor(percentage / 5));
  return `${chalk.cyan('⠋')} ${chalk.white(phase)}: [${chalk.green(progressBar)}] ${percentage}% (${step}/${totalSteps})`;
}

// Apple Security UI compatibility methods (replaces AppleSecurityUI.ts)
export function createSecurityBanner(title: string, subtitle?: string): string {
  const width = 70;
  const lines: string[] = [];
  lines.push(chalk.cyan('═'.repeat(width)));
  lines.push(`${chalk.cyan('🛡️')} ${chalk.cyan.bold(title.toUpperCase())}`);
  if (subtitle) {
    lines.push(chalk.gray(`  ${subtitle}`));
  }
  lines.push(chalk.cyan('═'.repeat(width)));
  return lines.join('\n');
}

export function createSecuritySpinner(message: string): string {
  return `${chalk.cyan('⠋')} ${chalk.white(message)}`;
}

export function formatSecurityFinding(finding: any): string {
  const severityColors = {
    critical: chalk.redBright,
    high: chalk.red,
    medium: chalk.yellow,
    low: chalk.blue,
    info: chalk.gray
  };
  
  const severityIcons = {
    critical: chalk.redBright('⚠'),
    high: chalk.red('▲'),
    medium: chalk.yellow('▲'),
    low: chalk.blue('▼'),
    info: chalk.gray('ℹ')
  };
  
  const color = severityColors[finding.severity] || chalk.white;
  const icon = severityIcons[finding.severity] || chalk.gray('ℹ');
  
  const lines: string[] = [];
  lines.push(`${icon} ${color.bold(finding.name || finding.type || 'Finding')}`);
  lines.push(`  ${chalk.gray('Description:')} ${chalk.white(finding.description || 'No description')}`);
  if (finding.evidence) {
    lines.push(`  ${chalk.gray('Evidence:')} ${chalk.white(finding.evidence)}`);
  }
  if (finding.remediation) {
    lines.push(`  ${chalk.gray('Remediation:')} ${chalk.green(finding.remediation)}`);
  }
  return lines.join('\n');
}

export function formatSecuritySummary(results: any): string {
  const lines: string[] = [];
  lines.push(chalk.cyan('═'.repeat(70)));
  lines.push(`${chalk.cyan('🛡️')} ${chalk.cyan.bold('SECURITY AUDIT SUMMARY')}`);
  lines.push(chalk.cyan('═'.repeat(70)));
  
  lines.push(`  ${chalk.gray('Campaign:')} ${chalk.white(results.campaign || 'Unknown')}`);
  lines.push(`  ${chalk.gray('Start Time:')} ${chalk.white(results.startTime || 'Unknown')}`);
  if (results.endTime) {
    lines.push(`  ${chalk.gray('End Time:')} ${chalk.white(results.endTime)}`);
  }
  if (results.duration) {
    lines.push(`  ${chalk.gray('Duration:')} ${chalk.white(`${results.duration}ms`)}`);
  }
  
  if (results.findings && Array.isArray(results.findings)) {
    const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    results.findings.forEach((f: any) => {
      counts[f.severity] = (counts[f.severity] || 0) + 1;
    });
    
    lines.push(`  ${chalk.gray('Findings:')}`);
    Object.entries(counts).forEach(([severity, count]) => {
      if (count > 0) {
        const color = severityColors[severity] || chalk.white;
        lines.push(`    ${color(`${severity.toUpperCase()}:`)} ${chalk.white(count)}`);
      }
    });
    lines.push(`    ${chalk.gray('Total:')} ${chalk.white(results.findings.length)}`);
  }
  
  return lines.join('\n');
}

export function formatSecurityStatus(status: string, details: string): string {
  const statusIcons = {
    healthy: `${chalk.green('●')}`,
    degraded: `${chalk.yellow('●')}`,
    unavailable: `${chalk.red('●')}`
  };
  
  const icon = statusIcons[status] || chalk.gray('●');
  return `${icon} ${chalk.white(details)}`;
}

export function formatAuditProgress(phase: string, progress: number, total: number): string {
  const percentage = Math.round((progress / total) * 100);
  const filled = Math.round(percentage / 10);
  const empty = 10 - filled;

  const progressBar = `${chalk.green('█'.repeat(filled))}${chalk.gray('░'.repeat(empty))}`;

  return `${chalk.gray('⏱')} ${chalk.cyan('Security Audit')} - ${chalk.white(phase)}\n` +
         `  ${progressBar} ${chalk.white(`${progress}/${total}`)} ${chalk.gray(`(${percentage}%)`)}`;
}

/**
 * Format a security tools summary message for display.
 * Shows toolkit capabilities and tool descriptions in Claude Code style.
 */
export function formatSecureToolsSummary(options?: {
  showTitle?: boolean;
  tools?: Array<{ name: string; description: string; status?: 'active' | 'ready' | 'disabled' }>;
}): string {
  const lines: string[] = [];
  const showTitle = options?.showTitle ?? true;

  if (showTitle) {
    lines.push(`${chalk.white('⏺')} ${chalk.white('Added new security tools and improved')}`);
    lines.push(`  ${chalk.white('existing ones for more versatile')}`);
    lines.push(`  ${chalk.white('operations.')}`);
  }

  const defaultTools = [
    { name: 'Execute', description: 'secure shell commands', status: 'active' as const },
    { name: 'Probe', description: 'target analysis', status: 'active' as const },
    { name: 'State', description: 'session management', status: 'active' as const },
  ];

  const tools = options?.tools || defaultTools;

  const toolParts = tools.map(tool => {
    const statusIcon = tool.status === 'active' ? chalk.green('●') :
                       tool.status === 'ready' ? chalk.yellow('○') :
                       chalk.gray('○');
    return `${statusIcon} ${chalk.cyan(`'${tool.name}'`)} for ${chalk.white(tool.description)}`;
  });

  if (toolParts.length > 0) {
    lines.push(`  ${chalk.white("You now have")} ${toolParts[0]},`);
    for (let i = 1; i < toolParts.length - 1; i++) {
      lines.push(`  ${toolParts[i]},`);
    }
    if (toolParts.length > 1) {
      lines.push(`  ${chalk.white('and')} ${toolParts[toolParts.length - 1]}—`);
    }
    lines.push(`  ${chalk.white('each with enhanced output formatting.')}`);
  }

  lines.push(`  ${chalk.gray('This expands your toolkit\'s capabilities')}`);
  lines.push(`  ${chalk.gray('while maintaining strict input sanitization')}`);
  lines.push(`  ${chalk.gray('and security.')}`);
  lines.push(`  ${chalk.gray('(src/capabilities/maxOffensiveUkraineCapability.ts)')}`);

  return lines.join('\n');
}

const severityColors: Record<string, any> = {
  critical: (text: string) => chalk.hex('#FF6B6B')(text), // redBright
  high: (text: string) => chalk.hex('#FF5252')(text), // red
  medium: (text: string) => chalk.hex('#FFD93D')(text), // yellow
  low: (text: string) => chalk.hex('#4D96FF')(text), // blue
  info: (text: string) => chalk.hex('#AAAAAA')(text) // gray
};

export interface CommandSuggestion {
  command: string;
  description: string;
  category?: string;
}

/**
 * Interactive menu item for Claude Code style menus.
 */
export interface MenuItem {
  /** Unique identifier for the item */
  id: string;
  /** Display label */
  label: string;
  /** Optional description shown to the right */
  description?: string;
  /** Optional category for grouping */
  category?: string;
  /** Whether item is disabled */
  disabled?: boolean;
  /** Whether this is the current/active item */
  isActive?: boolean;
}

type CanonicalEventType = 'prompt' | 'thought' | 'stream' | 'tool' | 'tool-result' | 'build' | 'test' | 'response';

export type RendererEventType =
  | CanonicalEventType
  | 'raw'
  | 'banner'
  | 'error'
  | 'streaming'
  | 'tool-call'
  | 'tool-result'
  | 'system';

type UIEvent = {
  type: CanonicalEventType;
  rawType: RendererEventType;
  content: string;
  timestamp: number;
  isCompacted?: boolean; // Claude Code style compact conversation block
};

export interface UnifiedUIRendererOptions {
  debug?: boolean;
}

type InputChangeEvent = {
  text: string;
  cursor: number;
};

interface ModeToggleState {
  autoMode?: 'off' | 'on' | 'dual';  // off = disabled, on = auto-continue, dual = tournament RL
  autoContinueHotkey?: string;
  thinkingModeLabel?: string | null;
  thinkingHotkey?: string;
  criticalApprovalMode?: 'auto' | 'approval';
  criticalApprovalHotkey?: string;
  debugEnabled?: boolean;
  debugHotkey?: string;
}

/**
 * RL agent execution status for real-time display during dual-RL mode.
 */
export interface RLAgentStatus {
  /** Current active variant being executed */
  activeVariant?: 'primary' | 'refiner' | null;
  /** Current module being processed */
  currentModule?: string;
  /** Current step within the module */
  currentStep?: string;
  /** Win statistics for primary vs refiner */
  wins?: { primary: number; refiner: number; ties: number };
  /** Current reward scores if available */
  scores?: { primary?: number; refiner?: number };
  /** Human-accuracy style scores (0-1) */
  accuracy?: { primary?: number; refiner?: number };
  /** Whether variants are running in parallel */
  parallelExecution?: boolean;
  /** Total steps completed */
  stepsCompleted?: number;
  /** Total steps to process */
  totalSteps?: number;
  /** Last step winner for celebration */
  lastWinner?: 'primary' | 'refiner' | 'tie' | null;
  /** Streak count for current leader */
  streak?: number;
}

/**
 * Attack operation status for real-time display during offensive security operations.
 */
export interface AttackStatus {
  /** Current attack phase */
  phase?: 'recon' | 'scanning' | 'exploitation' | 'persistence' | 'exfiltration' | 'destruction';
  /** Current target being attacked */
  currentTarget?: string;
  /** Number of targets acquired */
  targetsAcquired?: number;
  /** Number of vulnerabilities found */
  vulnerabilitiesFound?: number;
  /** Number of successful exploits */
  exploitsSuccessful?: number;
  /** Persistence mechanisms established */
  persistenceEstablished?: number;
  /** Data exfiltrated (MB) */
  dataExfiltrated?: number;
  /** Infrastructure compromised count */
  infrastructureCompromised?: number;
  /** Real-time monitoring active */
  monitoringActive?: boolean;
  /** Current attack mode */
  attackMode?: 'recon' | 'attack' | 'exploit' | 'persistence' | 'c2' | 'destruction';
  /** Attack success rate percentage */
  successRate?: number;
  /** Last attack result */
  lastResult?: 'success' | 'failure' | 'partial';
  /** Active attack modules */
  activeModules?: string[];
  /** Time since attack started */
  attackDuration?: number;
}

/**
 * Security tools status for real-time display of secure TAO tools.
 * Tracks Execute, Probe, State tools with enhanced output formatting.
 */
export interface SecureToolsStatus {
  /** Execute tool - secure shell command status */
  execute?: {
    active: boolean;
    lastCommand?: string;
    lastExitCode?: number;
    execCount?: number;
  };
  /** Probe tool - target analysis status */
  probe?: {
    active: boolean;
    lastTarget?: string;
    servicesFound?: number;
    probeCount?: number;
  };
  /** State tool - session management status */
  state?: {
    active: boolean;
    keysStored?: number;
    lastAction?: 'get' | 'set';
    persistent?: boolean;
  };
  /** Overall toolkit status */
  toolkitReady?: boolean;
  /** Input sanitization active */
  sanitizationActive?: boolean;
  /** Last tool used */
  lastToolUsed?: 'Execute' | 'Probe' | 'State' | 'Transform' | 'TaoOps' | null;
  /** Total tool invocations this session */
  totalInvocations?: number;
}

const ESC = {
  HIDE_CURSOR: '\x1b[?25l',
  SHOW_CURSOR: '\x1b[?25h',
  CLEAR_SCREEN: '\x1b[2J',
  CLEAR_LINE: '\x1b[2K',
  HOME: '\x1b[H',
  ENABLE_BRACKETED_PASTE: '\x1b[?2004h',
  DISABLE_BRACKETED_PASTE: '\x1b[?2004l',
  TO: (row: number, col: number) => `\x1b[${row};${col}H`,
  TO_COL: (col: number) => `\x1b[${col}G`,
  ERASE_DOWN: '\x1b[J',
  REVERSE: '\x1b[7m',
  RESET: '\x1b[0m',
  // Scroll region control - CRITICAL for fixed bottom overlay
  SET_SCROLL_REGION: (top: number, bottom: number) => `\x1b[${top};${bottom}r`,
  RESET_SCROLL_REGION: '\x1b[r',
  SAVE_CURSOR: '\x1b[s',
  RESTORE_CURSOR: '\x1b[u',
} as const;

const NEWLINE_PLACEHOLDER = '↵';

export class UnifiedUIRenderer extends EventEmitter {
  private readonly output: NodeJS.WriteStream;
  private readonly input: NodeJS.ReadStream;
  private readonly rl: readline.Interface;
  private readonly plainMode: boolean;
  private readonly interactive: boolean;

  private rows = 24;
  private cols = 80;
  private lastRenderWidth: number | null = null;

  private eventQueue: UIEvent[] = [];
  private isProcessingQueue = false;

  private buffer = '';
  private cursor = 0;
  private history: string[] = [];
  private historyIndex = -1;
  private suggestions: { command: string; description: string; category?: string }[] = [];
  private suggestionIndex = -1;
  private availableCommands: typeof this.suggestions = [];
  private hotkeysInToggleLine: Set<string> = new Set();
  private collapsedPaste: { text: string; lines: number; chars: number } | null = null;

  private mode: 'idle' | 'streaming' = 'idle';
  /** Queue for input received during streaming - processed after streaming ends */
  private streamingInputQueue: string[] = [];
  /** Buffer to accumulate streaming content for post-processing */
  private streamingContentBuffer: string = '';
  /** Track lines written during streaming for potential reformat */
  private streamingLinesWritten: number = 0;
  private lastToolResult: string | null = null;
  /** Stack of collapsed tool results for Ctrl+O expansion */
  private collapsedToolResults: Array<{
    toolName: string;
    content: string;
    summary: string;
    timestamp: number;
    metadata?: {
      filePath?: string;
      oldLength?: number;
      newLength?: number;
      diff?: { old: string; new: string };
    };
  }> = [];
  private readonly maxCollapsedResults = 50;
  /** Track the last tool name for pairing with results */
  private lastToolName: string = '';
  private streamingStartTime: number | null = null;
  private statusMessage: string | null = null;
  private statusOverride: string | null = null;
  private statusStreaming: string | null = null;

  // Animated UI components
  private streamingSpinner: AnimatedSpinner | null = null;
  private thinkingIndicator: ThinkingIndicator | null = null;
  private contextMeter: ContextMeter;
  private spinnerFrame = 0;
  private spinnerInterval: NodeJS.Timeout | null = null;
  private readonly maxInlinePanelLines = 12;

  // Compacting status animation
  private compactingStatusMessage = '';
  private compactingStatusFrame = 0;
  private compactingStatusInterval: NodeJS.Timeout | null = null;
  private readonly compactingSpinnerFrames = ['✻', '✼', '✻', '✺'];

  // Animated activity line (e.g., "✳ Ruminating… (esc to interrupt · 34s · ↑1.2k)")
  private activityMessage: string | null = null;
  private activityPhraseIndex = 0;
  private activityStarFrame = 0;
  private readonly activityStarFrames = ['✳', '✴', '✵', '✶', '✷', '✸'];
  // Token count during streaming
  private streamingTokens = 0;
  // Elapsed time color animation
  private elapsedColorFrame = 0;
  private readonly elapsedColorFrames = ['#F59E0B', '#FBBF24', '#FCD34D', '#FDE68A', '#FCD34D', '#FBBF24'];
  // User-friendly activity phrases (clean, professional)
  private readonly funActivityPhrases = [
    'Thinking', 'Processing', 'Analyzing', 'Working', 'Preparing',
  ];
  private readonly maxCuratedReasoningLines = 8;
  private readonly maxCuratedReasoningChars = 1800;
  private readonly thoughtDedupWindowMs = 15000;
  private lastCuratedThought: { text: string; at: number } | null = null;

  private statusMeta: {
    model?: string;
    provider?: string;
    sessionTime?: string;
    contextPercent?: number;
    profile?: string;
    workspace?: string;
    directory?: string;
    writes?: string;
    sessionLabel?: string;
    thinkingLabel?: string;
    autosave?: boolean;
    version?: string;
    toolSummary?: string;
  } = {};
  private toggleState: ModeToggleState = {
    autoMode: 'off',
    criticalApprovalMode: 'auto',
    debugEnabled: false,
  };

  /** RL agent execution status for dual-RL mode display */
  private rlStatus: RLAgentStatus = {};

  /** Secure TAO tools status for real-time display */
  private secureToolsStatus: SecureToolsStatus = {
    toolkitReady: true,
    sanitizationActive: true,
    totalInvocations: 0,
  };

  // ------------ Helpers ------------

  /** Ensure cursor is always within valid bounds for the current buffer */
  private clampCursor(): void {
    this.cursor = Math.max(0, Math.min(this.cursor, this.buffer.length));
  }

  /** Safely append to paste buffer with size limit enforcement */
  private appendToPasteBuffer(buffer: 'paste' | 'plainPaste', text: string): void {
    if (this.pasteBufferOverflow) return; // Already at limit
    const current = buffer === 'paste' ? this.pasteBuffer : this.plainPasteBuffer;
    const remaining = this.maxPasteBufferSize - current.length;
    if (remaining <= 0) {
      this.pasteBufferOverflow = true;
      return;
    }
    const toAdd = text.length <= remaining ? text : text.slice(0, remaining);
    if (buffer === 'paste') {
      this.pasteBuffer += toAdd;
    } else {
      this.plainPasteBuffer += toAdd;
    }
    if (toAdd.length < text.length) {
      this.pasteBufferOverflow = true;
    }
  }

  /** Strip ANSI escape sequences and special formatting from text to get clean plaintext */
  private sanitizePasteContent(text: string): string {
    if (!text) return '';
    
    // Remove all ANSI escape sequences (CSI, OSC, etc.)
    // Including bracketed paste markers (\x1b[200~ and \x1b[201~) which end with ~
    // eslint-disable-next-line no-control-regex
    let sanitized = text.replace(/\x1b\[[0-9;]*[A-Za-z~]|\x1b\][^\x07]*\x07|\x1b[PX^_][^\x1b]*\x1b\\|\x1b./g, '');
    // Also remove partial bracketed paste markers that may have leaked (e.g., "[200~" without ESC)
    sanitized = sanitized.replace(/\[20[01]~/g, '');
    // Remove any stray escape character at start/end
    // eslint-disable-next-line no-control-regex
    sanitized = sanitized.replace(/^\x1b+|\x1b+$/g, '');

    // Strip toggle symbols that might have leaked through
    // This is a safety net - primary removal happens in stripToggleSymbols
    const isToggleCharacter = (ch: string): boolean => {
      if (!ch || ch.length !== 1) return false;
      const code = ch.charCodeAt(0);
      if (code === 169 || code === 8482) return true; // © ™ (Option+G)
      if (code === 229 || code === 197) return true;  // å Å (Option+A)
      if (code === 8706 || code === 8710 || code === 206) return true; // ∂ ∆ Î (Option+D)
      if (code === 8224 || code === 8225) return true; // † ‡ (Option+T)
      if (code === 8730) return true; // √ (Option+V)
      return false;
    };
    
    const chars = [...sanitized];
    let result = '';
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (isToggleCharacter(ch)) {
        continue;
      }
      result += ch;
    }
    sanitized = result;

    // Strip special formatting characters for clean plaintext:
    // - Zero-width characters (ZWSP, ZWNJ, ZWJ, BOM/ZWNBSP)
    // - Word joiner, invisible separator, invisible times/plus
    // - Directional formatting (LRM, RLM, LRE, RLE, LRO, RLO, PDF, LRI, RLI, FSI, PDI)
    // - Object replacement character
    // - Soft hyphen
    // - Non-breaking space variants (NBSP, narrow NBSP, figure space, etc.)
    sanitized = sanitized.replace(/[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\u00AD\uFFFC]/g, '');

    // Normalize various space characters to regular space
    // Includes: NBSP, en/em space, thin space, hair space, figure space, etc.
    sanitized = sanitized.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ');

    // Remove control characters except tab, newline, carriage return
    // eslint-disable-next-line no-control-regex
    sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    return sanitized;
  }

  private formatHotkey(combo?: string): string | null {
    if (!combo?.trim()) return null;
    return combo.trim().toUpperCase();
  }

  private lastPromptEvent: { text: string; at: number } | null = null;

  private promptHeight = 0;
  private lastOverlayHeight = 0;
  private inlinePanel: string[] = [];
  private hasConversationContent = false;
  private isPromptActive = false;
  private inputRenderOffset = 0;
  private readonly plainPasteIdleMs = 80; // Increased for more robust multi-line paste detection
  private readonly plainPasteWindowMs = 120; // Increased window for paste burst detection
  private readonly plainPasteTriggerChars = 16; // Lower threshold to catch multi-line pastes sooner
  private readonly plainPasteEarlyNewlineChars = 1; // Immediate detection of multi-line content
  // Paste buffer limits to prevent memory exhaustion
  private readonly maxPasteBufferSize = 10 * 1024 * 1024; // 10MB max paste size
  private pasteBufferOverflow = false; // Track if paste was truncated
  private cursorVisibleColumn = 1;
  private inBracketedPaste = false;
  private pasteBuffer = '';
  private inPlainPaste = false;
  private plainPasteBuffer = '';
  private plainPasteTimer: NodeJS.Timeout | null = null;
  private pasteBurstWindowStart = 0;
  private pasteBurstCharCount = 0;
  private plainRecentChunks: Array<{ text: string; at: number }> = [];
  // Pending insert buffer: holds characters during paste detection window to prevent visual leak
  private pendingInsertBuffer = '';
  private pendingInsertTimer: NodeJS.Timeout | null = null;
  private readonly pendingInsertDelayMs = 16; // Reduced from 80ms for faster typing response
  // Emit-level paste detection - accumulate all rapid input then commit
  private emitPasteBuffer = '';
  private emitPasteTimer: NodeJS.Timeout | null = null;
  private readonly emitPasteCommitMs = 30; // Commit after 30ms of no input
  private lastRenderedEventKey: string | null = null;
  private lastOutputEndedWithNewline = true;
  private hasRenderedPrompt = false;
  private hasEverRenderedOverlay = false;  // Track if we've ever rendered for inline clearing
  private lastOverlay: { lines: string[]; promptIndex: number } | null = null;
  private allowPromptRender = true;
  private promptRenderingSuspended = false;
  private secretMode = false;
  // Render throttling to prevent excessive redraws during rapid input
  private pendingRender = false;
  private lastRenderTime = 0;
  private readonly renderThrottleMs = 16; // ~60fps max
  private renderThrottleTimer: NodeJS.Timeout | null = null;
  // Performance: Cache last rendered state to skip unnecessary renders
  private lastRenderedBuffer = '';
  private forceNextRender = false;
  private lastRenderedCursor = 0;
  private lastRenderedMode: 'idle' | 'streaming' = 'idle';
  // Disposal state to prevent operations after cleanup
  private disposed = false;
  // Initialization state - skip prompt renders until first banner is shown
  private initializing = true;
  // Bound event handlers for proper cleanup
  private boundResizeHandler: (() => void) | null = null;
  private boundKeypressHandler: ((str: string, key: readline.Key) => void) | null = null;
  private boundDataHandler: ((data: Buffer) => void) | null = null;
  private boundCtrlHandler: (() => void) | null = null;
  // Original emit method for restoration on cleanup
  private originalEmit: ((...args: unknown[]) => boolean) | null = null;
  private inputProtection: InputProtection | null = null;
  private inputCapture:
    | {
        resolve: (value: string) => void;
        reject?: (reason?: unknown) => void;
        options: { trim: boolean; allowEmpty: boolean };
      }
    | null = null;

  // Interactive menu state (Claude Code style)
  private menuItems: MenuItem[] = [];
  private menuIndex = 0;
  private menuTitle: string | null = null;
  private menuCallback: ((item: MenuItem | null) => void) | null = null;

  constructor(
    output: NodeJS.WriteStream = process.stdout,
    input: NodeJS.ReadStream = process.stdin,
    _options?: UnifiedUIRendererOptions
  ) {
    super();

    // Set up error handling for EventEmitter
    this.on('error', (err) => {
      // Log errors but don't crash
      console.error('[UnifiedUIRenderer] Error:', err);
    });

    this.output = output;
    this.input = input;

    // Robust TTY detection with multiple fallbacks
    const outputIsTTY = Boolean(this.output?.isTTY);
    const inputIsTTY = Boolean(this.input?.isTTY);
    this.interactive = outputIsTTY && inputIsTTY;
    this.plainMode = isPlainOutputMode() || !this.interactive;

    // Initialize animated components with error handling
    try {
      this.contextMeter = new ContextMeter();
    } catch {
      // Create a no-op context meter if initialization fails
      this.contextMeter = new ContextMeter();
    }

    // Create readline interface with error handling
    try {
      this.rl = readline.createInterface({
        input: this.input,
        output: this.output,
        terminal: true,
        prompt: '',
        tabSize: 2,
      });
      this.rl.setPrompt('');
    } catch (err) {
      // If readline creation fails, create a minimal fallback
      console.error('[UnifiedUIRenderer] Failed to create readline interface:', err);
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false,
      });
      this.interactive = false;
      this.plainMode = true;
    }

    this.updateTerminalSize();

    // Initialize input protection against remote attacks
    this.inputProtection = initializeInputProtection({
      verbose: process.env['AGI_DEBUG'] === '1',
      onAttackDetected: (type, details) => {
        // Log attack but don't disrupt user experience
        if (process.env['AGI_DEBUG']) {
          console.error(`[InputProtection] Attack detected: ${type} - ${details}`);
        }
      },
    });

    // Use bound handlers so we can remove them on cleanup
    this.boundResizeHandler = () => {
      if (!this.plainMode && !this.disposed) {
        try {
          this.updateTerminalSize();
          this.renderPrompt();
        } catch {
          // Silently ignore resize errors
        }
      }
    };

    // Safely add resize handler
    try {
      this.output.on('resize', this.boundResizeHandler);
    } catch {
      // Ignore if event listener can't be added
    }

    this.setupInputHandlers();
  }

  initialize(): void {
    if (!this.interactive) {
      return;
    }

    // Reset input and paste state to prevent stale state from previous session
    this.buffer = '';
    this.cursor = 0;
    this.inputRenderOffset = 0;
    this.inBracketedPaste = false;
    this.pasteBuffer = '';
    this.pasteBufferOverflow = false;
    this.inPlainPaste = false;
    this.plainPasteBuffer = '';
    this.collapsedPaste = null;
    this.pendingInsertBuffer = '';
    this.cancelPlainPasteCapture();

    if (!this.plainMode) {
      // If an overlay was already rendered before initialization (e.g., banner emitted early),
      // clear it so initialize() doesn't stack a second control bar in scrollback.
      if (this.hasRenderedPrompt || this.lastOverlay) {
        this.clearPromptArea();
      }
      this.write(ESC.ENABLE_BRACKETED_PASTE);
      this.updateTerminalSize();
      this.hasRenderedPrompt = false;
      this.lastOutputEndedWithNewline = true;
      this.write(ESC.SHOW_CURSOR);
      return;
    }

    // Plain mode: minimal setup, still render a simple prompt line
    this.updateTerminalSize();
    this.hasRenderedPrompt = false;
    this.lastOutputEndedWithNewline = true;
    this.renderPrompt();
  }

  cleanup(): void {
    // Mark as disposed first to prevent any pending operations
    this.disposed = true;

    // Wrap all cleanup in try-catch to ensure graceful shutdown
    try {
      this.cancelInputCapture(new Error('Renderer disposed'));
    } catch { /* ignore */ }

    try {
      this.cancelPlainPasteCapture();
    } catch { /* ignore */ }

    // Clear render throttle timer
    if (this.renderThrottleTimer) {
      try {
        clearTimeout(this.renderThrottleTimer);
      } catch { /* ignore */ }
      this.renderThrottleTimer = null;
    }

    // Stop any running animations with error handling
    if (this.spinnerInterval) {
      try {
        clearInterval(this.spinnerInterval);
      } catch { /* ignore */ }
      this.spinnerInterval = null;
    }

    if (this.streamingSpinner) {
      try {
        this.streamingSpinner.stop();
      } catch { /* ignore */ }
      this.streamingSpinner = null;
    }

    if (this.thinkingIndicator) {
      try {
        this.thinkingIndicator.stop();
      } catch { /* ignore */ }
      this.thinkingIndicator = null;
    }

    try {
      this.contextMeter.dispose();
    } catch { /* ignore */ }

    try {
      disposeAnimations();
    } catch { /* ignore */ }

    // Remove event listeners to prevent memory leaks
    if (this.boundResizeHandler) {
      try {
        this.output.removeListener('resize', this.boundResizeHandler);
      } catch { /* ignore */ }
      this.boundResizeHandler = null;
    }

    if (this.boundKeypressHandler) {
      try {
        this.input.removeListener('keypress', this.boundKeypressHandler);
      } catch { /* ignore */ }
      this.boundKeypressHandler = null;
    }

    if (this.boundDataHandler) {
      try {
        this.input.removeListener('data', this.boundDataHandler);
      } catch { /* ignore */ }
      this.boundDataHandler = null;
    }

    if (this.boundCtrlHandler) {
      try {
        this.input.removeListener('data', this.boundCtrlHandler);
      } catch { /* ignore */ }
      this.boundCtrlHandler = null;
    }

    // Restore original emit method on stdin
    if (this.originalEmit) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.input as any).emit = this.originalEmit;
      } catch { /* ignore */ }
      this.originalEmit = null;
    }

    // Remove all EventEmitter listeners from this instance
    try {
      this.removeAllListeners();
    } catch { /* ignore */ }

    if (!this.interactive) {
      try {
        this.rl.close();
      } catch { /* ignore */ }
      return;
    }

    if (!this.plainMode) {
      // Clear the prompt area so it doesn't remain in scrollback history
      try {
        this.clearPromptArea();
        this.write(ESC.DISABLE_BRACKETED_PASTE);
        this.write(ESC.SHOW_CURSOR);
        this.write('\n');
      } catch { /* ignore */ }
    }

    try {
      if (this.input.isTTY) {
        this.input.setRawMode(false);
      }
    } catch { /* ignore */ }

    try {
      this.rl.close();
    } catch { /* ignore */ }

    this.lastOverlay = null;

    // Clear event queue
    this.eventQueue = [];
  }

  suspendPromptRendering(): void {
    this.promptRenderingSuspended = true;
  }

  resumePromptRendering(render: boolean = false): void {
    this.promptRenderingSuspended = false;
    if (render) {
      this.renderPrompt();
    }
  }

  // ------------ Input handling ------------

  // Track special keys intercepted at the raw data level
  private interceptedToggle: string | null = null;
  private interceptedCtrlC = false;
  private interceptedCtrlD = false;
  private pendingToggleSkips = 0;

  private setupInputHandlers(): void {
    if (!this.interactive) {
      return;
    }
    this.rl.removeAllListeners('line');

    // CRITICAL: Override the emit method on stdin to intercept data events
    // BEFORE any listener (including readline) sees them. This is the ONLY
    // way to truly prevent control characters from being echoed.
    const self = this;
    this.originalEmit = this.input.emit.bind(this.input);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.input as any).emit = function(event: string, ...args: unknown[]): boolean {
      if (event === 'data' && !self.disposed) {
        const data = args[0];
        const str = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
        const code = str ? str.charCodeAt(0) : 0;

        if (process.env['AGI_DEBUG_KEYS']) {
          console.error(`[KEY] EMIT INTERCEPT: event="${event}" str="${str}" code=${code} len=${str.length}`);
        }

        // BLOCK: Ctrl+C (code 3) - handle and suppress
        if (code === 3) {
          if (process.env['AGI_DEBUG_KEYS']) {
            console.error(`[KEY] CTRL+C BLOCKED AT EMIT LEVEL`);
          }
          // Use setImmediate to handle after this event loop tick
          setImmediate(() => self.handleCtrlC());
          return true; // Suppress the event
        }

        // BLOCK: Ctrl+D (code 4) - handle and suppress
        if (code === 4) {
          if (process.env['AGI_DEBUG_KEYS']) {
            console.error(`[KEY] CTRL+D BLOCKED AT EMIT LEVEL`);
          }
          setImmediate(() => self.handleCtrlD());
          return true; // Suppress the event
        }

        // BLOCK: Direct single-char toggle detection (most common case)
        // Check the first char code directly for speed and reliability
        let directToggle: string | null = null;

        if (str.length === 1) {
          if (code === 169 || code === 8482) directToggle = 'g'; // © ™
          else if (code === 229 || code === 197) directToggle = 'a'; // å Å
          else if (code === 8706 || code === 8710 || code === 206) directToggle = 'd'; // ∂ ∆ Î
          else if (code === 8224 || code === 8225) directToggle = 't'; // † ‡
          else if (code === 8730) directToggle = 'v'; // √
        }
        // Also check ESC+letter (2-char sequence)
        if (!directToggle && code === 27 && str.length === 2) {
          const letter = str.charAt(1).toLowerCase();
          if (['g', 'a', 'd', 't', 'v'].includes(letter)) {
            directToggle = letter;
          }
        }

        if (directToggle) {
          // Handle immediately (not in setImmediate to ensure it runs)
          self.handleToggle(directToggle);
          return true; // Suppress the event
        }

        // BLOCK: Multi-char toggle detection (for paste scenarios)
        const toggles = self.extractToggleLetters(str);
        if (toggles.length > 0) {
          if (process.env['AGI_DEBUG_KEYS']) {
            console.error(`[KEY] TOGGLE MULTI DETECT: ${toggles.join(',')}`);
          }
          for (const letter of toggles) {
            self.handleToggle(letter);
          }
          return true; // Suppress the event
        }

        // PASTE DETECTION at emit level: Multi-char data = paste
        // When user types, each character arrives separately
        // When user pastes, all characters arrive as one chunk OR rapidly
        // Check for bracketed paste markers first
        const pasteStartMarker = '\x1b[200~';
        const pasteEndMarker = '\x1b[201~';
        const hasBracketedStart = str.includes(pasteStartMarker);
        const hasBracketedEnd = str.includes(pasteEndMarker);

        // Handle bracketed paste (terminal sends markers)
        if (hasBracketedStart || hasBracketedEnd || self.inBracketedPaste) {
          // Let the regular bracketed paste handler deal with it
          // Fall through to readline
        }
        // Detect plain paste: multi-char, has printable content, not escape sequence
        // This is handled by the buffer logic below, so we can remove this special case
        // The buffer logic at the bottom handles both single-char and multi-char
        // Buffer ALL input (including multi-char chunks) and commit after idle
        // This catches paste whether terminal sends it as one chunk or char-by-char
        const isPrintable = (c: number) => (c >= 32 && c < 127) || c > 127; // ASCII printable or Unicode
        const isNewline = (c: number) => c === 10 || c === 13;
        const inPasteBurst = self.emitPasteBuffer.length > 0;

        // PASTE DETECTION: Only buffer when we detect paste-like input
        // - Multi-char string (definitely paste - terminal sent chunk)
        // - Continuation of existing paste burst
        // For single chars, let them through immediately for responsive typing
        let shouldBuffer = false;

        // Multi-char non-escape = definitely paste
        if (str.length > 1 && !str.startsWith('\x1b')) {
          shouldBuffer = true;
        }
        // Continue buffering if we're already in a paste burst
        else if (inPasteBurst && str.length === 1 && (isPrintable(code) || isNewline(code))) {
          shouldBuffer = true;
        }

        if (shouldBuffer) {
          // Add to buffer (strip any toggle symbols that might have slipped through)
          const cleaned = self.stripToggleSymbols(str);
          if (!cleaned) return true; // Was only toggle chars
          self.emitPasteBuffer += cleaned;

          // Clear existing timer
          if (self.emitPasteTimer) {
            clearTimeout(self.emitPasteTimer);
          }

          // Set timer to commit after idle
          self.emitPasteTimer = setTimeout(() => {
            self.commitEmitPasteBuffer();
          }, self.emitPasteCommitMs);

          return true; // Suppress - we're buffering
        }
        // Single char when NOT in paste burst = normal typing, let through
        // Newline when not in burst = Enter key, let through

        // NOTE: Do NOT block other control characters here!
        // Backspace (8/127), Tab (9), Enter (13), arrows (27+seq) must pass through
        // for normal editing to work. Only Ctrl+C/D and toggles are intercepted above.
      }

      // Allow all other events to pass through
      return self.originalEmit!(event, ...args);
    };

    // Now set up readline's keypress emission
    readline.emitKeypressEvents(this.input, this.rl);
    if (this.input.isTTY) {
      this.input.setRawMode(true);
    }

    // Use bound handler so we can remove it on cleanup
    this.boundKeypressHandler = (str: string, key: readline.Key) => {
      if (!this.disposed) {
        this.handleKeypress(str, key);
      }
    };
    this.input.on('keypress', this.boundKeypressHandler);
  }

  /**
   * Detect toggle characters from raw input data before readline processing.
   * Returns the toggle letter (g, a, d, t, v) or null if not a toggle.
   */
  private detectToggleFromRawData(input: string): string | null {
    if (!input) return null;
    const code = input.charCodeAt(0);

    // Unicode characters from "Option sends Unicode" mode
    if (code === 169 || code === 8482) return 'g'; // © ™
    if (code === 229 || code === 197) return 'a';  // å Å
    if (code === 8706 || code === 8710 || code === 206) return 'd'; // ∂ ∆ Î
    if (code === 8224 || code === 8225) return 't'; // † ‡
    if (code === 8730) return 'v'; // √

    // ESC + letter from "Option sends Meta" mode
    if (code === 27 && input.length === 2) {
      const letter = input.charAt(1).toLowerCase();
      if (['g', 'a', 'd', 't', 'v'].includes(letter)) return letter;
    }

    return null;
  }

  /**
   * Extract all toggle letters from an arbitrary chunk of input data.
   * Handles both Unicode toggles and ESC-prefixed Meta sequences, and
   * supports multiple toggles in a single data event.
   */
  private extractToggleLetters(input: string): string[] {
    if (!input) return [];
    const toggles: string[] = [];
    const chars = [...input];

    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      const code = ch.charCodeAt(0);

      // Detect ESC + letter (Option sends Meta)
      if (code === 27 && i + 1 < chars.length) {
        const letter = chars[i + 1].toLowerCase();
        if (['g', 'a', 'd', 't', 'v'].includes(letter)) {
          toggles.push(letter);
          i++; // Skip the meta letter so it isn't double-counted
          continue;
        }
      }

      const detected = this.detectToggleFromRawData(ch);
      if (detected) {
        toggles.push(detected);
      }
    }

    return toggles;
  }

  /**
   * Remove toggle symbols (and their ESC prefixes) from a string so they
   * can never leak into the prompt buffer.
   */
  private stripToggleSymbols(input: string): string {
    if (!input) return '';
    const chars = [...input];
    let result = '';

    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      const code = ch.charCodeAt(0);

      // Drop Unicode toggle characters outright
      if (this.isToggleCharacter(ch)) {
        continue;
      }

      // Drop ESC + toggle letter (Option sends Meta)
      // Also handle case where ESC might be followed by [ (CSI sequence start)
      if (code === 27) {
        if (i + 1 < chars.length) {
          const letter = chars[i + 1].toLowerCase();
          if (['g', 'a', 'd', 't', 'v'].includes(letter)) {
            i++; // Skip the meta letter as well
            continue;
          }
          // Also drop ESC + '[' (CSI sequence start) to prevent partial escape sequences
          if (chars[i + 1] === '[') {
            i++; // Skip the '[' as well
            // Skip any digits, semicolons, and the final character
            while (i + 1 < chars.length && /[0-9;]/.test(chars[i + 1])) {
              i++;
            }
            if (i + 1 < chars.length) {
              i++; // Skip the final character (A-Z, a-z, ~, etc.)
            }
            continue;
          }
        }
      }

      result += ch;
    }

    return result;
  }

  /**
   * Check if a character is a toggle character that should never be inserted.
   * Used as a safety guard to prevent toggle symbols from appearing in input.
   */
  private isToggleCharacter(input: string): boolean {
    if (!input || input.length !== 1) return false;
    const code = input.charCodeAt(0);
    // Unicode toggle characters
    if (code === 169 || code === 8482) return true; // © ™ (Option+G)
    if (code === 229 || code === 197) return true;  // å Å (Option+A)
    if (code === 8706 || code === 8710 || code === 206) return true; // ∂ ∆ Î (Option+D)
    if (code === 8224 || code === 8225) return true; // † ‡ (Option+T)
    if (code === 8730) return true; // √ (Option+V)
    return false;
  }

  /**
   * Handle a detected toggle action. Called from both raw data interception
   * and keypress processing for reliability.
   */
  private handleToggle(letter: string): void {
    // Clear any pending insert buffer so the symbol never lands in the prompt
    this.pendingInsertBuffer = '';
    // Cancel any plain paste detection in progress
    this.cancelPlainPasteCapture();

    // Force immediate render for toggles - works during streaming
    const forceRender = () => {
      if (this.mode === 'streaming') {
        this.renderPromptImmediate();
      } else {
        this.renderPrompt();
      }
    };

    if (process.env['AGI_DEBUG_KEYS']) {
      console.error(`[KEY] TOGGLE HANDLING: ${letter}`);
    }

    switch (letter) {
      case 'a':
        this.emit('toggle-critical-approval');
        forceRender();
        break;
      case 'g':
        this.emit('toggle-auto-continue');
        forceRender();
        break;
      case 'd':
        this.emit('toggle-alphazero');
        forceRender();
        break;
      case 't':
        this.emit('toggle-thinking');
        forceRender();
        break;
      case 'v':
        // Option+V: Available for future toggle
        break;
    }
  }

  /**
   * Handle Ctrl+C detected at raw data level.
   * Bypasses readline's keypress parsing for reliability.
   */
  private handleCtrlC(): void {
    if (process.env['AGI_DEBUG_KEYS']) {
      console.error(`[KEY] HANDLING CTRL+C`);
    }

    // If we're in input capture mode, cancel it first
    if (this.inputCapture) {
      this.cancelInputCapture(new Error('Input capture cancelled'));
      this.clearBuffer();
      return;
    }

    // Ctrl+C behavior:
    // 1. If buffer has text: clear it first, then notify shell
    // 2. If buffer is empty: let shell decide to pause AI or quit
    const hadBuffer = this.buffer.length > 0;
    if (hadBuffer) {
      this.buffer = '';
      this.cursor = 0;
      this.inputRenderOffset = 0;
      this.resetSuggestions();
      this.renderPrompt();
      this.emitInputChange();
    }
    // Emit ctrlc event with buffer state so shell can handle appropriately
    this.emit('ctrlc', { hadBuffer });
  }

  /**
   * Handle Ctrl+D detected at raw data level.
   * Bypasses readline's keypress parsing for reliability.
   */
  private handleCtrlD(): void {
    if (process.env['AGI_DEBUG_KEYS']) {
      console.error(`[KEY] HANDLING CTRL+D`);
    }

    // If we're in input capture mode, cancel it first
    if (this.inputCapture) {
      this.cancelInputCapture(new Error('Input capture cancelled'));
      this.clearBuffer();
      return;
    }

    // Ctrl+D: interrupt if buffer is empty
    if (this.buffer.length === 0) {
      this.emit('interrupt');
    }
  }

  /**
   * Commit buffered emit-level input after idle period.
   * Decides whether to treat as paste (collapse) or normal typing (insert).
   */
  private commitEmitPasteBuffer(): void {
    const content = this.emitPasteBuffer;
    this.emitPasteBuffer = '';
    this.emitPasteTimer = null;

    if (!content) return;

    if (process.env['AGI_DEBUG_KEYS']) {
      console.error(`[KEY] COMMIT EMIT BUFFER: ${content.length} chars`);
    }

    // Sanitize content
    let sanitized = this.sanitizePasteContent(content);
    sanitized = sanitized.replace(/\r\n?/g, '\n');

    // Input protection validation
    if (this.inputProtection) {
      const validation = this.inputProtection.validateInput(sanitized, true);
      if (validation.blocked) {
        return;
      }
      sanitized = validation.sanitized;
    }

    if (!sanitized) return;

    const lines = sanitized.split('\n');
    const isMultiLine = lines.length > 1;
    const isLongContent = sanitized.length > 100; // Lower threshold for better UX

    // Multi-line or long content: show collapsed indicator
    if (isMultiLine || isLongContent) {
      // Combine with existing collapsed paste if any
      if (this.collapsedPaste) {
        sanitized = this.collapsedPaste.text + sanitized;
        const newLines = sanitized.split('\n');
        this.collapsedPaste = {
          text: sanitized,
          lines: newLines.length,
          chars: sanitized.length,
        };
      } else {
        // IMPORTANT: Include any buffer content that leaked before paste detection
        // This prevents fragmented prompts where part shows separately
        const existingBuffer = this.buffer.trim();
        if (existingBuffer) {
          sanitized = existingBuffer + sanitized;
          const combinedLines = sanitized.split('\n');
          this.collapsedPaste = {
            text: sanitized,
            lines: combinedLines.length,
            chars: sanitized.length,
          };
        } else {
          this.collapsedPaste = {
            text: sanitized,
            lines: lines.length,
            chars: sanitized.length,
          };
        }
        this.buffer = '';
        this.cursor = 0;
      }
      this.updateSuggestions();
      this.forceNextRender = true;
      this.renderPrompt();
      this.emitInputChange();
    } else {
      // Short single-line content: insert directly as if typed
      if (this.collapsedPaste) {
        this.expandCollapsedPasteToBuffer();
      }
      this.insertSingleLineText(sanitized);
    }
  }

  /**
   * Handle paste detected at emit level (multi-char data arriving at once).
   * This bypasses readline processing for reliable paste detection.
   */
  private handleEmitLevelPaste(content: string): void {
    if (process.env['AGI_DEBUG_KEYS']) {
      console.error(`[KEY] EMIT PASTE HANDLING: ${content.length} chars`);
    }

    // Sanitize content (remove control chars, normalize line endings)
    let sanitized = this.sanitizePasteContent(content);
    sanitized = sanitized.replace(/\r\n?/g, '\n');

    // Input protection validation
    if (this.inputProtection) {
      const validation = this.inputProtection.validateInput(sanitized, true);
      if (validation.blocked) {
        return;
      }
      sanitized = validation.sanitized;
    }

    if (!sanitized) return;

    const lines = sanitized.split('\n');
    const isMultiLine = lines.length > 1;
    const isLongContent = sanitized.length > 200;

    // Multi-line or long content: show collapsed indicator
    if (isMultiLine || isLongContent) {
      // Clear any existing collapsed paste first
      if (this.collapsedPaste) {
        this.expandCollapsedPasteToBuffer();
      }
      // IMPORTANT: Include any buffer content that leaked before paste detection
      const existingBuffer = this.buffer.trim();
      if (existingBuffer) {
        sanitized = existingBuffer + sanitized;
        const combinedLines = sanitized.split('\n');
        this.collapsedPaste = {
          text: sanitized,
          lines: combinedLines.length,
          chars: sanitized.length,
        };
      } else {
        this.collapsedPaste = {
          text: sanitized,
          lines: lines.length,
          chars: sanitized.length,
        };
      }
      this.buffer = '';
      this.cursor = 0;
      this.updateSuggestions();
      this.forceNextRender = true;
      this.renderPrompt();
      this.emitInputChange();
    } else {
      // Short single-line content: insert directly as if typed
      // If there's a collapsed paste, expand it first
      if (this.collapsedPaste) {
        this.expandCollapsedPasteToBuffer();
      }
      this.insertSingleLineText(sanitized);
    }
  }

  private emitInputChange(): void {
    const payload: InputChangeEvent = {
      text: this.buffer,
      cursor: this.cursor,
    };
    this.emit('change', payload);
  }

  private handleKeypress(str: string, key: readline.Key): void {
    // Skip processing if a raw-level toggle was already handled for this keypress
    if (this.pendingToggleSkips > 0) {
      this.pendingToggleSkips--;
      if (process.env['AGI_DEBUG_KEYS']) {
        console.error(`[KEY] SKIP KEYPRESS (pending toggle)`);
      }
      return;
    }

    // BLOCK: If Ctrl+C/D was intercepted at raw level, it's already handled
    if (this.interceptedCtrlC || this.interceptedCtrlD) {
      return; // Already handled in raw data handler
    }

    // BLOCK: If toggle was intercepted at raw level, it's already handled
    if (this.interceptedToggle) {
      this.interceptedToggle = null;
      return; // Already handled in raw data handler
    }

    // BLOCK: Check character code directly for special keys
    const code = str ? str.charCodeAt(0) : 0;
    if (code === 3) { // Ctrl+C
      this.handleCtrlC();
      return;
    }
    if (code === 4) { // Ctrl+D
      this.handleCtrlD();
      return;
    }

    // BLOCK: Check for toggle characters directly
    if (str && this.isToggleCharacter(str)) {
      this.handleToggle(this.detectToggleFromRawData(str)!);
      return;
    }

    // Debug: log entry parameters to understand what readline is sending
    if (process.env['AGI_DEBUG_KEYS']) {
      const keyInfo = key ? `name=${key.name} ctrl=${key.ctrl} meta=${key.meta} shift=${key.shift} seq=${key.sequence ? JSON.stringify(key.sequence) : 'null'}` : 'null';
      console.error(`[KEY] ENTRY: str=${str ? JSON.stringify(str) : 'null'} code=${code} key={${keyInfo}}`);
    }
    // Normalize missing key metadata (common for some terminals emitting raw escape codes)
    const normalizedKey = key ?? this.parseEscapeSequence(str);
    const keyForPaste = normalizedKey ?? (str ? { sequence: str } as readline.Key : key);

    // CRITICAL: Handle Ctrl+C and Ctrl+D FIRST - must ALWAYS work to quit/interrupt
    // This is checked before ANY other processing to ensure it can never be blocked
    if (normalizedKey?.ctrl && (normalizedKey.name === 'c' || normalizedKey.name === 'd')) {
      // If we're in input capture mode, cancel it first
      if (this.inputCapture) {
        this.cancelInputCapture(new Error('Input capture cancelled'));
        this.clearBuffer();
        return;
      }

      if (normalizedKey.name === 'c') {
        // Ctrl+C behavior:
        // 1. If buffer has text: clear it first, then notify shell
        // 2. If buffer is empty: let shell decide to pause AI or quit
        const hadBuffer = this.buffer.length > 0;
        if (hadBuffer) {
          this.buffer = '';
          this.cursor = 0;
          this.inputRenderOffset = 0;
          this.resetSuggestions();
          this.renderPrompt();
          this.emitInputChange();
        }
        // Emit ctrlc event with buffer state so shell can handle appropriately
        this.emit('ctrlc', { hadBuffer });
        return;
      }

      if (normalizedKey.name === 'd') {
        // Ctrl+D: interrupt if buffer is empty
        if (this.buffer.length === 0) {
          this.emit('interrupt');
        }
        return;
      }
    }

    // Handle macOS Option+key toggles BEFORE any paste detection
    // Check multiple sources: str, key.sequence, and key.meta+key.name
    // This is a fallback - primary detection happens in the raw 'data' event handler

    // Check str first
    let toggleLetter = this.detectToggleFromRawData(str);

    // Also check key.sequence if str didn't match (readline may transform the input)
    if (!toggleLetter && key?.sequence) {
      toggleLetter = this.detectToggleFromRawData(key.sequence);
      if (toggleLetter && process.env['AGI_DEBUG_KEYS']) {
        console.error(`[KEY] TOGGLE DETECTED via key.sequence: ${toggleLetter}`);
      }
    }

    if (toggleLetter) {
      if (process.env['AGI_DEBUG_KEYS']) {
        console.error(`[KEY] TOGGLE DETECTED (keypress fallback): ${toggleLetter}`);
      }
      this.handleToggle(toggleLetter);
      return;
    }

    // Also check meta+key pattern if str/sequence didn't match
    if (normalizedKey?.meta && normalizedKey.name) {
      const metaLetter = normalizedKey.name.toLowerCase();
      if (['g', 'a', 'd', 't', 'v'].includes(metaLetter)) {
        if (process.env['AGI_DEBUG_KEYS']) {
          console.error(`[KEY] TOGGLE DETECTED (meta key): ${metaLetter}`);
        }
        this.handleToggle(metaLetter);
        return;
      }
    }

    if (this.handleBracketedPaste(str, keyForPaste)) {
      return;
    }

    if (this.handlePlainPaste(str, keyForPaste)) {
      return;
    }

    if (!normalizedKey) {
      return;
    }

    // inputCapture Ctrl+C/D is handled at the top of handleKeypress

    // Detect Ctrl+Shift combinations (fallback for non-macOS or configured terminals)
    const isCtrlShift = (letter: string): boolean => {
      const lowerLetter = letter.toLowerCase();
      const upperLetter = letter.toUpperCase();

      // Pattern 1: Standard readline shift flag + ctrl
      if (normalizedKey.ctrl && normalizedKey.shift && normalizedKey.name?.toLowerCase() === lowerLetter) {
        return true;
      }

      // Pattern 2: Some terminals send uppercase name with ctrl
      if (normalizedKey.ctrl && normalizedKey.name === upperLetter) {
        return true;
      }

      // Pattern 3: Meta/Alt + letter (iTerm2 with "Option sends Meta")
      if (normalizedKey.meta && normalizedKey.name?.toLowerCase() === lowerLetter) {
        return true;
      }

      // Pattern 4: Raw escape sequence check for xterm-style modifiers
      const seq = str || normalizedKey.sequence;
      // eslint-disable-next-line no-control-regex
      if (seq && /^\x1b\[[0-9]+;6[~A-Z]?$/.test(seq)) {
        return true;
      }

      // Pattern 5: ESC + letter (Option sends ESC prefix in some configs)
      if (seq && seq === `\x1b${lowerLetter}`) {
        return true;
      }

      return false;
    };

    const handleCtrlShiftToggle = (letter: 'a' | 'g' | 'd' | 't'): void => {
      // Ensure no buffered chars leak into the prompt
      this.pendingInsertBuffer = '';
      if (letter === 'a') {
        this.emit('toggle-critical-approval');
      } else if (letter === 'g') {
        this.emit('toggle-auto-continue');
      } else if (letter === 'd') {
        this.emit('toggle-alphazero');
      } else if (letter === 't') {
        this.emit('toggle-thinking');
      }
      // Force immediate render during streaming to ensure toggle state is visible
      if (this.mode === 'streaming') {
        this.renderPromptImmediate();
      } else {
        this.renderPrompt();
      }
    };

    if (isCtrlShift('a')) {
      handleCtrlShiftToggle('a');
      return;
    }

    if (isCtrlShift('g')) {
      handleCtrlShiftToggle('g');
      return;
    }

    if (isCtrlShift('d')) {
      handleCtrlShiftToggle('d');
      return;
    }

    if (isCtrlShift('t')) {
      handleCtrlShiftToggle('t');
      return;
    }

    if (normalizedKey.ctrl && normalizedKey.name?.toLowerCase() === 'r') {
      this.emit('resume');
      return;
    }

    // Ctrl+C and Ctrl+D are handled at the top of handleKeypress for guaranteed execution

    if (key.ctrl && key.name === 'u') {
      this.clearBuffer();
      return;
    }

    // Ctrl+L: Clear screen while preserving input
    if (key.ctrl && key.name === 'l') {
      if (this.collapsedPaste) {
        this.expandCollapsedPasteToBuffer();
        return;
      }
      // Clear screen and redraw
      this.output.write('\x1b[2J\x1b[H'); // Clear screen, move to top
      this.hasConversationContent = false;
      this.clearCollapsedResults();
      this.renderPrompt();
      return;
    }

    // Ctrl+O: Expand last tool result
    if (key.ctrl && key.name === 'o') {
      this.emit('expand-tool-result');
      return;
    }

    // Ctrl+A: Move cursor to start of line
    if (key.ctrl && key.name === 'a') {
      if (this.cursor !== 0) {
        this.cursor = 0;
        this.inputRenderOffset = 0;
        this.renderPrompt();
        this.emitInputChange();
      }
      return;
    }

    // Ctrl+E: Move cursor to end of line
    if (key.ctrl && key.name === 'e') {
      if (this.cursor !== this.buffer.length) {
        this.cursor = this.buffer.length;
        this.ensureCursorVisible();
        this.renderPrompt();
        this.emitInputChange();
      }
      return;
    }

    // Ctrl+W: Delete word backward
    if (key.ctrl && key.name === 'w') {
      if (this.cursor > 0) {
        // Find start of previous word
        let pos = this.cursor;
        // Skip trailing spaces
        while (pos > 0 && this.buffer[pos - 1] === ' ') pos--;
        // Skip word characters
        while (pos > 0 && this.buffer[pos - 1] !== ' ') pos--;
        this.buffer = this.buffer.slice(0, pos) + this.buffer.slice(this.cursor);
        this.cursor = pos;
        this.updateSuggestions();
        this.renderPrompt();
        this.emitInputChange();
      }
      return;
    }

    // Ctrl+K: Delete from cursor to end of line
    if (key.ctrl && key.name === 'k') {
      if (this.cursor < this.buffer.length) {
        this.buffer = this.buffer.slice(0, this.cursor);
        this.updateSuggestions();
        this.renderPrompt();
        this.emitInputChange();
      }
      return;
    }

    // Home: Move cursor to start
    if (key.name === 'home') {
      if (this.cursor !== 0) {
        this.cursor = 0;
        this.inputRenderOffset = 0;
        this.renderPrompt();
        this.emitInputChange();
      }
      return;
    }

    // End: Move cursor to end
    if (key.name === 'end') {
      if (this.cursor !== this.buffer.length) {
        this.cursor = this.buffer.length;
        this.ensureCursorVisible();
        this.renderPrompt();
        this.emitInputChange();
      }
      return;
    }

    // Alt+Left: Move cursor back one word
    if (key.meta && key.name === 'left') {
      if (this.cursor > 0) {
        let pos = this.cursor;
        // Skip spaces
        while (pos > 0 && this.buffer[pos - 1] === ' ') pos--;
        // Skip word characters
        while (pos > 0 && this.buffer[pos - 1] !== ' ') pos--;
        this.cursor = pos;
        this.ensureCursorVisible();
        this.renderPrompt();
        this.emitInputChange();
      }
      return;
    }

    // Alt+Right: Move cursor forward one word
    if (key.meta && key.name === 'right') {
      if (this.cursor < this.buffer.length) {
        let pos = this.cursor;
        // Skip current word
        while (pos < this.buffer.length && this.buffer[pos] !== ' ') pos++;
        // Skip spaces
        while (pos < this.buffer.length && this.buffer[pos] === ' ') pos++;
        this.cursor = pos;
        this.ensureCursorVisible();
        this.renderPrompt();
        this.emitInputChange();
      }
      return;
    }

    // Alt+Backspace: Delete word backward (alternative to Ctrl+W)
    if (key.meta && key.name === 'backspace') {
      if (this.collapsedPaste) {
        // If there's a collapsed paste, delete it completely
        this.collapsedPaste = null;
        this.renderPrompt();
        this.emitInputChange();
        return;
      }
      if (this.cursor > 0) {
        let pos = this.cursor;
        while (pos > 0 && this.buffer[pos - 1] === ' ') pos--;
        while (pos > 0 && this.buffer[pos - 1] !== ' ') pos--;
        this.buffer = this.buffer.slice(0, pos) + this.buffer.slice(this.cursor);
        this.cursor = pos;
        this.updateSuggestions();
        this.renderPrompt();
        this.emitInputChange();
      }
      return;
    }

    if (key.name === 'return' || key.name === 'enter') {
      // Check for slash command completion first (works in both streaming and non-streaming modes)
      if (this.applySuggestion(true)) return;
      
      // Fallback: if buffer starts with '/' and suggestions exist, use the selected/first one
      if (this.buffer.startsWith('/') && this.suggestions.length > 0) {
        const safeIndex = this.suggestionIndex >= 0 && this.suggestionIndex < this.suggestions.length
          ? this.suggestionIndex
          : 0;
        this.buffer = this.suggestions[safeIndex]?.command ?? this.buffer;
      }
      
      // During streaming, queue the input for processing after AI completes
      if (this.mode === 'streaming') {
        const queuedInput = this.streamingInputQueue.join('').trim();
        if (queuedInput) {
          this.emit('queue', queuedInput);
          this.streamingInputQueue = [];
        }
        // Also submit current buffer if it has content
        if (this.buffer.trim()) {
          this.submitText(this.buffer);
        }
        return;
      }
      
      // If there's a collapsed paste, expand and submit in one action
      if (this.collapsedPaste) {
        this.expandCollapsedPasteToBuffer();
        return;
      }
      
      this.submitText(this.buffer);
      return;
    }

    if (normalizedKey.name === 'backspace') {
      // Reset any paste detection state to ensure clean render
      this.resetPlainPasteBurst();
      this.cancelPlainPasteCapture();
      if (this.collapsedPaste) {
        this.collapsedPaste = null;
        this.forceNextRender = true;
        this.renderPrompt();
        this.emitInputChange();
        return;
      }
      if (this.cursor > 0) {
        this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor);
        this.cursor--;
        this.updateSuggestions();
        this.forceNextRender = true;
        this.renderPrompt();
        this.emitInputChange();
      }
      return;
    }

    if (normalizedKey.name === 'delete') {
      // Reset any paste detection state to ensure clean render
      this.resetPlainPasteBurst();
      this.cancelPlainPasteCapture();
      if (this.collapsedPaste) {
        // If there's a collapsed paste, delete it completely (similar to backspace)
        this.collapsedPaste = null;
        this.forceNextRender = true;
        this.renderPrompt();
        this.emitInputChange();
        return;
      }
      if (this.cursor < this.buffer.length) {
        this.buffer = this.buffer.slice(0, this.cursor) + this.buffer.slice(this.cursor + 1);
        this.updateSuggestions();
        this.forceNextRender = true;
        this.renderPrompt();
        this.emitInputChange();
      }
      return;
    }

    // Menu navigation (Claude Code style) - intercepts keys when menu is active
    if (this.isMenuActive()) {
      if (normalizedKey.name === 'up') {
        this.navigateMenu(-1);
        return;
      }
      if (normalizedKey.name === 'down') {
        this.navigateMenu(1);
        return;
      }
      if (normalizedKey.name === 'return') {
        this.selectMenuItem();
        return;
      }
      if (normalizedKey.name === 'escape') {
        this.closeMenu();
        return;
      }
      // Other keys close menu without selection
      if (str && !normalizedKey.ctrl && !normalizedKey.meta) {
        this.closeMenu();
        // Don't return - let the key be processed normally
      }
    }

    if (normalizedKey.name === 'left') {
      // Reset paste state to ensure clean render
      this.resetPlainPasteBurst();
      // If there's a collapsed paste, expand it first
      if (this.collapsedPaste) {
        this.expandCollapsedPasteToBuffer();
      }
      if (this.cursor > 0) {
        this.cursor--;
        this.ensureCursorVisible();
        this.forceNextRender = true;
        this.renderPrompt();
        this.emitInputChange();
      }
      return;
    }

    if (normalizedKey.name === 'right') {
      // Reset paste state to ensure clean render
      this.resetPlainPasteBurst();
      // If there's a collapsed paste, expand it first
      if (this.collapsedPaste) {
        this.expandCollapsedPasteToBuffer();
      }
      if (this.cursor < this.buffer.length) {
        this.cursor++;
        this.ensureCursorVisible();
        this.forceNextRender = true;
        this.renderPrompt();
        this.emitInputChange();
      }
      return;
    }

    if (normalizedKey.name === 'up') {
      if (this.navigateSuggestions(-1)) {
        return;
      }
      if (this.history.length > 0) {
        if (this.historyIndex === -1) {
          this.historyIndex = this.history.length - 1;
        } else if (this.historyIndex > 0) {
          this.historyIndex--;
        }
        // Validate index is within bounds before accessing
        if (this.historyIndex >= 0 && this.historyIndex < this.history.length) {
          this.buffer = this.history[this.historyIndex] ?? '';
        } else {
          this.historyIndex = -1;
          this.buffer = '';
        }
        this.cursor = this.buffer.length;
        this.inputRenderOffset = 0; // Reset render offset for new buffer
        this.updateSuggestions();
        this.renderPrompt();
        this.emitInputChange();
      }
      return;
    }

    if (normalizedKey.name === 'down') {
      if (this.navigateSuggestions(1)) {
        return;
      }
      if (this.historyIndex !== -1) {
        this.historyIndex++;
        if (this.historyIndex >= this.history.length) {
          this.historyIndex = -1;
          this.buffer = '';
        } else if (this.historyIndex >= 0) {
          this.buffer = this.history[this.historyIndex] ?? '';
        } else {
          // Safety: invalid state, reset
          this.historyIndex = -1;
          this.buffer = '';
        }
        this.cursor = this.buffer.length;
        this.inputRenderOffset = 0; // Reset render offset for new buffer
        this.updateSuggestions();
        this.renderPrompt();
        this.emitInputChange();
      }
      return;
    }

    if (normalizedKey.name === 'tab') {
      if (this.applySuggestion(false)) return;
      return;
    }

    if (str && !normalizedKey.ctrl && !normalizedKey.meta) {
      // SAFETY: Final guard to prevent toggle characters from ever being inserted
      // This should never trigger if earlier detection works, but acts as a safety net
      if (this.isToggleCharacter(str)) {
        if (process.env['AGI_DEBUG_KEYS']) {
          console.error(`[KEY] BLOCKED toggle character from insertion: "${str}" code=${str.charCodeAt(0)}`);
        }
        return;
      }

      // Queue text input during streaming - process after AI completes
      if (this.mode === 'streaming') {
        this.streamingInputQueue.push(str);
        return;
      }
      // Debug: trace why toggle didn't catch this character
      if (process.env['AGI_DEBUG_KEYS']) {
        const code = str.charCodeAt(0);
        console.error(`[KEY] QUEUE INSERT: str="${str}" code=${code}`);
      }
      // Defer insertion to allow paste detection window to catch rapid input
      this.queuePendingInsert(str);
    }
  }

  /**
   * Ensure horizontal cursor position stays within the visible input window.
   * Prevents jumps when using left/right arrows on long lines.
   */
  private ensureCursorVisible(): void {
    const maxWidth = Math.max(10, this.safeWidth() - 12); // margin for prompt/toggles and padding
    // If cursor is left of current window, shift window left
    if (this.cursor < this.inputRenderOffset) {
      this.inputRenderOffset = this.cursor;
      return;
    }
    // If cursor is beyond visible window, shift window right
    if (this.cursor - this.inputRenderOffset >= maxWidth) {
      this.inputRenderOffset = this.cursor - maxWidth + 1;
    }
  }

  /**
   * Parse raw escape sequences when readline doesn't populate key metadata.
   * Prevents control codes (e.g., ^[[200~) from leaking into the buffer.
   */
  private parseEscapeSequence(sequence: string | null | undefined): readline.Key | null {
    if (!sequence) return null;
    const map: Record<string, readline.Key> = {
      '\x1b[A': { name: 'up', sequence } as readline.Key,
      '\x1b[B': { name: 'down', sequence } as readline.Key,
      '\x1b[C': { name: 'right', sequence } as readline.Key,
      '\x1b[D': { name: 'left', sequence } as readline.Key,
      '\x1b[H': { name: 'home', sequence } as readline.Key,
      '\x1b[F': { name: 'end', sequence } as readline.Key,
      '\x1b[200~': { name: 'paste-start', sequence } as readline.Key,
      '\x1b[201~': { name: 'paste-end', sequence } as readline.Key,
    };
    return map[sequence] ?? null;
  }

  /**
   * Queue characters for deferred insertion. This prevents visual "leak" of
   * pasted content by holding characters until we're confident it's not a paste.
   */
  private queuePendingInsert(text: string): void {
    // If toggle characters slipped through, handle them here and strip them before insertion
    const toggles = this.extractToggleLetters(text);
    if (toggles.length > 0) {
      for (const letter of toggles) {
        this.handleToggle(letter);
      }
      text = this.stripToggleSymbols(text);
      if (!text) {
        if (process.env['AGI_DEBUG_KEYS']) {
          console.error('[KEY] QUEUE INSERT DROPPED: toggle-only input');
        }
        return;
      }
    }

    // Fast-path: single printable ASCII character with no pending buffer = immediate insert
    // This makes normal typing feel instant while still detecting multi-char pastes
    // BUT: skip fast path if burst activity suggests incoming paste
    const now = Date.now();
    const burstActive = this.pasteBurstWindowStart > 0 && now - this.pasteBurstWindowStart <= this.plainPasteWindowMs;
    if (text.length === 1 &&
        this.pendingInsertBuffer === '' &&
        !this.inPlainPaste &&
        !this.inBracketedPaste &&
        !burstActive &&
        text.charCodeAt(0) >= 32 &&
        text.charCodeAt(0) < 127) {
      this.insertText(text);
      return;
    }

    this.pendingInsertBuffer += text;

    // Clear any existing timer
    if (this.pendingInsertTimer) {
      clearTimeout(this.pendingInsertTimer);
      this.pendingInsertTimer = null;
    }

    // Schedule commit after delay - if paste detection triggers first, it will consume the buffer
    this.pendingInsertTimer = setTimeout(() => {
      this.commitPendingInsert();
    }, this.pendingInsertDelayMs);
  }

  /**
   * Commit pending characters as normal input (not a paste).
   * If we reach here, paste detection didn't trigger, so this is normal typing.
   */
  private commitPendingInsert(): void {
    if (this.pendingInsertTimer) {
      clearTimeout(this.pendingInsertTimer);
      this.pendingInsertTimer = null;
    }

    if (this.pendingInsertBuffer && !this.inPlainPaste && !this.inBracketedPaste) {
      // Reset burst state BEFORE inserting so render isn't suppressed
      // If paste detection didn't trigger, this is just fast typing, not a paste
      this.resetPlainPasteBurst();
      this.plainRecentChunks = [];
      this.insertText(this.pendingInsertBuffer);
    }
    this.pendingInsertBuffer = '';
  }

  /**
   * Consume pending insert buffer into paste detection (prevents visual leak).
   */
  private consumePendingInsertForPaste(): string {
    if (this.pendingInsertTimer) {
      clearTimeout(this.pendingInsertTimer);
      this.pendingInsertTimer = null;
    }
    const consumed = this.pendingInsertBuffer;
    this.pendingInsertBuffer = '';
    return consumed;
  }

  private handleBracketedPaste(str: string, key: readline.Key): boolean {
    const sequence = key?.sequence || str;
    if (sequence === ESC.ENABLE_BRACKETED_PASTE || sequence === ESC.DISABLE_BRACKETED_PASTE) {
      return true;
    }

    // Handle case where paste markers might be embedded in the string
    const pasteStartMarker = '\x1b[200~';
    const pasteEndMarker = '\x1b[201~';

    // Check if str contains paste start marker (handles chunked arrival)
    if (typeof str === 'string' && str.includes(pasteStartMarker)) {
      this.inBracketedPaste = true;
      this.pasteBufferOverflow = false;
      // Consume and sanitize pending buffer to prevent partial escape sequences leaking
      const pending = this.sanitizePasteContent(this.consumePendingInsertForPaste());
      // Extract content after the start marker (discard any content before it - likely partial escapes)
      const startIdx = str.indexOf(pasteStartMarker);
      let content = str.slice(startIdx + pasteStartMarker.length);
      // Check if end marker is also in this chunk
      if (content.includes(pasteEndMarker)) {
        const endIdx = content.indexOf(pasteEndMarker);
        content = content.slice(0, endIdx);
        this.pasteBuffer = pending + content;
        this.commitPasteBuffer();
        return true;
      }
      this.pasteBuffer = pending + content;
      this.cancelPlainPasteCapture();
      return true;
    }

    if (sequence === pasteStartMarker) {
      this.inBracketedPaste = true;
      this.pasteBufferOverflow = false; // Reset overflow flag for new paste
      // Consume and sanitize any pending insert buffer to prevent partial escapes leaking
      const pending = this.sanitizePasteContent(this.consumePendingInsertForPaste());
      this.pasteBuffer = pending;
      this.cancelPlainPasteCapture();
      return true;
    }
    if (!this.inBracketedPaste) {
      return false;
    }

    // Check if str contains paste end marker
    if (typeof str === 'string' && str.includes(pasteEndMarker)) {
      const endIdx = str.indexOf(pasteEndMarker);
      const contentBefore = str.slice(0, endIdx);
      if (contentBefore) {
        this.appendToPasteBuffer('paste', contentBefore);
      }
      this.commitPasteBuffer();
      return true;
    }

    if (sequence === pasteEndMarker) {
      this.commitPasteBuffer();
      return true;
    }
    if (key?.name === 'return' || key?.name === 'enter') {
      this.appendToPasteBuffer('paste', '\n');
      return true;
    }
    if (key?.name === 'backspace') {
      this.pasteBuffer = this.pasteBuffer.slice(0, -1);
      return true;
    }
    if (typeof str === 'string' && str.length > 0) {
      this.appendToPasteBuffer('paste', str);
      return true;
    }
    if (typeof sequence === 'string' && sequence.length > 0) {
      this.appendToPasteBuffer('paste', sequence);
      return true;
    }
    return true;
  }

  private commitPasteBuffer(): void {
    if (!this.inBracketedPaste) return;
    // Sanitize to remove any injected escape sequences, then normalize line endings
    let sanitized = this.sanitizePasteContent(this.pasteBuffer);

    // Input protection validation against remote paste attacks
    if (this.inputProtection) {
      const validation = this.inputProtection.validateInput(sanitized, true);
      if (validation.blocked) {
        // Paste blocked - reset state and abort
        this.inBracketedPaste = false;
        this.pasteBuffer = '';
        this.pasteBufferOverflow = false;
        return;
      }
      sanitized = validation.sanitized;
    }

    let content = sanitized.replace(/\r\n?/g, '\n');
    if (content) {
      const lines = content.split('\n');
      const wasTruncated = this.pasteBufferOverflow;
      if (lines.length > 1 || content.length > 200) {
        // IMPORTANT: Include any buffer content that leaked before paste detection
        const existingBuffer = this.buffer.trim();
        if (existingBuffer) {
          content = existingBuffer + content;
          const combinedLines = content.split('\n');
          this.collapsedPaste = {
            text: content,
            lines: combinedLines.length,
            chars: content.length + (wasTruncated ? '+' as unknown as number : 0),
          };
        } else {
          this.collapsedPaste = {
            text: content,
            lines: lines.length,
            chars: content.length + (wasTruncated ? '+' as unknown as number : 0), // Indicate truncation
          };
        }
        this.buffer = '';
        this.cursor = 0;
        this.updateSuggestions();
        this.renderPrompt();
        this.emitInputChange();
      } else {
        this.insertText(content);
      }
    }
    this.inBracketedPaste = false;
    this.pasteBuffer = '';
    this.pasteBufferOverflow = false;
    this.cancelPlainPasteCapture();
  }

  private handlePlainPaste(str: string, key: readline.Key): boolean {
    // Fallback paste capture when bracketed paste isn't supported
    if (this.inBracketedPaste || key?.ctrl || key?.meta) {
      this.resetPlainPasteBurst();
      this.pruneRecentPlainChunks();
      return false;
    }

    // Don't treat escape sequences (arrow keys, etc.) as paste
    // Escape sequences start with \x1b (ESC) and are used for cursor movement, etc.
    if (typeof str === 'string' && str.startsWith('\x1b')) {
      this.resetPlainPasteBurst();
      this.pruneRecentPlainChunks();
      return false;
    }

    const sequence = key?.sequence ?? '';
    const chunk = typeof str === 'string' && str.length > 0 ? str : sequence;
    if (!chunk) {
      this.resetPlainPasteBurst();
      this.pruneRecentPlainChunks();
      return false;
    }

    const now = Date.now();
    this.trackPlainPasteBurst(chunk.length, now);

    if (!this.inPlainPaste) {
      this.recordRecentPlainChunk(chunk, now);
    }

    const chunkMultiple = chunk.length > 1;
    const hasNewline = /[\r\n]/.test(chunk);
    const burstActive = this.pasteBurstWindowStart > 0 && now - this.pasteBurstWindowStart <= this.plainPasteWindowMs;
    const burstTrigger = burstActive && this.pasteBurstCharCount >= this.plainPasteTriggerChars;
    const hasRecentNonNewline = this.plainRecentChunks.some(entry => !/^[\r\n]+$/.test(entry.text));
    const earlyNewlineTrigger =
      hasNewline &&
      burstActive &&
      hasRecentNonNewline &&
      this.pasteBurstCharCount >= this.plainPasteEarlyNewlineChars;
    const newlineTrigger = hasNewline && (this.inPlainPaste || chunkMultiple || burstTrigger || earlyNewlineTrigger);
    const looksLikePaste = this.inPlainPaste || chunkMultiple || burstTrigger || newlineTrigger;

    if (!looksLikePaste) {
      this.pruneRecentPlainChunks();
      return false;
    }

    let chunkAlreadyCaptured = false;
    if (!this.inPlainPaste) {
      this.inPlainPaste = true;
      this.pasteBufferOverflow = false; // Reset overflow flag for new paste
      // Consume pending insert buffer first - this is the primary source now
      const pending = this.consumePendingInsertForPaste();
      const reclaimed = this.reclaimRecentPlainChunks();
      // Combine pending buffer with any reclaimed chunks
      const combined = pending + reclaimed;
      if (combined.length > 0) {
        // Remove any chars that leaked into buffer (legacy reclaim path)
        if (reclaimed.length > 0) {
          const removeCount = Math.min(this.buffer.length, reclaimed.length);
          const suffix = this.buffer.slice(-removeCount);
          if (removeCount > 0 && suffix === reclaimed.slice(-removeCount)) {
            this.buffer = this.buffer.slice(0, this.buffer.length - removeCount);
            this.cursor = Math.max(0, this.buffer.length);
            this.clampCursor(); // Ensure cursor is valid
          }
        }
        this.plainPasteBuffer = combined.slice(0, this.maxPasteBufferSize);
        if (combined.length > this.maxPasteBufferSize) {
          this.pasteBufferOverflow = true;
        }
        chunkAlreadyCaptured = combined.endsWith(chunk);
      } else {
        this.plainPasteBuffer = '';
      }
    }

    if (!chunkAlreadyCaptured) {
      this.appendToPasteBuffer('plainPaste', chunk);
    }
    this.schedulePlainPasteCommit();
    return true;
  }

  private trackPlainPasteBurst(length: number, now: number): void {
    if (!this.pasteBurstWindowStart || now - this.pasteBurstWindowStart > this.plainPasteWindowMs) {
      this.pasteBurstWindowStart = now;
      this.pasteBurstCharCount = 0;
    }
    this.pasteBurstCharCount += length;
  }

  private resetPlainPasteBurst(): void {
    this.pasteBurstWindowStart = 0;
    this.pasteBurstCharCount = 0;
  }

  private cancelPlainPasteCapture(): void {
    if (this.plainPasteTimer) {
      clearTimeout(this.plainPasteTimer);
      this.plainPasteTimer = null;
    }
    // Also cancel pending insert buffer
    if (this.pendingInsertTimer) {
      clearTimeout(this.pendingInsertTimer);
      this.pendingInsertTimer = null;
    }
    this.pendingInsertBuffer = '';
    this.inPlainPaste = false;
    this.plainPasteBuffer = '';
    this.plainRecentChunks = [];
    this.resetPlainPasteBurst();
  }

  private recordRecentPlainChunk(text: string, at: number): void {
    const windowStart = at - this.plainPasteWindowMs;
    this.plainRecentChunks.push({ text, at });
    this.plainRecentChunks = this.plainRecentChunks.filter(entry => entry.at >= windowStart);
  }

  private pruneRecentPlainChunks(): void {
    if (!this.plainRecentChunks.length) return;
    const now = Date.now();
    const windowStart = now - this.plainPasteWindowMs;
    this.plainRecentChunks = this.plainRecentChunks.filter(entry => entry.at >= windowStart);
  }

  private reclaimRecentPlainChunks(): string {
    if (!this.plainRecentChunks.length) return '';
    const combined = this.plainRecentChunks.map(entry => entry.text).join('');
    this.plainRecentChunks = [];
    return combined;
  }

  private schedulePlainPasteCommit(): void {
    if (this.plainPasteTimer) {
      clearTimeout(this.plainPasteTimer);
    }
    this.plainPasteTimer = setTimeout(() => {
      this.finalizePlainPaste();
    }, this.plainPasteIdleMs);
  }

  private finalizePlainPaste(): void {
    if (!this.inPlainPaste) return;

    // Sanitize to remove any injected escape sequences, then normalize line endings
    let sanitized = this.sanitizePasteContent(this.plainPasteBuffer);

    // Input protection validation against remote paste attacks
    if (this.inputProtection) {
      const validation = this.inputProtection.validateInput(sanitized, true);
      if (validation.blocked) {
        // Paste blocked - reset state and abort
        this.inPlainPaste = false;
        this.plainPasteBuffer = '';
        this.plainRecentChunks = [];
        this.resetPlainPasteBurst();
        this.pasteBufferOverflow = false;
        return;
      }
      sanitized = validation.sanitized;
    }

    const content = sanitized.replace(/\r\n?/g, '\n');
    const wasTruncated = this.pasteBufferOverflow;
    this.inPlainPaste = false;
    this.plainPasteBuffer = '';
    this.plainRecentChunks = [];
    this.resetPlainPasteBurst();
    this.pasteBufferOverflow = false;
    if (this.plainPasteTimer) {
      clearTimeout(this.plainPasteTimer);
      this.plainPasteTimer = null;
    }

    if (!content) return;
    const lines = content.split('\n');
    if (lines.length > 1 || content.length > 200) {
      // IMPORTANT: Include any buffer content that leaked before paste detection
      const existingBuffer = this.buffer.trim();
      let finalContent = content;
      if (existingBuffer) {
        finalContent = existingBuffer + content;
        const combinedLines = finalContent.split('\n');
        this.collapsedPaste = {
          text: finalContent,
          lines: combinedLines.length,
          chars: finalContent.length + (wasTruncated ? '+' as unknown as number : 0),
        };
      } else {
        this.collapsedPaste = {
          text: content,
          lines: lines.length,
          chars: content.length + (wasTruncated ? '+' as unknown as number : 0),
        };
      }
      this.buffer = '';
      this.cursor = 0;
      this.updateSuggestions();
      this.renderPrompt();
      this.emitInputChange();
      return;
    }

    this.insertText(content);
  }

  private insertText(text: string): void {
    if (!text) return;

    // SAFETY NET: Filter out any toggle or control characters that slipped through
    // This should never happen if earlier detection works, but acts as final guard
    const filtered = [...text].filter(c => {
      const code = c.charCodeAt(0);
      // Block ALL control characters (0-31) and DEL (127)
      // This includes Ctrl+C (3), Ctrl+D (4), ESC (27), etc.
      if (code < 32 || code === 127) return false;
      // Block toggle characters (Option+G/A/D/T/V Unicode)
      if (this.isToggleCharacter(c)) return false;
      return true;
    }).join('');

    if (!filtered) {
      if (process.env['AGI_DEBUG_KEYS']) {
        console.error(`[KEY] INSERT TEXT BLOCKED: all chars filtered from "${text}"`);
      }
      return;
    }
    text = filtered;

    // Debug: trace what's being inserted
    if (process.env['AGI_DEBUG_KEYS']) {
      const code = text.charCodeAt(0);
      console.error(`[KEY] INSERT TEXT: "${text}" code=${code}`);
    }

    // Don't insert during paste operations - content goes to paste buffer
    if (this.inBracketedPaste || this.inPlainPaste) {
      return;
    }

    // Input protection validation against remote attacks
    if (this.inputProtection) {
      const validation = this.inputProtection.validateInput(text, false);
      if (validation.blocked) {
        // Input blocked - silently drop to prevent attack
        return;
      }
      if (validation.sanitized !== text) {
        // Use sanitized version
        text = validation.sanitized;
        if (!text) return;
      }
    }
    // If there's a collapsed paste and user types, expand to buffer first then insert at cursor
    if (this.collapsedPaste) {
      this.expandCollapsedPasteToBuffer();
    }
    // Sanitize input to remove special formatting characters
    const sanitized = this.sanitizePasteContent(text);
    if (!sanitized) return;
    
    // Handle multi-line text by collapsing to single line for normal input
    const hasNewlines = sanitized.includes('\n');
    if (hasNewlines) {
      // For multi-line text in normal insertion, collapse to single line with spaces
      const collapsed = sanitized.replace(/\r\n|\r|\n/g, ' ');
      this.insertSingleLineText(collapsed);
    } else {
      this.insertSingleLineText(sanitized);
    }
  }

  private insertSingleLineText(text: string): void {
    if (!text) return;
    // Ensure cursor is valid before slicing
    this.clampCursor();
    this.buffer = this.buffer.slice(0, this.cursor) + text + this.buffer.slice(this.cursor);
    this.cursor += text.length;
    this.clampCursor(); // Ensure cursor remains valid after modification
    this.updateSuggestions();
    // Suppress render during paste detection to prevent visual leak
    const inEmitPaste = this.emitPasteBuffer.length > 0 || this.emitPasteTimer !== null;
    if (!this.inPlainPaste && !this.inBracketedPaste && !inEmitPaste) {
      this.renderPrompt();
    }
    this.emitInputChange();
  }

  private submitText(text: string): void {
    const isBufferSource = text === this.buffer;

    // If there's a collapsed paste, submit that instead of the buffer text
    // This handles edge cases where submitText is called programmatically
    if (this.collapsedPaste) {
      this.expandCollapsedPaste();
      return;
    }

    // Ensure any deferred input has been committed before submission
    this.commitPendingInsert();
    if (isBufferSource) {
      text = this.buffer;
    }

    if (this.inputCapture) {
      const shouldTrim = this.inputCapture.options.trim;
      const normalizedCapture = shouldTrim ? text.trim() : text;
      if (!this.inputCapture.options.allowEmpty && !normalizedCapture) {
        this.renderPrompt();
        return;
      }
      const resolver = this.inputCapture;
      this.inputCapture = null;
      this.buffer = '';
      this.cursor = 0;
      this.inputRenderOffset = 0;
      this.resetSuggestions();
      this.renderPrompt();
      this.emitInputChange();
      resolver.resolve(normalizedCapture);
      return;
    }

    let normalized = text.trim();
    if (!normalized) {
      this.renderPrompt();
      return;
    }

    // Final prompt validation before submission to AI
    if (this.inputProtection) {
      const validation = this.inputProtection.validatePromptSubmission(normalized);
      if (validation.blocked) {
        // Prompt blocked - don't submit
        this.buffer = '';
        this.cursor = 0;
        this.renderPrompt();
        return;
      }
      normalized = validation.sanitized;
    }

    // Don't add secrets or slash commands to history/scrollback
    if (!this.secretMode && !normalized.startsWith('/')) {
      this.history.push(normalized);
      this.historyIndex = -1;
      this.displayUserPrompt(normalized);
    } else if (!this.secretMode) {
      // Still track slash commands in history for convenience
      this.history.push(normalized);
      this.historyIndex = -1;
    }
    if (this.mode === 'streaming') {
      this.emit('queue', normalized);
    } else {
      this.emit('submit', normalized);
    }
    this.buffer = '';
    this.cursor = 0;
    this.resetSuggestions();
    this.renderPrompt();
    this.emitInputChange();
  }

  private updateSuggestions(): void {
    if (!this.buffer.startsWith('/')) {
      this.resetSuggestions();
      return;
    }

    const firstSpace = this.buffer.indexOf(' ');
    const hasArgText = firstSpace >= 0 && /\S/.test(this.buffer.slice(firstSpace + 1));
    // Hide slash suggestions when the user is editing arguments
    if (firstSpace >= 0 && this.cursor > firstSpace && hasArgText) {
      this.resetSuggestions();
      return;
    }

    const cursorSlice = this.buffer.slice(0, this.cursor);
    const commandSlice = firstSpace >= 0 ? cursorSlice.slice(0, firstSpace) : cursorSlice;
    const fallbackSlice = firstSpace >= 0 ? this.buffer.slice(0, firstSpace) : this.buffer;
    const partial = (commandSlice.trimEnd() || fallbackSlice.trimEnd() || '/').toLowerCase();
    const previous = this.suggestions[this.suggestionIndex]?.command;
    this.suggestions = this.availableCommands
      .filter(cmd => cmd.command.toLowerCase().startsWith(partial))
      .slice(0, 5);
    if (this.suggestions.length === 0) {
      this.resetSuggestions();
      return;
    }
    if (previous) {
      const idx = this.suggestions.findIndex(s => s.command === previous);
      this.suggestionIndex = idx >= 0 ? idx : 0;
    } else {
      this.suggestionIndex = 0;
    }
  }

  setAvailableCommands(commands: typeof this.suggestions): void {
    this.availableCommands = commands;
    this.updateSuggestions();
  }

  private applySuggestion(submit: boolean): boolean {
    if (!this.buffer.startsWith('/') || this.suggestions.length === 0) {
      return false;
    }
    // Ensure suggestionIndex is valid, default to first item
    const safeIndex = this.suggestionIndex >= 0 && this.suggestionIndex < this.suggestions.length
      ? this.suggestionIndex
      : 0;
    const selected = this.suggestions[safeIndex];
    if (!selected) {
      return false;
    }
    if (submit) {
      this.submitText(selected.command);
    } else {
      this.buffer = `${selected.command} `;
      this.cursor = this.buffer.length;
      this.resetSuggestions();
      this.renderPrompt();
      this.emitInputChange();
    }
    return true;
  }

  private resetSuggestions(): void {
    this.suggestions = [];
    this.suggestionIndex = -1;
  }

  private navigateSuggestions(direction: number): boolean {
    if (!this.buffer.startsWith('/') || this.suggestions.length === 0) {
      // Reset index if suggestions were cleared but index wasn't
      if (this.suggestionIndex !== -1 && this.suggestions.length === 0) {
        this.suggestionIndex = -1;
      }
      return false;
    }
    // Ensure current index is valid before computing next
    const currentIndex = this.suggestionIndex >= 0 && this.suggestionIndex < this.suggestions.length
      ? this.suggestionIndex
      : -1;
    const next = currentIndex + direction;
    const clamped = Math.max(0, Math.min(this.suggestions.length - 1, next));
    if (clamped === this.suggestionIndex && this.suggestionIndex >= 0) {
      return true;
    }
    this.suggestionIndex = clamped;
    this.renderPrompt();
    return true;
  }

  // ------------ Event queue ------------

  /** Track last added event to prevent duplicates */
  private lastAddedEventSignature: string = '';

  addEvent(type: RendererEventType, content: string): void {
    if (!content) return;
    const normalized = this.normalizeEventType(type);
    if (!normalized) return;

    // Deduplicate events at the source to prevent duplicate display
    // Skip deduplication for prompts (user input should always show)
    if (normalized !== 'prompt') {
      const signature = `${normalized}:${content}`;
      if (signature === this.lastAddedEventSignature) {
        return; // Skip duplicate event
      }
      this.lastAddedEventSignature = signature;
    }

    if (
      normalized === 'prompt' ||
      normalized === 'response' ||
      normalized === 'thought' ||
      normalized === 'stream' ||
      normalized === 'tool' ||
      normalized === 'tool-result' ||
      normalized === 'build' ||
      normalized === 'test'
    ) {
      this.hasConversationContent = true;
    }
    if (normalized === 'tool-result') {
      this.lastToolResult = content;
    }

    if (this.plainMode) {
      const formatted = this.formatContent({
        type: normalized,
        rawType: type,
        content,
        timestamp: Date.now(),
      });
      if (formatted) {
        const text = formatted.endsWith('\n') ? formatted : `${formatted}\n`;
        this.output.write(text);
        this.lastOutputEndedWithNewline = text.endsWith('\n');
      }
      return;
    }

    const event = {
      type: normalized,
      rawType: type,
      content,
      timestamp: Date.now(),
    };

    // Priority queue: prompt events are inserted at the front to ensure immediate display
    // This guarantees user input is echoed before any async processing responses
    if (normalized === 'prompt') {
      // Find the first non-prompt event and insert before it
      // This maintains prompt order while giving them priority over other events
      const insertIndex = this.eventQueue.findIndex(e => e.type !== 'prompt');
      if (insertIndex === -1) {
        this.eventQueue.push(event);
      } else {
        this.eventQueue.splice(insertIndex, 0, event);
      }
    } else {
      this.eventQueue.push(event);
    }

    if (!this.isProcessingQueue) {
      queueMicrotask(() => {
        if (!this.isProcessingQueue) {
          void this.processQueue();
        }
      });
    }
  }

  /**
   * Re-render the prompt/control bar immediately.
   * This keeps the chat box pinned during long streaming runs instead of waiting
   * for the event queue to drain before the prompt reappears.
   */
  private renderPromptOverlay(immediate: boolean = false): void {
    if (this.plainMode || this.disposed || !this.output.isTTY || this.promptRenderingSuspended) {
      return;
    }
    this.allowPromptRender = true;
    if (immediate) {
      this.renderPromptImmediate();
      return;
    }
    this.renderPrompt();
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.disposed) return;
    this.isProcessingQueue = true;
    try {
      while (this.eventQueue.length > 0 && !this.disposed) {
        const event = this.eventQueue.shift();
        if (!event) continue;
        const coalesced = this.coalesceAdjacentTextEvents(event);
        try {
          await this.renderEvent(coalesced);
        } catch (error) {
          // Never allow a rendering failure to stall the event queue
          if (this.disposed) break; // Don't try to write after disposal
          const message =
            error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown renderer error';
          this.output.write(`\n[renderer] ${message}\n`);
        }

        // Check disposed before continuing
        if (this.disposed) break;

        // Note: For prompt events, the overlay is already rendered in renderEvent()
        // via renderPromptOverlay(true). No need to render again here.
        if (event.type === 'prompt') {
          // Ensure prompt rendering is allowed for subsequent events
          if (this.output.isTTY) {
            this.allowPromptRender = true;
          }
          // No delay for prompt events - render immediately
        } else {
          await this.delay(1);
        }
      }
      // ALWAYS render prompt after queue completes to keep bottom UI persistent
      // This ensures status/toggles stay pinned and responses are fully rendered
      if (this.output.isTTY && !this.disposed) {
        this.allowPromptRender = true;
        this.renderPrompt();
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Merge adjacent response/thought events into a single block so continuous
   * chat text renders with one bullet instead of one per chunk.
   */
  private coalesceAdjacentTextEvents(event: UIEvent): UIEvent {
    const isMergeable = (target: UIEvent | undefined): target is UIEvent =>
      Boolean(
        target &&
          !target.isCompacted &&
          ((target.type === 'response' && target.rawType === 'response') ||
            (target.type === 'thought' && target.rawType === 'thought'))
      );

    if (!isMergeable(event)) {
      return event;
    }

    while (this.eventQueue.length > 0 && isMergeable(this.eventQueue[0])) {
      const next = this.eventQueue.shift()!;
      const needsSeparator =
        event.content.length > 0 && !event.content.endsWith('\n') && !next.content.startsWith('\n');
      event.content = needsSeparator ? `${event.content}\n${next.content}` : `${event.content}${next.content}`;
    }

    return event;
  }

  /**
   * Flush pending renderer events.
   * Useful for startup flows (e.g., welcome banner) to guarantee the scrollback is hydrated
   * before continuing with additional UI updates.
   */
  async flushEvents(timeoutMs: number = 250): Promise<void> {
    // Kick off processing if idle
    if (!this.plainMode && !this.isProcessingQueue && this.eventQueue.length > 0) {
      void this.processQueue();
    }

    const start = Date.now();
    while ((this.isProcessingQueue || this.eventQueue.length > 0) && Date.now() - start < timeoutMs) {
      await this.delay(5);
    }

    if (!this.plainMode && this.output.isTTY) {
      this.allowPromptRender = true;
      this.renderPrompt();
    }
  }

  private async renderEvent(event: UIEvent): Promise<void> {
    // Clear initialization flag when first banner is displayed
    // This allows prompt rendering to begin after the welcome banner
    if (event.rawType === 'banner' && this.initializing) {
      this.initializing = false;
    }

    if (this.plainMode) {
      const formattedPlain = this.formatContent(event);
      if (formattedPlain) {
        const text = formattedPlain.endsWith('\n') ? formattedPlain : `${formattedPlain}\n`;
        this.output.write(text);
        this.lastOutputEndedWithNewline = text.endsWith('\n');
      }
      return;
    }

    const formatted = this.formatContent(event);
    if (!formatted) return;

    // Deduplicate streaming and response content to prevent duplicates
    const signature = `${event.rawType}:${event.content}`;
    if ((event.type === 'stream' || event.type === 'response') && signature === this.lastRenderedEventKey) {
      return;
    }
    if (event.type !== 'prompt') {
      this.lastRenderedEventKey = signature;
    }

    // Clear the prompt area before writing new content
    // For stream events during streaming, we let the content flow naturally
    // without clearing/re-rendering the overlay on each chunk. The spinner
    // timer handles periodic overlay updates.
    const isStreamChunk = this.mode === 'streaming' && event.type === 'stream';
    if (!isStreamChunk && (this.promptHeight > 0 || this.lastOverlay)) {
      this.clearPromptArea();
    }
    this.isPromptActive = false;

    if (event.type !== 'stream' && !this.lastOutputEndedWithNewline && formatted.trim()) {
      // Keep scrollback ordering predictable when previous output ended mid-line
      this.output.write('\n');
      this.lastOutputEndedWithNewline = true;
    }

    this.output.write(formatted);
    this.lastOutputEndedWithNewline = formatted.endsWith('\n');

    // Restore the prompt overlay to keep the chat box pinned
    // During streaming mode, skip overlay rendering for stream events to prevent
    // visual chaos from rapid re-renders. The spinner animation timer will
    // update the overlay periodically. For non-stream events (tool results,
    // responses, prompts), render immediately to show important state changes.
    if (this.output.isTTY && this.interactive && !this.disposed) {
      if (this.mode === 'streaming' && event.type === 'stream') {
        // Skip overlay render for stream events - let spinner timer handle it
        // This prevents the visual artifacts from clear→write→render→clear cycles
      } else {
        // Non-stream events render immediately
        this.renderPromptOverlay(true);
      }
    }
  }

  private normalizeEventType(type: RendererEventType): CanonicalEventType | null {
    switch (type) {
      case 'prompt':
        return 'prompt';
      case 'thought':
        return 'thought';
      case 'stream':
      case 'streaming':
        return 'stream';
      case 'tool':
      case 'tool-call':
        return 'tool';
      case 'tool-result':
        return 'tool-result';
      case 'build':
        return 'build';
      case 'test':
        return 'test';
      case 'response':
      case 'banner':
      case 'raw':
        return 'response';
      case 'error':
        return 'response';
      default:
        return null;
    }
  }

  private formatContent(event: UIEvent): string {
    // Compacted blocks already have separator and formatting
    if (event.isCompacted) {
      return event.content;
    }

    if (event.rawType === 'banner') {
      // Banners display without bullet prefix
      const lines = event.content.split('\n').map(line => line.trimEnd());
      return `${lines.join('\n')}\n`;
    }

    // Compact, user-friendly formatting
    switch (event.type) {
      case 'prompt':
        // User prompt - just the text (prompt box handles styling)
        return `${theme.primary('>')} ${event.content}\n`;

      case 'thought': {
        // Programmatic filter: reject content that looks like internal/garbage output
        if (this.isGarbageOutput(event.content)) {
          return '';
        }
        const curated = this.curateReasoningContent(event.content);
        if (!curated || this.isGarbageOutput(curated)) {
          return '';
        }
        if (!this.shouldRenderThought(curated)) {
          return '';
        }
        this.lastCuratedThought = {
          text: curated.replace(/\s+/g, ' ').trim().toLowerCase(),
          at: Date.now(),
        };
        return this.formatThinkingBlock(curated);
      }

      case 'tool': {
        // Premium tool display with enhanced visualization
        const content = event.content.replace(/^[⏺⚙○]\s*/, '');
        return this.formatToolCall(content);
      }

      case 'tool-result': {
        // Inline result: └─ summary
        return this.formatCompactToolResult(event.content);
      }

      case 'build':
        return this.wrapBulletText(event.content, { label: 'build', labelColor: theme.warning });

      case 'test':
        return this.wrapBulletText(event.content, { label: 'test', labelColor: theme.info });

      case 'stream': {
        // Streaming content is the model's response - pass through directly
        // IMPORTANT: Don't filter streaming chunks with isGarbageOutput because:
        // 1. Chunks arrive character-by-character or in small pieces
        // 2. Small chunks like "." or ":" are valid parts of sentences
        // 3. Filtering would break the streaming display
        // Only filter completely empty content
        if (!event.content) {
          return '';
        }
        // Accumulate streaming content for potential post-processing
        this.streamingContentBuffer += event.content;
        // Track newlines for line counting
        const newlines = (event.content.match(/\n/g) || []).length;
        this.streamingLinesWritten += newlines;
        return event.content;
      }

      case 'response':
      default: {
        // Programmatic filter: reject content that looks like internal/garbage output
        if (this.isGarbageOutput(event.content)) {
          return '';
        }
        // Premium response formatting with assistant styling
        const isError = event.rawType === 'error';
        if (isError) {
          return this.wrapBulletText(event.content, { 
            label: 'error', 
            labelColor: theme.error,
            thoughtType: 'danger'
          });
        } else {
          // Assistant response with premium styling
          return this.formatAssistantResponse(event.content);
        }
      }
    }
  }

  /**
   * Programmatic garbage detection - checks if content looks like internal/system output
   * that shouldn't be shown to users. Uses structural checks, not pattern matching.
   */
  private isGarbageOutput(content: string): boolean {
    if (!content || content.trim().length === 0) return true;

    const trimmed = content.trim();

    // Very short content checks - catch leaked punctuation fragments like "." or ":"
    if (trimmed.length <= 3) {
      // Single punctuation marks or very short punctuation sequences are garbage
      if (/^[.,:;!?*#\-_=+|\\/<>(){}[\]`'"~^@&%$]+$/.test(trimmed)) {
        return true;
      }
    }

    // Check if content is just punctuation on multiple lines (leaked reasoning)
    const lines = content.split('\n');
    const punctOnlyLines = lines.filter(line => {
      const lineTrimmed = line.trim();
      return lineTrimmed.length > 0 && /^[.,:;!?*#\-_=+|\\/<>(){}[\]`'"~^@&%$\s]+$/.test(lineTrimmed);
    });
    // If ALL non-empty lines are just punctuation, it's garbage
    const nonEmptyLines = lines.filter(l => l.trim().length > 0);
    if (nonEmptyLines.length > 0 && punctOnlyLines.length === nonEmptyLines.length) {
      return true;
    }

    // Structural check: content starting with < that isn't valid markdown/code
    if (content.startsWith('<') && !content.startsWith('<http') && !content.startsWith('<!')) {
      return true;
    }

    // Structural check: contains "to=functions." or "to=tools." (internal routing)
    if (content.includes('to=functions.') || content.includes('to=tools.')) {
      return true;
    }

    // Structural check: looks like internal instruction (quoted system text)
    if (content.startsWith('"') && content.includes('block') && content.includes('tool')) {
      return true;
    }

    // Structural check: very short content that's just timing info
    if (content.length < 30 && /elapsed|seconds?|ms\b/i.test(content)) {
      return true;
    }

    // Structural check: mostly punctuation/symbols - leaked reasoning fragments
    const meaningfulLines = lines.filter(line => {
      const lineTrimmed = line.trim();
      if (!lineTrimmed) return false;
      // Line must have at least 30% alphanumeric content
      const alphaNum = (lineTrimmed.match(/[a-zA-Z0-9]/g) || []).length;
      return lineTrimmed.length > 0 && alphaNum / lineTrimmed.length >= 0.3;
    });
    // If less than 30% of lines are meaningful, it's garbage
    if (lines.length > 3 && meaningfulLines.length / lines.length < 0.3) {
      return true;
    }

    // Structural check: gibberish - high ratio of non-word characters
    const alphaCount = (content.match(/[a-zA-Z]/g) || []).length;
    const totalCount = content.replace(/\s/g, '').length;
    if (totalCount > 20 && alphaCount / totalCount < 0.4) {
      return true; // Less than 40% letters = likely garbage
    }

    return false;
  }

  /**
   * Sanitize tool result content to remove leaked reasoning/thinking output.
   * This filters out fragments that look like internal model output.
   */
  private sanitizeToolResultContent(content: string): string {
    if (!content) return '';

    // Split into lines and filter out garbage lines
    const lines = content.split('\n');
    const cleanLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines at start
      if (cleanLines.length === 0 && !trimmed) continue;

      // Skip lines that look like leaked reasoning fragments
      // Common patterns: single punctuation, markdown artifacts, emoji fragments
      if (/^[)\]}>*`'"]+$/.test(trimmed)) continue;
      if (/^[*_]{2,}$/.test(trimmed)) continue; // Just ** or __
      if (/^[|│┃]+$/.test(trimmed)) continue; // Just vertical bars
      if (/^[─━═]+$/.test(trimmed)) continue; // Just horizontal lines
      if (/^\.{2,}$/.test(trimmed)) continue; // Just dots
      if (/^[\s️]+$/.test(trimmed)) continue; // Just whitespace/emoji modifiers
      if (/^[:\s]+$/.test(trimmed)) continue; // Just colons/whitespace
      if (/^[,\s]+$/.test(trimmed)) continue; // Just commas/whitespace

      // Skip markdown bold/italic fragments that leaked
      if (/^\*{1,2}[^*]*\*{0,2}$/.test(trimmed) && trimmed.length < 10 && !/\w{3,}/.test(trimmed)) continue;

      // Skip lines that are just short fragments with high punctuation ratio
      const alphaInLine = (trimmed.match(/[a-zA-Z0-9]/g) || []).length;
      if (trimmed.length > 0 && trimmed.length < 20 && alphaInLine / trimmed.length < 0.3) continue;

      // Skip very short lines that are just punctuation or single chars (except numbers)
      if (trimmed.length <= 2 && !/^\d+$/.test(trimmed) && !/^[a-zA-Z]{2}$/.test(trimmed)) {
        // Allow specific short patterns like "OK", "0", "1" etc.
        if (!/^(?:ok|no|yes|\d+)$/i.test(trimmed)) continue;
      }

      // Skip lines that look like stray parentheses or brackets from reasoning
      if (/^[()[\]{}]+$/.test(trimmed)) continue;

      // Skip lines that look like markdown code fence artifacts
      if (/^```\s*$/.test(trimmed)) continue;

      cleanLines.push(line);
    }

    // Trim trailing empty lines
    while (cleanLines.length > 0 && !cleanLines[cleanLines.length - 1]?.trim()) {
      cleanLines.pop();
    }

    return cleanLines.join('\n').trim();
  }

  private curateReasoningContent(content: string): string | null {
    const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    if (!normalized) return null;

    const limited =
      normalized.length > this.maxCuratedReasoningChars
        ? normalized.slice(0, this.maxCuratedReasoningChars)
        : normalized;

    const maxSegments = this.maxCuratedReasoningLines * 3;
    const segments = limited
      .split('\n')
      .flatMap(line => line.split(/(?<=[.?!])\s+/))
      .map(line => line.replace(/^[•*⏺○\-\u2022]+\s*/, '').trim())
      .filter(Boolean);

    if (segments.length === 0) {
      return null;
    }

    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const segment of segments) {
      const normalizedSegment = segment.replace(/\s+/g, ' ');
      const key = normalizedSegment.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(normalizedSegment);
      if (deduped.length >= maxSegments) {
        break;
      }
    }

    if (deduped.length === 0) {
      return null;
    }

    const prioritized = this.prioritizeReasoningSegments(deduped);
    if (prioritized.length === 0) {
      return null;
    }

    const limitedSelection = prioritized.slice(0, this.maxCuratedReasoningLines);
    const bulleted = limitedSelection.map(line => this.ensureReasoningBullet(line));

    return bulleted.join('\n');
  }

  private ensureReasoningBullet(line: string): string {
    if (/^([•*⏺○-]|\d+[.)])\s/.test(line)) {
      return line;
    }
    return `• ${line}`;
  }

  private looksStructuredThought(line: string): boolean {
    return (
      /^(\d+[.)]\s|step\s*\d+|plan\b|next\b|then\b|goal\b)/i.test(line) ||
      /^[-*•]\s/.test(line) ||
      line.includes('->') ||
      line.includes('→') ||
      line.includes(': ') ||
      /\b(test|verify|validate|check|build|run|deploy|diff|lint|type ?check|fix|bug|issue|risk|mitigate|investigate)\b/i.test(line)
    );
  }

  private prioritizeReasoningSegments(segments: string[]): string[] {
    if (!segments.length) {
      return [];
    }

    const scored = segments.map((text, index) => ({
      text,
      index,
      score: this.reasoningSignalScore(text),
    }));

    const hasSignal = scored.some(item => item.score > 0);
    if (!hasSignal) {
      return segments;
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    });

    return scored.map(item => item.text);
  }

  private reasoningSignalScore(line: string): number {
    let score = 0;
    const lower = line.toLowerCase();

    if (this.looksStructuredThought(line)) {
      score += 3;
    }

    const actionKeywords = [
      'tool', 'command', 'script', 'context', 'summar', 'risk', 'issue',
      'investigate', 'root cause', 'remediat', 'mitigat', 'fix', 'patch',
      'test', 'verify', 'validate', 'check', 'build', 'deploy', 'run',
      'diff', 'lint', 'typecheck', 'benchmark',
    ];
    if (actionKeywords.some(keyword => lower.includes(keyword))) {
      score += 2;
    }

    if (/[#:→]|->/.test(line)) {
      score += 1;
    }

    if (/^(i('| a)m|i will|let me|starting|now|ok|sure)\b/i.test(line)) {
      score -= 1;
    }

    if (line.length > 120) {
      score -= 1;
    }

    return score;
  }

  private shouldRenderThought(content: string): boolean {
    const normalized = content.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return false;
    }

    const now = Date.now();
    const normalizedLower = normalized.toLowerCase();
    
    // Exact duplicate detection
    if (this.lastCuratedThought && this.lastCuratedThought.text === normalizedLower) {
      if (now - this.lastCuratedThought.at < this.thoughtDedupWindowMs) {
        return false;
      }
    }

    // Semantic duplicate detection - check if new thought is a subset of previous thought
    if (this.lastCuratedThought) {
      const previous = this.lastCuratedThought.text;
      const current = normalizedLower;
      
      // If current thought contains most of previous thought (or vice versa), it's likely a duplicate
      const wordsPrevious = previous.split(/\s+/).filter(w => w.length > 3);
      const wordsCurrent = current.split(/\s+/).filter(w => w.length > 3);
      
      if (wordsPrevious.length > 0 && wordsCurrent.length > 0) {
        const sharedWords = wordsCurrent.filter(word => wordsPrevious.includes(word));
        const similarity = sharedWords.length / Math.max(wordsPrevious.length, wordsCurrent.length);
        
        // If similarity > 70% and within time window, filter it out
        if (similarity > 0.7 && now - this.lastCuratedThought.at < this.thoughtDedupWindowMs) {
          return false;
        }
      }
    }

    // Filter out very short or trivial thoughts
    const wordCount = normalizedLower.split(/\s+/).filter(w => w.length > 2).length;
    if (wordCount < 3 && normalizedLower.length < 30) {
      // Too short to be meaningful
      return false;
    }

    // Filter out common meaningless patterns
    const meaninglessPatterns = [
      /^i(?:'?ll?)?\s+(?:will\s+)?(?:now\s+)?(?:proceed|continue|go|move|start)/i,
      /^(?:let me|i will|i'll|i am|i'm)\s+(?:check|look|see|examine|review|analyze)/i,
      /^proceeding\s+(?:with|to)/i,
      /^continuing\s+(?:with|to)/i,
      /^moving\s+(?:on|forward|to)/i,
      /^starting\s+(?:with|to)/i,
      /^now\s+(?:i|let me|we|let's)/i,
      /^(?:ok|alright|well)\s*,?\s*(?:now|then|so|let)/i,
    ];

    for (const pattern of meaninglessPatterns) {
      if (pattern.test(normalized)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Format text in Claude Code style: ⏺ prefix with wrapped continuation lines
   * Example:
   *   ⏺ The AI ran tools but gave no response. Need to fix
   *     the response handling. Let me check where the AI's
   *     text response should be displayed:
   */
  private formatClaudeCodeBlock(content: string): string {
    const bullet = '⏺';
    const maxWidth = Math.max(24, Math.min(this.safeWidth() - 4, 110)); // Responsive to terminal width
    const lines = content.split('\n');
    const result: string[] = [];

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx]!;
      if (!line.trim()) {
        result.push('');
        continue;
      }

      // Word-wrap each line
      const words = line.split(/(\s+)/);
      let currentLine = '';

      for (const word of words) {
        if ((currentLine + word).length > maxWidth && currentLine.trim()) {
          // First line of this paragraph gets ⏺, rest get indent
          const prefix = result.length === 0 && lineIdx === 0 ? `${bullet} ` : '  ';
          result.push(`${prefix}${currentLine.trimEnd()}`);
          currentLine = word.trimStart();
        } else {
          currentLine += word;
        }
      }

      if (currentLine.trim()) {
        const prefix = result.length === 0 && lineIdx === 0 ? `${bullet} ` : '  ';
        result.push(`${prefix}${currentLine.trimEnd()}`);
      }
    }

    return result.join('\n') + '\n';
  }

  /**
   * Format a tool call in Claude Code style:
   *   ⏺ [Search] pattern: "foo", path: "src",
   *              output_mode: "content", head_limit: 30
   */
  private formatToolCall(content: string): string {
    const bullet = '⏺';
    // Parse tool name and arguments
    const match = content.match(/^(\w+)\((.*)\)$/s);
    if (!match) {
      // Simple format without args
      const nameMatch = content.match(/^(\w+)/);
      if (nameMatch) {
        return `${bullet} ${theme.toolColors.default(`[${nameMatch[1]}]`)}\n`;
      }
      return `${bullet} ${content}\n`;
    }

    const toolName = match[1];
    const argsStr = match[2]!;
    const maxWidth = Math.min(this.cols - 4, 56);

    // Format: ⏺ [ToolName] args...
    const prefix = `${bullet} ${theme.toolColors.default(`[${toolName}]`)} `;
    const prefixLen = toolName!.length + 5; // "⏺ [ToolName] " visible length
    const indent = ' '.repeat(prefixLen + 4); // Extra indent for wrapped args

    // Parse and format arguments
    const args = this.parseToolArgs(argsStr);
    if (args.length === 0) {
      return `${prefix.trimEnd()}\n`;
    }

    const lines: string[] = [];
    let currentLine = prefix;

    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      const argText = `${theme.ui.muted(arg.key + ':')} ${this.formatArgValue(arg.key, arg.value)}`;
      const separator = i < args.length - 1 ? ', ' : '';

      // Check if this arg fits on current line
      const testLine = currentLine + argText + separator;
      if (this.stripAnsi(testLine).length > maxWidth && currentLine !== prefix) {
        lines.push(currentLine.trimEnd());
        currentLine = indent + argText + separator;
      } else {
        currentLine += argText + separator;
      }
    }

    if (currentLine.trim()) {
      lines.push(currentLine.trimEnd());
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Parse tool arguments from string like: key: "value", key2: value2
   */
  private parseToolArgs(argsStr: string): Array<{ key: string; value: string }> {
    const args: Array<{ key: string; value: string }> = [];
    // Simple regex to extract key: value pairs
    const regex = /(\w+):\s*("(?:[^"\\]|\\.)*"|[^,)]+)/g;
    let match;
    while ((match = regex.exec(argsStr)) !== null) {
      args.push({ key: match[1]!, value: match[2]!.trim() });
    }
    return args;
  }

  /**
   * Format an argument value (truncate long strings)
   */
  private formatArgValue(key: string, value: string): string {
    // Remove surrounding quotes if present
    const isQuoted = value.startsWith('"') && value.endsWith('"');
    const inner = isQuoted ? value.slice(1, -1) : value;

    const lowerKey = key.toLowerCase();
    const shouldPreserve =
      lowerKey.includes('path') ||
      lowerKey === 'file' ||
      lowerKey === 'pattern' ||
      lowerKey === 'query' ||
      lowerKey === 'command' ||
      lowerKey === 'cmd';

    // Truncate long values when not explicitly preserving
    const maxLen = 40;
    const truncated = shouldPreserve || inner.length <= maxLen ? inner : inner.slice(0, maxLen - 3) + '...';

    return isQuoted ? `"${truncated}"` : truncated;
  }

  /**
   * Format a tool result in Claude Code style:
   *   ⎿  Found 12 lines (ctrl+o to expand)
   */
  private formatToolResult(content: string): string {
    // Check if this is a summary line (e.g., "Found X lines")
    const summaryMatch = content.match(/^(Found \d+ (?:lines?|files?|matches?)|Read \d+ lines?|Wrote \d+ lines?|Edited|Created|Deleted)/i);
    if (summaryMatch) {
      return `  ${theme.ui.muted('⎿')}  ${content} ${theme.ui.muted('(ctrl+o to expand)')}\n`;
    }

    // For other results, show truncated preview
    const lines = content.split('\n');
    if (lines.length > 3) {
      const preview = lines.slice(0, 2).join('\n');
      return `  ${theme.ui.muted('⎿')}  ${preview}\n  ${theme.ui.muted(`... ${lines.length - 2} more lines (ctrl+o to expand)`)}\n`;
    }

    return `  ${theme.ui.muted('⎿')}  ${content}\n`;
  }

  /**
   * Format a compact tool call: ⏺ [Read] file.ts
   */
  private formatCompactToolCall(content: string): string {
    const bullet = '⏺';
    // Parse tool name and args
    const match = content.match(/^(\w+)\s*(?:\((.*)\))?$/s);
    if (!match) {
      return `${bullet} ${content}\n`;
    }

    const toolName = match[1]!;
    const argsStr = match[2]?.trim() || '';

    // Track tool name for pairing with result
    this.lastToolName = toolName;

    // Get tool-specific color (bash=orange, read=cyan, write=green, etc.)
    const toolColor = getToolColor(toolName);
    const coloredToolName = toolColor(`[${toolName}]`);

    // If no args, just show tool name
    if (!argsStr) {
      return `${bullet} ${coloredToolName}\n`;
    }

    const maxWidth = this.cols - 8; // Leave room for margins

    // Parse individual params
    const params = this.parseToolParams(argsStr);
    if (params.length === 0) {
      return `${bullet} ${coloredToolName} ${argsStr}\n`;
    }

    // Format params with proper wrapping
    return this.formatToolParamsColored(toolName, params, maxWidth, toolColor);
  }

  /**
   * Parse tool params from args string
   */
  private parseToolParams(argsStr: string): Array<{ key: string; value: string }> {
    const params: Array<{ key: string; value: string }> = [];
    // Match key: "value" or key: value patterns
    const regex = /(\w+):\s*("(?:[^"\\]|\\.)*"|[^,\n]+)/g;
    let match;
    while ((match = regex.exec(argsStr)) !== null) {
      params.push({ key: match[1]!, value: match[2]!.trim() });
    }
    return params;
  }

  /**
   * Format tool params in Claude Code style with wrapping (default green color)
   */
  private formatToolParams(
    toolName: string,
    params: Array<{ key: string; value: string }>,
    maxWidth: number
  ): string {
    return this.formatToolParamsColored(toolName, params, maxWidth, theme.toolColors.default);
  }

  /**
   * Format tool params with custom tool color
   */
  private formatToolParamsColored(
    toolName: string,
    params: Array<{ key: string; value: string }>,
    maxWidth: number,
    toolColor: (text: string) => string
  ): string {
    const bullet = '⏺';
    const lines: string[] = [];
    const indent = '        '; // 8 spaces for continuation

    let currentLine = `${bullet} ${toolColor(`[${toolName}]`)} `;
    let firstParam = true;

    for (const param of params) {
      const coloredValue = this.colorParamValue(param.key, param.value);
      const paramText = `${param.key}: ${coloredValue}`;
      const paramStr = firstParam ? paramText : `, ${paramText}`;

      // Check if adding this param would exceed width
      const testLine = currentLine + paramStr;
      const plainLength = this.visibleLength(testLine);

      if (plainLength > maxWidth && !firstParam) {
        // Start new line
        lines.push(currentLine);
        currentLine = indent + paramText;
      } else {
        currentLine += paramStr;
      }
      firstParam = false;
    }

    lines.push(currentLine);

    return lines.join('\n') + '\n';
  }

  /**
   * Color critical parameter values (paths, commands) for readability.
  */
  private colorParamValue(key: string, value: string): string {
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes('path') || lowerKey === 'file' || lowerKey === 'pattern' || lowerKey === 'query') {
      return theme.warning(value);
    }
    if (lowerKey === 'command' || lowerKey === 'cmd') {
      return theme.toolColors.default(value);
    }
    return value;
  }

  /**
   * Extract a short summary from tool args
   */
  private extractToolSummary(toolName: string, argsStr: string): string | null {
    const tool = toolName.toLowerCase();

    // Extract path/file for file operations
    if (['read', 'write', 'edit', 'glob', 'grep', 'search'].includes(tool)) {
      const pathMatch = argsStr.match(/(?:path|file_path|pattern):\s*"([^"]+)"/);
      if (pathMatch) {
        const path = pathMatch[1]!;
        return theme.file?.path ? theme.file.path(path) : theme.ui.muted(path);
      }
    }

    // Extract command for bash
    if (tool === 'bash') {
      const cmdMatch = argsStr.match(/command:\s*"([^"]+)"/);
      if (cmdMatch) {
        const cmd = cmdMatch[1]!;
        return theme.ui.muted(cmd);
      }
    }

    return null;
  }

  /**
   * Format a compact tool result: ⎿  Found X lines (ctrl+o to expand)
   * For edits, show a small inline diff preview
   */
  private formatCompactToolResult(content: string): string {
    // Sanitize content first - filter out garbage/reasoning output that leaked through
    const sanitized = this.sanitizeToolResultContent(content);
    if (!sanitized || this.isGarbageOutput(sanitized)) {
      return ''; // Don't render garbage tool results
    }

    // Special handling for edit results - show inline diff
    if (this.lastToolName?.toLowerCase() === 'edit') {
      return this.formatEditResultWithDiff(sanitized);
    }

    // Parse common result patterns for summary
    const lineMatch = sanitized.match(/(\d+)\s*lines?/i);
    const fileMatch = sanitized.match(/(\d+)\s*(?:files?|matches?)/i);
    const readMatch = sanitized.match(/read.*?(\d+)\s*lines?/i);

    // Check if content contains a file path or command that should be preserved
    const hasPath = /(?:^|\s)(?:\/[\w./-]+|[\w./-]+\/[\w./-]+)/.test(sanitized);
    const hasCommand = /^\s*\$\s+.+|command:/i.test(sanitized);
    const isPathOrDir = /^(?:File|Directory|Path):\s*/i.test(sanitized);

    let summary: string;
    let preserveFull = false;

    if (readMatch) {
      summary = `Read ${readMatch[1]} lines`;
    } else if (lineMatch) {
      summary = `Found ${lineMatch[1]} line${lineMatch[1] === '1' ? '' : 's'}`;
    } else if (fileMatch) {
      summary = `Found ${fileMatch[1]} file${fileMatch[1] === '1' ? '' : 's'}`;
    } else if (sanitized.match(/^(success|ok|done|completed|written|edited|created)/i)) {
      summary = '✓';
    } else if (isPathOrDir || hasPath || hasCommand) {
      // Preserve full content for paths, directories, and commands
      // Only show first line if multi-line
      const firstLine = sanitized.split('\n')[0] || sanitized;
      summary = firstLine;
      preserveFull = true;
    } else {
      // Extract meaningful summary from content
      let summaryText = sanitized;

      // Handle "Summary:" prefix from web search/extract results
      const summaryMatch = sanitized.match(/^Summary:\s*(.+)/i);
      if (summaryMatch) {
        summaryText = summaryMatch[1]!;
      }

      // For multi-line content, use first meaningful line
      const firstLine = summaryText.split('\n')[0]?.trim() || summaryText;

      // Try to end at a sentence boundary for readability (up to 120 chars)
      const maxLen = 120;
      if (firstLine.length > maxLen) {
        // Look for sentence end within limit
        const sentenceEnd = firstLine.slice(0, maxLen).search(/[.!?;]\s|[.!?;]$/);
        if (sentenceEnd > 30) {
          summary = firstLine.slice(0, sentenceEnd + 1);
        } else {
          // No good sentence break, truncate at word boundary
          const truncated = firstLine.slice(0, maxLen);
          const lastSpace = truncated.lastIndexOf(' ');
          summary = lastSpace > 60 ? truncated.slice(0, lastSpace) + '…' : truncated + '…';
        }
      } else {
        summary = firstLine;
      }
    }

    // Store collapsed result for Ctrl+O expansion (use sanitized content)
    this.collapsedToolResults.push({
      toolName: this.lastToolName || 'tool',
      content: sanitized,
      summary,
      timestamp: Date.now(),
    });

    // Trim to max size
    if (this.collapsedToolResults.length > this.maxCollapsedResults) {
      this.collapsedToolResults.shift();
    }

    const coloredSummary = this.colorResultSummary(summary);
    // Only show expand hint if content is actually collapsed (multi-line or was truncated)
    const hasMoreContent = sanitized.includes('\n') || summary.endsWith('…') || (!preserveFull && sanitized.length > summary.length);
    const expandHint = hasMoreContent ? ` ${theme.ui.muted('(ctrl+o to expand)')}` : '';
    return `  ${theme.ui.muted('⎿')}  ${coloredSummary}${expandHint}\n`;
  }

  private colorResultSummary(summary: string): string {
    if (!summary) return summary;
    const lower = summary.toLowerCase();
    if (lower.includes('fail') || lower.includes('error')) {
      return theme.error(summary);
    }
    if (summary.startsWith('✓') || lower.includes('updated') || lower.includes('created') || lower.includes('written')) {
      return theme.success(summary);
    }
    return theme.info(summary);
  }

  /**
   * Format edit result with enhanced inline diff preview
   * Shows: ⎿ ✓ Updated (filename) - removed X, added Y chars
   *        ├─┐
   *        │ - old content...
   *        │ + new content...
   *        └─
   */
  private formatEditResultWithDiff(content: string): string {
    const lines: string[] = [];
    const indent = '  ';

    // Extract file path from content with better regex
    const filePathMatch = content.match(/(?:file[_\s]*path|path):\s*"([^"]+)"/i) || 
                         content.match(/updated.*?([\/\w.\-]+\.\w+)/i) ||
                         content.match(/edited.*?([\/\w.\-]+\.\w+)/i);
    const fileName = filePathMatch ? filePathMatch[1]!.split('/').pop() : 'file';
    const fullPath = filePathMatch ? filePathMatch[1] : fileName;

    // Try to extract old/new content from edit result with better parsing
    const oldMatch = content.match(/old[_\s]*string[:\s]*(["'`])([^\x01]+?)\1/i) || 
                    content.match(/old[_\s]*string[:\s]*["']?([^"'\n]+)["']?/i);
    const newMatch = content.match(/new[_\s]*string[:\s]*(["'`])([^\x01]+?)\1/i) ||
                    content.match(/new[_\s]*string[:\s]*["']?([^"'\n]+)["']?/i);

    const oldContent = oldMatch?.[2] || oldMatch?.[1] || '';
    const newContent = newMatch?.[2] || newMatch?.[1] || '';

    // Calculate diff stats
    const oldLen = oldContent.length;
    const newLen = newContent.length;
    const diffStat = oldLen || newLen
      ? theme.ui.muted(` (${theme.error(`-${oldLen}`)} ${theme.success(`+${newLen}`)} chars)`)
      : '';

    // Main summary line with enhanced styling
    lines.push(`${indent}${theme.ui.muted('⎿')}  ${theme.success('✓')} ${theme.success(`Updated`)} ${theme.file?.path ? theme.file.path(`${fullPath}`) : theme.warning(`${fullPath}`)}${diffStat}`);

    // Show enhanced diff visualization
    if (oldContent || newContent) {
      const maxDiffLen = Math.min(this.safeWidth() - 20, 80);
      
      // Start diff box
      lines.push(`${indent}${theme.ui.muted('├─┐')}`);

      if (oldContent) {
        const oldPreview = oldContent.length > maxDiffLen
          ? oldContent.slice(0, maxDiffLen) + '…'
          : oldContent;
        // Clean up the preview (remove escaped quotes, etc.)
        const cleanOld = oldPreview.replace(/\\"/g, '"').replace(/\\n/g, '↲');
        lines.push(`${indent}${theme.ui.muted('│')} ${theme.error('─ ' + cleanOld)}`);
      }

      if (newContent) {
        const newPreview = newContent.length > maxDiffLen
          ? newContent.slice(0, maxDiffLen) + '…'
          : newContent;
        const cleanNew = newPreview.replace(/\\"/g, '"').replace(/\\n/g, '↲');
        lines.push(`${indent}${theme.ui.muted('│')} ${theme.success('+ ' + cleanNew)}`);
      }

      // End diff box
      lines.push(`${indent}${theme.ui.muted('└─')}`);
    }

    // Store for expansion with enhanced metadata
    this.collapsedToolResults.push({
      toolName: 'edit',
      content,
      summary: `Updated ${fileName} (-${oldLen}, +${newLen})`,
      timestamp: Date.now(),
      metadata: {
        filePath: fullPath,
        oldLength: oldLen,
        newLength: newLen,
        diff: { old: oldContent, new: newContent }
      }
    });

    if (this.collapsedToolResults.length > this.maxCollapsedResults) {
      this.collapsedToolResults.shift();
    }

    const expandHint = content.length > 100 || oldLen > 50 || newLen > 50 ? 
      ` ${theme.ui.muted('(ctrl+o to expand)')}` : '';
    return lines.join('\n') + expandHint + '\n';
  }

  /**
   * Format a compact response with bullet on first line
   */
  private formatCompactResponse(content: string): string {
    return this.wrapBulletText(content);
  }

  /**
   * Wrap text with a single bullet on the first line and tidy indentation for readability.
   * Prevents awkward mid-word terminal wrapping by handling the layout ourselves.
   * Supports full markdown formatting: headers, lists, code blocks, inline styles.
   */
  private wrapBulletText(
    content: string,
    options: { maxWidth?: number; label?: string; labelColor?: (value: string) => string; thoughtType?: string } = {}
  ): string {
    const bullet = '⏺';
    let cleaned = content.replace(/^[⏺•○]\s*/, '').trimEnd();
    if (!cleaned.trim()) {
      return '';
    }

    // Normalize content: add spaces after headers, fix common formatting issues
    // Fix headers without space: ##HEADING -> ## HEADING (including emoji)
    cleaned = cleaned.replace(/^(#{1,6})([A-Z🚀⚔️🎯🔐📦✅❌⚡💀🔥🛡️💣🎖️⭐])/gm, '$1 $2');
    // Fix numbered headers: ###1 Elite -> ### 1. Elite
    cleaned = cleaned.replace(/^(#{1,6})(\d+)\s+/gm, '$1 $2. ');
    // Fix dash lists without space: -RSA2048 -> - RSA2048
    cleaned = cleaned.replace(/^-([A-Z])/gm, '- $1');
    // Fix numbered lists without space: 1.Item -> 1. Item
    cleaned = cleaned.replace(/^(\d+\.)([A-Z])/gm, '$1 $2');
    // Add line breaks before headers that are joined to previous text
    cleaned = cleaned.replace(/([.!?)])(\s*)(#{1,6}\s)/g, '$1\n\n$3');
    // Add line breaks between sections (text followed immediately by ##)
    cleaned = cleaned.replace(/([a-z])(\s*)(#{2,6}\s)/gi, '$1\n\n$3');
    // Add line breaks between emoji bullets and next section
    cleaned = cleaned.replace(/([\u2705\u274C\u2714\u2718\u26A0\uD83C-\uDBFF\uDC00-\uDFFF]+)\s*(#{1,6})/g, '$1\n\n$2');
    // Fix code blocks that run together: bash# -> bash\n#
    cleaned = cleaned.replace(/(bash|sh|python|javascript|typescript)#/gi, '$1\n```\n#');
    // Add newlines before code block markers
    cleaned = cleaned.replace(/([^\n])```(\w+)?/g, '$1\n```$2');
    // Fix tables that run together
    cleaned = cleaned.replace(/(\w+)\s+([-─]{3,})\s+(\w+)/g, '$1\n$2\n$3');

    // Reserve a little margin to reduce terminal wrap jitter
    const availableWidth = this.safeWidth();
    const maxWidth = Math.max(20, Math.min(options.maxWidth ?? availableWidth - 2, availableWidth));
    const labelText = options.label
      ? `${options.labelColor ? options.labelColor(options.label) : options.label}${theme.ui.muted(' · ')}`
      : '';
    const bulletPrefix = `${bullet} ${labelText}`;
    const indent = ' '.repeat(this.visibleLength(`${bullet} `));

    const lines = cleaned.split('\n');
    const result: string[] = [];
    let firstNonEmpty = true;
    let inCodeBlock = false;
    let codeBlockLang = '';
    const codeBlockBuffer: string[] = [];

    for (const rawLine of lines) {
      const trimmedLine = rawLine.trim();

      // Handle code block fences
      if (trimmedLine.startsWith('```')) {
        if (!inCodeBlock) {
          // Start code block
          inCodeBlock = true;
          codeBlockLang = trimmedLine.slice(3).trim().toUpperCase() || 'CODE';
          continue;
        } else {
          // End code block - render it
          inCodeBlock = false;
          const codeIndent = firstNonEmpty ? bulletPrefix : indent;
          if (firstNonEmpty) {
            result.push(`${bulletPrefix}${theme.ui.muted(`─── ${codeBlockLang} ───`)}`);
            firstNonEmpty = false;
          } else {
            result.push(`${indent}${theme.ui.muted(`─── ${codeBlockLang} ───`)}`);
          }
          for (const codeLine of codeBlockBuffer) {
            result.push(`${indent}${theme.ui.muted('│')} ${theme.ui.code(codeLine)}`);
          }
          codeBlockBuffer.length = 0;
          codeBlockLang = '';
          continue;
        }
      }

      if (inCodeBlock) {
        codeBlockBuffer.push(rawLine);
        continue;
      }

      // Handle empty lines
      if (!trimmedLine) {
        result.push(''); // Preserve intentional spacing between paragraphs
        continue;
      }

      // Handle markdown headers (# ## ### etc.) - also handle ##HEADING without space
      const headerMatch = trimmedLine.match(/^(#{1,6})\s*(.+)$/);
      if (headerMatch && headerMatch[2] && !headerMatch[2].startsWith('#')) {
        const level = headerMatch[1]?.length ?? 1;
        const headerText = headerMatch[2]?.trim() ?? '';
        // Skip if it's just hashes or if content is too short
        if (headerText.length > 0) {
          // Add blank line before headers for better visual separation
          if (result.length > 0 && result[result.length - 1] !== '') {
            result.push('');
          }
          const formattedHeader = this.formatMarkdownHeader(headerText, level, maxWidth, firstNonEmpty ? bulletPrefix : indent);
          result.push(formattedHeader);
          firstNonEmpty = false;
          continue;
        }
      }

      // Handle dividers (--- or ***)
      if (/^[-*_]{3,}$/.test(trimmedLine)) {
        const dividerWidth = Math.min(maxWidth - indent.length, 50);
        result.push(`${indent}${theme.ui.muted('─'.repeat(dividerWidth))}`);
        continue;
      }

      // Handle markdown tables (lines starting with |)
      if (trimmedLine.startsWith('|') || /^[-|:]+$/.test(trimmedLine)) {
        // Table line - render with fixed width font styling
        const tablePrefix = firstNonEmpty ? bulletPrefix : indent;
        result.push(`${tablePrefix}${theme.ui.muted(trimmedLine)}`);
        firstNonEmpty = false;
        continue;
      }

      // Handle list items (- or * or numbered) - also handle -Item without space
      const listMatch = trimmedLine.match(/^(\*|-|•|\d+\.)\s*(.+)$/);
      if (listMatch && listMatch[2]) {
        const listContent = listMatch[2].trim();
        const formattedList = formatInlineText(listContent);
        const listBullet = theme.secondary('  • ');
        const listIndent = '    ';

        if (firstNonEmpty) {
          result.push(bulletPrefix.trimEnd());
          firstNonEmpty = false;
        }

        // Wrap list item content
        const words = formattedList.split(/\s+/);
        let current = '';
        let isFirstListLine = true;
        for (const word of words) {
          const candidate = current ? `${current} ${word}` : word;
          const prefixLen = this.visibleLength(isFirstListLine ? listBullet : listIndent);
          if (prefixLen + this.visibleLength(candidate) > maxWidth - 2 && current) {
            result.push(`${isFirstListLine ? listBullet : listIndent}${current}`);
            current = word;
            isFirstListLine = false;
          } else {
            current = candidate;
          }
        }
        if (current) {
          result.push(`${isFirstListLine ? listBullet : listIndent}${current}`);
        }
        continue;
      }

      // Regular paragraph - apply markdown formatting
      const formattedLine = formatInlineText(trimmedLine);

      const words = formattedLine.split(/\s+/);
      let current = '';
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        const prefixLength = this.visibleLength(firstNonEmpty ? bulletPrefix : indent);
        if (prefixLength + this.visibleLength(candidate) > maxWidth && current) {
          result.push(`${firstNonEmpty ? bulletPrefix : indent}${current}`);
          current = word;
          firstNonEmpty = false;
        } else {
          current = candidate;
        }
      }

      if (current) {
        result.push(`${firstNonEmpty ? bulletPrefix : indent}${current}`);
        firstNonEmpty = false;
      }
    }

    return result.join('\n') + '\n';
  }

  /**
   * Format a markdown header with Claude Code style visual hierarchy.
   */
  private formatMarkdownHeader(text: string, level: number, maxWidth: number, prefix: string): string {
    const formattedText = formatInlineText(text);

    switch (level) {
      case 1: {
        // H1: Bold cyan with decorative borders
        const headerWidth = Math.min(maxWidth - 4, this.visibleLength(formattedText) + 4);
        const topBorder = theme.primary('═'.repeat(headerWidth));
        const headerLine = theme.primary.bold(`◆ ${formattedText}`);
        return `${prefix}${topBorder}\n  ${headerLine}\n  ${topBorder}`;
      }
      case 2: {
        // H2: Bold with underline accent
        const headerLine = theme.info.bold(`▸ ${formattedText}`);
        const underline = theme.info('─'.repeat(Math.min(maxWidth - 4, this.visibleLength(formattedText) + 2)));
        return `${prefix}${headerLine}\n  ${underline}`;
      }
      case 3: {
        // H3: Bold with bullet prefix
        return `${prefix}${theme.secondary.bold(`◇ ${formattedText}`)}`;
      }
      case 4: {
        // H4: Dimmer bold
        return `${prefix}${theme.ui.muted('▹')} ${theme.bold(formattedText)}`;
      }
      default: {
        // H5+: Simple bold
        return `${prefix}${theme.bold(formattedText)}`;
      }
    }
  }

  /**
   * Format thinking block with premium visual design.
   * Uses a distinct visual style to clearly separate thinking from responses.
   * Enhanced with gradient labels, better typography, and visual hierarchy.
   *
   * In plain output mode we keep it simple and inline with the rest of the
   * stream so transcripts remain easy to scan.
   */
  private formatThinkingBlock(content: string): string {
    if (!content.trim()) return '';

    // Detect thought type for better labeling and visual styling
    const lower = content.toLowerCase();
    let label = 'thinking';
    let labelColor = theme.neon.cyan;
    let labelIcon = '💭';
    let thoughtType = 'default';

    // Detect initial acknowledgement
    if (lower.includes('acknowledge') || lower.includes('understand') ||
        lower.includes("user wants") || lower.includes("user is asking") ||
        lower.includes("the request") || lower.includes("i'll help")) {
      label = 'understood';
      labelColor = theme.success ?? theme.neon.green;
      labelIcon = '✅';
      thoughtType = 'acknowledgement';
    }
    // Detect planning thoughts
    else if (lower.includes('plan') || lower.includes('steps') ||
             lower.includes('first') || lower.includes('then') ||
             lower.includes('approach') || lower.includes('strategy')) {
      label = 'planning';
      labelColor = theme.info ?? theme.neon.blue;
      labelIcon = '🗺️';
      thoughtType = 'planning';
    }
    // Detect analysis/reasoning
    else if (lower.includes('analyzing') || lower.includes('examining') ||
             lower.includes('looking at') || lower.includes('reviewing')) {
      label = 'analyzing';
      labelColor = theme.warning ?? theme.neon.orange;
      labelIcon = '🔍';
      thoughtType = 'analysis';
    }
    // Detect tool selection/execution thoughts
    else if (lower.includes('tool') || lower.includes('read') || 
             lower.includes('edit') || lower.includes('search') ||
             lower.includes('bash') || lower.includes('execute')) {
      label = 'executing';
      labelColor = theme.toolColors.default ?? theme.neon.purple;
      labelIcon = '⚙️';
      thoughtType = 'execution';
    }
    // Detect completion/result thoughts
    else if (lower.includes('complete') || lower.includes('done') ||
             lower.includes('finished') || lower.includes('result')) {
      label = 'completed';
      labelColor = theme.success ?? theme.neon.green;
      labelIcon = '✓';
      thoughtType = 'completion';
    }

    const normalized = content.replace(/\s+/g, ' ').trim();
    
    // Enhanced bullet design with icon and gradient styling
    const bullet = '⏺';
    const coloredLabel = labelColor(`${labelIcon} ${label}`);
    
    // Format with premium styling
    return this.wrapBulletText(normalized, {
      label: coloredLabel,
      labelColor: (text) => text, // Already colored
      thoughtType,
    });
  }

  /**
   * Format assistant response with premium styling
   * Uses distinct visual style to clearly separate from thoughts
   */
  private formatAssistantResponse(content: string): string {
    if (!content.trim()) return '';

    // Clean content - remove any existing bullet prefixes
    const cleaned = content.replace(/^[⏺•○]\s*/, '').trim();
    if (!cleaned.trim()) return '';

    // Assistant styling with gradient and icon
    const bullet = '◆'; // Distinct from thought bullet (⏺)
    const label = 'assistant';
    const labelColor = theme.gradient.neon;
    const labelIcon = '✨';
    
    const coloredLabel = labelColor(`${labelIcon} ${label}`);
    
    // Format with premium styling
    return this.wrapBulletText(cleaned, {
      label: coloredLabel,
      labelColor: (text) => text, // Already colored
      thoughtType: 'assistant',
    });
  }

  private wrapTextToWidth(text: string, width: number): string[] {
    if (!text.trim()) return [''];
    const lines: string[] = [];
    const words = text.trim().split(/\s+/);
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (this.visibleLength(candidate) > width && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }

    if (current) {
      lines.push(current);
    }

    return lines;
  }

  /**
   * Format streaming elapsed time in Claude Code style: 3m 30s
   */
  private formatStreamingElapsed(): string | null {
    if (!this.streamingStartTime) return null;
    const elapsed = Math.floor((Date.now() - this.streamingStartTime) / 1000);
    if (elapsed < 5) return null; // Don't show for very short durations
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  }

  /**
   * Format a compact conversation block (Claude Code style)
   * Shows a visual separator with "history" label and ctrl+o hint
   */
  private formatCompactBlock(content: string, label: string = 'history'): string {
    const maxWidth = Math.min(this.cols, 80);
    const labelText = ` ${label} `;
    const padding = Math.max(0, maxWidth - labelText.length);
    const leftPad = Math.floor(padding / 2);
    const rightPad = Math.ceil(padding / 2);

    // Claude Code style: ══ history ═════════════
    const separator = theme.ui.muted('═'.repeat(leftPad) + labelText + '═'.repeat(rightPad));

    return `\n${separator}\n${content}\n`;
  }

  /**
   * Add a compact conversation block to the event queue
   * This displays a collapsed view with expansion hint (Claude Code style)
   */
  addCompactBlock(content: string, label: string = 'history'): void {
    const formattedContent = this.formatCompactBlock(content, label);
    this.eventQueue.push({
      type: 'response',
      rawType: 'response',
      content: formattedContent,
      timestamp: Date.now(),
      isCompacted: true,
    });
    if (!this.isProcessingQueue) {
      void this.processQueue();
    }
  }

  /**
   * Expand the most recent tool result inline (Ctrl+O support).
   * Pops from the collapsed results stack and displays full content.
   */
  expandLastToolResult(): boolean {
    // First try the new stack, fallback to old lastToolResult
    const collapsed = this.collapsedToolResults.pop();
    if (!collapsed && !this.lastToolResult) {
      return false;
    }

    const content = collapsed?.content || this.lastToolResult || '';
    const toolName = collapsed?.toolName || 'result';

    // Determine if this is structured output that shouldn't be word-wrapped
    const isStructured = this.isStructuredToolOutput(toolName, content);

    let rendered: string;
    if (isStructured) {
      // Preserve structured output (grep, bash, code output) - just indent, don't wrap
      rendered = this.formatStructuredToolOutput(toolName, content);
    } else {
      // Format prose/text with tool name label and word wrapping
      const label = `${toolName}`;
      rendered = this.wrapBulletText(content, { label, labelColor: theme.info });
    }

    this.eventQueue.push({
      type: 'response',
      rawType: 'response',
      content: rendered,
      timestamp: Date.now(),
      isCompacted: false,
    });

    // Clear lastToolResult if we used the stack
    if (collapsed) {
      this.lastToolResult = null;
    }

    if (!this.isProcessingQueue) {
      void this.processQueue();
    }
    return true;
  }

  /**
   * Check if tool output is structured (code, grep, file listings) that shouldn't be word-wrapped.
   */
  private isStructuredToolOutput(toolName: string, content: string): boolean {
    const tool = toolName.toLowerCase();
    // Tools that produce structured output
    if (['bash', 'grep', 'read', 'glob', 'execute_bash', 'search', 'find'].includes(tool)) {
      return true;
    }
    // Content patterns that indicate structured output
    // - File paths with colons (grep output): src/file.ts:123:
    // - Line numbers: "   1→" or "  42:"
    // - Code-like patterns
    if (/^\s*[\w./]+:\d+[:\s]/.test(content)) return true; // grep-style output
    if (/^\s*\d+[→:│|]\s/.test(content)) return true; // line-numbered output
    if (/^[│├└─┌┐┘┬┴┼╭╮╯╰]+/.test(content)) return true; // box drawing
    if (/^\s*[$>]\s+\w+/.test(content)) return true; // command prompt output
    return false;
  }

  /**
   * Format structured tool output preserving line structure.
   */
  private formatStructuredToolOutput(toolName: string, content: string): string {
    const lines = content.split('\n');
    const header = `⏺ ${theme.info(toolName)}${theme.ui.muted(' · expanded')}\n`;
    const indent = '  ';
    const maxWidth = this.safeWidth() - 4;

    const formattedLines = lines.map(line => {
      // Truncate overly long lines instead of wrapping (preserves structure)
      if (line.length > maxWidth) {
        return indent + line.slice(0, maxWidth - 1) + '…';
      }
      return indent + line;
    });

    return header + formattedLines.join('\n') + '\n';
  }

  /**
   * Get count of expandable collapsed results
   */
  getCollapsedResultCount(): number {
    return this.collapsedToolResults.length;
  }

  /**
   * Clear all collapsed results (e.g., on new conversation)
   */
  clearCollapsedResults(): void {
    this.collapsedToolResults = [];
    this.lastToolResult = null;
  }

  // ------------ Status / mode ------------

  setMode(mode: 'idle' | 'streaming'): void {
    const wasStreaming = this.mode === 'streaming';
    this.mode = mode;

    // Track streaming start time for elapsed display
    if (mode === 'streaming' && !wasStreaming) {
      this.streamingStartTime = Date.now();
      this.streamingTokens = 0; // Reset token count
      this.streamingContentBuffer = ''; // Reset streaming buffer
      this.streamingLinesWritten = 0;
      this.streamingInputQueue = []; // Clear any stale queued input
      // Clear inline panel when entering streaming mode to prevent stale menus
      if (this.inlinePanel.length > 0) {
        this.inlinePanel = [];
      }
      this.startSpinnerAnimation();
    } else if (mode === 'idle' && wasStreaming) {
      this.streamingStartTime = null;
      this.stopSpinnerAnimation();
    }

    if (wasStreaming && mode === 'idle') {
      // IMPORTANT: Clear the overlay BEFORE writing newline to prevent duplicate boxes
      // The old overlay would otherwise scroll into scrollback history
      if (!this.plainMode && this.lastOverlay) {
        this.clearPromptArea();
      }

      // Format accumulated streaming content as a premium assistant response
      if (this.streamingContentBuffer && this.streamingContentBuffer.trim()) {
        // Ensure we're on a fresh line
        if (!this.lastOutputEndedWithNewline) {
          this.write('\n');
          this.lastOutputEndedWithNewline = true;
        }
        
        // Format as premium assistant response
        const formattedResponse = this.formatAssistantResponse(this.streamingContentBuffer);
        if (formattedResponse.trim()) {
          this.write(formattedResponse);
        }
      } else if (!this.lastOutputEndedWithNewline) {
        // Finish streaming on a fresh line so the next prompt/event doesn't collide
        this.write('\n');
        this.lastOutputEndedWithNewline = true;
      }

      // Clear the buffer after processing
      this.streamingContentBuffer = '';
      this.streamingLinesWritten = 0;
      // Clear any remaining queued input (user didn't press Enter to queue it)
      this.streamingInputQueue = [];
    }

    if (!this.plainMode) {
      // Always render prompt to keep bottom UI persistent (rich mode only)
      this.renderPrompt();
    }
  }

  /**
   * Start the animated spinner for streaming status
   */
  private startSpinnerAnimation(): void {
    if (this.spinnerInterval) return; // Already running
    this.spinnerFrame = 0;
    this.activityStarFrame = 0;
    this.elapsedColorFrame = 0;
    this.spinnerInterval = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % spinnerFrames.braille.length;
      this.activityStarFrame = (this.activityStarFrame + 1) % this.activityStarFrames.length;
      // Update elapsed time color animation (slower cycle)
      if (this.spinnerFrame % 3 === 0) {
        this.elapsedColorFrame = (this.elapsedColorFrame + 1) % this.elapsedColorFrames.length;
      }
      // Re-render to show updated spinner/star frame
      if (!this.plainMode && this.mode === 'streaming') {
        this.renderPrompt();
      }
    }, 120); // ~8 FPS - reduced from 80ms to minimize flickering while keeping animation smooth
  }

  /**
   * Stop the animated spinner
   */
  private stopSpinnerAnimation(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
    this.spinnerFrame = 0;
    this.activityStarFrame = 0;
    this.activityMessage = null;
    this.elapsedColorFrame = 0;
  }

  /**
   * Set the activity message displayed with animated star
   * Example: "Ruminating…" shows as "✳ Ruminating… (esc to interrupt · 34s · ↑1.2k)"
   */
  setActivity(message: string | null): void {
    this.activityMessage = message;
    if (!this.plainMode) {
      this.renderPrompt();
    }
  }

  /**
   * Update the token count displayed in the activity line
   */
  updateStreamingTokens(tokens: number): void {
    this.streamingTokens = tokens;
  }

  /**
   * Format token count as compact string (e.g., 1.2k, 24k, 128k)
   */
  private formatTokenCount(tokens: number): string {
    if (tokens < 1000) return String(tokens);
    if (tokens < 10000) return `${(tokens / 1000).toFixed(1)}k`;
    return `${Math.round(tokens / 1000)}k`;
  }

  getMode(): 'idle' | 'streaming' {
    return this.mode;
  }

  updateStatus(message: string | null): void {
    this.updateStatusBundle({ main: message, override: null, streaming: null });
  }

  updateStatusBundle(
    status: { main?: string | null; override?: string | null; streaming?: string | null },
    options: { render?: boolean } = {}
  ): void {
    const prevStreaming = this.statusStreaming;
    let changed = false;
    let mainChanged = false;
    let overrideChanged = false;

    if (status.main !== undefined && status.main !== this.statusMessage) {
      this.statusMessage = status.main;
      changed = true;
      mainChanged = true;
    }
    if (status.override !== undefined && status.override !== this.statusOverride) {
      this.statusOverride = status.override;
      changed = true;
      overrideChanged = true;
    }

    const streamingChanged = status.streaming !== undefined && status.streaming !== prevStreaming;
    if (status.streaming !== undefined) {
      if (streamingChanged) {
        changed = true;
      }
      this.statusStreaming = status.streaming;
    }

    const streamingIntroduce =
      streamingChanged && prevStreaming === null && status.streaming !== null && this.mode === 'streaming';
    const streamingCleared =
      streamingChanged && status.streaming === null && this.mode === 'streaming';
    const onlyStreamingChanged = streamingChanged && !mainChanged && !overrideChanged;
    const skipStreamingRender =
      onlyStreamingChanged && this.mode === 'streaming' && !streamingIntroduce && !streamingCleared;

    const shouldRender = options.render !== false && changed && !skipStreamingRender;
    if (shouldRender) {
      this.renderPrompt();
    }
  }

  updateStatusMeta(
    meta: {
      model?: string;
      provider?: string;
      sessionTime?: string;
      contextPercent?: number;
      profile?: string;
      workspace?: string;
      directory?: string;
      writes?: string;
      sessionLabel?: string;
      thinkingLabel?: string;
      autosave?: boolean;
      version?: string;
      toolSummary?: string;
    },
    options: { render?: boolean } = {}
  ): void {
    const next = { ...this.statusMeta, ...meta };
    const changed = JSON.stringify(next) !== JSON.stringify(this.statusMeta);
    this.statusMeta = next;
    const shouldRender = options.render !== false && changed;
    if (shouldRender) {
      this.renderPrompt();
    }
  }

  updateModeToggles(state: Partial<ModeToggleState>): void {
    this.toggleState = { ...this.toggleState, ...state };
    if (
      !state.thinkingHotkey &&
      !state.criticalApprovalHotkey &&
      !state.autoContinueHotkey &&
      !state.debugHotkey
    ) {
      this.hotkeysInToggleLine.clear();
    }
    // Force next render to show updated toggle state
    this.forceNextRender = true;
    this.renderPromptImmediate();
  }

  /**
   * Update RL agent execution status for display in the UI.
   * Called during dual-RL mode to show active agent, module/step progress, and win statistics.
   */
  updateRLStatus(status: Partial<RLAgentStatus>): void {
    const next = { ...this.rlStatus, ...status };
    const changed = JSON.stringify(next) !== JSON.stringify(this.rlStatus);
    this.rlStatus = next;
    if (changed) {
      this.renderPrompt();
    }
  }

  /**
   * Clear RL agent status (e.g., when RL run completes).
   */
  clearRLStatus(): void {
    this.rlStatus = {};
    this.renderPrompt();
  }

  /**
   * Get current RL status for external access.
   */
  getRLStatus(): Readonly<RLAgentStatus> {
    return this.rlStatus;
  }

  /**
   * Update secure TAO tools status for display in the UI.
   * Tracks Execute, Probe, State tools with enhanced output formatting.
   */
  updateSecureToolsStatus(status: Partial<SecureToolsStatus>): void {
    const next = { ...this.secureToolsStatus, ...status };
    const changed = JSON.stringify(next) !== JSON.stringify(this.secureToolsStatus);
    this.secureToolsStatus = next;
    if (changed) {
      this.renderPrompt();
    }
  }

  /**
   * Record a secure tool invocation for tracking.
   */
  recordSecureToolInvocation(
    tool: 'Execute' | 'Probe' | 'State' | 'Transform' | 'TaoOps',
    details?: { command?: string; exitCode?: number; target?: string; services?: number; action?: 'get' | 'set'; keysCount?: number }
  ): void {
    const invocations = (this.secureToolsStatus.totalInvocations || 0) + 1;
    const updates: Partial<SecureToolsStatus> = {
      lastToolUsed: tool,
      totalInvocations: invocations,
    };

    if (tool === 'Execute' && details) {
      updates.execute = {
        active: true,
        lastCommand: details.command,
        lastExitCode: details.exitCode,
        execCount: (this.secureToolsStatus.execute?.execCount || 0) + 1,
      };
    } else if (tool === 'Probe' && details) {
      updates.probe = {
        active: true,
        lastTarget: details.target,
        servicesFound: details.services,
        probeCount: (this.secureToolsStatus.probe?.probeCount || 0) + 1,
      };
    } else if (tool === 'State' && details) {
      updates.state = {
        active: true,
        lastAction: details.action,
        keysStored: details.keysCount,
        persistent: true,
      };
    }

    this.updateSecureToolsStatus(updates);
  }

  /**
   * Get current secure tools status for external access.
   */
  getSecureToolsStatus(): Readonly<SecureToolsStatus> {
    return this.secureToolsStatus;
  }

  setInlinePanel(lines: string[]): void {
    const normalized = (lines ?? []).map(line => line.replace(/\s+$/g, ''));
    const hasContent = normalized.some((line) => line.trim().length > 0);
    if (!hasContent) {
      if (this.inlinePanel.length) {
        this.inlinePanel = [];
        this.renderPrompt();
      }
      return;
    }
    const limited = this.limitInlinePanel(normalized);
    if (JSON.stringify(limited) === JSON.stringify(this.inlinePanel)) {
      return;
    }
    this.inlinePanel = limited;
    this.renderPrompt();
  }

  supportsInlinePanel(): boolean {
    return this.interactive && !this.plainMode;
  }

  clearInlinePanel(): void {
    if (!this.inlinePanel.length) return;
    this.inlinePanel = [];
    this.renderPrompt();
  }

  /**
   * Show an interactive menu with arrow key navigation (Claude Code style).
   * Menu is displayed in the inline panel area and intercepts arrow/enter keys.
   * @param items - Menu items to display
   * @param options - Menu options (title, initialIndex)
   * @param callback - Called when user selects an item (or null if cancelled)
   */
  setMenu(
    items: MenuItem[],
    options: { title?: string; initialIndex?: number } = {},
    callback: (item: MenuItem | null) => void
  ): void {
    if (!this.supportsInlinePanel()) {
      // Non-interactive mode - just call callback with first item or null
      callback(items[0] ?? null);
      return;
    }

    this.menuItems = items;
    this.menuIndex = options.initialIndex ?? items.findIndex(i => i.isActive) ?? 0;
    if (this.menuIndex < 0) this.menuIndex = 0;
    this.menuTitle = options.title ?? null;
    this.menuCallback = callback;
    this.renderMenuPanel();
  }

  /**
   * Close the active menu without selecting anything.
   */
  closeMenu(): void {
    if (!this.isMenuActive()) return;
    const callback = this.menuCallback;
    this.menuItems = [];
    this.menuIndex = 0;
    this.menuTitle = null;
    this.menuCallback = null;
    this.clearInlinePanel();
    callback?.(null);
  }

  /**
   * Check if an interactive menu is currently active.
   */
  isMenuActive(): boolean {
    return this.menuItems.length > 0 && this.menuCallback !== null;
  }

  /**
   * Render the menu to the inline panel.
   */
  private renderMenuPanel(): void {
    if (!this.isMenuActive()) return;

    const lines: string[] = [];

    // Title
    if (this.menuTitle) {
      lines.push(chalk.bold.hex('#8B5CF6')(this.menuTitle));
      lines.push('');
    }

    // Menu items with selection indicator
    for (let i = 0; i < this.menuItems.length; i++) {
      const item = this.menuItems[i]!;
      const isSelected = i === this.menuIndex;
      const isDisabled = item.disabled;
      const isActive = item.isActive;

      let line = '';

      // Selection indicator
      if (isSelected) {
        line += chalk.hex('#22D3EE')('❯ ');
      } else {
        line += '  ';
      }

      // Label with styling
      if (isDisabled) {
        line += chalk.dim(item.label);
      } else if (isSelected) {
        line += chalk.bold.hex('#22D3EE')(item.label);
      } else if (isActive) {
        line += chalk.hex('#34D399')(item.label);
      } else {
        line += chalk.white(item.label);
      }

      // Active indicator
      if (isActive) {
        line += chalk.dim(' (current)');
      }

      // Description
      if (item.description) {
        const desc = isDisabled ? chalk.dim(item.description) : chalk.dim(` - ${item.description}`);
        line += desc;
      }

      lines.push(line);
    }

    // Hint
    lines.push('');
    lines.push(chalk.dim('↑↓ navigate • enter select • esc cancel'));

    this.setInlinePanel(lines);
  }

  /**
   * Navigate menu selection.
   * @returns true if menu consumed the navigation
   */
  private navigateMenu(direction: number): boolean {
    if (!this.isMenuActive()) return false;

    // Find next non-disabled item
    let newIndex = this.menuIndex;
    let attempts = 0;
    const maxAttempts = this.menuItems.length;

    do {
      newIndex = (newIndex + direction + this.menuItems.length) % this.menuItems.length;
      attempts++;
    } while (this.menuItems[newIndex]?.disabled && attempts < maxAttempts);

    if (newIndex !== this.menuIndex) {
      this.menuIndex = newIndex;
      this.renderMenuPanel();
    }

    return true;
  }

  /**
   * Select the currently highlighted menu item.
   * @returns true if menu consumed the selection
   */
  private selectMenuItem(): boolean {
    if (!this.isMenuActive()) return false;

    const item = this.menuItems[this.menuIndex];
    if (!item || item.disabled) return true; // Consume but don't select

    const callback = this.menuCallback;
    this.menuItems = [];
    this.menuIndex = 0;
    this.menuTitle = null;
    this.menuCallback = null;
    this.clearInlinePanel();
    callback?.(item);

    return true;
  }

  private limitInlinePanel(lines: string[]): string[] {
    const maxLines = Math.max(4, Math.min(this.maxInlinePanelLines, Math.max(2, this.rows - 8)));
    if (lines.length <= maxLines) {
      return lines;
    }
    const overflow = lines.length - maxLines;
    const indicator = theme.ui.muted(`… ${overflow} more lines`);
    const tailCount = Math.max(1, maxLines - 1);
    const tail = lines.slice(-tailCount);
    return [indicator, ...tail];
  }

  // ------------ Prompt rendering ------------

  private renderPrompt(): void {
    // Don't render if disposed or still initializing (before banner shown)
    if (this.disposed || this.initializing) return;

    // Throttle renders to prevent excessive redraws during rapid input
    const now = Date.now();
    if (now - this.lastRenderTime < this.renderThrottleMs) {
      if (!this.pendingRender) {
        this.pendingRender = true;
        // Track the timer for cleanup
        this.renderThrottleTimer = setTimeout(() => {
          this.renderThrottleTimer = null;
          this.pendingRender = false;
          if (!this.disposed) {
            this.renderPromptImmediate();
          }
        }, this.renderThrottleMs);
      }
      return;
    }
    this.renderPromptImmediate();
  }

  private renderPromptImmediate(): void {
    // Don't render if disposed or still initializing (before banner shown)
    if (this.disposed || this.initializing) return;

    // Performance optimization: Skip render if nothing changed (during idle mode only)
    // During streaming mode, we need to update animations and status
    if (!this.forceNextRender &&
        this.mode === 'idle' &&
        this.buffer === this.lastRenderedBuffer &&
        this.cursor === this.lastRenderedCursor &&
        this.mode === this.lastRenderedMode &&
        this.lastOverlay !== null) {
      // Content unchanged, skip expensive re-render
      return;
    }
    this.forceNextRender = false;

    // Suppress render during paste burst to prevent visual leak
    // Only allow render if we have a collapsed paste to show
    const now = Date.now();
    const burstActive = this.pasteBurstWindowStart > 0 && now - this.pasteBurstWindowStart <= this.plainPasteWindowMs;
    const inEmitPaste = this.emitPasteBuffer.length > 0 || this.emitPasteTimer !== null;
    if ((burstActive || this.inPlainPaste || this.inBracketedPaste || inEmitPaste) && !this.collapsedPaste) {
      return;
    }

    this.lastRenderTime = Date.now();
    this.lastRenderedBuffer = this.buffer;
    this.lastRenderedCursor = this.cursor;
    this.lastRenderedMode = this.mode;

    if (!this.interactive) {
      this.isPromptActive = false;
      return;
    }

    if (this.promptRenderingSuspended) {
      this.isPromptActive = false;
      return;
    }

    if (this.plainMode) {
      const line = `> ${this.buffer}`;
      if (!this.isPromptActive && !this.lastOutputEndedWithNewline) {
        this.write('\n');
        this.lastOutputEndedWithNewline = true;
      }
      this.write(`\r${ESC.CLEAR_LINE}${line}`);
      this.cursorVisibleColumn = line.length + 1;
      this.hasRenderedPrompt = true;
      this.isPromptActive = true;
      this.lastOutputEndedWithNewline = false; // prompt ends mid-line by design
      this.promptHeight = 1;
      return;
    }

    if (!this.allowPromptRender) {
      return;
    }

    // Rich inline mode: prompt flows naturally with content
    this.updateTerminalSize();
    const maxWidth = this.safeWidth();
    this.lastRenderWidth = maxWidth;

    const overlay = this.buildOverlayLines();
    if (!overlay.lines.length) {
      return;
    }

    const renderedLines = overlay.lines.map(line => this.truncateLine(line, maxWidth));
    if (!renderedLines.length) {
      return;
    }

    const promptIndex = Math.max(0, Math.min(overlay.promptIndex, renderedLines.length - 1));
    const height = renderedLines.length;

    // Batch all ANSI operations into a single write to prevent flickering
    // This eliminates the visual jitter caused by multiple sequential terminal writes
    const buffer: string[] = [];

    // Hide cursor during render to prevent visual artifacts
    buffer.push('\x1b[?25l');

    // Clear previous prompt and handle height changes
    // IMPORTANT: Only clear if we have valid overlay state to avoid cursor position bugs
    // that cause separator lines to accumulate in scrollback
    if (this.hasEverRenderedOverlay && this.lastOverlayHeight > 0 && this.lastOverlay !== null) {
      // Move up from prompt row to top of overlay
      const linesToTop = this.lastOverlay.promptIndex;
      if (linesToTop > 0) {
        buffer.push(`\x1b[${linesToTop}A`);
      }

      // Clear exactly the old overlay lines using atomic escape sequence batch
      const clearHeight = this.lastOverlayHeight;
      for (let i = 0; i < clearHeight; i++) {
        buffer.push('\r');
        buffer.push(ESC.CLEAR_LINE);
        if (i < clearHeight - 1) {
          buffer.push('\x1b[B');
        }
      }

      // Clear anything below the old overlay (handles edge cases)
      buffer.push('\x1b[J');

      // After clearing, cursor is at last cleared line
      // Move back up to the top where new overlay should start
      const moveBackUp = clearHeight - 1;
      if (moveBackUp > 0) {
        buffer.push(`\x1b[${moveBackUp}A`);
      }
    } else if (this.hasEverRenderedOverlay) {
      // Overlay was cleared but we're re-rendering - ensure clean slate
      // Use erase-to-end-of-screen from current position
      buffer.push('\r');
      buffer.push('\x1b[J');
    }

    // Write prompt lines (no trailing newline on last line)
    for (let i = 0; i < renderedLines.length; i++) {
      buffer.push('\r');
      buffer.push(ESC.CLEAR_LINE);
      buffer.push(renderedLines[i] || '');
      if (i < renderedLines.length - 1) {
        buffer.push('\n');
      }
    }

    // If old overlay was taller, clear any remaining stale lines below
    // and use CSI J (erase from cursor to end of screen) to clean up
    if (this.lastOverlayHeight > height) {
      buffer.push('\n'); // Move to line below last content
      buffer.push('\x1b[J'); // Clear from cursor to end of screen
      buffer.push('\x1b[A'); // Move back up to last content line
    }

    // Position cursor at prompt input line
    const promptCol = Math.min(Math.max(1, 3 + this.cursor), this.cols || 80);
    // Cursor is now at the last line. Move up to the prompt row.
    const linesToMoveUp = height - 1 - promptIndex;
    if (linesToMoveUp > 0) {
      buffer.push(`\x1b[${linesToMoveUp}A`);
    }
    buffer.push(`\x1b[${promptCol}G`);

    // Show cursor again after positioning
    buffer.push('\x1b[?25h');

    // Single atomic write to prevent flickering
    this.write(buffer.join(''));

    this.cursorVisibleColumn = promptCol;
    this.hasRenderedPrompt = true;
    this.hasEverRenderedOverlay = true;
    this.isPromptActive = true;
    this.lastOverlayHeight = height;
    this.lastOverlay = { lines: renderedLines, promptIndex };
    this.lastOutputEndedWithNewline = false;
    this.promptHeight = height;
  }

  private buildOverlayLines(): { lines: string[]; promptIndex: number } {
    const lines: string[] = [];
    const maxWidth = this.safeWidth();
    // Simple horizontal divider - clean and reliable
    const divider = theme.ui.muted('─'.repeat(maxWidth));

    const fallbackActivity = (() => {
      const raw = this.statusStreaming || this.statusOverride || this.statusMessage;
      if (!raw) return null;
      const cleaned = this.stripAnsi(raw).replace(/^[⏺•]\s*/, '').trim();
      return cleaned || null;
    })();

    // Activity line (only when streaming) - shows: ◐ Working… (esc to interrupt · 34s)
    if (this.mode === 'streaming' && (this.activityMessage || fallbackActivity)) {
      // Clean spinner animation using braille dots + shimmer accent for a richer feel
      const spinnerChars = spinnerFrames.braille;
      const spinnerChar = spinnerChars[this.spinnerFrame % spinnerChars.length] ?? '⠋';
      const starChar = this.activityStarFrames[this.activityStarFrame % this.activityStarFrames.length] ?? '✶';
      const spinnerDecorated = `${theme.info(spinnerChar)}${theme.accent ? theme.accent(starChar) : starChar}`;
      const elapsed = this.formatStreamingElapsed();
      const genericActivities = ['Streaming', 'Thinking', 'Processing'];
      let displayActivity = this.activityMessage || fallbackActivity || '';
      if (genericActivities.includes(displayActivity) && fallbackActivity) {
        displayActivity = fallbackActivity;
      }
      if (!displayActivity.trim()) {
        displayActivity = fallbackActivity || 'Working';
      }
      const needsEllipsis = !displayActivity.trimEnd().endsWith('…') && !displayActivity.trimEnd().endsWith('...');
      // Format: ⠋ Working… (esc to interrupt · 1m 19s · ↑1.2k tokens)
      // Build parts with animated elapsed time color
      const elapsedColor = chalk.hex(this.elapsedColorFrames[this.elapsedColorFrame % this.elapsedColorFrames.length] ?? '#F59E0B');
      const parts: string[] = ['esc to interrupt'];
      if (elapsed) parts.push(elapsedColor(elapsed));
      if (this.streamingTokens > 0) {
        parts.push(`↑${this.formatTokenCount(this.streamingTokens)} tokens`);
      }
      const prefix = `${spinnerDecorated} `;
      const activityText = `${displayActivity.trim()}${needsEllipsis ? '…' : ''}`;
      const suffix = ` ${theme.ui.muted('(')}${parts.join(theme.ui.muted(' · '))}${theme.ui.muted(')')}`;

      // Build the full activity line with animated color for elapsed time
      const activityLine = `${prefix}${activityText}${suffix}`;

      // Always show full text - wrap to multiple lines if needed
      const indent = ' '.repeat(this.visibleLength(prefix));
      const wrapped = this.wrapOverlayLine(activityLine, maxWidth, indent);
      lines.push(...wrapped);
    }

    // Top divider
    lines.push(divider);

    // Input prompt line
    const promptIndex = lines.length;
    const inputLine = this.buildInputLine();
    // Handle multi-line input by splitting on newlines
    // Filter out empty lines to prevent duplicate divider appearance from leading/trailing newlines
    const inputLines = inputLine.split('\n').filter((line, idx, arr) => {
      // Keep non-empty lines, but preserve single empty line if it's intentional (e.g., between content)
      // Only filter leading/trailing empty lines
      if (line.trim() === '') {
        // Filter if it's the first line (leading empty) or last line (trailing empty)
        if (idx === 0 || idx === arr.length - 1) return false;
      }
      return true;
    });
    // Ensure at least one line for the prompt
    if (inputLines.length === 0) {
      inputLines.push(theme.primary('> '));
    }
    for (const line of inputLines) {
      lines.push(this.truncateLine(line, maxWidth));
    }

    // Bottom divider
    lines.push(divider);

    // Inline panel (pinned scroll box for live output/menus)
    if (this.inlinePanel.length > 0) {
      for (const panelLine of this.inlinePanel) {
        lines.push(this.truncateLine(`  ${panelLine}`, maxWidth));
      }
      // Separate inline content from suggestions/toggles
      lines.push(divider);
    }

    // Slash command suggestions
    if (this.suggestions.length > 0) {
      for (let index = 0; index < this.suggestions.length; index++) {
        const suggestion = this.suggestions[index]!;
        const isActive = index === this.suggestionIndex;
        const marker = isActive ? theme.primary('▸') : theme.ui.muted(' ');
        const cmdText = isActive ? theme.primary(suggestion.command) : theme.ui.muted(suggestion.command);
        const descText = isActive ? suggestion.description : theme.ui.muted(suggestion.description);
        lines.push(this.truncateLine(`  ${marker} ${cmdText} — ${descText}`, maxWidth));
      }
    }

    // Compact status line: model · context% · profile · dir
    const compactStatus = this.buildCompactStatusLine();
    if (compactStatus) {
      lines.push(this.truncateLine(`  ${compactStatus}`, maxWidth));
    }

    // Mode toggles (compact single line when possible)
    const toggleLine = this.buildToggleLine();
    if (toggleLine) {
      lines.push(this.truncateLine(`  ${toggleLine}`, maxWidth));
    }

    // Keyboard shortcuts line (shows shortcuts not already visible in toggle line)
    const shortcutLine = this.buildShortcutLine();
    if (shortcutLine) {
      lines.push(this.truncateLine(`  ${shortcutLine}`, maxWidth));
    }

    return { lines, promptIndex };
  }

  /**
   * Build a single compact status line with all essential info
   * Format: deepseek-reasoner · ░░░░░░ 5% · agi-code · ~/GitHub
   */
  private buildCompactStatusLine(): string | null {
    const parts: string[] = [];

    // Model (compact: just model name, not provider/model)
    const model = this.statusMeta.model || this.statusMeta.provider;
    if (model) {
      parts.push(theme.info(model));
    }

    // Context meter (compact mini bar)
    if (this.statusMeta.contextPercent !== undefined) {
      const used = clampPercentage(this.statusMeta.contextPercent);
      const barWidth = 5;
      const filled = Math.round((used / 100) * barWidth);
      const empty = Math.max(0, barWidth - filled);
      const barColor = getContextColor(used, {
        error: theme.error,
        warning: theme.warning,
        info: theme.info,
        success: theme.success,
      });
      const bar = barColor('█'.repeat(filled)) + theme.ui.muted('░'.repeat(empty));
      parts.push(`${bar} ${barColor(`${used}%`)}`);
    }

    // Profile (if set)
    if (this.statusMeta.profile) {
      parts.push(theme.secondary(this.statusMeta.profile));
    }

    // Directory (abbreviated)
    const workspace = this.statusMeta.workspace || this.statusMeta.directory;
    if (workspace) {
      parts.push(theme.ui.muted(this.abbreviatePath(workspace)));
    }

    return parts.length > 0 ? parts.join(theme.ui.muted(' · ')) : null;
  }

  private buildChromeLines(): string[] {
    const maxWidth = this.safeWidth();
    const statusLines = this.buildStatusBlock(maxWidth);
    const metaLines = this.buildMetaBlock(maxWidth);
    return [...statusLines, ...metaLines];
  }

  private abbreviatePath(pathValue: string): string {
    const home = homedir();
    if (home && pathValue.startsWith(home)) {
      return pathValue.replace(home, '~');
    }
    return pathValue;
  }

  private buildStatusBlock(maxWidth: number): string[] {
    const segments: string[] = [];

    // Skip status label when streaming - the activity line already shows the animated status
    // This prevents duplicate "Thinking..." displays
    if (this.mode !== 'streaming') {
      const statusLabel = this.composeStatusLabel();
      if (statusLabel) {
        segments.push(`${theme.ui.muted('status')} ${this.applyTone(statusLabel.text, statusLabel.tone)}`);
      }
    }

    if (this.statusMeta.sessionTime) {
      segments.push(`${theme.ui.muted('runtime')} ${theme.ui.muted(this.statusMeta.sessionTime)}`);
    }

    if (this.statusMeta.contextPercent !== undefined) {
      // Use animated context meter for smooth color transitions
      this.contextMeter.update(this.statusMeta.contextPercent);
      segments.push(this.contextMeter.render());
    }

    return segments.length > 0 ? this.wrapSegments(segments, maxWidth) : [];
  }

  private buildMetaBlock(maxWidth: number): string[] {
    const segments: string[] = [];

    if (this.statusMeta.profile) {
      segments.push(this.formatMetaSegment('profile', this.statusMeta.profile, 'info'));
    }

    const model = this.statusMeta.provider && this.statusMeta.model
      ? `${this.statusMeta.provider} / ${this.statusMeta.model}`
      : this.statusMeta.model || this.statusMeta.provider;
    if (model) {
      segments.push(this.formatMetaSegment('model', model, 'info'));
    }

    const workspace = this.statusMeta.workspace || this.statusMeta.directory;
    if (workspace) {
      segments.push(this.formatMetaSegment('dir', this.abbreviatePath(workspace), 'muted'));
    }

    if (this.statusMeta.writes) {
      segments.push(this.formatMetaSegment('writes', this.statusMeta.writes, 'muted'));
    }

    if (this.statusMeta.toolSummary) {
      segments.push(this.formatMetaSegment('tools', this.statusMeta.toolSummary, 'muted'));
    }

    if (this.statusMeta.sessionLabel) {
      segments.push(this.formatMetaSegment('session', this.statusMeta.sessionLabel, 'muted'));
    }

    if (this.statusMeta.version) {
      segments.push(this.formatMetaSegment('build', `v${this.statusMeta.version}`, 'muted'));
    }

    // Add RL agent status when dual-RL mode is active
    const rlSegments = this.buildRLStatusSegments();
    if (rlSegments.length > 0) {
      segments.push(...rlSegments);
    }

    // Add secure TAO tools status
    const secureToolsSegments = this.buildSecureToolsSegments();
    if (secureToolsSegments.length > 0) {
      segments.push(...secureToolsSegments);
    }

    if (segments.length === 0) {
      return [];
    }

    return this.wrapSegments(segments, maxWidth);
  }

  /**
   * Build RL agent status segments for display during dual-RL execution.
   * Shows: tournament scoreboard, active agent, module/step progress, and scores.
   */
  private buildRLStatusSegments(): string[] {
    const segments: string[] = [];
    const rl = this.rlStatus;

    // Only show RL status when there's meaningful data
    if (!rl.activeVariant && !rl.wins && !rl.currentModule) {
      return segments;
    }

    // Tournament scoreboard (always show when wins exist)
    if (rl.wins && (rl.wins.primary > 0 || rl.wins.refiner > 0 || rl.wins.ties > 0)) {
      const totalGames = rl.wins.primary + rl.wins.refiner + rl.wins.ties;
      const leader = rl.wins.primary > rl.wins.refiner ? 'primary' :
                     rl.wins.refiner > rl.wins.primary ? 'refiner' : 'tie';

      // Scoreboard with colors based on leader
      const pColor = leader === 'primary' ? theme.success : theme.info;
      const rColor = leader === 'refiner' ? theme.success : theme.warning;
      const pScore = pColor(`${rl.wins.primary}`);
      const rScore = rColor(`${rl.wins.refiner}`);

      // Trophy for leader
      const trophy = leader === 'primary' ? theme.info('🏆') :
                     leader === 'refiner' ? theme.warning('🏆') : '⚖️';

      // Win streak indicator
      const streakText = rl.streak && rl.streak > 1 ? theme.ui.muted(` 🔥${rl.streak}`) : '';

      segments.push(`${trophy}${pScore}${theme.ui.muted(':')}${rScore}${streakText}`);

      // Progress bar showing relative wins
      if (totalGames > 0) {
        const barWidth = 8;
        const pBars = Math.round((rl.wins.primary / totalGames) * barWidth);
        const rBars = Math.round((rl.wins.refiner / totalGames) * barWidth);
        const tBars = Math.max(0, barWidth - pBars - rBars);
        const bar = theme.info('█'.repeat(pBars)) +
                    theme.ui.muted('░'.repeat(tBars)) +
                    theme.warning('█'.repeat(rBars));
        segments.push(`[${bar}]`);
      }
    }

    // Active variant indicator
    if (rl.activeVariant) {
      const isParallel = rl.parallelExecution;
      if (isParallel) {
        // Both running in parallel
        segments.push(`${theme.info('⚡P')} ${theme.ui.muted('∥')} ${theme.warning('⚡R')}`);
      } else {
        const variantIcon = rl.activeVariant === 'primary' ? '▶' : '▷';
        const variantLabel = rl.activeVariant === 'primary' ? 'P' : 'R';
        const variantColor = rl.activeVariant === 'primary' ? theme.info : theme.warning;
        segments.push(`${variantIcon}${variantColor(variantLabel)}`);
      }
    }

    // Last winner indicator
    if (rl.lastWinner && rl.lastWinner !== 'tie') {
      const winnerIcon = rl.lastWinner === 'primary' ? theme.info('✓P') : theme.warning('✓R');
      segments.push(winnerIcon);
    } else if (rl.lastWinner === 'tie') {
      segments.push(theme.ui.muted('≈'));
    }

    // Current module/step (compact)
    if (rl.currentModule || rl.currentStep) {
      const stepText = rl.currentStep || rl.currentModule || '';
      if (stepText) {
        segments.push(theme.ui.muted(this.truncateMiddle(stepText, 15)));
      }
    }

    // Progress indicator (steps completed / total)
    if (typeof rl.stepsCompleted === 'number' && typeof rl.totalSteps === 'number' && rl.totalSteps > 0) {
      const pct = Math.round((rl.stepsCompleted / rl.totalSteps) * 100);
      segments.push(theme.ui.muted(`${pct}%`));
    }

    // Current reward scores (compact, only during active comparison)
    if (rl.scores && (typeof rl.scores.primary === 'number' || typeof rl.scores.refiner === 'number')) {
      const pScore = typeof rl.scores.primary === 'number' ? rl.scores.primary.toFixed(2) : '-';
      const rScore = typeof rl.scores.refiner === 'number' ? rl.scores.refiner.toFixed(2) : '-';
      const pVal = rl.scores.primary ?? 0;
      const rVal = rl.scores.refiner ?? 0;
      const pDisplay = pVal > rVal ? theme.success(pScore) : theme.info(pScore);
      const rDisplay = rVal > pVal ? theme.success(rScore) : theme.warning(rScore);
      segments.push(`${pDisplay}${theme.ui.muted('/')}${rDisplay}`);
    }

    // Human accuracy indicator (relative ranking quality)
    if (rl.accuracy && (typeof rl.accuracy.primary === 'number' || typeof rl.accuracy.refiner === 'number')) {
      const pAcc = rl.accuracy.primary !== undefined ? Math.round(rl.accuracy.primary * 100) : null;
      const rAcc = rl.accuracy.refiner !== undefined ? Math.round(rl.accuracy.refiner * 100) : null;
      const pDisplay = pAcc !== null ? theme.info(`P${pAcc}%`) : null;
      const rDisplay = rAcc !== null ? theme.warning(`R${rAcc}%`) : null;
      const parts = [pDisplay, rDisplay].filter(Boolean).join(theme.ui.muted('|'));
      if (parts) {
        segments.push(parts);
      }
    }

    return segments;
  }

  /**
   * Build secure TAO tools status segments for display.
   * Shows: toolkit status, tool invocation counts, and last tool used.
   */
  private buildSecureToolsSegments(): string[] {
    const segments: string[] = [];
    const st = this.secureToolsStatus;

    // Only show status when tools have been used
    if (!st.totalInvocations && !st.lastToolUsed) {
      // Show toolkit ready indicator even when no invocations
      if (st.toolkitReady) {
        segments.push(theme.success('🔒') + theme.ui.muted(' TAO'));
      }
      return segments;
    }

    // Security indicator with sanitization status
    const secIcon = st.sanitizationActive ? theme.success('🔒') : theme.warning('⚠');
    segments.push(secIcon);

    // Tool status indicators (compact format)
    const toolIndicators: string[] = [];

    if (st.execute?.active) {
      const execIcon = st.execute.lastExitCode === 0 ? theme.success('✓') : theme.error('✗');
      const execCount = st.execute.execCount || 0;
      toolIndicators.push(`${theme.info('Ex')}${execIcon}${execCount > 1 ? theme.ui.muted(`×${execCount}`) : ''}`);
    }

    if (st.probe?.active) {
      const svcCount = st.probe.servicesFound || 0;
      toolIndicators.push(`${chalk.cyan('Pr')}${theme.success('✓')}${svcCount > 0 ? theme.ui.muted(`[${svcCount}]`) : ''}`);
    }

    if (st.state?.active) {
      const stateIcon = st.state.persistent ? theme.success('💾') : theme.info('📝');
      const keysCount = st.state.keysStored || 0;
      toolIndicators.push(`${stateIcon}${keysCount > 0 ? theme.ui.muted(`${keysCount}k`) : ''}`);
    }

    if (toolIndicators.length > 0) {
      segments.push(toolIndicators.join(theme.ui.muted('·')));
    }

    // Total invocations counter
    if (st.totalInvocations && st.totalInvocations > 0) {
      segments.push(theme.ui.muted(`Σ${st.totalInvocations}`));
    }

    // Last tool used indicator
    if (st.lastToolUsed) {
      const toolColors: Record<string, (s: string) => string> = {
        Execute: theme.info,
        Probe: (s: string) => chalk.cyan(s),
        State: theme.success,
        Transform: theme.warning,
        TaoOps: (s: string) => chalk.magenta(s),
      };
      const color = toolColors[st.lastToolUsed] || theme.ui.muted;
      segments.push(color(`→${st.lastToolUsed.slice(0, 2)}`));
    }

    return segments;
  }

  /**
   * Truncate a string in the middle, showing start and end with ellipsis.
   */
  private truncateMiddle(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    const keepLen = Math.floor((maxLen - 3) / 2);
    return `${text.slice(0, keepLen)}...${text.slice(-keepLen)}`;
  }

  private composeStatusLabel(): { text: string; tone: 'success' | 'info' | 'warn' | 'error' } | null {
    const statuses = [this.statusStreaming, this.statusOverride, this.statusMessage].filter(
      (value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index
    );
    const text = statuses.length > 0 ? statuses.join(' / ') : 'Ready for prompts';
    if (!text.trim()) {
      return null;
    }
    const normalized = text.toLowerCase();
    const tone: 'success' | 'info' | 'warn' | 'error' = normalized.includes('ready') ? 'success' : 'info';
    return { text, tone };
  }

  private formatMetaSegment(
    label: string,
    value: string,
    tone: 'info' | 'success' | 'warn' | 'error' | 'muted'
  ): string {
    const colorizer =
      tone === 'success'
        ? theme.success
        : tone === 'warn'
          ? theme.warning
          : tone === 'error'
            ? theme.error
            : tone === 'muted'
              ? theme.ui.muted
              : theme.info;
    return `${theme.ui.muted(label)} ${colorizer(value)}`;
  }

  private applyTone(text: string, tone: 'success' | 'info' | 'warn' | 'error'): string {
    switch (tone) {
      case 'success':
        return theme.success(text);
      case 'warn':
        return theme.warning(text);
      case 'error':
        return theme.error(text);
      case 'info':
      default:
        return theme.info(text);
    }
  }

  private wrapSegments(segments: string[], maxWidth: number): string[] {
    const lines: string[] = [];
    const separator = theme.ui.muted('  |  ');

    let current = '';
    for (const segment of segments) {
      const normalized = segment.trim();
      if (!normalized) continue;
      if (!current) {
        current = this.truncateLine(normalized, maxWidth);
        continue;
      }
      const candidate = `${current}${separator}${normalized}`;
      if (this.visibleLength(candidate) <= maxWidth) {
        current = candidate;
      } else {
        lines.push(this.truncateLine(current, maxWidth));
        current = this.truncateLine(normalized, maxWidth);
      }
    }

    if (current) {
      lines.push(this.truncateLine(current, maxWidth));
    }

    return lines;
  }

  private buildControlLines(): string[] {
    const lines: string[] = [];
    const toggleLine = this.buildToggleLine();
    if (toggleLine) {
      lines.push(`${theme.ui.muted('modes')} ${theme.ui.muted('›')} ${toggleLine}`);
    }

    const shortcutLine = this.buildShortcutLine();
    if (shortcutLine) {
      lines.push(`${theme.ui.muted('keys')}  ${shortcutLine}`);
    }

    return lines;
  }

  private buildToggleLine(): string | null {
    const toggles: Array<{
      label: string;
      on: boolean;
      value?: string;
      hotkey?: string | null;
    }> = [];

    const addToggle = (label: string, on: boolean, hotkey?: string, value?: string) => {
      toggles.push({ label, on, hotkey: this.formatHotkey(hotkey), value });
    };

    const approvalMode = this.toggleState.criticalApprovalMode || 'auto';
    const approvalActive = approvalMode !== 'auto';
    addToggle(
      'Approvals',
      approvalActive,
      this.toggleState.criticalApprovalHotkey,
      approvalMode === 'auto' ? 'auto' : 'ask'
    );

    const autoMode = this.toggleState.autoMode ?? 'off';
    const autoActive = autoMode !== 'off';
    addToggle(
      'Auto',
      autoActive,
      this.toggleState.autoContinueHotkey,
      autoMode  // Shows: off, on, or dual
    );

    const thinkingLabelRaw = (this.toggleState.thinkingModeLabel || 'balanced').trim();
    const thinkingLabel =
      thinkingLabelRaw.toLowerCase() === 'extended' ? 'deep' : thinkingLabelRaw || 'balanced';
    const thinkingActive = thinkingLabel.length > 0;
    addToggle('Thinking', thinkingActive, this.toggleState.thinkingHotkey, thinkingLabel);

    const buildLine = (includeHotkeys: boolean): string => {
      return toggles
        .map(toggle => {
          const stateText = toggle.on ? theme.success(toggle.value || 'on') : theme.ui.muted(toggle.value || 'off');
          const hotkeyText =
            includeHotkeys && toggle.hotkey ? theme.ui.muted(` [${toggle.hotkey}]`) : '';
          return `${theme.ui.muted(`${toggle.label}:`)} ${stateText}${hotkeyText}`;
        })
        .join(theme.ui.muted('  '));
    };

    const maxWidth = this.safeWidth();
    let line = buildLine(true);

    // Record which hotkeys are actually shown so the shortcut line can avoid duplicates
    this.hotkeysInToggleLine = new Set(
      toggles
        .map(toggle => (toggle.hotkey ? toggle.hotkey : null))
        .filter((key): key is string => Boolean(key))
    );

    // If the line is too wide, drop hotkey hints to preserve all toggle labels
    if (this.visibleLength(line) > maxWidth) {
      this.hotkeysInToggleLine.clear();
      line = buildLine(false);
    }

    return line.trim() ? line : null;
  }

  private buildShortcutLine(): string | null {
    const parts: string[] = [];

    const addHotkey = (label: string, combo?: string) => {
      const normalized = this.formatHotkey(combo);
      if (!normalized) return;
      if (this.hotkeysInToggleLine.has(normalized)) {
        return;
      }
      parts.push(`${theme.info(normalized)} ${theme.ui.muted(label)}`);
    };

    // Core controls
    addHotkey('interrupt', 'Ctrl+C');
    addHotkey('clear input', 'Ctrl+U');

    // Feature toggles (only if hotkeys are defined)
    addHotkey('approvals', this.toggleState.criticalApprovalHotkey);
    addHotkey('auto', this.toggleState.autoContinueHotkey);
    addHotkey('thinking', this.toggleState.thinkingHotkey);

    if (parts.length === 0) {
      return null;
    }
    return parts.join(theme.ui.muted('   '));
  }


  private buildInputLine(): string {
    if (this.collapsedPaste) {
      // Clean paste indicator - just show the summary, no action hints
      const linesText = this.collapsedPaste.lines === 1 ? '1 line' : `${this.collapsedPaste.lines} lines`;
      const charsText = typeof this.collapsedPaste.chars === 'number' ?
        `${this.collapsedPaste.chars} chars` :
        `${this.collapsedPaste.chars}`;
      const summary = theme.success(`[📋 ${linesText}, ${charsText}]`);
      return this.truncateLine(`${theme.primary('> ')}${summary}`, this.safeWidth());
    }

    // While detecting paste (or in burst detection phase), suppress buffer display
    const now = Date.now();
    const burstActive = this.pasteBurstWindowStart > 0 && now - this.pasteBurstWindowStart <= this.plainPasteWindowMs;
    if (this.inPlainPaste || this.inBracketedPaste || burstActive) {
      const chars = this.plainPasteBuffer.length || this.pasteBuffer.length || this.pendingInsertBuffer.length || 0;
      if (chars > 0) {
        const indicator = theme.ui.muted(`[📋 pasting... ${chars} chars]`);
        return this.truncateLine(`${theme.primary('> ')}${indicator}`, this.safeWidth());
      }
      // Even if no chars yet, show empty prompt during burst to prevent flicker
      if (burstActive) {
        return this.truncateLine(`${theme.primary('> ')}`, this.safeWidth());
      }
    }

    // Claude Code uses simple '>' prompt
    const prompt = theme.primary('> ');
    const promptWidth = this.visibleLength(prompt);
    const maxWidth = this.safeWidth();
    const continuationIndent = '  '; // 2 spaces for continuation lines
    const continuationWidth = continuationIndent.length;

    // Handle multi-line input - split buffer on newlines first
    // In secret mode, mask all characters with bullets
    const rawBuffer = this.buffer.replace(/\r/g, '\n');
    const normalized = this.secretMode ? '•'.repeat(rawBuffer.length) : rawBuffer;
    const bufferLines = normalized.split('\n');

    // Wrap each logical line to fit terminal width, expanding vertically
    const result: string[] = [];
    let totalChars = 0;
    let cursorLine = 0;
    let cursorCol = 0;
    let foundCursor = false;

    for (let lineIndex = 0; lineIndex < bufferLines.length; lineIndex++) {
      const line = bufferLines[lineIndex] ?? '';
      const isFirstLogicalLine = lineIndex === 0;
      const lineStartChar = totalChars;

      // Determine available width for this line
      const firstLineWidth = maxWidth - promptWidth;
      const contLineWidth = maxWidth - continuationWidth;

      // Wrap this logical line into display lines
      let remaining = line;
      let isFirstDisplayLine = true;

      while (remaining.length > 0 || isFirstDisplayLine) {
        const availableWidth = (isFirstLogicalLine && isFirstDisplayLine) ? firstLineWidth : contLineWidth;
        const chunk = remaining.slice(0, availableWidth);
        remaining = remaining.slice(availableWidth);

        // Build the display line
        let displayLine: string;
        if (isFirstLogicalLine && isFirstDisplayLine) {
          displayLine = `${prompt}${chunk}`;
        } else {
          displayLine = `${continuationIndent}${chunk}`;
        }

        // Track cursor position
        if (!foundCursor) {
          const chunkStart = lineStartChar + (line.length - remaining.length - chunk.length);
          const chunkEnd = chunkStart + chunk.length;
          if (this.cursor >= chunkStart && this.cursor <= chunkEnd) {
            cursorLine = result.length;
            const offsetInChunk = this.cursor - chunkStart;
            cursorCol = ((isFirstLogicalLine && isFirstDisplayLine) ? promptWidth : continuationWidth) + offsetInChunk;
            foundCursor = true;
          }
        }

        result.push(displayLine);
        isFirstDisplayLine = false;

        // If nothing left and this was an empty line, we already added it
        if (remaining.length === 0 && chunk.length === 0) break;
      }

      totalChars += line.length + 1; // +1 for the newline separator
    }

    // Handle cursor at very end
    if (!foundCursor) {
      cursorLine = Math.max(0, result.length - 1);
      const lastLine = result[cursorLine] ?? '';
      cursorCol = this.visibleLength(lastLine);
    }

    // Add cursor highlight to the appropriate position
    if (result.length > 0) {
      const targetLine = result[cursorLine] ?? '';
      const visiblePart = this.stripAnsi(targetLine);
      const cursorPos = Math.min(cursorCol, visiblePart.length);

      // Rebuild the line with cursor highlight
      const before = visiblePart.slice(0, cursorPos);
      const at = visiblePart.charAt(cursorPos) || ' ';
      const after = visiblePart.slice(cursorPos + 1);

      // Preserve the prompt/indent styling
      const prefix = cursorLine === 0 ? prompt : continuationIndent;
      const textPart = cursorLine === 0 ? before.slice(promptWidth) : before.slice(continuationWidth);
      result[cursorLine] = `${prefix}${textPart}${ESC.REVERSE}${at}${ESC.RESET}${after}`;
    }

    // Store cursor column for terminal positioning
    this.cursorVisibleColumn = cursorCol + 1;

    return result.join('\n');
  }

  private buildInputWindow(available: number): { text: string; cursor: number } {
    if (available <= 0) {
      return { text: '', cursor: 0 };
    }

    if (this.collapsedPaste) {
      return { text: '', cursor: 0 };
    }

    const normalized = this.buffer.replace(/\r/g, '\n');
    const cursorIndex = Math.min(this.cursor, normalized.length);

    let offset = this.inputRenderOffset;
    if (cursorIndex < offset) {
      offset = cursorIndex;
    }
    const overflow = cursorIndex - offset - available + 1;
    if (overflow > 0) {
      offset += overflow;
    }
    const maxOffset = Math.max(0, normalized.length - available);
    if (offset > maxOffset) {
      offset = maxOffset;
    }
    this.inputRenderOffset = offset;

    const window = normalized.slice(offset, offset + available);
    const display = window.split('').map(char => (char === '\n' ? NEWLINE_PLACEHOLDER : char)).join('');
    const cursorInWindow = Math.min(display.length, Math.max(0, cursorIndex - offset));

    const before = display.slice(0, cursorInWindow);
    const at = display.charAt(cursorInWindow) || ' ';
    const after = display.slice(cursorInWindow + 1);

    return {
      text: `${before}${ESC.REVERSE}${at}${ESC.RESET}${after}`,
      cursor: cursorInWindow,
    };
  }

  /**
   * Expand collapsed paste into the buffer without submitting (Ctrl+L).
   * Allows user to edit the pasted content before submission.
   */
  private expandCollapsedPasteToBuffer(): void {
    if (!this.collapsedPaste) return;
    const text = this.collapsedPaste.text;
    this.collapsedPaste = null;
    // Put the pasted content into the buffer for editing
    this.buffer = text;
    this.cursor = text.length;
    this.updateSuggestions();
    this.renderPrompt();
    this.emitInputChange();
  }

  /**
   * Expand collapsed paste and submit immediately.
   * Useful for programmatic submissions when a paste chip is active.
   */
  private expandCollapsedPaste(): void {
    if (!this.collapsedPaste) return;
    const text = this.collapsedPaste.text;
    this.collapsedPaste = null;
    // Clear the buffer first to avoid any visual duplication
    this.buffer = '';
    this.cursor = 0;
    this.updateSuggestions();
    this.renderPrompt();
    this.emitInputChange();
    // Submit the paste content (displayUserPrompt is called within submitText for non-slash commands)
    this.submitText(text);
  }

  captureInput(options: { allowEmpty?: boolean; trim?: boolean; resetBuffer?: boolean } = {}): Promise<string> {
    if (this.inputCapture) {
      return Promise.reject(new Error('Input capture already in progress'));
    }

    if (options.resetBuffer) {
      this.buffer = '';
      this.cursor = 0;
      this.inputRenderOffset = 0;
      this.resetSuggestions();
      this.renderPrompt();
      this.emitInputChange();
    }

    return new Promise<string>((resolve, reject) => {
      this.inputCapture = {
        resolve,
        reject,
        options: {
          trim: options.trim !== false,
          allowEmpty: options.allowEmpty ?? false,
        },
      };
    });
  }

  private cancelInputCapture(reason?: unknown): void {
    if (!this.inputCapture) {
      return;
    }
    const capture = this.inputCapture;
    this.inputCapture = null;
    capture.reject?.(reason ?? new Error('Input capture cancelled'));
  }


  // ------------ Helpers ------------

  private wrapOverlayLine(text: string, width: number, indent: string): string[] {
    const words = text.split(/(\s+)/);
    const lines: string[] = [];
    let current = '';

    for (const word of words) {
      const next = current + word;
      if (this.visibleLength(next) > width && current.trim()) {
        // Don't truncate - just push the line as-is (it fits within width)
        lines.push(current.trimEnd());
        current = indent + word.trimStart();
      } else {
        current = next;
      }
    }

    if (current.trim()) {
      lines.push(current.trimEnd());
    }

    // If no lines were produced, return the original text without truncation
    return lines.length ? lines : [text];
  }

  private safeWidth(): number {
    const cols = this.output.isTTY ? this.cols || 80 : 80;
    return Math.max(1, cols - 1);
  }

  private visibleLength(value: string): number {
    if (!value) return 0;
    return this.stripAnsi(value).length;
  }

  private stripAnsi(value: string): string {
    if (!value) return '';
    // eslint-disable-next-line no-control-regex
    return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '');
  }

  private truncateLine(value: string, width: number): string {
    if (!value) return '';
    const limit = Math.max(1, width);
    // eslint-disable-next-line no-control-regex
    const tokens = value.split(/(\x1b\[[0-9;]*m)/u);
    let visible = 0;
    let truncated = false;
    let result = '';

    for (const token of tokens) {
      if (!token) continue;
      // eslint-disable-next-line no-control-regex
      if (/^\x1b\[[0-9;]*m$/u.test(token)) {
        result += token;
        continue;
      }
      if (visible >= limit) {
        truncated = true;
        continue;
      }
      const remaining = limit - visible;
      if (token.length <= remaining) {
        result += token;
        visible += token.length;
      } else {
        const sliceLength = Math.max(0, remaining - 1);
        if (sliceLength > 0) {
          result += token.slice(0, sliceLength);
          visible += sliceLength;
        }
        result += '…';
        truncated = true;
        break;
      }
    }

    if (truncated && !result.endsWith(ESC.RESET)) {
      result += ESC.RESET;
    }

    return result;
  }

  getBuffer(): string {
    return this.buffer;
  }

  getCursor(): number {
    return this.cursor;
  }

  setBuffer(text: string, cursorPos?: number): void {
    this.buffer = text;
    // Validate cursor position to prevent out-of-bounds issues
    const requestedCursor = cursorPos ?? text.length;
    this.cursor = Math.max(0, Math.min(requestedCursor, text.length));
    this.inputRenderOffset = 0;
    this.updateSuggestions();
    this.renderPrompt();
    this.emitInputChange();
  }

  setSecretMode(enabled: boolean): void {
    this.secretMode = enabled;
    this.renderPrompt();
  }

  clearBuffer(): void {
    this.cancelPlainPasteCapture();
    this.buffer = '';
    this.cursor = 0;
    this.inputRenderOffset = 0;
    this.suggestions = [];
    this.suggestionIndex = -1;
    this.renderPrompt();
    this.emitInputChange();
  }

  setModeStatus(status: string | null): void {
    this.updateStatus(status);
  }

  /**
   * Show a compacting status with animated spinner (Claude Code style)
   * Uses ✻ character with animation to indicate context compaction in progress
   */
  showCompactingStatus(message: string): void {
    this.statusMessage = message;
    if (!this.spinnerInterval) {
      this.spinnerInterval = setInterval(() => {
        this.spinnerFrame++;
        // Cycle activity phrase every ~4 seconds (50 frames at 80ms)
        if (this.spinnerFrame % 50 === 0) {
          this.activityPhraseIndex++;
        }
        this.renderPrompt();
      }, 80);
    }
    this.renderPrompt();
  }

  /**
   * Hide the compacting status and stop spinner animation
   */
  hideCompactingStatus(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
    this.statusMessage = null;
    this.renderPrompt();
  }

  emitPrompt(content: string): void {
    this.pushPromptEvent(content);
  }

  /**
   * Display user prompt immediately in scrollback (Claude Code style)
   * Writes synchronously to ensure it appears ONCE in scrollback before status updates.
   * The prompt input area will then float below this and all subsequent events.
   */
  private displayUserPrompt(text: string): void {
    const normalized = text?.trim();
    if (!normalized) return;

    // Prevent duplicate prompt display within 1.5 seconds
    const now = Date.now();
    if (this.lastPromptEvent && this.lastPromptEvent.text === normalized && now - this.lastPromptEvent.at < 1500) {
      return;
    }
    this.lastPromptEvent = { text: normalized, at: now };

    // Add to event queue instead of writing directly to ensure proper rendering
    this.addEvent('prompt', normalized);
  }

  render(): void {
    this.renderPrompt();
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ------------ Low-level helpers ------------

  private write(data: string): void {
    this.output.write(data);
  }

  private pushPromptEvent(text: string): void {
    const normalized = text?.trim();
    if (!normalized) {
      return;
    }
    const now = Date.now();
    if (this.lastPromptEvent && this.lastPromptEvent.text === normalized && now - this.lastPromptEvent.at < 1500) {
      return;
    }
    this.lastPromptEvent = { text: normalized, at: now };
    this.addEvent('prompt', normalized);
  }

  private clearPromptArea(): void {
    const height = this.lastOverlay?.lines.length ?? this.promptHeight ?? 0;
    if (height === 0) return;

    // Use batched atomic write to prevent visual glitches from non-atomic escape sequences
    const buffer: string[] = [];

    // Hide cursor during clearing to prevent visual artifacts
    buffer.push('\x1b[?25l');

    // Cursor is at prompt row. Move up to top of overlay first.
    if (this.lastOverlay) {
      const linesToTop = this.lastOverlay.promptIndex;
      if (linesToTop > 0) {
        buffer.push(`\x1b[${linesToTop}A`);
      }
    }

    // Now at top, clear each line downward
    for (let i = 0; i < height; i++) {
      buffer.push('\r');
      buffer.push(ESC.CLEAR_LINE);
      if (i < height - 1) {
        buffer.push('\x1b[B');
      }
    }

    // Move back to top (where content should continue from)
    if (height > 1) {
      buffer.push(`\x1b[${height - 1}A`);
    }
    buffer.push('\r');

    // Show cursor again
    buffer.push('\x1b[?25h');

    // Single atomic write
    this.write(buffer.join(''));

    this.lastOverlay = null;
    this.promptHeight = 0;
    this.lastOverlayHeight = 0;
    this.isPromptActive = false;
    // CRITICAL: Reset hasEverRenderedOverlay to prevent the next render from
    // trying to clear already-cleared content, which causes duplicate dividers
    this.hasEverRenderedOverlay = false;
  }

  private updateTerminalSize(): void {
    if (this.output.isTTY) {
      this.rows = this.output.rows || 24;
      this.cols = this.output.columns || 80;
    }
  }
}
