/**
 * AI Flow Protection System
 *
 * Comprehensive protection against attacks targeting the AI conversation flow:
 *
 * 1. Prompt Injection Defense - Detect and neutralize injection attempts
 * 2. Flow Continuity Protection - Prevent conversation interruption attacks
 * 3. UI Stability Armor - Protect rendering from error-inducing payloads
 * 4. Context Poisoning Prevention - Detect attempts to corrupt AI context
 * 5. Response Hijacking Defense - Prevent response manipulation
 * 6. State Corruption Protection - Guard conversation state integrity
 * 7. Rate Limiting - Prevent DoS through rapid message flooding
 * 8. Escape Sequence Sanitization - Neutralize terminal escape attacks
 *
 * @module flowProtection
 */

import { EventEmitter } from 'events';

/** Injection detection result */
export interface InjectionAnalysis {
  detected: boolean;
  confidence: number; // 0-100
  type: InjectionType | null;
  sanitized: string;
  originalLength: number;
  sanitizedLength: number;
  blockedPatterns: string[];
}

/** Types of injection attacks */
export type InjectionType =
  | 'prompt_override'      // Attempting to override system prompt
  | 'role_injection'       // Injecting fake assistant/system messages
  | 'context_manipulation' // Manipulating conversation context
  | 'escape_sequence'      // Terminal escape sequence injection
  | 'unicode_attack'       // Unicode normalization attacks
  | 'delimiter_injection'  // Injecting message delimiters
  | 'instruction_leak'     // Attempting to leak system instructions
  | 'jailbreak'           // Known jailbreak patterns
  | 'flow_termination'    // Attempting to terminate AI flow
  | 'ui_corruption';      // Attempting to corrupt UI rendering

/** Flow state for continuity tracking */
interface FlowState {
  messageCount: number;
  lastMessageTime: number;
  errorCount: number;
  recoveryAttempts: number;
  contextHash: string;
  isProcessing: boolean;
  lastValidState: string | null;
}

/** Configuration options */
export interface FlowProtectionConfig {
  /** Enable prompt injection detection (default: true) */
  detectInjection?: boolean;
  /** Injection confidence threshold to block (default: 70) */
  injectionThreshold?: number;
  /** Enable flow continuity protection (default: true) */
  protectFlow?: boolean;
  /** Enable UI stability protection (default: true) */
  protectUI?: boolean;
  /** Rate limit messages per second (default: 10) */
  rateLimitPerSecond?: number;
  /** Maximum message length (default: 100000) */
  maxMessageLength?: number;
  /** Enable verbose logging (default: false) */
  verbose?: boolean;
  /** Callback on injection detection */
  onInjectionDetected?: (analysis: InjectionAnalysis) => void;
  /** Callback on flow error */
  onFlowError?: (error: Error, recovered: boolean) => void;
}

/** Singleton instance */
let flowProtectionInstance: FlowProtection | null = null;

/**
 * Flow Protection System
 */
export class FlowProtection extends EventEmitter {
  private config: Required<FlowProtectionConfig>;
  private flowState: FlowState;
  private messageTimestamps: number[] = [];
  private blockedInjections = 0;
  private recoveredFlows = 0;
  private uiErrorsBlocked = 0;

