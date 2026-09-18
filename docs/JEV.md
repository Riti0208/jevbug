# Jev integration

This document covers the Jev decision provider used by JevBug Experiment 0:
what it is, how the wire format works, how to configure it on Vercel and
locally, its cost/latency profile, and the experimental-integrity rules its
implementation must never violate.

## What Jev is, and why it fits

Jev ("System One", by TypeSafe AI) is a **decision model, not a text
generator**. You give it a JSON `state` and a set of typed `questions`
(here: two `'choice'` questions, `action` and `signal`), and it returns one
answer per question — a choice plus (when available) a full probability
distribution over the options. There is no free-text output to parse, no
prompt-injection surface from generated prose, and — crucially for this
experiment — sampling from a real distribution over actions/signals (via
`SeededRandom.weighted`, spec §8) rather than taking the argmax is a first-class
part of the API (`probabilities`), not something we have to coax out of a
chat model.

Jev is reached through the **Vercel AI Gateway** using the AI SDK's
experimental evaluation API (`ai@7`, `@ai-sdk/gateway@4`):

```ts
import { experimental_evaluate as evaluate } from 'ai';
import { createGateway } from '@ai-sdk/gateway';

const gateway = createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY });
const result = await evaluate({
  model: gateway.evaluationModel('typesafe-ai/jev-latest'),
  state,
  questions,
  maxRetries: 2,
});
// result.answers.action => { type: 'choice', choice: 'MOVE_FORWARD', probabilities? }
```

Each call evaluates **all its questions against one shared state** — there is
no multi-bug batching inside a single Jev call. So the integration makes
**one Jev request per bug per tick** (2 questions: `action`, `signal`), and
gets concurrency/throughput by fanning many such requests out in parallel
instead.

## Architecture

```
Browser (simulation loop)
  └─ JevDecisionProvider.decideBatch(requests: DecisionRequest[])
       ├─ builds Jev state+questions per bug (jevState.ts, integrity-checked)
       ├─ dedupes identical states, caches, retries, circuit-breaks
       └─ POST /api/jev  { requests: [...], model? }
                │
                ▼
        Vercel serverless function (api/jev.ts)
          └─ validateBatch -> evaluateBatch (api/_lib/jev.ts)
                │
                ▼
        Vercel AI Gateway  ──▶  typesafe-ai/jev-latest  (Jev / System One)
                │  (or, if JEV_BACKEND=typesafe: directly to api.typesafe.ai)
                ▼
        { answers, usage } per bug  ──▶  sampled into ActionDecision / SignalDecision
```

In local dev (`npm run dev`, i.e. `vite`), `api/_lib/vite-dev-plugin.ts`
serves the exact same `/api/jev` and `/api/health` routes inside Vite's dev
server, so no separate deploy or `vercel dev` is required (though `vercel
dev` also works, since it runs the real `api/*.ts` functions directly). The
headless CLI (`npm run experiment -- --provider jev`) skips HTTP entirely and
calls `evaluateBatch` in-process via `createInProcessTransport(process.env)`.

## Vercel setup

1. In the Vercel dashboard, go to the project's **Storage → AI Gateway → API
   Keys** (or **Settings → AI Gateway**) and create an AI Gateway API key.
2. Add environment variables under **Project Settings → Environment
   Variables**:
   - `AI_GATEWAY_API_KEY` — required (unless you rely on Vercel OIDC — see
     the note in "Uncertainties" below, which this implementation does not
     currently use).
   - `JEV_MODEL` — optional, defaults to `typesafe-ai/jev-latest`.
   - `JEV_BACKEND` — optional, `gateway` (default) or `typesafe`.
   - `TYPESAFE_API_KEY` — required only if `JEV_BACKEND=typesafe`.
   - `JEV_CONCURRENCY` — optional, default `8`; max concurrent Jev calls per
     serverless invocation.
   - `JEV_ALLOWED_ORIGIN` — optional CORS allow-origin for `/api/jev` if you
     ever call it from a different origin than the deployed app.
3. `vercel.json` is already present (`framework: "vite"`, `buildCommand: "npm
   run build"`, `outputDirectory: "dist"`, `api/**/*.ts` given a 30s
   `maxDuration`).
4. Deploy by pushing to the connected repo, or `vercel --prod` from the CLI.

## Local development

```sh
cp .env.example .env.local     # then fill in AI_GATEWAY_API_KEY
npm run dev                    # vite dev server; jevDevApiPlugin serves /api/jev + /api/health
```

`.env.local` (and `.env`) are picked up via Vite's `loadEnv`, merged over
`process.env`, inside the dev plugin — the same env resolution logic Vercel
uses in production. `GET /api/health` reports `{ ok, backend, model, hasKey
}` without ever revealing the key itself, which is a quick way to confirm
your `.env.local` is being read.

