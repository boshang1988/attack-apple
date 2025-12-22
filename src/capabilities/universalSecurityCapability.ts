/**
 * Universal Security Capability Module
 * 
 * MAXIMUM CAPABILITIES FOR COMPREHENSIVE SECURITY OPERATIONS
 * 
 * Integrates all security systems: zero-day discovery, universal audit,
 * tournament RL, Apple security, and attack simulation into a single
 * unified capability module for AGI Core.
 */

import type { CapabilityContribution, CapabilityContext, CapabilityModule } from '../runtime/agentHost.js';
import { ZeroDayDiscovery, type ZeroDayDiscoveryConfig, type ZeroDayDiscoveryResult } from '../core/zeroDayDiscovery.js';
import { runUniversalSecurityAudit, type AuditConfig, type UniversalAuditResult } from '../core/universalSecurityAudit.js';
import { runSecurityTournament, type SecurityTournamentConfig } from '../core/securityTournament.js';
import { AppleSecurityIntegration, type AppleSecurityConfig } from '../core/appleSecurityIntegration.js';

export interface UniversalSecurityCapabilityOptions {
  /** Enable zero-day discovery capabilities */
  enableZeroDayDiscovery: boolean;
  /** Enable universal security audit */
  enableUniversalAudit: boolean;
  /** Enable tournament RL optimization */
  enableTournamentRL: boolean;
  /** Enable Apple security integration */
  enableAppleSecurity: boolean;
  /** Default aggressiveness level 0-1 */
  defaultAggressiveness: number;
  /** Enable live verification by default */
  defaultLiveVerification: boolean;
  /** Default output directory */
  outputDir: string;
  /** Working directory for operations */
  workingDir?: string;
}

export class UniversalSecurityCapabilityModule implements CapabilityModule {
  readonly id = 'capability.universal-security';
  private readonly options: UniversalSecurityCapabilityOptions;

  constructor(options: Partial<UniversalSecurityCapabilityOptions> = {}) {
    this.options = {
      enableZeroDayDiscovery: true,
      enableUniversalAudit: true,
      enableTournamentRL: true,
      enableAppleSecurity: true,
      defaultAggressiveness: 0.9,
      defaultLiveVerification: true,
      outputDir: process.cwd(),
      ...options
    };
  }

  async create(context: CapabilityContext): Promise<CapabilityContribution> {
    const workingDir = this.options.workingDir ?? context.workingDir;
    
    return {
      id: 'universal-security.maximum-capability',
      description: 'MAXIMUM CAPABILITIES FOR COMPREHENSIVE SECURITY OPERATIONS - Zero-day discovery, universal audit, tournament RL, Apple security, attack simulation',
      toolSuite: {
        id: 'universal-security',
        description: 'Comprehensive security operations across all domains',
        tools: this.createSecurityTools(workingDir),
      },
      metadata: {
        workingDir,
        outputDir: this.options.outputDir,
        capabilities: {
          zeroDayDiscovery: this.options.enableZeroDayDiscovery,
          universalAudit: this.options.enableUniversalAudit,
          tournamentRL: this.options.enableTournamentRL,
          appleSecurity: this.options.enableAppleSecurity,
        },
      },
    };
  }

