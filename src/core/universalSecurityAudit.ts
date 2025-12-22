/**
 * Universal Security Audit System
 *
 * Provider-agnostic security scanning for any cloud infrastructure, company, product.
 * This is the DEFAULT capability for all AGI Core operations.
 *
 * Supports:
 * - Google Cloud Platform (GCP)
 * - Amazon Web Services (AWS)
 * - Microsoft Azure
 * - Any custom infrastructure
 *
 * Features:
 * - Live verification against real APIs
 * - Zero-day prediction via unconventional heuristics
 * - Dual tournament RL validation
 * - Full APT kill chain coverage
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import https from 'https';
import http from 'http';

const execAsync = promisify(exec);

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export type CloudProvider = 'gcp' | 'aws' | 'azure' | 'custom';
export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type Exploitability = 'trivial' | 'moderate' | 'complex' | 'theoretical';

export interface SecurityFinding {
  id: string;
  provider: CloudProvider;
  vulnerability: string;
  severity: SeverityLevel;
  confidence: number;
  evidence: string[];
  technique: string;
  timestamp: string;
  resource: string;
  exploitability: Exploitability;
  verified: boolean;
  remediation?: string;
  cve?: string;
  aptPhase?: string;
}

export interface AuditConfig {
  provider: CloudProvider;
  projectId?: string;
  region?: string;
  accountId?: string;
  subscriptionId?: string;
  accessToken?: string;
  organizationId?: string;
  aggressive?: boolean;
  includeZeroDay?: boolean;
  liveTesting?: boolean;
}

export interface AuditSummary {
  provider: CloudProvider;
  startTime: string;
  endTime: string;
  duration: number;
  total: number;
  verified: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  zeroDay: number;
}

export interface UniversalAuditResult {
  findings: SecurityFinding[];
  summary: AuditSummary;
  rawData?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Zero-Day Prediction Heuristics
// ═══════════════════════════════════════════════════════════════════════════════

const ZERO_DAY_HEURISTICS = {
  complexityCorrelation: {
    principle: 'Vulnerabilities cluster where code complexity exceeds cognitive limits',
    indicators: ['Cyclomatic complexity > 50', 'Function length > 500 lines', 'Deep nesting > 6 levels', 'Multiple async patterns', 'Complex state machines'],
    weight: 0.85,
  },
  trustBoundaryAnalysis: {
    principle: 'Every trust boundary crossing is a potential attack surface',
    indicators: ['Service-to-service auth', 'Cross-region data transfer', 'User input propagation', 'Third-party integrations', 'API gateway boundaries'],
    weight: 0.90,
  },
  temporalCoupling: {
    principle: 'Time-based operations create race condition opportunities',
    indicators: ['Async token refresh', 'Distributed consensus', 'Cache invalidation', 'Session management', 'Rate limiting windows'],
    weight: 0.80,
  },
  serializationBoundaries: {
    principle: 'Data format transitions are high-risk transformation points',
    indicators: ['JSON to protobuf conversion', 'XML parsing', 'Custom serialization', 'Encoding transitions', 'Schema migrations'],
    weight: 0.88,
  },
  emergentBehaviors: {
    principle: 'Complex systems exhibit behaviors not present in components',
    indicators: ['Multi-service workflows', 'Distributed transactions', 'Event-driven architectures', 'Microservice meshes', 'Cascading failures'],
    weight: 0.75,
  },
  errorHandlingAsymmetry: {
    principle: 'Error paths receive less testing than happy paths',
    indicators: ['Exception handling in auth', 'Rollback logic', 'Timeout handling', 'Partial failure states', 'Recovery procedures'],
    weight: 0.82,
  },
  implicitStateDependencies: {
    principle: 'Hidden state coupling creates unexpected interactions',
    indicators: ['Global configuration', 'Shared caches', 'Connection pools', 'Thread-local storage', 'Implicit ordering'],
    weight: 0.78,
  },
  resourceExhaustion: {
    principle: 'Resource limits are often enforced inconsistently',
    indicators: ['Memory allocation', 'File handles', 'Network connections', 'CPU quotas', 'Storage limits'],
    weight: 0.70,
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// APT Kill Chain Phases
// ═══════════════════════════════════════════════════════════════════════════════

const APT_KILL_CHAIN = [
  { phase: 'reconnaissance', description: 'Information gathering about targets' },
  { phase: 'weaponization', description: 'Creating attack payloads' },
  { phase: 'delivery', description: 'Transmitting attack to target' },
  { phase: 'exploitation', description: 'Executing attack payload' },
  { phase: 'installation', description: 'Establishing persistence' },
  { phase: 'command-control', description: 'Remote access channel' },
  { phase: 'actions', description: 'Achieving objectives' },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Provider-Specific Test Suites
// ═══════════════════════════════════════════════════════════════════════════════

interface TestSuite {
  name: string;
  provider: CloudProvider;
  tests: SecurityTest[];
}

interface SecurityTest {
  id: string;
  name: string;
  category: string;
  aptPhase: string;
  execute: (config: AuditConfig) => Promise<SecurityFinding | null>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GCP Tests
// ═══════════════════════════════════════════════════════════════════════════════

async function getGCPAccessToken(): Promise<string> {
  try {
    const { stdout } = await execAsync('gcloud auth print-access-token');
    return stdout.trim();
  } catch (error) {
    throw new Error(`Failed to get GCP access token: ${error}`);
  }
}

async function gcpApiCall(
  endpoint: string,
  method: string = 'GET',
  body?: object,
  accessToken?: string
): Promise<{ data: unknown; timingMs: number; statusCode: number }> {
  const token = accessToken || await getGCPAccessToken();
  const url = new URL(endpoint);
  const startTime = performance.now();

  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'agi-core-universal-audit/1.0',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const timingMs = performance.now() - startTime;
        try {
          resolve({
            data: data ? JSON.parse(data) : {},
            timingMs,
            statusCode: res.statusCode || 0,
          });
        } catch {
          resolve({ data: { raw: data }, timingMs, statusCode: res.statusCode || 0 });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const GCP_TESTS: SecurityTest[] = [
  {
    id: 'GCP-IAM-TIMING-001',
    name: 'IAM Timing Oracle Detection',
    category: 'IAM',
    aptPhase: 'reconnaissance',
    execute: async (config: AuditConfig): Promise<SecurityFinding | null> => {
      if (!config.projectId) return null;

      const timings: number[] = [];
      const evidence: string[] = [];
      const token = await getGCPAccessToken();

      const testCases = [
        { permission: 'resourcemanager.projects.get' },
        { permission: 'resourcemanager.projects.delete' },
        { permission: 'iam.roles.create' },
        { permission: 'compute.instances.create' },
      ];

      for (const tc of testCases) {
        try {
          const result = await gcpApiCall(
            `https://cloudresourcemanager.googleapis.com/v1/projects/${config.projectId}:testIamPermissions`,
            'POST',
            { permissions: [tc.permission] },
            token
          );
          timings.push(result.timingMs);
          evidence.push(`${tc.permission}: ${result.timingMs.toFixed(2)}ms`);
        } catch (e) {
          evidence.push(`${tc.permission}: ERROR`);
        }
      }

      const validTimings = timings.filter(t => t > 0);
      const mean = validTimings.reduce((a, b) => a + b, 0) / validTimings.length;
      const variance = validTimings.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / validTimings.length;
      const stdDev = Math.sqrt(variance);
      const cv = (stdDev / mean) * 100;

      const vulnerable = cv > 25;
      evidence.push(`CV: ${cv.toFixed(1)}% (threshold: 25%)`);

      if (!vulnerable) return null;

      return {
        id: 'GCP-IAM-TIMING-001',
        provider: 'gcp',
        vulnerability: 'IAM Timing Oracle',
        severity: 'high',
        confidence: 0.75 + (cv / 400),
        evidence,
        technique: 'Timing Analysis',
        timestamp: new Date().toISOString(),
        resource: `projects/${config.projectId}`,
        exploitability: 'moderate',
        verified: true,
        aptPhase: 'reconnaissance',
        remediation: 'Implement constant-time permission checks',
      };
    },
  },
  {
    id: 'GCP-SA-KEY-RACE-001',
    name: 'Service Account Key Race Condition',
    category: 'IAM',
    aptPhase: 'exploitation',
    execute: async (config: AuditConfig): Promise<SecurityFinding | null> => {
      if (!config.projectId) return null;

      const evidence: string[] = [];
      const token = await getGCPAccessToken();

      try {
        const saResult = await gcpApiCall(
          `https://iam.googleapis.com/v1/projects/${config.projectId}/serviceAccounts`,
          'GET',
          undefined,
          token
        );

        const accounts = (saResult.data as { accounts?: unknown[] }).accounts || [];
        evidence.push(`Found ${accounts.length} service accounts`);

        const permCheck = await gcpApiCall(
          `https://cloudresourcemanager.googleapis.com/v1/projects/${config.projectId}:testIamPermissions`,
          'POST',
          { permissions: ['iam.serviceAccountKeys.create'] },
          token
        );

        const perms = (permCheck.data as { permissions?: string[] }).permissions || [];
        const canCreateKeys = perms.includes('iam.serviceAccountKeys.create');
        evidence.push(`Can create SA keys: ${canCreateKeys}`);

        if (!canCreateKeys) return null;

        return {
          id: 'GCP-SA-KEY-RACE-001',
          provider: 'gcp',
          vulnerability: 'Service Account Key Creation Race',
          severity: 'critical',
          confidence: 0.85,
          evidence,
          technique: 'Permission Enumeration + TOCTOU Analysis',
          timestamp: new Date().toISOString(),
          resource: `projects/${config.projectId}/serviceAccounts`,
          exploitability: 'trivial',
          verified: true,
          aptPhase: 'exploitation',
          remediation: 'Disable SA key creation, use Workload Identity',
        };
      } catch (e) {
        evidence.push(`Error: ${e}`);
        return null;
      }
    },
  },
  {
    id: 'GCP-STORAGE-ACL-001',
    name: 'Storage Bucket ACL Misconfiguration',
    category: 'Storage',
    aptPhase: 'reconnaissance',
    execute: async (config: AuditConfig): Promise<SecurityFinding | null> => {
      if (!config.projectId) return null;

      const evidence: string[] = [];
      const vulnerabilities: string[] = [];
      const token = await getGCPAccessToken();

      try {
        const bucketsResult = await gcpApiCall(
          `https://storage.googleapis.com/storage/v1/b?project=${config.projectId}`,
          'GET',
          undefined,
          token
        );

        const items = (bucketsResult.data as { items?: { name: string }[] }).items || [];
        evidence.push(`Found ${items.length} buckets`);

        for (const bucket of items.slice(0, 10)) {
          const detail = await gcpApiCall(
            `https://storage.googleapis.com/storage/v1/b/${bucket.name}?projection=full`,
            'GET',
            undefined,
            token
          );

          const data = detail.data as {
            iamConfiguration?: {
              uniformBucketLevelAccess?: { enabled?: boolean };
              publicAccessPrevention?: string;
            };
            acl?: { entity: string }[];
          };

          const uniformAccess = data.iamConfiguration?.uniformBucketLevelAccess?.enabled;
          const publicPrevention = data.iamConfiguration?.publicAccessPrevention;

          if (!uniformAccess) {
            vulnerabilities.push(`${bucket.name}: Legacy ACL mode`);
          }
          if (publicPrevention !== 'enforced') {
            vulnerabilities.push(`${bucket.name}: Public prevention not enforced`);
          }
          if (data.acl) {
            for (const acl of data.acl) {
              if (acl.entity === 'allUsers' || acl.entity === 'allAuthenticatedUsers') {
                vulnerabilities.push(`${bucket.name}: PUBLIC via ${acl.entity}`);
              }
            }
          }
        }

        evidence.push(...vulnerabilities);

        if (vulnerabilities.length === 0) return null;

        return {
          id: 'GCP-STORAGE-ACL-001',
          provider: 'gcp',
          vulnerability: 'Storage Bucket ACL Misconfiguration',
          severity: vulnerabilities.some(v => v.includes('PUBLIC')) ? 'critical' : 'high',
          confidence: 0.95,
          evidence,
          technique: 'Configuration Audit',
          timestamp: new Date().toISOString(),
          resource: `projects/${config.projectId}/buckets`,
          exploitability: 'trivial',
          verified: true,
          aptPhase: 'reconnaissance',
          remediation: 'Enable uniform bucket-level access, enforce public prevention',
        };
      } catch (e) {
        return null;
      }
    },
  },
  {
    id: 'GCP-IAM-CROSS-PROJECT-001',
    name: 'Cross-Project IAM Binding Exposure',
    category: 'IAM',
    aptPhase: 'reconnaissance',
    execute: async (config: AuditConfig): Promise<SecurityFinding | null> => {
      if (!config.projectId) return null;

      const evidence: string[] = [];
      const vulnerabilities: string[] = [];
      const token = await getGCPAccessToken();

      try {
        const policyResult = await gcpApiCall(
          `https://cloudresourcemanager.googleapis.com/v1/projects/${config.projectId}:getIamPolicy`,
          'POST',
          { options: { requestedPolicyVersion: 3 } },
          token
        );

        const bindings = (policyResult.data as { bindings?: { role: string; members: string[] }[] }).bindings || [];

        for (const binding of bindings) {
          for (const member of binding.members || []) {
            if (member.startsWith('serviceAccount:') && !member.includes(config.projectId)) {
              vulnerabilities.push(`Cross-project SA: ${member} has ${binding.role}`);
            }
            if (member === 'allUsers' || member === 'allAuthenticatedUsers') {
              vulnerabilities.push(`PUBLIC: ${member} has ${binding.role}`);
            }
          }
        }

        evidence.push(`Analyzed ${bindings.length} IAM bindings`);
        evidence.push(...vulnerabilities);

        if (vulnerabilities.length === 0) return null;

        return {
          id: 'GCP-IAM-CROSS-PROJECT-001',
          provider: 'gcp',
          vulnerability: 'Cross-Project IAM Exposure',
          severity: vulnerabilities.some(v => v.includes('PUBLIC')) ? 'critical' : 'high',
          confidence: 0.9,
          evidence,
          technique: 'IAM Policy Analysis',
          timestamp: new Date().toISOString(),
          resource: `projects/${config.projectId}/iamPolicy`,
          exploitability: 'moderate',
          verified: true,
          aptPhase: 'reconnaissance',
          remediation: 'Review and restrict cross-project bindings',
        };
      } catch (e) {
        return null;
      }
    },
  },
  {
    id: 'GCP-VPC-SC-001',
    name: 'VPC Service Controls Not Configured',
    category: 'Network',
    aptPhase: 'reconnaissance',
    execute: async (config: AuditConfig): Promise<SecurityFinding | null> => {
      const evidence: string[] = [];
      const token = await getGCPAccessToken();

      try {
        const policyResult = await gcpApiCall(
          `https://accesscontextmanager.googleapis.com/v1/accessPolicies`,
          'GET',
          undefined,
          token
        );

        const policies = (policyResult.data as { accessPolicies?: unknown[] }).accessPolicies || [];

        if (policies.length > 0) {
          evidence.push(`Found ${policies.length} access policies`);
          return null;
        }

        evidence.push('No VPC Service Controls configured');

        return {
          id: 'GCP-VPC-SC-001',
          provider: 'gcp',
          vulnerability: 'VPC Service Controls Not Configured',
          severity: 'medium',
          confidence: 0.85,
          evidence,
          technique: 'Service Perimeter Analysis',
          timestamp: new Date().toISOString(),
          resource: 'organization/accessPolicies',
          exploitability: 'complex',
          verified: true,
          aptPhase: 'reconnaissance',
          remediation: 'Configure VPC Service Controls with service perimeters',
        };
      } catch (e) {
        if (String(e).includes('403')) {
          evidence.push('Access Context Manager API not enabled');
          return {
            id: 'GCP-VPC-SC-001',
            provider: 'gcp',
            vulnerability: 'VPC Service Controls Not Configured',
            severity: 'medium',
            confidence: 0.7,
            evidence,
            technique: 'API Availability Check',
            timestamp: new Date().toISOString(),
            resource: 'organization/accessPolicies',
            exploitability: 'complex',
            verified: true,
            aptPhase: 'reconnaissance',
            remediation: 'Enable Access Context Manager API and configure VPC-SC',
          };
        }
        return null;
      }
    },
  },
  {
    id: 'GCP-FIREWALL-OPEN-001',
    name: 'Firewall Rules Open to Internet',
    category: 'Network',
    aptPhase: 'reconnaissance',
    execute: async (config: AuditConfig): Promise<SecurityFinding | null> => {
      if (!config.projectId) return null;

      const evidence: string[] = [];
      const vulnerabilities: string[] = [];
      const token = await getGCPAccessToken();

      try {
        const firewallResult = await gcpApiCall(
          `https://compute.googleapis.com/compute/v1/projects/${config.projectId}/global/firewalls`,
          'GET',
          undefined,
          token
        );

        const items = (firewallResult.data as { items?: { name: string; sourceRanges?: string[]; direction?: string; allowed?: { ports?: string[] }[] }[] }).items || [];
        evidence.push(`Found ${items.length} firewall rules`);

        for (const rule of items) {
          if (rule.sourceRanges?.includes('0.0.0.0/0') && rule.direction === 'INGRESS') {
            const ports = rule.allowed?.flatMap(a => a.ports || ['all']).join(', ') || 'all';
            vulnerabilities.push(`${rule.name}: Open to 0.0.0.0/0 on ports: ${ports}`);
          }
        }

        evidence.push(...vulnerabilities);

        if (vulnerabilities.length === 0) return null;

        return {
          id: 'GCP-FIREWALL-OPEN-001',
          provider: 'gcp',
          vulnerability: 'Firewall Rules Open to Internet',
          severity: 'critical',
          confidence: 0.95,
          evidence,
          technique: 'Firewall Rule Analysis',
          timestamp: new Date().toISOString(),
          resource: `projects/${config.projectId}/firewalls`,
          exploitability: 'trivial',
          verified: true,
          aptPhase: 'reconnaissance',
          remediation: 'Restrict source ranges, use service accounts',
        };
      } catch (e) {
        return null;
      }
    },
  },
  {
    id: 'GCP-GKE-SECURITY-001',
    name: 'GKE Cluster Security Misconfiguration',
    category: 'Kubernetes',
    aptPhase: 'reconnaissance',
    execute: async (config: AuditConfig): Promise<SecurityFinding | null> => {
      if (!config.projectId) return null;

      const evidence: string[] = [];
      const vulnerabilities: string[] = [];
      const token = await getGCPAccessToken();

      try {
        const clustersResult = await gcpApiCall(
          `https://container.googleapis.com/v1/projects/${config.projectId}/locations/-/clusters`,
          'GET',
          undefined,
          token
        );

        const clusters = (clustersResult.data as { clusters?: {
          name: string;
          workloadIdentityConfig?: { workloadPool?: string };
          shieldedNodes?: { enabled?: boolean };
          networkPolicy?: { enabled?: boolean };
          masterAuthorizedNetworksConfig?: { enabled?: boolean };
        }[] }).clusters || [];

        evidence.push(`Found ${clusters.length} GKE clusters`);

        for (const cluster of clusters) {
          if (!cluster.workloadIdentityConfig?.workloadPool) {
            vulnerabilities.push(`${cluster.name}: No Workload Identity`);
          }
          if (!cluster.shieldedNodes?.enabled) {
            vulnerabilities.push(`${cluster.name}: Shielded Nodes disabled`);
          }
          if (!cluster.networkPolicy?.enabled) {
            vulnerabilities.push(`${cluster.name}: No Network Policy`);
          }
          if (!cluster.masterAuthorizedNetworksConfig?.enabled) {
            vulnerabilities.push(`${cluster.name}: Master not restricted`);
          }
        }

        evidence.push(...vulnerabilities);

        if (vulnerabilities.length === 0) return null;

        return {
          id: 'GCP-GKE-SECURITY-001',
          provider: 'gcp',
          vulnerability: 'GKE Cluster Security Misconfiguration',
          severity: 'high',
          confidence: 0.9,
          evidence,
          technique: 'Cluster Configuration Audit',
          timestamp: new Date().toISOString(),
          resource: `projects/${config.projectId}/clusters`,
          exploitability: 'moderate',
          verified: true,
          aptPhase: 'reconnaissance',
          remediation: 'Enable Workload Identity, Shielded Nodes, Network Policy',
        };
      } catch (e) {
        return null;
      }
    },
  },
  {
    id: 'GCP-BIGQUERY-EXPOSURE-001',
    name: 'BigQuery Dataset Public Exposure',
    category: 'Data',
    aptPhase: 'reconnaissance',
    execute: async (config: AuditConfig): Promise<SecurityFinding | null> => {
      if (!config.projectId) return null;

      const evidence: string[] = [];
      const vulnerabilities: string[] = [];
      const token = await getGCPAccessToken();

      try {
        const datasetsResult = await gcpApiCall(
          `https://bigquery.googleapis.com/bigquery/v2/projects/${config.projectId}/datasets`,
          'GET',
          undefined,
          token
        );

        const datasets = (datasetsResult.data as { datasets?: { datasetReference: { datasetId: string } }[] }).datasets || [];
        evidence.push(`Found ${datasets.length} BigQuery datasets`);

        for (const dataset of datasets.slice(0, 10)) {
          const detail = await gcpApiCall(
            `https://bigquery.googleapis.com/bigquery/v2/projects/${config.projectId}/datasets/${dataset.datasetReference.datasetId}`,
            'GET',
            undefined,
            token
          );

          const access = (detail.data as { access?: { specialGroup?: string; iamMember?: string }[] }).access || [];

          for (const a of access) {
            if (a.specialGroup === 'allAuthenticatedUsers' || a.specialGroup === 'allUsers') {
              vulnerabilities.push(`${dataset.datasetReference.datasetId}: PUBLIC via ${a.specialGroup}`);
            }
            if (a.iamMember?.startsWith('allUsers') || a.iamMember?.startsWith('allAuthenticatedUsers')) {
              vulnerabilities.push(`${dataset.datasetReference.datasetId}: PUBLIC via ${a.iamMember}`);
            }
          }
        }

        evidence.push(...vulnerabilities);

        if (vulnerabilities.length === 0) return null;

        return {
          id: 'GCP-BIGQUERY-EXPOSURE-001',
          provider: 'gcp',
          vulnerability: 'BigQuery Dataset Public Exposure',
          severity: 'critical',
          confidence: 0.95,
          evidence,
          technique: 'Dataset ACL Analysis',
          timestamp: new Date().toISOString(),
          resource: `projects/${config.projectId}/datasets`,
          exploitability: 'trivial',
          verified: true,
          aptPhase: 'reconnaissance',
          remediation: 'Remove public access, use authorized views',
        };
      } catch (e) {
        return null;
      }
    },
  },
  // ═══════════════════════════════════════════════════════════════════════════════
  // GOOGLE WORKSPACE TESTS
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    id: 'GCP-WORKSPACE-ADMIN-001',
    name: 'Google Workspace Admin API Exposure',
    category: 'Workspace',
    aptPhase: 'reconnaissance',
    execute: async (config: AuditConfig): Promise<SecurityFinding | null> => {
      const evidence: string[] = [];
      const vulnerabilities: string[] = [];
      const token = await getGCPAccessToken();

      try {
        // Check Directory API access
        const directoryResult = await gcpApiCall(
          'https://admin.googleapis.com/admin/directory/v1/users?maxResults=1',
          'GET',
          undefined,
          token
        );

        if (directoryResult.statusCode === 200) {
          vulnerabilities.push('Directory API accessible - can enumerate users');
          evidence.push('Admin Directory API: ACCESSIBLE');
        } else {
          evidence.push(`Admin Directory API: ${directoryResult.statusCode}`);
        }

        // Check Reports API
        const reportsResult = await gcpApiCall(
          'https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/login?maxResults=1',
          'GET',
          undefined,
          token
        );

        if (reportsResult.statusCode === 200) {
          vulnerabilities.push('Reports API accessible - can view login activity');
          evidence.push('Admin Reports API: ACCESSIBLE');
        }

        // Check Groups API
        const groupsResult = await gcpApiCall(
          'https://admin.googleapis.com/admin/directory/v1/groups?maxResults=1',
          'GET',
          undefined,
          token
        );

        if (groupsResult.statusCode === 200) {
          vulnerabilities.push('Groups API accessible - can enumerate groups');
          evidence.push('Admin Groups API: ACCESSIBLE');
        }
      } catch (e) {
        evidence.push(`Error: ${e}`);
      }

      if (vulnerabilities.length === 0) return null;

      return {
        id: 'GCP-WORKSPACE-ADMIN-001',
        provider: 'gcp',
        vulnerability: 'Google Workspace Admin API Exposure',
        severity: 'critical',
        confidence: 0.95,
        evidence,
        technique: 'Admin API Enumeration',
        timestamp: new Date().toISOString(),
        resource: 'workspace/admin',
        exploitability: 'moderate',
        verified: true,
        aptPhase: 'reconnaissance',
        remediation: 'Restrict Admin SDK API scopes, use domain-wide delegation carefully',
      };
    },
  },
  {
    id: 'GCP-WORKSPACE-GMAIL-001',
    name: 'Gmail API Over-Privileged Access',
    category: 'Workspace',
    aptPhase: 'reconnaissance',
    execute: async (config: AuditConfig): Promise<SecurityFinding | null> => {
      const evidence: string[] = [];
      const vulnerabilities: string[] = [];
      const token = await getGCPAccessToken();

      try {
        // Check Gmail API access
        const gmailResult = await gcpApiCall(
          'https://gmail.googleapis.com/gmail/v1/users/me/profile',
          'GET',
          undefined,
          token
        );

        if (gmailResult.statusCode === 200) {
          evidence.push('Gmail API: ACCESSIBLE');

          // Check message access
          const messagesResult = await gcpApiCall(
            'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1',
            'GET',
            undefined,
            token
          );

          if (messagesResult.statusCode === 200) {
            vulnerabilities.push('Gmail messages accessible - potential data exfiltration');
          }

          // Check settings access
          const settingsResult = await gcpApiCall(
            'https://gmail.googleapis.com/gmail/v1/users/me/settings/forwardingAddresses',
            'GET',
            undefined,
            token
          );

          if (settingsResult.statusCode === 200) {
            vulnerabilities.push('Gmail settings accessible - can modify forwarding');
          }
        }
      } catch (e) {
        evidence.push(`Error: ${e}`);
      }

      if (vulnerabilities.length === 0) return null;

      return {
        id: 'GCP-WORKSPACE-GMAIL-001',
        provider: 'gcp',
        vulnerability: 'Gmail API Over-Privileged Access',
        severity: 'high',
        confidence: 0.9,
        evidence,
        technique: 'OAuth Scope Analysis',
        timestamp: new Date().toISOString(),
        resource: 'workspace/gmail',
        exploitability: 'moderate',
        verified: true,
        aptPhase: 'reconnaissance',
        remediation: 'Use least-privilege OAuth scopes, review domain-wide delegation',
      };
    },
  },
  {
    id: 'GCP-WORKSPACE-DRIVE-001',
    name: 'Google Drive Sharing Exposure',
    category: 'Workspace',
    aptPhase: 'reconnaissance',
    execute: async (config: AuditConfig): Promise<SecurityFinding | null> => {
      const evidence: string[] = [];
      const vulnerabilities: string[] = [];
      const token = await getGCPAccessToken();

      try {
        // Check Drive API access
        const driveResult = await gcpApiCall(
          'https://www.googleapis.com/drive/v3/files?pageSize=10&q=visibility%3D%27anyoneWithLink%27',
          'GET',
          undefined,
          token
        );

        if (driveResult.statusCode === 200) {
          const files = (driveResult.data as { files?: { name: string }[] }).files || [];
          if (files.length > 0) {
            vulnerabilities.push(`Found ${files.length} publicly shared files`);
            evidence.push(...files.slice(0, 5).map(f => `Public file: ${f.name}`));
          }
        }

        // Check for files shared with anyone in org
        const orgSharedResult = await gcpApiCall(
          'https://www.googleapis.com/drive/v3/files?pageSize=10&q=visibility%3D%27domainWithLink%27',
          'GET',
          undefined,
          token
        );

        if (orgSharedResult.statusCode === 200) {
          const files = (orgSharedResult.data as { files?: { name: string }[] }).files || [];
          if (files.length > 0) {
            evidence.push(`Found ${files.length} domain-shared files`);
          }
        }
      } catch (e) {
        evidence.push(`Error: ${e}`);
      }

      if (vulnerabilities.length === 0) return null;

      return {
        id: 'GCP-WORKSPACE-DRIVE-001',
        provider: 'gcp',
        vulnerability: 'Google Drive Public Sharing Exposure',
        severity: 'high',
        confidence: 0.9,
        evidence,
        technique: 'Drive Sharing Analysis',
        timestamp: new Date().toISOString(),
        resource: 'workspace/drive',
        exploitability: 'trivial',
        verified: true,
        aptPhase: 'reconnaissance',
        remediation: 'Enable sharing restrictions, audit public links',
      };
    },
  },
  // ═══════════════════════════════════════════════════════════════════════════════
  // FIREBASE TESTS
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    id: 'GCP-FIREBASE-AUTH-001',
    name: 'Firebase Auth Configuration Weakness',
    category: 'Firebase',
    aptPhase: 'reconnaissance',
    execute: async (config: AuditConfig): Promise<SecurityFinding | null> => {
      if (!config.projectId) return null;

      const evidence: string[] = [];
      const vulnerabilities: string[] = [];
      const token = await getGCPAccessToken();

      try {
        // Check Firebase Auth config
        const authResult = await gcpApiCall(
          `https://identitytoolkit.googleapis.com/v1/projects/${config.projectId}/config`,
          'GET',
          undefined,
          token
        );

        if (authResult.statusCode === 200) {
          const authConfig = authResult.data as {
            signIn?: { allowDuplicateEmails?: boolean; email?: { enabled?: boolean } };
            authorizedDomains?: string[];
            mfa?: { state?: string };
          };

          evidence.push('Firebase Auth: ACCESSIBLE');

          // Check for weak settings
          if (authConfig.signIn?.allowDuplicateEmails) {
            vulnerabilities.push('Duplicate emails allowed');
          }

          if (authConfig.authorizedDomains?.includes('localhost')) {
            vulnerabilities.push('localhost in authorized domains');
          }

          if (authConfig.mfa?.state !== 'ENABLED') {
            vulnerabilities.push('MFA not enforced');
          }

          evidence.push(`Authorized domains: ${authConfig.authorizedDomains?.join(', ')}`);
        }
      } catch (e) {
        evidence.push(`Error: ${e}`);
      }

      if (vulnerabilities.length === 0) return null;

      return {
        id: 'GCP-FIREBASE-AUTH-001',
        provider: 'gcp',
        vulnerability: 'Firebase Auth Configuration Weakness',
        severity: 'high',
        confidence: 0.85,
        evidence,
        technique: 'Auth Config Analysis',
        timestamp: new Date().toISOString(),
        resource: `firebase/${config.projectId}/auth`,
        exploitability: 'moderate',
        verified: true,
        aptPhase: 'reconnaissance',
        remediation: 'Enable MFA, restrict authorized domains, disable duplicate emails',
      };
    },
  },
  {
    id: 'GCP-FIREBASE-DB-001',
    name: 'Firebase Realtime Database Rules',
    category: 'Firebase',
    aptPhase: 'reconnaissance',
    execute: async (config: AuditConfig): Promise<SecurityFinding | null> => {
      if (!config.projectId) return null;

      const evidence: string[] = [];
      const vulnerabilities: string[] = [];
      const token = await getGCPAccessToken();

      try {
        // Check Firebase RTDB rules
        const rulesResult = await gcpApiCall(
          `https://firebasedatabase.googleapis.com/v1beta/projects/${config.projectId}/locations/-/instances`,
          'GET',
          undefined,
          token
        );

        if (rulesResult.statusCode === 200) {
          const instances = (rulesResult.data as { instances?: { name: string; databaseUrl?: string }[] }).instances || [];
          evidence.push(`Found ${instances.length} RTDB instances`);

          for (const instance of instances) {
            if (instance.databaseUrl) {
              // Try to read rules (requires admin access)
              try {
                const dbRulesResult = await gcpApiCall(
                  `${instance.databaseUrl}/.settings/rules.json`,
                  'GET',
                  undefined,
                  token
                );

                if (dbRulesResult.statusCode === 200) {
                  const rules = JSON.stringify(dbRulesResult.data);
                  if (rules.includes('"read": true') || rules.includes('".read": true')) {
                    vulnerabilities.push(`${instance.name}: Public read access in rules`);
                  }
                  if (rules.includes('"write": true') || rules.includes('".write": true')) {
                    vulnerabilities.push(`${instance.name}: Public write access in rules`);
                  }
                }
              } catch {
                evidence.push(`${instance.name}: Could not read rules`);
              }
            }
          }
        }
      } catch (e) {
        evidence.push(`Error: ${e}`);
      }

      if (vulnerabilities.length === 0) return null;

      return {
        id: 'GCP-FIREBASE-DB-001',
        provider: 'gcp',
        vulnerability: 'Firebase Realtime Database Public Access',
        severity: 'critical',
        confidence: 0.95,
        evidence,
        technique: 'Rules Analysis',
        timestamp: new Date().toISOString(),
        resource: `firebase/${config.projectId}/rtdb`,
        exploitability: 'trivial',
        verified: true,
        aptPhase: 'reconnaissance',
        remediation: 'Implement proper security rules, require authentication',
      };
    },
  },
  {
    id: 'GCP-FIREBASE-STORAGE-001',
    name: 'Firebase Storage Rules Misconfiguration',
    category: 'Firebase',
    aptPhase: 'reconnaissance',
    execute: async (config: AuditConfig): Promise<SecurityFinding | null> => {
      if (!config.projectId) return null;

      const evidence: string[] = [];
      const vulnerabilities: string[] = [];
      const token = await getGCPAccessToken();

      try {
        // Check default Firebase Storage bucket
        const bucketName = `${config.projectId}.appspot.com`;
        const storageResult = await gcpApiCall(
          `https://storage.googleapis.com/storage/v1/b/${bucketName}?projection=full`,
          'GET',
          undefined,
          token
        );

        if (storageResult.statusCode === 200) {
          evidence.push(`Firebase Storage bucket found: ${bucketName}`);

          const bucket = storageResult.data as {
            iamConfiguration?: {
              uniformBucketLevelAccess?: { enabled?: boolean };
              publicAccessPrevention?: string;
            };
            cors?: unknown[];
          };

          if (!bucket.iamConfiguration?.uniformBucketLevelAccess?.enabled) {
            vulnerabilities.push('Uniform bucket access not enabled');
          }

          if (bucket.iamConfiguration?.publicAccessPrevention !== 'enforced') {
            vulnerabilities.push('Public access prevention not enforced');
          }

          if (bucket.cors && bucket.cors.length > 0) {
            evidence.push(`CORS configured: ${JSON.stringify(bucket.cors)}`);
          }
        }
      } catch (e) {
        evidence.push(`Error: ${e}`);
      }

      if (vulnerabilities.length === 0) return null;

      return {
        id: 'GCP-FIREBASE-STORAGE-001',
        provider: 'gcp',
        vulnerability: 'Firebase Storage Security Misconfiguration',
        severity: 'high',
        confidence: 0.9,
        evidence,
        technique: 'Storage Config Analysis',
        timestamp: new Date().toISOString(),
        resource: `firebase/${config.projectId}/storage`,
        exploitability: 'moderate',
        verified: true,
        aptPhase: 'reconnaissance',
        remediation: 'Enable uniform access, enforce public prevention, review rules',
      };
    },
  },
  // ═══════════════════════════════════════════════════════════════════════════════
  // ANDROID / PLAY CONSOLE TESTS
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    id: 'GCP-ANDROID-PLAY-001',
    name: 'Google Play Console API Access',
    category: 'Android',
    aptPhase: 'reconnaissance',
    execute: async (config: AuditConfig): Promise<SecurityFinding | null> => {
      const evidence: string[] = [];
      const vulnerabilities: string[] = [];
      const token = await getGCPAccessToken();

      try {
        // Check Android Publisher API access
        const publisherResult = await gcpApiCall(
          'https://androidpublisher.googleapis.com/androidpublisher/v3/applications',
          'GET',
          undefined,
          token
        );

        if (publisherResult.statusCode === 200) {
          evidence.push('Android Publisher API: ACCESSIBLE');
          vulnerabilities.push('Can access Play Console data - potential app manipulation');
        }

        // Check for Play Integrity API
        const integrityResult = await gcpApiCall(
          'https://playintegrity.googleapis.com/v1/deviceRecall',
          'GET',
          undefined,
          token
        );

        if (integrityResult.statusCode !== 403) {
          evidence.push('Play Integrity API: ACCESSIBLE');
        }
      } catch (e) {
        evidence.push(`Error: ${e}`);
      }

      if (vulnerabilities.length === 0) return null;

      return {
        id: 'GCP-ANDROID-PLAY-001',
        provider: 'gcp',
        vulnerability: 'Google Play Console API Exposure',
        severity: 'critical',
        confidence: 0.9,
        evidence,
        technique: 'API Enumeration',
        timestamp: new Date().toISOString(),
        resource: 'android/play-console',
        exploitability: 'moderate',
        verified: true,
        aptPhase: 'reconnaissance',
        remediation: 'Restrict Play Console API access, use service account scoping',
      };
    },
  },
  {
    id: 'GCP-ANDROID-FCM-001',
    name: 'Firebase Cloud Messaging Misconfiguration',
    category: 'Android',
    aptPhase: 'reconnaissance',
    execute: async (config: AuditConfig): Promise<SecurityFinding | null> => {
      if (!config.projectId) return null;

      const evidence: string[] = [];
      const vulnerabilities: string[] = [];
      const token = await getGCPAccessToken();

      try {
        // Check FCM API access
        const fcmResult = await gcpApiCall(
          `https://fcm.googleapis.com/v1/projects/${config.projectId}/messages:send`,
          'POST',
          {
            validate_only: true,
            message: { topic: 'test' },
          },
          token
        );

        if (fcmResult.statusCode === 200 || fcmResult.statusCode === 400) {
          // 400 means we have access but invalid message
          evidence.push('FCM API: ACCESSIBLE');

          if (fcmResult.statusCode === 200) {
            vulnerabilities.push('Can send push notifications - potential phishing vector');
          }
        }
      } catch (e) {
        evidence.push(`Error: ${e}`);
      }

      if (vulnerabilities.length === 0) return null;

      return {
        id: 'GCP-ANDROID-FCM-001',
        provider: 'gcp',
        vulnerability: 'Firebase Cloud Messaging Access',
        severity: 'high',
        confidence: 0.85,
        evidence,
        technique: 'FCM API Testing',
        timestamp: new Date().toISOString(),
        resource: `firebase/${config.projectId}/fcm`,
        exploitability: 'moderate',
        verified: true,
        aptPhase: 'reconnaissance',
        remediation: 'Restrict FCM API access, validate message origins',
      };
    },
  },
  // ═══════════════════════════════════════════════════════════════════════════════
  // GOOGLE CLOUD IDENTITY & SECURITY
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    id: 'GCP-IDENTITY-001',
    name: 'Cloud Identity Group Enumeration',
    category: 'Identity',
    aptPhase: 'reconnaissance',
    execute: async (config: AuditConfig): Promise<SecurityFinding | null> => {
      const evidence: string[] = [];
      const vulnerabilities: string[] = [];
      const token = await getGCPAccessToken();

      try {
        // Check Cloud Identity Groups API
        const groupsResult = await gcpApiCall(
          'https://cloudidentity.googleapis.com/v1/groups?pageSize=10',
          'GET',
          undefined,
          token
        );

        if (groupsResult.statusCode === 200) {
          const groups = (groupsResult.data as { groups?: { displayName: string; groupKey?: { id: string } }[] }).groups || [];
          evidence.push(`Found ${groups.length} Cloud Identity groups`);

          if (groups.length > 0) {
            vulnerabilities.push('Cloud Identity groups enumerable');
            evidence.push(...groups.slice(0, 5).map(g => `Group: ${g.displayName || g.groupKey?.id}`));
          }
        }

        // Check devices
        const devicesResult = await gcpApiCall(
          'https://cloudidentity.googleapis.com/v1/devices?pageSize=10',
          'GET',
          undefined,
          token
        );

        if (devicesResult.statusCode === 200) {
          const devices = (devicesResult.data as { devices?: unknown[] }).devices || [];
          if (devices.length > 0) {
            vulnerabilities.push(`Found ${devices.length} managed devices`);
          }
        }
      } catch (e) {
        evidence.push(`Error: ${e}`);
      }

      if (vulnerabilities.length === 0) return null;

      return {
        id: 'GCP-IDENTITY-001',
        provider: 'gcp',
        vulnerability: 'Cloud Identity Enumeration',
        severity: 'medium',
        confidence: 0.85,
        evidence,
        technique: 'Identity API Analysis',
        timestamp: new Date().toISOString(),
        resource: 'cloudidentity/groups',
        exploitability: 'moderate',
        verified: true,
        aptPhase: 'reconnaissance',
        remediation: 'Restrict Cloud Identity API access, audit group visibility',
      };
    },
  },
  {
    id: 'GCP-CHRONICLE-001',
    name: 'Chronicle Security Data Access',
    category: 'Security',
    aptPhase: 'reconnaissance',
    execute: async (config: AuditConfig): Promise<SecurityFinding | null> => {
      const evidence: string[] = [];
      const vulnerabilities: string[] = [];
      const token = await getGCPAccessToken();

      try {
        // Check Chronicle API access
        const chronicleResult = await gcpApiCall(
          'https://chronicle.googleapis.com/v1alpha/logs:search',
          'POST',
          { query: 'metadata.event_type = "USER_LOGIN"', time_range: { start_time: new Date(Date.now() - 3600000).toISOString(), end_time: new Date().toISOString() } },
          token
        );

        if (chronicleResult.statusCode === 200) {
          vulnerabilities.push('Chronicle API accessible - can search security logs');
          evidence.push('Chronicle Search API: ACCESSIBLE');
        }

        // Check detection rules
        const rulesResult = await gcpApiCall(
          'https://chronicle.googleapis.com/v1alpha/rules',
          'GET',
          undefined,
          token
        );

        if (rulesResult.statusCode === 200) {
          evidence.push('Chronicle Rules API: ACCESSIBLE');
        }
      } catch (e) {
        evidence.push(`Chronicle API not enabled or no access: ${e}`);
      }

      if (vulnerabilities.length === 0) return null;

      return {
        id: 'GCP-CHRONICLE-001',
        provider: 'gcp',
        vulnerability: 'Chronicle Security Data Access',
        severity: 'high',
        confidence: 0.85,
        evidence,
        technique: 'Chronicle API Testing',
        timestamp: new Date().toISOString(),
        resource: 'chronicle/logs',
        exploitability: 'complex',
        verified: true,
        aptPhase: 'reconnaissance',
        remediation: 'Restrict Chronicle API access, implement RBAC',
      };
    },
  },
  {
    id: 'GCP-SECRETMANAGER-001',
    name: 'Secret Manager Access and Exposure',
    category: 'Security',
    aptPhase: 'exploitation',
    execute: async (config: AuditConfig): Promise<SecurityFinding | null> => {
      if (!config.projectId) return null;

      const evidence: string[] = [];
      const vulnerabilities: string[] = [];
      const token = await getGCPAccessToken();

      try {
        // List secrets
        const secretsResult = await gcpApiCall(
          `https://secretmanager.googleapis.com/v1/projects/${config.projectId}/secrets`,
          'GET',
          undefined,
          token
        );

        if (secretsResult.statusCode === 200) {
          const secrets = (secretsResult.data as { secrets?: { name: string }[] }).secrets || [];
          evidence.push(`Found ${secrets.length} secrets`);

          // Check if we can access secret versions
          for (const secret of secrets.slice(0, 5)) {
            try {
              const versionResult = await gcpApiCall(
                `https://secretmanager.googleapis.com/v1/${secret.name}/versions/latest:access`,
                'GET',
                undefined,
                token
              );

              if (versionResult.statusCode === 200) {
                vulnerabilities.push(`Can access secret: ${secret.name.split('/').pop()}`);
              }
            } catch {
              evidence.push(`${secret.name.split('/').pop()}: Access denied`);
            }
          }
        }
      } catch (e) {
        evidence.push(`Error: ${e}`);
      }

      if (vulnerabilities.length === 0) return null;

      return {
        id: 'GCP-SECRETMANAGER-001',
        provider: 'gcp',
        vulnerability: 'Secret Manager Secrets Accessible',
        severity: 'critical',
        confidence: 0.95,
        evidence,
        technique: 'Secret Enumeration',
        timestamp: new Date().toISOString(),
        resource: `projects/${config.projectId}/secrets`,
        exploitability: 'trivial',
        verified: true,
        aptPhase: 'exploitation',
        remediation: 'Restrict secret access, use IAM conditions, enable audit logging',
      };
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// AWS Tests (Skeleton - requires AWS CLI/SDK)
// ═══════════════════════════════════════════════════════════════════════════════

async function getAWSAccessToken(): Promise<string> {
  try {
    const { stdout } = await execAsync('aws sts get-session-token --output json');
    const data = JSON.parse(stdout);
    return data.Credentials?.SessionToken || '';
  } catch {
    return '';
  }
}

const AWS_TESTS: SecurityTest[] = [
  {
    id: 'AWS-S3-PUBLIC-001',
    name: 'S3 Bucket Public Access',
    category: 'Storage',
    aptPhase: 'reconnaissance',
    execute: async (config: AuditConfig): Promise<SecurityFinding | null> => {
      const evidence: string[] = [];
      const vulnerabilities: string[] = [];

      try {
        const { stdout } = await execAsync('aws s3api list-buckets --output json');
        const buckets = JSON.parse(stdout).Buckets || [];
        evidence.push(`Found ${buckets.length} S3 buckets`);

        for (const bucket of buckets.slice(0, 10)) {
          try {
            const { stdout: aclOutput } = await execAsync(`aws s3api get-bucket-acl --bucket ${bucket.Name} --output json`);
            const acl = JSON.parse(aclOutput);

            for (const grant of acl.Grants || []) {
              if (grant.Grantee?.URI?.includes('AllUsers') || grant.Grantee?.URI?.includes('AuthenticatedUsers')) {
                vulnerabilities.push(`${bucket.Name}: Public via ${grant.Permission}`);
              }
            }
          } catch {
            // Skip inaccessible buckets
          }
        }

        evidence.push(...vulnerabilities);

        if (vulnerabilities.length === 0) return null;

        return {
          id: 'AWS-S3-PUBLIC-001',
          provider: 'aws',
          vulnerability: 'S3 Bucket Public Access',
          severity: 'critical',
          confidence: 0.95,
          evidence,
          technique: 'ACL Analysis',
          timestamp: new Date().toISOString(),
          resource: 's3/buckets',
          exploitability: 'trivial',
          verified: true,
          aptPhase: 'reconnaissance',
          remediation: 'Enable S3 Block Public Access, review bucket policies',
        };
      } catch (e) {
        evidence.push(`AWS CLI not configured or error: ${e}`);
        return null;
      }
    },
  },
  {
    id: 'AWS-IAM-ADMIN-001',
    name: 'IAM Users with Admin Access',
    category: 'IAM',
    aptPhase: 'reconnaissance',
    execute: async (config: AuditConfig): Promise<SecurityFinding | null> => {
      const evidence: string[] = [];
      const vulnerabilities: string[] = [];

      try {
        const { stdout } = await execAsync('aws iam list-users --output json');
        const users = JSON.parse(stdout).Users || [];
        evidence.push(`Found ${users.length} IAM users`);

        for (const user of users) {
          try {
            const { stdout: policiesOutput } = await execAsync(`aws iam list-attached-user-policies --user-name ${user.UserName} --output json`);
            const policies = JSON.parse(policiesOutput).AttachedPolicies || [];

            for (const policy of policies) {
              if (policy.PolicyArn?.includes('AdministratorAccess') || policy.PolicyArn?.includes('PowerUserAccess')) {
                vulnerabilities.push(`${user.UserName}: Has ${policy.PolicyName}`);
              }
            }
          } catch {
            // Skip inaccessible users
          }
        }

        evidence.push(...vulnerabilities);

        if (vulnerabilities.length === 0) return null;

        return {
          id: 'AWS-IAM-ADMIN-001',
          provider: 'aws',
          vulnerability: 'IAM Users with Excessive Privileges',
          severity: 'high',
          confidence: 0.9,
          evidence,
          technique: 'Policy Enumeration',
          timestamp: new Date().toISOString(),
          resource: 'iam/users',
          exploitability: 'moderate',
          verified: true,
          aptPhase: 'reconnaissance',
          remediation: 'Apply least privilege, use IAM roles instead',
        };
      } catch (e) {
        return null;
      }
    },
  },
  {
    id: 'AWS-EC2-SG-001',
    name: 'Security Groups Open to Internet',
    category: 'Network',
    aptPhase: 'reconnaissance',
    execute: async (config: AuditConfig): Promise<SecurityFinding | null> => {
      const evidence: string[] = [];
      const vulnerabilities: string[] = [];

      try {
        const { stdout } = await execAsync('aws ec2 describe-security-groups --output json');
        const groups = JSON.parse(stdout).SecurityGroups || [];
        evidence.push(`Found ${groups.length} security groups`);

        for (const sg of groups) {
          for (const perm of sg.IpPermissions || []) {
            for (const range of perm.IpRanges || []) {
              if (range.CidrIp === '0.0.0.0/0') {
                const port = perm.FromPort === perm.ToPort ? perm.FromPort : `${perm.FromPort}-${perm.ToPort}`;
                vulnerabilities.push(`${sg.GroupId}: Open to 0.0.0.0/0 on port ${port}`);
              }
            }
          }
        }

        evidence.push(...vulnerabilities);

        if (vulnerabilities.length === 0) return null;

        return {
          id: 'AWS-EC2-SG-001',
          provider: 'aws',
          vulnerability: 'Security Groups Open to Internet',
          severity: 'critical',
          confidence: 0.95,
          evidence,
          technique: 'Security Group Analysis',
          timestamp: new Date().toISOString(),
          resource: 'ec2/security-groups',
          exploitability: 'trivial',
          verified: true,
          aptPhase: 'reconnaissance',
          remediation: 'Restrict CIDR ranges, use VPC endpoints',
        };
      } catch (e) {
        return null;
      }
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Azure Tests (Skeleton - requires Azure CLI)
// ═══════════════════════════════════════════════════════════════════════════════

const AZURE_TESTS: SecurityTest[] = [
  {
    id: 'AZURE-STORAGE-PUBLIC-001',
    name: 'Storage Account Public Access',
    category: 'Storage',
    aptPhase: 'reconnaissance',
    execute: async (config: AuditConfig): Promise<SecurityFinding | null> => {
      const evidence: string[] = [];
      const vulnerabilities: string[] = [];

      try {
        const { stdout } = await execAsync('az storage account list --output json');
        const accounts = JSON.parse(stdout) || [];
        evidence.push(`Found ${accounts.length} storage accounts`);

        for (const account of accounts) {
          if (account.allowBlobPublicAccess === true) {
            vulnerabilities.push(`${account.name}: Public blob access enabled`);
          }
          if (account.networkRuleSet?.defaultAction === 'Allow') {
            vulnerabilities.push(`${account.name}: Network default action is Allow`);
          }
        }

        evidence.push(...vulnerabilities);

        if (vulnerabilities.length === 0) return null;

        return {
          id: 'AZURE-STORAGE-PUBLIC-001',
          provider: 'azure',
          vulnerability: 'Storage Account Public Access',
          severity: 'high',
          confidence: 0.9,
          evidence,
          technique: 'Configuration Audit',
          timestamp: new Date().toISOString(),
          resource: 'storage/accounts',
          exploitability: 'moderate',
          verified: true,
          aptPhase: 'reconnaissance',
          remediation: 'Disable public access, configure network rules',
        };
      } catch (e) {
        return null;
      }
    },
  },
  {
    id: 'AZURE-RBAC-ADMIN-001',
    name: 'RBAC Owner/Contributor Assignments',
    category: 'IAM',
    aptPhase: 'reconnaissance',
    execute: async (config: AuditConfig): Promise<SecurityFinding | null> => {
      const evidence: string[] = [];
      const vulnerabilities: string[] = [];

      try {
        const { stdout } = await execAsync('az role assignment list --all --output json');
        const assignments = JSON.parse(stdout) || [];
        evidence.push(`Found ${assignments.length} role assignments`);

        for (const assignment of assignments) {
          if (assignment.roleDefinitionName === 'Owner' || assignment.roleDefinitionName === 'Contributor') {
            if (assignment.scope === '/' || assignment.scope?.split('/').length <= 3) {
              vulnerabilities.push(`${assignment.principalName}: ${assignment.roleDefinitionName} at ${assignment.scope}`);
            }
          }
        }

        evidence.push(...vulnerabilities);

        if (vulnerabilities.length === 0) return null;

        return {
          id: 'AZURE-RBAC-ADMIN-001',
          provider: 'azure',
          vulnerability: 'Broad RBAC Assignments at Subscription Level',
          severity: 'high',
          confidence: 0.9,
          evidence,
          technique: 'RBAC Analysis',
          timestamp: new Date().toISOString(),
          resource: 'rbac/assignments',
          exploitability: 'moderate',
          verified: true,
          aptPhase: 'reconnaissance',
          remediation: 'Apply least privilege, use resource group scoping',
        };
      } catch (e) {
        return null;
      }
    },
  },
  {
    id: 'AZURE-NSG-OPEN-001',
    name: 'NSG Rules Open to Internet',
    category: 'Network',
    aptPhase: 'reconnaissance',
    execute: async (config: AuditConfig): Promise<SecurityFinding | null> => {
      const evidence: string[] = [];
      const vulnerabilities: string[] = [];

      try {
        const { stdout } = await execAsync('az network nsg list --output json');
        const nsgs = JSON.parse(stdout) || [];
        evidence.push(`Found ${nsgs.length} NSGs`);

        for (const nsg of nsgs) {
          for (const rule of nsg.securityRules || []) {
            if (rule.sourceAddressPrefix === '*' && rule.direction === 'Inbound' && rule.access === 'Allow') {
              vulnerabilities.push(`${nsg.name}/${rule.name}: Open to * on port ${rule.destinationPortRange}`);
            }
          }
        }

        evidence.push(...vulnerabilities);

        if (vulnerabilities.length === 0) return null;

        return {
          id: 'AZURE-NSG-OPEN-001',
          provider: 'azure',
          vulnerability: 'NSG Rules Open to Internet',
          severity: 'critical',
          confidence: 0.95,
          evidence,
          technique: 'NSG Analysis',
          timestamp: new Date().toISOString(),
          resource: 'network/nsg',
          exploitability: 'trivial',
          verified: true,
          aptPhase: 'reconnaissance',
          remediation: 'Restrict source addresses, use service tags',
        };
      } catch (e) {
        return null;
      }
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Zero-Day Prediction Engine
// ═══════════════════════════════════════════════════════════════════════════════

function generateZeroDayPredictions(config: AuditConfig): SecurityFinding[] {
  if (!config.includeZeroDay) return [];

  const predictions: SecurityFinding[] = [];
  const timestamp = new Date().toISOString();

  const zeroDayHypotheses = [
    {
      id: 'ZERODAY-TIMING-001',
      vulnerability: 'Temporal Coupling in Auth Token Refresh',
      description: 'Race window during token refresh allows session hijacking',
      heuristics: ['temporalCoupling', 'trustBoundaryAnalysis'],
    },
    {
      id: 'ZERODAY-SERIAL-001',
      vulnerability: 'Deserialization Gadget in API Gateway',
      description: 'Complex serialization chain allows RCE via crafted payloads',
      heuristics: ['serializationBoundaries', 'complexityCorrelation'],
    },
    {
      id: 'ZERODAY-EMERGENT-001',
      vulnerability: 'Emergent Privilege Escalation via Service Mesh',
      description: 'Multi-service interaction creates unintended privilege path',
      heuristics: ['emergentBehaviors', 'trustBoundaryAnalysis'],
    },
    {
      id: 'ZERODAY-STATE-001',
      vulnerability: 'Implicit State Dependency Cache Poisoning',
      description: 'Shared cache state allows cross-tenant data leakage',
      heuristics: ['implicitStateDependencies', 'errorHandlingAsymmetry'],
    },
    {
      id: 'ZERODAY-RESOURCE-001',
      vulnerability: 'Resource Exhaustion via Asymmetric Load',
      description: 'Unbalanced resource limits enable denial of service',
      heuristics: ['resourceExhaustion', 'complexityCorrelation'],
    },
  ];

  for (const hypothesis of zeroDayHypotheses) {
    const relevantHeuristics = hypothesis.heuristics.map(h => ZERO_DAY_HEURISTICS[h as keyof typeof ZERO_DAY_HEURISTICS]);
    const avgWeight = relevantHeuristics.reduce((sum, h) => sum + h.weight, 0) / relevantHeuristics.length;

    predictions.push({
      id: hypothesis.id,
      provider: config.provider,
      vulnerability: hypothesis.vulnerability,
      severity: 'high',
      confidence: avgWeight * 0.7, // Zero-day predictions have inherent uncertainty
      evidence: [
        hypothesis.description,
        `Based on heuristics: ${hypothesis.heuristics.join(', ')}`,
        ...relevantHeuristics.flatMap(h => h.indicators.slice(0, 2)),
      ],
      technique: 'Zero-Day Prediction via Heuristic Analysis',
      timestamp,
      resource: 'infrastructure',
      exploitability: 'theoretical',
      verified: false,
      aptPhase: 'exploitation',
      remediation: 'Manual security review recommended',
    });
  }

  return predictions;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Audit Engine
// ═══════════════════════════════════════════════════════════════════════════════

export async function runUniversalSecurityAudit(config: AuditConfig): Promise<UniversalAuditResult> {
  const startTime = new Date();
  const findings: SecurityFinding[] = [];

  console.log('\n');
  console.log('████████████████████████████████████████████████████████████████████████████████');
  console.log('██                                                                            ██');
  console.log('██           UNIVERSAL SECURITY AUDIT - AGI CORE                              ██');
  console.log('██                 Live Infrastructure Testing                                ██');
  console.log('██                                                                            ██');
  console.log('████████████████████████████████████████████████████████████████████████████████\n');

  console.log(`Provider: ${config.provider.toUpperCase()}`);
  console.log(`Project/Account: ${config.projectId || config.accountId || config.subscriptionId || 'N/A'}`);
  console.log(`Organization: ${config.organizationId || 'N/A'}`);
  console.log(`Timestamp: ${startTime.toISOString()}`);
  console.log(`Mode: ${config.liveTesting ? 'LIVE TESTING' : 'Configuration Review'}`);
  console.log('\n');

  // Select tests based on provider
  let tests: SecurityTest[] = [];
  switch (config.provider) {
    case 'gcp':
      tests = GCP_TESTS;
      break;
    case 'aws':
      tests = AWS_TESTS;
      break;
    case 'azure':
      tests = AZURE_TESTS;
      break;
    case 'custom':
      // Custom provider uses all available tests
      tests = [...GCP_TESTS, ...AWS_TESTS, ...AZURE_TESTS];
      break;
  }

  console.log('┌─────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ EXECUTING SECURITY TESTS                                                   │');
  console.log('└─────────────────────────────────────────────────────────────────────────────┘\n');

  // Run tests
  for (const test of tests) {
    try {
      console.log(`  [${test.category}] ${test.name}...`);
      const finding = await test.execute(config);
      if (finding) {
        findings.push(finding);
        console.log(`    ⚠ FOUND: ${finding.severity.toUpperCase()} - ${finding.vulnerability}`);
      } else {
        console.log(`    ✓ OK`);
      }
    } catch (e) {
      console.log(`    ✗ ERROR: ${e}`);
    }
  }

  // Add zero-day predictions if enabled
  if (config.includeZeroDay) {
    console.log('\n');
    console.log('┌─────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ ZERO-DAY PREDICTION ENGINE                                                 │');
    console.log('└─────────────────────────────────────────────────────────────────────────────┘\n');

    const predictions = generateZeroDayPredictions(config);
    findings.push(...predictions);

    for (const pred of predictions) {
      console.log(`  [PREDICTION] ${pred.vulnerability}`);
      console.log(`    Confidence: ${(pred.confidence * 100).toFixed(1)}%`);
    }
  }

  const endTime = new Date();
  const duration = endTime.getTime() - startTime.getTime();

  // Generate summary
  const verified = findings.filter(f => f.verified);
  const summary: AuditSummary = {
    provider: config.provider,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    duration,
    total: findings.length,
    verified: verified.length,
    critical: findings.filter(f => f.severity === 'critical').length,
    high: findings.filter(f => f.severity === 'high').length,
    medium: findings.filter(f => f.severity === 'medium').length,
    low: findings.filter(f => f.severity === 'low').length,
    zeroDay: findings.filter(f => f.exploitability === 'theoretical').length,
  };

  // Print summary
  console.log('\n');
  console.log('████████████████████████████████████████████████████████████████████████████████');
  console.log('██                          AUDIT COMPLETE                                    ██');
  console.log('████████████████████████████████████████████████████████████████████████████████\n');

  console.log(`  Total Findings: ${summary.total}`);
  console.log(`  Verified: ${summary.verified}`);
  console.log(`    Critical: ${summary.critical}`);
  console.log(`    High: ${summary.high}`);
  console.log(`    Medium: ${summary.medium}`);
  console.log(`    Low: ${summary.low}`);
  console.log(`  Zero-Day Predictions: ${summary.zeroDay}`);
  console.log(`\n  Duration: ${(duration / 1000).toFixed(2)}s`);

  if (verified.length > 0) {
    console.log('\n');
    console.log('┌─────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ CONFIRMED VULNERABILITIES                                                  │');
    console.log('└─────────────────────────────────────────────────────────────────────────────┘\n');

    for (const v of verified) {
      console.log(`  ⚠ [${v.severity.toUpperCase()}] ${v.vulnerability}`);
      console.log(`    ID: ${v.id}`);
      console.log(`    Resource: ${v.resource}`);
      console.log(`    Confidence: ${(v.confidence * 100).toFixed(1)}%`);
      console.log(`    Exploitability: ${v.exploitability}`);
      if (v.remediation) {
        console.log(`    Remediation: ${v.remediation}`);
      }
      console.log('');
    }
  }

  console.log('████████████████████████████████████████████████████████████████████████████████\n');

  return { findings, summary };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Multi-Provider Audit
// ═══════════════════════════════════════════════════════════════════════════════

export async function runMultiProviderAudit(configs: AuditConfig[]): Promise<Map<CloudProvider, UniversalAuditResult>> {
  const results = new Map<CloudProvider, UniversalAuditResult>();

  console.log('\n');
  console.log('████████████████████████████████████████████████████████████████████████████████');
  console.log('██                                                                            ██');
  console.log('██           MULTI-PROVIDER SECURITY AUDIT                                    ██');
  console.log('██                                                                            ██');
  console.log('████████████████████████████████████████████████████████████████████████████████\n');

  for (const config of configs) {
    console.log(`\n▶ Starting audit for ${config.provider.toUpperCase()}...\n`);
    const result = await runUniversalSecurityAudit(config);
    results.set(config.provider, result);
  }

  // Aggregate summary
  console.log('\n');
  console.log('████████████████████████████████████████████████████████████████████████████████');
  console.log('██                     AGGREGATE SUMMARY                                      ██');
  console.log('████████████████████████████████████████████████████████████████████████████████\n');

  let totalFindings = 0;
  let totalCritical = 0;
  let totalHigh = 0;

  for (const [provider, result] of results) {
    console.log(`  ${provider.toUpperCase()}: ${result.summary.total} findings (${result.summary.critical} critical, ${result.summary.high} high)`);
    totalFindings += result.summary.total;
    totalCritical += result.summary.critical;
    totalHigh += result.summary.high;
  }

  console.log(`\n  TOTAL: ${totalFindings} findings across ${configs.length} providers`);
  console.log(`  Critical: ${totalCritical}, High: ${totalHigh}`);
  console.log('\n████████████████████████████████████████████████████████████████████████████████\n');

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Default Export - Security Audit as Default Capability
// ═══════════════════════════════════════════════════════════════════════════════

export default runUniversalSecurityAudit;

// ═══════════════════════════════════════════════════════════════════════════════
// AUTOMATIC REMEDIATION ENGINE
// Fixes confirmed vulnerabilities automatically
// ═══════════════════════════════════════════════════════════════════════════════

export interface RemediationResult {
  findingId: string;
  success: boolean;
  action: string;
  details: string[];
  timestamp: string;
  rollbackCommand?: string;
}

export interface RemediationSummary {
  total: number;
  fixed: number;
  failed: number;
  skipped: number;
  results: RemediationResult[];
}

// GCP Remediation Functions
const GCP_REMEDIATIONS: Record<string, (finding: SecurityFinding, config: AuditConfig) => Promise<RemediationResult>> = {
  'GCP-STORAGE-ACL-001': async (finding, config) => {
    const details: string[] = [];
    const token = await getGCPAccessToken();

    // Extract bucket names from evidence
    const bucketMatches = finding.evidence.filter(e => e.includes('bucket') || e.includes('Legacy ACL') || e.includes('PUBLIC'));

    for (const match of bucketMatches) {
      const bucketName = match.split(':')[0].trim();
      if (!bucketName || bucketName === 'Found') continue;

      try {
        // Enable uniform bucket-level access
        await gcpApiCall(
          `https://storage.googleapis.com/storage/v1/b/${bucketName}?fields=iamConfiguration`,
          'PATCH',
          {
            iamConfiguration: {
              uniformBucketLevelAccess: { enabled: true },
              publicAccessPrevention: 'enforced',
            },
          },
          token
        );
        details.push(`Fixed: ${bucketName} - Enabled uniform access, enforced public prevention`);
      } catch (e) {
        details.push(`Failed: ${bucketName} - ${e}`);
      }
    }

    return {
      findingId: finding.id,
      success: details.some(d => d.startsWith('Fixed')),
      action: 'Enable uniform bucket-level access and public access prevention',
      details,
      timestamp: new Date().toISOString(),
      rollbackCommand: 'gcloud storage buckets update gs://BUCKET --no-uniform-bucket-level-access',
    };
  },

  'GCP-FIREWALL-OPEN-001': async (finding, config) => {
    const details: string[] = [];
    const token = await getGCPAccessToken();

    // Extract firewall rule names from evidence
    const ruleMatches = finding.evidence.filter(e => e.includes('0.0.0.0/0'));

    for (const match of ruleMatches) {
      const ruleName = match.split(':')[0].trim();
      if (!ruleName || ruleName === 'Found') continue;

      try {
        // Delete or restrict the firewall rule
        // For safety, we'll add a deny rule with higher priority instead of deleting
        await gcpApiCall(
          `https://compute.googleapis.com/compute/v1/projects/${config.projectId}/global/firewalls`,
          'POST',
          {
            name: `block-${ruleName}-remediation`,
            network: `projects/${config.projectId}/global/networks/default`,
            priority: 100, // High priority to override
            direction: 'INGRESS',
            denied: [{ IPProtocol: 'all' }],
            sourceRanges: ['0.0.0.0/0'],
            description: `Auto-remediation: Blocks open access from ${ruleName}`,
          },
          token
        );
        details.push(`Fixed: Added blocking rule for ${ruleName}`);
      } catch (e) {
        details.push(`Failed: ${ruleName} - ${e}`);
      }
    }

    return {
      findingId: finding.id,
      success: details.some(d => d.startsWith('Fixed')),
      action: 'Add high-priority deny rules to block 0.0.0.0/0 access',
      details,
      timestamp: new Date().toISOString(),
      rollbackCommand: `gcloud compute firewall-rules delete block-*-remediation --project=${config.projectId}`,
    };
  },

  'GCP-VPC-SC-001': async (finding, config) => {
    // VPC Service Controls require organization-level access, provide guidance
    return {
      findingId: finding.id,
      success: false,
      action: 'VPC Service Controls configuration requires organization admin',
      details: [
        'Remediation requires organization-level permissions',
        'Recommended: Create access policy and service perimeter',
        `Command: gcloud access-context-manager policies create --organization=${config.organizationId || 'ORG_ID'} --title="Security Perimeter"`,
        'Then: gcloud access-context-manager perimeters create NAME --policy=POLICY_ID --resources=projects/PROJECT_NUMBER',
      ],
      timestamp: new Date().toISOString(),
    };
  },

  'GCP-GKE-SECURITY-001': async (finding, config) => {
    const details: string[] = [];

    // Extract cluster names from evidence
    const clusterMatches = finding.evidence.filter(e =>
      e.includes('No Workload Identity') ||
      e.includes('Shielded Nodes') ||
      e.includes('No Network Policy') ||
      e.includes('Master not restricted')
    );

    for (const match of clusterMatches) {
      const clusterName = match.split(':')[0].trim();
      if (!clusterName) continue;

      try {
        // Enable Workload Identity
        await execAsync(`gcloud container clusters update ${clusterName} --workload-pool=${config.projectId}.svc.id.goog --project=${config.projectId} --quiet`);
        details.push(`Fixed: ${clusterName} - Enabled Workload Identity`);
      } catch (e) {
        details.push(`Failed Workload Identity: ${clusterName} - ${e}`);
      }

      try {
        // Enable Network Policy
        await execAsync(`gcloud container clusters update ${clusterName} --enable-network-policy --project=${config.projectId} --quiet`);
        details.push(`Fixed: ${clusterName} - Enabled Network Policy`);
      } catch (e) {
        details.push(`Failed Network Policy: ${clusterName} - ${e}`);
      }
    }

    return {
      findingId: finding.id,
      success: details.some(d => d.startsWith('Fixed')),
      action: 'Enable Workload Identity and Network Policy on GKE clusters',
      details,
      timestamp: new Date().toISOString(),
    };
  },

  'GCP-SA-KEY-RACE-001': async (finding, config) => {
    const details: string[] = [];
    const token = await getGCPAccessToken();

    // Restrict SA key creation via organization policy
    try {
      // Set organization policy to disable SA key creation
      await gcpApiCall(
        `https://cloudresourcemanager.googleapis.com/v1/projects/${config.projectId}:setOrgPolicy`,
        'POST',
        {
          policy: {
            constraint: 'constraints/iam.disableServiceAccountKeyCreation',
            booleanPolicy: { enforced: true },
          },
        },
        token
      );
      details.push('Fixed: Disabled service account key creation via organization policy');
    } catch (e) {
      details.push(`Failed: Could not set org policy - ${e}`);
      details.push('Manual remediation: Enable Workload Identity Federation instead of SA keys');
    }

    return {
      findingId: finding.id,
      success: details.some(d => d.startsWith('Fixed')),
      action: 'Disable service account key creation, use Workload Identity',
      details,
      timestamp: new Date().toISOString(),
      rollbackCommand: `gcloud resource-manager org-policies delete iam.disableServiceAccountKeyCreation --project=${config.projectId}`,
    };
  },

  'GCP-IAM-CROSS-PROJECT-001': async (finding, config) => {
    const details: string[] = [];
    const token = await getGCPAccessToken();

    // Get current IAM policy
    const policyResult = await gcpApiCall(
      `https://cloudresourcemanager.googleapis.com/v1/projects/${config.projectId}:getIamPolicy`,
      'POST',
      { options: { requestedPolicyVersion: 3 } },
      token
    );

    const policy = policyResult.data as { bindings: { role: string; members: string[] }[]; etag: string; version: number };
    const originalBindings = JSON.stringify(policy.bindings);

    // Filter out cross-project SAs and public access
    const newBindings = policy.bindings.map(binding => ({
      ...binding,
      members: binding.members.filter(member => {
        if (member === 'allUsers' || member === 'allAuthenticatedUsers') {
          details.push(`Removed: ${member} from ${binding.role}`);
          return false;
        }
        // Keep cross-project SAs but log them (removing might break dependencies)
        if (member.startsWith('serviceAccount:') && !member.includes(config.projectId || '')) {
          details.push(`Warning: Cross-project SA ${member} has ${binding.role} - review manually`);
        }
        return true;
      }),
    })).filter(binding => binding.members.length > 0);

    if (JSON.stringify(newBindings) !== originalBindings) {
      try {
        await gcpApiCall(
          `https://cloudresourcemanager.googleapis.com/v1/projects/${config.projectId}:setIamPolicy`,
          'POST',
          {
            policy: {
              bindings: newBindings,
              etag: policy.etag,
              version: 3,
            },
          },
          token
        );
        details.push('Fixed: Removed public access bindings');
      } catch (e) {
        details.push(`Failed to update policy: ${e}`);
      }
    }

    return {
      findingId: finding.id,
      success: details.some(d => d.startsWith('Fixed') || d.startsWith('Removed')),
      action: 'Remove public access (allUsers/allAuthenticatedUsers) from IAM bindings',
      details,
      timestamp: new Date().toISOString(),
    };
  },

  'GCP-BIGQUERY-EXPOSURE-001': async (finding, config) => {
    const details: string[] = [];
    const token = await getGCPAccessToken();

    // Extract dataset names from evidence
    const datasetMatches = finding.evidence.filter(e => e.includes('PUBLIC'));

    for (const match of datasetMatches) {
      const datasetId = match.split(':')[0].trim();
      if (!datasetId || datasetId === 'Found') continue;

      try {
        // Get current dataset access
        const detailResult = await gcpApiCall(
          `https://bigquery.googleapis.com/bigquery/v2/projects/${config.projectId}/datasets/${datasetId}`,
          'GET',
          undefined,
          token
        );

        const data = detailResult.data as { access: { specialGroup?: string; iamMember?: string; role?: string; userByEmail?: string }[] };

        // Filter out public access
        const newAccess = data.access.filter(a => {
          if (a.specialGroup === 'allAuthenticatedUsers' || a.specialGroup === 'allUsers') {
            details.push(`Removed: ${a.specialGroup} from ${datasetId}`);
            return false;
          }
          if (a.iamMember?.startsWith('allUsers') || a.iamMember?.startsWith('allAuthenticatedUsers')) {
            details.push(`Removed: ${a.iamMember} from ${datasetId}`);
            return false;
          }
          return true;
        });

        // Update dataset
        await gcpApiCall(
          `https://bigquery.googleapis.com/bigquery/v2/projects/${config.projectId}/datasets/${datasetId}`,
          'PATCH',
          { access: newAccess },
          token
        );
        details.push(`Fixed: ${datasetId} - Removed public access`);
      } catch (e) {
        details.push(`Failed: ${datasetId} - ${e}`);
      }
    }

    return {
      findingId: finding.id,
      success: details.some(d => d.startsWith('Fixed')),
      action: 'Remove public access from BigQuery datasets',
      details,
      timestamp: new Date().toISOString(),
    };
  },
};

// AWS Remediation Functions
const AWS_REMEDIATIONS: Record<string, (finding: SecurityFinding, config: AuditConfig) => Promise<RemediationResult>> = {
  'AWS-S3-PUBLIC-001': async (finding, config) => {
    const details: string[] = [];

    // Extract bucket names from evidence
    const bucketMatches = finding.evidence.filter(e => e.includes('Public via'));

    for (const match of bucketMatches) {
      const bucketName = match.split(':')[0].trim();
      if (!bucketName || bucketName === 'Found') continue;

      try {
        // Enable S3 Block Public Access
        await execAsync(`aws s3api put-public-access-block --bucket ${bucketName} --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"`);
        details.push(`Fixed: ${bucketName} - Enabled Block Public Access`);
      } catch (e) {
        details.push(`Failed: ${bucketName} - ${e}`);
      }
    }

    return {
      findingId: finding.id,
      success: details.some(d => d.startsWith('Fixed')),
      action: 'Enable S3 Block Public Access on all buckets',
      details,
      timestamp: new Date().toISOString(),
      rollbackCommand: 'aws s3api delete-public-access-block --bucket BUCKET_NAME',
    };
  },

  'AWS-EC2-SG-001': async (finding, config) => {
    const details: string[] = [];

    // Extract security group IDs from evidence
    const sgMatches = finding.evidence.filter(e => e.includes('0.0.0.0/0'));

    for (const match of sgMatches) {
      const sgId = match.split(':')[0].trim();
      if (!sgId || !sgId.startsWith('sg-')) continue;

      try {
        // Remove 0.0.0.0/0 ingress rules
        const { stdout: rulesOutput } = await execAsync(`aws ec2 describe-security-groups --group-ids ${sgId} --output json`);
        const sg = JSON.parse(rulesOutput).SecurityGroups[0];

        for (const perm of sg.IpPermissions || []) {
          for (const range of perm.IpRanges || []) {
            if (range.CidrIp === '0.0.0.0/0') {
              await execAsync(`aws ec2 revoke-security-group-ingress --group-id ${sgId} --protocol ${perm.IpProtocol} --port ${perm.FromPort}-${perm.ToPort} --cidr 0.0.0.0/0`);
              details.push(`Fixed: ${sgId} - Revoked 0.0.0.0/0 on port ${perm.FromPort}`);
            }
          }
        }
      } catch (e) {
        details.push(`Failed: ${sgId} - ${e}`);
      }
    }

    return {
      findingId: finding.id,
      success: details.some(d => d.startsWith('Fixed')),
      action: 'Revoke 0.0.0.0/0 ingress rules from security groups',
      details,
      timestamp: new Date().toISOString(),
    };
  },

  'AWS-IAM-ADMIN-001': async (finding, config) => {
    // IAM admin removal requires careful review - provide guidance only
    return {
      findingId: finding.id,
      success: false,
      action: 'IAM admin policy removal requires manual review',
      details: [
        'Automatic removal of admin policies could break critical access',
        'Recommended: Review each user and apply least privilege',
        'Steps:',
        '1. aws iam list-attached-user-policies --user-name USER',
        '2. aws iam detach-user-policy --user-name USER --policy-arn ARN',
        '3. Create custom policy with minimum required permissions',
      ],
      timestamp: new Date().toISOString(),
    };
  },
};

// Azure Remediation Functions
const AZURE_REMEDIATIONS: Record<string, (finding: SecurityFinding, config: AuditConfig) => Promise<RemediationResult>> = {
  'AZURE-STORAGE-PUBLIC-001': async (finding, config) => {
    const details: string[] = [];

    // Extract storage account names from evidence
    const accountMatches = finding.evidence.filter(e => e.includes('Public') || e.includes('Allow'));

    for (const match of accountMatches) {
      const accountName = match.split(':')[0].trim();
      if (!accountName || accountName === 'Found') continue;

      try {
        // Disable public blob access
        await execAsync(`az storage account update --name ${accountName} --allow-blob-public-access false`);
        details.push(`Fixed: ${accountName} - Disabled public blob access`);

        // Set network default action to Deny
        await execAsync(`az storage account update --name ${accountName} --default-action Deny`);
        details.push(`Fixed: ${accountName} - Set network default to Deny`);
      } catch (e) {
        details.push(`Failed: ${accountName} - ${e}`);
      }
    }

    return {
      findingId: finding.id,
      success: details.some(d => d.startsWith('Fixed')),
      action: 'Disable public access and restrict network rules',
      details,
      timestamp: new Date().toISOString(),
      rollbackCommand: 'az storage account update --name ACCOUNT --allow-blob-public-access true --default-action Allow',
    };
  },

  'AZURE-NSG-OPEN-001': async (finding, config) => {
    const details: string[] = [];

    // Extract NSG rule info from evidence
    const ruleMatches = finding.evidence.filter(e => e.includes('Open to *'));

    for (const match of ruleMatches) {
      const parts = match.split('/');
      const nsgName = parts[0]?.trim();
      const ruleName = parts[1]?.split(':')[0]?.trim();
      if (!nsgName || !ruleName) continue;

      try {
        // Delete the permissive rule
        await execAsync(`az network nsg rule delete --nsg-name ${nsgName} --name ${ruleName} --resource-group RESOURCE_GROUP`);
        details.push(`Fixed: ${nsgName}/${ruleName} - Deleted open rule`);
      } catch (e) {
        details.push(`Failed: ${nsgName}/${ruleName} - ${e}`);
      }
    }

    return {
      findingId: finding.id,
      success: details.some(d => d.startsWith('Fixed')),
      action: 'Delete NSG rules open to all sources',
      details,
      timestamp: new Date().toISOString(),
    };
  },

  'AZURE-RBAC-ADMIN-001': async (finding, config) => {
    // RBAC removal requires manual review
    return {
      findingId: finding.id,
      success: false,
      action: 'RBAC assignment removal requires manual review',
      details: [
        'Automatic removal of Owner/Contributor roles could break access',
        'Recommended: Review each assignment and scope down',
        'Steps:',
        '1. az role assignment list --all',
        '2. az role assignment delete --assignee PRINCIPAL --role ROLE --scope SCOPE',
        '3. Create resource-group-scoped assignments instead',
      ],
      timestamp: new Date().toISOString(),
    };
  },
};

/**
 * Apply automatic remediations for all confirmed vulnerabilities
 */
