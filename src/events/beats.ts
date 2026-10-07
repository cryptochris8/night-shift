/**
 * Scripted story beats (CONTRACT §5): the fixed spine the seeded anomaly pool hangs from.
 * Every beat is a GameEventDef the director schedules like any other event, with one convention:
 * `consequences` carries the state the night depends on (flags, door access, objectives) and runs
 * even when a beat is caught up after a time jump, while `presentation` carries only what is seen
 * and heard. Spoken text comes from story/content.ts wherever a line exists there.
 */
import type { DocumentView, FigureHandle, GameEventDef, Services } from '../core/contracts';
import { formatClock12 } from '../core/clock';
import type { CharacterId, RoomId, ScenarioType, Vec3, ViewId } from '../core/types';
import { CHOICE_META, LINES, SUBFLAGS, type ChoiceId } from '../story/content';
import type { StoryApi } from './Director';
import { C, CLUE, DF, F } from './Director.ids';
import type { NpcCast } from './Director.npcs';
import { Silhouette, injectSilhouette } from './Director.silhouette';

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const wait = (seconds: number): Promise<void> => new Promise((r) => setTimeout(r, seconds * 1000));
const REAL: ScenarioType[] = ['supernatural', 'mixed'];

/** What the director lends the beats beyond the StoryApi. Every member is optional so the file also builds alone. */
export interface BeatHooks {
  cast?: NpcCast;
  silhouette?: Silhouette;
  /** A clue that is awarded when the right character is looking at a point (the director polls). */
  pendingClue?(id: string, point: Vec3, viewers: CharacterId[], rooms: RoomId[], seconds?: number, cond?: () => boolean): void;
  johnSedated?(): void;
  johnLeavesRoom?(): void;
  susieRedirect?(room: 'exam2' | 'exam3', stayMinutes: number): void;
  susieToElevator?(): void;
  startAlarm?(): void;
  stopAlarm?(): void;
  bumpFear?(c: CharacterId, amount: number): void;
  isWatchingCam?(cameraId: string): boolean;
  jumpTimestamp?(cameraId: string, offsetMinutes: number, seconds: number): void;
}

/** Points the director uses for witness checks on beats (anomalies have anomalyPoint). */
const BEAT_POINTS: Record<string, Vec3> = {
  beat_marcus_backed_up: v3(-9.0, 1.4, -1.95),
  beat_page_john: v3(-9.0, 2.5, -3.0),
  beat_triage_vitals: v3(-6.6, 1.2, -3.6),
  beat_roomed: v3(-7.7, 1.2, 1.5),
  beat_alvarez_man: v3(-12.9, 0.9, 4.1),
  beat_hall_figure: v3(17.5, 1.0, 0.3),
  beat_paul_cascade: v3(5, 2.4, 7),
  beat_susie_checks_john: v3(-7.3, 1.0, 4.1),
  beat_pre_outage_radio: v3(-0.4, 0.8, -2.5),
  beat_john_isolated_pass: v3(-7.7, 1.0, 0.6),
  beat_alvarez_alarm: v3(-11.9, 1.35, 4.9),
  beat_cam_generator_figure: v3(14, 1.0, 11.6),
  beat_timestamp_jump: v3(18, 1.65, 0),
  beat_drag_marks: v3(5, 0.05, 7.1),
  beat_okafor_wander_out: v3(3.2, 0.9, 0.5),
  beat_paul_surge: v3(14, 1.0, 11.6),
  beat_susie_elevator: v3(16, 1.2, -1.5),
};

export function beatPoint(id: string): Vec3 | undefined {
  return BEAT_POINTS[id];
}

/** Dialogue options for a canonical choice, as content.ts words them. */
export function optionsFor(id: ChoiceId): { id: string; label: string }[] {
  return CHOICE_META[id].options.map((o) => ({ id: o.id, label: o.label }));
}

