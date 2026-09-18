# Metrics

This document explains every metric produced by `MetricsCollector` and
`ExperimentLogger` (`src/simulation/metrics/`), and how to run and read
headless experiments with the CLI (`scripts/run-experiment.ts`).

**Read this first if you only remember one thing:** every "communication"
number here is a statistical correlation between an emitted signal and some
other variable (predator visibility, a receiver's action, ...). None of it
knows or cares what the signal "means" — signals `A`/`B` are opaque tokens by
design (spec §9/§11/§32). A high mutual-information value tells you two
variables are *not independent*; it never tells you *why*, and it is not
evidence of shared meaning, intent, or anything resembling language.
`potentialCommunication` is named "potential" on purpose.

## Global metrics (`MetricsCollector.getGlobal()`)

| Field | Meaning |
|---|---|
| `tick` | Tick number of the last recorded `TickRecord`. |
| `population`, `averageAge`, `averageEnergy`, `averageGeneration`, `averageTraits` | Snapshot values taken directly from the most recent tick. |
| `maxGeneration` | The highest generation number ever seen (a running max — it never decreases even if the highest-generation lineage later dies out). |
| `signalCounts` | Cumulative count of emitted signals (`NONE`/`A`/`B`) since the collector was created, summed from every tick's `TickRecord.signalCounts`. |
| `signalCountsWindow` | Same, but only counting the sliding window (see below) — a "recent" view. |
| `signalRate` | `(A + B) / observations` within the window. How often *any* bug emits a non-NONE signal, recently. |
| `deaths` | Cumulative death counts by cause (`predator`, `starvation`, `oldAge`) plus `total`. |
| `births` | Cumulative births. |
| `averageLifespan` | Mean `age` at death, over every death recorded so far (not just the window — this is a whole-run statistic). |
| `decisionSources` | Cumulative count of decisions answered by each provider/source label (e.g. `{ jev: 9800, "fallback:random": 200 }`), useful for spotting how often a provider fell back. |

## The sliding window

Communication metrics are computed over a **sliding window of the last
`windowTicks` ticks** (default 500), not the whole run. Two reasons:

1. Early-experiment behavior and late-experiment behavior can differ a lot as
   the population evolves; a whole-run average would blur that.
2. Memory: the collector never keeps a full history of every observation. It
   only stores a compact tuple per observation
   (`{ signalEmitted, predatorVisible, foodVisible, heard, action }`, no
   `bugId`, no timestamps beyond the block it belongs to) and evicts an entire
   tick's worth of tuples at once as the window slides, via a fixed-size ring
   buffer. Memory is bounded by roughly `windowTicks * averagePopulation`
   tuples, however long the experiment runs.

Under the hood, rather than replaying the whole window on every query, the
collector keeps small running joint-count tables (a handful of cells each,
since every variable involved has at most 8 possible values) and updates them
incrementally as ticks enter and leave the window. That is also why it is
cheap enough to recompute mutual information *every tick* (needed to track
`potentialCommunication`'s "sustained" condition below), not just when the UI
asks for it.

## Heard category

A receiver can hear zero, one, or (spec §39) several signals in the same
tick, with duplicates preserved. For every communication metric that involves
what a bug *heard*, that list is collapsed into one of four buckets:

| `signalsHeard` | Category |
|---|---|
| `[]` | `NONE` |
| one or more `A`, no `B` | `A` |
| one or more `B`, no `A` | `B` |
| at least one `A` and one `B` | `MIXED` |

See `classifyHeard()` in `MetricsCollector.ts`.

## Communication metrics (`MetricsCollector.getCommunication()`)

All within the sliding window described above.

- **`pSignalGivenPredatorVisible` / `pSignalGivenNoPredator`** — for each
  signal `s`, `P(emitted = s | predatorVisible)`. Compares what bugs emit
  when a predator is or isn't visible to them.
- **`pSignalGivenFoodVisible` / `pSignalGivenNoFood`** — same, for food
  visibility.
- **`pFleeGivenHeard`** — for each heard category, `P(action = FLEE | heard)`.
  Does hearing a particular signal make a bug more likely to flee?
- **`pFleeGivenHeardNoPredator`** — the same conditional probability, but
  restricted to observations where *that bug's own* predator is not visible.
  This is the interesting one: if a bug flees more often after hearing signal
  `A` *even when it can't see a predator itself*, that is exactly the
  correlation you'd expect from useful alarm-calling.
- **`miSignalPredator`** — `I(emitted signal ; predatorVisible)`, in bits.
- **`miSignalFood`** — `I(emitted signal ; foodVisible)`, in bits.
- **`miSignalReceiverAction`** — `I(heard category ; action)`, in bits.
- **`miSignalReceiverFlee`** — `I(heard category ; action == FLEE)`, in bits
  (a coarser, FLEE-vs-everything-else version of the above).

### Mutual information formula

All MI values are computed in base-2 (bits) from empirical joint counts:

```
I(X; Y) = sum_{x,y} p(x,y) * log2( p(x,y) / (p(x) * p(y)) )
```

summed only over cells with nonzero count (an empty cell contributes 0, never
`NaN`). `I(X;Y) = 0` means X and Y look independent in the sample; the
theoretical maximum is `min(H(X), H(Y))`, reached when one variable perfectly
determines the other. See `MutualInformation.ts` for the implementation and
its unit tests (independent variables, a perfectly-dependent binary pair, and
a hand-computed 2x2 table) for worked examples.

### `potentialCommunication`

```
potentialCommunication =
  miSignalPredator > miThreshold (default 0.05 bits)
  AND miSignalReceiverAction > miThreshold
  continuously for sustainTicks ticks (default 300)
```

This is a **heuristic flag, not a detector of meaning**. It looks for two
correlations at once — "emitters' signals track a real event" and "receivers'
actions track what they heard" — sustained long enough that it's unlikely to
be a fluke of the current window's contents. The UI should present this as
"Potential communication detected" and nothing stronger. In particular:

- Correlation can arise from confounds that have nothing to do with
  communication (e.g. if predator visibility and time-of-tick both correlate
  with something else in the world).
- It says nothing about *which* signal maps to *which* event, or whether that
  mapping is consistent across bugs — only that some statistical dependency
  exists.
- It is measured over a **finite recent window**, so it can flicker on and
  off as the population and its behavior drift, and a short interruption
  (one tick below threshold) resets the streak to zero by design — that's
  intentional (a real, indefinitely-sustained relationship shouldn't dip in
  and out) but means a *briefly* interrupted-then-resumed correlation reports
  as "not yet sustained" again from scratch.

## Timeline (`MetricsCollector.getTimeline()`)

A downsampled time series for charting: `{ tick, population, averageLifespan,
signalRate, miSignalPredator, miSignalReceiverAction, averageEnergy,
maxGeneration }`, sampled every `sampleEvery` ticks (default 10). To keep
memory bounded on very long runs, once the timeline exceeds
`maxTimelinePoints` (default 4000) it is halved by dropping every other
point, and the effective sampling interval doubles — so a long run's timeline
gets coarser over time instead of growing without bound.

## Experiment export

`ExperimentLogger` accumulates, over a whole run:

- `rows`: one `ExperimentRow` every `logEvery` ticks (default 10) — a flat
  snapshot of global + communication metrics at that tick, suitable for a CSV
  (see below). Field names `MI_signal_predator` / `MI_signal_food` /
  `MI_signal_action` / `MI_signal_flee` intentionally spell out which metric
  they mirror (`miSignalPredator` etc. on `CommunicationMetrics`).
- `deaths`: every `DeathRecord`, capped at the last 50 000 (oldest dropped
  first) so a very long run can't grow this unbounded.
- (optional, off by default) a bounded ring of raw per-bug observations, for
  debugging — enable with `new ExperimentLogger({ keepObservations: true })`.
  These are *not* included in `ExperimentExport` (only `rows`/`deaths`/final
  metrics are); use `logger.getObservations()` directly if you need them.

`runExperiment()` (in `src/experiments/ExperimentRunner.ts`) wires a
`Simulation` + a `DecisionProvider` + a `MetricsCollector` + an
`ExperimentLogger` together, ticks the simulation `ticks` times (or until
extinction, if `stopOnExtinction` — the default), and returns the resulting
`ExperimentExport`.

## The comparison grid (spec §49)

`runComparison()` runs every seed against 4 standard conditions:

| Label | Mode | Memory | Purpose |
|---|---|---|---|
| A | `COMMUNICATION` | `WITH_MEMORY` | The full experimental condition. |
| B | `COMMUNICATION` | `NO_MEMORY` | Memory ablated (naive agent) — if signal/predator correlation is as strong here as in A, the provider's prior knowledge, not individual experience, is producing it. |
| C | `NO_COMMUNICATION` | `WITH_MEMORY` | Communication ablated — survival baseline. |
| D | `SHUFFLED_COMMUNICATION` | `WITH_MEMORY` | Signals exist but their identity is randomised on reception, so a receiver can't learn anything real from them — separates "signals exist" from "signals carry information". |

Pass `conditions` to `runComparison()` to override this grid.

## CLI (`npm run experiment`)

```
npm run experiment -- --seed 1 --mode COMMUNICATION --ticks 2000
npm run experiment -- --seeds 1-5 --mode all --memory both --ticks 5000
npm run experiment -- --compare --seeds 1-10 --ticks 3000 --provider mock
npm run experiment -- --seed 1 --ticks 1000 --config maxPopulation=200,mutationRate=0.1
```

Flags:

- `--seed 1` or `--seed 1,2,3` — one or more explicit seeds.
- `--seeds 1-10` — a seed range (takes priority over `--seed` if both given).
- `--mode COMMUNICATION|NO_COMMUNICATION|SHUFFLED_COMMUNICATION|all` (default
  `COMMUNICATION`; `all` runs every mode).
- `--memory WITH_MEMORY|NO_MEMORY|both` (default `WITH_MEMORY`).
- `--ticks 2000` (default 2000).
- `--provider mock|random|jev` (default `mock`).
- `--out experiments-out` — output directory.
- `--config key=value,key2=value2` — `SimulationConfig` overrides; values that
  parse as numbers become numbers, `true`/`false` become booleans, everything
  else stays a string.
- `--compare` — run the spec §49 grid (A-D) across `--seeds` instead of the
  `--mode`/`--memory` cross product.

Output: one `<experimentId>.json` (the full `ExperimentExport`) per run, plus
`summary.csv` (one row per run) and `rows.csv` (one row per logged tick,
across every run in this invocation) in `--out`. A progress line prints at
most once per second while a run is in flight, and a summary table prints to
stdout at the end.
