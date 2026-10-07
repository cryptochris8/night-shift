import { describe, expect, it, vi } from 'vitest';
import { makeInitialState } from '../src/core/state';
import { DEFAULT_SETTINGS } from '../src/core/types';
import {
  CLOCK_CAP,
  DANGER_TIP_SECONDS,
  LOOK_NEEDED,
  MAX_HOLD_SECONDS,
  MOVE_INPUT_SECONDS,
  QUICK_TIMEOUT,
  STEP_DONE_PAUSE,
  SWITCH_TIMEOUT,
  TIP_SECONDS,
  VENDING_DONE_PAUSE,
  WRAP_SECONDS,
  TutorialFlow,
  deviceOf,
  directionWords,
  heldTime,
  tokenize,
  type CardContext,
  type FlowEvents,
  type FrameInput,
} from '../src/ui/tutorial.flow';

const DT = 0.1;

function frame(over: Partial<FrameInput> = {}): FrameInput {
  return { dt: DT, playing: true, modal: false, view: 'john', look: 0, move: 0, walked: 0, clock: 3, ...over };
}

/** Run frames of DT for `seconds`. */
function run(flow: TutorialFlow, seconds: number, over: Partial<FrameInput> = {}): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) flow.update(frame(over));
}

function ctx(over: Partial<CardContext> = {}): CardContext {
  return { device: 'kbm', pointerLocked: true, view: 'john', vendingDir: 'ahead and to your right', targetingVending: false, ...over };
}

function started(events: FlowEvents = {}): TutorialFlow {
  const flow = new TutorialFlow(events);
  flow.start();
  return flow;
}

/** Look + walk, then wait out the ticked card: lands on the vending step. */
function toVending(flow: TutorialFlow): void {
  run(flow, 0.5, { look: LOOK_NEEDED, walked: 0.5 });
  run(flow, STEP_DONE_PAUSE + 0.3);
}

function toSwitch(flow: TutorialFlow): void {
  toVending(flow);
  flow.onInteract('wait_vending_1', 'john');
  run(flow, VENDING_DONE_PAUSE + 0.3);
}

function toQuick(flow: TutorialFlow, view: 'susie' | 'paul' | 'cctv' = 'susie'): void {
  toSwitch(flow);
  flow.onView(view, 'john');
  run(flow, STEP_DONE_PAUSE + 0.3, { view });
}

function toWrap(flow: TutorialFlow): void {
  toQuick(flow);
  flow.onView('john', 'susie');
  run(flow, STEP_DONE_PAUSE + 0.3);
}

function completeAll(flow: TutorialFlow): void {
  toWrap(flow);
  run(flow, WRAP_SECONDS + 0.3);
}

const text = (flow: TutorialFlow, c: Partial<CardContext> = {}): string => {
  const card = flow.card(ctx(c));
  return card ? [card.title, ...card.lines, ...card.checks.map((x) => x.label)].join(' | ') : '';
};

describe('tokenize', () => {
  it('splits text and key caps', () => {
    expect(tokenize('Press {E} to buy.')).toEqual([
      { key: false, text: 'Press ' },
      { key: true, text: 'E' },
      { key: false, text: ' to buy.' },
    ]);
  });

  it('handles adjacent keys, keys at the edges and plain text', () => {
    expect(tokenize('{W}{A}{S}{D}').map((t) => t.text)).toEqual(['W', 'A', 'S', 'D']);
    expect(tokenize('{W}{A}{S}{D}').every((t) => t.key)).toBe(true);
    expect(tokenize('{Esc} pauses')[0]).toEqual({ key: true, text: 'Esc' });
    expect(tokenize('no keys here')).toEqual([{ key: false, text: 'no keys here' }]);
    expect(tokenize('')).toEqual([]);
  });

  it('keeps spaces and bracket keys inside a cap, and leaves stray braces as text', () => {
    expect(tokenize('{Right stick}')).toEqual([{ key: true, text: 'Right stick' }]);
    expect(tokenize('{[} {]}')).toEqual([
      { key: true, text: '[' },
      { key: false, text: ' ' },
      { key: true, text: ']' },
    ]);
    expect(tokenize('a { b')).toEqual([{ key: false, text: 'a { b' }]);
  });
});

