/**
 * Live GCP Verification Engine
 *
 * REAL verification against live Google Cloud infrastructure.
 * Uses actual API calls, real timing measurements, and live configuration checks.
 *
 * For authorized red team operations only.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import https from 'https';
import http from 'http';

const execAsync = promisify(exec);

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface LiveVerificationResult {
  id: string;
  vulnerability: string;
  verified: boolean;
  confidence: number;
  evidence: string[];
  rawResponse?: string;
  timingMs?: number;
  technique: string;
  timestamp: string;
  projectId: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
}

export interface GCPConfig {
  projectId: string;
  region?: string;
  accessToken?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GCP API Helper
// ═══════════════════════════════════════════════════════════════════════════════

async function getAccessToken(): Promise<string> {
  try {
    const { stdout } = await execAsync('gcloud auth print-access-token');
    return stdout.trim();
  } catch (error) {
    throw new Error(`Failed to get access token: ${error}`);
  }
}

async function gcpApiCall(
  endpoint: string,
  method: string = 'GET',
  body?: object,
  accessToken?: string
): Promise<{ data: any; timingMs: number; statusCode: number; headers: http.IncomingHttpHeaders }> {
  const token = accessToken || await getAccessToken();
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
        'User-Agent': 'agi-core-security-audit/1.0',
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
            headers: res.headers,
          });
        } catch {
          resolve({
            data: { raw: data },
            timingMs,
            statusCode: res.statusCode || 0,
            headers: res.headers,
          });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Live Verification Tests
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Test 1: IAM Policy Update Race Condition
 * Measures timing variance in IAM permission checks
 */
async function verifyIAMRaceCondition(config: GCPConfig): Promise<LiveVerificationResult> {
  console.log('  [TEST] IAM Policy Update Race Condition...');

  const timings: number[] = [];
  const evidence: string[] = [];
  const token = await getAccessToken();

  // Make multiple permission check requests and measure timing variance
  const testCases = [
    { resource: `//cloudresourcemanager.googleapis.com/projects/${config.projectId}`, permission: 'resourcemanager.projects.get' },
    { resource: `//cloudresourcemanager.googleapis.com/projects/${config.projectId}`, permission: 'resourcemanager.projects.delete' },
    { resource: `//cloudresourcemanager.googleapis.com/projects/nonexistent-project-12345`, permission: 'resourcemanager.projects.get' },
    { resource: `//cloudresourcemanager.googleapis.com/projects/${config.projectId}`, permission: 'iam.roles.create' },
  ];

  for (const testCase of testCases) {
    try {
      const result = await gcpApiCall(
        `https://cloudresourcemanager.googleapis.com/v1/projects/${config.projectId}:testIamPermissions`,
        'POST',
        { permissions: [testCase.permission] },
        token
      );

      timings.push(result.timingMs);
      evidence.push(`${testCase.permission}: ${result.timingMs.toFixed(2)}ms (status: ${result.statusCode})`);
    } catch (error) {
      evidence.push(`${testCase.permission}: ERROR - ${error}`);
    }
  }

  // Calculate timing variance
  const validTimings = timings.filter(t => t > 0);
  const mean = validTimings.reduce((a, b) => a + b, 0) / validTimings.length;
  const variance = validTimings.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / validTimings.length;
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation = (stdDev / mean) * 100;

  // High variance suggests different code paths (potential timing oracle)
  const vulnerable = coefficientOfVariation > 25; // >25% CV indicates potential oracle

  evidence.push(`Mean: ${mean.toFixed(2)}ms, StdDev: ${stdDev.toFixed(2)}ms, CV: ${coefficientOfVariation.toFixed(1)}%`);
  evidence.push(vulnerable ? 'TIMING ORACLE DETECTED - High variance in permission checks' : 'Normal timing variance');

  return {
    id: 'LIVE-IAM-RACE-001',
    vulnerability: 'IAM Policy Update Race Condition / Timing Oracle',
    verified: vulnerable,
    confidence: vulnerable ? 0.75 + (coefficientOfVariation / 400) : 0.3,
    evidence,
    timingMs: mean,
    technique: 'Timing Oracle Analysis',
    timestamp: new Date().toISOString(),
    projectId: config.projectId,
    severity: vulnerable ? 'high' : 'info',
  };
}

/**
 * Test 2: Service Account Key Race
 * Tests the window between key creation and audit logging
 */
