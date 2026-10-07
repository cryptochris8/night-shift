/**
 * Touch controls: a floating virtual stick on the left half, drag-to-look on the right
 * half, and a small cluster of action buttons. Only shown when the UI decides the device
 * is touch-first (`input.isTouch`). Buttons inject abstract actions so the rest of the
 * game never knows a finger was involved.
 */
import type { Services } from '../core/contracts';
import type { Action } from '../core/input';

const STICK_RADIUS = 52;
const LOOK_GAIN = 2.1;

export class TouchControls {
  readonly el: HTMLElement;
  private s: Services;
  private visible = false;
  private stickZone: HTMLElement;
  private lookZone: HTMLElement;
  private stickBase: HTMLElement;
  private stickThumb: HTMLElement;
  private stickPointer: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private lookPointer: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private btnLight: HTMLElement;
  private btnInteract: HTMLElement;
  private btnSwitch: HTMLElement;
  private cluster: HTMLElement;
  private lastView: string | null = null;
  private lastLightVisible: boolean | null = null;

  constructor(s: Services, parent: HTMLElement) {
    this.s = s;
    this.el = document.createElement('div');
    this.el.className = 'ns-touch';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="ns-touch__zone ns-touch__zone--stick">
        <div class="ns-stick" hidden><div class="ns-stick__thumb"></div></div>
      </div>
      <div class="ns-touch__zone ns-touch__zone--look"></div>
      <button class="ns-tbtn ns-tbtn--pause" data-act="pause" aria-label="pause"><i></i><i></i></button>
      <div class="ns-touch__cluster">
        <button class="ns-tbtn ns-tbtn--light" data-act="flashlight" aria-label="flashlight"><span>LIGHT</span></button>
        <button class="ns-tbtn ns-tbtn--switch" data-act="switcher" aria-label="switch perspective"><span>SWITCH</span></button>
        <button class="ns-tbtn ns-tbtn--interact" data-act="interact" aria-label="interact"><span>USE</span></button>
      </div>
    `;
    parent.appendChild(this.el);
    const q = (sel: string): HTMLElement => this.el.querySelector(sel) as HTMLElement;
    this.stickZone = q('.ns-touch__zone--stick');
    this.lookZone = q('.ns-touch__zone--look');
    this.stickBase = q('.ns-stick');
    this.stickThumb = q('.ns-stick__thumb');
    this.btnLight = q('.ns-tbtn--light');
    this.btnInteract = q('.ns-tbtn--interact');
    this.btnSwitch = q('.ns-tbtn--switch');
    this.cluster = q('.ns-touch__cluster');

    this.stickZone.addEventListener('pointerdown', this.onStickDown);
    this.stickZone.addEventListener('pointermove', this.onStickMove);
    this.stickZone.addEventListener('pointerup', this.onStickUp);
    this.stickZone.addEventListener('pointercancel', this.onStickUp);
    this.lookZone.addEventListener('pointerdown', this.onLookDown);
    this.lookZone.addEventListener('pointermove', this.onLookMove);
    this.lookZone.addEventListener('pointerup', this.onLookUp);
    this.lookZone.addEventListener('pointercancel', this.onLookUp);

    for (const btn of Array.from(this.el.querySelectorAll<HTMLElement>('.ns-tbtn'))) {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.add('is-down');
        const act = btn.dataset.act as Action;
        if (act === 'pause') this.s.game.pause();
        else this.s.input.inject(act);
        this.s.audio.play('ui_hover', { nonSpatial: true, volume: 0.25 });
      });
      const up = () => btn.classList.remove('is-down');
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  setVisible(v: boolean): void {
    if (this.visible === v) return;
    this.visible = v;
    this.el.hidden = !v;
    if (!v) this.releaseAll();
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** Highlight the interact button while something is usable. */
  setPromptAvailable(available: boolean): void {
    this.btnInteract.classList.toggle('is-available', available);
  }

  update(): void {
    if (!this.visible) return;
    const st = this.s.store.get();
    const view = st.activeView;
    if (view !== this.lastView) {
      this.lastView = view;
      const cctv = view === 'cctv';
      this.stickZone.classList.toggle('is-disabled', cctv);
      this.lookZone.classList.toggle('is-disabled', cctv);
      this.cluster.hidden = cctv;
      if (cctv) this.releaseAll();
    }
    const lightVisible = view === 'paul' && st.characters.paul.hasFlashlight;
    if (lightVisible !== this.lastLightVisible) {
      this.lastLightVisible = lightVisible;
      this.btnLight.hidden = !lightVisible;
    }
    if (lightVisible) this.btnLight.classList.toggle('is-on', st.characters.paul.flashlight);
    this.btnSwitch.classList.toggle('is-locked', st.inputLocked);
  }

  private releaseAll(): void {
    this.stickPointer = null;
    this.lookPointer = null;
    this.stickBase.hidden = true;
    this.s.input.setTouchMove(0, 0);
  }

  private onStickDown = (e: PointerEvent): void => {
    if (this.stickPointer !== null || this.stickZone.classList.contains('is-disabled')) return;
    e.preventDefault();
    this.stickPointer = e.pointerId;
    this.stickZone.setPointerCapture(e.pointerId);
    const rect = this.stickZone.getBoundingClientRect();
    this.stickOrigin = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    this.stickBase.hidden = false;
    this.stickBase.style.left = `${this.stickOrigin.x}px`;
    this.stickBase.style.top = `${this.stickOrigin.y}px`;
    this.stickThumb.style.transform = 'translate(0px, 0px)';
    this.s.input.lastDeviceWasGamepad = false;
  };

  private onStickMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.stickPointer) return;
    const rect = this.stickZone.getBoundingClientRect();
    let dx = e.clientX - rect.left - this.stickOrigin.x;
    let dy = e.clientY - rect.top - this.stickOrigin.y;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      dx = (dx / len) * STICK_RADIUS;
      dy = (dy / len) * STICK_RADIUS;
    }
    this.stickThumb.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
    // dead zone, then a gentle curve so slow walking is possible
    const nx = dx / STICK_RADIUS;
    const ny = -dy / STICK_RADIUS;
    const mag = Math.hypot(nx, ny);
    const shaped = mag < 0.12 ? 0 : Math.min(1, ((mag - 0.12) / 0.88) ** 1.3);
    const k = mag > 0 ? shaped / mag : 0;
    this.s.input.setTouchMove(nx * k, ny * k);
    // "run" when the stick is pushed to the rim
    this.s.input.setTouchHeld('run', shaped > 0.97);
  };

  private onStickUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.stickPointer) return;
    this.stickPointer = null;
    this.stickBase.hidden = true;
    this.s.input.setTouchMove(0, 0);
    this.s.input.setTouchHeld('run', false);
  };

  private onLookDown = (e: PointerEvent): void => {
    if (this.lookPointer !== null || this.lookZone.classList.contains('is-disabled')) return;
    e.preventDefault();
    this.lookPointer = e.pointerId;
    this.lookZone.setPointerCapture(e.pointerId);
    this.lookLast = { x: e.clientX, y: e.clientY };
    this.s.input.lastDeviceWasGamepad = false;
  };

  private onLookMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.lookPointer) return;
    const dx = e.clientX - this.lookLast.x;
    const dy = e.clientY - this.lookLast.y;
    this.lookLast = { x: e.clientX, y: e.clientY };
    this.s.input.addTouchLook(dx * LOOK_GAIN, dy * LOOK_GAIN);
  };

  private onLookUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.lookPointer) return;
    this.lookPointer = null;
  };

  dispose(): void {
    this.releaseAll();
    this.el.remove();
  }
}
