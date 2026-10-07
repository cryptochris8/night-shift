// NIGHT SHIFT: record the title briefing with ElevenLabs. It is the one imported sound in the game;
// everything else is synthesised at runtime.
//
//   ELEVENLABS_API_KEY=... node tools/narration.mjs [--force] [--only id,id] [--verify] [--dry]
//
// Reads the lines from src/ui/briefing.script.ts and records one clip per line (cached in
// tools/narration/cache; a line is re-recorded only when its spoken text or the voice settings
// change, or with --force / --only). The clips are trimmed, joined with the script's gaps,
// loudness-normalised and written to src/assets/briefing.mp3, with the cue sheet
// src/ui/briefing.cues.ts the title uses to follow along. --verify transcribes every clip with
// ElevenLabs speech-to-text and diffs it against the script; --dry assembles from the cache only.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { briefingLines, speechHash, spokenText } from '../src/ui/briefing.script.ts';

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const VERIFY = args.includes('--verify');
const DRY = args.includes('--dry');
const ONLY = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;
const KEY = process.env.ELEVENLABS_API_KEY?.trim();
if (!KEY && (!DRY || VERIFY)) {
  console.error('ELEVENLABS_API_KEY is not set (--dry assembles from the cache without it)');
  process.exit(1);
}

// Cast: a calm, deep, low American storyteller (ElevenLabs voice library, 730-day notice period).
const VOICE = { id: '6FiCmD8eY5VyjOdG5Zjk', name: 'Adam - Deep English Story Voice' };
const MODEL = 'eleven_multilingual_v2';
// The trailer playbook's restrained read: steady across separately recorded lines, a touch slow.
const SETTINGS = { stability: 0.6, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true, speed: 0.94 };
const FORMAT = 'mp3_44100_192'; // Creator tier and up
const RATE = 44100;
const LEAD_IN = 0.35;
const TAIL = 0.6;
const MAX_PAUSE = 0.8; // longest silence kept inside a line
const TARGET = { I: -17, TP: -1.5 };
const CACHE = 'tools/narration/cache';
const OUT_AUDIO = 'src/assets/briefing.mp3';
const OUT_CUES = 'src/ui/briefing.cues.ts';
const H = { 'xi-api-key': KEY ?? '' };

