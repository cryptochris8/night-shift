/**
 * Edge detector over InputManager.down(). UI panels poll held state instead of
 * `pressed()` so they work both from `update()` (inside main's frame) and from a
 * fallback rAF loop that runs after main has already cleared per-frame presses.
 * Capturing the held state on reset() means the key that opened a panel never
 * counts as a press inside it.
 */
import type { Action, InputManager } from '../core/input';

export class ActionPoller {
  private prev = new Map<Action, boolean>();

  constructor(private readonly input: InputManager, private readonly actions: readonly Action[]) {
    this.reset();
  }

  /** Snapshot the current held state so already-held keys do not register as edges. */
  reset(): void {
    for (const a of this.actions) this.prev.set(a, this.safeDown(a));
  }

  /** Actions that transitioned from released → held since the previous poll. */
  poll(): Set<Action> {
    const edges = new Set<Action>();
    for (const a of this.actions) {
      const now = this.safeDown(a);
      if (now && !this.prev.get(a)) edges.add(a);
      this.prev.set(a, now);
    }
    return edges;
  }

  get gamepad(): boolean {
    return this.input.lastDeviceWasGamepad;
  }

  private safeDown(a: Action): boolean {
    try {
      return this.input.down(a);
    } catch {
      return false;
    }
  }
}

/** Shared action set for menu-like panels. */
export const PANEL_ACTIONS: readonly Action[] = [
  'confirm', 'cancel', 'interact', 'switcher',
  'forward', 'back', 'left', 'right',
  'quick_john', 'quick_susie', 'quick_paul', 'quick_cctv',
];
