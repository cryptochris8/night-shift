/**
 * Menu screens: title, pause, settings, controls, credits. One focus model for mouse,
 * keyboard (arrows / Enter / Esc) and gamepad (fed by UIManager through `padAction`).
 * Styled as a dark hospital/security console: thin rules, mono data, no app chrome.
 */
import type { Services } from '../core/contracts';
import { formatClock12 } from '../core/clock';
import { makeSeedCode } from '../core/rng';
import type { Difficulty, Screen, Settings } from '../core/types';

export type MenuScreen = 'title' | 'paused' | 'settings' | 'controls' | 'credits';
export type PadAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'cancel';

export interface ScreensHooks {
  /** Navigate to another menu screen (UIManager owns store.setScreen + showScreen). */
  navigate(screen: Screen): void;
  /** Leave the current sub-screen (settings/controls/credits → pause or title). */
  back(): void;
}

type RowKind = 'range' | 'toggle' | 'segment';
interface Row {
  key: keyof Settings;
  label: string;
  kind: RowKind;
  min?: number;
  max?: number;
  step?: number;
  format?: (v: number) => string;
  options?: { value: string; label: string; desc?: string }[];
  desc?: string;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

const SETTINGS_ROWS: Row[] = [
  { key: 'masterVolume', label: 'Master volume', kind: 'range', min: 0, max: 1, step: 0.05, format: pct },
  { key: 'musicVolume', label: 'Drone / music', kind: 'range', min: 0, max: 1, step: 0.05, format: pct },
  { key: 'sfxVolume', label: 'Effects', kind: 'range', min: 0, max: 1, step: 0.05, format: pct },
  { key: 'subtitles', label: 'Subtitles', kind: 'toggle', desc: 'Spoken lines as text. Non-speech captions always show.' },
  {
    key: 'difficulty',
    label: 'Difficulty',
    kind: 'segment',
    options: [
      { value: 'easy', label: 'Easy', desc: 'Danger builds slowly. More warnings before anyone is lost.' },
      { value: 'normal', label: 'Normal', desc: 'The night as intended. Watch everyone.' },
      { value: 'hard', label: 'Hard', desc: 'Danger builds faster, fewer warnings.' },
    ],
  },
  { key: 'tutorial', label: 'Tutorial', kind: 'toggle', desc: 'Walks through the controls at the start of the next night, with a few first-time tips. Turns itself off once finished.' },
  { key: 'mouseSensitivity', label: 'Mouse sensitivity', kind: 'range', min: 0.2, max: 3, step: 0.1, format: (v) => v.toFixed(1) + '×' },
  { key: 'invertY', label: 'Invert look', kind: 'toggle' },
  { key: 'motionEffects', label: 'Motion effects', kind: 'toggle', desc: 'Head bob, breathing distortion, camera shake.' },
  { key: 'filmGrain', label: 'Film grain', kind: 'toggle' },
  { key: 'reducedFlicker', label: 'Reduced flicker', kind: 'toggle', desc: 'Gentler fluorescent flicker and no strobing transitions.' },
  {
    key: 'quality',
    label: 'Quality',
    kind: 'segment',
    options: [
      { value: 'auto', label: 'Auto', desc: 'Steps down when the frame rate drops.' },
      { value: 'low', label: 'Low', desc: 'No bloom, half resolution, no shadows.' },
      { value: 'medium', label: 'Medium', desc: 'Reduced bloom, native resolution.' },
      { value: 'high', label: 'High', desc: 'Everything on.' },
    ],
  },
];

const CONTROL_ROWS: [string, string, string][] = [
  ['Move', 'W A S D · arrows', 'Left stick · d-pad'],
  ['Look', 'Mouse', 'Right stick'],
  ['Walk faster', 'Shift', 'Push the stick fully'],
  ['Interact', 'E · Enter', 'A'],
  ['Perspective console', 'Tab · Q', 'Y · Select'],
  ['Quick switch', '1 John · 2 Susie · 3 Paul · 4 CCTV', '—'],
  ['CCTV camera', '] [ or . ,', 'RB · LB'],
  ['Leave CCTV', 'Esc', 'B'],
  ['Flashlight (Paul)', 'F', 'X'],
  ['Skip cinematic', 'Space · Enter', 'A'],
  ['Pause', 'Esc', 'Start'],
];

const CREDITS_LINES: [string, string][] = [
  ['A night at', 'St. Augustine Regional Medical Center — a place that does not exist.'],
  ['Everything you see', 'is drawn by code at runtime: three.js primitives, canvas textures, SVG and CSS. No imported models, images or fonts.'],
  ['Everything you hear', 'is synthesised with the Web Audio API. The intercom borrows your browser\'s speech voice.'],
  ['Engine', 'three.js r186 · Vite 7 · TypeScript'],
  ['Night Seed', 'decides what the hospital is hiding. The game will not tell you which kind of night you had.'],
  ['Thank you', 'for working the shift. Headphones recommended.'],
];

export class Screens {
  readonly el: HTMLElement;
  current: MenuScreen | null = null;
  private s: Services;
  private hooks: ScreensHooks;
  private panels = {} as Record<MenuScreen, HTMLElement>;
  private seedInput!: HTMLInputElement;
  private resumeBtn!: HTMLElement;
  private skipTutBtn!: HTMLElement;
  private pauseClock!: HTMLElement;
  private pauseSeed!: HTMLElement;
  private titleClock!: HTMLElement;
  private focused: HTMLElement | null = null;
  private armed: { el: HTMLElement; label: string; t: number } | null = null;
  private clockAccum = 0;
  private unlockedOnce = false;
  private seedTouched = false;

