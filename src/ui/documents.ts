/**
 * Document modal (phone / chart / terminal / breaker panel / note / tag / radio / board /
 * monitor / generator) and the diegetic dialogue-choice box.
 *
 * Input is polled from the InputManager's held state in a rAF loop that runs after the
 * main loop, so the Esc / E that closes a document is never also read by main as
 * pause / interact. While a staged reveal (typing, incoming texts) is running, the first
 * close press fast-forwards it instead of closing.
 */
import './panels.css';
import { formatClock12, formatClock24 } from '../core/clock';
import type { DialogueOption, DocumentView, Services, SfxName } from '../core/contracts';
import type { RNG } from '../core/rng';
import { KIND_RENDERERS } from './documents.kinds';
import { PANEL_RENDERERS } from './documents.panels';
import { div, span, type DocContext, type SequenceStep } from './documents.types';
import { ActionPoller, PANEL_ACTIONS } from './switcher.input';

interface Focusable { el: HTMLElement; activate: () => void }

interface ChoiceState {
  el: HTMLElement;
  options: DialogueOption[];
  buttons: HTMLButtonElement[];
  sel: number;
  defaultId: string;
  timer: number;
  resolve: (id: string) => void;
}

const QUICK = ['quick_john', 'quick_susie', 'quick_paul', 'quick_cctv'] as const;

export class Documents {
  private readonly layer: HTMLElement;
  private readonly poller: ActionPoller;
  private rng: RNG;

  private docEl: HTMLElement | null = null;
  private docResolve: ((v: string | null) => void) | null = null;
  private docChoices: HTMLButtonElement[] = [];
  private hintEl: HTMLElement | null = null;
  private focusables: Focusable[] = [];
  private focusIdx = -1;

  private seqTimer = 0;
  private seqFinish: (() => void) | null = null;

  private choice_: ChoiceState | null = null;

  private raf = 0;
  private skipFrame = false;
  private modals = 0;
  private prevLocked = false;

  constructor(private readonly s: Services, root: HTMLElement) {
    this.layer = document.createElement('div');
    this.layer.className = 'ns-doclayer';
    root.appendChild(this.layer);
    this.poller = new ActionPoller(s.input, PANEL_ACTIONS);
    this.rng = s.rng.fork('documents');
    s.bus.on('game:new', () => {
      this.rng = s.rng.fork('documents');
    });
  }

  get open(): boolean {
    return !!this.docEl || !!this.choice_;
  }

  // ---------------------------------------------------------------------------
  // Documents
  // ---------------------------------------------------------------------------

  show(doc: DocumentView): Promise<string | null> {
    if (this.docEl) this.closeDoc(null, false);
    return new Promise<string | null>((resolve) => {
      this.docResolve = resolve;
      this.acquire();
      this.buildDoc(doc);
      this.sfx('ui_open', 0.5);
      this.startLoop();
    });
  }

