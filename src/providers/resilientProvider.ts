/**
 * Resilient Provider Wrapper
 *
 * Adds rate limiting, exponential backoff retry, and circuit breaker
 * patterns to any LLM provider for maximum reliability and performance.
 *
 * PERF: Provider-agnostic wrapper that prevents rate limit errors and
 * automatically recovers from transient failures.
 */

import type {
  LLMProvider,
  ConversationMessage,
  ProviderToolDefinition,
  ProviderResponse,
  StreamChunk,
  ProviderId,
} from '../core/types.js';
import { RateLimiter, retry, sleep } from '../utils/asyncUtils.js';

export interface ResilientProviderConfig {
  /** Maximum requests per window (default: 50) */
  maxRequestsPerMinute?: number;
  /** Maximum retry attempts (default: 4) */
  maxRetries?: number;
  /** Base delay for exponential backoff in ms (default: 1000) */
  baseDelayMs?: number;
  /** Maximum delay between retries in ms (default: 32000) */
  maxDelayMs?: number;
  /** Enable circuit breaker pattern (default: true) */
  enableCircuitBreaker?: boolean;
  /** Number of failures before circuit opens (default: 5) */
  circuitBreakerThreshold?: number;
  /** Time before circuit resets in ms (default: 60000) */
  circuitBreakerResetMs?: number;
}

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
}

const RATE_LIMIT_PATTERNS = [
  'rate limit',
  'rate_limit',
  'ratelimit',
  'too many requests',
  '429',
  'quota exceeded',
  'request limit',
  'throttled',
  'overloaded',
  'capacity',
];

const TRANSIENT_ERROR_PATTERNS = [
  'timeout',
  'timed out',
  'network',
  'connection',
  'econnrefused',
  'econnreset',
  'enotfound',
  'epipe',
  'econnaborted',
  'ehostunreach',
  'enetunreach',
  'socket',
  'temporarily unavailable',
  '502',
  '503',
  '504',
  'bad gateway',
  'service unavailable',
  'gateway timeout',
  'internal server error',
  '500',
  // Stream and fetch errors
  'premature close',
  'premature end',
  'unexpected end',
  'stream',
  'aborted',
  'fetcherror',
  'fetch error',
  'invalid response body',
  'response body',
  'gunzip',
  'decompress',
  'zlib',
  'content-encoding',
  'chunked encoding',
  'transfer-encoding',
  // SSL/TLS errors
  'ssl',
  'tls',
  'certificate',
  'cert',
  'handshake',
];

const FALLBACK_ELIGIBLE_PATTERNS = [
  // Quota/billing errors
  'insufficient_quota',
  'quota exceeded',
  'exceeded your current quota',
  'billing',
  'payment required',
  'account suspended',
  'account disabled',
  // API key errors
  'api key expired',
  'api_key_invalid',
  'invalid api key',
  'invalid_api_key',
  'api key not valid',
  // Model availability errors
  'model not found',
  'model_not_found',
  'does not exist',
  'not available',
  'deprecated',
  'access denied',
  'permission denied',
  'unauthorized',
  '401',
  '403',
  '400',
  'invalid_argument',
  // Regional/access restrictions
  'region',
  'not supported in your',
  'country',
  'restricted',
];

/**
 * Check if an error warrants trying a different provider (fallback).
 * These are non-transient errors that won't be fixed by retrying the same provider.
 */
export function isFallbackEligibleError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();

  // Check message for fallback patterns
  if (FALLBACK_ELIGIBLE_PATTERNS.some(pattern => message.includes(pattern))) {
    return true;
  }

  // Check error code/type/reason if present (OpenAI and Google style errors)
  const errorWithCode = error as { code?: string | number; type?: string; reason?: string; status?: string };
  const code = String(errorWithCode.code ?? '').toLowerCase();
  const type = (errorWithCode.type ?? '').toLowerCase();
  const reason = (errorWithCode.reason ?? '').toLowerCase();
  const status = (errorWithCode.status ?? '').toLowerCase();

  // OpenAI style errors
  if (code === 'insufficient_quota' || type === 'insufficient_quota') {
    return true;
  }
  if (code === 'model_not_found' || type === 'model_not_found') {
    return true;
  }
  if (code === 'invalid_api_key' || type === 'invalid_api_key') {
    return true;
  }

  // Google style errors
  if (reason === 'api_key_invalid' || status === 'invalid_argument') {
    return true;
  }
  if (code === '400' || code === '401' || code === '403') {
    return true;
  }

  return false;
}

/**
 * Get a user-friendly description of why fallback is needed
 */
