/**
 * First-night walkthrough — the pure part (no DOM, no three.js): which card is up, when a step is
 * done, how long the clock may be held short of the 23:00 page, and the first-time tips that follow.
 * `tutorial.ts` feeds it one snapshot per frame plus the few events it cares about, and draws the card.
 *
 * Main flow: get your bearings (look + walk) → buy something from the vending machine (E) → open the
 * perspective console and become someone else → number keys / back to John → a closing card.
 * Tips (same night, once each): the first time the player takes Paul, Susie or the cameras outside the
 * walkthrough, and the first time someone else is in danger.
 */
import type { CharacterId, ViewId } from '../core/types';

export type StepId = 'look_move' | 'vending' | 'switch' | 'quick' | 'wrap';
export const STEP_ORDER: readonly StepId[] = ['look_move', 'vending', 'switch', 'quick', 'wrap'];
export type Device = 'kbm' | 'pad' | 'touch';

/** Game minutes (22:59): while John is still on the first two steps the clock stops short of the 23:00 page. */
export const CLOCK_CAP = 14;
/** Real seconds the clock may sit at the cap before the night moves on regardless. */
export const MAX_HOLD_SECONDS = 75;
/** Look input needed (mouse pixels; sticks and touch are scaled to match). */
export const LOOK_NEEDED = 260;
export const MOVE_NEEDED_M = 1.0;
/** ...or this long holding a direction (a wall, a chair row or the stand-up can eat the distance) */
export const MOVE_INPUT_SECONDS = 2.2;
/** seconds a ticked card stays up before the next one */
export const STEP_DONE_PAUSE = 0.9;
/** after the purchase: room for the coin, the drop and John's line */
export const VENDING_DONE_PAUSE = 3.2;
export const SWITCH_TIMEOUT = 150;
export const QUICK_TIMEOUT = 26;
export const WRAP_SECONDS = 13;
export const TIP_SECONDS = 10;
export const DANGER_TIP_SECONDS = 12;
/** a frame step longer than this is a teleport or a perspective switch, not a walk */
export const MAX_STEP_M = 1.2;

/** Interactables that count as "used the vending machine" (the free bottle replaces the tray's prompt). */
export const VENDING_IDS: readonly string[] = ['wait_vending_0', 'wait_vending_1', 'take_bottle'];

export const NAMES: Record<ViewId, string> = { john: 'John', susie: 'Susie', paul: 'Paul', cctv: 'the cameras' };
const QUICK_KEY: Record<ViewId, string> = { john: '1', susie: '2', paul: '3', cctv: '4' };

export interface FrameInput {
  /** real seconds since the last frame */
  dt: number;
  /** screen 'playing', not paused, no cinematic */
  playing: boolean;
  /** perspective console, a document or a choice is open */
  modal: boolean;
  view: ViewId;
  /** look input this frame, in mouse pixels */
  look: number;
  /** 0..1 move input this frame */
  move: number;
  /** metres the possessed body walked this frame (horizontal) */
  walked: number;
  /** game minutes */
  clock: number;
}

export interface CardContext {
  device: Device;
  pointerLocked: boolean;
  view: ViewId;
  /** words toward the nearest vending machine ("ahead and to your right"), null when unknown */
  vendingDir: string | null;
  targetingVending: boolean;
}

export interface CardModel {
  /** identity: a new key animates a swap, the same key updates in place */
  key: string;
  kind: 'step' | 'tip';
  kicker: string;
  progress: string | null;
  title: string;
  /** body text; `{E}` marks a key cap */
  lines: string[];
  checks: { label: string; done: boolean }[];
  /** the step was just completed (ticked state) */
  done: boolean;
  footer: string | null;
  /** 0..1 time left on a card that dismisses itself */
  timer: number | null;
}

export interface FlowEvents {
  /** the walkthrough ended (completed or skipped): the setting flips off for future nights */
  onFinished?(how: 'completed' | 'skipped'): void;
  /** a step was completed (for a quiet tick) */
  onTick?(): void;
}

type Tip = { id: 'view'; view: Exclude<ViewId, 'john'> } | { id: 'danger'; who: CharacterId };

interface ActiveTip {
  tip: Tip;
  t: number;
  seconds: number;
}

/** Split `Press {E} to buy` into text and key-cap tokens. */
export function tokenize(text: string): { key: boolean; text: string }[] {
  const out: { key: boolean; text: string }[] = [];
  const re = /\{([^{}]+)\}/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ key: false, text: text.slice(last, m.index) });
    out.push({ key: true, text: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ key: false, text: text.slice(last) });
  return out;
}

