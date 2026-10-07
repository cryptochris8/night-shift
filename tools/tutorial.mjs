// NIGHT SHIFT — first-night walkthrough check (headless Chromium + SwiftShader).
// Plays the tutorial with real key presses and mouse input: look/walk → vending machine (E) → console
// (Tab) → Susie (2) → back to John (1) → closing card; then the first-time tips, the clock hold at 22:59,
// the pause-menu skip, the setting switching itself off, and the card on phone layouts.
// Screenshots: tools/shots/tut-*.png. Exit code 1 if any check fails.
//
//   node tools/tutorial.mjs                               (own no-HMR dev server on 5181)
//   node tools/tutorial.mjs --url http://127.0.0.1:5173/  (an already-running server)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const getArg = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const PORT = Number(getArg('--port', '5181'));
const URL = getArg('--url', `http://127.0.0.1:${PORT}/`);
const SHOTS = resolve('tools/shots');
mkdirSync(SHOTS, { recursive: true });

const log = (...m) => console.log('[tut]', ...m);
const failures = [];
const errors = [];
const notes = [];
const check = (ok, label, detail = '') => {
  if (ok) log('ok  ', label, detail);
  else {
    failures.push(label);
    console.log('[tut] FAIL', label, detail);
  }
  return ok;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server = null;
if (!args.includes('--url')) {
  server = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--config', 'vite.qa.config.ts', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], {
    cwd: resolve('.'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => process.stdout.write(String(d)));
  process.on('exit', () => {
    try {
      server?.kill();
    } catch {
      /* already gone */
    }
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    try {
      if ((await fetch(URL)).ok) break;
    } catch {
      /* not yet */
    }
    await sleep(400);
  }
}

const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
});

/** Everything the checks need in one round trip. */
const tut = (page) =>
  page.evaluate(() => {
    const s = window.__NS.services;
    const f = s.ui.tutorial?.flow;
    const st = s.store.get();
    const el = document.querySelector('.ns-tut');
    const parts = el ? Array.from(el.querySelectorAll('.ns-tut__title, .ns-tut__checks li, .ns-tut__lines p')).map((n) => n.textContent) : [];
    return {
      armed: f?.armed ?? false,
      step: f?.step ?? null,
      tip: f?.tipId ?? null,
      done: f ? f.doneTimer >= 0 : false,
      lookDone: f?.lookDone ?? false,
      moveDone: f?.moveDone ?? false,
      vendingDone: f?.vendingDone ?? false,
      hold: f?.holdUsed ?? 0,
      visible: el?.classList.contains('is-in') ?? false,
      key: el?.dataset.key ?? null,
      text: parts.join(' | '),
      time: s.clock.time,
      view: st.activeView,
      active: s.ui.tutorialActive,
      cap: s.ui.tutorialClockCap,
      setting: st.settings.tutorial,
      screen: st.screen,
      paused: st.paused,
      flags: st.flags,
    };
  });

const until = async (page, label, pred, timeout = 90000) => {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    last = await tut(page);
    if (pred(last)) return last;
    await sleep(250);
  }
  check(false, `timeout: ${label}`, JSON.stringify({ step: last?.step, tip: last?.tip, view: last?.view, time: last?.time?.toFixed(2), visible: last?.visible }));
  return last;
};

async function openGame(contextOpts, seed, { clearSettings = true } = {}) {
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.goto(URL);
  await page.waitForFunction(() => window.__NS?.ready, null, { timeout: 60000 });
  if (clearSettings) await page.evaluate(() => localStorage.removeItem('nightshift.settings.v1'));
  await page.mouse.click(5, 5); // the audio gesture
  await page.evaluate((s) => window.__NS.newGame(s), seed);
  await page.waitForFunction(() => window.__NS.state().screen === 'intro', null, { timeout: 30000 });
  await sleep(800);
  await page.evaluate(() => window.__NS.skipIntro());
  await page.waitForFunction(() => window.__NS.state().screen === 'playing', null, { timeout: 30000 });
  return { context, page };
}

/** Rectangles of the card and the HUD blocks it must not cover. */
const layout = (page) =>
  page.evaluate(() => {
    const r = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return b.width && b.height ? { x: b.left, y: b.top, w: b.width, h: b.height } : null;
    };
    return { card: r('.ns-tut'), tl: r('.ns-hud__tl'), br: r('.ns-hud__br'), bl: r('.ns-objective'), vw: innerWidth, vh: innerHeight };
  });
