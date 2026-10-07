import { describe, expect, it } from 'vitest';
import { Narration, type NarrationMedia } from '../src/audio/narration';
import { makeInitialState } from '../src/core/state';
import { DEFAULT_SETTINGS } from '../src/core/types';
import { BRIEFING_CUES } from '../src/ui/briefing.cues';
import { AUTOPLAY_DELAY, AutoplayGate, CUE_LEAD, CUE_RELEASE, activeLine, formatTime, listenView, richText } from '../src/ui/briefing.flow';
import { BRIEFING, briefingLines, plainText, speechHash, spokenText, type BriefingCues } from '../src/ui/briefing.script';
import { ENDING_TITLES } from '../src/ui/UIManager.ending';

class FakeMedia implements NarrationMedia {
  volume = 1;
  currentTime = 0;
  duration = Number.NaN;
  preload = '';
  paused = true;
  srcSets = 0;
  mode: 'promise' | 'none' | 'throw' = 'promise';
  resolvePlay: (() => void) | null = null;
  rejectPlay: ((e: unknown) => void) | null = null;
  private _src = '';
  private listeners: Record<string, (() => void)[]> = {};

  get src(): string {
    return this._src;
  }
  set src(v: string) {
    this._src = v;
    this.srcSets++;
  }
  play(): Promise<void> | undefined {
    if (this.mode === 'throw') throw new Error('not allowed');
    this.paused = false;
    if (this.mode === 'none') return undefined;
    return new Promise<void>((resolve, reject) => {
      this.resolvePlay = resolve;
      this.rejectPlay = reject;
    });
  }
  pause(): void {
    this.paused = true;
  }
  addEventListener(type: string, listener: () => void): void {
    (this.listeners[type] ??= []).push(listener);
  }
  fire(type: 'ended' | 'error'): void {
    for (const l of this.listeners[type] ?? []) l();
  }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function rig(): { m: FakeMedia; n: Narration } {
  const m = new FakeMedia();
  return { m, n: new Narration(() => m) };
}

describe('Narration (the recorded title briefing)', () => {
  it('starts from the top at the master level, loading until the media runs, then playing', async () => {
    const { m, n } = rig();
    n.setLevel(0.5);
    m.currentTime = 12;
    n.play('/briefing.mp3');
    expect(m.src).toBe('/briefing.mp3');
    expect(m.preload).toBe('auto');
    expect(m.currentTime).toBe(0);
    expect(m.volume).toBe(0.5);
    expect(n.status().state).toBe('loading');
    expect(n.active).toBe(true);
    m.resolvePlay!();
    await flush();
    expect(n.status().state).toBe('playing');
  });

  it('reports failed when the browser refuses or the call throws', async () => {
    const { m, n } = rig();
    n.play('/a.mp3');
    m.rejectPlay!(new Error('NotAllowedError'));
    await flush();
    expect(n.status().state).toBe('failed');
    expect(n.active).toBe(false);
    m.mode = 'throw';
    n.play('/a.mp3');
    expect(n.status().state).toBe('failed');
  });

  it('treats a play() without a promise (older browsers) as playing', () => {
    const { m, n } = rig();
    m.mode = 'none';
    n.play('/a.mp3');
    expect(n.status().state).toBe('playing');
  });

  it('stop: reports stopped at once, stays active (ducking) while it fades, then pauses', async () => {
    const { m, n } = rig();
    n.setLevel(0.8);
    n.play('/a.mp3');
    m.resolvePlay!();
    await flush();
    n.stop(0.5);
    expect(n.status().state).toBe('stopped');
    expect(n.active).toBe(true);
    n.update(0.25);
    expect(m.volume).toBeCloseTo(0.4, 5);
    expect(m.paused).toBe(false);
    n.update(0.3);
    expect(m.volume).toBe(0);
    expect(m.paused).toBe(true);
    expect(n.active).toBe(false);
  });

  it('the fade has a wall-clock backstop: it stops even when no frames arrive', async () => {
    const { m, n } = rig();
    n.play('/a.mp3');
    n.stop(0.02);
    expect(m.paused).toBe(false);
    await new Promise((r) => setTimeout(r, 200));
    expect(m.paused).toBe(true);
    expect(m.volume).toBe(0);
    expect(n.active).toBe(false);
  });

  it('a new start cancels a pending backstop', async () => {
    const { m, n } = rig();
    n.play('/a.mp3');
    n.stop(0.02);
    n.play('/a.mp3');
    await new Promise((r) => setTimeout(r, 200));
    expect(m.paused).toBe(false);
    expect(m.volume).toBe(1);
  });

  it('a zero fade cuts immediately; stop when idle does nothing', () => {
    const { m, n } = rig();
    n.stop(0.5);
    expect(n.status().state).toBe('idle');
    n.play('/a.mp3');
    n.stop(0);
    expect(m.paused).toBe(true);
    expect(n.active).toBe(false);
  });

  it('a start that resolves after stop stays stopped', async () => {
    const { m, n } = rig();
    n.play('/a.mp3');
    n.stop(0.3);
    m.resolvePlay!();
    await flush();
    expect(n.status().state).toBe('stopped');
  });

  it('follows the media: ended when it runs out, failed on a media error', async () => {
    const { m, n } = rig();
    n.play('/a.mp3');
    m.resolvePlay!();
    await flush();
    m.fire('ended');
    expect(n.status().state).toBe('ended');
    expect(n.active).toBe(false);
    n.play('/a.mp3');
    m.fire('error');
    expect(n.status().state).toBe('failed');
  });

  it('clamps the level and scales it by the fade', () => {
    const { m, n } = rig();
    n.play('/a.mp3');
    n.setLevel(3);
    expect(m.volume).toBe(1);
    n.setLevel(-1);
    expect(m.volume).toBe(0);
    n.setLevel(0.6);
    n.stop(1);
    n.update(0.5);
    expect(m.volume).toBeCloseTo(0.3, 5);
  });

  it('status: time from the media, duration 0 until it is known', () => {
    const { m, n } = rig();
    expect(n.status()).toEqual({ state: 'idle', time: 0, duration: 0 });
    n.play('/a.mp3');
    m.currentTime = 4.5;
    expect(n.status().time).toBe(4.5);
    expect(n.status().duration).toBe(0);
    m.duration = 94;
    expect(n.status().duration).toBe(94);
  });

  it('replays from the top on one element, setting the source only when it changes', async () => {
    const { m, n } = rig();
    n.play('/a.mp3');
    m.resolvePlay!();
    await flush();
    n.stop(0.5);
    n.update(0.1);
    m.currentTime = 30;
    n.play('/a.mp3');
    expect(m.srcSets).toBe(1);
    expect(m.currentTime).toBe(0);
    expect(m.volume).toBe(1);
    n.play('/b.mp3');
    expect(m.srcSets).toBe(2);
  });

  it('dispose pauses and forgets the element', () => {
    const { m, n } = rig();
    n.play('/a.mp3');
    n.dispose();
    expect(m.paused).toBe(true);
    expect(n.status()).toEqual({ state: 'idle', time: 0, duration: 0 });
  });
});

describe('briefing script', () => {
  const lines = briefingLines();

  it('has unique ids, text on every line and sane pauses', () => {
    expect(new Set(lines.map((l) => l.id)).size).toBe(lines.length);
    for (const l of lines) {
      expect(l.text.trim().length).toBeGreaterThan(0);
      expect(l.gap).toBeGreaterThanOrEqual(0);
      expect(l.gap).toBeLessThanOrEqual(2);
      // emphasis marks come in pairs
      expect(l.text.split('*').length % 2).toBe(1);
    }
    expect(BRIEFING.filter((b) => b.kind === 'endings')).toHaveLength(1);
  });

  it('names the four endings exactly as the ending screen does', () => {
    const named = lines.filter((l) => l.ending).map((l) => l.ending!.toUpperCase());
    expect(named.sort()).toEqual(Object.values(ENDING_TITLES).map((t) => t.title).sort());
  });

  it('speaks the say text, else the ending title then the line, without emphasis marks', () => {
    expect(plainText('a *b* c')).toBe('a b c');
    expect(spokenText({ id: 'a', text: '*Keep* going.', gap: 0 })).toBe('Keep going.');
    expect(spokenText({ id: 'b', text: 'Everyone makes it.', ending: 'Morning Comes', gap: 0 })).toBe('Morning Comes. Everyone makes it.');
    expect(spokenText({ id: 'c', text: 'From 10:45', say: 'From ten forty-five', gap: 0 })).toBe('From ten forty-five');
  });

  it('hashes speech with FNV-1a (8 hex digits)', () => {
    expect(speechHash('')).toBe('811c9dc5');
    expect(speechHash('a')).toBe('e40c292c');
    expect(speechHash('One night')).not.toBe(speechHash('One Night'));
  });
});

describe('briefing cue sheet (written by tools/narration.mjs)', () => {
  const lines = briefingLines();

  it('has a cue for every line, recorded from its current words', () => {
    expect(Object.keys(BRIEFING_CUES.lines).sort()).toEqual(lines.map((l) => l.id).sort());
    for (const l of lines) {
      expect(BRIEFING_CUES.lines[l.id].hash, `"${l.id}" changed since it was recorded: run node tools/narration.mjs`).toBe(speechHash(spokenText(l)));
    }
  });

  it('runs in script order, every line ending before the next starts', () => {
    let prev = 0;
    for (const l of lines) {
      const cue = BRIEFING_CUES.lines[l.id];
      expect(cue.start).toBeGreaterThanOrEqual(prev);
      expect(cue.end - cue.start).toBeGreaterThan(0.3);
      prev = cue.end;
    }
    expect(BRIEFING_CUES.duration).toBeGreaterThanOrEqual(prev);
  });

  it('puts the highlight on each line while it is being read', () => {
    const order = lines.map((l) => l.id);
    for (const l of lines) {
      const cue = BRIEFING_CUES.lines[l.id];
      expect(activeLine(BRIEFING_CUES, order, (cue.start + cue.end) / 2)).toBe(l.id);
    }
  });
});

describe('briefing flow', () => {
  const CUES: BriefingCues = {
    duration: 10,
    lines: { a: { start: 1, end: 3, hash: '' }, b: { start: 4, end: 6, hash: '' }, c: { start: 7, end: 8, hash: '' } },
  };
  const ORDER = ['a', 'b', 'c'];

  it('activeLine: nothing before the first line, a line from just before it starts, held through the pause', () => {
    expect(activeLine(CUES, ORDER, 0)).toBeNull();
    expect(activeLine(CUES, ORDER, 1 - CUE_LEAD - 0.01)).toBeNull();
    expect(activeLine(CUES, ORDER, 1 - CUE_LEAD + 0.01)).toBe('a');
    expect(activeLine(CUES, ORDER, 3.5)).toBe('a');
    expect(activeLine(CUES, ORDER, 4)).toBe('b');
    expect(activeLine(CUES, ORDER, 7.5)).toBe('c');
  });

  it('activeLine: lets go after the last line, and skips ids without a cue', () => {
    expect(activeLine(CUES, ORDER, 8 + CUE_RELEASE - 0.01)).toBe('c');
    expect(activeLine(CUES, ORDER, 8 + CUE_RELEASE + 0.01)).toBeNull();
    expect(activeLine(CUES, ['a', 'x', 'b'], 4.5)).toBe('b');
  });

  it('formatTime', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(59.9)).toBe('0:59');
    expect(formatTime(94.02)).toBe('1:34');
    expect(formatTime(600)).toBe('10:00');
    expect(formatTime(-3)).toBe('0:00');
  });

