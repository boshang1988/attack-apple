import type { ProviderId } from '../src/core/types.js';
import * as modelDiscovery from '../src/core/modelDiscovery.js';

const { inferProviderFromModelId, getLatestModelForProvider } = modelDiscovery;

describe('modelDiscovery provider inference', () => {
  it('infers providers from common model IDs', () => {
    expect(inferProviderFromModelId('gpt-4o')).toBe('openai');
    expect(inferProviderFromModelId('claude-3-5-sonnet-20241022')).toBe('anthropic');
    expect(inferProviderFromModelId('gemini-2.5-pro')).toBe('google');
    expect(inferProviderFromModelId('deepseek-reasoner')).toBe('deepseek');
    expect(inferProviderFromModelId('grok-4-1-fast-reasoning')).toBe('xai');
    expect(inferProviderFromModelId('llama3.2:3b')).toBe('ollama');
  });

  it('falls back to safe defaults when no discovered models exist', () => {
    const spy = jest.spyOn(modelDiscovery, 'getCachedDiscoveredModels').mockReturnValue([]);

    expect(getLatestModelForProvider('openai' as ProviderId)).toBe('gpt-5.2-codex');
    expect(getLatestModelForProvider('anthropic' as ProviderId)).toBe('claude-sonnet-4-5-20250514');
    expect(getLatestModelForProvider('google' as ProviderId)).toBe('gemini-3.0-pro');
    expect(getLatestModelForProvider('ollama' as ProviderId)).toBe('llama3.3:70b');

    spy.mockRestore();
  });
});
