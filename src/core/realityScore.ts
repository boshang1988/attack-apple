/**
 * Reality Score System - Hallucination Detection via Testability
 *
 * Core insight: The more testable/verifiable an edit is, the more "real" it is.
 * High reality score = grounded in verifiable facts
 * Low reality score = potentially hallucinated
 *
 * This scoring system works even without running full RL tournaments -
 * it provides instant feedback on whether an edit is likely to be real.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, dirname, join, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { logDebug } from '../utils/debugLogger.js';

/**
 * Reality score breakdown for an edit operation
 */
export interface RealityScore {
  /** Overall reality score 0-100 (higher = more real/testable) */
  total: number;

  /** Individual component scores */
  components: {
    /** Does the target file exist? (0-20) */
    fileExists: number;
    /** Does the old_string content actually exist in the file? (0-25) */
    contentMatch: number;
    /** Will the resulting code be syntactically valid? (0-20) */
    syntaxValid: number;
    /** Are imports/dependencies real and resolvable? (0-15) */
    importsValid: number;
    /** Can we run a quick test to verify? (0-20) */
    testable: number;
  };

  /** Confidence level based on what we could verify */
  confidence: 'high' | 'medium' | 'low';

  /** Potential hallucination indicators */
  warnings: string[];

  /** What tests/checks passed */
  passed: string[];

  /** What tests/checks failed */
  failed: string[];
}

/**
 * Edit operation to score
 */
