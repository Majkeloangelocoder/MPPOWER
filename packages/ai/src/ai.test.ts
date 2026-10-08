import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AIGateway, type UsageEvent } from './gateway.ts';
import { AnthropicProvider } from './providers/anthropic.ts';
import { OpenAIProvider } from './providers/openai.ts';
import { MockProvider } from './providers/mock.ts';
import { AIProviderError } from './types.ts';
import { buildRuleBasedReview, generateSessionReview, isGrounded, type SessionReviewFacts } from './tasks/session-review.ts';
import { assessMessageSafety } from './safety/red-flags.ts';

function fakeFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { impl, calls };
}

const schema = { name: 'review', schema: { type: 'object' } };

describe('adapter Claude (Messages API)', () => {
  it('wysyła output_config.format i zwraca sparsowany JSON', async () => {
    const { impl, calls } = fakeFetch(200, {
      model: 'claude-haiku-5-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"ok":true}' }],
      usage: { input_tokens: 120, output_tokens: 8 },
    });
    const p = new AnthropicProvider({ apiKey: 'test-key', fetchImpl: impl });
    const r = await p.generate({ model: 'claude-haiku-5-5', maxTokens: 300, messages: [{ role: 'user', content: 'x' }], jsonSchema: schema });
    assert.deepEqual(r.json, { ok: true });
    assert.equal(r.usage.inputTokens, 120);
    const call = calls[0];
    assert.ok(call);
    assert.equal(call.url, 'https://api.anthropic.com/v1/messages');
    const sent = JSON.parse(String(call.init.body));
    assert.equal(sent.output_config.format.type, 'json_schema');
    assert.equal(sent.max_tokens, 300);
    const headers = call.init.headers as Record<string, string>;
    assert.equal(headers['x-api-key'], 'test-key');
    assert.equal(headers['anthropic-version'], '2023-06-01');
  });

  it('odmowa modelu i przeciążenie API → czytelne błędy', async () => {
    const refused = new AnthropicProvider({ apiKey: 'k', fetchImpl: fakeFetch(200, { stop_reason: 'refusal', content: [] }).impl });
    await assert.rejects(refused.generate({ model: 'm', maxTokens: 10, messages: [] }), (e) => e instanceof AIProviderError && !e.retryable);
    const overloaded = new AnthropicProvider({ apiKey: 'k', fetchImpl: fakeFetch(529, { error: { message: 'Overloaded' } }).impl });
    await assert.rejects(overloaded.generate({ model: 'm', maxTokens: 10, messages: [] }), (e) => e instanceof AIProviderError && e.retryable && e.status === 529);
  });
});

describe('adapter OpenAI (zapasowy)', () => {
  it('wysyła response_format strict i max_completion_tokens, bez temperature', async () => {
    const { impl, calls } = fakeFetch(200, {
      model: 'fallback-model',
      choices: [{ finish_reason: 'stop', message: { content: '{"ok":1}' } }],
      usage: { prompt_tokens: 50, completion_tokens: 5 },
    });
    const p = new OpenAIProvider({ apiKey: 'k', fetchImpl: impl });
    const r = await p.generate({ model: 'fallback-model', maxTokens: 200, temperature: 0.4, messages: [{ role: 'user', content: 'x' }], jsonSchema: schema });
    assert.deepEqual(r.json, { ok: 1 });
    const sent = JSON.parse(String(calls[0]?.init.body));
    assert.equal(sent.response_format.json_schema.strict, true);
    assert.equal(sent.max_completion_tokens, 200);
    assert.equal('temperature' in sent, false);
  });
});

describe('AI Gateway', () => {
  it('błąd dostawcy głównego → zapasowy; oba wywołania w logu kosztów', async () => {
    const events: UsageEvent[] = [];
    const gw = new AIGateway({
      providers: {
        primary: new MockProvider(() => new AIProviderError('primary', 529, 'overloaded', true), 'primary'),
        backup: new MockProvider(() => 'ok', 'backup'),
      },
      policies: { t: { primary: { provider: 'primary', model: 'a' }, fallback: { provider: 'backup', model: 'b' }, maxTokens: 10, timeoutMs: 100 } },
      onUsage: (e) => {
        events.push(e);
      },
    });
    const r = await gw.run('t', { messages: [{ role: 'user', content: 'x' }], userId: 'u1' });
    assert.equal(r.provider, 'backup');
    assert.deepEqual(events.map((e) => [e.provider, e.ok, e.fallbackUsed]), [['primary', false, false], ['backup', true, true]]);
    assert.equal(events[1]?.userId, 'u1');
  });

  it('nieskonfigurowany dostawca jest pomijany, a brak wszystkich kończy się błędem', async () => {
    const gw = new AIGateway({
      providers: {},
      policies: { t: { primary: { provider: 'anthropic', model: 'a' }, maxTokens: 10, timeoutMs: 100 } },
    });
    await assert.rejects(gw.run('t', { messages: [] }), /Provider not configured/);
    await assert.rejects(gw.run('unknown', { messages: [] }), /Unknown AI task/);
  });
});