export function buildBeats(api: StoryApi, s: Services, hooks: BeatHooks = {}): GameEventDef[] {
  const P = s.layout.points;
  const store = s.store;
  const loc = (c: CharacterId): RoomId => store.char(c).location;
  const controlled = (c: CharacterId): boolean => store.get().activeView === c;
  const view = (): ViewId => store.get().activeView;
  const real = (): boolean => REAL.includes(api.scenario);
  const sil = hooks.silhouette ?? new Silhouette(1.9);
  const MARCUS = 'Marcus';
  const RADIO = 'Marcus (radio)';
  let alarmHandle: { stop(fade?: number): void } | null = null;

  const beat = (
    def: Omit<GameEventDef, 'scenarios' | 'offscreen' | 'tags' | 'presentation'> &
      Partial<Pick<GameEventDef, 'scenarios' | 'offscreen' | 'tags' | 'presentation'>>,
  ): GameEventDef => ({
    scenarios: 'all',
    offscreen: true,
    presentation: {},
    ...def,
    tags: ['beat', ...(def.tags ?? [])],
  });

  // ---------------------------------------------------------------------------
  // Dialogue helpers
  // ---------------------------------------------------------------------------

  const vitalsDoc = (): DocumentView => ({
    kind: 'monitor',
    title: 'TRIAGE — VITALS',
    subtitle: 'MERCER, JOHN   M 35   MRN 00447108',
    sections: [
      { heading: formatClock12(api.time), lines: ['BP    152 / 94', 'HR    104', 'RR    18', 'SpO2  98 %', 'Temp  37.1 °C', 'Pain  6 / 10  (headache)'], style: 'mono' },
      {
        heading: 'NOTE',
        lines: ['Headache × 2 days, worse tonight. Dizziness. Hx migraine with aura.', 'Pt reports 2× hydrocodone/APAP 5/325 at 21:00 (home supply, not his).'],
        style: 'normal',
      },
    ],
  });

  /** Susie decides for herself when the player is not her. Seeded, leaning clinical. */
  const autoBelieve = (): 'believe' | 'sedate' => {
    const toldLights = api.choice(C.tell_lights) === 'yes';
    return api.rng.chance(toldLights ? 0.35 : 0.55) ? 'believe' : 'sedate';
  };

  const applyBelieve = async (value: string, spoken: boolean): Promise<void> => {
    api.addChoice(C.believe_john, CHOICE_META.believe_john.label, value);
    if (value === 'believe') {
      api.setFlag(F.susie_believed);
      if (spoken) api.say(LINES.susieCheck.believe, 3.6, 'Susie');
      api.objective('susie', 'Check CAM 03 (East Hall) from the station terminal.');
      store.setChar('susie', { status: 'Checking the cameras' });
    } else {
      api.setFlag(F.john_sedated);
      const p = store.char('john').perception;
      store.setPerception('john', { medication: p.medication + 0.4, fear: p.fear * 0.6 });
      if (spoken) {
        api.say(LINES.susieCheck.sedate, 3.8, 'Susie');
        await wait(4);
        api.say(LINES.susieCheck.johnAfterSedate, 2, 'John');
      }
      store.setChar('john', { status: 'Resting — Bay 3 (medicated)' });
      hooks.johnSedated?.();
    }
    api.setFlag(DF.believe_resolved);
  };

  const stopAlarm = (): void => {
    if (alarmHandle) {
      alarmHandle.stop(0.6);
      alarmHandle = null;
    }
    try {
      const st = store.get();
      s.world.setScreen('exam2_monitor', st.zones.exam || st.power === 'normal' || st.power === 'unstable' ? 'vitals' : 'off');
    } catch {
      /* optional */
    }
    api.setFlag(DF.alvarez_alarm_live, false);
    hooks.stopAlarm?.();
  };

  const hydrocodoneExchange = async (ctx: { witnessed: boolean }, susieView: boolean): Promise<void> => {
    api.say('And you took something for it tonight?', 2.4, 'Susie');
    await wait(2.8);
    api.say(LINES.triage.johnPills, 3, 'John');
    if (susieView && (ctx.witnessed || loc('susie') === 'triage')) api.addClue(CLUE.hydrocodone);
    await wait(3.2);
  };

  // ---------------------------------------------------------------------------
  // Phase 1 — Normal (22:45–23:05)
  // ---------------------------------------------------------------------------

  const beats: GameEventDef[] = [
    beat({
      id: 'beat_shift_start',
      title: 'Shift begins',
      window: [0.2, 0.2],
      room: 'waiting',
      characters: ['john', 'susie', 'paul'],
      consequences: () => {
        api.objective('john', 'Wait to be called.');
        api.objective('susie', 'Badge in. Check the board and your patients.');
        api.objective('paul', 'Restock Supply, then check the generator log.');
        store.setChar('john', { status: 'Waiting to be seen' });
        store.setChar('susie', { status: 'Starting shift' });
        store.setChar('paul', { status: 'Rounds — service hall' });
      },
    }),

    beat({
      id: 'beat_marcus_backed_up',
      title: 'Marcus: backed up',
      window: [2.4, 3.4],
      room: 'waiting',
      characters: ['john'],
      presentation: {
        john: {
          run: () => {
            if (loc('john') !== 'waiting') return;
            s.audio.play('typing', { pos: v3(-9.0, 1.0, -2.3), volume: 0.3 });
            api.say(LINES.marcus.byPhase.normal[0], 3.2, MARCUS);
          },
        },
      },
    }),

    beat({
      id: 'beat_page_john',
      title: '23:00 page: John Mercer to triage',
      window: [15, 15],
      room: 'corridor',
      characters: ['john', 'susie'],
      presentation: {
        any: {
          run: async () => {
            s.audio.play('intercom_chime', { nonSpatial: true, volume: 0.5 });
            await wait(0.9);
            api.say(LINES.intercom.johnToTriage, 4, 'Intercom');
            await s.audio.intercom(LINES.intercom.johnToTriage);
            if (view() === 'john' && loc('john') === 'waiting') {
              await wait(1.2);
              api.say("That's you.", 2, MARCUS);
            }
          },
        },
      },
      consequences: () => {
        s.world.setDoorAccess('d_triage', 'all');
        api.setFlag(F.john_called);
        api.objective('john', 'Go to Triage — the door past the registration desk.');
        api.objective('susie', 'Take John Mercer’s vitals in Triage.');
        store.setChar('john', { status: 'Called to triage' });
      },
    }),

    beat({
      id: 'beat_triage_vitals',
      title: 'Triage: vitals',
      window: [16, 21],
      room: 'triage',
      characters: ['john', 'susie'],
      tags: ['after'],
      requires: () => loc('john') === 'triage' || store.get().time >= 20.6,
      presentation: {
        john: {
          run: async (ctx) => {
            api.say(LINES.triage.seat, 2.6, 'Susie');
            await wait(3);
            s.audio.play('monitor_beep', { pos: v3(-7.4, 1.3, -4.6), volume: 0.4 });
            await api.doc(vitalsDoc());
            api.say(LINES.triage.vitals, 3.4, 'Susie');
            await wait(3.6);
            const answer = await api.ask(LINES.triage.question, optionsFor('tell_lights'), { speaker: 'Susie', timeoutSeconds: 16, defaultId: 'no' });
            api.addChoice(C.tell_lights, CHOICE_META.tell_lights.label, answer);
            api.setFlag(F.john_told_lights, answer === 'yes');
            if (answer === 'yes') {
              api.say(LINES.triage.afterYes, 3.4, 'Susie');
              await wait(3.6);
              api.say(LINES.triage.johnPills, 3, 'John');
              await wait(3.2);
            } else {
              api.say(LINES.triage.afterNo, 2.6, 'Susie');
              await wait(2.8);
              await hydrocodoneExchange(ctx, false);
            }
            api.say("Alright. Let's get you a bed.", 2.4, 'Susie');
          },
        },
        susie: {
          run: async (ctx) => {
            api.say(LINES.triage.seat, 2.6, 'Susie');
            await wait(3);
            s.audio.play('monitor_beep', { pos: v3(-7.4, 1.3, -4.6), volume: 0.4 });
            await api.doc(vitalsDoc());
            api.say(LINES.triage.vitals, 3.4, 'Susie');
            await wait(3.6);
            api.say(LINES.triage.question, 3, 'Susie');
            await wait(3.2);
            api.say(LINES.triage.johnNo, 2.2, 'John');
            api.addChoice(C.tell_lights, CHOICE_META.tell_lights.label, 'no');
            api.setFlag(F.john_told_lights, false);
            await wait(2.4);
            await hydrocodoneExchange(ctx, true);
            api.say("Okay. That's going in the chart. Let's get you a bed.", 3, 'Susie');
          },
        },
      },
      consequences: () => {
        api.setFlag(F.john_triaged);
        if (api.choice(C.tell_lights) === undefined) {
          api.addChoice(C.tell_lights, CHOICE_META.tell_lights.label, 'no');
          api.setFlag(F.john_told_lights, false);
        }
        store.setChar('john', { status: 'In triage' });
      },
    }),

    beat({
      id: 'beat_roomed',
      title: '23:05 John roomed in Bay 3',
      window: [20, 24.5],
      room: 'exam3',
      characters: ['john', 'susie'],
      requires: () => Boolean(api.flag(F.john_triaged)) || store.get().time >= 24.4,
      presentation: {
        john: {
          run: () => {
            api.say(LINES.triage.rooming, 3.6, 'Susie');
            s.audio.play('door_open', { pos: P.exam3_door, volume: 0.4 });
          },
        },
        susie: {
          run: async () => {
            api.say(LINES.triage.rooming, 3.6, 'Susie');
            await wait(3.8);
            api.say('Thanks.', 1.4, 'John');
          },
        },
      },
      consequences: () => {
        s.world.setDoorAccess('d_exam3', 'all');
        s.world.setCallLight('exam3', false);
        api.setFlag(F.john_roomed);
        api.objective('john', LINES.triage.objectiveAfter);
        api.objective('susie', 'Start rounds: Bay 2, then Bay 4.');
        store.setChar('john', { status: 'Waiting — Bay 3' });
        store.setChar('susie', { status: 'Rounds' });
      },
    }),

    // ---------------------------------------------------------------------------
    // Phase 2 — Unease (23:05–23:35)
    // ---------------------------------------------------------------------------

    beat({
      id: 'beat_alvarez_man',
      title: 'Mrs. Alvarez: the man at my door',
      window: [27, 34],
      room: 'exam2',
      characters: ['susie'],
      requires: () => loc('susie') === 'exam2' || store.get().time >= 33.6,
      presentation: {
        susie: {
          run: async (ctx) => {
            if (loc('susie') !== 'exam2') return;
            hooks.cast?.alvarezMurmur(2.6);
            api.say(LINES.alvarez.question, 3.2, 'Mrs. Alvarez');
            await wait(3.6);
            hooks.cast?.alvarezMurmur(3);
            api.say(LINES.alvarez.detail, 3.8, 'Mrs. Alvarez');
            await wait(4);
            api.say(LINES.alvarez.susieReply, 3.4, 'Susie');
            if (ctx.witnessed || loc('susie') === 'exam2') api.addClue(CLUE.alvarez_man);
            hooks.bumpFear?.('susie', 0.06);
          },
        },
        john: {
          run: () => {
            // from Bay 3 the murmur carries through the staff passage wall
            if (loc('john') === 'exam3') hooks.cast?.alvarezMurmur(2.2);
          },
        },
      },
      consequences: () => {
        api.setFlag(DF.alvarez_man_said);
        api.setFlag(SUBFLAGS.alvarez_man);
      },
    }),

    // ---------------------------------------------------------------------------
    // Phase 3 — Contradictions (23:35–00:05)
    // ---------------------------------------------------------------------------

    beat({
      id: 'beat_hall_figure',
      title: '23:45 the hallway figure',
      window: [60, 60],
      room: 'corridor',
      characters: ['john'],
      realIn: REAL,
      presentation: {
        john: {
          run: async () => {
            if (loc('john') === 'exam3') void s.world.setDoorOpen('d_exam3', true);
            s.lighting.setFixture('corridor_fl_14', 'flicker', 2.6);
            s.audio.play('light_buzz', { pos: v3(16.25, 2.7, 0), volume: 0.45 });
            await wait(0.8);
            s.audio.play('knock_soft', { pos: v3(17.5, 1.0, 0.3), volume: 0.5 });
            let fig: FigureHandle | null = null;
            try {
              fig = s.characters.spawnFigure({
                id: 'anom_hall_figure',
                pos: P.hall_figure_e,
                yaw: Math.PI / 2,
                outfit: 'dark',
                anim: 'stand_still',
                visibleTo: ['john'],
                vanishWithin: 7,
                vanishWhenUnseen: 3,
                duration: 45,
              });
            } catch (err) {
              console.error('[beats] figure spawn failed', err);
            }
            if (!fig) return;
            const until = performance.now() + 45000;
            let seen = false;
            while (performance.now() < until && !fig.removed) {
              if (!seen && view() === 'john' && fig.isSeen()) {
                seen = true;
                api.setFlag(F.figure_seen_john);
                api.say(LINES.figure.johnSees, 3.2);
                hooks.bumpFear?.('john', 0.3);
                s.postfx.pulse('heartbeat', 0.7);
                s.audio.play('drone_rise', { nonSpatial: true, volume: 0.35 });
                store.setChar('john', { status: 'Saw something — Bay 3' });
              }
              await wait(0.25);
            }
            if (seen && view() === 'john') api.say(LINES.figure.johnGone, 1.6);
          },
        },
        susie: {
          run: async () => {
            s.lighting.setFixture('corridor_fl_14', 'flicker', 2.6);
            if (api.scenario !== 'grounded') return;
            const walker = await hooks.cast?.okaforWander('back_to_bed');
            const until = performance.now() + 30000;
            while (walker && !walker.removed && performance.now() < until) {
              if (view() === 'susie' && walker.isSeen()) {
                api.say(LINES.figure.susieOkafor, 3, 'Susie');
                break;
              }
              await wait(0.3);
            }
          },
        },
        paul: {
          run: () => {
            s.lighting.setFixture('corridor_fl_14', 'flicker', 2.6);
          },
        },
        truth: {
          run: () => {
            if (hooks.isWatchingCam?.('cam_hall_e')) {
              s.cctv.inject('cam_hall_e', 2, injectSilhouette(sil, P.hall_figure_e, Math.PI / 2));
              api.addClue(CLUE.two_frames);
              api.say('(two frames. Then nothing.)', 2.6);
            } else if (view() === 'cctv') {
              s.cctv.glitch(store.get().activeCamera ?? 'cam_hall_e', 'skip', 0.2);
            }
          },
        },
        cctv: {
          run: () => {
            s.cctv.glitch(store.get().activeCamera ?? 'cam_hall_e', 'skip', 0.15);
          },
        },
      },
      consequences: () => {
        api.setFlag(DF.hall_figure_fired);
        if (real()) api.setFlag(F.figure_cctv_frames);
        if (api.scenario === 'grounded' && view() !== 'susie') {
          // the plausible source: Mr. Okafor shuffling back to Bay 4 twenty seconds later
          setTimeout(() => void hooks.cast?.okaforWander('back_to_bed'), 20000);
        }
      },
    }),

    beat({
      id: 'beat_paul_cascade',
      title: '23:50 strip lights go out toward Paul',
      window: [65, 65],
      room: 'service_n',
      characters: ['paul'],
      presentation: {
        any: {
          run: async () => {
            const paul = store.char('paul');
            const toward = paul.location === 'service_n' ? { x: paul.position.x, z: paul.position.z } : { x: -1.5, z: 7 };
            s.audio.play('light_buzz', { pos: v3(toward.x, 2.5, 7), volume: 0.4 });
            if (view() === 'paul' && paul.location === 'service_n') api.say(LINES.anomalies.cascade, 3);
            await s.lighting.cascadeOff('service_n', toward, 0.7);
            await wait(1.2);
            if (view() === 'paul') {
              s.audio.play('radio_click', { nonSpatial: true, volume: 0.55 });
              api.say(LINES.radio.flickers, 3, RADIO);
              hooks.bumpFear?.('paul', 0.12);
            } else if (view() === 'susie' && loc('susie') === 'nurse_station') {
              s.audio.play('radio_voice', { pos: v3(-0.4, 0.8, -2.5), volume: 0.5 });
              api.say(LINES.radio.flickers, 3, RADIO);
            }
            await wait(4.5);
            s.lighting.setRoomLights('service_n', 'flicker', 2.5);
            await wait(2.6);
            s.lighting.setRoomLights('service_n', 'on');
          },
        },
      },
      consequences: () => {
        api.setFlag(SUBFLAGS.service_cascade_done);
        api.setFlag('west_wing_tripped');
        api.objective('paul', 'Check the panel in the electrical room.');
        store.setChar('paul', { status: 'Lights failing — service hall' });
      },
    }),

    beat({
      id: 'beat_susie_checks_john',
      title: '23:55 Susie checks on John',
      window: [70, 76],
      room: 'exam3',
      characters: ['susie', 'john'],
      tags: ['after'],
      requires: () => (loc('susie') === 'exam3' && loc('john') === 'exam3') || store.get().time >= 75.6,
      presentation: {
        susie: {
          run: async (ctx) => {
            if (loc('john') !== 'exam3') return;
            api.say('How are we doing, John?', 2.4, 'Susie');
            await wait(2.8);
            if (api.flag(DF.hall_figure_fired) && !api.flag(F.john_sedated)) {
              api.say(LINES.susieCheck.prompt, 2.6, 'Susie');
              await wait(2.8);
              api.say(LINES.susieCheck.johnYes, 4.2, 'John');
              api.addChoice(C.tell_figure, CHOICE_META.tell_figure.label, 'yes');
              api.setFlag(F.john_told_figure, true);
              // the monitor reads zero while he is talking
              try {
                s.world.setScreen('exam3_monitor', 'dead');
              } catch {
                /* optional */
              }
              s.audio.play('monitor_flat', { pos: v3(-5.9, 1.35, 4.9), volume: 0.5 });
              await wait(3.2);
              try {
                s.world.setScreen('exam3_monitor', 'vitals');
              } catch {
                /* optional */
              }
              if (ctx.witnessed || s.characters.canSee(v3(-5.9, 1.35, 4.9), 70, 6)) {
                api.say(LINES.anomalies.hrZero, 2, undefined);
                api.addClue(CLUE.impossible_vitals);
              }
              await wait(1.2);
              const value = await api.ask("He's looking at you like he needs an answer.", optionsFor('believe_john'), { timeoutSeconds: 22, defaultId: 'sedate' });
              await applyBelieve(value, true);
            } else {
              api.say("Pressure's coming down. Try to rest, okay? I'm right down the hall.", 3.6, 'Susie');
              api.setFlag(DF.believe_resolved);
            }
          },
        },
        john: {
          run: async () => {
            if (loc('john') !== 'exam3') return;
            s.audio.play('door_open', { pos: P.exam3_door, volume: 0.4 });
            await wait(1.2);
            api.say('How are we doing, John?', 2.4, 'Susie');
            await wait(2.6);
            if (api.flag(DF.hall_figure_fired)) {
              const tell = await api.ask(LINES.susieCheck.prompt, optionsFor('tell_figure'), { speaker: 'Susie', timeoutSeconds: 16, defaultId: 'no' });
              api.addChoice(C.tell_figure, CHOICE_META.tell_figure.label, tell);
              api.setFlag(F.john_told_figure, tell === 'yes');
              if (tell === 'yes') {
                await wait(1.4);
                await applyBelieve(autoBelieve(), true);
              } else {
                api.say("Okay. Try to rest. I'm right down the hall.", 3, 'Susie');
                api.setFlag(DF.believe_resolved);
              }
            } else {
              api.say("Pressure's coming down. Try to rest, okay?", 3, 'Susie');
              api.setFlag(DF.believe_resolved);
            }
            await wait(3.2);
            s.audio.play('door_close', { pos: P.exam3_door, volume: 0.4 });
          },
        },
      },
      consequences: () => {
        // whatever the player did not witness, the two of them settled between themselves
        if (!api.flag(DF.believe_resolved)) {
          if (api.flag(DF.hall_figure_fired) && !api.flag(F.john_sedated)) {
            api.addChoice(C.tell_figure, CHOICE_META.tell_figure.label, 'yes');
            api.setFlag(F.john_told_figure, true);
            void applyBelieve('sedate', false);
          } else {
            api.setFlag(DF.believe_resolved);
          }
        }
        api.objective('susie', api.flag(F.susie_believed) ? 'Check CAM 03 (East Hall) from the station terminal.' : 'Back to the station. Watch the board.');
      },
    }),

    beat({
      id: 'beat_pre_outage_radio',
      title: '23:59 voltage drops',
      window: [74, 74.6],
      room: 'nurse_station',
      characters: ['susie', 'paul'],
      presentation: {
        susie: {
          run: async () => {
            s.audio.play('radio_click', { pos: v3(-0.4, 0.8, -2.5), volume: 0.55 });
            api.say(LINES.radio.voltage, 3, RADIO);
            await wait(3.2);
            api.say(LINES.radio.whereIsRay, 2.6, RADIO);
          },
        },
        paul: {
          run: async () => {
            s.audio.play('radio_click', { nonSpatial: true, volume: 0.55 });
            api.say(LINES.radio.voltage, 3, RADIO);
            await wait(3.2);
            api.say('Paul, you near the panel?', 2.4, RADIO);
          },
        },
        john: {
          run: () => {
            s.lighting.flicker(loc('john'), 1.2, 0.5);
            s.audio.play('light_buzz', { nonSpatial: true, volume: 0.3 });
            api.say('(the lights dip)', 2);
          },
        },
        cctv: {
          run: () => s.cctv.glitch(store.get().activeCamera ?? 'cam_hall_w', 'tear', 0.5),
        },
      },
      consequences: () => {
        api.setFlag(DF.voltage_warned);
        api.objective('paul', 'Check the electrical room.');
        api.objective('susie', 'Voltage is dropping. Check on the bays.');
        store.setChar('paul', { status: 'Heading to Electrical' });
      },
    }),

    // ---------------------------------------------------------------------------
    // Phase 5 — Generator night (00:08–00:50)
    // ---------------------------------------------------------------------------

    beat({
      id: 'beat_generator_objectives',
      title: 'Generator: new objectives',
      window: [83.4, 83.4],
      room: 'corridor',
      characters: ['john', 'susie', 'paul'],
      presentation: {
        john: { run: () => api.say(LINES.generator.john, 3.2, 'John') },
        susie: { run: () => api.say(LINES.generator.susie, 3.4, 'Susie') },
        paul: { run: () => api.say(LINES.generator.paul, 3, 'Paul') },
      },
      consequences: () => {
        api.objective('susie', 'Check patients. Account for everyone.');
        api.objective('paul', 'Get to the generator.');
        api.objective('john', "Stay put… or don't.");
        store.setChar('john', { status: 'Alone — Bay 3' });
        store.setChar('susie', { status: 'Emergency protocol' });
        store.setChar('paul', { status: 'Generator' });
      },
    }),

    beat({
      id: 'beat_marcus_cams',
      title: 'Marcus: the camera wall is black',
      window: [87, 88.5],
      room: 'nurse_station',
      characters: ['paul', 'susie'],
      presentation: {
        paul: {
          run: () => {
            s.audio.play('radio_click', { nonSpatial: true, volume: 0.55 });
            api.say('Paul — the camera wall down here is black. Anything you can do about that?', 3.8, RADIO);
          },
        },
        susie: {
          run: () => {
            s.audio.play('radio_click', { pos: v3(-0.4, 0.8, -2.5), volume: 0.5 });
            api.say('Paul — the camera wall down here is black. Anything you can do?', 3.6, RADIO);
          },
        },
      },
      consequences: () => {
        api.setFlag(DF.cams_hint);
        api.objective('paul', 'Electrical room: decide which three zones the generator carries.');
      },
    }),

    beat({
      id: 'beat_john_isolated_pass',
      title: 'Something passes the door gap',
      window: [89, 97],
      room: 'corridor',
      characters: ['john'],
      realIn: REAL,
      requires: () => loc('john') === 'exam3' || store.get().time >= 96.6,
      presentation: {
        john: {
          run: async () => {
            if (loc('john') !== 'exam3') return;
            s.audio.play('door_creak', { pos: P.exam3_door, volume: 0.25, rate: 0.8 });
            await wait(1.5);
            if (api.scenario === 'grounded') {
              s.lighting.flicker('corridor', 1.6, 0.4);
              for (let i = 0; i < 4; i++) {
                s.audio.play('footstep_tile', { pos: v3(-11 + i * 2.2, 0.1, 0.5), volume: 0.4 - i * 0.07 });
                await wait(0.55);
              }
              return;
            }
            let fig: FigureHandle | null = null;
            try {
              fig = s.characters.spawnFigure({
                id: 'anom_door_pass',
                pos: v3(-12.2, 0, 0.55),
                yaw: -Math.PI / 2,
                outfit: 'dark',
                anim: 'wrong_gait',
                visibleTo: ['john'],
                path: [{ x: -3.2, z: 0.55 }],
                speed: 0.85,
                duration: 14,
                opacity: 0.92,
              });
            } catch (err) {
              console.error('[beats] figure spawn failed', err);
            }
            s.audio.play('drag', { pos: v3(-9, 0.2, 0.6), volume: 0.22, rate: 0.7 });
            if (!fig) return;
            const until = performance.now() + 13000;
            while (performance.now() < until && !fig.removed) {
              if (view() === 'john' && fig.isSeen()) {
                api.say(LINES.anomalies.doorGap, 3);
                hooks.bumpFear?.('john', 0.16);
                s.postfx.pulse('heartbeat', 0.5);
                break;
              }
              await wait(0.25);
            }
          },
        },
        truth: {
          run: () => {
            if (hooks.isWatchingCam?.('cam_hall_w')) {
              s.cctv.inject('cam_hall_w', 2, injectSilhouette(sil, v3(-7.7, 0, 0.55), -Math.PI / 2));
              s.cctv.markFootage('cam_hall_w', 'Figure outside Bay 3');
            }
          },
        },
      },
    }),

    beat({
      id: 'beat_alvarez_alarm',
      title: '00:20 Bay 2 alarms, Bay 3 call light',
      window: [95, 95],
      room: 'exam2',
      characters: ['susie', 'john'],
      presentation: {
        any: {
          run: async () => {
            try {
              s.world.setScreen('exam2_monitor', 'alarm');
            } catch {
              /* optional */
            }
            alarmHandle = s.audio.play('monitor_alarm', { pos: v3(-11.9, 1.35, 4.9), loop: true, volume: 0.7 });
            hooks.startAlarm?.();
            await wait(2.2);
            s.world.setCallLight('exam3', true);
            s.audio.play('call_light', { pos: v3(-2.8, 2.0, -5.55), volume: 0.55 });
            s.audio.play('call_light', { pos: v3(-7.7, 2.35, 1.35), volume: 0.4 });
            api.setFlag(DF.john_call_light);
            const v = view();
            if (v === 'john') {
              api.say("(the call light above your door comes on. You didn't press it.)", 4);
              hooks.bumpFear?.('john', 0.14);
            } else if (v === 'susie') {
              await wait(0.8);
              const value = await api.ask("Bay 2's monitor is alarming. Bay 3's call light just went on.", optionsFor('alvarez_or_john'), {
                timeoutSeconds: 18,
                defaultId: 'alvarez',
              });
              api.addChoice(C.alvarez_or_john, CHOICE_META.alvarez_or_john.label, value);
              api.setFlag(value === 'alvarez' ? F.susie_went_alvarez : F.susie_went_john);
              api.objective('susie', value === 'alvarez' ? 'Go to Bay 2.' : 'Go to Bay 3.');
            }
          },
        },
      },
      consequences: () => {
        api.setFlag(DF.alvarez_alarm_live);
        api.setFlag(SUBFLAGS.alvarez_alarm);
        api.setFlag(DF.john_alone_since, store.get().time);
        if (!controlled('susie') && api.choice(C.alvarez_or_john) === undefined) {
          // the nurse answers the monitor; that is what nurses do
          api.addChoice(C.alvarez_or_john, CHOICE_META.alvarez_or_john.label, 'alvarez');
          api.setFlag(F.susie_went_alvarez);
          hooks.susieRedirect?.('exam2', 3.5);
        }
        store.setChar('susie', { status: 'Responding — Bay 2 alarm' });
        // the alarm resolves itself eventually: a lead came off
        setTimeout(() => {
          if (api.flag(DF.alvarez_alarm_live)) stopAlarm();
        }, 6 * 10 * 1000);
      },
    }),

    beat({
      id: 'beat_drag_marks',
      title: 'Drag marks to the generator room',
      window: [96, 96.5],
      room: 'service_n',
      characters: ['paul'],
      scenarios: REAL,
      realIn: REAL,
      presentation: {
        any: {
          run: () => {
            s.world.addFloorDecal(
              'drag',
              [
                { x: -10.6, z: 7.0 },
                { x: -6, z: 7.05 },
                { x: -1, z: 7.1 },
                { x: 4, z: 7.0 },
                { x: 8, z: 7.15 },
                { x: 10.6, z: 7.45 },
                { x: 11.1, z: 8.7 },
                { x: 12.4, z: 9.8 },
              ],
              {},
            );
            hooks.pendingClue?.(CLUE.drag_marks, v3(5, 0.05, 7.1), ['paul'], ['service_n', 'generator', 'electrical'], 80 * 60);
            hooks.pendingClue?.(CLUE.drag_marks, v3(-9, 0.05, 7.0), ['paul'], ['service_n', 'closed_wing'], 80 * 60);
          },
        },
      },
    }),

    beat({
      id: 'beat_john_hint_leave',
      title: 'John: nobody is coming',
      window: [98, 103],
      room: 'exam3',
      characters: ['john'],
      requires: () => {
        const since = api.flag(DF.john_alone_since);
        return typeof since === 'number' && store.get().time - since >= 3 && loc('john') === 'exam3' && !api.flag(F.john_sedated) && !api.flag(F.susie_went_john);
      },
      presentation: {
        john: {
          run: () => {
            api.say('(you can hear the generator through the wall. Nobody has come.)', 4);
            api.objective('john', "Nobody's coming. The nurse station is down the hall, on the left.");
          },
        },
      },
      consequences: () => {
        api.setFlag(DF.john_hint_leave);
        if (!controlled('john')) {
          api.setFlag(F.john_left_room);
          hooks.johnLeavesRoom?.();
        }
      },
    }),

    beat({
      id: 'beat_cam_generator_figure',
      title: 'CAM 08: someone behind Paul',
      window: [100, 114],
      room: 'generator',
      characters: ['paul'],
      offscreen: false,
      realIn: REAL,
      requires: () => loc('paul') === 'generator' && Boolean(hooks.isWatchingCam?.('cam_generator')),
      presentation: {
        truth: {
          run: () => {
            const paul = store.char('paul').position;
            const cam = s.layout.cameras.find((c) => c.id === 'cam_generator');
            const dx = cam ? paul.x - cam.pos.x : -1;
            const dz = cam ? paul.z - cam.pos.z : -1;
            const len = Math.hypot(dx, dz) || 1;
            const pos = v3(Math.min(17.6, Math.max(10.4, paul.x + (dx / len) * 1.4)), 0, Math.min(13.6, Math.max(8.8, paul.z + (dz / len) * 1.4)));
            const yaw = Math.atan2(-(paul.x - pos.x), -(paul.z - pos.z));
            s.cctv.inject('cam_generator', 2, injectSilhouette(sil, pos, yaw));
            api.say(LINES.anomalies.behindPaul, 2.6);
            s.cctv.markFootage('cam_generator', 'Someone behind Paul');
          },
        },
        cctv: {
          run: () => s.cctv.glitch('cam_generator', 'skip', 0.3),
        },
      },
    }),

    beat({
      id: 'beat_timestamp_jump',
      title: 'CAM 03 time-stamp jumps back',
      window: [104, 118],
      room: 'corridor',
      characters: ['susie'],
      offscreen: false,
      requires: () => Boolean(hooks.isWatchingCam?.('cam_hall_e')),
      presentation: {
        any: {
          run: async () => {
            if (hooks.jumpTimestamp) hooks.jumpTimestamp('cam_hall_e', -11, 6);
            else s.cctv.glitch('cam_hall_e', 'timestamp', 6);
            await wait(1.4);
            api.say(LINES.anomalies.timestamp, 3.2);
            api.addClue(CLUE.timestamp_jump);
          },
        },
      },
    }),

    beat({
      id: 'beat_okafor_wander_out',
      title: 'Mr. Okafor wanders',
      window: [102, 116],
      room: 'corridor',
      characters: ['susie'],
      chance: 0.85,
      presentation: {
        any: {
          run: async () => {
            const walker = await hooks.cast?.okaforWander('out_to_hall');
            hooks.pendingClue?.(CLUE.okafor_wander, v3(3.2, 0.9, 0.5), ['susie', 'paul'], ['corridor', 'nurse_station'], 6 * 60, () => Boolean(walker && !walker.removed));
            // a line when someone reaches him
            const until = performance.now() + 5 * 60 * 1000;
            while (performance.now() < until && walker && !walker.removed) {
              const v = view();
              if (v === 'susie' || v === 'paul') {
                const p = store.char(v).position;
                if (loc(v) === 'corridor' && Math.hypot(p.x - 3.2, p.z - 0.5) < 2.6) {
                  s.audio.murmur(v3(3.2, 1.5, 0.5), 2.2, { pitch: 0.85 });
                  api.say(LINES.okafor.hallway, 3, 'Mr. Okafor');
                  await wait(3.2);
                  if (v === 'susie') api.say(LINES.okafor.redirect, 3, 'Susie');
                  break;
                }
              }
              await wait(0.4);
            }
          },
        },
      },
      consequences: () => {
        api.setFlag(DF.okafor_wandered);
        api.setFlag(SUBFLAGS.okafor_wandered);
      },
    }),

    // ---------------------------------------------------------------------------
    // Phase 6 — Crisis (00:50–01:30)
    // ---------------------------------------------------------------------------

    beat({
      id: 'beat_paul_surge',
      title: '01:05 the generator surges',
      window: [140, 140],
      room: 'generator',
      characters: ['paul'],
      presentation: {
        any: {
          run: async () => {
            s.lighting.flicker('generator', 3.5, 0.9);
            s.lighting.flicker('service_n', 2.5, 0.6);
            s.audio.play('generator_fail', { pos: P.generator_unit, volume: 0.8 });
            s.cctv.glitch('cam_generator', 'offline_blip', 5);
            const v = view();
            if (v === 'paul' && loc('paul') === 'generator') api.say(LINES.crisis.paulGenerator, 3, 'Paul');
            if (v === 'paul' || v === 'susie') {
              await wait(1.2);
              s.audio.play('radio_click', { nonSpatial: true, volume: 0.5 });
              s.audio.play('static_burst', { nonSpatial: true, volume: 0.4 });
            }
            if (store.get().zones.west_wing) {
              await wait(2.2);
              s.world.setDoorLocked('d_closed_wing', false);
              s.audio.play('metal_groan', { pos: P.closed_wing_door, volume: 0.6, rate: 0.75 });
              await s.world.setDoorOpen('d_closed_wing', true);
              s.audio.play('door_creak', { pos: P.closed_wing_door, volume: 0.5, rate: 0.85 });
              api.setFlag(F.west_wing_door_open);
              hooks.pendingClue?.(CLUE.west_wing_open, v3(P.closed_wing_door.x + 0.2, 1.2, P.closed_wing_door.z), ['paul'], ['service_n', 'closed_wing'], 40 * 60);
              if (v === 'paul' && loc('paul') === 'service_n') api.say(LINES.crisis.paulDoor, 3.4, 'Paul');
              api.objective('paul', 'The west wing door is open.');
            } else {
              api.objective('paul', 'Keep the generator running.');
            }
          },
        },
      },
      consequences: () => {
        api.setFlag(DF.paul_surge_done);
        store.setChar('paul', { status: 'Generator surging' });
      },
    }),

    beat({
      id: 'beat_susie_elevator',
      title: '01:15 the elevator opens',
      window: [150, 150],
      room: 'corridor',
      characters: ['susie'],
      presentation: {
        any: {
          run: async () => {
            s.audio.play('elevator_tone', { pos: P.elevator_doors, volume: 0.6 });
            await wait(0.6);
            await s.world.setElevator(true, true);
            s.audio.play('light_flicker', { pos: v3(16, 2.3, -2.4), volume: 0.4 });
            await wait(0.9);
            void s.world.setElevator(true, false);
            const cctvOn = store.get().zones.cctv;
            let cab: FigureHandle | null = null;
            if (cctvOn) {
              // the dead elevator camera wakes by itself, and shows what is standing in the cab
              s.cctv.setOnline('cam_elevator', true);
              try {
                cab = s.characters.spawnFigure({ id: 'anom_cab_figure', pos: v3(16, 0, -2.5), yaw: 0, outfit: 'dark', anim: 'stand_still', visibleTo: ['cctv'], duration: 32 });
              } catch (err) {
                console.error('[beats] cab figure failed', err);
              }
              hooks.pendingClue?.(CLUE.cab_figure, v3(16, 1.0, -2.5), [], [], 32, () => Boolean(hooks.isWatchingCam?.('cam_elevator')));
              setTimeout(() => {
                s.cctv.setOnline('cam_elevator', false);
                if (cab && !cab.removed) cab.remove(0);
              }, 32000);
            }
            if (view() === 'susie') {
              api.say(LINES.crisis.susieElevator, 3.6, 'Susie');
              await wait(2.2);
              const value = await api.ask('The elevator just opened on a dark cab.', optionsFor('hold_or_investigate'), { timeoutSeconds: 20, defaultId: 'hold' });
              api.addChoice(C.hold_or_investigate, CHOICE_META.hold_or_investigate.label, value);
              if (value === 'hold') {
                api.setFlag(F.susie_held_position);
                api.objective('susie', 'Stay at the station. Account for everyone.');
              } else {
                api.setFlag(F.susie_investigated_elevator);
                api.objective('susie', 'Look at the elevator.');
              }
            }
          },
        },
      },
      consequences: () => {
        api.setFlag(DF.elevator_beat_done);
        if (!controlled('susie')) {
          // nobody tells her not to look
          api.addChoice(C.hold_or_investigate, CHOICE_META.hold_or_investigate.label, 'investigate');
          api.setFlag(F.susie_investigated_elevator);
          hooks.susieToElevator?.();
        }
      },
    }),

    // ---------------------------------------------------------------------------
    // Phase 7 — Resolution (01:30–01:45)
    // ---------------------------------------------------------------------------

    beat({
      id: 'beat_resolution',
      title: '01:30 relief call',
      window: [165, 165],
      room: 'corridor',
      characters: ['john', 'susie', 'paul'],
      presentation: {
        any: {
          run: async () => {
            stopAlarm();
            s.audio.setTension(0);
            api.say(LINES.resolution.settle, 2.6);
            await wait(2.8);
            s.audio.play('intercom_click', { nonSpatial: true, volume: 0.5 });
            await wait(0.8);
            api.say(LINES.intercom.relief, 4, 'Marcus (intercom)');
            await s.audio.intercom(LINES.intercom.relief);
          },
        },
      },
      consequences: () => {
        api.setFlag(DF.relief_called);
        api.objective('john', 'Wait for morning.');
        api.objective('susie', 'Account for everyone.');
        api.objective('paul', 'Keep the generator running.');
        for (const room of ['exam1', 'exam2', 'exam3', 'exam4', 'exam5'] as const) s.world.setCallLight(room, false);
      },
    }),

    beat({
      id: 'beat_closing_john',
      title: 'John, after',
      window: [168, 169.5],
      room: 'exam3',
      characters: ['john'],
      presentation: {
        john: {
          run: () => {
            if (api.flag(F.john_sedated)) api.say("(your head is clear for the first time all night. You don't remember most of it.)", 4.5);
            else if (api.flag(F.john_at_station)) api.say('(the hall is quiet. You decide to stop looking at the end of it.)', 4);
            else api.say('(you count the ceiling tiles again. Still twenty-two.)', 4);
          },
        },
      },
      consequences: () => api.setFlag(DF.john_closing_said),
    }),

    beat({
      id: 'beat_closing_susie',
      title: 'Susie, after',
      window: [170, 171.5],
      room: 'nurse_station',
      characters: ['susie'],
      presentation: {
        susie: {
          run: () => {
            if (api.flag(F.susie_believed)) api.say("I wrote it down. Time, place, what he said. It's in the chart now.", 4, 'Susie');
            else if (api.flag(F.john_sedated)) api.say("He'll sleep till day shift. That's the kind thing. Probably.", 4, 'Susie');
            else api.say("Everyone's where they should be. Mostly.", 3.4, 'Susie');
          },
        },
      },
      consequences: () => api.setFlag(DF.susie_closing_said),
    }),

    beat({
      id: 'beat_closing_paul',
      title: 'Paul, after',
      window: [172, 173.5],
      room: 'generator',
      characters: ['paul'],
      presentation: {
        paul: {
          run: () => {
            if (api.flag(F.paul_entered_west_wing)) api.say("I'm not writing any of that in the log.", 3.4, 'Paul');
            else if (api.flag(F.paul_shut_west_wing)) api.say("Breaker's off. Whatever it was running, it isn't now.", 3.8, 'Paul');
            else if (api.flag(F.paul_reset_west_wing)) api.say("Still humming back there. Not my problem till it is.", 3.6, 'Paul');
            else api.say("Load's steady. Twenty minutes. Fine.", 3, 'Paul');
          },
        },
      },
      consequences: () => api.setFlag(DF.paul_closing_said),
    }),
  ];

  return beats;
}
