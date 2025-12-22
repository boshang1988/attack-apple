/**
 * Security Tournament Engine
 *
 * Dual tournament RL system for zero-day discovery with live verification.
 * Two competing agents race to discover vulnerabilities - winner's strategy
 * updates the security model weights.
 *
 * This is the DEFAULT security capability for AGI Core.
 */

import {
  runDualTournament,
  type TournamentCandidate,
  type TournamentTask,
  type TournamentOutcome,
  type RankedCandidate,
  DEFAULT_HUMAN_REWARD_WEIGHTS,
} from './dualTournament.js';

import {
  runUniversalSecurityAudit,
  runSecurityAuditWithRemediation,
  remediateFindings,
  type SecurityFinding,
  type AuditConfig,
  type AuditSummary,
  type UniversalAuditResult,
  type RemediationSummary,
} from './universalSecurityAudit.js';

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface SecurityTournamentConfig {
  /** Working directory for storing tournament state */
  workingDir: string;
  /** Target providers to audit */
  providers: ('gcp' | 'aws' | 'azure')[];
  /** GCP project IDs to scan */
  projectIds?: string[];
  /** Enable auto-remediation */
  autoFix?: boolean;
  /** Include zero-day predictions */
  includeZeroDay?: boolean;
  /** Max tournament rounds */
  maxRounds?: number;
  /** Callback for progress updates */
  onProgress?: (event: SecurityTournamentEvent) => void;
}

export interface SecurityTournamentEvent {
  type: 'round.start' | 'round.complete' | 'finding.discovered' | 'finding.verified' | 'finding.fixed' | 'tournament.complete';
  round?: number;
  agent?: 'primary' | 'refiner';
  finding?: SecurityFinding;
  summary?: SecurityTournamentSummary;
}

export interface SecurityTournamentSummary {
  totalRounds: number;
  primaryWins: number;
  refinerWins: number;
  ties: number;
  totalFindings: number;
  verifiedFindings: number;
  fixedFindings: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  duration: number;
  winningStrategy: string;
}

export interface AgentSecurityStrategy {
  /** Focus areas for this agent */
  focusAreas: string[];
  /** Test categories to prioritize */
  priorityCategories: string[];
  /** Heuristics to emphasize */
  heuristics: string[];
  /** Aggressiveness level 0-1 */
  aggressiveness: number;
}

export interface TournamentWeights {
  /** Weight for number of findings */
  findingsWeight: number;
  /** Weight for severity (critical > high > medium) */
  severityWeight: number;
  /** Weight for verification success */
  verificationWeight: number;
  /** Weight for successful remediation */
  remediationWeight: number;
  /** Winning strategy history */
  winningStrategies: string[];
  /** Last updated timestamp */
  lastUpdated: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Default Strategies
// ═══════════════════════════════════════════════════════════════════════════════

const PRIMARY_STRATEGY: AgentSecurityStrategy = {
  focusAreas: ['IAM', 'Network', 'Storage', 'Secrets'],
  priorityCategories: ['IAM', 'Network', 'Security'],
  heuristics: ['trustBoundaryAnalysis', 'complexityCorrelation', 'errorHandlingAsymmetry'],
  aggressiveness: 0.8,
};

const REFINER_STRATEGY: AgentSecurityStrategy = {
  focusAreas: ['Workspace', 'Firebase', 'Android', 'Identity'],
  priorityCategories: ['Workspace', 'Firebase', 'Android', 'Identity'],
  heuristics: ['temporalCoupling', 'serializationBoundaries', 'emergentBehaviors'],
  aggressiveness: 0.6,
};

const DEFAULT_WEIGHTS: TournamentWeights = {
  findingsWeight: 0.3,
  severityWeight: 0.4,
  verificationWeight: 0.2,
  remediationWeight: 0.1,
  winningStrategies: [],
  lastUpdated: new Date().toISOString(),
};

// ═══════════════════════════════════════════════════════════════════════════════
// Weight Persistence
// ═══════════════════════════════════════════════════════════════════════════════

function getWeightsPath(workingDir: string): string {
  const agiDir = join(workingDir, '.agi');
  if (!existsSync(agiDir)) {
    mkdirSync(agiDir, { recursive: true });
  }
  return join(agiDir, 'security-tournament-weights.json');
}

function loadWeights(workingDir: string): TournamentWeights {
  const path = getWeightsPath(workingDir);
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      return { ...DEFAULT_WEIGHTS };
    }
  }
  return { ...DEFAULT_WEIGHTS };
}

