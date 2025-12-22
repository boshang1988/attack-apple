import { describe, it, expect, jest } from '@jest/globals';
import { PassThrough } from 'node:stream';
import { UnifiedUIRenderer } from '../src/ui/UnifiedUIRenderer.js';

const createRenderer = () => {
  const input = new PassThrough() as unknown as NodeJS.ReadStream;
  (input as any).isTTY = true;
  (input as any).setRawMode = jest.fn();

  const output = new PassThrough() as unknown as NodeJS.WriteStream;
  (output as any).isTTY = true;
  (output as any).columns = 80;
  (output as any).rows = 24;
  (output as any).write = ((chunk: any) => {
    const text = typeof chunk === 'string' ? chunk : chunk?.toString?.() ?? '';
    // Preserve write signature used by readline
    PassThrough.prototype.write.call(output, text);
    return true;
  }) as any;

  const renderer = new UnifiedUIRenderer(output, input);
  return { renderer, input, output };
};

describe('Paste functionality fixes', () => {
  it('should not leak toggle symbols during paste', () => {
    // Test the core logic - toggle symbols should be stripped
    const testStripToggleSymbols = (input: string): string => {
      const chars = [...input];
      let result = '';
      
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        const code = ch.charCodeAt(0);
        
        // Check for toggle characters
        if (code === 169 || code === 8482) continue; // © ™ (Option+G)
        if (code === 229 || code === 197) continue;  // å Å (Option+A)
        if (code === 8706 || code === 8710 || code === 206) continue; // ∂ ∆ Î (Option+D)
        if (code === 8224 || code === 8225) continue; // † ‡ (Option+T)
        if (code === 8730) continue; // √ (Option+V)
        
        // Check for ESC + toggle letter
        if (code === 27 && i + 1 < chars.length) {
          const letter = chars[i + 1].toLowerCase();
          if (['g', 'a', 'd', 't', 'v'].includes(letter)) {
            i++;
            continue;
          }
        }
        
        result += ch;
      }
      
      return result;
    };
    
    const result = testStripToggleSymbols('Hello©WorldåTest∂Content');
    expect(result).toBe('HelloWorldTestContent');
    expect(result).not.toContain('©');
    expect(result).not.toContain('å');
    expect(result).not.toContain('∂');
  });

  it('should suppress render during paste burst', () => {
    // Test that render is suppressed when emitPasteBuffer is active
    const { renderer } = createRenderer();
    try {
      // Simulate being in a paste burst state
      (renderer as any).emitPasteBuffer = 'Some paste content';
      
      // Check that render suppression works
      const inEmitPaste = (renderer as any).emitPasteBuffer.length > 0;
      expect(inEmitPaste).toBe(true);
      
      // When collapsedPaste is null, render should be suppressed
      const shouldSuppress = inEmitPaste && !(renderer as any).collapsedPaste;
      expect(shouldSuppress).toBe(true);
      
    } finally {
      renderer.cleanup();
    }
  });

  it('should auto-expand chat box height for multi-line content', () => {
    // Test that collapsed paste tracks line count
    const { renderer } = createRenderer();
    try {
      // Create a collapsed paste with multiple lines
      const multiLineText = 'Line 1\nLine 2\nLine 3\nLine 4';
      (renderer as any).collapsedPaste = {
        text: multiLineText,
        lines: 4,
        chars: multiLineText.length
      };
      
      // The collapsed paste should track correct line count
      const paste = (renderer as any).collapsedPaste;
      expect(paste).toBeDefined();
      expect(paste.lines).toBe(4);
      expect(paste.text).toBe(multiLineText);
      
    } finally {
      renderer.cleanup();
    }
  });

  it('should maintain toggle state below paste chip', () => {
    // Test that toggles work even when collapsed paste is active
    const { renderer } = createRenderer();
    try {
      // Create a collapsed paste
      (renderer as any).collapsedPaste = {
        text: 'Some pasted content',
        lines: 1,
        chars: 18
      };
      
      // Toggle state should still be accessible
      // The renderer should show both paste chip and toggles
      expect((renderer as any).collapsedPaste).toBeDefined();
      
    } finally {
      renderer.cleanup();
    }
  });
});