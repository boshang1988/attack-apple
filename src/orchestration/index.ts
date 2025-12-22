/**
 * Orchestration Module Index
 *
 * Exports orchestration runners for AGI Core operations including
 * repository upgrades and security audits.
 */

export {
  runRepoUpgradeFlow,
  type RepoUpgradeFlowOptions,
  type EnhancedRepoUpgradeReport,
} from './repoUpgradeRunner.js';

export {
  SecurityAuditRunner,
  runSecurityAuditWithDualTournamentRL,
  type SecurityAuditRunnerOptions,
  type SecurityAuditProgress,
  type SecurityAuditResult,
  type SecurityAuditMetrics,
  type SecurityFix,
  type TournamentStats,
} from './securityAuditRunner.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Universal Security Audit (DEFAULT for all providers)
// ═══════════════════════════════════════════════════════════════════════════════

export {
  runUniversalSecurityAudit,
  runMultiProviderAudit,
  runDefaultSecurityAudit,
  runSecurityAuditWithRemediation,
  remediateFindings,
  type CloudProvider,
  type SeverityLevel,
  type Exploitability,
  type SecurityFinding,
  type AuditConfig,
  type AuditSummary,
  type UniversalAuditResult,
  type RemediationResult,
  type RemediationSummary,
} from '../core/universalSecurityAudit.js';
