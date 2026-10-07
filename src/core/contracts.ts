/**
 * System contracts. Every major subsystem implements one of these interfaces and is
 * wired together in main.ts through the `Services` bag. Modules talk to each other ONLY
 * through these interfaces and the EventBus — never by importing another module's class.
 *
 * Lifecycle: constructor(no args or own config) → init(services) [may be async] → update(dt, gdt) each frame → dispose().
 *   dt  = real seconds since last frame (clamped ≤ 0.1)
 *   gdt = game minutes elapsed this frame (0 while paused / in menus)
 */
import type * as THREE from 'three';
import type { GameClock } from './clock';
import type { InputManager } from './input';
import type { RNG } from './rng';
import type { EventBus, Store } from './state';
import type {
  CameraDef,
  CharacterId,
  CharacterState,
  Clue,
  DoorDef,
  EndingId,
  GamePhase,
  HospitalLayout,
  PerceptionState,
  PowerState,
  Rect,
  RoomId,
  ScheduleEntry,
  Screen,
  Settings,
  SoundState,
  Vec2,
  Vec3,
  ViewId,
  ZoneId,
} from './types';

export interface System {
  init(services: Services): void | Promise<void>;
  update(dt: number, gdt: number): void;
  dispose?(): void;
}

// ---------------------------------------------------------------------------
// Services bag
// ---------------------------------------------------------------------------

export interface ThreeContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  /** The camera currently being rendered (first-person camera, cinematic camera, or CCTV camera). */
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  /** DOM root for all UI overlays (sibling of the canvas) */
  uiRoot: HTMLElement;
}

export interface Services {
  store: Store;
  bus: EventBus;
  clock: GameClock;
  rng: RNG;
  layout: HospitalLayout;
  input: InputManager;
  three: ThreeContext;
  world: IWorldBuilder;
  lighting: ILightingSystem;
  postfx: IPostFX;
  audio: IAudioEngine;
  characters: ICharacterSystem;
  interact: IInteractionSystem;
  cctv: ICCTVSystem;
  ui: IUIManager;
  director: IEventDirector;
  cinematic: ICinematicSystem;
  /** Game-level orchestration available to everyone (view switching, pause, new game). */
  game: IGameController;
}

// ---------------------------------------------------------------------------
// Game controller (main.ts)
// ---------------------------------------------------------------------------

export interface IGameController {
  /** Called by the director when the opening cinematic ends: unhides HUD, starts the clock, locks the pointer. */
  beginPlay(): void;
  /** Switch the player's view with a cinematic transition. Resolves when complete. */
  switchView(view: ViewId, cameraId?: string): Promise<void>;
  newGame(seedCode?: string): Promise<void>;
  restart(): Promise<void>;
  /** Return to title (ends the run). */
  quitToTitle(): void;
  pause(): void;
  resume(): void;
  /** Fire the ending flow (director decides which). */
  endShift(ending: EndingId): Promise<void>;
  /** Debug helpers exposed on window.__NS */
  debug: {
    setTime(minutes: number): void;
    fire(eventId: string): void;
    screenshotMode(on: boolean): void;
  };
}

// ---------------------------------------------------------------------------
// World (geometry + props + doors)
// ---------------------------------------------------------------------------

export interface DoorHandle {
  def: DoorDef;
  open: boolean;
  /** nobody passes while locked (director unlocks) */
  locked: boolean;
  /** current access list (director may widen, e.g. exam3 → 'all' once John is roomed) */
  access: CharacterId[] | 'all' | 'none';
  /** world-space rectangle covering the opening (for movement through it) */
  passage: Rect;
}