export interface EditOperation {
  filePath: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

/**
 * Score an edit operation for reality/testability
 */
export function scoreEditReality(edit: EditOperation): RealityScore {
  const score: RealityScore = {
    total: 0,
    components: {
      fileExists: 0,
      contentMatch: 0,
      syntaxValid: 0,
      importsValid: 0,
      testable: 0,
    },
    confidence: 'low',
    warnings: [],
    passed: [],
    failed: [],
  };

  // 1. File exists check (0-20 points)
  score.components.fileExists = scoreFileExists(edit.filePath, score);

  // 2. Content match check (0-25 points) - most important for hallucination detection
  if (score.components.fileExists > 0) {
    score.components.contentMatch = scoreContentMatch(edit, score);
  }

  // 3. Syntax validity check (0-20 points)
  score.components.syntaxValid = scoreSyntaxValidity(edit, score);

  // 4. Import/dependency validity (0-15 points)
  score.components.importsValid = scoreImportsValidity(edit, score);

  // 5. Testability score (0-20 points)
  score.components.testable = scoreTestability(edit, score);

  // Calculate total
  score.total =
    score.components.fileExists +
    score.components.contentMatch +
    score.components.syntaxValid +
    score.components.importsValid +
    score.components.testable;

  // Determine confidence
  if (score.total >= 75 && score.warnings.length === 0) {
    score.confidence = 'high';
  } else if (score.total >= 50) {
    score.confidence = 'medium';
  } else {
    score.confidence = 'low';
  }

  logDebug(`Reality score for ${edit.filePath}: ${score.total}/100 (${score.confidence})`);

  return score;
}

/**
 * Score file existence (0-20 points)
 */
function scoreFileExists(filePath: string, score: RealityScore): number {
  try {
    if (existsSync(filePath)) {
      const stats = statSync(filePath);
      if (stats.isFile()) {
        score.passed.push('Target file exists');
        return 20;
      } else {
        score.warnings.push('Path exists but is not a file');
        score.failed.push('Target is not a file');
        return 5;
      }
    } else {
      // Check if it's a new file creation (directory exists)
      const dir = dirname(filePath);
      if (existsSync(dir)) {
        score.passed.push('Parent directory exists (new file creation)');
        return 15; // Slightly lower for new files
      }
      score.warnings.push('File does not exist and parent directory missing');
      score.failed.push('Target file not found');
      return 0;
    }
  } catch {
    score.failed.push('Could not check file existence');
    return 0;
  }
}

/**
 * Score content match - does old_string actually exist? (0-25 points)
 * This is the key hallucination detector
 */
function scoreContentMatch(edit: EditOperation, score: RealityScore): number {
  try {
    const content = readFileSync(edit.filePath, 'utf-8');

    // Empty old_string means we're appending/creating
    if (!edit.oldString || edit.oldString.trim() === '') {
      score.passed.push('Append/create operation (no content to match)');
      return 20; // Slightly lower since we can't verify
    }

    // Check for exact match
    if (content.includes(edit.oldString)) {
      score.passed.push('Old content found in file (exact match)');
      return 25;
    }

    // Check for normalized match (whitespace differences)
    const normalizedContent = content.replace(/\s+/g, ' ').trim();
    const normalizedOld = edit.oldString.replace(/\s+/g, ' ').trim();

    if (normalizedContent.includes(normalizedOld)) {
      score.warnings.push('Content match with whitespace differences');
      score.passed.push('Old content found (whitespace-normalized)');
      return 18;
    }

    // Check for partial match (at least 80% of lines)
    const oldLines = edit.oldString.split('\n').filter(l => l.trim());
    const contentLines = content.split('\n');
    let matchedLines = 0;

    for (const oldLine of oldLines) {
      const trimmedOld = oldLine.trim();
      if (trimmedOld && contentLines.some(cl => cl.includes(trimmedOld))) {
        matchedLines++;
      }
    }

    const matchRatio = oldLines.length > 0 ? matchedLines / oldLines.length : 0;

    if (matchRatio >= 0.8) {
      score.warnings.push(`Partial content match (${Math.round(matchRatio * 100)}% of lines)`);
      score.passed.push('Partial content match found');
      return Math.round(15 * matchRatio);
    }

    // HALLUCINATION DETECTED: Content doesn't exist
    score.warnings.push('HALLUCINATION RISK: old_string not found in file');
    score.failed.push('Old content not found in file');
    return 0;
  } catch (error) {
    score.failed.push('Could not read file for content match');
    return 0;
  }
}

/**
 * Score syntax validity of the new code (0-20 points)
 */
function scoreSyntaxValidity(edit: EditOperation, score: RealityScore): number {
  const ext = extname(edit.filePath).toLowerCase();

  // Skip syntax check for non-code files
  if (!['.ts', '.tsx', '.js', '.jsx', '.json', '.py', '.go', '.rs'].includes(ext)) {
    score.passed.push('Non-code file (syntax check skipped)');
    return 15; // Give some points but not full
  }

  try {
    // JSON validation
    if (ext === '.json') {
      try {
        // Try to parse the new content as JSON if it looks complete
        if (edit.newString.trim().startsWith('{') || edit.newString.trim().startsWith('[')) {
          JSON.parse(edit.newString);
          score.passed.push('JSON syntax valid');
          return 20;
        }
        score.passed.push('JSON fragment (partial validation)');
        return 15;
      } catch {
        score.warnings.push('JSON syntax may be invalid');
        score.failed.push('JSON parse error');
        return 5;
      }
    }

    // TypeScript/JavaScript basic validation
    if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
      const syntaxIssues = checkJSTSSyntax(edit.newString);
      if (syntaxIssues.length === 0) {
        score.passed.push('JS/TS syntax appears valid');
        return 20;
      } else {
        score.warnings.push(...syntaxIssues);
        // Partial score based on severity
        return Math.max(5, 20 - syntaxIssues.length * 3);
      }
    }

    // Python basic validation
    if (ext === '.py') {
      const syntaxIssues = checkPythonSyntax(edit.newString);
      if (syntaxIssues.length === 0) {
        score.passed.push('Python syntax appears valid');
        return 20;
      } else {
        score.warnings.push(...syntaxIssues);
        return Math.max(5, 20 - syntaxIssues.length * 3);
      }
    }

    score.passed.push('Basic syntax check passed');
    return 15;
  } catch {
    score.failed.push('Syntax validation error');
    return 10;
  }
}

/**
 * Basic JS/TS syntax checks
 */
