/**
 * Apple Security Audit Module
 * 
 * Comprehensive security audit system that integrates with AGI Core UI
 * and provides real-time security assessment of Apple products and services.
 */

import chalk from 'chalk';
import { AppleSecurityIntegration, type AppleSecurityConfig, type AppleSecurityFinding } from './appleSecurityIntegration.js';
// Unified UI system - AppleSecurityUI is deprecated
// Using UnifiedUIRenderer for all UI needs
import {
  createSecurityBanner,
  createSecuritySpinner,
  formatSecurityFinding,
  formatSecuritySummary,
  formatSecurityStatus,
  formatAuditProgress,
  createBanner,
  formatProgress
} from '../ui/UnifiedUIRenderer.js';

export interface AppleSecurityAuditOptions extends Partial<AppleSecurityConfig> {
  /** Enable UI integration for real-time display */
  enableUI: boolean;
  /** Enable real-time progress updates */
  realTimeUpdates: boolean;
  /** Output format: 'text', 'json', or 'both' */
  outputFormat: 'text' | 'json' | 'both';
  /** Generate detailed reports */
  generateReports: boolean;
  /** Enable interactive mode for remediation */
  interactiveRemediation: boolean;
}

export interface AuditProgress {
  phase: string;
  step: number;
  totalSteps: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  message: string;
  findings: AppleSecurityFinding[];
  metrics: Record<string, any>;
}

export class AppleSecurityAudit {
  private integration: AppleSecurityIntegration;
  private ui: any; // AppleSecurityUI is deprecated
  private options: AppleSecurityAuditOptions;
  private progress: AuditProgress;
  private eventCallbacks: Map<string, Function[]>;
  
  constructor(options?: Partial<AppleSecurityAuditOptions>) {
    this.options = {
      enableUI: true,
      realTimeUpdates: true,
      outputFormat: 'both',
      generateReports: true,
      interactiveRemediation: false,
      aggressive: false,
      evidencePrefix: 'agi-apple-audit',
      rateLimit: 1000,
      targetScope: 'all',
      enableExploitation: false,
      enableRemediation: true,
      outputDir: process.cwd(),
      ...options
    };

    this.integration = new AppleSecurityIntegration(this.options);
    // UnifiedUIRenderer provides all UI functions
    this.ui = {
      createSecurityBanner,
      createSecuritySpinner,
      formatSecurityFinding,
      formatSecuritySummary,
      formatSecurityStatus,
      formatAuditProgress,
      // Fallback methods for unused AppleSecurityUI features
      formatVulnerability: (vuln: any) => `${chalk.red(`[${vuln.severity?.toUpperCase() || 'UNKNOWN'}]`)} ${vuln.name || 'Unknown'}: ${vuln.description || 'No description'}`,
      formatRemediation: (category: string, steps: string[]) => `${chalk.green(`[${category}]`)} ${steps.join('\n  ')}`,
      formatFindingsTable: (findings: any[]) => findings.map(f => `${chalk.red(`[${f.severity}]`)} ${f.name}`).join('\n'),
      categoryColors: {},
      severityColors: {},
      getServiceIcon: () => '🛡️'
    };
    this.eventCallbacks = new Map();
    
    this.progress = {
      phase: 'initializing',
      step: 0,
      totalSteps: 7, // 7 audit phases
      status: 'pending',
      message: 'Initializing Apple Security Audit',
      findings: [],
      metrics: {}
    };
  }

  /**
   * Get all findings from the audit
   */
  getFindings(): AppleSecurityFinding[] {
    return this.progress.findings;
  }

  /**
   * Register event callback
   */
  on(event: 'progress' | 'finding' | 'phase_start' | 'phase_complete' | 'audit_complete', callback: Function): void {
    if (!this.eventCallbacks.has(event)) {
      this.eventCallbacks.set(event, []);
    }
    this.eventCallbacks.get(event)!.push(callback);
  }

