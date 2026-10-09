/**
 * The extra people in the building: Marcus at registration, Mr. Haddad coughing in the waiting
 * room until his discharge, Mrs. Alvarez and Mr. Okafor in their bays, Ray the guard walking the
 * hallway every quarter hour until the lights go, and the two paramedics who pull away at 23:00.
 * Everything here is background texture — the ordinary life of the wing the anomalies subtract from.
 */
import type { FaceKind, FigureHandle, Services } from '../core/contracts';
import type { RNG } from '../core/rng';
import type { PowerState, Vec2, Vec3 } from '../core/types';
import { yawToward } from '../story/schedules';
import { F } from './Director.ids';

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const WEST = Math.PI / 2;

const AMBULANCE_REAR: Vec2 = { x: -26.6, z: -3.3 };
const HADDAD_SEAT = v3(-11.9, 0, -4.2);
const OKAFOR_BED = v3(-3.3, 0, 4.1);
const ALVAREZ_BED = v3(-12.9, 0, 4.1);
const MARCUS_POS = v3(-9.0, 0, -1.95);

const wait = (seconds: number): Promise<void> => new Promise((r) => setTimeout(r, seconds * 1000));

export class NpcCast {
  private figures = new Map<string, FigureHandle>();
  private coughIn: number;
  private typingIn: number;
  private rayNextAt: number;
  private rayCount = 0;
  private rayBusy = false;
  private medicsLeaving = false;
  private haddadLeaving = false;
  private okaforBusy = false;
  private dark = false;
  private disposed = false;

  constructor(private readonly s: Services, private readonly rng: RNG) {
    this.coughIn = rng.range(6, 16);
    this.typingIn = rng.range(3, 9);
    this.rayNextAt = 7 + rng.range(0, 4);
  }

  // ---------------------------------------------------------------------------
  // Spawning
  // ---------------------------------------------------------------------------

  spawnAll(): void {
    this.removeAll();
    this.add('npc_marcus', { pos: MARCUS_POS, yaw: 0, outfit: 'clerk', anim: 'work' });
    this.add('npc_haddad', { pos: HADDAD_SEAT, yaw: 0, outfit: 'patient', anim: 'sit' });
    // lying figures put their head toward local -z, so yaw pi lays them head-to-wall in beds whose head is +z
    this.add('npc_alvarez', { pos: ALVAREZ_BED, yaw: Math.PI, outfit: 'patient', anim: 'lie', face: 'soft' });
    this.add('npc_okafor', { pos: OKAFOR_BED, yaw: Math.PI, outfit: 'patient', anim: 'lie' });
    const medicA = v3(-25.8, 0, -2.6);
    const medicB = v3(-27.5, 0, -2.9);
    this.add('npc_medic_a', { pos: medicA, yaw: yawToward({ x: medicA.x, z: medicA.z }, AMBULANCE_REAR), outfit: 'paramedic', anim: 'work' });
    this.add('npc_medic_b', { pos: medicB, yaw: yawToward({ x: medicB.x, z: medicB.z }, AMBULANCE_REAR), outfit: 'paramedic', anim: 'idle' });
  }

  private add(id: string, opts: { pos: Vec3; yaw: number; outfit: 'clerk' | 'patient' | 'paramedic' | 'security' | 'workwear' | 'dark'; anim: 'work' | 'sit' | 'lie' | 'idle' | 'walk' | 'slow' | 'stand_still'; face?: FaceKind }): FigureHandle | null {
    try {
      const h = this.s.characters.spawnFigure({ id, pos: opts.pos, yaw: opts.yaw, outfit: opts.outfit, anim: opts.anim, duration: 0, face: opts.face });
      this.figures.set(id, h);
      return h;
    } catch (err) {
      console.error('[director] spawnFigure failed', id, err);
      return null;
    }
  }

  get(id: string): FigureHandle | undefined {
    const h = this.figures.get(id);
    return h && !h.removed ? h : undefined;
  }

  // ---------------------------------------------------------------------------
  // Per-frame life
  // ---------------------------------------------------------------------------

