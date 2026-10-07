/**
 * The public side of the wing: John's phone, the waiting-room vending machines and muted TV,
 * Marcus at registration, the elevator call button, the restroom sink (and its mirror), and the
 * staff notices board in the hall. Role-aware: John gets the patient's verbs, staff the staff's.
 */
import * as THREE from 'three';
import type { DialogueOption, DocumentSection, DocumentView } from '../core/contracts';
import { formatClock12 } from '../core/clock';
import { PHASE_STARTS, type GamePhase } from '../core/types';
import { LINES, MARCUS_BY_PHASE, PHONE_STATUS, PHONE_THREAD, SUBFLAGS, TV_LINES, type PhoneMessage } from '../story/content';
import { ANOMALY_BY_ID, runMirrorLag } from './anomalies';
import { DARK_SCREEN, TOO_DARK, bindObject, bindProp, canRead, flagOn, nudge, onMains, propPos, sfx, wait, type Ctx } from './interactables.kit';
import { noticesDoc } from './interactables.records';

const PHONE_NODE = 'story_john_phone';
/** Kate is saved in his contacts; this number is not. 937 is the county's area code. */
const UNKNOWN_NUMBER = '+1 (937) 555-0148';
/** The free bottle the anomaly pool leaves in the vending tray (anomalies.ts vendingDrop). */
const TAKE_BOTTLE = 'take_bottle';
const MARCUS_FIGURE = 'npc_marcus';

export function registerPublic(ctx: Ctx): void {
  registerPhone(ctx);
  registerVending(ctx);
  registerTv(ctx);
  registerDesk(ctx);
  registerElevator(ctx);
  registerSink(ctx);
  bindProp(ctx, 'hall_board', {
    prompt: () => 'Read notices',
    use: async (c) => {
      if (!canRead(ctx, c)) {
        ctx.api.say(TOO_DARK, 2);
        return;
      }
      await ctx.api.doc(noticesDoc());
    },
  });
}

// ---------------------------------------------------------------------------
// John's phone
// ---------------------------------------------------------------------------

function contactOf(m: PhoneMessage): string {
  return m.from === 'Unknown' ? UNKNOWN_NUMBER : 'Kate';
}

/** Same delivery rule as the director's buzz: arrived, right scenario, flag gates satisfied. */
function delivered(ctx: Ctx, m: PhoneMessage): boolean {
  const st = ctx.s.store.get();
  if (m.time > ctx.s.clock.time) return false;
  if (m.scenarios && !m.scenarios.includes(st.scenario)) return false;
  if (m.requiresFlag && !st.flags[m.requiresFlag]) return false;
  if (m.requiresNotFlag && st.flags[m.requiresNotFlag]) return false;
  return true;
}

/** Messages as the phone renderer reads them: "[time]" stamps after a gap, "> " for John's own. */
function threadLines(list: readonly PhoneMessage[]): string[] {
  const out: string[] = [];
  let last = -Infinity;
  for (const m of list) {
    if (m.time - last >= 10) out.push(`[${formatClock12(m.time)}]`);
    last = m.time;
    out.push(m.from === 'John' ? `> ${m.text}` : m.text);
  }
  return out;
}

/** A 41 % phone idling in a waiting room, then the only light he has, hunting for one bar. */
function batteryPct(t: number): number {
  const before = Math.min(t, PHASE_STARTS.outage);
  const after = Math.max(0, t - PHASE_STARTS.outage);
  return Math.max(3, Math.round(41 - before * 0.085 - after * 0.17));
}

/**
 * The phone document. The thread with the newest message goes last; anything in it John has not
 * seen yet is split into its own trailing block so only those messages type themselves in.
 */