function checkJSTSSyntax(code: string): string[] {
  const issues: string[] = [];

  // Check balanced braces/brackets/parens
  const balanceCheck = checkBalancedDelimiters(code);
  if (balanceCheck) issues.push(balanceCheck);

  // Check for common syntax errors
  if (/\bfunction\s+\(/.test(code) && !/\bfunction\s*\*?\s*\w+\s*\(/.test(code) && !/\bfunction\s*\(/.test(code)) {
    // This is actually valid for anonymous functions, skip
  }

  // Check for incomplete statements
  if (/^\s*(const|let|var)\s+\w+\s*$/.test(code.trim())) {
    issues.push('Incomplete variable declaration');
  }

  // Check for obviously broken syntax
  if (/\)\s*\{[^}]*$/.test(code) && !code.includes('}')) {
    issues.push('Unclosed function/block');
  }

  return issues;
}

/**
 * Basic Python syntax checks
 */
function checkPythonSyntax(code: string): string[] {
  const issues: string[] = [];

  // Check for consistent indentation
  const lines = code.split('\n');
  let expectedIndent = 0;

  for (const line of lines) {
    if (line.trim() === '') continue;

    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;

    // Check for mixed tabs and spaces
    if (line.match(/^\t+ +/) || line.match(/^ +\t+/)) {
      issues.push('Mixed tabs and spaces in indentation');
      break;
    }

    // Check if indentation is a multiple of 2 or 4
    if (indent > 0 && indent % 2 !== 0 && indent % 4 !== 0) {
      issues.push('Inconsistent indentation');
      break;
    }
  }

  // Check for unclosed strings
  const singleQuotes = (code.match(/'/g) || []).length;
  const doubleQuotes = (code.match(/"/g) || []).length;
  const tripleQuotes = (code.match(/"""/g) || []).length;

  if ((singleQuotes - tripleQuotes * 3) % 2 !== 0) {
    issues.push('Potentially unclosed single-quoted string');
  }

  return issues;
}

/**
 * Check balanced delimiters
 */
function checkBalancedDelimiters(code: string): string | null {
  const stack: string[] = [];
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const closers = new Set(Object.values(pairs));

  // Remove string contents to avoid false positives
  const codeWithoutStrings = code
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');

  for (const char of codeWithoutStrings) {
    if (pairs[char]) {
      stack.push(pairs[char]);
    } else if (closers.has(char)) {
      if (stack.length === 0 || stack.pop() !== char) {
        return `Unbalanced delimiter: unexpected '${char}'`;
      }
    }
  }

  if (stack.length > 0) {
    return `Unclosed delimiter: missing '${stack[stack.length - 1]}'`;
  }

  return null;
}

/**
 * Score import/dependency validity (0-15 points)
 */
function scoreImportsValidity(edit: EditOperation, score: RealityScore): number {
  const ext = extname(edit.filePath).toLowerCase();

  if (!['.ts', '.tsx', '.js', '.jsx', '.py'].includes(ext)) {
    score.passed.push('Non-import file type');
    return 10;
  }

  try {
    const imports = extractImports(edit.newString, ext);

    if (imports.length === 0) {
      score.passed.push('No imports to validate');
      return 15;
    }

    let validImports = 0;
    const workingDir = dirname(edit.filePath);

    for (const imp of imports) {
      if (isValidImport(imp, workingDir, ext)) {
        validImports++;
      } else {
        score.warnings.push(`Potentially invalid import: ${imp}`);
      }
    }

    const ratio = validImports / imports.length;

    if (ratio === 1) {
      score.passed.push('All imports appear valid');
      return 15;
    } else if (ratio >= 0.7) {
      score.passed.push(`Most imports valid (${validImports}/${imports.length})`);
      return Math.round(15 * ratio);
    } else {
      score.warnings.push('HALLUCINATION RISK: Many imports may be invalid');
      score.failed.push(`Many invalid imports (${imports.length - validImports}/${imports.length})`);
      return Math.round(15 * ratio);
    }
  } catch {
    score.failed.push('Import validation error');
    return 5;
  }
}

/**
 * Extract imports from code
 */
function extractImports(code: string, ext: string): string[] {
  const imports: string[] = [];

  if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
    // ES6 imports
    const esImports = code.matchAll(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g);
    for (const match of esImports) {
      if (match[1]) imports.push(match[1]);
    }

    // CommonJS requires
    const cjsImports = code.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
    for (const match of cjsImports) {
      if (match[1]) imports.push(match[1]);
    }
  } else if (ext === '.py') {
    // Python imports
    const pyImports = code.matchAll(/(?:from\s+(\S+)\s+import|import\s+(\S+))/g);
    for (const match of pyImports) {
      const mod = match[1] || match[2];
      if (mod) imports.push(mod.split('.')[0] ?? mod);
    }
  }

  return [...new Set(imports)];
}

/**
 * Check if an import is valid
 */
function isValidImport(importPath: string, workingDir: string, ext: string): boolean {
  // Node built-ins
  const nodeBuiltins = new Set([
    'fs', 'path', 'os', 'util', 'events', 'stream', 'http', 'https',
    'crypto', 'buffer', 'child_process', 'cluster', 'dgram', 'dns',
    'net', 'readline', 'repl', 'tls', 'tty', 'url', 'v8', 'vm', 'zlib',
    'assert', 'async_hooks', 'console', 'constants', 'domain', 'inspector',
    'perf_hooks', 'process', 'punycode', 'querystring', 'string_decoder',
    'timers', 'trace_events', 'worker_threads', 'node:fs', 'node:path',
    'node:os', 'node:util', 'node:events', 'node:stream', 'node:http',
    'node:https', 'node:crypto', 'node:buffer', 'node:child_process',
  ]);

  // Python standard library (common modules)
  const pythonStdlib = new Set([
    'os', 'sys', 'json', 're', 'math', 'datetime', 'collections', 'itertools',
    'functools', 'typing', 'pathlib', 'subprocess', 'threading', 'asyncio',
    'logging', 'argparse', 'unittest', 'pytest', 'time', 'random', 'copy',
    'pickle', 'socket', 'http', 'urllib', 'email', 'html', 'xml', 'sqlite3',
    'csv', 'io', 'shutil', 'tempfile', 'glob', 'hashlib', 'base64', 'struct',
  ]);

  // Check built-ins
  if (ext === '.py') {
    if (pythonStdlib.has(importPath)) return true;
  } else {
    if (nodeBuiltins.has(importPath) || importPath.startsWith('node:')) return true;
  }

  // Relative imports - check if file exists
  if (importPath.startsWith('.')) {
    const extensions = ext === '.py' ? ['.py', ''] : ['.ts', '.tsx', '.js', '.jsx', '.json', ''];

    for (const tryExt of extensions) {
      const fullPath = join(workingDir, importPath + tryExt);
      if (existsSync(fullPath)) return true;

      // Check for index file
      const indexPath = join(workingDir, importPath, `index${tryExt}`);
      if (existsSync(indexPath)) return true;
    }

    return false;
  }

  // Package imports - check node_modules or assume valid for common packages
  const commonPackages = new Set([
    'react', 'vue', 'angular', 'express', 'lodash', 'axios', 'moment',
    'chalk', 'commander', 'inquirer', 'ora', 'yargs', 'typescript',
    'webpack', 'rollup', 'vite', 'esbuild', 'jest', 'mocha', 'chai',
    '@types', '@babel', '@typescript-eslint', 'eslint', 'prettier',
    'numpy', 'pandas', 'requests', 'flask', 'django', 'fastapi',
    'tensorflow', 'torch', 'sklearn', 'matplotlib', 'scipy',
  ]);

  const packageName = importPath.split('/')[0] ?? importPath;
  if (commonPackages.has(packageName)) return true;

  // Check node_modules
  try {
    // Walk up to find node_modules
    let dir = workingDir;
    for (let i = 0; i < 10; i++) {
      const nodeModulesPath = join(dir, 'node_modules', packageName);
      if (existsSync(nodeModulesPath)) return true;

      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // Ignore errors
  }

  // Can't verify - give benefit of doubt for external packages
  return true;
}

/**
 * Score testability - can we verify this edit? (0-20 points)
 */
function scoreTestability(edit: EditOperation, score: RealityScore): number {
  const ext = extname(edit.filePath).toLowerCase();
  const fileName = basename(edit.filePath);

  let testabilityScore = 0;

  // Check if there are related test files
  const testPatterns = [
    edit.filePath.replace(ext, `.test${ext}`),
    edit.filePath.replace(ext, `.spec${ext}`),
    edit.filePath.replace('/src/', '/test/'),
    edit.filePath.replace('/src/', '/__tests__/'),
  ];

  for (const pattern of testPatterns) {
    if (existsSync(pattern)) {
      score.passed.push(`Related test file exists: ${basename(pattern)}`);
      testabilityScore += 5;
      break;
    }
  }

  // Check if file is in a testable project (has package.json with test script)
  try {
    let dir = dirname(edit.filePath);
    for (let i = 0; i < 5; i++) {
      const pkgPath = join(dir, 'package.json');
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (pkg.scripts?.test) {
          score.passed.push('Project has test script');
          testabilityScore += 5;
        }
        if (pkg.scripts?.build || pkg.scripts?.typecheck) {
          score.passed.push('Project has build/typecheck script');
          testabilityScore += 3;
        }
        break;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // Ignore errors
  }

  // TypeScript files can be type-checked
  if (['.ts', '.tsx'].includes(ext)) {
    score.passed.push('TypeScript (can be type-checked)');
    testabilityScore += 4;
  }

  // Check if edit introduces testable patterns
  if (edit.newString.includes('export ')) {
    score.passed.push('Has exports (testable interface)');
    testabilityScore += 3;
  }

  // Cap at 20
  return Math.min(20, testabilityScore);
}

/**
 * Quick reality check - returns true if edit is likely real, false if potentially hallucinated
 */
export function quickRealityCheck(edit: EditOperation): { isReal: boolean; reason: string } {
  // Fast checks only

  // 1. File must exist for edits (not creates)
  if (edit.oldString && edit.oldString.trim()) {
    if (!existsSync(edit.filePath)) {
      return { isReal: false, reason: 'File does not exist' };
    }

    // 2. Old content must exist in file
    try {
      const content = readFileSync(edit.filePath, 'utf-8');
      if (!content.includes(edit.oldString)) {
        // Try normalized match
        const normalizedContent = content.replace(/\s+/g, ' ');
        const normalizedOld = edit.oldString.replace(/\s+/g, ' ');
        if (!normalizedContent.includes(normalizedOld)) {
          return { isReal: false, reason: 'Content to replace not found in file' };
        }
      }
    } catch {
      return { isReal: false, reason: 'Could not read file' };
    }
  }

  return { isReal: true, reason: 'Basic checks passed' };
}

/**
 * Get a human-readable summary of the reality score
 */
export function formatRealityScore(score: RealityScore): string {
  const emoji = score.confidence === 'high' ? '✓' : score.confidence === 'medium' ? '?' : '⚠';
  const color = score.confidence === 'high' ? 'green' : score.confidence === 'medium' ? 'yellow' : 'red';

  let summary = `${emoji} Reality Score: ${score.total}/100 (${score.confidence} confidence)\n`;

  if (score.warnings.length > 0) {
    summary += `\nWarnings:\n${score.warnings.map(w => `  - ${w}`).join('\n')}`;
  }

  if (score.passed.length > 0 && score.confidence !== 'high') {
    summary += `\nPassed:\n${score.passed.map(p => `  ✓ ${p}`).join('\n')}`;
  }

  if (score.failed.length > 0) {
    summary += `\nFailed:\n${score.failed.map(f => `  ✗ ${f}`).join('\n')}`;
  }

  return summary;
}

/**
 * Score threshold recommendations
 */
export const REALITY_THRESHOLDS = {
  /** Edits below this score should be rejected */
  REJECT: 25,
  /** Edits below this score need human review */
  REVIEW: 50,
  /** Edits at or above this score can proceed automatically */
  AUTO_APPROVE: 75,
};

// ============================================================================
// RL-Style Feedback Loop - Learning from Edit Outcomes
// ============================================================================

/**
 * Edit outcome for RL feedback
 */
export interface EditOutcome {
  /** Timestamp of the edit */
  timestamp: number;
  /** File that was edited */
  filePath: string;
  /** Reality score at time of edit */
  realityScore: number;
  /** Confidence level */
  confidence: 'high' | 'medium' | 'low';
  /** Did the edit succeed without issues? */
  success: boolean;
  /** Was there a build error after? */
  buildError?: boolean;
  /** Was there a test failure after? */
  testFailure?: boolean;
  /** Was the edit reverted? */
  reverted?: boolean;
  /** Time until outcome was determined (ms) */
  outcomeDelayMs?: number;
}

/**
 * RL feedback statistics
 */
export interface RLFeedbackStats {
  /** Total edits tracked */
  totalEdits: number;
  /** Success rate by confidence level */
  successRates: {
    high: { total: number; success: number; rate: number };
    medium: { total: number; success: number; rate: number };
    low: { total: number; success: number; rate: number };
  };
  /** Average score for successful edits */
  avgSuccessScore: number;
  /** Average score for failed edits */
  avgFailureScore: number;
  /** Optimal threshold (where success rate crosses 80%) */
  optimalThreshold: number;
  /** Score distribution */
  scoreDistribution: {
    '0-25': number;
    '26-50': number;
    '51-75': number;
    '76-100': number;
  };
}

// In-memory RL feedback buffer (persisted per session)
const editOutcomes: EditOutcome[] = [];
const MAX_OUTCOMES = 1000;

/**
 * Record an edit outcome for RL learning
 */
export function recordEditOutcome(outcome: EditOutcome): void {
  editOutcomes.push(outcome);

  // Limit buffer size
  if (editOutcomes.length > MAX_OUTCOMES) {
    editOutcomes.shift();
  }

  // Log for debugging
  const status = outcome.success ? '✓' : '✗';
  logDebug(`RL Feedback: ${status} score=${outcome.realityScore} file=${outcome.filePath}`);
}

/**
 * Record a successful edit
 */
export function recordSuccessfulEdit(
  filePath: string,
  score: RealityScore,
  outcomeDelayMs?: number
): void {
  recordEditOutcome({
    timestamp: Date.now(),
    filePath,
    realityScore: score.total,
    confidence: score.confidence,
    success: true,
    outcomeDelayMs,
  });
}

/**
 * Record a failed edit (build error, test failure, revert)
 */
export function recordFailedEdit(
  filePath: string,
  score: RealityScore,
  reason: 'build_error' | 'test_failure' | 'reverted' | 'other'
): void {
  recordEditOutcome({
    timestamp: Date.now(),
    filePath,
    realityScore: score.total,
    confidence: score.confidence,
    success: false,
    buildError: reason === 'build_error',
    testFailure: reason === 'test_failure',
    reverted: reason === 'reverted',
  });
}

/**
 * Calculate RL feedback statistics
 */
export function calculateRLStats(): RLFeedbackStats {
  const stats: RLFeedbackStats = {
    totalEdits: editOutcomes.length,
    successRates: {
      high: { total: 0, success: 0, rate: 0 },
      medium: { total: 0, success: 0, rate: 0 },
      low: { total: 0, success: 0, rate: 0 },
    },
    avgSuccessScore: 0,
    avgFailureScore: 0,
    optimalThreshold: REALITY_THRESHOLDS.REVIEW,
    scoreDistribution: {
      '0-25': 0,
      '26-50': 0,
      '51-75': 0,
      '76-100': 0,
    },
  };

  if (editOutcomes.length === 0) {
    return stats;
  }

  let successScoreSum = 0;
  let successCount = 0;
  let failureScoreSum = 0;
  let failureCount = 0;

  for (const outcome of editOutcomes) {
    // Count by confidence
    stats.successRates[outcome.confidence].total++;
    if (outcome.success) {
      stats.successRates[outcome.confidence].success++;
      successScoreSum += outcome.realityScore;
      successCount++;
    } else {
      failureScoreSum += outcome.realityScore;
      failureCount++;
    }

    // Score distribution
    if (outcome.realityScore <= 25) {
      stats.scoreDistribution['0-25']++;
    } else if (outcome.realityScore <= 50) {
      stats.scoreDistribution['26-50']++;
    } else if (outcome.realityScore <= 75) {
      stats.scoreDistribution['51-75']++;
    } else {
      stats.scoreDistribution['76-100']++;
    }
  }

  // Calculate rates
  for (const level of ['high', 'medium', 'low'] as const) {
    const { total, success } = stats.successRates[level];
    stats.successRates[level].rate = total > 0 ? success / total : 0;
  }

  // Calculate averages
  stats.avgSuccessScore = successCount > 0 ? successScoreSum / successCount : 0;
  stats.avgFailureScore = failureCount > 0 ? failureScoreSum / failureCount : 0;

  // Calculate optimal threshold (score where success rate is ~80%)
  // Group outcomes by score buckets and find crossover point
  const buckets = new Map<number, { success: number; total: number }>();
  for (const outcome of editOutcomes) {
    const bucket = Math.floor(outcome.realityScore / 10) * 10;
    const current = buckets.get(bucket) ?? { success: 0, total: 0 };
    current.total++;
    if (outcome.success) current.success++;
    buckets.set(bucket, current);
  }

  // Find the lowest score bucket with >= 80% success rate
  for (const score of [0, 10, 20, 30, 40, 50, 60, 70, 80, 90]) {
    const bucket = buckets.get(score);
    if (bucket && bucket.total >= 3) { // Minimum sample size
      const rate = bucket.success / bucket.total;
      if (rate >= 0.8) {
        stats.optimalThreshold = score;
        break;
      }
    }
  }

  return stats;
}

/**
 * Get RL feedback recommendation for current session
 */
export function getRLRecommendation(): string {
  const stats = calculateRLStats();

  if (stats.totalEdits < 10) {
    return 'Insufficient data for RL recommendation (need 10+ edits)';
  }

  const lines: string[] = [
    `📊 RL Feedback Summary (${stats.totalEdits} edits)`,
    '',
  ];

  // Success rates by confidence
  lines.push('Success Rates by Confidence:');
  for (const level of ['high', 'medium', 'low'] as const) {
    const { total, rate } = stats.successRates[level];
    if (total > 0) {
      const emoji = rate >= 0.8 ? '✓' : rate >= 0.5 ? '?' : '✗';
      lines.push(`  ${emoji} ${level}: ${Math.round(rate * 100)}% (n=${total})`);
    }
  }

  lines.push('');
  lines.push(`Average Score - Success: ${Math.round(stats.avgSuccessScore)} / Failure: ${Math.round(stats.avgFailureScore)}`);
  lines.push(`Recommended Threshold: ${stats.optimalThreshold}`);

  // Actionable recommendation
  if (stats.avgFailureScore > REALITY_THRESHOLDS.REVIEW) {
    lines.push('');
    lines.push('⚠ Warning: Failures occurring at high scores - check for runtime issues');
  }

  if (stats.successRates.low.rate > 0.5 && stats.successRates.low.total >= 5) {
    lines.push('');
    lines.push('💡 Low-confidence edits succeeding often - threshold may be too conservative');
  }

  return lines.join('\n');
}

/**
 * Clear RL feedback buffer (for testing or reset)
 */
export function clearRLFeedback(): void {
  editOutcomes.length = 0;
}
