/**
 * In-game HUD: identity block, wall-clock readout, hairline meters, objective hint,
 * interaction prompt and the portrait strip with warning rings. Everything is DOM +
 * inline SVG; the portraits are drawn procedurally per character (no emoji, no images).
 */
import type { HudState, Services } from '../core/contracts';
import { formatClock12 } from '../core/clock';
import { CHARACTER_META } from '../core/state';
import { CHARACTER_IDS, type CharacterId, type RoomId, type ViewId } from '../core/types';
import { ROOM_BY_ID } from '../world/layout';

const IDLE_SECONDS = 6;
const WARN_HOLD_SECONDS = 4.5;
const RING_R = 21;
const RING_C = 2 * Math.PI * RING_R;

/** Monochrome silhouette portraits. `currentColor` = figure, `--ns-portrait-bg` = cut-outs. */
export function portraitSvg(id: CharacterId): string {
  const body = (w: number) => `<path d="M${24 - w} 48 C${26 - w} 36 ${16 - (w - 20) * 0.4} 31 24 30 C${32 + (w - 20) * 0.4} 31 ${22 + w} 36 ${24 + w} 48 Z"/>`;
  const neck = '<rect x="20.5" y="23" width="7" height="8"/>';
  const cut = 'fill="var(--ns-portrait-bg, #0a0c0d)"';
  let inner = '';
  if (id === 'john') {
    inner =
      body(20) +
      neck +
      '<g transform="rotate(-5 24 15)">' +
      '<ellipse cx="24" cy="15" rx="8.2" ry="9.4"/>' +
      '<path d="M15.8 12.5 C16.5 6 21.5 3.8 24.6 4.3 C29 3.9 32.3 7 32.6 12.6 C30.2 9.6 27.2 8.6 24.2 9 C21 8.6 18 9.6 15.8 12.5 Z"/>' +
      '</g>' +
      `<path ${cut} d="M16.6 32 L24 42.5 L31.4 32 L28.6 31.1 L24 37.6 L19.4 31.1 Z"/>` +
      `<path ${cut} d="M11.4 36.6 L14.6 34.8 L15.2 35.9 L12 37.7 Z"/>`;
  } else if (id === 'susie') {
    inner =
      body(21) +
      neck +
      '<ellipse cx="24" cy="15.5" rx="8" ry="9"/>' +
      '<path d="M14.8 15 C14.6 6.6 19 3.6 24 3.6 C29 3.6 33.4 6.6 33.2 15 C31.6 10.4 28.2 8.6 24 8.6 C19.8 8.6 16.4 10.4 14.8 15 Z"/>' +
      '<circle cx="33.6" cy="11.4" r="3.7"/>' +
      `<path ${cut} d="M17.4 31.4 L24 40.2 L30.6 31.4 L28.4 30.9 L24 36.6 L19.6 30.9 Z"/>` +
      `<path ${cut} d="M20.2 31.2 L22.4 42.4 L23.1 42.3 L20.9 31.1 Z"/>` +
      `<path ${cut} d="M27.8 31.2 L25.6 42.4 L24.9 42.3 L27.1 31.1 Z"/>` +
      `<rect ${cut} x="21.6" y="41.6" width="4.8" height="4"/>`;
  } else {
    inner =
      body(22) +
      neck +
      '<ellipse cx="24" cy="16" rx="8" ry="9"/>' +
      '<path d="M15.2 14.6 C15.6 7.6 19.2 4 24 4 C28.8 4 32.4 7.6 32.8 14.6 Z"/>' +
      '<path d="M7.4 14.9 L32.8 13.3 L32.9 15.9 L8.2 17.6 Z"/>' +
      `<path ${cut} d="M17.6 30.8 L24 36.4 L30.4 30.8 L27.6 30.2 L24 33.4 L20.4 30.2 Z"/>` +
      `<rect ${cut} x="31.2" y="35.6" width="3.6" height="6.2"/>` +
      `<rect ${cut} x="32" y="34" width="2" height="1.8"/>`;
  }
  return `<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">${inner}</svg>`;
}

