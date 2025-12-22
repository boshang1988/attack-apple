import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ToolDefinition } from '../core/toolRuntime.js';

interface HumanTaskInput {
  title?: string;
  context?: string;
  urgency?: string;
  needsBrowser?: boolean;
  needsCaptcha?: boolean;
  emailDomain?: string;
  catchAll?: boolean;
  domainRegistrar?: string;
  paymentMethod?: string;
  phoneVerification?: boolean;
  ssoProviders?: string[];
  proxyPolicy?: string;
  steps?: string[];
  artifacts?: string[];
  taskPath?: string;
  update?: string;
}

interface HumanTaskRecord extends Required<Pick<HumanTaskInput, 'title'>> {
  context?: string;
  urgency?: string;
  needsBrowser?: boolean;
  needsCaptcha?: boolean;
  emailDomain?: string;
  catchAll?: boolean;
  domainRegistrar?: string;
  paymentMethod?: string;
  phoneVerification?: boolean;
  ssoProviders?: string[];
  proxyPolicy?: string;
  steps: string[];
  artifacts?: string[];
  updates: Array<{ note: string; at: string }>;
}

function getTaskDir(): string {
  const root = process.env['AGI_HUMAN_TASK_DIR'] || join(homedir(), '.agi', 'human-tasks');
  mkdirSync(root, { recursive: true });
  return root;
}

function safeTitle(title: string): string {
  return title.trim().replace(/[^\w\d-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'task';
}

function writeTask(record: HumanTaskRecord, path: string): void {
  mkdirSync(getTaskDir(), { recursive: true });
  writeFileSync(path, JSON.stringify(record, null, 2), 'utf8');
}

function createNewTask(args: HumanTaskInput): { path: string; record: HumanTaskRecord; message: string } {
  const dir = getTaskDir();
  const title = args.title?.trim() || 'Untitled task';
  const record: HumanTaskRecord = {
    title,
    context: args.context,
    urgency: args.urgency ?? 'normal',
    needsBrowser: args.needsBrowser ?? false,
    needsCaptcha: args.needsCaptcha ?? false,
    emailDomain: args.emailDomain,
    catchAll: args.catchAll,
    domainRegistrar: args.domainRegistrar,
    paymentMethod: args.paymentMethod,
    phoneVerification: args.phoneVerification,
    ssoProviders: args.ssoProviders ?? [],
    proxyPolicy: args.proxyPolicy,
    steps: (args.steps && args.steps.length ? args.steps : ['Provide update and next actions']).map((s) => String(s)),
    artifacts: args.artifacts,
    updates: [
      {
        note: args.context ? `Initial context: ${args.context}` : 'Task created',
        at: new Date().toISOString(),
      },
    ],
  };

  const path = join(dir, `${safeTitle(title)}-${Date.now()}.json`);
  writeTask(record, path);

  const lines = [
    'Human task recorded',
    `Title: ${title}`,
    `Urgency: ${record.urgency}`,
    record.needsBrowser ? 'Requires browser use' : 'No browser required',
    record.needsCaptcha ? 'Requires captcha' : 'No captcha required',
    record.emailDomain ? `Email domain: ${record.emailDomain}` : 'Email domain: n/a',
    `Steps: ${record.steps.length}`,
    `Saved at: ${path}`,
  ];

  return { path, record, message: lines.join('\n') };
}

function appendUpdate(taskPath: string, note: string): { path: string; record: HumanTaskRecord; message: string } {
  const content = readFileSync(taskPath, 'utf8');
  const record = JSON.parse(content) as HumanTaskRecord;
  record.updates = record.updates ?? [];
  record.updates.push({ note, at: new Date().toISOString() });
  writeTask(record, taskPath);

  const lines = [
    'Update appended to human task',
    `Title: ${record.title}`,
    `Updates: ${record.updates.length}`,
    `Saved at: ${taskPath}`,
  ];
  return { path: taskPath, record, message: lines.join('\n') };
}

export function createHumanOpsTools(): ToolDefinition[] {
  return [
    {
      name: 'HumanIntegration',
      description: 'Create or update human-in-the-loop tasks with rich metadata (browser, captcha, domain/email needs).',
      handler: async (args: HumanTaskInput) => {
        if (args.taskPath && existsSync(args.taskPath)) {
          const updateNote = args.update?.trim() || 'Update added';
          const { message } = appendUpdate(args.taskPath, updateNote);
          return message;
        }
        const { message } = createNewTask(args);
        return message;
      },
    },
  ];
}