export function getFallbackReason(error: unknown): string {
  if (!(error instanceof Error)) return 'Unknown error';
  const message = error.message.toLowerCase();

  if (message.includes('quota') || message.includes('billing')) {
    return 'API quota exceeded or billing issue';
  }
  if (message.includes('expired') || message.includes('api_key_invalid') || message.includes('api key')) {
    return 'API key expired or invalid';
  }
  if (message.includes('model') && (message.includes('not found') || message.includes('not exist'))) {
    return 'Model not available';
  }
  if (message.includes('unauthorized') || message.includes('401') || message.includes('invalid_api_key')) {
    return 'Invalid API key';
  }
  if (message.includes('403') || message.includes('permission') || message.includes('access denied')) {
    return 'Access denied';
  }
  if (message.includes('400') || message.includes('invalid_argument')) {
    return 'Invalid request or API key';
  }
  if (message.includes('region') || message.includes('country') || message.includes('restricted')) {
    return 'Regional restriction';
  }

  return 'Provider error';
}

function isRateLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return RATE_LIMIT_PATTERNS.some(pattern => message.includes(pattern));
}

function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  // Check message
  const message = error.message.toLowerCase();
  if (TRANSIENT_ERROR_PATTERNS.some(pattern => message.includes(pattern))) {
    return true;
  }

  // Check error name/type (FetchError, AbortError, etc.)
  const errorName = error.name?.toLowerCase() ?? '';
  if (errorName.includes('fetch') || errorName.includes('abort') || errorName.includes('network')) {
    return true;
  }

  // Check error code if present (Node.js style)
  const errorCode = (error as { code?: string }).code?.toLowerCase() ?? '';
  if (errorCode && TRANSIENT_ERROR_PATTERNS.some(pattern => errorCode.includes(pattern))) {
    return true;
  }

  // Check cause chain for nested errors
  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    return isTransientError(cause);
  }

  return false;
}

function shouldRetry(error: unknown): boolean {
  return isRateLimitError(error) || isTransientError(error);
}

/**
 * Wraps any LLM provider with rate limiting and retry logic
 */
export class ResilientProvider implements LLMProvider {
  readonly id: ProviderId;
  readonly model: string;
  private readonly provider: LLMProvider;
  private readonly rateLimiter: RateLimiter;
  private readonly config: Required<ResilientProviderConfig>;
  private readonly circuitBreaker: CircuitBreakerState;
  private stats = {
    totalRequests: 0,
    rateLimitHits: 0,
    retries: 0,
    circuitBreakerTrips: 0,
  };

  constructor(provider: LLMProvider, config: ResilientProviderConfig = {}) {
    this.provider = provider;
    this.id = provider.id;
    this.model = provider.model;
    this.config = {
      maxRequestsPerMinute: config.maxRequestsPerMinute ?? 50,
      maxRetries: config.maxRetries ?? 4,
      baseDelayMs: config.baseDelayMs ?? 1000,
      maxDelayMs: config.maxDelayMs ?? 32000,
      enableCircuitBreaker: config.enableCircuitBreaker ?? true,
      circuitBreakerThreshold: config.circuitBreakerThreshold ?? 5,
      circuitBreakerResetMs: config.circuitBreakerResetMs ?? 60000,
    };

    this.rateLimiter = new RateLimiter({
      maxRequests: this.config.maxRequestsPerMinute,
      windowMs: 60000,
    });

    this.circuitBreaker = {
      failures: 0,
      lastFailure: 0,
      isOpen: false,
    };
  }

  /**
   * Check and potentially reset circuit breaker
   */
  private checkCircuitBreaker(): void {
    if (!this.config.enableCircuitBreaker) return;

    if (this.circuitBreaker.isOpen) {
      const elapsed = Date.now() - this.circuitBreaker.lastFailure;
      if (elapsed >= this.config.circuitBreakerResetMs) {
        // Half-open: allow one request through
        this.circuitBreaker.isOpen = false;
        this.circuitBreaker.failures = Math.floor(this.circuitBreaker.failures / 2);
      } else {
        throw new Error(
          `Circuit breaker is open. Too many failures (${this.circuitBreaker.failures}). ` +
          `Retry in ${Math.ceil((this.config.circuitBreakerResetMs - elapsed) / 1000)}s.`
        );
      }
    }
  }

  /**
   * Record a failure for circuit breaker
   */
  private recordFailure(_error?: unknown): void {
    if (!this.config.enableCircuitBreaker) return;

    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailure = Date.now();

    if (this.circuitBreaker.failures >= this.config.circuitBreakerThreshold) {
      this.circuitBreaker.isOpen = true;
      this.stats.circuitBreakerTrips++;
    }
  }

  /**
   * Record a success to reset circuit breaker
   */
  private recordSuccess(): void {
    if (this.config.enableCircuitBreaker && this.circuitBreaker.failures > 0) {
      this.circuitBreaker.failures = Math.max(0, this.circuitBreaker.failures - 1);
    }
  }

