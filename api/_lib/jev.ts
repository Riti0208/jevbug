/**
 * Server-side Jev core: validates a wire batch and evaluates it against either
 * the Vercel AI Gateway (`typesafe-ai/jev-latest`) or the TypeSafe API directly.
 *
 * Used by:
 *  - api/jev.ts (Vercel serverless function)
 *  - api/_lib/vite-dev-plugin.ts (`vite dev` middleware)
 *  - the headless CLI (`createInProcessTransport`), in-process — no HTTP hop.
 *
 * Never throws out of `evaluateBatch`: every request in the batch gets a
 * result, real or `{ error }`. One request's failure never fails the batch.
 */
import { experimental_evaluate as evaluate, APICallError } from 'ai';
import { createGateway } from '@ai-sdk/gateway';
import type { Experimental_EvaluationQuestion } from 'ai';
import type {
  JevBatchRequest,
  JevBatchResponse,
  JevQuestion,
  JevTransport,
  JevWireAnswer,
  JevWireRequest,
  JevWireResult,
  JsonObject,
} from '../../src/simulation/decision/jevProtocol';
import { JEV_LIMITS } from '../../src/simulation/decision/jevProtocol';

export interface JevServerEnv {
  AI_GATEWAY_API_KEY?: string;
  JEV_MODEL?: string;
  JEV_BACKEND?: 'gateway' | 'typesafe';
  TYPESAFE_API_KEY?: string;
  JEV_CONCURRENCY?: string;
  JEV_ALLOWED_ORIGIN?: string;
}

const DEFAULT_GATEWAY_MODEL = 'typesafe-ai/jev-latest';
const DEFAULT_TYPESAFE_MODEL = 'jev-latest';
const TYPESAFE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const DEFAULT_CONCURRENCY = 8;

