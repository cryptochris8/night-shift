/**
 * First-night walkthrough — the card on screen. Reads one snapshot of the game per frame, feeds it to
 * TutorialFlow (tutorial.flow.ts, the pure logic) and draws whatever card the flow wants up: a step of
 * the walkthrough or a first-time tip. Runs when the Tutorial setting is on; finishing or skipping the
 * walkthrough switches the setting off, so later nights start without it (Settings brings it back).
 */
import './tutorial.css';
import * as THREE from 'three';
import type { Services } from '../core/contracts';
import type { CharacterId, Settings, ViewId } from '../core/types';
import { TutorialFlow, VENDING_IDS, deviceOf, directionWords, tokenize, type CardContext, type CardModel } from './tutorial.flow';

export interface TutorialHooks {
  /** a perspective console, document, choice or menu is open */
  modalOpen(): boolean;
  switcherOpen(): boolean;
  /** HUD shown (false in screenshot mode) */
  hudVisible(): boolean;
  /** Show a line inside the open perspective console and ring one of its cards (null clears). */
  switcherHint(text: string | null, target: ViewId | null): void;
}

/** Fill an element with text, turning `{E}` tokens into key caps. */
export function renderRich(el: HTMLElement, text: string): void {
  el.textContent = '';
  for (const part of tokenize(text)) {
    if (part.key) {
      const k = document.createElement('span');
      k.className = 'ns-key';
      k.textContent = part.text;
      el.appendChild(k);
    } else {
      el.appendChild(document.createTextNode(part.text));
    }
  }
}

const PAD_LOOK_GAIN = 700;
const SWAP_SECONDS = 0.22;

export class Tutorial {
  readonly flow: TutorialFlow;
  private readonly el: HTMLElement;
  private readonly kickerEl: HTMLElement;
  private readonly progressEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly checksEl: HTMLElement;
  private readonly linesEl: HTMLElement;
  private readonly timerEl: HTMLElement;
  private readonly footEl: HTMLElement;
  private readonly vending: { x: number; z: number }[];
  private readonly camPos = new THREE.Vector3();
  private readonly camDir = new THREE.Vector3();
  private lastPos: { x: number; z: number } | null = null;
  private lastView: ViewId | null = null;
  private shownKey: string | null = null;
  private shownSig = '';
  private pending: CardModel | null = null;
  private swapT = 0;
  private visible = false;
  private hintSig = '';
  private writingSetting = false;
  private readonly offs: (() => void)[] = [];

  constructor(
    private readonly s: Services,
    layer: HTMLElement,
    private readonly hooks: TutorialHooks,
  ) {
    this.flow = new TutorialFlow({
      onFinished: () => this.writeSetting(false),
      onTick: () => this.sfx(),
    });
    this.vending = s.layout.props.filter((p) => p.type === 'vending' && p.interactable).map((p) => ({ x: p.pos.x, z: p.pos.z }));

    const el = document.createElement('div');
    el.className = 'ns-tut';
    el.setAttribute('role', 'status');
    el.innerHTML =
      '<div class="ns-tut__head"><span class="ns-tut__kicker"></span><span class="ns-tut__progress"></span></div>' +
      '<div class="ns-tut__title"></div>' +
      '<ul class="ns-tut__checks"></ul>' +
      '<div class="ns-tut__lines"></div>' +
      '<div class="ns-tut__timer"><i></i></div>' +
      '<div class="ns-tut__foot"></div>';
    layer.appendChild(el);
    this.el = el;
    const q = (sel: string): HTMLElement => el.querySelector(sel) as HTMLElement;
    this.kickerEl = q('.ns-tut__kicker');
    this.progressEl = q('.ns-tut__progress');
    this.titleEl = q('.ns-tut__title');
    this.checksEl = q('.ns-tut__checks');
    this.linesEl = q('.ns-tut__lines');
    this.timerEl = q('.ns-tut__timer');
    this.footEl = q('.ns-tut__foot');

    const bus = s.bus;
    this.offs.push(
      bus.on('interact:used', ({ id, by }) => this.flow.onInteract(id, by)),
      bus.on('view:change', ({ view, prev }) => this.flow.onView(view, prev)),
      bus.on('game:new', () => this.flow.reset()),
      bus.on('settings:change', ({ settings }) => this.onSettings(settings)),
    );
  }

  /** Control has just been handed to John: run the walkthrough if the setting asks for it. */
  start(): void {
    this.lastPos = null;
    this.lastView = null;
    if (this.s.store.get().settings.tutorial) this.flow.start();
    else this.flow.reset();
  }

  skip(): void {
    this.flow.skip();
    this.render(null);
    this.setHint(null);
  }

  /** A warning ring went up for someone. */
  onWarn(id: CharacterId, level: number): void {
    this.flow.onWarn(id, level, this.s.store.get().activeView);
  }

  get active(): boolean {
    return this.flow.running;
  }

  get clockCap(): number | null {
    return this.flow.clockCap();
  }

