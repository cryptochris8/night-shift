# NIGHT SHIFT — Build handoff (2026-10-07, ~01:30)

Read this first if you are picking the build up mid-way (new model, new session, or after a usage-window reset).

## What exists

- Spec: `NIGHT_SHIFT_Claude_Code_One_Shot_Prompt.md` (the one-shot brief). Architecture + story spine: `CONTRACT.md` (authoritative; every module was built against it).
- Foundation (committed, `2e2d0b4`): `src/core/*` (types, contracts, store/bus, clock, rng, input), `src/world/layout.ts` (floor plan), `src/main.ts` (wiring, game controller, main loop, `window.__NS` debug hooks, `#debug=1` overlay), `index.html`, `src/styles/base.css`.
- Modules written by parallel agents (uncommitted at the time of writing): textures, props, WorldBuilder, Lighting, PostFX + Cinematic, Figure, CharacterSystem (+nav/collision), AudioEngine, InteractionSystem, CCTVSystem, UIManager (+hud/screens/touch), switcher/floorplan/documents, Director (+beats/intro/endings/schedules), anomalies/interactables/content, tests.
- Tooling: `npm run typecheck`, `npm test` (Vitest, pure logic), `npm run smoke` (`tools/smoke.mjs`: headless Chromium drives title → intro → play → John/Susie/Paul/CCTV → blackout → generator → crisis → ending; screenshots in `tools/shots/`, report in `tools/shots/report.json`).

## Where the build was

Build workflow `wf_e3aad3ee-c9a` (15 agents) was finishing. 10/15 had reported; props, ui_panels, director, story, tests were still writing.

## Next steps, in order

1. `npx tsc --noEmit -p tsconfig.json` — expect seam errors between modules. Fix by file owner (see `CONTRACT.md §2`), keeping the contracts as the source of truth. Typical seams: props.ts ↔ WorldBuilder (PropInstance), Figure ↔ CharacterSystem, switcher/documents ↔ UIManager, content/anomalies/interactables ↔ Director (`StoryApi`, FLAGS/CHOICES/CLUES ids), textures signatures.
2. `npm test` — layout invariants and nav/collision tests; fix real bugs they expose (layout/core are mine to fix).
3. `npm run build` (tsc + vite build) must pass.
4. `npm run smoke` — read `tools/shots/*.png` (the Read tool renders images) and `report.json`. Fix page errors first, then visual problems (too dark, missing geometry, wrong scale), then flow problems (stuck stages, events not firing after `setTime` jumps, ending not reached).
5. Polish passes (lighting mood normal vs generator, audio levels, HUD legibility, switcher), then re-run the smoke test.
6. Commit with the attribution footer, update `README.md` if controls/flow changed, and replace the "fresh scaffold" paragraph in `CLAUDE.md` with a one-paragraph project description.

## Verification standard (from the brief §32)

title → gameplay → perspective switch → outage → ending; restart works; timeline continues while switching; nobody gets permanently stuck; interactions discoverable; audio only after a user gesture; mobile layout does not break.