function flashlightSvg(): string {
  return (
    '<svg viewBox="0 0 24 12" aria-hidden="true">' +
    '<path d="M1 3.5h9v5H1z M10 2.5l4-2v11l-4-2z" fill="currentColor"/>' +
    '<path class="ray" d="M16 3 l6-2 M16 6 h7 M16 9 l6 2" stroke="currentColor" stroke-width="1" fill="none"/>' +
    '</svg>'
  );
}

interface Transient {
  level: number;
  hint: string | null;
  t: number;
}

export class Hud {
  readonly el: HTMLElement;
  private s: Services;
  private pinned: Partial<HudState> = {};
  private transient: Record<CharacterId, Transient> = {
    john: { level: 0, hint: null, t: 0 },
    susie: { level: 0, hint: null, t: 0 },
    paul: { level: 0, hint: null, t: 0 },
  };
  private idle = 0;
  private visible = true;
  private cctv = false;
  private prompt: string | null = null;
  private objective: string | null = null;
  private objectiveTimer = 0;
  private pendingObjective: string | null | undefined;
  private lastClock = '';
  private lastLocation: RoomId | null = null;
  private lastView: ViewId | null = null;
  private lastPadGlyph: boolean | null = null;
  private lastTouch: boolean | null = null;

  // elements
  private name: HTMLElement;
  private role: HTMLElement;
  private loc: HTMLElement;
  private meterStress: HTMLElement;
  private meterPerc: HTMLElement;
  private flash: HTMLElement;
  private flashLabel: HTMLElement;
  private clockH: HTMLElement;
  private clockM: HTMLElement;
  private clockAp: HTMLElement;
  private objectiveEl: HTMLElement;
  private promptEl: HTMLElement;
  private promptKey: HTMLElement;
  private promptText: HTMLElement;
  private portraits: Record<CharacterId, { root: HTMLElement; ring: SVGCircleElement; hint: HTMLElement; status: HTMLElement }>;

  constructor(s: Services, parent: HTMLElement) {
    this.s = s;
    const el = document.createElement('div');
    el.className = 'ns-hud';
    el.innerHTML = `
      <div class="ns-hud__tl ns-fade">
        <div class="ns-id">
          <div class="ns-id__name"></div>
          <div class="ns-id__role"></div>
        </div>
        <div class="ns-meters" aria-hidden="true">
          <div class="ns-meter ns-meter--stress"><i></i></div>
          <div class="ns-meter ns-meter--perc"><i></i></div>
        </div>
        <div class="ns-loc"><span class="ns-loc__dot"></span><span class="ns-loc__text"></span></div>
        <div class="ns-flash" hidden>${flashlightSvg()}<span class="ns-flash__label">LIGHT</span></div>
      </div>
      <div class="ns-hud__tr ns-fade">
        <div class="ns-clock" aria-label="clock">
          <span class="ns-clock__d ns-clock__h"></span><span class="ns-clock__colon">:</span><span class="ns-clock__d ns-clock__m"></span><span class="ns-clock__ap"></span>
        </div>
      </div>
      <div class="ns-hud__bl ns-fade"><div class="ns-objective"></div></div>
      <div class="ns-hud__bc"><div class="ns-prompt" hidden><span class="ns-key"></span><span class="ns-prompt__text"></span></div></div>
      <div class="ns-hud__br ns-fade"><div class="ns-portraits"></div></div>
    `;
    parent.appendChild(el);
    this.el = el;
    const q = <T extends Element = HTMLElement>(sel: string): T => el.querySelector(sel) as T;
    this.name = q('.ns-id__name');
    this.role = q('.ns-id__role');
    this.loc = q('.ns-loc__text');
    this.meterStress = q('.ns-meter--stress i');
    this.meterPerc = q('.ns-meter--perc i');
    this.flash = q('.ns-flash');
    this.flashLabel = q('.ns-flash__label');
    this.clockH = q('.ns-clock__h');
    this.clockM = q('.ns-clock__m');
    this.clockAp = q('.ns-clock__ap');
    this.objectiveEl = q('.ns-objective');
    this.promptEl = q('.ns-prompt');
    this.promptKey = q('.ns-key');
    this.promptText = q('.ns-prompt__text');

    const strip = q('.ns-portraits');
    const portraits = {} as Hud['portraits'];
    for (const id of CHARACTER_IDS) {
      const p = document.createElement('div');
      p.className = 'ns-portrait';
      p.dataset.id = id;
      p.innerHTML =
        `<svg class="ns-portrait__ring" viewBox="0 0 48 48" aria-hidden="true">` +
        `<circle class="ns-portrait__track" cx="24" cy="24" r="${RING_R}"/>` +
        `<circle class="ns-portrait__fill" cx="24" cy="24" r="${RING_R}" stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${RING_C.toFixed(2)}"/>` +
        `</svg>` +
        `<div class="ns-portrait__face">${portraitSvg(id)}</div>` +
        `<div class="ns-portrait__key">${CHARACTER_IDS.indexOf(id) + 1}</div>` +
        `<div class="ns-portrait__status"></div>` +
        `<div class="ns-portrait__hint" hidden></div>`;
      strip.appendChild(p);
      portraits[id] = {
        root: p,
        ring: p.querySelector('.ns-portrait__fill') as SVGCircleElement,
        hint: p.querySelector('.ns-portrait__hint') as HTMLElement,
        status: p.querySelector('.ns-portrait__status') as HTMLElement,
      };
    }
    this.portraits = portraits;
    this.refreshStatic();
  }