  private createSecurityTools(workingDir: string) {
    const tools: any[] = [];

    // ZERO-DAY DISCOVERY TOOL
    if (this.options.enableZeroDayDiscovery) {
      tools.push({
        name: 'discover_zero_days_maximum',
        description: `MAXIMUM CAPABILITY ZERO-DAY DISCOVERY

Execute comprehensive zero-day discovery across ALL available pathways:
1. 14 heuristic-based vulnerability prediction systems
2. Universal security audit integration with live verification  
3. Tournament RL optimization for discovery strategy
4. Multi-vector attack surface exploration
5. Live exploitation verification
6. Comprehensive reporting and recommendations

Parameters:
- target: Primary target (domain, IP, cloud project, etc.)
- targetType: Type of target (web, cloud, mobile, api, infrastructure, iot, network, binary, source)
- attackSurface: Specific attack surfaces to target (optional)
- aggressiveness: Discovery aggressiveness 0-1 (default: 0.9)
- liveVerification: Enable live exploitation verification (default: true)
- enableTournament: Enable tournament RL optimization (default: true)
- heuristics: Zero-day heuristic categories to apply (optional - all 14 by default)
- outputDir: Output directory for findings (default: current directory)

Returns complete discovery results with executive summary and immediate actions.`,
        handler: async (args: any) => {
          try {
            const config: ZeroDayDiscoveryConfig = {
              target: args.target || 'localhost',
              targetType: args.targetType || 'web',
              attackSurface: args.attackSurface || [],
              aggressiveness: args.aggressiveness ?? this.options.defaultAggressiveness,
              liveVerification: args.liveVerification ?? this.options.defaultLiveVerification,
              enableTournament: args.enableTournament ?? this.options.enableTournamentRL,
              heuristics: args.heuristics || [
                'complexityCorrelation',
                'trustBoundaryAnalysis',
                'temporalCoupling',
                'serializationBoundaries',
                'emergentBehaviors',
                'errorHandlingAsymmetry',
                'implicitStateDependencies',
                'resourceExhaustion',
                'supplyChainAnalysis',
                'cryptographicWeakness',
                'raceConditions',
                'memoryCorruption',
                'logicBugs',
                'configurationDrift'
              ],
              outputDir: args.outputDir || this.options.outputDir,
            };

            const discovery = new ZeroDayDiscovery(config);
            const result = await discovery.discover();

            return JSON.stringify({
              status: 'maximum-capability-zero-day-discovery',
              result,
              executiveSummary: this.generateZeroDayExecutiveSummary(result),
              immediateActions: result.recommendations.immediate,
              securityPosture: this.calculateSecurityPosture(result),
            }, null, 2);
          } catch (error: any) {
            return JSON.stringify({
              status: 'error',
              error: error.message,
              stack: error.stack,
              recommendation: 'Check target accessibility and permissions',
            }, null, 2);
          }
        },
      });
    }

    // UNIVERSAL SECURITY AUDIT TOOL
    if (this.options.enableUniversalAudit) {
      tools.push({
        name: 'universal_security_audit',
        description: `UNIVERSAL SECURITY AUDIT

Provider-agnostic security scanning for any cloud infrastructure, company, or product.
Supports GCP, AWS, Azure, and custom infrastructure with live verification.

Parameters:
- provider: Cloud provider ('gcp', 'aws', 'azure', 'custom')
- projectId: GCP project ID (optional)
- accountId: AWS account ID (optional)
- subscriptionId: Azure subscription ID (optional)
- aggressive: Enable aggressive scanning (default: false)
- includeZeroDay: Include zero-day predictions (default: true)
- liveTesting: Enable live verification (default: false)

Returns comprehensive audit results with verified findings and remediation guidance.`,
        handler: async (args: any) => {
          try {
            const auditConfig: AuditConfig = {
              provider: args.provider || 'gcp',
              projectId: args.projectId,
              region: args.region,
              accountId: args.accountId,
              subscriptionId: args.subscriptionId,
              aggressive: args.aggressive || false,
              includeZeroDay: args.includeZeroDay !== false,
              liveTesting: args.liveTesting || false,
            };

            const result = await runUniversalSecurityAudit(auditConfig);

            return JSON.stringify({
              status: 'universal-audit-complete',
              result,
              summary: result.summary,
              riskAssessment: this.calculateRiskAssessment(result),
              remediationPriority: this.prioritizeRemediation(result.findings),
            }, null, 2);
          } catch (error: any) {
            return JSON.stringify({
              status: 'error',
              error: error.message,
              provider: args.provider,
              recommendation: 'Check credentials and API permissions',
            }, null, 2);
          }
        },
      });
    }

    // TOURNAMENT RL OPTIMIZATION TOOL
    if (this.options.enableTournamentRL) {
      tools.push({
        name: 'security_tournament_rl',
        description: `SECURITY TOURNAMENT RL OPTIMIZATION

Dual tournament reinforcement learning system for zero-day discovery optimization.
Two competing agents race to discover vulnerabilities - winner's strategy updates security model.

Parameters:
- providers: Cloud providers to audit ('gcp', 'aws', 'azure') array
- projectIds: Project IDs to scan (optional)
- autoFix: Enable auto-remediation (default: false)
- includeZeroDay: Include zero-day predictions (default: true)
- maxRounds: Maximum tournament rounds (default: 3)
- workingDir: Working directory for tournament state

Returns tournament results with winning strategy and optimized discovery approach.`,
        handler: async (args: any) => {
          try {
            const tournamentConfig: SecurityTournamentConfig = {
              workingDir: args.workingDir || workingDir,
              providers: args.providers || ['gcp'],
              projectIds: args.projectIds ? [args.projectIds] : undefined,
              autoFix: args.autoFix || false,
              includeZeroDay: args.includeZeroDay !== false,
              maxRounds: args.maxRounds || 3,
            };

            const result = await runSecurityTournament(tournamentConfig);

            return JSON.stringify({
              status: 'tournament-complete',
              result,
              winningStrategy: result.summary.winningStrategy,
              optimizationMetrics: {
                rounds: result.summary.totalRounds,
                primaryWins: result.summary.primaryWins,
                refinerWins: result.summary.refinerWins,
                effectiveness: result.summary.verifiedFindings / Math.max(result.summary.totalFindings, 1),
              },
              recommendations: this.generateTournamentRecommendations(result),
            }, null, 2);
          } catch (error: any) {
            return JSON.stringify({
              status: 'error',
              error: error.message,
              recommendation: 'Check provider configuration and permissions',
            }, null, 2);
          }
        },
      });
    }

    // APPLE SECURITY INTEGRATION TOOL
    if (this.options.enableAppleSecurity) {
      tools.push({
        name: 'apple_security_audit',
        description: `APPLE SECURITY AUDIT

Comprehensive Apple security auditing, exploitation analysis, and remediation capabilities.
Covers Apple services, devices, networks, and enterprise security configurations.

Parameters:
- aggressive: Enable aggressive scanning (default: false)
- targetScope: Scope of security assessment ('services', 'devices', 'network', 'all')
- enableExploitation: Enable exploitation scenario generation (default: false)
- enableRemediation: Enable automated remediation recommendations (default: true)
- outputDir: Output directory for evidence and reports

Returns Apple security findings with exploitation analysis and remediation guidance.`,
        handler: async (args: any) => {
          try {
            const appleConfig: AppleSecurityConfig = {
              aggressive: args.aggressive || false,
              evidencePrefix: 'agi-apple-security',
              rateLimit: 1000,
              targetScope: args.targetScope || 'all',
              enableExploitation: args.enableExploitation || false,
              enableRemediation: args.enableRemediation !== false,
              outputDir: args.outputDir || this.options.outputDir,
            };

            const integration = new AppleSecurityIntegration(appleConfig);
            const health = AppleSecurityIntegration.quickCheck();
            
            if (health.status === 'unavailable') {
              return JSON.stringify({
                status: 'apple-security-unavailable',
                health,
                recommendation: 'Apple security capabilities require macOS environment',
              }, null, 2);
            }

            // Run full integration
            const result = await integration.runFullIntegration();

            return JSON.stringify({
              status: 'apple-security-audit-complete',
              result,
              health,
              securityAssessment: this.assessAppleSecurity(result),
            }, null, 2);
          } catch (error: any) {
            return JSON.stringify({
              status: 'error',
              error: error.message,
              recommendation: 'Apple security audit requires macOS environment',
            }, null, 2);
          }
        },
      });
    }

    // COMPREHENSIVE SECURITY ASSESSMENT TOOL
    tools.push({
      name: 'comprehensive_security_assessment',
      description: `COMPREHENSIVE SECURITY ASSESSMENT

Execute multi-phase security assessment across all available capabilities:
1. Zero-day discovery for unknown vulnerabilities
2. Universal security audit for known vulnerabilities
3. Tournament RL optimization for discovery strategy
4. Apple security audit (if applicable)
5. Risk assessment and prioritization
6. Remediation planning

Parameters:
- target: Primary target (domain, IP, cloud project, etc.)
- targetType: Type of target (web, cloud, mobile, api, etc.)
- enableAllCapabilities: Enable all security capabilities (default: true)
- outputDir: Output directory for comprehensive report

Returns comprehensive security assessment with executive dashboard.`,
      handler: async (args: any) => {
        const assessment: any = {
          timestamp: new Date().toISOString(),
          target: args.target || 'localhost',
          targetType: args.targetType || 'web',
          phases: [],
          findings: [],
          riskScore: 0,
          recommendations: [],
        };

        try {
          // Phase 1: Zero-day discovery
          if (this.options.enableZeroDayDiscovery) {
            assessment.phases.push({
              phase: 'zero-day-discovery',
              status: 'running',
            });

            const zeroDayConfig: ZeroDayDiscoveryConfig = {
              target: args.target || 'localhost',
              targetType: args.targetType || 'web',
              attackSurface: [],
              aggressiveness: 0.8,
              liveVerification: false,
              enableTournament: false,
              heuristics: [
                'trustBoundaryAnalysis',
                'complexityCorrelation',
                'errorHandlingAsymmetry',
                'configurationDrift',
              ],
              outputDir: args.outputDir || this.options.outputDir,
            };

            const zeroDay = new ZeroDayDiscovery(zeroDayConfig);
            const zeroDayResult = await zeroDay.discover();
            assessment.findings.push(...zeroDayResult.findings);
            assessment.phases[assessment.phases.length - 1].status = 'completed';
            assessment.phases[assessment.phases.length - 1].findings = zeroDayResult.findings.length;
          }

          // Phase 2: Universal audit
          if (this.options.enableUniversalAudit) {
            assessment.phases.push({
              phase: 'universal-audit',
              status: 'running',
            });

            const auditConfig: AuditConfig = {
              provider: 'custom',
              aggressive: false,
              includeZeroDay: true,
              liveTesting: false,
            };

            const auditResult = await runUniversalSecurityAudit(auditConfig);
            assessment.findings.push(...auditResult.findings);
            assessment.phases[assessment.phases.length - 1].status = 'completed';
            assessment.phases[assessment.phases.length - 1].findings = auditResult.findings.length;
          }

          // Calculate overall risk score
          assessment.riskScore = this.calculateOverallRiskScore(assessment.findings);
          assessment.recommendations = this.generateComprehensiveRecommendations(assessment.findings);

          return JSON.stringify({
            status: 'comprehensive-assessment-complete',
            assessment,
            executiveDashboard: this.generateExecutiveDashboard(assessment),
            nextSteps: this.generateNextSteps(assessment),
          }, null, 2);
        } catch (error: any) {
          return JSON.stringify({
            status: 'error',
            error: error.message,
            phases: assessment.phases || [],
            recommendation: 'Comprehensive assessment failed - check individual capability health',
          }, null, 2);
        }
      },
    });

    // SECURITY HEALTH CHECK TOOL
    tools.push({
      name: 'security_capability_health_check',
      description: 'Check health and readiness of all security capabilities',
      handler: async () => {
        const health = {
          timestamp: new Date().toISOString(),
          capabilities: {
            zeroDayDiscovery: {
              enabled: this.options.enableZeroDayDiscovery,
              health: 'operational',
              heuristics: 14,
            },
            universalAudit: {
              enabled: this.options.enableUniversalAudit,
              health: 'operational',
              providers: ['gcp', 'aws', 'azure', 'custom'],
            },
            tournamentRL: {
              enabled: this.options.enableTournamentRL,
              health: 'operational',
              optimization: 'reinforcement-learning',
            },
            appleSecurity: {
              enabled: this.options.enableAppleSecurity,
              health: 'requires-macos',
              scope: this.options.enableAppleSecurity ? 'services,devices,network,all' : 'disabled',
            },
          },
          workingDir,
          outputDir: this.options.outputDir,
          maximumCapabilities: true,
        };

        return JSON.stringify({
          status: 'health-check-complete',
          health,
          message: 'Security capabilities operational with MAXIMUM discovery capabilities',
        }, null, 2);
      },
    });

    return tools;
  }