Alternatively, `vercel dev` runs the real `api/jev.ts` / `api/health.ts`
functions directly (useful for testing the actual Vercel Node runtime, CORS
headers, etc.) instead of the Vite-only mirror.

### Headless CLI

```sh
npm run experiment -- --provider jev --seed 1 --ticks 2000
```

This uses `createInProcessTransport(process.env)` — no HTTP hop, no running
dev server required, just the env vars above set in your shell or `.env`.

## Cost & latency

- Per Jev call: ~$0.00002, ~100–600 ms.
- One call per bug per tick, 2 questions/call (`action`, `signal`).
- At `initialBugs: 30` (default config): ~30 calls/tick ≈ **$0.0006/tick**.
  A 2000-tick run costs roughly **$1.2** in the worst case (no caching, no
  fallback) — usually less, since identical bug states get deduped/cached.
- Wall-clock: with `decisionConcurrency: 8` (default), ~30 calls batched into
  ~4 concurrent HTTP round trips ⇒ roughly **0.5–2 s/tick** at that latency,
  dominated by the slowest in-flight request per wave. Increase
  `JEV_CONCURRENCY` (server) and `JevDecisionProviderOptions.concurrency`
  (client) together to trade cost/rate-limit risk for wall-clock time.

### Reliability behaviour (`JevDecisionProvider`)

