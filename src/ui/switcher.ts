/**
 * Perspective switcher — a building-security console overlay. Left: the live floor
 * plan; right: character cards plus the CCTV card. Selecting a card asks the game
 * controller to switch views. Input is polled through the InputManager (keyboard
 * and gamepad alike) so the key that closes the console is never also read by the
 * main loop as a pause / interact press.
 */
import './panels.css';
import { formatClock12 } from '../core/clock';
import type { Services, SfxName } from '../core/contracts';
import type { CharacterId, RoomDef, RoomId, ViewId } from '../core/types';
import { CHARACTER_IDS } from '../core/types';
import { FloorPlan } from './floorplan';
import { ActionPoller, PANEL_ACTIONS } from './switcher.input';
import { cctvGlyphSVG, portraitSVG } from './switcher.portraits';
import { renderRich } from './tutorial';

const ORDER: readonly ViewId[] = ['john', 'susie', 'paul', 'cctv'];
const RING_C = 2 * Math.PI * 30;
/** stop trusting UIManager-driven updates after this many ms and self-drive */
const ORPHAN_MS = 250;

interface Card {
  root: HTMLButtonElement;
  loc: HTMLElement;
  status: HTMLElement;
  hint: HTMLElement;
  flag: HTMLElement;
  ringFill: SVGCircleElement | null;
  cams: HTMLElement | null;
}

export class Switcher {
  private readonly el: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly plan: FloorPlan;
  private readonly cards: Record<ViewId, Card>;
  private readonly clockEl: HTMLElement;
  private readonly seedEl: HTMLElement;
  private readonly subEl: HTMLElement;
  private readonly rooms: Map<RoomId, RoomDef>;
  private readonly poller: ActionPoller;
  /** the first-night walkthrough's line (above the key hints) */
  private readonly tutEl: HTMLElement;

  private _open = false;
  private sel = 0;
  private skipFrame = false;
  private prevLocked = false;
  private lastUpdateAt = 0;
  private raf = 0;
  private litTimer = 0;
  private lit: Partial<Record<RoomId, number>> = {};
  private camsOnline: Record<string, boolean> = {};
  private warnLevel: Record<CharacterId, number> = { john: 0, susie: 0, paul: 0 };
  private warnFlash: Record<CharacterId, number> = { john: 0, susie: 0, paul: 0 };
  private hints: Record<CharacterId, string | null> = { john: null, susie: null, paul: null };

