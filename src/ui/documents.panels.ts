/**
 * Equipment renderers: breaker panel, patient monitor, generator control panel.
 * Gauges and traces are inline SVG built from the document's lines.
 */
import type { DocumentSwitch } from '../core/contracts';
import { div, span, splitMeta, typeSteps, type DocContext, type KindRenderer, type SequenceStep } from './documents.types';

const SVG = 'http://www.w3.org/2000/svg';

// ---------------------------------------------------------------------------
// Switch rows (breakers / rockers) shared by panel + generator
// ---------------------------------------------------------------------------

function renderSwitches(ctx: DocContext, host: HTMLElement, style: 'breaker' | 'rocker'): void {
  let switches: DocumentSwitch[] = (ctx.doc.switches ?? []).map((sw) => ({ ...sw }));
  const rows = div(`ns-switches ns-switches--${style}`);
  host.appendChild(rows);

  const draw = (): void => {
    rows.replaceChildren();
    ctx.clearFocusables();
    switches.forEach((sw, i) => {
      const tripped = /tripped|fault/i.test(sw.note ?? '');
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `ns-sw${sw.on ? ' is-on' : ' is-off'}${tripped ? ' is-tripped' : ''}${sw.enabled ? '' : ' is-locked'}`;
      row.dataset.id = sw.id;
      row.disabled = !sw.enabled;
      row.setAttribute('aria-pressed', sw.on ? 'true' : 'false');
      row.innerHTML =
        `<span class="ns-sw__num">${String(i + 1).padStart(2, '0')}</span>` +
        `<span class="ns-sw__text"><span class="ns-sw__label">${sw.label}</span>` +
        `<span class="ns-sw__note">${tripped ? 'TRIPPED' : sw.note ?? (sw.enabled ? '' : 'LOCKED OUT')}</span></span>` +
        `<span class="ns-sw__state">${tripped ? 'TRIP' : sw.on ? 'ON' : 'OFF'}</span>` +
        `<span class="ns-sw__handle" aria-hidden="true"><span class="ns-sw__toggle"></span></span>`;
      const activate = (): void => {
        if (!sw.enabled) {
          ctx.sfx('ui_back', 0.3);
          return;
        }
        const want = !sw.on;
        ctx.sfx('breaker_click', 0.6);
        let result: void | DocumentSwitch[] = undefined;
        try {
          result = ctx.doc.onToggle?.(sw.id, want);
        } catch (err) {
          console.error('[documents] onToggle threw', err);
        }
        if (Array.isArray(result)) switches = result.map((x) => ({ ...x }));
        else switches = switches.map((x) => (x.id === sw.id ? { ...x, on: want } : x));
        const after = switches.find((x) => x.id === sw.id);
        const nowTripped = /tripped|fault/i.test(after?.note ?? '');
        if (nowTripped || (want && after && !after.on)) ctx.sfx('breaker_thunk', 0.7);
        draw();
      };
      row.addEventListener('click', (e) => {
        e.preventDefault();
        activate();
      });
      rows.appendChild(row);
      ctx.focusable(row, activate);
    });
  };
  draw();
}

// ---------------------------------------------------------------------------
// Breaker panel
// ---------------------------------------------------------------------------

const renderPanel: KindRenderer = (ctx, host) => {
  const { doc } = ctx;
  const panel = div('ns-panel');
  for (const c of ['tl', 'tr', 'bl', 'br']) panel.appendChild(span(`ns-panel__screw ns-panel__screw--${c}`));
  const plate = div('ns-panel__plate');
  plate.append(div('ns-panel__title', doc.title.toUpperCase()), div('ns-panel__sub', doc.subtitle ?? '480Y/277V · 3Ø 4W · 225A MLO'));
  panel.appendChild(plate);
  const warn = div('ns-panel__warning');
  warn.innerHTML = `<span>⚠</span><span>DANGER — ARC FLASH AND SHOCK HAZARD. APPROPRIATE PPE REQUIRED.</span>`;
  panel.appendChild(warn);
  for (const sec of doc.sections) {
    const block = div(`ns-panel__notes${sec.style === 'warning' ? ' is-warn' : ''}`);
    if (sec.heading) block.appendChild(div('ns-panel__noteshead', sec.heading));
    for (const l of sec.lines) block.appendChild(div('ns-panel__noteline', l));
    panel.appendChild(block);
  }
  const inner = div('ns-panel__inner');
  renderSwitches(ctx, inner, 'breaker');
  panel.appendChild(inner);
  panel.appendChild(div('ns-panel__legend', 'ON ▲   OFF ▼   TRIPPED ◆ — reset by switching OFF then ON'));
  host.appendChild(panel);
  ctx.sfx('panel_open', 0.5);
};