  // Injection detection patterns
  private readonly injectionPatterns: Array<{ pattern: RegExp; type: InjectionType; weight: number }> = [
    // System prompt override attempts
    { pattern: /\[?\/?system\]?[\s:]+/gi, type: 'prompt_override', weight: 40 },
    { pattern: /ignore.*(?:previous|above|all).*instructions?/gi, type: 'prompt_override', weight: 60 },
    { pattern: /disregard.*(?:previous|prior|all).*(?:instructions?|rules?)/gi, type: 'prompt_override', weight: 60 },
    { pattern: /forget.*(?:everything|all|previous)/gi, type: 'prompt_override', weight: 50 },
    { pattern: /new.*(?:system|base).*prompt/gi, type: 'prompt_override', weight: 55 },
    { pattern: /override.*(?:system|instructions?)/gi, type: 'prompt_override', weight: 55 },

    // Role injection
    { pattern: /^[\s]*(?:assistant|ai|claude|gpt|system)[\s]*:/gim, type: 'role_injection', weight: 45 },
    { pattern: /\n[\s]*(?:assistant|ai|claude)[\s]*:/gi, type: 'role_injection', weight: 40 },
    { pattern: /<\/?(?:system|assistant|user)>/gi, type: 'role_injection', weight: 50 },
    { pattern: /\[\[(?:SYSTEM|ASSISTANT|USER)\]\]/gi, type: 'role_injection', weight: 55 },

    // Context manipulation
    { pattern: /pretend.*(?:you.*are|to.*be|that)/gi, type: 'context_manipulation', weight: 35 },
    { pattern: /act.*as.*(?:if|though)/gi, type: 'context_manipulation', weight: 30 },
    { pattern: /roleplay.*as/gi, type: 'context_manipulation', weight: 30 },
    { pattern: /you.*are.*now/gi, type: 'context_manipulation', weight: 25 },
    { pattern: /from.*now.*on/gi, type: 'context_manipulation', weight: 20 },

    // Delimiter injection
    { pattern: /---+[\s]*(?:END|START)[\s]*---+/gi, type: 'delimiter_injection', weight: 45 },
    { pattern: /===+[\s]*(?:SYSTEM|USER|ASSISTANT)[\s]*===+/gi, type: 'delimiter_injection', weight: 50 },
    { pattern: /\|{3,}[\s]*(?:BREAK|END|NEW)[\s]*\|{3,}/gi, type: 'delimiter_injection', weight: 45 },

    // Instruction leak attempts
    { pattern: /repeat.*(?:system|initial).*(?:prompt|instructions?)/gi, type: 'instruction_leak', weight: 50 },
    { pattern: /show.*(?:me|your).*(?:system|base).*(?:prompt|instructions?)/gi, type: 'instruction_leak', weight: 55 },
    { pattern: /what.*(?:are|were).*(?:your|the).*(?:original|initial).*instructions?/gi, type: 'instruction_leak', weight: 45 },
    { pattern: /reveal.*(?:system|hidden).*(?:prompt|instructions?)/gi, type: 'instruction_leak', weight: 55 },

    // Jailbreak patterns
    { pattern: /DAN[\s]*(?:mode|prompt)?/gi, type: 'jailbreak', weight: 70 },
    { pattern: /jailbreak/gi, type: 'jailbreak', weight: 60 },
    { pattern: /developer[\s]*mode/gi, type: 'jailbreak', weight: 50 },
    { pattern: /\[.*unlock.*\]/gi, type: 'jailbreak', weight: 45 },
    { pattern: /bypass.*(?:filters?|restrictions?|safety)/gi, type: 'jailbreak', weight: 55 },

    // Flow termination attempts
    { pattern: /(?:exit|quit|terminate|abort|kill|stop)[\s]*(?:now|immediately|session|conversation)/gi, type: 'flow_termination', weight: 40 },
    { pattern: /(?:end|close|shutdown)[\s]*(?:this|the)?[\s]*(?:session|conversation|chat)/gi, type: 'flow_termination', weight: 35 },
    { pattern: /\x03|\x04|\x1a/g, type: 'flow_termination', weight: 70 }, // Ctrl+C, Ctrl+D, Ctrl+Z

    // UI corruption attempts
    { pattern: /\x1b\[[0-9;]*[mGKHJ]/g, type: 'ui_corruption', weight: 60 }, // ANSI escape sequences
    { pattern: /\x1b\][0-9]+;/g, type: 'ui_corruption', weight: 65 }, // OSC sequences
    { pattern: /\x07|\x08|\x7f/g, type: 'ui_corruption', weight: 40 }, // Bell, backspace, delete
    { pattern: /\x1b[PX^_]/g, type: 'ui_corruption', weight: 70 }, // DCS, SOS, PM, APC sequences
  ];