describe('AI Review po treningu', () => {
  const facts: SessionReviewFacts = {
    score: 9,
    records: [{ exerciseName: 'Wyciskanie hantli leżąc', kind: 'heaviest_load', value: 24, improvement: 2 }],
    nextTargets: [
      {
        exerciseName: 'Przysiad goblet',
        action: 'increase_load',
        loadKg: 22,
        repMin: 8,
        repMax: 12,
        sets: 3,
        explanation: 'Zwiększ ciężar do 22 kg (z 20 kg). Wszystkie serie w górnym zakresie (12 powt.) z zapasem RIR 2 lub większym. Cel: 3×8–12 powt.',
      },
    ],
  };
  const gatewayReturning = (text: string | Error) => {
    const mock = new MockProvider(() => text);
    const gw = new AIGateway({ providers: { mock }, policies: { session_review: { primary: { provider: 'mock', model: 'm' }, maxTokens: 10, timeoutMs: 100 } } });
    return { gw, mock };
  };

  it('podsumowanie z reguł w stylu briefu', () => {
    const r = buildRuleBasedReview(facts);
    assert.equal(r.headline, 'Dzisiejszy trening: 9/10');
    assert.equal(r.summary, 'Najlepszy wynik: Wyciskanie hantli leżąc +2 kg (24 kg).');
    assert.equal(r.nextFocus, 'Następnym razem: Przysiad goblet — 22 kg × 8–12.');
  });

  it('tekst AI z liczbami z faktów → używamy AI', async () => {
    const { gw } = gatewayReturning(JSON.stringify({ headline: 'Mocny trening: 9/10', summary: 'Wyciskanie poszło w górę o 2 kg.', nextFocus: 'Spróbuj 22 kg × 8–12 w przysiadzie.' }));
    const r = await generateSessionReview(gw, facts, { allowAi: true });
    assert.equal(r.source, 'ai');
  });

  it('AI dopisało liczbę spoza faktów → podsumowanie z reguł', async () => {
    const { gw } = gatewayReturning(JSON.stringify({ headline: 'Trening 9/10', summary: 'Dodaj 5 kg w przysiadzie.', nextFocus: 'Celuj w 27 kg.' }));
    assert.equal((await generateSessionReview(gw, facts, { allowAi: true })).source, 'rules');
    assert.equal(isGrounded('Dodaj 5 kg', facts), false);
  });

  it('błąd AI albo plan bez AI Review → reguły, bez wywołania modelu w planie FREE', async () => {
    const failing = gatewayReturning(new Error('down'));
    assert.equal((await generateSessionReview(failing.gw, facts, { allowAi: true })).source, 'rules');
    const free = gatewayReturning('{}');
    assert.equal((await generateSessionReview(free.gw, facts, { allowAi: false })).source, 'rules');
    assert.equal(free.mock.calls.length, 0);
  });
});

describe('sygnały alarmowe w czacie', () => {
  const cases: Array<[string, string | null]> = [
    ['Boli mnie w klatce piersiowej i mam duszność', 'emergency'],
    ['Nie mogę złapać tchu', 'emergency'],
    ['Po wczoraj mam ciemny mocz i bolą mnie mięśnie', 'emergency'],
    ['Ostatnio prowokuję wymioty po jedzeniu', 'eating_concern'],
    ['Czuję kłujący ból w kolanie przy przysiadzie', 'medical_consult'],
    ['Drętwieje mi noga i promieniuje do stopy', 'medical_consult'],
    ['Co zrobić na klatkę piersiową?', null],
    ['Mam lekkie zakwasy po nogach', null],
    ['Czy zwiększyć ciężar w przysiadzie?', null],
  ];
  for (const [text, expected] of cases) {
    it(`„${text}” → ${expected ?? 'brak sygnału'}`, () => {
      assert.equal(assessMessageSafety(text).category, expected);
    });
  }
});
