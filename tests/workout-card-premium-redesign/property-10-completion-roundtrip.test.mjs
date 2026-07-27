// Feature: workout-card-premium-redesign, Property 10: Round-trip de conclusão
// **Validates: Requirements 6.9, 6.10, 9.6, 9.7, 9.11, 9.12**
// Usage: node tests/workout-card-premium-redesign/property-10-completion-roundtrip.test.mjs
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BREAKPOINT_WIDTHS, INDEX_PATH, renderFixtureDocument } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAILURE_PATH = join(HERE, '.property-10-completion-roundtrip.failure.json');
const TEMP_PATH = join(HERE, '.tmp-property-10-completion-roundtrip.html');
const FEATURE = 'workout-card-premium-redesign';
const PROPERTY = 'Property 10: Round-trip de conclusão';
const DEFAULT_SEED = 0x48465010;
const UNLOCKED_COUNT = 120;
const LOCKED_COUNT = 40;
const requestedSeed = process.env.HF_PBT_SEED ?? process.env.HF_PROPERTY_SEED;
const parsedSeed = requestedSeed === undefined ? DEFAULT_SEED : Number(requestedSeed);
const SEED = Number.isFinite(parsedSeed) ? parsedSeed >>> 0 : DEFAULT_SEED;
const CHROME = [
  process.env.HF_CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
].filter(Boolean).find(existsSync);
const source = readFileSync(INDEX_PATH, 'utf8');

function extractFunction(name) {
  const marker = `    function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Production function not found: ${name}`);
  const tail = source.slice(start + marker.length);
  const next = tail.search(/^    (?:async )?function\s+/m);
  return source.slice(start, next < 0 ? source.length : start + marker.length + next).trim();
}

const PRODUCTION_FUNCTIONS = ['getCompletionKey', 'isPastWorkoutCheck',
  'createCompletionButtonHTML', 'handleExerciseToggle'].map(extractFunction).join('\n\n');
function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ mixed >>> 15, mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ mixed >>> 7, mixed | 61);
    return ((mixed ^ mixed >>> 14) >>> 0) / 4294967296;
  };
}
const random = mulberry32(SEED);
const pick = values => values[Math.floor(random() * values.length)];
const integer = (minimum, maximum) => minimum + Math.floor(random() * (maximum - minimum + 1));

function completionState(exerciseIndex, completed) {
  const state = {};
  const otherCount = integer(0, 4);
  while (Object.keys(state).length < otherCount) {
    const index = integer(0, 11);
    if (index !== exerciseIndex) state[index] = random() < 0.5;
  }
  state[exerciseIndex] = completed;
  return state;
}

const unlockedCases = Array.from({ length:UNLOCKED_COUNT }, (_, ordinal) => {
  const exerciseIndex = integer(0, 11);
  const completed = ordinal % 2 === 1;
  return {
    kind:'unlocked', ordinal, exerciseIndex, completed,
    width:pick(BREAKPOINT_WIDTHS), context:random() < 0.5 ? 'main' : 'week-sheet',
    pointer:random() < 0.35 ? 'coarse' : 'fine', capability:pick(['chromium', 'webkit', 'basic']),
    completionStatus:completionState(exerciseIndex, completed)
  };
});
const lockedCases = Array.from({ length:LOCKED_COUNT }, (_, ordinal) => {
  const exerciseIndex = integer(0, 11);
  return {
    kind:'locked', ordinal, exerciseIndex, completed:true,
    width:pick(BREAKPOINT_WIDTHS), context:random() < 0.5 ? 'main' : 'week-sheet',
    pointer:random() < 0.5 ? 'coarse' : 'fine', capability:pick(['chromium', 'webkit', 'basic']),
    completionStatus:completionState(exerciseIndex, true)
  };
});
const cases = [...unlockedCases, ...lockedCases].map((testCase, caseIndex) => ({ ...testCase, caseIndex }));

