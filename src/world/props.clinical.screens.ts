/**
 * Screen-bearing clinical props: patient monitor, terminal, security (CCTV) monitor and wall TV.
 * Each screen is a kit.screen plane plus a runtime Glow; content refreshes only while the
 * rendering camera is near, staggered per prop so refreshes never land on the same frame.
 */
import * as THREE from 'three';
import type { PropType } from '../core/types';
import type { ScreenOpts } from '../render/textures';
import type { MeshOpts, PropBuilder, PropKit, ScreenHandle } from './props';
import { Glow, type V3, bar, bev, cablePts, caster, clamp, ledMat, line, mat, rod, rr, soft, starBase, tiltX, vary } from './props.clinical.common';

// ---------------------------------------------------------------------------
// Screen rig
// ---------------------------------------------------------------------------

export interface ScreenLook {
  kind: string;
  opts?: ScreenOpts;
  /** seconds between content refreshes while the camera is near (0 = never) */
  refresh: number;
  brightness: number;
  /** glow strength (0 = dark) */
  glow: number;
  glowColor: number;
}

export interface RigSpec {
  w: number;
  h: number;
  x: number;
  y: number;
  z: number;
  o?: MeshOpts;
  initial: string;
  near?: number;
  look: (mode: string) => ScreenLook;
  onMode?: (mode: string, look: ScreenLook) => void;
}

export interface ScreenRig {
  handle: ScreenHandle;
  mode: () => string;
  /** switch mode (or re-evaluate the current one) */
  set: (mode: string) => void;
}

export function screenRig(k: PropKit, r: RigSpec): ScreenRig {
  let mode = r.initial;
  let look = r.look(mode);
  const handle = k.screen(r.w, r.h, look.kind, r.x, r.y, r.z, { ...(r.o ?? {}), opts: look.opts });
  handle.setBrightness(look.brightness);
  const n = new THREE.Vector3(0, 0, 0.25).applyEuler(new THREE.Euler(r.o?.rx ?? 0, r.o?.ry ?? 0, r.o?.rz ?? 0));
  const glow = new Glow(k, [r.x + n.x, r.y + n.y, r.z + n.z], look.glowColor, look.glow > 0 ? look.glow : 0.1);
  const show = (): void => {
    handle.show(look.kind, look.opts);
    handle.setBrightness(look.brightness);
    glow.set(look.glow > 0, look.glowColor, look.glow > 0 ? look.glow : undefined);
  };
  glow.set(look.glow > 0, look.glowColor, look.glow > 0 ? look.glow : undefined);
  const near = r.near ?? 14;
  let t = k.rand() * Math.max(0.5, look.refresh);
  const set = (m: string): void => {
    mode = m;
    look = r.look(m);
    show();
    r.onMode?.(m, look);
    t = 0;
  };
  k.onScreen(set);
  k.onUpdate((dt) => {
    if (look.refresh <= 0) return;
    t += dt;
    if (t < look.refresh) return;
    t = 0;
    if (k.cameraDistance() > near) return;
    look = r.look(mode);
    show();
  });
  r.onMode?.(mode, look);
  return { handle, mode: () => mode, set };
}

/** Camera roster for security screens, with live online state when the CCTV system is up. */
function cctvLines(k: PropKit): string[] | undefined {
  const cams = k.s.layout.cameras;
  if (!cams.length) return undefined;
  return cams.map((c) => {
    let online = true;
    try {
      online = k.s.cctv.isOnline(c.id);
    } catch {
      online = true;
    }
    return `${c.name.replace(/\s+[—-]\s+/, ' ')} ${online ? 'ONLINE' : 'OFFLINE'}`;
  });
}

const TERMINAL_STANDBY: Record<string, string> = {
  nurse_station: 'NURSE STATION  ·  UPS POWER  ·  NETWORK UNAVAILABLE',
  waiting: 'REGISTRATION 01  ·  SESSION LOCKED',
  triage: 'TRIAGE WORKSTATION  ·  SESSION LOCKED',
  med_room: 'MEDSTATION CONSOLE  ·  LOCAL MODE',
};

// ---------------------------------------------------------------------------
// Patient monitor
// ---------------------------------------------------------------------------

interface PatientRec {
  bay: string;
  name: string;
  hr: [number, number];
  bp: string;
  spo2: number;
  rr: number;
  temp: number;
}