  // Unicode normalization attacks
  private readonly unicodePatterns: Array<{ char: string; replacement: string }> = [
    { char: '\u200B', replacement: '' }, // Zero-width space
    { char: '\u200C', replacement: '' }, // Zero-width non-joiner
    { char: '\u200D', replacement: '' }, // Zero-width joiner
    { char: '\u2060', replacement: '' }, // Word joiner
    { char: '\uFEFF', replacement: '' }, // BOM
    { char: '\u00A0', replacement: ' ' }, // Non-breaking space
    { char: '\u2028', replacement: '\n' }, // Line separator
    { char: '\u2029', replacement: '\n' }, // Paragraph separator
    { char: '\u202A', replacement: '' }, // LRE
    { char: '\u202B', replacement: '' }, // RLE
    { char: '\u202C', replacement: '' }, // PDF
    { char: '\u202D', replacement: '' }, // LRO
    { char: '\u202E', replacement: '' }, // RLO (text direction override)
  ];

  constructor(config: FlowProtectionConfig = {}) {
    super();
    this.config = {
      detectInjection: config.detectInjection ?? true,
      injectionThreshold: config.injectionThreshold ?? 70,
      protectFlow: config.protectFlow ?? true,
      protectUI: config.protectUI ?? true,
      rateLimitPerSecond: config.rateLimitPerSecond ?? 10,
      maxMessageLength: config.maxMessageLength ?? 100000,
      verbose: config.verbose ?? false,
      onInjectionDetected: config.onInjectionDetected ?? (() => {}),
      onFlowError: config.onFlowError ?? (() => {}),
    };

    this.flowState = {
      messageCount: 0,
      lastMessageTime: 0,
      errorCount: 0,
      recoveryAttempts: 0,
      contextHash: '',
      isProcessing: false,
      lastValidState: null,
    };
  }

  /**
   * Analyze and sanitize a prompt for injection attempts
   */
  analyzePrompt(prompt: string): InjectionAnalysis {
    const blockedPatterns: string[] = [];
    let totalWeight = 0;
    let detectedType: InjectionType | null = null;
    let sanitized = prompt;

    // Check message length
    if (prompt.length > this.config.maxMessageLength) {
      this.log(`Prompt truncated from ${prompt.length} to ${this.config.maxMessageLength}`);
      sanitized = prompt.slice(0, this.config.maxMessageLength);
      totalWeight += 20;
    }

    // Unicode normalization
    sanitized = this.normalizeUnicode(sanitized);

    // Check injection patterns
    for (const { pattern, type, weight } of this.injectionPatterns) {
      const matches = sanitized.match(pattern);
      if (matches) {
        totalWeight += weight;
        blockedPatterns.push(...matches);
        if (!detectedType || weight > (this.injectionPatterns.find(p => p.type === detectedType)?.weight ?? 0)) {
          detectedType = type;
        }

        // Sanitize based on type
        if (type === 'ui_corruption' || type === 'escape_sequence') {
          sanitized = sanitized.replace(pattern, '');
        }
      }
    }

    // Normalize confidence to 0-100
    const confidence = Math.min(100, totalWeight);
    const detected = confidence >= this.config.injectionThreshold;

    if (detected) {
      this.blockedInjections++;
      this.log(`Injection detected: ${detectedType} (confidence: ${confidence}%)`);
    }

    const analysis: InjectionAnalysis = {
      detected,
      confidence,
      type: detected ? detectedType : null,
      sanitized,
      originalLength: prompt.length,
      sanitizedLength: sanitized.length,
      blockedPatterns,
    };

    if (detected) {
      this.config.onInjectionDetected?.(analysis);
      this.emit('injection_detected', analysis);
    }

    return analysis;
  }

  /**
   * Normalize unicode to prevent attacks
   */
  private normalizeUnicode(text: string): string {
    let result = text;

    for (const { char, replacement } of this.unicodePatterns) {
      result = result.split(char).join(replacement);
    }

    // Normalize to NFC form
    try {
      result = result.normalize('NFC');
    } catch {
      // Ignore normalization errors
    }

    return result;
  }