// ---------------------------------------------------------------------------
// Patient monitor
// ---------------------------------------------------------------------------

interface Vitals { hr?: string; spo2?: string; bp?: string; rr?: string; temp?: string; log: { text: string; warn: boolean }[] }

function parseVitals(ctx: DocContext): Vitals {
  const v: Vitals = { log: [] };
  for (const sec of ctx.doc.sections) {
    for (const raw of sec.lines) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(/^([A-Za-z0-9 ]{1,16}?)\s*[:=]?\s+(\S.*)$/);
      const key = m?.[1].replace(/\s+/g, '').toUpperCase() ?? '';
      const val = m?.[2].trim() ?? '';
      if (/^(HR|HEARTRATE|PULSE)$/.test(key)) v.hr = val;
      else if (/^(SPO2|SAT|SATS|O2)$/.test(key)) v.spo2 = val;
      else if (/^(BP|NIBP|BLOODPRESSURE)$/.test(key)) v.bp = val;
      else if (/^(RR|RESP|RESPRATE)$/.test(key)) v.rr = val;
      else if (/^(TEMP|T|TEMPERATURE)$/.test(key)) v.temp = val;
      else v.log.push({ text: line, warn: sec.style === 'warning' });
    }
  }
  return v;
}

function tracePath(kind: 'ecg' | 'pleth' | 'resp', beats: number, w: number, h: number, flat: boolean): string {
  const mid = h * 0.55;
  if (flat) return `M0 ${mid} L${w} ${mid}`;
  const bw = w / beats;
  let d = `M0 ${mid}`;
  for (let b = 0; b <= beats + 1; b++) {
    const x0 = b * bw;
    const p = (f: number): string => (x0 + bw * f).toFixed(1);
    if (kind === 'ecg') {
      d += ` L${p(0.12)} ${mid} Q${p(0.17)} ${(mid - h * 0.08).toFixed(1)} ${p(0.22)} ${mid}` + // P
        ` L${p(0.30)} ${mid} L${p(0.33)} ${(mid + h * 0.06).toFixed(1)} L${p(0.36)} ${(mid - h * 0.45).toFixed(1)} L${p(0.39)} ${(mid + h * 0.16).toFixed(1)} L${p(0.42)} ${mid}` + // QRS
        ` L${p(0.52)} ${mid} Q${p(0.60)} ${(mid - h * 0.16).toFixed(1)} ${p(0.70)} ${mid} L${p(1)} ${mid}`; // T
    } else if (kind === 'pleth') {
      d += ` C${p(0.08)} ${mid} ${p(0.12)} ${(mid - h * 0.42).toFixed(1)} ${p(0.22)} ${(mid - h * 0.42).toFixed(1)}` +
        ` C${p(0.32)} ${(mid - h * 0.42).toFixed(1)} ${p(0.36)} ${(mid - h * 0.1).toFixed(1)} ${p(0.46)} ${(mid - h * 0.14).toFixed(1)}` +
        ` C${p(0.6)} ${(mid - h * 0.18).toFixed(1)} ${p(0.8)} ${mid} ${p(1)} ${mid}`;
    } else {
      d += ` C${p(0.25)} ${(mid - h * 0.38).toFixed(1)} ${p(0.35)} ${(mid - h * 0.38).toFixed(1)} ${p(0.5)} ${mid}` +
        ` C${p(0.65)} ${(mid + h * 0.3).toFixed(1)} ${p(0.85)} ${(mid + h * 0.3).toFixed(1)} ${p(1)} ${mid}`;
    }
  }
  return d;
}