  it('richText escapes, then turns *stars* into strong', () => {
    expect(richText('*Keep* <safe> & sound')).toBe('<strong>Keep</strong> &lt;safe&gt; &amp; sound');
    expect(richText("don't")).toBe('don&#39;t');
    expect(richText('plain')).toBe('plain');
  });

  it('listenView: Stop with the elapsed time while it runs, else Listen with the length', () => {
    expect(listenView('playing', 12.4, 94, false)).toEqual({ label: 'Stop', time: '0:12', playing: true });
    expect(listenView('loading', 0, 94, false)).toEqual({ label: 'Stop', time: '0:00', playing: true });
    for (const st of ['idle', 'ended', 'stopped', 'failed'] as const) expect(listenView(st, 50, 94, false)).toEqual({ label: 'Listen', time: '1:34', playing: false });
    expect(listenView('failed', 0, 94, true).time).toBe('no audio');
  });

  it('AutoplayGate: starts once, after the briefing has been up with sound allowed for the delay', () => {
    const g = new AutoplayGate();
    const on = { enabled: true, gestured: true, showing: true, busy: false };
    expect(g.update(AUTOPLAY_DELAY / 2, on)).toBe(false);
    expect(g.update(AUTOPLAY_DELAY / 2 + 0.01, on)).toBe(true);
    expect(g.update(5, on)).toBe(false);
    expect(g.done).toBe(true);
  });

