#!/usr/bin/env node
/**
 * LEAN CODING AGENT CLI
 *
 * A minimal, streamlined CLI for the unified coding agent.
 * Usage: lean [prompt] or interactive mode
 */

import * as readline from 'readline';
import { LeanAgent } from '../leanAgent.js';
import type { LLMProvider, ConversationMessage, ProviderToolDefinition, ProviderResponse, StreamChunk, ProviderId } from '../core/types.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

function getApiKey(): string | undefined {
  return (
    process.env['DEEPSEEK_API_KEY'] ??
    process.env['OPENAI_API_KEY'] ??
    process.env['ANTHROPIC_API_KEY']
  );
}

function getProviderConfig(): { baseUrl: string; model: string; providerId: string } {
  if (process.env['DEEPSEEK_API_KEY']) {
    return {
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      providerId: 'deepseek',
    };
  }
  if (process.env['OPENAI_API_KEY']) {
    return {
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4-turbo-preview',
      providerId: 'openai',
    };
  }
  return {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    providerId: 'deepseek',
  };
}

// ============================================================================
// SIMPLE LLM PROVIDER
// ============================================================================

function createSimpleProvider(apiKey: string, config: ReturnType<typeof getProviderConfig>): LLMProvider {
  const { baseUrl, model, providerId } = config;

  return {
    id: providerId as ProviderId,
    model,

    async generate(
      messages: ConversationMessage[],
      tools: ProviderToolDefinition[]
    ): Promise<ProviderResponse> {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
            ...(m.role === 'assistant' && m.toolCalls ? {
              tool_calls: m.toolCalls.map(tc => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
              })),
            } : {}),
            ...(m.role === 'tool' ? { tool_call_id: m.toolCallId, name: m.name } : {}),
          })),
          tools: tools.length > 0 ? tools.map(t => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })) : undefined,
          tool_choice: tools.length > 0 ? 'auto' : undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API error: ${response.status} - ${error}`);
      }

      const data = await response.json() as {
        choices?: Array<{
          message?: {
            content?: string;
            tool_calls?: Array<{
              id: string;
              function: { name: string; arguments: string };
            }>;
          };
        }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const choice = data.choices?.[0];

      if (!choice) {
        return { type: 'message', content: '' };
      }

      const message = choice.message;
      const toolCalls = message?.tool_calls;

      if (toolCalls?.length) {
        return {
          type: 'tool_calls',
          content: message?.content ?? undefined,
          toolCalls: toolCalls.map(tc => ({
            id: tc.id,
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>,
          })),
          usage: data.usage ? {
            inputTokens: data.usage.prompt_tokens,
            outputTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          } : undefined,
        };
      }

      return {
        type: 'message',
        content: message?.content || '',
        usage: data.usage ? {
          inputTokens: data.usage.prompt_tokens,
          outputTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        } : undefined,
      };
    },

    async *generateStream(
      messages: ConversationMessage[],
      tools: ProviderToolDefinition[]
    ): AsyncIterableIterator<StreamChunk> {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
            ...(m.role === 'assistant' && m.toolCalls ? {
              tool_calls: m.toolCalls.map(tc => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
              })),
            } : {}),
            ...(m.role === 'tool' ? { tool_call_id: m.toolCallId, name: m.name } : {}),
          })),
          tools: tools.length > 0 ? tools.map(t => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })) : undefined,
          tool_choice: tools.length > 0 ? 'auto' : undefined,
          stream: true,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API error: ${response.status} - ${error}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      const toolCallsBuffer: Map<number, { id: string; name: string; arguments: string }> = new Map();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            if (dataStr === '[DONE]') continue;

            try {
              const parsed = JSON.parse(dataStr) as {
                choices?: Array<{
                  delta?: {
                    content?: string;
                    tool_calls?: Array<{
                      index?: number;
                      id?: string;
                      function?: { name?: string; arguments?: string };
                    }>;
                  };
                }>;
                usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
              };
              const delta = parsed.choices?.[0]?.delta;

              if (delta?.content) {
                yield { type: 'content' as const, content: delta.content };
              }

              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  const existing = toolCallsBuffer.get(idx) || { id: '', name: '', arguments: '' };
                  if (tc.id) existing.id = tc.id;
                  if (tc.function?.name) existing.name = tc.function.name;
                  if (tc.function?.arguments) existing.arguments += tc.function.arguments;
                  toolCallsBuffer.set(idx, existing);
                }
              }

              if (parsed.usage) {
                yield {
                  type: 'usage' as const,
                  usage: {
                    inputTokens: parsed.usage.prompt_tokens,
                    outputTokens: parsed.usage.completion_tokens,
                    totalTokens: parsed.usage.total_tokens,
                  },
                };
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }

      // Emit collected tool calls
      if (toolCallsBuffer.size > 0) {
        for (const [, tc] of toolCallsBuffer) {
          try {
            yield {
              type: 'tool_call' as const,
              toolCall: {
                id: tc.id,
                name: tc.name,
                arguments: JSON.parse(tc.arguments || '{}') as Record<string, unknown>,
              },
            };
          } catch {
            // Skip invalid tool calls
          }
        }
      }

      yield { type: 'done' as const };
    },
  };
}

// ============================================================================
// CLI INTERFACE
// ============================================================================

async function runInteractive(agent: LeanAgent): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('\n🤖 Lean Coding Agent');
  console.log('Type your request or "exit" to quit\n');

  const prompt = (): void => {
    rl.question('> ', async (input) => {
      const trimmed = input.trim();

      if (!trimmed || trimmed === 'exit' || trimmed === 'quit') {
        console.log('Goodbye!');
        rl.close();
        return;
      }

      if (trimmed === 'clear') {
        agent.clearHistory();
        console.log('History cleared.\n');
        prompt();
        return;
      }

      try {
        process.stdout.write('\n');
        const response = await agent.chat(trimmed, true);

        console.log('\n' + response.content);

        if (response.toolsUsed.length > 0) {
          console.log(`\n[Tools: ${response.toolsUsed.join(', ')}]`);
        }
        console.log(`[${response.elapsedMs}ms]\n`);
      } catch (error) {
        console.error('Error:', (error as Error).message);
      }

      prompt();
    });
  };

  prompt();
}

async function runQuick(agent: LeanAgent, userPrompt: string): Promise<void> {
  try {
    const response = await agent.chat(userPrompt, false);
    console.log(response.content);
  } catch (error) {
    console.error('Error:', (error as Error).message);
    process.exit(1);
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Lean Coding Agent - Minimal AI coding assistant

Usage:
  lean                    Interactive mode
  lean "prompt"           Execute single prompt
  lean -q "prompt"        Quick mode (non-interactive)

Environment:
  DEEPSEEK_API_KEY       DeepSeek API key
  OPENAI_API_KEY         OpenAI API key (fallback)
`);
    return;
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    console.error('Error: No API key found. Set DEEPSEEK_API_KEY or OPENAI_API_KEY');
    process.exit(1);
  }

  const providerConfig = getProviderConfig();
  const provider = createSimpleProvider(apiKey, providerConfig);

  const agent = new LeanAgent({
    provider,
    providerId: providerConfig.providerId,
    modelId: providerConfig.model,
    workingDir: process.cwd(),
    callbacks: {
      onStreamChunk: (chunk) => {
        process.stdout.write(chunk);
      },
    },
  });

  const quickMode = args.includes('-q') || args.includes('--quick');
  const promptArgs = args.filter(a => !a.startsWith('-'));

  if (promptArgs.length > 0) {
    const userPrompt = promptArgs.join(' ');
    if (quickMode) {
      await runQuick(agent, userPrompt);
    } else {
      const response = await agent.chat(userPrompt, true);
      console.log('\n' + response.content + '\n');
      await runInteractive(agent);
    }
  } else {
    await runInteractive(agent);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
