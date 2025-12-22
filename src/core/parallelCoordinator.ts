import type { ParallelTask, BatchResult } from './parallelExecutor.js';
import type { RepoUpgradeModule, UpgradeModuleReport, RepoUpgradeModeDefinition, RepoUpgradeMode } from './repoUpgradeOrchestrator.js';

interface RunModulesContext {
  concurrency: number;
  mode: RepoUpgradeMode;
  modeDefinition: RepoUpgradeModeDefinition;
  parallelVariants?: boolean;
  continueOnFailure: boolean;
  variantStats: Record<string, unknown>;
  processModule: (module: RepoUpgradeModule) => Promise<UpgradeModuleReport>;
  emit: (event: unknown) => void;
}

export class ParallelCoordinator {
  constructor(
    private readonly createRunner: () => { execute: (tasks: ParallelTask<UpgradeModuleReport>[]) => Promise<BatchResult<UpgradeModuleReport>> }
  ) {}

  async runModules(context: RunModulesContext, modules: RepoUpgradeModule[]): Promise<UpgradeModuleReport[]> {
    const tasks: ParallelTask<UpgradeModuleReport>[] = modules.map((module) => ({
      id: module.id,
      label: module.label,
      parallelizable: true,
      execute: () => context.processModule(module),
    }));

    const runner = this.createRunner();
    const batch = await runner.execute(tasks);
    const reports: UpgradeModuleReport[] = [];

    for (const result of batch.results) {
      const module = modules.find((m) => m.id === result.taskId);
      let report: UpgradeModuleReport;
      if (result.result) {
        report = result.result;
      } else {
        report = {
          id: module?.id ?? result.taskId,
          label: module?.label ?? result.taskId,
          scope: module?.scope ?? [],
          steps: [],
          status: result.status === 'completed' ? 'completed' : 'failed',
        };
      }

      if (result.status !== 'completed') {
        report.status = 'failed';
      }

      reports.push(report);

      if (result.status === 'failed' && !context.continueOnFailure) {
        break;
      }
    }

    return reports;
  }
}