describe('directionWords', () => {
  it("from John's seat facing the TV wall, the machines are ahead and to the right", () => {
    // spawn (-13.1, -4.2) facing -z; drinks machine (-10.1, -9.3)
    expect(directionWords(0, -1, -10.1 - -13.1, -9.3 - -4.2)).toBe('ahead and to your right');
  });

  it('names the four quarters', () => {
    expect(directionWords(0, -1, 0, -5)).toBe('straight ahead');
    expect(directionWords(0, -1, 0, 5)).toBe('behind you');
    expect(directionWords(0, -1, -5, 0)).toBe('to your left');
    expect(directionWords(0, -1, 5, 0)).toBe('to your right');
    expect(directionWords(0, -1, -3, -4)).toBe('ahead and to your left');
  });

  it('follows three.js handedness when facing +x', () => {
    expect(directionWords(1, 0, 0, 3)).toBe('to your right');
    expect(directionWords(1, 0, 0, -3)).toBe('to your left');
    expect(directionWords(1, 0, 4, 0)).toBe('straight ahead');
  });

  it('says so when the target is where you stand', () => {
    expect(directionWords(0, -1, 0, 0)).toBe('right here');
  });
});

describe('deviceOf', () => {
  it('prefers the gamepad when it was used last, then touch, then keyboard and mouse', () => {
    expect(deviceOf(true, true)).toBe('pad');
    expect(deviceOf(false, true)).toBe('pad');
    expect(deviceOf(true, false)).toBe('touch');
    expect(deviceOf(false, false)).toBe('kbm');
  });
});

describe('heldTime', () => {
  it('holds a natural advance across the cap', () => {
    expect(heldTime(13.95, 14.05, CLOCK_CAP)).toBe(CLOCK_CAP);
    expect(heldTime(CLOCK_CAP, CLOCK_CAP + 0.02, CLOCK_CAP)).toBe(CLOCK_CAP);
  });

  it('lets the clock run below the cap, without a cap, and after a jump past it', () => {
    expect(heldTime(10, 10.1, CLOCK_CAP)).toBe(10.1);
    expect(heldTime(13.95, 14.05, null)).toBe(14.05);
    expect(heldTime(30, 30.02, CLOCK_CAP)).toBe(30.02);
  });
});

