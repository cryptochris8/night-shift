/**
 * NIGHT SHIFT — bootstrap, game controller and main loop.
 * Wires every subsystem together through the Services bag (see core/contracts.ts).
 */
import * as THREE from 'three';
import { GameClock } from './core/clock';
import type { IGameController, Services, TransitionKind } from './core/contracts';
import { InputManager } from './core/input';
import { RNG, makeSeedCode, normalizeSeedCode, scenarioForSeed } from './core/rng';
import { EventBus, Store, loadSettings, makeInitialState } from './core/state';
import { phaseForTime, type EndingId, type Settings, type ViewId } from './core/types';
import { LAYOUT } from './world/layout';
import { buildOpenings, visibleRooms } from './world/visibility';
import { WorldBuilder } from './world/WorldBuilder';
import { LightingSystem } from './render/Lighting';
import { PostFX } from './render/PostFX';
import { CinematicSystem } from './render/Cinematic';
import { AudioEngine } from './audio/AudioEngine';
import { CharacterSystem } from './characters/CharacterSystem';
import { InteractionSystem } from './interact/InteractionSystem';
import { CCTVSystem } from './cctv/CCTVSystem';
import { UIManager } from './ui/UIManager';
import { EventDirector } from './events/Director';

declare global {
  interface Window {
    __NS?: {
      services: Services;
      state: () => Readonly<import('./core/types').GameState>;
      setTime: (minutes: number) => void;
      fire: (id: string) => Promise<void>;
      switchView: (view: ViewId, cameraId?: string) => Promise<void>;
      screenshotMode: (on: boolean) => void;
      newGame: (seed?: string) => Promise<void>;
      skipIntro: () => void;
      ready: boolean;
    };
  }
}

const MAX_DT = 0.1;

