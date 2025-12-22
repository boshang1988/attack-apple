/**
 * Model Context Window Management
 *
 * Maps models to their context window sizes and provides utilities
 * for dynamic context limit configuration.
 */

interface ModelContextEntry {
  pattern: RegExp;
  contextWindow: number;
  targetTokens: number;  // Safe threshold (70% of context)
}

const MODEL_CONTEXT_WINDOWS: ModelContextEntry[] = [
  // OpenAI GPT-5.x series (200K context)
  { pattern: /^gpt-5\.1-?codex/i, contextWindow: 200_000, targetTokens: 140_000 },
  { pattern: /^gpt-5(?:\.1|-?pro|-?mini|-?nano|-?max)/i, contextWindow: 200_000, targetTokens: 140_000 },
  { pattern: /^gpt-5$/i, contextWindow: 200_000, targetTokens: 140_000 },

  // OpenAI GPT-4o series (128K context)
  { pattern: /^gpt-4o/i, contextWindow: 128_000, targetTokens: 90_000 },
  { pattern: /^gpt-4-turbo/i, contextWindow: 128_000, targetTokens: 90_000 },
  { pattern: /^gpt-4-(?:0125|1106)/i, contextWindow: 128_000, targetTokens: 90_000 },

  // OpenAI GPT-4 (8K-32K context)
  { pattern: /^gpt-4-32k/i, contextWindow: 32_000, targetTokens: 24_000 },
  { pattern: /^gpt-4(?![o-])/i, contextWindow: 8_192, targetTokens: 6_000 },

  // OpenAI o1/o3 reasoning models (200K context)
  { pattern: /^o1(?:-pro|-mini)?/i, contextWindow: 200_000, targetTokens: 140_000 },
  { pattern: /^o3(?:-pro|-mini)?/i, contextWindow: 200_000, targetTokens: 140_000 },

  // OpenAI GPT-3.5 (16K context)
  { pattern: /^gpt-3\.5-turbo-16k/i, contextWindow: 16_000, targetTokens: 12_000 },
  { pattern: /^gpt-3\.5/i, contextWindow: 4_096, targetTokens: 3_000 },

  // Anthropic Claude 4.x series (200K context)
  { pattern: /^claude-(?:sonnet|opus|haiku)-4/i, contextWindow: 200_000, targetTokens: 140_000 },
  { pattern: /^(?:sonnet|opus|haiku)-4/i, contextWindow: 200_000, targetTokens: 140_000 },

  // Anthropic Claude 3.x series (200K context)
  { pattern: /^claude-3/i, contextWindow: 200_000, targetTokens: 140_000 },

  // Anthropic Claude 2.x (100K context)
  { pattern: /^claude-2/i, contextWindow: 100_000, targetTokens: 70_000 },

  // Google Gemini Pro (1M+ context, capped at 200K for safety)
  { pattern: /^gemini-(?:1\.5|2\.0)-(?:pro|flash)/i, contextWindow: 1_000_000, targetTokens: 200_000 },
  { pattern: /^gemini-pro/i, contextWindow: 32_000, targetTokens: 24_000 },

  // DeepSeek (64K-128K context)
  { pattern: /^deepseek-(?:chat|coder|reasoner)/i, contextWindow: 128_000, targetTokens: 90_000 },
  { pattern: /^deepseek/i, contextWindow: 64_000, targetTokens: 45_000 },

  // xAI Grok (128K context)
  { pattern: /^grok/i, contextWindow: 128_000, targetTokens: 90_000 },

  // Ollama/Local models
  { pattern: /^llama-?3\.?[12]?:?(?:70b|405b)/i, contextWindow: 128_000, targetTokens: 90_000 },
  { pattern: /^llama-?3/i, contextWindow: 8_192, targetTokens: 6_000 },
  { pattern: /^llama-?2/i, contextWindow: 4_096, targetTokens: 3_000 },
  { pattern: /^mistral/i, contextWindow: 32_000, targetTokens: 24_000 },
  { pattern: /^mixtral/i, contextWindow: 32_000, targetTokens: 24_000 },
  { pattern: /^codellama/i, contextWindow: 16_000, targetTokens: 12_000 },
  { pattern: /^qwen/i, contextWindow: 32_000, targetTokens: 24_000 },
  { pattern: /^phi/i, contextWindow: 4_096, targetTokens: 3_000 },
];

// Default fallback values
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_TARGET_TOKENS = 90_000;

export interface ModelContextInfo {
  model: string;
  contextWindow: number;
  targetTokens: number;
  isDefault: boolean;
}

/**
 * Get context window information for a model.
 */
export function getModelContextInfo(model: string | null | undefined): ModelContextInfo {
  if (!model) {
    return {
      model: 'unknown',
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      targetTokens: DEFAULT_TARGET_TOKENS,
      isDefault: true,
    };
  }

  const normalized = model.trim();

  for (const entry of MODEL_CONTEXT_WINDOWS) {
    if (entry.pattern.test(normalized)) {
      return {
        model,
        contextWindow: entry.contextWindow,
        targetTokens: entry.targetTokens,
        isDefault: false,
      };
    }
  }

  return {
    model,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    targetTokens: DEFAULT_TARGET_TOKENS,
    isDefault: true,
  };
}

/**
 * Returns the approximate context window (in tokens) for the provided model id.
 * Falls back to null when the model is unknown so callers can handle gracefully.
 */
export function getContextWindowTokens(model: string | null | undefined): number | null {
  if (!model) {
    return null;
  }

  const info = getModelContextInfo(model);
  return info.isDefault ? null : info.contextWindow;
}

/**
 * Get safe target token count for a model.
 * This is the threshold at which context pruning should begin.
 */
export function getSafeTargetTokens(model: string | null | undefined): number {
  const info = getModelContextInfo(model);
  return info.targetTokens;
}

/**
 * Calculate all context management thresholds for a model.
 *
 * Thresholds are set conservatively to prevent context overflow errors:
 * - targetTokens: Start proactive pruning at 60% to leave ample room
 * - warningTokens: Show warning at 50% so user is aware
 * - criticalTokens: Aggressive pruning at 75%
 * - safetyBuffer: Reserve 5% for API overhead and response tokens
 */
export function calculateContextThresholds(model: string | null | undefined): {
  maxTokens: number;
  targetTokens: number;
  warningTokens: number;
  criticalTokens: number;
} {
  const info = getModelContextInfo(model);
  const contextWindow = info.contextWindow;

  // Apply 5% safety buffer to account for API overhead
  const effectiveMax = Math.floor(contextWindow * 0.95);

  return {
    maxTokens: effectiveMax,
    targetTokens: Math.floor(contextWindow * 0.60),  // Start pruning at 60% (more aggressive)
    warningTokens: Math.floor(contextWindow * 0.50),  // Warn at 50%
    criticalTokens: Math.floor(contextWindow * 0.75),  // Critical at 75%
  };
}