function run(cmd, argv) {
  const r = spawnSync(cmd, argv, { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${String(r.stderr).slice(-500)}`);
  return r;
}

async function post(url, init, label) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await fetch(url, init);
    if (r.ok) return r;
    const body = await r.text();
    if (r.status === 429 || r.status >= 500) {
      await new Promise((res) => setTimeout(res, 1500 * attempt));
      continue;
    }
    throw new Error(`${label}: HTTP ${r.status} ${body.slice(0, 240)}`);
  }
  throw new Error(`${label}: retries exhausted`);
}

async function record(line, i, lines) {
  const text = spokenText(line);
  const sig = speechHash(JSON.stringify([text, VOICE.id, MODEL, SETTINGS, FORMAT]));
  const mp3 = path.join(CACHE, `${line.id}.mp3`);
  const meta = path.join(CACHE, `${line.id}.json`);
  const old = fs.existsSync(meta) ? JSON.parse(fs.readFileSync(meta, 'utf8')) : null;
  const redo = FORCE || (ONLY !== null && ONLY.has(line.id));
  if (fs.existsSync(mp3) && old?.sig === sig && !redo) return { mp3, fresh: false };
  if (DRY) throw new Error(`${line.id}: no current recording in the cache (run without --dry)`);
  const body = {
    text,
    model_id: MODEL,
    voice_settings: SETTINGS,
    seed: parseInt(speechHash(line.id), 16),
    // neighbouring lines steer the intonation so separately recorded clips flow as one read
    previous_text: i > 0 ? spokenText(lines[i - 1]) : undefined,
    next_text: i < lines.length - 1 ? spokenText(lines[i + 1]) : undefined,
  };
  const r = await post(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE.id}?output_format=${FORMAT}`,
    { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify(body) },
    line.id,
  );
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(mp3, buf);
  const info = { sig, text, voice: VOICE, model: MODEL, settings: SETTINGS, format: FORMAT, requestId: r.headers.get('request-id'), bytes: buf.length };
  fs.writeFileSync(meta, JSON.stringify(info, null, 2));
  return { mp3, fresh: true };
}

function decode(file) {
  const b = run('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-']).stdout;
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

/** Cut leading/trailing room tone, keeping a breath of pre-roll and the natural decay. */
function trim(x, id) {
  const win = Math.round(RATE * 0.01);
  const floor = Math.pow(10, -46 / 20);
  let first = -1;
  let last = -1;
  for (let i = 0; i + win <= x.length; i += win) {
    let e = 0;
    for (let j = i; j < i + win; j++) e += x[j] * x[j];
    if (Math.sqrt(e / win) > floor) {
      if (first < 0) first = i;
      last = i + win;
    }
  }
  if (first < 0) throw new Error(`${id}: the clip is silent`);
  const y = x.slice(Math.max(0, first - Math.round(RATE * 0.04)), Math.min(x.length, last + Math.round(RATE * 0.14)));
  const fadeIn = Math.round(RATE * 0.004);
  const fadeOut = Math.round(RATE * 0.03);
  for (let i = 0; i < fadeIn && i < y.length; i++) y[i] *= i / fadeIn;
  for (let i = 0; i < fadeOut && i < y.length; i++) y[y.length - 1 - i] *= i / fadeOut;
  return y;
}

/** Shorten any pause inside a line to MAX_PAUSE (drops the silent middle), so the beats stay even. */
function tighten(x) {
  const win = Math.round(RATE * 0.01);
  const floor = Math.pow(10, -46 / 20);
  const keep = Math.round(RATE * MAX_PAUSE);
  const pieces = [];
  let from = 0;
  let quietFrom = -1;
  for (let i = 0; i + win <= x.length; i += win) {
    let e = 0;
    for (let j = i; j < i + win; j++) e += x[j] * x[j];
    const quiet = Math.sqrt(e / win) <= floor;
    if (quiet && quietFrom < 0) quietFrom = i;
    if (!quiet && quietFrom >= 0) {
      if (i - quietFrom > keep) {
        pieces.push(x.subarray(from, quietFrom + Math.floor(keep / 2)));
        from = i - Math.ceil(keep / 2);
      }
      quietFrom = -1;
    }
  }
  pieces.push(x.subarray(from));
  const y = new Float32Array(pieces.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of pieces) {
    y.set(p, at);
    at += p.length;
  }
  return y;
}

function lastJson(stderr) {
  const s = String(stderr);
  return JSON.parse(s.slice(s.lastIndexOf('{'), s.lastIndexOf('}') + 1));
}

function words(s) {
  return s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(' ').filter(Boolean);
}

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

// ---------------------------------------------------------------------------------------------
const lines = briefingLines();
fs.mkdirSync(CACHE, { recursive: true });
console.log(`${lines.length} lines, ${VOICE.name}, ${MODEL}`);
const clips = [];
let fresh = 0;
for (let i = 0; i < lines.length; i++) {
  const r = await record(lines[i], i, lines);
  if (r.fresh) fresh++;
  clips.push(tighten(trim(decode(r.mp3), lines[i].id)));
}
console.log(`recorded ${fresh}, cached ${lines.length - fresh}`);

// Join on the script's timing; the cue sheet is exact because the gaps are inserted here.
const cues = {};
const parts = [new Float32Array(Math.round(LEAD_IN * RATE))];
let n = parts[0].length;
lines.forEach((line, i) => {
  const c = clips[i];
  cues[line.id] = { start: n / RATE, end: (n + c.length) / RATE, hash: speechHash(spokenText(line)) };
  parts.push(c);
  n += c.length;
  const gap = new Float32Array(Math.round((i === lines.length - 1 ? TAIL : line.gap) * RATE));
  parts.push(gap);
  n += gap.length;
});
const joined = new Float32Array(n);
let at = 0;
for (const p of parts) {
  joined.set(p, at);
  at += p.length;
}
const raw = path.join(CACHE, 'joined.f32');
fs.writeFileSync(raw, Buffer.from(joined.buffer));

// Mastering: a gentle speech compressor, linear gain to the target, then a 4x-oversampled limiter
// for the few plosives still above the ceiling. (Plain loudnorm drops to its dynamic mode on this
// read, ~20 dB peak-to-loudness, and that ramps the gain over the first seconds.)
const input = ['-hide_banner', '-v', 'info', '-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', raw];
const COMP = 'acompressor=threshold=0.08:ratio=3:attack=3:release=120:knee=3';
const m1 = lastJson(run('ffmpeg', [...input, '-af', `${COMP},loudnorm=print_format=json`, '-f', 'null', '-']).stderr);
const gain = TARGET.I - Number(m1.input_i);
const limiter = `aresample=${RATE * 4},alimiter=limit=${Math.pow(10, TARGET.TP / 20).toFixed(4)}:attack=1:release=60:level=0,aresample=${RATE}`;
fs.mkdirSync(path.dirname(OUT_AUDIO), { recursive: true });
run('ffmpeg', ['-y', ...input, '-af', `${COMP},volume=${gain.toFixed(2)}dB,${limiter}`, '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '96k', OUT_AUDIO]);
const m2 = lastJson(run('ffmpeg', ['-hide_banner', '-v', 'info', '-i', OUT_AUDIO, '-af', 'loudnorm=print_format=json', '-f', 'null', '-']).stderr);
const limited = Math.max(0, Number(m1.input_tp) + gain - TARGET.TP);
fs.rmSync(raw);

const total = n / RATE;
const probed = Number(String(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', OUT_AUDIO]).stdout).trim());
const fmt = (v) => Number(v.toFixed(3));
const ts = [
  '// Generated by tools/narration.mjs from briefing.script.ts. Do not edit by hand.',
  `// ${VOICE.name} (ElevenLabs ${MODEL}), ${fmt(total)} s, normalised to ${TARGET.I} LUFS.`,
  "import type { BriefingCues } from './briefing.script';",
  '',
  'export const BRIEFING_CUES: BriefingCues = {',
  `  duration: ${fmt(total)},`,
  '  lines: {',
  ...lines.map((l) => `    ${l.id}: { start: ${fmt(cues[l.id].start)}, end: ${fmt(cues[l.id].end)}, hash: '${cues[l.id].hash}' },`),
  '  },',
  '};',
  '',
].join('\n');
fs.writeFileSync(OUT_CUES, ts);

// Report + checks: every line ends before the next starts, and the file is as long as the plan.
let bad = 0;
for (let i = 0; i < lines.length; i++) {
  const c = cues[lines[i].id];
  const next = i + 1 < lines.length ? cues[lines[i + 1].id].start : total;
  const ok = c.end - c.start > 0.3 && c.end <= next;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'BAD '} ${lines[i].id.padEnd(13)} ${c.start.toFixed(2).padStart(6)} -> ${c.end.toFixed(2).padStart(6)}  (${(c.end - c.start).toFixed(2)} s)`);
}
if (Math.abs(probed - total) > 0.15) bad++;
if (Math.abs(Number(m2.input_i) - TARGET.I) > 1 || Number(m2.input_tp) > TARGET.TP + 0.6) bad++;
console.log(`total ${total.toFixed(2)} s (ffprobe ${probed.toFixed(2)} s)  ${m2.input_i} LUFS, true peak ${m2.input_tp} dBTP, LRA ${m2.input_lra} LU  (compressed read ${m1.input_i} LUFS, +${gain.toFixed(1)} dB, limiter up to ${limited.toFixed(1)} dB)`);
console.log(`wrote ${OUT_AUDIO} (${(fs.statSync(OUT_AUDIO).size / 1024).toFixed(0)} KB) and ${OUT_CUES}`);

if (VERIFY) {
  for (const line of lines) {
    const fd = new FormData();
    fd.append('model_id', 'scribe_v2');
    fd.append('language_code', 'en');
    fd.append('file', new Blob([fs.readFileSync(path.join(CACHE, `${line.id}.mp3`))], { type: 'audio/mpeg' }), `${line.id}.mp3`);
    const r = await post('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: H, body: fd }, `transcribe ${line.id}`);
    const heard = String((await r.json()).text ?? '');
    const want = words(spokenText(line));
    const wer = editDistance(want, words(heard)) / want.length;
    console.log(`${wer === 0 ? 'heard ok  ' : 'heard DIFF'} ${line.id.padEnd(13)} ${(wer * 100).toFixed(0).padStart(3)}%  ${wer === 0 ? '' : JSON.stringify(heard)}`);
  }
}
if (bad) {
  console.error(`${bad} check(s) failed`);
  process.exit(1);
}
