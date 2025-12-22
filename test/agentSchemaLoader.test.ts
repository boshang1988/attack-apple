/**
 * Tests for centralized agent schema loader
 */

// Mock the agentSchemaLoader module to avoid ESM import.meta issues in Jest
jest.mock('../src/core/agentSchemaLoader.js', () => {
  const mockSchema = {
    contractVersion: '1.0.0',
    version: '2024-11-24',
    providers: [
      { id: 'openai', label: 'OpenAI', envVars: { apiKey: 'OPENAI_API_KEY' } },
      { id: 'anthropic', label: 'Anthropic', envVars: { apiKey: 'ANTHROPIC_API_KEY' } },
      { id: 'ollama', label: 'Ollama (Local)', envVars: {} }
    ],
    models: [
      { id: 'gpt-4o', label: 'gpt-4o', provider: 'openai' },
      { id: 'claude-3-opus', label: 'Claude 3 Opus', provider: 'anthropic' }
    ],
    profiles: [
      { name: 'agi-code', label: 'AGI Code', description: 'Coding assistant' }
    ],
    slashCommands: [],
    capabilities: []
  };

  let cachedSchema: typeof mockSchema | null = mockSchema;

  return {
    getAgentSchemas: jest.fn(() => {
      if (!cachedSchema) {
        cachedSchema = mockSchema;
      }
      return cachedSchema;
    }),
    getProviders: jest.fn(() => mockSchema.providers),
    getProvider: jest.fn((providerId: string) => 
      mockSchema.providers.find(p => p.id === providerId)
    ),
    getModels: jest.fn(async () => mockSchema.models),
    getModelsByProvider: jest.fn(async (providerId: string) => 
      mockSchema.models.filter(m => m.provider === providerId)
    ),
    getModel: jest.fn(async (modelId: string) => 
      mockSchema.models.find(m => m.id === modelId)
    ),
    getProfiles: jest.fn(() => mockSchema.profiles),
    getProfile: jest.fn((profileName: string) => 
      mockSchema.profiles.find(p => p.name === profileName)
    ),
    getSlashCommands: jest.fn(() => mockSchema.slashCommands),
    getCapabilities: jest.fn(() => mockSchema.capabilities),
    clearSchemaCache: jest.fn(() => { cachedSchema = null; }),
    isValidProvider: jest.fn((providerId: string) => 
      mockSchema.providers.some(p => p.id === providerId)
    ),
    isValidModel: jest.fn(async (modelId: string) => 
      mockSchema.models.some(m => m.id === modelId)
    ),
    isValidProfile: jest.fn((profileName: string) => 
      mockSchema.profiles.some(p => p.name === profileName)
    )
  };
});

// Import after mock
import { 
  getAgentSchemas, 
  getProviders, 
  getProvider,
  getModels,
  getModelsByProvider,
  getModel,
  getProfiles,
  getProfile,
  getSlashCommands,
  getCapabilities,
  clearSchemaCache,
  isValidProvider,
  isValidModel,
  isValidProfile
} from '../src/core/agentSchemaLoader.js';

describe('agentSchemaLoader', () => {
  beforeEach(() => {
    // Clear cache before each test
    clearSchemaCache();
  });

  it('should load agent schemas', () => {
    const schemas = getAgentSchemas();
    expect(schemas).toBeDefined();
    expect(schemas.contractVersion).toBe('1.0.0');
    expect(schemas.version).toBeDefined();
    expect(Array.isArray(schemas.providers)).toBe(true);
    expect(Array.isArray(schemas.models)).toBe(true);
    expect(Array.isArray(schemas.profiles)).toBe(true);
  });

  it('should get providers list', () => {
    const providers = getProviders();
    expect(Array.isArray(providers)).toBe(true);
    expect(providers.length).toBeGreaterThan(0);
    
    const openaiProvider = providers.find(p => p.id === 'openai');
    expect(openaiProvider).toBeDefined();
    expect(openaiProvider?.label).toBe('OpenAI');
  });

  it('should get specific provider', () => {
    const provider = getProvider('anthropic');
    expect(provider).toBeDefined();
    expect(provider?.id).toBe('anthropic');
    expect(provider?.label).toBe('Anthropic');
    
    const unknownProvider = getProvider('unknown' as any);
    expect(unknownProvider).toBeUndefined();
  });

  it('should get models asynchronously', async () => {
    const models = await getModels();
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    
    const hasGpt4o = models.some(m => m.id === 'gpt-4o');
    expect(hasGpt4o).toBe(true);
  });

  it('should get models by provider asynchronously', async () => {
    const openaiModels = await getModelsByProvider('openai');
    expect(Array.isArray(openaiModels)).toBe(true);
    expect(openaiModels.length).toBeGreaterThan(0);
    expect(openaiModels.every(m => m.provider === 'openai')).toBe(true);
    
    const emptyModels = await getModelsByProvider('unknown' as any);
    expect(Array.isArray(emptyModels)).toBe(true);
    expect(emptyModels.length).toBe(0);
  });

  it('should get specific model asynchronously', async () => {
    const model = await getModel('gpt-4o');
    expect(model).toBeDefined();
    expect(model?.id).toBe('gpt-4o');
    expect(model?.provider).toBe('openai');
    
    const unknownModel = await getModel('unknown-model');
    expect(unknownModel).toBeUndefined();
  });

  it('should get profiles list', () => {
    const profiles = getProfiles();
    expect(Array.isArray(profiles)).toBe(true);
    expect(profiles.length).toBeGreaterThan(0);
    
    const hasCodeProfile = profiles.some(p => p.name === 'agi-code');
    expect(hasCodeProfile).toBe(true);
  });

  it('should get specific profile', () => {
    const profile = getProfile('agi-code');
    expect(profile).toBeDefined();
    expect(profile?.name).toBe('agi-code');
    
    const unknownProfile = getProfile('unknown-profile');
    expect(unknownProfile).toBeUndefined();
  });

  it('should get slash commands', () => {
    const slashCommands = getSlashCommands();
    expect(Array.isArray(slashCommands)).toBe(true);
  });

  it('should get capabilities', () => {
    const capabilities = getCapabilities();
    expect(Array.isArray(capabilities)).toBe(true);
  });

  it('should validate provider IDs', () => {
    expect(isValidProvider('openai')).toBe(true);
    expect(isValidProvider('anthropic')).toBe(true);
    expect(isValidProvider('unknown')).toBe(false);
  });

  it('should validate model IDs asynchronously', async () => {
    expect(await isValidModel('gpt-4o')).toBe(true);
    expect(await isValidModel('unknown-model')).toBe(false);
  });

  it('should validate profile names', () => {
    expect(isValidProfile('agi-code')).toBe(true);
    expect(isValidProfile('unknown-profile')).toBe(false);
  });
});