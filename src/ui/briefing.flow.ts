/**
 * Pure logic behind the title briefing (briefing.ts draws it): which line the narrator is on, the
 * markup for a line, what the Listen button shows, and when the narration may start by itself.
 */
import type { NarrationState } from '../core/contracts';
import type { BriefingCues } from './briefing.script';
import { escapeHtml } from './UIManager.overlays';

/** The highlight lands this long before the voice, so it reads as in time. */
export const CUE_LEAD = 0.12;
/** After the last line, the highlight lets go this long after the voice does. */
export const CUE_RELEASE = 0.8;
/** How long the briefing must be on screen, with sound allowed, before it starts by itself. */
export const AUTOPLAY_DELAY = 0.8;

/** The line being spoken at `t`: the latest one that has started, held through the pause after it. */
export function activeLine(cues: BriefingCues, order: readonly string[], t: number): string | null {
  let current: string | null = null;
  for (const id of order) {
    const cue = cues.lines[id];
    if (!cue) continue;
    if (t + CUE_LEAD < cue.start) break;
    current = id;
  }
  if (current !== null && current === order[order.length - 1] && t > cues.lines[current].end + CUE_RELEASE) return null;
  return current;
}

/** 94.2 → "1:34" */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A script line as markup: escaped, with *stars* turned into <strong>. */
export function richText(text: string): string {
  return text
    .split('*')
    .map((part, i) => (i % 2 === 1 ? `<strong>${escapeHtml(part)}</strong>` : escapeHtml(part)))
    .join('');
}

export interface ListenView {
  label: 'Listen' | 'Stop';
  time: string;
  playing: boolean;
}

/** The Listen button: Stop with the elapsed time while the voice runs, else Listen with the length. */
export function listenView(state: NarrationState, time: number, length: number, unavailable: boolean): ListenView {
  const playing = state === 'loading' || state === 'playing';
  if (playing) return { label: 'Stop', time: formatTime(time), playing };
  return { label: 'Listen', time: unavailable ? 'no audio' : formatTime(length), playing };
}

export interface AutoplayInput {
  /** the Title narration setting */
  enabled: boolean;
  /** the page has had a click, tap or key press, so the browser lets it make sound */
  gestured: boolean;
  /** the briefing is on screen */
  showing: boolean;
  /** the narration is already loading or playing */
  busy: boolean;
}

/** Lets the narration start by itself once, after it has been eligible for AUTOPLAY_DELAY. */
export class AutoplayGate {
  private spent = false;
  private t = 0;

  /** True on the frame the narration should start. */
  update(dt: number, i: AutoplayInput): boolean {
    if (this.spent) return false;
    if (i.busy) {
      // the player started it: nothing left to start
      this.spent = true;
      return false;
    }
    if (!i.enabled || !i.gestured || !i.showing) {
      this.t = 0;
      return false;
    }
    this.t += dt;
    if (this.t < AUTOPLAY_DELAY) return false;
    this.spent = true;
    return true;
  }

  /** The setting was switched back on: one more start is allowed. */
  rearm(): void {
    this.spent = false;
    this.t = 0;
  }

  get done(): boolean {
    return this.spent;
  }
}