export interface IWorldBuilder extends System {
  /** Build all geometry into scene. Called once in init(); idempotent rebuild allowed on new game. */
  build(): void;
  /** Root group of a room (walls, floor, ceiling, props). */
  roomGroup(room: RoomId): THREE.Group | undefined;
  /** A placed prop's root object (by PropDef.id). */
  getProp(id: string): THREE.Object3D | undefined;
  /** Move a prop (instant or animated). Also updates its collider. */
  moveProp(id: string, to: Vec3, rotY?: number, seconds?: number): Promise<void>;
  getDoor(id: string): DoorHandle | undefined;
  /** Animate a door open/closed. Resolves when the animation finishes. */
  setDoorOpen(id: string, open: boolean, animate?: boolean): Promise<void>;
  setDoorLocked(id: string, locked: boolean): void;
  setDoorAccess(id: string, access: CharacterId[] | 'all' | 'none'): void;
  /** Elevator: open/close cab doors, set cab lit/dark. */
  setElevator(open: boolean, lit: boolean): Promise<void>;
  /** Solid obstacles (props) as floor rects for collision. */
  getObstacles(): Rect[];
  /** Call-light indicator above an exam room door + at the nurse station board. */
  setCallLight(room: RoomId, on: boolean): void;
  /** Set what a monitor/terminal/TV screen displays. */
  setScreen(propId: string, mode: string): void;
  /** Spawn a transient decal on the floor (wet footprints, puddle). Returns remover. */
  addFloorDecal(kind: 'footprints' | 'puddle' | 'scuff' | 'drag', points: Vec2[], opts?: { fadeAfter?: number }): () => void;
  /** Rain / exterior weather intensity 0..1 */
  setRain(intensity: number): void;
  /** Condensation / fog overlay in a room 0..1 */
  setRoomHaze(room: RoomId, amount: number): void;
  /** Which room contains a point, or null. */
  roomAt(p: Vec2): RoomId | null;
}

// ---------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------

export type LightMode = 'on' | 'off' | 'flicker' | 'dim' | 'dying';

export interface ILightingSystem extends System {
  readonly powerState: PowerState;
  /** Transition global power. 'blackout' kills everything but battery exit signs; 'generator' restores emergency circuit only (subject to zones). */
  setPowerState(p: PowerState, opts?: { immediate?: boolean }): void;
  /** Energise / de-energise a breaker zone (Paul's panel). */
  setZone(zone: ZoneId, on: boolean): void;
  setRoomLights(room: RoomId, mode: LightMode, seconds?: number): void;
  setFixture(id: string, mode: LightMode, seconds?: number): void;
  /** Flicker all fixtures in a room for N seconds then return to previous mode. */
  flicker(room: RoomId, seconds: number, intensity?: number): void;
  /** Sequentially switch off fixtures in a room toward a point (anomaly). */
  cascadeOff(room: RoomId, toward: Vec2, stepSeconds: number): Promise<void>;
  /** Flashlight attached to the active first-person camera. */
  setFlashlight(on: boolean): void;
  /** Approx. brightness 0..1 at a point (gameplay logic: can an NPC see / is John in the dark). */
  brightnessAt(p: Vec3): number;
  /** Register an extra emissive/glow light source owned by a prop (monitor, vending). */
  registerGlow(id: string, pos: Vec3, color: number, intensity: number, circuit: 'main' | 'emergency' | 'always'): void;
  setGlow(id: string, on: boolean): void;
  /** For cinematics: override exposure/global multiplier 0..1 */
  setGlobalIntensity(mult: number): void;
  /** Dawn sky/ambient for the ending cinematic */
  setDawn(amount: number): void;
}

// ---------------------------------------------------------------------------
// Post-processing / transitions
// ---------------------------------------------------------------------------

export type TransitionKind = 'static' | 'flicker' | 'cut' | 'monitor_on' | 'monitor_off' | 'fade_black' | 'fade_in' | 'whip';

