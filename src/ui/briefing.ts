/**
 * The briefing on the title screen: what the night asks of you and how it can end, read aloud by a
 * recorded narrator (the one imported sound; tools/narration.mjs makes it). Wide screens show it beside
 * the menu; smaller ones open it as a sheet from a "Briefing" menu item. The text follows the voice line
 * by line from the cue sheet.
 *
 * With the Title narration setting on, it starts by itself once the title has been up for a moment
 * after the page's first click or key press (browsers only allow sound after one); hearing it through
 * or pressing Stop switches the setting off. Listen replays it any time.
 */
import briefingUrl from '../assets/briefing.mp3';
import type { NarrationState, Services } from '../core/contracts';
import { BRIEFING_CUES } from './briefing.cues';
import { AutoplayGate, activeLine, listenView, richText } from './briefing.flow';
import { BRIEFING, briefingLines } from './briefing.script';
import { escapeHtml } from './UIManager.overlays';
import './briefing.css';

/** Below this the briefing is a sheet opened from the menu. Keep in step with briefing.css. */
export const COMPACT_QUERY = '(max-width: 979px), (max-height: 539px)';
const STOP_FADE = 0.6;

export interface BriefingHooks {
  /** the title itself is the screen showing (not settings/controls/credits over it) */
  titleShowing(): boolean;
  /** the page has had a click, tap or key press */
  gestured(): boolean;
}

export class Briefing {
  readonly panel: HTMLElement;
  /** smaller layouts: the title menu item that opens the sheet */
  readonly opener: HTMLElement;
  readonly listenButton: HTMLElement;
  private readonly s: Services;
  private readonly hooks: BriefingHooks;
  private readonly title: HTMLElement;
  private readonly labelEl: HTMLElement;
  private readonly timeEl: HTMLElement;
  private readonly barEl: HTMLElement;
  private readonly body: HTMLElement;
  private readonly lineEls = new Map<string, HTMLElement>();
  private readonly order = briefingLines().map((l) => l.id);
  private readonly gate = new AutoplayGate();
  private readonly mq: MediaQueryList | null;
  private compact = false;
  private sheet = false;
  private live: string | null = null;
  private view = '';
  private bar = '';
  private enabled: boolean;
  /** our own write to the setting, not the player's */
  private writing = false;
  /** the last start was the autoplay: if the browser refuses it, stay quiet about it */
  private autoStart = false;
  private unavailable = false;
  private lastState: NarrationState = 'idle';
  private unsubs: (() => void)[] = [];

  constructor(s: Services, title: HTMLElement, menu: HTMLElement, hooks: BriefingHooks) {
    this.s = s;
    this.hooks = hooks;
    this.title = title;
    this.enabled = s.store.get().settings.narration;

    const panel = document.createElement('aside');
    panel.className = 'ns-brief';
    panel.setAttribute('aria-labelledby', 'ns-brief-kicker');
    panel.innerHTML =
      `<header class="ns-brief__head">` +
      `<div class="ns-brief__kicker" id="ns-brief-kicker">Briefing</div>` +
      `<button class="ns-item ns-brief__listen" data-act="listen" type="button" aria-pressed="false">` +
      `<span class="ns-brief__icon" aria-hidden="true"></span><span class="ns-brief__label">Listen</span><span class="ns-brief__time"></span>` +
      `</button></header>` +
      `<div class="ns-brief__bar" aria-hidden="true"><i></i></div>` +
      `<div class="ns-brief__body"></div>` +
      `<footer class="ns-brief__foot"><button class="ns-item ns-btn" data-act="briefclose" type="button">Back</button></footer>`;
    this.panel = panel;
    this.listenButton = panel.querySelector('.ns-brief__listen') as HTMLElement;
    this.labelEl = panel.querySelector('.ns-brief__label') as HTMLElement;
    this.timeEl = panel.querySelector('.ns-brief__time') as HTMLElement;
    this.barEl = panel.querySelector('.ns-brief__bar i') as HTMLElement;
    this.body = panel.querySelector('.ns-brief__body') as HTMLElement;
    this.buildText();
    title.appendChild(panel);

    const opener = document.createElement('button');
    opener.type = 'button';
    opener.className = 'ns-item ns-btn ns-brief__opener';
    opener.dataset.act = 'brief';
    opener.textContent = 'Briefing';
    (menu.querySelector('[data-act="resume"]') ?? menu.firstElementChild)?.after(opener);
    this.opener = opener;

    this.mq = typeof window.matchMedia === 'function' ? window.matchMedia(COMPACT_QUERY) : null;
    this.compact = this.mq?.matches ?? false;
    const onLayout = (): void => {
      this.compact = this.mq?.matches ?? false;
      if (!this.compact && this.sheet) this.closeSheet();
    };
    this.mq?.addEventListener('change', onLayout);
    this.unsubs.push(() => this.mq?.removeEventListener('change', onLayout));

    this.unsubs.push(
      s.bus.on('settings:change', ({ settings }) => {
        if (settings.narration === this.enabled) return;
        this.enabled = settings.narration;
        if (this.writing) return;
        // switched off by the player: stop reading; switched back on: it may start by itself again
        if (!settings.narration) this.halt();
        else this.gate.rearm();
      }),
    );
  }

  get sheetOpen(): boolean {
    return this.sheet;
  }