  private buildDoc(doc: DocumentView): void {
    const scrim = div(`ns-doc ns-doc--${doc.kind}`);
    scrim.setAttribute('role', 'dialog');
    scrim.setAttribute('aria-label', doc.title);
    scrim.addEventListener('pointerdown', (e) => {
      if (e.target !== scrim) return;
      if (this.seqFinish) this.finishSequence();
      else this.closeDoc(null, true);
    });
    const frame = div('ns-doc__frame');
    scrim.appendChild(frame);
    const body = div('ns-doc__body');
    frame.appendChild(body);

    this.focusables = [];
    this.focusIdx = -1;
    this.docChoices = [];
    const reducedMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const time = this.s.store.get().time;
    const ctx: DocContext = {
      s: this.s,
      doc,
      rng: this.rng,
      now12: formatClock12(time),
      now24: formatClock24(time),
      reducedMotion,
      sfx: (name, volume = 0.4) => this.sfx(name, volume),
      sequence: (steps) => this.runSequence(steps),
      focusable: (el, activate) => this.addFocusable(el, activate),
      clearFocusables: () => this.clearWidgetFocusables(),
    };
    const render = KIND_RENDERERS[doc.kind] ?? PANEL_RENDERERS[doc.kind];
    if (render) render(ctx, body);
    else {
      // unknown kind: still legible as a plain record
      body.appendChild(div('ns-chart__name', doc.title));
      for (const sec of doc.sections) for (const l of sec.lines) body.appendChild(div('ns-chart__line', l));
    }

    if (doc.choices?.length) {
      const row = div('ns-doc__choices');
      doc.choices.forEach((c, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ns-docchoice';
        b.innerHTML = `<span class="ns-docchoice__key">${i + 1}</span><span class="ns-docchoice__label">${c.label}${c.hint ? `<small>${c.hint}</small>` : ''}</span>`;
        b.addEventListener('click', (e) => {
          e.preventDefault();
          this.pickDocChoice(c.id);
        });
        b.addEventListener('pointerenter', () => this.setFocus(this.focusables.findIndex((f) => f.el === b), true));
        row.appendChild(b);
        this.docChoices.push(b);
      });
      frame.appendChild(row);
    }
    this.hintEl = div('ns-doc__hint');
    frame.appendChild(this.hintEl);
    this.layer.appendChild(scrim);
    this.layer.classList.add('is-open');
    this.docEl = scrim;
    // choices follow any widgets the renderer registered
    for (const b of this.docChoices) this.focusables.push({ el: b, activate: () => b.click() });
    if (this.focusables.length && (doc.kind === 'panel' || doc.kind === 'generator' || !this.docChoices.length)) this.setFocus(0, false);
    else if (this.docChoices.length) this.setFocus(this.focusables.length - this.docChoices.length, false);
    this.updateHint();
    requestAnimationFrame(() => scrim.classList.add('is-in'));
  }

  private pickDocChoice(id: string): void {
    this.sfx('ui_select', 0.5);
    this.closeDoc(id, false);
  }

  private closeDoc(result: string | null, sound: boolean): void {
    if (!this.docEl) return;
    this.cancelSequence();
    const el = this.docEl;
    this.docEl = null;
    el.classList.remove('is-in');
    el.classList.add('is-out');
    window.setTimeout(() => el.remove(), 180);
    this.focusables = [];
    this.focusIdx = -1;
    this.docChoices = [];
    this.hintEl = null;
    if (sound) this.sfx('ui_close', 0.45);
    const resolve = this.docResolve;
    this.docResolve = null;
    this.release();
    resolve?.(result);
    this.stopLoopIfIdle();
  }

  // --- staged reveals ----------------------------------------------------------

  private runSequence(steps: SequenceStep[]): void {
    this.cancelSequence();
    let i = 0;
    const runNext = (): void => {
      if (i >= steps.length) {
        this.seqFinish = null;
        this.updateHint();
        return;
      }
      const step = steps[i];
      this.seqTimer = window.setTimeout(() => {
        step.run();
        i++;
        runNext();
      }, step.delay);
    };
    this.seqFinish = () => {
      window.clearTimeout(this.seqTimer);
      for (; i < steps.length; i++) steps[i].run();
      this.seqFinish = null;
      this.updateHint();
    };
    runNext();
    this.updateHint();
  }

  private finishSequence(): void {
    this.seqFinish?.();
    this.sfx('ui_hover', 0.2);
  }

  private cancelSequence(): void {
    window.clearTimeout(this.seqTimer);
    this.seqFinish = null;
  }

  // --- focus ---------------------------------------------------------------------

  private addFocusable(el: HTMLElement, activate: () => void): void {
    // widgets go before choice buttons
    const firstChoice = this.focusables.findIndex((f) => this.docChoices.includes(f.el as HTMLButtonElement));
    const item = { el, activate };
    if (firstChoice < 0) this.focusables.push(item);
    else this.focusables.splice(firstChoice, 0, item);
    el.addEventListener('pointerenter', () => this.setFocus(this.focusables.indexOf(item), true));
  }

  private clearWidgetFocusables(): void {
    const keepIdx = this.focusIdx;
    this.focusables = this.focusables.filter((f) => this.docChoices.includes(f.el as HTMLButtonElement));
    this.focusIdx = Math.min(keepIdx, Math.max(-1, this.focusables.length - 1));
    // re-apply after the renderer has re-registered its widgets
    requestAnimationFrame(() => {
      if (this.docEl) this.setFocus(Math.max(0, Math.min(keepIdx, this.focusables.length - 1)), false);
    });
  }

