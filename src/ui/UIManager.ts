/**
 * UI façade for the whole game: composes the HUD, overlays, menu screens, ending screen,
 * touch controls, the perspective switcher and the document viewer, and owns the rules
 * about modals (pointer lock / input lock) so no other module has to think about them.
 */
import './ui.css';
import type { Services, DialogueOption, DocumentView, HudState, IUIManager } from '../core/contracts';
import type { CharacterId, Clue, EndingId, Screen, ViewId } from '../core/types';
import { Hud } from './hud';
import { Captions, CCTVOverlay, Subtitles, Toasts } from './UIManager.overlays';
import { Screens, type MenuScreen, type PadAction } from './screens';
import { EndingScreen } from './UIManager.ending';
import { TouchControls } from './touch';
import { Switcher } from './switcher';
import { Documents } from './documents';
import { Tutorial } from './tutorial';

interface SwitcherLike {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  update(dt: number): void;
  warn(id: CharacterId, level: number, hint?: string): void;
  setTutorialHint(text: string | null, target: ViewId | null): void;
  dispose(): void;
}

interface DocumentsLike {
  show(doc: DocumentView): Promise<string | null>;
  choice(prompt: string, options: DialogueOption[], opts?: { speaker?: string; timeoutSeconds?: number; defaultId?: string }): Promise<string>;
  readonly open: boolean;
  close(): void;
  dispose(): void;
}

const MENU_SCREENS: readonly Screen[] = ['title', 'paused', 'settings', 'controls', 'credits'];

export class UIManager implements IUIManager {
  private s!: Services;
  private root!: HTMLElement;
  private rootTop!: HTMLElement;
  private hud!: Hud;
  private subtitles!: Subtitles;
  private captions!: Captions;
  private toasts!: Toasts;
  private cctv!: CCTVOverlay;
  private screens!: Screens;
  private ending!: EndingScreen;
  private touch!: TouchControls;
  private switcher!: SwitcherLike;
  private documents!: DocumentsLike;
  private tutorial!: Tutorial;
  private tutLayer!: HTMLElement;

  private screen: Screen = 'boot';
  private hudVisible = true;
  private touchWanted = false;
  private modalWas = false;
  private lockedByModal = false;
  private viewSwitching = false;
  private stickNavHeld = false;
  private unsubs: (() => void)[] = [];
  private lastSubtitle = { text: '', at: 0 };

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  init(services: Services): void {
    this.s = services;
    const uiRoot = services.three.uiRoot;

    // Lower layer: HUD + overlays. Upper layer: menus + ending (always above switcher/documents).
    this.root = document.createElement('div');
    this.root.className = 'ns-root';
    this.root.setAttribute('aria-live', 'off'); // the clock ticks every second; #ui is polite-live
    uiRoot.appendChild(this.root);

    const letterbox = document.createElement('div');
    letterbox.className = 'ns-letterbox';
    letterbox.innerHTML = '<i></i><i></i>';
    this.root.appendChild(letterbox);

    this.hud = new Hud(services, this.root);
    this.cctv = new CCTVOverlay(services, this.root);
    this.touch = new TouchControls(services, this.root);
    this.toasts = new Toasts(this.root);
    this.subtitles = new Subtitles(services, this.root);
    this.captions = new Captions(this.root);

    this.switcher = new Switcher(services, uiRoot);
    this.documents = new Documents(services, uiRoot);

    // the walkthrough card sits above the perspective console (it points into it) and below the menus
    this.tutLayer = document.createElement('div');
    this.tutLayer.className = 'ns-root ns-root--tut';
    uiRoot.appendChild(this.tutLayer);
    this.tutorial = new Tutorial(services, this.tutLayer, {
      modalOpen: () => this.modalOpen,
      switcherOpen: () => this.switcher.isOpen,
      hudVisible: () => this.hudVisible,
      switcherHint: (text, target) => this.switcher.setTutorialHint(text, target),
    });

    this.rootTop = document.createElement('div');
    this.rootTop.className = 'ns-root ns-root--top';
    uiRoot.appendChild(this.rootTop);
    this.screens = new Screens(services, this.rootTop, {
      navigate: (screen) => this.navigate(screen),
      back: () => this.navigate(this.s.store.get().paused ? 'paused' : 'title'),
    });
    this.ending = new EndingScreen(services, this.rootTop);

    this.applySettingsClasses();
    const bus = services.bus;
    this.unsubs.push(
      bus.on('screen:change', ({ screen }) => this.showScreen(screen)),
      bus.on('subtitle', ({ text, speaker, seconds }) => {
        const now = performance.now();
        if (text === this.lastSubtitle.text && now - this.lastSubtitle.at < 150) return;
        this.subtitle(text, seconds, speaker);
      }),
      bus.on('settings:change', () => this.applySettingsClasses()),
      bus.on('view:switching', () => {
        this.viewSwitching = true;
        this.hud.wake();
      }),
      bus.on('view:change', () => {
        this.viewSwitching = false;
        this.hud.wake();
      }),
      bus.on('pause', ({ paused }) => {
        if (paused && this.switcher.isOpen) this.switcher.close();
      }),
      bus.on('character:missing', ({ id }) => this.hud.warn(id, 1, 'UNACCOUNTED')),
    );

    window.addEventListener('keydown', this.onKeyDown, { capture: true });
    window.addEventListener('pointerdown', this.onActivity, { passive: true });
    window.addEventListener('pointermove', this.onActivity, { passive: true });

    // main sets the store to 'title' after init; mirror whatever it already is.
    this.showScreen(services.store.get().screen);
  }