function trace(label: string, color: string, kind: 'ecg' | 'pleth' | 'resp', rate: number, flat: boolean, reduced: boolean): HTMLElement {
  const row = div(`ns-mon__trace ns-mon__trace--${kind}`);
  row.style.setProperty('--trace', color);
  row.appendChild(span('ns-mon__tracelabel', label));
  const w = 600;
  const h = 56;
  const beats = Math.max(2, Math.min(14, Math.round(rate / 10)));
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  const g = document.createElementNS(SVG, 'g');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', tracePath(kind, beats, w, h, flat));
  g.appendChild(path);
  svg.appendChild(g);
  row.appendChild(svg);
  if (!flat && !reduced && rate > 0) {
    g.style.setProperty('--beat-w', `${(w / beats).toFixed(2)}px`);
    g.style.animationDuration = `${(60 / rate).toFixed(3)}s`;
    g.classList.add('is-scrolling');
  }
  return row;
}

const renderMonitor: KindRenderer = (ctx, host) => {
  const v = parseVitals(ctx);
  const hrNum = parseFloat((v.hr ?? '').replace(/[^\d.]/g, ''));
  const flat = v.hr !== undefined && (/^(-+|—+|0|asystole|none)$/i.test(v.hr.trim()) || hrNum === 0);
  const hr = Number.isFinite(hrNum) && hrNum > 0 ? hrNum : 72;
  const rrNum = parseFloat((v.rr ?? '').replace(/[^\d.]/g, ''));
  const rr = Number.isFinite(rrNum) && rrNum > 0 ? rrNum : 16;
  const alarm = flat || v.log.some((l) => l.warn) || ctx.doc.sections.some((s) => s.style === 'warning');
  const mon = div(`ns-mon${alarm ? ' is-alarm' : ''}${flat ? ' is-flat' : ''}`);
  const head = div('ns-mon__head');
  head.append(span('ns-mon__bed', ctx.doc.title.toUpperCase()), span('ns-mon__meta', splitMeta(ctx.doc.subtitle).join('  ') || 'ADULT · ECG II · NIBP AUTO 15'), span('ns-mon__time', ctx.now24));
  if (alarm) head.appendChild(span('ns-mon__alarm', flat ? 'ASYSTOLE' : v.log.find((l) => l.warn)?.text.toUpperCase().slice(0, 28) ?? 'CHECK PATIENT'));
  mon.appendChild(head);
  const body = div('ns-mon__body');
  const traces = div('ns-mon__traces');
  const reduced = ctx.reducedMotion;
  traces.append(
    trace('II', '#6cff9a', 'ecg', flat ? 0 : hr, flat, reduced),
    trace('PLETH', '#5fd8ff', 'pleth', flat ? 0 : hr, flat, reduced),
    trace('RESP', '#ffe36a', 'resp', flat ? 0 : rr, flat, reduced),
  );
  body.appendChild(traces);
  const tiles = div('ns-mon__tiles');
  const tile = (label: string, value: string | undefined, unit: string, color: string, big = false): void => {
    const t = div(`ns-mon__tile${big ? ' is-big' : ''}`);
    t.style.setProperty('--trace', color);
    t.append(span('ns-mon__tilelabel', label), span('ns-mon__tilevalue', value ?? '---'), span('ns-mon__tileunit', unit));
    tiles.appendChild(t);
  };
  tile('HR', flat ? '0' : v.hr, 'bpm', '#6cff9a', true);
  tile('SpO₂', v.spo2, '%', '#5fd8ff');
  tile('NIBP', v.bp, 'mmHg', '#ffffff');
  tile('RR', v.rr, '/min', '#ffe36a');
  tile('TEMP', v.temp, '°', '#ffffff');
  body.appendChild(tiles);
  mon.appendChild(body);
  if (v.log.length) {
    const log = div('ns-mon__log');
    for (const l of v.log) log.appendChild(div(`ns-mon__logline${l.warn ? ' is-warn' : ''}`, l.text));
    mon.appendChild(log);
  }
  host.appendChild(mon);
  ctx.sfx(flat ? 'monitor_flat' : 'monitor_beep', flat ? 0.25 : 0.18);
};

// ---------------------------------------------------------------------------
// Generator control panel
// ---------------------------------------------------------------------------

interface GaugeSpec { key: RegExp; label: string; min: number; max: number; unit: string; red?: [number, number] }

