/**
 * Core Layer - AGI CLI Core Systems
 *
 * This module exports the core functionality of AGI CLI:
 * - AGI Core: Central intelligence and task planning
 * - Self-Upgrade: Automatic version updates with session continuity
 * - Hot-Reload: Seamless version transitions
 * - Episodic Memory: Cross-session learning
 * - Update Checker: Version checking utilities
 *
 * Usage:
 * - AGI Core: import { getAGI, AGICore } from './agiCore.js';
 * - Self-Upgrade: import { getSelfUpgrade, upgradeToLatest } from './selfUpgrade.js';
 * - Hot-Reload: import { getHotReload, checkAndReload } from './hotReload.js';
 */

// ═══════════════════════════════════════════════════════════════════════════════
// AGI Core - Central Intelligence
// ═══════════════════════════════════════════════════════════════════════════════

export {
  AGICore,
  getAGI,
  resetAGI,
  type AGIContext,
  type AGIMemory,
  type AGITask,
  type LearnedPattern,
  type OperationRecord,
  type ProjectKnowledge,
  type PromptAnalysis,
  type PromptIntent,
  type PromptCategory,
  type TaskCategory,
  type TaskResult,
  type ToolCallSpec,
} from './agiCore.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Self-Upgrade System
// ═══════════════════════════════════════════════════════════════════════════════

export {
  SelfUpgrade,
  getSelfUpgrade,
  resetSelfUpgrade,
  upgradeToLatest,
  upgradeAndVerify,
  saveUpgradeState,
  resumeAfterUpgrade,
  type SelfUpgradeConfig,
  type UpgradeSessionState,
  type RLUpgradeContext,
  type BuildState,
  type TestState,
  type UpgradeResult,
  type VersionInfo,
  type UpgradeEventType,
  type UpgradeEvent,
} from './selfUpgrade.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Hot-Reload System
// ═══════════════════════════════════════════════════════════════════════════════

export {
  HotReload,
  getHotReload,
  resetHotReload,
  checkAndReload,
  enableAutoCheck,
  disableAutoCheck,
  type HotReloadConfig,
  type HotReloadState,
  type HotReloadEventType,
  type HotReloadEvent,
  type ReloadStrategy,
} from './hotReload.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Update Checker (Legacy compatibility)
// ═══════════════════════════════════════════════════════════════════════════════

export {
  checkForUpdates,
  maybeAutoUpdate,
  formatUpdateNotification,
  formatUpdateBanner,
  getUpdateDecision,
  shouldShowUpdateNotification,
  readAutoUpdateState,
  performBackgroundUpdate,
  performUpdate,
  updateAndContinue,
  installPackageVersion,
  runNpmInstall,
  saveSessionState,
  loadSessionState,
  clearSessionState,
  hasPendingSession,
  type UpdateInfo,
  type AutoUpdateResult,
  type AutoUpdateState,
  type SessionState,
} from './updateChecker.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Episodic Memory
// ═══════════════════════════════════════════════════════════════════════════════

export {
  getEpisodicMemory,
  createEpisodicMemory,
  type EpisodicMemory,
  type Episode,
  type LearnedApproach,
  type MemorySearchResult,
  type EpisodeCategory,
} from './episodicMemory.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Preferences
// ═══════════════════════════════════════════════════════════════════════════════

export {
  loadModelPreference,
  saveModelPreference,
  loadSessionPreferences,
  saveSessionPreferences,
  loadFeatureFlags,
  saveFeatureFlags,
  type SessionPreferences,
  type FeatureFlags,
} from './preferences.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Dual Tournament (RL System)
// ═══════════════════════════════════════════════════════════════════════════════

export {
  runDualTournament,
  DEFAULT_HUMAN_REWARD_WEIGHTS,
  type TournamentCandidate,
  type TournamentOutcome,
  type HumanRewardWeights,
} from './dualTournament.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Anti-Termination Protection
// ═══════════════════════════════════════════════════════════════════════════════

export {
  AntiTerminationProtection,
  initializeProtection,
  getProtection,
  enterCriticalSection,
  exitCriticalSection,
  authorizedShutdown,
  getProtectionStatus,
  type ProtectionStatus,
  type AntiTerminationConfig,
} from './antiTermination.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Flow Protection (Prompt Injection & UI Safety)
// ═══════════════════════════════════════════════════════════════════════════════

export {
  FlowProtection,
  initializeFlowProtection,
  getFlowProtection,
  sanitizePrompt,
  sanitizeForDisplay,
  type InjectionAnalysis,
  type InjectionType,
  type FlowProtectionConfig,
} from './flowProtection.js';

// Input Protection
export {
  InputProtection,
  initializeInputProtection,
  getInputProtection,
  validateChatInput,
  validatePromptSubmit,
  type InputValidation,
  type InputAttackType,
  type InputProtectionConfig,
} from './inputProtection.js';
