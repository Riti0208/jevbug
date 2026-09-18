import { describe, expect, it, vi } from 'vitest';
import { createInProcessTransport, evaluateBatch, resolveJevConfig, validateBatch } from './jev';
import { JEV_LIMITS } from '../../src/simulation/decision/jevProtocol';
import type { JevBatchRequest, JevWireRequest } from '../../src/simulation/decision/jevProtocol';

function baseRequest(id = 'bug-1'): JevWireRequest {
  return {
    id,
    state: { creature: { energy: 0.5 } },
    questions: {
      action: { type: 'choice', instructions: 'pick one', criteria: { MOVE_FORWARD: 'move', REST: 'rest' } },
      signal: { type: 'choice', instructions: 'pick one', criteria: { NONE: 'none', A: null, B: null } },
    },
  };
}

describe('resolveJevConfig', () => {
  it('defaults to the gateway backend and the documented default model', () => {
    const cfg = resolveJevConfig({});
    expect(cfg.backend).toBe('gateway');
    expect(cfg.model).toBe('typesafe-ai/jev-latest');
    expect(cfg.hasKey).toBe(false);
    expect(cfg.concurrency).toBe(8);
  });

  it('honors JEV_BACKEND=typesafe, TYPESAFE_API_KEY, and JEV_MODEL/JEV_CONCURRENCY overrides', () => {
    const cfg = resolveJevConfig({ JEV_BACKEND: 'typesafe', TYPESAFE_API_KEY: 'sk', JEV_MODEL: 'jev-custom', JEV_CONCURRENCY: '3' });
    expect(cfg.backend).toBe('typesafe');
    expect(cfg.model).toBe('jev-custom');
    expect(cfg.hasKey).toBe(true);
    expect(cfg.concurrency).toBe(3);
  });
});

describe('validateBatch', () => {
  it('accepts a well-formed batch', () => {
    const result = validateBatch({ requests: [baseRequest()] });
    expect(result.ok).toBe(true);
  });

  it('rejects a non-object body', () => {
    expect(validateBatch('nope').ok).toBe(false);
    expect(validateBatch(null).ok).toBe(false);
    expect(validateBatch([1, 2, 3]).ok).toBe(false);
  });

  it('rejects a missing or empty requests array', () => {
    expect(validateBatch({}).ok).toBe(false);
    expect(validateBatch({ requests: [] }).ok).toBe(false);
  });

  it('rejects a batch exceeding maxRequestsPerBatch', () => {
    const requests = Array.from({ length: JEV_LIMITS.maxRequestsPerBatch + 1 }, (_, i) => baseRequest(`bug-${i}`));
    const result = validateBatch({ requests });
    expect(result.ok).toBe(false);
  });

  it('rejects duplicate ids within a batch', () => {
    const result = validateBatch({ requests: [baseRequest('dup'), baseRequest('dup')] });
    expect(result.ok).toBe(false);
  });

  it('rejects a state exceeding maxStateBytes', () => {
    const bloated = baseRequest();
    (bloated.state as Record<string, unknown>).filler = 'x'.repeat(JEV_LIMITS.maxStateBytes + 1);
    const result = validateBatch({ requests: [bloated] });
    expect(result.ok).toBe(false);
  });

  it('rejects more than maxQuestionsPerRequest questions', () => {
    const req = baseRequest();
    for (let i = 0; i < JEV_LIMITS.maxQuestionsPerRequest; i++) {
      (req.questions as Record<string, unknown>)[`extra_${i}`] = { type: 'choice', instructions: 'x', criteria: { A: null } };
    }
    const result = validateBatch({ requests: [req] });
    expect(result.ok).toBe(false);
  });

  it('rejects more than maxCriteria options', () => {
    const req = baseRequest();
    const criteria: Record<string, string | null> = {};
    for (let i = 0; i < JEV_LIMITS.maxCriteria + 1; i++) criteria[`OPT_${i}`] = null;
    (req.questions as Record<string, unknown>).action = { type: 'choice', instructions: 'x', criteria };
    const result = validateBatch({ requests: [req] });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-"choice" question type', () => {
    const req = baseRequest();
    (req.questions as Record<string, unknown>).action = { type: 'score', instructions: 'x', criteria: ['lo', 'hi'] };
    const result = validateBatch({ requests: [req] });
    expect(result.ok).toBe(false);
  });

  it('rejects prototype-pollution-shaped keys (as they arrive via JSON.parse, i.e. as real own properties)', () => {
    const topLevel = JSON.parse('{"requests":[],"__proto__":{"polluted":true}}');
    expect(Object.prototype.hasOwnProperty.call(topLevel, '__proto__')).toBe(true);
    expect(validateBatch(topLevel).ok).toBe(false);

    const req = JSON.parse('{"id":"a","state":{"__proto__":{"x":1}},"questions":{}}');
    expect(validateBatch({ requests: [req] }).ok).toBe(false);
  });
});