export function resolveJevConfig(env: Record<string, string | undefined>): {
  backend: 'gateway' | 'typesafe';
  model: string;
  hasKey: boolean;
  concurrency: number;
} {
  const backend: 'gateway' | 'typesafe' = env.JEV_BACKEND === 'typesafe' ? 'typesafe' : 'gateway';
  const modelOverride = env.JEV_MODEL && env.JEV_MODEL.trim().length > 0 ? env.JEV_MODEL.trim() : undefined;
  const model = modelOverride ?? (backend === 'typesafe' ? DEFAULT_TYPESAFE_MODEL : DEFAULT_GATEWAY_MODEL);
  // Gateway auth: an explicit API key, or Vercel OIDC when running on Vercel
  // (the gateway SDK picks up VERCEL_OIDC_TOKEN itself when apiKey is undefined).
  const hasKey =
    backend === 'typesafe'
      ? Boolean(env.TYPESAFE_API_KEY)
      : Boolean(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN || env.VERCEL);
  const rawConcurrency = env.JEV_CONCURRENCY ? Number(env.JEV_CONCURRENCY) : NaN;
  const concurrency = Number.isFinite(rawConcurrency) && rawConcurrency > 0 ? Math.floor(rawConcurrency) : DEFAULT_CONCURRENCY;
  return { backend, model, hasKey, concurrency };
}

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function hasDangerousKey(obj: Record<string, unknown>): boolean {
  return Object.keys(obj).some((k) => DANGEROUS_KEYS.has(k));
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function validateBatch(body: unknown): { ok: true; batch: JevBatchRequest } | { ok: false; error: string } {
  if (!isPlainObject(body) || hasDangerousKey(body)) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }

  const requestsRaw = body.requests;
  if (!Array.isArray(requestsRaw)) return { ok: false, error: '"requests" must be an array.' };
  if (requestsRaw.length === 0) return { ok: false, error: '"requests" must not be empty.' };
  if (requestsRaw.length > JEV_LIMITS.maxRequestsPerBatch) {
    return { ok: false, error: `"requests" exceeds the max batch size of ${JEV_LIMITS.maxRequestsPerBatch}.` };
  }

  const modelRaw = body.model;
  if (modelRaw !== undefined && typeof modelRaw !== 'string') {
    return { ok: false, error: '"model" must be a string.' };
  }

  const requests: JevWireRequest[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < requestsRaw.length; i++) {
    const r = requestsRaw[i];
    if (!isPlainObject(r) || hasDangerousKey(r)) return { ok: false, error: `requests[${i}] must be an object.` };

    const { id, state, questions } = r;
    if (typeof id !== 'string' || id.length === 0) return { ok: false, error: `requests[${i}].id must be a non-empty string.` };
    if (seenIds.has(id)) return { ok: false, error: `requests[${i}].id "${id}" is duplicated in this batch.` };
    seenIds.add(id);

    if (!isPlainObject(state) || hasDangerousKey(state)) return { ok: false, error: `requests[${i}].state must be an object.` };
    if (byteLength(JSON.stringify(state)) > JEV_LIMITS.maxStateBytes) {
      return { ok: false, error: `requests[${i}].state exceeds ${JEV_LIMITS.maxStateBytes} bytes.` };
    }

    if (!isPlainObject(questions) || hasDangerousKey(questions)) {
      return { ok: false, error: `requests[${i}].questions must be an object.` };
    }
    const qEntries = Object.entries(questions);
    if (qEntries.length === 0) return { ok: false, error: `requests[${i}].questions must not be empty.` };
    if (qEntries.length > JEV_LIMITS.maxQuestionsPerRequest) {
      return { ok: false, error: `requests[${i}].questions exceeds the max of ${JEV_LIMITS.maxQuestionsPerRequest}.` };
    }

    const sanitizedQuestions: Record<string, JevQuestion> = {};
    for (const [qid, qRaw] of qEntries) {
      if (DANGEROUS_KEYS.has(qid)) return { ok: false, error: `requests[${i}].questions has an invalid key "${qid}".` };
      if (!isPlainObject(qRaw) || hasDangerousKey(qRaw)) return { ok: false, error: `requests[${i}].questions.${qid} must be an object.` };
      if (qRaw.type !== 'choice') return { ok: false, error: `requests[${i}].questions.${qid}.type must be "choice".` };

      const instructions = qRaw.instructions;
      if (typeof instructions !== 'string' && !(isPlainObject(instructions) && !hasDangerousKey(instructions))) {
        return { ok: false, error: `requests[${i}].questions.${qid}.instructions must be a string or a plain object.` };
      }

      const criteria = qRaw.criteria;
      if (!isPlainObject(criteria) || hasDangerousKey(criteria)) {
        return { ok: false, error: `requests[${i}].questions.${qid}.criteria must be an object.` };
      }
      const criteriaEntries = Object.entries(criteria);
      if (criteriaEntries.length === 0) return { ok: false, error: `requests[${i}].questions.${qid}.criteria must not be empty.` };
      if (criteriaEntries.length > JEV_LIMITS.maxCriteria) {
        return { ok: false, error: `requests[${i}].questions.${qid}.criteria exceeds the max of ${JEV_LIMITS.maxCriteria} options.` };
      }

      const sanitizedCriteria: Record<string, string | null> = {};
      for (const [ck, cv] of criteriaEntries) {
        if (DANGEROUS_KEYS.has(ck)) return { ok: false, error: `requests[${i}].questions.${qid}.criteria has an invalid key "${ck}".` };
        if (cv !== null && typeof cv !== 'string') {
          return { ok: false, error: `requests[${i}].questions.${qid}.criteria.${ck} must be a string or null.` };
        }
        sanitizedCriteria[ck] = cv;
      }

      sanitizedQuestions[qid] = { type: 'choice', instructions: instructions as string | JsonObject, criteria: sanitizedCriteria };
    }

    requests.push({ id, state: state as JsonObject, questions: sanitizedQuestions });
  }

  return { ok: true, batch: { requests, model: modelRaw as string | undefined } };
}

function classifyError(err: unknown): { message: string; status?: number; retryable?: boolean } {
  if (APICallError.isInstance(err)) {
    return { message: err.message, status: err.statusCode, retryable: err.isRetryable };
  }
  if (err instanceof Error) return { message: err.message, retryable: false };
  return { message: 'Unknown error evaluating with Jev.', retryable: false };
}

