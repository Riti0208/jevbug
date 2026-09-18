# JevBug — Experiment 0

An artificial-life experiment that uses **Jev** (TypeSafe AI's decision-only model, served
through **Vercel AI Gateway**) as the decision maker for simple 2D creatures ("JevBugs").

The purpose is not to build a game. It is to build an observable environment in which
**a finite set of signals with no predefined meaning** may — or may not — become
informative about hidden environmental states and change receiver behaviour.

## Research question

> Can initially meaningless signals become statistically informative about hidden
> environmental states and alter receiver behaviour in a way that improves survival?

Concretely we measure over time:

- `I(Signal ; PredatorPresence)`
- `I(Signal ; ReceiverAction)`
- survival / lifespan compared with `NO_COMMUNICATION` and `SHUFFLED_COMMUNICATION` controls

## Experimental integrity (read before changing anything)

1. Signals `A` / `B` have **no meaning** anywhere in code, config, prompts or UI.
2. The prompt/state sent to Jev never suggests what a signal means.
3. Receivers never learn the sender's perception, id or reasoning.
4. Bugs only know their own state, traits, perception and own memory — never world state.

See `docs/JEV.md` for what exactly is sent to Jev and `docs/METRICS.md` for the metrics.

## Quick start

```bash
npm install
cp .env.example .env.local   # add AI_GATEWAY_API_KEY to use Jev; mock/random providers need no key
npm run dev                  # http://localhost:5173  (the Vite plugin serves /api/jev locally)
```

Press **Start** in the browser. The simulation runs until you press **Stop** or close the tab.
All initial parameters (bug count, predator count, food, mode, provider, seed, ...) can be
set on the start screen.

## Headless experiments

```bash
npm run experiment -- --seeds 1-5 --mode all --ticks 5000 --provider mock --out experiments-out
npm run experiment -- --compare --seeds 1-3 --ticks 3000 --provider jev
```

Outputs JSON per run plus `summary.csv` / `rows.csv`.

## Deploying to Vercel

1. Import the repository in Vercel (framework preset: Vite; `vercel.json` is included).
2. Create an AI Gateway API key in the Vercel dashboard and add it as the environment
   variable `AI_GATEWAY_API_KEY` (server-side only; it is never exposed to the browser).
3. Deploy. The browser talks to `/api/jev`, a serverless function that calls
   `typesafe-ai/jev-latest` through the AI SDK's evaluate API.

Details: `docs/JEV.md`.

## Architecture

```
UI (src/ui)
 └── SimulationController
      ├── Simulation Core   (src/simulation)   — headless, no three.js, seeded RNG
      ├── DecisionProvider  (src/simulation/decision) — Jev | Mock | Random
      ├── Metrics           (src/simulation/metrics)  — MI, conditional probabilities, timeline
      └── Renderer          (src/renderer)    — three.js particles, reads RenderSnapshot only
api/                         — Vercel serverless functions (Jev proxy)
scripts/run-experiment.ts    — headless CLI
```

## Scripts

| command              | what                                   |
| -------------------- | -------------------------------------- |
| `npm run dev`        | dev server with local `/api/jev`       |
| `npm run build`      | typecheck + production build           |
| `npm test`           | vitest                                 |
| `npm run experiment` | headless experiment runner             |
