/**
 * Embedding Providers - Pluggable vector embedding backends
 *
 * Supports:
 * - Simple (built-in, no dependencies)
 * - OpenAI text-embedding-3-small/large
 * - Ollama local embeddings
 * - Custom providers via interface
 */

import type { EmbeddingProvider } from './episodicMemory.js';

// ============================================================================
// OPENAI EMBEDDING PROVIDER
// ============================================================================

export interface OpenAIEmbeddingConfig {
  apiKey: string;
  model?: 'text-embedding-3-small' | 'text-embedding-3-large' | 'text-embedding-ada-002';
  baseUrl?: string;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai';
  readonly dimension: number;

  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(config: OpenAIEmbeddingConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || 'text-embedding-3-small';
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';

    // Set dimension based on model
    switch (this.model) {
      case 'text-embedding-3-large':
        this.dimension = 3072;
        break;
      case 'text-embedding-ada-002':
        this.dimension = 1536;
        break;
      case 'text-embedding-3-small':
      default:
        this.dimension = 1536;
        break;
    }
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI embedding failed: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[] }>;
    };

    return data.data[0]?.embedding || [];
  }
}

// ============================================================================
// OLLAMA EMBEDDING PROVIDER
// ============================================================================

export interface OllamaEmbeddingConfig {
  model?: string;
  baseUrl?: string;
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'ollama';
  readonly dimension = 4096; // Default for most Ollama models

  private model: string;
  private baseUrl: string;

  constructor(config: OllamaEmbeddingConfig = {}) {
    this.model = config.model || 'nomic-embed-text';
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        prompt: text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama embedding failed: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      embedding: number[];
    };

    return data.embedding || [];
  }
}

// ============================================================================
// DEEPSEEK EMBEDDING PROVIDER
// ============================================================================

export interface DeepSeekEmbeddingConfig {
  apiKey: string;
  baseUrl?: string;
}

export class DeepSeekEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'deepseek';
  readonly dimension = 1024;

  private apiKey: string;
  private baseUrl: string;

  constructor(config: DeepSeekEmbeddingConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.deepseek.com/v1';
  }

  async embed(text: string): Promise<number[]> {
    // DeepSeek uses OpenAI-compatible API
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-embedding',
        input: text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`DeepSeek embedding failed: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[] }>;
    };

    return data.data[0]?.embedding || [];
  }
}

// ============================================================================
// CACHED EMBEDDING PROVIDER WRAPPER
// ============================================================================

export class CachedEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  readonly dimension: number;

  private provider: EmbeddingProvider;
  private cache: Map<string, number[]> = new Map();
  private maxCacheSize: number;

  constructor(provider: EmbeddingProvider, maxCacheSize = 10000) {
    this.provider = provider;
    this.name = `cached-${provider.name}`;
    this.dimension = provider.dimension;
    this.maxCacheSize = maxCacheSize;
  }

  async embed(text: string): Promise<number[]> {
    // Check cache first
    const cached = this.cache.get(text);
    if (cached) {
      return cached;
    }

    // Generate embedding
    const embedding = await this.provider.embed(text);

    // Cache result
    if (this.cache.size >= this.maxCacheSize) {
      // Remove oldest entry (first key)
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(text, embedding);

    return embedding;
  }

  clearCache(): void {
    this.cache.clear();
  }

  getCacheStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
    };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export type EmbeddingProviderType = 'simple' | 'openai' | 'ollama' | 'deepseek';

export interface EmbeddingProviderOptions {
  type: EmbeddingProviderType;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  useCache?: boolean;
  maxCacheSize?: number;
}

/**
 * Create an embedding provider based on configuration
 */
export function createEmbeddingProvider(options: EmbeddingProviderOptions): EmbeddingProvider {
  let provider: EmbeddingProvider;

  switch (options.type) {
    case 'openai':
      if (!options.apiKey) {
        throw new Error('OpenAI embedding provider requires apiKey');
      }
      provider = new OpenAIEmbeddingProvider({
        apiKey: options.apiKey,
        model: options.model as OpenAIEmbeddingConfig['model'],
        baseUrl: options.baseUrl,
      });
      break;

    case 'ollama':
      provider = new OllamaEmbeddingProvider({
        model: options.model,
        baseUrl: options.baseUrl,
      });
      break;

    case 'deepseek':
      if (!options.apiKey) {
        throw new Error('DeepSeek embedding provider requires apiKey');
      }
      provider = new DeepSeekEmbeddingProvider({
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
      });
      break;

    case 'simple':
    default:
      // Simple provider is built into episodicMemory.ts
      // Return a placeholder that will use the default
      return {
        name: 'simple',
        dimension: 256,
        embed: async (text: string) => {
          // This is a simplified version - the real one is in episodicMemory.ts
          const tokens = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 2);
          const vector = new Array(256).fill(0);
          for (const token of tokens) {
            let hash = 0;
            for (let i = 0; i < token.length; i++) {
              hash = ((hash << 5) - hash) + token.charCodeAt(i);
              hash = hash & hash;
            }
            vector[Math.abs(hash) % 256] += 1;
          }
          const mag = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
          return mag > 0 ? vector.map(v => v / mag) : vector;
        },
      };
  }

  // Wrap with cache if requested
  if (options.useCache) {
    return new CachedEmbeddingProvider(provider, options.maxCacheSize);
  }

  return provider;
}

/**
 * Auto-detect best available embedding provider
 */
export function autoDetectEmbeddingProvider(): EmbeddingProvider {
  // Check for API keys in environment
  const openaiKey = process.env['OPENAI_API_KEY'];
  const deepseekKey = process.env['DEEPSEEK_API_KEY'];

  if (openaiKey) {
    return createEmbeddingProvider({
      type: 'openai',
      apiKey: openaiKey,
      useCache: true,
    });
  }

  if (deepseekKey) {
    return createEmbeddingProvider({
      type: 'deepseek',
      apiKey: deepseekKey,
      useCache: true,
    });
  }

  // Try Ollama (local)
  // Could add a ping check here, but for now just use simple
  return createEmbeddingProvider({ type: 'simple' });
}
