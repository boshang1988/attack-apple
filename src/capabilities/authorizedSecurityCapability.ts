/**
 * Authorized Security Capability Module
 *
 * Modular security testing tools that require explicit authorization context.
 * Supports: CTF challenges, pentesting engagements, security research, defensive testing.
 *
 * Authorization is enforced via:
 * 1. Explicit context declaration (ctf, pentest, research, defensive)
 * 2. Target scope validation (localhost, *.ctf.*, authorized domains)
 * 3. Operation logging for accountability
 */

import type { CapabilityContribution, CapabilityContext, CapabilityModule } from '../runtime/agentHost.js';

// Authorized CTF/training platforms - safe by design
const AUTHORIZED_CTF_DOMAINS = [
  /\.hackthebox\.(com|eu)$/,
  /\.tryhackme\.com$/,
  /\.ctf\./,
  /\.ctftime\.org$/,
  /\.vulnhub\.com$/,
  /\.pentesterlab\.com$/,
  /\.offensive-security\.com$/,
  /\.htb$/,
  /localhost$/,
  /^127\./,
  /^10\./,          // Private network - controlled environment
  /^192\.168\./,    // Private network - controlled environment
];

// Prohibited targets - never allow regardless of authorization
const PROHIBITED_TARGETS = [
  /\.gov$/,         // Government
  /\.mil$/,         // Military
  /\.edu$/,         // Education
  /\.bank$/,        // Banking
  /critical.*infrastructure/i,
];

type AuthorizationContext = 'ctf' | 'pentest' | 'research' | 'defensive' | 'educational';

interface AuthorizationState {
  context: AuthorizationContext | null;
  authorizedDomains: string[];
  sessionId: string;
  startTime: number;
  operationLog: Array<{ timestamp: number; operation: string; target: string; result: string }>;
}

export class AuthorizedSecurityCapabilityModule implements CapabilityModule {
  readonly id = 'capability.authorized-security';

