/**
 * Input manager: keyboard, mouse (pointer lock), gamepad → abstract actions.
 * Systems poll `input.down(action)` / `input.pressed(action)` and read `input.look`.
 */

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'run'
  | 'interact'
  | 'switcher'
  | 'quick_john'
  | 'quick_susie'
  | 'quick_paul'
  | 'quick_cctv'
  | 'pause'
  | 'flashlight'
  | 'cctv_next'
  | 'cctv_prev'
  | 'confirm'
  | 'cancel'
  | 'skip';

const KEYMAP: Record<string, Action[]> = {
  KeyW: ['forward'],
  ArrowUp: ['forward'],
  KeyS: ['back'],
  ArrowDown: ['back'],
  KeyA: ['left'],
  ArrowLeft: ['left'],
  KeyD: ['right'],
  ArrowRight: ['right'],
  ShiftLeft: ['run'],
  ShiftRight: ['run'],
  KeyE: ['interact'],
  Enter: ['interact', 'confirm'],
  NumpadEnter: ['confirm'],
  Space: ['confirm', 'skip'],
  Tab: ['switcher'],
  KeyQ: ['switcher'],
  Digit1: ['quick_john'],
  Digit2: ['quick_susie'],
  Digit3: ['quick_paul'],
  Digit4: ['quick_cctv'],
  KeyC: ['quick_cctv'],
  Escape: ['pause', 'cancel'],
  KeyF: ['flashlight'],
  BracketRight: ['cctv_next'],
  BracketLeft: ['cctv_prev'],
  Period: ['cctv_next'],
  Comma: ['cctv_prev'],
};

// Standard gamepad mapping indices
const PAD_BUTTONS: Record<number, Action[]> = {
  0: ['interact', 'confirm'], // A
  1: ['cancel'], // B
  2: ['flashlight'], // X
  3: ['switcher'], // Y
  4: ['cctv_prev'], // LB
  5: ['cctv_next'], // RB
  9: ['pause'], // Start
  8: ['switcher'], // Back/Select
  12: ['forward'],
  13: ['back'],
  14: ['left'],
  15: ['right'],
};