const PATIENTS: Record<string, PatientRec> = {
  exam2: { bay: '2', name: 'ALVAREZ, R', hr: [84, 92], bp: '138/86', spo2: 96, rr: 18, temp: 37.0 },
  exam4: { bay: '4', name: 'OKAFOR, E', hr: [70, 76], bp: '128/80', spo2: 99, rr: 16, temp: 36.8 },
};
const JOHN: PatientRec = { bay: '3', name: 'MERCER, J', hr: [92, 127], bp: '152/94', spo2: 98, rr: 18, temp: 37.1 };
/** the old record exam 2 flashes up: someone who is not here any more, frozen at 04:17 */
const OLD_RECORD = { name: 'HALVORSEN, E', hr: 58, bp: '96/58', spo2: 91, rr: 12, temp: 35.9, time: '04:17:09' };
const VITALS_GLOW = 0x86d4cc;
const ALARM_GLOW = 0xff5a48;

const vitalsLines = (bay: string, name: string, hr: number, bp: string, spo2: number, resp: number, temp: number, alarm?: string): string[] => {
  const l = [`BAY ${bay}`, `PT ${name}`, `HR ${hr}`, `SPO2 ${spo2}`, `BP ${bp}`, `RR ${resp}`, `TEMP ${temp.toFixed(1)}`];
  if (alarm) l.push(`ALARM ${alarm}`);
  return l;
};

const bayOf = (key: string): string => {
  const m = key.match(/^exam(\d)$/);
  return m ? m[1] : key === 'triage' ? 'T' : key.toUpperCase().slice(0, 3);
};

