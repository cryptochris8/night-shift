/**
 * Edge detector over InputManager.down(). UI panels poll held state instead of
 * `pressed()` so they work both from `update()` (inside main's frame) and from a
 * fallback rAF loop that runs after main has already cleared per-frame presses.
 * Capturing the held state on reset() means the key that opened a panel never
 * counts as a press inside it.
 */
import type { Action, InputManager } from '../core/input';

export class ActionPoller {
  private prev = new Map<Action, number>();

  constructor(private readonly input: InputManager, private readonly actions: readonly Action[]) {
    this.reset();
  }

  /** Snapshot press counts so presses made before the panel opened (the key that opened it) do not count. */
  reset(): void {
    for (const a of this.actions) this.prev.set(a, this.count(a));
  }

  /**
   * Actions pressed since the previous poll. Counting presses (not sampling held state) means a tap that
   * goes down and up between two frames still registers, however low the frame rate.
   */
  poll(): Set<Action> {
    const edges = new Set<Action>();
    for (const a of this.actions) {
      const now = this.count(a);
      if (now > (this.prev.get(a) ?? 0)) edges.add(a);
      this.prev.set(a, now);
    }
    return edges;
  }

  private count(a: Action): number {
    try {
      return this.input.pressCount(a);
    } catch {
      return 0;
    }
  }

  get gamepad(): boolean {
    return this.input.lastDeviceWasGamepad;
  }

}

/** Shared action set for menu-like panels. */
export const PANEL_ACTIONS: readonly Action[] = [
  'confirm', 'cancel', 'interact', 'switcher',
  'forward', 'back', 'left', 'right',
  'quick_john', 'quick_susie', 'quick_paul', 'quick_cctv',
];