  /** Listen / Stop. Stopping is a choice, so it also stops the briefing starting by itself. */
  toggle(): void {
    if (this.busy()) {
      this.s.audio.stopNarration(STOP_FADE);
      this.switchOff();
    } else {
      this.start(false);
    }
  }

  /** Smaller layouts: open the sheet; it reads itself while the setting is on (this is the gesture). */
  openSheet(): void {
    if (this.sheet) return;
    this.sheet = true;
    this.title.classList.add('is-brief-open');
    this.body.scrollTop = 0;
    if (this.s.store.get().settings.narration && !this.busy()) this.start(true);
  }

  closeSheet(): void {
    if (!this.sheet) return;
    this.sheet = false;
    this.title.classList.remove('is-brief-open');
    this.halt();
  }

  /** The title is going away (a shift starts or resumes): fade the voice out. */
  leave(): void {
    if (this.sheet) {
      this.sheet = false;
      this.title.classList.remove('is-brief-open');
    }
    this.halt();
  }

  update(dt: number): void {
    const status = this.s.audio.narrationStatus();
    const busy = status.state === 'loading' || status.state === 'playing';
    const showing = this.hooks.titleShowing() && !this.compact;
    if (this.gate.update(dt, { enabled: this.s.store.get().settings.narration, gestured: this.hooks.gestured(), showing, busy })) this.start(true);

    if (status.state !== this.lastState) {
      if (status.state === 'ended') this.switchOff();
      if (status.state === 'failed' && !this.autoStart) this.unavailable = true;
      this.lastState = status.state;
    }

    const v = listenView(status.state, status.time, BRIEFING_CUES.duration, this.unavailable);
    const key = `${v.label}|${v.time}`;
    if (key !== this.view) {
      this.view = key;
      this.labelEl.textContent = v.label;
      this.timeEl.textContent = v.time;
      this.listenButton.setAttribute('aria-pressed', String(v.playing));
      this.listenButton.setAttribute('aria-label', v.playing ? 'Stop the briefing' : 'Listen to the briefing');
      this.panel.classList.toggle('is-narrating', v.playing);
    }
    const length = status.duration > 0 ? status.duration : BRIEFING_CUES.duration;
    const bar = `scaleX(${v.playing ? Math.min(1, status.time / length).toFixed(3) : '0'})`;
    if (bar !== this.bar) {
      this.bar = bar;
      this.barEl.style.transform = bar;
    }

    const live = v.playing ? activeLine(BRIEFING_CUES, this.order, status.time) : null;
    if (live !== this.live) {
      if (this.live) this.lineEls.get(this.live)?.classList.remove('is-live');
      this.live = live;
      const el = live ? this.lineEls.get(live) : undefined;
      if (el) {
        el.classList.add('is-live');
        this.follow(el);
      }
    }
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.panel.remove();
    this.opener.remove();
  }

  // ---------------------------------------------------------------------------

  private buildText(): void {
    BRIEFING.forEach((block, b) => {
      if (block.kind === 'para') {
        const p = document.createElement('p');
        p.className = b === BRIEFING.length - 1 ? 'ns-brief__p ns-brief__sign' : 'ns-brief__p';
        block.lines.forEach((line, i) => {
          if (i > 0) p.append(' ');
          p.append(this.lineEl('span', line.id, richText(line.text)));
        });
        this.body.appendChild(p);
        return;
      }
      const list = document.createElement('ul');
      list.className = 'ns-brief__endings';
      for (const line of block.lines) {
        if (!line.ending) {
          const lead = document.createElement('p');
          lead.className = 'ns-brief__p ns-brief__lead';
          lead.append(this.lineEl('span', line.id, richText(line.text)));
          this.body.appendChild(lead);
          continue;
        }
        const li = this.lineEl('li', line.id, `<b>${escapeHtml(line.ending)}</b><span>${richText(line.text)}</span>`);
        li.classList.add('ns-brief__ending');
        list.appendChild(li);
      }
      this.body.appendChild(list);
    });
  }

  private lineEl(tag: 'span' | 'li', id: string, html: string): HTMLElement {
    const el = document.createElement(tag);
    el.className = 'ns-brief__line';
    el.dataset.line = id;
    el.innerHTML = html;
    this.lineEls.set(id, el);
    return el;
  }

  private busy(): boolean {
    const st = this.s.audio.narrationStatus().state;
    return st === 'loading' || st === 'playing';
  }

  private start(auto: boolean): void {
    this.autoStart = auto;
    this.unavailable = false;
    this.s.audio.narrate(briefingUrl);
  }

  private halt(): void {
    if (this.busy()) this.s.audio.stopNarration(STOP_FADE);
  }

  private switchOff(): void {
    if (!this.s.store.get().settings.narration) return;
    this.writing = true;
    try {
      this.s.store.setSettings({ narration: false });
    } finally {
      this.writing = false;
    }
  }

  /** Keep the spoken line in view when the text scrolls (short windows, the phone sheet). */
  private follow(el: HTMLElement): void {
    const body = this.body;
    if (body.scrollHeight <= body.clientHeight + 1) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top >= body.scrollTop + 8 && bottom <= body.scrollTop + body.clientHeight - 8) return;
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    body.scrollTo({ top: Math.max(0, top - body.clientHeight * 0.3), behavior: smooth ? 'smooth' : 'auto' });
  }
}