  update(dt: number): void {
    const st = this.s.store.get();
    const input = this.s.input;

    // Activity for the HUD idle fade
    const look = input.look.dx !== 0 || input.look.dy !== 0 || input.padLook.x !== 0 || input.padLook.y !== 0;
    const mv = input.moveAxis();
    const active = look || mv.x !== 0 || mv.y !== 0;

    if (this.screen === 'playing' || this.screen === 'paused') this.hud.update(dt, active);
    this.subtitles.update(dt);
    this.captions.update(dt);
    this.toasts.update(dt);
    this.cctv.update(dt);
    this.screens.update(dt);
    this.ending.update(dt);
    this.switcher.update(dt);
    this.tutorial.update(dt);
    this.touch.update();
    this.touch.setPromptAvailable(this.hud.hasPrompt && st.activeView !== 'cctv');

    // Gamepad navigation in menus (keyboard arrives through the capture handler instead)
    if (input.lastDeviceWasGamepad && (this.screens.current || this.ending.isActive)) {
      const dispatch = (pad: PadAction): void => {
        if (this.ending.isActive) this.ending.padAction(pad);
        else this.screens.padAction(pad);
      };
      const map: [Parameters<typeof input.pressed>[0], PadAction][] = [
        ['forward', 'up'],
        ['back', 'down'],
        ['left', 'left'],
        ['right', 'right'],
        ['confirm', 'confirm'],
        ['cancel', 'cancel'],
      ];
      for (const [action, pad] of map) {
        if (!input.pressed(action)) continue;
        dispatch(pad);
        break;
      }
      // Left stick as a d-pad with edge detection
      const sx = input.padMove.x;
      const sy = input.padMove.y;
      if (Math.abs(sy) > 0.6 && Math.abs(sy) >= Math.abs(sx)) {
        if (!this.stickNavHeld) dispatch(sy > 0 ? 'up' : 'down');
        this.stickNavHeld = true;
      } else if (Math.abs(sx) > 0.6) {
        if (!this.stickNavHeld) dispatch(sx > 0 ? 'right' : 'left');
        this.stickNavHeld = true;
      } else if (Math.abs(sx) < 0.35 && Math.abs(sy) < 0.35) {
        this.stickNavHeld = false;
      }
    }

    // Modal reconciliation: switcher/documents may open or close on their own.
    const modalNow = this.switcher.isOpen || this.documents.open;
    if (modalNow !== this.modalWas) {
      this.modalWas = modalNow;
      if (modalNow) this.onModalOpen();
      else this.onModalClose();
    }
    this.root.classList.toggle('has-modal', modalNow);
    this.applyTouchVisibility();
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    window.removeEventListener('keydown', this.onKeyDown, { capture: true });
    window.removeEventListener('pointerdown', this.onActivity);
    window.removeEventListener('pointermove', this.onActivity);
    this.hud.dispose();
    this.subtitles.dispose();
    this.captions.dispose();
    this.toasts.dispose();
    this.cctv.dispose();
    this.screens.dispose();
    this.ending.dispose();
    this.touch.dispose();
    this.switcher.dispose();
    this.documents.dispose();
    this.tutorial.dispose();
    this.root.remove();
    this.tutLayer.remove();
    this.rootTop.remove();
  }

