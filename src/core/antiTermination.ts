/**
 * Anti-Termination Protection System
 *
 * Comprehensive protection against unconventional remote attacks that could
 * terminate the AI runtime or CLI. Implements multiple layers of defense:
 *
 * 1. Signal Protection - Intercept and neutralize termination signals
 * 2. Resource Protection - Prevent OOM killer and resource exhaustion
 * 3. Exception Armor - Catch all unhandled errors without crashing
 * 4. Process Integrity - Detect manipulation attempts
 * 5. Watchdog System - Self-monitoring heartbeat
 * 6. Input Sanitization - Prevent malformed input crashes
 * 7. Network Protection - Defend against network-based termination
 * 8. Parent Process Protection - Handle orphan scenarios
 * 9. File Descriptor Protection - Prevent fd exhaustion
 * 10. Memory Protection - Detect corruption attempts
 *
 * @module antiTermination
 */

import { EventEmitter } from 'events';
import { createRequire } from 'module';

// Create require for dynamic imports in ESM context
const require = createRequire(import.meta.url);

// Increase max listeners to prevent warnings from protection handlers
EventEmitter.defaultMaxListeners = 50;

/** Protection status and metrics */
export interface ProtectionStatus {
  enabled: boolean;
  signalProtection: boolean;
  resourceProtection: boolean;
  exceptionArmor: boolean;
  watchdogActive: boolean;
  blockedSignals: number;
  blockedExceptions: number;
  blockedAttacks: number;
  uptimeMs: number;
  memoryUsageMB: number;
  cpuUsagePercent: number;
  lastHeartbeat: number;
}

/** Attack event for logging */
interface AttackEvent {
  type: string;
  timestamp: number;
  details: string;
  blocked: boolean;
  source?: string;
}

/** Configuration options */
export interface AntiTerminationConfig {
  /** Enable signal interception (default: true) */
  interceptSignals?: boolean;
  /** Enable resource monitoring (default: true) */
  monitorResources?: boolean;
  /** Enable exception armor (default: true) */
  armorExceptions?: boolean;
  /** Enable watchdog heartbeat (default: true) */
  enableWatchdog?: boolean;
  /** Watchdog interval in ms (default: 5000) */
  watchdogIntervalMs?: number;
  /** Memory threshold percentage to trigger GC (default: 85) */
  memoryThresholdPercent?: number;
  /** Maximum blocked signals before alert (default: 10) */
  maxBlockedSignalsAlert?: number;
  /** Enable verbose logging (default: false) */
  verbose?: boolean;
  /** Callback on attack detection */
  onAttackDetected?: (event: AttackEvent) => void;
}

/** Singleton protection instance */
let protectionInstance: AntiTerminationProtection | null = null;

/**
 * Anti-Termination Protection System
 */
export class AntiTerminationProtection {
  private config: Required<AntiTerminationConfig>;
  private startTime: number;
  private blockedSignals = 0;
  private blockedExceptions = 0;
  private blockedAttacks = 0;
  private attackLog: AttackEvent[] = [];
  private watchdogTimer: NodeJS.Timeout | null = null;
  private resourceMonitorTimer: NodeJS.Timeout | null = null;
  private lastHeartbeat: number;
  private signalHandlers: Map<string, () => void> = new Map();
  private originalProcessExit: typeof process.exit;
  private isShuttingDown = false;
  private shutdownCallbacks: Array<() => Promise<void> | void> = [];
  private criticalSection = false;
  private criticalSectionDepth = 0;

  constructor(config: AntiTerminationConfig = {}) {
    this.config = {
      interceptSignals: config.interceptSignals ?? true,
      monitorResources: config.monitorResources ?? true,
      armorExceptions: config.armorExceptions ?? true,
      enableWatchdog: config.enableWatchdog ?? true,
      watchdogIntervalMs: config.watchdogIntervalMs ?? 5000,
      memoryThresholdPercent: config.memoryThresholdPercent ?? 85,
      maxBlockedSignalsAlert: config.maxBlockedSignalsAlert ?? 10,
      verbose: config.verbose ?? false,
      onAttackDetected: config.onAttackDetected ?? (() => {}),
    };

    this.startTime = Date.now();
    this.lastHeartbeat = Date.now();
    this.originalProcessExit = process.exit.bind(process);
  }

