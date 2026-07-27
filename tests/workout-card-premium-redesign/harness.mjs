import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..', '..');
export const INDEX_PATH = join(ROOT, 'index.html');
export const PLAYER_CSS_PATH = join(ROOT, 'src', 'player', 'player.css');
export const FIXED_NOW = '2025-02-10T12:00:00.000Z';
export const BREAKPOINT_WIDTHS = Object.freeze([639, 640, 641, 767, 768, 769, 1279, 1280, 1281, 1535, 1536, 1537, 1919, 1920, 1921]);
export const STATES = Object.freeze(['pending', 'completed', 'locked', 'series-active', 'series-complete', 'reps-open', 'rest-counting', 'rest-finished', 'method-open']);

const source = readFileSync(INDEX_PATH, 'utf8');
const playerCss = readFileSync(PLAYER_CSS_PATH, 'utf8');

function extractFunction(name) {
  const marker = `    function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Real renderer dependency not found: ${name}`);
  const tail = source.slice(start + marker.length);
  const next = tail.search(/^    (?:async )?function\s+/m);
  return source.slice(start, next < 0 ? source.length : start + marker.length + next).trim();
}

function extractConst(name) {
  const marker = `    const ${name} =`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Real renderer constant not found: ${name}`);
  let quote = null;
  let escaped = false;
  let depth = 0;
  for (let i = start + marker.length; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if ('{[('.includes(char)) depth += 1;
    else if ('}])'.includes(char)) depth -= 1;
    else if (char === ';' && depth === 0) return source.slice(start, i + 1).trim();
  }
  throw new Error(`Unterminated real renderer constant: ${name}`);
}
const FUNCTION_NAMES = [
  'createMethodBadgeHTML', 'createExerciseCardHTML', 'shouldUseControlledSheetImageLazy',
  'createExerciseStatsHTML', 'parseTotalSeries', 'parseMethodSegments',
  'formatMethodTooltipSegment', 'normalizeMethodKey', 'getMethodDescriptions',
  'parseRepetitionSegments', 'parseRestToSeconds', 'formatRestLabel',
  'createCompletionButtonHTML', 'getExerciseImageUrl', 'escapeHTML'
];

export const REAL_RENDERER_SOURCE = Object.freeze({
  functions: Object.fromEntries(FUNCTION_NAMES.map(name => [name, extractFunction(name)])),
  constants: {
    METHOD_DESCRIPTION_MAP: extractConst('METHOD_DESCRIPTION_MAP'),
    EXERCISE_IMAGE_MAP: extractConst('EXERCISE_IMAGE_MAP')
  }
});

function compileRenderers(windowLike) {
  const code = [
    REAL_RENDERER_SOURCE.constants.METHOD_DESCRIPTION_MAP,
    REAL_RENDERER_SOURCE.constants.EXERCISE_IMAGE_MAP,
    ...FUNCTION_NAMES.map(name => REAL_RENDERER_SOURCE.functions[name]),
    'return { createExerciseCardHTML };'
  ].join('\n\n');
  return new Function('window', code)(windowLike);
}

export function createMatchMedia({ width, pointer, motion, capability }) {
  return query => {
    const max = query.match(/max-width:\s*([\d.]+)px/);
    const min = query.match(/min-width:\s*([\d.]+)px/);
    const matched = (!max || width <= Number(max[1]))
      && (!min || width >= Number(min[1]))
      && (!query.includes('pointer: coarse') || pointer === 'coarse')
      && (!query.includes('pointer: fine') || pointer === 'fine')
      && (!query.includes('prefers-reduced-motion: reduce') || motion === 'reduced')
      && (!query.includes('backdrop-filter') || capability !== 'basic');
    return { matches: matched, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false };
  };
}

export function normalizeCase(input = {}) {
  const captureCase = {
    id: input.id || 'main-768-fine-full-chromium-pending',
    width: Number(input.width || 768), height: Number(input.height || 900),
    context: input.context || 'main', pointer: input.pointer || 'fine',
    motion: input.motion || 'full', capability: input.capability || 'chromium',
    state: input.state || 'pending', maskMedia: input.maskMedia !== false
  };
  if (!BREAKPOINT_WIDTHS.includes(captureCase.width)) throw new Error(`Unsupported harness width: ${captureCase.width}`);
  if (!['main', 'week-sheet'].includes(captureCase.context)) throw new Error(`Unsupported context: ${captureCase.context}`);
  if (!['fine', 'coarse'].includes(captureCase.pointer)) throw new Error(`Unsupported pointer: ${captureCase.pointer}`);
  if (!['full', 'reduced'].includes(captureCase.motion)) throw new Error(`Unsupported motion: ${captureCase.motion}`);
  if (!['chromium', 'webkit', 'basic'].includes(captureCase.capability)) throw new Error(`Unsupported capability: ${captureCase.capability}`);
  if (!STATES.includes(captureCase.state)) throw new Error(`Unsupported state: ${captureCase.state}`);
  return Object.freeze(captureCase);
}

export function defaultExercise() {
  return Object.freeze({
    name: 'Elevação Pélvica com Barra', series: '4', rept: '20/18/15/12',
    descanso: '90 seg', method: 'Pirâmide Crescente + Isometria'
  });
}
function realStyles() {
  const inline = [...source.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi)].map(match => match[1]);
  if (!inline.length) throw new Error('No real inline styles found in index.html');
  return `${playerCss}\n${inline.join('\n')}`;
}

function deterministicBootstrap(captureCase) {
  return `(() => {
    const config = ${JSON.stringify(captureCase)};
    const RealDate = Date;
    class FixedDate extends RealDate { constructor(...args) { super(...(args.length ? args : ['${FIXED_NOW}'])); } static now() { return ${Date.parse(FIXED_NOW)}; } }
    window.Date = FixedDate;
    let seed = 0x48594654;
    Math.random = () => ((seed = Math.imul(seed ^ seed >>> 15, 1 | seed)) >>> 0) / 4294967296;
    const persisted = new Map();
    window.__HARNESS_STORAGE__ = { getItem: key => persisted.get(String(key)) ?? null, setItem: (key, value) => persisted.set(String(key), String(value)), removeItem: key => persisted.delete(String(key)), clear: () => persisted.clear() };
    window.__HARNESS_CLOCK__ = { now: () => FixedDate.now(), timers: [], tick(ms) { this.timers = this.timers.map(timer => ({ ...timer, remaining: Math.max(0, timer.remaining - ms) })); } };
    document.documentElement.dataset.harnessPointer = config.pointer;
    document.documentElement.dataset.harnessMotion = config.motion;
    document.documentElement.dataset.harnessCapability = config.capability;
    document.documentElement.dataset.harnessContext = config.context;
    const card = document.querySelector('.workout-card');
    const method = card.querySelector('[data-method-badge]');
    const series = card.querySelector('[data-stat-type="series"]');
    const reps = card.querySelector('[data-stat-type="reps"]');
    const rest = card.querySelector('[data-stat-type="rest"]');
    if (config.state === 'completed' || config.state === 'locked') card.classList.add('exercise-completed');
    if (config.state === 'locked') card.dataset.locked = 'true';
    if (config.state === 'series-active') { series.classList.add('is-active'); series.setAttribute('aria-pressed', 'true'); series.querySelector('[data-role="series-value"]').textContent = '2/4'; }
    if (config.state === 'series-complete') { series.classList.add('is-complete'); series.querySelector('[data-role="series-value"]').textContent = '4/4'; }
    if (config.state === 'reps-open') { reps.classList.add('is-open'); reps.setAttribute('aria-expanded', 'true'); }
    if (config.state === 'rest-counting') { rest.classList.add('is-counting'); rest.setAttribute('aria-pressed', 'true'); rest.querySelector('[data-role="rest-value"]').textContent = '01:00'; rest.querySelector('[data-role="rest-helper"]').textContent = 'Toque para cancelar'; }
    if (config.state === 'rest-finished') { rest.classList.add('finished'); rest.querySelector('[data-role="rest-value"]').textContent = 'Pronto!'; }
    if (config.state === 'method-open') { method.classList.add('is-open'); method.setAttribute('aria-expanded', 'true'); }
    document.querySelectorAll('img').forEach(img => { img.removeAttribute('src'); img.removeAttribute('data-src'); img.dataset.harnessMedia = 'stable'; });
    document.fonts?.ready.then(() => { window.__HARNESS_READY__ = true; });
    if (!document.fonts) window.__HARNESS_READY__ = true;
  })();`;
}

const HARNESS_CSS = `
  *,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}
  html,body{margin:0;min-height:100%;background:#09090d;color:#fff;font-family:Poppins,Arial,sans-serif}
  body{display:flex;justify-content:center;padding:24px;box-sizing:border-box}.harness-main{width:min(100%,560px)}
  .hf-week-sheet__panel{position:relative!important;transform:none!important;width:min(100%,560px);padding:16px;box-sizing:border-box}.hf-week-sheet__body{overflow:visible!important}
  .relative{position:relative}.absolute{position:absolute}.inset-0{inset:0}.overflow-hidden{overflow:hidden}.w-full{width:100%}.h-full{height:100%}
  .flex{display:flex}.flex-col{flex-direction:column}.flex-grow{flex-grow:1}.items-center{align-items:center}.justify-center{justify-content:center}.justify-end{justify-content:flex-end}
  .p-3{padding:.75rem}.p-4{padding:1rem}.gap-3{gap:.75rem}.space-y-4>*+*{margin-top:1rem}.z-10{z-index:10}.text-white{color:#fff}.font-black{font-weight:900}.font-bold{font-weight:700}.text-2xl{font-size:1.5rem}.text-base{font-size:1rem}.leading-tight{line-height:1.25}
  [data-harness-media="stable"]{background:linear-gradient(135deg,#2b2430,#10141b 48%,#5d2d18);visibility:visible!important;color:transparent}
  html[data-harness-capability="basic"] .glass-effect,html[data-harness-capability="basic"] .liquid-glass{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
  html[data-harness-motion="reduced"] *{animation:none!important;transition:none!important}
  html[data-harness-pointer="coarse"] button{touch-action:manipulation}
`;
export function renderFixtureDocument(input = {}, exercise = defaultExercise()) {
  const captureCase = normalizeCase(input);
  const windowLike = { matchMedia: createMatchMedia(captureCase) };
  const { createExerciseCardHTML } = compileRenderers(windowLike);
  const completed = captureCase.state === 'completed' || captureCase.state === 'locked';
  const card = `<article class="workout-card relative rounded-3xl border flex flex-col justify-end${completed ? ' exercise-completed' : ''}" data-image-url="src/imagens/Elevação Pélvica com Barra.webp">${createExerciseCardHTML(exercise, 0, completed, captureCase.state === 'locked')}</article>`;
  const content = captureCase.context === 'week-sheet'
    ? `<section class="hf-week-sheet is-open is-settled"><div class="hf-week-sheet__panel"><div class="hf-week-sheet__panel-bg"></div><div class="hf-week-sheet__body"><div id="workout-details">${card}</div></div></div></section>`
    : `<main class="harness-main"><div id="workout-details">${card}</div></main>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${captureCase.id}</title><style>${realStyles()}\n${HARNESS_CSS}</style></head><body>${content}<script>${deterministicBootstrap(captureCase)}</script></body></html>`;
}

function caseId(parts) {
  return [parts.context, parts.width, parts.pointer, parts.motion, parts.capability, parts.state].join('-');
}

export function buildCaptureMatrix() {
  const cases = [];
  const add = parts => {
    const value = normalizeCase({ ...parts, id: caseId(parts) });
    if (!cases.some(item => item.id === value.id)) cases.push(value);
  };
  for (const context of ['main', 'week-sheet']) {
    for (const width of BREAKPOINT_WIDTHS) add({ context, width, pointer: 'fine', motion: 'full', capability: 'chromium', state: 'pending' });
    for (const width of [639, 641, 767, 769]) add({ context, width, pointer: 'coarse', motion: 'full', capability: 'chromium', state: 'pending' });
    for (const width of [640, 768]) add({ context, width, pointer: 'fine', motion: 'reduced', capability: 'chromium', state: 'pending' });
    add({ context, width: 768, pointer: 'fine', motion: 'full', capability: 'basic', state: 'pending' });
    add({ context, width: 768, pointer: 'fine', motion: 'full', capability: 'webkit', state: 'pending' });
  }
  for (const state of STATES) add({ context: 'main', width: 768, pointer: 'fine', motion: state === 'pending' ? 'reduced' : 'full', capability: 'chromium', state });
  return Object.freeze(cases);
}

export function matrixCoverage(matrix = buildCaptureMatrix()) {
  const values = key => [...new Set(matrix.map(item => item[key]))].sort();
  return Object.freeze({
    count: matrix.length, widths: values('width'), contexts: values('context'),
    pointers: values('pointer'), motions: values('motion'), capabilities: values('capability'), states: values('state')
  });
}

export function createFixtureWorkspace(cases) {
  const directory = mkdtempSync(join(tmpdir(), 'hf-workout-card-'));
  const files = cases.map(captureCase => {
    const path = join(directory, `${captureCase.id}.html`);
    writeFileSync(path, renderFixtureDocument(captureCase), 'utf8');
    return { captureCase, path, url: pathToFileURL(path).href };
  });
  return { directory, files, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

export function sourceContract() {
  return Object.freeze({
    indexPath: INDEX_PATH, playerCssPath: PLAYER_CSS_PATH,
    rendererNames: [...FUNCTION_NAMES], inlineStyleBlocks: [...source.matchAll(/<style(?:\s[^>]*)?>/gi)].length,
    usesRealPlayerCss: playerCss.includes('.liquid-glass'), fixedNow: FIXED_NOW
  });
}