  // ---------------------------------------------------------------------------
  // Screens
  // ---------------------------------------------------------------------------

  showScreen(screen: Screen): void {
    const prev = this.screen;
    this.screen = screen;
    for (const c of Array.from(this.root.classList)) if (c.startsWith('screen-')) this.root.classList.remove(c);
    this.root.classList.add(`screen-${screen}`);
    this.rootTop.className = `ns-root ns-root--top screen-${screen}`;

    if (MENU_SCREENS.includes(screen)) {
      if (screen === 'title' && prev !== 'title') {
        if (this.switcher.isOpen) this.switcher.close();
        if (this.documents.open) this.documents.close();
        this.hud.setPrompt(null);
      }
      this.screens.show(screen as MenuScreen);
      this.s.input.releaseLock();
    } else {
      this.screens.hide();
    }
    if (screen !== 'ending') this.ending.hide();

    const hudOn = this.hudVisible && (screen === 'playing' || screen === 'paused');
    this.hud.setVisible(hudOn);
    this.cctv.setHudVisible(this.hudVisible && screen !== 'title' && screen !== 'ending' && screen !== 'boot');
    this.toasts.el.hidden = !this.hudVisible || screen === 'title' || screen === 'boot';
    if (screen === 'playing') this.hud.wake();
    this.applyTouchVisibility();
  }

  private navigate(screen: Screen): void {
    this.s.store.setScreen(screen);
    this.showScreen(screen);
  }

  // ---------------------------------------------------------------------------
  // HUD + overlays
  // ---------------------------------------------------------------------------

  setHud(patch: Partial<HudState>): void {
    this.hud.setState(patch);
  }

  setPrompt(text: string | null): void {
    this.hud.setPrompt(text);
  }

  setObjective(text: string | null): void {
    this.hud.setObjective(text);
  }

  subtitle(text: string, seconds?: number, speaker?: string): void {
    this.lastSubtitle = { text, at: performance.now() };
    this.subtitles.show(text, seconds, speaker);
  }

  caption(text: string, seconds: number, opts?: { sub?: string; style?: 'title' | 'time' | 'card' }): Promise<void> {
    return this.captions.show(text, seconds, opts);
  }

  toast(text: string, seconds?: number): void {
    this.toasts.show(text, seconds);
  }

  warn(character: CharacterId, level: number, hint?: string): void {
    this.hud.warn(character, level, hint);
    this.switcher.warn(character, level, hint);
    this.tutorial.onWarn(character, level);
  }

  startTutorial(): void {
    this.tutorial.start();
  }

  skipTutorial(): void {
    this.tutorial.skip();
  }

  get tutorialActive(): boolean {
    return this.tutorial.active;
  }

  get tutorialClockCap(): number | null {
    return this.tutorial.clockCap;
  }

  setCCTVOverlay(p: { visible: boolean; cameras?: { id: string; name: string; online: boolean; active: boolean }[]; timestamp?: string; label?: string; online?: boolean }): void {
    this.cctv.set(p);
  }

  setHudVisible(visible: boolean): void {
    this.hudVisible = visible;
    this.hud.setVisible(visible && (this.screen === 'playing' || this.screen === 'paused'));
    this.cctv.setHudVisible(visible && this.screen !== 'title' && this.screen !== 'ending' && this.screen !== 'boot');
    this.toasts.el.hidden = !visible || this.screen === 'title' || this.screen === 'boot';
    this.applyTouchVisibility();
  }

  setTouchControls(visible: boolean): void {
    this.touchWanted = visible;
    this.applyTouchVisibility();
  }

