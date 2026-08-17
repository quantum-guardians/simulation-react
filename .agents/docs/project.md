# Project Context

Fill this document during project initialization. Agents must verify commands against repository configuration before running them.

## Overview

- Product: simulation-react — a top-view pedestrian crowd simulation. A CSV edge
  list becomes corridors; agents walk them under a Social Force Model, and the
  MR2S backend supplies one-way orientations to compare against.
- Repository: https://github.com/quantum-guardians/simulation-react
- Primary users: MR2S researchers and demo audiences evaluating whether edge
  orientation reduces crowd density and crush pressure.
- Core domain: Social Force Model (Helbing & Molnár) crowd dynamics, corridor
  generation from a weighted graph, density and pressure metrics.
- Runtime environment: browser canvas. Vite 7 + React 19 + TypeScript 5.9,
  deployed on Vercel.

## Architecture

- Entry points: `index.html` → `src/main.tsx` → `src/App.tsx`.
- Main modules: `src/simulation/` holds the model — `graph.ts`, `corridors.ts`,
  `planarLayout.ts`, `planarEmbedding.ts`, `agents.ts`, `socialForce.ts`,
  `pressure.ts`, `density.ts`, `spatialGrid.ts`, `draw.ts`, `presets.ts`.
  `src/components/` holds the UI (`TopViewCanvas`, `ControlPanel`,
  `GraphCsvInput`, `SolverPanel`, `ScorePanel`, `WarningsPanel`,
  `DensityLegend`). `src/api/` holds the backend client.
- Dependency direction: components depend on `src/simulation/` and `src/api/`;
  simulation modules are pure TypeScript with no React import, which is what
  keeps them unit-testable under a `node` test environment.
- External systems: the deployed mr2s-backend at `https://quantum.yunseong.dev`
  via `POST /api/v2/solvers/{solver}` (`qubo`, `raw-sa`, `robin`) and
  `GET /api/v2/solvers`. See `docs/BACKEND_REFERENCE.md`.
- Persistent data: none. All state is in-memory.

## Commands

| Purpose | Command |
|---|---|
| Install dependencies | `npm install` |
| Run locally | `npm run dev` |
| Format | TODO — none configured |
| Lint | `npm run lint` (oxlint) |
| Type-check | `npx tsc -b` |
| Unit tests | `npm test` (`vitest run`) |
| Integration tests | TODO — none |
| Build | `npm run build` (`tsc -b && vite build`) |

## Constraints

- Supported platforms: modern browsers with Canvas 2D.
- Compatibility requirements: the backend's CORS allowlist has no localhost
  entry, so requests go through the `/mr2s-api` prefix — the Vite proxy in dev,
  the `vercel.json` rewrite in production. The dev proxy is not part of the
  build, so removing the rewrite makes `/mr2s-api/...` return 404.
- Performance constraints: the agent loop is the hot path. Neighbor lookups go
  through `spatialGrid.ts`; do not reintroduce O(n²) scans over agents.
- Security or privacy requirements: no credentials in the client. `.env.example`
  documents `VITE_API_BASE_URL` and `VITE_PROXY_TARGET`; both are optional.

## Ownership

- Maintainers: Yunseong <me@yunseong.dev>
- Sensitive modules: `src/simulation/socialForce.ts`, `src/simulation/pressure.ts`,
  `src/simulation/spatialGrid.ts`, `vite.config.ts`, `vercel.json`
- Changes requiring explicit review: force-model constants, death and pressure
  thresholds, proxy or rewrite configuration.