  private setFocus(i: number, sound: boolean): void {
    if (!this.focusables.length) return;
    const n = ((i % this.focusables.length) + this.focusables.length) % this.focusables.length;
    if (n === this.focusIdx && this.focusables[n].el.classList.contains('is-focus')) return;
    this.focusIdx = n;
    this.focusables.forEach((f, j) => f.el.classList.toggle('is-focus', j === n));
    if (sound) this.sfx('ui_hover', 0.22);
  }

  private updateHint(): void {
    if (!this.hintEl) return;
    const touch = this.s.input.isTouch;
    if (this.seqFinish) {
      this.hintEl.textContent = touch ? 'Tap to skip' : 'any key — skip';
      return;
    }
    const parts: string[] = [];
    if (this.focusables.length > this.docChoices.length) parts.push(touch ? 'Tap a breaker' : '↑↓ select · Enter toggle');
    else if (this.docChoices.length) parts.push(touch ? 'Choose' : '1–4 choose');
    parts.push(touch ? 'Tap outside to put down' : 'Esc · E  put down');
    this.hintEl.textContent = parts.join('     ');
  }

  // ---------------------------------------------------------------------------
  // Dialogue choice
  // ---------------------------------------------------------------------------

  choice(prompt: string, options: DialogueOption[], opts: { speaker?: string; timeoutSeconds?: number; defaultId?: string } = {}): Promise<string> {
    if (this.choice_) this.resolveChoice(this.choice_.defaultId, false);
    return new Promise<string>((resolve) => {
      const opt = options.length ? options : [{ id: 'ok', label: '…' }];
      const defaultId = opts.defaultId && opt.some((o) => o.id === opts.defaultId) ? opts.defaultId : opt[0].id;
      this.acquire();
      const el = div('ns-dialogue');
      el.setAttribute('role', 'dialog');
      if (opts.speaker) el.appendChild(div('ns-dialogue__speaker', opts.speaker.toUpperCase()));
      el.appendChild(div('ns-dialogue__prompt', prompt));
      const list = div('ns-dialogue__options');
      const buttons: HTMLButtonElement[] = [];
      opt.forEach((o, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ns-dialogue__option';
        b.innerHTML = `<span class="ns-dialogue__num">${i + 1}</span><span class="ns-dialogue__label">${o.label}</span>`;
        b.addEventListener('pointerenter', () => this.setChoiceSel(i, true));
        b.addEventListener('click', (e) => {
          e.preventDefault();
          this.resolveChoice(o.id, true);
        });
        list.appendChild(b);
        buttons.push(b);
      });
      el.appendChild(list);
      let timer = 0;
      if (opts.timeoutSeconds && opts.timeoutSeconds > 0) {
        const bar = div('ns-dialogue__timeout');
        const fill = span('ns-dialogue__timeoutfill');
        bar.appendChild(fill);
        el.appendChild(bar);
        fill.style.transitionDuration = `${opts.timeoutSeconds}s`;
        requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = '0%'; }));
        timer = window.setTimeout(() => this.resolveChoice(defaultId, false), opts.timeoutSeconds * 1000);
      }
      this.layer.appendChild(el);
      this.layer.classList.add('is-open');
      this.choice_ = { el, options: opt, buttons, sel: Math.max(0, opt.findIndex((o) => o.id === defaultId)), defaultId, timer, resolve };
      this.setChoiceSel(this.choice_.sel, false);
      this.sfx('ui_open', 0.35);
      this.startLoop();
      requestAnimationFrame(() => el.classList.add('is-in'));
    });
  }

  private setChoiceSel(i: number, sound: boolean): void {
    const c = this.choice_;
    if (!c) return;
    const n = ((i % c.options.length) + c.options.length) % c.options.length;
    const changed = n !== c.sel || !c.buttons[n].classList.contains('is-focus');
    c.sel = n;
    c.buttons.forEach((b, j) => b.classList.toggle('is-focus', j === n));
    if (sound && changed) this.sfx('ui_hover', 0.22);
  }

  private resolveChoice(id: string, sound: boolean): void {
    const c = this.choice_;
    if (!c) return;
    this.choice_ = null;
    window.clearTimeout(c.timer);
    c.el.classList.remove('is-in');
    c.el.classList.add('is-out');
    window.setTimeout(() => c.el.remove(), 220);
    if (sound) this.sfx('ui_select', 0.5);
    this.release();
    c.resolve(id);
    this.stopLoopIfIdle();
  }

  // ---------------------------------------------------------------------------
  // Shared
  // ---------------------------------------------------------------------------

  close(): void {
    if (this.choice_) this.resolveChoice(this.choice_.defaultId, false);
    if (this.docEl) this.closeDoc(null, true);
  }

  dispose(): void {
    this.close();
    cancelAnimationFrame(this.raf);
    this.layer.remove();
  }

  private acquire(): void {
    if (this.modals++ === 0) {
      this.prevLocked = this.s.store.get().inputLocked;
      this.s.store.lockInput(true);
      try {
        this.s.input.releaseLock();
      } catch {
        /* unsupported */
      }
    }
    this.poller.reset();
    this.skipFrame = true;
  }

  private release(): void {
    this.modals = Math.max(0, this.modals - 1);
    if (this.modals > 0) return;
    this.layer.classList.remove('is-open');
    this.s.store.lockInput(this.prevLocked);
    const st = this.s.store.get();
    let cinematic = false;
    try {
      cinematic = this.s.cinematic.playing;
    } catch {
      cinematic = false;
    }
    if (!this.s.input.isTouch && st.screen === 'playing' && !st.paused && !cinematic) {
      try {
        this.s.input.requestLock();
      } catch {
        /* unsupported */
      }
    }
  }

  private startLoop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  private stopLoopIfIdle(): void {
    if (!this.open) cancelAnimationFrame(this.raf);
  }

  private tick = (): void => {
    if (!this.open) return;
    this.raf = requestAnimationFrame(this.tick);
    if (this.skipFrame) {
      this.skipFrame = false;
      this.poller.reset();
      return;
    }
    const edges = this.poller.poll();
    if (edges.size === 0) return;
    if (this.choice_) this.handleChoiceInput(edges);
    else if (this.docEl) this.handleDocInput(edges);
  };

  private handleChoiceInput(edges: Set<string>): void {
    const c = this.choice_!;
    for (let i = 0; i < QUICK.length; i++) {
      if (edges.has(QUICK[i]) && i < c.options.length) return this.resolveChoice(c.options[i].id, true);
    }
    if (edges.has('confirm')) return this.resolveChoice(c.options[c.sel].id, true);
    let delta = 0;
    if (edges.has('forward') || edges.has('left')) delta -= 1;
    if (edges.has('back') || edges.has('right')) delta += 1;
    if (delta) this.setChoiceSel(c.sel + delta, true);
  }

  private handleDocInput(edges: Set<string>): void {
    if (this.seqFinish && (edges.has('cancel') || edges.has('interact') || edges.has('confirm') || edges.has('switcher'))) {
      this.finishSequence();
      return;
    }
    if (edges.has('cancel') || edges.has('switcher')) return this.closeDoc(null, true);
    for (let i = 0; i < QUICK.length; i++) {
      if (!edges.has(QUICK[i])) continue;
      if (i < this.docChoices.length) return this.docChoices[i].click();
      const widgets = this.focusables.filter((f) => !this.docChoices.includes(f.el as HTMLButtonElement));
      if (!this.docChoices.length && i < widgets.length) return widgets[i].activate();
    }
    if (edges.has('confirm')) {
      if (this.focusIdx >= 0 && this.focusables[this.focusIdx]) return this.focusables[this.focusIdx].activate();
      return this.closeDoc(null, true);
    }
    if (edges.has('interact')) return this.closeDoc(null, true);
    let delta = 0;
    if (edges.has('forward') || edges.has('left')) delta -= 1;
    if (edges.has('back') || edges.has('right')) delta += 1;
    if (delta && this.focusables.length) this.setFocus(this.focusIdx + delta, true);
  }

  private sfx(name: SfxName, volume: number): void {
    try {
      this.s.audio.play(name, { nonSpatial: true, volume });
    } catch {
      /* audio not ready */
    }
  }
}