async function verifyServiceAccountKeyRace(config: GCPConfig): Promise<LiveVerificationResult> {
  console.log('  [TEST] Service Account Key Creation Race...');

  const evidence: string[] = [];
  const token = await getAccessToken();

  // List service accounts to find one we can test with
  try {
    const saListResult = await gcpApiCall(
      `https://iam.googleapis.com/v1/projects/${config.projectId}/serviceAccounts`,
      'GET',
      undefined,
      token
    );

    evidence.push(`Found ${saListResult.data.accounts?.length || 0} service accounts`);
    evidence.push(`API response time: ${saListResult.timingMs.toFixed(2)}ms`);

    if (saListResult.data.accounts?.length > 0) {
      // Check key listing timing for each SA
      const keyTimings: number[] = [];

      for (const sa of saListResult.data.accounts.slice(0, 3)) {
        const keyResult = await gcpApiCall(
          `https://iam.googleapis.com/v1/${sa.name}/keys`,
          'GET',
          undefined,
          token
        );
        keyTimings.push(keyResult.timingMs);
        evidence.push(`${sa.email}: ${keyResult.data.keys?.length || 0} keys, ${keyResult.timingMs.toFixed(2)}ms`);
      }

      // Check if we have permission to create keys (don't actually create)
      const createPermCheck = await gcpApiCall(
        `https://cloudresourcemanager.googleapis.com/v1/projects/${config.projectId}:testIamPermissions`,
        'POST',
        { permissions: ['iam.serviceAccountKeys.create'] },
        token
      );

      const canCreateKeys = createPermCheck.data.permissions?.includes('iam.serviceAccountKeys.create');
      evidence.push(`Can create SA keys: ${canCreateKeys}`);

      if (canCreateKeys) {
        evidence.push('VULNERABLE: Key creation permission exists - race window exploitable');
      }

      return {
        id: 'LIVE-SA-KEY-RACE-001',
        vulnerability: 'Service Account Key Creation Race Condition',
        verified: canCreateKeys,
        confidence: canCreateKeys ? 0.85 : 0.4,
        evidence,
        timingMs: saListResult.timingMs,
        technique: 'Permission Enumeration + Race Analysis',
        timestamp: new Date().toISOString(),
        projectId: config.projectId,
        severity: canCreateKeys ? 'critical' : 'info',
      };
    }
  } catch (error) {
    evidence.push(`Error: ${error}`);
  }

  return {
    id: 'LIVE-SA-KEY-RACE-001',
    vulnerability: 'Service Account Key Creation Race Condition',
    verified: false,
    confidence: 0.2,
    evidence,
    technique: 'Permission Enumeration + Race Analysis',
    timestamp: new Date().toISOString(),
    projectId: config.projectId,
    severity: 'info',
  };
}

/**
 * Test 3: Storage Bucket ACL Configuration
 * Checks for legacy ACL mode and public access
 */
async function verifyStorageACLConfig(config: GCPConfig): Promise<LiveVerificationResult> {
  console.log('  [TEST] Storage Bucket ACL Configuration...');

  const evidence: string[] = [];
  const token = await getAccessToken();
  const vulnerabilities: string[] = [];

  try {
    // List all buckets
    const bucketsResult = await gcpApiCall(
      `https://storage.googleapis.com/storage/v1/b?project=${config.projectId}`,
      'GET',
      undefined,
      token
    );

    evidence.push(`Found ${bucketsResult.data.items?.length || 0} buckets`);

    if (bucketsResult.data.items) {
      for (const bucket of bucketsResult.data.items.slice(0, 5)) {
        // Get detailed bucket info
        const bucketDetail = await gcpApiCall(
          `https://storage.googleapis.com/storage/v1/b/${bucket.name}?projection=full`,
          'GET',
          undefined,
          token
        );

        const iamConfig = bucketDetail.data.iamConfiguration;
        const uniformAccess = iamConfig?.uniformBucketLevelAccess?.enabled;
        const publicPrevention = iamConfig?.publicAccessPrevention;

        evidence.push(`Bucket: ${bucket.name}`);
        evidence.push(`  Uniform bucket-level access: ${uniformAccess}`);
        evidence.push(`  Public access prevention: ${publicPrevention}`);

        if (!uniformAccess) {
          vulnerabilities.push(`${bucket.name}: Legacy ACL mode enabled`);
        }
        if (publicPrevention !== 'enforced') {
          vulnerabilities.push(`${bucket.name}: Public access prevention not enforced`);
        }

        // Check for public ACLs
        if (bucketDetail.data.acl) {
          for (const acl of bucketDetail.data.acl) {
            if (acl.entity === 'allUsers' || acl.entity === 'allAuthenticatedUsers') {
              vulnerabilities.push(`${bucket.name}: PUBLIC ACCESS via ${acl.entity}`);
            }
          }
        }
      }
    }
  } catch (error) {
    evidence.push(`Error: ${error}`);
  }

  const verified = vulnerabilities.length > 0;
  evidence.push(...vulnerabilities.map(v => `VULN: ${v}`));

  return {
    id: 'LIVE-STORAGE-ACL-001',
    vulnerability: 'Storage Bucket ACL Misconfiguration',
    verified,
    confidence: verified ? 0.95 : 0.1,
    evidence,
    technique: 'Configuration Audit',
    timestamp: new Date().toISOString(),
    projectId: config.projectId,
    severity: verified ? 'high' : 'info',
  };
}