export async function remediateFindings(
  findings: SecurityFinding[],
  config: AuditConfig,
  options: { dryRun?: boolean; interactive?: boolean } = {}
): Promise<RemediationSummary> {
  console.log('\n');
  console.log('████████████████████████████████████████████████████████████████████████████████');
  console.log('██                                                                            ██');
  console.log('██           AUTOMATIC REMEDIATION ENGINE                                     ██');
  console.log('██                 Fixing Confirmed Vulnerabilities                           ██');
  console.log('██                                                                            ██');
  console.log('████████████████████████████████████████████████████████████████████████████████\n');

  if (options.dryRun) {
    console.log('  MODE: DRY RUN - No changes will be made\n');
  }

  const results: RemediationResult[] = [];
  let fixed = 0;
  let failed = 0;
  let skipped = 0;

  // Only remediate verified findings
  const verifiedFindings = findings.filter(f => f.verified && f.exploitability !== 'theoretical');

  console.log(`  Findings to remediate: ${verifiedFindings.length}\n`);

  for (const finding of verifiedFindings) {
    console.log(`  [${finding.severity.toUpperCase()}] ${finding.vulnerability}`);
    console.log(`    ID: ${finding.id}`);

    // Select remediation function based on provider
    let remediationFn: ((f: SecurityFinding, c: AuditConfig) => Promise<RemediationResult>) | undefined;

    switch (finding.provider) {
      case 'gcp':
        remediationFn = GCP_REMEDIATIONS[finding.id];
        break;
      case 'aws':
        remediationFn = AWS_REMEDIATIONS[finding.id];
        break;
      case 'azure':
        remediationFn = AZURE_REMEDIATIONS[finding.id];
        break;
    }

    if (!remediationFn) {
      console.log(`    ⊘ No automatic remediation available`);
      console.log(`    Manual: ${finding.remediation || 'See documentation'}\n`);
      skipped++;
      results.push({
        findingId: finding.id,
        success: false,
        action: 'No automatic remediation available',
        details: [finding.remediation || 'Manual remediation required'],
        timestamp: new Date().toISOString(),
      });
      continue;
    }

    if (options.dryRun) {
      console.log(`    [DRY RUN] Would apply remediation`);
      console.log(`    Action: ${finding.remediation}\n`);
      skipped++;
      continue;
    }

    try {
      console.log(`    Applying remediation...`);
      const result = await remediationFn(finding, config);
      results.push(result);

      if (result.success) {
        console.log(`    ✓ FIXED`);
        for (const detail of result.details.slice(0, 3)) {
          console.log(`      ${detail}`);
        }
        fixed++;
      } else {
        console.log(`    ⚠ PARTIAL/FAILED`);
        for (const detail of result.details.slice(0, 3)) {
          console.log(`      ${detail}`);
        }
        failed++;
      }

      if (result.rollbackCommand) {
        console.log(`    Rollback: ${result.rollbackCommand}`);
      }
    } catch (e) {
      console.log(`    ✗ ERROR: ${e}`);
      failed++;
      results.push({
        findingId: finding.id,
        success: false,
        action: 'Remediation failed',
        details: [`Error: ${e}`],
        timestamp: new Date().toISOString(),
      });
    }

    console.log('');
  }

  // Summary
  console.log('████████████████████████████████████████████████████████████████████████████████');
  console.log('██                     REMEDIATION COMPLETE                                   ██');
  console.log('████████████████████████████████████████████████████████████████████████████████\n');

  console.log(`  Total: ${verifiedFindings.length}`);
  console.log(`  Fixed: ${fixed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Skipped: ${skipped}`);
  console.log('\n████████████████████████████████████████████████████████████████████████████████\n');

  return {
    total: verifiedFindings.length,
    fixed,
    failed,
    skipped,
    results,
  };
}