export class InputManager {
  private held = new Set<Action>();
  private pressedThisFrame = new Set<Action>();
  private releasedThisFrame = new Set<Action>();
  private keyHeld = new Set<string>();
  private padHeld = new Set<Action>();
  private padPrev = new Set<Action>();
  /** accumulated mouse delta since last frame (pixels) */
  look = { dx: 0, dy: 0 };
  /** analog move axis from gamepad (x right, y forward) */
  padMove = { x: 0, y: 0 };
  padLook = { x: 0, y: 0 };
  pointerLocked = false;
  /** when true, movement actions are ignored by consumers (UI open) */
  enabled = true;
  private element: HTMLElement;
  private wantLock = false;
  gamepadConnected = false;
  lastDeviceWasGamepad = false;
  /** when pointer lock is unavailable (iframe/mobile), mouse drag can still look */
  allowUnlockedLook = false;
  get isTouch(): boolean {
    return typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0) && !window.matchMedia?.('(pointer: fine)').matches;
  }

  constructor(element: HTMLElement) {
    this.element = element;
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('pointerlockerror', () => {
      this.pointerLocked = false;
    });
    window.addEventListener('gamepadconnected', () => {
      this.gamepadConnected = true;
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.gamepadConnected = navigator.getGamepads?.().some(Boolean) ?? false;
    });
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onLockChange);
  }

  /** Request pointer lock on the game canvas (call from a user gesture). */
  requestLock(): void {
    this.wantLock = true;
    if (document.pointerLockElement === this.element) return;
    try {
      const p = (this.element as any).requestPointerLock?.({ unadjustedMovement: true });
      if (p && typeof p.catch === 'function') p.catch(() => this.element.requestPointerLock());
    } catch {
      try {
        this.element.requestPointerLock();
      } catch {
        /* unsupported */
      }
    }
  }

  releaseLock(): void {
    this.wantLock = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  get wantsLock(): boolean {
    return this.wantLock;
  }

  /** Call once per frame AFTER systems have consumed input. */
  endFrame(): void {
    this.pressedThisFrame.clear();
    this.releasedThisFrame.clear();
    this.look.dx = 0;
    this.look.dy = 0;
  }

  /** Call once per frame BEFORE systems consume input (polls gamepad). */
  beginFrame(): void {
    this.pollGamepad();
  }

  down(action: Action): boolean {
    return this.held.has(action) || this.padHeld.has(action);
  }

  pressed(action: Action): boolean {
    return this.pressedThisFrame.has(action);
  }

  released(action: Action): boolean {
    return this.releasedThisFrame.has(action);
  }

  /** Movement vector in [-1,1]: x = strafe right, y = forward. */
  moveAxis(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.down('forward')) y += 1;
    if (this.down('back')) y -= 1;
    if (this.down('right')) x += 1;
    if (this.down('left')) x -= 1;
    x += this.padMove.x + this.touchMove.x;
    y += this.padMove.y + this.touchMove.y;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  /** Consume synthetic press (e.g. UI button mapped to an action). */
  inject(action: Action): void {
    this.pressedThisFrame.add(action);
  }

  /** Touch controls: virtual stick (-1..1) — persists until changed. */
  setTouchMove(x: number, y: number): void {
    this.touchMove.x = x;
    this.touchMove.y = y;
  }

  /** Touch controls: accumulate look delta (pixels). */
  addTouchLook(dx: number, dy: number): void {
    this.look.dx += dx;
    this.look.dy += dy;
  }

  /** Touch controls: hold/release an action (e.g. run button). */
  setTouchHeld(action: Action, held: boolean): void {
    if (held) {
      if (!this.held.has(action)) this.pressedThisFrame.add(action);
      this.held.add(action);
    } else if (this.held.has(action)) {
      this.held.delete(action);
      this.releasedThisFrame.add(action);
    }
  }

  private touchMove = { x: 0, y: 0 };

  private onKeyDown = (e: KeyboardEvent): void => {
    const actions = KEYMAP[e.code];
    if (e.code === 'Tab') e.preventDefault();
    if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) e.preventDefault();
    if (!actions) return;
    this.lastDeviceWasGamepad = false;
    if (this.keyHeld.has(e.code)) return; // auto-repeat
    this.keyHeld.add(e.code);
    for (const a of actions) {
      this.held.add(a);
      this.pressedThisFrame.add(a);
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const actions = KEYMAP[e.code];
    this.keyHeld.delete(e.code);
    if (!actions) return;
    for (const a of actions) {
      // only release if no other held key maps to the same action
      const stillHeld = Array.from(this.keyHeld).some((code) => KEYMAP[code]?.includes(a));
      if (!stillHeld) {
        this.held.delete(a);
        this.releasedThisFrame.add(a);
      }
    }
  };

  private onBlur = (): void => {
    this.held.clear();
    this.keyHeld.clear();
    this.padHeld.clear();
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.pointerLocked && !this.allowUnlockedLook) return;
    this.lastDeviceWasGamepad = false;
    this.look.dx += e.movementX;
    this.look.dy += e.movementY;
  };

  private onLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.element;
  };

  private pollGamepad(): void {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = Array.from(pads).find((p) => p && p.connected);
    this.padPrev = new Set(this.padHeld);
    this.padHeld.clear();
    this.padMove.x = 0;
    this.padMove.y = 0;
    this.padLook.x = 0;
    this.padLook.y = 0;
    if (!pad) return;
    const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
    this.padMove.x = dz(pad.axes[0] ?? 0);
    this.padMove.y = -dz(pad.axes[1] ?? 0);
    this.padLook.x = dz(pad.axes[2] ?? 0);
    this.padLook.y = dz(pad.axes[3] ?? 0);
    if (this.padMove.x || this.padMove.y || this.padLook.x || this.padLook.y) this.lastDeviceWasGamepad = true;
    pad.buttons.forEach((b, i) => {
      if (!b.pressed) return;
      const actions = PAD_BUTTONS[i];
      if (!actions) return;
      this.lastDeviceWasGamepad = true;
      for (const a of actions) {
        this.padHeld.add(a);
        if (!this.padPrev.has(a)) this.pressedThisFrame.add(a);
      }
    });
    for (const a of this.padPrev) {
      if (!this.padHeld.has(a)) this.releasedThisFrame.add(a);
    }
  }
}