const monitor: PropBuilder = (k) => {
  const arm = k.str('mount', 'stand') === 'arm';
  const key = k.str('patient', k.def.room);
  const shell = mat.plastic(k, vary(k, 0xd2d3cd, 0.04), 0.45);
  const dark = mat.plastic(k, 0x2a2d30, 0.5);
  const metal = mat.satin(k);
  const trim = metal;
  const rub = dark;
  const W = 0.36;
  const H = 0.3;
  const D = 0.1;
  const hz = arm ? 0.46 : 0;
  const front = hz + D * 0.475;

  // housing: rounded front shell, deeper rear hump, dark bezel
  soft(k, W, H, D * 0.55, shell, 0, 0, hz + D * 0.2, 0.022);
  soft(k, W * 0.8, H * 0.76, D * 0.62, shell, 0, -0.006, hz - D * 0.16, 0.03);
  bev(k, 0.318, 0.244, 0.008, dark, 0, 0.012, front + 0.002, 0.003);
  // control strip under the screen
  k.cyl(0.015, 0.015, 0.012, dark, 0.135, -0.124, front + 0.002, { axis: 'z', seg: 12, cast: false });
  for (let i = 0; i < 4; i++) bev(k, 0.026, 0.01, 0.006, trim, -0.13 + i * 0.034, -0.126, front + 0.001, 0.002, { cast: false });
  // carry handle and alarm lamp on top
  line(k, [[-0.11, H / 2 - 0.006, hz - 0.012], [-0.11, H / 2 + 0.032, hz - 0.012], [0.11, H / 2 + 0.032, hz - 0.012], [0.11, H / 2 - 0.006, hz - 0.012]], 0.009, trim, { cast: false });
  const lamp = ledMat(k, 0xff2a1a, 0);
  bev(k, 0.15, 0.012, 0.026, lamp, 0, H / 2 + 0.002, hz + D * 0.3, 0.004, { cast: false });
  // parameter module rack with patient connectors on the right side
  bev(k, 0.045, 0.21, 0.088, trim, W / 2 + 0.02, -0.018, hz, 0.006);
  for (let i = 0; i < 3; i++) k.cyl(0.009, 0.009, 0.014, dark, W / 2 + 0.047, 0.05 - i * 0.06, hz + 0.018, { axis: 'x', seg: 10, cast: false });
  // speaker grille slots on the rear hump
  for (let i = 0; i < 5; i++) k.box(0.08, 0.004, 0.004, dark, -0.06, -0.06 + i * 0.012, hz - D * 0.47, { cast: false });

  const cableM = dark;
  if (arm) {
    // wall channel + two-link arm out to the tilt head behind the housing
    bev(k, 0.075, 0.44, 0.026, trim, 0, -0.05, 0.013, 0.005);
    const p0: V3 = [0, -0.04, 0.03];
    const p1: V3 = [0.17, -0.04, 0.22];
    const p2: V3 = [0.02, -0.03, hz - D * 0.47 - 0.03];
    bar(k, p0, p1, 0.05, 0.034, dark);
    bar(k, p1, p2, 0.05, 0.034, dark);
    for (const p of [p0, p1, p2]) k.cyl(0.029, 0.029, 0.05, trim, p[0], p[1], p[2], { seg: 12 });
    bev(k, 0.11, 0.11, 0.02, dark, 0, 0, hz - D * 0.47 - 0.012, 0.004);
    line(k, cablePts([W / 2 + 0.05, -0.02, hz + 0.02], [0.03, -0.24, 0.03], 0.42, 6), 0.005, cableM, { cast: false });
    line(k, cablePts([W / 2 + 0.05, 0.03, hz + 0.02], [0.2, -0.5, hz * 0.6], 0.25, 6), 0.004, cableM, { cast: false });
  } else {
    // rolling stand: clamp behind the housing, pole to a five-caster base on the floor
    const floorY = -k.def.pos.y;
    const poleZ = -D / 2 - 0.05;
    bev(k, 0.12, 0.12, 0.018, dark, 0, 0, hz - D * 0.47 - 0.006, 0.004);
    rod(k, [0, -0.02, hz - D * 0.47 - 0.012], [0, -0.02, poleZ], 0.013, metal);
    k.cyl(0.03, 0.03, 0.085, dark, 0, -0.02, poleZ, { seg: 12 });
    const poleTop = 0.07;
    const poleBot = floorY + 0.11;
    k.cyl(0.019, 0.019, poleTop - poleBot, metal, 0, (poleTop + poleBot) / 2, poleZ, { seg: 12 });
    k.cyl(0.021, 0.021, 0.012, dark, 0, poleTop + 0.006, poleZ, { seg: 12, cast: false });
    // accessory basket with a coiled spare lead
    const by = floorY + 0.84;
    const bz = poleZ - 0.085;
    k.box(0.22, 0.005, 0.13, metal, 0, by - 0.06, bz, { cast: false });
    for (const sx of [-1, 1]) k.box(0.005, 0.12, 0.13, metal, sx * 0.11, by, bz, { cast: false });
    for (const sz of [-1, 1]) k.box(0.22, 0.012, 0.005, metal, 0, by + 0.054, bz + sz * 0.065, { cast: false });
    k.box(0.22, 0.012, 0.005, metal, 0, by - 0.01, bz - 0.065, { cast: false });
    k.cyl(0.024, 0.024, 0.04, dark, 0, by + 0.03, poleZ, { seg: 10, cast: false });
    k.torus(0.05, 0.007, cableM, 0.03, by - 0.045, bz, { rx: Math.PI / 2, seg: 18, cast: false });
    starBase(k, { z: poleZ, floor: floorY, radius: 0.29, hubR: 0.05, hubY: floorY + 0.115, tipY: floorY + 0.1, legW: 0.042, legH: 0.03, casterR: 0.035, legMat: dark, hubMat: dark, casterMetal: metal, wheelMat: rub });
    // patient leads looping down from the module to the basket
    line(k, cablePts([W / 2 + 0.05, -0.02, hz + 0.02], [0.08, by + 0.05, bz + 0.06], 0.35, 6), 0.005, cableM, { cast: false });
    line(k, cablePts([W / 2 + 0.05, 0.04, hz + 0.02], [-0.05, by + 0.05, bz], 0.55, 6), 0.004, cableM, { cast: false });
  }

  // --- content -------------------------------------------------------------
  const rec = key === 'exam3' ? JOHN : PATIENTS[key];
  let hr = rec ? (rec.hr[0] + rec.hr[1]) / 2 : 80;
  const bay = rec?.bay ?? bayOf(key);
  const standby = (): ScreenLook => ({
    kind: 'standby',
    opts: { lines: [`BAY ${bay}  ·  NO PATIENT CONNECTED`] },
    refresh: 2,
    brightness: 0.72,
    glow: 0.07,
    glowColor: 0x6f907c,
  });
  /** current numbers for the bay's patient, or null when nobody is on the monitor */
  const live = (): { r: PatientRec; hr: number } | null => {
    if (key === 'exam3') {
      const st = k.s.store.get();
      if (!st.flags.john_roomed) return null;
      const p = st.characters.john.perception;
      return { r: JOHN, hr: Math.round(92 + 35 * Math.max(p.anxiety, p.fear) + rr(k, -1.5, 1.5)) };
    }
    if (!rec) return null;
    hr = clamp(hr + rr(k, -1.6, 1.6), rec.hr[0], rec.hr[1]);
    return { r: rec, hr: Math.round(hr) };
  };
  const look = (mode: string): ScreenLook => {
    const time = k.screenTime();
    switch (mode) {
      case 'off':
        return { kind: 'off', refresh: 0, brightness: 0.42, glow: 0, glowColor: VITALS_GLOW };
      case 'dead':
        return { kind: 'vitals', opts: { dead: true }, refresh: 0, brightness: 0.85, glow: 0, glowColor: VITALS_GLOW };
      case 'standby':
        return { ...standby(), refresh: 0 };
      case 'mismatch': {
        const o = OLD_RECORD;
        return { kind: 'vitals', opts: { time: o.time, lines: vitalsLines(bay, o.name, o.hr, o.bp, o.spo2, o.rr, o.temp) }, refresh: 0, brightness: 0.9, glow: 0.22, glowColor: VITALS_GLOW };
      }
      case 'flat': {
        const v = live();
        const r = v?.r ?? rec ?? JOHN;
        // HR reads zero while every other channel is a living patient's
        return { kind: 'vitals', opts: { time, lines: vitalsLines(r.bay, r.name, 0, r.bp, r.spo2, r.rr, r.temp), alarm: true }, refresh: 1, brightness: 0.92, glow: 0.26, glowColor: ALARM_GLOW };
      }
      case 'alarm': {
        const r = rec ?? JOHN;
        const h = Math.round(rr(k, 138, 149));
        return { kind: 'vitals', opts: { time, lines: vitalsLines(r.bay, r.name, h, '171/102', Math.max(88, r.spo2 - 6), r.rr + 8, r.temp, 'HR HIGH'), alarm: true }, refresh: 1, brightness: 0.95, glow: 0.3, glowColor: ALARM_GLOW };
      }
      default: {
        const v = live();
        if (!v) return standby();
        return { kind: 'vitals', opts: { time, lines: vitalsLines(v.r.bay, v.r.name, v.hr, v.r.bp, v.r.spo2, v.r.rr + (k.rand() < 0.2 ? 1 : 0), v.r.temp) }, refresh: 1, brightness: 0.9, glow: 0.24, glowColor: VITALS_GLOW };
      }
    }
  };
  let alarmOn = false;
  screenRig(k, {
    w: 0.296,
    h: 0.222,
    x: 0,
    y: 0.012,
    z: front + 0.0068,
    initial: k.str('screen', 'vitals'),
    look,
    onMode: (m) => {
      alarmOn = m === 'alarm' || m === 'flat';
      if (!alarmOn) lamp.emissiveIntensity = 0;
    },
  });
  let t = k.rand() * 3;
  k.onUpdate((dt) => {
    if (!alarmOn) return;
    t += dt;
    // a soft breathing pulse, not a strobe
    lamp.emissiveIntensity = 0.35 + 1.25 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 0.9));
  });
};