function readHash(): { seed?: string; auto?: boolean; debug?: boolean } {
  const h = location.hash.replace(/^#/, '');
  if (!h) return {};
  const params = new URLSearchParams(h);
  return {
    seed: params.get('seed') ?? undefined,
    auto: params.get('auto') === '1',
    debug: params.get('debug') === '1',
  };
}

class Game implements IGameController {
  readonly services: Services;
  private running = false;
  private last = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private lowFpsSeconds = 0;
  private qualityLevel: 'low' | 'medium' | 'high' = 'high';
  private screenshotMode = false;
  private switching = false;
  private debugEl: HTMLDivElement | null = null;
  private readonly openings = buildOpenings(LAYOUT.rooms, LAYOUT.doors);
  private readonly camWorld = new THREE.Vector3();
  private readonly doorSeenOpen = new Map<string, number>();
  private debugAccum = 0;

  constructor() {
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    const uiRoot = document.getElementById('ui') as HTMLElement;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      alpha: false,
      preserveDrawingBuffer: true, // screenshots
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    // r186 removed PCFSoftShadowMap; its late fallback leaves early-compiled materials with the wrong sampler type
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight, false);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020304);

    const bus = new EventBus();
    const hash = readHash();
    const seed = hash.seed ? normalizeSeedCode(hash.seed) : makeSeedCode(Date.now());
    const store = new Store(bus, makeInitialState(seed, scenarioForSeed(seed), loadSettings()));
    const clock = new GameClock();
    const input = new InputManager(canvas);

    const characters = new CharacterSystem();
    const cinematic = new CinematicSystem();

    this.services = {
      store,
      bus,
      clock,
      rng: new RNG(seed),
      layout: LAYOUT,
      input,
      three: { renderer, scene, camera: characters.camera, canvas, uiRoot },
      world: new WorldBuilder(),
      lighting: new LightingSystem(),
      postfx: new PostFX(),
      audio: new AudioEngine(),
      characters,
      interact: new InteractionSystem(),
      cctv: new CCTVSystem(),
      ui: new UIManager(),
      director: new EventDirector(),
      cinematic,
      game: this,
    };
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  async init(): Promise<void> {
    const s = this.services;
    const order = [
      s.world,
      s.lighting,
      s.postfx,
      s.audio,
      s.characters,
      s.interact,
      s.cctv,
      s.cinematic,
      s.director,
      s.ui,
    ];
    for (const sys of order) {
      try {
        await sys.init(s);
      } catch (err) {
        console.error('[init] system failed', sys.constructor?.name, err);
      }
    }

    s.postfx.applySettings(s.store.get().settings);
    s.audio.applySettings(s.store.get().settings);
    s.bus.on('settings:change', ({ settings }) => this.onSettings(settings));
    this.onSettings(s.store.get().settings);

    window.addEventListener('resize', () => this.resize());
    this.resize();

    const hash = readHash();
    // Title screen (skipped when restarting a night: a plain prompt waits for the audio gesture instead)
    if (!hash.auto) s.store.setScreen('title');
    document.getElementById('boot')?.classList.add('hidden');
    setTimeout(() => document.getElementById('boot')?.remove(), 900);

    this.exposeDebug();
    if (hash.debug) this.enableDebugOverlay();
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.frame);

    if (hash.auto) {
      // Auto-start after the first user gesture (browsers only allow audio after one)
      const prompt = document.createElement('div');
      prompt.className = 'ns-autostart';
      prompt.innerHTML = '<div class="ns-autostart__title">NIGHT SHIFT</div><div class="ns-autostart__sub">Click or press any key to begin the night</div>';
      document.getElementById('app')?.appendChild(prompt);
      const start = (e: Event): void => {
        e.preventDefault();
        window.removeEventListener('pointerdown', start);
        window.removeEventListener('keydown', start);
        prompt.remove();
        void this.newGame(hash.seed);
      };
      window.addEventListener('pointerdown', start);
      window.addEventListener('keydown', start);
    }
  }

  private onSettings(settings: Settings): void {
    const s = this.services;
    s.postfx.applySettings(settings);
    s.audio.applySettings(settings);
    s.characters.setMotionScale(settings.motionEffects ? 1 : 0);
    if (settings.quality !== 'auto') this.setQuality(settings.quality);
  }

  private resize(): void {
    const { renderer, canvas } = this.services.three;
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    const cam = this.services.characters.camera;
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    const cc = this.services.cinematic.camera;
    cc.aspect = w / h;
    cc.updateProjectionMatrix();
    this.services.postfx.resize(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
  }

  private setQuality(q: 'low' | 'medium' | 'high'): void {
    if (this.qualityLevel === q) return;
    this.qualityLevel = q;
    const { renderer } = this.services.three;
    renderer.setPixelRatio(q === 'high' ? Math.min(window.devicePixelRatio, 1.5) : q === 'medium' ? 1 : 0.75);
    const shadows = q !== 'low';
    if (renderer.shadowMap.enabled !== shadows) {
      renderer.shadowMap.enabled = shadows;
      // shadow samplers are compiled into programs; force every material to rebuild
      this.services.three.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (m) for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
      });
    }
    this.services.postfx.setQuality(q);
    this.resize();
  }

  // ---------------------------------------------------------------------------
  // Game flow
  // ---------------------------------------------------------------------------

  private starting = false;

  async newGame(seedCode?: string): Promise<void> {
    // a double click on New Shift (or a menu click racing the auto-start) must not start two nights
    if (this.starting) return;
    this.starting = true;
    try {
      await this.startNight(seedCode);
    } finally {
      this.starting = false;
    }
  }

  private async startNight(seedCode?: string): Promise<void> {
    const s = this.services;
    const seed = seedCode ? normalizeSeedCode(seedCode) : makeSeedCode(Date.now() ^ Math.floor(Math.random() * 0xffffffff));
    const settings = s.store.get().settings;
    s.store.replace(makeInitialState(seed, scenarioForSeed(seed), settings));
    (s as { rng: RNG }).rng = new RNG(seed);
    s.clock.reset(0);
    await s.audio.unlock();
    s.bus.emit('game:new', { seed });

    // Reset the world + characters to their shift-start state
    s.world.build();
    s.lighting.setPowerState('normal', { immediate: true });
    // Night lighting: like real wards after 22:00 the corridor runs every other troffer. It leaves pools of
    // dark between the lights, and the panel behind the 23:45 figure stays lit so it reads as a silhouette.
    for (const l of LAYOUT.lights) {
      const m = /^corridor_fl_(\d+)$/.exec(l.id);
      if (m && Number(m[1]) % 2 === 0) s.lighting.setFixture(l.id, 'off');
    }
    s.characters.release();
    for (const id of ['john', 'susie', 'paul'] as const) {
      const sp = LAYOUT.spawn[id];
      s.characters.teleport(id, sp.pos, sp.yaw);
      s.store.setChar(id, { location: sp.room, position: { ...sp.pos }, yaw: sp.yaw });
    }

    s.store.setScreen('intro');
    s.ui.showScreen('intro');
    s.director.start(); // director plays the opening cinematic, then hands control to John
  }

  /** Called by the director once the intro is over. */
  beginPlay(): void {
    const s = this.services;
    s.store.update((d) => {
      d.introDone = true;
    });
    s.store.setScreen('playing');
    s.ui.showScreen('playing');
    s.clock.running = true;
    if (!s.input.isTouch) s.input.requestLock();
  }

  async restart(): Promise<void> {
    const seed = this.services.store.get().seed;
    location.hash = `seed=${encodeURIComponent(seed)}&auto=1`;
    location.reload();
  }

  quitToTitle(): void {
    location.hash = '';
    location.reload();
  }

  pause(): void {
    const s = this.services;
    if (s.store.get().screen !== 'playing') return;
    s.store.setPaused(true);
    s.clock.running = false;
    s.store.setScreen('paused');
    s.ui.showScreen('paused');
    s.input.releaseLock();
  }

  resume(): void {
    const s = this.services;
    if (!s.store.get().paused) return;
    s.store.setPaused(false);
    s.store.setScreen('playing');
    s.ui.showScreen('playing');
    s.clock.running = true;
    if (!s.input.isTouch) s.input.requestLock();
  }

  async endShift(ending: EndingId): Promise<void> {
    const s = this.services;
    s.clock.running = false;
    s.store.setEnding(ending);
    s.store.setScreen('ending');
    s.input.releaseLock();
    const st = s.store.get();
    const result = await s.ui.showEnding(ending, {
      seed: st.seed,
      clues: st.clues,
      choices: st.choices.map((c) => ({ label: c.label, value: c.value })),
      missing: (['john', 'susie', 'paul'] as const).filter((id) => st.characters[id].missing),
      lines: s.director.endingSummary(ending),
    });
    if (result === 'new_night') {
      location.hash = 'auto=1';
      location.reload();
    } else {
      this.quitToTitle();
    }
  }

  /** Perspective switch with a cinematic transition. */
  async switchView(view: ViewId, cameraId?: string): Promise<void> {
    const s = this.services;
    const st = s.store.get();
    if (this.switching) return;
    if (view !== 'cctv' && st.characters[view].missing) {
      s.ui.toast(`${st.characters[view].name} cannot be reached.`);
      s.audio.play('cctv_offline', { nonSpatial: true, volume: 0.5 });
      return;
    }
    if (view === st.activeView && view !== 'cctv') return;
    this.switching = true;
    const from = st.activeView;
    s.bus.emit('view:switching', { to: view, from });
    s.store.lockInput(true);
    s.ui.closeSwitcher();

    const kind: TransitionKind = view === 'cctv' ? 'monitor_on' : from === 'cctv' ? 'monitor_off' : s.rng.chance(0.5) ? 'static' : 'flicker';
    s.audio.play(view === 'cctv' ? 'cctv_switch' : 'static_burst', { nonSpatial: true, volume: 0.45 });
    await s.postfx.transition(kind, view === 'cctv' || from === 'cctv' ? 0.55 : 0.45);

    if (view === 'cctv') {
      s.characters.release();
      s.cctv.enter(cameraId);
      s.store.setView('cctv', s.cctv.currentCamera?.id ?? cameraId ?? null);
      s.postfx.setMode('cctv');
      s.audio.setCCTVMode(true);
      s.audio.setPerception(null, null);
    } else {
      if (s.cctv.active) s.cctv.exit();
      s.characters.possess(view);
      s.store.setView(view);
      s.postfx.setMode('world');
      s.audio.setCCTVMode(false);
      const c = s.store.char(view);
      s.postfx.setPerception(c.perception, view);
      s.audio.setPerception(c.perception, view);
      s.audio.setRoom(c.location);
      s.store.setChar(view, { danger: Math.min(c.danger, 0.35) });
    }
    s.characters.setViewFilter(view);
    s.store.lockInput(false);
    this.switching = false;
  }

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------

  private frame = (now: number): void => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);
    const s = this.services;
    const dt = Math.min(MAX_DT, Math.max(0, (now - this.last) / 1000));
    this.last = now;

    s.input.beginFrame();
    const st = s.store.get();
    const playing = st.screen === 'playing' && !st.paused;

    // Global hotkeys
    if (s.input.pressed('pause')) {
      if (st.screen === 'playing' && !s.ui.modalOpen && !s.cinematic.playing) this.pause();
      else if (st.screen === 'paused') this.resume();
    }
    if (playing && !st.inputLocked && !s.ui.modalOpen) {
      if (s.input.pressed('switcher')) {
        if (s.ui.switcherOpen) s.ui.closeSwitcher();
        else s.ui.openSwitcher();
      }
      if (s.input.pressed('quick_john')) void this.switchView('john');
      if (s.input.pressed('quick_susie')) void this.switchView('susie');
      if (s.input.pressed('quick_paul')) void this.switchView('paul');
      if (s.input.pressed('quick_cctv')) void this.switchView('cctv');
      if (st.activeView === 'cctv') {
        if (s.input.pressed('cctv_next')) s.cctv.next();
        if (s.input.pressed('cctv_prev')) s.cctv.prev();
        if (s.input.pressed('cancel')) void this.switchView(st.lastCharacter);
      }
      if (s.input.pressed('interact') && st.activeView !== 'cctv') void s.interact.trigger();
      if (s.input.pressed('flashlight') && st.activeView === 'paul') {
        const c = s.store.char('paul');
        if (c.hasFlashlight) {
          s.store.setChar('paul', { flashlight: !c.flashlight });
          s.lighting.setFlashlight(!c.flashlight);
          s.audio.play('flashlight_click', { nonSpatial: true, volume: 0.6 });
        }
      }
    }

    // Game time
    let gdt = 0;
    if (playing && !s.cinematic.playing) {
      gdt = s.clock.advance(dt);
      s.store.update((d) => {
        d.time = s.clock.time;
        d.realElapsed += dt;
      });
      s.bus.emit('time:tick', { time: s.clock.time, dt: gdt, realDt: dt });
      const phase = phaseForTime(s.clock.time);
      if (phase !== st.phase) s.store.setPhase(phase);
    }

    // Systems
    s.director.update(dt, gdt);
    s.characters.update(dt, gdt);
    s.world.update(dt, gdt);
    s.lighting.update(dt, gdt);
    s.interact.update(dt, gdt);
    s.cctv.update(dt, gdt);
    s.cinematic.update(dt, gdt);
    s.audio.update(dt, gdt);
    s.postfx.update(dt, gdt);
    s.ui.update(dt, gdt);

    // Render
    const cam = s.cinematic.playing ? s.cinematic.camera : s.characters.camera;
    s.three.camera = cam;
    const cctvView = !s.cinematic.playing && s.cctv.active && st.screen !== 'title';
    cam.getWorldPosition(this.camWorld); // the first-person camera is parented to its rig
    this.cullRooms(s.cinematic.playing ? null : cctvView ? (s.cctv.currentCamera?.room ?? null) : s.world.roomAt({ x: this.camWorld.x, z: this.camWorld.z }));
    if (cctvView) {
      s.cctv.renderFrame();
    } else {
      s.postfx.render(s.three.scene, cam);
    }

    // Adaptive quality
    this.fpsAccum += dt;
    this.fpsFrames++;
    if (this.fpsAccum >= 1) {
      const fps = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
      if (s.store.get().settings.quality === 'auto' && playing) {
        if (fps < 38) this.lowFpsSeconds++;
        else this.lowFpsSeconds = Math.max(0, this.lowFpsSeconds - 1);
        if (this.lowFpsSeconds >= 3) {
          this.lowFpsSeconds = 0;
          if (this.qualityLevel === 'high') this.setQuality('medium');
          else if (this.qualityLevel === 'medium') this.setQuality('low');
        }
      }
    }

    if (this.debugEl) this.updateDebugOverlay(dt);
    s.input.endFrame();
  };

  /**
   * Room-level visibility: draw only rooms that can be seen from the camera's room (closed solid doors
   * hide what is behind them). null (cinematics, camera inside a door gap) draws everything.
   */
  private cullRooms(room: import('./core/types').RoomId | null): void {
    const s = this.services;
    const now = performance.now();
    // a door counts as see-through until well after it starts closing, so the room behind does not
    // vanish while the leaf is still swinging shut
    const seeThrough = (id: string): boolean => {
      if (s.world.getDoor(id)?.open) {
        this.doorSeenOpen.set(id, now);
        return true;
      }
      return now - (this.doorSeenOpen.get(id) ?? -Infinity) < 2500;
    };
    const visible = room ? visibleRooms(room, this.openings, seeThrough) : null;
    for (const r of LAYOUT.rooms) {
      const g = s.world.roomGroup(r.id);
      if (g) g.visible = visible ? visible.has(r.id) : true;
    }
  }

  private enableDebugOverlay(): void {
    const el = document.createElement('div');
    el.id = 'ns-debug';
    el.style.cssText =
      'position:fixed;left:8px;bottom:8px;z-index:9999;font:11px/1.35 Consolas,monospace;color:#9fd3a6;background:rgba(0,0,0,.55);padding:6px 8px;pointer-events:none;white-space:pre;max-width:46vw;';
    document.body.appendChild(el);
    this.debugEl = el;
  }

  private updateDebugOverlay(dt: number): void {
    this.debugAccum += dt;
    if (this.debugAccum < 0.25 || !this.debugEl) return;
    this.debugAccum = 0;
    const s = this.services;
    const st = s.store.get();
    const chars = (['john', 'susie', 'paul'] as const)
      .map((id) => {
        const c = st.characters[id];
        return `${id[0].toUpperCase()} ${c.location.padEnd(13)} d=${c.danger.toFixed(2)}${c.missing ? ' MISSING' : ''}`;
      })
      .join('\n');
    const next = s.director
      .schedule()
      .filter((e) => e.at >= st.time)
      .slice(0, 5)
      .map((e) => `  ${e.at.toFixed(1).padStart(6)} ${e.id}`)
      .join('\n');
    this.debugEl.textContent =
      `t=${st.time.toFixed(2)} ${st.phase} power=${st.power} snd=${st.sound} view=${st.activeView}${st.activeCamera ? ':' + st.activeCamera : ''}\n` +
      `seed=${st.seed} fired=${st.fired.length} wit=${st.witnessed.length} miss=${st.missed.length} clues=${st.clues.length} thr=${st.threat.toFixed(2)} q=${this.qualityLevel}\n` +
      `${chars}\nnext:\n${next}`;
  }

  // ---------------------------------------------------------------------------
  // Debug
  // ---------------------------------------------------------------------------

  debug = {
    setTime: (minutes: number): void => {
      this.services.clock.set(minutes);
      this.services.store.update((d) => {
        d.time = minutes;
      });
      const phase = phaseForTime(minutes);
      this.services.store.setPhase(phase);
    },
    fire: (eventId: string): void => {
      void this.services.director.fire(eventId);
    },
    screenshotMode: (on: boolean): void => {
      this.screenshotMode = on;
      this.services.ui.setHudVisible(!on);
    },
  };

  private exposeDebug(): void {
    const s = this.services;
    window.__NS = {
      services: s,
      state: () => s.store.get(),
      setTime: (m) => this.debug.setTime(m),
      fire: (id) => s.director.fire(id),
      switchView: (v, c) => this.switchView(v, c),
      screenshotMode: (on) => this.debug.screenshotMode(on),
      newGame: (seed) => this.newGame(seed),
      skipIntro: () => s.cinematic.skip(),
      ready: true,
    };
  }
}

// ---------------------------------------------------------------------------

const game = new Game();
game.init().catch((err) => {
  console.error('[NIGHT SHIFT] failed to start', err);
  const boot = document.getElementById('boot');
  if (boot) boot.innerHTML = `<div class="boot__inner"><div class="boot__title">NIGHT SHIFT</div><div class="boot__sub">Your browser could not start WebGL. Try Chrome or Edge on desktop.</div></div>`;
});

export type { Game };
