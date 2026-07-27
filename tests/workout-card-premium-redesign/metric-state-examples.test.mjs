// Targeted metric/indicator examples for workout-card premium redesign task 9.3.
// Usage: node tests/workout-card-premium-redesign/metric-state-examples.test.mjs
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FIXED_NOW, INDEX_PATH, renderFixtureDocument } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(INDEX_PATH, 'utf8');
const manifest = JSON.parse(readFileSync(join(HERE, 'baseline-manifest.json'), 'utf8'));
const CHROME = [process.env.HF_CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium'
].filter(Boolean).find(existsSync);
const TOLERANCE = 0.75;
let checks = 0;
let failures = 0;

function check(name, condition, detail = '') {
  checks += 1;
  if (!condition) failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'} - ${name}${condition || !detail ? '' : `: ${detail}`}`);
}
function same(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  check(name, pass, pass ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function fields(name, entries) {
  const mismatches = Object.entries(entries).flatMap(([field, entry]) => {
    const pass = entry.compare
      ? entry.compare(entry.actual, entry.expected)
      : JSON.stringify(entry.actual) === JSON.stringify(entry.expected);
    return pass ? [] : [`${field}: expected ${JSON.stringify(entry.expected)}, got ${JSON.stringify(entry.actual)}`];
  });
  check(name, mismatches.length === 0, mismatches.join('; '));
}
function fixture(state) {
  return JSON.parse(readFileSync(join(HERE, manifest.states[state].fixture), 'utf8'));
}
function extractFunction(name) {
  const marker = `    function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Production function not found: ${name}`);
  const tail = source.slice(start + marker.length);
  const next = tail.search(/^    (?:async )?function\s+/m);
  return source.slice(start, next < 0 ? source.length : start + marker.length + next).trim();
}
const HANDLERS = [
  'addEventListenerSafe', 'stopEvent', 'getCompletionKey', 'formatTime',
  'getSeriesTrackerForCurrentWorkout', 'setupSeriesButton', 'handleSeriesButtonPress', 'updateSeriesButtonDisplay',
  'setupRestButton', 'handleRestButtonClick', 'startRestCountdown', 'stopRestCountdown', 'resetRestButton', 'clearPendingRestReset',
  'setupRepsButton', 'handleRepsButtonToggle', 'closeOtherRepsTooltips', 'scheduleRepsAutoClose', 'cancelRepsAutoClose'
].map(extractFunction).join('\n\n');

function interactionScript() {
  return `(() => {
    const epoch = ${Date.parse(FIXED_NOW)};
    let now = epoch, nextTimerId = 1, storageWrites = 0;
    const timers = new Map(), vibrationCalls = [];
    const schedule = (callback, delay, every = 0) => {
      const id = nextTimerId++;
      timers.set(id, { callback, at: now + Number(delay || 0), every });
      return id;
    };
    window.setTimeout = (callback, delay) => schedule(callback, delay);
    window.clearTimeout = id => timers.delete(Number(id));
    window.setInterval = (callback, delay) => schedule(callback, delay, Number(delay || 0));
    window.clearInterval = id => timers.delete(Number(id));
    Date.now = () => now;
    const tick = milliseconds => {
      const target = now + milliseconds;
      while (true) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        const [id, timer] = due;
        now = timer.at;
        if (timer.every > 0) timer.at += timer.every; else timers.delete(id);
        timer.callback();
      }
      now = target;
    };
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true, value: pattern => { vibrationCalls.push(pattern); return true; }
    });
    const APP_STATE = {
      currentWeekNumber: 1, currentDay: 'A', highestUnlockedWeek: 1,
      completionStatus: {}, allCompletions: {}, seriesTracker: {}
    };
    const REST_COUNTDOWNS = new Map(), REPS_TOOLTIP_TIMEOUTS = new Map();
    const DOM_ELEMENTS = { workoutDetails: document.querySelector('#workout-details') };
    function saveApplicationState() {
      storageWrites += 1;
      window.__HARNESS_STORAGE__.setItem('workout-state', JSON.stringify(APP_STATE));
    }
    ${HANDLERS}
    const card = document.querySelector('.workout-card');
    const series = card.querySelector('[data-stat-type="series"]');
    const reps = card.querySelector('[data-stat-type="reps"]');
    const rest = card.querySelector('[data-stat-type="rest"]');
    const method = card.querySelector('[data-method-badge]');
    const cta = card.querySelector('.completion-toggle-wrapper');
    setupSeriesButton(series, 0);
    setupRepsButton(reps);
    setupRestButton(rest, 0);

    const round = value => Math.round(value * 1000) / 1000;
    const rect = element => {
      const value = element.getBoundingClientRect();
      return { left: round(value.left), top: round(value.top), right: round(value.right),
        bottom: round(value.bottom), width: round(value.width), height: round(value.height) };
    };
    const text = element => (element?.textContent || '').replace(/\\s+/g, ' ').trim();
    const functionalAttributes = element => Object.fromEntries([...element.attributes]
      .filter(attribute => attribute.name === 'type' || attribute.name.startsWith('data-') || attribute.name.startsWith('aria-'))
      .map(attribute => [attribute.name, attribute.value]));
    const style = element => {
      const computed = getComputedStyle(element);
      return { color: computed.color, backgroundColor: computed.backgroundColor,
        borderColor: computed.borderColor, opacity: computed.opacity,
        pointerEvents: computed.pointerEvents, zIndex: computed.zIndex };
    };
    const metric = element => {
      const valueElement = element.querySelector('.stat-value');
      const progressFill = element.querySelector('.stat-progress-fill');
      return {
        classes: [...element.classList], attributes: functionalAttributes(element),
        label: text(element.querySelector('.stat-label')), value: text(valueElement),
        helper: text(element.querySelector('.stat-helper')), rect: rect(element), style: style(element),
        valueStyle: valueElement ? style(valueElement) : null,
        progressCount: element.querySelectorAll('.stat-progress-bar').length,
        progressWidth: progressFill?.style.width || '',
        progressStyle: progressFill ? style(progressFill) : null
      };
    };
    const metrics = () => ({ series: metric(series), reps: metric(reps), rest: metric(rest) });
    const persisted = () => {
      const value = window.__HARNESS_STORAGE__.getItem('workout-state');
      return value ? JSON.parse(value) : null;
    };
    const overlay = element => ({ rect: rect(element), style: style(element), role: element.getAttribute('role'),
      label: element.getAttribute('aria-label'), text: text(element),
      childTexts: [...element.children].map(text).filter(Boolean) });
    const results = { initial: metrics() };

    const free = rest.cloneNode(true);
    free.dataset.restSeconds = '';
    free.dataset.originalValue = 'Livre';
    free.querySelector('[data-role="rest-value"]').textContent = 'Livre';
    free.querySelector('[data-role="rest-helper"]').textContent = 'Toque para iniciar';
    free.removeAttribute('aria-pressed');
    free.classList.remove('is-counting', 'finished');
    document.body.append(free);
    setupRestButton(free, 1);
    const timersBeforeFreeClick = timers.size;
    free.click();
    results.restFree = { ...metric(free), timersBeforeFreeClick, timersAfterFreeClick: timers.size };

    series.click(); series.click();
    results.seriesActive = { ...metrics(), persisted: persisted(), storageWrites };
    series.click(); series.click();
    results.seriesComplete = { ...metrics(), persisted: persisted(), storageWrites };
    series.click();
    results.seriesWrapped = { ...metrics(), persisted: persisted(), storageWrites };

    reps.click();
    results.repsOpen = { ...metrics(), overlay: overlay(reps.querySelector('.stat-details')) };
    tick(5000);
    results.repsClosed = { ...metrics(), overlay: overlay(reps.querySelector('.stat-details')) };

    method.classList.add('is-open');
    method.setAttribute('aria-expanded', 'true');
    results.methodOverlay = overlay(method.querySelector('.method-tooltip'));
    method.classList.remove('is-open');
    method.setAttribute('aria-expanded', 'false');

    rest.click();
    results.restStarted = metrics();
    tick(30000);
    results.restCounting = metrics();
    rest.click();
    results.restCancelled = metrics();
    rest.click();
    tick(90000);
    results.restFinished = metrics();
    results.vibrationCalls = vibrationCalls;
    tick(4000);
    results.restReset = metrics();

    results.final = {
      storageWrites, persisted: persisted(), pendingTimers: timers.size,
      elapsedMs: now - epoch, restCountdowns: REST_COUNTDOWNS.size,
      repsTimeouts: REPS_TOOLTIP_TIMEOUTS.size,
      ctaRect: rect(cta), rootColors: {
        orange: getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim(),
        blue: getComputedStyle(document.documentElement).getPropertyValue('--blue').trim(),
        green: getComputedStyle(document.documentElement).getPropertyValue('--green').trim()
      }
    };
    document.body.dataset.metricResults = btoa(unescape(encodeURIComponent(JSON.stringify(results))));
  })();`;
}

function runInteractions() {
  if (!CHROME) throw new Error('A local Chromium executable is required by the deterministic harness');
  const html = renderFixtureDocument({ id: 'main-768-fine-full-chromium-pending' })
    .replace('</body>', `<script>${interactionScript()}</script></body>`);
  const tempPath = join(HERE, '.tmp-metric-state-examples.html');
  writeFileSync(tempPath, html, 'utf8');
  try {
    const run = spawnSync(CHROME, [
      '--headless=new', '--hide-scrollbars', '--disable-background-networking', '--disable-component-update',
      '--disable-default-apps', '--disable-sync', '--metrics-recording-only', '--no-first-run',
      '--host-resolver-rules=MAP * ~NOTFOUND', '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=1200', '--window-size=768,900', '--dump-dom', pathToFileURL(tempPath).href
    ], { encoding: 'utf8', timeout: 30000, maxBuffer: 24 * 1024 * 1024 });
    const match = run.stdout.match(/data-metric-results="([A-Za-z0-9+/=]+)"/);
    if (run.status !== 0 || !match) {
      throw new Error(`metric interaction harness failed (${run.status}): ${run.stderr.slice(-1200)}`);
    }
    return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
  } finally {
    rmSync(tempPath, { force: true });
  }
}

const pending = fixture('pending');
const activeBaseline = fixture('series-active');
const completeBaseline = fixture('series-complete');
const repsBaseline = fixture('reps-open');
const countingBaseline = fixture('rest-counting');
const finishedBaseline = fixture('rest-finished');
const baselineControl = (record, key) => record.semanticOrder.find(item => item.key === key);
const baselineRepsSegments = record => record.copyAndData.interactive.reps['data-reps'].split('|');
const hasClass = (state, className) => state.classes.includes(className);
const near = (left, right) => Math.abs(left - right) <= TOLERANCE;
const samePercent = (actual, expected) => {
  const numeric = Number.parseFloat(actual);
  return Number.isFinite(numeric) && Math.abs(numeric - expected) <= Number.EPSILON;
};
const equalMetrics = state => {
  const rects = [state.series.rect, state.reps.rect, state.rest.rect];
  return Math.max(...rects.map(item => item.width)) - Math.min(...rects.map(item => item.width)) <= TOLERANCE
    && Math.max(...rects.map(item => item.height)) - Math.min(...rects.map(item => item.height)) <= TOLERANCE
    && rects.every(item => near(item.top, rects[0].top) && near(item.bottom, rects[0].bottom));
};
const attrsInclude = (actual, expected) => Object.entries(expected).every(([key, value]) => actual[key] === value);

console.log('\nMetric state interaction harness');
let observed;
try {
  observed = runInteractions();
  check('real metric handlers execute with a local fake clock/storage/vibration', true);
} catch (error) {
  check('real metric handlers execute with a local fake clock/storage/vibration', false, error.stack || error.message);
}

if (observed) {
  console.log('\nEqual tracks, baseline attributes and indicators');
  check('Séries, Reps and Descanso have equal dimensions on one row', equalMetrics(observed.initial),
    JSON.stringify([observed.initial.series.rect, observed.initial.reps.rect, observed.initial.rest.rect]));
  check('equal metric dimensions survive active, complete, open, counting and finished states',
    [observed.seriesActive, observed.seriesComplete, observed.repsOpen, observed.restCounting, observed.restFinished]
      .every(equalMetrics));
  for (const key of ['series', 'reps', 'rest']) {
    check(`${key} preserves frozen functional attributes`,
      attrsInclude(observed.initial[key].attributes, pending.copyAndData.interactive[key]),
      JSON.stringify(observed.initial[key].attributes));
  }
  same('metric order and labels remain Séries, Reps, Descanso',
    [observed.initial.series.label, observed.initial.reps.label, observed.initial.rest.label], ['Séries', 'Reps', 'Descanso']);
  check('only Séries and Descanso retain existing progress bars',
    observed.initial.series.progressCount === 1 && observed.initial.rest.progressCount === 1
      && observed.initial.reps.progressCount === 0);
  check('progress tracks/fills stay above future material and pointer-inert',
    Number(observed.initial.series.progressStyle.zIndex) >= 1
      && Number(observed.initial.rest.progressStyle.zIndex) >= 1);

  console.log('\nSeries idle, active, complete and wraparound');
  fields('Series idle has value/helper/progress non-color signals', {
    value: { actual: observed.initial.series.value, expected: '0/4' },
    helper: { actual: observed.initial.series.helper, expected: 'Toque para registrar' },
    progressPercent: { actual: observed.initial.series.progressWidth, expected: 0, compare: samePercent },
    ariaPressed: { actual: observed.initial.series.attributes['aria-pressed'], expected: 'false' }
  });
  fields('Series active is baseline-equivalent and signals state without color alone', {
    value: { actual: observed.seriesActive.series.value, expected: activeBaseline.copyAndData.values[0] },
    activeClass: { actual: hasClass(observed.seriesActive.series, 'is-active'), expected: true },
    ariaPressed: { actual: observed.seriesActive.series.attributes['aria-pressed'], expected: baselineControl(activeBaseline, 'series').attributes['aria-pressed'] },
    helper: { actual: observed.seriesActive.series.helper, expected: 'Toque para avançar' },
    progressPercent: { actual: observed.seriesActive.series.progressWidth, expected: 50, compare: samePercent }
  });
  fields('Series complete is baseline-equivalent and signals completion with helper/progress', {
    value: { actual: observed.seriesComplete.series.value, expected: completeBaseline.copyAndData.values[0] },
    completeClass: { actual: hasClass(observed.seriesComplete.series, 'is-complete'), expected: true },
    ariaPressed: { actual: observed.seriesComplete.series.attributes['aria-pressed'], expected: 'true' },
    helper: { actual: observed.seriesComplete.series.helper, expected: 'Séries completas' },
    progressPercent: { actual: observed.seriesComplete.series.progressWidth, expected: 100, compare: samePercent }
  });
  fields('Series wraparound restores idle value, helper, ARIA and progress', {
    value: { actual: observed.seriesWrapped.series.value, expected: '0/4' },
    activeClass: { actual: hasClass(observed.seriesWrapped.series, 'is-active'), expected: false },
    completeClass: { actual: hasClass(observed.seriesWrapped.series, 'is-complete'), expected: false },
    helper: { actual: observed.seriesWrapped.series.helper, expected: 'Toque para registrar' },
    ariaPressed: { actual: observed.seriesWrapped.series.attributes['aria-pressed'], expected: 'false' },
    progressPercent: { actual: observed.seriesWrapped.series.progressWidth, expected: 0, compare: samePercent }
  });
  const activeTracker = Object.values(observed.seriesActive.persisted.seriesTracker)[0];
  const completeTracker = Object.values(observed.seriesComplete.persisted.seriesTracker)[0];
  const wrappedTracker = Object.values(observed.seriesWrapped.persisted.seriesTracker)[0];
  check('Series persistence records active/complete values then removes wrapped value',
    activeTracker['0'] === 2 && completeTracker['0'] === 4
      && !('0' in wrappedTracker) && observed.seriesWrapped.storageWrites === 5);

  console.log('\nReps closed/open and overlays');
  check('Reps starts closed with baseline data and no invented bar',
    !hasClass(observed.initial.reps, 'is-open') && observed.initial.reps.attributes['aria-expanded'] === 'false'
      && observed.initial.reps.attributes['data-reps'] === pending.copyAndData.interactive.reps['data-reps']
      && observed.initial.reps.progressCount === 0);
  fields('Reps opens with frozen role/copy/ARIA and remains bar-free', {
    openClass: { actual: hasClass(observed.repsOpen.reps, 'is-open'), expected: true },
    ariaExpanded: { actual: observed.repsOpen.reps.attributes['aria-expanded'], expected: repsBaseline.copyAndData.interactive.reps['aria-expanded'] },
    overlayRole: { actual: observed.repsOpen.overlay.role, expected: 'dialog' },
    overlayLabel: { actual: observed.repsOpen.overlay.label, expected: 'Detalhes das repetições' },
    overlaySegments: { actual: observed.repsOpen.overlay.childTexts, expected: baselineRepsSegments(repsBaseline) },
    progressCount: { actual: observed.repsOpen.reps.progressCount, expected: 0 },
    overlayOpacity: { actual: observed.repsOpen.overlay.style.opacity, expected: '1' },
    overlayPointerEvents: { actual: observed.repsOpen.overlay.style.pointerEvents, expected: 'auto' }
  });
  check('Reps overlay is viewport-contained above the chip and never blocks CTA',
    observed.repsOpen.overlay.rect.left >= -TOLERANCE
      && observed.repsOpen.overlay.rect.right <= 768 + TOLERANCE
      && observed.repsOpen.overlay.rect.bottom <= observed.repsOpen.reps.rect.top + TOLERANCE
      && observed.repsOpen.overlay.rect.bottom <= observed.final.ctaRect.top + TOLERANCE);
  check('Reps fake 5s timeout restores closed state without real waiting',
    !hasClass(observed.repsClosed.reps, 'is-open')
      && observed.repsClosed.reps.attributes['aria-expanded'] === 'false'
      && observed.repsClosed.overlay.style.opacity === '0'
      && observed.repsClosed.overlay.style.pointerEvents === 'none');
  check('method overlay preserves dialog semantics, viewport containment and CTA clearance',
    observed.methodOverlay.role === 'dialog' && observed.methodOverlay.label === 'Detalhes do método'
      && observed.methodOverlay.rect.left >= -TOLERANCE && observed.methodOverlay.rect.right <= 768 + TOLERANCE
      && observed.methodOverlay.rect.bottom <= observed.final.ctaRect.top + TOLERANCE
      && observed.methodOverlay.style.opacity === '1');

  console.log('\nRest free, idle, counting, finished and cancelled');
  check('Rest free remains informational and starts no timer',
    observed.restFree.value === 'Livre' && observed.restFree.helper === 'Descanso livre'
      && observed.restFree.timersAfterFreeClick === observed.restFree.timersBeforeFreeClick
      && !hasClass(observed.restFree, 'is-counting') && observed.restFree.progressWidth === '');
  check('Rest idle preserves baseline value/data/live region and start signal',
    observed.initial.rest.value === pending.copyAndData.values[2]
      && observed.initial.rest.helper === pending.copyAndData.helpers[2]
      && observed.initial.rest.attributes['aria-live'] === pending.copyAndData.interactive.rest['aria-live']
      && observed.initial.rest.progressWidth === '');
  check('Rest starts immediately at full duration with cancel signal',
    observed.restStarted.rest.value === '01:30' && observed.restStarted.rest.helper === 'toque para cancelar'
      && hasClass(observed.restStarted.rest, 'is-counting')
      && observed.restStarted.rest.attributes['aria-pressed'] === 'true'
      && observed.restStarted.rest.progressWidth === '0%');
  check('Rest fake clock reaches frozen counting result with blue progress',
    observed.restCounting.rest.value === countingBaseline.copyAndData.values[2]
      && hasClass(observed.restCounting.rest, 'is-counting')
      && observed.restCounting.rest.attributes['aria-pressed'] === baselineControl(countingBaseline, 'rest').attributes['aria-pressed']
      && /cancelar/i.test(observed.restCounting.rest.helper)
      && observed.restCounting.rest.progressWidth === '33.3%');
  check('Rest cancellation restores idle copy, ARIA, classes and progress',
    observed.restCancelled.rest.value === pending.copyAndData.values[2]
      && observed.restCancelled.rest.helper === 'Toque para iniciar'
      && observed.restCancelled.rest.attributes['aria-pressed'] === 'false'
      && !hasClass(observed.restCancelled.rest, 'is-counting')
      && observed.restCancelled.rest.progressWidth === '0%');
  check('Rest completion reaches frozen ready value plus text/progress signals',
    observed.restFinished.rest.value === finishedBaseline.copyAndData.values[2]
      && hasClass(observed.restFinished.rest, 'finished')
      && observed.restFinished.rest.helper === 'Respire e retome'
      && observed.restFinished.rest.attributes['aria-pressed'] === 'false'
      && observed.restFinished.rest.progressWidth === '100%');
  same('Rest completion uses only fake vibration', observed.vibrationCalls, [[100, 60, 100]]);
  check('Rest fake 4s reset restores idle and clears countdown state',
    observed.restReset.rest.value === pending.copyAndData.values[2]
      && observed.restReset.rest.helper === 'Toque para iniciar'
      && !hasClass(observed.restReset.rest, 'finished')
      && observed.final.restCountdowns === 0);

  console.log('\nSemantic colors, non-color signals and baseline-equivalent results');
  check('active Series keeps orange action state on surface/border/progress',
    observed.seriesActive.series.style.backgroundColor === 'rgba(255, 122, 31, 0.2)'
      && observed.seriesActive.series.style.borderColor === 'rgba(255, 122, 31, 0.6)'
      && observed.seriesActive.series.progressStyle.backgroundColor === 'rgb(255, 122, 31)');
  fields('complete Series keeps green state on value/surface/progress', {
    valueColor: { actual: observed.seriesComplete.series.valueStyle.color, expected: 'rgb(166, 227, 161)' },
    surfaceColor: { actual: observed.seriesComplete.series.style.backgroundColor, expected: 'rgba(166, 227, 161, 0.18)' },
    progressColor: { actual: observed.seriesComplete.series.progressStyle.backgroundColor, expected: 'rgb(166, 227, 161)' }
  });
  fields('counting Rest keeps blue operational state on value/surface/progress', {
    valueColor: { actual: observed.restCounting.rest.valueStyle.color, expected: 'rgb(137, 180, 250)' },
    surfaceColor: { actual: observed.restCounting.rest.style.backgroundColor, expected: 'rgba(137, 180, 250, 0.18)' },
    progressColor: { actual: observed.restCounting.rest.progressStyle.backgroundColor, expected: 'rgb(137, 180, 250)' }
  });
  fields('finished Rest keeps green ready state on value/surface/progress', {
    valueColor: { actual: observed.restFinished.rest.valueStyle.color, expected: 'rgb(166, 227, 161)' },
    surfaceColor: { actual: observed.restFinished.rest.style.backgroundColor, expected: 'rgba(166, 227, 161, 0.18)' },
    progressColor: { actual: observed.restFinished.rest.progressStyle.backgroundColor, expected: 'rgb(166, 227, 161)' }
  });
  same('semantic color tokens remain the established orange/blue/green values', observed.final.rootColors,
    { orange: '#ff7a1f', blue: '#89b4fa', green: '#a6e3a1' });
  check('Reps/Rest interactions do not alter Series persistence or add writes',
    observed.final.storageWrites === 5
      && JSON.stringify(observed.final.persisted) === JSON.stringify(observed.seriesWrapped.persisted));
  check('all timing is fake/local and leaves no pending metric work',
    observed.final.elapsedMs === 129000 && observed.final.pendingTimers === 0
      && observed.final.restCountdowns === 0 && observed.final.repsTimeouts === 0);
  check('baseline-equivalent observable values are reached for every frozen metric state',
    observed.seriesActive.series.value === activeBaseline.copyAndData.values[0]
      && observed.seriesComplete.series.value === completeBaseline.copyAndData.values[0]
      && observed.repsOpen.reps.value === repsBaseline.copyAndData.values[1]
      && observed.restCounting.rest.value === countingBaseline.copyAndData.values[2]
      && observed.restFinished.rest.value === finishedBaseline.copyAndData.values[2]);
}

console.log(failures
  ? `\n${failures} of ${checks} targeted metric-state checks failed (geometry tolerance ${TOLERANCE}px)`
  : `\nAll ${checks} targeted metric-state checks passed (geometry tolerance ${TOLERANCE}px)`);
process.exit(failures ? 1 : 0);