  async create(_context: CapabilityContext): Promise<CapabilityContribution> {
    // Session-scoped authorization state
    const authState: AuthorizationState = {
      context: null,
      authorizedDomains: [],
      sessionId: `sec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      startTime: Date.now(),
      operationLog: [],
    };

    const isTargetAuthorized = (target: string): { authorized: boolean; reason: string } => {
      // Check prohibited first
      for (const pattern of PROHIBITED_TARGETS) {
        if (pattern.test(target)) {
          return { authorized: false, reason: `Target matches prohibited pattern: ${pattern}` };
        }
      }

      // Check CTF platforms (always allowed for ctf/educational context)
      if (authState.context === 'ctf' || authState.context === 'educational') {
        for (const pattern of AUTHORIZED_CTF_DOMAINS) {
          if (pattern.test(target)) {
            return { authorized: true, reason: 'CTF/training platform' };
          }
        }
      }

      // Check explicitly authorized domains
      if (authState.authorizedDomains.some(d => target.includes(d) || target === d)) {
        return { authorized: true, reason: 'Explicitly authorized domain' };
      }

      // Localhost always allowed for any context
      if (/^(localhost|127\.|10\.|192\.168\.)/.test(target)) {
        return { authorized: true, reason: 'Local/private network' };
      }

      return { authorized: false, reason: 'Target not in authorized scope' };
    };

    const logOperation = (operation: string, target: string, result: string) => {
      authState.operationLog.push({
        timestamp: Date.now(),
        operation,
        target,
        result,
      });
    };

    return {
      id: 'authorized-security.tools',
      description: 'Security testing tools with authorization enforcement',
      toolSuite: {
        id: 'authorized-security',
        description: 'CTF, pentest, research, and defensive security tools',
        tools: [
          {
            name: 'SecurityAuth',
            description: `Set authorization context for security operations.
Required before using security tools.

Contexts:
- ctf: CTF challenges, HackTheBox, TryHackMe, etc.
- pentest: Authorized penetration testing engagement
- research: Security research with controlled targets
- defensive: Blue team / defensive security testing
- educational: Learning/training purposes

Example: SecurityAuth({ context: "ctf", authorizedDomains: ["target.htb"] })`,
            parameters: {
              type: 'object',
              properties: {
                context: {
                  type: 'string',
                  enum: ['ctf', 'pentest', 'research', 'defensive', 'educational'],
                  description: 'Authorization context type',
                },
                authorizedDomains: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Additional domains explicitly authorized for this session',
                },
                engagement: {
                  type: 'string',
                  description: 'Optional engagement ID or reference for pentest context',
                },
              },
              required: ['context'],
            },
            handler: async (args: Record<string, unknown>) => {
              const context = args['context'] as AuthorizationContext;
              const domains = (args['authorizedDomains'] as string[]) || [];
              const engagement = args['engagement'] as string | undefined;

              authState.context = context;
              authState.authorizedDomains = domains;

              logOperation('authorize', 'session', `context=${context}`);

              return JSON.stringify({
                status: 'authorized',
                sessionId: authState.sessionId,
                context,
                authorizedDomains: domains,
                engagement,
                ctfPlatformsEnabled: context === 'ctf' || context === 'educational',
                message: `Security operations authorized for ${context} context`,
                guidelines: {
                  ctf: 'Only target CTF platforms and authorized challenge hosts',
                  pentest: 'Only target explicitly authorized systems in scope',
                  research: 'Use controlled environments, document findings responsibly',
                  defensive: 'Blue team operations on owned/authorized infrastructure',
                  educational: 'Learning purposes on training platforms only',
                },
              }, null, 2);
            },
          },
          {
            name: 'SecurityRecon',
            description: 'Reconnaissance and information gathering on authorized targets. Requires SecurityAuth first.',
            parameters: {
              type: 'object',
              properties: {
                target: {
                  type: 'string',
                  description: 'Target hostname or IP (must be authorized)',
                },
                type: {
                  type: 'string',
                  enum: ['dns', 'ports', 'services', 'headers', 'ssl'],
                  description: 'Type of reconnaissance',
                },
                passive: {
                  type: 'boolean',
                  description: 'Passive-only recon (no active probing)',
                },
              },
              required: ['target', 'type'],
            },
            handler: async (args: Record<string, unknown>) => {
              if (!authState.context) {
                return JSON.stringify({
                  error: 'Authorization required',
                  message: 'Call SecurityAuth first to set context',
                }, null, 2);
              }

              const target = args['target'] as string;
              const type = args['type'] as string;
              const passive = args['passive'] as boolean ?? true;

              const authCheck = isTargetAuthorized(target);
              if (!authCheck.authorized) {
                logOperation('recon-blocked', target, authCheck.reason);
                return JSON.stringify({
                  error: 'Target not authorized',
                  target,
                  reason: authCheck.reason,
                  context: authState.context,
                  hint: 'Add target to authorizedDomains or use a CTF platform',
                }, null, 2);
              }

              logOperation(`recon-${type}`, target, 'executed');

              // Simulated recon results (actual implementation would use real tools)
              const results: Record<string, unknown> = {
                sessionId: authState.sessionId,
                context: authState.context,
                target,
                type,
                passive,
                timestamp: new Date().toISOString(),
              };

              switch (type) {
                case 'dns':
                  results.data = {
                    records: ['A', 'AAAA', 'MX', 'TXT', 'NS'],
                    note: 'DNS enumeration results would appear here',
                  };
                  break;
                case 'ports':
                  results.data = {
                    commonPorts: [22, 80, 443, 8080],
                    note: 'Port scan results would appear here (use nmap for real scans)',
                  };
                  break;
                case 'services':
                  results.data = {
                    detected: ['ssh', 'http', 'https'],
                    note: 'Service detection results would appear here',
                  };
                  break;
                case 'headers':
                  results.data = {
                    securityHeaders: ['X-Frame-Options', 'CSP', 'HSTS'],
                    note: 'HTTP header analysis would appear here',
                  };
                  break;
                case 'ssl':
                  results.data = {
                    protocols: ['TLS 1.2', 'TLS 1.3'],
                    note: 'SSL/TLS analysis would appear here',
                  };
                  break;
              }

              return JSON.stringify(results, null, 2);
            },
          },
          {
            name: 'SecurityVulnCheck',
            description: 'Check for common vulnerabilities on authorized targets. Requires SecurityAuth first.',
            parameters: {
              type: 'object',
              properties: {
                target: {
                  type: 'string',
                  description: 'Target to check (must be authorized)',
                },
                category: {
                  type: 'string',
                  enum: ['web', 'network', 'config', 'crypto', 'injection'],
                  description: 'Vulnerability category to check',
                },
                safe: {
                  type: 'boolean',
                  description: 'Safe mode - detection only, no exploitation',
                },
              },
              required: ['target', 'category'],
            },
            handler: async (args: Record<string, unknown>) => {
              if (!authState.context) {
                return JSON.stringify({
                  error: 'Authorization required',
                  message: 'Call SecurityAuth first',
                }, null, 2);
              }

              const target = args['target'] as string;
              const category = args['category'] as string;
              const safe = args['safe'] as boolean ?? true;

              const authCheck = isTargetAuthorized(target);
              if (!authCheck.authorized) {
                logOperation('vulncheck-blocked', target, authCheck.reason);
                return JSON.stringify({
                  error: 'Target not authorized',
                  target,
                  reason: authCheck.reason,
                }, null, 2);
              }

              logOperation(`vulncheck-${category}`, target, `safe=${safe}`);

              return JSON.stringify({
                sessionId: authState.sessionId,
                context: authState.context,
                target,
                category,
                safeMode: safe,
                checks: {
                  web: ['XSS', 'CSRF', 'SSRF', 'Path traversal'],
                  network: ['Open ports', 'Service versions', 'Default creds'],
                  config: ['Misconfigurations', 'Debug endpoints', 'Info disclosure'],
                  crypto: ['Weak ciphers', 'Certificate issues', 'Key exposure'],
                  injection: ['SQLi', 'Command injection', 'LDAP injection'],
                }[category] || [],
                note: `Vulnerability checks for ${category} - implement with actual security tools`,
                timestamp: new Date().toISOString(),
              }, null, 2);
            },
          },
          {
            name: 'SecurityReport',
            description: 'Generate security assessment report for the session.',
            parameters: {
              type: 'object',
              properties: {
                format: {
                  type: 'string',
                  enum: ['summary', 'detailed', 'json'],
                  description: 'Report format',
                },
              },
            },
            handler: async (args: Record<string, unknown>) => {
              const format = (args['format'] as string) || 'summary';

              const report = {
                sessionId: authState.sessionId,
                context: authState.context || 'none',
                duration: Date.now() - authState.startTime,
                operationCount: authState.operationLog.length,
                operations: format === 'detailed' ? authState.operationLog : undefined,
                authorizedDomains: authState.authorizedDomains,
                generated: new Date().toISOString(),
              };

              if (format === 'summary') {
                return `Security Session Report
========================
Session: ${report.sessionId}
Context: ${report.context}
Duration: ${Math.round(report.duration / 1000)}s
Operations: ${report.operationCount}
Generated: ${report.generated}`;
              }

              return JSON.stringify(report, null, 2);
            },
          },
        ],
      },
    };
  }
}