  constructor(private readonly s: Services, root: HTMLElement) {
    this.rooms = new Map(s.layout.rooms.map((r) => [r.id, r]));
    this.poller = new ActionPoller(s.input, PANEL_ACTIONS);

    this.el = document.createElement('div');
    this.el.className = 'ns-switcher';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Security console');
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target === this.el) this.close();
    });

    this.panel = document.createElement('div');
    this.panel.className = 'ns-switcher__panel';
    this.el.appendChild(this.panel);

    // header
    const head = document.createElement('header');
    head.className = 'ns-switcher__head';
    head.innerHTML =
      `<div class="ns-switcher__title"><span class="ns-switcher__site">ST. AUGUSTINE REGIONAL</span><span class="ns-switcher__sys">SECURITY CONSOLE · ED WING</span></div>` +
      `<div class="ns-switcher__meta"><span class="ns-switcher__clock"></span><span class="ns-switcher__seed"></span></div>`;
    this.clockEl = head.querySelector('.ns-switcher__clock') as HTMLElement;
    this.seedEl = head.querySelector('.ns-switcher__seed') as HTMLElement;
    this.panel.appendChild(head);

    // body: plan + cards
    const body = document.createElement('div');
    body.className = 'ns-switcher__body';
    const planWrap = document.createElement('div');
    planWrap.className = 'ns-switcher__plan';
    const planTitle = document.createElement('div');
    planTitle.className = 'ns-switcher__plantitle';
    planTitle.innerHTML = `<span>SITE MAP</span><span class="ns-switcher__plansub"></span>`;
    this.subEl = planTitle.querySelector('.ns-switcher__plansub') as HTMLElement;
    planWrap.appendChild(planTitle);
    const planHost = document.createElement('div');
    planHost.className = 'ns-switcher__planhost';
    planWrap.appendChild(planHost);
    this.plan = new FloorPlan(s.layout, planHost);
    this.plan.onPick((view) => this.select(view));

    const list = document.createElement('div');
    list.className = 'ns-switcher__cards';
    this.cards = {
      john: this.buildCard('john', 1, list),
      susie: this.buildCard('susie', 2, list),
      paul: this.buildCard('paul', 3, list),
      cctv: this.buildCard('cctv', 4, list),
    };
    body.append(planWrap, list);
    this.panel.appendChild(body);

    this.tutEl = document.createElement('div');
    this.tutEl.className = 'ns-switcher__tut';
    this.tutEl.hidden = true;
    this.panel.appendChild(this.tutEl);

    // footer hints
    const foot = document.createElement('footer');
    foot.className = 'ns-switcher__foot';
    foot.innerHTML = s.input.isTouch
      ? `<span>Tap a card to switch perspective · tap outside to close</span>`
      : `<span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd> select</span><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> switch</span><span><kbd>Esc</kbd> close</span>`;
    this.panel.appendChild(foot);

    root.appendChild(this.el);
  }

  // ---------------------------------------------------------------------------

  private buildCard(view: ViewId, key: number, parent: HTMLElement): Card {
    const root = document.createElement('button');
    root.type = 'button';
    root.className = `ns-card ns-card--${view}`;
    root.dataset.view = view;
    const isChar = view !== 'cctv';
    const name = isChar ? this.s.store.char(view).name : 'CCTV';
    const role = isChar ? this.s.store.char(view).role : 'Surveillance feeds';
    root.innerHTML =
      `<span class="ns-card__key">${key}</span>` +
      `<span class="ns-card__portrait">${isChar ? portraitSVG(view) : cctvGlyphSVG()}` +
      (isChar
        ? `<svg class="ns-card__ring" viewBox="0 0 64 64" aria-hidden="true"><circle class="ns-card__ringtrack" cx="32" cy="32" r="30"/><circle class="ns-card__ringfill" cx="32" cy="32" r="30" stroke-dasharray="0 ${RING_C.toFixed(1)}"/></svg>`
        : '') +
      `</span>` +
      `<span class="ns-card__body">` +
      `<span class="ns-card__name">${name}</span>` +
      `<span class="ns-card__role">${role.toUpperCase()}</span>` +
      `<span class="ns-card__loc"></span>` +
      `<span class="ns-card__status"></span>` +
      (isChar ? `<span class="ns-card__hint"></span>` : `<span class="ns-card__cams" aria-hidden="true"></span>`) +
      `</span>` +
      `<span class="ns-card__flag"></span>`;
    root.addEventListener('pointerenter', () => this.setSel(ORDER.indexOf(view), true));
    root.addEventListener('focus', () => this.setSel(ORDER.indexOf(view), false));
    root.addEventListener('click', (e) => {
      e.preventDefault();
      this.select(view);
    });
    parent.appendChild(root);
    const cams = root.querySelector('.ns-card__cams') as HTMLElement | null;
    if (cams) {
      for (const cam of this.s.layout.cameras) {
        const sq = document.createElement('i');
        sq.dataset.cam = cam.id;
        sq.title = cam.name;
        cams.appendChild(sq);
      }
    }
    return {
      root,
      loc: root.querySelector('.ns-card__loc') as HTMLElement,
      status: root.querySelector('.ns-card__status') as HTMLElement,
      hint: (root.querySelector('.ns-card__hint') as HTMLElement | null) ?? document.createElement('span'),
      flag: root.querySelector('.ns-card__flag') as HTMLElement,
      ringFill: root.querySelector('.ns-card__ringfill') as SVGCircleElement | null,
      cams,
    };
  }

  // ---------------------------------------------------------------------------

  get isOpen(): boolean {
    return this._open;
  }

  open(): void {
    if (this._open) return;
    this._open = true;
    const st = this.s.store.get();
    this.prevLocked = st.inputLocked;
    this.s.store.lockInput(true);
    try {
      this.s.input.releaseLock();
    } catch {
      /* pointer lock unavailable */
    }
    this.sel = Math.max(0, ORDER.indexOf(st.activeView));
    this.skipFrame = true;
    this.poller.reset();
    this.litTimer = 0;
    this.el.classList.add('is-open');
    this.el.classList.toggle('is-touch', this.s.input.isTouch);
    this.refresh(st);
    this.sfx('ui_open', 0.55);
    this.lastUpdateAt = performance.now();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  close(): void {
    if (!this._open) return;
    this._open = false;
    cancelAnimationFrame(this.raf);
    this.el.classList.remove('is-open');
    this.s.store.lockInput(this.prevLocked);
    const st = this.s.store.get();
    if (!this.s.input.isTouch && st.screen === 'playing' && !st.paused) {
      try {
        this.s.input.requestLock();
      } catch {
        /* unsupported */
      }
    }
    this.sfx('ui_close', 0.45);
  }

  update(dt: number): void {
    this.lastUpdateAt = performance.now();
    this.step(dt);
  }

  /** The walkthrough's line inside the console and the card it points at (null clears both). */
  setTutorialHint(text: string | null, target: ViewId | null): void {
    if (text) renderRich(this.tutEl, text);
    else this.tutEl.textContent = '';
    this.tutEl.hidden = !text;
    for (const v of ORDER) this.cards[v].root.classList.toggle('is-tut-target', v === target);
  }

  warn(id: CharacterId, level: number, hint?: string): void {
    const lvl = Math.max(0, Math.min(1, level));
    this.warnLevel[id] = Math.max(this.warnLevel[id] * 0.5, lvl);
    if (hint !== undefined) this.hints[id] = hint || null;
    else if (lvl <= 0.02) this.hints[id] = null;
    this.warnFlash[id] = lvl > 0.02 ? 2.4 : 0;
    if (this._open) this.refreshCard(id, this.s.store.get());
  }

  dispose(): void {
    this.close();
    cancelAnimationFrame(this.raf);
    this.plan.dispose();
    this.el.remove();
  }

  // ---------------------------------------------------------------------------

  /** Self-drive only when nobody has called update() recently. */
  private tick = (): void => {
    if (!this._open) return;
    this.raf = requestAnimationFrame(this.tick);
    if (performance.now() - this.lastUpdateAt > ORPHAN_MS) this.step(1 / 60);
  };

  private step(dt: number): void {
    const st = this.s.store.get();
    for (const id of CHARACTER_IDS) {
      const floor = st.characters[id].missing ? 0 : st.characters[id].danger;
      this.warnLevel[id] = Math.max(floor, this.warnLevel[id] - dt * 0.08);
      this.warnFlash[id] = Math.max(0, this.warnFlash[id] - dt);
      if (this.warnLevel[id] < 0.04 && this.warnFlash[id] <= 0 && this.hints[id]) this.hints[id] = null;
    }
    if (!this._open) return;
    if (this.skipFrame) {
      this.skipFrame = false;
      this.poller.reset();
    } else {
      this.handleInput();
      if (!this._open) return;
    }
    this.litTimer -= dt;
    if (this.litTimer <= 0) {
      this.litTimer = 0.25;
      this.sampleLighting();
    }
    this.refresh(st);
  }

  private handleInput(): void {
    const edges = this.poller.poll();
    if (edges.size === 0) return;
    if (edges.has('cancel') || edges.has('switcher')) {
      this.close();
      return;
    }
    if (edges.has('quick_john')) return this.select('john');
    if (edges.has('quick_susie')) return this.select('susie');
    if (edges.has('quick_paul')) return this.select('paul');
    if (edges.has('quick_cctv')) return this.select('cctv');
    if (edges.has('confirm')) return this.select(ORDER[this.sel]);
    let delta = 0;
    if (edges.has('forward') || edges.has('left')) delta -= 1;
    if (edges.has('back') || edges.has('right')) delta += 1;
    if (delta) this.setSel((this.sel + delta + ORDER.length) % ORDER.length, true);
  }

  private setSel(i: number, sound: boolean): void {
    if (i < 0 || i === this.sel) return;
    this.sel = i;
    if (sound) this.sfx('ui_hover', 0.25);
    this.applySelection();
  }

  private applySelection(): void {
    ORDER.forEach((v, i) => this.cards[v].root.classList.toggle('is-selected', i === this.sel));
    this.plan.setSelection(ORDER[this.sel]);
  }

  private select(view: ViewId): void {
    const st = this.s.store.get();
    if (view !== 'cctv' && st.characters[view].missing) {
      this.sfx('ui_back', 0.4);
      const card = this.cards[view].root;
      card.classList.remove('is-denied');
      void card.offsetWidth; // restart the CSS flash
      card.classList.add('is-denied');
      return;
    }
    this.sfx('ui_select', 0.5);
    this.close();
    if (view === st.activeView && view !== 'cctv') return;
    try {
      void this.s.game.switchView(view);
    } catch (err) {
      console.error('[switcher] switchView failed', err);
    }
  }

  // ---------------------------------------------------------------------------

  private sampleLighting(): void {
    const lighting = this.s.lighting;
    for (const def of this.s.layout.rooms) {
      const b = def.bounds;
      let v: number | undefined;
      try {
        v = lighting.brightnessAt({ x: (b.x0 + b.x1) / 2, y: 1.5, z: (b.z0 + b.z1) / 2 });
      } catch {
        v = undefined;
      }
      this.lit[def.id] = typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : def.lit ? 0.85 : 0.1;
    }
    for (const cam of this.s.layout.cameras) {
      let on = true;
      try {
        on = this.s.cctv.isOnline(cam.id);
      } catch {
        on = true;
      }
      this.camsOnline[cam.id] = on;
    }
  }

  private refresh(st: Readonly<import('../core/types').GameState>): void {
    this.clockEl.textContent = formatClock12(st.time);
    this.seedEl.textContent = `NIGHT SEED ${st.seed}`;
    const power = st.power === 'normal' ? 'MAINS' : st.power === 'unstable' ? 'MAINS · UNSTABLE' : st.power === 'blackout' ? 'NO POWER' : 'GENERATOR';
    this.subEl.textContent = power;
    this.subEl.classList.toggle('is-alert', st.power !== 'normal');
    for (const id of CHARACTER_IDS) this.refreshCard(id, st);
    this.refreshCCTVCard(st);
    this.applySelection();
    const doorLocked: Record<string, boolean> = {};
    for (const d of this.s.layout.doors) {
      const h = this.s.world.getDoor(d.id);
      if (h) doorLocked[d.id] = h.locked;
    }
    this.plan.update(st, { camerasOnline: this.camsOnline, litRooms: this.lit, warnings: this.warnLevel, doorLocked });
  }

  private refreshCard(id: CharacterId, st: Readonly<import('../core/types').GameState>): void {
    const c = st.characters[id];
    const card = this.cards[id];
    const room = this.rooms.get(c.location);
    card.loc.textContent = c.missing ? 'Last seen — ' + (room?.name ?? c.location) : room?.name ?? c.location;
    card.status.textContent = c.status;
    const level = c.missing ? 1 : Math.max(c.danger, this.warnLevel[id]);
    card.root.classList.toggle('is-missing', c.missing);
    card.root.classList.toggle('is-current', st.activeView === id);
    card.root.classList.toggle('is-warn', !c.missing && level > 0.18);
    card.root.classList.toggle('is-critical', !c.missing && level > 0.6);
    card.root.classList.toggle('is-flash', this.warnFlash[id] > 0);
    card.root.disabled = c.missing;
    card.root.style.setProperty('--pulse', `${(1.9 - 1.4 * Math.min(1, level)).toFixed(2)}s`);
    if (card.ringFill) card.ringFill.setAttribute('stroke-dasharray', `${(RING_C * Math.min(1, level)).toFixed(1)} ${RING_C.toFixed(1)}`);
    card.flag.textContent = c.missing ? 'UNREACHABLE' : st.activeView === id ? 'CURRENT' : '';
    const hint = c.missing ? 'No response on radio or phone.' : this.hints[id] ?? '';
    card.hint.textContent = hint;
    card.hint.classList.toggle('is-empty', !hint);
  }

  private refreshCCTVCard(st: Readonly<import('../core/types').GameState>): void {
    const card = this.cards.cctv;
    const total = this.s.layout.cameras.length;
    const online = this.s.layout.cameras.filter((c) => this.camsOnline[c.id] !== false).length;
    card.loc.textContent = `${online} of ${total} cameras online`;
    const current = st.activeView === 'cctv' && st.activeCamera ? this.s.layout.cameras.find((c) => c.id === st.activeCamera) : null;
    card.status.textContent = current ? `Viewing ${current.name}` : online === 0 ? 'All feeds down' : st.power === 'blackout' ? 'Monitors dark' : 'Monitor room feeds';
    card.root.classList.toggle('is-current', st.activeView === 'cctv');
    card.root.classList.toggle('is-warn', online < total);
    card.root.classList.toggle('is-critical', online === 0);
    card.flag.textContent = st.activeView === 'cctv' ? 'CURRENT' : '';
    if (card.cams) {
      for (const sq of Array.from(card.cams.children) as HTMLElement[]) {
        const on = this.camsOnline[sq.dataset.cam ?? ''] !== false;
        sq.classList.toggle('is-off', !on);
        sq.classList.toggle('is-active', st.activeCamera === sq.dataset.cam && st.activeView === 'cctv');
      }
    }
  }

  private sfx(name: SfxName, volume: number): void {
    try {
      this.s.audio.play(name, { nonSpatial: true, volume });
    } catch {
      /* audio not ready */
    }
  }
}