describe('TutorialFlow — walkthrough', () => {
  it('does nothing until started, then opens on look/walk with the clock held', () => {
    const flow = new TutorialFlow();
    expect(flow.armed).toBe(false);
    expect(flow.card(ctx())).toBeNull();
    expect(flow.clockCap()).toBeNull();
    flow.start();
    expect(flow.step).toBe('look_move');
    expect(flow.running).toBe(true);
    expect(flow.clockCap()).toBe(CLOCK_CAP);
    const card = flow.card(ctx())!;
    expect(card.kicker).toBe('TUTORIAL');
    expect(card.progress).toBe('1 / 5');
    expect(card.checks.map((c) => c.done)).toEqual([false, false]);
  });

  it('needs both looking and walking; the first ticks quietly, the second completes the card', () => {
    const onTick = vi.fn();
    const flow = started({ onTick });
    run(flow, 1, { look: LOOK_NEEDED / 5 });
    expect(flow.lookDone).toBe(true);
    expect(flow.moveDone).toBe(false);
    expect(flow.doneTimer).toBe(-1);
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(flow.card(ctx())!.checks.map((c) => c.done)).toEqual([true, false]);

    run(flow, 0.5, { walked: 0.25 });
    expect(flow.moveDone).toBe(true);
    expect(flow.doneTimer).toBeGreaterThan(0);
    expect(onTick).toHaveBeenCalledTimes(2);
    expect(flow.card(ctx())!.done).toBe(true);

    run(flow, STEP_DONE_PAUSE + 0.2);
    expect(flow.step).toBe('vending');
  });

  it('counts holding a direction as walking (a chair row can eat the distance)', () => {
    const flow = started();
    run(flow, MOVE_INPUT_SECONDS + 0.2, { move: 1 });
    expect(flow.moveDone).toBe(true);
  });

  it('ignores teleports, other perspectives, open modals and pauses', () => {
    const flow = started();
    flow.update(frame({ walked: 5 }));
    expect(flow.walkedAccum).toBe(0);
    run(flow, 1, { view: 'cctv', look: 500, walked: 0.3 });
    run(flow, 1, { modal: true, look: 500, walked: 0.3 });
    run(flow, 1, { playing: false, look: 500, walked: 0.3 });
    expect(flow.lookAccum).toBe(0);
    expect(flow.walkedAccum).toBe(0);
    expect(flow.step).toBe('look_move');
  });

  it('words the first card for the device in hand', () => {
    const flow = started();
    expect(text(flow)).toContain('{Mouse}');
    expect(text(flow)).toContain('{W}{A}{S}{D}');
    expect(text(flow, { pointerLocked: false })).toContain('Click the view first');
    expect(text(flow, { device: 'pad' })).toContain('{Right stick}');
    expect(text(flow, { device: 'pad' })).toContain('{Left stick}');
    expect(text(flow, { device: 'touch' })).toContain('drag on the right half');
    expect(text(flow, { device: 'pad', pointerLocked: false })).not.toContain('Click the view');
  });

  it('sends John to the vending machine and says where it is', () => {
    const flow = started();
    toVending(flow);
    expect(flow.step).toBe('vending');
    expect(text(flow)).toContain('ahead and to your right');
    expect(text(flow)).toContain('press {E}');
    expect(text(flow, { targetingVending: true })).toContain('Press {E} to buy.');
    expect(text(flow, { device: 'pad', targetingVending: true })).toContain('Press {A} to buy.');
    expect(text(flow, { device: 'touch', targetingVending: true })).toContain('Tap {USE} to buy.');
    expect(text(flow, { vendingDir: null })).toContain('by the TV wall.');
  });

  it('completes the vending step when John buys, after the purchase plays out', () => {
    const flow = started();
    toVending(flow);
    flow.onInteract('wait_vending_1', 'john');
    expect(flow.doneTimer).toBeCloseTo(VENDING_DONE_PAUSE);
    expect(flow.card(ctx())!.done).toBe(true);
    expect(text(flow)).toContain('That is how you use things');
    run(flow, VENDING_DONE_PAUSE - 0.5);
    expect(flow.step).toBe('vending');
    run(flow, 0.8);
    expect(flow.step).toBe('switch');
    expect(flow.clockCap()).toBeNull();
  });

  it('only counts John using a machine (or the free bottle)', () => {
    const flow = started();
    toVending(flow);
    flow.onInteract('wait_vending_1', 'susie');
    flow.onInteract('wait_tv', 'john');
    expect(flow.doneTimer).toBe(-1);
    flow.onInteract('take_bottle', 'john');
    expect(flow.doneTimer).toBeGreaterThan(0);
  });

  it('lets an eager player who buys first skip straight to the console step', () => {
    const flow = started();
    flow.onInteract('wait_vending_0', 'john');
    expect(flow.lookDone && flow.moveDone && flow.vendingDone).toBe(true);
    run(flow, VENDING_DONE_PAUSE + 0.3);
    expect(flow.step).toBe('switch');
  });

  it('points the open console at Susie and moves on when the player becomes her', () => {
    const flow = started();
    toSwitch(flow);
    expect(text(flow)).toContain('Press {Tab}');
    expect(text(flow, { device: 'pad' })).toContain('Press {Y}');
    expect(text(flow, { device: 'touch' })).toContain('Tap {SWITCH}');
    expect(flow.switcherHint('kbm')).toEqual({ text: expect.stringContaining('{2}'), target: 'susie' });
    expect(flow.switcherHint('pad')!.text).toContain('{A}');
    expect(flow.switcherHint('touch')!.text).toContain('tap');

    flow.onView('susie', 'john');
    expect(flow.switchedTo).toBe('susie');
    expect(flow.switcherHint('kbm')).toBeNull();
    run(flow, STEP_DONE_PAUSE + 0.2, { view: 'susie' });
    expect(flow.step).toBe('quick');
    expect(flow.card(ctx({ view: 'susie' }))!.title).toBe("You're Susie now");
    expect(text(flow, { view: 'susie' })).toContain('Press {1} to go back to John');
    expect(text(flow, { view: 'susie', device: 'pad' })).toContain('Press {Y} and pick John');
  });

  it('closes with a card that dismisses itself and reports completion once', () => {
    const onFinished = vi.fn();
    const flow = started({ onFinished });
    toWrap(flow);
    expect(flow.step).toBe('wrap');
    const card = flow.card(ctx())!;
    expect(card.footer).toBeNull();
    expect(card.timer).toBeGreaterThan(0.9);
    run(flow, WRAP_SECONDS + 0.2);
    expect(flow.step).toBeNull();
    expect(flow.running).toBe(false);
    expect(flow.armed).toBe(true); // tips stay on for the rest of the night
    expect(flow.card(ctx())).toBeNull();
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(onFinished).toHaveBeenCalledWith('completed');
  });

  it('gives up on the number-key card and on the console step after their timeouts', () => {
    const a = started();
    toQuick(a);
    run(a, QUICK_TIMEOUT + 0.3, { view: 'susie' });
    expect(a.step).toBe('wrap');

    const b = started();
    toSwitch(b);
    run(b, SWITCH_TIMEOUT + 0.2);
    expect(b.step).toBe('wrap');
  });

  it('stops the step timer while a modal is open', () => {
    const flow = started();
    toSwitch(flow);
    const before = flow.stepTime;
    run(flow, 10, { modal: true });
    expect(flow.stepTime).toBe(before);
    run(flow, 1);
    expect(flow.stepTime).toBeCloseTo(before + 1);
  });

  it('skips ahead when the player switches before being asked to', () => {
    const flow = started();
    flow.onView('paul', 'john');
    run(flow, STEP_DONE_PAUSE + 0.2, { view: 'paul' });
    expect(flow.step).toBe('quick');
    expect(text(flow, { view: 'paul' })).toContain('{F} switches his flashlight');
  });

  it('follows a purchase that is straight away followed by a switch', () => {
    const flow = started();
    toVending(flow);
    flow.onInteract('wait_vending_1', 'john');
    flow.onView('paul', 'john');
    run(flow, 1.2, { view: 'paul' });
    expect(flow.step).toBe('quick');
    expect(flow.switchedTo).toBe('paul');
  });

  it('describes the cameras when they were the first switch', () => {
    const flow = started();
    toQuick(flow, 'cctv');
    expect(flow.card(ctx({ view: 'cctv' }))!.title).toBe("You're watching the cameras");
    expect(text(flow, { view: 'cctv' })).toContain('{[} {]} change camera');
  });
});

