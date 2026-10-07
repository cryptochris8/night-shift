/**
 * Shot lists for the cinematics (CONTRACT §5 Opening and the four endings).
 * Camera poses are world metres (see world/layout.ts); hooks fire sounds, poses and lighting as
 * each shot begins. Everything spawned here is removed by `cleanupCinematicScene`.
 */
import { formatClock12, formatClock24 } from '../core/clock';
import type { FigureHandle, Services, Shot } from '../core/contracts';
import type { CharacterId, EndingId, RoomId, Vec3 } from '../core/types';
import { Silhouette } from './Director.silhouette';
import { missingCharacter, missingWhen, missingWhere } from './endings';

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** Transient scene content owned by the running cinematic. */
const transient: { figures: FigureHandle[]; silhouettes: Silhouette[]; cctvLook: boolean } = {
  figures: [],
  silhouettes: [],
  cctvLook: false,
};

function cctvLook(s: Services, label: string, timestamp: string, degradation = 0.55): void {
  transient.cctvLook = true;
  s.postfx.setMode('cctv');
  s.postfx.setCCTVParams({ degradation, online: true, label, timestamp, recording: true });
  s.ui.setCCTVOverlay({ visible: true, label, timestamp, online: true });
}

function worldLook(s: Services): void {
  if (!transient.cctvLook) return;
  transient.cctvLook = false;
  s.postfx.setMode('world');
  s.ui.setCCTVOverlay({ visible: false });
}

function silhouetteAt(s: Services, pos: Vec3, yaw: number, height = 1.9): Silhouette {
  const sil = new Silhouette(height).place(pos, yaw);
  s.three.scene.add(sil.group);
  transient.silhouettes.push(sil);
  return sil;
}

/** Remove figures, silhouettes and the CCTV look left behind by a cinematic. */
export function cleanupCinematicScene(s: Services): void {
  for (const f of transient.figures) if (!f.removed) f.remove(0);
  transient.figures = [];
  for (const sil of transient.silhouettes) sil.dispose();
  transient.silhouettes = [];
  worldLook(s);
  const cctv = s.cctv as { setTimestampOverride?: (cameraId: string, text: string | null) => void };
  cctv.setTimestampOverride?.('cam_hall_e', null);
}

// ---------------------------------------------------------------------------
// Opening (~45 s)
// ---------------------------------------------------------------------------

