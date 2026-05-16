import type { ConfirmationData, ConfirmationStatus } from './confirmation-types';

export type ChatMessageType = 'text' | 'confirmation' | 'error';

export interface ToolCallEntry {
  toolCallId: string;
  name: string;
  argsHint: string;
  argsFull?: string;
  result?: string;
  success?: boolean;
  durationSecs?: number;
  status: 'running' | 'done';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  type?: ChatMessageType;
  data?: ConfirmationData;
  status?: ConfirmationStatus;
  toolCalls?: ToolCallEntry[];
  streaming?: boolean;
}

export interface QueuedMessage {
  id: string;
  text: string;
}

export interface SessionEntry {
  key: string;
  messageCount: number;
  updatedAt?: string;
}

export type MessageContent = string | Array<string | { text: unknown }>;

// Raw pi-ai ToolCall content block
interface RawToolCall {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// Raw pi-ai ToolResultMessage
interface RawToolResult {
  role: 'toolResult';
  toolCallId: string;
  toolName: string;
  content: MessageContent;
  isError: boolean;
  timestamp?: number;
}

export interface HistoryMessage {
  role: string;
  content: MessageContent;
  timestamp?: string | number;
  /**
   * Optional stable id stamped at write time by the gateway side. Currently
   * only proactive sources (alerts, briefings) bother to set this so that
   * the live `chat.proactive` event and the post-F5 history rebuild collapse
   * to a single bubble; live LLM-streamed turns omit it and fall back to
   * `crypto.randomUUID()`.
   */
  id?: string;
}

/** Strip leaked tool XML and tool call announcements from display text. */
export function cleanDisplayText(text: string): string {
  return text
    // Remove <tool_call>...</tool_call> blocks (including multiline)
    .replace(/<tool_call[\s\S]*?<\/tool_call>/g, '')
    // Remove <tool_use>...</tool_use> blocks (including multiline)
    .replace(/<tool_use[\s\S]*?<\/tool_use>/g, '')
    // Remove <tool_result>...</tool_result> blocks (including multiline)
    .replace(/<tool_result[\s\S]*?<\/tool_result>/g, '')
    // Remove orphaned/partial tool tags
    .replace(/<\/?tool_(?:call|use|result)[^>]*>/g, '')
    // Remove tool call announcements like [ghost_bracket_order ...] or [mcp__ghost__ghost_bracket_order ...]
    .replace(/\[(?:mcp__ghost__)?ghost_\w+[^\]]*\]/g, '')
    .trim();
}

export function extractTextContent(content: MessageContent): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === 'string') {
      parts.push(part);
    } else if (part && typeof part === 'object' && 'text' in part) {
      parts.push(String(part.text));
    }
  }
  return parts.join('');
}

function extractToolCalls(content: MessageContent): RawToolCall[] {
  if (!Array.isArray(content)) return [];
  const calls: RawToolCall[] = [];
  for (const part of content) {
    if (part && typeof part === 'object' && 'type' in part) {
      const obj = part as unknown as Record<string, unknown>;
      if (obj.type === 'toolCall' && typeof obj.id === 'string' && typeof obj.name === 'string') {
        calls.push(obj as unknown as RawToolCall);
      }
    }
  }
  return calls;
}

function argsHint(args: unknown): string {
  try {
    const s = typeof args === 'string' ? args : JSON.stringify(args);
    return s.length > 80 ? s.slice(0, 80) + '\u2026' : s;
  } catch { return ''; }
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch { return String(value); }
}

export function historyToMessages(raw: HistoryMessage[], showToolCalls = false): ChatMessage[] {
  const out: ChatMessage[] = [];

  // Build a lookup of toolResult messages keyed by toolCallId
  const toolResults = new Map<string, RawToolResult>();
  for (const msg of raw) {
    if (msg.role === 'toolResult') {
      const tr = msg as unknown as RawToolResult;
      toolResults.set(tr.toolCallId, tr);
    }
  }

  // Pending tool calls from text-less assistant messages, to merge into the next text message
  let pendingToolCalls: ToolCallEntry[] = [];

  for (const msg of raw) {
    if (msg.role === 'user') {
      const text = extractTextContent(msg.content).trim();
      if (!text) continue;
      out.push({
        id: crypto.randomUUID(),
        role: 'user',
        content: text,
        timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
      });
    } else if (msg.role === 'assistant') {
      const text = cleanDisplayText(extractTextContent(msg.content));

      // Extract tool calls from this assistant message (only when debug tool chips enabled)
      const rawCalls = showToolCalls ? extractToolCalls(msg.content) : [];
      if (rawCalls.length > 0) {
        const entries = rawCalls.map((tc) => {
          const result = toolResults.get(tc.id);
          return {
            toolCallId: tc.id,
            name: tc.name,
            argsHint: argsHint(tc.arguments),
            argsFull: safeStringify(tc.arguments),
            result: result ? extractTextContent(result.content) : undefined,
            success: result ? !result.isError : undefined,
            status: 'done' as const,
          };
        });
        pendingToolCalls.push(...entries);
      }

      // No text — hold tool calls for the next text-bearing message
      if (!text) continue;

      // Deduplicate consecutive assistant messages with identical text
      const last = out[out.length - 1];
      if (last?.role === 'assistant' && last.content === text) continue;

      // Attach any pending tool calls to this message
      const toolCalls = showToolCalls && pendingToolCalls.length > 0 ? [...pendingToolCalls] : undefined;
      pendingToolCalls = [];

      out.push({
        id: msg.id ?? crypto.randomUUID(),
        role: 'assistant',
        content: text,
        timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
        toolCalls,
      });
    }
  }

  return out;
}
