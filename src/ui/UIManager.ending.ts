/**
 * Ending screen: a slow reveal — title, typed summary lines, then the night's record
 * (seed, clues with kind glyphs, choices, anyone missing) and two actions. The hidden
 * scenario is never shown; only what the player found.
 */
import type { Services } from '../core/contracts';
import type { CharacterId, Clue, ClueKind, EndingId } from '../core/types';
import { CHARACTER_META } from '../core/state';
import { formatClock12 } from '../core/clock';
import { escapeHtml } from './UIManager.overlays';

export interface EndingSummary {
  seed: string;
  clues: Clue[];
  choices: { label: string; value: string }[];
  missing: CharacterId[];
  lines: string[];
}

export type EndingResult = 'new_night' | 'title';

const TITLES: Record<EndingId, { title: string; sub: string }> = {
  morning: { title: 'MORNING COMES', sub: 'Everyone accounted for. Nothing explained.' },
  missing: { title: 'SOMEONE MISSING', sub: 'The shift ended before the count was right.' },
  rational: { title: 'A RATIONAL EXPLANATION', sub: 'Almost everything fits.' },
  came_through: { title: 'SOMETHING CAME THROUGH', sub: 'The footage does not lie. Or it does.' },
};

function clueGlyph(kind: ClueKind): string {
  const d: Record<ClueKind, string> = {
    physical: '<path d="M2 4 6 1.5 10 4v4.5L6 11 2 8.5Z"/><path d="M2 4l4 2.5 4-2.5M6 6.5V11"/>',
    record: '<path d="M3 1h4.5L10 3.5V11H3Z"/><path d="M4.5 6h3M4.5 8.2h3"/>',
    footage: '<path d="M1.5 4h6.5v5H1.5Z"/><path d="M8 6.2l3-1.8v4.2L8 6.8"/>',
    testimony: '<path d="M2 2h8v6H6.2L3.8 10V8H2Z"/>',
    infrastructure: '<path d="M7 1 3 7h3l-1 4 4-6H6Z"/>',
  };
  return `<svg class="ns-clue__glyph" viewBox="0 0 12 12" aria-hidden="true">${d[kind]}</svg>`;
}

export class EndingScreen {
  readonly el: HTMLElement;
  private s: Services;
  private titleEl: HTMLElement;
  private subEl: HTMLElement;
  private linesEl: HTMLElement;
  private recordEl: HTMLElement;
  private actionsEl: HTMLElement;
  private resolve: ((r: EndingResult) => void) | null = null;
  private active = false;
  private revealDone = false;
  private skipRequested = false;
  private timeline: { at: number; fn: () => void }[] = [];
  private t = 0;
  private typing: { el: HTMLElement; text: string; i: number; next: number } | null = null;
  private typeQueue: { el: HTMLElement; text: string }[] = [];
  private focusIndex = 0;
  private rng = { next: () => 0.5 };

