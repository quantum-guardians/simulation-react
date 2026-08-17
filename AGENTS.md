# Project Agent Instructions

## Scope and Precedence

This file is the repository-level entrypoint for coding agents.

Read `.agents/docs/project.md` before non-trivial work. Repository-specific
commands, constraints, and narrower instructions take precedence over these
template defaults.

## Project Workflow

For non-trivial work, follow:

- `.agents/docs/workflow.md`
- `.agents/docs/testing.md`

For tracked Git work, follow:

- `.agents/docs/issue.md`
- `.agents/docs/branch.md`
- `.agents/docs/commit.md`
- `.agents/docs/pull-request.md`

For published releases, follow:

- `.agents/docs/release.md`

Use project-local skills when installed and applicable. Skill instructions
define their own triggers, formats, and output paths.

## Project Structure & Module Organization

`index.html` boots `src/main.tsx`, which mounts `src/App.tsx`. The model lives
in `src/simulation/`: `graph.ts` parses and validates the CSV edge list,
`planarLayout.ts` and `planarEmbedding.ts` place nodes, `corridors.ts` widens
edges into walkable space by weight, `agents.ts` and `socialForce.ts` move
people, `pressure.ts` and `density.ts` compute crush and crowding metrics,
`spatialGrid.ts` provides neighbor lookup, `draw.ts` renders to canvas, and
`presets.ts` holds sample graphs. UI lives in `src/components/`, backend access
in `src/api/` (`client.ts`, `types.ts`). Reference material is in `docs/API.md`,
`docs/BACKEND_REFERENCE.md`, and `docs/claude_topview_mr2s_react_spec.md`.

Keep `src/simulation/` free of React imports. That boundary is why the model can
be tested under a plain `node` environment; a `useState` inside a force
computation breaks it.

## Backend Integration

Orientation comes from the deployed mr2s-backend, not from this repository:
`GET /api/v2/solvers` lists the catalog and
`POST /api/v2/solvers/{solver}` runs `qubo`, `raw-sa`, or `robin`. All calls use
the `/mr2s-api` prefix so the health endpoint and the versioned paths share one
base-URL rule. Dev traffic goes through the Vite proxy in `vite.config.ts`
(override the target with `VITE_PROXY_TARGET` when running a local backend);
production traffic goes through the `vercel.json` rewrite. Set
`VITE_API_BASE_URL` only when the hosting origin is already on the backend's
CORS allowlist.

## Build, Test, and Development Commands

Install with `npm install`. `npm run dev` starts Vite, `npm test` runs
`vitest run`, `npm run lint` runs oxlint, `npm run build` runs `tsc -b && vite
build`, and `npm run preview` serves the build. Run lint and tests before
opening a pull request; neither runs in CI today.

## Coding Style & Naming Conventions

TypeScript strict mode, 2-space indentation, single quotes, no semicolon-heavy
style beyond what exists — match the surrounding file. Simulation modules are
`camelCase.ts` exporting pure functions and plain data; components are
`PascalCase.tsx`. oxlint enforces `react/rules-of-hooks` as an error and
`react/only-export-components` as a warning; fix these rather than disabling
them. Prefer typed numeric constants at module top over magic numbers inside the
force loop, matching the existing files.

## Testing Guidelines

Tests are colocated as `<module>.test.ts` next to the module and run under
vitest's `node` environment (`vite.config.ts`). Cover new simulation behavior
with deterministic inputs — fixed positions and velocities, no randomness in
assertions. `agents`, `socialForce`, `pressure`, `density`, `corridors`,
`graph`, `planarLayout`, and `api/client` already have suites; extend the
matching file instead of adding a parallel one. Canvas rendering in `draw.ts` is
untested, so state in the pull request what you verified by watching the
simulation.

## Performance Notes

The per-frame agent loop is the hot path and has already been optimized once
with a spatial hash grid. Route neighbor queries through `spatialGrid.ts`, keep
allocations out of the inner loop, and measure with a large agent count before
and after any change to force computation.

## Commit & Pull Request Guidelines

History uses short imperative Conventional Commit subjects such as
`perf: optimize simulation hot loops with spatial hash grid` and
`feat: add planar (crossing-free) graph layout mode`. Branch names follow
`<tag>/<issue num>[-slug]`, for example `feat/3-planar-embedding` or
`perf/1-simulation-lag`. Pull requests should describe the behavioral change,
link the issue, note any tuned model constant with its old and new value, and
report the density or death statistics when crowd behavior changes.
