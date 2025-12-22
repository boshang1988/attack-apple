/**
 * Revenue Suite Environment Validator
 * Validates required secrets based on chosen providers at startup
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ProviderConfig {
  docs?: 'DRIVE' | 'SHAREPOINT' | 'S3';
  helpdesk?: 'ZENDESK' | 'INTERCOM' | 'GORGIAS';
  crm?: 'SALESFORCE' | 'HUBSPOT';
  mockMode?: boolean;
}

function toBool(val: string | undefined): boolean {
  if (!val) return false;
  return ['1', 'true', 'yes', 'on'].includes(val.toLowerCase());
}

/**
 * Validates environment variables required for the revenue suite
 * based on chosen providers
 */
export function validateRevenueEnv(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Get provider choices from env
  const docsProvider = process.env.DOCS_PROVIDER?.toUpperCase();
  const helpdeskProvider = process.env.HELPDESK_PROVIDER?.toUpperCase();
  const crmProvider = process.env.CRM_PROVIDER?.toUpperCase();
  const mockMode = toBool(process.env.MOCK_CONNECTORS);

  // Core LLM providers (required unless mock)
  if (!mockMode) {
    const llmKeys = resolveKeys(['OPENAI_API_KEY', 'ANTHROPIC_API_KEY']);
    llmKeys.forEach((k) => {
      if (k.source === 'missing') {
        errors.push(`${k.name} is missing or not set (set USER_${k.name} for per-user keys, or ${k.name} for platform)`);
      }
    });
  } else {
    warnings.push('MOCK_CONNECTORS enabled: using mock LLM stubs unless keys are provided.');
  }

  // Search provider (required)
  if (!process.env.GOOGLE_SEARCH_KEY || process.env.GOOGLE_SEARCH_KEY === 'CHANGE_ME') {
    warnings.push('GOOGLE_SEARCH_KEY is missing or not set - search functionality will be limited');
  }

  // Validate docs provider
  if (!docsProvider || docsProvider === 'CHANGE_ME') {
    if (mockMode) {
      warnings.push('DOCS_PROVIDER not set; running mock docs connector.');
    } else {
      errors.push('DOCS_PROVIDER must be set to one of: DRIVE, SHAREPOINT, S3');
    }
  } else {
    switch (docsProvider) {
      case 'DRIVE':
        if (!process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON ||
            process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON === 'CHANGE_ME') {
          mockMode
            ? warnings.push('GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON missing; using mock docs connector.')
            : errors.push('GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON is required when DOCS_PROVIDER=DRIVE');
        }
        break;
      case 'SHAREPOINT':
        const sharepointVars = [
          'MS_TENANT_ID',
          'MS_CLIENT_ID',
          'MS_CLIENT_SECRET',
          'MS_SHAREPOINT_SITE'
        ];
        for (const varName of sharepointVars) {
          if (!process.env[varName] || process.env[varName] === 'CHANGE_ME') {
            mockMode
              ? warnings.push(`${varName} missing; using mock docs connector.`)
              : errors.push(`${varName} is required when DOCS_PROVIDER=SHAREPOINT`);
          }
        }
        break;
      case 'S3':
        const s3Vars = [
          'AWS_ACCESS_KEY_ID',
          'AWS_SECRET_ACCESS_KEY',
          'AWS_REGION',
          'DOCS_S3_BUCKET'
        ];
        for (const varName of s3Vars) {
          if (!process.env[varName] || process.env[varName] === 'CHANGE_ME') {
            mockMode
              ? warnings.push(`${varName} missing; using mock docs connector.`)
              : errors.push(`${varName} is required when DOCS_PROVIDER=S3`);
          }
        }
        break;
      default:
        errors.push(`Invalid DOCS_PROVIDER: ${docsProvider}. Must be one of: DRIVE, SHAREPOINT, S3`);
    }
  }

  // Validate helpdesk provider (required for revenue suite)
  if (!helpdeskProvider || helpdeskProvider === 'CHANGE_ME') {
    if (mockMode) {
      warnings.push('HELPDESK_PROVIDER not set; running mock helpdesk connector.');
    } else {
      errors.push('HELPDESK_PROVIDER must be set to one of: ZENDESK, INTERCOM, GORGIAS');
    }
  } else {
    switch (helpdeskProvider) {
      case 'ZENDESK':
        const zendeskVars = ['ZENDESK_SUBDOMAIN', 'ZENDESK_EMAIL', 'ZENDESK_API_TOKEN'];
        for (const varName of zendeskVars) {
          if (!process.env[varName] || process.env[varName] === 'CHANGE_ME') {
            mockMode
              ? warnings.push(`${varName} missing; using mock helpdesk connector.`)
              : errors.push(`${varName} is required when HELPDESK_PROVIDER=ZENDESK`);
          }
        }
        break;
      case 'INTERCOM':
        if (!process.env.INTERCOM_ACCESS_TOKEN ||
            process.env.INTERCOM_ACCESS_TOKEN === 'CHANGE_ME') {
          mockMode
            ? warnings.push('INTERCOM_ACCESS_TOKEN missing; using mock helpdesk connector.')
            : errors.push('INTERCOM_ACCESS_TOKEN is required when HELPDESK_PROVIDER=INTERCOM');
        }
        break;
      case 'GORGIAS':
        const gorgiasVars = ['GORGIAS_DOMAIN', 'GORGIAS_API_USERNAME', 'GORGIAS_API_PASSWORD'];
        for (const varName of gorgiasVars) {
          if (!process.env[varName] || process.env[varName] === 'CHANGE_ME') {
            mockMode
              ? warnings.push(`${varName} missing; using mock helpdesk connector.`)
              : errors.push(`${varName} is required when HELPDESK_PROVIDER=GORGIAS`);
          }
        }
        break;
      default:
        errors.push(`Invalid HELPDESK_PROVIDER: ${helpdeskProvider}. Must be one of: ZENDESK, INTERCOM, GORGIAS`);
    }
  }

  // Validate CRM provider (optional)
  if (crmProvider && crmProvider !== 'CHANGE_ME') {
    switch (crmProvider) {
      case 'SALESFORCE':
        const salesforceVars = [
          'SALESFORCE_CLIENT_ID',
          'SALESFORCE_CLIENT_SECRET',
          'SALESFORCE_USERNAME',
          'SALESFORCE_PASSWORD',
          'SALESFORCE_SECURITY_TOKEN'
        ];
        for (const varName of salesforceVars) {
          if (!process.env[varName] || process.env[varName] === 'CHANGE_ME') {
            mockMode
              ? warnings.push(`${varName} missing; using mock CRM connector.`)
              : errors.push(`${varName} is required when CRM_PROVIDER=SALESFORCE`);
          }
        }
        break;
      case 'HUBSPOT':
        if (!process.env.HUBSPOT_PRIVATE_APP_TOKEN ||
            process.env.HUBSPOT_PRIVATE_APP_TOKEN === 'CHANGE_ME') {
          mockMode
            ? warnings.push('HUBSPOT_PRIVATE_APP_TOKEN missing; using mock CRM connector.')
            : errors.push('HUBSPOT_PRIVATE_APP_TOKEN is required when CRM_PROVIDER=HUBSPOT');
        }
        break;
      default:
        warnings.push(`Unknown CRM_PROVIDER: ${crmProvider}. Will be ignored.`);
    }
  }

  // Validate Stripe (required for billing)
  const stripeKeys = resolveKeys(['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET']);
  stripeKeys.forEach((k) => {
    if (k.source === 'missing') {
      mockMode
        ? warnings.push(`${k.name} missing; Stripe connector will run in mock mode.`)
        : errors.push(`${k.name} is required for billing functionality`);
    }
  });

  // Validate Firebase (required for auth and user data)
  const firebaseVars = [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY'
  ];
  firebaseVars.forEach((varName) => {
    const resolved = resolveKeys([varName])[0];
    if (resolved.source === 'missing') {
      mockMode
        ? warnings.push(`${varName} missing; auth/user data features may be disabled.`)
        : errors.push(`${varName} is required for authentication and user data`);
    }
  });

  // Observability endpoint (optional but recommended)
  if (!process.env.OBSERVABILITY_ENDPOINT ||
      process.env.OBSERVABILITY_ENDPOINT === 'CHANGE_ME') {
    warnings.push('OBSERVABILITY_ENDPOINT not set - audit logging will be limited');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validates and throws if required secrets are missing
 * Call this at application startup for the revenue suite
 */
export function enforceRevenueEnv(): void {
  const result = validateRevenueEnv();

  if (result.warnings.length > 0) {
    console.warn('\n⚠️  Revenue Suite Warnings:');
    result.warnings.forEach(warning => console.warn(`  - ${warning}`));
  }

  if (!result.valid) {
    console.error('\n❌ Revenue Suite validation failed:');
    result.errors.forEach(error => console.error(`  - ${error}`));
    const missingMsg = buildMissingKeyMessage([
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'GOOGLE_SEARCH_KEY',
      'STRIPE_SECRET_KEY',
      'STRIPE_PUBLISHABLE_KEY',
      'STRIPE_WEBHOOK_SECRET',
    ]);
    if (missingMsg) {
      console.error(`\n${missingMsg}`);
    }
    console.error('\nPlease fill in the required secrets in .env.revenue.local (or USER_* overrides for per-user keys).');
    console.error('See docs/SECRET_ACQUISITION_GUIDE.md for instructions.\n');
    throw new Error('Revenue Suite environment validation failed - missing required secrets');
  }

  console.log('✓ Revenue Suite environment validated successfully\n');
}

/**
 * Gets the configured provider settings
 */
export function getProviderConfig(): ProviderConfig {
  return {
    docs: process.env.DOCS_PROVIDER?.toUpperCase() as ProviderConfig['docs'],
    helpdesk: process.env.HELPDESK_PROVIDER?.toUpperCase() as ProviderConfig['helpdesk'],
    crm: process.env.CRM_PROVIDER?.toUpperCase() as ProviderConfig['crm'],
    mockMode: toBool(process.env.MOCK_CONNECTORS),
  };
}
import { resolveKeys, buildMissingKeyMessage } from './providerKeys.js';