export interface IPostFX extends System {
  /** Smoothly blend toward a character's perception look (medication blur, tunnel vision, desaturation…). */
  setPerception(p: PerceptionState | null, character: CharacterId | null): void;
  /** 'world' = normal, 'cctv' = monochrome surveillance look, 'black' = screens dead. */
  setMode(mode: 'world' | 'cctv' | 'black'): void;
  /** Play a transition. Resolves at its midpoint-ish (when the screen is fully obscured) so the caller can swap views; the tail finishes on its own. */
  transition(kind: TransitionKind, seconds: number): Promise<void>;
  /** 0..1 global darkness overlay (blackout). */
  setBlackout(amount: number): void;
  /** Short impulse effects. */
  pulse(kind: 'heartbeat' | 'hit' | 'glitch', strength: number): void;
  /** Continuous heartbeat vignette rate (0 = off). */
  setHeartbeat(rate: number): void;
  /** CCTV look parameters while in cctv mode. */
  setCCTVParams(p: { degradation: number; online: boolean; label: string; timestamp: string; recording?: boolean }): void;
  applySettings(s: Settings): void;
  /** Render one frame of `scene` through `camera` with all effects. */
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  /** Called on resize. */
  resize(width: number, height: number): void;
  /** Lower internal resolution / disable passes when FPS drops. */
  setQuality(q: 'low' | 'medium' | 'high'): void;
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

export type SfxName =
  | 'footstep_tile' | 'footstep_concrete' | 'footstep_wet'
  | 'door_open' | 'door_close' | 'door_locked' | 'door_slam' | 'door_creak'
  | 'badge_ok' | 'badge_deny'
  | 'cart_roll' | 'wheelchair' | 'curtain' | 'bed_rail'
  | 'monitor_beep' | 'monitor_alarm' | 'monitor_flat' | 'monitor_off'
  | 'intercom_click' | 'intercom_chime' | 'intercom_static'
  | 'elevator_tone' | 'elevator_doors' | 'elevator_hum'
  | 'vending_drop' | 'vending_hum' | 'coin'
  | 'phone_buzz' | 'phone_unlock' | 'phone_tap'
  | 'paper' | 'pen' | 'typing' | 'keys' | 'clipboard'
  | 'light_flicker' | 'light_buzz' | 'light_pop' | 'light_on'
  | 'breaker_click' | 'breaker_thunk' | 'panel_open'
  | 'generator_start' | 'generator_fail' | 'power_down' | 'power_up' | 'transformer_hum'
  | 'static_burst' | 'cctv_switch' | 'cctv_offline'
  | 'drag' | 'knock' | 'knock_soft' | 'scratch' | 'bang' | 'metal_groan' | 'hvac_thump' | 'pipe_knock'
  | 'whisper' | 'name_call' | 'child_laugh' | 'cough' | 'voice_murmur' | 'breath' | 'gasp' | 'scream_distant'
  | 'rain_loop' | 'thunder' | 'water_drip' | 'faucet' | 'flush'
  | 'flashlight_click' | 'call_light' | 'heartbeat'
  | 'glass_tap' | 'glass_crack'
  | 'radio_click' | 'radio_voice'
  | 'ui_hover' | 'ui_select' | 'ui_back' | 'ui_open' | 'ui_close'
  | 'sting_low' | 'sting_high' | 'drone_rise' | 'silence_drop'
  | 'tv_murmur' | 'microwave' | 'coffee' | 'chair_creak' | 'sit' | 'stand';

export interface SfxOptions {
  pos?: Vec3;
  volume?: number;
  /** -1..1 stereo pan (ignored when pos is given) */
  pan?: number;
  rate?: number;
  loop?: boolean;
  /** seconds */
  fadeIn?: number;
  /** when true the sound is heard by the current view even if far away (UI / narrative) */
  nonSpatial?: boolean;
}

export interface SfxHandle {
  stop(fadeSeconds?: number): void;
  setPosition(pos: Vec3): void;
  setVolume(v: number): void;
  readonly playing: boolean;
}

export interface IAudioEngine extends System {
  /** Create/resume the AudioContext. Must be called from a user gesture. */
  unlock(): Promise<void>;
  readonly unlocked: boolean;
  setSoundState(s: SoundState): void;
  play(name: SfxName, opts?: SfxOptions): SfxHandle | null;
  /** Listener pose (the active camera). */
  setListener(pos: Vec3, yaw: number): void;
  /** Perception-driven filtering (John medicated = lowpass + slight detune; fear = heartbeat etc.). null = neutral (CCTV). */
  setPerception(p: PerceptionState | null, character: CharacterId | null): void;
  /** Room acoustics + room ambience mix. */
  setRoom(room: RoomId | null): void;
  /** CCTV monitoring mode: thin, compressed, mono-ish audio with hum. */
  setCCTVMode(on: boolean): void;
  setPowerState(p: PowerState): void;
  applySettings(s: Settings): void;
  /** Spoken intercom page: uses SpeechSynthesis when available (filtered, robotic) or a synthesized murmur fallback. Resolves when done. */
  intercom(text: string, opts?: { glitch?: boolean }): Promise<void>;
  /** Speech-like murmur from a position (no words). */
  murmur(pos: Vec3, seconds: number, opts?: { pitch?: number; whisper?: boolean }): SfxHandle | null;
  /** Continuous heartbeat (bpm; 0 = off). */
  setHeartbeat(bpm: number): void;
  /** Duck everything except UI for N seconds (blackout, jump). */
  duck(seconds: number, amount?: number): void;
  /** Hard silence (the scariest state). */
  silence(seconds: number): void;
  /** Music/drone layer intensity 0..1 (sound state sets a baseline; this is an offset). */
  setTension(t: number): void;
}

// ---------------------------------------------------------------------------
// Characters (player controller + NPC figures)
// ---------------------------------------------------------------------------

export type Outfit = 'scrubs' | 'patient' | 'workwear' | 'security' | 'clerk' | 'coat' | 'dark' | 'child' | 'paramedic';
export type FigureAnim = 'idle' | 'walk' | 'sit' | 'stand_still' | 'limp' | 'drag' | 'glitch' | 'lie' | 'work' | 'mop' | 'phone' | 'wrong_gait' | 'slow';

export interface FigureOptions {
  id?: string;
  pos: Vec3;
  yaw?: number;
  outfit: Outfit;
  anim?: FigureAnim;
  /** waypoints to walk (world x/z); figure is removed at the end unless `persist` */
  path?: Vec2[];
  speed?: number;
  /** seconds until auto-removal (0 = persistent) */
  duration?: number;
  /** which views can see it. Default: all. Use ['john'] for hallucination candidates, ['cctv'] for footage-only. */
  visibleTo?: ViewId[];
  /** 0..1 */
  opacity?: number;
  /** vanish when the viewer gets within this distance (metres) */
  vanishWithin?: number;
  /** vanish when the viewer looks away for > N seconds */
  vanishWhenUnseen?: number;
  /** face the viewer */
  faceViewer?: boolean;
  scale?: number;
}

export interface FigureHandle {
  readonly id: string;
  readonly object: THREE.Object3D;
  setAnim(anim: FigureAnim): void;
  walkTo(target: Vec2, speed?: number): Promise<void>;
  setVisibleTo(views: ViewId[]): void;
  /** true if the active view currently has this figure roughly in frame and unoccluded */
  isSeen(): boolean;
  remove(fade?: number): void;
  readonly removed: boolean;
}

export interface ICharacterSystem extends System {
  /** Character the player is controlling, or null in CCTV / cinematic. */
  readonly active: CharacterId | null;
  /** First-person camera (eye height). Also used as audio listener. */
  readonly camera: THREE.PerspectiveCamera;
  /** Take control of a character: camera attaches to them, their NPC body hides. */
  possess(id: CharacterId): void;
  /** Release control (CCTV / cinematic). Everyone becomes an NPC again. */
  release(): void;
  getState(id: CharacterId): CharacterState;
  teleport(id: CharacterId, pos: Vec3, yaw?: number): void;
  /** NPC navigation along the waypoint graph. Resolves true on arrival, false if blocked/cancelled. */
  walkTo(id: CharacterId, target: Vec2 | RoomId, opts?: { speed?: number; action?: string }): Promise<boolean>;
  /** Replace a character's baseline schedule (what they do while not controlled). */
  setSchedule(id: CharacterId, entries: ScheduleEntry[]): void;
  /** Set an NPC's idle action immediately (sit/stand/work/phone/lie). */
  setAction(id: CharacterId, action: string): void;
  /** Transient figure (anomalies, extra staff/patients). */
  spawnFigure(opts: FigureOptions): FigureHandle;
  getFigure(id: string): FigureHandle | undefined;
  /** Movement / look toggles (UI open, cinematic). */
  setMovementEnabled(enabled: boolean): void;
  setLookEnabled(enabled: boolean): void;
  /** Is the active view roughly looking at a point (within fovDeg, unoccluded by walls)? */
  canSee(target: Vec3, fovDeg?: number, maxDist?: number): boolean;
  /** Room containing a character. */
  roomOf(id: CharacterId): RoomId;
  /** Whether a character may pass a door right now (access + lock). */
  canPass(id: CharacterId, doorId: string): boolean;
  /** Head bob / camera shake amplitude multiplier (settings.motionEffects). */
  setMotionScale(scale: number): void;
  /** Play a brief scripted camera motion on the active character (e.g. look toward a point). */
  lookToward(target: Vec3, seconds: number): Promise<void>;
  /** Interaction reach from the active camera (metres). */
  readonly reach: number;
  /** All NPC bodies (incl. uncontrolled main characters) for occlusion / CCTV rendering. */
  setViewFilter(view: ViewId): void;
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

export interface Interactable {
  id: string;
  object: THREE.Object3D;
  room: RoomId;
  /** metres from the camera at which the prompt appears (default 2.2) */
  radius?: number;
  /** Prompt text for a character, e.g. "Open chart". Return null when this character cannot use it. */
  prompt(c: CharacterId): string | null;
  use(c: CharacterId): void | Promise<void>;
  enabled?: boolean;
  /** show the prompt even without looking directly at it (large objects) */
  loose?: boolean;
}

export interface IInteractionSystem extends System {
  register(i: Interactable): void;
  unregister(id: string): void;
  get(id: string): Interactable | undefined;
  /** The interactable currently targeted by the active camera. */
  current(): Interactable | null;
  /** Trigger the current interactable (bound to E). */
  trigger(): Promise<void>;
  setEnabled(enabled: boolean): void;
}

// ---------------------------------------------------------------------------
// CCTV
// ---------------------------------------------------------------------------

export type CCTVGlitch = 'static' | 'skip' | 'timestamp' | 'freeze' | 'tear' | 'rollback' | 'offline_blip';

export interface ICCTVSystem extends System {
  readonly active: boolean;
  readonly currentCamera: CameraDef | null;
  /** Enter surveillance mode on a camera (default: last used or first online). */
  enter(cameraId?: string): void;
  exit(): void;
  select(cameraId: string): void;
  next(): void;
  prev(): void;
  list(): CameraDef[];
  isOnline(cameraId: string): boolean;
  setOnline(cameraId: string, online: boolean): void;
  /** 0..1 global feed quality loss (grows with phases). */
  setDegradation(level: number): void;
  glitch(cameraId: string, kind: CCTVGlitch, seconds: number): void;
  /** Show something ONLY on this feed for N frames (e.g. a 2-frame silhouette). The callback receives the three scene before each injected render; return a cleanup. */
  inject(cameraId: string, frames: number, setup: (scene: THREE.Scene) => () => void): void;
  /** The three camera object for a feed (for rendering / canSee checks). */
  cameraObject(cameraId: string): THREE.PerspectiveCamera | undefined;
  /** Record a "clip" marker the player can later find (footage clue). */
  markFootage(cameraId: string, label: string): void;
  /** Render the active feed for this frame (handles injection, view filtering, and calls postfx.render in cctv mode). */
  renderFrame(): void;
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

export interface DocumentSection {
  heading?: string;
  lines: string[];
  /** 'mono' for terminal/chart tables, 'note' for handwriting-ish */
  style?: 'mono' | 'note' | 'normal' | 'warning' | 'redacted';
}

export interface DocumentSwitch {
  id: string;
  label: string;
  on: boolean;
  enabled: boolean;
  /** e.g. "12A" or "TRIPPED" */
  note?: string;
}

export interface DocumentView {
  kind: 'phone' | 'chart' | 'terminal' | 'panel' | 'note' | 'tag' | 'radio' | 'board' | 'monitor' | 'generator';
  title: string;
  subtitle?: string;
  sections: DocumentSection[];
  /** breaker-panel style toggles */
  switches?: DocumentSwitch[];
  onToggle?: (id: string, on: boolean) => void | DocumentSwitch[];
  /** choice buttons at the bottom; resolves with the chosen id */
  choices?: { id: string; label: string; hint?: string }[];
  /** phone: incoming messages appear with a delay */
  typing?: boolean;
}

export interface DialogueOption {
  id: string;
  label: string;
}

export interface HudState {
  clock: string;
  character: string;
  role: string;
  location: string;
  /** 0..1 subtle meters */
  stress: number;
  perception: number;
  prompt: string | null;
  flashlight: boolean | null;
  /** per-character warning level for the switcher/portraits 0..1 */
  warnings: Record<CharacterId, number>;
  view: ViewId;
}

export interface IUIManager extends System {
  showScreen(screen: Screen): void;
  /** Update HUD fields (cheap; call every frame). */
  setHud(patch: Partial<HudState>): void;
  /** Interaction prompt text (null hides). */
  setPrompt(text: string | null): void;
  subtitle(text: string, seconds?: number, speaker?: string): void;
  /** Big centered caption for cinematics (title cards). */
  caption(text: string, seconds: number, opts?: { sub?: string; style?: 'title' | 'time' | 'card' }): Promise<void>;
  /** Open a phone / chart / terminal / breaker panel. Resolves with the chosen choice id (or null when closed). */
  showDocument(doc: DocumentView): Promise<string | null>;
  /** Choice prompt (2–4 options) rendered as diegetic dialogue. */
  showChoice(prompt: string, options: DialogueOption[], opts?: { speaker?: string; timeoutSeconds?: number; defaultId?: string }): Promise<string>;
  openSwitcher(): void;
  closeSwitcher(): void;
  readonly switcherOpen: boolean;
  /** Briefly flash a switcher portrait / warning for a character. */
  warn(character: CharacterId, level: number, hint?: string): void;
  toast(text: string, seconds?: number): void;
  /** Ending screen with summary. Resolves when the player chooses an action. */
  showEnding(ending: EndingId, summary: { seed: string; clues: Clue[]; choices: { label: string; value: string }[]; missing: CharacterId[]; lines: string[] }): Promise<'new_night' | 'title'>;
  /** CCTV overlay (camera list, timestamp, REC). */
  setCCTVOverlay(p: { visible: boolean; cameras?: { id: string; name: string; online: boolean; active: boolean }[]; timestamp?: string; label?: string; online?: boolean }): void;
  /** Hide all UI for screenshots / cinematics. */
  setHudVisible(visible: boolean): void;
  /** Mobile touch controls visible */
  setTouchControls(visible: boolean): void;
  /** Whether a modal (document/choice/menu) is open. */
  readonly modalOpen: boolean;
  /** Set the objective hint (subtle, bottom-left). */
  setObjective(text: string | null): void;
}

// ---------------------------------------------------------------------------
// Cinematics
// ---------------------------------------------------------------------------

export interface Shot {
  /** camera start/end pose */
  from: { pos: Vec3; lookAt: Vec3 };
  to?: { pos: Vec3; lookAt: Vec3 };
  seconds: number;
  fov?: number;
  /** text card shown during this shot */
  caption?: { text: string; sub?: string; style?: 'title' | 'time' | 'card'; at?: number };
  /** hooks */
  onStart?: () => void;
  /** transition into this shot */
  transition?: TransitionKind;
  /** handheld shake 0..1 */
  shake?: number;
  /** ease name */
  ease?: 'linear' | 'inout' | 'out' | 'in';
}

export interface ICinematicSystem extends System {
  readonly playing: boolean;
  /** Play shots; resolves when finished or skipped. Locks input, hides HUD. */
  play(id: string, shots: Shot[], opts?: { skippable?: boolean; letterbox?: boolean }): Promise<void>;
  skip(): void;
  /** The camera used while playing (for the renderer). */
  readonly camera: THREE.PerspectiveCamera;
}

// ---------------------------------------------------------------------------
// Director (events / anomalies / story / endings)
// ---------------------------------------------------------------------------

export interface EventRunContext {
  s: Services;
  view: ViewId;
  /** game minutes */
  time: number;
  /** does the active view count as witnessing this event (right room / looking) */
  witnessed: boolean;
  /** convenience */
  rng: RNG;
}

export interface EventPresentation {
  /** Run the visual/audio presentation for this perspective. */
  run: (ctx: EventRunContext) => void | Promise<void>;
  subtitle?: string;
}

export interface GameEventDef {
  id: string;
  title: string;
  /** game-minute window [start, end] during which it may fire */
  window: [number, number];
  /** scenarios where this event can occur */
  scenarios: import('./types').ScenarioType[] | 'all';
  /** scenarios where the event is OBJECTIVELY real (used for ending evaluation / CCTV truth) */
  realIn?: import('./types').ScenarioType[];
  room: RoomId;
  /** characters for whom this is relevant (used for danger / witness logic) */
  characters: CharacterId[];
  /** fires even if nobody is watching */
  offscreen: boolean;
  /** 0..1 seeded chance it is scheduled at all (default 1) */
  chance?: number;
  /** ordering preference when windows overlap */
  priority?: number;
  /** extra preconditions */
  requires?: (s: Services) => boolean;
  /** per-perspective presentation; 'truth' used by CCTV when the event is real; 'any' as fallback */
  presentation: Partial<Record<ViewId | 'truth' | 'any', EventPresentation>>;
  /** applied whenever it fires */
  consequences?: (ctx: EventRunContext) => void;
  /** applied if it fired while the player was NOT witnessing */
  missedConsequences?: (ctx: EventRunContext) => void;
  tags?: string[];
}

export interface IEventDirector extends System {
  readonly phase: GamePhase;
  /** Build the night's schedule from the seed and begin. */
  start(): void;
  /** Force an event now (debug / scripted). */
  fire(eventId: string): Promise<void>;
  /** Scheduled (id, minute) pairs for debug overlay. */
  schedule(): { id: string; at: number }[];
  /** Decide the ending from state. */
  evaluateEnding(): EndingId;
  /** Human-readable summary lines for the ending screen. */
  endingSummary(ending: EndingId): string[];
  /** Objective text for a character right now. */
  objectiveFor(c: CharacterId): string | null;
}

export type { Vec2, Vec3, Rect, Clue, RoomId, CharacterId, ViewId, PowerState, SoundState, GamePhase, EndingId, ZoneId };