  update(dt: number, time: number, power: PowerState): void {
    if (this.disposed) return;
    const lit = power === 'normal' || power === 'unstable';

    const haddad = this.get('npc_haddad');
    if (haddad && !this.haddadLeaving) {
      this.coughIn -= dt;
      if (this.coughIn <= 0) {
        this.coughIn = this.rng.range(14, 34);
        this.s.audio.play('cough', { pos: v3(HADDAD_SEAT.x, 1.2, HADDAD_SEAT.z), volume: 0.45, rate: this.rng.range(0.92, 1.06) });
      }
    }

    if (this.get('npc_marcus') && lit) {
      this.typingIn -= dt;
      if (this.typingIn <= 0) {
        this.typingIn = this.rng.range(7, 18);
        this.s.audio.play('typing', { pos: v3(-9.0, 1.0, -2.3), volume: 0.3 });
      }
    }

    if (!this.medicsLeaving && time >= 15) {
      this.medicsLeaving = true;
      void this.ambulanceLeaves();
    }
    if (!this.haddadLeaving && time >= 35) {
      this.haddadLeaving = true;
      void this.dischargeHaddad();
    }
    if (!this.rayBusy && lit && time >= this.rayNextAt && time < 78) {
      this.rayBusy = true;
      this.rayNextAt = time + 13 + this.rng.range(0, 5);
      void this.rayPatrol();
    }
  }

  /** The lights are gone: Ray is too, and Marcus is a face lit by a phone. */
  onBlackout(): void {
    this.dark = true;
    for (const [id, h] of this.figures) {
      if (id.startsWith('npc_ray') && !h.removed) h.remove(0.5);
    }
    this.get('npc_marcus')?.setAnim('phone');
  }

  // ---------------------------------------------------------------------------
  // Sequences
  // ---------------------------------------------------------------------------

  private async walk(h: FigureHandle | undefined, to: Vec2, speed?: number): Promise<boolean> {
    if (!h || h.removed || this.disposed) return false;
    try {
      await h.walkTo(to, speed);
      return !h.removed;
    } catch {
      return false;
    }
  }

  private async ambulanceLeaves(): Promise<void> {
    const s = this.s;
    const a = this.get('npc_medic_a');
    const b = this.get('npc_medic_b');
    a?.setAnim('walk');
    b?.setAnim('walk');
    await Promise.all([this.walk(a, { x: -26.2, z: -3.6 }, 1.1), this.walk(b, { x: -27.1, z: -3.7 }, 1.1)]);
    a?.remove(0.5);
    b?.remove(0.5);
    const rear = v3(AMBULANCE_REAR.x, 1.2, AMBULANCE_REAR.z);
    s.audio.play('door_slam', { pos: rear, volume: 0.55 });
    await wait(0.9);
    s.audio.play('door_slam', { pos: rear, volume: 0.5, rate: 0.95 });
    await wait(1.4);
    if (this.disposed) return;
    // diesel turning over, then the box van rolls south out of the lot and is gone
    s.audio.play('generator_start', { pos: v3(-27, 0.8, -6.5), volume: 0.18, rate: 0.72 });
    await wait(1.6);
    if (this.disposed) return;
    try {
      await s.world.moveProp('ext_ambulance', v3(-29.5, 0, -42), 0.32, 20);
    } catch {
      /* world may refuse; the flag still records the departure */
    }
    s.store.setFlag(F.ambulance_left);
  }

  private async dischargeHaddad(): Promise<void> {
    const s = this.s;
    const h = this.get('npc_haddad');
    if (!h) {
      s.store.setFlag(F.haddad_left);
      return;
    }
    const st = s.store.get();
    const watching =
      (st.activeView === 'john' && st.characters.john.location === 'waiting') ||
      (st.activeView === 'cctv' && st.activeCamera === 'cam_waiting');
    if (watching) s.ui.subtitle("Mr. Haddad? You're all set. Take care of that cough.", 3.2, 'Marcus');
    s.audio.play('paper', { pos: v3(-9.3, 1.0, -2.6), volume: 0.3 });
    await wait(1.2);
    h.setAnim('walk');
    if (!(await this.walk(h, { x: -11.9, z: -5.1 }, 1.0))) return;
    if (!(await this.walk(h, { x: -18.8, z: -5.1 }, 1.0))) return;
    s.world.setDoorLocked('d_entrance', false);
    await s.world.setDoorOpen('d_entrance', true);
    if (!(await this.walk(h, { x: -19.9, z: -6 }, 0.9))) return;
    await this.walk(h, { x: -22.6, z: -6 }, 1.0);
    void s.world.setDoorOpen('d_entrance', false);
    s.world.setDoorLocked('d_entrance', true);
    await this.walk(h, { x: -27, z: -11 }, 1.1);
    h.remove(1.2);
    s.store.setFlag(F.haddad_left);
  }

