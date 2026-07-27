// Feature: workout-card-premium-redesign, Property 1: Equivalência estrutural e semântica
// **Validates: Requirements 1.1, 1.3, 2.2, 2.3, 5.1, 5.9, 7.9, 8.12, 9.1, 9.2, 9.3**
import { isDeepStrictEqual } from 'node:util';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';
import {
  BREAKPOINT_WIDTHS, INDEX_PATH, PLAYER_CSS_PATH, ROOT, STATES, createMatchMedia
} from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const COUNTEREXAMPLE_PATH = join(HERE, 'property-01-structural-equivalence.counterexample.json');
const BASELINE_REVISION = 'd82a7ed';
const DEFAULT_SEED = 0x01c0ffee;
const RUNS = 128;
const PROPERTY = 'Property 1: Equivalência estrutural e semântica';
const FEATURE = 'workout-card-premium-redesign';
const seedInput = process.env.HF_PROPERTY_SEED || String(DEFAULT_SEED);
const seed = Number(seedInput.startsWith('0x') ? Number.parseInt(seedInput.slice(2), 16) : Number.parseInt(seedInput, 10)) >>> 0;
const candidateSource = readFileSync(INDEX_PATH, 'utf8');
const playerCss = readFileSync(PLAYER_CSS_PATH, 'utf8');

const baselineRun = spawnSync('git', ['show', `${BASELINE_REVISION}:index.html`], {
  cwd: ROOT, encoding: 'utf8', timeout: 10_000, maxBuffer: 20 * 1024 * 1024
});
if (baselineRun.status !== 0 || !baselineRun.stdout) {
  throw new Error(`Unable to load frozen baseline ${BASELINE_REVISION}: ${baselineRun.stderr.trim()}`);
}
const baselineSource = baselineRun.stdout;

function extractFunction(source, name) {
  const pattern = new RegExp(`^\\s{4}function ${name}\\(`, 'm');
  const match = pattern.exec(source);
  if (!match) throw new Error(`Renderer dependency not found: ${name}`);
  const start = match.index;
  const tail = source.slice(start + match[0].length);
  const next = tail.search(/^\s{4}(?:async )?function\s+/m);
  return source.slice(start, next < 0 ? source.length : start + match[0].length + next).trim();
}
function extractConst(source, name) {
  const marker = `    const ${name} =`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Renderer constant not found: ${name}`);
  let quote = null;
  let escaped = false;
  let depth = 0;
  for (let index = start + marker.length; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if ('"\'`'.includes(character)) quote = character;
    else if ('{[('.includes(character)) depth += 1;
    else if ('}])'.includes(character)) depth -= 1;
    else if (character === ';' && depth === 0) return source.slice(start, index + 1).trim();
  }
  throw new Error(`Unterminated renderer constant: ${name}`);
}

const RENDERER_FUNCTIONS = [
  'createMethodBadgeHTML', 'createExerciseCardHTML', 'shouldUseControlledSheetImageLazy',
  'createExerciseStatsHTML', 'parseTotalSeries', 'parseMethodSegments',
  'formatMethodTooltipSegment', 'normalizeMethodKey', 'getMethodDescriptions',
  'parseRepetitionSegments', 'parseRestToSeconds', 'formatRestLabel',
  'createCompletionButtonHTML', 'getExerciseImageUrl', 'escapeHTML'
];

function compile(source, environment) {
  const code = [
    extractConst(source, 'METHOD_DESCRIPTION_MAP'),
    extractConst(source, 'EXERCISE_IMAGE_MAP'),
    ...RENDERER_FUNCTIONS.map(name => extractFunction(source, name)),
    'return { createExerciseCardHTML, getExerciseImageUrl };'
  ].join('\n\n');
  return new Function('window', code)({ matchMedia: createMatchMedia(environment) });
}

