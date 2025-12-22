/**
 * Hallucination Guard - Advanced validation to minimize AI hallucinations
 * 
 * Features:
 * 1. Content validation before edits
 * 2. Fact verification for web search results
 * 3. Confidence scoring for AI outputs
 * 4. Cross-referencing with existing knowledge
 */

import { existsSync } from 'node:fs';

export interface HallucinationCheck {
  type: 'content_guess' | 'fact_claim' | 'code_pattern' | 'file_existence';
  confidence: 'high' | 'medium' | 'low';
  riskLevel: 'critical' | 'warning' | 'info';
  message: string;
  suggestion: string;
}

export interface HallucinationReport {
  checks: HallucinationCheck[];
  overallRisk: 'critical' | 'warning' | 'safe';
  confidenceScore: number; // 0-100
}

/**
 * Validate AI content for hallucinations before execution
 */
export class HallucinationGuard {
  private readonly workingDir: string;
  private readonly knownFacts: Map<string, number> = new Map();

  constructor(options: { workingDir?: string } = {}) {
    this.workingDir = options.workingDir ?? process.cwd();
  }

  /**
   * Validate file operations for hallucinations
   */
  validateFileOperation(
    toolName: string,
    args: Record<string, unknown>,
    existingContent?: string
  ): HallucinationReport {
    const checks: HallucinationCheck[] = [];
    const toolLower = toolName.toLowerCase();

    // === Edit Tool Validation ===
    if (toolLower === 'edit') {
      const oldString = args['old_string'] as string | undefined;
      const filePath = args['file_path'] as string | undefined;

      // Check 1: Edit without existing content reference
      if (oldString && existingContent) {
        const similarity = this.calculateContentSimilarity(oldString, existingContent);
        if (similarity < 0.5) {
          checks.push({
            type: 'content_guess',
            confidence: 'high',
            riskLevel: 'critical',
            message: `Low content similarity (${Math.round(similarity * 100)}%) - AI may be guessing file content`,
            suggestion: 'Verify exact file content matches old_string. Use Read tool to confirm.',
          });
        }
      }

      // Check 2: File existence validation
      if (filePath && !existsSync(filePath) && oldString) {
        checks.push({
          type: 'file_existence',
          confidence: 'high',
          riskLevel: 'warning',
          message: `Editing non-existent file: ${filePath}`,
          suggestion: 'Check if file exists before editing. Use empty old_string for new file creation.',
        });
      }
    }

    // === Search Operations ===
    if (toolLower.includes('search') || toolLower.includes('grep')) {
      const pattern = args['pattern'] as string | undefined;
      if (pattern && this.isOverlyBroadPattern(pattern)) {
        checks.push({
          type: 'code_pattern',
          confidence: 'medium',
          riskLevel: 'warning',
          message: `Search pattern '${pattern}' is very broad and may produce overwhelming results`,
          suggestion: 'Use more specific patterns or add file type filters.',
        });
      }
    }

    // === Web Operations ===
    if (toolLower.includes('web') || toolLower.includes('search')) {
      const query = args['query'] as string | undefined;
      if (query && this.containsFactClaim(query)) {
        checks.push({
          type: 'fact_claim',
          confidence: 'low',
          riskLevel: 'info',
          message: 'Query contains factual claims that should be verified',
          suggestion: 'Cross-reference results with authoritative sources.',
        });
      }
    }

    return this.generateReport(checks);
  }

