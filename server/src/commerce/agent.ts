/**
 * Commerce Agents — цикл одного хода агента поверх Messages API (стриминг + инструменты).
 *
 * По blueprint: один агент, skills подгружаются инструментом, UI-компоненты — тоже инструменты
 * (их исполняет сервер и отдаёт клиенту событием), параллельные вызовы одного раунда исполняются
 * одновременно, кэш промпта в три сегмента: [tools + static system] (cache_control) →
 * [история диалога] (скользящая точка на последнем сообщении) → [динамический контекст].
 * Текст стримится по мере генерации, карточки уходят сразу после исполнения инструмента.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { AgentEvent, ToolOutcome } from './types.js';

export interface RunTurnOptions {
  client: Anthropic;
  model: string;
  staticSystem: string;
  dynamicContext: string;
  tools: Anthropic.Tool[];
  history: Anthropic.MessageParam[];
  userMessage: string;
  execute: (name: string, input: Record<string, unknown>) => Promise<ToolOutcome>;
  emit: (event: AgentEvent) => void;
  progressFor?: (toolName: string) => string | null;
  maxRounds?: number;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high';
}

export interface TurnUsage { input: number; output: number; cache_read: number; cache_write: number }

export interface TurnResult {
  /** Новые сообщения этого хода (user + assistant + tool rounds) — то, что надо сохранить. */
  newMessages: Anthropic.MessageParam[];
  text: string;
  usage: TurnUsage;
  rounds: number;
  stopReason: string | null;
}

function withRollingBreakpoint(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (messages.length < 2) return messages;
  const out = messages.map((m) => {
    if (typeof m.content === 'string') return m;
    return { ...m, content: m.content.map((b: any) => (b && typeof b === 'object' && 'cache_control' in b ? (({ cache_control: _c, ...rest }) => rest)(b) : b)) } as Anthropic.MessageParam;
  });
  const last = out[out.length - 1];
  if (typeof last.content === 'string') {
    out[out.length - 1] = { ...last, content: [{ type: 'text', text: last.content, cache_control: { type: 'ephemeral' } } as any] };
  } else if (Array.isArray(last.content) && last.content.length) {
    const blocks = [...last.content] as any[];
    const idx = blocks.length - 1;
    blocks[idx] = { ...blocks[idx], cache_control: { type: 'ephemeral' } };
    out[out.length - 1] = { ...last, content: blocks };
  }
  return out;
}

function toolsWithCache(tools: Anthropic.Tool[]): Anthropic.Tool[] {
  if (!tools.length) return tools;
  const copy = tools.map((t) => ({ ...t }));
  (copy[copy.length - 1] as any).cache_control = { type: 'ephemeral' };
  return copy;
}

export async function runAgentTurn(o: RunTurnOptions): Promise<TurnResult> {
  const maxRounds = o.maxRounds ?? 6;
  const messages: Anthropic.MessageParam[] = [...o.history, { role: 'user', content: o.userMessage }];
  const startLen = o.history.length;
  const usage: TurnUsage = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  let text = '';
  let stopReason: string | null = null;
  let rounds = 0;
  const tools = toolsWithCache(o.tools);
  const system: any[] = [
    { type: 'text', text: o.staticSystem, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: o.dynamicContext },
  ];

  for (rounds = 1; rounds <= maxRounds; rounds++) {
    const params: any = {
      model: o.model,
      max_tokens: o.maxTokens ?? 4000,
      system,
      tools,
      messages: withRollingBreakpoint(messages),
    };
    if (o.effort) params.output_config = { effort: o.effort };

    const stream = o.client.messages.stream(params);
    let announced = new Set<string>();
    stream.on('text', (delta) => {
      text += delta;
      o.emit({ type: 'text', delta });
    });
    stream.on('contentBlock', (block) => {
      if (block.type === 'tool_use' && o.progressFor && !announced.has(block.name)) {
        announced.add(block.name);
        const p = o.progressFor(block.name);
        if (p) o.emit({ type: 'progress', text: p });
      }
    });
    const message = await stream.finalMessage();
    usage.input += message.usage.input_tokens || 0;
    usage.output += message.usage.output_tokens || 0;
    usage.cache_read += (message.usage as any).cache_read_input_tokens || 0;
    usage.cache_write += (message.usage as any).cache_creation_input_tokens || 0;
    stopReason = message.stop_reason;
    messages.push({ role: 'assistant', content: message.content });

    if (message.stop_reason === 'pause_turn') continue;
    if (message.stop_reason !== 'tool_use') break;

    const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (!toolUses.length) break;
    // Параллельное исполнение раунда; результаты — в одном user-сообщении, в порядке вызовов.
    const outcomes = await Promise.all(toolUses.map(async (tu) => {
      try {
        const input = (tu.input && typeof tu.input === 'object') ? (tu.input as Record<string, unknown>) : {};
        return await o.execute(tu.name, input);
      } catch (err) {
        return { result: `Tool ${tu.name} failed: ${(err as Error).message}`, isError: true } as ToolOutcome;
      }
    }));
    const results: Anthropic.ToolResultBlockParam[] = [];
    toolUses.forEach((tu, i) => {
      const oc = outcomes[i];
      for (const ev of oc.events || []) o.emit(ev);
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: oc.result || 'ok', ...(oc.isError ? { is_error: true } : {}) });
    });
    messages.push({ role: 'user', content: results });
  }

  return { newMessages: messages.slice(startLen), text, usage, rounds, stopReason };
}