const overlaps = (a, b) => !!(a && b) && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a, vw, vh) => !!a && a.x >= 0 && a.y >= 0 && a.x + a.w <= vw + 0.5 && a.y + a.h <= vh + 0.5;
/** Screenshots are for review, not checks: software WebGL can stall for a while compiling shaders when the
 * camera first sees a new room, so a slow capture is noted and the run goes on. */
const shot = async (page, name) => {
  try {
    await page.screenshot({ path: `${SHOTS}/${name}.png`, timeout: 120000 });
  } catch (err) {
    notes.push(`screenshot ${name} skipped: ${String(err?.message ?? err).split('\n')[0]}`);
  }
};

try {
  // -------------------------------------------------------------------------
  // 1) The whole walkthrough, desktop, real input
  // -------------------------------------------------------------------------
  const { context: ctxA, page } = await openGame({ viewport: { width: 960, height: 540 } }, 'NS-TUT-001');
  let t = await until(page, 'first card visible', (x) => x.visible && x.key === 'step:look_move');
  check(t.armed && t.step === 'look_move' && t.active, 'walkthrough starts on look/walk', `step=${t.step}`);
  check(/Get your bearings/.test(t.text) && /\{?Mouse/.test(t.text), 'first card explains looking and walking', t.text.slice(0, 140));
  check(t.cap === 14, 'clock hold armed at 22:59', `cap=${t.cap}`);
  let lay = await layout(page);
  check(inside(lay.card, lay.vw, lay.vh) && !overlaps(lay.card, lay.tl) && !overlaps(lay.card, lay.br) && !overlaps(lay.card, lay.bl), 'card fits beside the HUD (desktop)', JSON.stringify(lay.card));
  await shot(page, 'tut-01-bearings');

  // look: drag with the button held (works whether or not the browser grants pointer lock)
  await page.mouse.move(480, 300);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) {
    await page.mouse.move(480 + i * 22, 300 + (i % 2) * 6, { steps: 3 });
    await sleep(70);
  }
  await page.mouse.up();
  t = await until(page, 'look ticked', (x) => x.lookDone, 60000);
  if (!t.lookDone) {
    notes.push('mouse drag did not register as look input headless; injected look deltas instead');
    await page.evaluate(() => {
      window.__NS.services.input.look.dx += 400;
    });
    t = await until(page, 'look ticked (injected)', (x) => x.lookDone, 10000);
  }
  check(t.lookDone && !t.moveDone && t.step === 'look_move', 'looking ticks the first box only');
  await shot(page, 'tut-02-look-ticked');

  // walk: hold W (John stands up, then walks toward the TV wall)
  await page.keyboard.down('KeyW');
  t = await until(page, 'walk ticked', (x) => x.moveDone, 90000);
  await page.keyboard.up('KeyW');
  check(t.moveDone, 'walking ticks the second box');
  t = await until(page, 'vending step', (x) => x.key === 'step:vending' && x.visible && !x.done, 90000);
  check(/vending machine/.test(t.text), 'vending card is up', t.text.slice(0, 160));
  check(/(straight ahead|ahead and to your (left|right)|to your (left|right)|behind you)/.test(t.text), 'vending card gives a direction', (t.text.match(/TV wall[^.|]*/) ?? [''])[0]);
  await shot(page, 'tut-03-vending');

  // stand John in front of the drinks machine, facing it (yaw 0 faces the TV wall), and press E
  await page.evaluate(() => window.__NS.services.characters.teleport('john', { x: -10.1, y: 0, z: -7.9 }, 0));
  t = await until(page, 'aiming at the machine', (x) => /Press \{?E\}? to buy|Press E to buy/.test(x.text), 20000);
  const target = await page.evaluate(() => window.__NS.services.interact.current()?.id ?? null);
  check(target === 'wait_vending_1', 'the drinks machine is targeted', `target=${target}`);
  check(/Press E to buy/.test(t.text), 'card switches to "Press E to buy"', t.text.slice(-60));
  await shot(page, 'tut-04-press-e');
  await page.keyboard.press('KeyE');
  t = await until(page, 'purchase counted', (x) => x.vendingDone && x.done, 60000);
  check(t.vendingDone && t.done, 'pressing E at the machine completes the step');
  t = await until(page, 'bought water', (x) => Boolean(x.flags.john_bought_water), 60000);
  check(Boolean(t.flags.john_bought_water), 'the purchase went through (john_bought_water)');
  t = await until(page, 'console step', (x) => x.key === 'step:switch' && x.visible && !x.done, 40000);
  check(/Press Tab to open the perspective console/.test(t.text), 'console card asks for Tab', t.text.slice(-70));
  check(t.cap === null, 'clock hold released after the John steps', `cap=${t.cap}`);
  check(t.time < 14.01, 'clock never ran past 22:59 during the John steps', t.time.toFixed(2));

  // open the console with Tab: its own line points at Susie
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => window.__NS.services.ui.switcherOpen, null, { timeout: 15000 });
  await sleep(1200);
  const sw = await page.evaluate(() => {
    const hint = document.querySelector('.ns-switcher__tut');
    return {
      hint: hint && !hint.hidden ? hint.textContent : null,
      target: Array.from(document.querySelectorAll('.ns-card.is-tut-target')).map((c) => c.dataset.view),
      cardHidden: !document.querySelector('.ns-tut')?.classList.contains('is-in'),
    };
  });
  check(/Susie/.test(sw.hint ?? '') && /2/.test(sw.hint ?? ''), 'console shows the tutorial line', sw.hint ?? 'none');
  check(sw.target.length === 1 && sw.target[0] === 'susie', "Susie's card is ringed", JSON.stringify(sw.target));
  check(sw.cardHidden, 'the corner card steps aside while the console is open');
  await shot(page, 'tut-05-console');

  await page.keyboard.press('Digit2');
  t = await until(page, 'became Susie', (x) => x.view === 'susie', 90000);
  t = await until(page, 'number-key card', (x) => x.key === 'step:quick' && x.visible && !x.done, 90000);
  check(/You're Susie now/.test(t.text) && /Press 1 to go back to John/.test(t.text), 'Susie card explains the number keys', t.text.slice(0, 160));
  const leftover = await page.evaluate(() => ({
    hint: document.querySelector('.ns-switcher__tut')?.hidden,
    target: document.querySelectorAll('.ns-card.is-tut-target').length,
  }));
  check(leftover.hint === true && leftover.target === 0, 'console hint cleared after the switch', JSON.stringify(leftover));
  await shot(page, 'tut-06-susie');

  await page.keyboard.press('Digit1');
  t = await until(page, 'back to John', (x) => x.view === 'john', 90000);
  t = await until(page, 'closing card', (x) => x.key === 'step:wrap' && x.visible, 90000);
  check(/That's the shift/.test(t.text) && /bottom left/.test(t.text), 'closing card explains objectives and warning rings', t.text.slice(0, 120));
  await shot(page, 'tut-07-wrap');
  t = await until(page, 'walkthrough finished', (x) => x.step === null, 120000);
  check(t.step === null && !t.active, 'closing card dismisses itself');
  check(t.setting === false, 'Tutorial setting switched itself off');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('nightshift.settings.v1') ?? '{}').tutorial);
  check(saved === false, 'and it is saved for the next night', `saved=${saved}`);
  await sleep(800);
  t = await tut(page);
  check(!t.visible, 'no card left on screen');
  const obj = await page.evaluate(() => {
    const el = document.querySelector('.ns-objective');
    return { text: el?.textContent ?? '', isNew: el?.classList.contains('is-new') ?? false, label: el?.dataset.label ?? '' };
  });
  log('objective now:', JSON.stringify(obj));

  // first-time tips after the walkthrough: Paul, then a danger warning about Susie
  await page.keyboard.press('Digit3');
  t = await until(page, 'Paul tip', (x) => x.view === 'paul' && x.key === 'tip:paul' && x.visible, 90000);
  check(/flashlight/.test(t.text), 'first time as Paul: flashlight tip', t.text.slice(0, 120));
  await shot(page, 'tut-08-tip-paul');
  await page.evaluate(() => window.__NS.services.ui.warn('susie', 0.3, 'Elevator'));
  t = await until(page, 'danger tip', (x) => x.key === 'tip:danger:susie' && x.visible, 60000);
  check(/Susie needs you/.test(t.text) && /Press 2/.test(t.text), 'first danger warning: go-to-her tip', t.text.slice(0, 140));
  await shot(page, 'tut-09-tip-danger');
  await page.keyboard.press('Digit2');
  t = await until(page, 'danger tip cleared', (x) => x.view === 'susie' && x.tip === null, 90000);
  check(t.tip === null, 'switching to her clears the danger tip');

  // the next night in the same session starts without the walkthrough
  await page.evaluate(() => window.__NS.newGame('NS-TUT-002'));
  await page.waitForFunction(() => window.__NS.state().screen === 'intro', null, { timeout: 30000 });
  await sleep(600);
  await page.evaluate(() => window.__NS.skipIntro());
  await page.waitForFunction(() => window.__NS.state().screen === 'playing', null, { timeout: 30000 });
  await sleep(2500);
  t = await tut(page);
  check(!t.armed && !t.visible && t.cap === null, 'second night: no walkthrough, no clock hold', JSON.stringify({ armed: t.armed, cap: t.cap }));
  await ctxA.close();

  // -------------------------------------------------------------------------
  // 2) Clock hold at 22:59, and skipping from the pause menu
  // -------------------------------------------------------------------------
  {
    const { context, page: p } = await openGame({ viewport: { width: 960, height: 540 } }, 'NS-TUT-003');
    await until(p, 'card up', (x) => x.visible && x.key === 'step:look_move');
    await p.evaluate(() => {
      window.__NS.services.clock.timeScale = 600; // ten game minutes per real second
    });
    let h = await until(p, 'clock reaches 22:59', (x) => x.time >= 13.99, 60000);
    await sleep(3000);
    const h2 = await tut(p);
    check(Math.abs(h2.time - 14) < 1e-6 && h2.step === 'look_move', 'clock holds at 22:59 while John is still learning', `time=${h2.time} hold=${h2.hold.toFixed(1)}s`);
    check(!h2.flags.john_called, 'the 23:00 page has not fired');
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => window.__NS.state().screen === 'paused', null, { timeout: 15000 });
    await sleep(600);
    const btn = await p.evaluate(() => {
      const b = document.querySelector('.ns-screen[data-screen="paused"] [data-act="skiptutorial"]');
      return b ? { hidden: b.hidden || !!b.closest('[hidden]'), text: b.textContent } : null;
    });
    check(btn && !btn.hidden, 'pause menu offers "Skip tutorial"', JSON.stringify(btn));
    await shot(p, 'tut-10-pause-skip');
    await p.click('.ns-screen[data-screen="paused"] [data-act="skiptutorial"]');
    h = await until(p, 'resumed without the walkthrough', (x) => x.screen === 'playing' && !x.armed, 60000);
    check(!h.armed && !h.visible && h.setting === false, 'skip ends the walkthrough, resumes, and turns the setting off');
    h = await until(p, 'the night moves on', (x) => x.time > 15.5, 60000);
    h = await until(p, '23:00 page fires', (x) => Boolean(x.flags.john_called), 90000);
    check(Boolean(h.flags.john_called), 'after skipping, the clock runs on and the 23:00 page fires', `time=${h.time.toFixed(2)}`);
    await context.close();
  }

  // -------------------------------------------------------------------------
  // 3) Phone layouts (touch wording, no overlap with the HUD)
  // -------------------------------------------------------------------------
  for (const [name, vp] of [
    ['landscape', { width: 844, height: 390 }],
    ['portrait', { width: 390, height: 844 }],
  ]) {
    const { context, page: p } = await openGame({ viewport: vp, hasTouch: true, isMobile: true, deviceScaleFactor: 1 }, 'NS-TUT-004');
    const m = await until(p, `phone ${name} card`, (x) => x.visible && x.key === 'step:look_move', 60000);
    check(/drag on the right half/.test(m.text), `phone ${name}: touch wording`, m.text.slice(0, 120));
    const l = await layout(p);
    check(inside(l.card, l.vw, l.vh), `phone ${name}: card on screen`, JSON.stringify(l.card));
    check(!overlaps(l.card, l.tl) && !overlaps(l.card, l.br), `phone ${name}: card clear of identity and portraits`, JSON.stringify({ card: l.card, tl: l.tl, br: l.br }));
    await shot(p, `tut-11-phone-${name}`);
    await context.close();
  }
} catch (err) {
  failures.push(`exception: ${err?.message ?? err}`);
  console.error(err);
} finally {
  await browser.close();
}

const real = errors.filter((e) => !/favicon|AudioContext was not allowed/i.test(e));
for (const e of real.slice(0, 10)) console.log('[tut] error:', e);
for (const n of notes) console.log('[tut] note:', n);
console.log(`[tut] ${failures.length === 0 && real.length === 0 ? 'PASS' : 'FAIL'} — ${failures.length} failed checks, ${real.length} page/console errors`);
process.exit(failures.length === 0 && real.length === 0 ? 0 : 1);