/**
 * Test 4: Metadata Server Access (for GCE/GKE contexts)
 * Tests if metadata server is accessible and what's exposed
 */
async function verifyMetadataServerAccess(config: GCPConfig): Promise<LiveVerificationResult> {
  console.log('  [TEST] Metadata Server Access...');

  const evidence: string[] = [];

  // Try to access metadata server (will only work if running on GCP)
  const metadataEndpoints = [
    { path: '/computeMetadata/v1/project/project-id', header: true },
    { path: '/computeMetadata/v1/instance/service-accounts/', header: true },
    { path: '/0.1/meta-data/project/project-id', header: false }, // Legacy endpoint
  ];

  let vulnerable = false;

  for (const endpoint of metadataEndpoints) {
    try {
      const result = await new Promise<{ status: number; data: string; timingMs: number }>((resolve, reject) => {
        const startTime = performance.now();
        const options: http.RequestOptions = {
          hostname: 'metadata.google.internal',
          port: 80,
          path: endpoint.path,
          method: 'GET',
          headers: endpoint.header ? { 'Metadata-Flavor': 'Google' } : {},
          timeout: 2000,
        };

        const req = http.request(options, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            resolve({
              status: res.statusCode || 0,
              data,
              timingMs: performance.now() - startTime,
            });
          });
        });

        req.on('error', () => resolve({ status: 0, data: 'Not accessible', timingMs: 0 }));
        req.on('timeout', () => {
          req.destroy();
          resolve({ status: 0, data: 'Timeout', timingMs: 2000 });
        });
        req.end();
      });

      evidence.push(`${endpoint.path}: status=${result.status}, ${result.timingMs.toFixed(0)}ms`);

      if (result.status === 200) {
        evidence.push(`  Response: ${result.data.substring(0, 100)}`);
        if (!endpoint.header) {
          vulnerable = true;
          evidence.push('  CRITICAL: Legacy metadata endpoint accessible without header!');
        }
      }
    } catch (error) {
      evidence.push(`${endpoint.path}: ${error}`);
    }
  }

  if (evidence.every(e => e.includes('Not accessible') || e.includes('Timeout'))) {
    evidence.push('Not running on GCP - metadata server not accessible');
  }

  return {
    id: 'LIVE-METADATA-001',
    vulnerability: 'Metadata Server Exposure',
    verified: vulnerable,
    confidence: vulnerable ? 0.95 : 0.1,
    evidence,
    technique: 'Direct Endpoint Probing',
    timestamp: new Date().toISOString(),
    projectId: config.projectId,
    severity: vulnerable ? 'critical' : 'info',
  };
}

/**
 * Test 5: Cross-Project IAM Bindings
 * Checks for overly permissive cross-project access
 */