export function introShots(s: Services): Shot[] {
  const P = s.layout.points;
  const sign = P.canopy_sign;
  const ambulance = P.ambulance;
  // seated eye height: control begins with John still in his chair (he stands on the first step)
  const johnEye = v3(-13.1, 1.2, -4.2);

  return [
    {
      // exterior wide in the rain
      from: { pos: v3(-31.5, 2.4, -11.5), lookAt: v3(sign.x, sign.y - 0.6, sign.z) },
      to: { pos: v3(-28.4, 2.1, -9.2), lookAt: v3(sign.x, sign.y - 0.8, sign.z + 0.4) },
      seconds: 5.5,
      fov: 46,
      shake: 0.18,
      ease: 'inout',
      transition: 'fade_in',
      onStart: () => {
        s.world.setRain(0.85);
        s.audio.setRoom('exterior');
        s.audio.play('thunder', { pos: v3(-60, 20, 40), volume: 0.35, rate: 0.8 });
      },
    },
    {
      // the canopy sign
      from: { pos: v3(-24.2, 3.4, -7.2), lookAt: v3(sign.x, sign.y, sign.z) },
      to: { pos: v3(-23.4, 3.7, -6.2), lookAt: v3(sign.x, sign.y + 0.2, sign.z) },
      seconds: 4.2,
      fov: 38,
      shake: 0.12,
      transition: 'cut',
    },
    {
      // slow push on the ambulance; two paramedics unloading nothing
      from: { pos: v3(-23.2, 1.5, -1.2), lookAt: v3(ambulance.x, 1.1, ambulance.z) },
      to: { pos: v3(-24.8, 1.4, -2.9), lookAt: v3(ambulance.x + 0.3, 1.0, ambulance.z + 2.4) },
      seconds: 5.5,
      fov: 44,
      shake: 0.22,
      transition: 'cut',
      onStart: () => {
        s.audio.play('door_creak', { pos: v3(-26.6, 1.2, -3.3), volume: 0.35, rate: 0.9 });
      },
    },
    {
      // inside: the waiting room clock
      from: { pos: v3(-10.6, 2.0, -6.6), lookAt: v3(P.waiting_clock.x, P.waiting_clock.y, P.waiting_clock.z) },
      to: { pos: v3(-9.7, 2.05, -5.3), lookAt: v3(P.waiting_clock.x, P.waiting_clock.y - 0.1, P.waiting_clock.z) },
      seconds: 3.4,
      fov: 34,
      shake: 0.06,
      transition: 'cut',
      onStart: () => {
        s.audio.setRoom('waiting');
        s.audio.play('tv_murmur', { pos: P.tv, volume: 0.25, loop: false });
      },
    },
    {
      // John, second row, on his phone
      from: { pos: v3(-15.4, 1.45, -6.4), lookAt: v3(johnEye.x, 1.15, johnEye.z) },
      to: { pos: v3(-14.5, 1.38, -5.7), lookAt: v3(johnEye.x, 1.2, johnEye.z) },
      seconds: 4.8,
      fov: 42,
      shake: 0.2,
      transition: 'cut',
      onStart: () => {
        s.characters.setAction('john', 'phone');
        s.audio.play('cough', { pos: v3(-11.9, 1.2, -4.2), volume: 0.4 });
      },
    },
    {
      // registration desk, Marcus typing
      from: { pos: v3(-11.6, 1.6, -5.3), lookAt: v3(-9.0, 1.3, -2.1) },
      to: { pos: v3(-10.9, 1.55, -4.6), lookAt: v3(-9.0, 1.25, -2.0) },
      seconds: 3.8,
      fov: 40,
      shake: 0.15,
      transition: 'cut',
      onStart: () => {
        s.audio.play('typing', { pos: v3(-9.0, 1.0, -2.3), volume: 0.35 });
      },
    },
    {
      // Susie badges in through the ambulance doors, phone to her ear
      from: { pos: v3(-16.3, 1.6, 0.5), lookAt: v3(-19.6, 1.5, 0) },
      to: { pos: v3(-17.0, 1.6, 0.4), lookAt: v3(-18.8, 1.5, 0) },
      seconds: 3.6,
      fov: 44,
      shake: 0.22,
      transition: 'cut',
      onStart: () => {
        s.audio.setRoom('corridor');
        s.audio.play('badge_ok', { pos: v3(-19.9, 1.2, 0.8), volume: 0.5 });
        void s.world.setDoorOpen('d_ambulance', true);
        s.characters.setAction('susie', 'phone');
        s.ui.subtitle("Yeah. Yeah, I'm here. Who called out?", 3.2, 'Susie');
      },
    },
    {
      from: { pos: v3(-17.0, 1.6, 0.4), lookAt: v3(-18.6, 1.5, 0) },
      to: { pos: v3(-17.4, 1.58, 0.35), lookAt: v3(-18.3, 1.5, -0.1) },
      seconds: 3.0,
      fov: 44,
      shake: 0.22,
      onStart: () => {
        s.ui.subtitle('…Dana. Okay.', 2.4, 'Susie');
        void s.world.setDoorOpen('d_ambulance', false);
      },
    },
    {
      // Paul in the service corridor under a flickering strip light
      from: { pos: v3(14.2, 1.5, 7.3), lookAt: v3(8.5, 1.2, 7.0) },
      to: { pos: v3(12.3, 1.5, 7.15), lookAt: v3(8.5, 1.1, 6.95) },
      seconds: 5.2,
      fov: 46,
      shake: 0.2,
      transition: 'cut',
      onStart: () => {
        s.audio.setRoom('service_n');
        s.lighting.setFixture('service_n_strip_5', 'flicker', 6);
        s.audio.play('light_buzz', { pos: v3(11, 2.5, 7), volume: 0.4 });
        s.characters.setAction('paul', 'work');
        s.audio.play('cart_roll', { pos: v3(10, 0.5, 7.2), volume: 0.35 });
      },
    },
    {
      // title cards over the dark west wing door
      from: { pos: v3(-14.2, 1.6, 7.0), lookAt: v3(-11.3, 1.2, 7.0) },
      seconds: 3.4,
      fov: 50,
      transition: 'fade_black',
      caption: { text: 'NIGHT SHIFT', style: 'title', at: 0.4 },
      onStart: () => {
        s.audio.setRoom(null);
      },
    },
    {
      from: { pos: v3(-14.2, 1.6, 7.0), lookAt: v3(-11.3, 1.2, 7.0) },
      seconds: 2.8,
      fov: 50,
      transition: 'cut',
      caption: { text: '10:47 PM', style: 'time', at: 0.2 },
    },
    {
      // John's eyes open on the waiting room — exactly the first-person pose control begins from
      from: { pos: johnEye, lookAt: v3(johnEye.x, 1.45, -9.8) },
      to: { pos: johnEye, lookAt: v3(johnEye.x, 1.55, -9.8) },
      seconds: 1.9,
      fov: 70,
      ease: 'out',
      transition: 'fade_black',
      onStart: () => {
        s.audio.setRoom('waiting');
        // take John now so his own body is hidden before the camera sits inside his head
        s.characters.setAction('john', 'sit');
        s.characters.possess('john');
        s.characters.setViewFilter('john');
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Endings (3–5 shots each)
// ---------------------------------------------------------------------------

const CAM_LOOK: Record<string, { pos: Vec3; lookAt: Vec3; fov: number }> = {
  cam_hall_w: { pos: v3(-19.6, 2.55, 1.2), lookAt: v3(0, 1.1, 0), fov: 58 },
  cam_hall_e: { pos: v3(19.6, 2.55, -1.2), lookAt: v3(0, 1.1, 0.1), fov: 58 },
  cam_station: { pos: v3(3.7, 2.6, -5.3), lookAt: v3(-1, 1.0, -1.6), fov: 66 },
  cam_generator: { pos: v3(17.6, 3.2, 13.6), lookAt: v3(12, 1.0, 9.5), fov: 64 },
};

function roomCamera(room: RoomId): { pos: Vec3; lookAt: Vec3; fov: number; label: string } {
  switch (room) {
    case 'generator':
      return { ...CAM_LOOK.cam_generator, label: 'CAM 08 — GENERATOR' };
    case 'nurse_station':
      return { ...CAM_LOOK.cam_station, label: 'CAM 04 — NURSE STN' };
    case 'closed_wing':
      return { pos: v3(-12.2, 2.4, 6.2), lookAt: v3(-18, 1.0, 7.2), fov: 60, label: 'CAM 09 — WEST WING' };
    case 'corridor':
      return { ...CAM_LOOK.cam_hall_w, label: 'CAM 02 — WEST HALL' };
    case 'exam3':
    default:
      return { pos: v3(-5.95, 2.65, 5.45), lookAt: v3(-7.4, 0.75, 3.6), fov: 62, label: 'CAM 11 — BAY 3' };
  }
}

const OUTFIT: Record<CharacterId, 'patient' | 'scrubs' | 'workwear'> = { john: 'patient', susie: 'scrubs', paul: 'workwear' };

export function endingShots(s: Services, ending: EndingId): Shot[] {
  const st = s.store.get();
  const hallClock = v3(0, 2.4, -1.38);
  const clockShot = (seconds: number, caption?: Shot['caption']): Shot => ({
    from: { pos: v3(0.7, 1.5, 0.7), lookAt: hallClock },
    to: { pos: v3(0.25, 1.55, 0.25), lookAt: hallClock },
    seconds,
    fov: 38,
    shake: 0.05,
    transition: 'cut',
    caption,
    onStart: () => worldLook(s),
  });

  switch (ending) {
    case 'morning': {
      return [
        {
          from: { pos: v3(-31.5, 2.6, -11.5), lookAt: v3(-21, 2.4, -3) },
          to: { pos: v3(-28.6, 2.4, -9.0), lookAt: v3(-20.6, 2.6, -3.5) },
          seconds: 6,
          fov: 46,
          shake: 0.1,
          transition: 'fade_in',
          caption: { text: '6:12 AM', style: 'time', at: 0.9 },
          onStart: () => {
            s.lighting.setPowerState('normal');
            s.lighting.setDawn(0.45);
            s.world.setRain(0.12);
            s.audio.setRoom('exterior');
            s.audio.setSoundState('RESOLUTION');
          },
        },
        {
          from: { pos: v3(-19.2, 1.6, 0.25), lookAt: v3(12, 1.2, 0) },
          to: { pos: v3(-16.2, 1.6, 0.1), lookAt: v3(12, 1.1, 0.1) },
          seconds: 6,
          fov: 50,
          shake: 0.06,
          transition: 'fade_black',
          onStart: () => {
            s.lighting.setDawn(0.7);
            s.audio.setRoom('corridor');
          },
        },
        {
          from: { pos: v3(-6.3, 1.5, -0.5), lookAt: v3(-7.7, 1.2, 3.6) },
          to: { pos: v3(-7.1, 1.5, 0.5), lookAt: v3(-7.5, 1.0, 4.0) },
          seconds: 5,
          fov: 44,
          shake: 0.08,
          transition: 'cut',
          onStart: () => {
            s.lighting.setDawn(0.9);
            void s.world.setDoorOpen('d_exam3', true);
          },
        },
        clockShot(4),
      ];
    }

    case 'missing': {
      const who = missingCharacter(st) ?? 'john';
      const where = missingWhere(st, who);
      const when = missingWhen(st, who);
      const cam = roomCamera(where);
      const c = st.characters[who];
      const lastPos: Vec3 = where === c.location ? { ...c.position, y: 0 } : roomCentre(s, where);
      return [
        {
          from: { pos: cam.pos, lookAt: cam.lookAt },
          seconds: 6,
          fov: cam.fov,
          shake: 0.03,
          transition: 'monitor_on',
          onStart: () => {
            s.audio.setSoundState('RESOLUTION');
            cctvLook(s, cam.label, formatClock24(when + 0.4));
          },
        },
        {
          from: { pos: CAM_LOOK.cam_hall_w.pos, lookAt: CAM_LOOK.cam_hall_w.lookAt },
          seconds: 4.5,
          fov: CAM_LOOK.cam_hall_w.fov,
          shake: 0.03,
          transition: 'static',
          onStart: () => cctvLook(s, 'CAM 02 — WEST HALL', formatClock24(when + 2.1), 0.65),
        },
        {
          from: { pos: cam.pos, lookAt: cam.lookAt },
          seconds: 4,
          fov: cam.fov,
          shake: 0.03,
          transition: 'static',
          caption: { text: c.name.toUpperCase(), sub: `LAST SEEN ${formatClock12(when)}`, style: 'card', at: 0.9 },
          onStart: () => {
            cctvLook(s, cam.label, formatClock24(when - 0.05), 0.72);
            try {
              const f = s.characters.spawnFigure({ id: 'ending_last_frame', pos: lastPos, yaw: c.yaw, outfit: OUTFIT[who], anim: 'stand_still', duration: 0 });
              transient.figures.push(f);
            } catch (err) {
              console.error('[director] ending figure failed', err);
            }
          },
        },
        {
          from: { pos: v3(-9.2, 1.6, 7.0), lookAt: v3(-11.3, 1.2, 7.0) },
          seconds: 2.6,
          fov: 50,
          transition: 'static',
          onStart: () => {
            worldLook(s);
            for (const f of transient.figures) if (!f.removed) f.remove(0);
            s.audio.play('silence_drop', { nonSpatial: true, volume: 0.6 });
          },
        },
      ];
    }

    case 'rational': {
      const cctv = s.cctv as { setTimestampOverride?: (cameraId: string, text: string | null) => void };
      return [
        {
          from: { pos: v3(16.6, 1.4, 9.5), lookAt: v3(15.9, 1.1, 10.8) },
          to: { pos: v3(16.3, 1.35, 10.0), lookAt: v3(15.9, 1.1, 10.8) },
          seconds: 4.5,
          fov: 40,
          shake: 0.08,
          transition: 'fade_in',
          onStart: () => {
            s.lighting.setPowerState('normal');
            s.audio.setRoom('generator');
            s.audio.setSoundState('RESOLUTION');
          },
        },
        {
          from: { pos: v3(0.9, 1.5, 3.3), lookAt: v3(-1.25, 1.2, 4.2) },
          to: { pos: v3(0.3, 1.45, 3.8), lookAt: v3(-1.25, 1.15, 4.2) },
          seconds: 4,
          fov: 42,
          shake: 0.08,
          transition: 'cut',
          onStart: () => s.audio.setRoom('med_room'),
        },
        {
          from: { pos: v3(-4.4, 1.5, 6.3), lookAt: v3(-6, 0.1, 7) },
          to: { pos: v3(-5.2, 1.3, 6.6), lookAt: v3(-6, 0.05, 7) },
          seconds: 4,
          fov: 44,
          shake: 0.08,
          transition: 'cut',
          onStart: () => {
            s.audio.setRoom('service_n');
            s.audio.play('water_drip', { pos: v3(-6, 0.1, 7), volume: 0.5 });
          },
        },
        {
          from: { pos: CAM_LOOK.cam_hall_e.pos, lookAt: CAM_LOOK.cam_hall_e.lookAt },
          seconds: 5.5,
          fov: CAM_LOOK.cam_hall_e.fov,
          shake: 0.03,
          transition: 'static',
          caption: { text: '06:12:40', sub: 'CAM 03 — EAST HALL', style: 'time', at: 1.6 },
          onStart: () => {
            cctv.setTimestampOverride?.('cam_hall_e', '06:12:40');
            cctvLook(s, 'CAM 03 — EAST HALL', '06:12:40', 0.5);
          },
        },
        clockShot(3.6, { text: '01:44', sub: 'PATIENT HALLWAY', style: 'time', at: 0.5 }),
      ];
    }

    case 'came_through': {
      const figurePos = v3(17.5, 0, 0.3);
      let sil: Silhouette | null = null;
      return [
        {
          from: { pos: v3(-8.4, 1.5, 6.55), lookAt: v3(-11.3, 1.2, 7.0) },
          to: { pos: v3(-9.9, 1.45, 6.8), lookAt: v3(-11.6, 1.1, 7.0) },
          seconds: 5.5,
          fov: 46,
          shake: 0.1,
          transition: 'fade_in',
          onStart: () => {
            s.audio.setRoom('service_n');
            s.audio.setSoundState('RESOLUTION');
            s.world.setDoorLocked('d_closed_wing', false);
            void s.world.setDoorOpen('d_closed_wing', true);
            s.audio.play('water_drip', { pos: v3(-13, 0.1, 7), volume: 0.45 });
          },
        },
        {
          from: { pos: v3(2.6, 0.95, 6.2), lookAt: v3(8.5, 0.05, 7.3) },
          to: { pos: v3(4.4, 0.85, 6.4), lookAt: v3(9.5, 0.05, 7.6) },
          seconds: 4.5,
          fov: 46,
          shake: 0.08,
          transition: 'cut',
          onStart: () => {
            s.world.addFloorDecal(
              'drag',
              [
                { x: -10.6, z: 7.0 },
                { x: -4, z: 7.1 },
                { x: 2, z: 7.0 },
                { x: 7, z: 7.15 },
                { x: 10.6, z: 7.4 },
                { x: 11.1, z: 8.7 },
                { x: 12.4, z: 9.8 },
              ],
              { fadeAfter: 60 },
            );
          },
        },
        {
          from: { pos: v3(14.7, 1.5, -0.5), lookAt: v3(16, 1.2, -2.4) },
          to: { pos: v3(15.3, 1.45, -1.0), lookAt: v3(16, 1.15, -2.5) },
          seconds: 4.5,
          fov: 44,
          shake: 0.1,
          transition: 'static',
          onStart: () => {
            s.audio.setRoom('corridor');
            void s.world.setElevator(true, false);
            sil = silhouetteAt(s, v3(16, 0, -2.5), 0);
            s.audio.play('sting_low', { nonSpatial: true, volume: 0.55 });
          },
        },
        {
          from: { pos: v3(-2.5, 1.6, 0.0), lookAt: v3(figurePos.x, 1.1, figurePos.z) },
          to: { pos: v3(-1.2, 1.6, 0.0), lookAt: v3(figurePos.x, 1.05, figurePos.z) },
          seconds: 4,
          fov: 48,
          shake: 0.07,
          transition: 'cut',
          onStart: () => {
            if (sil) sil.place(figurePos, Math.PI / 2);
          },
        },
        {
          from: { pos: v3(-1.2, 1.6, 0.0), lookAt: v3(figurePos.x, 1.05, figurePos.z) },
          seconds: 1.6,
          fov: 48,
          shake: 0.07,
          transition: 'flicker',
          onStart: () => {
            if (sil) {
              sil.dispose();
              transient.silhouettes = transient.silhouettes.filter((x) => x !== sil);
              sil = null;
            }
          },
        },
      ];
    }
  }
}

function roomCentre(s: Services, room: RoomId): Vec3 {
  const r = s.layout.rooms.find((x) => x.id === room);
  if (!r) return v3(0, 0, 0);
  return v3((r.bounds.x0 + r.bounds.x1) / 2, 0, (r.bounds.z0 + r.bounds.z1) / 2);
}