/**
 * Where a target lies relative to the way the camera faces, in words. XZ plane, three.js handedness:
 * facing -z, +x is to the right. `fx, fz` is the facing direction, `dx, dz` the offset to the target.
 */
export function directionWords(fx: number, fz: number, dx: number, dz: number): string {
  const right = dx * -fz + dz * fx;
  const ahead = dx * fx + dz * fz;
  if (Math.hypot(right, ahead) < 1e-6) return 'right here';
  const deg = (Math.atan2(right, ahead) * 180) / Math.PI;
  const a = Math.abs(deg);
  const side = deg > 0 ? 'right' : 'left';
  if (a < 22) return 'straight ahead';
  if (a < 68) return `ahead and to your ${side}`;
  if (a < 125) return `to your ${side}`;
  return 'behind you';
}

/**
 * The clock after it ran from `before` to `after`, held at `cap`. Only natural running is held: a jump
 * that starts past the cap (debug setTime, a restored night) passes through.
 */
export function heldTime(before: number, after: number, cap: number | null): number {
  return cap !== null && before <= cap && after > cap ? cap : after;
}

export function deviceOf(isTouch: boolean, lastWasGamepad: boolean): Device {
  if (lastWasGamepad) return 'pad';
  return isTouch ? 'touch' : 'kbm';
}

export class TutorialFlow {
  /** running this night (the walkthrough and/or the tips that follow it) */
  armed = false;
  step: StepId | null = null;
  /** playing seconds on the current step (paused while a modal is open) */
  stepTime = 0;
  /** >= 0 while a ticked card is shown before the next step */
  doneTimer = -1;
  lookAccum = 0;
  moveSeconds = 0;
  walkedAccum = 0;
  lookDone = false;
  moveDone = false;
  vendingDone = false;
  /** real seconds the clock has been held at the cap */
  holdUsed = 0;
  /** the view the player switched into during the walkthrough */
  switchedTo: ViewId | null = null;
  private tip: ActiveTip | null = null;
  private queue: Tip[] = [];
  private shown = new Set<string>();
  private seen = new Set<ViewId>(['john']);
  private nextAfterDone: StepId | null = null;

  constructor(private readonly events: FlowEvents = {}) {}

  /** A new night with the Tutorial setting on. */
  start(): void {
    this.reset();
    this.armed = true;
    this.enter('look_move');
  }

  /** Forget everything (a new night with the setting off, or the setting switched off mid-night). */
  reset(): void {
    this.armed = false;
    this.step = null;
    this.stepTime = 0;
    this.doneTimer = -1;
    this.lookAccum = 0;
    this.moveSeconds = 0;
    this.walkedAccum = 0;
    this.lookDone = false;
    this.moveDone = false;
    this.vendingDone = false;
    this.holdUsed = 0;
    this.switchedTo = null;
    this.tip = null;
    this.queue = [];
    this.shown.clear();
    this.seen = new Set<ViewId>(['john']);
    this.nextAfterDone = null;
  }

  /** The player asked to skip: no walkthrough, no tips for the rest of the night. */
  skip(): void {
    if (!this.armed) return;
    const wasRunning = this.step !== null;
    this.reset();
    if (wasRunning) this.events.onFinished?.('skipped');
  }

  /** The walkthrough is on screen (the pause menu offers to skip it). */
  get running(): boolean {
    return this.armed && this.step !== null;
  }

  /** The tip on screen, if any (`view:paul`, `danger`, ...). */
  get tipId(): string | null {
    return this.tip ? tipKey(this.tip.tip) : null;
  }

  /** Game minute the clock may not run past (null: no hold). */
  clockCap(): number | null {
    if (!this.armed || this.holdUsed >= MAX_HOLD_SECONDS) return null;
    return this.step === 'look_move' || this.step === 'vending' ? CLOCK_CAP : null;
  }

  update(inp: FrameInput): void {
    if (!this.armed || !inp.playing) return;
    const dt = Math.max(0, Math.min(inp.dt, 0.25));

    if ((this.step === 'look_move' || this.step === 'vending') && inp.clock >= CLOCK_CAP - 1e-6) {
      this.holdUsed += dt;
      // the hold ran out, or a debug jump went past the page: the night moves on without the vending trip
      if (this.holdUsed >= MAX_HOLD_SECONDS || inp.clock > CLOCK_CAP + 0.5) {
        this.lookDone = this.moveDone = true;
        this.enter('switch');
      }
    }

    if (this.doneTimer >= 0) {
      this.doneTimer -= dt;
      if (this.doneTimer < 0) this.enter(this.nextAfterDone ?? this.following(this.step));
    } else if (this.step) {
      if (!inp.modal) this.stepTime += dt;
      this.progress(inp, dt);
    }

    this.updateTip(inp, dt);
  }