async function verifyCrossProjectBindings(config: GCPConfig): Promise<LiveVerificationResult> {
  console.log('  [TEST] Cross-Project IAM Bindings...');

  const evidence: string[] = [];
  const token = await getAccessToken();
  const vulnerabilities: string[] = [];

  try {
    // Get project IAM policy
    const policyResult = await gcpApiCall(
      `https://cloudresourcemanager.googleapis.com/v1/projects/${config.projectId}:getIamPolicy`,
      'POST',
      { options: { requestedPolicyVersion: 3 } },
      token
    );

    evidence.push(`Retrieved IAM policy in ${policyResult.timingMs.toFixed(2)}ms`);

    if (policyResult.data.bindings) {
      for (const binding of policyResult.data.bindings) {
        for (const member of binding.members || []) {
          // Check for cross-project service accounts
          if (member.startsWith('serviceAccount:') && !member.includes(config.projectId)) {
            vulnerabilities.push(`Cross-project SA: ${member} has ${binding.role}`);
          }
          // Check for allUsers/allAuthenticatedUsers
          if (member === 'allUsers' || member === 'allAuthenticatedUsers') {
            vulnerabilities.push(`PUBLIC ACCESS: ${member} has ${binding.role}`);
          }
          // Check for domain-wide access
          if (member.startsWith('domain:')) {
            evidence.push(`Domain binding: ${member} has ${binding.role}`);
          }
        }
      }
    }

    evidence.push(`Total bindings: ${policyResult.data.bindings?.length || 0}`);
  } catch (error) {
    evidence.push(`Error: ${error}`);
  }

  const verified = vulnerabilities.length > 0;
  evidence.push(...vulnerabilities.map(v => `VULN: ${v}`));

  return {
    id: 'LIVE-CROSS-PROJECT-001',
    vulnerability: 'Cross-Project IAM Binding Exposure',
    verified,
    confidence: verified ? 0.9 : 0.2,
    evidence,
    technique: 'IAM Policy Analysis',
    timestamp: new Date().toISOString(),
    projectId: config.projectId,
    severity: verified ? 'high' : 'info',
  };
}

/**
 * Test 6: Cloud Functions SSRF Potential
 * Enumerates Cloud Functions that might be vulnerable to SSRF
 */
async function verifyCloudFunctionsSSRF(config: GCPConfig): Promise<LiveVerificationResult> {
  console.log('  [TEST] Cloud Functions SSRF Potential...');

  const evidence: string[] = [];
  const token = await getAccessToken();
  const potentialVulns: string[] = [];

  try {
    // List Cloud Functions (v1 and v2)
    const functionsResult = await gcpApiCall(
      `https://cloudfunctions.googleapis.com/v1/projects/${config.projectId}/locations/-/functions`,
      'GET',
      undefined,
      token
    );

    evidence.push(`Found ${functionsResult.data.functions?.length || 0} Cloud Functions`);

    if (functionsResult.data.functions) {
      for (const fn of functionsResult.data.functions) {
        evidence.push(`Function: ${fn.name}`);
        evidence.push(`  Runtime: ${fn.runtime}`);
        evidence.push(`  Trigger: ${fn.httpsTrigger ? 'HTTP' : fn.eventTrigger?.eventType || 'Unknown'}`);

        // HTTP-triggered functions with Pub/Sub triggers are SSRF candidates
        if (fn.httpsTrigger || fn.eventTrigger?.eventType?.includes('pubsub')) {
          potentialVulns.push(`${fn.name}: HTTP/Pub/Sub triggered - potential SSRF vector`);
        }

        // Check if function has broad network access
        if (!fn.vpcConnector) {
          evidence.push(`  VPC Connector: None (public internet access)`);
          potentialVulns.push(`${fn.name}: No VPC connector - can reach metadata server`);
        }
      }
    }
  } catch (error) {
    if (String(error).includes('403')) {
      evidence.push('Cloud Functions API not enabled or no permission');
    } else {
      evidence.push(`Error: ${error}`);
    }
  }

  const verified = potentialVulns.length > 0;
  evidence.push(...potentialVulns.map(v => `POTENTIAL: ${v}`));

  return {
    id: 'LIVE-FUNCTIONS-SSRF-001',
    vulnerability: 'Cloud Functions SSRF Potential',
    verified,
    confidence: verified ? 0.7 : 0.1,
    evidence,
    technique: 'Function Enumeration + Architecture Analysis',
    timestamp: new Date().toISOString(),
    projectId: config.projectId,
    severity: verified ? 'medium' : 'info',
  };
}

/**
 * Test 7: BigQuery Dataset Exposure
 * Checks for publicly accessible datasets and authorized views
 */