function saveWeights(workingDir: string, weights: TournamentWeights): void {
  const path = getWeightsPath(workingDir);
  writeFileSync(path, JSON.stringify(weights, null, 2));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Scoring Functions
// ═══════════════════════════════════════════════════════════════════════════════

function scoreFindings(findings: SecurityFinding[], weights: TournamentWeights): number {
  let score = 0;

  // Count score
  score += findings.length * weights.findingsWeight;

  // Severity score
  const severityScores = {
    critical: 10,
    high: 5,
    medium: 2,
    low: 1,
    info: 0.5,
  };

  for (const finding of findings) {
    score += severityScores[finding.severity] * weights.severityWeight;
    if (finding.verified) {
      score += 2 * weights.verificationWeight;
    }
  }

  return score;
}

function buildCandidate(
  id: string,
  findings: SecurityFinding[],
  weights: TournamentWeights
): TournamentCandidate {
  const verified = findings.filter(f => f.verified);
  const critical = findings.filter(f => f.severity === 'critical');
  const high = findings.filter(f => f.severity === 'high');

  return {
    id,
    policyId: id,
    patchSummary: `Found ${findings.length} vulnerabilities (${verified.length} verified)`,
    diffSummary: `Critical: ${critical.length}, High: ${high.length}`,
    metrics: {
      executionSuccess: verified.length / Math.max(findings.length, 1),
      testsPassed: verified.length,
      testsFailed: findings.length - verified.length,
      toolSuccesses: verified.length,
      toolFailures: 0,
    },
    signals: {
      rewardModelScore: scoreFindings(findings, weights) / 100,
      selfAssessment: verified.length > 0 ? 0.8 : 0.3,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Security Tournament Runner
// ═══════════════════════════════════════════════════════════════════════════════

export async function runSecurityTournament(
  config: SecurityTournamentConfig
): Promise<{
  summary: SecurityTournamentSummary;
  findings: SecurityFinding[];
  remediation?: RemediationSummary;
}> {
  const startTime = Date.now();
  const weights = loadWeights(config.workingDir);
  const maxRounds = config.maxRounds || 3;

  const allFindings: SecurityFinding[] = [];
  let primaryWins = 0;
  let refinerWins = 0;
  let ties = 0;
  let totalFixed = 0;

  console.log('\n');
  console.log('████████████████████████████████████████████████████████████████████████████████');
  console.log('██                                                                            ██');
  console.log('██           DUAL TOURNAMENT SECURITY AUDIT                                   ██');
  console.log('██                 Live Zero-Day Discovery                                    ██');
  console.log('██                                                                            ██');
  console.log('████████████████████████████████████████████████████████████████████████████████\n');

  console.log(`  Providers: ${config.providers.join(', ').toUpperCase()}`);
  console.log(`  Projects: ${config.projectIds?.join(', ') || 'auto-detect'}`);
  console.log(`  Max Rounds: ${maxRounds}`);
  console.log(`  Auto-Fix: ${config.autoFix ? 'ENABLED' : 'disabled'}`);
  console.log(`  Zero-Day Predictions: ${config.includeZeroDay !== false ? 'ENABLED' : 'disabled'}`);
  console.log('\n');

  // Tournament rounds
  for (let round = 1; round <= maxRounds; round++) {
    console.log('┌─────────────────────────────────────────────────────────────────────────────┐');
    console.log(`│ ROUND ${round}/${maxRounds}                                                              │`);
    console.log('└─────────────────────────────────────────────────────────────────────────────┘\n');

    config.onProgress?.({ type: 'round.start', round });

    // Primary agent scan - focuses on core infrastructure
    console.log('  🔵 PRIMARY AGENT - Core Infrastructure Scan');
    const primaryFindings: SecurityFinding[] = [];

    for (const provider of config.providers) {
      for (const category of PRIMARY_STRATEGY.priorityCategories) {
        const auditConfig: AuditConfig = {
          provider,
          projectId: config.projectIds?.[0],
          liveTesting: true,
          includeZeroDay: config.includeZeroDay !== false,
          aggressive: PRIMARY_STRATEGY.aggressiveness > 0.7,
        };

        try {
          const result = await runUniversalSecurityAudit(auditConfig);
          const categoryFindings = result.findings.filter(f =>
            PRIMARY_STRATEGY.focusAreas.some(area =>
              f.id.toLowerCase().includes(area.toLowerCase()) ||
              f.vulnerability.toLowerCase().includes(area.toLowerCase())
            )
          );
          primaryFindings.push(...categoryFindings);

          for (const finding of categoryFindings) {
            config.onProgress?.({ type: 'finding.discovered', round, agent: 'primary', finding });
          }
        } catch (e) {
          console.log(`    Error scanning ${category}: ${e}`);
        }
      }
    }

    console.log(`    Found: ${primaryFindings.length} vulnerabilities\n`);

    // Refiner agent scan - focuses on apps and identity
    console.log('  🟠 REFINER AGENT - Application & Identity Scan');
    const refinerFindings: SecurityFinding[] = [];

    for (const provider of config.providers) {
      for (const category of REFINER_STRATEGY.priorityCategories) {
        const auditConfig: AuditConfig = {
          provider,
          projectId: config.projectIds?.[0],
          liveTesting: true,
          includeZeroDay: config.includeZeroDay !== false,
          aggressive: REFINER_STRATEGY.aggressiveness > 0.7,
        };

        try {
          const result = await runUniversalSecurityAudit(auditConfig);
          const categoryFindings = result.findings.filter(f =>
            REFINER_STRATEGY.focusAreas.some(area =>
              f.id.toLowerCase().includes(area.toLowerCase()) ||
              f.vulnerability.toLowerCase().includes(area.toLowerCase())
            )
          );
          refinerFindings.push(...categoryFindings);

          for (const finding of categoryFindings) {
            config.onProgress?.({ type: 'finding.discovered', round, agent: 'refiner', finding });
          }
        } catch (e) {
          console.log(`    Error scanning ${category}: ${e}`);
        }
      }
    }

    console.log(`    Found: ${refinerFindings.length} vulnerabilities\n`);

    // Run dual tournament to determine winner
    const task: TournamentTask = {
      id: `security-round-${round}`,
      goal: 'Find and verify security vulnerabilities',
      constraints: ['Must verify on live systems', 'Prioritize critical findings'],
    };

    const primaryCandidate = buildCandidate('primary', primaryFindings, weights);
    const refinerCandidate = buildCandidate('refiner', refinerFindings, weights);

    const tournamentResult = runDualTournament(
      task,
      [primaryCandidate, refinerCandidate],
      { rewardWeights: DEFAULT_HUMAN_REWARD_WEIGHTS }
    );

    // Determine round winner
    const primaryScore = scoreFindings(primaryFindings, weights);
    const refinerScore = scoreFindings(refinerFindings, weights);

    let roundWinner: 'primary' | 'refiner' | 'tie';
    if (primaryScore > refinerScore * 1.1) {
      roundWinner = 'primary';
      primaryWins++;
      console.log(`  🏆 Round ${round} Winner: PRIMARY (${primaryScore.toFixed(1)} vs ${refinerScore.toFixed(1)})`);
    } else if (refinerScore > primaryScore * 1.1) {
      roundWinner = 'refiner';
      refinerWins++;
      console.log(`  🏆 Round ${round} Winner: REFINER (${refinerScore.toFixed(1)} vs ${primaryScore.toFixed(1)})`);
    } else {
      roundWinner = 'tie';
      ties++;
      console.log(`  🤝 Round ${round}: TIE (${primaryScore.toFixed(1)} vs ${refinerScore.toFixed(1)})`);
    }

    // Merge findings (deduplicate by ID)
    const seenIds = new Set(allFindings.map(f => f.id));
    for (const finding of [...primaryFindings, ...refinerFindings]) {
      if (!seenIds.has(finding.id)) {
        allFindings.push(finding);
        seenIds.add(finding.id);
      }
    }

    // Update weights based on winner
    if (roundWinner !== 'tie') {
      const winnerStrategy = roundWinner === 'primary' ? PRIMARY_STRATEGY : REFINER_STRATEGY;
      weights.winningStrategies.push(winnerStrategy.focusAreas.join(','));

      // Adjust weights based on what worked
      if (roundWinner === 'primary') {
        weights.severityWeight = Math.min(0.5, weights.severityWeight + 0.02);
      } else {
        weights.findingsWeight = Math.min(0.4, weights.findingsWeight + 0.02);
      }
      weights.lastUpdated = new Date().toISOString();
      saveWeights(config.workingDir, weights);
    }

    config.onProgress?.({ type: 'round.complete', round, agent: roundWinner === 'tie' ? undefined : roundWinner });
    console.log('\n');
  }

  // Final verification pass on all findings
  console.log('┌─────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ FINAL VERIFICATION                                                         │');
  console.log('└─────────────────────────────────────────────────────────────────────────────┘\n');

  const verifiedFindings = allFindings.filter(f => f.verified);
  console.log(`  Total Findings: ${allFindings.length}`);
  console.log(`  Verified: ${verifiedFindings.length}`);

  // Auto-remediation if enabled
  let remediationResult: RemediationSummary | undefined;
  if (config.autoFix && verifiedFindings.length > 0) {
    console.log('\n');
    console.log('┌─────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ AUTO-REMEDIATION                                                           │');
    console.log('└─────────────────────────────────────────────────────────────────────────────┘\n');

    remediationResult = await remediateFindings(verifiedFindings, {
      provider: config.providers[0] || 'gcp',
      projectId: config.projectIds?.[0],
      liveTesting: true,
    });

    totalFixed = remediationResult.fixed;

    for (const result of remediationResult.results.filter(r => r.success)) {
      const finding = verifiedFindings.find(f => f.id === result.findingId);
      if (finding) {
        config.onProgress?.({ type: 'finding.fixed', finding });
      }
    }
  }

  const duration = Date.now() - startTime;

  // Build summary
  const summary: SecurityTournamentSummary = {
    totalRounds: maxRounds,
    primaryWins,
    refinerWins,
    ties,
    totalFindings: allFindings.length,
    verifiedFindings: verifiedFindings.length,
    fixedFindings: totalFixed,
    criticalCount: allFindings.filter(f => f.severity === 'critical').length,
    highCount: allFindings.filter(f => f.severity === 'high').length,
    mediumCount: allFindings.filter(f => f.severity === 'medium').length,
    duration,
    winningStrategy: primaryWins > refinerWins ? 'Infrastructure Focus' : refinerWins > primaryWins ? 'Application Focus' : 'Balanced',
  };

  // Final output
  console.log('\n');
  console.log('████████████████████████████████████████████████████████████████████████████████');
  console.log('██                     TOURNAMENT COMPLETE                                    ██');
  console.log('████████████████████████████████████████████████████████████████████████████████\n');

  console.log(`  Rounds: ${maxRounds} | Primary Wins: ${primaryWins} | Refiner Wins: ${refinerWins} | Ties: ${ties}`);
  console.log(`  Total Findings: ${allFindings.length} | Verified: ${verifiedFindings.length} | Fixed: ${totalFixed}`);
  console.log(`  Critical: ${summary.criticalCount} | High: ${summary.highCount} | Medium: ${summary.mediumCount}`);
  console.log(`  Winning Strategy: ${summary.winningStrategy}`);
  console.log(`  Duration: ${(duration / 1000).toFixed(2)}s`);

  if (verifiedFindings.length > 0) {
    console.log('\n  VERIFIED VULNERABILITIES:');
    for (const finding of verifiedFindings) {
      const sevColor = finding.severity === 'critical' ? '🔴' :
                      finding.severity === 'high' ? '🟠' :
                      finding.severity === 'medium' ? '🟡' : '🔵';
      console.log(`    ${sevColor} [${finding.severity.toUpperCase()}] ${finding.vulnerability}`);
    }
  }

  console.log('\n████████████████████████████████████████████████████████████████████████████████\n');

  config.onProgress?.({ type: 'tournament.complete', summary });

  return { summary, findings: allFindings, remediation: remediationResult };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Quick Security Check (for startup)
// ═══════════════════════════════════════════════════════════════════════════════

export async function runQuickSecurityCheck(workingDir: string): Promise<{
  status: 'secure' | 'at-risk' | 'critical';
  findings: SecurityFinding[];
  message: string;
}> {
  try {
    // Quick single-round check
    const result = await runUniversalSecurityAudit({
      provider: 'gcp',
      liveTesting: true,
      includeZeroDay: false, // Skip predictions for quick check
    });

    const critical = result.findings.filter(f => f.severity === 'critical' && f.verified);
    const high = result.findings.filter(f => f.severity === 'high' && f.verified);

    let status: 'secure' | 'at-risk' | 'critical';
    let message: string;

    if (critical.length > 0) {
      status = 'critical';
      message = `${critical.length} CRITICAL vulnerabilities found - immediate action required`;
    } else if (high.length > 0) {
      status = 'at-risk';
      message = `${high.length} HIGH severity issues found - review recommended`;
    } else if (result.findings.length > 0) {
      status = 'at-risk';
      message = `${result.findings.length} security findings - run full audit for details`;
    } else {
      status = 'secure';
      message = 'No critical vulnerabilities detected';
    }

    return { status, findings: result.findings, message };
  } catch (error) {
    return {
      status: 'at-risk',
      findings: [],
      message: `Security check unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Export Default
// ═══════════════════════════════════════════════════════════════════════════════

export default runSecurityTournament;
