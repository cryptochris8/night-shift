/**
 * Document renderers: phone, chart, terminal, note, tag, board, radio.
 * Everything is DOM + CSS; no images. Staged reveals go through ctx.sequence so the
 * modal can fast-forward them.
 */
import type { DocumentSection } from '../core/contracts';
import { div, redact, span, splitField, splitMeta, typeSteps, type DocContext, type KindRenderer, type SequenceStep } from './documents.types';

// ---------------------------------------------------------------------------
// Phone
// ---------------------------------------------------------------------------

interface Msg { kind: 'in' | 'out' | 'time'; text: string }

function parseThread(lines: string[], contact: string): Msg[] {
  const out: Msg[] = [];
  const who = contact.toLowerCase();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const t = line.match(/^\[(.+)\]$/);
    if (t) {
      out.push({ kind: 'time', text: t[1] });
      continue;
    }
    if (/^(>|me:)\s*/i.test(line)) {
      out.push({ kind: 'out', text: line.replace(/^(>|me:)\s*/i, '') });
      continue;
    }
    const named = line.match(/^([^:]{1,24}):\s+(.*)$/);
    if (named && named[1].trim().toLowerCase() === who) out.push({ kind: 'in', text: named[2] });
    else out.push({ kind: 'in', text: line });
  }
  return out;
}

const renderPhone: KindRenderer = (ctx, host) => {
  const { doc, s } = ctx;
  const meta = doc.subtitle ?? '';
  const barsMatch = meta.match(/(\d)\s*bars?/i);
  const bars = barsMatch ? Math.max(0, Math.min(4, Number(barsMatch[1]))) : 3;
  const battMatch = meta.match(/(\d{1,3})\s*%/);
  const batt = battMatch ? Math.max(0, Math.min(100, Number(battMatch[1]))) : 41;
  const carrier = splitMeta(meta).find((p) => !/bars?|%/i.test(p)) ?? (bars === 0 ? 'No Service' : 'LTE');

  const phone = div('ns-phone');
  phone.appendChild(div('ns-phone__notch'));
  const status = div('ns-phone__status');
  const sig = span('ns-phone__signal');
  for (let i = 0; i < 4; i++) {
    const b = span(i < bars ? 'on' : '');
    b.style.height = `${4 + i * 2.5}px`;
    sig.appendChild(b);
  }
  status.append(sig, span('ns-phone__carrier', carrier), span('ns-phone__time', ctx.now12.replace(/\s?[AP]M/, '')));
  const battery = span('ns-phone__batt');
  const fill = span(batt <= 20 ? 'low' : '');
  fill.style.width = `${batt}%`;
  battery.appendChild(fill);
  status.append(span('ns-phone__battpct', `${batt}%`), battery);
  phone.appendChild(status);

  const lock = div('ns-phone__lock');
  lock.appendChild(div('ns-phone__bigtime', ctx.now12.replace(/\s?[AP]M/, '')));
  const total = doc.sections.reduce((n, sec) => n + sec.lines.filter((l) => l.trim() && !/^\[.+\]$/.test(l.trim()) && !/^(>|me:)/i.test(l.trim())).length, 0);
  lock.appendChild(div('ns-phone__lockline', `${doc.title}${total ? ` · ${total} message${total === 1 ? '' : 's'}` : ''}`));
  phone.appendChild(lock);

  const threads = div('ns-phone__threads');
  phone.appendChild(threads);
  const staged: SequenceStep[] = [];

  doc.sections.forEach((sec, si) => {
    const contact = sec.heading ?? 'Unknown';
    const thread = div('ns-phone__thread');
    const head = div('ns-phone__contact');
    head.append(span('ns-phone__avatar', contact.replace(/[^A-Za-z]/g, '').slice(0, 1).toUpperCase() || '#'), span('', contact));
    thread.appendChild(head);
    const list = div('ns-phone__msgs');
    thread.appendChild(list);
    threads.appendChild(thread);

    const msgs = parseThread(sec.lines, contact);
    const isLast = si === doc.sections.length - 1;
    const lastOut = msgs.map((m) => m.kind).lastIndexOf('out');
    msgs.forEach((m, mi) => {
      const el = div(m.kind === 'time' ? 'ns-phone__stamp' : `ns-phone__bubble ns-phone__bubble--${m.kind}`, m.text);
      const delayed = doc.typing && isLast && m.kind === 'in' && mi > lastOut;
      if (!delayed) {
        list.appendChild(el);
        return;
      }
      const dots = div('ns-phone__typing');
      dots.append(span(''), span(''), span(''));
      const wait = ctx.rng.int(700, 1500) + Math.min(1800, m.text.length * 22);
      staged.push({ delay: ctx.rng.int(350, 900), run: () => { list.appendChild(dots); list.scrollTop = list.scrollHeight; threads.scrollTop = threads.scrollHeight; } });
      staged.push({
        delay: wait,
        run: () => {
          dots.remove();
          el.classList.add('is-new');
          list.appendChild(el);
          threads.scrollTop = threads.scrollHeight;
          ctx.sfx('phone_buzz', 0.3);
        },
      });
    });
  });
  if (staged.length) ctx.sequence(staged);
  host.appendChild(phone);
  void s;
};

