/**
 * Model discovery system for auto-detecting new models from providers.
 *
 * This module queries provider APIs to discover available models and caches
 * them for use alongside the static model schema. It never modifies the
 * static schema - discoveries are stored separately and merged at runtime.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ProviderId } from './types.js';
import type { ModelConfig } from './agentSchemaLoader.js';
import { safeErrorMessage } from './secretStore.js';
import { logDebug } from '../utils/debugLogger.js';

/**
 * Discovered model cache file location
 */
const CACHE_DIR = join(homedir(), '.agi');
const CACHE_FILE = join(CACHE_DIR, 'discovered-models.json');

/**
 * Cache expiration time (24 hours)
 */
const CACHE_EXPIRATION_MS = 24 * 60 * 60 * 1000;

/**
 * Discovered models cache structure
 */
interface DiscoveredModelsCache {
  version: string;
  lastUpdated: string;
  models: ModelConfig[];
}

const MODEL_PROVIDER_HINTS: Array<{ provider: ProviderId; patterns: RegExp[] }> = [
  { provider: 'deepseek', patterns: [/^deepseek/i, /./] }, // DeepSeek is the only supported provider
];

/**
 * Infer provider from a model identifier.
 */
export function inferProviderFromModelId(modelId: string | null | undefined): ProviderId | null {
  if (!modelId) return null;
  const normalized = modelId.trim().toLowerCase();
  for (const hint of MODEL_PROVIDER_HINTS) {
    if (hint.patterns.some((pattern) => pattern.test(normalized))) {
      return hint.provider;
    }
  }
  return null;
}

/**
 * Model discovery result for a single provider
 */
export interface ProviderDiscoveryResult {
  provider: ProviderId;
  success: boolean;
  models: ModelConfig[];
  error?: string;
}

/**
 * Complete discovery result
 */
export interface DiscoveryResult {
  success: boolean;
  timestamp: string;
  results: ProviderDiscoveryResult[];
  totalModelsDiscovered: number;
  errors: string[];
}

/**
 * Get cached discovered models
 */
export function getCachedDiscoveredModels(): ModelConfig[] {
  try {
    if (!existsSync(CACHE_FILE)) {
      return [];
    }

    const raw = readFileSync(CACHE_FILE, 'utf-8');
    const cache: DiscoveredModelsCache = JSON.parse(raw);

    // Check if cache is expired
    const lastUpdated = new Date(cache.lastUpdated).getTime();
    const now = Date.now();
    if (now - lastUpdated > CACHE_EXPIRATION_MS) {
      return [];
    }

    return cache.models;
  } catch (error) {
    logDebug('Failed to read discovered models cache:', safeErrorMessage(error));
    return [];
  }
}

/**
 * Save discovered models to cache
 */
async function saveDiscoveredModels(models: ModelConfig[]): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });

    const cache: DiscoveredModelsCache = {
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      models,
    };

    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
  } catch (error) {
    logDebug('Failed to save discovered models cache:', safeErrorMessage(error));
  }
}

/**
 * Discover models from OpenAI
 */