  constructor(s: Services, parent: HTMLElement) {
    this.s = s;
    this.el = document.createElement('section');
    this.el.className = 'ns-ending';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="ns-ending__inner">
        <div class="ns-ending__kicker">SHIFT REPORT</div>
        <h1 class="ns-ending__title"></h1>
        <div class="ns-ending__sub"></div>
        <div class="ns-ending__lines"></div>
        <div class="ns-ending__record"></div>
        <div class="ns-ending__actions">
          <button class="ns-btn ns-ending__btn" data-r="new_night">New Night</button>
          <button class="ns-btn ns-ending__btn" data-r="title">Title</button>
        </div>
        <div class="ns-ending__hint">Enter · continue</div>
      </div>
    `;
    parent.appendChild(this.el);
    const q = (sel: string): HTMLElement => this.el.querySelector(sel) as HTMLElement;
    this.titleEl = q('.ns-ending__title');
    this.subEl = q('.ns-ending__sub');
    this.linesEl = q('.ns-ending__lines');
    this.recordEl = q('.ns-ending__record');
    this.actionsEl = q('.ns-ending__actions');
    this.actionsEl.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-r]');
      if (btn) this.finish(btn.dataset.r as EndingResult);
    });
    this.actionsEl.addEventListener('pointerover', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-r]');
      if (!btn) return;
      const i = this.buttons().indexOf(btn);
      if (i >= 0 && i !== this.focusIndex) this.setFocus(i, true);
    });
    this.el.addEventListener('pointerdown', () => this.skip());
  }

  get isActive(): boolean {
    return this.active;
  }

  show(ending: EndingId, summary: EndingSummary): Promise<EndingResult> {
    this.resolve?.('title');
    this.active = true;
    this.revealDone = false;
    this.skipRequested = false;
    this.t = 0;
    this.timeline = [];
    this.typing = null;
    this.typeQueue = [];
    this.rng = this.s.rng.fork('ui-ending');
    const meta = TITLES[ending];
    this.el.hidden = false;
    this.el.className = `ns-ending ns-ending--${ending}`;
    this.titleEl.textContent = meta.title;
    this.subEl.textContent = meta.sub;
    this.linesEl.innerHTML = '';
    this.recordEl.innerHTML = this.buildRecord(summary);
    this.el.classList.remove('is-in', 'show-title', 'show-sub', 'show-record', 'show-actions');
    void this.el.offsetWidth;
    this.el.classList.add('is-in');

    // Reveal schedule (real seconds)
    const lines = summary.lines.slice(0, 5);
    let at = 1.2;
    this.timeline.push({ at, fn: () => this.el.classList.add('show-title') });
    at += 1.5;
    this.timeline.push({ at, fn: () => this.el.classList.add('show-sub') });
    at += 1.1;
    for (const line of lines) {
      const el = document.createElement('p');
      el.className = 'ns-ending__line';
      this.linesEl.appendChild(el);
      this.timeline.push({ at, fn: () => this.typeQueue.push({ el, text: line }) });
      at += 0.7 + Math.min(2.6, line.length * 0.038);
    }
    at += 0.8;
    this.timeline.push({ at, fn: () => this.el.classList.add('show-record') });
    at += 1.2;
    this.timeline.push({
      at,
      fn: () => {
        this.el.classList.add('show-actions');
        this.revealDone = true;
        this.setFocus(0, false);
      },
    });
    return new Promise<EndingResult>((res) => {
      this.resolve = res;
    });
  }

  private buildRecord(sum: EndingSummary): string {
    const clues = sum.clues.length
      ? sum.clues
          .map(
            (c) =>
              `<li class="ns-clue ns-clue--${c.kind}">${clueGlyph(c.kind)}<span class="ns-clue__title">${escapeHtml(c.title)}</span><span class="ns-clue__meta">${escapeHtml(formatClock12(c.time))} · ${escapeHtml(sourceName(c.source))}</span></li>`,
          )
          .join('')
      : '<li class="ns-clue ns-clue--none">Nothing written down.</li>';
    const choices = sum.choices.length
      ? sum.choices.map((c) => `<li><span class="ns-rec__k">${escapeHtml(c.label)}</span><span class="ns-rec__v">${escapeHtml(c.value)}</span></li>`).join('')
      : '<li><span class="ns-rec__v">No decisions recorded.</span></li>';
    const missing = sum.missing.length
      ? sum.missing.map((id) => `<li class="is-missing">${escapeHtml(CHARACTER_META[id].name)} — unaccounted for</li>`).join('')
      : '<li>Everyone accounted for.</li>';
    return `
      <div class="ns-rec">
        <div class="ns-rec__row"><div class="ns-rec__h">Night seed</div><div class="ns-rec__seed">${escapeHtml(sum.seed)}</div></div>
        <div class="ns-rec__row"><div class="ns-rec__h">Clues found <span class="ns-rec__n">${sum.clues.length}</span></div><ul class="ns-rec__list ns-rec__clues">${clues}</ul></div>
        <div class="ns-rec__row"><div class="ns-rec__h">Choices</div><ul class="ns-rec__list">${choices}</ul></div>
        <div class="ns-rec__row"><div class="ns-rec__h">Count</div><ul class="ns-rec__list">${missing}</ul></div>
      </div>`;
  }

  /** Any input during the reveal fast-forwards it; after that, confirm activates the focused button. */
  skip(): void {
    if (!this.active || this.revealDone) return;
    this.skipRequested = true;
  }

  handleKey(e: KeyboardEvent): boolean {
    if (!this.active) return true;
    if (!this.revealDone) {
      if (['Enter', 'NumpadEnter', 'Space', 'Escape'].includes(e.code)) this.skip();
      return true;
    }
    switch (e.code) {
      case 'ArrowLeft':
      case 'ArrowUp':
        this.setFocus(this.focusIndex - 1, true);
        return true;
      case 'ArrowRight':
      case 'ArrowDown':
      case 'Tab':
        this.setFocus(this.focusIndex + 1, true);
        return true;
      case 'Enter':
      case 'NumpadEnter':
      case 'Space':
        this.finish(this.buttons()[this.focusIndex]?.dataset.r as EndingResult);
        return true;
      case 'Escape':
        this.finish('title');
        return true;
      default:
        return true;
    }
  }

  padAction(a: 'up' | 'down' | 'left' | 'right' | 'confirm' | 'cancel'): void {
    if (!this.active) return;
    if (!this.revealDone) {
      if (a === 'confirm') this.skip();
      return;
    }
    if (a === 'left' || a === 'up') this.setFocus(this.focusIndex - 1, true);
    else if (a === 'right' || a === 'down') this.setFocus(this.focusIndex + 1, true);
    else if (a === 'confirm') this.finish(this.buttons()[this.focusIndex]?.dataset.r as EndingResult);
    else if (a === 'cancel') this.finish('title');
  }

  private buttons(): HTMLElement[] {
    return Array.from(this.actionsEl.querySelectorAll<HTMLElement>('[data-r]'));
  }

  private setFocus(i: number, sound: boolean): void {
    const btns = this.buttons();
    if (!btns.length) return;
    this.focusIndex = (i + btns.length) % btns.length;
    btns.forEach((b, j) => b.classList.toggle('is-focus', j === this.focusIndex));
    btns[this.focusIndex].focus({ preventScroll: true });
    if (sound) this.s.audio.play('ui_hover', { nonSpatial: true, volume: 0.25 });
  }

  private finish(r: EndingResult | undefined): void {
    if (!this.active || !this.revealDone) return;
    this.s.audio.play(r === 'title' ? 'ui_back' : 'ui_select', { nonSpatial: true, volume: 0.45 });
    this.active = false;
    this.el.classList.add('is-out');
    const res = this.resolve;
    this.resolve = null;
    res?.(r ?? 'title');
  }

  update(dt: number): void {
    if (!this.active) return;
    if (this.skipRequested) {
      // run the whole schedule now and complete all typing
      for (const step of this.timeline) step.fn();
      this.timeline = [];
      if (this.typing) {
        this.typing.el.textContent = this.typing.text;
        this.typing = null;
      }
      for (const q of this.typeQueue) q.el.textContent = q.text;
      this.typeQueue = [];
      for (const el of Array.from(this.linesEl.children)) el.classList.add('is-done');
      this.skipRequested = false;
      return;
    }
    this.t += dt;
    while (this.timeline.length && this.timeline[0].at <= this.t) {
      this.timeline.shift()!.fn();
    }
    // typewriter: one line at a time, ~26 chars/s with a little seeded unevenness
    if (!this.typing && this.typeQueue.length) {
      const next = this.typeQueue.shift()!;
      this.typing = { el: next.el, text: next.text, i: 0, next: 0 };
      next.el.classList.add('is-typing');
    }
    if (this.typing) {
      this.typing.next -= dt;
      let guard = 0;
      while (this.typing && this.typing.next <= 0 && guard++ < 6) {
        this.typing.i++;
        this.typing.el.textContent = this.typing.text.slice(0, this.typing.i);
        const ch = this.typing.text[this.typing.i - 1];
        const pause = ch === '.' || ch === ',' || ch === '—' ? 0.22 : ch === ' ' ? 0.05 : 0.03;
        this.typing.next += pause + this.rng.next() * 0.025;
        if (this.typing.i >= this.typing.text.length) {
          this.typing.el.classList.remove('is-typing');
          this.typing.el.classList.add('is-done');
          this.typing = null;
        }
      }
    }
  }

  hide(): void {
    this.active = false;
    this.el.hidden = true;
    this.el.classList.remove('is-in', 'is-out');
  }

  dispose(): void {
    this.resolve?.('title');
    this.resolve = null;
    this.el.remove();
  }
}

function sourceName(v: string): string {
  if (v === 'cctv') return 'CCTV';
  const meta = CHARACTER_META[v as CharacterId];
  return meta ? meta.name.split(' ')[0] : v;
}