function mulberry32(initialSeed) {
  let value = initialSeed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

const random = mulberry32(seed);
const pick = values => values[Math.floor(random() * values.length)];
const integer = (minimum, maximum) => minimum + Math.floor(random() * (maximum - minimum + 1));
const titles = [
  'Agachamento Hack', 'Elevação Pélvica com Barra', 'Cadeira Extensora',
  'Rosca Martelo + Tríceps Francês (Corda)', 'Remada unilateral — controle 3:1 🔥',
  'Abdução de quadril <máxima> & pausa', 'Supino "pegada neutra" com halteres'
];
const methods = [
  'Bi-set', 'Pirâmide Crescente + Isometria', 'Rest Pause Última Série',
  'Drop-set + Ênfase excêntrica', 'Método livre • ação 🔥', 'Cluster 4×4'
];
const seriesValues = ['1', '3', '4', '5 séries', '8 séries progressivas', '12'];
const repetitionValues = ['8', '12/10/8', '20/18/15/12', '6-8', 'AMRAP', '10 + 10', '12–15'];
const restValues = ['Livre', '30 seg', '45 segundos', '60 seg', '90 seg', '2 min', '2 minutos e 30 segundos'];

function generateCase(index) {
  return {
    id: index,
    environment: {
      width: pick(BREAKPOINT_WIDTHS), height: 900,
      context: pick(['main', 'week-sheet']), pointer: pick(['fine', 'coarse']),
      motion: pick(['full', 'reduced']), capability: pick(['chromium', 'webkit', 'basic'])
    },
    state: pick(STATES),
    exerciseIndex: integer(0, 250),
    exercise: {
      name: pick(titles), series: pick(seriesValues), rept: pick(repetitionValues),
      descanso: pick(restValues), method: pick(methods)
    }
  };
}
const SEMANTIC_CLASSES = new Set([
  'workout-card', 'exercise-card-image', 'exercise-method-pill', 'method-icon', 'method-label',
  'method-tooltip', 'exercise-stats-chip-group', 'exercise-stat-button', 'chip-header', 'stat-icon',
  'stat-label', 'stat-value', 'stat-helper', 'stat-progress-bar', 'stat-progress-fill', 'stat-details',
  'completion-toggle-wrapper', 'animated-check-container', 'animated-check-svg',
  'animated-check-circle', 'animated-check-path', 'exercise-completed', 'completed', 'is-active',
  'is-complete', 'is-open', 'is-counting', 'finished'
]);
const VISUAL_ATTRIBUTES = new Set([
  'class', 'style', 'fill', 'stroke', 'stroke-width', 'color', 'width', 'height'
]);
const normalizeText = value => String(value || '').replace(/\s+/g, ' ').trim();

function render(source, testCase) {
  const renderer = compile(source, testCase.environment);
  const completed = testCase.state === 'completed' || testCase.state === 'locked';
  const imageUrl = renderer.getExerciseImageUrl(testCase.exercise.name);
  const html = `<article class="workout-card${completed ? ' exercise-completed' : ''}" data-image-url="${imageUrl}">${renderer.createExerciseCardHTML(
    testCase.exercise, testCase.exerciseIndex, completed, testCase.state === 'locked'
  )}</article>`;
  const $ = load(html);
  const card = $('.workout-card').first();
  const method = card.find('[data-method-badge]').first();
  const series = card.find('[data-stat-type="series"]').first();
  const reps = card.find('[data-stat-type="reps"]').first();
  const rest = card.find('[data-stat-type="rest"]').first();
  const total = Number.parseInt(testCase.exercise.series, 10) || 1;
  if (testCase.state === 'locked') card.attr('data-locked', 'true');
  if (testCase.state === 'series-active') {
    series.addClass('is-active').attr('aria-pressed', 'true');
    series.find('[data-role="series-value"]').text(`1/${total}`);
  }
  if (testCase.state === 'series-complete') {
    series.addClass('is-complete');
    series.find('[data-role="series-value"]').text(`${total}/${total}`);
  }
  if (testCase.state === 'reps-open') reps.addClass('is-open').attr('aria-expanded', 'true');
  if (testCase.state === 'rest-counting') {
    rest.addClass('is-counting').attr('aria-pressed', 'true');
    rest.find('[data-role="rest-value"]').text('00:17');
    rest.find('[data-role="rest-helper"]').text('Toque para cancelar');
  }
  if (testCase.state === 'rest-finished') {
    rest.addClass('finished');
    rest.find('[data-role="rest-value"]').text('Pronto!');
  }
  if (testCase.state === 'method-open') method.addClass('is-open').attr('aria-expanded', 'true');
  return { $, card };
}

function assertInertEdges($, card) {
  card.find('.liquid-glass-edge').each((_, edge) => {
    const node = $(edge);
    const attributes = edge.attribs || {};
    const forbidden = Object.keys(attributes).filter(name => !['class', 'aria-hidden', 'style'].includes(name));
    if (edge.name !== 'span' || attributes['aria-hidden'] !== 'true' || forbidden.length
      || normalizeText(node.text()) || node.children().length || node.is('[tabindex],a,button,input,select,textarea,[role]')) {
      throw new Error(`.liquid-glass-edge must be an empty aria-hidden span; got ${$.html(node)}`);
    }
  });
  if (card.find('.liquid-glass-edge').length && !/\.liquid-glass-edge[\s\S]{0,1200}pointer-events\s*:\s*none/.test(playerCss)) {
    throw new Error('.liquid-glass-edge is not pointer-inert in the canonical stylesheet');
  }
}

function normalizedAttributes(element) {
  return Object.fromEntries(Object.entries(element.attribs || {})
    .filter(([name]) => !VISUAL_ATTRIBUTES.has(name.toLowerCase()))
    .sort(([left], [right]) => left.localeCompare(right)));
}

function normalizedClasses(element) {
  return String(element.attribs?.class || '').split(/\s+/).filter(Boolean)
    .filter(name => SEMANTIC_CLASSES.has(name) || name.startsWith('ph-')).sort();
}

function normalizeNode($, element) {
  return {
    tag: element.name,
    classes: normalizedClasses(element),
    attributes: normalizedAttributes(element),
    text: normalizeText((element.children || []).filter(child => child.type === 'text').map(child => child.data).join(' ')),
    children: (element.children || []).filter(child => child.type === 'tag').map(child => normalizeNode($, child))
  };
}
const semanticSelectors = [
  ['image', '.exercise-card-image'], ['method', '[data-method-badge]'], ['title', 'h3'],
  ['series', '[data-stat-type="series"]'], ['reps', '[data-stat-type="reps"]'],
  ['rest', '[data-stat-type="rest"]'], ['cta', '.completion-toggle-wrapper']
];

function snapshot(view) {
  const { $, card } = view;
  assertInertEdges($, card);
  card.find('.liquid-glass-edge').remove();
  const semanticOrder = semanticSelectors.flatMap(([key, selector]) => card.find(selector).toArray().map(element => ({
    key, tag: element.name, text: normalizeText($(element).text()), attributes: normalizedAttributes(element)
  })));
  const interactiveOrder = card.find('button,a[href],input,select,textarea,[tabindex]').toArray()
    .filter(element => element.attribs?.tabindex !== '-1')
    .map(element => ({
      key: semanticSelectors.find(([, selector]) => $(element).is(selector))?.[0] || element.name,
      tag: element.name, text: normalizeText($(element).text()), attributes: normalizedAttributes(element)
    }));
  const icons = card.find('i,svg,path,circle').toArray().map(element => normalizeNode($, element));
  const indicators = card.find('.stat-progress-bar,.stat-progress-fill').toArray().map(element => ({
    tag: element.name, classes: normalizedClasses(element), attributes: normalizedAttributes(element),
    owner: $(element).closest('[data-stat-type]').attr('data-stat-type') || null
  }));
  const copyAndData = {
    allText: normalizeText(card.text()),
    title: normalizeText(card.find('h3').text()),
    method: normalizeText(card.find('.method-label').text()),
    labels: card.find('.stat-label').toArray().map(node => normalizeText($(node).text())),
    values: card.find('.stat-value').toArray().map(node => normalizeText($(node).text())),
    helpers: card.find('.stat-helper').toArray().map(node => normalizeText($(node).text())),
    dialogs: card.find('[role="dialog"]').toArray().map(node => normalizeText($(node).text()))
  };
  return {
    inventory: normalizeNode($, card[0]), semanticOrder, interactiveOrder, copyAndData, icons, indicators
  };
}

function firstDifference(expected, actual, path = '$') {
  if (isDeepStrictEqual(expected, actual)) return null;
  if (typeof expected !== 'object' || expected === null || typeof actual !== 'object' || actual === null) {
    return { path, expected, actual };
  }
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])];
  for (const key of keys) {
    const difference = firstDifference(expected[key], actual[key], `${path}.${key}`);
    if (difference) return difference;
  }
  return { path, expected, actual };
}

