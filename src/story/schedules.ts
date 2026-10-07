/**
 * Baseline schedules: what each main character does while the player is not controlling them.
 * Times are game minutes since 22:45. Positions are inside room bounds and clear of solid props
 * (see world/layout.ts). The character system walks to the latest entry whose time has passed,
 * so a redirect (John leaving his room, Susie answering an alarm) replaces the whole list with
 * entries anchored at the current time.
 */
import type { CharacterId, RoomId, ScheduleEntry, Vec2 } from '../core/types';

const E = (time: number, room: RoomId, x: number, z: number, yaw: number, action: string): ScheduleEntry => ({
  time,
  room,
  pos: { x, z },
  yaw,
  action,
});

/** yaw that makes `forwardFromYaw` point from `from` toward `to` (three.js: yaw 0 looks toward -z). */
export function yawToward(from: Vec2, to: Vec2): number {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

// Frequently used poses -------------------------------------------------------

export const POSE = {
  johnSeat: { x: -13.1, z: -4.2 },
  johnTriageChair: { x: -6.6, z: -3.6 },
  johnBed: { x: -7.3, z: 4.1 },
  johnCounter: { x: 0.6, z: -0.8 },
  susieStation: { x: -1.5, z: -3.0 },
  susieStationB: { x: 0.5, z: -3.0 },
  susieCoffee: { x: 6.9, z: -2.9 },
  susieTriage: { x: -5.9, z: -4.6 },
  susieExam3: { x: -8.6, z: 3.2 },
  susieExam2: { x: -13.9, z: 3.4 },
  susieExam4: { x: -4.3, z: 3.4 },
  susieMed: { x: 0.3, z: 4.4 },
  susieElevator: { x: 15.2, z: -0.6 },
  paulCart: { x: 8.5, z: 6.8 },
  paulUtility: { x: -6, z: 9.4 },
  paulSupply: { x: 9.9, z: -3.6 },
  paulGenerator: { x: 13.2, z: 10.2 },
  paulElectrical: { x: 3.7, z: 10.4 },
  paulHallEast: { x: 12.4, z: 0.6 },
  paulServiceWest: { x: -8, z: 6.8 },
} as const;

const EAST = -Math.PI / 2;
const NORTH = Math.PI;
const SOUTH = 0;

export function baseSchedules(): Record<CharacterId, ScheduleEntry[]> {
  const john: ScheduleEntry[] = [
    E(0, 'waiting', POSE.johnSeat.x, POSE.johnSeat.z, SOUTH, 'phone'),
    E(4, 'waiting', POSE.johnSeat.x, POSE.johnSeat.z, SOUTH, 'sit'),
    // 23:00 paged to triage (the director widens d_triage first)
    E(15, 'triage', POSE.johnTriageChair.x, POSE.johnTriageChair.z, EAST, 'sit'),
    // 23:05 roomed in Bay 3
    E(20, 'exam3', POSE.johnBed.x, POSE.johnBed.z, SOUTH, 'lie'),
    // generator night: sits up in the dark
    E(83, 'exam3', POSE.johnBed.x, POSE.johnBed.z, SOUTH, 'sit'),
    E(165, 'exam3', POSE.johnBed.x, POSE.johnBed.z, SOUTH, 'sit'),
  ];

  const susie: ScheduleEntry[] = [
    // the intro freezes the clock at 10:47 (t = 2); nobody moves off their mark until it releases
    E(0, 'corridor', -18.5, 0, EAST, 'phone'),
    E(2.6, 'nurse_station', POSE.susieStation.x, POSE.susieStation.z, NORTH, 'work'),
    E(6, 'break_room', POSE.susieCoffee.x, POSE.susieCoffee.z, EAST, 'work'),
    E(9, 'nurse_station', POSE.susieStation.x, POSE.susieStation.z, NORTH, 'work'),
    E(15, 'triage', POSE.susieTriage.x, POSE.susieTriage.z, yawToward(POSE.susieTriage, POSE.johnTriageChair), 'work'),
    E(20, 'exam3', POSE.susieExam3.x, POSE.susieExam3.z, EAST, 'stand'),
    E(22.5, 'nurse_station', POSE.susieStation.x, POSE.susieStation.z, NORTH, 'work'),
    // rounds
    E(27, 'exam2', POSE.susieExam2.x, POSE.susieExam2.z, EAST, 'stand'),
    E(31, 'exam4', POSE.susieExam4.x, POSE.susieExam4.z, EAST, 'stand'),
    E(35, 'nurse_station', POSE.susieStation.x, POSE.susieStation.z, NORTH, 'work'),
    E(45, 'med_room', POSE.susieMed.x, POSE.susieMed.z, NORTH, 'work'),
    E(49, 'nurse_station', POSE.susieStationB.x, POSE.susieStationB.z, NORTH, 'work'),
    E(58, 'exam2', POSE.susieExam2.x, POSE.susieExam2.z, EAST, 'stand'),
    E(62, 'nurse_station', POSE.susieStation.x, POSE.susieStation.z, NORTH, 'work'),
    // 23:55 checks on John
    E(70, 'exam3', POSE.susieExam3.x, POSE.susieExam3.z, EAST, 'stand'),
    E(74, 'nurse_station', POSE.susieStation.x, POSE.susieStation.z, NORTH, 'work'),
    // generator night rounds
    E(84, 'exam2', POSE.susieExam2.x, POSE.susieExam2.z, EAST, 'stand'),
    E(88, 'exam4', POSE.susieExam4.x, POSE.susieExam4.z, EAST, 'stand'),
    E(91, 'exam3', POSE.susieExam3.x, POSE.susieExam3.z, EAST, 'stand'),
    E(94, 'nurse_station', POSE.susieStation.x, POSE.susieStation.z, NORTH, 'work'),
    E(105, 'nurse_station', POSE.susieStationB.x, POSE.susieStationB.z, NORTH, 'work'),
    E(118, 'exam2', POSE.susieExam2.x, POSE.susieExam2.z, EAST, 'stand'),
    E(122, 'nurse_station', POSE.susieStation.x, POSE.susieStation.z, NORTH, 'work'),
    E(165, 'nurse_station', POSE.susieStation.x, POSE.susieStation.z, NORTH, 'work'),
  ];

  const paul: ScheduleEntry[] = [
    E(0, 'service_n', POSE.paulCart.x, POSE.paulCart.z, EAST, 'stand'),
    E(2.8, 'utility', POSE.paulUtility.x, POSE.paulUtility.z, SOUTH, 'work'),
    E(5.5, 'supply', POSE.paulSupply.x, POSE.paulSupply.z, SOUTH, 'work'),
    E(11, 'service_n', 10.5, 6.5, EAST, 'mop'),
    E(14.5, 'generator', POSE.paulGenerator.x, POSE.paulGenerator.z, NORTH, 'work'),
    E(19, 'service_n', 3, 6.6, EAST, 'mop'),
    E(27, 'corridor', POSE.paulHallEast.x, POSE.paulHallEast.z, EAST, 'mop'),
    E(35, 'service_n', POSE.paulServiceWest.x, POSE.paulServiceWest.z, EAST, 'mop'),
    E(43, 'utility', POSE.paulUtility.x, POSE.paulUtility.z, SOUTH, 'work'),
    E(51, 'service_n', 5, 6.8, EAST, 'mop'),
    // 23:50 strip lights cascade off toward him here
    E(63, 'service_n', -1.5, 6.8, EAST, 'mop'),
    E(68, 'electrical', POSE.paulElectrical.x, POSE.paulElectrical.z, NORTH, 'work'),
    E(74, 'service_n', POSE.paulCart.x, POSE.paulCart.z, EAST, 'stand'),
    E(84, 'electrical', POSE.paulElectrical.x, POSE.paulElectrical.z, NORTH, 'work'),
    E(92, 'generator', POSE.paulGenerator.x, POSE.paulGenerator.z, NORTH, 'work'),
    E(102, 'service_n', 10.5, 6.5, EAST, 'mop'),
    E(112, 'electrical', POSE.paulElectrical.x, POSE.paulElectrical.z, NORTH, 'work'),
    E(124, 'generator', POSE.paulGenerator.x, POSE.paulGenerator.z, NORTH, 'work'),
    E(158, 'service_n', 5, 6.8, EAST, 'stand'),
    E(165, 'service_n', POSE.paulCart.x, POSE.paulCart.z, EAST, 'stand'),
  ];

  return { john, susie, paul };
}

// Redirects -----------------------------------------------------------------------

/** John walks to the nurse-station counter (the corridor side; patients cannot pass the gate) and stays. */
export function johnToCounterSchedule(now: number): ScheduleEntry[] {
  return [E(Math.max(0, now - 0.01), 'corridor', POSE.johnCounter.x, POSE.johnCounter.z, SOUTH, 'stand')];
}

/** John sedated: back on the bed for the rest of the night. */
export function johnSedatedSchedule(now: number): ScheduleEntry[] {
  return [E(Math.max(0, now - 0.01), 'exam3', POSE.johnBed.x, POSE.johnBed.z, SOUTH, 'lie')];
}

/** Susie answers a room, then returns to the station after `stayMinutes`. */
export function susieVisitSchedule(now: number, room: 'exam2' | 'exam3' | 'exam4', stayMinutes: number): ScheduleEntry[] {
  const pose = room === 'exam2' ? POSE.susieExam2 : room === 'exam3' ? POSE.susieExam3 : POSE.susieExam4;
  const back = baseSchedules().susie.filter((e) => e.time > now + stayMinutes);
  return [
    E(Math.max(0, now - 0.01), room, pose.x, pose.z, EAST, 'stand'),
    E(now + stayMinutes, 'nurse_station', POSE.susieStation.x, POSE.susieStation.z, NORTH, 'work'),
    ...back,
  ];
}

/** Susie walks to the elevator doors, waits, and comes back. */
export function susieElevatorSchedule(now: number): ScheduleEntry[] {
  const back = baseSchedules().susie.filter((e) => e.time > now + 3);
  return [
    E(Math.max(0, now - 0.01), 'corridor', POSE.susieElevator.x, POSE.susieElevator.z, SOUTH, 'stand'),
    E(now + 3, 'nurse_station', POSE.susieStation.x, POSE.susieStation.z, NORTH, 'work'),
    ...back,
  ];
}

/** Paul keeps to the generator room for a while (after the surge), then resumes his rounds. */
export function paulGeneratorSchedule(now: number): ScheduleEntry[] {
  const back = baseSchedules().paul.filter((e) => e.time > now + 6);
  return [E(Math.max(0, now - 0.01), 'generator', POSE.paulGenerator.x, POSE.paulGenerator.z, NORTH, 'work'), ...back];
}
