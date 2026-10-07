/**
 * Story interactables (CONTRACT §4J): every layout prop flagged `interactable` — plus the hall
 * notices board, the station base radio and John's phone — registered with the interaction system
 * as role-aware prompts. The director calls this from start(), after the world has been (re)built,
 * so every prop lookup sees the live object. The parts live in interactables.<part>.ts.
 */
import type { Services } from '../core/contracts';
import { bindAnomalies } from './anomalies';
import { resetFx } from './anomalies.fx';
import type { StoryApi } from './Director';
import { registerClinical } from './interactables.clinical';
import type { Ctx } from './interactables.kit';
import { registerPublic } from './interactables.public';
import { registerService } from './interactables.service';

let previous: Ctx | null = null;

export function registerStoryInteractables(s: Services, api: StoryApi): void {
  // a new night: the last run's prompts and listeners go, with the anomaly hot-spots and wet spots
  if (previous) {
    for (const off of previous.offs.splice(0)) off();
    for (const id of previous.ids.splice(0)) s.interact.unregister(id);
  }
  resetFx();
  // the anomaly pool's flags, clues and subtitles go through the same api as everything here
  bindAnomalies(api);

  const ctx: Ctx = { s, api, ids: [], offs: [], genStart: s.store.get().power === 'generator' ? s.clock.time : null };
  previous = ctx;
  ctx.offs.push(
    s.bus.on('power:change', ({ power }) => {
      if (power === 'generator' && ctx.genStart === null) ctx.genStart = s.clock.time;
    }),
  );

  const parts: [string, (c: Ctx) => void][] = [
    ['public', registerPublic],
    ['clinical', registerClinical],
    ['service', registerService],
  ];
  for (const [name, register] of parts) {
    try {
      register(ctx);
    } catch (err) {
      console.error(`[interactables] ${name} registration failed`, err);
    }
  }
}