describe('TutorialFlow — clock hold', () => {
  it('holds the clock at the cap for at most MAX_HOLD_SECONDS, then lets the night go on', () => {
    const flow = started();
    run(flow, MAX_HOLD_SECONDS - 1, { clock: CLOCK_CAP });
    expect(flow.step).toBe('look_move');
    expect(flow.clockCap()).toBe(CLOCK_CAP);
    run(flow, 1.5, { clock: CLOCK_CAP });
    expect(flow.step).toBe('switch');
    expect(flow.clockCap()).toBeNull();
  });

  it('only counts time spent at the cap', () => {
    const flow = started();
    run(flow, 100, { clock: 10 });
    expect(flow.holdUsed).toBe(0);
    expect(flow.clockCap()).toBe(CLOCK_CAP);
  });

  it('skips the vending trip after a jump past the page', () => {
    const flow = started();
    flow.update(frame({ clock: CLOCK_CAP + 1 }));
    expect(flow.step).toBe('switch');
  });
});

describe('TutorialFlow — skip and reset', () => {
  it('skip ends the walkthrough and the tips, and reports once', () => {
    const onFinished = vi.fn();
    const flow = started({ onFinished });
    flow.skip();
    expect(onFinished).toHaveBeenCalledWith('skipped');
    expect(flow.armed).toBe(false);
    expect(flow.card(ctx())).toBeNull();
    expect(flow.clockCap()).toBeNull();
    flow.skip();
    flow.onView('paul', 'john');
    flow.onWarn('susie', 0.5, 'paul');
    run(flow, 1, { view: 'paul' });
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(flow.card(ctx({ view: 'paul' }))).toBeNull();
  });

  it('reset disarms without reporting', () => {
    const onFinished = vi.fn();
    const flow = started({ onFinished });
    flow.reset();
    expect(flow.armed).toBe(false);
    expect(flow.step).toBeNull();
    expect(onFinished).not.toHaveBeenCalled();
  });
});