  /**
   * Execute a request with rate limiting and retry
   */
  private async executeWithResilience<T>(
    operation: () => Promise<T>,
    _operationName?: string
  ): Promise<T> {
    this.stats.totalRequests++;

    // Check circuit breaker
    this.checkCircuitBreaker();

    // Acquire rate limit token
    await this.rateLimiter.acquire();

    try {
      const result = await retry(
        operation,
        {
          maxRetries: this.config.maxRetries,
          baseDelayMs: this.config.baseDelayMs,
          maxDelayMs: this.config.maxDelayMs,
          backoffMultiplier: 2,
          shouldRetry: (error) => {
            if (shouldRetry(error)) {
              this.stats.retries++;
              if (isRateLimitError(error)) {
                this.stats.rateLimitHits++;
              }
              return true;
            }
            return false;
          },
        }
      );

      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure(error);
      throw error;
    }
  }

  /**
   * Generate a response with resilience
   */
  async generate(
    messages: ConversationMessage[],
    tools: ProviderToolDefinition[]
  ): Promise<ProviderResponse> {
    return this.executeWithResilience(
      () => this.provider.generate(messages, tools),
      'generate'
    );
  }

  /**
   * Generate a streaming response with resilience
   *
   * Note: Retry logic is limited for streaming - we can only retry
   * before the stream starts, not mid-stream.
   */
  async *generateStream(
    messages: ConversationMessage[],
    tools: ProviderToolDefinition[]
  ): AsyncIterableIterator<StreamChunk> {
    if (!this.provider.generateStream) {
      // Fall back to non-streaming
      const response = await this.generate(messages, tools);
      if (response.type === 'message') {
        yield { type: 'content', content: response.content };
      } else if (response.type === 'tool_calls') {
        if (response.content) {
          yield { type: 'content', content: response.content };
        }
        if (response.toolCalls) {
          for (const call of response.toolCalls) {
            yield { type: 'tool_call', toolCall: call };
          }
        }
      }
      if (response.usage) {
        yield { type: 'usage', usage: response.usage };
      }
      return;
    }

    this.stats.totalRequests++;

    // Check circuit breaker
    this.checkCircuitBreaker();

    // Acquire rate limit token
    await this.rateLimiter.acquire();

    let attempts = 0;
    let lastError: unknown;

    while (attempts <= this.config.maxRetries) {
      try {
        const stream = this.provider.generateStream(messages, tools);
        for await (const chunk of stream) {
          yield chunk;
        }
        this.recordSuccess();
        return;
      } catch (err) {
        lastError = err;
        attempts++;

        if (attempts <= this.config.maxRetries && shouldRetry(err)) {
          this.stats.retries++;
          if (isRateLimitError(err)) {
            this.stats.rateLimitHits++;
          }

          const delay = Math.min(
            this.config.baseDelayMs * Math.pow(2, attempts - 1),
            this.config.maxDelayMs
          );
          await sleep(delay);
          continue;
        }

        this.recordFailure(err);
        throw err;
      }
    }

    this.recordFailure(lastError);
    throw lastError;
  }

  /**
   * Get resilience statistics
   */
  getStats(): {
    totalRequests: number;
    rateLimitHits: number;
    retries: number;
    circuitBreakerTrips: number;
    circuitBreakerOpen: boolean;
    availableTokens: number;
  } {
    return {
      ...this.stats,
      circuitBreakerOpen: this.circuitBreaker.isOpen,
      availableTokens: this.rateLimiter.availableTokens,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalRequests: 0,
      rateLimitHits: 0,
      retries: 0,
      circuitBreakerTrips: 0,
    };
  }
}

/**
 * Wrap any provider with resilience features
 */
export function withResilience(
  provider: LLMProvider,
  config?: ResilientProviderConfig
): ResilientProvider {
  return new ResilientProvider(provider, config);
}

/**
 * Provider-specific recommended configurations
 */
export const PROVIDER_RESILIENCE_CONFIGS: Record<string, ResilientProviderConfig> = {
  anthropic: {
    maxRequestsPerMinute: 50,
    maxRetries: 4,
    baseDelayMs: 1500,
    maxDelayMs: 40000,
  },
  openai: {
    maxRequestsPerMinute: 60,
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
  },
  google: {
    maxRequestsPerMinute: 60,
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
  },
  deepseek: {
    maxRequestsPerMinute: 30,
    maxRetries: 4,
    baseDelayMs: 2000,
    maxDelayMs: 45000,
  },
  xai: {
    maxRequestsPerMinute: 40,
    maxRetries: 3,
    baseDelayMs: 1500,
    maxDelayMs: 35000,
  },
  ollama: {
    maxRequestsPerMinute: 100,
    maxRetries: 2,
    baseDelayMs: 500,
    maxDelayMs: 10000,
    enableCircuitBreaker: false, // Local, less likely to need circuit breaker
  },
};

/**
 * Wrap a provider with resilience using provider-specific defaults
 */
export function withProviderResilience(
  provider: LLMProvider,
  providerId: string,
  overrides?: Partial<ResilientProviderConfig>
): ResilientProvider {
  const defaults = PROVIDER_RESILIENCE_CONFIGS[providerId] ?? {};
  return new ResilientProvider(provider, { ...defaults, ...overrides });
}
