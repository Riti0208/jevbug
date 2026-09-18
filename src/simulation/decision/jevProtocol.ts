/**
 * Wire protocol shared by the browser (JevDecisionProvider) and the server
 * (api/jev.ts, api/_lib/jev.ts, the vite dev plugin, and the headless CLI).
 *
 * IMPORTANT: no runtime dependencies here (no 'ai', no '@ai-sdk/gateway', no DOM).
 * This file must be importable from both browser and Node/edge code unchanged.
 *
 * EXPERIMENTAL INTEGRITY: nothing in this module should ever carry a sender's
 * identity, world-global information, or a suggestive label for a signal — see
 * jevState.ts, which is what actually builds the `state`/`questions` payloads.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/**
 * We only ever send 'choice' questions to Jev (action, signal). The type is kept
 * narrow on purpose — see api/_lib/jev.ts `validateBatch`, which rejects anything else.
 */
export interface JevQuestion {
  type: 'choice';
  instructions: string | JsonObject;
  /** Option name -> description. `null` means "no description" (used for signal tokens). */
  criteria: Record<string, string | null>;
}

/** One bug's decision request, addressed by `id` (= bugId) so results can be matched up. */
export interface JevWireRequest {
  id: string;
  state: JsonObject;
  questions: Record<string, JevQuestion>;
}

/** A batch of requests sent to POST /api/jev in a single HTTP round trip. */
export interface JevBatchRequest {
  requests: JevWireRequest[];
  /** Optional override of the Jev model id (defaults to server config). */
  model?: string;
}

export type JevWireAnswer = {
  type: 'choice';
  choice: string;
  probabilities?: Record<string, number>;
};

export interface JevWireResult {
  id: string;
  /** Present on success. */
  answers?: Record<string, JevWireAnswer>;
  /** Present on failure for this one request; the batch itself still returns 200. */
  error?: { message: string; status?: number; retryable?: boolean };
  usage?: { inputTokens?: number; outputTokens?: number };
  latencyMs?: number;
}

export interface JevBatchResponse {
  results: JevWireResult[];
  model: string;
  backend: 'gateway' | 'typesafe';
  totalLatencyMs: number;
}

/** A pluggable way to actually deliver a batch (HTTP fetch in the browser, in-process on the server/CLI). */
export type JevTransport = (batch: JevBatchRequest, signal?: AbortSignal) => Promise<JevBatchResponse>;

export const JEV_LIMITS = {
  maxRequestsPerBatch: 64,
  maxQuestionsPerRequest: 4,
  maxStateBytes: 16_384,
  maxCriteria: 16,
} as const;