// ---------------------------------------------------------------------------
// Terminal (flat panel + keyboard + mouse on a work surface)
// ---------------------------------------------------------------------------

const terminal: PropBuilder = (k) => {
  const bezelM = mat.plastic(k, vary(k, 0x24272a, 0.08), 0.5);
  const shell = mat.plastic(k, 0x303337, 0.55);
  const keyM = shell;
  const padM = bezelM;
  const baseZ = -0.1;
  // stand: foot, neck
  bev(k, 0.23, 0.014, 0.19, shell, 0, 0.007, baseZ, 0.006);
  bev(k, 0.07, 0.2, 0.026, shell, 0, 0.11, baseZ - 0.03, 0.008);
  // panel tilted back a little on its hinge
  const tilt = -0.09;
  const pivot: V3 = [0, 0.22, baseZ - 0.02];
  const at = (p: V3): V3 => tiltX(p, pivot, tilt);
  const pc = at([0, 0.3, baseZ]);
  bev(k, 0.42, 0.335, 0.026, bezelM, pc[0], pc[1], pc[2], 0.008, { rx: tilt });
  const rear = at([0, 0.29, baseZ - 0.028]);
  bev(k, 0.28, 0.2, 0.034, shell, rear[0], rear[1], rear[2], 0.012, { rx: tilt });
  const sc = at([0, 0.306, baseZ + 0.0135]);
  // power LED in the bezel chin
  const led = ledMat(k, 0x7fb6ff, 0.6);
  const lp = at([0.185, 0.145, baseZ + 0.0135]);
  k.box(0.006, 0.004, 0.002, led, lp[0], lp[1], lp[2], { rx: tilt, cast: false });
  // keyboard: body + key rows (main block, navigation/numpad block)
  bev(k, 0.44, 0.02, 0.15, bezelM, 0, 0.01, 0.13, 0.006);
  for (let r = 0; r < 5; r++) {
    const z = 0.078 + r * 0.025;
    k.box(r === 4 ? 0.13 : 0.29, 0.007, 0.019, keyM, r === 4 ? -0.07 : -0.065, 0.023, z, { cast: false });
    if (r === 4) {
      k.box(0.06, 0.007, 0.019, keyM, -0.175, 0.023, z, { cast: false });
      k.box(0.06, 0.007, 0.019, keyM, 0.045, 0.023, z, { cast: false });
    }
    k.box(0.105, 0.007, 0.019, keyM, 0.15, 0.023, z, { cast: false });
  }
  // mouse on its pad, cable back to the monitor
  const mx = 0.32;
  bev(k, 0.2, 0.003, 0.17, padM, mx, 0.0015, 0.15, 0.001, { cast: false });
  const mouse = k.sphere(0.03, shell, mx + rr(k, -0.02, 0.02), 0.014, 0.15 + rr(k, -0.02, 0.02), { seg: 10, cast: false });
  mouse.scale.set(0.62, 0.42, 1.05);
  mouse.rotation.y = rr(k, -0.3, 0.3);
  line(k, [[mx, 0.008, 0.118], [mx - 0.02, 0.004, 0.05], [0.16, 0.004, -0.04], [0.06, 0.004, baseZ - 0.05]], 0.0022, padM, { cast: false });
  // a sticky note or two on the bezel
  const note = mat.plastic(k, 0xd6c56a, 0.9);
  if (k.rand() < 0.65) {
    const np = at([-0.17, 0.165, baseZ + 0.0135]);
    k.box(0.05, 0.05, 0.001, note, np[0], np[1], np[2] + 0.001, { rx: tilt, rz: rr(k, -0.12, 0.12), cast: false });
  }
  if (k.rand() < 0.3) {
    const np = at([0.188, 0.42, baseZ + 0.0135]);
    k.box(0.045, 0.045, 0.001, note, np[0], np[1], np[2] + 0.001, { rx: tilt, rz: rr(k, -0.2, 0.2), cast: false });
  }

  const standbyText = k.def.room === 'imaging' ? undefined : TERMINAL_STANDBY[k.def.room] ?? 'WORKSTATION LOCKED  ·  BADGE TO RESUME';
  const look = (mode: string): ScreenLook => {
    const time = k.screenTime();
    switch (mode) {
      case 'off':
        return { kind: 'off', refresh: 0, brightness: 0.4, glow: 0, glowColor: 0x9cc2ea };
      case 'standby':
        return { kind: 'standby', opts: standbyText ? { lines: [standbyText] } : undefined, refresh: 0, brightness: 0.75, glow: 0.06, glowColor: 0x6f907c };
      case 'static':
        return { kind: 'static', opts: { time }, refresh: 0.5, brightness: 0.8, glow: 0.16, glowColor: 0xc9d2da };
      case 'security':
        return { kind: 'security', opts: { time, lines: cctvLines(k) }, refresh: 2, brightness: 0.86, glow: 0.16, glowColor: 0xa8b4bc };
      default:
        return { kind: mode, opts: { time }, refresh: 2, brightness: 0.86, glow: 0.18, glowColor: 0x9cc2ea };
    }
  };
  screenRig(k, {
    w: 0.384,
    h: 0.288,
    x: sc[0],
    y: sc[1],
    z: sc[2],
    o: { rx: tilt },
    initial: k.str('screen', 'standby'),
    look,
    near: 12,
    onMode: (m) => {
      // 'off' is what the director sends when the circuit is dead; amber is the power-save lamp
      led.emissive.setHex(m === 'standby' ? 0xffa040 : 0x7fb6ff);
      led.emissiveIntensity = m === 'off' ? 0 : m === 'standby' ? 0.35 : 0.6;
    },
  });
};

