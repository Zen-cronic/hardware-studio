import { afterEach, expect, test, vi } from 'vitest';
import { Store } from '../server/store';
import { propose } from '../server/proposals';
import { selectedAiKey, selectedAiModel, providerRequest, providerUsage, AI_MAX_OUTPUT_TOKENS } from '../server/ai-provider';
const stores: Store[] = [];
afterEach(() => { stores.forEach(s => s.close()); stores.length = 0; vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const setup = (budgetUsd = 10) => { const store = new Store(':memory:', { budgetUsd, reservationUsd: 1 }); stores.push(store); return { store, snapshot: store.create('turntable').snapshot }; };
const proposal = { changes: { rpm: 9 }, explanation: 'Review the speed change.', questions: [] };
const reply = (provider: string) => provider === 'openai' ? { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(proposal) }] }], usage: { input_tokens: 100, output_tokens: 20 } } : { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: JSON.stringify(proposal) }], usage: { input_tokens: 100, cache_creation_input_tokens: 30, cache_read_input_tokens: 40, output_tokens: 20 } };
const request = { prompt: 'Set rpm to 9', actor: 'Maker' };
const rows = (store: Store) => store.db.prepare('SELECT status,spent,reserved,input_tokens,output_tokens FROM ai_usage').all() as any[];

test('selects only the explicit frontier provider and its credential; unknown models fail closed', () => {
 expect(selectedAiModel({})).toEqual({ provider: 'openai', model: 'gpt-6-astra' });
 expect(selectedAiModel({ AI_PROVIDER: 'anthropic' })).toEqual({ provider: 'anthropic', model: 'claude-opus-5-5' });
 expect(selectedAiKey({ AI_PROVIDER: 'anthropic', OPENAI_API_KEY: 'a', ANTHROPIC_API_KEY: 'b' })).toBe('b');
 expect(selectedAiKey({ AI_PROVIDER: 'anthropic', OPENAI_API_KEY: 'a' })).toBeUndefined();
 for (const env of [{ AI_PROVIDER: 'other' }, { OPENAI_MODEL: 'gpt-5.4-mini' }, { AI_PROVIDER: 'anthropic', ANTHROPIC_MODEL: 'unknown' }]) expect(() => selectedAiModel(env)).toThrow();
});

test.each(['openai', 'anthropic'])('%s sends bounded frontier text and image requests, accounts usage, leaves changes reviewable', async provider => {
 vi.stubEnv('AI_PROVIDER', provider);
 const { store, snapshot } = setup(), calls: any[] = [];
 vi.stubGlobal('fetch', vi.fn(async (url: string, options: any) => { calls.push({ url, ...options, body: JSON.parse(options.body) }); return new Response(JSON.stringify(url.endsWith('input_tokens') || url.endsWith('count_tokens') ? { input_tokens: 18000 } : reply(provider))); }));
 const result = await propose(store, snapshot, { ...request, images: ['data:image/png;base64,YQ=='] }, 'synthetic');
 expect(calls).toHaveLength(2); expect(result.source).toBe('ai'); expect(store.get(snapshot.design.id).design.revision).toBe(0);
 const generation = calls[1];
 if (provider === 'openai') {
  expect(generation.url).toBe('https://api.openai.com/v1/responses');
  expect(generation.body).toMatchObject({ model: 'gpt-6-astra', store: false, service_tier: 'default', reasoning: { effort: 'low' }, max_output_tokens: AI_MAX_OUTPUT_TOKENS });
  expect(generation.body.input[0].content[1]).toMatchObject({ type: 'input_image', image_url: 'data:image/png;base64,YQ==' });
  expect(generation.body.input[0].content[0].text).toContain('JSON');
  expect(generation.body).not.toHaveProperty('temperature');
 } else {
  expect(generation.url).toBe('https://api.anthropic.com/v1/messages');
  expect(generation.body).toMatchObject({ model: 'claude-opus-5-5', max_tokens: AI_MAX_OUTPUT_TOKENS, output_config: { effort: 'low' } });
  expect(generation.body.messages[0].content[1]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'YQ==' } });
  expect(generation.body).not.toHaveProperty('thinking');
 }
 expect(rows(store)[0]).toMatchObject({ status: 'complete', reserved: 0, input_tokens: provider === 'openai' ? 100 : 170, output_tokens: 20 });
 expect(rows(store)[0].spent).toBeCloseTo(provider === 'openai' ? .0035 : .00176);
});

test.each([18001, -1, 1.5, undefined])('rejects invalid/oversized input count %s before inference and releases reservation', async input_tokens => {
 const { store, snapshot } = setup(), fetch = vi.fn(async () => new Response(JSON.stringify({ input_tokens })));
 vi.stubGlobal('fetch', fetch);
 await expect(propose(store, snapshot, request, 'synthetic')).rejects.toThrow();
 expect(fetch).toHaveBeenCalledTimes(1); expect(rows(store)[0]).toMatchObject({ spent: 0, reserved: 0 });
});

test.each(['openai', 'anthropic'])('%s auth failure never retries or crosses providers', async provider => {
 vi.stubEnv('AI_PROVIDER', provider); const { store, snapshot } = setup();
 const fetch = vi.fn(async () => new Response('credential details must not escape', { status: 401 })); vi.stubGlobal('fetch', fetch);
 await expect(propose(store, snapshot, request, 'synthetic')).rejects.toMatchObject({ code: 'AI_UNAVAILABLE', message: 'The design assistant credential is not authorized for this model.' });
 expect(fetch).toHaveBeenCalledTimes(1); expect(rows(store)[0].reserved).toBe(0);
});

test('switching providers uses the same cumulative ledger and stops before either provider when depleted', async () => {
 const { store, snapshot } = setup(1.004);
 vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(/(?:input_tokens|count_tokens)$/.test(url) ? { input_tokens: 100 } : reply(process.env.AI_PROVIDER || 'openai')))));
 await propose(store, snapshot, request, 'synthetic');
 vi.stubEnv('AI_PROVIDER', 'anthropic'); await propose(store, snapshot, request, 'synthetic');
 expect(rows(store)).toHaveLength(2); expect(rows(store).reduce((n, row) => n + row.spent, 0)).toBeCloseTo(.00526);
 const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
 await expect(propose(store, snapshot, request, 'synthetic')).rejects.toMatchObject({ code: 'BUDGET_LIMIT' }); expect(fetch).not.toHaveBeenCalled();
});

test.each(['openai', 'anthropic'])('%s truncated response is charged and never accepted', async provider => {
 vi.stubEnv('AI_PROVIDER', provider); const { store, snapshot } = setup(); const data = { ...reply(provider), status: 'incomplete', stop_reason: 'max_tokens' };
 vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(/(?:input_tokens|count_tokens)$/.test(url) ? { input_tokens: 100 } : data))));
 await expect(propose(store, snapshot, request, 'synthetic')).rejects.toMatchObject({ code: 'AI_INVALID' }); expect(rows(store)[0].spent).toBeGreaterThan(0); expect(store.get(snapshot.design.id).design.revision).toBe(0);
});

test('cache accounting rejects malformed counters instead of undercharging', () => {
 expect(providerUsage('anthropic', { usage: { input_tokens: 1, cache_read_input_tokens: -1, output_tokens: 2 } }).input).toBeUndefined();
 expect(providerUsage('anthropic', { usage: { input_tokens: 1, cache_read_input_tokens: 2, cache_creation_input_tokens: 3, output_tokens: 4 } })).toEqual({ input: 6, output: 4 });
});