describe('TutorialFlow — tips', () => {
  it('after the walkthrough, the first time as Paul shows his tip once', () => {
    const flow = started();
    completeAll(flow);
    flow.onView('paul', 'john');
    flow.update(frame({ view: 'paul' }));
    const card = flow.card(ctx({ view: 'paul' }))!;
    expect(card.kind).toBe('tip');
    expect(card.key).toBe('tip:paul');
    expect(card.lines.join(' ')).toContain('{F}');
    run(flow, TIP_SECONDS + 0.2, { view: 'paul' });
    expect(flow.card(ctx({ view: 'paul' }))).toBeNull();
    flow.onView('john', 'paul');
    flow.onView('paul', 'john');
    run(flow, 1, { view: 'paul' });
    expect(flow.card(ctx({ view: 'paul' }))).toBeNull();
  });

  it('a perspective tip waits for the walkthrough to finish', () => {
    const flow = started();
    toWrap(flow);
    flow.onView('cctv', 'john');
    run(flow, 1, { view: 'cctv' });
    expect(flow.card(ctx({ view: 'cctv' }))!.key).toBe('step:wrap');
    run(flow, WRAP_SECONDS, { view: 'cctv' });
    expect(flow.card(ctx({ view: 'cctv' }))!.key).toBe('tip:cctv');
  });

  it('drops a perspective tip when the player has already left that perspective', () => {
    const flow = started();
    toWrap(flow);
    flow.onView('paul', 'john');
    flow.onView('john', 'paul');
    run(flow, WRAP_SECONDS + 1);
    expect(flow.card(ctx())).toBeNull();
    expect(flow.tipId).toBeNull();
  });

  it('gives no separate tip for the perspective the walkthrough already introduced', () => {
    const flow = started();
    completeAll(flow);
    flow.onView('susie', 'john');
    run(flow, 1, { view: 'susie' });
    expect(flow.card(ctx({ view: 'susie' }))).toBeNull();
  });

  it('shows the first danger warning about someone else at once, even mid-walkthrough', () => {
    const flow = started();
    flow.onWarn('paul', 0.3, 'john');
    const card = flow.card(ctx())!;
    expect(card.key).toBe('tip:danger:paul');
    expect(card.title).toBe('Paul needs you');
    expect(card.lines.join(' ')).toContain('Press {3} to switch to Paul.');
    expect(text(flow, { device: 'pad' })).toContain('Press {Y} and pick Paul.');
    flow.onWarn('susie', 0.6, 'john');
    expect(flow.card(ctx())!.key).toBe('tip:danger:paul');
    // going to him clears it; the walkthrough card comes back
    flow.update(frame({ view: 'paul' }));
    expect(flow.card(ctx())!.key).toBe('step:look_move');
  });

  it('ignores warnings about the person being watched, faint ones, and nights without the tutorial', () => {
    const flow = started();
    flow.onWarn('john', 0.8, 'john');
    flow.onWarn('susie', 0.05, 'john');
    expect(flow.tipId).toBeNull();
    const off = new TutorialFlow();
    off.onWarn('susie', 0.8, 'john');
    expect(off.tipId).toBeNull();
  });

  it('lets the danger tip time out', () => {
    const flow = started();
    completeAll(flow);
    flow.onWarn('susie', 0.4, 'john');
    expect(flow.tipId).toBe('danger');
    run(flow, DANGER_TIP_SECONDS + 0.2);
    expect(flow.tipId).toBeNull();
  });
});

describe('Tutorial setting', () => {
  it('is on by default, and older saved settings without it get it on', () => {
    expect(DEFAULT_SETTINGS.tutorial).toBe(true);
    expect(makeInitialState('x', 'mixed', { difficulty: 'hard' }).settings.tutorial).toBe(true);
    expect(makeInitialState('x', 'mixed', { tutorial: false }).settings.tutorial).toBe(false);
  });
});