describe('evaluateBatch', () => {
  it('reports a non-throwing per-result error for every request when no key is configured', async () => {
    const batch: JevBatchRequest = { requests: [baseRequest('a'), baseRequest('b')] };
    const response = await evaluateBatch(batch, {});
    expect(response.results).toHaveLength(2);
    for (const r of response.results) {
      expect(r.error?.message).toContain('AI_GATEWAY_API_KEY missing');
      expect(r.error?.retryable).toBe(false);
      expect(r.answers).toBeUndefined();
    }
  });

  it('maps answers/usage/latency from an injected fake `evaluate`, and isolates one failure from the rest', async () => {
    const fakeEvaluate = vi.fn(async ({ state }: { state: unknown }) => {
      const s = state as { creature: { energy: number } };
      if (s.creature.energy < 0) throw new Error('boom');
      return {
        answers: {
          action: { type: 'choice', choice: 'REST', probabilities: { REST: 1 } },
          signal: { type: 'choice', choice: 'NONE' },
        },
        usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 },
        warnings: [],
        rounding: undefined,
        providerMetadata: undefined,
        response: { modelId: 'typesafe-ai/jev-latest', timestamp: new Date() },
      };
    });

    const good = baseRequest('good');
    const bad = { ...baseRequest('bad'), state: { creature: { energy: -1 } } };
    const batch: JevBatchRequest = { requests: [good, bad] };

    const response = await evaluateBatch(batch, { AI_GATEWAY_API_KEY: 'test-key' }, { evaluate: fakeEvaluate as never });

    expect(response.backend).toBe('gateway');
    expect(response.results).toHaveLength(2);

    const goodResult = response.results.find((r) => r.id === 'good')!;
    expect(goodResult.answers?.action).toEqual({ type: 'choice', choice: 'REST', probabilities: { REST: 1 } });
    expect(goodResult.usage).toEqual({ inputTokens: 12, outputTokens: 3 });
    expect(typeof goodResult.latencyMs).toBe('number');

    const badResult = response.results.find((r) => r.id === 'bad')!;
    expect(badResult.error?.message).toBe('boom');
    expect(badResult.answers).toBeUndefined();
  });

  it('calls the typesafe endpoint with an injected fake fetch and maps a successful choice answer', async () => {
    const fakeFetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://api.typesafe.ai/v1/systemone');
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('jev-latest');
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
      return new Response(JSON.stringify({ answers: { action: { type: 'choice', choice: 'EAT' }, signal: { type: 'choice', choice: 'NONE' } }, usage: { inputTokens: 1, outputTokens: 1 } }), {
        status: 200,
      });
    });

    const batch: JevBatchRequest = { requests: [baseRequest('a')] };
    const response = await evaluateBatch(batch, { JEV_BACKEND: 'typesafe', TYPESAFE_API_KEY: 'sk-test' }, { fetch: fakeFetch as unknown as typeof fetch });

    expect(response.backend).toBe('typesafe');
    expect(response.results[0].answers?.action).toEqual({ type: 'choice', choice: 'EAT', probabilities: undefined });
  });

  it('marks a 429 from the typesafe backend as retryable and does not throw', async () => {
    const fakeFetch = vi.fn(async () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }));
    const batch: JevBatchRequest = { requests: [baseRequest('a')] };
    const response = await evaluateBatch(batch, { JEV_BACKEND: 'typesafe', TYPESAFE_API_KEY: 'sk-test' }, { fetch: fakeFetch as unknown as typeof fetch });

    expect(response.results[0].error).toEqual({ message: 'rate limited', status: 429, retryable: true });
  });
});

describe('createInProcessTransport', () => {
  it('wraps evaluateBatch using the provided env, without a key configured', async () => {
    const transport = createInProcessTransport({});
    const response = await transport({ requests: [baseRequest('a')] });
    expect(response.results[0].error?.message).toContain('AI_GATEWAY_API_KEY missing');
  });
});