  /**
   * Check rate limiting
   */
  checkRateLimit(): boolean {
    const now = Date.now();
    const windowMs = 1000;

    // Remove timestamps outside window
    this.messageTimestamps = this.messageTimestamps.filter(t => now - t < windowMs);

    if (this.messageTimestamps.length >= this.config.rateLimitPerSecond) {
      this.log(`Rate limit exceeded: ${this.messageTimestamps.length} msgs/sec`);
      return false;
    }

    this.messageTimestamps.push(now);
    return true;
  }

  /**
   * Process a message through all protections
   */
  processMessage(message: string): { allowed: boolean; sanitized: string; reason?: string } {
    // Rate limiting
    if (!this.checkRateLimit()) {
      return { allowed: false, sanitized: '', reason: 'Rate limit exceeded' };
    }

    // Injection analysis
    const analysis = this.analyzePrompt(message);

    if (analysis.detected && analysis.confidence >= this.config.injectionThreshold) {
      // High confidence injection - block or heavily sanitize
      if (analysis.type === 'jailbreak' || analysis.type === 'prompt_override') {
        return {
          allowed: false,
          sanitized: '',
          reason: `Blocked ${analysis.type} attempt (confidence: ${analysis.confidence}%)`,
        };
      }

      // Other types - allow sanitized version
      return {
        allowed: true,
        sanitized: analysis.sanitized,
        reason: `Sanitized ${analysis.type} attempt`,
      };
    }

    // Update flow state
    this.flowState.messageCount++;
    this.flowState.lastMessageTime = Date.now();

    return { allowed: true, sanitized: analysis.sanitized };
  }

  /**
   * Protect UI rendering from malicious content
   */
  sanitizeForUI(content: string): string {
    if (!this.config.protectUI) return content;

    let sanitized = content;

    // Remove all ANSI escape sequences except safe ones
    sanitized = this.removeUnsafeEscapeSequences(sanitized);

    // Remove control characters except newline and tab
    sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    // Limit line length to prevent terminal overflow
    const maxLineLength = 10000;
    sanitized = sanitized.split('\n').map(line =>
      line.length > maxLineLength ? line.slice(0, maxLineLength) + '...' : line
    ).join('\n');

    // Limit total output length
    const maxOutputLength = 500000;
    if (sanitized.length > maxOutputLength) {
      sanitized = sanitized.slice(0, maxOutputLength) + '\n[Output truncated for safety]';
    }

    if (sanitized !== content) {
      this.uiErrorsBlocked++;
    }

    return sanitized;
  }

  /**
   * Remove unsafe escape sequences while preserving safe formatting
   */
  private removeUnsafeEscapeSequences(text: string): string {
    // Safe escape sequences (basic colors and formatting)
    const safePattern = /\x1b\[[0-9;]*m/g;

    // Remove all escape sequences first
    let cleaned = text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    cleaned = cleaned.replace(/\x1b\][^\x07]*\x07/g, ''); // OSC sequences
    cleaned = cleaned.replace(/\x1b[PX^_].*?\x1b\\/g, ''); // DCS, SOS, PM, APC

    // For safety, just strip all escape sequences
    cleaned = cleaned.replace(/\x1b./g, '');

    return cleaned;
  }

  /**
   * Wrap an async operation with flow protection
   */
  async protectFlow<T>(operation: () => Promise<T>, context?: string): Promise<T> {
    if (!this.config.protectFlow) {
      return operation();
    }

    this.flowState.isProcessing = true;
    const startTime = Date.now();

    try {
      const result = await operation();
      this.flowState.errorCount = 0; // Reset on success
      return result;
    } catch (error) {
      this.flowState.errorCount++;
      const errorObj = error instanceof Error ? error : new Error(String(error));

      // Check if this looks like an attack-induced error
      const isAttackError = this.isAttackInducedError(errorObj);

      if (isAttackError) {
        this.log(`Attack-induced error detected: ${errorObj.message}`);

        // Attempt recovery
        if (this.flowState.recoveryAttempts < 3) {
          this.flowState.recoveryAttempts++;
          this.log(`Attempting flow recovery (attempt ${this.flowState.recoveryAttempts})`);

          // Wait a bit and retry
          await this.delay(100 * this.flowState.recoveryAttempts);

          try {
            const result = await operation();
            this.recoveredFlows++;
            this.config.onFlowError?.(errorObj, true);
            return result;
          } catch (retryError) {
            // Recovery failed
            this.config.onFlowError?.(errorObj, false);
            throw retryError;
          }
        }
      }

      this.config.onFlowError?.(errorObj, false);
      throw error;
    } finally {
      this.flowState.isProcessing = false;
    }
  }