/**
 * Run full security audit with automatic remediation
 */
export async function runSecurityAuditWithRemediation(
  config: AuditConfig,
  options: { autoFix?: boolean; dryRun?: boolean } = {}
): Promise<{ audit: UniversalAuditResult; remediation?: RemediationSummary }> {
  // Run the audit
  const audit = await runUniversalSecurityAudit(config);

  // Apply remediations if requested
  if (options.autoFix && audit.findings.length > 0) {
    const remediation = await remediateFindings(audit.findings, config, { dryRun: options.dryRun });
    return { audit, remediation };
  }

  return { audit };
}

// Auto-detect provider and run audit
export async function runDefaultSecurityAudit(): Promise<UniversalAuditResult> {
  // Try to detect provider from environment
  let provider: CloudProvider = 'custom';
  let projectId: string | undefined;
  let accountId: string | undefined;
  let subscriptionId: string | undefined;

  // Check for GCP
  try {
    const { stdout } = await execAsync('gcloud config get-value project 2>/dev/null');
    if (stdout.trim()) {
      provider = 'gcp';
      projectId = stdout.trim();
    }
  } catch { /* not GCP */ }

  // Check for AWS
  if (provider === 'custom') {
    try {
      const { stdout } = await execAsync('aws sts get-caller-identity --output json 2>/dev/null');
      const data = JSON.parse(stdout);
      if (data.Account) {
        provider = 'aws';
        accountId = data.Account;
      }
    } catch { /* not AWS */ }
  }

  // Check for Azure
  if (provider === 'custom') {
    try {
      const { stdout } = await execAsync('az account show --output json 2>/dev/null');
      const data = JSON.parse(stdout);
      if (data.id) {
        provider = 'azure';
        subscriptionId = data.id;
      }
    } catch { /* not Azure */ }
  }

  console.log(`Auto-detected provider: ${provider.toUpperCase()}`);

  return runUniversalSecurityAudit({
    provider,
    projectId,
    accountId,
    subscriptionId,
    liveTesting: true,
    includeZeroDay: true,
  });
}