  update(dt: number): void {
    if (!this.flow.armed) {
      if (this.visible) this.render(null);
      this.setHint(null);
      return;
    }
    const s = this.s;
    const st = s.store.get();
    const view = st.activeView;
    const playing = st.screen === 'playing' && !st.paused && !s.cinematic.playing;
    const modal = this.hooks.modalOpen();
    const input = s.input;

    // where the possessed body is and which way it faces
    let walked = 0;
    let facing: { x: number; z: number } | null = null;
    if (view !== 'cctv' && !s.cinematic.playing) {
      const cam = s.characters.camera;
      cam.getWorldPosition(this.camPos);
      cam.getWorldDirection(this.camDir);
      const pos = { x: this.camPos.x, z: this.camPos.z };
      if (this.lastPos && this.lastView === view) walked = Math.hypot(pos.x - this.lastPos.x, pos.z - this.lastPos.z);
      this.lastPos = pos;
      const len = Math.hypot(this.camDir.x, this.camDir.z);
      if (len > 1e-4) facing = { x: this.camDir.x / len, z: this.camDir.z / len };
    } else {
      this.lastPos = null;
    }
    this.lastView = view;

    const locked = st.inputLocked;
    const look = locked ? 0 : Math.abs(input.look.dx) + Math.abs(input.look.dy) + (Math.abs(input.padLook.x) + Math.abs(input.padLook.y)) * dt * PAD_LOOK_GAIN;
    const mv = locked ? { x: 0, y: 0 } : input.moveAxis();
    this.flow.update({ dt, playing, modal, view, look, move: Math.hypot(mv.x, mv.y), walked, clock: s.clock.time });

    const device = deviceOf(input.isTouch, input.lastDeviceWasGamepad);
    // the console's own line while the walkthrough asks for a switch
    this.setHint(playing && this.hooks.switcherOpen() ? this.flow.switcherHint(device) : null);

    if (!playing || modal || !this.hooks.hudVisible()) {
      this.render(null);
      return;
    }
    const ctx: CardContext = {
      device,
      pointerLocked: input.pointerLocked,
      view,
      vendingDir: this.vendingDirection(facing),
      targetingVending: this.targetingVending(),
    };
    this.render(this.flow.card(ctx), dt);
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.el.remove();
  }

  // ---------------------------------------------------------------------------

  private vendingDirection(facing: { x: number; z: number } | null): string | null {
    if (!facing || !this.lastPos || this.vending.length === 0) return null;
    const p = this.lastPos;
    let best = this.vending[0];
    let bestD = Infinity;
    for (const v of this.vending) {
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    // close enough to see the prompt: no need for directions
    if (bestD < 1.6) return null;
    return directionWords(facing.x, facing.z, best.x - p.x, best.z - p.z);
  }

  /** The perspective console's tutorial line (only touched when it changes). */
  private setHint(hint: { text: string; target: ViewId } | null): void {
    const sig = hint ? `${hint.target}|${hint.text}` : '';
    if (sig === this.hintSig) return;
    this.hintSig = sig;
    this.hooks.switcherHint(hint?.text ?? null, hint?.target ?? null);
  }

  private targetingVending(): boolean {
    try {
      const id = this.s.interact.current()?.id;
      return id !== undefined && VENDING_IDS.includes(id);
    } catch {
      return false;
    }
  }

  private render(card: CardModel | null, dt = 0): void {
    if (!card) {
      if (this.visible) {
        this.visible = false;
        this.el.classList.remove('is-in');
      }
      this.pending = null;
      return;
    }
    if (!this.visible) {
      // appearing: draw straight away, then fade in
      this.visible = true;
      this.fill(card);
      this.el.classList.remove('is-swapping');
      this.el.classList.add('is-in');
      this.swapT = 0;
      this.pending = null;
      return;
    }
    if (card.key !== this.shownKey) {
      // a different card: fade the old one out, then draw the new one
      if (!this.pending) {
        this.swapT = SWAP_SECONDS;
        this.el.classList.add('is-swapping');
      }
      this.pending = card;
      this.swapT -= dt;
      if (this.swapT <= 0) {
        this.fill(card);
        this.pending = null;
        this.el.classList.remove('is-swapping');
      }
      return;
    }
    if (this.pending) {
      // the card came back before the swap finished
      this.pending = null;
      this.el.classList.remove('is-swapping');
    }
    this.fill(card);
  }

  private fill(card: CardModel): void {
    const timer = card.timer === null ? -1 : Math.round(card.timer * 200) / 200;
    const sig = JSON.stringify([card.key, card.title, card.lines, card.checks, card.done, card.footer, card.progress, card.kicker, timer < 0]);
    if (timer >= 0) (this.timerEl.firstElementChild as HTMLElement).style.transform = `scaleX(${timer})`;
    if (sig === this.shownSig) return;
    this.shownSig = sig;
    this.shownKey = card.key;
    this.el.dataset.kind = card.kind;
    this.el.dataset.key = card.key;
    this.el.classList.toggle('is-done', card.done);
    this.kickerEl.textContent = card.kicker;
    this.progressEl.textContent = card.progress ?? '';
    this.titleEl.textContent = card.title;

    this.checksEl.textContent = '';
    for (const c of card.checks) {
      const li = document.createElement('li');
      li.className = c.done ? 'is-done' : '';
      renderRich(li, c.label);
      this.checksEl.appendChild(li);
    }
    this.checksEl.hidden = card.checks.length === 0;

    this.linesEl.textContent = '';
    for (const line of card.lines) {
      const p = document.createElement('p');
      renderRich(p, line);
      this.linesEl.appendChild(p);
    }
    this.timerEl.hidden = timer < 0;
    this.footEl.textContent = card.footer ?? '';
    this.footEl.hidden = !card.footer;
  }

  private onSettings(settings: Settings): void {
    // the player switched it off mid-night (not our own write at the end of the walkthrough)
    if (!settings.tutorial && !this.writingSetting && this.flow.armed) {
      this.flow.reset();
      this.render(null);
      this.setHint(null);
    }
  }

  private writeSetting(on: boolean): void {
    if (this.s.store.get().settings.tutorial === on) return;
    this.writingSetting = true;
    try {
      this.s.store.setSettings({ tutorial: on });
    } finally {
      this.writingSetting = false;
    }
  }

  private sfx(): void {
    try {
      this.s.audio.play('ui_select', { nonSpatial: true, volume: 0.3 });
    } catch {
      /* audio not ready */
    }
  }
}
