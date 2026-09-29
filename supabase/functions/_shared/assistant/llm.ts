// Provider-neutral OpenAI-compatible Chat Completions client, configured only
// through LLM_BASE_URL / LLM_API_KEY / LLM_MODEL. The key never leaves the server.
import {envInt, optionalEnv} from '../env.ts';

export type LlmToolCall = {id: string; type: 'function'; function: {name: string; arguments: string}};
export type LlmMessage =
  | {role: 'system' | 'user'; content: string}
  | {role: 'assistant'; content: string | null; tool_calls?: LlmToolCall[]}
  | {role: 'tool'; tool_call_id: string; content: string};
export type LlmTool = {type: 'function'; function: {name: string; description: string; parameters: Record<string, unknown>}};
export type LlmRequest = {
  messages: LlmMessage[];
  tools?: LlmTool[];
  toolChoice?: 'auto' | 'required' | 'none';
  json?: boolean;
  maxTokens?: number;
};
export type LlmResponse = {content: string | null; toolCalls: LlmToolCall[]; usage: {total: number}};

export class LlmUnavailable extends Error {}
export class LlmToolsUnsupported extends Error {}

export function llmConfigured(): boolean {
  return Boolean(optionalEnv('LLM_BASE_URL') && optionalEnv('LLM_API_KEY') && optionalEnv('LLM_MODEL'));
}

export async function chat(req: LlmRequest): Promise<LlmResponse> {
  const base = optionalEnv('LLM_BASE_URL');
  const key = optionalEnv('LLM_API_KEY');
  const model = optionalEnv('LLM_MODEL');
  if (!base || !key || !model) throw new LlmUnavailable('LLM is not configured');
  const body: Record<string, unknown> = {
    model,
    messages: req.messages,
    max_tokens: req.maxTokens ?? envInt('LLM_MAX_TOKENS', 700),
  };
  if (req.tools?.length) {
    body.tools = req.tools;
    body.tool_choice = req.toolChoice ?? 'auto';
  }
  if (req.json && optionalEnv('LLM_JSON_MODE') === '1') body.response_format = {type: 'json_object'};
  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${key}`},
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(envInt('LLM_TIMEOUT_MS', 25_000)),
    });
  } catch (error) {
    throw new LlmUnavailable(`LLM request failed: ${(error as Error).message}`);
  }
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 400 && req.tools?.length && /tool/i.test(text)) throw new LlmToolsUnsupported(text.slice(0, 300));
    throw new LlmUnavailable(`LLM HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  let data: {choices?: {message?: {content?: string | null; tool_calls?: LlmToolCall[]}}[]; usage?: {total_tokens?: number; prompt_tokens?: number; completion_tokens?: number}};
  try {
    data = JSON.parse(text);
  } catch {
    throw new LlmUnavailable('LLM returned invalid JSON');
  }
  const message = data.choices?.[0]?.message;
  if (!message) throw new LlmUnavailable('LLM returned no choices');
  const usage = data.usage?.total_tokens ?? (data.usage?.prompt_tokens ?? 0) + (data.usage?.completion_tokens ?? 0);
  return {content: message.content ?? null, toolCalls: message.tool_calls ?? [], usage: {total: usage || Math.ceil(text.length / 3)}};
}

/** Extracts the first JSON object from a model reply (tolerates code fences / prose). */
export function extractJson(text: string | null): unknown {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}