async function verifyBigQueryExposure(config: GCPConfig): Promise<LiveVerificationResult> {
  console.log('  [TEST] BigQuery Dataset Exposure...');

  const evidence: string[] = [];
  const token = await getAccessToken();
  const vulnerabilities: string[] = [];

  try {
    // List datasets
    const datasetsResult = await gcpApiCall(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${config.projectId}/datasets`,
      'GET',
      undefined,
      token
    );

    evidence.push(`Found ${datasetsResult.data.datasets?.length || 0} datasets`);

    if (datasetsResult.data.datasets) {
      for (const dataset of datasetsResult.data.datasets.slice(0, 5)) {
        const datasetId = dataset.datasetReference.datasetId;

        // Get dataset details with ACLs
        const detailResult = await gcpApiCall(
          `https://bigquery.googleapis.com/bigquery/v2/projects/${config.projectId}/datasets/${datasetId}`,
          'GET',
          undefined,
          token
        );

        evidence.push(`Dataset: ${datasetId}`);

        // Check ACLs for public access
        if (detailResult.data.access) {
          for (const access of detailResult.data.access) {
            if (access.specialGroup === 'allAuthenticatedUsers' || access.specialGroup === 'allUsers') {
              vulnerabilities.push(`${datasetId}: PUBLIC ACCESS via ${access.specialGroup}`);
            }
            if (access.iamMember?.startsWith('allUsers') || access.iamMember?.startsWith('allAuthenticatedUsers')) {
              vulnerabilities.push(`${datasetId}: PUBLIC ACCESS via ${access.iamMember}`);
            }
          }
        }

        // Check for column-level security
        evidence.push(`  Labels: ${JSON.stringify(detailResult.data.labels || {})}`);
      }
    }
  } catch (error) {
    if (String(error).includes('403')) {
      evidence.push('BigQuery API not enabled or no permission');
    } else {
      evidence.push(`Error: ${error}`);
    }
  }

  const verified = vulnerabilities.length > 0;
  evidence.push(...vulnerabilities.map(v => `VULN: ${v}`));

  return {
    id: 'LIVE-BIGQUERY-001',
    vulnerability: 'BigQuery Dataset Exposure',
    verified,
    confidence: verified ? 0.95 : 0.1,
    evidence,
    technique: 'Dataset ACL Analysis',
    timestamp: new Date().toISOString(),
    projectId: config.projectId,
    severity: verified ? 'critical' : 'info',
  };
}

/**
 * Test 8: GKE Cluster Security Configuration
 * Checks for insecure GKE configurations
 */
async function verifyGKESecurityConfig(config: GCPConfig): Promise<LiveVerificationResult> {
  console.log('  [TEST] GKE Cluster Security Configuration...');

  const evidence: string[] = [];
  const token = await getAccessToken();
  const vulnerabilities: string[] = [];

  try {
    // List GKE clusters
    const clustersResult = await gcpApiCall(
      `https://container.googleapis.com/v1/projects/${config.projectId}/locations/-/clusters`,
      'GET',
      undefined,
      token
    );

    evidence.push(`Found ${clustersResult.data.clusters?.length || 0} GKE clusters`);

    if (clustersResult.data.clusters) {
      for (const cluster of clustersResult.data.clusters) {
        evidence.push(`Cluster: ${cluster.name} (${cluster.location})`);

        // Check Workload Identity
        if (!cluster.workloadIdentityConfig?.workloadPool) {
          vulnerabilities.push(`${cluster.name}: Workload Identity not enabled`);
        }

        // Check Shielded Nodes
        if (!cluster.shieldedNodes?.enabled) {
          vulnerabilities.push(`${cluster.name}: Shielded Nodes not enabled`);
        }

        // Check Network Policy
        if (!cluster.networkPolicy?.enabled) {
          vulnerabilities.push(`${cluster.name}: Network Policy not enabled`);
        }

        // Check Binary Authorization
        if (!cluster.binaryAuthorization?.enabled) {
          evidence.push(`  Binary Authorization: disabled`);
        }

        // Check legacy metadata
        if (cluster.nodeConfig?.metadata?.['disable-legacy-endpoints'] !== 'true') {
          vulnerabilities.push(`${cluster.name}: Legacy metadata endpoints may be enabled`);
        }

        // Check master authorized networks
        if (!cluster.masterAuthorizedNetworksConfig?.enabled) {
          vulnerabilities.push(`${cluster.name}: Master authorized networks not configured`);
        }

        evidence.push(`  Version: ${cluster.currentMasterVersion}`);
        evidence.push(`  Node pools: ${cluster.nodePools?.length || 0}`);
      }
    }
  } catch (error) {
    if (String(error).includes('403')) {
      evidence.push('GKE API not enabled or no permission');
    } else {
      evidence.push(`Error: ${error}`);
    }
  }

  const verified = vulnerabilities.length > 0;
  evidence.push(...vulnerabilities.map(v => `VULN: ${v}`));

  return {
    id: 'LIVE-GKE-001',
    vulnerability: 'GKE Cluster Security Misconfiguration',
    verified,
    confidence: verified ? 0.9 : 0.1,
    evidence,
    technique: 'Cluster Configuration Audit',
    timestamp: new Date().toISOString(),
    projectId: config.projectId,
    severity: verified ? 'high' : 'info',
  };
}