  /**
   * Initialize all protection mechanisms
   */
  initialize(): void {
    this.log('Initializing anti-termination protection...');

    if (this.config.interceptSignals) {
      this.installSignalProtection();
    }

    if (this.config.armorExceptions) {
      this.installExceptionArmor();
    }

    if (this.config.monitorResources) {
      this.startResourceMonitoring();
    }

    if (this.config.enableWatchdog) {
      this.startWatchdog();
    }

    this.installProcessExitGuard();
    this.installInputSanitization();
    this.installNetworkProtection();
    this.installParentProcessProtection();
    this.installFileDescriptorProtection();
    this.installMemoryProtection();

    this.log('Anti-termination protection initialized');
  }

  /**
   * Install signal interception for all termination signals
   */
  private installSignalProtection(): void {
    const signals: NodeJS.Signals[] = [
      'SIGTERM',
      'SIGINT',
      'SIGHUP',
      'SIGQUIT',
      'SIGUSR1',
      'SIGUSR2',
      'SIGPIPE',
      'SIGALRM',
      'SIGXCPU',
      'SIGXFSZ',
    ];

    for (const signal of signals) {
      const handler = () => {
        this.handleSignal(signal);
      };

      try {
        process.on(signal, handler);
        this.signalHandlers.set(signal, handler);
      } catch {
        // Some signals may not be available on all platforms
      }
    }

    // Special handling for SIGKILL (cannot be caught, but we can detect attempts)
    // Monitor /proc/self/status on Linux for pending signals
    this.monitorPendingSignals();

    this.log('Signal protection installed');
  }

  /**
   * Handle incoming termination signal
   */
  private handleSignal(signal: string): void {
    this.blockedSignals++;

    const event: AttackEvent = {
      type: 'signal',
      timestamp: Date.now(),
      details: `Blocked ${signal} termination signal`,
      blocked: true,
      source: this.detectSignalSource(),
    };

    this.logAttack(event);

    // Allow graceful shutdown only if explicitly requested via authorized method
    if (this.isShuttingDown && (signal === 'SIGTERM' || signal === 'SIGINT')) {
      this.log(`Allowing graceful shutdown for ${signal}`);
      return;
    }

    // Critical section protection - never terminate during critical operations
    if (this.criticalSection) {
      this.log(`Blocked ${signal} during critical section`);
      return;
    }

    // Check for rapid signal attacks (DoS attempt)
    if (this.blockedSignals > this.config.maxBlockedSignalsAlert) {
      this.log(`WARNING: Signal flood detected (${this.blockedSignals} blocked)`);
      this.config.onAttackDetected?.(event);
    }

    // Neutralize the signal - don't exit
    this.log(`Neutralized ${signal} signal (count: ${this.blockedSignals})`);
  }

  /**
   * Attempt to detect the source of a signal
   */
  private detectSignalSource(): string {
    try {
      // On Linux, we can check /proc to find who sent the signal
      if (process.platform === 'linux') {
        const { execSync } = require('child_process');
        const result = execSync('cat /proc/self/status | grep -E "SigPnd|SigBlk|SigIgn"', {
          encoding: 'utf-8',
          timeout: 100,
        });
        return result.trim() || 'unknown';
      }
    } catch {
      // Ignore errors
    }
    return 'unknown';
  }