  /** Fields set here take priority over store-derived values (clock/location/identity always follow the store). */
  setState(patch: Partial<HudState>): void {
    Object.assign(this.pinned, patch);
    if (patch.prompt !== undefined) this.setPrompt(patch.prompt);
    if (patch.warnings) this.wake();
  }

  setPrompt(text: string | null): void {
    if (text === this.prompt) return;
    this.prompt = text;
    this.promptText.textContent = text ?? '';
    this.promptEl.hidden = !text;
    this.el.classList.toggle('has-prompt', !!text);
  }

  get hasPrompt(): boolean {
    return !!this.prompt;
  }

  setObjective(text: string | null): void {
    if (text === this.objective && this.pendingObjective === undefined) return;
    // fade the old line out, then swap
    this.pendingObjective = text;
    this.objectiveTimer = this.objective ? 0.45 : 0;
    this.objectiveEl.classList.add('is-swapping');
    this.wake();
  }

  warn(id: CharacterId, level: number, hint?: string): void {
    const t = this.transient[id];
    t.level = Math.max(0, Math.min(1, level));
    t.hint = hint ?? t.hint;
    t.t = WARN_HOLD_SECONDS;
    this.portraits[id].root.classList.add('is-warned');
    this.wake();
  }

  wake(): void {
    this.idle = 0;
    this.el.classList.remove('is-idle');
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.el.classList.toggle('is-hidden', !v);
  }

  /** Surveillance view: the CCTV overlay carries label + timestamp, so drop identity/clock. */
  setCCTV(active: boolean): void {
    if (this.cctv === active) return;
    this.cctv = active;
    this.el.classList.toggle('is-cctv', active);
  }