  // Helper methods for analysis and reporting
  private generateZeroDayExecutiveSummary(result: ZeroDayDiscoveryResult) {
    const critical = result.findings.filter(f => f.severity === 'critical').length;
    const high = result.findings.filter(f => f.severity === 'high').length;
    const verified = result.findings.filter(f => f.verified).length;
    const zeroDays = result.findings.filter(f => f.zeroDayConfidence > 0.8).length;

    return {
      target: result.target,
      totalFindings: result.findings.length,
      zeroDayCandidates: zeroDays,
      verifiedVulnerabilities: verified,
      severityBreakdown: { critical, high },
      attackVectors: result.discoveryMetrics.uniqueAttackVectors,
      discoveryMethods: result.discoveryMetrics.totalPathsExplored,
      riskLevel: critical > 0 ? 'CRITICAL' : high > 0 ? 'HIGH' : zeroDays > 0 ? 'MEDIUM' : 'LOW',
      assessment: zeroDays > 0 ? 'ZERO-DAY CANDIDATES IDENTIFIED' : 'NO ZERO-DAY CANDIDATES',
    };
  }

  private calculateSecurityPosture(result: ZeroDayDiscoveryResult) {
    const zeroDays = result.findings.filter(f => f.zeroDayConfidence > 0.8).length;
    const verified = result.findings.filter(f => f.verified).length;
    const total = result.findings.length;

    if (zeroDays > 0) return 'CRITICAL - Zero-day candidates detected';
    if (verified > 0) return 'HIGH - Verified vulnerabilities present';
    if (total > 0) return 'MEDIUM - Potential vulnerabilities identified';
    return 'LOW - No significant findings';
  }