  private async rayPatrol(): Promise<void> {
    const s = this.s;
    const id = `npc_ray_${this.rayCount++}`;
    const ray = this.add(id, { pos: v3(21.4, 0, 0.6), yaw: WEST, outfit: 'security', anim: 'walk' });
    if (!ray) {
      this.rayBusy = false;
      return;
    }
    const finish = (): void => {
      if (!ray.removed) ray.remove(0.4);
      this.figures.delete(id);
      this.rayBusy = false;
    };
    try {
      await s.world.setDoorOpen('d_service', true);
      s.audio.play('keys', { pos: v3(20.4, 1.0, 0.3), volume: 0.3 });
      if (!(await this.walk(ray, { x: 19.2, z: 0.3 }, 1.1))) return finish();
      void s.world.setDoorOpen('d_service', false);
      if (!(await this.walk(ray, { x: -18.3, z: 0.3 }, 1.1))) return finish();
      if (this.dark) return finish();
      ray.setAnim('idle');
      await wait(2 + this.rng.range(0, 2.5));
      if (this.dark || ray.removed) return finish();
      ray.setAnim('walk');
      if (!(await this.walk(ray, { x: 19.2, z: 0.3 }, 1.15))) return finish();
      await s.world.setDoorOpen('d_service', true);
      await this.walk(ray, { x: 21.6, z: 0.8 }, 1.1);
      void s.world.setDoorOpen('d_service', false);
    } catch (err) {
      console.error('[director] ray patrol failed', err);
    }
    finish();
  }

  /**
   * Mr. Okafor wanders: he gets up and shuffles through the hallway, either back to his bay
   * (the grounded source of the 23:45 figure) or out to stand confused by the east hall until
   * someone walks him back. Resolves with the walking figure for witness checks (null if busy).
   */
  async okaforWander(mode: 'back_to_bed' | 'out_to_hall'): Promise<FigureHandle | null> {
    if (this.okaforBusy || this.disposed) return null;
    this.okaforBusy = true;
    const s = this.s;
    const lying = this.get('npc_okafor');
    lying?.remove(0);
    this.figures.delete('npc_okafor');
    const start = mode === 'back_to_bed' ? v3(16.8, 0, 0.3) : v3(-3.3, 0, 3.6);
    const walker = this.add('npc_okafor_walk', { pos: start, yaw: WEST, outfit: 'patient', anim: 'slow' });
    if (!walker) {
      this.okaforBusy = false;
      return null;
    }
    void (async () => {
      try {
        if (mode === 'out_to_hall') {
          await s.world.setDoorOpen('d_exam4', true);
          await this.walk(walker, { x: -3.7, z: 2.3 }, 0.5);
          await this.walk(walker, { x: -3.7, z: 0.4 }, 0.5);
          void s.world.setDoorOpen('d_exam4', false);
          await this.walk(walker, { x: 3.2, z: 0.5 }, 0.5);
          walker.setAnim('idle');
          // stands there until Susie (or anyone) gets close, or four game-minutes pass
          const until = s.store.get().time + 4;
          while (!walker.removed && !this.disposed && s.store.get().time < until) {
            const near = (['susie', 'paul', 'john'] as const).some((c) => {
              const p = s.store.char(c).position;
              return Math.hypot(p.x - 3.2, p.z - 0.5) < 2.2 && s.store.char(c).location === 'corridor';
            });
            if (near) break;
            await wait(0.5);
          }
          if (walker.removed || this.disposed) return;
          walker.setAnim('slow');
          await this.walk(walker, { x: -3.7, z: 0.4 }, 0.5);
        } else {
          await this.walk(walker, { x: -3.7, z: 0.5 }, 0.55);
        }
        await s.world.setDoorOpen('d_exam4', true);
        await this.walk(walker, { x: -3.7, z: 2.3 }, 0.5);
        await this.walk(walker, { x: -3.3, z: 3.6 }, 0.45);
        void s.world.setDoorOpen('d_exam4', false);
      } catch (err) {
        console.error('[director] okafor wander failed', err);
      }
      if (!walker.removed) walker.remove(0);
      this.figures.delete('npc_okafor_walk');
      if (!this.disposed) this.add('npc_okafor', { pos: OKAFOR_BED, yaw: Math.PI, outfit: 'patient', anim: 'lie' });
      this.okaforBusy = false;
    })();
    return walker;
  }

  /** Mrs. Alvarez says something from her bed. */
  alvarezMurmur(seconds = 2.4): void {
    this.s.audio.murmur(v3(ALVAREZ_BED.x, 0.9, ALVAREZ_BED.z), seconds, { pitch: 1.12 });
  }

  // ---------------------------------------------------------------------------

  private removeAll(): void {
    for (const h of this.figures.values()) {
      if (!h.removed) h.remove(0);
    }
    this.figures.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.removeAll();
  }
}