function verify(testCase) {
  const baseline = snapshot(render(baselineSource, testCase));
  const candidate = snapshot(render(candidateSource, testCase));
  const expectedOrder = ['image', 'method', 'title', 'series', 'reps', 'rest', 'cta'];
  if (!isDeepStrictEqual(candidate.semanticOrder.map(item => item.key), expectedOrder)) {
    throw Object.assign(new Error('Candidate semantic order differs from image → badge → title → Séries → Reps → Descanso → CTA'), {
      difference: { path: '$.semanticOrder', expected: expectedOrder, actual: candidate.semanticOrder.map(item => item.key) }, baseline, candidate
    });
  }
  const difference = firstDifference(baseline, candidate);
  if (difference) {
    throw Object.assign(new Error(`Structural/semantic mismatch at ${difference.path}`), { difference, baseline, candidate });
  }
}

rmSync(COUNTEREXAMPLE_PATH, { force: true });
console.log(`Running ${FEATURE} ${PROPERTY}: ${RUNS} cases, seed=${seed} (0x${seed.toString(16).padStart(8, '0')})`);
for (let run = 0; run < RUNS; run += 1) {
  const testCase = generateCase(run);
  try {
    verify(testCase);
  } catch (error) {
    const counterexample = {
      feature: FEATURE, property: PROPERTY, baselineRevision: BASELINE_REVISION,
      seed, seedHex: `0x${seed.toString(16).padStart(8, '0')}`, run, testCase,
      message: error.message, difference: error.difference || null,
      baseline: error.baseline || null, candidate: error.candidate || null
    };
    writeFileSync(COUNTEREXAMPLE_PATH, `${JSON.stringify(counterexample, null, 2)}\n`, 'utf8');
    console.error(`FAIL ${PROPERTY} at run ${run}; counterexample persisted to ${COUNTEREXAMPLE_PATH}`);
    console.error(JSON.stringify({ seed, run, testCase, message: error.message, difference: error.difference }, null, 2));
    process.exit(1);
  }
}
console.log(`PASS ${PROPERTY}: ${RUNS} seeded cases preserved exact structural and semantic equivalence`);
