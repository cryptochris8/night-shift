/**
 * NIGHT SHIFT — post-processing: composer pipeline, perception look, transitions, pulses.
 *
 * Chain: RenderPass → UnrealBloomPass → OutputPass (ACES + sRGB) → the NIGHT SHIFT shader.
 * The custom pass sits after OutputPass on purpose: its effects (quantisation, scanlines,
 * grain, blackout) are display-referred and need predictable 0..1 pixel values (see
 * OutputPass's own note: passes that need sRGB input must follow it).
 *
 * transition() resolves at the point of maximum obscuration so the caller can swap views
 * while nothing is visible; the tail keeps animating on its own.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { IPostFX, Services, TransitionKind } from '../core/contracts';
import { RNG } from '../core/rng';
import type { CharacterId, PerceptionState, Settings } from '../core/types';
import { DEFAULT_SETTINGS } from '../core/types';
import { POSTFX_FRAGMENT_SHADER, POSTFX_VERTEX_SHADER, makePostFXUniforms, type PostFXUniforms } from './shaders';

type Tier = 'low' | 'medium' | 'high';
type Mode = 'world' | 'cctv' | 'black';

/** Blended look values derived from a character's perception. */
interface Look {
  blur: number;
  chroma: number;
  vignette: number;
  desat: number;
  grain: number;
  warp: number;
  tunnel: number;
  hbRate: number;
  hbAmp: number;
  injury: number;
}

const LOOK_KEYS: (keyof Look)[] = ['blur', 'chroma', 'vignette', 'desat', 'grain', 'warp', 'tunnel', 'hbRate', 'hbAmp', 'injury'];

const BASE_VIGNETTE = 0.28;
const BASE_GRAIN = 0.035;
const GRAIN_OFF = 0.006;

interface Transition {
  kind: TransitionKind;
  duration: number;
  t: number;
  /** fraction of duration at which the screen is maximally obscured */
  peak: number;
  resolve: (() => void) | null;
  dir: THREE.Vector2;
  flickerPattern: { at: number; v: number }[];
  stutters: number[];
  done: boolean;
}

interface Pulse {
  kind: 'glitch' | 'heartbeat' | 'hit' | 'cctv' | 'switch';
  strength: number;
  t: number;
  dur: number;
  dir: THREE.Vector2;
  pix: number;
  tear: number;
  stat: number;
}

/** Per-frame transient outputs collected from transitions + pulses before writing uniforms. */
interface Transient {
  flicker: number;
  flash: number;
  stat: number;
  tear: number;
  chroma: number;
  pix: number;
  fade: number;
  whipX: number;
  whipY: number;
  shakeX: number;
  shakeY: number;
  crtOpen: number;
  crtAmt: number;
  crtGlow: number;
  crtRoll: number;
  heartbeat: number;
}

