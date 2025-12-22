import type {
  RepoUpgradeMode,
  RepoUpgradeModeDefinition,
  RepoUpgradeModule,
  RepoUpgradeStep,
  UpgradeStepExecutionInput,
  UpgradeStepResult,
  UpgradeVariant,
} from './repoUpgradeOrchestrator.js';

export interface VariantExecutionContext {
  parallelVariants?: boolean;
  variantWorkspaceRoots?: Partial<Record<UpgradeVariant, string>>;
  repoPolicy?: string;
}

export interface VariantExecutionOptions {
  module: RepoUpgradeModule;
  step: RepoUpgradeStep;
  mode: RepoUpgradeMode;
  modeDefinition: RepoUpgradeModeDefinition;
  context: VariantExecutionContext;
  executeVariant: (input: UpgradeStepExecutionInput) => Promise<UpgradeStepResult>;
  emit?: (event: { type: string; timestamp: number; data?: Record<string, unknown> }) => void;
}

export function resolveWorkspaceRoot(
  variant: UpgradeVariant,
  context: VariantExecutionContext
): string | undefined {
  return context.variantWorkspaceRoots?.[variant] ?? context.variantWorkspaceRoots?.primary;
}

export function canRunVariantsParallel(
  modeDefinition: RepoUpgradeModeDefinition,
  context: VariantExecutionContext
): boolean {
  if (!modeDefinition.parallelVariants || !context.parallelVariants) {
    return false;
  }
  const primaryRoot = context.variantWorkspaceRoots?.primary;
  const refinerRoot = context.variantWorkspaceRoots?.refiner;
  return Boolean(primaryRoot && refinerRoot && primaryRoot !== refinerRoot);
}

export async function executeVariants(
  options: VariantExecutionOptions
): Promise<Partial<Record<UpgradeVariant, UpgradeStepResult>>> {
  const { module, step, mode, modeDefinition, context, executeVariant, emit } = options;
  const variantResults: Partial<Record<UpgradeVariant, UpgradeStepResult>> = {};

  if (canRunVariantsParallel(modeDefinition, context)) {
    emit?.({
      type: 'upgrade.step.variants.parallel',
      timestamp: Date.now(),
      data: { moduleId: module.id, stepId: step.id, variants: modeDefinition.variants },
    });

    const results = await Promise.all(
      modeDefinition.variants.map(async (variant) => {
        const result = await executeVariant({
          module,
          step,
          mode,
          variant,
          previousResult: undefined,
          workspaceRoot: resolveWorkspaceRoot(variant, context),
          repoPolicy: context.repoPolicy,
        });
        return { variant, result };
      })
    );
    for (const entry of results) {
      variantResults[entry.variant] = entry.result;
    }
  } else {
    let primaryResult: UpgradeStepResult | undefined;
    for (const variant of modeDefinition.variants) {
      const previousResult = variant === 'refiner' ? primaryResult : undefined;
      const result = await executeVariant({
        module,
        step,
        mode,
        variant,
        previousResult,
        workspaceRoot: resolveWorkspaceRoot(variant, context),
        repoPolicy: context.repoPolicy,
      });
      variantResults[variant] = result;
      if (variant === 'primary') {
        primaryResult = result;
      }
    }
  }

  return variantResults;
}
