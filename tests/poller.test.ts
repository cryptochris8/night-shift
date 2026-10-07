import { describe, expect, it } from 'vitest';
import type { Action, InputManager } from '../src/core/input';
import { ActionPoller } from '../src/ui/switcher.input';

/** Minimal stand-in for InputManager: only the press counter the poller reads. */
function fakeInput(): { input: InputManager; press(a: Action): void } {
  const counts = new Map<Action, number>();
  const input = {
    pressCount: (a: Action) => counts.get(a) ?? 0,
    lastDeviceWasGamepad: false,
  } as unknown as InputManager;
  return { input, press: (a) => counts.set(a, (counts.get(a) ?? 0) + 1) };
}

describe('ActionPoller (press-count edges)', () => {
  it('ignores presses that happened before reset (the key that opened the panel)', () => {
    const f = fakeInput();
    f.press('confirm');
    const p = new ActionPoller(f.input, ['confirm', 'cancel']);
    expect(p.poll().size).toBe(0);
  });

  it('reports a tap that went down and up between two polls', () => {
    const f = fakeInput();
    const p = new ActionPoller(f.input, ['cancel']);
    f.press('cancel'); // keydown + keyup both happen before the next frame
    expect([...p.poll()]).toEqual(['cancel']);
    expect(p.poll().size).toBe(0); // consumed
  });

  it('reports several actions pressed in the same interval, and only watched ones', () => {
    const f = fakeInput();
    const p = new ActionPoller(f.input, ['confirm', 'left']);
    f.press('confirm');
    f.press('left');
    f.press('pause');
    expect(new Set(p.poll())).toEqual(new Set(['confirm', 'left']));
  });

  it('reset() re-baselines so presses made while closed do not leak into the next open', () => {
    const f = fakeInput();
    const p = new ActionPoller(f.input, ['interact']);
    f.press('interact');
    p.reset();
    expect(p.poll().size).toBe(0);
    f.press('interact');
    expect(p.poll().has('interact')).toBe(true);
  });

  it('exposes the input device hint', () => {
    const f = fakeInput();
    expect(new ActionPoller(f.input, []).gamepad).toBe(false);
  });
});