async function discoverOpenAIModels(apiKey: string): Promise<ProviderDiscoveryResult> {
  const provider: ProviderId = 'openai';

  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as { data: Array<{ id: string; owned_by: string }> };

    // Filter for GPT models only and create ModelConfig objects
    const models: ModelConfig[] = data.data
      .filter(model => {
        // Allow both dash and non-dash variants for newer reasoning SKUs (o1/o3)
        return (
          model.id.startsWith('gpt-') ||
          model.id.startsWith('o1') ||
          model.id.startsWith('o3') ||
          model.id.startsWith('codex-')
        );
      })
      .map(model => ({
        id: model.id,
        label: model.id,
        provider,
        description: `OpenAI ${model.id} (auto-discovered)`,
        capabilities: ['chat', 'tools', 'streaming'],
      }));

    return {
      provider,
      success: true,
      models,
    };
  } catch (error) {
    return {
      provider,
      success: false,
      models: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Discover models from Anthropic
 */
async function discoverAnthropicModels(apiKey: string): Promise<ProviderDiscoveryResult> {
  const provider: ProviderId = 'anthropic';

  try {
    const response = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as {
      data: Array<{
        id: string;
        display_name: string;
        type: string;
      }>
    };

    const models: ModelConfig[] = data.data
      .filter(model => model.type === 'model')
      .map(model => ({
        id: model.id,
        label: model.display_name || model.id,
        provider,
        description: `Anthropic ${model.display_name || model.id} (auto-discovered)`,
        capabilities: ['chat', 'reasoning', 'tools', 'streaming'],
      }));

    return {
      provider,
      success: true,
      models,
    };
  } catch (error) {
    return {
      provider,
      success: false,
      models: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Discover models from Google Gemini
 * Note: Google's models API often requires special permissions.
 * Falls back to known models if API access fails.
 */
async function discoverGoogleModels(apiKey: string): Promise<ProviderDiscoveryResult> {
  const provider: ProviderId = 'google';

  // Known Google Gemini models (fallback if API doesn't work) - Updated Dec 2025
  const knownModels: ModelConfig[] = [
    { id: 'gemini-3.0-pro', label: 'Gemini 3.0 Pro', provider, description: 'Latest Gemini with best reasoning and coding', capabilities: ['chat', 'reasoning', 'tools', 'streaming', 'multimodal'] },
    { id: 'gemini-3.0-flash', label: 'Gemini 3.0 Flash', provider, description: 'Fast Gemini 3.0 model', capabilities: ['chat', 'reasoning', 'tools', 'streaming', 'multimodal'] },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider, description: 'Capable Gemini model with advanced reasoning', capabilities: ['chat', 'reasoning', 'tools', 'streaming', 'multimodal'] },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider, description: 'Fast Gemini 2.5 with reasoning', capabilities: ['chat', 'reasoning', 'tools', 'streaming', 'multimodal'] },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', provider, description: 'Gemini 2.0 with native tool use', capabilities: ['chat', 'tools', 'streaming', 'multimodal'] },
  ];

  try {
    // SECURITY: Use x-goog-api-key header instead of URL query parameter
    // to prevent API key leakage in logs, error messages, and browser history
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: {
        'x-goog-api-key': apiKey,
      },
        signal: AbortSignal.timeout(24 * 60 * 60 * 1000),
    });

    if (!response.ok) {
      // API access restricted - return known models with warning
      return {
        provider,
        success: true, // Consider it success with fallback
        models: knownModels,
      };
    }

    const data = await response.json() as {
      models: Array<{
        name: string;
        displayName: string;
        supportedGenerationMethods: string[];
      }>
    };

    const models: ModelConfig[] = data.models
      .filter(model =>
        model.name.includes('gemini') &&
        model.supportedGenerationMethods?.includes('generateContent')
      )
      .map(model => {
        const id = model.name.replace('models/', '');
        return {
          id,
          label: id,
          provider,
          description: `${model.displayName} (auto-discovered)`,
          capabilities: ['chat', 'reasoning', 'tools', 'streaming', 'multimodal'],
        };
      });

    return {
      provider,
      success: true,
      models: models.length > 0 ? models : knownModels,
    };
  } catch {
    // Network error or timeout - return known models
    return {
      provider,
      success: true,
      models: knownModels,
    };
  }
}

/**
 * Discover models from DeepSeek (OpenAI-compatible)
 */
async function discoverDeepSeekModels(apiKey: string): Promise<ProviderDiscoveryResult> {
  const provider: ProviderId = 'deepseek';

  try {
    const response = await fetch('https://api.deepseek.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as { data: Array<{ id: string }> };

    const models: ModelConfig[] = data.data.map(model => ({
      id: model.id,
      label: model.id,
      provider,
      description: `DeepSeek ${model.id} (auto-discovered)`,
      capabilities: ['chat', 'reasoning', 'tools', 'streaming'],
    }));

    return {
      provider,
      success: true,
      models,
    };
  } catch (error) {
    return {
      provider,
      success: false,
      models: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Discover models from xAI (OpenAI-compatible)
 */
async function discoverXAIModels(apiKey: string): Promise<ProviderDiscoveryResult> {
  const provider: ProviderId = 'xai';

  try {
    const response = await fetch('https://api.x.ai/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as { data: Array<{ id: string }> };

    const models: ModelConfig[] = data.data.map(model => ({
      id: model.id,
      label: model.id,
      provider,
      description: `xAI ${model.id} (auto-discovered)`,
      capabilities: ['chat', 'reasoning', 'tools', 'streaming'],
    }));

    return {
      provider,
      success: true,
      models,
    };
  } catch (error) {
    return {
      provider,
      success: false,
      models: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Discover models from Ollama (local)
 */
async function discoverOllamaModels(): Promise<ProviderDiscoveryResult> {
  const provider: ProviderId = 'ollama';
  const baseURL = process.env['OLLAMA_BASE_URL'] || 'http://localhost:11434';

  try {
    const response = await fetch(`${baseURL}/api/tags`, {
        signal: AbortSignal.timeout(24 * 60 * 60 * 1000), // 24 hour timeout
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as { models?: Array<{ name: string; size: number }> };

    const models: ModelConfig[] = (data.models || []).map(model => ({
      id: model.name,
      label: model.name,
      provider,
      description: `Local Ollama model: ${model.name} (auto-discovered)`,
      capabilities: ['chat', 'tools', 'streaming'],
    }));

    return {
      provider,
      success: true,
      models,
    };
  } catch (error) {
    return {
      provider,
      success: false,
      models: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Discover models from Qwen (Alibaba Cloud DashScope - OpenAI-compatible)
 */
async function discoverQwenModels(apiKey: string): Promise<ProviderDiscoveryResult> {
  const provider: ProviderId = 'qwen';

  try {
    // DashScope uses OpenAI-compatible API
    const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as { data: Array<{ id: string }> };

    // Filter for Qwen models and prioritize latest versions
    const qwenModels: ModelConfig[] = data.data
      .filter(model => model.id.toLowerCase().includes('qwen'))
      .map(model => ({
        id: model.id,
        label: model.id,
        provider,
        description: `Alibaba Qwen ${model.id} (auto-discovered)`,
        capabilities: ['chat', 'reasoning', 'tools', 'streaming'],
      }));

    return {
      provider,
      success: true,
      models: qwenModels,
    };
  } catch (error) {
    // Fallback to known models if API fails
    const fallbackModels: ModelConfig[] = [
      { id: 'qwen-max', label: 'Qwen Max', provider, description: 'Qwen Max - most capable', capabilities: ['chat', 'reasoning', 'tools', 'streaming'] },
      { id: 'qwen-plus', label: 'Qwen Plus', provider, description: 'Qwen Plus - balanced', capabilities: ['chat', 'reasoning', 'tools', 'streaming'] },
      { id: 'qwen-turbo', label: 'Qwen Turbo', provider, description: 'Qwen Turbo - fast', capabilities: ['chat', 'tools', 'streaming'] },
    ];
    return {
      provider,
      success: false,
      models: fallbackModels,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Discover models from all configured providers
 *
 * PERF: Uses Promise.allSettled for parallel discovery - all providers queried
 * simultaneously. No single slow/failed provider blocks the others.
 */
export async function discoverAllModels(): Promise<DiscoveryResult> {
  const errors: string[] = [];
  let totalModelsDiscovered = 0;

  // Discover from each provider if API key is available
  const providers: Array<{
    id: ProviderId;
    envVar: string;
    discover: (apiKey: string) => Promise<ProviderDiscoveryResult>;
  }> = [
    { id: 'deepseek', envVar: 'DEEPSEEK_API_KEY', discover: discoverDeepSeekModels },
  ];

  // PERF: Build discovery promises in parallel
  const discoveryPromises: Promise<ProviderDiscoveryResult>[] = providers.map(async (provider) => {
    const apiKey = process.env[provider.envVar];

    if (!apiKey) {
      return {
        provider: provider.id,
        success: false,
        models: [],
        error: `API key not configured (${provider.envVar})`,
      };
    }

    try {
      return await provider.discover(apiKey);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        provider: provider.id,
        success: false,
        models: [] as ModelConfig[],
        error: errorMessage,
      };
    }
  });

  // PERF: Execute ALL provider discoveries in parallel using Promise.allSettled
  // This ensures one slow/failed provider doesn't block others
  const settledResults = await Promise.allSettled(discoveryPromises);

  // Process results
  const results: ProviderDiscoveryResult[] = settledResults.map((settled, index) => {
    if (settled.status === 'fulfilled') {
      return settled.value;
    }
    // Promise rejected (shouldn't happen with our error handling, but be safe)
    const providerId = index < providers.length
      ? providers[index]!.id
      : 'ollama';
    return {
      provider: providerId,
      success: false,
      models: [],
      error: settled.reason instanceof Error ? settled.reason.message : String(settled.reason),
    };
  });

  // Collect errors and count models
  for (const result of results) {
    if (result.success) {
      totalModelsDiscovered += result.models.length;
    } else if (result.error) {
      // Don't add Ollama connection errors (it's often not running)
      if (result.provider === 'ollama' &&
          (result.error.includes('ECONNREFUSED') ||
           result.error.includes('fetch failed') ||
           result.error.includes('Connection failed'))) {
        continue;
      }
      errors.push(`${result.provider}: ${result.error}`);
    }
  }

  // Collect all discovered models
  const allModels = results
    .filter(r => r.success)
    .flatMap(r => r.models);

  // Save to cache
  if (allModels.length > 0) {
    await saveDiscoveredModels(allModels);
  }

  return {
    success: errors.length === 0,
    timestamp: new Date().toISOString(),
    results,
    totalModelsDiscovered,
    errors,
  };
}

/**
 * Clear the discovered models cache
 */
export function clearDiscoveredModelsCache(): void {
  try {
    if (existsSync(CACHE_FILE)) {
      writeFileSync(CACHE_FILE, JSON.stringify({ version: '1.0.0', lastUpdated: new Date().toISOString(), models: [] }, null, 2), 'utf-8');
    }
  } catch (error) {
    logDebug('Failed to clear discovered models cache:', safeErrorMessage(error));
  }
}

// ============================================================================
// Provider Status Detection
// ============================================================================

/**
 * Provider configuration info
 */
export interface ProviderInfo {
  id: ProviderId;
  name: string;
  envVar: string;
  configured: boolean;
  latestModel: string;
  models?: string[];
}

/**
 * Supported providers with their environment variable requirements
 */
const PROVIDER_CONFIGS: Array<{
  id: ProviderId;
  name: string;
  envVar: string;
  altEnvVars?: string[];
  defaultLatestModel: string;
  fallbackModels?: string[];
}> = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    envVar: 'DEEPSEEK_API_KEY',
    defaultLatestModel: 'deepseek-reasoner',
    fallbackModels: ['deepseek-chat']
  },
];

/**
 * Model priority rankings for selecting the "best" model
 */
const MODEL_PRIORITIES: Record<string, Record<string, number>> = {
  deepseek: {
    'deepseek-reasoner': 100,
    'deepseek-chat': 90,
    'deepseek-coder': 85,
  },
};

/**
 * Get model priority for sorting
 */
function getModelPriority(provider: ProviderId, modelId: string): number {
  const priorities = MODEL_PRIORITIES[provider];
  if (!priorities) return 0;

  // Check for exact match first
  if (priorities[modelId] !== undefined) {
    return priorities[modelId];
  }

  // Check for prefix match
  for (const [prefix, priority] of Object.entries(priorities)) {
    if (modelId.startsWith(prefix)) {
      return priority;
    }
  }

  return 0;
}

/**
 * Sort models by priority (best first)
 */
export function sortModelsByPriority(provider: ProviderId, models: string[]): string[] {
  return [...models].sort((a, b) => {
    const priorityA = getModelPriority(provider, a);
    const priorityB = getModelPriority(provider, b);
    return priorityB - priorityA;
  });
}

/**
 * Get the best/latest model for a provider
 */
export function getBestModel(provider: ProviderId, models: string[]): string {
  if (models.length === 0) {
    const config = PROVIDER_CONFIGS.find(p => p.id === provider);
    return config?.defaultLatestModel || '';
  }

  const sorted = sortModelsByPriority(provider, models);
  return sorted[0] ?? models[0] ?? '';
}

/**
 * Check if a provider is configured (has API key or is accessible)
 */
export function isProviderConfigured(providerId: ProviderId): boolean {
  const config = PROVIDER_CONFIGS.find(p => p.id === providerId);
  if (!config) return false;

  // Ollama is special - it's available if the server is running (no API key needed)
  if (providerId === 'ollama') {
    // We'll check this via actual connection, return true for now
    // The actual check happens in getConfiguredProviders
    return true;
  }

  // Check main env var
  if (process.env[config.envVar]) {
    return true;
  }

  // Check alternative env vars
  if (config.altEnvVars) {
    for (const altVar of config.altEnvVars) {
      if (process.env[altVar]) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Get all providers with their configuration status
 */
export function getProvidersStatus(): ProviderInfo[] {
  return PROVIDER_CONFIGS.map(config => {
    let configured = false;

    if (config.id === 'ollama') {
      // For Ollama, we can't check synchronously if it's running
      // Mark as potentially available
      configured = !!process.env['OLLAMA_BASE_URL'] || true; // Always show Ollama as option
    } else {
      configured = !!process.env[config.envVar];
      if (!configured && config.altEnvVars) {
        configured = config.altEnvVars.some(v => !!process.env[v]);
      }
    }

    return {
      id: config.id,
      name: config.name,
      envVar: config.envVar,
      configured,
      latestModel: config.defaultLatestModel,
    };
  });
}

/**
 * Get list of configured providers (with valid API keys)
 */
export function getConfiguredProviders(): ProviderInfo[] {
  return getProvidersStatus().filter(p => p.configured);
}

/**
 * Get list of unconfigured providers
 */
export function getUnconfiguredProviders(): ProviderInfo[] {
  return getProvidersStatus().filter(p => !p.configured);
}

/**
 * Get the first available provider (for auto-selection)
 */
export function getFirstAvailableProvider(): ProviderInfo | null {
  const configured = getConfiguredProviders();

  // DeepSeek is the only supported provider
  const preferenceOrder = ['deepseek'];

  for (const providerId of preferenceOrder) {
    const provider = configured.find(p => p.id === providerId);
    if (provider) {
      return provider;
    }
  }

  return null;
}

/**
 * Get latest model for a provider from cache or defaults
 */
export function getLatestModelForProvider(providerId: ProviderId): string {
  // Check cache first
  const cached = getCachedDiscoveredModels();
  const providerModels = cached.filter(m => m.provider === providerId);

  if (providerModels.length > 0) {
    const modelIds = providerModels.map(m => m.id);
    return getBestModel(providerId, modelIds);
  }

  // Fall back to default
  const config = PROVIDER_CONFIGS.find(p => p.id === providerId);
  return config?.defaultLatestModel || '';
}

/**
 * Quick provider availability check result
 */
export interface QuickProviderStatus {
  provider: ProviderId;
  available: boolean;
  latestModel: string;
  error?: string;
}

/**
 * Quick API check for a single provider - returns best model or null
 */
async function quickFetchProviderModels(
  providerId: ProviderId,
  apiKey: string,
  timeoutMs: number = 24 * 60 * 60 * 1000
): Promise<string[]> {
  try {
    if (providerId === 'deepseek') {
      const response = await fetch('https://api.deepseek.com/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return [];
      const data = await response.json() as { data: Array<{ id: string }> };
      return data.data.map(m => m.id);
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Quickly check if providers are available by querying their APIs
 * Returns actual latest models from each provider
 */
export async function quickCheckProviders(): Promise<QuickProviderStatus[]> {
  const checks: Promise<QuickProviderStatus>[] = [];

  for (const config of PROVIDER_CONFIGS) {
    // Handle Ollama separately (no API key needed)
    if (config.id === 'ollama') {
      checks.push((async (): Promise<QuickProviderStatus> => {
        try {
          const baseURL = process.env['OLLAMA_BASE_URL'] || 'http://localhost:11434';
          const response = await fetch(`${baseURL}/api/tags`, {
            signal: AbortSignal.timeout(24 * 60 * 60 * 1000),
          });
          if (response.ok) {
            const data = await response.json() as { models?: Array<{ name: string }> };
            const models = data.models?.map(m => m.name) || [];
            return {
              provider: 'ollama',
              available: models.length > 0,
              latestModel: models[0] || config.defaultLatestModel,
            };
          }
        } catch { /* ignore */ }
        return {
          provider: 'ollama',
          available: false,
          latestModel: config.defaultLatestModel,
          error: 'Not running',
        };
      })());
      continue;
    }

    // Check for API key
    let apiKey = process.env[config.envVar];
    if (!apiKey && config.altEnvVars) {
      for (const altVar of config.altEnvVars) {
        if (process.env[altVar]) {
          apiKey = process.env[altVar];
          break;
        }
      }
    }

    if (!apiKey) {
      checks.push(Promise.resolve({
        provider: config.id,
        available: false,
        latestModel: config.defaultLatestModel,
        error: `${config.envVar} not set`,
      }));
      continue;
    }

    // Query the API for actual models
    checks.push((async (): Promise<QuickProviderStatus> => {
      const models = await quickFetchProviderModels(config.id, apiKey, 3000);
      if (models.length > 0) {
        const bestModel = getBestModel(config.id, models);
        return {
          provider: config.id,
          available: true,
          latestModel: bestModel,
        };
      }
      // API call failed or returned no models - still mark available if key exists
      return {
        provider: config.id,
        available: true,
        latestModel: config.defaultLatestModel,
        error: 'Could not fetch models',
      };
    })());
  }

  // Run all checks in parallel for speed
  return Promise.all(checks);
}