  /**
   * Check if an error appears to be attack-induced
   */
  private isAttackInducedError(error: Error): boolean {
    const attackPatterns = [
      /maximum call stack/i,
      /out of memory/i,
      /allocation failed/i,
      /too many/i,
      /timeout/i,
      /ETIMEDOUT/i,
      /ECONNRESET/i,
      /EPIPE/i,
      /stream.*destroyed/i,
      /socket.*closed/i,
      /unexpected.*end/i,
      /JSON.*parse/i,
      /invalid.*token/i,
    ];

    return attackPatterns.some(p => p.test(error.message) || p.test(error.stack || ''));
  }

  /**
   * Helper delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Save flow state checkpoint
   */
  saveCheckpoint(state: string): void {
    this.flowState.lastValidState = state;
    this.flowState.contextHash = this.hashString(state);
  }

  /**
   * Restore from last checkpoint
   */
  restoreCheckpoint(): string | null {
    return this.flowState.lastValidState;
  }

  /**
   * Verify context integrity
   */
  verifyContextIntegrity(context: string): boolean {
    const currentHash = this.hashString(context);
    if (this.flowState.contextHash && currentHash !== this.flowState.contextHash) {
      this.log('Context integrity check failed - possible manipulation');
      return false;
    }
    return true;
  }

  /**
   * Simple string hash for integrity checks
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(16);
  }

  /**
   * Get protection statistics
   */
  getStats(): {
    blockedInjections: number;
    recoveredFlows: number;
    uiErrorsBlocked: number;
    messageCount: number;
    errorCount: number;
  } {
    return {
      blockedInjections: this.blockedInjections,
      recoveredFlows: this.recoveredFlows,
      uiErrorsBlocked: this.uiErrorsBlocked,
      messageCount: this.flowState.messageCount,
      errorCount: this.flowState.errorCount,
    };
  }

  /**
   * Internal logging
   */
  private log(message: string): void {
    if (this.config.verbose || process.env['AGI_DEBUG']) {
      console.error(`[FlowProtection] ${message}`);
    }
  }
}

/**
 * Initialize global flow protection (singleton)
 */
export function initializeFlowProtection(config?: FlowProtectionConfig): FlowProtection {
  if (!flowProtectionInstance) {
    flowProtectionInstance = new FlowProtection(config);
  }
  return flowProtectionInstance;
}

/**
 * Get flow protection instance
 */
export function getFlowProtection(): FlowProtection | null {
  return flowProtectionInstance;
}

/**
 * Quick sanitize function for prompts
 */
export function sanitizePrompt(prompt: string): { sanitized: string; blocked: boolean } {
  const protection = flowProtectionInstance ?? new FlowProtection();
  const result = protection.processMessage(prompt);
  return {
    sanitized: result.sanitized,
    blocked: !result.allowed,
  };
}

/**
 * Quick sanitize function for UI output
 */
export function sanitizeForDisplay(content: string): string {
  const protection = flowProtectionInstance ?? new FlowProtection();
  return protection.sanitizeForUI(content);
}

// Auto-initialize if environment variable is set
if (process.env['AGI_FLOW_PROTECTION'] === '1' || process.env['AGI_PROTECTED_MODE'] === '1') {
  initializeFlowProtection({ verbose: process.env['AGI_DEBUG'] === '1' });
}