  /**
   * Emit event to registered callbacks
   */
  private emit(event: string, data?: any): void {
    if (this.eventCallbacks.has(event)) {
      this.eventCallbacks.get(event)!.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in ${event} callback:`, error);
        }
      });
    }
  }

  /**
   * Update progress and emit events
   */
  private updateProgress(update: Partial<AuditProgress>): void {
    this.progress = { ...this.progress, ...update };
    
    if (this.options.realTimeUpdates) {
      this.emit('progress', this.progress);
      
      if (this.options.enableUI) {
        this.displayProgress();
      }
    }
  }

  /**
   * Display progress in UI
   */
  private displayProgress(): void {
    if (!this.options.enableUI) return;

    const { phase, step, totalSteps, status, message } = this.progress;

    switch (status) {
      case 'running':
        console.log(this.ui.createSecuritySpinner(message));
        console.log(this.ui.formatAuditProgress(phase, step, totalSteps));
        break;
      case 'completed':
        console.log(`\n${this.ui.createSecurityBanner('Audit Phase Complete', phase)}`);
        break;
      case 'failed':
        console.error(`\n${this.ui.createSecurityBanner('Audit Phase Failed', phase)}`);
        break;
    }
  }

  /**
   * AGENT REFINER: Helper method to aggregate findings from phase results
   * This ensures consistent findings collection across ALL phases
   */
  private aggregateFindings(result: any, phaseName: string): void {
    if (result?.findings && Array.isArray(result.findings)) {
      // Add phase tag to each finding for traceability
      const taggedFindings = result.findings.map((f: any) => ({
        ...f,
        phase: phaseName,
        collectedAt: new Date().toISOString()
      }));
      this.progress.findings.push(...taggedFindings);

      // Emit finding events for real-time tracking
      taggedFindings.forEach((finding: any) => {
        this.emit('finding', finding);
      });
    }
  }

  /**
   * AGENT REFINER: Complete phase with findings aggregation
   */
  private completePhase(phaseName: string, step: number, message: string, result: any): void {
    this.aggregateFindings(result, phaseName);

    this.updateProgress({
      step,
      status: 'completed',
      message,
      findings: this.progress.findings,
      metrics: {
        ...this.progress.metrics,
        [`${phaseName}_count`]: result?.findings?.length ?? 0,
        totalFindings: this.progress.findings.length
      }
    });

    this.emit('phase_complete', { phase: phaseName, result });
  }

  /**
   * Phase 1: Service Discovery with UI integration
   */
  private async phase1ServiceDiscovery(): Promise<any> {
    this.updateProgress({
      phase: 'service_discovery',
      step: 1,
      status: 'running',
      message: 'Discovering Apple services...'
    });

    this.emit('phase_start', { phase: 'service_discovery' });
    
    try {
      const result = await this.integration.phase1ServiceDiscovery();
      
      if (this.options.enableUI) {
        console.log(`\n${this.ui.createSecurityBanner('Apple Service Discovery')}`);
        console.log(`Discovered ${result.services.length} Apple services across categories:\n`);
        
        // Display services by category
        const categories = new Map<string, any[]>();
        result.services.forEach(service => {
          if (!categories.has(service.category)) {
            categories.set(service.category, []);
          }
          categories.get(service.category)!.push(service);
        });
        
        categories.forEach((services, category) => {
          console.log(`${this.ui.categoryColors[category as keyof typeof this.ui.categoryColors]?.bold?.(category.toUpperCase()) || chalk.white.bold(category.toUpperCase())}: ${services.length} services`);
          services.slice(0, 3).forEach(service => {
            console.log(`  ${this.ui.getServiceIcon(service.category)} ${service.domain}`);
          });
          if (services.length > 3) {
            console.log(`  ${chalk.gray(`... and ${services.length - 3} more`)}`);
          }
          console.log();
        });
      }
      
      // AGENT REFINER: Use unified phase completion with findings aggregation
      this.completePhase('service_discovery', 2, `Discovered ${result.services.length} Apple services`, result);
      return result;
    } catch (error) {
      this.updateProgress({
        status: 'failed',
        message: `Service discovery failed: ${error instanceof Error ? error.message : String(error)}`
      });
      throw error;
    }
  }

  /**
   * Phase 2: Vulnerability Assessment with UI integration
   */
  private async phase2VulnerabilityAssessment(): Promise<any> {
    this.updateProgress({
      phase: 'vulnerability_assessment',
      step: 2,
      status: 'running',
      message: 'Assessing Apple vulnerabilities...'
    });

    this.emit('phase_start', { phase: 'vulnerability_assessment' });
    
    try {
      const result = await this.integration.phase2VulnerabilityAssessment();
      
      if (this.options.enableUI) {
        console.log(`\n${this.ui.createSecurityBanner('Apple Vulnerability Assessment')}`);
        
        // Count vulnerabilities by severity
        const severityCounts: Record<string, number> = {};
        result.vulnerabilities.forEach(vuln => {
          severityCounts[vuln.severity] = (severityCounts[vuln.severity] || 0) + 1;
        });
        
        console.log(`Assessed ${result.vulnerabilities.length} vulnerabilities:\n`);
        
        Object.entries(severityCounts).forEach(([severity, count]) => {
          const color = this.ui.severityColors[severity as keyof typeof this.ui.severityColors];
          console.log(`  ${color?.(severity.toUpperCase()) || severity.toUpperCase()}: ${count}`);
        });
        
        console.log(`\n${chalk.cyan('Top Vulnerabilities:')}`);
        result.vulnerabilities
          .filter(v => v.severity === 'critical' || v.severity === 'high')
          .slice(0, 3)
          .forEach(vuln => {
            console.log(this.ui.formatVulnerability(vuln));
            console.log();
          });
      }
      
      // AGENT REFINER: Use unified phase completion with findings aggregation
      this.completePhase('vulnerability_assessment', 3, `Assessed ${result.vulnerabilities.length} vulnerabilities`, result);
      return result;
    } catch (error) {
      this.updateProgress({
        status: 'failed',
        message: `Vulnerability assessment failed: ${error instanceof Error ? error.message : String(error)}`
      });
      throw error;
    }
  }

  /**
   * Phase 3: Security Hardening with UI integration
   */
  private async phase3SecurityHardening(): Promise<any> {
    this.updateProgress({
      phase: 'security_hardening',
      step: 3,
      status: 'running',
      message: 'Generating security hardening recommendations...'
    });

    this.emit('phase_start', { phase: 'security_hardening' });
    
    try {
      const result = await this.integration.phase3SecurityHardening();
      
      if (this.options.enableUI) {
        console.log(`\n${this.ui.createSecurityBanner('Security Hardening Recommendations')}`);
        
        console.log(`Generated ${result.recommendations.length} categories with ${result.recommendations.reduce((acc, rec) => acc + rec.steps.length, 0)} recommendations:\n`);
        
        result.recommendations.forEach(rec => {
          console.log(this.ui.formatRemediation(rec.category, rec.steps));
          console.log();
        });
      }
      
      // AGENT REFINER: Use unified phase completion with findings aggregation
      this.completePhase('security_hardening', 4, 'Generated security hardening recommendations', result);
      return result;
    } catch (error) {
      this.updateProgress({
        status: 'failed',
        message: `Security hardening failed: ${error instanceof Error ? error.message : String(error)}`
      });
      throw error;
    }
  }

  /**
   * Phase 4: AGI Core Integration with UI
   */
  private async phase4AgiIntegration(): Promise<any> {
    this.updateProgress({
      phase: 'agi_integration',
      step: 4,
      status: 'running',
      message: 'Checking AGI Core integration capabilities...'
    });

    this.emit('phase_start', { phase: 'agi_integration' });
    
    try {
      const result = await this.integration.phase4AgiIntegration();
      
      if (this.options.enableUI) {
        console.log(`\n${this.ui.createSecurityBanner('AGI Core Integration')}`);
        
        const implementedCount = result.integrations.filter(i => i.implemented).length;
        const totalCount = result.integrations.length;
        const implementationRate = Math.round((implementedCount / totalCount) * 100);
        
        console.log(`Integration Status: ${implementedCount}/${totalCount} (${implementationRate}%)\n`);
        
        result.integrations.forEach(integration => {
          const status = integration.implemented ? chalk.green('[IMPLEMENTED]') : chalk.yellow('[PLANNED]');
          console.log(`${status} ${chalk.white(integration.capability)}`);
          console.log(`  ${chalk.gray(integration.description)}\n`);
        });
      }
      
      // AGENT REFINER: Use unified phase completion with findings aggregation
      this.completePhase('agi_integration', 5, 'Checked AGI Core integration capabilities', result);
      return result;
    } catch (error) {
      this.updateProgress({
        status: 'failed',
        message: `AGI Core integration check failed: ${error instanceof Error ? error.message : String(error)}`
      });
      throw error;
    }
  }

  /**
   * Phase 5: Generate comprehensive report
   */
  private async phase5GenerateReport(): Promise<any> {
    this.updateProgress({
      phase: 'report_generation',
      step: 5,
      status: 'running',
      message: 'Generating comprehensive security report...'
    });

    this.emit('phase_start', { phase: 'report_generation' });
    
    try {
      const result = await this.integration.phase5GenerateReport();
      
      if (this.options.enableUI) {
        console.log(`\n${this.ui.createSecurityBanner('Security Report Generation')}`);
        console.log(this.ui.formatSecuritySummary(result.report));
        
        if (result.report.executiveSummary.criticalFindings > 0) {
          console.log(`\n${chalk.red.bold('⚠ CRITICAL FINDINGS DETECTED ⚠')}`);
          console.log(chalk.red(`  Immediate action required for ${result.report.executiveSummary.criticalFindings} critical findings`));
        }
        
        console.log(`\n${chalk.cyan('Reports Generated:')}`);
        console.log(`  Text report: ${chalk.cyan(result.report.metadata.evidenceDirectory + '/security_report.txt')}`);
        console.log(`  JSON report: ${chalk.cyan(result.report.metadata.evidenceDirectory + '/security_report.json')}`);
      }
      
      this.updateProgress({
        step: 6,
        status: 'completed',
        message: 'Generated comprehensive security report'
      });
      
      this.emit('phase_complete', {
        phase: 'report_generation',
        result
      });
      
      return result;
    } catch (error) {
      this.updateProgress({
        status: 'failed',
        message: `Report generation failed: ${error instanceof Error ? error.message : String(error)}`
      });
      throw error;
    }
  }

  /**
   * Phase 6: Interactive remediation (if enabled)
   */
  private async phase6InteractiveRemediation(): Promise<any> {
    if (!this.options.interactiveRemediation) {
      this.updateProgress({
        phase: 'interactive_remediation',
        step: 6,
        status: 'completed',
        message: 'Interactive remediation skipped'
      });
      return { skipped: true };
    }

    this.updateProgress({
      phase: 'interactive_remediation',
      step: 6,
      status: 'running',
      message: 'Starting interactive remediation...'
    });

    this.emit('phase_start', { phase: 'interactive_remediation' });
    
    try {
      if (this.options.enableUI) {
        console.log(`\n${this.ui.createSecurityBanner('Interactive Remediation')}`);
        console.log(chalk.yellow('Interactive remediation mode requires manual implementation.'));
        console.log(chalk.gray('Please review the security report and implement recommendations.'));
      }
      
      this.updateProgress({
        step: 7,
        status: 'completed',
        message: 'Interactive remediation completed'
      });
      
      this.emit('phase_complete', {
        phase: 'interactive_remediation',
        result: { interactive: true, manual: true }
      });
      
      return { interactive: true, manual: true };
    } catch (error) {
      this.updateProgress({
        status: 'failed',
        message: `Interactive remediation failed: ${error instanceof Error ? error.message : String(error)}`
      });
      throw error;
    }
  }

  /**
   * Phase 7: Final summary and cleanup
   */
  private async phase7FinalSummary(): Promise<any> {
    this.updateProgress({
      phase: 'final_summary',
      step: 7,
      status: 'running',
      message: 'Generating final audit summary...'
    });

    this.emit('phase_start', { phase: 'final_summary' });
    
    try {
      const finalResults = await this.integration.runFullIntegration();
      
      if (this.options.enableUI) {
        console.log(`\n${this.ui.createSecurityBanner('Apple Security Audit Complete', 'Final Summary')}`);
        
        // Display comprehensive summary
        console.log(this.ui.formatSecuritySummary(finalResults));
        
        // Display findings table
        if (finalResults.findings.length > 0) {
          console.log(`\n${chalk.cyan('Security Findings Table:')}`);
          console.log(this.ui.formatFindingsTable(finalResults.findings));
        }
        
        // Security status
        const criticalFindings = finalResults.findings.filter(f => f.severity === 'critical').length;
        const highFindings = finalResults.findings.filter(f => f.severity === 'high').length;
        
        let securityStatus: 'healthy' | 'degraded' | 'unavailable';
        let statusMessage: string;
        
        if (criticalFindings > 0) {
          securityStatus = 'unavailable';
          statusMessage = `${criticalFindings} critical findings require immediate attention`;
        } else if (highFindings > 0) {
          securityStatus = 'degraded';
          statusMessage = `${highFindings} high findings need prompt remediation`;
        } else {
          securityStatus = 'healthy';
          statusMessage = 'No critical or high findings detected';
        }
        
        console.log(`\n${this.ui.formatSecurityStatus(securityStatus, statusMessage)}`);
      }
      
      this.updateProgress({
        status: 'completed',
        message: 'Apple Security Audit completed successfully'
      });
      
      this.emit('phase_complete', {
        phase: 'final_summary',
        result: finalResults
      });
      
      this.emit('audit_complete', finalResults);
      
      return finalResults;
    } catch (error) {
      this.updateProgress({
        status: 'failed',
        message: `Final summary failed: ${error instanceof Error ? error.message : String(error)}`
      });
      throw error;
    }
  }

  /**
   * Run complete Apple security audit
   */
  async runFullAudit(): Promise<any> {
    console.log(this.ui.createSecurityBanner('Apple Security Audit', 'Comprehensive Security Assessment'));
    
    try {
      // Phase 1: Service Discovery
      await this.phase1ServiceDiscovery();
      
      // Phase 2: Vulnerability Assessment
      await this.phase2VulnerabilityAssessment();
      
      // Phase 3: Security Hardening
      await this.phase3SecurityHardening();
      
      // Phase 4: AGI Core Integration
      await this.phase4AgiIntegration();

      // Phase 5: Generate Report
      await this.phase5GenerateReport();

      // Phase 6: Interactive Remediation (if enabled)
      if (this.options.interactiveRemediation) {
        await this.phase6InteractiveRemediation();
      }

      // Phase 7: Final Summary
      const results = await this.phase7FinalSummary();

      return results;
    } catch (error) {
      this.updateProgress({
        status: 'failed',
        message: `Audit failed: ${error instanceof Error ? error.message : String(error)}`
      });
      throw error;
    }
  }
}