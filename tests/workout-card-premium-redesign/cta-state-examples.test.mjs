// Targeted CTA state/lock examples for workout-card premium redesign task 13.2.
// Usage: node tests/workout-card-premium-redesign/cta-state-examples.test.mjs
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FIXED_NOW, INDEX_PATH, PLAYER_CSS_PATH, renderFixtureDocument } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(INDEX_PATH, 'utf8');
const playerCss = readFileSync(PLAYER_CSS_PATH, 'utf8');
const CHROME = [process.env.HF_CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium'
].filter(Boolean).find(existsSync);
const ENVIRONMENTS = Object.freeze([
  { id: 'chromium', width: 769, pointer: 'fine', capability: 'chromium', branch: 'chromium' },
  { id: 'webkit', width: 769, pointer: 'fine', capability: 'webkit', branch: 'webkit' },
  { id: 'basic', width: 769, pointer: 'fine', capability: 'basic', branch: 'basic' },
  { id: 'mobile', width: 639, pointer: 'fine', capability: 'chromium', branch: 'chromium-soft', hideRim: true },
  { id: 'coarse', width: 769, pointer: 'coarse', capability: 'chromium', branch: 'chromium', hideRim: true }
]);
let checks = 0;
let failures = 0;
function check(name, condition, detail = '') {
  checks += 1;
  if (!condition) failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'} - ${name}${condition || !detail ? '' : `: ${detail}`}`);
}
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const noFilter = value => value === '' || value === 'none' || value === undefined;

function balancedBlock(css, marker, from = 0) {
  const markerIndex = css.indexOf(marker, from);
  if (markerIndex < 0) throw new Error(`CSS marker not found: ${marker}`);
  const open = css.indexOf('{', markerIndex + marker.length);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    else if (css[index] === '}' && --depth === 0) return css.slice(open + 1, index);
  }
  throw new Error(`Unterminated CSS block: ${marker}`);
}
function declarations(block) {
  const result = {};
  for (const entry of block.split(';')) {
    const colon = entry.indexOf(':');
    if (colon > 0) result[entry.slice(0, colon).trim()] = entry.slice(colon + 1).trim().replace(/\s+/g, ' ');
  }
  return result;
}
function canonicalManifest() {
  const start = playerCss.indexOf('/* ===== Liquid Glass — material reutilizável');
  const end = playerCss.indexOf('/* Player Modal e Screens */', start);
  const canonical = playerCss.slice(start, end);
  const support = balancedBlock(canonical,
    '@supports (backdrop-filter: url(#liquid-glass-refract)) and (background: paint(liquid-glass-probe))');
  const soft = balancedBlock(support, '@media (max-width: 768px)');
  return {
    base: declarations(balancedBlock(canonical, '.liquid-glass,')),
    neutral: declarations(balancedBlock(canonical, '.player-glass-btn {')),
    chromium: declarations(balancedBlock(support, '.liquid-glass,')),
    chromiumNeutral: declarations(balancedBlock(support, '.player-glass-btn {')),
    soft: declarations(balancedBlock(soft, '.liquid-glass,'))
  };
}
const manifest = canonicalManifest();
function extractFunction(name) {
  const marker = `    function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Production function not found: ${name}`);
  const tail = source.slice(start + marker.length);
  const next = tail.search(/^    (?:async )?function\s+/m);
  return source.slice(start, next < 0 ? source.length : start + marker.length + next).trim();
}
const PRODUCTION = ['getCompletionKey', 'createCompletionButtonHTML', 'handleExerciseToggle']
  .map(extractFunction).join('\n\n');

function branchCss(environment) {
  const rules = [];
  if (environment.branch === 'webkit') {
    rules.push(`.player-glass-btn{background:${manifest.neutral.background}!important;backdrop-filter:${manifest.base['backdrop-filter']}!important;-webkit-backdrop-filter:${manifest.base['-webkit-backdrop-filter']}!important}`);
  }
  if (environment.branch === 'basic') {
    rules.push(`.player-glass-btn{background:${manifest.neutral.background}!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}`);
    rules.push(`.liquid-glass-edge{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}`);
  }
  if (environment.pointer === 'coarse') {
    rules.push('.workout-card .liquid-glass-edge{display:none!important}');
  }
  return rules.join('\n');
}