async function evaluateViaGateway(
  req: JevWireRequest,
  model: string,
  env: Record<string, string | undefined>,
  evaluateFn: typeof evaluate,
): Promise<JevWireResult> {
  const gateway = createGateway({ apiKey: env.AI_GATEWAY_API_KEY || undefined });
  const questions: Record<string, Experimental_EvaluationQuestion> = {};
  for (const [qid, q] of Object.entries(req.questions)) {
    questions[qid] = { type: 'choice', instructions: q.instructions, criteria: q.criteria };
  }

  const result = await evaluateFn({
    model: gateway.evaluationModel(model),
    state: req.state,
    questions,
    maxRetries: 2,
  });

  const answers: Record<string, JevWireAnswer> = {};
  for (const [qid, ans] of Object.entries(result.answers)) {
    if (ans && (ans as { type: string }).type === 'choice') {
      const choiceAns = ans as { type: 'choice'; choice: string; probabilities?: Record<string, number> };
      answers[qid] = { type: 'choice', choice: choiceAns.choice, probabilities: choiceAns.probabilities };
    }
  }

  return {
    id: req.id,
    answers,
    usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
  };
}

async function evaluateViaTypesafe(
  req: JevWireRequest,
  model: string,
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch,
): Promise<JevWireResult> {
  const res = await fetchImpl(TYPESAFE_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.TYPESAFE_API_KEY ?? ''}`,
    },
    body: JSON.stringify({ model: model || DEFAULT_TYPESAFE_MODEL, state: req.state, questions: req.questions }),
  });

  if (!res.ok) {
    let message = `TypeSafe request failed with status ${res.status}`;
    try {
      const errBody = (await res.json()) as { error?: string; message?: string };
      if (errBody && typeof errBody.error === 'string' && errBody.error) message = errBody.error;
      else if (errBody && typeof errBody.message === 'string' && errBody.message) message = errBody.message;
    } catch {
      // ignore body parse failures
    }
    const retryable = res.status === 429 || res.status >= 500;
    return { id: req.id, error: { message, status: res.status, retryable } };
  }

  const body = (await res.json()) as {
    answers?: Record<string, { type?: string; choice?: string; probabilities?: Record<string, number> }>;
    usage?: { inputTokens?: number; outputTokens?: number };
  };

  const answers: Record<string, JevWireAnswer> = {};
  for (const [qid, ans] of Object.entries(body.answers ?? {})) {
    if (ans && ans.type === 'choice' && typeof ans.choice === 'string') {
      answers[qid] = { type: 'choice', choice: ans.choice, probabilities: ans.probabilities };
    }
  }

  return { id: req.id, answers, usage: body.usage };
}

export async function evaluateBatch(
  batch: JevBatchRequest,
  env: Record<string, string | undefined>,
  deps?: { evaluate?: typeof evaluate; fetch?: typeof fetch },
): Promise<JevBatchResponse> {
  const config = resolveJevConfig(env);
  const started = Date.now();

  if (!config.hasKey) {
    const message =
      config.backend === 'typesafe'
        ? 'Jev is not configured (TYPESAFE_API_KEY missing)'
        : 'Jev is not configured (AI_GATEWAY_API_KEY missing)';
    return {
      results: batch.requests.map((r) => ({ id: r.id, error: { message, retryable: false } })),
      model: config.model,
      backend: config.backend,
      totalLatencyMs: Date.now() - started,
    };
  }

  const evaluateFn = deps?.evaluate ?? evaluate;
  const fetchFn = deps?.fetch ?? fetch;
  const results: JevWireResult[] = new Array(batch.requests.length);
  const model = batch.model && batch.model.trim().length > 0 ? batch.model : config.model;

  let idx = 0;
  const runOne = async (): Promise<void> => {
    while (idx < batch.requests.length) {
      const i = idx++;
      const req = batch.requests[i];
      const t0 = Date.now();
      try {
        results[i] =
          config.backend === 'typesafe'
            ? await evaluateViaTypesafe(req, model, env, fetchFn)
            : await evaluateViaGateway(req, model, env, evaluateFn);
      } catch (err) {
        results[i] = { id: req.id, error: classifyError(err) };
      }
      results[i].latencyMs = Date.now() - t0;
    }
  };

  const workerCount = Math.min(config.concurrency, batch.requests.length);
  await Promise.all(Array.from({ length: workerCount }, runOne));

  return { results, model, backend: config.backend, totalLatencyMs: Date.now() - started };
}

export function createInProcessTransport(env?: Record<string, string | undefined>): JevTransport {
  return (batch: JevBatchRequest) => evaluateBatch(batch, env ?? process.env);
}