  update(dt: number, active: boolean): void {
    if (!this.visible) return;
    const st = this.s.store.get();
    const view = st.activeView;
    this.setCCTV(view === 'cctv');

    // Idle fade (prompt excluded via CSS)
    if (active) this.wake();
    else {
      this.idle += dt;
      if (this.idle > IDLE_SECONDS) this.el.classList.add('is-idle');
    }

    // Clock — always from the game clock
    const clock = formatClock12(this.s.clock.time);
    if (clock !== this.lastClock) {
      this.lastClock = clock;
      const [hm, ap] = clock.split(' ');
      const [h, m] = hm.split(':');
      this.clockH.textContent = h;
      this.clockM.textContent = m;
      this.clockAp.textContent = ap;
    }

    // Identity / location — from the active character
    if (view !== this.lastView) {
      this.lastView = view;
      this.lastLocation = null;
      for (const id of CHARACTER_IDS) this.portraits[id].root.classList.toggle('is-active', id === view);
      if (view !== 'cctv') {
        const meta = CHARACTER_META[view];
        this.name.textContent = meta.name.toUpperCase();
        this.role.textContent = meta.role.toUpperCase();
        this.wake();
      }
    }
    if (view !== 'cctv') {
      const c = st.characters[view];
      if (c.location !== this.lastLocation) {
        this.lastLocation = c.location;
        this.loc.textContent = (ROOM_BY_ID[c.location]?.name ?? c.location).toUpperCase();
        this.wake();
      }
      const p = c.perception;
      const stress = this.pinned.stress ?? Math.min(1, p.stress * 0.55 + p.anxiety * 0.3 + p.fear * 0.45);
      const perc = this.pinned.perception ?? Math.min(1, p.medication * 0.7 + p.fatigue * 0.25 + p.injury * 0.25 + p.fear * 0.15);
      this.meterStress.style.width = `${(stress * 100).toFixed(1)}%`;
      this.meterPerc.style.width = `${(perc * 100).toFixed(1)}%`;
      this.meterStress.parentElement!.classList.toggle('is-high', stress > 0.7);

      const flash = this.pinned.flashlight !== undefined && this.pinned.flashlight !== null ? this.pinned.flashlight : view === 'paul' && c.hasFlashlight ? c.flashlight : null;
      this.flash.hidden = flash === null;
      if (flash !== null) {
        this.flash.classList.toggle('is-on', flash);
        this.flashLabel.textContent = flash ? 'LIGHT ON' : 'LIGHT OFF';
      }
    }

    // Prompt glyph follows the last input device
    const pad = this.s.input.lastDeviceWasGamepad;
    const touch = this.s.input.isTouch;
    if (pad !== this.lastPadGlyph || touch !== this.lastTouch) {
      this.lastPadGlyph = pad;
      this.lastTouch = touch;
      this.promptKey.textContent = pad ? 'A' : 'E';
      this.promptKey.classList.toggle('ns-key--pad', pad);
      this.promptKey.hidden = touch && !pad;
    }

    // Objective swap
    if (this.pendingObjective !== undefined) {
      this.objectiveTimer -= dt;
      if (this.objectiveTimer <= 0) {
        this.objective = this.pendingObjective;
        this.pendingObjective = undefined;
        this.objectiveEl.textContent = this.objective ?? '';
        this.objectiveEl.classList.remove('is-swapping');
      }
    }

    // Portraits: warning rings and status
    const warnings = this.pinned.warnings;
    for (const id of CHARACTER_IDS) {
      const c = st.characters[id];
      const t = this.transient[id];
      const P = this.portraits[id];
      if (t.t > 0) {
        t.t -= dt;
        if (t.t <= 0) {
          t.level = 0;
          t.hint = null;
          P.root.classList.remove('is-warned');
        }
      }
      const level = c.missing ? 1 : Math.max(warnings?.[id] ?? 0, t.level, c.danger);
      P.ring.setAttribute('stroke-dashoffset', (RING_C * (1 - level)).toFixed(2));
      P.root.classList.toggle('is-danger', level >= 0.5);
      P.root.classList.toggle('is-critical', level >= 0.85 && !c.missing);
      P.root.classList.toggle('is-missing', c.missing);
      P.root.style.setProperty('--ns-warn-level', level.toFixed(3));
      const hint = c.missing ? 'UNACCOUNTED' : t.t > 0 && t.hint ? t.hint : null;
      if (hint !== (P.hint.hidden ? null : P.hint.textContent)) {
        P.hint.textContent = hint ?? '';
        P.hint.hidden = !hint;
      }
      const status = id === view ? '' : c.missing ? '' : shortRoom(c.location);
      if (status !== P.status.textContent) P.status.textContent = status;
    }
  }

  private refreshStatic(): void {
    const meta = CHARACTER_META.john;
    this.name.textContent = meta.name.toUpperCase();
    this.role.textContent = meta.role.toUpperCase();
  }

  dispose(): void {
    this.el.remove();
  }
}

function shortRoom(room: RoomId): string {
  return (ROOM_BY_ID[room]?.shortName ?? room).toUpperCase();
}
