# CLAUDE.md

simulation-react — a top-view pedestrian crowd simulation (Social Force Model)
over corridors generated from a graph, with edge orientation supplied by the
deployed mr2s-backend.

## Instructions

This repository's agent instructions live in [`AGENTS.md`](AGENTS.md). Read it
first; it links the workflow, testing, and Git documents under `.agents/docs/`.

Read [`.agents/docs/project.md`](.agents/docs/project.md) before non-trivial
work. Verify any command against repository configuration before running it,
and keep `src/simulation/` free of React imports so the model stays testable.
