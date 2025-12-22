/**
 * Tests for Robust Input Processor
 */

import { RobustInputProcessor } from '../src/shell/inputProcessor.js';

describe('RobustInputProcessor', () => {
  let processor: RobustInputProcessor;

  beforeEach(() => {
    processor = new RobustInputProcessor();
  });

  describe('processInput', () => {
    test('handles empty input', () => {
      const result = processor.processInput('');
      expect(result.content).toBe('');
      expect(result.isMultiLine).toBe(false);
      expect(result.lineCount).toBe(0);
      expect(result.displayFormat).toBe('inline');
    });

    test('handles single line input', () => {
      const result = processor.processInput('Hello world');
      expect(result.content).toBe('Hello world');
      expect(result.isMultiLine).toBe(false);
      expect(result.lineCount).toBe(1);
      expect(result.displayFormat).toBe('inline');
      expect(result.summary).toBeUndefined();
    });

    test('handles short multi-line input inline', () => {
      const input = 'Line 1\nLine 2\nLine 3';
      const result = processor.processInput(input);
      expect(result.content).toBe(input);
      expect(result.isMultiLine).toBe(true);
      expect(result.lineCount).toBe(3);
      expect(result.displayFormat).toBe('inline');
    });

    test('handles moderate multi-line input as block', () => {
      const input = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
      const result = processor.processInput(input);
      expect(result.content).toBe(input);
      expect(result.isMultiLine).toBe(true);
      expect(result.lineCount).toBe(5);
      expect(result.displayFormat).toBe('block');
      expect(result.summary).toBe('Line 1');
    });

    test('handles long multi-line input as paste-chip', () => {
      const lines = Array.from({ length: 15 }, (_, i) => `Line ${i + 1}`);
      const input = lines.join('\n');
      const result = processor.processInput(input);
      expect(result.content).toBe(input);
      expect(result.isMultiLine).toBe(true);
      expect(result.lineCount).toBe(15);
      expect(result.displayFormat).toBe('paste-chip');
      expect(result.summary).toContain('[Pasted text +15 lines]');
      expect(result.summary).toContain('Line 1');
    });

    test('truncates long first line in summary', () => {
      const longLine = 'A'.repeat(100);
      const input = `${longLine}\nLine 2\nLine 3\nLine 4\nLine 5`;
      const result = processor.processInput(input);
      expect(result.summary).toContain('...');
      expect(result.summary!.length).toBeLessThan(100);
    });
  });

  describe('formatForDisplay', () => {
    test('formats single line inline', () => {
      const result = processor.processInput('Hello world');
      const display = processor.formatForDisplay(result);
      expect(display).toBe('Hello world');
    });

    test('formats multi-line inline with visual indicators', () => {
      const input = 'Line 1\nLine 2';
      const result = processor.processInput(input);
      const display = processor.formatForDisplay(result);
      expect(display).toBe('Line 1 ↵ Line 2');
    });

    test('formats block content as-is', () => {
      const input = 'Line 1\nLine 2\nLine 3\nLine 4';
      const result = processor.processInput(input);
      const display = processor.formatForDisplay(result);
      expect(display).toBe(input);
    });

    test('formats paste-chip with summary', () => {
      const lines = Array.from({ length: 12 }, (_, i) => `Line ${i + 1}`);
      const input = lines.join('\n');
      const result = processor.processInput(input);
      const display = processor.formatForDisplay(result);
      expect(display).toContain('[Pasted text +12 lines]');
      expect(display).toContain('Line 1');
    });
  });

  describe('containsInitializationWarning', () => {
    test('detects initialization warnings', () => {
      const warnings = [
        'take a moment for complex initialization...',
        'initializing...',
        'loading...',
        'please wait...',
        'starting up...',
      ];

      warnings.forEach(warning => {
        expect(processor.containsInitializationWarning(warning)).toBe(true);
      });
    });

    test('does not detect normal text as warnings', () => {
      const normalTexts = [
        'Hello world',
        'Please help me with this',
        'I need to initialize the system',
        'Loading data from database',
      ];

      normalTexts.forEach(text => {
        expect(processor.containsInitializationWarning(text)).toBe(false);
      });
    });
  });

  describe('extractContentFromWarning', () => {
    test('extracts content from warning text', () => {
      const input = 'take a moment for complex initialization... Hello world';
      const { content, hadWarning } = processor.extractContentFromWarning(input);
      expect(hadWarning).toBe(true);
      expect(content).toBe('Hello world');
    });

    test('handles text without warnings', () => {
      const input = 'Hello world';
      const { content, hadWarning } = processor.extractContentFromWarning(input);
      expect(hadWarning).toBe(false);
      expect(content).toBe('Hello world');
    });

    test('handles multiple warnings', () => {
      const input = 'initializing... loading... please wait... Actual content';
      const { content, hadWarning } = processor.extractContentFromWarning(input);
      expect(hadWarning).toBe(true);
      expect(content).toBe('Actual content');
    });
  });

  describe('validateInput', () => {
    test('validates normal input', () => {
      const { isValid, issues } = processor.validateInput('Hello world');
      expect(isValid).toBe(true);
      expect(issues).toHaveLength(0);
    });

    test('rejects empty input', () => {
      const { isValid, issues } = processor.validateInput('   ');
      expect(isValid).toBe(false);
      expect(issues).toContain('Input is empty');
    });

    test('rejects excessively long input', () => {
      const longInput = 'A'.repeat(15000);
      const { isValid, issues } = processor.validateInput(longInput);
      expect(isValid).toBe(false);
      expect(issues).toContain('Input exceeds maximum length (10,000 characters)');
    });

    test('warns about excessive control characters', () => {
      const inputWithControls = 'Hello\x00\x01\x02\x03\x04\x05\x06 world';
      const { isValid, issues } = processor.validateInput(inputWithControls);
      expect(isValid).toBe(false);
      expect(issues).toContain('Input contains excessive control characters');
    });
  });
});