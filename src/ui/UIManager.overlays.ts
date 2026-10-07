/**
 * Non-interactive overlays: subtitles, cinematic captions, toasts and the CCTV frame.
 * All timers run on real seconds from UIManager.update() so they pause with the game loop
 * only when the loop stops (menus keep them ticking — a toast should not freeze).
 */
import type { Services } from '../core/contracts';

// ---------------------------------------------------------------------------
// Subtitles
// ---------------------------------------------------------------------------

export class Subtitles {
  readonly el: HTMLElement;
  private speakerEl: HTMLElement;
  private textEl: HTMLElement;
  private remaining = 0;
  private current = '';

  constructor(private s: Services, parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'ns-subtitle';
    this.el.hidden = true;
    this.el.innerHTML = '<span class="ns-subtitle__speaker"></span><span class="ns-subtitle__text"></span>';
    parent.appendChild(this.el);
    this.speakerEl = this.el.querySelector('.ns-subtitle__speaker') as HTMLElement;
    this.textEl = this.el.querySelector('.ns-subtitle__text') as HTMLElement;
  }

  show(text: string, seconds?: number, speaker?: string): void {
    const t = text.trim();
    if (!t) return;
    // Speech honours the subtitles setting; non-speech captions (no speaker) always show.
    if (speaker && !this.s.store.get().settings.subtitles) return;
    const dur = seconds && seconds > 0 ? seconds : Math.max(1.6, Math.min(7, 0.9 + t.length * 0.055));
    this.current = t;
    this.remaining = dur;
    this.speakerEl.textContent = speaker ? speaker.toUpperCase() : '';
    this.speakerEl.hidden = !speaker;
    this.textEl.textContent = t;
    this.el.classList.toggle('is-caption', !speaker);
    this.el.hidden = false;
    // restart the fade-in
    this.el.classList.remove('is-in');
    void this.el.offsetWidth;
    this.el.classList.add('is-in');
  }

  get text(): string {
    return this.el.hidden ? '' : this.current;
  }

  update(dt: number): void {
    if (this.el.hidden) return;
    this.remaining -= dt;
    if (this.remaining <= 0) {
      this.el.classList.remove('is-in');
      this.el.hidden = true;
      this.current = '';
    } else if (this.remaining < 0.35) {
      this.el.classList.remove('is-in');
    }
  }

  dispose(): void {
    this.el.remove();
  }
}

// ---------------------------------------------------------------------------
// Captions (title cards)
// ---------------------------------------------------------------------------

export class Captions {
  readonly el: HTMLElement;
  private mainEl: HTMLElement;
  private subEl: HTMLElement;
  private remaining = 0;
  private resolve: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'ns-caption';
    this.el.hidden = true;
    this.el.innerHTML = '<div class="ns-caption__main"></div><div class="ns-caption__sub"></div>';
    parent.appendChild(this.el);
    this.mainEl = this.el.querySelector('.ns-caption__main') as HTMLElement;
    this.subEl = this.el.querySelector('.ns-caption__sub') as HTMLElement;
  }

  show(text: string, seconds: number, opts?: { sub?: string; style?: 'title' | 'time' | 'card' }): Promise<void> {
    // A new card replaces the previous one; the earlier promise still resolves on schedule.
    const prev = this.resolve;
    this.resolve = null;
    prev?.();
    const style = opts?.style ?? 'card';
    this.el.className = `ns-caption ns-caption--${style}`;
    this.mainEl.textContent = text;
    this.subEl.textContent = opts?.sub ?? '';
    this.subEl.hidden = !opts?.sub;
    this.el.hidden = false;
    this.el.classList.remove('is-in', 'is-out');
    void this.el.offsetWidth;
    this.el.classList.add('is-in');
    this.remaining = Math.max(0.6, seconds);
    return new Promise<void>((res) => {
      this.resolve = res;
    });
  }

  update(dt: number): void {
    if (this.el.hidden) return;
    this.remaining -= dt;
    if (this.remaining <= 0.5 && !this.el.classList.contains('is-out')) {
      this.el.classList.add('is-out');
    }
    if (this.remaining <= 0) {
      this.el.hidden = true;
      this.el.classList.remove('is-in', 'is-out');
      const r = this.resolve;
      this.resolve = null;
      r?.();
    }
  }

  dispose(): void {
    this.resolve?.();
    this.el.remove();
  }
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

export class Toasts {
  readonly el: HTMLElement;
  private items: { el: HTMLElement; t: number }[] = [];

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'ns-toasts';
    parent.appendChild(this.el);
  }

  show(text: string, seconds = 3.2): void {
    const t = text.trim();
    if (!t) return;
    const item = document.createElement('div');
    item.className = 'ns-toast';
    item.textContent = t;
    this.el.appendChild(item);
    void item.offsetWidth;
    item.classList.add('is-in');
    this.items.push({ el: item, t: Math.max(1, seconds) });
    while (this.items.length > 3) {
      const old = this.items.shift();
      old?.el.remove();
    }
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t -= dt;
      if (it.t <= 0.4) it.el.classList.remove('is-in');
      if (it.t <= 0) {
        it.el.remove();
        this.items.splice(i, 1);
      }
    }
  }

  dispose(): void {
    this.el.remove();
  }
}