- **Cache**: an in-memory LRU (5000 entries, keyed by `stateCacheKey` — a
  stable, sorted-keys JSON serialization of the bug's Jev `state`) is checked
  before any network call. Bugs with byte-identical states — either within
  the same tick's batch or across ticks — share one live answer; duplicates
  are tagged `source: 'jev:cache'`.
- **Batching**: unique states are chunked into HTTP requests of up to
  `min(batchSize, 64)` bugs (`JEV_LIMITS.maxRequestsPerBatch = 64`), run with
  up to `concurrency` chunks in flight at once (default 2 client-side, 8
  server-side across one function invocation).
- **Retries**: a whole-chunk transport failure (network error, timeout,
  non-2xx from `/api/jev` itself) gets one client-side retry after a fixed
  500 ms backoff. Per-request 429/5xx/529 from Jev itself are retried
  server-side by the AI SDK's own `maxRetries: 2` inside `evaluate(...)`.
- **Circuit breaker**: after 3 consecutive whole-chunk transport failures,
  the breaker opens for 15 s — during that window every request falls back
  immediately without attempting the network. After the cooldown, the next
  call is treated as a probe: success closes the breaker, failure reopens it
  for another cooldown period.
- **Fallback**: any failure — validation error, missing/malformed answer, a
  transport error, or the circuit being open — falls back to a uniform
  random decision (`uniformActionDecision`/`uniformSignalDecision`) for just
  the affected bug(s), tagged `source: 'fallback:<reason>'`
  (`circuit-open`, `transport-error`, `jev-error`, `no-answer`,
  `decode-error`). `decideBatch` **never throws**; every bug in the batch
  always gets a `DecisionResult`.
- A custom `fallback` (any other `DecisionProvider`) can be supplied instead
  of the default uniform one, e.g. to fall back to a heuristic provider.

## The exact state/question JSON sent to Jev

For each bug, one wire request:

```json
{
  "id": "<bugId>",
  "state": {
    "creature": { "energy": 0.31, "fear": 0.72, "age": 120, "generation": 3, "carrying_food": false },
    "traits": { "curiosity": 0.62, "aggression": 0.14, "sociality": 0.78, "signal_tendency": 0.51 },
    "perception": {
      "food_direction": null,
      "predator_direction": "left",
      "nearby_bug_count": 3,
      "heard_signals": ["SIG_M2P"],
      "previous_action": "MOVE_FORWARD",
      "previous_outcome": "NOTHING"
    },
    "recent_experience": {
      "signal_SIG_M2P": { "received_count": 8, "followed_by_predator": 5, "followed_by_food": 1, "followed_by_escape": 4, "followed_by_attack": 1, "average_energy_delta": -0.02 }
    },
    "recent_memory": [
      { "tick": 118, "heard": ["SIG_M2P"], "emitted": "NONE", "action": "FLEE", "outcome": "ESCAPED", "energy_delta": -0.01 }
    ]
  },
  "questions": {
    "action": {
      "type": "choice",
      "instructions": "You are a small creature in a 2D world. Given the creature's current perceived state, traits and its own recent experience, choose its next action. Nearby creatures may emit abstract signals named SIG_X7Q or SIG_M2P. These signals have no predefined meaning. You may use your own observed experience with these signals when making decisions.",
      "criteria": {
        "MOVE_FORWARD": "Move one step in the current heading.",
        "TURN_LEFT": "Rotate heading to the left.",
        "TURN_RIGHT": "Rotate heading to the right.",
        "EAT": "Eat food if it is within reach, or eat carried food.",
        "PICKUP": "Pick up food within reach to carry it.",
        "DROP": "Drop carried food here.",
        "FLEE": "Move quickly away from the perceived predator direction.",
        "REST": "Stay still and recover a little energy."
      }
    },
    "signal": {
      "type": "choice",
      "instructions": "Given the creature's current perceived state, choose whether it emits NONE, SIG_X7Q, or SIG_M2P. Nearby creatures may emit abstract signals named SIG_X7Q or SIG_M2P. These signals have no predefined meaning. You may use your own observed experience with these signals when making decisions. Emitting a signal costs a small amount of energy.",
      "criteria": { "NONE": "Emit no signal.", "SIG_X7Q": null, "SIG_M2P": null }
    }
  }
}
```

`recent_experience` and `recent_memory` are omitted entirely when
`memoryMode === 'NO_MEMORY'` (i.e. the corresponding `DecisionRequest` fields
are `null`). Numbers are rounded to 2 decimals (`age` is left as an integer,
never rounded). `recent_memory` is capped at 10 entries, most recent last.
`heard_signals` (and each memory entry's `heard`) preserve duplicates and
order — they are never deduplicated or sorted.

## Experimental integrity rules

These are the entire point of the experiment (spec §9, §11, §32) — violating
them invalidates any result about emergent communication:

1. **No predefined meaning.** The only sentence anywhere that describes what
   a signal is (verbatim, in both questions' `instructions`):
   > "Nearby creatures may emit abstract signals named `<token1>` or
   > `<token2>`. These signals have no predefined meaning. You may use your
   > own observed experience with these signals when making decisions."
   Forbidden anywhere else in prompts/instructions/criteria/state keys:
   `danger`, `warn`, `warning`, `alarm`, `alert`, `threat`, `food signal`,
   `predator signal`, `means`, `meaning`, `indicates`, `call`, `cry`.
2. **Signal criteria are unlabeled.** The `signal` question's criteria give
   `null` for both token options; only `NONE` gets a (neutral, mechanical)
   description ("Emit no signal.").
3. **No sender information.** A receiver only ever sees
   `heard_signals: [token, token, ...]` — no sender id, no sender
   perception, no sender anything.
4. **No world-global information.** Only fields already present on
   `DecisionRequest` (the bug's own state, traits, perception, own signal
   experience, own recent memory) ever reach Jev.
5. **Mechanical action descriptions only.** Action criteria describe *what
   the action does physically* and never mention signals.
6. **Signal token relabeling round-trips.** Everything sent to Jev uses the
   configured `SignalDefinition.id` (e.g. `SIG_X7Q`); everything returned is
   mapped back to the canonical `'A' | 'B'` before it reaches the simulation
   core. Before `configure()` is called, the default mapping is the
   identity (`id: 'A'`/`'B'`).

`src/simulation/decision/jevState.test.ts` has an automated integrity test
that serializes a rich `DecisionRequest` into its wire form, strips out the
one allowed sentence, and asserts none of the forbidden words remain
anywhere in the payload — plus checks for `null` signal criteria, absence of
`sender`/`bugId`/`world` keys, and duplicate-preserving `heard_signals`.

## Uncertain / not independently verified

- **Vercel OIDC auth for the Gateway.** The AI SDK docs say
  `createGateway({ apiKey: undefined })` can authenticate via Vercel OIDC
  when running on Vercel with no explicit key. This implementation does
  **not** rely on that: if `AI_GATEWAY_API_KEY` is unset, `evaluateBatch`
  short-circuits with a `Jev is not configured` error for every request
  before ever calling `createGateway`/`evaluate`, per this integration's
  explicit contract. If you want to rely on OIDC instead of an explicit key,
  that check needs to be relaxed for the `gateway` backend specifically —
  flagging this so it's a deliberate choice, not an oversight.
- **TypeSafe direct API (`JEV_BACKEND=typesafe`) response shape.** The exact
  field names of `api.typesafe.ai/v1/systemone`'s response (beyond
  `answers[].{type, choice, confidence, probabilities}` and top-level
  `usage`) were not independently verified against a live endpoint — only
  against the shape given in the integration spec. `evaluateViaTypesafe`
  tolerates `error`/`message` fields on failure bodies and ignores unknown
  extra fields (e.g. `confidence`) rather than failing on them.
  This path is exercised in `api/_lib/jev.test.ts` only against an injected
  fake `fetch`, never a real network call.
- **Gateway rate limits / exact retry semantics for 429 vs 529.** The
  `maxRetries: 2` passed to `evaluate(...)` is assumed to cover Gateway-side
  429/5xx/529 backoff per the AI SDK's own `RetryError` handling; this was
  not observed against a live rate-limited endpoint, only inferred from the
  installed `@ai-sdk/provider` typings (`APICallError.isRetryable`).