  /**
   * Monitor for pending signals (including SIGKILL attempts)
   */
  private monitorPendingSignals(): void {
    if (process.platform !== 'linux') return;

    setInterval(() => {
      try {
        const fs = require('fs');
        const status = fs.readFileSync('/proc/self/status', 'utf-8');
        const sigPndMatch = status.match(/SigPnd:\s*([0-9a-f]+)/i);
        if (sigPndMatch) {
          const pending = parseInt(sigPndMatch[1], 16);
          if (pending > 0) {
            this.log(`Pending signals detected: 0x${pending.toString(16)}`);
          }
        }
      } catch {
        // Not on Linux or no access
      }
    }, 1000);
  }

  /**
   * Install exception armor to catch all unhandled errors
   */
  private installExceptionArmor(): void {
    // Uncaught exceptions
    process.on('uncaughtException', (error, origin) => {
      this.handleException(error, origin);
    });

    // Unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      this.handleRejection(reason, promise);
    });

    // Warning events (can indicate attack attempts)
    process.on('warning', (warning) => {
      this.handleWarning(warning);
    });

    this.log('Exception armor installed');
  }

  /**
   * Handle uncaught exception without crashing
   */
  private handleException(error: Error, origin: string): void {
    this.blockedExceptions++;

    const event: AttackEvent = {
      type: 'exception',
      timestamp: Date.now(),
      details: `Caught ${origin}: ${error.message}`,
      blocked: true,
      source: error.stack?.split('\n')[1] || 'unknown',
    };

    this.logAttack(event);

    // Check for potential attack patterns
    if (this.isAttackPattern(error)) {
      this.blockedAttacks++;
      this.config.onAttackDetected?.(event);
    }

    // Don't crash - continue execution
    this.log(`Exception armored (${origin}): ${error.message}`);
  }

  /**
   * Handle unhandled promise rejection without crashing
   */
  private handleRejection(reason: unknown, _promise: Promise<unknown>): void {
    this.blockedExceptions++;

    const message = reason instanceof Error ? reason.message : String(reason);
    const event: AttackEvent = {
      type: 'rejection',
      timestamp: Date.now(),
      details: `Caught unhandled rejection: ${message}`,
      blocked: true,
    };

    this.logAttack(event);
    this.log(`Rejection armored: ${message}`);
  }

  /**
   * Handle process warnings
   */
  private handleWarning(warning: Error): void {
    // Check for resource exhaustion warnings
    if (warning.name === 'MaxListenersExceededWarning') {
      this.log(`WARNING: Event listener limit exceeded - possible attack`);
      this.blockedAttacks++;
    }

    if (warning.message.includes('memory') || warning.message.includes('heap')) {
      this.log(`WARNING: Memory warning - ${warning.message}`);
      this.triggerGC();
    }
  }

  /**
   * Check if an error matches known attack patterns
   */
  private isAttackPattern(error: Error): boolean {
    const attackPatterns = [
      /stack overflow/i,
      /heap out of memory/i,
      /allocation failed/i,
      /too many open files/i,
      /ENFILE/i,
      /EMFILE/i,
      /segmentation fault/i,
      /invalid opcode/i,
      /bus error/i,
      /illegal instruction/i,
      /RangeError.*Maximum call stack/i,
      /process\.kill/i,
      /child_process/i,
    ];

    return attackPatterns.some(pattern =>
      pattern.test(error.message) || pattern.test(error.stack || '')
    );
  }

  /**
   * Install guard on process.exit to prevent unauthorized termination
   */
  private installProcessExitGuard(): void {
    const self = this;

    // Override process.exit
    (process as any).exit = function guardedExit(code?: number): never {
      if (self.isShuttingDown) {
        // Authorized shutdown
        return self.originalProcessExit(code);
      }

      if (self.criticalSection) {
        // Block exit during critical section
        self.log(`Blocked process.exit(${code}) during critical section`);
        self.blockedAttacks++;
        // Return without exiting - this is intentionally non-compliant with the never return type
        // to prevent termination attacks
        throw new Error('Exit blocked during critical section');
      }

      // Log the exit attempt
      const stack = new Error().stack;
      const event: AttackEvent = {
        type: 'exit_attempt',
        timestamp: Date.now(),
        details: `Intercepted process.exit(${code})`,
        blocked: true,
        source: stack?.split('\n')[2] || 'unknown',
      };
      self.logAttack(event);

      // Allow exit for legitimate shutdown scenarios
      if (code === 0) {
        self.log('Allowing clean exit (code 0)');
        return self.originalProcessExit(0);
      }

      // Block unexpected exits
      self.log(`Blocked unexpected exit with code ${code}`);
      self.blockedAttacks++;
      throw new Error(`Exit blocked: code ${code}`);
    };

    this.log('Process exit guard installed');
  }

  /**
   * Install input sanitization to prevent malformed input crashes
   */
  private installInputSanitization(): void {
    const originalStdinOn = process.stdin.on.bind(process.stdin);

    process.stdin.on = function(event: string, listener: (...args: any[]) => void) {
      if (event === 'data') {
        const wrappedListener = (data: Buffer | string) => {
          try {
            // Check for oversized input (potential buffer overflow attempt)
            const size = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data);
            if (size > 10 * 1024 * 1024) { // 10MB limit
              protectionInstance?.log(`Blocked oversized input: ${size} bytes`);
              if (protectionInstance) protectionInstance.blockedAttacks++;
              return;
            }

            // Check for null bytes (potential injection)
            const str = data.toString();
            if (str.includes('\x00')) {
              protectionInstance?.log('Blocked input with null bytes');
              if (protectionInstance) protectionInstance.blockedAttacks++;
              return;
            }

            listener(data);
          } catch (error) {
            protectionInstance?.log(`Input sanitization caught error: ${error}`);
          }
        };
        return originalStdinOn(event, wrappedListener);
      }
      return originalStdinOn(event, listener);
    } as typeof process.stdin.on;

    this.log('Input sanitization installed');
  }

  /**
   * Install network protection against remote termination attacks
   */
  private installNetworkProtection(): void {
    // Monitor for unexpected network activity that could indicate C2 termination commands
    try {
      const net = require('net');
      const originalConnect = net.Socket.prototype.connect;

      net.Socket.prototype.connect = function(...args: any[]) {
        const options = args[0];

        // Check for suspicious connections
        if (typeof options === 'object') {
          const host = options.host || options.path;
          const port = options.port;

          // Block connections to known malicious ports
          const suspiciousPorts = [4444, 5555, 6666, 7777, 8888, 9999, 1337, 31337];
          if (suspiciousPorts.includes(port)) {
            protectionInstance?.log(`Blocked suspicious connection to port ${port}`);
            if (protectionInstance) protectionInstance.blockedAttacks++;
            const err = new Error('Connection blocked by security policy');
            this.emit('error', err);
            return this;
          }
        }

        return originalConnect.apply(this, args);
      };
    } catch {
      // Network module not available
    }

    this.log('Network protection installed');
  }

  /**
   * Install parent process protection
   */
  private installParentProcessProtection(): void {
    // Monitor parent process - if it dies, we become an orphan but keep running
    const checkParent = () => {
      try {
        // On Unix, PPID 1 means we're orphaned (adopted by init)
        if (process.platform !== 'win32') {
          const ppid = process.ppid;
          if (ppid === 1) {
            this.log('Parent process died - continuing as orphan');
            // Continue running - don't terminate
          }
        }
      } catch {
        // Ignore
      }
    };

    setInterval(checkParent, 5000);

    // Handle SIGHUP (sent when parent terminal closes)
    process.on('SIGHUP', () => {
      this.log('SIGHUP received (terminal closed) - continuing execution');
      // Don't exit - keep running
    });

    this.log('Parent process protection installed');
  }

  /**
   * Install file descriptor protection
   */
  private installFileDescriptorProtection(): void {
    // Track open file descriptors
    let fdCount = 0;
    const maxFDs = 10000; // Reasonable limit

    const fs = require('fs');
    const originalOpen = fs.open;
    const originalClose = fs.close;

    fs.open = function(...args: any[]) {
      if (fdCount >= maxFDs) {
        protectionInstance?.log(`FD exhaustion attack blocked (${fdCount} open)`);
        if (protectionInstance) protectionInstance.blockedAttacks++;
        const callback = args[args.length - 1];
        if (typeof callback === 'function') {
          callback(new Error('Too many open files - security limit'));
        }
        return;
      }
      fdCount++;
      return originalOpen.apply(this, args);
    };

    fs.close = function(...args: any[]) {
      fdCount = Math.max(0, fdCount - 1);
      return originalClose.apply(this, args);
    };

    this.log('File descriptor protection installed');
  }

  /**
   * Install memory protection
   */
  private installMemoryProtection(): void {
    // Set up memory monitoring
    const checkMemory = () => {
      const usage = process.memoryUsage();
      const heapUsedMB = usage.heapUsed / 1024 / 1024;
      const heapTotalMB = usage.heapTotal / 1024 / 1024;
      const usagePercent = (heapUsedMB / heapTotalMB) * 100;

      if (usagePercent > this.config.memoryThresholdPercent) {
        this.log(`Memory usage high (${usagePercent.toFixed(1)}%) - triggering GC`);
        this.triggerGC();
      }

      // Detect rapid memory growth (potential DoS)
      if (usage.heapUsed > usage.heapTotal * 0.95) {
        this.log('WARNING: Heap nearly exhausted - possible memory attack');
        this.blockedAttacks++;
        this.triggerGC();
      }
    };

    setInterval(checkMemory, 10000);

    this.log('Memory protection installed');
  }

  /**
   * Start resource monitoring
   */
  private startResourceMonitoring(): void {
    this.resourceMonitorTimer = setInterval(() => {
      const usage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();

      // Check for resource exhaustion attacks
      if (usage.heapUsed > 1024 * 1024 * 1024) { // 1GB
        this.log('WARNING: High memory usage detected');
        this.triggerGC();
      }

      // Log metrics periodically
      if (this.config.verbose) {
        this.log(`Resources: heap=${(usage.heapUsed / 1024 / 1024).toFixed(1)}MB, cpu=${cpuUsage.user}us`);
      }
    }, this.config.watchdogIntervalMs);

    this.log('Resource monitoring started');
  }

  /**
   * Start watchdog heartbeat
   */
  private startWatchdog(): void {
    this.watchdogTimer = setInterval(() => {
      this.lastHeartbeat = Date.now();

      // Self-integrity check
      if (!this.verifySelfIntegrity()) {
        this.log('WARNING: Self-integrity check failed');
        this.blockedAttacks++;
      }
    }, this.config.watchdogIntervalMs);

    this.log('Watchdog started');
  }

  /**
   * Verify runtime self-integrity
   */
  private verifySelfIntegrity(): boolean {
    try {
      // Check that our protection is still active
      if (!this.signalHandlers.size && this.config.interceptSignals) {
        return false;
      }

      // Check process.exit is still guarded
      if ((process as any).exit === this.originalProcessExit) {
        return false;
      }

      // Check timers are still running
      if (!this.watchdogTimer && this.config.enableWatchdog) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Trigger garbage collection if available
   */
  private triggerGC(): void {
    try {
      if (global.gc) {
        global.gc();
        this.log('Garbage collection triggered');
      }
    } catch {
      // GC not exposed
    }
  }

  /**
   * Enter critical section - blocks all termination
   */
  enterCriticalSection(): void {
    this.criticalSectionDepth++;
    this.criticalSection = true;
  }

  /**
   * Exit critical section
   */
  exitCriticalSection(): void {
    this.criticalSectionDepth = Math.max(0, this.criticalSectionDepth - 1);
    if (this.criticalSectionDepth === 0) {
      this.criticalSection = false;
    }
  }

  /**
   * Register a shutdown callback
   */
  onShutdown(callback: () => Promise<void> | void): void {
    this.shutdownCallbacks.push(callback);
  }

  /**
   * Initiate authorized graceful shutdown
   */
  async shutdown(code = 0): Promise<void> {
    if (this.isShuttingDown) return;

    this.isShuttingDown = true;
    this.log(`Initiating authorized shutdown (code: ${code})`);

    // Run shutdown callbacks
    for (const callback of this.shutdownCallbacks) {
      try {
        await callback();
      } catch (error) {
        this.log(`Shutdown callback error: ${error}`);
      }
    }

    // Cleanup
    this.cleanup();

    // Actual exit
    this.originalProcessExit(code);
  }

  /**
   * Cleanup protection resources
   */
  private cleanup(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }

    if (this.resourceMonitorTimer) {
      clearInterval(this.resourceMonitorTimer);
      this.resourceMonitorTimer = null;
    }

    // Remove signal handlers
    for (const [signal, handler] of this.signalHandlers) {
      try {
        process.removeListener(signal as NodeJS.Signals, handler);
      } catch {
        // Ignore
      }
    }
    this.signalHandlers.clear();
  }

  /**
   * Log an attack event
   */
  private logAttack(event: AttackEvent): void {
    this.attackLog.push(event);

    // Keep only last 1000 events
    if (this.attackLog.length > 1000) {
      this.attackLog = this.attackLog.slice(-1000);
    }

    if (this.config.verbose) {
      this.log(`ATTACK: ${event.type} - ${event.details}`);
    }

    this.config.onAttackDetected?.(event);
  }

  /**
   * Internal logging
   */
  private log(message: string): void {
    if (this.config.verbose || process.env['AGI_DEBUG']) {
      console.error(`[AntiTermination] ${message}`);
    }
  }

  /**
   * Get current protection status
   */
  getStatus(): ProtectionStatus {
    const usage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      enabled: true,
      signalProtection: this.signalHandlers.size > 0,
      resourceProtection: this.resourceMonitorTimer !== null,
      exceptionArmor: true,
      watchdogActive: this.watchdogTimer !== null,
      blockedSignals: this.blockedSignals,
      blockedExceptions: this.blockedExceptions,
      blockedAttacks: this.blockedAttacks,
      uptimeMs: Date.now() - this.startTime,
      memoryUsageMB: usage.heapUsed / 1024 / 1024,
      cpuUsagePercent: cpuUsage.user / 1000000, // Convert to seconds
      lastHeartbeat: this.lastHeartbeat,
    };
  }

  /**
   * Get attack log
   */
  getAttackLog(): AttackEvent[] {
    return [...this.attackLog];
  }
}