// ---------------------------------------------------------------------------
// Chart (clinical record)
// ---------------------------------------------------------------------------

function sectionBlock(sec: DocumentSection, baseCls: string): HTMLElement {
  const wrap = div(`${baseCls}__section${sec.style ? ` is-${sec.style}` : ''}`);
  if (sec.heading) wrap.appendChild(div(`${baseCls}__heading`, sec.heading));
  if (sec.style === 'mono') {
    const pre = document.createElement('pre');
    pre.className = `${baseCls}__mono`;
    pre.textContent = sec.lines.join('\n');
    wrap.appendChild(pre);
    return wrap;
  }
  for (const line of sec.lines) {
    if (sec.style === 'redacted') {
      const p = div(`${baseCls}__line`);
      const f = splitField(line);
      if (f) {
        p.appendChild(span(`${baseCls}__key`, f[0]));
        redact(p, f[1]);
      } else redact(p, line);
      wrap.appendChild(p);
      continue;
    }
    const f = splitField(line);
    if (f && sec.style !== 'note') {
      const row = div(`${baseCls}__row`);
      row.append(span(`${baseCls}__key`, f[0]), span(`${baseCls}__val`, f[1]));
      wrap.appendChild(row);
    } else {
      wrap.appendChild(div(`${baseCls}__line${sec.style === 'note' ? ' is-hand' : ''}`, line));
    }
  }
  return wrap;
}

const renderChart: KindRenderer = (ctx, host) => {
  const { doc } = ctx;
  const chart = div('ns-chart');
  const head = div('ns-chart__head');
  head.appendChild(div('ns-chart__facility', 'ST. AUGUSTINE REGIONAL MEDICAL CENTER · EMERGENCY DEPARTMENT'));
  const strip = div('ns-chart__strip');
  strip.appendChild(span('ns-chart__name', doc.title));
  for (const pill of splitMeta(doc.subtitle)) strip.appendChild(span('ns-chart__pill', pill));
  strip.appendChild(span('ns-chart__pill ns-chart__pill--time', `PRINTED ${ctx.now24.slice(0, 5)}`));
  head.appendChild(strip);
  chart.appendChild(head);
  const body = div('ns-chart__body');
  for (const sec of doc.sections) body.appendChild(sectionBlock(sec, 'ns-chart'));
  chart.appendChild(body);
  chart.appendChild(div('ns-chart__foot', 'CONFIDENTIAL PATIENT INFORMATION — DO NOT LEAVE UNATTENDED'));
  host.appendChild(chart);
};

// ---------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------

