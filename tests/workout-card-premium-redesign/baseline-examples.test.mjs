// Targeted regression examples for the frozen workout-card baseline.
// Usage: node tests/workout-card-premium-redesign/baseline-examples.test.mjs
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { load } from 'cheerio';
import {
  FIXED_NOW, INDEX_PATH, ROOT, STATES, defaultExercise, renderFixtureDocument
} from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINES = join(HERE, 'baselines');
const MANIFEST_PATH = join(HERE, 'baseline-manifest.json');
const CHROME_CANDIDATES = [
  process.env.HF_CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean);
const CHROME = CHROME_CANDIDATES.find(existsSync);
const source = readFileSync(INDEX_PATH, 'utf8');
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
let failures = 0;
let checks = 0;

function check(name, condition, detail = '') {
  checks += 1;
  if (!condition) failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'} - ${name}${condition || !detail ? '' : `: ${detail}`}`);
}
function same(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  check(name, pass, pass ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const normalizeText = value => String(value || '').replace(/\s+/g, ' ').trim();
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const fixture = state => JSON.parse(readFileSync(join(HERE, manifest.states[state].fixture), 'utf8'));

function rendered(input = {}, exercise = defaultExercise()) {
  const $ = load(renderFixtureDocument(input, exercise));
  return { $, card: $('.workout-card').first() };
}
function cardCopy($, card) {
  return {
    title: normalizeText(card.find('h3').text()),
    method: normalizeText(card.find('.method-label').text()),
    labels: card.find('.stat-label').map((_, node) => normalizeText($(node).text())).get(),
    values: card.find('.stat-value').map((_, node) => normalizeText($(node).text())).get(),
    helpers: card.find('.stat-helper').map((_, node) => normalizeText($(node).text())).get(),
    cta: normalizeText(card.find('.completion-toggle-wrapper').text())
  };
}

console.log('\nFrozen baseline integrity');
same('manifest covers every frozen functional state', Object.keys(manifest.states).sort(), [...STATES].sort());
check('baseline explicitly disables network and isolates persistence',
  manifest.determinism.network === 'disabled' && manifest.determinism.persistence === 'isolated-memory');
check('baseline media mask is restricted to GIF/parallax pixels',
  manifest.maskPolicy.allowedOnly.length === 2
  && manifest.maskPolicy.allowedOnly.every(value => /GIF|parallax/.test(value)));
for (const [state, record] of Object.entries(manifest.states)) {
  const fixturePath = join(HERE, record.fixture);
  const capturePath = join(HERE, record.capture);
  check(`${state} fixture and capture exist`, existsSync(fixturePath) && existsSync(capturePath));
  check(`${state} fixture identifies its state`, fixture(state).case.state === state);
}
const targetedCaptures = manifest.captures.filter(item => /main-768-fine-full-chromium-(pending|completed|locked|series-active|series-complete|reps-open|rest-counting|rest-finished|method-open)\.png$/.test(item.path));
check('targeted capture hashes still match the frozen manifest', targetedCaptures.length === STATES.length
  && targetedCaptures.every(item => sha256(join(HERE, item.path)) === item.sha256));

console.log('\nCanonical content, keyboard order, ARIA and lazy media');
const pending = fixture('pending');
const canonical = rendered({ id: 'main-768-fine-full-chromium-pending' });
const canonicalCopy = cardCopy(canonical.$, canonical.card);
same('canonical title matches baseline', canonicalCopy.title, pending.copyAndData.title);
same('canonical metric labels match baseline', canonicalCopy.labels, pending.copyAndData.labels);
same('canonical values match baseline', canonicalCopy.values, pending.copyAndData.values);
same('canonical helpers match baseline', canonicalCopy.helpers, pending.copyAndData.helpers);
same('canonical CTA copy matches baseline', canonicalCopy.cta, pending.copyAndData.cta);
const focusSelectors = ['[data-method-badge]', '[data-stat-type="series"]', '[data-stat-type="reps"]', '[data-stat-type="rest"]', '.completion-toggle-wrapper'];
const focusKeys = ['method', 'series', 'reps', 'rest', 'cta'];
same('keyboard order remains method → series → reps → rest → CTA', focusSelectors.filter(selector => canonical.card.find(selector).length).map((_, index) => focusKeys[index]), pending.focusOrder.map(item => item.key));
const method = canonical.card.find('[data-method-badge]');
const series = canonical.card.find('[data-stat-type="series"]');
const reps = canonical.card.find('[data-stat-type="reps"]');
const rest = canonical.card.find('[data-stat-type="rest"]');
check('baseline ARIA contracts remain present', method.attr('aria-expanded') === 'false'
  && series.attr('aria-pressed') === 'false'
  && rest.attr('aria-live') === 'polite'
  && canonical.card.find('.method-tooltip[role="dialog"][aria-label="Detalhes do método"]').length === 1
  && canonical.card.find('.stat-details[role="dialog"][aria-label="Detalhes das repetições"]').length === 1);
check('decorative icons and progress tracks remain hidden from accessibility tree',
  canonical.card.find('i[aria-hidden="true"]').length === 4
  && canonical.card.find('.stat-progress-bar[aria-hidden="true"]').length === 2);
const mainImage = canonical.card.find('.exercise-card-image');
const coarseWeek = rendered({ id: 'week-sheet-639-coarse-full-chromium-pending', width: 639, context: 'week-sheet', pointer: 'coarse' });
const weekImage = coarseWeek.card.find('.exercise-card-image');
check('main image keeps native lazy/async attributes and immediate local source',
  mainImage.attr('loading') === 'lazy' && mainImage.attr('decoding') === 'async'
  && /^src\/imagens\//.test(mainImage.attr('src') || '') && !mainImage.attr('data-src'));
check('mobile/coarse week-sheet image keeps controlled data-src lazy loading',
  weekImage.attr('loading') === 'lazy' && weekImage.attr('decoding') === 'async'
  && /^src\/imagens\//.test(weekImage.attr('data-src') || '') && !weekImage.attr('src'));

console.log('\nShort, long, Unicode and local media examples');
const examples = [
  {
    label: 'short/light', mediaTone: 'light',
    exercise: { name: 'Cadeira Extensora', series: '3', rept: '8', descanso: 'Livre', method: 'Bi-set' },
    extension: '.webp'
  },
  {
    label: 'long/dark', mediaTone: 'dark',
    exercise: {
      name: 'Rosca Martelo + Tríceps Francês (Corda)',
      series: '12 séries progressivas', rept: '20/18/15/12/10/8', descanso: '2 minutos e 30 segundos',
      method: 'Pirâmide Crescente + Isometria + Rest Pause Última Série'
    },
    extension: '.webp'
  },
  {
    label: 'Unicode/GIF', mediaTone: 'animated',
    exercise: { name: 'Agachamento Hack', series: '4', rept: '12/10/8/6', descanso: '90 seg', method: 'Ênfase excêntrica • ação 🔥' },
    extension: '.gif'
  }
];
for (const example of examples) {
  const view = rendered({ id: 'main-768-fine-full-chromium-pending' }, example.exercise);
  const copy = cardCopy(view.$, view.card);
  const image = view.card.find('.exercise-card-image');
  const mediaSource = image.attr('src') || image.attr('data-src') || '';
  same(`${example.label} preserves full title`, copy.title, example.exercise.name);
  same(`${example.label} preserves full method Unicode/content`, copy.method, example.exercise.method);
  check(`${example.label} keeps title and badge untruncated in markup`,
    !/line-clamp|truncate|ellipsis/.test(`${view.card.find('h3').attr('class') || ''} ${view.card.find('[data-method-badge]').attr('class') || ''}`));
  check(`${example.label} uses only local ${example.mediaTone} fixture media`,
    mediaSource.startsWith('src/imagens/') && mediaSource.endsWith(example.extension)
    && !/^(?:https?:)?\/\//.test(mediaSource));
  check(`${example.label} keeps complete escaped alt text`, image.attr('alt') === `Ilustração do exercício ${example.exercise.name}`);
}

console.log('\nFrozen CTA, metric and overlay states');
const expectedStates = {
  pending: { cta: 'Marcar como Concluído' },
  completed: { cta: 'Concluído!', cardClass: 'exercise-completed', checkClass: 'completed' },
  locked: { cta: 'Concluído!', cardClass: 'exercise-completed', checkClass: 'completed' },
  'series-active': { value: '2/4', aria: 'true', controlClass: 'is-active' },
  'series-complete': { value: '4/4', controlClass: 'is-complete' },
  'reps-open': { aria: 'true', controlClass: 'is-open', dialogRole: 'dialog' },
  'rest-counting': { value: '01:00', aria: 'true', controlClass: 'is-counting' },
  'rest-finished': { value: 'Pronto!', controlClass: 'finished' },
  'method-open': { aria: 'true', controlClass: 'is-open', dialogRole: 'dialog' }
};
for (const [state, expected] of Object.entries(expectedStates)) {
  const data = fixture(state);
  const inventoryByKey = key => data.inventory.find(item => item.key === key);
  const semanticByKey = key => data.semanticOrder.find(item => item.key === key);
  const controlKey = state.startsWith('series-') ? 'series' : state.startsWith('rest-') ? 'rest' : state === 'reps-open' ? 'reps' : state === 'method-open' ? 'method' : 'cta';
  const control = inventoryByKey(controlKey);
  if (expected.cta) same(`${state} CTA copy is frozen`, data.copyAndData.cta, expected.cta);
  if (expected.cardClass) check(`${state} card class is frozen`, data.geometryAndMaterials.card.classes.includes(expected.cardClass));
  if (expected.checkClass) check(`${state} completed check remains a non-color cue`, data.inventory.some(item => item.classes.includes('animated-check-container') && item.classes.includes(expected.checkClass)));
  if (expected.value) check(`${state} value is frozen`, semanticByKey(controlKey).text.includes(expected.value));
  if (expected.aria) check(`${state} ARIA state is frozen`, semanticByKey(controlKey).attributes['aria-expanded'] === expected.aria || semanticByKey(controlKey).attributes['aria-pressed'] === expected.aria);
  if (expected.controlClass) check(`${state} visual/functional class is frozen`, control.classes.includes(expected.controlClass));
  if (expected.dialogRole) {
    const dialogKey = controlKey === 'method' ? 'methodDialog' : 'repsDialog';
    check(`${state} overlay keeps dialog semantics`, inventoryByKey(dialogKey).attributes.role === expected.dialogRole);
  }
}
check('Reps remains without an invented progress indicator', !fixture('reps-open').inventory.some(item => item.key === 'reps' && item.classes.includes('stat-progress-bar'))
  && canonical.card.find('[data-stat-type="reps"] .stat-progress-bar').length === 0);

function extractFunction(name) {
  const marker = `    function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Production function not found: ${name}`);
  const tail = source.slice(start + marker.length);
  const next = tail.search(/^    (?:async )?function\s+/m);
  return source.slice(start, next < 0 ? source.length : start + marker.length + next).trim();
}
const handlerNames = [
  'addEventListenerSafe', 'stopEvent', 'getCompletionKey', 'formatTime',
  'getSeriesTrackerForCurrentWorkout', 'setupSeriesButton', 'handleSeriesButtonPress', 'updateSeriesButtonDisplay',
  'setupRestButton', 'handleRestButtonClick', 'startRestCountdown', 'stopRestCountdown', 'resetRestButton', 'clearPendingRestReset',
  'setupRepsButton', 'handleRepsButtonToggle', 'closeOtherRepsTooltips', 'scheduleRepsAutoClose', 'cancelRepsAutoClose',
  'setupMethodButton', 'handleMethodButtonToggle', 'closeOtherMethodTooltips', 'scheduleMethodAutoClose', 'cancelMethodAutoClose', 'setupMethodOutsideClickHandler',
  'createCompletionButtonHTML', 'handleExerciseToggle'
];
const productionHandlers = handlerNames.map(extractFunction).join('\n\n');

function interactiveScript() {
  return `(() => {
    const results = {};
    const epoch = ${Date.parse(FIXED_NOW)};
    let now = epoch, nextTimerId = 1;
    const timers = new Map();
    const schedule = (callback, delay, every = 0) => { const id = nextTimerId++; timers.set(id, { callback, at: now + Number(delay || 0), every }); return id; };
    window.setTimeout = (callback, delay) => schedule(callback, delay);
    window.clearTimeout = id => timers.delete(Number(id));
    window.setInterval = (callback, delay) => schedule(callback, delay, Number(delay || 0));
    window.clearInterval = id => timers.delete(Number(id));
    Date.now = () => now;
    const tick = milliseconds => {
      const target = now + milliseconds;
      while (true) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        const [id, timer] = due;
        now = timer.at;
        if (timer.every > 0) timer.at += timer.every; else timers.delete(id);
        timer.callback();
      }
      now = target;
    };
    const vibrationCalls = [];
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: pattern => { vibrationCalls.push(pattern); return true; } });
    const APP_STATE = { currentWeekNumber: 1, currentDay: 'A', highestUnlockedWeek: 1, highestUnlockedDayIndex: 0, completionStatus: {}, allCompletions: {}, seriesTracker: {} };
    const REST_COUNTDOWNS = new Map(), REPS_TOOLTIP_TIMEOUTS = new Map(), METHOD_TOOLTIP_TIMEOUTS = new Map();
    let repsOutsideClickBound = false, methodOutsideClickBound = false, pastWorkout = false, fallbackRenders = 0, globalUpdates = 0, storageWrites = 0;
    const DOM_ELEMENTS = { workoutDetails: document.querySelector('#workout-details') };
    function saveApplicationState() { storageWrites += 1; window.__HARNESS_STORAGE__.setItem('workout-state', JSON.stringify(APP_STATE)); }
    function isPastWorkoutCheck() { return pastWorkout; }
    function renderWorkoutDetails() { fallbackRenders += 1; }
    function getPhaseDataByWeek() { return { schedule: { A: 'A' }, workouts: { A: { exercises: [{}] } } }; }
    function updateWorkoutButton(done) { globalUpdates += done ? 1 : 0; }
    ${productionHandlers}
    const card = document.querySelector('.workout-card');
    const method = card.querySelector('[data-method-badge]');
    const series = card.querySelector('[data-stat-type="series"]');
    const reps = card.querySelector('[data-stat-type="reps"]');
    const rest = card.querySelector('[data-stat-type="rest"]');
    setupSeriesButton(series, 0);
    setupRepsButton(reps);
    setupRestButton(rest, 0);
    setupMethodButton(method);
    let modalUrl = null;
    function openExerciseImageModal(url) { modalUrl = url; }
    card.addEventListener('click', event => {
      const isCompletionButton = event.target.closest('.completion-toggle-wrapper');
      if (!isCompletionButton) { stopEvent(event); openExerciseImageModal(card.dataset.imageUrl); }
    });
    const classState = element => [...element.classList];
    const stateOf = element => ({ text: (element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim(), classes: classState(element), ariaExpanded: element.getAttribute('aria-expanded'), ariaPressed: element.getAttribute('aria-pressed') });

    series.click(); series.click();
    results.seriesActive = stateOf(series);
    series.click(); series.click();
    results.seriesComplete = stateOf(series);
    series.click();
    results.seriesWrapped = stateOf(series);

    reps.click();
    results.repsOpen = stateOf(reps);
    tick(5000);
    results.repsAutoClosed = stateOf(reps);

    method.click();
    results.methodOpen = stateOf(method);
    method.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    results.methodEscapeClosed = { ...stateOf(method), focused: document.activeElement === method };
    method.click(); tick(5000);
    results.methodAutoClosed = stateOf(method);

    rest.click(); tick(30000);
    results.restCounting = stateOf(rest);
    rest.click();
    results.restCancelled = stateOf(rest);
    rest.click(); tick(90000);
    results.restFinished = stateOf(rest);
    results.vibrationCalls = vibrationCalls;
    tick(4000);
    results.restReset = stateOf(rest);

    const beforeInternalModal = modalUrl;
    series.click();
    results.internalPropagation = { before: beforeInternalModal, after: modalUrl };
    card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    results.imageModal = modalUrl;

    let cta = card.querySelector('.completion-toggle-wrapper');
    handleExerciseToggle({ target: cta }); tick(100);
    cta = card.querySelector('.completion-toggle-wrapper');
    results.ctaCompleted = { ...stateOf(cta), cardClasses: classState(card), persisted: JSON.parse(window.__HARNESS_STORAGE__.getItem('workout-state')), storageWrites, globalUpdates };
    handleExerciseToggle({ target: cta }); tick(100);
    cta = card.querySelector('.completion-toggle-wrapper');
    results.ctaPendingAgain = { ...stateOf(cta), cardClasses: classState(card), storageWrites };
    pastWorkout = true; APP_STATE.completionStatus[0] = true;
    const writesBeforeLock = storageWrites;
    handleExerciseToggle({ target: cta }); tick(100);
    results.ctaLocked = { completed: APP_STATE.completionStatus[0], writesBeforeLock, storageWrites, text: stateOf(cta).text };
    results.fakes = { pendingTimers: timers.size, fallbackRenders, storage: window.__HARNESS_STORAGE__.getItem('workout-state') !== null, elapsedMs: now - epoch };
    document.body.dataset.interactionResults = btoa(unescape(encodeURIComponent(JSON.stringify(results))));
  })();`;
}

function runLocalInteractions() {
  if (!CHROME) throw new Error('A local Chromium executable is required by the existing baseline harness');
  const captureCase = { id: 'main-768-fine-full-chromium-pending' };
  const html = renderFixtureDocument(captureCase).replace('</body>', `<script>${interactiveScript()}</script></body>`);
  const tempPath = join(HERE, '.tmp-baseline-examples.html');
  writeFileSync(tempPath, html, 'utf8');
  try {
    const run = spawnSync(CHROME, [
      '--headless=new', '--hide-scrollbars', '--disable-background-networking', '--disable-component-update',
      '--disable-default-apps', '--disable-sync', '--metrics-recording-only', '--no-first-run',
      '--host-resolver-rules=MAP * ~NOTFOUND', '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=1000', '--window-size=768,900', '--dump-dom', pathToFileURL(tempPath).href
    ], { encoding: 'utf8', timeout: 30000, maxBuffer: 20 * 1024 * 1024 });
    const match = run.stdout.match(/data-interaction-results="([A-Za-z0-9+/=]+)"/);
    if (run.status !== 0 || !match) throw new Error(`Local interaction harness failed (${run.status}): ${run.stderr.slice(-1200)}`);
    return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
  } finally {
    rmSync(tempPath, { force: true });
  }
}

console.log('\nObservable interactions with local fakes');
let observed;
try {
  observed = runLocalInteractions();
  check('local interaction harness executed', true);
} catch (error) {
  check('local interaction harness executed', false, error.stack || error.message);
}
if (observed) {
  const activeBaseline = fixture('series-active');
  const completeBaseline = fixture('series-complete');
  const repsBaseline = fixture('reps-open');
  const methodBaseline = fixture('method-open');
  const countingBaseline = fixture('rest-counting');
  const finishedBaseline = fixture('rest-finished');
  const completedBaseline = fixture('completed');

  check('Series click cycle reaches frozen active result', observed.seriesActive.text.includes(activeBaseline.copyAndData.values[0])
    && observed.seriesActive.classes.includes('is-active') && observed.seriesActive.ariaPressed === 'true');
  check('Series click cycle reaches frozen complete result and non-color helper', observed.seriesComplete.text.includes(completeBaseline.copyAndData.values[0])
    && observed.seriesComplete.classes.includes('is-complete') && /Séries completas/i.test(observed.seriesComplete.text));
  check('Series wraparound restores idle result', /0\/4/.test(observed.seriesWrapped.text)
    && !observed.seriesWrapped.classes.includes('is-active') && !observed.seriesWrapped.classes.includes('is-complete')
    && observed.seriesWrapped.ariaPressed === 'false');

  check('Reps click reaches frozen open overlay result', observed.repsOpen.classes.includes('is-open')
    && observed.repsOpen.ariaExpanded === repsBaseline.copyAndData.interactive.reps['aria-expanded']);
  check('Reps fake timeout closes immediately without real wait', !observed.repsAutoClosed.classes.includes('is-open')
    && observed.repsAutoClosed.ariaExpanded === 'false');
  check('Method click reaches frozen open overlay result', observed.methodOpen.classes.includes('is-open')
    && observed.methodOpen.ariaExpanded === methodBaseline.copyAndData.interactive.method['aria-expanded']);
  check('Method Escape closes and restores focus', !observed.methodEscapeClosed.classes.includes('is-open')
    && observed.methodEscapeClosed.ariaExpanded === 'false' && observed.methodEscapeClosed.focused);
  check('Method fake timeout closes immediately without real wait', !observed.methodAutoClosed.classes.includes('is-open')
    && observed.methodAutoClosed.ariaExpanded === 'false');

  check('Rest fake clock reaches frozen counting result', observed.restCounting.text.includes(countingBaseline.copyAndData.values[2])
    && observed.restCounting.classes.includes('is-counting') && observed.restCounting.ariaPressed === 'true');
  check('Rest cancellation restores idle copy and ARIA', observed.restCancelled.text.includes(pending.copyAndData.values[2])
    && /Toque para iniciar/i.test(observed.restCancelled.text) && observed.restCancelled.ariaPressed === 'false');
  check('Rest completion reaches frozen ready result with text signal', observed.restFinished.text.includes(finishedBaseline.copyAndData.values[2])
    && observed.restFinished.classes.includes('finished') && /Respire e retome/i.test(observed.restFinished.text));
  same('Rest completion uses only fake vibration', observed.vibrationCalls, [[100, 60, 100]]);
  check('Rest fake reset timeout restores baseline idle result', observed.restReset.text.includes(pending.copyAndData.values[2])
    && !observed.restReset.classes.includes('finished'));

  check('internal controls stop card-level modal propagation', observed.internalPropagation.before === observed.internalPropagation.after);
  same('card/image click preserves observable modal target', observed.imageModal, 'src/imagens/Elevação Pélvica com Barra.webp');
  check('CTA transition reaches frozen completed copy/check/card result', observed.ctaCompleted.text === completedBaseline.copyAndData.cta
    && observed.ctaCompleted.classes.includes('completion-toggle-wrapper')
    && observed.ctaCompleted.cardClasses.includes('exercise-completed')
    && observed.ctaCompleted.persisted.completionStatus['0'] === true
    && observed.ctaCompleted.globalUpdates === 1);
  check('second CTA transition restores pending baseline', observed.ctaPendingAgain.text === pending.copyAndData.cta
    && !observed.ctaPendingAgain.cardClasses.includes('exercise-completed'));
  check('locked completed workout is immutable and does not persist', observed.ctaLocked.completed === true
    && observed.ctaLocked.storageWrites === observed.ctaLocked.writesBeforeLock);
  check('all async effects used isolated fakes with no pending work', observed.fakes.pendingTimers === 0
    && observed.fakes.fallbackRenders === 0 && observed.fakes.storage && observed.fakes.elapsedMs > 120000);
}

check('production card listener still guards CTA while opening local exercise media',
  /const isCompletionButton = event\.target\.closest\('\.completion-toggle-wrapper'\);[\s\S]{0,160}openExerciseImageModal\(imageUrl\)/.test(source));
console.log(failures ? `\n${failures} of ${checks} checks failed` : `\nAll ${checks} targeted baseline regression checks passed`);
process.exit(failures ? 1 : 0);