  private progress(inp: FrameInput, dt: number): void {
    switch (this.step) {
      case 'look_move': {
        if (inp.view !== 'john' || inp.modal) return;
        this.lookAccum += Math.max(0, inp.look);
        if (inp.walked > 0 && inp.walked < MAX_STEP_M) this.walkedAccum += inp.walked;
        if (inp.move > 0.3) this.moveSeconds += dt;
        const lookNow = this.lookAccum >= LOOK_NEEDED;
        const moveNow = this.walkedAccum >= MOVE_NEEDED_M || this.moveSeconds >= MOVE_INPUT_SECONDS;
        // the first of the two ticks quietly; the second completes the card (which ticks itself)
        if (lookNow && !this.lookDone) {
          this.lookDone = true;
          if (!this.moveDone && !moveNow) this.events.onTick?.();
        }
        if (moveNow && !this.moveDone) {
          this.moveDone = true;
          if (!this.lookDone) this.events.onTick?.();
        }
        if (this.lookDone && this.moveDone) this.complete(STEP_DONE_PAUSE);
        return;
      }
      case 'switch':
        if (this.stepTime >= SWITCH_TIMEOUT) this.enter('wrap');
        return;
      case 'quick':
        if (this.stepTime >= QUICK_TIMEOUT) this.complete(0.01, 'wrap');
        return;
      case 'wrap':
        if (this.stepTime >= WRAP_SECONDS) this.finish();
        return;
      default:
        return;
    }
  }

  /** E on something. Only John buying from the machines matters. */
  onInteract(id: string, by: CharacterId): void {
    if (!this.armed || by !== 'john' || !VENDING_IDS.includes(id)) return;
    if (this.step !== 'look_move' && this.step !== 'vending') return;
    this.vendingDone = true;
    if (this.doneTimer >= 0) return;
    // an eager player who heads straight for the machines has looked and walked already
    this.lookDone = this.moveDone = true;
    this.complete(VENDING_DONE_PAUSE, 'switch');
  }

  /** The active view changed. */
  onView(view: ViewId, prev: ViewId): void {
    if (!this.armed || view === prev) return;
    const firstTime = !this.seen.has(view);
    this.seen.add(view);
    const step = this.step;
    if (step === 'look_move' || step === 'vending' || step === 'switch') {
      // switching is what the console step teaches: whoever gets there early skips ahead to it
      this.lookDone = this.moveDone = true;
      if (view !== 'john') {
        this.switchedTo = view;
        this.forceComplete(STEP_DONE_PAUSE, 'quick');
        return;
      }
    } else if (step === 'quick') {
      this.forceComplete(STEP_DONE_PAUSE, 'wrap');
    }
    if (firstTime && view !== 'john' && view !== this.switchedTo) this.queueTip({ id: 'view', view });
  }

  /** Someone was warned about (the HUD ring). The first warning about someone the player is not watching gets a tip. */
  onWarn(id: CharacterId, level: number, view: ViewId): void {
    if (!this.armed || level < 0.1 || id === view || this.shown.has('danger')) return;
    this.shown.add('danger');
    this.tip = { tip: { id: 'danger', who: id }, t: 0, seconds: DANGER_TIP_SECONDS };
  }

  private queueTip(tip: Tip): void {
    const key = tipKey(tip);
    if (this.shown.has(key) || this.queue.some((q) => tipKey(q) === key)) return;
    this.queue.push(tip);
  }

  private updateTip(inp: FrameInput, dt: number): void {
    if (this.tip) {
      const tip = this.tip.tip;
      const resolved = tip.id === 'danger' ? inp.view === tip.who : inp.view !== tip.view;
      if (!inp.modal) this.tip.t += dt;
      if (resolved || this.tip.t >= this.tip.seconds) this.tip = null;
      return;
    }
    if (this.step !== null || this.queue.length === 0 || inp.modal) return;
    while (this.queue.length) {
      const next = this.queue.shift()!;
      // a perspective tip only makes sense while the player is still in that perspective
      if (next.id === 'view' && next.view !== inp.view) continue;
      this.shown.add(tipKey(next));
      this.tip = { tip: next, t: 0, seconds: TIP_SECONDS };
      return;
    }
  }