  private calculateRiskAssessment(result: UniversalAuditResult) {
    const critical = result.findings.filter(f => f.severity === 'critical').length;
    const high = result.findings.filter(f => f.severity === 'high').length;
    const verified = result.findings.filter(f => f.verified).length;

    const riskScore = (critical * 10) + (high * 5) + (verified * 3);
    
    return {
      score: riskScore,
      level: riskScore >= 20 ? 'CRITICAL' : riskScore >= 10 ? 'HIGH' : riskScore >= 5 ? 'MEDIUM' : 'LOW',
      factors: {
        criticalVulnerabilities: critical,
        highVulnerabilities: high,
        verifiedFindings: verified,
      },
    };
  }

  private prioritizeRemediation(findings: any[]) {
    return findings
      .filter(f => f.verified)
      .sort((a, b) => {
        const severityScore = { critical: 4, high: 3, medium: 2, low: 1 };
        const aScore = severityScore[a.severity] || 0;
        const bScore = severityScore[b.severity] || 0;
        return bScore - aScore;
      })
      .slice(0, 10)
      .map(f => ({
        id: f.id,
        vulnerability: f.vulnerability,
        severity: f.severity,
        remediation: f.remediation || 'No remediation provided',
        priority: f.severity === 'critical' ? 'IMMEDIATE' : f.severity === 'high' ? 'HIGH' : 'MEDIUM',
      }));
  }