  /**
   * Validate AI-generated code for common hallucination patterns
   */
  validateGeneratedCode(code: string, _context?: string): HallucinationReport {
    const checks: HallucinationCheck[] = [];

    // Check for placeholder patterns
    const placeholderPatterns = [
      /\{\{.*?\}\}/g,      // {{variable}}
      /\[\[.*?\]\]/g,      // [[placeholder]]
      /<TODO>/gi,          // <TODO>
      /FIXME/gi,           // FIXME (in generated code)
    ];

    for (const pattern of placeholderPatterns) {
      const matches = code.match(pattern);
      if (matches) {
        checks.push({
          type: 'content_guess',
          confidence: 'high',
          riskLevel: 'critical',
          message: `Placeholder patterns found in generated code: ${matches.slice(0, 3).join(', ')}`,
          suggestion: 'Replace placeholders with actual implementation based on context.',
        });
      }
    }

    // Check for unrealistic imports
    const importPatterns = [
      /import\s+.*\s+from\s+['"][@\w\-/]+['"]/g,
    ];
    
    const imports = code.match(importPatterns[0]) || [];
    for (const imp of imports) {
      if (imp.includes('undefined-package') || imp.includes('example-library')) {
        checks.push({
          type: 'code_pattern',
          confidence: 'medium',
          riskLevel: 'warning',
          message: `Suspicious import pattern: ${imp}`,
          suggestion: 'Verify package names and availability in the project.',
        });
      }
    }

    return this.generateReport(checks);
  }

  /**
   * Register known facts from previous operations to cross-reference
   */
  registerFact(fact: string, source: string, confidence: number): void {
    const key = `${source}:${fact}`;
    this.knownFacts.set(key, confidence);
  }

  /**
   * Check if a claim contradicts known facts
   */
  checkFactContradiction(claim: string): HallucinationCheck | null {
    const claimLower = claim.toLowerCase();
    
    for (const [key, confidence] of this.knownFacts.entries()) {
      const [, fact] = key.split(':');
      const factLower = fact.toLowerCase();
      
      // Simple contradiction detection
      if (this.areContradictory(claimLower, factLower)) {
        return {
          type: 'fact_claim',
          confidence: confidence > 0.7 ? 'high' : 'medium',
          riskLevel: 'warning',
          message: `Claim contradicts previously established fact: ${fact}`,
          suggestion: 'Verify information consistency across operations.',
        };
      }
    }
    
    return null;
  }

  private calculateContentSimilarity(a: string, b: string): number {
    // Simple similarity calculation for validation
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
    const union = new Set([...wordsA, ...wordsB]);
    
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  private isOverlyBroadPattern(pattern: string): boolean {
    // Patterns that match everything
    const broadPatterns = [
      /^.*$/,
      /^\.*$/,
      /^\w*$/,
      /^[a-zA-Z]*$/,
    ];
    
    return broadPatterns.some(p => p.test(pattern));
  }

  private containsFactClaim(text: string): boolean {
    const factIndicators = [
      'is', 'are', 'was', 'were', 'will be',
      'has', 'have', 'had',
      'can', 'cannot', 'could', 'would',
      'always', 'never', 'every', 'all',
      'true', 'false', 'correct', 'incorrect',
    ];
    
    const words = text.toLowerCase().split(/\s+/);
    return words.some(word => factIndicators.includes(word));
  }

  private areContradictory(claim: string, fact: string): boolean {
    // Simple contradiction detection
    const contradictions = [
      ['is', 'is not'],
      ['has', 'has no'],
      ['can', 'cannot'],
      ['true', 'false'],
      ['always', 'never'],
    ];
    
    return contradictions.some(([a, b]) => 
      (claim.includes(a) && fact.includes(b)) || 
      (claim.includes(b) && fact.includes(a))
    );
  }

  private generateReport(checks: HallucinationCheck[]): HallucinationReport {
    if (checks.length === 0) {
      return {
        checks: [],
        overallRisk: 'safe',
        confidenceScore: 100,
      };
    }

    const riskScores = {
      'critical': 3,
      'warning': 2,
      'info': 1,
    };

    const confidenceScores = {
      'high': 1.0,
      'medium': 0.7,
      'low': 0.3,
    };

    let totalRisk = 0;
    let maxRisk = 0;
    
    for (const check of checks) {
      const riskScore = riskScores[check.riskLevel];
      const confidence = confidenceScores[check.confidence];
      
      totalRisk += riskScore * confidence;
      maxRisk = Math.max(maxRisk, riskScore * confidence);
    }

    const averageRisk = totalRisk / checks.length;
    const overallRisk = averageRisk >= 2.5 ? 'critical' : averageRisk >= 1.5 ? 'warning' : 'safe';
    
    // Confidence score: 100 - (risk * 20)
    const confidenceScore = Math.max(0, Math.min(100, 100 - (averageRisk * 20)));

    return {
      checks,
      overallRisk,
      confidenceScore,
    };
  }
}

/**
 * Enhanced validation that integrates with existing tool runtime
 */
export function enhanceWithHallucinationGuard(
  toolName: string,
  args: Record<string, unknown>,
  existingContent?: string
): HallucinationReport {
  const guard = new HallucinationGuard();
  return guard.validateFileOperation(toolName, args, existingContent);
}