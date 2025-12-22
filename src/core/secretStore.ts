import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { ProviderId } from './types.js';

export type SecretName =
  | 'DEEPSEEK_API_KEY'
  | 'TAVILY_API_KEY'
  | 'SMTP_USER'
  | 'SMTP_PASSWORD'
  | 'SMTP_PROVIDER'
  | 'SMTP_FROM_NAME'
  | 'SMTP_HOST'
  | 'SMTP_PORT';

export interface SecretDefinition {
  id: SecretName;
  label: string;
  description: string;
  envVar: SecretName;
  providers: ProviderId[];
}

interface SecretStoreData {
  [key: string]: string | undefined;
}

const SECRET_DEFINITIONS: SecretDefinition[] = [
  {
    id: 'DEEPSEEK_API_KEY',
    label: 'DeepSeek API Key',
    description: 'Required to run DeepSeek Reasoner or Chat models.',
    envVar: 'DEEPSEEK_API_KEY',
    providers: ['deepseek'],
  },
  {
    id: 'TAVILY_API_KEY',
    label: 'Tavily API Key',
    description: 'Required: WebSearch and WebExtract provider. Get yours at https://tavily.com',
    envVar: 'TAVILY_API_KEY',
    providers: [],
  },
  {
    id: 'SMTP_USER',
    label: 'Email Address',
    description: 'Your email address for sending emails (e.g., you@gmail.com).',
    envVar: 'SMTP_USER',
    providers: [],
  },
  {
    id: 'SMTP_PASSWORD',
    label: 'Email App Password',
    description: 'App password for your email (NOT your regular password). For Gmail: https://myaccount.google.com/apppasswords',
    envVar: 'SMTP_PASSWORD',
    providers: [],
  },
  {
    id: 'SMTP_PROVIDER',
    label: 'Email Provider',
    description: 'Email provider: gmail, outlook, yahoo, icloud, zoho (default: gmail).',
    envVar: 'SMTP_PROVIDER',
    providers: [],
  },
  {
    id: 'SMTP_FROM_NAME',
    label: 'Email Display Name',
    description: 'Optional: Display name shown in sent emails (e.g., "John Doe").',
    envVar: 'SMTP_FROM_NAME',
    providers: [],
  },
  {
    id: 'SMTP_HOST',
    label: 'Custom SMTP Host',
    description: 'Optional: Custom SMTP server hostname (only for non-standard providers).',
    envVar: 'SMTP_HOST',
    providers: [],
  },
  {
    id: 'SMTP_PORT',
    label: 'Custom SMTP Port',
    description: 'Optional: Custom SMTP port (only for non-standard providers, default: 587).',
    envVar: 'SMTP_PORT',
    providers: [],
  },
];

const envAgiHome = process.env['AGI_HOME'];
const SECRET_DIR = envAgiHome ? resolve(envAgiHome) : join(homedir(), '.agi');
const SECRET_FILE = join(SECRET_DIR, 'secrets.json');

export class MissingSecretError extends Error {
  constructor(public readonly secret: SecretDefinition) {
    super(`${secret.label} is not configured.`);
    this.name = 'MissingSecretError';
  }
}

export function listSecretDefinitions(): SecretDefinition[] {
  return [...SECRET_DEFINITIONS];
}

export function getSecretDefinition(id: SecretName): SecretDefinition | null {
  return SECRET_DEFINITIONS.find((entry) => entry.id === id) ?? null;
}

export function getSecretValue(id: SecretName): string | null {
  const envValue = sanitize(process.env[id]);
  if (envValue) {
    return envValue;
  }

  const store = readSecretStore();
  const storedValue = sanitize(store[id]);
  if (!storedValue) {
    return null;
  }

  process.env[id] = storedValue;
  return storedValue;
}

/**
 * Load all stored secrets into process.env at startup.
 * This ensures secrets are available before any provider checks.
 *
 * IMPORTANT: Stored secrets always take precedence over environment variables
 * for provider API keys. This ensures keys set via /secrets are used even if
 * the user has old/stale keys exported in their shell environment.
 */
export function loadAllSecrets(): void {
  const store = readSecretStore();
  for (const definition of SECRET_DEFINITIONS) {
    const storedValue = sanitize(store[definition.id]);
    if (storedValue) {
      // Always use stored value for API keys to ensure /secrets takes precedence
      // over potentially stale environment variables
      process.env[definition.id] = storedValue;
    }
  }
}

export function setSecretValue(id: SecretName, rawValue: string): void {
  const value = sanitize(rawValue);
  if (!value) {
    throw new Error('Secret value cannot be blank.');
  }

  const store = readSecretStore();
  store[id] = value;
  writeSecretStore(store);
  process.env[id] = value;
}

export function maskSecret(value: string): string {
  if (!value) {
    return '';
  }
  if (value.length <= 4) {
    return '*'.repeat(value.length);
  }
  const suffix = value.slice(-4);
  const prefix = '*'.repeat(Math.max(0, value.length - 4));
  return `${prefix}${suffix}`;
}

export function ensureSecretForProvider(provider: ProviderId): string {
  const definition = findDefinitionForProvider(provider);
  const value = getSecretValue(definition.id);
  if (!value) {
    throw new MissingSecretError(definition);
  }
  process.env[definition.envVar] = value;
  return value;
}

