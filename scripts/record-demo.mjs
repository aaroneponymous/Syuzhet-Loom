// Optional tooling: records the demonstration media in docs/media/ from the built viewer running the bundled
// example. Not needed to use Syuzhet Loom and not part of `npm test`.
//
// Needs:
//   - Google Chrome installed locally (driven headless, with a fresh temporary profile);
//   - playwright-core, which is deliberately not a dependency: `npm i --no-save playwright-core`, or point the
//     PLAYWRIGHT_CORE environment variable at an existing copy's entry file;
//   - ffmpeg on the PATH (or FFMPEG=/path/to/ffmpeg).
//
// Run:
//   npm run trace-staleness                     (so the "Since pinned" block has a report to show)
//   npm run build && npm run preview            (in one terminal)
//   node scripts/record-demo.mjs [baseUrl] [outDir] [name ...]
//     baseUrl  default http://localhost:4173/
//     outDir   default docs/media
//     name     limit the run to some of: demo-model demo-trace demo-scenario stills
//
// What it does: every step is a real pointer move, click or wheel scroll on the live page. The frames are
// Chrome's own screencast of that page (DevTools Page.startScreencast), kept with their timestamps and encoded
// by ffmpeg to an MP4 and a GIF; the stills are page screenshots. Nothing is drawn over or cut out of a frame
// afterwards. One thing is added to the page while a clip is recorded: a small round pointer marker that
// follows the mouse, because headless Chrome draws no cursor. The stills are taken without it.
//
// The recorder types nothing, so the response log (responses/) is not written.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const pw = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const chromium = pw.chromium ?? pw.default.chromium;
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';

const BASE = process.argv[2] ?? 'http://localhost:4173/';
const OUT = resolve(process.argv[3] ?? 'docs/media');
const ONLY = process.argv.slice(4);
const SIZE = { width: 1440, height: 900 };
const GIF = { width: 1200, fps: 10 };

// ---- the pointer marker (the only thing added to the page; clips only) ---------------------------------
const POINTER = () => {
  const dot = document.createElement('div');
  dot.id = 'recorder-pointer';
  Object.assign(dot.style, {
    position: 'fixed', left: '-40px', top: '-40px', width: '18px', height: '18px', borderRadius: '50%',
    background: 'rgba(40,40,40,.18)', border: '2px solid rgba(40,40,40,.85)', boxShadow: '0 0 0 2px rgba(255,255,255,.7)',
    pointerEvents: 'none', zIndex: 99999, transform: 'translate(-50%,-50%)', transition: 'width .12s, height .12s',
  });
  const add = () => document.body.append(dot);
  if (document.body) add(); else addEventListener('DOMContentLoaded', add);
  addEventListener('mousemove', (e) => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; }, true);
  addEventListener('mousedown', () => { dot.style.width = dot.style.height = '11px'; }, true);
  addEventListener('mouseup', () => { dot.style.width = dot.style.height = '18px'; }, true);
};