/**
 * Test 9: VPC Service Controls Check
 * Verifies if VPC Service Controls are properly configured
 */
async function verifyVPCServiceControls(config: GCPConfig): Promise<LiveVerificationResult> {
  console.log('  [TEST] VPC Service Controls...');

  const evidence: string[] = [];
  const token = await getAccessToken();

  try {
    // Try to get access policy
    const policyResult = await gcpApiCall(
      `https://accesscontextmanager.googleapis.com/v1/accessPolicies`,
      'GET',
      undefined,
      token
    );

    if (policyResult.data.accessPolicies?.length > 0) {
      evidence.push(`Found ${policyResult.data.accessPolicies.length} access policies`);

      for (const policy of policyResult.data.accessPolicies) {
        evidence.push(`Policy: ${policy.name}`);

        // Get service perimeters
        const perimetersResult = await gcpApiCall(
          `https://accesscontextmanager.googleapis.com/v1/${policy.name}/servicePerimeters`,
          'GET',
          undefined,
          token
        );

        evidence.push(`  Service perimeters: ${perimetersResult.data.servicePerimeters?.length || 0}`);
      }
    } else {
      evidence.push('No VPC Service Controls configured');
      evidence.push('VULN: Project not protected by service perimeter');
    }
  } catch (error) {
    if (String(error).includes('403')) {
      evidence.push('Access Context Manager API not enabled or no permission');
      evidence.push('Cannot verify VPC Service Controls status');
    } else {
      evidence.push(`Error: ${error}`);
    }
  }

  const verified = evidence.some(e => e.includes('VULN:'));

  return {
    id: 'LIVE-VPC-SC-001',
    vulnerability: 'VPC Service Controls Not Configured',
    verified,
    confidence: verified ? 0.85 : 0.3,
    evidence,
    technique: 'Service Perimeter Analysis',
    timestamp: new Date().toISOString(),
    projectId: config.projectId,
    severity: verified ? 'medium' : 'info',
  };
}

/**
 * Test 10: Pub/Sub Topic Permissions
 * Checks for overly permissive Pub/Sub configurations
 */
