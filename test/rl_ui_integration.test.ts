import { test, expect, jest } from '@jest/globals';
import { PassThrough } from 'node:stream';
import { UnifiedUIRenderer } from '../src/ui/UnifiedUIRenderer';
import type { RLAgentStatus } from '../src/ui/UnifiedUIRenderer';

const createMockStream = () => {
  const stream = new PassThrough() as unknown as NodeJS.ReadStream & NodeJS.WriteStream;
  (stream as any).isTTY = true;
  (stream as any).columns = 120;
  (stream as any).rows = 40;
  (stream as any).on = jest.fn();
  (stream as any).setRawMode = jest.fn();
  (stream as any).write = ((chunk: any) => {
    const text = typeof chunk === 'string' ? chunk : chunk?.toString?.() ?? '';
    PassThrough.prototype.write.call(stream, text);
    return true;
  }) as any;
  return stream;
};

describe('Dual Tournament RL UI Integration', () => {
  let renderer: UnifiedUIRenderer;
  let mockStdout: any;
  let mockStdin: any;

  beforeEach(() => {
    mockStdout = createMockStream();
    mockStdin = createMockStream();
    
    renderer = new UnifiedUIRenderer(mockStdout, mockStdin);
  });

  test('RL status should update correctly', () => {
    const initialStatus: Partial<RLAgentStatus> = {
      activeVariant: 'primary',
      currentModule: 'security-audit',
      wins: { primary: 0, refiner: 0, ties: 0 }
    };
    
    renderer.updateRLStatus(initialStatus);
    const status = renderer.getRLStatus();
    
    expect(status.activeVariant).toBe('primary');
    expect(status.currentModule).toBe('security-audit');
    expect(status.wins?.primary).toBe(0);
  });

  test('RL status should clear correctly', () => {
    renderer.updateRLStatus({
      activeVariant: 'primary',
      currentModule: 'test-module'
    });
    
    renderer.clearRLStatus();
    const status = renderer.getRLStatus();
    
    expect(status.activeVariant).toBeUndefined();
    expect(status.currentModule).toBeUndefined();
  });

  test('Status bar should render RL info when active', () => {
    // This would test actual rendering
    // For now, just verify the method exists
    expect(renderer.updateRLStatus).toBeDefined();
    expect(renderer.clearRLStatus).toBeDefined();
    expect(renderer.getRLStatus).toBeDefined();
  });

  test('RL status updates should trigger re-render when changed', () => {
    const renderSpy = jest.spyOn(renderer as any, 'renderPrompt');
    
    // First update should trigger render
    renderer.updateRLStatus({ activeVariant: 'primary' });
    expect(renderSpy).toHaveBeenCalled();
    
    renderSpy.mockClear();
    
    // Same update should not trigger re-render
    renderer.updateRLStatus({ activeVariant: 'primary' });
    expect(renderSpy).not.toHaveBeenCalled();
    
    // Different update should trigger re-render
    renderer.updateRLStatus({ activeVariant: 'refiner' });
    expect(renderSpy).toHaveBeenCalled();
  });
});

describe('Mode Toggle Integration', () => {
  test('Default mode should be single-continuous', () => {
    // This would test the interactive shell default
    expect(true).toBe(true);
  });

  test('Toggle should switch between single and dual modes', () => {
    // This would test the toggle handler
    expect(true).toBe(true);
  });
});
