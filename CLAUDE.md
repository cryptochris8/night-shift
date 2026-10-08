# Altered-reality

_Claude Code reads this file automatically._

## This project
**NIGHT SHIFT** — a browser psychological-horror game (one hospital night, 22:45→01:45, played across three perspectives — John the patient, Susie the nurse, Paul from environmental services — plus CCTV). Everything is procedural: three.js primitives, canvas-drawn textures, Web Audio synthesis; no imported models, images, fonts or audio, except one recording: the title briefing's ElevenLabs narration (`src/assets/briefing.mp3`, made by `tools/narration.mjs`).

- Stack: **Vite 7 + TypeScript 5 (strict) + three r186**, vanilla DOM UI (no React).
- Architecture + module ownership + story spine: `CONTRACT.md` (authoritative). Modules talk through `src/core/contracts.ts` interfaces and the `EventBus` in `src/core/state.ts`.
- Commands: `npm run dev` · `npm run build` · `npm test` (Vitest, pure logic) · `npm run typecheck`.
- Live build: https://night-shift-game.netlify.app (Netlify project `night-shift-game`, settings in `netlify.toml`). Netlify builds and publishes every push to `main`, so a push is a release; a failed build leaves the previous deploy live. `netlify deploy --prod` from a checkout linked to the site (`.netlify/`, gitignored) publishes the local tree without a push.
- QA tools (headless Chromium + SwiftShader, `vite.qa.config.ts` = no HMR, own dep cache in `node_modules/.vite-qa`; software WebGL can take ~30 s to load a page, so tools navigate with `waitUntil: 'domcontentloaded'` and then wait for `__NS.ready`): `node tools/smoke.mjs` (title→ending screenshots), `node tools/night.mjs` (full night at 60× with switching), `node tools/shots.mjs` (fixed camera poses), `node tools/probe.mjs "<js>" --play`, `node tools/audiolevel.mjs`, `node tools/tutorial.mjs` (first-night walkthrough), `node tools/briefing.mjs` (title briefing).
- First-night walkthrough: `src/ui/tutorial.ts` + pure `tutorial.flow.ts` (unit-tested). On while `settings.tutorial` (default true; switches itself off when finished/skipped). It holds the clock at 22:59 while John is still learning the controls, so QA tools set `tutorial: false` before `newGame`.
- Title briefing: `src/ui/briefing.ts` + pure `briefing.flow.ts` (unit-tested). The words live in `briefing.script.ts`, which `tools/narration.mjs` also reads (it needs `ELEVENLABS_API_KEY`). `briefing.cues.ts` and the MP3 are generated, so re-record after editing a line; `npm test` fails on a stale recording. `settings.narration` (default true) switches itself off after a full listen or Stop. QA tools set `narration: false`.
- Debug: `window.__NS` (`setTime`, `switchView`, `fire`, `state`), `#debug=1` overlay, `#seed=NS-XXX-XXX`.
- Gotcha (three r186): shadow-casting lights must render their shadow map once at startup (`shadow.needsUpdate = true`) or every shadow-receiving draw fails with a sampler-type mismatch; and use `PCFShadowMap` (PCFSoft was removed).
- Gotcha (Playwright): `page.evaluate` runs as a user gesture, so `navigator.userActivation.hasBeenActive` is already true before any input. A test of "waits for the first click/key" must report activation only after trusted input events (see `openTitle` in `tools/briefing.mjs`).
- Gotcha (clean builds): Node and TypeScript also resolve packages from parent folders' `node_modules`, so a dependency missing from `package.json` can still work on a dev machine. Netlify builds a clean checkout, so declare everything; that is how a missing `@types/node` (needed by `vite.config.ts`) once broke the Netlify build.