const renderTerminal: KindRenderer = (ctx, host) => {
  const { doc } = ctx;
  const amber = /amber|security|pyxis|alarm|bms|building/i.test(`${doc.title} ${doc.subtitle ?? ''}`);
  const term = div(`ns-term${amber ? ' ns-term--amber' : ''}`);
  const reduced = ctx.reducedMotion || ctx.s.store.get().settings.reducedFlicker;
  if (reduced) term.classList.add('is-steady');
  const bar = div('ns-term__bar');
  bar.append(span('', doc.title.toUpperCase()), span('ns-term__barright', `${doc.subtitle ?? 'TTY-02'}  ${ctx.now24}`));
  term.appendChild(bar);
  const screen = div('ns-term__screen');
  term.appendChild(screen);
  const cursor = span('ns-term__cursor');

  const steps: SequenceStep[] = [];
  const addLine = (text: string, cls: string, typed: boolean): void => {
    const line = div(`ns-term__line${cls ? ` ${cls}` : ''}`);
    steps.push({
      delay: typed ? ctx.rng.int(60, 180) : 0,
      run: () => {
        screen.appendChild(line);
        line.appendChild(cursor);
        screen.scrollTop = screen.scrollHeight;
      },
    });
    if (typed) {
      const txt = span('');
      steps.push({ delay: 0, run: () => line.insertBefore(txt, cursor) });
      steps.push(...typeSteps(txt, text, cls.includes('prompt') ? 46 : 14));
    } else {
      steps.push({ delay: 0, run: () => { line.insertBefore(span('', text), cursor); } });
    }
  };
  doc.sections.forEach((sec, i) => {
    if (sec.heading) addLine(`── ${sec.heading.toUpperCase()} ${'─'.repeat(Math.max(2, 44 - sec.heading.length))}`, 'is-head', false);
    for (const raw of sec.lines) {
      const prompt = /^(\$|>|C:\\>)\s?/.test(raw);
      const cls = [prompt ? 'is-prompt' : '', sec.style === 'warning' ? 'is-warn' : '', sec.style === 'redacted' ? 'is-redacted' : ''].filter(Boolean).join(' ');
      addLine(raw, cls, prompt || sec.style !== 'mono');
    }
    if (i < doc.sections.length - 1) addLine('', '', false);
  });
  steps.push({ delay: 120, run: () => { const l = div('ns-term__line is-prompt'); l.append(span('', '> '), cursor); screen.appendChild(l); screen.scrollTop = screen.scrollHeight; } });
  ctx.sequence(steps);
  ctx.sfx('typing', 0.18);
  host.appendChild(term);
};

// ---------------------------------------------------------------------------
// Note (handwriting on paper)
// ---------------------------------------------------------------------------

const renderNote: KindRenderer = (ctx, host) => {
  const { doc } = ctx;
  const note = div('ns-note');
  note.style.setProperty('--tilt', `${ctx.rng.range(-1.6, 1.6).toFixed(2)}deg`);
  note.appendChild(div('ns-note__title', doc.title));
  if (doc.subtitle) note.appendChild(div('ns-note__sub', doc.subtitle));
  for (const sec of doc.sections) {
    if (sec.heading) note.appendChild(div('ns-note__heading', sec.heading));
    for (const line of sec.lines) {
      const p = div(`ns-note__line${sec.style === 'warning' ? ' is-pressed' : ''}${sec.style === 'mono' ? ' is-print' : ''}`);
      if (sec.style === 'redacted') {
        p.classList.add('is-scribbled');
        p.textContent = line;
      } else p.textContent = line;
      note.appendChild(p);
    }
  }
  host.appendChild(note);
  ctx.sfx('paper', 0.35);
};

// ---------------------------------------------------------------------------
// Maintenance tag
// ---------------------------------------------------------------------------

const renderTag: KindRenderer = (ctx, host) => {
  const { doc } = ctx;
  const wrap = div('ns-tagwrap');
  wrap.innerHTML = `<svg class="ns-tag__wire" viewBox="0 0 120 70" aria-hidden="true"><path d="M60 0 C 40 10, 20 30, 60 62" fill="none" stroke="#b8bcb6" stroke-width="1.4"/><path d="M60 0 C 80 12, 96 34, 60 62" fill="none" stroke="#8e928c" stroke-width="1.2"/></svg>`;
  const tag = div('ns-tag');
  tag.style.setProperty('--tilt', `${ctx.rng.range(-3, 3).toFixed(2)}deg`);
  tag.appendChild(div('ns-tag__hole'));
  tag.appendChild(div('ns-tag__band', doc.title.toUpperCase()));
  if (doc.subtitle) tag.appendChild(div('ns-tag__sub', doc.subtitle));
  for (const sec of doc.sections) {
    if (sec.heading) tag.appendChild(div('ns-tag__heading', sec.heading.toUpperCase()));
    for (const line of sec.lines) {
      const f = splitField(line);
      if (f) {
        const row = div('ns-tag__row');
        row.append(span('ns-tag__key', f[0].toUpperCase()), span(`ns-tag__val${sec.style === 'warning' ? ' is-warn' : ''}`, f[1]));
        tag.appendChild(row);
      } else tag.appendChild(div(`ns-tag__hand${sec.style === 'warning' ? ' is-warn' : ''}`, line));
    }
  }
  tag.appendChild(div('ns-tag__fine', 'DO NOT REMOVE THIS TAG · FORM 2211-B · FACILITIES'));
  wrap.appendChild(tag);
  host.appendChild(wrap);
  ctx.sfx('paper', 0.25);
};

// ---------------------------------------------------------------------------
// Whiteboard
// ---------------------------------------------------------------------------

const INKS = ['blue', 'black', 'green', 'red'];

