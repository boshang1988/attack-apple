/**
 * AGI Core - Unified Autonomous General Intelligence for Software Engineering
 *
 * This is the central intelligence module that provides:
 * 1. Unified prompt understanding and routing
 * 2. Real task decomposition and planning
 * 3. Persistent learning and memory
 * 4. Autonomous execution with verification
 *
 * NO SIMULATIONS - All operations execute real tools
 */

import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { getEpisodicMemory, type EpisodicMemory, type Episode, type MemorySearchResult } from './episodicMemory.js';
import { getSelfUpgrade, SelfUpgrade, type UpgradeSessionState, type RLUpgradeContext } from './selfUpgrade.js';
import { getHotReload, HotReload } from './hotReload.js';

// ============================================================================
// CORE TYPES
// ============================================================================

export interface AGIContext {
  workingDir: string;
  sessionId: string;
  startTime: number;
  memory: AGIMemory;
}

export interface AGIMemory {
  /** Learned patterns from successful operations */
  patterns: LearnedPattern[];
  /** Recent operations for context */
  recentOps: OperationRecord[];
  /** Project-specific knowledge */
  projectKnowledge: ProjectKnowledge;
}

export interface LearnedPattern {
  id: string;
  trigger: string;
  successfulApproach: string;
  tools: string[];
  successCount: number;
  lastUsed: number;
}

export interface OperationRecord {
  id: string;
  prompt: string;
  interpretation: string;
  tasks: string[];
  success: boolean;
  timestamp: number;
  duration: number;
  toolsUsed: string[];
  errors?: string[];
}

export interface ProjectKnowledge {
  type: 'node' | 'python' | 'rust' | 'go' | 'java' | 'unknown';
  buildSystem: string | null;
  testCommand: string | null;
  lintCommand: string | null;
  entryPoints: string[];
  dependencies: Record<string, string>;
  lastAnalyzed: number;
}

// ============================================================================
// TASK TYPES
// ============================================================================

export interface AGITask {
  id: string;
  description: string;
  category: TaskCategory;
  tools: string[];
  dependencies: string[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  result?: TaskResult;
}

export type TaskCategory =
  | 'analysis'      // Read/understand code or data
  | 'search'        // Find files/content/patterns
  | 'execution'     // Run commands/scripts
  | 'modification'  // Edit/write code
  | 'verification'  // Test/validate changes
  | 'communication' // Report/explain to user
  | 'research'      // Web search, data gathering
  | 'generation'    // Create documents, reports, code
  | 'computation'   // Mathematical/scientific calculations
  | 'automation'    // Automate workflows
  ;

export interface TaskResult {
  success: boolean;
  output: string;
  duration: number;
  artifacts?: string[];
  errors?: string[];
}

// ============================================================================
// PROMPT UNDERSTANDING
// ============================================================================

export interface PromptAnalysis {
  originalPrompt: string;
  interpretation: string;
  intent: PromptIntent;
  category: PromptCategory;
  confidence: number;
  tasks: AGITask[];
  clarificationNeeded: string[];
}

export type PromptIntent =
  // Software Engineering
  | 'fix_bugs'
  | 'add_feature'
  | 'refactor'
  | 'test'
  | 'document'
  | 'deploy'
  | 'analyze'
  | 'explain'
  | 'optimize'
  | 'security_audit'
  | 'setup'
  | 'migrate'
  // Research & Science
  | 'research'
  | 'data_analysis'
  | 'scientific_computing'
  // Business & Legal
  | 'legal_research'
  | 'business_analysis'
  | 'financial_analysis'
  // Automation & Operations
  | 'automate'
  | 'monitor'
  // Generic
  | 'generic_task'
  ;

export type PromptCategory =
  | 'code_modification'
  | 'code_analysis'
  | 'infrastructure'
  | 'testing'
  | 'documentation'
  | 'research'
  | 'automation'
  // Non-SWE categories
  | 'scientific'
  | 'business'
  | 'legal'
  | 'financial'
  | 'operations'
  | 'general_coding'
  ;

// ============================================================================
// AGI CORE CLASS
// ============================================================================

export class AGICore extends EventEmitter {
  private context: AGIContext;
  private memoryPath: string;
  private episodicMemory: EpisodicMemory;
  private currentEpisodeId: string | null = null;
  private selfUpgrade: SelfUpgrade;
  private hotReload: HotReload;
  private upgradeCheckPromise: Promise<void> | null = null;