  constructor(s: Services, parent: HTMLElement, hooks: ScreensHooks) {
    this.s = s;
    this.hooks = hooks;
    this.el = document.createElement('div');
    this.el.className = 'ns-screens';
    this.el.hidden = true;
    parent.appendChild(this.el);
    this.buildTitle();
    this.buildPause();
    this.buildSettings();
    this.buildControls();
    this.buildCredits();

    this.el.addEventListener('pointerover', (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>('.ns-item');
      if (item && item !== this.focused) this.focus(item, true);
    });
    this.el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const seg = target.closest<HTMLElement>('.ns-seg__opt');
      if (seg) {
        const row = seg.closest<HTMLElement>('.ns-row');
        if (row) this.setSegment(row, seg.dataset.value!);
        return;
      }
      const item = target.closest<HTMLElement>('.ns-item');
      if (!item || item instanceof HTMLInputElement) return;
      this.activate(item);
    });
    // Audio policy: the first gesture on the title unlocks the context.
    this.el.addEventListener('pointerdown', () => this.unlockAudio(), { passive: true });
    this.s.bus.on('settings:change', () => this.refreshSettings());
  }

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------

  private section(screen: MenuScreen, cls: string, html: string): HTMLElement {
    const sec = document.createElement('section');
    sec.className = `ns-screen ${cls}`;
    sec.dataset.screen = screen;
    sec.hidden = true;
    sec.innerHTML = html;
    this.el.appendChild(sec);
    this.panels[screen] = sec;
    return sec;
  }

  private buildTitle(): void {
    const sec = this.section(
      'title',
      'ns-title',
      `
      <div class="ns-title__grad"></div>
      <div class="ns-title__inner">
        <div class="ns-title__kicker">ONE NIGHT · THREE PEOPLE · THE SAME THREE HOURS</div>
        <h1 class="ns-title__name" aria-label="Night Shift"><span>NIGHT</span><span>SHIFT</span></h1>
        <div class="ns-title__sub">St. Augustine Regional — Emergency Department</div>
        <nav class="ns-menu" aria-label="main menu">
          <button class="ns-item ns-btn" data-act="new">New Shift</button>
          <button class="ns-item ns-btn" data-act="resume" hidden>Resume</button>
          <button class="ns-item ns-btn" data-act="settings">Settings</button>
          <button class="ns-item ns-btn" data-act="controls">Controls</button>
          <button class="ns-item ns-btn" data-act="credits">Credits</button>
        </nav>
        <div class="ns-seed">
          <label class="ns-seed__label" for="ns-seed-input">Night Seed</label>
          <div class="ns-seed__field">
            <input id="ns-seed-input" class="ns-item ns-seed__input" type="text" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" />
            <button class="ns-item ns-seed__rand" data-act="randomseed" title="Random seed" aria-label="random seed">⟳</button>
          </div>
          <div class="ns-seed__help">Same seed, same night. Leave as is for tonight's.</div>
        </div>
      </div>
      <div class="ns-title__footer">Headphones recommended. Contains flickering light.</div>
      <div class="ns-title__corner"><span class="ns-title__time"></span><span>v0.1</span></div>
    `,
    );
    this.seedInput = sec.querySelector('.ns-seed__input') as HTMLInputElement;
    this.resumeBtn = sec.querySelector('[data-act="resume"]') as HTMLElement;
    this.titleClock = sec.querySelector('.ns-title__time') as HTMLElement;
    this.seedInput.addEventListener('focus', () => this.focus(this.seedInput, false));
    this.seedInput.addEventListener('input', () => {
      this.seedTouched = true;
      const v = this.seedInput.value.toUpperCase();
      if (v !== this.seedInput.value) this.seedInput.value = v;
    });
  }

  private buildPause(): void {
    this.section(
      'paused',
      'ns-pause',
      `
      <div class="ns-pause__box">
        <header class="ns-pause__head">
          <div class="ns-pause__title">PAUSED</div>
          <div class="ns-pause__meta"><span class="ns-pause__clock"></span><span class="ns-pause__sep">·</span>SEED <span class="ns-pause__seed"></span></div>
        </header>
        <nav class="ns-menu" aria-label="pause menu">
          <button class="ns-item ns-btn" data-act="resume">Resume</button>
          <button class="ns-item ns-btn" data-act="skiptutorial" hidden>Skip tutorial</button>
          <button class="ns-item ns-btn" data-act="settings">Settings</button>
          <button class="ns-item ns-btn" data-act="controls">Controls</button>
          <button class="ns-item ns-btn ns-btn--confirm" data-act="restart" data-confirm="Restart — same seed. Sure?">Restart this night</button>
          <button class="ns-item ns-btn ns-btn--confirm" data-act="quit" data-confirm="Leave the shift. Sure?">Quit to title</button>
        </nav>
        <div class="ns-pause__hint">Esc resumes</div>
      </div>
    `,
    );
    this.skipTutBtn = this.panels.paused.querySelector('[data-act="skiptutorial"]') as HTMLElement;
    this.pauseClock = this.panels.paused.querySelector('.ns-pause__clock') as HTMLElement;
    this.pauseSeed = this.panels.paused.querySelector('.ns-pause__seed') as HTMLElement;
  }

  private panelShell(screen: MenuScreen, title: string, body: string): HTMLElement {
    return this.section(
      screen,
      'ns-panel',
      `
      <div class="ns-panel__box">
        <header class="ns-panel__head"><h2>${title}</h2><span class="ns-panel__esc">ESC · BACK</span></header>
        <div class="ns-panel__body">${body}</div>
        <footer class="ns-panel__foot"><button class="ns-item ns-btn" data-act="back">Back</button></footer>
      </div>
    `,
    );
  }

  private buildSettings(): void {
    const rows = SETTINGS_ROWS.map((r) => {
      const desc = r.desc ? `<div class="ns-row__desc">${r.desc}</div>` : r.kind === 'segment' ? '<div class="ns-row__desc"></div>' : '';
      let control = '';
      if (r.kind === 'range') {
        control = `<div class="ns-range"><input class="ns-item ns-range__input" type="range" min="${r.min}" max="${r.max}" step="${r.step}" aria-label="${r.label}" /><span class="ns-range__val"></span></div>`;
      } else if (r.kind === 'toggle') {
        control = `<button class="ns-item ns-toggle" role="switch" aria-label="${r.label}"><span class="ns-toggle__track"><i></i></span><span class="ns-toggle__val"></span></button>`;
      } else {
        control = `<div class="ns-item ns-seg" tabindex="0" role="radiogroup" aria-label="${r.label}">${(r.options ?? [])
          .map((o) => `<button class="ns-seg__opt" data-value="${o.value}" role="radio" tabindex="-1">${o.label}</button>`)
          .join('')}</div>`;
      }
      return `<div class="ns-row ns-row--${r.kind}" data-key="${r.key}"><div class="ns-row__label">${r.label}</div><div class="ns-row__control">${control}</div>${desc}</div>`;
    });
    const sec = this.panelShell('settings', 'SETTINGS', rows.join(''));
    for (const input of Array.from(sec.querySelectorAll<HTMLInputElement>('.ns-range__input'))) {
      input.addEventListener('input', () => {
        const row = input.closest<HTMLElement>('.ns-row')!;
        this.writeSetting(row.dataset.key as keyof Settings, Number(input.value));
      });
      input.addEventListener('focus', () => this.focus(input, false));
    }
    for (const seg of Array.from(sec.querySelectorAll<HTMLElement>('.ns-seg'))) {
      seg.addEventListener('focus', () => this.focus(seg, false));
    }
    this.refreshSettings();
  }

  private buildControls(): void {
    const rows = CONTROL_ROWS.map(([a, k, g]) => `<tr><th scope="row">${a}</th><td>${k}</td><td>${g}</td></tr>`).join('');
    this.panelShell(
      'controls',
      'CONTROLS',
      `<table class="ns-table"><thead><tr><th>Action</th><th>Keyboard / mouse</th><th>Gamepad</th></tr></thead><tbody>${rows}</tbody></table>
       <p class="ns-panel__note">Touch devices get an on-screen stick (left), drag to look (right) and buttons for Use, Switch, Light and Pause.</p>`,
    );
  }

  private buildCredits(): void {
    const lines = CREDITS_LINES.map(([k, v]) => `<div class="ns-credit"><div class="ns-credit__k">${k}</div><div class="ns-credit__v">${v}</div></div>`).join('');
    this.panelShell('credits', 'CREDITS', `<div class="ns-credits">${lines}</div>`);
  }

  // ---------------------------------------------------------------------------
  // Show / hide
  // ---------------------------------------------------------------------------

  show(screen: MenuScreen): void {
    const prev = this.current;
    this.current = screen;
    this.el.hidden = false;
    for (const [k, p] of Object.entries(this.panels)) p.hidden = k !== screen;
    this.el.classList.toggle('is-title', screen === 'title');
    this.el.classList.toggle('is-pause', screen === 'paused');
    this.el.classList.toggle('over-play', this.s.store.get().paused || screen === 'paused');
    this.disarm();
    if (screen === 'title') {
      const st = this.s.store.get();
      this.resumeBtn.hidden = !st.paused;
      // Prefill from the store unless the player has typed their own seed.
      if (!this.seedTouched || !this.seedInput.value) this.seedInput.value = st.seed;
      this.titleClock.textContent = formatClock12(this.s.clock.time);
    }
    if (screen === 'paused') {
      this.skipTutBtn.hidden = !this.s.ui.tutorialActive;
      this.pauseSeed.textContent = this.s.store.get().seed;
      this.pauseClock.textContent = formatClock12(this.s.clock.time);
    }
    if (screen === 'settings') this.refreshSettings();
    // Keep focus on the first button (not the seed field) so Enter starts the shift.
    const items = this.items();
    const first = items.find((i) => !(i instanceof HTMLInputElement)) ?? items[0] ?? null;
    if (prev !== screen || !this.focused || !items.includes(this.focused)) this.focus(first, false);
  }

  hide(): void {
    if (this.current === null && this.el.hidden) return;
    this.current = null;
    this.el.hidden = true;
    this.disarm();
    if (this.focused) {
      this.focused.classList.remove('is-focus');
      this.focused.blur();
      this.focused = null;
    }
  }

  get seedValue(): string {
    return this.seedInput.value.trim();
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  refreshSettings(): void {
    const sec = this.panels.settings;
    if (!sec) return;
    const settings = this.s.store.get().settings;
    for (const row of Array.from(sec.querySelectorAll<HTMLElement>('.ns-row'))) {
      const def = SETTINGS_ROWS.find((r) => r.key === row.dataset.key)!;
      const value = settings[def.key];
      if (def.kind === 'range') {
        const input = row.querySelector('input') as HTMLInputElement;
        const v = Number(value);
        if (Number(input.value) !== v) input.value = String(v);
        input.style.setProperty('--ns-range-pct', `${(((v - def.min!) / (def.max! - def.min!)) * 100).toFixed(1)}%`);
        (row.querySelector('.ns-range__val') as HTMLElement).textContent = def.format ? def.format(v) : String(v);
      } else if (def.kind === 'toggle') {
        const btn = row.querySelector('.ns-toggle') as HTMLElement;
        const on = Boolean(value);
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-checked', String(on));
        (btn.querySelector('.ns-toggle__val') as HTMLElement).textContent = on ? 'ON' : 'OFF';
      } else {
        const opts = Array.from(row.querySelectorAll<HTMLElement>('.ns-seg__opt'));
        let desc = '';
        for (const o of opts) {
          const active = o.dataset.value === String(value);
          o.classList.toggle('is-on', active);
          o.setAttribute('aria-checked', String(active));
          if (active) desc = def.options?.find((x) => x.value === o.dataset.value)?.desc ?? '';
        }
        const d = row.querySelector('.ns-row__desc');
        if (d) d.textContent = desc;
      }
    }
  }

  private writeSetting(key: keyof Settings, value: number | boolean | string): void {
    const patch: Partial<Settings> = {};
    (patch as Record<string, unknown>)[key] = value;
    this.s.store.setSettings(patch);
    this.refreshSettings();
  }

  private setSegment(row: HTMLElement, value: string): void {
    const key = row.dataset.key as keyof Settings;
    if (String(this.s.store.get().settings[key]) === value) return;
    this.writeSetting(key, key === 'difficulty' ? (value as Difficulty) : value);
    this.sfx('ui_select');
  }

  private adjust(item: HTMLElement, dir: -1 | 1): boolean {
    const row = item.closest<HTMLElement>('.ns-row');
    if (!row) return false;
    const def = SETTINGS_ROWS.find((r) => r.key === row.dataset.key)!;
    const settings = this.s.store.get().settings;
    if (def.kind === 'range') {
      const v = Number(settings[def.key]);
      const next = Math.min(def.max!, Math.max(def.min!, Math.round((v + dir * def.step!) / def.step!) * def.step!));
      if (next !== v) {
        this.writeSetting(def.key, Number(next.toFixed(3)));
        this.sfx('ui_hover');
      }
      return true;
    }
    if (def.kind === 'toggle') {
      this.writeSetting(def.key, !settings[def.key]);
      this.sfx('ui_select');
      return true;
    }
    const opts = def.options!;
    const i = opts.findIndex((o) => o.value === String(settings[def.key]));
    const n = opts[(i + dir + opts.length) % opts.length];
    this.setSegment(row, n.value);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Focus + activation
  // ---------------------------------------------------------------------------

  private items(): HTMLElement[] {
    if (!this.current) return [];
    return Array.from(this.panels[this.current].querySelectorAll<HTMLElement>('.ns-item')).filter((el) => !el.hidden && !el.closest('[hidden]'));
  }

  private focus(item: HTMLElement | null, sound: boolean): void {
    if (this.focused === item) return;
    this.focused?.classList.remove('is-focus');
    this.focused = item;
    if (!item) return;
    item.classList.add('is-focus');
    if (document.activeElement !== item) item.focus({ preventScroll: true });
    item.scrollIntoView?.({ block: 'nearest' });
    if (sound) this.sfx('ui_hover');
  }

  private move(dir: -1 | 1): void {
    const items = this.items();
    if (!items.length) return;
    const i = this.focused ? items.indexOf(this.focused) : -1;
    const next = items[(i + dir + items.length) % items.length];
    this.focus(next, true);
  }

  private activate(item: HTMLElement): void {
    const act = item.dataset.act;
    if (item.classList.contains('ns-toggle') || item.classList.contains('ns-seg')) {
      this.adjust(item, 1);
      return;
    }
    if (item instanceof HTMLInputElement) {
      if (item.type === 'text') this.startShift();
      return;
    }
    if (!act) return;
    if (item.dataset.confirm && this.armed?.el !== item) {
      this.arm(item);
      this.sfx('ui_select');
      return;
    }
    this.disarm();
    switch (act) {
      case 'new':
        this.startShift();
        break;
      case 'resume':
        this.sfx('ui_select');
        this.s.game.resume();
        break;
      case 'skiptutorial':
        this.sfx('ui_select');
        this.s.ui.skipTutorial();
        this.s.game.resume();
        break;
      case 'settings':
      case 'controls':
      case 'credits':
        this.sfx('ui_open');
        this.hooks.navigate(act);
        break;
      case 'back':
        this.sfx('ui_back');
        this.hooks.back();
        break;
      case 'restart':
        this.sfx('ui_select');
        void this.s.game.restart();
        break;
      case 'quit':
        this.sfx('ui_back');
        this.s.game.quitToTitle();
        break;
      case 'randomseed':
        this.seedInput.value = makeSeedCode((Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0);
        this.seedTouched = true;
        this.sfx('ui_hover');
        break;
      default:
        break;
    }
  }

  private startShift(): void {
    this.unlockAudio();
    this.sfx('ui_select');
    const seed = this.seedValue;
    void this.s.game.newGame(seed || undefined);
  }

  private arm(item: HTMLElement): void {
    this.disarm();
    this.armed = { el: item, label: item.textContent ?? '', t: 3.5 };
    item.textContent = item.dataset.confirm ?? 'Sure?';
    item.classList.add('is-armed');
  }

  private disarm(): void {
    if (!this.armed) return;
    this.armed.el.textContent = this.armed.label;
    this.armed.el.classList.remove('is-armed');
    this.armed = null;
  }

  private unlockAudio(): void {
    if (this.unlockedOnce) return;
    this.unlockedOnce = true;
    void this.s.audio.unlock();
  }

  private sfx(name: 'ui_hover' | 'ui_select' | 'ui_back' | 'ui_open' | 'ui_close'): void {
    this.s.audio.play(name, { nonSpatial: true, volume: name === 'ui_hover' ? 0.25 : 0.45 });
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  /** Returns true when the key was consumed (caller stops propagation to the game input). */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.current) return false;
    const inSeed = document.activeElement === this.seedInput;
    if (e.code === 'Escape') {
      if (this.current === 'title') {
        if (inSeed) {
          this.seedInput.blur();
          this.focus(this.items()[0] ?? null, false);
        }
        return true;
      }
      if (this.current === 'paused') {
        this.sfx('ui_back');
        this.s.game.resume();
        return true;
      }
      this.sfx('ui_back');
      this.hooks.back();
      return true;
    }
    this.unlockAudio();
    switch (e.code) {
      case 'ArrowUp':
        this.move(-1);
        return true;
      case 'ArrowDown':
        this.move(1);
        return true;
      case 'ArrowLeft':
      case 'ArrowRight':
        if (inSeed) return false;
        if (this.focused && this.adjust(this.focused, e.code === 'ArrowLeft' ? -1 : 1)) return true;
        return false;
      case 'Enter':
      case 'NumpadEnter':
        if (this.focused) this.activate(this.focused);
        else if (this.current === 'title') this.startShift();
        return true;
      case 'Space':
        if (inSeed) return true;
        if (this.focused) this.activate(this.focused);
        return true;
      case 'Tab':
        this.move(e.shiftKey ? -1 : 1);
        return true;
      default:
        return false;
    }
  }

  padAction(a: PadAction): void {
    if (!this.current) return;
    switch (a) {
      case 'up':
        this.move(-1);
        break;
      case 'down':
        this.move(1);
        break;
      case 'left':
      case 'right':
        if (this.focused) this.adjust(this.focused, a === 'left' ? -1 : 1);
        break;
      case 'confirm':
        if (this.focused) this.activate(this.focused);
        break;
      case 'cancel':
        if (this.current === 'paused') this.s.game.resume();
        else if (this.current !== 'title') {
          this.sfx('ui_back');
          this.hooks.back();
        }
        break;
    }
  }

  update(dt: number): void {
    if (!this.current) return;
    if (this.armed) {
      this.armed.t -= dt;
      if (this.armed.t <= 0) this.disarm();
    }
    this.clockAccum += dt;
    if (this.clockAccum > 0.5) {
      this.clockAccum = 0;
      if (this.current === 'paused') this.pauseClock.textContent = formatClock12(this.s.clock.time);
      if (this.current === 'title') this.titleClock.textContent = formatClock12(this.s.clock.time);
    }
  }

  dispose(): void {
    this.el.remove();
  }
}
