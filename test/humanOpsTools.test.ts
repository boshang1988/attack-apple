import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHumanOpsTools } from '../src/tools/humanOpsTools.js';

let originalEnvDir: string | undefined;
let tempDir: string;

beforeEach(() => {
  originalEnvDir = process.env['AGI_HUMAN_TASK_DIR'];
  tempDir = mkdtempSync(join(tmpdir(), 'human-ops-'));
  process.env['AGI_HUMAN_TASK_DIR'] = join(tempDir, 'ops');
});

afterEach(() => {
  if (originalEnvDir === undefined) {
    delete process.env['AGI_HUMAN_TASK_DIR'];
  } else {
    process.env['AGI_HUMAN_TASK_DIR'] = originalEnvDir;
  }
  rmSync(tempDir, { recursive: true, force: true });
});

describe('HumanIntegration tool', () => {
  it('records a human task with metadata and returns a summary', async () => {
    const tools = createHumanOpsTools();
    const tool = tools.find(t => t.name === 'HumanIntegration');
    expect(tool).toBeDefined();
    if (!tool) return;

    const output = await tool.handler({
      title: 'Solve checkout captcha',
      context: 'Staging checkout blocks at captcha after address step.',
      urgency: 'high',
      needsBrowser: true,
      needsCaptcha: true,
      emailDomain: 'fastmail.test',
      catchAll: true,
      domainRegistrar: 'Namecheap',
      paymentMethod: 'Virtual card (no auto-renew)',
      phoneVerification: true,
      ssoProviders: ['Google'],
      proxyPolicy: 'Residential US IP, consistent UA',
      steps: ['Open staging checkout', 'Proceed to address', 'Solve captcha', 'Complete order'],
      artifacts: ['screenshot', 'HAR'],
    } as any);

    expect(output).toContain('Human task recorded');
    expect(output).toContain('Urgency: high');
    expect(output).toContain('Requires browser use');
    expect(output).toContain('Requires captcha');
    expect(output).toContain('Email domain:');
    expect(output).toContain(tempDir);

    // Ensure a task file was written and contains JSON with expected fields
    const filePathLine = output.split('\n').find(line => line.startsWith('Saved at: '));
    expect(filePathLine).toBeTruthy();
    const filePath = filePathLine?.replace('Saved at: ', '').trim() ?? '';
    const content = JSON.parse(readFileSync(filePath, 'utf8'));
    expect(content.title).toBe('Solve checkout captcha');
    expect(content.urgency).toBe('high');
    expect(content.needsBrowser).toBe(true);
    expect(Array.isArray(content.steps)).toBe(true);
    expect(content.steps.length).toBeGreaterThan(0);
    expect(Array.isArray(content.updates)).toBe(true);
    expect(content.updates?.length).toBeGreaterThan(0);
    expect(content.emailDomain).toBe('fastmail.test');
  });

  it('appends an update to an existing task file', async () => {
    const tools = createHumanOpsTools();
    const tool = tools.find(t => t.name === 'HumanIntegration');
    expect(tool).toBeDefined();
    if (!tool) return;

    const createOutput = await tool.handler({
      title: 'Browser QA',
      context: 'Need manual end-to-end with captcha',
    } as any);
    const filePathLine = createOutput.split('\n').find(line => line.startsWith('Saved at: '));
    expect(filePathLine).toBeTruthy();
    const filePath = filePathLine?.replace('Saved at: ', '').trim() ?? '';

    const updateOutput = await tool.handler({
      title: 'Browser QA',
      taskPath: filePath,
      update: 'Ran captcha solver; waiting on email verification.',
    } as any);

    expect(updateOutput).toContain('Update appended to human task');
    const content = JSON.parse(readFileSync(filePath, 'utf8'));
    expect(content.updates?.length).toBeGreaterThan(1);
    const last = content.updates?.slice(-1)[0];
    expect(last?.note).toContain('captcha solver');
  });
});