function phoneDoc(ctx: Ctx, seenUpTo: number): { view: DocumentView; newest: number } {
  const st = ctx.s.store.get();
  const msgs = PHONE_THREAD.filter((m) => delivered(ctx, m)).sort((a, b) => a.time - b.time);
  const byContact = new Map<string, PhoneMessage[]>();
  for (const m of msgs) {
    const list = byContact.get(contactOf(m)) ?? [];
    list.push(m);
    byContact.set(contactOf(m), list);
  }
  const newestOf = (list: readonly PhoneMessage[]): number => (list.length ? list[list.length - 1].time : -Infinity);
  const threads = [...byContact.entries()].sort((a, b) => newestOf(a[1]) - newestOf(b[1]));
  const sections: DocumentSection[] = [];
  let typing = false;
  threads.forEach(([contact, list], i) => {
    const fresh = i === threads.length - 1 ? list.filter((m) => m.from !== 'John' && m.time > seenUpTo) : [];
    const read = list.filter((m) => !fresh.includes(m));
    if (read.length) sections.push({ heading: contact, lines: threadLines(read) });
    if (fresh.length) {
      typing = true;
      sections.push({ heading: contact, lines: [`[${formatClock12(fresh[0].time)}]`, ...fresh.map((m) => m.text)] });
    }
  });
  // the outage drops the tower before PHONE_STATUS's phase table catches up
  const status = st.power === 'blackout' ? 'No Service' : PHONE_STATUS[st.phase];
  const bars = /\d\s*bars?/i.test(status) ? '' : ' · 0 bars';
  const newest = msgs.length ? msgs[msgs.length - 1].time : seenUpTo;
  return {
    view: {
      kind: 'phone',
      title: threads.length ? threads[threads.length - 1][0] : 'Messages',
      subtitle: `${status}${bars} · ${batteryPct(ctx.s.clock.time)}%`,
      sections,
      typing,
    },
    newest: Math.max(seenUpTo, newest),
  };
}

function registerPhone(ctx: Ctx): void {
  const { s, api } = ctx;
  const cam = s.characters.camera;
  let node = cam.getObjectByName(PHONE_NODE);
  if (!node) {
    node = new THREE.Object3D();
    node.name = PHONE_NODE;
    cam.add(node);
  }
  // in the hand at chest height, close enough to the eye that it never sits in the next room
  node.position.set(0.05, -0.34, -0.14);

  // everything before the shift was read in the car park
  let seenUpTo = 0;
  bindObject(ctx, 'john_phone', node, 'waiting', {
    radius: 1.2,
    loose: true,
    prompt: (c) => (c === 'john' && !s.store.char('john').missing ? 'Check phone' : null),
    use: async () => {
      const { view, newest } = phoneDoc(ctx, seenUpTo);
      seenUpTo = newest;
      api.setFlag(SUBFLAGS.phone_checked);
      sfx(ctx, 'phone_unlock', null, 0.3);
      await api.doc(view);
    },
  });

  // The director buzzes a flag-gated text only within six minutes of its slot. When the anomaly
  // pool sets the unknown number's flag later than that, the phone notices it here instead.
  ctx.offs.push(
    s.bus.on('flag:set', ({ key, value }) => {
      if (key !== SUBFLAGS.unknown_text || !value) return;
      const st = s.store.get();
      const m = PHONE_THREAD.find((x) => x.requiresFlag === SUBFLAGS.unknown_text && (!x.scenarios || x.scenarios.includes(st.scenario)));
      if (!m || s.clock.time <= m.time + 6.05) return;
      if (st.power === 'blackout' || st.characters.john.missing || st.activeView !== 'john') return;
      sfx(ctx, 'phone_buzz', null, 0.45);
      api.say(`(phone) ${m.from}: ${m.text}`, 3.6);
    }),
  );
}

// ---------------------------------------------------------------------------
// Waiting room: vending machines, TV, registration
// ---------------------------------------------------------------------------