  private applyTouchVisibility(): void {
    const want = (this.touchWanted || this.s.input.isTouch) && this.screen === 'playing' && this.hudVisible && !this.modalWas && !this.s.cinematic.playing;
    this.touch.setVisible(want);
  }

  // ---------------------------------------------------------------------------
  // Modals
  // ---------------------------------------------------------------------------

  async showDocument(doc: DocumentView): Promise<string | null> {
    this.s.audio.play('ui_open', { nonSpatial: true, volume: 0.4 });
    this.hud.setPrompt(null);
    try {
      return await this.documents.show(doc);
    } finally {
      this.s.audio.play('ui_close', { nonSpatial: true, volume: 0.35 });
      this.reconcileModal();
    }
  }

  async showChoice(prompt: string, options: DialogueOption[], opts?: { speaker?: string; timeoutSeconds?: number; defaultId?: string }): Promise<string> {
    try {
      return await this.documents.choice(prompt, options, opts);
    } finally {
      this.reconcileModal();
    }
  }

  openSwitcher(): void {
    const st = this.s.store.get();
    if (this.screen !== 'playing' || st.paused || this.switcher.isOpen || this.documents.open || this.s.cinematic.playing) return;
    this.switcher.open();
    this.s.audio.play('ui_open', { nonSpatial: true, volume: 0.45 });
    this.reconcileModal();
  }

  closeSwitcher(): void {
    if (!this.switcher.isOpen) return;
    this.switcher.close();
    this.s.audio.play('ui_close', { nonSpatial: true, volume: 0.4 });
    this.reconcileModal();
  }

  get switcherOpen(): boolean {
    return this.switcher.isOpen;
  }

  get modalOpen(): boolean {
    return this.switcher.isOpen || this.documents.open || this.screens.current !== null || this.ending.isActive;
  }

  private reconcileModal(): void {
    const modalNow = this.switcher.isOpen || this.documents.open;
    if (modalNow === this.modalWas) return;
    this.modalWas = modalNow;
    if (modalNow) this.onModalOpen();
    else this.onModalClose();
    this.applyTouchVisibility();
  }

  private onModalOpen(): void {
    const store = this.s.store;
    this.s.input.releaseLock();
    if (!store.get().inputLocked) {
      store.lockInput(true);
      this.lockedByModal = true;
    }
    this.hud.wake();
  }

  private onModalClose(): void {
    const store = this.s.store;
    const st = store.get();
    if (this.lockedByModal) {
      this.lockedByModal = false;
      // During a perspective switch main owns the lock and releases it when the transition ends.
      if (!this.viewSwitching && !this.s.cinematic.playing) store.lockInput(false);
    }
    if (st.screen === 'playing' && !st.paused && !this.s.input.isTouch && !this.s.cinematic.playing) {
      this.s.input.requestLock();
    }
  }

  // ---------------------------------------------------------------------------
  // Ending
  // ---------------------------------------------------------------------------

  async showEnding(
    ending: EndingId,
    summary: { seed: string; clues: Clue[]; choices: { label: string; value: string }[]; missing: CharacterId[]; lines: string[] },
  ): Promise<'new_night' | 'title'> {
    if (this.screen !== 'ending') this.showScreen('ending');
    if (this.switcher.isOpen) this.switcher.close();
    if (this.documents.open) this.documents.close();
    this.s.input.releaseLock();
    return this.ending.show(ending, summary);
  }

  // ---------------------------------------------------------------------------
  // Input hooks
  // ---------------------------------------------------------------------------

  private onKeyDown = (e: KeyboardEvent): void => {
    this.hud.wake();
    let consumed = false;
    if (this.ending.isActive) consumed = this.ending.handleKey(e);
    else if (this.screens.current) consumed = this.screens.handleKey(e);
    if (consumed) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };

  private onActivity = (): void => {
    this.hud.wake();
  };

  private applySettingsClasses(): void {
    const settings = this.s.store.get().settings;
    const reduced = settings.reducedFlicker || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.root.classList.toggle('reduced-flicker', reduced);
    this.rootTop.classList.toggle('reduced-flicker', reduced);
  }
}