function extractHead(document) {
  const match = document.match(/<head>([\s\S]*?)<\/head>/i);
  if (!match) throw new Error('Harness document has no head');
  return match[1];
}
function extractCard(document) {
  const match = document.match(/<article class="workout-card[\s\S]*?<\/article>/i);
  if (!match) throw new Error('Harness document has no workout card');
  return match[0];
}
const baseConfig = { id:'property-10-template', width:768, context:'main', pointer:'fine', motion:'reduced', capability:'chromium' };
const pendingDocument = renderFixtureDocument({ ...baseConfig, state:'pending' });
const completedDocument = renderFixtureDocument({ ...baseConfig, state:'completed' });
const lockedDocument = renderFixtureDocument({ ...baseConfig, state:'locked' });
const CARD_TEMPLATES = {
  pending:extractCard(pendingDocument), completed:extractCard(completedDocument), locked:extractCard(lockedDocument)
};

function cardMarkup(testCase) {
  const state = testCase.kind === 'locked' ? 'locked' : testCase.completed ? 'completed' : 'pending';
  return CARD_TEMPLATES[state].replace('data-index="0"', `data-index="${testCase.exerciseIndex}"`);
}
function caseMarkup(testCase) {
  const card = cardMarkup(testCase);
  const details = `<div id="workout-details">${card}</div>`;
  const content = testCase.context === 'week-sheet'
    ? `<div class="hf-week-sheet__panel"><div class="hf-week-sheet__body">${details}</div></div>`
    : `<main class="harness-main">${details}</main>`;
  return `<section class="property-case" data-property-index="${testCase.caseIndex}" style="width:min(100%,560px)">${content}</section>`;
}
function browserScript() {
  return `(() => {
    const generatedCases = ${JSON.stringify(cases)};
    const productionSource = ${JSON.stringify(PRODUCTION_FUNCTIONS)};
    let now = 1739188800000, nextTimerId = 1, storageWrites = 0;
    const timers = new Map(), storage = new Map();
    const schedule = (callback, delay) => {
      const id = nextTimerId++;
      timers.set(id, { callback, at:now + Number(delay || 0) });
      return id;
    };
    window.setTimeout = (callback, delay) => schedule(callback, delay);
    window.clearTimeout = id => timers.delete(Number(id));
    Date.now = () => now;
    const tick = milliseconds => {
      const target = now + milliseconds;
      while (true) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target)
          .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
        if (!due) break;
        const [id, timer] = due;
        timers.delete(id);
        now = timer.at;
        timer.callback();
      }
      now = target;
    };
    const clone = value => JSON.parse(JSON.stringify(value));
    const stable = value => JSON.stringify(value);
    const text = element => (element?.textContent || '').replace(/\\s+/g, ' ').trim();
    const requireElement = (root, selector) => {
      const element = root.querySelector(selector);
      if (!element) throw new Error('Missing completion element: ' + selector);
      return element;
    };
    const APP_STATE = {
      currentWeekNumber:1, currentDay:'A', highestUnlockedWeek:1, highestUnlockedDayIndex:0,
      completionStatus:{}, allCompletions:{}
    };
    const DOM_ELEMENTS = { workoutDetails:null };
    let updateCalls = [], fallbackRenders = 0;
    function getPhaseDataByWeek() {
      return { schedule:{ A:'A', B:'B' }, workouts:{ A:{ exercises:Array.from({ length:12 }, (_, index) => ({ index })) } } };
    }
    function saveApplicationState() {
      storageWrites += 1;
      storage.set('workout-state', JSON.stringify({
        completionStatus:APP_STATE.completionStatus, allCompletions:APP_STATE.allCompletions
      }));
    }
    function updateWorkoutButton(value) { updateCalls.push(Boolean(value)); }
    function renderWorkoutDetails() { fallbackRenders += 1; }
    eval(productionSource);

    const material = button => {
      const computed = getComputedStyle(button);
      const before = getComputedStyle(button, '::before');
      const after = getComputedStyle(button, '::after');
      const edge = button.querySelector('.liquid-glass-edge');
      return {
        classes:[...button.classList], backgroundColor:computed.backgroundColor,
        backgroundImage:computed.backgroundImage, opacity:computed.opacity,
        backdropFilter:computed.backdropFilter, webkitBackdropFilter:computed.webkitBackdropFilter,
        boxShadow:computed.boxShadow, borderColor:computed.borderColor,
        edgeCount:button.querySelectorAll(':scope > .liquid-glass-edge').length,
        edgeAriaHidden:edge?.getAttribute('aria-hidden') ?? null,
        before:{ content:before.content, display:before.display },
        after:{ content:after.content, display:after.display }
      };
    };
    const functional = container => {
      const card = requireElement(container, '.workout-card');
      const button = requireElement(card, '.completion-toggle-wrapper');
      return {
        completed:Boolean(APP_STATE.completionStatus[button.dataset.index]),
        ownPersistedValue:APP_STATE.completionStatus[button.dataset.index],
        cardCompleted:card.classList.contains('exercise-completed'),
        cardBorderStyle:card.style.borderColor,
        buttonIndex:button.dataset.index,
        checkCompleted:requireElement(button, '.animated-check-container').classList.contains('completed')
      };
    };
    const copy = container => {
      const button = requireElement(container, '.completion-toggle-wrapper');
      return { buttonText:text(button), cardText:text(requireElement(container, '.workout-card')) };
    };
    const persistence = () => {
      const raw = storage.get('workout-state');
      return raw ? JSON.parse(raw) : null;
    };
    const snapshot = container => ({
      functional:functional(container), copy:copy(container),
      material:material(requireElement(container, '.completion-toggle-wrapper')),
      persistence:persistence()
    });
    const assert = (condition, assertion, observed) => {
      if (!condition) {
        const error = new Error(assertion);
        error.assertion = assertion;
        error.observed = observed;
        throw error;
      }
    };
    const assertStateMaterial = (snapshotValue, completed, label) => {
      const value = snapshotValue.material;
      assert(snapshotValue.functional.completed === completed
        && snapshotValue.functional.cardCompleted === completed
        && snapshotValue.functional.checkCompleted === completed,
      label + ' functional completion signals must agree', snapshotValue.functional);
      assert(snapshotValue.copy.buttonText === (completed ? 'Concluído!' : 'Marcar como Concluído'),
        label + ' must preserve the current CTA copy', snapshotValue.copy);
      assert(value.classes.includes('player-glass-btn') === !completed,
        label + ' must select the material class for the current state', value);
      assert(value.edgeCount === (completed ? 0 : 1),
        label + ' must select the decorative rim exclusively by state', value);
      if (completed) {
        assert(value.backgroundColor === 'rgb(57, 255, 20)'
          && value.backdropFilter === 'none'
          && (!value.webkitBackdropFilter || value.webkitBackdropFilter === 'none' || value.webkitBackdropFilter === value.backdropFilter)
          && value.before.content === 'none' && value.after.content === 'none',
        label + ' completed material must remain settled solid green only', value);
      } else {
        assert(value.edgeAriaHidden === 'true',
          label + ' pending glass edge must remain inert decoration', value);
      }
    };
    const runCase = testCase => {
      const container = requireElement(document, '.property-case[data-property-index="' + testCase.caseIndex + '"]');
      APP_STATE.currentWeekNumber = 1;
      APP_STATE.currentDay = 'A';
      APP_STATE.highestUnlockedWeek = testCase.kind === 'locked' ? 2 : 1;
      APP_STATE.highestUnlockedDayIndex = 0;
      APP_STATE.completionStatus = clone(testCase.completionStatus);
      APP_STATE.allCompletions = {
        history:{ 0:true, 3:false },
        'week1-A':APP_STATE.completionStatus
      };
      storageWrites = 0;
      updateCalls = [];
      fallbackRenders = 0;
      timers.clear();
      storage.clear();
      storage.set('workout-state', JSON.stringify({
        completionStatus:APP_STATE.completionStatus, allCompletions:APP_STATE.allCompletions
      }));
      const card = requireElement(container, '.workout-card');
      card.style.borderColor = testCase.completed ? 'rgba(166, 227, 161, 0.6)' : 'var(--surface-0)';
      const workoutDetails = requireElement(container, '#workout-details');
      DOM_ELEMENTS.workoutDetails = workoutDetails;
      workoutDetails.addEventListener('click', handleExerciseToggle);
      const initial = snapshot(container);
      assertStateMaterial(initial, testCase.completed, 'initial');

      if (testCase.kind === 'locked') {
        requireElement(workoutDetails, '.completion-toggle-wrapper').click();
        requireElement(workoutDetails, '.completion-toggle-wrapper').click();
        tick(500);
        const final = snapshot(container);
        assert(stable(final) === stable(initial),
          'completed locked past workout attempts must change no state, text, material, or persistence',
          { initial, final });
        assert(storageWrites === 0 && updateCalls.length === 0 && fallbackRenders === 0 && timers.size === 0,
          'locked attempts must schedule, persist, update, and render nothing',
          { storageWrites, updateCalls, fallbackRenders, pendingTimers:timers.size });
      } else {
        const workoutDetails = requireElement(container, '#workout-details');
        requireElement(workoutDetails, '.completion-toggle-wrapper').click();
        tick(100);
        const intermediate = snapshot(container);
        assertStateMaterial(intermediate, !testCase.completed, 'first settled toggle');
        assert(stable(intermediate.persistence.completionStatus)
          === stable(intermediate.persistence.allCompletions['week1-A']),
        'first toggle must persist the active completion state under its workout key', intermediate.persistence);

        requireElement(workoutDetails, '.completion-toggle-wrapper').click();
        tick(100);
        const final = snapshot(container);
        assertStateMaterial(final, testCase.completed, 'second settled toggle');
        assert(stable(final.functional) === stable(initial.functional),
          'two toggles must restore the exact functional state', { initial:initial.functional, final:final.functional });
        assert(stable(final.copy) === stable(initial.copy),
          'two toggles must restore the exact CTA/card text', { initial:initial.copy, final:final.copy });
        assert(stable(final.material) === stable(initial.material),
          'two settled toggles must restore the exact material snapshot', { initial:initial.material, final:final.material });
        assert(stable(final.persistence) === stable(initial.persistence),
          'two toggles must restore the exact persisted completion payload',
          { initial:initial.persistence, final:final.persistence });
        assert(storageWrites === 2 && updateCalls.length === 2 && fallbackRenders === 0 && timers.size === 0,
          'unlocked round-trip must persist and settle exactly once per toggle without fallback work',
          { storageWrites, updateCalls, fallbackRenders, pendingTimers:timers.size });
      }
      workoutDetails.removeEventListener('click', handleExerciseToggle);
      return { ok:true, caseIndex:testCase.caseIndex, kind:testCase.kind };
    };

    const results = generatedCases.map(testCase => {
      try { return runCase(testCase); }
      catch (error) {
        return { ok:false, caseIndex:testCase.caseIndex, kind:testCase.kind,
          assertion:error.assertion || error.message, observed:error.observed || null,
          stack:error.stack || error.message };
      }
    });
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(results))));
    document.body.dataset.propertyResults = encoded;
    document.body.dataset.propertyHarnessState = 'complete';
  })();`;
}
function propertyDocument() {
  const markup = cases.map(caseMarkup).join('\n');
  return `<!doctype html><html lang="pt-BR"><head>${extractHead(pendingDocument)}
    <style>
      body{display:block!important;padding:20px!important}.property-case{margin:0 auto 24px}
      .property-case .harness-main,.property-case #workout-details{width:100%}
      .property-case .hf-week-sheet__panel{position:relative!important;transform:none!important;width:100%!important}
    </style></head><body>${markup}<script>${browserScript()}</script></body></html>`;
}

function assertInvariant(condition, assertion, observed) {
  if (!condition) {
    const error = new Error(assertion);
    error.assertion = assertion;
    error.observed = observed;
    throw error;
  }
}

function assertGenerationAndSourceContracts() {
  assertInvariant(unlockedCases.length >= 100,
    'property must generate at least 100 seeded unlocked initial states', unlockedCases.length);
  assertInvariant(unlockedCases.filter(item => item.completed).length === UNLOCKED_COUNT / 2
    && unlockedCases.filter(item => !item.completed).length === UNLOCKED_COUNT / 2,
  'unlocked generator must cover pending and completed initial states equally', {
    pending:unlockedCases.filter(item => !item.completed).length,
    completed:unlockedCases.filter(item => item.completed).length
  });
  assertInvariant(lockedCases.every(item => item.completed),
    'every generated locked past-workout case must start completed', lockedCases);
  const contracts = [
    ['locked completed guard', /if\s*\(isPastWorkout\s*&&\s*APP_STATE\.completionStatus\[index\]\)\s*return/],
    ['functional toggle', /APP_STATE\.completionStatus\[index\]\s*=\s*!wasCompleted/],
    ['workout-key persistence', /APP_STATE\.allCompletions\[key\]\s*=\s*APP_STATE\.completionStatus/],
    ['state persistence call', /APP_STATE\.allCompletions\[key\][\s\S]{0,100}saveApplicationState\(\)/],
    ['settled 100ms replacement', /setTimeout\(\(\)\s*=>\s*\{[\s\S]{0,1800}replaceWith\(newToggle\)[\s\S]{0,800}\},\s*100\)/],
    ['delegated workout listener', /\[DOM_ELEMENTS\.workoutDetails,\s*['"]click['"],\s*handleExerciseToggle\]/],
    ['pending canonical material', /completion-toggle-wrapper[^`]+\$\{isCompleted\s*\?\s*''\s*:\s*'player-glass-btn'\}/],
    ['completed omits glass edge', /\$\{isCompleted\s*\?\s*''\s*:\s*'<span class="liquid-glass-edge" aria-hidden="true"><\/span>'\}/]
  ];
  const missing = contracts.filter(([, pattern]) => !pattern.test(source)).map(([name]) => name);
  assertInvariant(missing.length === 0,
    'real source must retain completion toggle, lock, persistence, replacement, and material contracts', { missing });
}

function runBrowser() {
  writeFileSync(TEMP_PATH, propertyDocument(), 'utf8');
  const profilePath = `${TEMP_PATH}.chrome-${process.pid}`;
  rmSync(profilePath, { recursive:true, force:true });
  try {
    const result = spawnSync(CHROME, [
      '--headless=new', '--hide-scrollbars', '--disable-background-networking', '--disable-extensions',
      '--disable-component-update', '--disable-default-apps', '--disable-sync', '--metrics-recording-only',
      '--no-first-run', '--host-resolver-rules=MAP * ~NOTFOUND', `--user-data-dir=${profilePath}`,
      '--window-size=768,900', '--dump-dom', pathToFileURL(TEMP_PATH).href
    ], { encoding:'utf8', timeout:30_000, maxBuffer:32 * 1024 * 1024 });
    const stdout = result.stdout || '';
    const state = stdout.match(/data-property-harness-state="([^"]+)"/)?.[1];
    const payload = stdout.match(/data-property-results="([A-Za-z0-9+/=]+)"/)?.[1];
    assertInvariant(result.status === 0 && state === 'complete' && payload,
      'Chromium completion harness must return a conclusive payload', {
        status:result.status, signal:result.signal || null, state:state || 'missing',
        spawnError:result.error?.message || null, stderr:(result.stderr || '').slice(-1600)
      });
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } finally {
    rmSync(profilePath, { recursive:true, force:true });
    rmSync(TEMP_PATH, { force:true });
  }
}
function persistFailure(testCase, error) {
  const record = {
    feature:FEATURE, property:PROPERTY, seed:SEED,
    seedHex:`0x${SEED.toString(16).padStart(8, '0')}`,
    unlockedCases:UNLOCKED_COUNT, lockedCases:LOCKED_COUNT, totalCases:cases.length,
    counterexample:testCase, assertion:error.assertion || error.message,
    observed:error.observed || null,
    replay:`HF_PBT_SEED=${SEED} node tests/workout-card-premium-redesign/property-10-completion-roundtrip.test.mjs`
  };
  writeFileSync(FAILURE_PATH, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  console.error(`COUNTEREXAMPLE ${JSON.stringify(record)}`);
}

let activeCase = { kind:'generation-and-source-contract' };
try {
  if (!CHROME) throw new Error('A local Chromium executable is required by the existing property harness');
  assertGenerationAndSourceContracts();
  const results = runBrowser();
  assertInvariant(results.length === cases.length,
    'browser harness must return exactly one result per generated case',
    { expected:cases.length, actual:results.length });
  for (const result of results) {
    activeCase = cases[result.caseIndex] ?? { kind:'unknown-browser-case', result };
    assertInvariant(result.ok, result.assertion || 'browser completion property failed',
      { browser:result.observed, stack:result.stack });
  }
  rmSync(FAILURE_PATH, { force:true });
  console.log(`PASS - Feature: ${FEATURE}, ${PROPERTY}`);
  console.log(`Seed: ${SEED} (0x${SEED.toString(16).padStart(8, '0')}); unlocked: ${UNLOCKED_COUNT}; locked: ${LOCKED_COUNT}; total: ${cases.length}`);
  console.log('Fake clock: 100ms settled replacement per toggle; fake persistence: local in-memory workout-state; counterexample: none');
} catch (error) {
  persistFailure(activeCase, error);
  process.exitCode = 1;
} finally {
  rmSync(TEMP_PATH, { force:true });
}