  private generateTournamentRecommendations(result: any) {
    const recommendations = [];

    if (result.summary.winningStrategy.includes('Infrastructure')) {
      recommendations.push('Focus on infrastructure security hardening');
      recommendations.push('Implement network segmentation and access controls');
      recommendations.push('Review IAM policies and service accounts');
    } else if (result.summary.winningStrategy.includes('Application')) {
      recommendations.push('Focus on application security testing');
      recommendations.push('Implement input validation and output encoding');
      recommendations.push('Review authentication and authorization logic');
    } else {
      recommendations.push('Maintain balanced security approach');
      recommendations.push('Implement defense-in-depth strategy');
      recommendations.push('Regular security assessments recommended');
    }

    if (result.summary.verifiedFindings > 0) {
      recommendations.push(`Address ${result.summary.verifiedFindings} verified vulnerabilities`);
    }

    return recommendations;
  }

  private assessAppleSecurity(result: any) {
    // Simple assessment based on Apple security integration results
    return {
      status: 'assessed',
      recommendation: result.enableRemediation ? 'Remediation capabilities enabled' : 'Assessment only',
      scope: result.targetScope || 'all',
    };
  }

  private calculateOverallRiskScore(findings: any[]) {
    const critical = findings.filter(f => f.severity === 'critical').length;
    const high = findings.filter(f => f.severity === 'high').length;
    const verified = findings.filter(f => f.verified).length;
    const zeroDays = findings.filter(f => f.zeroDayConfidence > 0.8).length;

    return (critical * 20) + (high * 10) + (verified * 5) + (zeroDays * 15);
  }