// ---- real input, paced so that it can be followed --------------------------------------------------------
function driver(page) {
  let at = { x: 520, y: 300 };
  const wait = (ms) => page.waitForTimeout(ms);
  const glide = async (x, y, ms) => {
    const from = at;
    // a short hop is quick, a move across the page takes about half a second
    ms ??= Math.min(600, 120 + Math.hypot(x - from.x, y - from.y) * 0.9);
    const n = Math.max(4, Math.round(ms / 25));
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; // ease in and out
      await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
      await wait(25);
    }
    at = { x, y };
  };
  const box = async (target) => {
    const l = typeof target === 'string' ? page.locator(target).first() : target;
    await l.waitFor({ state: 'visible', timeout: 8000 });
    const b = await l.boundingBox();
    if (!b) throw new Error(`not visible: ${target}`);
    return b;
  };
  /** Move to the middle of an element, pause, press and release there, then hold the result on screen. */
  const click = async (target, hold = 1500) => {
    const b = await box(target);
    const [cx, cy] = [b.x + b.width / 2, b.y + b.height / 2];
    if (cx < 0 || cy < 0 || cx > SIZE.width || cy > SIZE.height) throw new Error(`scrolled out of view: ${target}`);
    await glide(cx, cy);
    await wait(300);
    await page.mouse.down();
    await wait(90);
    await page.mouse.up();
    await wait(hold);
  };
  /** Wheel-scroll the details panel until an element sits near its top, then hold. */
  const scrollPanelTo = async (target, hold = 1800, offset = 56) => {
    const p = await box('[data-testid="panel"]');
    if (at.x < p.x + 20 || at.y < p.y + 20) await glide(p.x + p.width / 2, p.y + p.height * 0.45, 450);
    for (let pass = 0; pass < 3; pass++) {
      const b = await (typeof target === 'string' ? page.locator(target).first() : target).boundingBox();
      if (!b) throw new Error(`not in the panel: ${target}`);
      const dy = b.y - p.y - offset;
      if (Math.abs(dy) < 6) break;
      const n = Math.max(6, Math.ceil(Math.abs(dy) / 45));
      for (let i = 0; i < n; i++) { await page.mouse.wheel(0, dy / n); await wait(28); }
      await wait(150);
    }
    await wait(hold);
  };
  const park = async (x, y) => { await page.mouse.move(x, y); at = { x, y }; };
  return { wait, click, scrollPanelTo, glide, park };
}

const panel = (rest) => `[data-testid="panel"] ${rest}`;

// ---- the clips ---------------------------------------------------------------------------------------------
const CLIPS = {
  // overview -> a journey expanded in place -> the Booking hold component focused -> a state with its rules and
  // sources, one decision and one criterion opened to their original wording -> an OPEN event and its question
  'demo-model': async (page, d) => {
    await d.wait(1800);
    await d.click('[aria-label="Expand J01 Book a room"]', 1900);
    await d.click('[aria-label="Focus Booking hold"]', 1800);
    await d.click('[data-testid="node-held"]', 1900);
    await d.click(panel('summary:has-text("D-08")'), 2000);
    await d.click(panel('summary:has-text("AC-J01-07")'), 2000);
    await d.click('[data-testid="edge-confirming__held-unknown"]', 2200);
    await d.click(panel('button.ref-q'), 2600);
  },

  // a traced state of the Booking hold component -> its Trace layers -> an event with a coverage gap, a finding
  // and the draft work item -> back to the state for the "Since pinned" staleness block
  'demo-trace': async (page, d) => {
    await d.wait(900);
    await d.click('[data-testid="node-held"]', 1300);
    await d.scrollPanelTo('[data-testid="trace-layer-product"]', 2200);
    await d.scrollPanelTo('[data-testid="trace-layer-verification"]', 1900, 220);
    await d.click('[data-testid="edge-confirming__expired"]', 1000);
    await d.scrollPanelTo('[data-testid="trace-layer-verification"]', 2000, 120);
    await d.scrollPanelTo('[data-testid="trace-findings"]', 2100);
    // the work item's text scrolls by itself, so the panel is positioned before it is opened
    await d.scrollPanelTo('[data-testid="trace-work"]', 500, 60);
    await d.click(panel('[data-testid="trace-wi"] summary'), 2000);
    await d.click('[data-testid="node-held"]', 800);
    await d.scrollPanelTo('[data-testid="staleness"]', 3000, 90);
  },

  // one scenario, played on the map one step at a time
  'demo-scenario': async (page, d) => {
    await d.wait(900);
    await d.click('[data-testid="scenarios-button"]', 1300);
    await d.click('[data-testid="scenario-list"] .sc-item >> nth=0', 1400);
    for (;;) {
      const next = page.locator('[data-testid="scenario-next"]');
      if (await next.isDisabled()) break;
      await d.click(next, 700);
    }
    await d.wait(400);
  },
};
const START = { 'demo-model': '', 'demo-trace': '#/booking-hold', 'demo-scenario': '' };