const DEFAULT_FLICKER: { at: number; v: number }[] = [
  { at: 0, v: 1 }, { at: 0.06, v: 0.55 }, { at: 0.1, v: 1.15 }, { at: 0.14, v: 0 }, { at: 0.24, v: 1.3 },
  { at: 0.28, v: 0 }, { at: 0.46, v: 0.65 }, { at: 0.5, v: 0 }, { at: 0.58, v: 1.25 }, { at: 0.62, v: 0.35 },
  { at: 0.68, v: 1 }, { at: 0.74, v: 0.5 }, { at: 0.78, v: 1 }, { at: 0.86, v: 0.85 }, { at: 0.92, v: 1 },
];

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeOutCubic = (u: number): number => 1 - Math.pow(1 - clamp01(u), 3);
const easeInCubic = (u: number): number => Math.pow(clamp01(u), 3);
const easeInOut = (u: number): number => {
  const t = clamp01(u);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

export class PostFX implements IPostFX {
  private s!: Services;
  private rng = new RNG('postfx');
  private composer!: EffectComposer;
  private renderPass!: RenderPass;
  private bloom!: UnrealBloomPass;
  private output!: OutputPass;
  private fxPass!: ShaderPass;
  private material!: THREE.ShaderMaterial;
  private u!: PostFXUniforms;

  private tier: Tier = 'high';
  private width = 1920;
  private height = 1080;
  private time = 0;
  private lastDt = 1 / 60;
  private settings: Settings = { ...DEFAULT_SETTINGS };

  private mode: Mode = 'world';
  private lastPerception: PerceptionState | null = null;
  private look: Look = { blur: 0, chroma: 0, vignette: BASE_VIGNETTE, desat: 0, grain: BASE_GRAIN, warp: 0, tunnel: 0, hbRate: 0, hbAmp: 0, injury: 0 };
  private target: Look = { ...this.look };

  private blackoutTarget = 0;
  private blackout = 0;
  /** black held after fade_black until a fade_in or the next transition's peak */
  private fadeHold = 0;
  private heartbeatRate = 0;
  private hbPhase = 0;

  private transition_: Transition | null = null;
  private pulses: Pulse[] = [];

  private wobbleTimer = 5;
  private wobbleT = -1;

  private cctv = { degradation: 0.1, online: true, label: '', timestamp: '' };
  private cctvGlitchTimer = 4;
  private offBus: (() => void)[] = [];

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  init(services: Services): void {
    this.s = services;
    this.reseed();
    const { renderer, scene, camera } = services.three;

    this.composer = new EffectComposer(renderer);
    // We feed device pixels straight in (main passes w*ratio), so the composer must not re-scale.
    this.composer.setPixelRatio(1);

    this.renderPass = new RenderPass(scene, camera);
    // Threshold sits above lit-wall luminance (<~2 in HDR) and below fixture emissives (~5-15), so only
    // tubes, lenses, signs and screens glow instead of veiling every bright corridor.
    // Tight radius: large ceiling lenses near the camera otherwise flood the wide mips into a full-frame veil.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(this.width, this.height), 0.38, 0.1, 2.2);
    // Clamp what feeds the bloom chain: one HDR hotspot (a light grazing a surface, a specular spike)
    // otherwise spreads through the low mips into a veil over the whole frame.
    const hp = this.bloom.materialHighPassFilter;
    hp.fragmentShader = hp.fragmentShader.replace(
      'vec4 texel = texture2D( tDiffuse, vUv );',
      'vec4 texel = texture2D( tDiffuse, vUv ); texel.rgb = min( texel.rgb, vec3( 12.0 ) );',
    );
    hp.needsUpdate = true;
    this.output = new OutputPass();

    this.u = makePostFXUniforms();
    this.u.uSeed.value = this.rng.range(0, 1000);
    this.material = new THREE.ShaderMaterial({
      name: 'NightShiftPost',
      uniforms: this.u,
      vertexShader: POSTFX_VERTEX_SHADER,
      fragmentShader: POSTFX_FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
    });
    this.fxPass = new ShaderPass(this.material);

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
    this.composer.addPass(this.fxPass);

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.width = Math.max(2, Math.round(size.x));
    this.height = Math.max(2, Math.round(size.y));
    this.applySize();
    this.applySettings(services.store.get().settings);

    this.offBus.push(
      services.bus.on('game:new', () => {
        this.reseed();
        this.u.uSeed.value = this.rng.range(0, 1000);
        this.resetState();
      }),
    );
  }

  private reseed(): void {
    this.rng = this.s.rng.fork('postfx');
  }

  private resetState(): void {
    this.blackoutTarget = 0;
    this.blackout = 0;
    this.fadeHold = 0;
    this.heartbeatRate = 0;
    this.hbPhase = 0;
    this.pulses = [];
    if (this.transition_) this.finishTransition(this.transition_, false);
    this.transition_ = null;
    this.setPerception(null, null);
    this.setMode('world');
    this.wobbleTimer = this.rng.range(4, 9);
    this.wobbleT = -1;
  }

  dispose(): void {
    for (const off of this.offBus) off();
    this.offBus = [];
    if (this.transition_) this.finishTransition(this.transition_, false);
    this.bloom?.dispose();
    this.output?.dispose();
    this.fxPass?.dispose();
    this.composer?.dispose();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  setPerception(p: PerceptionState | null, _character: CharacterId | null): void {
    // The mapping is the same for everyone: perception values already carry the character.
    this.lastPerception = p ? { ...p } : null;
    this.computeTargets();
  }

  setMode(mode: Mode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.u.uMode.value = mode === 'world' ? 0 : mode === 'cctv' ? 1 : 2;
    if (mode === 'cctv') this.cctvGlitchTimer = this.rng.range(1.5, 4);
    this.computeTargets();
  }

  transition(kind: TransitionKind, seconds: number): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.transition_) this.finishTransition(this.transition_, false);
      const duration = kind === 'cut' ? Math.max(seconds, 0.02) : Math.max(0.05, seconds || 0.5);
      const tr: Transition = {
        kind,
        duration,
        t: 0,
        peak: this.peakFor(kind),
        resolve,
        dir: new THREE.Vector2(this.rng.chance(0.5) ? 1 : -1, this.rng.range(-0.12, 0.12)).normalize(),
        flickerPattern: this.makeFlickerPattern(),
        stutters: [this.rng.range(0.62, 0.78), this.rng.range(0.8, 0.95)],
        done: false,
      };
      this.transition_ = tr;
      // The CRT mask blacks out everything but the line from frame one, so a held black can go now.
      if (kind === 'monitor_on') this.fadeHold = 0;
      // Peak at t = 0 → resolve right away (the caller can already swap).
      if (tr.peak <= 0) this.resolveTransition(tr);
    });
  }

  setBlackout(amount: number): void {
    this.blackoutTarget = clamp01(amount);
  }

  pulse(kind: 'heartbeat' | 'hit' | 'glitch', strength: number): void {
    const s = Math.max(0, Math.min(1.5, strength));
    const dir = new THREE.Vector2(this.rng.range(-1, 1), this.rng.range(-1, 1));
    if (dir.lengthSq() < 1e-4) dir.set(1, 0);
    dir.normalize();
    const dur = kind === 'glitch' ? 0.3 : kind === 'heartbeat' ? 0.65 : 0.45;
    this.pulses.push({ kind, strength: s, t: 0, dur, dir, pix: kind === 'glitch' && s > 0.3 ? 3 + 6 * s : 0, tear: 0, stat: 0 });
    if (this.pulses.length > 12) this.pulses.splice(0, this.pulses.length - 12);
  }

  setHeartbeat(rate: number): void {
    // Accept Hz or BPM: anything above 5 is clearly beats per minute.
    const r = Math.max(0, rate);
    this.heartbeatRate = r > 5 ? r / 60 : r;
  }

  setCCTVParams(p: { degradation: number; online: boolean; label: string; timestamp: string; recording?: boolean }): void {
    const labelChanged = p.label !== this.cctv.label && this.cctv.label !== '';
    const onlineChanged = p.online !== this.cctv.online;
    this.cctv = { degradation: clamp01(p.degradation), online: p.online, label: p.label, timestamp: p.timestamp };
    const deg = this.cctv.degradation;
    this.u.uDegradation.value = deg;
    this.u.uOnline.value = p.online ? 1 : 0;
    this.u.uQuant.value = Math.round(8 - deg * 3.5);
    this.u.uScanline.value = 0.16 + deg * 0.1;
    this.u.uBleed.value = 0.5 + deg * 0.5;
    if ((labelChanged || onlineChanged) && this.mode === 'cctv') {
      // matrix switcher blip: a short burst of snow with a tear
      this.pulses.push({ kind: 'switch', strength: 1, t: 0, dur: 0.16, dir: new THREE.Vector2(1, 0), pix: 0, tear: 0.8, stat: 0.75 });
    }
  }

  applySettings(s: Settings): void {
    this.settings = { ...s };
    this.computeTargets();
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.composer.render(this.lastDt);
  }

  resize(width: number, height: number): void {
    const w = Math.max(2, Math.round(width));
    const h = Math.max(2, Math.round(height));
    if (w === this.width && h === this.height && this.composer) {
      return;
    }
    this.width = w;
    this.height = h;
    this.applySize();
  }

  setQuality(q: Tier): void {
    if (this.tier === q) return;
    this.tier = q;
    this.applySize();
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  update(dt: number, _gdt: number): void {
    const d = Math.min(0.1, Math.max(0, dt));
    this.lastDt = d;
    this.time += d;
    this.u.uTime.value = this.time;

    // perception blend (~2/s)
    const k = Math.min(1, d * 2);
    for (const key of LOOK_KEYS) this.look[key] += (this.target[key] - this.look[key]) * k;

    this.blackout += (this.blackoutTarget - this.blackout) * Math.min(1, d * 8);

    const tr: Transient = {
      flicker: 1, flash: 0, stat: 0, tear: 0, chroma: 0, pix: 0, fade: this.fadeHold,
      whipX: 0, whipY: 0, shakeX: 0, shakeY: 0, crtOpen: 1, crtAmt: 0, crtGlow: 0, crtRoll: -1, heartbeat: 0,
    };

    this.updateTransition(d, tr);
    this.updatePulses(d, tr);
    this.updateHeartbeat(d, tr);
    this.updateWobble(d);
    this.updateCCTVScheduler(d);

    const motion = this.settings.motionEffects;
    const u = this.u;
    u.uBlur.value = this.look.blur;
    u.uChroma.value = this.look.chroma;
    u.uVignette.value = this.look.vignette;
    u.uDesat.value = this.look.desat;
    u.uGrain.value = this.look.grain;
    u.uWarp.value = motion ? this.look.warp : 0;
    u.uTunnel.value = this.look.tunnel;
    u.uBlackout.value = this.blackout;
    u.uFade.value = clamp01(tr.fade);
    u.uFlicker.value = Math.max(0, tr.flicker);
    u.uFlash.value = Math.max(0, tr.flash);
    u.uStaticAmt.value = clamp01(tr.stat);
    u.uTear.value = Math.min(1.5, tr.tear);
    u.uGlitchChroma.value = Math.min(1.5, tr.chroma);
    u.uPixelate.value = tr.pix > 1 ? Math.round(tr.pix) : 0;
    u.uWhip.value.set(tr.whipX, tr.whipY);
    u.uShake.value.set(motion ? tr.shakeX : 0, motion ? tr.shakeY : 0);
    u.uCrt.value.set(tr.crtOpen, tr.crtAmt, tr.crtGlow, tr.crtRoll);
    u.uHeartbeat.value = Math.min(1, tr.heartbeat);
  }

  // ---------------------------------------------------------------------------
  // Perception mapping
  // ---------------------------------------------------------------------------

  private computeTargets(): void {
    const t = this.target;
    const p = this.mode === 'world' ? this.lastPerception : null;
    const grainOn = this.settings.filmGrain;
    if (!p) {
      t.blur = 0;
      t.chroma = 0;
      t.vignette = BASE_VIGNETTE;
      t.desat = 0;
      t.grain = grainOn ? BASE_GRAIN : GRAIN_OFF;
      t.warp = 0;
      t.tunnel = 0;
      t.hbRate = 0;
      t.hbAmp = 0;
      t.injury = 0;
      return;
    }
    const med = clamp01(p.medication);
    const fat = clamp01(p.fatigue);
    const anx = clamp01(p.anxiety);
    const str = clamp01(p.stress);
    const fear = clamp01(p.fear);
    const inj = clamp01(p.injury);
    t.blur = 0.6 * med;
    t.chroma = 0.4 * med;
    t.vignette = BASE_VIGNETTE + 0.4 * fat + 0.15 * fear;
    t.desat = 0.25 * fat + 0.12 * med;
    const nerves = Math.max(anx, str * 0.8);
    t.grain = grainOn ? BASE_GRAIN + 0.07 * nerves + 0.03 * fear : GRAIN_OFF;
    t.warp = 0.3 * nerves + 0.5 * fear;
    t.tunnel = fear > 0.3 ? ((fear - 0.3) / 0.7) * 0.6 : 0;
    // the heart only becomes visible past mild fear
    t.hbRate = fear > 0.35 ? 0.9 + fear * 1.1 : 0;
    t.hbAmp = fear > 0.35 ? 0.15 + 0.3 * fear : 0;
    t.injury = inj;
  }

  // ---------------------------------------------------------------------------
  // Transitions
  // ---------------------------------------------------------------------------

  private peakFor(kind: TransitionKind): number {
    switch (kind) {
      case 'static': return 0.44;
      case 'flicker': return 0.36;
      case 'cut': return 0;
      case 'monitor_on': return 0.3;
      case 'monitor_off': return 0.52;
      case 'fade_black': return 1;
      case 'fade_in': return 0;
      case 'whip': return 0.5;
    }
  }

  private makeFlickerPattern(): { at: number; v: number }[] {
    const soft = this.settings.reducedFlicker;
    // tiny timing jitter so no two cuts are identical; keep the resolve-black (0.28–0.46) stable
    return DEFAULT_FLICKER.map((seg, i) => {
      const jitter = i === 0 || seg.at === 0.28 || seg.at === 0.46 ? 0 : this.rng.range(-0.012, 0.012);
      let v = seg.v;
      if (soft) {
        if (v > 1) v = 1.05;
        else if (v === 0 && seg.at !== 0.28) v = 0.12;
      }
      return { at: Math.max(0, seg.at + jitter), v };
    });
  }

  private resolveTransition(tr: Transition): void {
    if (tr.resolve) {
      const r = tr.resolve;
      tr.resolve = null;
      // Any held black is released at the moment the new view is swapped in (fade_black keeps it).
      if (tr.kind !== 'fade_black') this.fadeHold = 0;
      r();
    }
  }

  /** `completed` = ran to its end (a superseded fade_black must not snap the screen to black). */
  private finishTransition(tr: Transition, completed = true): void {
    this.resolveTransition(tr);
    tr.done = true;
    if (tr.kind === 'fade_black' && completed) this.fadeHold = 1;
    if (tr.kind === 'fade_in') this.fadeHold = 0;
    if (this.transition_ === tr) this.transition_ = null;
  }

  private updateTransition(dt: number, out: Transient): void {
    const tr = this.transition_;
    if (!tr) return;
    tr.t += dt;
    const f = Math.min(1, tr.t / tr.duration);

    switch (tr.kind) {
      case 'static': {
        const rise = smoothstep(0, 0.32, f);
        const fall = 1 - smoothstep(0.55, 1, f);
        let amt = Math.min(rise, fall);
        for (const st of tr.stutters) {
          if (f > st && f < st + 0.05) amt = Math.max(amt, 0.55);
        }
        out.stat = Math.max(out.stat, amt);
        out.tear += amt * 0.9;
        out.chroma += amt * 0.8;
        out.flash += Math.exp(-f * 40) * 0.25;
        if (amt > 0.15 && fall < 1) out.pix = Math.max(out.pix, 3 + 7 * amt);
        break;
      }
      case 'flicker': {
        let v = 1;
        for (const seg of tr.flickerPattern) if (f >= seg.at) v = seg.v;
        out.flicker *= v;
        // the ballast buzz: tiny brightness jitter on the lit frames
        if (v > 0.2) out.flicker *= 1 + (this.frameHash() - 0.5) * 0.06;
        break;
      }
      case 'cut': {
        out.fade = 1;
        break;
      }
      case 'monitor_on': {
        out.crtAmt = 1 - smoothstep(0.9, 1, f);
        if (f < 0.08) {
          out.crtOpen = 0.0015;
          out.crtGlow = (f / 0.08) * 0.9;
        } else if (f < 0.3) {
          out.crtOpen = 0.0015;
          out.crtGlow = 0.9 + 0.2 * ((f - 0.08) / 0.22) + (this.frameHash() - 0.5) * 0.15;
        } else if (f < 0.78) {
          const u = (f - 0.3) / 0.48;
          out.crtOpen = 0.0015 + (1 - 0.0015) * easeOutCubic(u);
          out.crtGlow = 1.1 * (1 - smoothstep(0, 0.5, u));
          out.crtRoll = 1.2;
        } else {
          out.crtOpen = 1;
          out.crtGlow = 0;
          out.crtRoll = 1 - (f - 0.78) / 0.22;
        }
        break;
      }
      case 'monitor_off': {
        if (f < 0.45) {
          const u = f / 0.45;
          out.crtAmt = 1;
          out.crtOpen = 1 - (1 - 0.0015) * easeInCubic(u);
          out.crtGlow = smoothstep(0.5, 1, u);
          out.crtRoll = -1;
        } else if (f < 0.64) {
          out.crtAmt = 1;
          out.crtOpen = 0.0015;
          out.crtGlow = 1 - 0.65 * ((f - 0.45) / 0.19);
          out.crtRoll = -1;
          out.fade = Math.max(out.fade, smoothstep(0.58, 0.64, f));
        } else if (f < 0.72) {
          out.fade = 1;
        } else {
          out.fade = Math.max(out.fade, 1 - easeInOut((f - 0.72) / 0.28));
        }
        break;
      }
      case 'fade_black': {
        out.fade = Math.max(out.fade, easeInOut(f));
        break;
      }
      case 'fade_in': {
        out.fade = Math.max(out.fade, 1 - easeInOut(f));
        break;
      }
      case 'whip': {
        const s = Math.pow(Math.sin(Math.PI * f), 1.4);
        out.whipX += tr.dir.x * 0.1 * s;
        out.whipY += tr.dir.y * 0.1 * s;
        out.flicker *= 1 - 0.3 * s;
        out.chroma += 0.5 * s;
        break;
      }
    }

    if (tr.resolve && f >= tr.peak) this.resolveTransition(tr);
    if (f >= 1) this.finishTransition(tr);
  }

  // ---------------------------------------------------------------------------
  // Pulses / heartbeat / wobble / CCTV life
  // ---------------------------------------------------------------------------

  private updatePulses(dt: number, out: Transient): void {
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.t += dt;
      const u = p.t / p.dur;
      if (u >= 1) {
        this.pulses.splice(i, 1);
        continue;
      }
      switch (p.kind) {
        case 'glitch': {
          const e = Math.exp(-u * 6) * (1 - u);
          out.tear += p.strength * e;
          out.chroma += p.strength * e;
          out.stat = Math.max(out.stat, p.strength * e * 0.35);
          if (u < 0.4 && p.pix > 0) out.pix = Math.max(out.pix, p.pix);
          break;
        }
        case 'heartbeat': {
          out.heartbeat += p.strength * 0.5 * this.beatShape(p.t);
          break;
        }
        case 'hit': {
          out.flash += p.strength * 0.55 * Math.exp(-p.t * 14);
          const a = p.strength * 0.014 * Math.exp(-p.t * 8) * Math.cos(p.t * 45);
          out.shakeX += p.dir.x * a;
          out.shakeY += p.dir.y * a;
          break;
        }
        case 'cctv':
        case 'switch': {
          const e = 1 - u;
          out.tear += p.tear * e;
          out.stat = Math.max(out.stat, p.stat * e);
          if (p.pix > 0 && u < 0.6) out.pix = Math.max(out.pix, p.pix);
          break;
        }
      }
    }
  }

  /** Cheap per-frame jitter in [0,1) from the clock, so visual noise never drains the seeded stream. */
  private frameHash(): number {
    const n = Math.imul(Math.floor(this.time * 120) + 0x9e37, 2654435761) >>> 0;
    return n / 4294967296;
  }

  /** lub-dub envelope, seconds since the beat started */
  private beatShape(tb: number): number {
    const lub = Math.exp(-tb * 9);
    const dub = tb > 0.16 ? 0.55 * Math.exp(-(tb - 0.16) * 11) : 0;
    return lub + dub;
  }

  private updateHeartbeat(dt: number, out: Transient): void {
    const fearRate = this.look.hbRate;
    const rate = Math.max(this.heartbeatRate, fearRate);
    if (rate <= 0.01) {
      this.hbPhase = 0;
      return;
    }
    this.hbPhase = (this.hbPhase + dt * rate) % 1;
    const tb = this.hbPhase / rate;
    const amp = this.heartbeatRate > fearRate ? Math.max(0.4, this.look.hbAmp) : this.look.hbAmp;
    out.heartbeat += amp * this.beatShape(tb);
  }

  private updateWobble(dt: number): void {
    const inj = this.look.injury;
    if (inj < 0.02 || !this.settings.motionEffects || this.mode !== 'world') {
      this.u.uWobble.value = 0;
      this.wobbleT = -1;
      return;
    }
    if (this.wobbleT >= 0) {
      this.wobbleT += dt;
      const u = this.wobbleT / 0.7;
      if (u >= 1) {
        this.wobbleT = -1;
        this.wobbleTimer = this.rng.range(4, 9) / (0.5 + inj);
        this.u.uWobble.value = 0;
      } else {
        this.u.uWobble.value = inj * 0.8 * Math.sin(Math.PI * u);
      }
      return;
    }
    this.wobbleTimer -= dt;
    if (this.wobbleTimer <= 0) this.wobbleT = 0;
  }

  private updateCCTVScheduler(dt: number): void {
    if (this.mode !== 'cctv' || !this.cctv.online) return;
    this.cctvGlitchTimer -= dt;
    if (this.cctvGlitchTimer > 0) return;
    const deg = this.cctv.degradation;
    this.cctvGlitchTimer = this.rng.range(2.5, 7) / (0.25 + deg * 1.5);
    this.pulses.push({
      kind: 'cctv',
      strength: 1,
      t: 0,
      dur: this.rng.range(0.08, 0.3),
      dir: new THREE.Vector2(1, 0),
      pix: this.rng.chance(0.1 + 0.4 * deg) ? this.rng.int(3, 10) : 0,
      tear: this.rng.range(0.2, 0.7) * (0.3 + deg),
      stat: this.rng.chance(0.3) ? this.rng.range(0.1, 0.35) * deg : 0,
    });
  }

  // ---------------------------------------------------------------------------
  // Sizing / quality
  // ---------------------------------------------------------------------------

  private applySize(): void {
    if (!this.composer) return;
    const scale = this.tier === 'low' ? 0.5 : 1;
    const rw = Math.max(2, Math.round(this.width * scale));
    const rh = Math.max(2, Math.round(this.height * scale));
    this.composer.setSize(rw, rh);
    this.bloom.enabled = this.tier !== 'low';
    if (this.tier === 'medium') this.bloom.setSize(Math.max(2, Math.round(rw * 0.5)), Math.max(2, Math.round(rh * 0.5)));
    this.u.uResolution.value.set(this.width, this.height);
    this.u.uTexel.value.set(1 / rw, 1 / rh);
    this.u.uScanPeriod.value = Math.max(2, Math.round(this.height / 360));
  }
}