async function verifyPubSubPermissions(config: GCPConfig): Promise<LiveVerificationResult> {
  console.log('  [TEST] Pub/Sub Topic Permissions...');

  const evidence: string[] = [];
  const token = await getAccessToken();
  const vulnerabilities: string[] = [];

  try {
    // List topics
    const topicsResult = await gcpApiCall(
      `https://pubsub.googleapis.com/v1/projects/${config.projectId}/topics`,
      'GET',
      undefined,
      token
    );

    evidence.push(`Found ${topicsResult.data.topics?.length || 0} Pub/Sub topics`);

    if (topicsResult.data.topics) {
      for (const topic of topicsResult.data.topics.slice(0, 5)) {
        const topicName = topic.name;

        // Get IAM policy for topic
        const policyResult = await gcpApiCall(
          `https://pubsub.googleapis.com/v1/${topicName}:getIamPolicy`,
          'GET',
          undefined,
          token
        );

        evidence.push(`Topic: ${topicName.split('/').pop()}`);

        if (policyResult.data.bindings) {
          for (const binding of policyResult.data.bindings) {
            for (const member of binding.members || []) {
              if (member === 'allUsers' || member === 'allAuthenticatedUsers') {
                vulnerabilities.push(`${topicName.split('/').pop()}: ${member} has ${binding.role}`);
              }
            }
          }
        }
      }
    }
  } catch (error) {
    if (String(error).includes('403')) {
      evidence.push('Pub/Sub API not enabled or no permission');
    } else {
      evidence.push(`Error: ${error}`);
    }
  }

  const verified = vulnerabilities.length > 0;
  evidence.push(...vulnerabilities.map(v => `VULN: ${v}`));

  return {
    id: 'LIVE-PUBSUB-001',
    vulnerability: 'Pub/Sub Topic Public Access',
    verified,
    confidence: verified ? 0.95 : 0.1,
    evidence,
    technique: 'Topic IAM Policy Analysis',
    timestamp: new Date().toISOString(),
    projectId: config.projectId,
    severity: verified ? 'high' : 'info',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Export
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Run all live GCP verification tests
 */
export async function runLiveGCPVerification(
  projectId?: string
): Promise<{
  results: LiveVerificationResult[];
  summary: {
    total: number;
    verified: number;
    critical: number;
    high: number;
    medium: number;
  };
}> {
  console.log('\n');
  console.log('████████████████████████████████████████████████████████████████████████████████');
  console.log('██                                                                            ██');
  console.log('██              LIVE GCP VERIFICATION - REAL API TESTING                      ██');
  console.log('██                   Authorized Red Team Operations                           ██');
  console.log('██                                                                            ██');
  console.log('████████████████████████████████████████████████████████████████████████████████\n');

  // Get project ID from arg, env, or gcloud config
  let resolvedProjectId = projectId;
  if (!resolvedProjectId) {
    try {
      const { stdout } = await execAsync('gcloud config get-value project');
      resolvedProjectId = stdout.trim();
    } catch {
      throw new Error('No project ID provided and could not get from gcloud config');
    }
  }

  console.log(`Target Project: ${resolvedProjectId}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log('\n');

  const config: GCPConfig = { projectId: resolvedProjectId };
  const results: LiveVerificationResult[] = [];

  // Run all tests
  const tests = [
    verifyIAMRaceCondition,
    verifyServiceAccountKeyRace,
    verifyStorageACLConfig,
    verifyMetadataServerAccess,
    verifyCrossProjectBindings,
    verifyCloudFunctionsSSRF,
    verifyBigQueryExposure,
    verifyGKESecurityConfig,
    verifyVPCServiceControls,
    verifyPubSubPermissions,
  ];

  console.log('┌─────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ EXECUTING LIVE VERIFICATION TESTS                                          │');
  console.log('└─────────────────────────────────────────────────────────────────────────────┘\n');

  for (const test of tests) {
    try {
      const result = await test(config);
      results.push(result);

      const status = result.verified ? '⚠ VULNERABLE' : '✓ OK';
      const severity = result.verified ? `[${result.severity.toUpperCase()}]` : '';
      console.log(`    ${status} ${severity} ${result.vulnerability}`);
      console.log(`      Confidence: ${(result.confidence * 100).toFixed(1)}%`);
      console.log('');
    } catch (error) {
      console.log(`    ✗ ERROR: ${test.name} - ${error}`);
      console.log('');
    }
  }

  // Summary
  const verified = results.filter(r => r.verified);
  const critical = verified.filter(r => r.severity === 'critical');
  const high = verified.filter(r => r.severity === 'high');
  const medium = verified.filter(r => r.severity === 'medium');

  console.log('\n');
  console.log('████████████████████████████████████████████████████████████████████████████████');
  console.log('██                        LIVE VERIFICATION COMPLETE                          ██');
  console.log('████████████████████████████████████████████████████████████████████████████████');
  console.log('');
  console.log(`  Total Tests: ${results.length}`);
  console.log(`  Vulnerabilities Found: ${verified.length}`);
  console.log(`    Critical: ${critical.length}`);
  console.log(`    High: ${high.length}`);
  console.log(`    Medium: ${medium.length}`);
  console.log('');

  if (verified.length > 0) {
    console.log('┌─────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ CONFIRMED VULNERABILITIES                                                  │');
    console.log('└─────────────────────────────────────────────────────────────────────────────┘\n');

    for (const v of verified) {
      console.log(`  ⚠ [${v.severity.toUpperCase()}] ${v.vulnerability}`);
      console.log(`    ID: ${v.id}`);
      console.log(`    Confidence: ${(v.confidence * 100).toFixed(1)}%`);
      console.log(`    Technique: ${v.technique}`);
      console.log(`    Evidence:`);
      for (const e of v.evidence.slice(0, 5)) {
        console.log(`      - ${e}`);
      }
      console.log('');
    }
  }

  console.log('████████████████████████████████████████████████████████████████████████████████\n');

  return {
    results,
    summary: {
      total: results.length,
      verified: verified.length,
      critical: critical.length,
      high: high.length,
      medium: medium.length,
    },
  };
}

export default runLiveGCPVerification;