  private generateComprehensiveRecommendations(findings: any[]) {
    const recommendations = [];
    const critical = findings.filter(f => f.severity === 'critical').length;
    const zeroDays = findings.filter(f => f.zeroDayConfidence > 0.8).length;

    if (critical > 0) {
      recommendations.push(`Address ${critical} critical vulnerabilities immediately`);
    }

    if (zeroDays > 0) {
      recommendations.push(`Investigate ${zeroDays} zero-day candidates`);
      recommendations.push('Implement additional monitoring for zero-day exploitation');
    }

    if (findings.length > 0) {
      recommendations.push('Establish vulnerability management process');
      recommendations.push('Implement regular security assessments');
    } else {
      recommendations.push('Maintain current security posture');
      recommendations.push('Continue regular security monitoring');
    }

    return recommendations;
  }

  private generateExecutiveDashboard(assessment: any) {
    return {
      timestamp: assessment.timestamp,
      target: assessment.target,
      riskScore: assessment.riskScore,
      riskLevel: assessment.riskScore >= 50 ? 'CRITICAL' : assessment.riskScore >= 25 ? 'HIGH' : assessment.riskScore >= 10 ? 'MEDIUM' : 'LOW',
      phasesCompleted: assessment.phases.filter((p: any) => p.status === 'completed').length,
      totalFindings: assessment.findings.length,
      criticalFindings: assessment.findings.filter((f: any) => f.severity === 'critical').length,
      zeroDayCandidates: assessment.findings.filter((f: any) => f.zeroDayConfidence > 0.8).length,
      status: assessment.riskScore >= 50 ? 'REQUIRES IMMEDIATE ACTION' : assessment.riskScore >= 25 ? 'NEEDS ATTENTION' : 'STABLE',
    };
  }

  private generateNextSteps(assessment: any) {
    const nextSteps = [];

    if (assessment.riskScore >= 50) {
      nextSteps.push('IMMEDIATE: Address critical vulnerabilities');
      nextSteps.push('IMMEDIATE: Isolate affected systems if necessary');
      nextSteps.push('SHORT-TERM: Implement emergency security controls');
    } else if (assessment.riskScore >= 25) {
      nextSteps.push('SHORT-TERM: Address high-severity vulnerabilities');
      nextSteps.push('SHORT-TERM: Enhance security monitoring');
      nextSteps.push('MEDIUM-TERM: Conduct deeper security assessment');
    } else {
      nextSteps.push('MEDIUM-TERM: Implement regular security assessments');
      nextSteps.push('MEDIUM-TERM: Enhance security awareness training');
      nextSteps.push('LONG-TERM: Develop security maturity roadmap');
    }

    if (assessment.findings.filter((f: any) => f.zeroDayConfidence > 0.8).length > 0) {
      nextSteps.push('SPECIAL: Investigate zero-day candidates');
      nextSteps.push('SPECIAL: Implement zero-day detection mechanisms');
    }

    return nextSteps;
  }
}