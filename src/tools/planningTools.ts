/**
 * Planning Tools - Minimal stub for backward compatibility
 */

import type { ToolDefinition } from '../core/toolRuntime.js';

export interface PlanStep {
  description: string;
}

export type PlanApprovalCallback = (
  steps: PlanStep[],
  explanation: string,
  resolve: (approved: boolean) => void
) => void;

let _planApprovalCallback: PlanApprovalCallback | null = null;

export function setPlanApprovalCallback(callback: PlanApprovalCallback | null): void {
  _planApprovalCallback = callback;
}

export function getPlanApprovalCallback(): PlanApprovalCallback | null {
  return _planApprovalCallback;
}

export function createPlanningTools(_workingDir: string): ToolDefinition[] {
  return [
    {
      name: 'UpdatePlan',
      description: 'Present a multi-step plan to the user',
      parameters: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            items: { type: 'string' },
            description: 'Plan steps',
          },
          explanation: { type: 'string', description: 'Plan explanation' },
        },
        required: ['steps'],
      },
      handler: async (args) => {
        const steps = args['steps'] as string[];
        return `Plan with ${steps.length} steps presented.`;
      },
    },
    {
      name: 'ProposePlan',
      description: 'Propose a plan for user approval',
      parameters: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            items: { type: 'string' },
            description: 'Plan steps',
          },
          explanation: { type: 'string', description: 'Plan explanation' },
        },
        required: ['steps'],
      },
      handler: async (args) => {
        const steps = args['steps'] as string[];
        const explanation = (args['explanation'] as string) || '';

        if (_planApprovalCallback) {
          return new Promise((resolve) => {
            const planSteps: PlanStep[] = steps.map(s => ({ description: s }));
            _planApprovalCallback!(planSteps, explanation, (approved) => {
              resolve(approved ? 'Plan approved' : 'Plan rejected');
            });
          });
        }
        return `Plan with ${steps.length} steps proposed (auto-approved).`;
      },
    },
    {
      name: 'ExitPlanMode',
      description: 'Signal that planning is complete',
      parameters: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        return 'Plan mode exited.';
      },
    },
  ];
}