// ---------------------------------------------------------------------------
// Security monitor (quad-feed CCTV display)
// ---------------------------------------------------------------------------

const securityMonitor: PropBuilder = (k) => {
  const onCart = k.str('base', 'desk') === 'cart';
  const caseM = mat.painted(k, 0x232527, 0.55);
  const metal = mat.satin(k);
  const dark = mat.plastic(k, 0x18191b, 0.6);
  // industrial 17" 4:3 monitor in a steel case on a short pedestal
  bev(k, 0.22, 0.014, 0.17, caseM, 0, 0.007, -0.02, 0.004);
  bev(k, 0.05, 0.13, 0.04, caseM, 0, 0.075, -0.045, 0.006);
  bev(k, 0.38, 0.31, 0.06, caseM, 0, 0.3, -0.01, 0.008);
  bev(k, 0.3, 0.22, 0.05, caseM, 0, 0.295, -0.06, 0.012);
  for (let i = 0; i < 5; i++) bev(k, 0.018, 0.009, 0.005, dark, 0.06 + i * 0.024, 0.159, 0.022, 0.002, { cast: false });
  const pwr = ledMat(k, 0x5fd38a, 0.7);
  k.box(0.006, 0.004, 0.002, pwr, -0.165, 0.159, 0.021, { cast: false });
  line(k, [[0.08, 0.22, -0.085], [0.11, 0.06, -0.11], [0.12, 0.004, -0.15], [0.14, 0.004, -0.24]], 0.004, dark, { cast: false });

  const rec = ledMat(k, 0xff3a2a, 0);
  let recording = false;
  if (onCart) {
    // small steel AV cart: the monitor's surface is the cart top at the origin height
    const floorY = -k.def.pos.y;
    const top = 0;
    const cw = 0.5;
    const cd = 0.4;
    bev(k, cw, 0.022, cd, caseM, 0, top - 0.011, 0, 0.004);
    bev(k, cw, 0.018, cd, caseM, 0, floorY + 0.46, 0, 0.004);
    bev(k, cw, 0.018, cd, caseM, 0, floorY + 0.16, 0, 0.004);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        k.box(0.022, top - floorY - 0.11, 0.022, metal, sx * (cw / 2 - 0.015), (top + floorY + 0.11) / 2, sz * (cd / 2 - 0.015));
        caster(k, sx * (cw / 2 - 0.03), sz * (cd / 2 - 0.03), floorY + 0.11, 0.04, metal, dark, rr(k, 0, 6.28), { floor: floorY });
      }
    }
    // DVR on the middle shelf, UPS on the bottom
    bev(k, 0.36, 0.065, 0.3, dark, 0, floorY + 0.502, -0.02, 0.004);
    k.box(0.006, 0.004, 0.002, pwr, -0.15, floorY + 0.51, 0.131, { cast: false });
    k.box(0.006, 0.004, 0.002, rec, -0.135, floorY + 0.51, 0.131, { cast: false });
    for (let i = 0; i < 6; i++) k.box(0.02, 0.012, 0.002, metal, 0.02 + i * 0.026, floorY + 0.505, 0.131, { cast: false });
    bev(k, 0.15, 0.22, 0.34, dark, -0.12, floorY + 0.28, -0.01, 0.006);
    k.box(0.006, 0.004, 0.002, pwr, -0.12, floorY + 0.35, 0.161, { cast: false });
    line(k, cablePts([0.05, floorY + 0.53, -0.17], [0.0, -0.02, -0.19], 0.02, 6), 0.005, dark, { cast: false });
    let t = k.rand() * 4;
    k.onUpdate((dt) => {
      if (!recording) return;
      t += dt;
      rec.emissiveIntensity = Math.sin(t * Math.PI) > 0 ? 0.9 : 0.1;
    });
  }

  const look = (mode: string): ScreenLook => {
    const time = k.screenTime();
    switch (mode) {
      case 'off':
        return { kind: 'off', refresh: 0, brightness: 0.4, glow: 0, glowColor: 0xa8b4bc };
      case 'standby':
        return { kind: 'standby', opts: { lines: ['DVR 02  ·  NO VIDEO INPUT'] }, refresh: 0, brightness: 0.72, glow: 0.06, glowColor: 0x6f907c };
      case 'static':
        return { kind: 'static', opts: { time }, refresh: 0.45, brightness: 0.8, glow: 0.2, glowColor: 0xc9d2da };
      default:
        return { kind: 'security', opts: { time, lines: cctvLines(k) }, refresh: 2, brightness: 0.86, glow: 0.18, glowColor: 0xa8b4bc };
    }
  };
  screenRig(k, {
    w: 0.336,
    h: 0.252,
    x: 0,
    y: 0.305,
    z: 0.0215,
    initial: k.str('screen', 'security'),
    look,
    near: 10,
    onMode: (m) => {
      pwr.emissiveIntensity = m === 'off' ? 0 : 0.7;
      recording = m === 'security';
      if (!recording) rec.emissiveIntensity = 0;
    },
  });
};