// ---------------------------------------------------------------------------
// CCTV overlay
// ---------------------------------------------------------------------------

export interface CCTVOverlayState {
  visible: boolean;
  cameras?: { id: string; name: string; online: boolean; active: boolean }[];
  timestamp?: string;
  label?: string;
  online?: boolean;
}

export class CCTVOverlay {
  readonly el: HTMLElement;
  private labelEl: HTMLElement;
  private recEl: HTMLElement;
  private timeEl: HTMLElement;
  private listEl: HTMLElement;
  private noSignalEl: HTMLElement;
  private hintEl: HTMLElement;
  private blink = 0;
  private lastListKey = '';
  private visible = false;
  private hudVisible = true;

  constructor(private s: Services, parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'ns-cctv';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="ns-cctv__bar ns-cctv__bar--l"></div><div class="ns-cctv__bar ns-cctv__bar--r"></div>
      <div class="ns-cctv__frame">
        <i class="ns-cctv__corner ns-cctv__corner--tl"></i><i class="ns-cctv__corner ns-cctv__corner--tr"></i>
        <i class="ns-cctv__corner ns-cctv__corner--bl"></i><i class="ns-cctv__corner ns-cctv__corner--br"></i>
        <div class="ns-cctv__tl"><span class="ns-cctv__label"></span><span class="ns-cctv__rec">REC <i>●</i></span></div>
        <div class="ns-cctv__tr"><span class="ns-cctv__time"></span></div>
        <div class="ns-cctv__nosignal" hidden><span>NO SIGNAL</span></div>
        <div class="ns-cctv__bottom">
          <div class="ns-cctv__list" role="list"></div>
          <div class="ns-cctv__hint"></div>
        </div>
        <div class="ns-cctv__touch">
          <button class="ns-cctv__tbtn" data-act="cctv_prev" aria-label="previous camera">‹</button>
          <button class="ns-cctv__tbtn" data-act="cctv_next" aria-label="next camera">›</button>
          <button class="ns-cctv__tbtn ns-cctv__tbtn--back" data-act="cancel" aria-label="leave surveillance">BACK</button>
        </div>
      </div>
    `;
    parent.appendChild(this.el);
    const q = (sel: string): HTMLElement => this.el.querySelector(sel) as HTMLElement;
    this.labelEl = q('.ns-cctv__label');
    this.recEl = q('.ns-cctv__rec');
    this.timeEl = q('.ns-cctv__time');
    this.listEl = q('.ns-cctv__list');
    this.noSignalEl = q('.ns-cctv__nosignal');
    this.hintEl = q('.ns-cctv__hint');
    this.listEl.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-cam]');
      if (!btn) return;
      const id = btn.dataset.cam!;
      if (this.s.cctv.currentCamera?.id !== id) {
        this.s.cctv.select(id);
        this.s.audio.play('ui_select', { nonSpatial: true, volume: 0.35 });
      }
    });
    q('.ns-cctv__touch').addEventListener('pointerdown', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!btn) return;
      e.preventDefault();
      this.s.input.inject(btn.dataset.act as 'cctv_prev' | 'cctv_next' | 'cancel');
    });
  }

  set(p: CCTVOverlayState): void {
    this.visible = p.visible;
    this.applyVisibility();
    if (!p.visible) return;
    if (p.label !== undefined) this.labelEl.textContent = p.label;
    if (p.timestamp !== undefined) this.timeEl.textContent = p.timestamp;
    if (p.online !== undefined) {
      this.noSignalEl.hidden = p.online;
      this.el.classList.toggle('is-offline', !p.online);
    }
    if (p.cameras) {
      const key = p.cameras.map((c) => `${c.id}:${c.online ? 1 : 0}:${c.active ? 1 : 0}`).join('|');
      if (key !== this.lastListKey) {
        this.lastListKey = key;
        this.listEl.innerHTML = p.cameras
          .map((c) => {
            const short = c.name.split('—')[0].trim();
            const cls = ['ns-cctv__cam', c.active ? 'is-active' : '', c.online ? '' : 'is-offline'].filter(Boolean).join(' ');
            return `<button class="${cls}" data-cam="${c.id}" role="listitem" title="${escapeAttr(c.name)}"><span>${escapeHtml(short)}</span></button>`;
          })
          .join('');
      }
    }
    const hint = this.s.input.isTouch
      ? 'tap a camera · BACK to return'
      : this.s.input.lastDeviceWasGamepad
        ? 'LB / RB switch camera · B back'
        : '[ ] / , . switch camera · Esc back';
    if (this.hintEl.textContent !== hint) this.hintEl.textContent = hint;
    this.el.classList.toggle('is-touch', this.s.input.isTouch);
  }

  setHudVisible(v: boolean): void {
    this.hudVisible = v;
    this.applyVisibility();
  }

  private applyVisibility(): void {
    this.el.hidden = !(this.visible && this.hudVisible);
  }

  update(dt: number): void {
    if (this.el.hidden) return;
    this.blink += dt;
    if (this.blink >= 1) this.blink -= 1;
    this.recEl.classList.toggle('is-on', this.blink < 0.6);
  }

  dispose(): void {
    this.el.remove();
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

export function escapeAttr(s: string): string {
  return escapeHtml(s);
}