  constructor(workingDir?: string) {
    super();
    const dir = workingDir || process.cwd();
    this.memoryPath = path.join(dir, '.agi', 'agi-memory.json');

    this.context = {
      workingDir: dir,
      sessionId: `agi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      startTime: Date.now(),
      memory: this.loadMemory(),
    };

    // Initialize episodic memory system
    this.episodicMemory = getEpisodicMemory();

    // Initialize self-upgrade system
    this.selfUpgrade = getSelfUpgrade({
      workingDir: dir,
      autoRestart: true,
      logger: (msg) => this.emit('upgrade:log', msg),
    });

    // Initialize hot-reload system
    this.hotReload = getHotReload({
      workingDir: dir,
      autoCheck: true,
      checkInterval: 5 * 60 * 1000, // Check every 5 minutes
      logger: (msg) => this.emit('hotReload:log', msg),
    });

    // Forward upgrade events
    this.selfUpgrade.on('upgrade', (event) => this.emit('upgrade', event));
    this.hotReload.on('hotReload', (event) => this.emit('hotReload', event));

    // Check for upgrade on initialization (non-blocking)
    this.upgradeCheckPromise = this.checkForUpgradeOnStart();

    // Analyze project on initialization
    this.analyzeProject();
  }

  /**
   * Non-blocking upgrade check on startup
   */
  private async checkForUpgradeOnStart(): Promise<void> {
    try {
      const versionInfo = await this.selfUpgrade.checkForUpdates();
      if (versionInfo.updateAvailable) {
        this.emit('upgrade:available', {
          current: versionInfo.current,
          latest: versionInfo.latest,
        });
      }
    } catch {
      // Non-blocking, ignore errors
    }
  }

  // ==========================================================================
  // MEMORY MANAGEMENT - Real Persistent Learning
  // ==========================================================================

  private loadMemory(): AGIMemory {
    try {
      if (fs.existsSync(this.memoryPath)) {
        const data = fs.readFileSync(this.memoryPath, 'utf-8');
        return JSON.parse(data) as AGIMemory;
      }
    } catch {
      // Start fresh if memory is corrupted
    }
    return this.createEmptyMemory();
  }

  private createEmptyMemory(): AGIMemory {
    return {
      patterns: [],
      recentOps: [],
      projectKnowledge: {
        type: 'unknown',
        buildSystem: null,
        testCommand: null,
        lintCommand: null,
        entryPoints: [],
        dependencies: {},
        lastAnalyzed: 0,
      },
    };
  }

  private saveMemory(): void {
    try {
      const dir = path.dirname(this.memoryPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.memoryPath, JSON.stringify(this.context.memory, null, 2));
    } catch (error) {
      this.emit('warning', `Failed to save memory: ${error}`);
    }
  }

  /**
   * Learn from a successful operation
   */
  learnFromSuccess(prompt: string, approach: string, tools: string[]): void {
    const existingPattern = this.context.memory.patterns.find(
      p => this.normalizePrompt(p.trigger) === this.normalizePrompt(prompt)
    );

    if (existingPattern) {
      existingPattern.successCount++;
      existingPattern.lastUsed = Date.now();
      existingPattern.successfulApproach = approach;
      existingPattern.tools = tools;
    } else {
      this.context.memory.patterns.push({
        id: `pattern-${Date.now()}`,
        trigger: prompt,
        successfulApproach: approach,
        tools,
        successCount: 1,
        lastUsed: Date.now(),
      });
    }

    // Keep only most useful patterns (limit to 100)
    this.context.memory.patterns = this.context.memory.patterns
      .sort((a, b) => (b.successCount * 0.7 + (b.lastUsed - a.lastUsed) / 86400000 * 0.3) -
                      (a.successCount * 0.7 + (a.lastUsed - b.lastUsed) / 86400000 * 0.3))
      .slice(0, 100);

    this.saveMemory();
  }

  /**
   * Record an operation for context
   */
  recordOperation(op: OperationRecord): void {
    this.context.memory.recentOps.unshift(op);
    // Keep last 50 operations
    this.context.memory.recentOps = this.context.memory.recentOps.slice(0, 50);
    this.saveMemory();
  }

  /**
   * Get learned approach for similar prompts
   */
  getLearnedApproach(prompt: string): LearnedPattern | null {
    const normalized = this.normalizePrompt(prompt);
    return this.context.memory.patterns.find(
      p => this.normalizePrompt(p.trigger) === normalized ||
           this.promptSimilarity(p.trigger, prompt) > 0.7
    ) || null;
  }

  private normalizePrompt(prompt: string): string {
    return prompt.toLowerCase().trim().replace(/[^\w\s]/g, '');
  }

  private promptSimilarity(a: string, b: string): number {
    const wordsA = new Set(this.normalizePrompt(a).split(/\s+/));
    const wordsB = new Set(this.normalizePrompt(b).split(/\s+/));
    const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
    const union = new Set([...wordsA, ...wordsB]);
    return intersection.size / union.size;
  }

  // ==========================================================================
  // PROJECT ANALYSIS - Understand the Codebase
  // ==========================================================================

  private analyzeProject(): void {
    const knowledge = this.context.memory.projectKnowledge;
    const dir = this.context.workingDir;

    // Check for package.json (Node.js)
    const packageJsonPath = path.join(dir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        knowledge.type = 'node';
        knowledge.dependencies = { ...pkg.dependencies, ...pkg.devDependencies };

        if (pkg.scripts) {
          knowledge.testCommand = pkg.scripts.test ? 'npm test' : null;
          knowledge.lintCommand = pkg.scripts.lint ? 'npm run lint' : null;
          knowledge.buildSystem = pkg.scripts.build ? 'npm run build' : null;
        }

        if (pkg.main) {
          knowledge.entryPoints.push(pkg.main);
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Check for pyproject.toml or setup.py (Python)
    if (fs.existsSync(path.join(dir, 'pyproject.toml')) ||
        fs.existsSync(path.join(dir, 'setup.py'))) {
      knowledge.type = 'python';
      knowledge.testCommand = 'pytest';
      knowledge.lintCommand = 'ruff check .';
    }

    // Check for Cargo.toml (Rust)
    if (fs.existsSync(path.join(dir, 'Cargo.toml'))) {
      knowledge.type = 'rust';
      knowledge.testCommand = 'cargo test';
      knowledge.lintCommand = 'cargo clippy';
      knowledge.buildSystem = 'cargo build';
    }

    // Check for go.mod (Go)
    if (fs.existsSync(path.join(dir, 'go.mod'))) {
      knowledge.type = 'go';
      knowledge.testCommand = 'go test ./...';
      knowledge.lintCommand = 'golangci-lint run';
      knowledge.buildSystem = 'go build';
    }

    knowledge.lastAnalyzed = Date.now();
    this.saveMemory();
  }

  // ==========================================================================
  // PROMPT UNDERSTANDING - Parse and Interpret User Requests
  // ==========================================================================

  /**
   * Analyze a user prompt and produce a comprehensive execution plan
   */
  analyzePrompt(prompt: string): PromptAnalysis {
    const lower = prompt.toLowerCase().trim();

    // Check for learned patterns first
    const learned = this.getLearnedApproach(prompt);
    if (learned && learned.successCount >= 2) {
      return this.createFromLearnedPattern(prompt, learned);
    }

    // Determine intent
    const intent = this.determineIntent(lower);
    const category = this.determineCategory(intent);

    // Generate tasks based on intent
    const tasks = this.generateTasks(prompt, intent);

    // Check for ambiguity
    const clarificationNeeded = this.checkAmbiguity(prompt, intent);

    return {
      originalPrompt: prompt,
      interpretation: this.generateInterpretation(prompt, intent),
      intent,
      category,
      confidence: clarificationNeeded.length === 0 ? 0.9 : 0.6,
      tasks,
      clarificationNeeded,
    };
  }

  private determineIntent(lower: string): PromptIntent {
    // Order matters! More specific patterns first.

    // =========================================================================
    // NON-SWE DOMAINS (check first for domain-specific keywords)
    // =========================================================================

    // Legal/Litigation (sue, lawsuit, court, legal action)
    if (/\bsue\b|lawsuit|litigation|legal\s+action|\bcourt\b|attorney|lawyer|complaint|motion|brief/i.test(lower)) {
      return 'legal_research';
    }

    // Financial/Accounting (accounting, bookkeeping, tax, financial)
    if (/accounting|bookkeeping|financ|tax\b|ledger|balance\s*sheet|invoice|payroll|budget|forecast/i.test(lower)) {
      return 'financial_analysis';
    }

    // Scientific Research (cure, research, experiment, hypothesis, study)
    if (/\bcure\b|research|experiment|hypothesis|scientific|laboratory|clinical|biomedical|genome|molecular/i.test(lower)) {
      return 'research';
    }

    // Data Analysis/Science (data analysis, ML, statistics, visualization)
    if (/data\s+(?:analysis|science|engineer)|statistic|machine\s+learning|\bml\b|\bai\b|neural|dataset/i.test(lower)) {
      return 'data_analysis';
    }

    // Engineering/Science (engineering, physics, chemistry, simulation)
    if (/engineer(?:ing)?|physic|chemist|simulat|cad\b|finite\s+element|signal\s+process/i.test(lower)) {
      return 'scientific_computing';
    }

    // Business Analysis (business, strategy, market, competitor)
    if (/business|strateg|\bmarket\b|competitor|swot|business\s+plan/i.test(lower)) {
      return 'business_analysis';
    }

    // Automation/Operations (automate, workflow, schedule, cron)
    // Note: "pipeline" without "CI" or "CD" context - those go to setup
    if (/\bautomat|\bworkflow|\bschedule|\bcron\b|batch\s+process/i.test(lower)) {
      return 'automate';
    }

    // Data pipeline (ETL, data pipeline) - separate from CI/CD
    if (/(?:data|etl)\s+pipeline/i.test(lower)) {
      return 'automate';
    }

    // Monitoring (monitor, alert, dashboard, metrics, observability)
    if (/\bmonitor|alert|dashboard|metric|observab|logging|trace/i.test(lower)) {
      return 'monitor';
    }

    // =========================================================================
    // SOFTWARE ENGINEERING DOMAINS
    // =========================================================================

    // Security audit (check before general 'audit')
    if (/security|vulnerab|pentest|secure/i.test(lower)) {
      return 'security_audit';
    }

    // Optimization (check before 'improve' which could be refactor)
    if (/optim|faster|performance|speed\s*up|slow/i.test(lower)) {
      return 'optimize';
    }

    // Explanation (check before 'document' - "explain" is for understanding, not writing docs)
    if (/\bwhat\b|\bhow\b.*work|\bwhy\b|\bexplain\b|\bunderstand/i.test(lower)) {
      return 'explain';
    }

    // Bug fixing
    if (/fix|bug|error|issue|broken|crash|fail/i.test(lower)) {
      return 'fix_bugs';
    }

    // Setup/Configuration (check before 'add' - configure is setup, not adding)
    if (/setup|install|configure|init/i.test(lower)) {
      return 'setup';
    }

    // Feature addition
    if (/add|create|implement|build|new|feature/i.test(lower)) {
      return 'add_feature';
    }

    // Refactoring (check 'improve' here after optimization is handled)
    if (/refactor|clean|improve|reorganize|restructure/i.test(lower)) {
      return 'refactor';
    }

    // Testing
    if (/test|spec|coverage|verify/i.test(lower)) {
      return 'test';
    }

    // Documentation
    if (/document|readme|comment|doc\b/i.test(lower)) {
      return 'document';
    }

    // Deployment
    if (/deploy|release|publish|ship/i.test(lower)) {
      return 'deploy';
    }

    // Analysis (general analysis, after security)
    if (/analyze|review|audit|check|inspect/i.test(lower)) {
      return 'analyze';
    }

    // Migration
    if (/migrate|upgrade|update|version/i.test(lower)) {
      return 'migrate';
    }

    return 'generic_task';
  }

  private determineCategory(intent: PromptIntent): PromptCategory {
    const mapping: Record<PromptIntent, PromptCategory> = {
      // Software Engineering
      'fix_bugs': 'code_modification',
      'add_feature': 'code_modification',
      'refactor': 'code_modification',
      'test': 'testing',
      'document': 'documentation',
      'deploy': 'infrastructure',
      'analyze': 'code_analysis',
      'explain': 'research',
      'optimize': 'code_modification',
      'security_audit': 'code_analysis',
      'setup': 'infrastructure',
      'migrate': 'code_modification',
      // Research & Science
      'research': 'scientific',
      'data_analysis': 'scientific',
      'scientific_computing': 'scientific',
      // Business & Legal
      'legal_research': 'legal',
      'business_analysis': 'business',
      'financial_analysis': 'financial',
      // Automation & Operations
      'automate': 'automation',
      'monitor': 'operations',
      // Generic
      'generic_task': 'general_coding',
    };
    return mapping[intent];
  }

  private generateInterpretation(prompt: string, intent: PromptIntent): string {
    const interpretations: Record<PromptIntent, string> = {
      // Software Engineering
      'fix_bugs': `Identify and fix bugs/errors in the codebase based on: "${prompt}"`,
      'add_feature': `Implement new functionality: "${prompt}"`,
      'refactor': `Improve code structure and quality: "${prompt}"`,
      'test': `Create or run tests: "${prompt}"`,
      'document': `Create or update documentation: "${prompt}"`,
      'deploy': `Prepare and execute deployment: "${prompt}"`,
      'analyze': `Analyze and review: "${prompt}"`,
      'explain': `Explain and clarify: "${prompt}"`,
      'optimize': `Improve performance: "${prompt}"`,
      'security_audit': `Security review and hardening: "${prompt}"`,
      'setup': `Set up and configure: "${prompt}"`,
      'migrate': `Migrate or upgrade: "${prompt}"`,
      // Research & Science
      'research': `Build research tools and analysis pipeline for: "${prompt}"`,
      'data_analysis': `Create data analysis pipeline and visualizations for: "${prompt}"`,
      'scientific_computing': `Build scientific computing tools for: "${prompt}"`,
      // Business & Legal
      'legal_research': `Legal research and document automation for: "${prompt}"`,
      'business_analysis': `Business analysis and strategy tools for: "${prompt}"`,
      'financial_analysis': `Financial analysis and reporting tools for: "${prompt}"`,
      // Automation & Operations
      'automate': `Build automation workflow for: "${prompt}"`,
      'monitor': `Create monitoring and alerting system for: "${prompt}"`,
      // Generic
      'generic_task': `Execute task: "${prompt}"`,
    };
    return interpretations[intent];
  }

  private generateTasks(prompt: string, intent: PromptIntent): AGITask[] {
    const tasks: AGITask[] = [];
    const knowledge = this.context.memory.projectKnowledge;

    switch (intent) {
      case 'fix_bugs':
        // First: analyze the codebase
        tasks.push({
          id: 'analyze-errors',
          description: 'Run type checker and linter to identify issues',
          category: 'execution',
          tools: ['Bash'],
          dependencies: [],
          status: 'pending',
        });

        if (knowledge.testCommand) {
          tasks.push({
            id: 'run-tests',
            description: 'Run test suite to find failing tests',
            category: 'execution',
            tools: ['Bash'],
            dependencies: [],
            status: 'pending',
          });
        }

        tasks.push({
          id: 'search-issues',
          description: 'Search for TODO/FIXME comments and known issues',
          category: 'search',
          tools: ['Grep'],
          dependencies: [],
          status: 'pending',
        });

        tasks.push({
          id: 'analyze-findings',
          description: 'Analyze all findings and prioritize fixes',
          category: 'analysis',
          tools: ['Read'],
          dependencies: ['analyze-errors', 'search-issues'],
          status: 'pending',
        });

        tasks.push({
          id: 'fix-issues',
          description: 'Apply fixes to identified issues',
          category: 'modification',
          tools: ['Edit'],
          dependencies: ['analyze-findings'],
          status: 'pending',
        });

        tasks.push({
          id: 'verify-fixes',
          description: 'Verify fixes by re-running checks',
          category: 'verification',
          tools: ['Bash'],
          dependencies: ['fix-issues'],
          status: 'pending',
        });
        break;

      case 'add_feature':
        tasks.push({
          id: 'understand-codebase',
          description: 'Analyze existing code structure',
          category: 'analysis',
          tools: ['Glob', 'Read'],
          dependencies: [],
          status: 'pending',
        });

        tasks.push({
          id: 'plan-implementation',
          description: 'Plan the implementation approach',
          category: 'analysis',
          tools: ['Read'],
          dependencies: ['understand-codebase'],
          status: 'pending',
        });

        tasks.push({
          id: 'implement-feature',
          description: 'Write the feature code',
          category: 'modification',
          tools: ['Edit', 'Write'],
          dependencies: ['plan-implementation'],
          status: 'pending',
        });

        tasks.push({
          id: 'add-tests',
          description: 'Add tests for the new feature',
          category: 'modification',
          tools: ['Edit', 'Write'],
          dependencies: ['implement-feature'],
          status: 'pending',
        });

        tasks.push({
          id: 'verify-feature',
          description: 'Run tests and verify feature works',
          category: 'verification',
          tools: ['Bash'],
          dependencies: ['add-tests'],
          status: 'pending',
        });
        break;

      case 'analyze':
      case 'explain':
        tasks.push({
          id: 'explore-structure',
          description: 'Explore project structure',
          category: 'search',
          tools: ['Glob', 'Bash'],
          dependencies: [],
          status: 'pending',
        });

        tasks.push({
          id: 'read-key-files',
          description: 'Read and understand key files',
          category: 'analysis',
          tools: ['Read'],
          dependencies: ['explore-structure'],
          status: 'pending',
        });

        tasks.push({
          id: 'summarize-findings',
          description: 'Summarize and explain findings',
          category: 'communication',
          tools: [],
          dependencies: ['read-key-files'],
          status: 'pending',
        });
        break;

      case 'test':
        if (knowledge.testCommand) {
          tasks.push({
            id: 'run-existing-tests',
            description: 'Run existing test suite',
            category: 'execution',
            tools: ['Bash'],
            dependencies: [],
            status: 'pending',
          });
        }

        tasks.push({
          id: 'analyze-coverage',
          description: 'Analyze test coverage',
          category: 'analysis',
          tools: ['Bash', 'Read'],
          dependencies: [],
          status: 'pending',
        });

        tasks.push({
          id: 'identify-gaps',
          description: 'Identify testing gaps',
          category: 'analysis',
          tools: ['Grep', 'Read'],
          dependencies: ['analyze-coverage'],
          status: 'pending',
        });

        tasks.push({
          id: 'write-tests',
          description: 'Write new tests for uncovered code',
          category: 'modification',
          tools: ['Edit', 'Write'],
          dependencies: ['identify-gaps'],
          status: 'pending',
        });
        break;

      case 'security_audit':
        tasks.push({
          id: 'dependency-audit',
          description: 'Audit dependencies for known vulnerabilities',
          category: 'execution',
          tools: ['Bash'],
          dependencies: [],
          status: 'pending',
        });

        tasks.push({
          id: 'code-patterns',
          description: 'Search for insecure code patterns',
          category: 'search',
          tools: ['Grep'],
          dependencies: [],
          status: 'pending',
        });

        tasks.push({
          id: 'analyze-security',
          description: 'Analyze security findings',
          category: 'analysis',
          tools: ['Read'],
          dependencies: ['dependency-audit', 'code-patterns'],
          status: 'pending',
        });

        tasks.push({
          id: 'report-findings',
          description: 'Report security findings with recommendations',
          category: 'communication',
          tools: [],
          dependencies: ['analyze-security'],
          status: 'pending',
        });
        break;

      // =====================================================================
      // NON-SWE DOMAIN TASKS
      // =====================================================================

      case 'research':
        // Scientific/Medical Research (e.g., "cure cancer")
        tasks.push({
          id: 'define-scope',
          description: 'Define research scope and objectives',
          category: 'analysis',
          tools: ['Read'],
          dependencies: [],
          status: 'pending',
        });

        tasks.push({
          id: 'gather-data',
          description: 'Gather relevant data and research materials',
          category: 'research',
          tools: ['Bash', 'Read'],
          dependencies: ['define-scope'],
          status: 'pending',
        });

        tasks.push({
          id: 'build-pipeline',
          description: 'Build data processing and analysis pipeline',
          category: 'generation',
          tools: ['Edit', 'Write', 'Bash'],
          dependencies: ['gather-data'],
          status: 'pending',
        });

        tasks.push({
          id: 'implement-analysis',
          description: 'Implement analysis algorithms and models',
          category: 'generation',
          tools: ['Edit', 'Write'],
          dependencies: ['build-pipeline'],
          status: 'pending',
        });

        tasks.push({
          id: 'generate-report',
          description: 'Generate analysis report with findings',
          category: 'communication',
          tools: ['Edit', 'Write'],
          dependencies: ['implement-analysis'],
          status: 'pending',
        });
        break;

      case 'data_analysis':
        tasks.push({
          id: 'explore-data',
          description: 'Explore and understand the data',
          category: 'analysis',
          tools: ['Read', 'Bash'],
          dependencies: [],
          status: 'pending',
        });

        tasks.push({
          id: 'clean-data',
          description: 'Clean and preprocess data',
          category: 'execution',
          tools: ['Bash', 'Edit'],
          dependencies: ['explore-data'],
          status: 'pending',
        });

        tasks.push({
          id: 'analyze-patterns',
          description: 'Analyze patterns and statistics',
          category: 'computation',
          tools: ['Bash', 'Edit'],
          dependencies: ['clean-data'],
          status: 'pending',
        });

        tasks.push({
          id: 'create-visualizations',
          description: 'Create visualizations and charts',
          category: 'generation',
          tools: ['Edit', 'Bash'],
          dependencies: ['analyze-patterns'],
          status: 'pending',
        });

        tasks.push({
          id: 'summarize-insights',
          description: 'Summarize insights and recommendations',
          category: 'communication',
          tools: ['Edit'],
          dependencies: ['create-visualizations'],
          status: 'pending',
        });
        break;

      case 'scientific_computing':
        tasks.push({
          id: 'define-problem',
          description: 'Define the scientific problem and requirements',
          category: 'analysis',
          tools: ['Read'],
          dependencies: [],
          status: 'pending',
        });

        tasks.push({
          id: 'design-algorithm',
          description: 'Design computational algorithm',
          category: 'analysis',
          tools: ['Read', 'Edit'],
          dependencies: ['define-problem'],
          status: 'pending',
        });

        tasks.push({
          id: 'implement-computation',
          description: 'Implement computational solution',
          category: 'generation',
          tools: ['Edit', 'Write'],
          dependencies: ['design-algorithm'],
          status: 'pending',
        });

        tasks.push({
          id: 'validate-results',
          description: 'Validate and verify results',
          category: 'verification',
          tools: ['Bash', 'Read'],
          dependencies: ['implement-computation'],
          status: 'pending',
        });
        break;

      case 'legal_research':
        // Legal/Litigation (e.g., "sue google in fed court")
        tasks.push({
          id: 'identify-claims',
          description: 'Identify legal claims and causes of action',
          category: 'research',
          tools: ['Read'],
          dependencies: [],
          status: 'pending',
        });

        tasks.push({
          id: 'research-law',
          description: 'Research applicable laws and precedents',
          category: 'research',
          tools: ['Read', 'Bash'],
          dependencies: ['identify-claims'],
          status: 'pending',
        });

        tasks.push({
          id: 'gather-evidence',
          description: 'Gather and organize evidence',
          category: 'search',
          tools: ['Glob', 'Grep', 'Read'],
          dependencies: [],
          status: 'pending',
        });

        tasks.push({
          id: 'draft-documents',
          description: 'Draft legal documents (complaint, motion, brief)',
          category: 'generation',
          tools: ['Edit', 'Write'],
          dependencies: ['research-law', 'gather-evidence'],
          status: 'pending',
        });

        tasks.push({
          id: 'prepare-filing',
          description: 'Prepare filing package and procedures',
          category: 'generation',
          tools: ['Edit', 'Write'],
          dependencies: ['draft-documents'],
          status: 'pending',
        });
        break;

      case 'business_analysis':
        tasks.push({
          id: 'gather-business-data',
          description: 'Gather business data and market information',
          category: 'research',
          tools: ['Read', 'Bash'],
          dependencies: [],
          status: 'pending',
        });

        tasks.push({
          id: 'analyze-market',
          description: 'Analyze market and competitive landscape',
          category: 'analysis',
          tools: ['Read', 'Edit'],
          dependencies: ['gather-business-data'],
          status: 'pending',
        });

        tasks.push({
          id: 'build-models',
          description: 'Build financial/business models',
          category: 'computation',
          tools: ['Edit', 'Write'],
          dependencies: ['analyze-market'],
          status: 'pending',
        });

        tasks.push({
          id: 'generate-strategy',
          description: 'Generate strategy recommendations',
          category: 'communication',
          tools: ['Edit'],
          dependencies: ['build-models'],
          status: 'pending',
        });
        break;

      case 'financial_analysis':
        // Accounting/Finance (e.g., "do accounting")
        tasks.push({
          id: 'gather-financial-data',
          description: 'Gather financial data and records',
          category: 'search',
          tools: ['Glob', 'Read'],
          dependencies: [],
          status: 'pending',
        });

        tasks.push({
          id: 'organize-transactions',
          description: 'Organize and categorize transactions',
          category: 'analysis',
          tools: ['Read', 'Edit'],
          dependencies: ['gather-financial-data'],
          status: 'pending',
        });

        tasks.push({
          id: 'calculate-financials',
          description: 'Calculate financial metrics and statements',
          category: 'computation',
          tools: ['Edit', 'Bash'],
          dependencies: ['organize-transactions'],
          status: 'pending',
        });

        tasks.push({
          id: 'generate-reports',
          description: 'Generate financial reports',
          category: 'generation',
          tools: ['Edit', 'Write'],
          dependencies: ['calculate-financials'],
          status: 'pending',
        });

        tasks.push({
          id: 'prepare-tax',
          description: 'Prepare tax calculations and filings',
          category: 'generation',
          tools: ['Edit', 'Write'],
          dependencies: ['calculate-financials'],
          status: 'pending',
        });
        break;

      case 'automate':
        tasks.push({
          id: 'analyze-workflow',
          description: 'Analyze current workflow and processes',
          category: 'analysis',
          tools: ['Read', 'Glob'],
          dependencies: [],
          status: 'pending',
        });

        tasks.push({
          id: 'design-automation',
          description: 'Design automation solution',
          category: 'analysis',
          tools: ['Read'],
          dependencies: ['analyze-workflow'],
          status: 'pending',
        });

        tasks.push({
          id: 'implement-automation',
          description: 'Implement automation scripts',
          category: 'generation',
          tools: ['Edit', 'Write', 'Bash'],
          dependencies: ['design-automation'],
          status: 'pending',
        });

        tasks.push({
          id: 'test-automation',
          description: 'Test automation workflow',
          category: 'verification',
          tools: ['Bash'],
          dependencies: ['implement-automation'],
          status: 'pending',
        });
        break;

      case 'monitor':
        tasks.push({
          id: 'identify-metrics',
          description: 'Identify key metrics to monitor',
          category: 'analysis',
          tools: ['Read'],
          dependencies: [],
          status: 'pending',
        });

        tasks.push({
          id: 'setup-collection',
          description: 'Set up metric collection',
          category: 'execution',
          tools: ['Edit', 'Bash'],
          dependencies: ['identify-metrics'],
          status: 'pending',
        });

        tasks.push({
          id: 'create-dashboard',
          description: 'Create monitoring dashboard',
          category: 'generation',
          tools: ['Edit', 'Write'],
          dependencies: ['setup-collection'],
          status: 'pending',
        });

        tasks.push({
          id: 'configure-alerts',
          description: 'Configure alerting rules',
          category: 'generation',
          tools: ['Edit', 'Write'],
          dependencies: ['create-dashboard'],
          status: 'pending',
        });
        break;

      default:
        // Generic task decomposition
        tasks.push({
          id: 'understand-request',
          description: 'Understand the request and context',
          category: 'analysis',
          tools: ['Glob', 'Read'],
          dependencies: [],
          status: 'pending',
        });

        tasks.push({
          id: 'execute-task',
          description: 'Execute the requested task',
          category: 'execution',
          tools: ['Bash', 'Edit'],
          dependencies: ['understand-request'],
          status: 'pending',
        });

        tasks.push({
          id: 'verify-completion',
          description: 'Verify task completion',
          category: 'verification',
          tools: ['Bash', 'Read'],
          dependencies: ['execute-task'],
          status: 'pending',
        });
        break;
    }

    return tasks;
  }

  private checkAmbiguity(prompt: string, intent: PromptIntent): string[] {
    const questions: string[] = [];
    const lower = prompt.toLowerCase();

    // Vague scope
    if (/all|everything|entire|whole/i.test(lower)) {
      questions.push('The request has broad scope. Should I focus on specific areas first?');
    }

    // Missing target
    if (intent === 'fix_bugs' && !/specific|file|function|module/i.test(lower)) {
      questions.push('Are there specific files or modules to prioritize?');
    }

    // Unclear priority
    if (/important|priority|critical/i.test(lower) && !/high|low|medium/i.test(lower)) {
      questions.push('What priority level should I focus on?');
    }

    return questions;
  }

  private createFromLearnedPattern(prompt: string, pattern: LearnedPattern): PromptAnalysis {
    return {
      originalPrompt: prompt,
      interpretation: `Using learned approach: ${pattern.successfulApproach}`,
      intent: 'generic_task',
      category: 'automation',
      confidence: 0.95,
      tasks: pattern.tools.map((tool, i) => ({
        id: `learned-${i}`,
        description: `Execute ${tool} based on learned pattern`,
        category: 'execution' as TaskCategory,
        tools: [tool],
        dependencies: i > 0 ? [`learned-${i-1}`] : [],
        status: 'pending' as const,
      })),
      clarificationNeeded: [],
    };
  }

  // ==========================================================================
  // EXECUTION - Run Tasks with Real Tools
  // ==========================================================================

  /**
   * Generate tool calls for a given analysis
   * Returns explicit tool call specifications ready for execution
   */
  generateToolCalls(analysis: PromptAnalysis): ToolCallSpec[] {
    const calls: ToolCallSpec[] = [];
    const knowledge = this.context.memory.projectKnowledge;

    for (const task of analysis.tasks) {
      switch (task.category) {
        case 'execution':
          if (task.tools.includes('Bash')) {
            // Generate appropriate commands based on task
            if (task.id.includes('lint') || task.id.includes('errors')) {
              if (knowledge.lintCommand) {
                calls.push({
                  tool: 'Bash',
                  args: { command: knowledge.lintCommand + ' 2>&1 || true', description: task.description },
                  description: task.description,
                  taskId: task.id,
                });
              }
              if (knowledge.type === 'node') {
                calls.push({
                  tool: 'Bash',
                  args: { command: 'npx tsc --noEmit 2>&1 || true', description: 'Type check' },
                  description: 'Run TypeScript type checker',
                  taskId: task.id,
                });
              }
            }
            if (task.id.includes('test')) {
              if (knowledge.testCommand) {
                calls.push({
                  tool: 'Bash',
                  args: { command: knowledge.testCommand + ' 2>&1 || true', description: task.description },
                  description: task.description,
                  taskId: task.id,
                });
              }
            }
            if (task.id.includes('dependency') || task.id.includes('audit')) {
              if (knowledge.type === 'node') {
                calls.push({
                  tool: 'Bash',
                  args: { command: 'npm audit 2>&1 || true', description: 'Security audit' },
                  description: 'Audit npm dependencies for vulnerabilities',
                  taskId: task.id,
                });
              }
            }
          }
          break;

        case 'search':
          if (task.tools.includes('Grep')) {
            if (task.id.includes('issues') || task.id.includes('todo')) {
              calls.push({
                tool: 'Grep',
                args: { pattern: 'TODO|FIXME|BUG|HACK|XXX', output_mode: 'content' },
                description: 'Find TODO/FIXME comments',
                taskId: task.id,
              });
            }
            if (task.id.includes('security') || task.id.includes('patterns')) {
              calls.push({
                tool: 'Grep',
                args: { pattern: 'eval\\(|exec\\(|innerHTML|dangerouslySetInnerHTML', output_mode: 'content' },
                description: 'Find potentially unsafe patterns',
                taskId: task.id,
              });
            }
          }
          if (task.tools.includes('Glob')) {
            calls.push({
              tool: 'Glob',
              args: { pattern: 'src/**/*.{ts,js,tsx,jsx}' },
              description: 'Find source files',
              taskId: task.id,
            });
          }
          break;

        case 'analysis':
          // Analysis typically involves reading files
          if (task.tools.includes('Read')) {
            calls.push({
              tool: 'Read',
              args: { file_path: 'package.json' },
              description: 'Read project configuration',
              taskId: task.id,
            });
          }
          break;
      }
    }

    return calls;
  }

  // ==========================================================================
  // PUBLIC API
  // ==========================================================================

  /**
   * Get the current AGI context
   */
  getContext(): AGIContext {
    return this.context;
  }

  /**
   * Get project knowledge
   */
  getProjectKnowledge(): ProjectKnowledge {
    return this.context.memory.projectKnowledge;
  }

  /**
   * Get recent operations
   */
  getRecentOperations(limit: number = 10): OperationRecord[] {
    return this.context.memory.recentOps.slice(0, limit);
  }

  /**
   * Get learned patterns
   */
  getLearnedPatterns(): LearnedPattern[] {
    return this.context.memory.patterns;
  }

  /**
   * Force project re-analysis
   */
  refreshProjectKnowledge(): ProjectKnowledge {
    this.analyzeProject();
    return this.context.memory.projectKnowledge;
  }

  // ==========================================================================
  // EPISODIC MEMORY - Cross-session learning with semantic search
  // ==========================================================================

  /**
   * Start tracking a new episode (task/conversation unit)
   */
  startEpisode(intent: string): string {
    this.currentEpisodeId = this.episodicMemory.startEpisode(
      intent,
      this.context.sessionId
    );
    this.emit('episode:start', { id: this.currentEpisodeId, intent });
    return this.currentEpisodeId;
  }

  /**
   * Record tool usage within the current episode
   */
  recordEpisodeToolUse(toolName: string): void {
    if (this.currentEpisodeId) {
      this.episodicMemory.recordToolUse(toolName);
    }
  }

  /**
   * Record file modification within the current episode
   */
  recordEpisodeFileModification(filePath: string): void {
    if (this.currentEpisodeId) {
      this.episodicMemory.recordFileModification(filePath);
    }
  }

  /**
   * End the current episode and save to memory
   */
  async endEpisode(success: boolean, summary: string): Promise<Episode | null> {
    if (!this.currentEpisodeId) return null;

    const episode = await this.episodicMemory.endEpisode(success, summary);
    this.emit('episode:end', { episode, success });
    this.currentEpisodeId = null;
    return episode;
  }

  /**
   * Abort the current episode without saving
   */
  abortEpisode(): void {
    if (this.currentEpisodeId) {
      this.episodicMemory.abortEpisode();
      this.emit('episode:abort', { id: this.currentEpisodeId });
      this.currentEpisodeId = null;
    }
  }

  /**
   * Search episodic memory for similar past work
   */
  async searchMemory(query: string, options?: {
    limit?: number;
    successOnly?: boolean;
    since?: number;
  }): Promise<MemorySearchResult[]> {
    return this.episodicMemory.search({
      query,
      limit: options?.limit ?? 5,
      successOnly: options?.successOnly,
      since: options?.since,
    });
  }

  /**
   * Get learned approach from episodic memory
   */
  async getEpisodicApproach(intent: string): Promise<{
    approach: string[];
    tools: string[];
    successRate: number;
  } | null> {
    const learned = await this.episodicMemory.getApproach(intent);
    if (!learned) return null;

    return {
      approach: learned.approach,
      tools: learned.tools,
      successRate: learned.successRate,
    };
  }

  /**
   * Get recent episodes for context
   */
  getRecentEpisodes(limit = 5): Episode[] {
    return this.episodicMemory.getRecentEpisodes(limit, this.context.sessionId);
  }

  /**
   * Get episodic memory statistics
   */
  getEpisodicMemoryStats(): {
    totalEpisodes: number;
    successfulEpisodes: number;
    totalApproaches: number;
    categoryCounts: Record<string, number>;
    topTags: string[];
  } {
    return this.episodicMemory.getStats();
  }

  /**
   * Get the episodic memory instance for direct access
   */
  getEpisodicMemory(): EpisodicMemory {
    return this.episodicMemory;
  }

  /**
   * Check if there's an active episode
   */
  hasActiveEpisode(): boolean {
    return this.currentEpisodeId !== null;
  }

  /**
   * Get current episode ID
   */
  getCurrentEpisodeId(): string | null {
    return this.currentEpisodeId;
  }

  // ==========================================================================
  // SELF-UPGRADE SYSTEM - Automatic updates and hot-reload
  // ==========================================================================

  /**
   * Check for available updates
   */
  async checkForUpdates(): Promise<{
    available: boolean;
    current: string;
    latest: string;
  }> {
    const info = await this.selfUpgrade.checkForUpdates();
    return {
      available: info.updateAvailable,
      current: info.current,
      latest: info.latest,
    };
  }

  /**
   * Perform self-upgrade to latest version
   * Saves session state and restarts CLI automatically
   */
  async performSelfUpgrade(options: {
    version?: string;
    preserveSession?: boolean;
  } = {}): Promise<{
    success: boolean;
    fromVersion: string;
    toVersion?: string;
    error?: string;
  }> {
    // Save current session state if requested
    if (options.preserveSession !== false) {
      const sessionState: UpgradeSessionState = {
        workingDir: this.context.workingDir,
        fromVersion: (await this.selfUpgrade.checkForUpdates()).current,
        timestamp: Date.now(),
        pendingTasks: this.context.memory.recentOps.slice(0, 5).map(op => op.prompt),
        contextSummary: `Session ${this.context.sessionId}, ${this.context.memory.recentOps.length} recent operations`,
      };

      // Include RL context if in an active episode
      if (this.currentEpisodeId) {
        sessionState.rlContext = {
          iteration: 1,
          variant: 'primary',
          objective: 'Continue from episode ' + this.currentEpisodeId,
          currentScore: 0,
          filesModified: [],
        };
      }

      this.selfUpgrade.saveSessionState(sessionState);
    }

    // Perform upgrade
    const result = await this.selfUpgrade.npmInstallFresh(options.version);
    return {
      success: result.success,
      fromVersion: result.fromVersion,
      toVersion: result.toVersion,
      error: result.error,
    };
  }

  /**
   * Perform self-upgrade with build and test verification
   */
  async performVerifiedUpgrade(options: {
    version?: string;
    buildCommand?: string;
    testCommand?: string;
  } = {}): Promise<{
    success: boolean;
    buildSuccess: boolean;
    testsPassed: number;
    testsFailed: number;
    fromVersion: string;
    toVersion?: string;
  }> {
    const result = await this.selfUpgrade.upgradeWithFullVerification(
      options.version,
      options.buildCommand || this.context.memory.projectKnowledge.buildSystem || 'npm run build',
      options.testCommand || this.context.memory.projectKnowledge.testCommand || 'npm test'
    );

    return {
      success: result.success,
      buildSuccess: result.buildSuccess,
      testsPassed: result.testState.passed,
      testsFailed: result.testState.failed,
      fromVersion: result.fromVersion,
      toVersion: result.toVersion,
    };
  }

  /**
   * Trigger hot-reload if update is available
   */
  async triggerHotReload(options: {
    preserveState?: Record<string, unknown>;
    activeEdits?: string[];
  } = {}): Promise<{
    success: boolean;
    strategy: 'hot-swap' | 'restart';
    error?: string;
  }> {
    // Include RL context if applicable
    const rlContext: RLUpgradeContext | undefined = this.currentEpisodeId ? {
      iteration: 1,
      variant: 'primary',
      objective: 'Hot-reload continuation',
      currentScore: 0,
      filesModified: options.activeEdits || [],
    } : undefined;

    return this.hotReload.performHotReload({
      preserveState: options.preserveState,
      rlContext,
      activeEdits: options.activeEdits,
    });
  }

  /**
   * Resume from previous upgrade session
   */
  resumeFromUpgrade(): UpgradeSessionState | null {
    const state = this.selfUpgrade.loadSessionState();
    if (state) {
      this.selfUpgrade.clearSessionState();
      this.emit('upgrade:resumed', state);
    }
    return state;
  }

  /**
   * Get the self-upgrade instance for direct access
   */
  getSelfUpgrade(): SelfUpgrade {
    return this.selfUpgrade;
  }

  /**
   * Get the hot-reload instance for direct access
   */
  getHotReload(): HotReload {
    return this.hotReload;
  }

  /**
   * Check if this session was started after an upgrade
   */
  wasUpgraded(): boolean {
    return SelfUpgrade.wasUpgraded();
  }

  /**
   * Get version we upgraded from (if applicable)
   */
  getUpgradeFromVersion(): string | null {
    return SelfUpgrade.getUpgradeFromVersion();
  }
}

// ============================================================================
// TOOL CALL SPECIFICATION
// ============================================================================

export interface ToolCallSpec {
  tool: string;
  args: Record<string, unknown>;
  description: string;
  taskId: string;
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

let agiInstance: AGICore | null = null;

export function getAGI(workingDir?: string): AGICore {
  if (!agiInstance || (workingDir && workingDir !== agiInstance.getContext().workingDir)) {
    agiInstance = new AGICore(workingDir);
  }
  return agiInstance;
}

export function resetAGI(): void {
  agiInstance = null;
}