const renderBoard: KindRenderer = (ctx, host) => {
  const { doc } = ctx;
  const board = div('ns-board');
  const face = div('ns-board__face');
  face.appendChild(div('ns-board__title ink-blue', doc.title));
  if (doc.subtitle) face.appendChild(div('ns-board__sub ink-black', doc.subtitle));
  doc.sections.forEach((sec, i) => {
    const ink = sec.style === 'warning' ? 'red' : INKS[i % 3];
    const block = div(`ns-board__section ink-${ink}`);
    if (sec.heading) block.appendChild(div('ns-board__heading', sec.heading));
    const tableRows = sec.lines.filter((l) => l.includes('|'));
    if (tableRows.length && tableRows.length >= sec.lines.length - 1) {
      const table = document.createElement('table');
      table.className = 'ns-board__table';
      for (const l of sec.lines) {
        const tr = document.createElement('tr');
        for (const cell of l.split('|')) {
          const td = document.createElement('td');
          td.textContent = cell.trim();
          tr.appendChild(td);
        }
        table.appendChild(tr);
      }
      block.appendChild(table);
    } else {
      for (const l of sec.lines) block.appendChild(div(`ns-board__line${sec.style === 'redacted' ? ' is-erased' : ''}`, l));
    }
    face.appendChild(block);
  });
  board.appendChild(face);
  const tray = div('ns-board__tray');
  for (const c of ['blue', 'black', 'red']) tray.appendChild(span(`ns-board__marker ink-${c}`));
  tray.appendChild(span('ns-board__eraser'));
  board.appendChild(tray);
  host.appendChild(board);
};

// ---------------------------------------------------------------------------
// Handheld radio
// ---------------------------------------------------------------------------

const renderRadio: KindRenderer = (ctx, host) => {
  const { doc } = ctx;
  const radio = div('ns-radio');
  radio.appendChild(div('ns-radio__antenna'));
  const top = div('ns-radio__top');
  top.append(span('ns-radio__knob'), span('ns-radio__knob ns-radio__knob--small'));
  radio.appendChild(top);
  const lcd = div('ns-radio__lcd');
  const lcdHead = div('ns-radio__lcdhead');
  lcdHead.append(span('', (doc.subtitle ?? 'CH 03 · FACILITIES').toUpperCase()), span('ns-radio__rx', 'RX'), span('ns-radio__bars', '▂▄▆'), span('ns-radio__battery'));
  lcd.appendChild(lcdHead);
  lcd.appendChild(div('ns-radio__lcdtitle', doc.title.toUpperCase()));
  const log = div('ns-radio__log');
  lcd.appendChild(log);
  radio.appendChild(lcd);
  const grille = div('ns-radio__grille');
  radio.appendChild(grille);
  radio.appendChild(div('ns-radio__ptt'));
  radio.appendChild(div('ns-radio__brand', 'SAR-FAC · UHF'));

  const rx = lcdHead.querySelector('.ns-radio__rx') as HTMLElement;
  const steps: SequenceStep[] = [];
  for (const sec of doc.sections) {
    if (sec.heading) steps.push({ delay: 200, run: () => { log.appendChild(div('ns-radio__time', sec.heading!)); } });
    for (const raw of sec.lines) {
      const m = raw.match(/^([^:]{1,20}):\s+(.*)$/);
      const who = m ? m[1].toUpperCase() : null;
      const text = m ? m[2] : raw;
      const line = div(`ns-radio__line${sec.style === 'warning' ? ' is-warn' : ''}`);
      const body = span('');
      steps.push({
        delay: ctx.rng.int(350, 900),
        run: () => {
          ctx.sfx('radio_click', 0.28);
          rx.classList.add('is-on');
          if (who) line.appendChild(span('ns-radio__who', `${who} ▸ `));
          line.appendChild(body);
          log.appendChild(line);
          log.scrollTop = log.scrollHeight;
        },
      });
      steps.push(...typeSteps(body, text, 22, () => { rx.classList.remove('is-on'); log.scrollTop = log.scrollHeight; }));
    }
  }
  steps.push({ delay: 300, run: () => ctx.sfx('radio_click', 0.2) });
  ctx.sequence(steps);
  host.appendChild(radio);
};

export const KIND_RENDERERS: Partial<Record<DocContext['doc']['kind'], KindRenderer>> = {
  phone: renderPhone,
  chart: renderChart,
  terminal: renderTerminal,
  note: renderNote,
  tag: renderTag,
  board: renderBoard,
  radio: renderRadio,
};