export function getSecretDefinitionForProvider(provider: ProviderId): SecretDefinition | null {
  return SECRET_DEFINITIONS.find((entry) => entry.providers.includes(provider)) ?? null;
}

function readSecretStore(): SecretStoreData {
  if (!existsSync(SECRET_FILE)) {
    return {};
  }

  try {
    const content = readFileSync(SECRET_FILE, 'utf8');
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object') {
      return parsed as SecretStoreData;
    }
  } catch {
    return {};
  }
  return {};
}

function writeSecretStore(store: SecretStoreData): void {
  const directory = dirname(SECRET_FILE);
  mkdirSync(directory, { recursive: true });
  const payload = JSON.stringify(store, null, 2);
  writeFileSync(SECRET_FILE, `${payload}
`);
}

function findDefinitionForProvider(provider: ProviderId): SecretDefinition {
  const definition = getSecretDefinitionForProvider(provider);
  if (!definition) {
    throw new Error(`No secret configuration for provider "${provider}".`);
  }
  return definition;
}

function sanitize(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

// ============================================================================
// Secret Sanitization for Error Messages
// ============================================================================

/**
 * Known API key patterns to detect and sanitize in error messages.
 * These patterns match common API key formats from various providers.
 */
const API_KEY_PATTERNS: RegExp[] = [
  // Anthropic API keys: sk-ant-api03-...
  /sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}/g,
  // OpenAI API keys: sk-proj-... or sk-...
  /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
  // Generic Bearer tokens in headers
  /Bearer\s+[A-Za-z0-9_.-]{20,}/gi,
  // x-api-key header values
  /x-api-key['":\s]+[A-Za-z0-9_.-]{20,}/gi,
  // API keys in URLs (key=value pattern)
  /[?&](?:key|api_key|apiKey|api-key|token|access_token)=([A-Za-z0-9_.-]{16,})/gi,
  // DeepSeek keys
  /sk-[a-f0-9]{32,}/gi,
  // xAI/Grok keys
  /xai-[A-Za-z0-9_-]{20,}/gi,
  // Google/Gemini API keys (AIza...)
  /AIza[A-Za-z0-9_-]{30,}/g,
  // Generic long alphanumeric tokens that look like API keys
  /(?:api[_-]?key|token|secret|password|credential)['"]?\s*[:=]\s*['"]?([A-Za-z0-9_.-]{20,})['"]?/gi,
];

/**
 * Sanitize error messages to remove potential API keys and secrets.
 * This prevents accidental token leakage in logs, error reports, and console output.
 *
 * @param message - The error message or string to sanitize
 * @returns The sanitized string with secrets replaced by [REDACTED]
 */
export function sanitizeErrorMessage(message: string): string {
  if (!message || typeof message !== 'string') {
    return message;
  }

  let sanitized = message;

  // Apply all API key patterns
  for (const pattern of API_KEY_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    sanitized = sanitized.replace(pattern, (match) => {
      // For patterns with capture groups, try to preserve context
      if (match.includes('=') || match.includes(':')) {
        const separator = match.includes('=') ? '=' : ':';
        const parts = match.split(separator);
        if (parts.length === 2) {
          return `${parts[0]}${separator}[REDACTED]`;
        }
      }
      return '[REDACTED]';
    });
  }

  // Additionally sanitize any env var values that are currently loaded
  sanitized = sanitizeAgainstLoadedSecrets(sanitized);

  return sanitized;
}

/**
 * Sanitize a string against currently loaded secret values.
 * This catches any secrets that might not match the pattern-based detection.
 */
function sanitizeAgainstLoadedSecrets(message: string): string {
  const secretNames: SecretName[] = [
    'DEEPSEEK_API_KEY',
    'TAVILY_API_KEY',
    'SMTP_PASSWORD',
  ];

  let sanitized = message;

  for (const name of secretNames) {
    const value = process.env[name];
    if (value && value.length >= 4) {
      // Only sanitize if the value appears in the message
      // Use a case-sensitive exact match to avoid false positives
      if (sanitized.includes(value)) {
        sanitized = sanitized.split(value).join('[REDACTED]');
      }

      // Also sanitize partial matches (first 8 chars + last 4 chars pattern)
      if (value.length >= 12) {
        const partialPattern = `${value.substring(0, 8)}...${value.substring(value.length - 4)}`;
        if (sanitized.includes(partialPattern)) {
          sanitized = sanitized.split(partialPattern).join('[REDACTED_PARTIAL]');
        }
      }
    }
  }

  return sanitized;
}

/**
 * Sanitize an Error object's message and stack trace.
 * Returns a new error message string with secrets removed.
 */
export function sanitizeError(error: Error): string {
  const message = sanitizeErrorMessage(error.message);
  const stack = error.stack ? sanitizeErrorMessage(error.stack) : '';

  if (stack && stack !== message) {
    return `${message}\n${stack}`;
  }
  return message;
}

/**
 * Create a safe error message from an unknown error value.
 * Ensures no secrets are leaked regardless of error type.
 */
export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeErrorMessage(error.message);
  }
  if (typeof error === 'string') {
    return sanitizeErrorMessage(error);
  }
  return 'Unknown error occurred';
}
