# NIGHT SHIFT — status (2026-10-07, ~07:00)

The build is complete and playable end to end. This note is for whoever picks it up next.

## State

- All modules implemented and integrated; `npm run typecheck` clean, `npm test` 308 passing, `npm run build` OK (≈1.5 MB JS, ≈465 KB gzipped, plus the 1.1 MB title narration).
- Verified headless (Chromium + SwiftShader): full smoke run title → ending with 0 console errors; several full nights at 60× on different seeds/scenarios with 0 errors; an attentive-player run reaches "Morning Comes", inattentive runs reach "Someone Missing"; "Rational Explanation" and "Something Came Through" are covered by unit tests of the ending rules.
- Restart flow, phone layout (touch controls, stacked switcher), modal keyboard input, and audio levels per sound state all checked by the tools in `tools/`.
- First-night walkthrough (added after the first live playtest, where the opening felt unclear): look/walk → vending machine (E) → perspective console (Tab) → Susie → back to John → closing card, then once-per-night tips. Pure logic in `src/ui/tutorial.flow.ts` (unit-tested), card in `src/ui/tutorial.ts`; `node tools/tutorial.mjs` plays it with real input. Changed objectives now light up for a few seconds in the HUD.
- Title briefing (added at the owner's request): the title screen explains the night (keep everyone accounted for, work out what is happening) and the four endings. An ElevenLabs narrator reads it aloud, the game's one recorded asset, while the text follows the voice line by line. It starts by itself after the first click or key until it has been heard through. `node tools/narration.mjs` re-records it from `src/ui/briefing.script.ts`; `node tools/briefing.mjs` checks it in a browser.
- Code lives at https://github.com/cryptochris8/night-shift (public, branch `main`); keep local machine paths out of committed files.
- Live build: https://night-shift-game.netlify.app. Netlify builds and publishes every push to `main` (settings in `netlify.toml`); `netlify deploy --prod` publishes a local tree by hand.

## Not verified (needs a human)

- Played at real speed on a real GPU with sound. Visuals were judged from software-rendered screenshots; audio only by measured levels (no clipping, intended dynamics), not by ear.
- Real-GPU frame rate. Draw calls after room culling: ≈1,080 looking down the main corridor, ≈450–700 elsewhere. If a laptop struggles, the next wins are instancing repeated props (chair rows, lockers) and a label-texture atlas.
- Gamepad support exists in the input layer but was not tested with a physical controller.
- Intercom speech uses the browser's speechSynthesis, so the voice differs per OS/browser.
- The title narration was checked by machine, not by ear: transcription matched every word of the script, and the master measures -17.5 LUFS with a -1.6 dBTP true peak. Voice: "Adam - Deep English Story Voice" (ElevenLabs library). Swapping it is one id in `tools/narration.mjs` plus a re-record.

## Known rough edges

- Mirrors are dark panes (no true reflection); the mirror-lag anomaly is staged around that.
- Procedural characters are deliberately featureless and kept at a distance or in low light.
- A few minor UI notes from the stylesheet agent: breaker switches that are locked give no click feedback (keyboard does), and a "SpO2 LOW" style monitor warning replaces the number instead of adding an alarm.

## Where to look

`CONTRACT.md` (architecture + story spine), `README.md` (run, controls, QA tools), `CLAUDE.md` (project notes and three.js gotchas).