function interactionScript(environment) {
  return `(() => {
    const environment = ${JSON.stringify(environment)};
    const epoch = ${Date.parse(FIXED_NOW)};
    let now = epoch, nextTimerId = 1, storageWrites = 0, fallbackRenders = 0;
    let pastWorkout = false;
    const timers = new Map(), globalUpdates = [];
    const schedule = (callback, delay) => {
      const id = nextTimerId++;
      timers.set(id, { callback, at: now + Number(delay || 0) });
      return id;
    };
    window.setTimeout = (callback, delay) => schedule(callback, delay);
    window.clearTimeout = id => timers.delete(Number(id));
    Date.now = () => now;
    const tick = milliseconds => {
      const target = now + milliseconds;
      while (true) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        const [id, timer] = due;
        timers.delete(id);
        now = timer.at;
        timer.callback();
      }
      now = target;
    };
    const APP_STATE = {
      currentWeekNumber: 1, currentDay: 'A', highestUnlockedWeek: 1,
      completionStatus: {}, allCompletions: {}
    };
    const DOM_ELEMENTS = { workoutDetails: document.querySelector('#workout-details') };
    function isPastWorkoutCheck() { return pastWorkout; }
    function saveApplicationState() {
      storageWrites += 1;
      window.__HARNESS_STORAGE__.setItem('workout-state', JSON.stringify(APP_STATE));
    }
    function renderWorkoutDetails() { fallbackRenders += 1; }
    function getPhaseDataByWeek() {
      return { schedule: { A: 'A' }, workouts: { A: { exercises: [{}] } } };
    }
    function updateWorkoutButton(allDone) { globalUpdates.push(allDone); }
    ${PRODUCTION}
    const probe = document.createElement('button');
    probe.id = 'canonical-cta-probe';
    probe.className = 'player-glass-btn';
    probe.style.cssText = 'position:absolute;left:-10000px;top:0;width:220px;height:52px;border-radius:9999px';
    probe.innerHTML = '<span class="liquid-glass-edge" aria-hidden="true"></span><span>Probe</span>';
    document.body.append(probe);

    const style = (element, pseudo = null) => {
      if (!element) return null;
      const value = getComputedStyle(element, pseudo);
      return {
        backgroundColor: value.backgroundColor, backgroundImage: value.backgroundImage,
        backdropFilter: value.backdropFilter, webkitBackdropFilter: value.webkitBackdropFilter,
        filter: value.filter, boxShadow: value.boxShadow, opacity: value.opacity,
        content: value.content, display: value.display, mixBlendMode: value.mixBlendMode,
        pointerEvents: value.pointerEvents, zIndex: value.zIndex, color: value.color,
        stroke: value.stroke, fill: value.fill
      };
    };
    const text = element => (element?.textContent || '').replace(/\\s+/g, ' ').trim();
    const snapshot = button => {
      const edge = button.querySelector(':scope > .liquid-glass-edge');
      return {
        tag: button.tagName.toLowerCase(), dataIndex: button.dataset.index,
        copy: text(button), classes: [...button.classList], html: button.outerHTML,
        edgeCount: button.querySelectorAll(':scope > .liquid-glass-edge').length,
        edgeAria: edge?.getAttribute('aria-hidden') ?? null,
        edge: edge ? style(edge) : null,
        surface: style(button), before: style(button, '::before'), after: style(button, '::after'),
        checkCompleted: button.querySelector('.animated-check-container')?.classList.contains('completed') || false,
        svgCount: button.querySelectorAll('.animated-check-svg').length,
        circle: style(button.querySelector('.animated-check-circle')),
        path: style(button.querySelector('.animated-check-path')),
        textStyle: style(button.querySelector(':scope > span:not(.liquid-glass-edge)'))
      };
    };
    const reference = snapshot(probe);
    const card = document.querySelector('.workout-card');
    DOM_ELEMENTS.workoutDetails.addEventListener('click', handleExerciseToggle);
    let cta = card.querySelector('.completion-toggle-wrapper');
    const firstNode = cta;
    const results = { environment, reference, initial: snapshot(cta) };

    cta.click();
    results.firstImmediate = { state: APP_STATE.completionStatus[0], writes: storageWrites,
      persisted: JSON.parse(window.__HARNESS_STORAGE__.getItem('workout-state')), sameNode: card.querySelector('.completion-toggle-wrapper') === firstNode,
      cardCompleted: card.classList.contains('exercise-completed'), cta: snapshot(firstNode), timerCount: timers.size };
    tick(99);
    results.firstAt99 = { sameNode: card.querySelector('.completion-toggle-wrapper') === firstNode,
      cardCompleted: card.classList.contains('exercise-completed'), fallbackRenders, cta: snapshot(firstNode) };
    tick(1);
    cta = card.querySelector('.completion-toggle-wrapper');
    results.firstAt100 = { sameNode: cta === firstNode, cardCompleted: card.classList.contains('exercise-completed'),
      state: APP_STATE.completionStatus[0], writes: storageWrites, globalUpdates: [...globalUpdates], cta: snapshot(cta) };

    const completedNode = cta;
    cta.click();
    results.secondImmediate = { state: APP_STATE.completionStatus[0], writes: storageWrites,
      sameNode: card.querySelector('.completion-toggle-wrapper') === completedNode,
      cardCompleted: card.classList.contains('exercise-completed'), cta: snapshot(completedNode) };
    tick(99);
    results.secondAt99 = { sameNode: card.querySelector('.completion-toggle-wrapper') === completedNode,
      cardCompleted: card.classList.contains('exercise-completed'), cta: snapshot(completedNode) };
    tick(1);
    cta = card.querySelector('.completion-toggle-wrapper');
    results.secondAt100 = { sameNode: cta === completedNode, cardCompleted: card.classList.contains('exercise-completed'),
      state: APP_STATE.completionStatus[0], writes: storageWrites, globalUpdates: [...globalUpdates], cta: snapshot(cta) };

    cta.click();
    const fallbackNode = cta;
    fallbackNode.remove();
    tick(99);
    results.fallbackAt99 = { fallbackRenders, state: APP_STATE.completionStatus[0], writes: storageWrites };
    tick(1);
    results.fallbackAt100 = { fallbackRenders, state: APP_STATE.completionStatus[0], writes: storageWrites,
      persisted: JSON.parse(window.__HARNESS_STORAGE__.getItem('workout-state')), globalUpdates: [...globalUpdates] };

    pastWorkout = true;
    APP_STATE.completionStatus[1] = true;
    const lockedCard = document.createElement('article');
    lockedCard.className = 'workout-card exercise-completed';
    lockedCard.innerHTML = createCompletionButtonHTML(1, true, true);
    DOM_ELEMENTS.workoutDetails.append(lockedCard);
    const locked = lockedCard.querySelector('.completion-toggle-wrapper');
    const lockedBefore = snapshot(locked);
    const lockedStateBefore = JSON.stringify(APP_STATE);
    const lockedWritesBefore = storageWrites;
    const lockedUpdatesBefore = JSON.stringify(globalUpdates);
    locked.click();
    tick(100);
    results.locked = { before: lockedBefore, after: snapshot(locked), sameNode: locked === lockedCard.querySelector('.completion-toggle-wrapper'),
      stateUnchanged: JSON.stringify(APP_STATE) === lockedStateBefore, writesBefore: lockedWritesBefore,
      writesAfter: storageWrites, updatesUnchanged: JSON.stringify(globalUpdates) === lockedUpdatesBefore,
      pendingTimers: timers.size };
    results.final = { elapsedMs: now - epoch, storageWrites, fallbackRenders, globalUpdates,
      pendingTimers: timers.size, persisted: JSON.parse(window.__HARNESS_STORAGE__.getItem('workout-state')) };
    document.body.dataset.ctaResults = btoa(unescape(encodeURIComponent(JSON.stringify(results))));
  })();`;
}
function runEnvironment(environment) {
  if (!CHROME) throw new Error('A local Chromium executable is required by the standalone harness');
  const errorCapture = `<script>window.addEventListener('error',event=>{document.body.dataset.ctaError=btoa(unescape(encodeURIComponent(event.message+' @ '+event.filename+':'+event.lineno+':'+event.colno)))})</script>`;
  const html = renderFixtureDocument({ ...environment, id: `cta-${environment.id}`, state: 'pending' })
    .replace('</head>', `<style>${branchCss(environment)}</style></head>`)
    .replace('</body>', `${errorCapture}<script>${interactionScript(environment)}</script></body>`);
  const tempPath = join(HERE, `.tmp-cta-state-${environment.id}.html`);
  writeFileSync(tempPath, html, 'utf8');
  try {
    const run = spawnSync(CHROME, [
      '--headless=new', '--hide-scrollbars', '--disable-background-networking', '--disable-component-update',
      '--disable-default-apps', '--disable-sync', '--metrics-recording-only', '--no-first-run',
      '--host-resolver-rules=MAP * ~NOTFOUND', '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=1000', `--window-size=${environment.width},1200`, '--dump-dom', pathToFileURL(tempPath).href
    ], { encoding: 'utf8', timeout: 30000, maxBuffer: 24 * 1024 * 1024 });
    const match = run.stdout.match(/data-cta-results="([A-Za-z0-9+/=]+)"/);
    if (run.status !== 0 || !match) {
      const browserError = run.stdout.match(/data-cta-error="([A-Za-z0-9+/=]+)"/);
      const detail = browserError ? Buffer.from(browserError[1], 'base64').toString('utf8') : run.stdout.slice(-1000);
      throw new Error(`${environment.id} CTA harness failed (${run.status}): ${detail}; ${run.stderr.slice(-600)}`);
    }
    return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
  } finally {
    rmSync(tempPath, { force: true });
  }
}
const pick = (record, keys) => Object.fromEntries(keys.map(key => [key, record?.[key]]));
const SURFACE_KEYS = ['backgroundColor', 'backgroundImage', 'backdropFilter', 'webkitBackdropFilter', 'boxShadow', 'opacity'];
const EDGE_KEYS = ['backdropFilter', 'webkitBackdropFilter', 'pointerEvents', 'zIndex'];
const PSEUDO_KEYS = ['content', 'backgroundImage', 'mixBlendMode', 'pointerEvents', 'zIndex'];
function parseColor(value) {
  const match = String(value).match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?/);
  return match ? { rgb: match.slice(1, 4).map(Number), alpha: match[4] === undefined ? 1 : Number(match[4]) } : null;
}
function luminance(rgb) {
  const channels = rgb.map(value => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
function contrast(foreground, background) {
  const first = parseColor(foreground)?.rgb;
  const second = parseColor(background)?.rgb;
  if (!first || !second) return 0;
  const light = Math.max(luminance(first), luminance(second));
  const dark = Math.min(luminance(first), luminance(second));
  return (light + 0.05) / (dark + 0.05);
}
function pendingEqualsReference(cta, reference, hideRim) {
  return same(pick(cta.surface, SURFACE_KEYS), pick(reference.surface, SURFACE_KEYS))
    && same(pick(cta.before, PSEUDO_KEYS), pick(reference.before, PSEUDO_KEYS))
    && same(pick(cta.after, PSEUDO_KEYS), pick(reference.after, PSEUDO_KEYS))
    && cta.edge && same(pick(cta.edge, EDGE_KEYS), pick(reference.edge, EDGE_KEYS))
    && cta.edge.display === (hideRim ? 'none' : reference.edge.display);
}
function isCompletedMaterial(cta) {
  return !cta.classes.includes('player-glass-btn') && cta.edgeCount === 0
    && cta.surface.backgroundColor === 'rgb(57, 255, 20)'
    && cta.surface.backgroundImage === 'none' && cta.surface.opacity === '1'
    && noFilter(cta.surface.backdropFilter) && noFilter(cta.surface.webkitBackdropFilter)
    && noFilter(cta.surface.filter) && cta.surface.boxShadow === 'none'
    && cta.before.content === 'none' && cta.before.display === 'none'
    && cta.after.content === 'none' && cta.after.display === 'none';
}
console.log('\nCTA capability and interaction matrix');
let results = [];
try {
  results = ENVIRONMENTS.map(runEnvironment);
  check('Chromium, Safari/WebKit, basic fallback, mobile and coarse cases rendered', results.length === ENVIRONMENTS.length);
} catch (error) {
  check('standalone CTA browser matrix executed', false, error.stack || error.message);
}
for (const result of results) {
  const label = result.environment.id;
  const { initial, reference } = result;
  console.log(`\n${label}`);
  check(`${label}: pending CTA is the canonical compact glass surface`,
    initial.tag === 'button' && initial.dataIndex === '0'
      && initial.classes.includes('player-glass-btn') && initial.edgeCount === 1
      && initial.edgeAria === 'true' && pendingEqualsReference(initial, reference, result.environment.hideRim),
    JSON.stringify({ surface: initial.surface, reference: reference.surface }));
  check(`${label}: pending copy, action target and unchecked SVG remain unchanged`,
    initial.copy === 'Marcar como Concluído' && initial.svgCount === 1 && !initial.checkCompleted);
  check(`${label}: pending fringe, sheen and rim are restored and pointer-inert`,
    initial.before.content !== 'none' && initial.after.content !== 'none'
      && initial.before.pointerEvents === 'none' && initial.after.pointerEvents === 'none'
      && initial.edge.pointerEvents === 'none');

  if (result.environment.branch === 'webkit') {
    const hasValidWebkitProp = !initial.surface.webkitBackdropFilter || initial.surface.webkitBackdropFilter === initial.surface.backdropFilter;
    check(`${label}: WebKit uses canonical base blur without SVG refraction`,
      initial.surface.backdropFilter.includes('blur(4px)') && !initial.surface.backdropFilter.includes('url(')
        && hasValidWebkitProp);
  } else if (result.environment.branch === 'basic') {
    check(`${label}: basic fallback keeps tint/decorations and removes backdrop filtering`,
      noFilter(initial.surface.backdropFilter) && noFilter(initial.surface.webkitBackdropFilter)
        && initial.surface.backgroundColor === reference.surface.backgroundColor
        && initial.before.content !== 'none' && initial.after.content !== 'none');
  } else if (result.environment.branch === 'chromium-soft') {
    check(`${label}: mobile Chromium uses soft refraction and hides the rim`,
      initial.surface.backdropFilter.includes('liquid-glass-refract-soft') && initial.edge.display === 'none');
  } else {
    check(`${label}: Chromium path retains canonical refraction`,
      initial.surface.backdropFilter.includes('liquid-glass-refract')
        && !initial.surface.backdropFilter.includes('liquid-glass-refract-soft'));
  }
  if (result.environment.id === 'coarse') {
    check(`${label}: coarse protection hides only the rim while base glass remains`,
      initial.edge.display === 'none' && !noFilter(initial.surface.backdropFilter));
  }

  check(`${label}: first click persists immediately but does not replace before 100ms`,
    result.firstImmediate.state === true && result.firstImmediate.writes === 1
      && result.firstImmediate.persisted.completionStatus['0'] === true
      && result.firstImmediate.sameNode && !result.firstImmediate.cardCompleted
      && result.firstImmediate.timerCount === 1 && result.firstImmediate.cta.checkCompleted);
  check(`${label}: CTA remains the same pending-material node at settled time minus 1ms`,
    result.firstAt99.sameNode && !result.firstAt99.cardCompleted && result.firstAt99.fallbackRenders === 0
      && pendingEqualsReference(result.firstAt99.cta, reference, result.environment.hideRim));
  check(`${label}: exactly at 100ms completion replaces the CTA with solid green`,
    !result.firstAt100.sameNode && result.firstAt100.cardCompleted && result.firstAt100.state === true
      && result.firstAt100.cta.copy === 'Concluído!' && result.firstAt100.cta.checkCompleted
      && isCompletedMaterial(result.firstAt100.cta));
  const completed = result.firstAt100.cta;
  check(`${label}: completed CTA removes tint/blur/refraction/rim/fringe/sheen`,
    completed.edgeCount === 0 && !completed.classes.includes('player-glass-btn')
      && noFilter(completed.surface.backdropFilter) && noFilter(completed.surface.webkitBackdropFilter)
      && completed.before.content === 'none' && completed.after.content === 'none');
  check(`${label}: completed #39ff14 text and check have dark, readable contrast`,
    completed.textStyle.color === completed.circle.stroke
      && completed.textStyle.color === completed.path.stroke
      && completed.circle.fill === 'rgba(0, 0, 0, 0)'
      && contrast(completed.textStyle.color, completed.surface.backgroundColor) >= 4.5,
    JSON.stringify({ text: completed.textStyle.color, background: completed.surface.backgroundColor,
      ratio: contrast(completed.textStyle.color, completed.surface.backgroundColor) }));

  check(`${label}: second click changes state/persistence but keeps completed node through 99ms`,
    result.secondImmediate.state === false && result.secondImmediate.writes === 2
      && result.secondImmediate.sameNode && result.secondImmediate.cardCompleted
      && result.secondAt99.sameNode && result.secondAt99.cardCompleted
      && isCompletedMaterial(result.secondAt99.cta));
  check(`${label}: second 100ms settlement restores copy, unchecked state and every glass layer`,
    !result.secondAt100.sameNode && !result.secondAt100.cardCompleted && result.secondAt100.state === false
      && result.secondAt100.cta.copy === initial.copy && !result.secondAt100.cta.checkCompleted
      && result.secondAt100.cta.edgeCount === 1
      && pendingEqualsReference(result.secondAt100.cta, reference, result.environment.hideRim));
  check(`${label}: two toggles preserve exact delegated action and global completion outcomes`,
    same(result.secondAt100.globalUpdates, [true, false]) && result.secondAt100.writes === 2);

  check(`${label}: missing settled target invokes fallback only at 100ms after persistence`,
    result.fallbackAt99.fallbackRenders === 0 && result.fallbackAt99.state === true
      && result.fallbackAt100.fallbackRenders === 1 && result.fallbackAt100.state === true
      && result.fallbackAt100.writes === 3
      && result.fallbackAt100.persisted.completionStatus['0'] === true
      && same(result.fallbackAt100.globalUpdates, [true, false]));
  check(`${label}: locked past completed workout is fully immutable`,
    result.locked.sameNode && result.locked.stateUnchanged
      && result.locked.writesAfter === result.locked.writesBefore
      && result.locked.updatesUnchanged && result.locked.pendingTimers === 0
      && same(result.locked.before, result.locked.after)
      && result.locked.after.copy === 'Concluído!' && isCompletedMaterial(result.locked.after));
  check(`${label}: fake clock/storage finish locally with no pending work`,
    result.final.elapsedMs === 400 && result.final.storageWrites === 3
      && result.final.fallbackRenders === 1 && result.final.pendingTimers === 0
      && same(result.final.globalUpdates, [true, false]));
}

console.log('\nProduction source contract');
check('CTA renderer preserves exact pending/completed copy, SVG and state-exclusive edge/class output',
  /const buttonText = isCompleted \? "Concluído!" : "Marcar como Concluído"/.test(source)
    && /\$\{isCompleted \? '' : 'player-glass-btn'\}/.test(source)
    && /\$\{isCompleted \? '' : '<span class="liquid-glass-edge" aria-hidden="true"><\/span>'\}/.test(source)
    && /class="animated-check-svg" viewBox="0 0 24 24"/.test(source));
check('production keeps delegated workout-details action and settled 100ms replacement',
  /\[DOM_ELEMENTS\.workoutDetails, 'click', handleExerciseToggle\]/.test(source)
    && /currentToggle\.replaceWith\(newToggle\);[\s\S]*?\}, 100\);/.test(source));
check('production keeps lock, persistence, fallback and global completion update paths',
  /if \(isPastWorkout && APP_STATE\.completionStatus\[index\]\) return;/.test(source)
    && /APP_STATE\.allCompletions\[key\] = APP_STATE\.completionStatus;[\s\S]*?saveApplicationState\(\);/.test(source)
    && /Fallback renderWorkoutDetails after completion toggle/.test(source)
    && /updateWorkoutButton\(completedExercises >= totalExercises\);/.test(source));

console.log(failures
  ? `\nFAIL: ${failures} of ${checks} targeted CTA-state checks failed`
  : `\nPASS: all ${checks} targeted CTA-state checks passed`);
process.exit(failures ? 1 : 0);