function registerVending(ctx: Ctx): void {
  const { s, api } = ctx;
  // John has two singles; after that the machines are scenery
  let singles = 2;
  for (const def of s.layout.props) {
    if (def.type !== 'vending' || !def.interactable) continue;
    const drinks = def.params?.kind === 'drinks';
    bindProp(ctx, def.id, {
      prompt: (c) => {
        if (s.interact.get(TAKE_BOTTLE)) return 'Take bottle';
        if (!onMains(ctx)) return 'Try machine';
        if (c === 'john') return drinks ? 'Buy water' : 'Buy snack';
        return drinks ? 'Buy a drink' : 'Buy a snack';
      },
      use: async (c) => {
        // a bottle nobody paid for is already in the tray: the anomaly's hot-spot handles it
        const bottle = s.interact.get(TAKE_BOTTLE);
        if (bottle) {
          await bottle.use(c);
          return;
        }
        if (!onMains(ctx)) {
          api.say(LINES.vending.dead, 2.4);
          return;
        }
        if (c === 'john' && singles <= 0) {
          api.say("(you're out of singles)", 2.2);
          return;
        }
        const at = propPos(ctx, def.id, 1.0);
        sfx(ctx, 'coin', at, 0.45);
        await wait(1.1);
        sfx(ctx, 'vending_drop', at ? { x: at.x, y: 0.4, z: at.z } : null, 0.7);
        await wait(0.8);
        if (c !== 'john') {
          api.say(LINES.vending.staff, 3);
          return;
        }
        singles--;
        if (drinks) {
          api.setFlag(SUBFLAGS.john_bought_water);
          api.say(LINES.vending.johnWater, 3);
          nudge(ctx, 'john', { anxiety: -0.03 });
        } else {
          api.say(LINES.vending.johnSnack, 3);
        }
      },
    });
  }
}

function registerTv(ctx: Ctx): void {
  const { s, api } = ctx;
  bindProp(ctx, 'wait_tv', {
    // up on the wall: watchable from the chairs
    radius: 6.5,
    prompt: () => (onMains(ctx) ? 'Watch TV' : 'Look at TV'),
    use: async () => {
      if (!onMains(ctx)) {
        api.say(DARK_SCREEN, 2.2);
        return;
      }
      const line = TV_LINES[s.store.get().phase][0] ?? DARK_SCREEN;
      const parts = line.split(' · ');
      if (parts.length < 3) {
        api.say(line, 3);
        return;
      }
      // the muted ticker, one headline at a time
      const head = `${parts[0]} · ${parts[1]}`;
      for (let i = 2; i < parts.length; i++) {
        api.say(i === 2 ? `${head} — ${parts[i]}` : parts[i], 2.8);
        await wait(2.9);
      }
    },
  });
}

