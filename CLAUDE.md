# Altered-reality

_Claude Code reads this file automatically._

## This project
**NIGHT SHIFT** — a browser psychological-horror game (one hospital night, 22:45→01:45, played across three perspectives — John the patient, Susie the nurse, Paul from environmental services — plus CCTV). Everything is procedural: three.js primitives, canvas-drawn textures, Web Audio synthesis; no imported models, images, fonts or audio.

- Stack: **Vite 7 + TypeScript 5 (strict) + three r186**, vanilla DOM UI (no React).
- Architecture + module ownership + story spine: `CONTRACT.md` (authoritative). Modules talk through `src/core/contracts.ts` interfaces and the `EventBus` in `src/core/state.ts`.
- Commands: `npm run dev` · `npm run build` · `npm test` (Vitest, pure logic) · `npm run typecheck`.
- QA tools (headless Chromium + SwiftShader, `vite.qa.config.ts` = no HMR): `node tools/smoke.mjs` (title→ending screenshots), `node tools/night.mjs` (full night at 60× with switching), `node tools/shots.mjs` (fixed camera poses), `node tools/probe.mjs "<js>" --play`, `node tools/audiolevel.mjs`.
- Debug: `window.__NS` (`setTime`, `switchView`, `fire`, `state`), `#debug=1` overlay, `#seed=NS-XXX-XXX`.
- Gotcha (three r186): shadow-casting lights must render their shadow map once at startup (`shadow.needsUpdate = true`) or every shadow-receiving draw fails with a sampler-type mismatch; and use `PCFShadowMap` (PCFSoft was removed).
