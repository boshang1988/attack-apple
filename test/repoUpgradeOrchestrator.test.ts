import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, jest } from '@jest/globals';
import {
  RepoUpgradeOrchestrator,
  buildRepoWidePlan,
  type RepoUpgradeModule,
  type RepoUpgradePlan,
  type UpgradeStepExecutionInput,
} from '../src/core/repoUpgradeOrchestrator.js';

const simpleModule = (id: string): RepoUpgradeModule => ({
  id,
  label: id,
  description: `Module ${id}`,
  scope: [`${id}/**/*`],
  steps: [
    { id: `${id}-analyze`, intent: 'analyze', description: 'analyze' },
    { id: `${id}-upgrade`, intent: 'upgrade', description: 'upgrade' },
    { id: `${id}-verify`, intent: 'verify', description: 'verify' },
  ],
});

const makePlan = (...modules: RepoUpgradeModule[]): RepoUpgradePlan => ({ modules });

describe('RepoUpgradeOrchestrator - modes', () => {
  it('runs primary only in single-continuous mode and records winning executions', async () => {
    const calls: UpgradeStepExecutionInput[] = [];
    const executor = jest.fn(async (input: UpgradeStepExecutionInput) => {
      calls.push(input);
      return {
        success: true,
        summary: `${input.step.id}-${input.variant}`,
        score: input.variant === 'primary' ? 0.4 : 0.9,
        execution: {
          success: true,
          output: 'ok',
          duration: 1,
          command: `${input.module.id}/${input.step.id}/${input.variant}`,
        },
      };
    });

    const orchestrator = new RepoUpgradeOrchestrator(executor);
    const plan = makePlan(simpleModule('source'));

    const report = await orchestrator.run(plan, {
      mode: 'single-continuous',
      objective: 'upgrade',
    });

    expect(report.modules[0]?.steps.map((s) => s.winnerVariant)).toEqual(['primary', 'primary', 'primary']);
    expect(calls.every((call) => call.variant === 'primary')).toBe(true);
    expect(report.results).toHaveLength(plan.modules[0]?.steps.length ?? 0);
    expect(report.results.every((result) => result.command?.endsWith('/primary'))).toBe(true);
  });

  it('prefers the refiner path in dual-rl-continuous mode when it scores higher', async () => {
    const executor = jest.fn(async (input: UpgradeStepExecutionInput) => {
      if (input.variant === 'primary') {
        return {
          success: true,
          summary: 'primary version',
          score: 0.2,
          execution: {
            success: true,
            output: 'primary',
            duration: 1,
            command: `${input.module.id}/${input.step.id}/primary`,
          },
        };
      }
      return {
        success: true,
        summary: 'refiner wins',
        score: 0.9,
        execution: {
          success: true,
          output: 'refiner',
          duration: 1,
          command: `${input.module.id}/${input.step.id}/refiner`,
        },
      };
    });

    const orchestrator = new RepoUpgradeOrchestrator(executor);
    const plan = makePlan(simpleModule('src-only'));

    const report = await orchestrator.run(plan, { mode: 'dual-rl-continuous' });
    const step = report.modules[0]?.steps[0];

    expect(step?.winnerVariant).toBe('refiner');
    expect(report.results[0]?.command).toContain('/refiner');
    const expectedCalls = (plan.modules[0]?.steps.length ?? 0) * 2;
    expect(executor).toHaveBeenCalledTimes(expectedCalls);
  });

  it('halts when continueOnFailure is false and marks remaining modules as skipped', async () => {
    const executor = jest.fn(async (input: UpgradeStepExecutionInput) => {
      if (input.module.id === 'first') {
        return {
          success: false,
          summary: 'failed primary',
          execution: {
            success: false,
            output: 'failed',
            duration: 0,
            command: `${input.module.id}/${input.step.id}/${input.variant}`,
            error: 'failed',
          },
        };
      }
      return {
        success: true,
        summary: 'should not run',
        execution: {
          success: true,
          output: 'ok',
          duration: 0,
          command: `${input.module.id}/${input.step.id}/${input.variant}`,
        },
      };
    });

    const orchestrator = new RepoUpgradeOrchestrator(executor);
    const plan = makePlan(simpleModule('first'), simpleModule('second'));

    const report = await orchestrator.run(plan, {
      mode: 'single-continuous',
      continueOnFailure: false,
    });

    expect(report.modules[0]?.status).toBe('failed');
    expect(report.modules[1]?.status).toBe('skipped');
    expect(executor).toHaveBeenCalledTimes(1);
    expect(report.results[0]?.success).toBe(false);
  });

  it('uses refiner bias to break ties when both variants succeed', async () => {
    const executor = jest.fn(async (input: UpgradeStepExecutionInput) => ({
      success: true,
      summary: `${input.step.id}-${input.variant}`,
      score: 0.4,
      execution: {
        success: true,
        output: input.variant,
        duration: 1,
        command: `${input.module.id}/${input.step.id}/${input.variant}`,
      },
    }));

    const orchestrator = new RepoUpgradeOrchestrator(executor);
    const plan = makePlan(simpleModule('tie-breaker'));

    const report = await orchestrator.run(plan, { mode: 'dual-rl-continuous' });
    const step = report.modules[0]?.steps[0];

    expect(step?.winnerVariant).toBe('refiner');
    expect(executor).toHaveBeenCalledTimes((plan.modules[0]?.steps.length ?? 0) * 2);
  });
});

describe('buildRepoWidePlan', () => {
  it('returns a fallback module when no known scopes exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'upgrade-fw-'));
    try {
      const plan = buildRepoWidePlan(dir);
      expect(plan.modules).toHaveLength(1);
      expect(plan.modules[0]?.id).toBe('repo-wide');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('expands npm/yarn workspaces into dedicated modules', () => {
    const dir = mkdtempSync(join(tmpdir(), 'upgrade-fw-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'workspace-test', workspaces: ['packages/*'] }));
      mkdirSync(join(dir, 'packages', 'svc-a'), { recursive: true });
      const plan = buildRepoWidePlan(dir);
      const ids = plan.modules.map((m) => m.id);

      expect(ids.some((id) => id.includes('workspace-packages-svc-a'))).toBe(true);
      const workspaceModule = plan.modules.find((m) => m.id.includes('workspace-packages-svc-a'));
      expect(workspaceModule?.scope).toEqual(['packages/svc-a/**/*']);
      expect(workspaceModule?.validationCommands?.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects repo-specific scopes like skills/agents/examples and carries validation hints', () => {
    const dir = mkdtempSync(join(tmpdir(), 'upgrade-fw-'));
    try {
      mkdirSync(join(dir, 'src'));
      mkdirSync(join(dir, 'skills'));
      mkdirSync(join(dir, 'agents'));
      mkdirSync(join(dir, 'examples'));

      const plan = buildRepoWidePlan(dir);
      const moduleIds = plan.modules.map((m) => m.id);

      expect(moduleIds).toEqual(expect.arrayContaining(['source', 'skills', 'agents', 'examples']));

      const skillsModule = plan.modules.find((m) => m.id === 'skills');
      expect(skillsModule?.validationCommands?.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