// ---- the stills --------------------------------------------------------------------------------------------
async function stills(browser) {
  const shot = async (page, name) => { await page.screenshot({ path: join(OUT, name), type: 'png' }); console.log(`ok    ${name}`); };
  const fresh = async (hash = '') => {
    const ctx = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto(BASE + hash);
    await page.waitForTimeout(1500);
    return { ctx, page, d: driver(page) };
  };
  {
    const { ctx, page, d } = await fresh();
    await shot(page, 'overview.png');
    // the theme button cycles through follows-the-system, light and dark
    for (let i = 0; i < 3 && (await page.evaluate(() => document.documentElement.dataset.theme)) !== 'dark'; i++) await d.click('[data-testid="theme-toggle"]', 400);
    await d.park(520, 760);
    await d.wait(600);
    await shot(page, 'overview-dark.png');
    await ctx.close();
  }
  {
    const { ctx, page, d } = await fresh();
    await d.click('[aria-label="Focus Booking hold"]', 1200);
    await d.click('[data-testid="node-held"]', 900);
    await d.park(520, 860);
    await d.wait(400);
    await shot(page, 'component.png');
    await d.scrollPanelTo('[data-testid="trace-layer-product"]', 600);
    await shot(page, 'trace.png');
    await d.click('[data-testid="edge-confirming__held-unknown"]', 900);
    await d.scrollPanelTo('[data-testid="open-box"]', 400, 400); // the panel keeps its scroll position: back to the top
    await d.click(panel('button.ref-q'), 900);
    await d.park(520, 860);
    await d.wait(400);
    await shot(page, 'open-point.png');
    await ctx.close();
  }
}

// ---- runner ------------------------------------------------------------------------------------------------
const want = (name) => ONLY.length === 0 || ONLY.includes(name);
mkdirSync(OUT, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'loom-record-'));
// the screencast captures the window surface, so the window must match the viewport
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [`--window-size=${SIZE.width},${SIZE.height}`] });
let failed = 0;
try {
  for (const name of Object.keys(CLIPS).filter(want)) {
    const dir = join(work, name);
    mkdirSync(dir);
    const ctx = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, colorScheme: 'light' });
    await ctx.addInitScript(POINTER);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + START[name]);
    await page.waitForTimeout(1500);
    const d = driver(page);
    await d.park(520, 300);

    const frames = [];
    const cdp = await ctx.newCDPSession(page);
    cdp.on('Page.screencastFrame', async (f) => {
      frames.push({ data: f.data, ts: f.metadata.timestamp });
      await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'png', maxWidth: SIZE.width, maxHeight: SIZE.height, everyNthFrame: 1 });
    try {
      await CLIPS[name](page, d);
    } catch (e) {
      errors.push(String(e.message ?? e));
    }
    await cdp.send('Page.stopScreencast').catch(() => {});
    await ctx.close();
    if (errors.length || frames.length === 0) {
      failed++;
      console.log(`FAIL  ${name}: ${errors.join(' | ') || 'no frames'}`);
      continue;
    }

    // a frame arrives only when the page repaints: each is shown until the next one, the last for 1.2 s
    const list = [];
    frames.forEach((f, i) => {
      const file = join(dir, `f${String(i).padStart(5, '0')}.png`);
      writeFileSync(file, Buffer.from(f.data, 'base64'));
      const dur = i + 1 < frames.length ? Math.max(frames[i + 1].ts - f.ts, 0.001) : 1.2;
      list.push(`file '${file}'`, `duration ${dur.toFixed(4)}`);
    });
    list.push(`file '${join(dir, `f${String(frames.length - 1).padStart(5, '0')}.png`)}'`);
    writeFileSync(join(dir, 'list.txt'), list.join('\n') + '\n');
    const input = ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt')];
    const clean = ['-map_metadata', '-1', '-fflags', '+bitexact'];
    execFileSync(FFMPEG, [...input, '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', ...clean, '-flags:v', '+bitexact', join(OUT, `${name}.mp4`)]);
    execFileSync(FFMPEG, [...input, '-vf', `fps=${GIF.fps},scale=${GIF.width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`, '-loop', '0', ...clean, join(OUT, `${name}.gif`)]);
    console.log(`ok    ${name}.mp4 ${name}.gif  (${frames.length} frames captured)`);
  }
  if (want('stills')) await stills(browser);
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