  private complete(pause: number, next?: StepId): void {
    if (this.doneTimer >= 0) return;
    this.doneTimer = pause;
    this.nextAfterDone = next ?? null;
    this.events.onTick?.();
  }

  /** Like complete(), but a switch overrides a pending advance (a purchase followed at once by a switch). */
  private forceComplete(pause: number, next: StepId): void {
    if (this.doneTimer >= 0) {
      this.nextAfterDone = next;
      this.doneTimer = Math.min(this.doneTimer, pause);
      return;
    }
    this.complete(pause, next);
  }

  private following(step: StepId | null): StepId | null {
    if (!step) return null;
    let i = STEP_ORDER.indexOf(step) + 1;
    if (STEP_ORDER[i] === 'vending' && this.vendingDone) i++;
    return STEP_ORDER[i] ?? null;
  }

  private enter(step: StepId | null): void {
    this.doneTimer = -1;
    this.nextAfterDone = null;
    this.stepTime = 0;
    if (step === 'vending' && this.vendingDone) step = 'switch';
    if (step === null) {
      this.finish();
      return;
    }
    this.step = step;
  }

  private finish(): void {
    const was = this.step !== null;
    this.step = null;
    this.doneTimer = -1;
    if (was) this.events.onFinished?.('completed');
  }

  // ---------------------------------------------------------------------------
  // What the card says
  // ---------------------------------------------------------------------------

  card(ctx: CardContext): CardModel | null {
    if (!this.armed) return null;
    if (this.tip && (this.tip.tip.id === 'danger' || this.step === null)) return this.tipCard(this.tip, ctx);
    if (!this.step) return null;
    return this.stepCard(this.step, ctx);
  }

  /** The line the open perspective console shows during the console step (null: none). */
  switcherHint(device: Device): { text: string; target: ViewId } | null {
    if (!this.armed || this.step !== 'switch' || this.doneTimer >= 0) return null;
    const text =
      device === 'touch'
        ? "Tutorial — tap Susie's card to become her"
        : device === 'pad'
          ? "Tutorial — move to Susie's card and press {A}"
          : "Tutorial — click Susie's card, or press {2}";
    return { text, target: 'susie' };
  }