function registerDesk(ctx: Ctx): void {
  const { s, api } = ctx;
  const told = new Map<string, number>();
  const next = (key: string, lines: readonly string[], start = 0): string => {
    const i = told.get(key) ?? start;
    told.set(key, i + 1);
    return lines[i % lines.length];
  };
  const marcus = () => {
    const f = s.characters.getFigure(MARCUS_FIGURE);
    return f && !f.removed ? f : null;
  };
  const voice = (seconds: number): void => {
    const f = marcus();
    if (!f) return;
    const p = f.object.position;
    s.audio.murmur({ x: p.x, y: 1.45, z: p.z }, seconds, { pitch: 0.95 });
  };

  bindProp(ctx, 'wait_desk', {
    // Marcus is behind the glass all night (the director's cast); no Marcus, no conversation
    prompt: () => (marcus() ? 'Talk to Marcus' : null),
    use: async (c) => {
      const st = s.store.get();
      const late = st.power === 'blackout' || st.power === 'generator';
      if (c !== 'john') {
        const lines = c === 'susie' ? (late ? LINES.marcus.toSusieLate : LINES.marcus.toSusie) : late ? LINES.marcus.toPaulLate : LINES.marcus.toPaul;
        voice(2.4);
        api.say(next(`${c}:${late ? 'late' : 'early'}`, lines), 3.6, 'Marcus');
        return;
      }
      const options: DialogueOption[] = [{ id: 'how_long', label: LINES.marcus.howLong }];
      if (flagOn(ctx, SUBFLAGS.intercom_west_wing) && !flagOn(ctx, SUBFLAGS.marcus_denied_page)) options.push({ id: 'page', label: LINES.marcus.didYouPageMe });
      options.push({ id: 'never', label: LINES.marcus.neverMind });
      const pick = await api.ask(late ? "Marcus's face is lit by his phone." : 'Marcus looks up from the screen.', options, { timeoutSeconds: 14, defaultId: 'never' });
      api.setFlag(SUBFLAGS.john_asked_marcus);
      if (pick === 'never') return;
      api.say(options.find((o) => o.id === pick)?.label ?? LINES.marcus.howLong, 2.2, 'John');
      await wait(2.4);
      const phase: GamePhase = s.store.get().phase;
      // he already told the room they were backed up at 22:47; start from his next line
      const start = phase === 'normal' && s.store.hasFired('beat_marcus_backed_up') ? 1 : 0;
      voice(2.6);
      api.say(pick === 'page' ? LINES.marcus.didYouPage : next(`john:${phase}`, MARCUS_BY_PHASE[phase], start), 3.8, 'Marcus');
      if (pick === 'page') {
        api.setFlag(SUBFLAGS.marcus_denied_page);
        nudge(ctx, 'john', { anxiety: 0.06, fear: 0.04 });
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Hallway: elevator call; restroom: the sink and the mirror
// ---------------------------------------------------------------------------

function registerElevator(ctx: Ctx): void {
  const { s, api } = ctx;
  bindProp(ctx, 'elev_panel', {
    prompt: () => (onMains(ctx) ? 'Call elevator' : 'Press call button'),
    use: async () => {
      if (!onMains(ctx)) {
        api.say(LINES.elevator.dead, 2.4);
        return;
      }
      sfx(ctx, 'elevator_tone', propPos(ctx, 'elev_panel'), 0.32);
      await wait(1.5);
      const shaft = s.layout.points.elevator_doors;
      sfx(ctx, 'elevator_hum', { x: shaft.x, y: shaft.y + 3.2, z: shaft.z - 0.9 }, 0.16, { rate: 0.8 });
      await wait(1.8);
      // the car is held upstairs for the night; it only ever comes down on its own
      api.say(flagOn(ctx, SUBFLAGS.elevator_opened_empty) ? "(the button lights. It doesn't come this time.)" : '(the button lights. The car stays upstairs.)', 3.2);
    },
  });
}

function registerSink(ctx: Ctx): void {
  const { api } = ctx;
  bindProp(ctx, 'wc_sink', {
    prompt: (c) => (c === 'john' ? 'Wash face' : 'Wash hands'),
    use: async (c) => {
      sfx(ctx, 'faucet', propPos(ctx, 'wc_sink', 0.9), 0.5);
      await wait(c === 'john' ? 2.0 : 2.6);
      if (c !== 'john') {
        api.say(LINES.sink.staffWash, 2.6);
        return;
      }
      api.say(LINES.sink.johnWash, 3);
      nudge(ctx, 'john', { anxiety: -0.06, fatigue: -0.03 });
      await mirror(ctx);
    },
  });
}

/**
 * The mirror lag belongs to anomalies.ts. If it already fired somewhere John wasn't, it armed
 * itself for this sink; if it is still waiting in tonight's schedule inside its window, this is
 * its moment and the director fires it (recorded and witnessed like any other event).
 */
async function mirror(ctx: Ctx): Promise<void> {
  const { s } = ctx;
  if (flagOn(ctx, SUBFLAGS.mirror_lag_done)) return;
  const here = (): boolean => s.characters.active === 'john' && s.store.char('john').location === 'restroom';
  if (flagOn(ctx, SUBFLAGS.mirror_lag_armed)) {
    await wait(1.6);
    if (here()) await runMirrorLag(s);
    return;
  }
  const def = ANOMALY_BY_ID.get('mirror_lag');
  const t = s.clock.time;
  if (!def || t < def.window[0] || t > def.window[1]) return;
  if (!s.director.schedule().some((e) => e.id === def.id)) return;
  await wait(1.6);
  if (here() && !flagOn(ctx, SUBFLAGS.mirror_lag_done)) await s.director.fire(def.id);
}