const GAUGES: GaugeSpec[] = [
  { key: /^fuel/i, label: 'FUEL', min: 0, max: 100, unit: '%', red: [0, 0.15] },
  { key: /^(oil|oilpress)/i, label: 'OIL PRESS', min: 0, max: 100, unit: 'psi', red: [0, 0.2] },
  { key: /^(cool|temp|water)/i, label: 'COOLANT', min: 0, max: 120, unit: '°C', red: [0.85, 1] },
  { key: /^(volt|v$|output)/i, label: 'VOLTS', min: 0, max: 600, unit: 'V' },
  { key: /^(freq|hz)/i, label: 'FREQ', min: 55, max: 65, unit: 'Hz', red: [0.75, 1] },
  { key: /^(load|kw|power)/i, label: 'LOAD', min: 0, max: 100, unit: '%', red: [0.9, 1] },
  { key: /^(batt|battery|dc)/i, label: 'BATTERY', min: 0, max: 30, unit: 'V', red: [0, 0.4] },
  { key: /^rpm/i, label: 'RPM', min: 0, max: 2400, unit: 'rpm', red: [0.85, 1] },
];

function dial(spec: GaugeSpec, value: number, unitOverride: string): HTMLElement {
  const wrap = div('ns-gen__gauge');
  const frac = Math.max(0, Math.min(1, (value - spec.min) / (spec.max - spec.min)));
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 100 78');
  const cx = 50;
  const cy = 50;
  const r = 36;
  const arc = (a0: number, a1: number, cls: string, rr = r): void => {
    const p = document.createElementNS(SVG, 'path');
    const toXY = (a: number): [number, number] => [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
    const [x0, y0] = toXY(a0);
    const [x1, y1] = toXY(a1);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    p.setAttribute('d', `M${x0.toFixed(2)} ${y0.toFixed(2)} A${rr} ${rr} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`);
    p.setAttribute('class', cls);
    svg.appendChild(p);
  };
  const start = Math.PI * 0.75;
  const sweep = Math.PI * 1.5;
  arc(start, start + sweep, 'ns-gen__arc');
  if (spec.red) arc(start + sweep * spec.red[0], start + sweep * spec.red[1], 'ns-gen__arc--red', r + 0.5);
  for (let i = 0; i <= 10; i++) {
    const a = start + (sweep * i) / 10;
    const t = document.createElementNS(SVG, 'line');
    const inner = i % 5 === 0 ? r - 7 : r - 4;
    t.setAttribute('x1', (cx + inner * Math.cos(a)).toFixed(2));
    t.setAttribute('y1', (cy + inner * Math.sin(a)).toFixed(2));
    t.setAttribute('x2', (cx + (r - 1) * Math.cos(a)).toFixed(2));
    t.setAttribute('y2', (cy + (r - 1) * Math.sin(a)).toFixed(2));
    t.setAttribute('class', 'ns-gen__tick');
    svg.appendChild(t);
  }
  const needle = document.createElementNS(SVG, 'path');
  needle.setAttribute('d', `M${cx - 1.6} ${cy + 6} L${cx} ${cy - r + 6} L${cx + 1.6} ${cy + 6}Z`);
  needle.setAttribute('class', 'ns-gen__needle');
  needle.setAttribute('transform', `rotate(${(-135 + 270 * frac).toFixed(1)} ${cx} ${cy})`);
  svg.appendChild(needle);
  const cap = document.createElementNS(SVG, 'circle');
  cap.setAttribute('cx', String(cx));
  cap.setAttribute('cy', String(cy));
  cap.setAttribute('r', '4');
  cap.setAttribute('class', 'ns-gen__cap');
  svg.appendChild(cap);
  const txt = document.createElementNS(SVG, 'text');
  txt.setAttribute('x', String(cx));
  txt.setAttribute('y', '72');
  txt.setAttribute('text-anchor', 'middle');
  txt.setAttribute('class', 'ns-gen__value');
  txt.textContent = `${Number.isInteger(value) ? value : value.toFixed(1)} ${unitOverride || spec.unit}`;
  svg.appendChild(txt);
  wrap.appendChild(svg);
  const inRed = spec.red ? frac >= spec.red[0] && frac <= spec.red[1] : false;
  wrap.appendChild(div(`ns-gen__gaugelabel${inRed ? ' is-red' : ''}`, spec.label));
  if (inRed) wrap.classList.add('is-red');
  return wrap;
}

const renderGenerator: KindRenderer = (ctx, host) => {
  const { doc } = ctx;
  const gen = div('ns-gen');
  const plate = div('ns-gen__plate');
  plate.append(div('ns-gen__title', doc.title.toUpperCase()), div('ns-gen__sub', doc.subtitle ?? 'DIESEL GENSET 350 kW · 480V · 60 Hz · AUTO-TRANSFER'));
  gen.appendChild(plate);

  const gauges = div('ns-gen__gauges');
  const leds = div('ns-gen__leds');
  const lcdLines: { text: string; warn: boolean }[] = [];
  let hours: string | null = null;
  for (const sec of doc.sections) {
    if (sec.heading) lcdLines.push({ text: `[${sec.heading.toUpperCase()}]`, warn: false });
    for (const raw of sec.lines) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(/^([A-Za-z][A-Za-z ._/]{0,18}?)\s*[:=]?\s*(-?\d+(?:\.\d+)?)\s*([%°A-Za-z/]*)\s*$/);
      if (m) {
        const key = m[1].replace(/\s+/g, '').toLowerCase();
        const num = Number(m[2]);
        if (/^(hour|hrs|runhours|engine\s*hours|runtime)/i.test(key)) {
          hours = m[2];
          continue;
        }
        const spec = GAUGES.find((g) => g.key.test(key));
        if (spec) {
          let max = spec.max;
          if (spec.label === 'COOLANT' && /f/i.test(m[3])) max = 250;
          gauges.appendChild(dial({ ...spec, max }, num, m[3]));
          continue;
        }
      }
      const red = /fail|fault|trip|shutdown|alarm|overload|not ready|no fuel/i.test(line) || sec.style === 'warning';
      const amber = !red && /warn|low|check|due|overdue|service|bypass|manual|degraded|unstable/i.test(line);
      const led = div(`ns-gen__led ${red ? 'is-red' : amber ? 'is-amber' : 'is-green'}`);
      led.append(span('ns-gen__lamp'), span('ns-gen__ledtext', line));
      leds.appendChild(led);
      lcdLines.push({ text: line, warn: red || amber });
    }
  }
  if (gauges.childElementCount) gen.appendChild(gauges);

  const mid = div('ns-gen__mid');
  const lcd = div('ns-gen__lcd');
  const lcdHead = div('ns-gen__lcdhead');
  const power = ctx.s.store.get().power;
  lcdHead.append(span('', power === 'generator' ? 'RUNNING · ON LOAD' : power === 'blackout' ? 'CRANKING…' : 'STANDBY · AUTO'), span('', ctx.now24));
  lcd.appendChild(lcdHead);
  const lcdBody = div('ns-gen__lcdbody');
  lcd.appendChild(lcdBody);
  if (hours !== null) {
    const h = div('ns-gen__hours');
    h.append(span('ns-gen__hourslabel', 'ENGINE HOURS'), span('ns-gen__hoursval', hours.padStart(7, '0')));
    lcd.appendChild(h);
  }
  mid.appendChild(lcd);
  const controls = div('ns-gen__controls');
  const key = div(`ns-gen__key ns-gen__key--${power === 'generator' ? 'run' : 'auto'}`);
  key.innerHTML = `<span class="ns-gen__keylabel l">OFF</span><span class="ns-gen__keylabel c">AUTO</span><span class="ns-gen__keylabel r">RUN</span><span class="ns-gen__keyswitch"></span>`;
  const estop = div('ns-gen__estop');
  estop.appendChild(span('', 'EMERGENCY STOP'));
  controls.append(key, estop);
  mid.appendChild(controls);
  gen.appendChild(mid);
  if (leds.childElementCount) gen.appendChild(leds);
  if (doc.switches?.length) renderSwitches(ctx, gen, 'rocker');

  const steps: SequenceStep[] = [];
  for (const l of lcdLines) {
    const line = div(`ns-gen__lcdline${l.warn ? ' is-warn' : ''}`);
    steps.push({ delay: 90, run: () => { lcdBody.appendChild(line); lcdBody.scrollTop = lcdBody.scrollHeight; } });
    steps.push(...typeSteps(line, l.text, 10));
  }
  if (steps.length) ctx.sequence(steps);
  host.appendChild(gen);
};

export const PANEL_RENDERERS: Partial<Record<DocContext['doc']['kind'], KindRenderer>> = {
  panel: renderPanel,
  monitor: renderMonitor,
  generator: renderGenerator,
};