// ---------------------------------------------------------------------------
// Wall TV on a tilt bracket
// ---------------------------------------------------------------------------

const tv: PropBuilder = (k) => {
  const bezelM = mat.plastic(k, 0x161719, 0.45);
  const backM = bezelM;
  const metal = mat.darkMetal(k);
  const W = 0.93;
  const H = 0.545;
  const tilt = k.num('tilt', k.def.pos.y > 1.8 ? 0.13 : 0.03);
  const pivot: V3 = [0, 0.04, 0.055];
  const at = (p: V3): V3 => tiltX(p, pivot, tilt);
  // wall plate, rails and tilt links
  bev(k, 0.42, 0.3, 0.012, metal, 0, 0.02, 0.006, 0.003);
  for (const sx of [-1, 1]) {
    const r0 = at([sx * 0.16, 0.02, 0.064]);
    k.box(0.03, 0.42, 0.014, metal, r0[0], r0[1], r0[2], { rx: tilt });
    bar(k, [sx * 0.16, 0.1, 0.012], at([sx * 0.16, 0.1, 0.062]), 0.02, 0.012, metal, { cast: false });
    bar(k, [sx * 0.16, -0.06, 0.012], at([sx * 0.16, -0.06, 0.062]), 0.02, 0.012, metal, { cast: false });
  }
  // panel, rear housing, screen
  const back = at([0, -0.02, 0.085]);
  bev(k, 0.62, 0.36, 0.035, backM, back[0], back[1], back[2], 0.012, { rx: tilt });
  const body = at([0, 0, 0.115]);
  bev(k, W, H, 0.026, bezelM, body[0], body[1], body[2], 0.006, { rx: tilt });
  const led = ledMat(k, 0xff2a1a, 0);
  const lp = at([0.4, -H / 2 + 0.008, 0.129]);
  k.box(0.006, 0.004, 0.002, led, lp[0], lp[1], lp[2], { rx: tilt, cast: false });
  // power and coax lead dropping from the set into the recessed wall box behind it
  line(k, cablePts(at([0.12, -0.1, 0.07]), [0.1, -0.08, 0.01], 0.07, 6), 0.004, metal, { cast: false });
  const sc = at([0, 0.006, 0.1285]);

  const look = (mode: string): ScreenLook => {
    switch (mode) {
      case 'news_muted':
        return { kind: 'news_muted', opts: { time: k.screenTime() }, refresh: 1, brightness: 0.9, glow: 0.34, glowColor: 0x8eb2f0 };
      case 'static':
        return { kind: 'static', opts: { time: k.screenTime() }, refresh: 0.5, brightness: 0.82, glow: 0.3, glowColor: 0xc8d0d8 };
      default:
        // 'standby' = dark panel with the red standby lamp; 'off' = dark panel, lamp out
        return { kind: 'off', refresh: 0, brightness: 0.38, glow: 0, glowColor: 0x8eb2f0 };
    }
  };
  screenRig(k, {
    w: 0.89,
    h: 0.5,
    x: sc[0],
    y: sc[1],
    z: sc[2],
    o: { rx: tilt },
    initial: k.str('screen', 'off'),
    look,
    near: 16,
    onMode: (m) => {
      led.emissiveIntensity = m === 'standby' ? 1.1 : 0;
    },
  });
};

export const SCREEN_BUILDERS: Partial<Record<PropType, PropBuilder>> = {
  monitor,
  terminal,
  security_monitor: securityMonitor,
  tv,
};