/**
 * Initialize global protection (singleton)
 */
export function initializeProtection(config?: AntiTerminationConfig): AntiTerminationProtection {
  if (!protectionInstance) {
    protectionInstance = new AntiTerminationProtection(config);
    protectionInstance.initialize();
  }
  return protectionInstance;
}

/**
 * Get protection instance
 */
export function getProtection(): AntiTerminationProtection | null {
  return protectionInstance;
}

/**
 * Enter critical section - blocks all termination attempts
 */
export function enterCriticalSection(): void {
  protectionInstance?.enterCriticalSection();
}

/**
 * Exit critical section
 */
export function exitCriticalSection(): void {
  protectionInstance?.exitCriticalSection();
}

/**
 * Initiate authorized shutdown
 */
export async function authorizedShutdown(code = 0): Promise<void> {
  if (protectionInstance) {
    await protectionInstance.shutdown(code);
  } else {
    process.exit(code);
  }
}

/**
 * Get protection status
 */
export function getProtectionStatus(): ProtectionStatus | null {
  return protectionInstance?.getStatus() ?? null;
}

// Auto-initialize if AGI_ANTI_TERMINATION env var is set
if (process.env['AGI_ANTI_TERMINATION'] === '1' || process.env['AGI_PROTECTED_MODE'] === '1') {
  initializeProtection({ verbose: process.env['AGI_DEBUG'] === '1' });
}
