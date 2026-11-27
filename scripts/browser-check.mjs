// Optional browser smoke check of the built viewer, on the bundled example. Not needed to view the model,
// and not part of `npm test`: playwright-core is deliberately not a dependency.
//   npm run build && npm run preview          (in one terminal)
//   npm i --no-save playwright-core && node scripts/browser-check.mjs [baseUrl]
// Uses the locally installed Google Chrome. Checks that the viewer works, not that the model is right.
const pw = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const chromium = pw.chromium ?? pw.default.chromium;
const base = process.argv[2] ?? 'http://localhost:4173/';
const origin = new URL(base).origin;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const external = [];
const consoleErrors = [];
page.on('request', (r) => {
  const u = r.url();
  if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
});
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

let failed = 0;
let total = 0;
const check = (name, ok, detail = '') => { total++; if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const settle = (ms = 650) => page.waitForTimeout(ms);
const open = async (hash) => { await page.goto(base + hash); await page.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange'))); await settle(900); };
const count = (sel) => page.locator(sel).count();
const text = async (sel) => (await page.locator(sel).allTextContents()).join(' ');

// 1. the viewer loads the overview
await open('');
check('the page is titled Syuzhet Loom', (await page.title()) === 'Syuzhet Loom', await page.title());
check('the overview shows the journeys, shared components, the record and the boundary', (await count('[data-testid^="node-"]')) === 8, `${await count('[data-testid^="node-"]')} nodes`);

// 2. expand a machine in place
await page.click('[aria-label="Expand Booking hold"]', { timeout: 5000 }); await settle();
check('expanding "Booking hold" in place reveals its states', (await count('[data-testid="node-booking-hold/held"]')) === 1);

// 3. open a state
await page.click('[data-testid="node-booking-hold/held"]', { timeout: 5000 }); await settle(400);
const stateView = await text('[data-testid="state-view"]');
check('clicking a state opens its details', stateView.includes('Room held'), stateView.slice(0, 80));
check('its panel lists its rules and source references', (await text('[data-testid="panel"]')).includes('The time left on the hold is shown.') && (await text('[data-testid="panel"]')).includes('D-07'));

// 4. the Trace section of that state
check('the Trace section is shown', (await count('[data-testid="trace"]')) === 1);
check('trace: handoff SR-03 refines it, with its class quoted', /SR-03 \(v1\)[\s\S]*refines this[\s\S]*confirmed/.test(await text('[data-testid="trace-layer-handoff"]')), (await text('[data-testid="trace-layer-handoff"]')).slice(0, 120));
check('trace: product approval is quoted, not computed', /Not started/.test(await text('[data-testid="trace-layer-product"]')));
check('trace: the design row is shown with its coverage and acceptance', /designed[\s\S]*not accepted/.test(await text('[data-testid="trace-layer-design"]')));
check('trace: no check run, so no result is shown', (await count('[data-testid="trace-no-runs"]')) === 1);
check('trace: the element hash is compared with the baseline', /(matches|differs from) baseline [0-9a-f]{7}/.test(await text('[data-testid="trace-hash"]')), await text('[data-testid="trace-hash"]'));
{
  // the staleness report is generated output and may be absent: either way the viewer must say which
  const status = await page.locator('[data-testid="stale-report"]').first().getAttribute('data-status').catch(() => null);
  check('trace: the staleness block states whether a report was bundled', ['missing', 'loaded', 'outdated'].includes(status ?? ''), `report: ${status}`);
}

// 5. a transition with a finding and its draft work item, by direct link
await open('#/booking-hold/confirming__expired');
check('direct link to a transition selects it', (await text('[data-testid="transition-view"]')).includes('No answer: hold given up'));
check('trace: finding XLF-01 is attached and WI-01 is a draft that was not sent', /XLF-01/.test(await text('[data-testid="trace-findings"]')) && (await page.textContent('[data-testid="wi-status"]'))?.trim() === 'Draft — not sent');
check('trace: the missing scenario is shown as a checked absence', /Checked: none found/.test(await text('[data-testid="trace-layer-verification"]')));

// 6. an element the trace does not cover
await open('#/room-search/criteria__checking');
check('outside the trace: model scenarios are still listed', /S01/.test(await text('[data-testid="trace"]')));
await open('#/check-in/open__checked-in');
check('an element with nothing recorded says so in one line', /Not traced yet\. The trace covers the Booking hold component only\./.test(await text('[data-testid="trace"]')), await text('[data-testid="trace"]'));

check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
check('no request left the preview server', external.length === 0, external.slice(0, 5).join(', '));
await browser.close();
console.log(failed ? `\n${failed} of ${total} check(s) FAILED` : `\nall ${total} browser checks passed`);
process.exit(failed ? 1 : 0);