  it('AutoplayGate: needs the setting, a gesture and the title on screen; leaving restarts the wait', () => {
    const g = new AutoplayGate();
    const on = { enabled: true, gestured: true, showing: true, busy: false };
    expect(g.update(5, { ...on, gestured: false })).toBe(false);
    expect(g.update(5, { ...on, enabled: false })).toBe(false);
    expect(g.update(AUTOPLAY_DELAY * 0.9, on)).toBe(false);
    // e.g. the first click was New Shift: the title went away before the voice began
    expect(g.update(0.1, { ...on, showing: false })).toBe(false);
    expect(g.update(AUTOPLAY_DELAY * 0.9, on)).toBe(false);
    expect(g.update(AUTOPLAY_DELAY * 0.2, on)).toBe(true);
  });

  it('AutoplayGate: never starts after the player started it; rearm allows one more', () => {
    const g = new AutoplayGate();
    const on = { enabled: true, gestured: true, showing: true, busy: false };
    expect(g.update(0.1, { ...on, busy: true })).toBe(false);
    expect(g.update(5, on)).toBe(false);
    g.rearm();
    expect(g.done).toBe(false);
    expect(g.update(AUTOPLAY_DELAY + 0.01, on)).toBe(true);
  });
});

describe('Title narration setting', () => {
  it('is on by default, including for settings saved before it existed', () => {
    expect(DEFAULT_SETTINGS.narration).toBe(true);
    expect(makeInitialState('NS-AAA-AAA', 'grounded', { masterVolume: 0.5 }).settings.narration).toBe(true);
  });
});