  private stepCard(step: StepId, ctx: CardContext): CardModel {
    const d = ctx.device;
    const k = keys(d);
    const index = STEP_ORDER.indexOf(step) + 1;
    const base = {
      key: `step:${step}`,
      kind: 'step' as const,
      kicker: 'TUTORIAL',
      progress: `${index} / ${STEP_ORDER.length}`,
      checks: [] as CardModel['checks'],
      done: this.doneTimer >= 0,
      footer: d === 'touch' ? 'Pause › Skip tutorial' : `${d === 'pad' ? 'Start' : 'Esc'} › Skip tutorial`,
      timer: null as number | null,
    };
    switch (step) {
      case 'look_move': {
        const lines = ['You are John Mercer, waiting to be seen in the ER.'];
        if (d === 'kbm' && !ctx.pointerLocked) lines.push('Click the view first to take the mouse.');
        return {
          ...base,
          title: 'Get your bearings',
          lines,
          checks: [
            {
              label: d === 'kbm' ? 'Look around — {Mouse}' : d === 'pad' ? 'Look around — {Right stick}' : 'Look around — drag on the right half',
              done: this.lookDone,
            },
            {
              label: d === 'kbm' ? 'Walk — {W}{A}{S}{D}, hold {Shift} to hurry' : d === 'pad' ? 'Walk — {Left stick}' : 'Walk — drag on the left half',
              done: this.moveDone,
            },
          ],
        };
      }
      case 'vending': {
        const where = ctx.vendingDir ? `, ${ctx.vendingDir}` : '';
        const lines = [`You've been waiting a while. The machines glow by the TV wall${where}.`];
        if (this.doneTimer >= 0) lines.push('That is how you use things: doors, phones, charts.');
        else if (ctx.targetingVending) lines.push(d === 'touch' ? 'Tap {USE} to buy.' : `Press ${k.use} to buy.`);
        else lines.push(d === 'touch' ? 'Walk up to one and tap {USE} when its name appears.' : `Walk up to one and press ${k.use} when its name appears.`);
        return { ...base, title: 'Get something from the vending machine', lines };
      }
      case 'switch': {
        const lines = ['Three people are working the same night. You can become any of them, at any time.'];
        lines.push(d === 'touch' ? 'Tap {SWITCH} to open the perspective console.' : `Press ${k.console} to open the perspective console.`);
        return { ...base, title: "Step into someone else's shoes", lines };
      }
      case 'quick': {
        const v = this.switchedTo ?? ctx.view;
        const lines: string[] = [];
        if (v === 'susie') lines.push('Susie Tran, the night nurse. Her badge opens staff doors.');
        else if (v === 'paul') lines.push(`Paul Reyes, environmental services. ${k.light} switches his flashlight; his keys open the service areas.`);
        else if (v === 'cctv') {
          lines.push(
            d === 'kbm'
              ? 'The security cameras. {[} {]} change camera, {Esc} goes back.'
              : d === 'pad'
                ? 'The security cameras. {LB} {RB} change camera, {B} goes back.'
                : 'The security cameras. Tap a camera to change feed.',
          );
        }
        lines.push("The clock runs for everyone, even the people you aren't watching.");
        if (d === 'kbm') lines.push('Number keys switch instantly: {1} John · {2} Susie · {3} Paul · {4} Cameras. Press {1} to go back to John.');
        else lines.push(d === 'pad' ? 'Press {Y} and pick John to go back.' : 'Tap {SWITCH} and pick John to go back.');
        const title = v === 'cctv' ? "You're watching the cameras" : `You're ${NAMES[v]} now`;
        return { ...base, title, lines, timer: this.doneTimer >= 0 ? null : 1 - Math.min(1, this.stepTime / QUICK_TIMEOUT) };
      }
      case 'wrap':
      default: {
        const pause = d === 'kbm' ? '{Esc}' : d === 'pad' ? '{Start}' : 'The pause button';
        return {
          ...base,
          title: "That's the shift",
          lines: [
            'What each person should do next is written at the bottom left.',
            "If a ring fills around someone's portrait (bottom right), they're in trouble. Go to them.",
            `${pause} pauses. Every control is listed in the pause menu.`,
          ],
          footer: null,
          timer: 1 - Math.min(1, this.stepTime / WRAP_SECONDS),
        };
      }
    }
  }

  private tipCard(active: ActiveTip, ctx: CardContext): CardModel {
    const d = ctx.device;
    const k = keys(d);
    const tip = active.tip;
    const base = {
      kind: 'tip' as const,
      kicker: 'TIP',
      progress: null,
      checks: [],
      done: false,
      footer: null,
      timer: 1 - Math.min(1, active.t / active.seconds),
    };
    if (tip.id === 'danger') {
      const name = NAMES[tip.who];
      const how = d === 'kbm' ? `Press {${QUICK_KEY[tip.who]}} to switch to ${name}.` : d === 'pad' ? `Press {Y} and pick ${name}.` : `Tap {SWITCH} and pick ${name}.`;
      return {
        ...base,
        key: `tip:danger:${tip.who}`,
        title: `${name} needs you`,
        lines: [`The ring around ${name}'s portrait (bottom right) is filling: something is wrong where ${tip.who === 'susie' ? 'she' : 'he'} is.`, how],
      };
    }
    if (tip.view === 'paul') {
      return { ...base, key: 'tip:paul', title: 'Paul Reyes — environmental services', lines: [`${k.light} switches his flashlight. His keys open the service areas.`] };
    }
    if (tip.view === 'susie') {
      return { ...base, key: 'tip:susie', title: 'Susie Tran — night nurse', lines: ['Her badge opens staff doors. Her patients are in the bays down the hall.'] };
    }
    const cams = d === 'kbm' ? '{[} {]} change camera, {Esc} goes back.' : d === 'pad' ? '{LB} {RB} change camera, {B} goes back.' : 'Tap a camera to change feed.';
    return { ...base, key: 'tip:cctv', title: 'Security cameras', lines: [cams, 'Watch the feeds: what a camera records may not match what people saw.'] };
  }
}

function tipKey(t: Tip): string {
  return t.id === 'danger' ? 'danger' : `view:${t.view}`;
}

function keys(d: Device): { use: string; console: string; light: string } {
  if (d === 'pad') return { use: '{A}', console: '{Y}', light: '{X}' };
  if (d === 'touch') return { use: '{USE}', console: '{SWITCH}', light: '{LIGHT}' };
  return { use: '{E}', console: '{Tab}', light: '{F}' };
}
