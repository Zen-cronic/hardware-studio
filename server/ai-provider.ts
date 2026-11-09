import { HttpError } from './store';

export const AI_MAX_INPUT_TOKENS = 18_000;
export const AI_MAX_OUTPUT_TOKENS = 8192;
// Conservative accounting includes each model’s longest cache write rate.
// Base rates: Astra $10/$50, Opus $4/$20 per MTok; no cache-read discounts.
export const FRONTIER_PRICING = { openai: { input: 25, output: 50 }, anthropic: { input: 8, output: 20 } };
export function selectedAiKey(env: NodeJS.ProcessEnv = process.env) {
  return env.AI_PROVIDER === 'anthropic' ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY;
}
export function selectedAiModel(env: NodeJS.ProcessEnv = process.env) {
  const provider = env.AI_PROVIDER || 'openai';
  const model = provider === 'anthropic' ? env.ANTHROPIC_MODEL || 'claude-opus-5-5' : env.OPENAI_MODEL || 'gpt-6-astra';
  if ((provider !== 'openai' && provider !== 'anthropic') || model !== (provider === 'openai' ? 'gpt-6-astra' : 'claude-opus-5-5'))
    throw new HttpError(503, 'AI is unavailable until its model and spending limit are configured.', 'AI_MODEL_UNPRICED');
  return { provider, model } as { provider: 'openai' | 'anthropic'; model: string };
}
export function providerRequest(system: string, prompt: string, images: string[]) {
  const { provider, model } = selectedAiModel();
  if (provider === 'openai') {
    const input = [{ role: 'user', content: [{ type: 'input_text', text: prompt + '\nReturn the proposal as JSON.' }, ...images.map(image_url => ({ type: 'input_image', image_url, detail: 'auto' }))] }];
    return { provider, countUrl: 'https://api.openai.com/v1/responses/input_tokens', url: 'https://api.openai.com/v1/responses',
      count: { model, instructions: system, input },
      body: { model, instructions: system, input, store: false, service_tier: 'default', reasoning: { effort: 'low' }, text: { format: { type: 'json_object' } }, max_output_tokens: AI_MAX_OUTPUT_TOKENS } };
  }
  const messages = [{ role: 'user', content: [{ type: 'text', text: prompt }, ...images.map(image => {
    const [prefix, data] = image.split(',');
    return { type: 'image', source: { type: 'base64', media_type: prefix.slice(5, -7), data } };
  })] }];
  return { provider, countUrl: 'https://api.anthropic.com/v1/messages/count_tokens', url: 'https://api.anthropic.com/v1/messages',
    count: { model, system, messages },
    body: { model, system, messages, max_tokens: AI_MAX_OUTPUT_TOKENS, output_config: { effort: 'low' } } };
}
export function providerHeaders(provider: 'openai' | 'anthropic', key: string): Record<string, string> {
  return { 'Content-Type': 'application/json', ...(provider === 'openai' ? { Authorization: 'Bearer ' + key } : { 'x-api-key': key, 'anthropic-version': '2023-06-01' }) };
}
export async function providerJson(url: string, body: unknown, headers: Record<string, string>, signal: AbortSignal) {
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!response.ok) {
    await response.body?.cancel();
    throw new HttpError(502, response.status === 401 || response.status === 403 ? 'The design assistant credential is not authorized for this model.' : 'The design assistant is temporarily unavailable. Keep working with measurements or retry.', 'AI_UNAVAILABLE');
  }
  return await response.json();
}
export function validateInputCount(data: any) {
  if (!Number.isSafeInteger(data?.input_tokens) || data.input_tokens < 0)
    throw new HttpError(502, 'The assistant could not verify this request’s spending bound.', 'AI_USAGE_INVALID');
  if (data.input_tokens > AI_MAX_INPUT_TOKENS)
    throw new HttpError(422, 'This design or its references are too large for one AI request. Use fewer references or a smaller assembly.', 'AI_INPUT_LIMIT');
}
export function providerUsage(provider: 'openai' | 'anthropic', data: any) {
  const usage = data?.usage || {};
  const parts = provider === 'openai' ? [usage.input_tokens] : [usage.input_tokens, usage.cache_creation_input_tokens ?? 0, usage.cache_read_input_tokens ?? 0];
  return { input: parts.every(v => Number.isSafeInteger(v) && v >= 0) ? parts.reduce((a, b) => a + b, 0) : undefined, output: usage.output_tokens };
}
export function providerText(provider: 'openai' | 'anthropic', data: any): string {
  const complete = provider === 'openai' ? data?.status === 'completed' : data?.stop_reason === 'end_turn';
  if (!complete) throw new HttpError(502, 'The assistant returned an incomplete proposal. Please try a more specific request.', 'AI_INVALID');
  const blocks = provider === 'openai' ? (data.output || []).filter((item: any) => item.type === 'message').flatMap((item: any) => item.content || []) : data.content || [];
  return blocks.filter((item: any) => item.type === (provider === 'openai' ? 'output_text' : 'text')).map((item: any) => item.text).join('');
}
