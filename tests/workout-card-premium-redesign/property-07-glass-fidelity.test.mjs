// Feature: workout-card-premium-redesign, Property 7: Fidelidade e confinamento do Liquid Glass
// **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7**
// Usage: node tests/workout-card-premium-redesign/property-07-glass-fidelity.test.mjs
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BREAKPOINT_WIDTHS, PLAYER_CSS_PATH, renderFixtureDocument } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAILURE_PATH = join(HERE, '.property-07-glass-fidelity.failure.json');
const TEMP_PATH = join(HERE, '.tmp-property-07-glass-fidelity.html');
const FEATURE = 'workout-card-premium-redesign';
const PROPERTY = 'Property 7: Fidelidade e confinamento do Liquid Glass';
const DEFAULT_SEED = 0x48465037;
const requestedSeed = process.env.HF_PBT_SEED ?? process.env.HF_PROPERTY_SEED;
const parsedSeed = requestedSeed === undefined ? DEFAULT_SEED : Number(requestedSeed);
const SEED = Number.isFinite(parsedSeed) ? parsedSeed >>> 0 : DEFAULT_SEED;
const CHROME = [process.env.HF_CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
const playerCss = readFileSync(PLAYER_CSS_PATH, 'utf8');

function balancedBlockAt(source, open, label) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let comment = false;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (comment) {
      if (character === '*' && next === '/') { comment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '/' && next === '*') { comment = true; index += 1; }
    else if (character === '"' || character === "'") quote = character;
    else if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) {
      return { open, close:index, body:source.slice(open + 1, index) };
    }
  }
  throw new Error(`Unterminated canonical CSS block: ${label}`);
}

function balancedBlock(source, marker, from = 0) {
  const markerIndex = source.indexOf(marker, from);
  if (markerIndex < 0) throw new Error(`Canonical CSS marker not found: ${marker}`);
  const markerBrace = marker.lastIndexOf('{');
  const open = markerBrace >= 0
    ? markerIndex + markerBrace
    : source.indexOf('{', markerIndex + marker.length);
  if (open < 0) throw new Error(`Canonical CSS block has no opening brace: ${marker}`);
  return { markerIndex, ...balancedBlockAt(source, open, marker) };
}

function normalizePrelude(value) {
  return value.replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ');
}

function topLevelRule(source, selector) {
  const expected = normalizePrelude(selector);
  let depth = 0;
  let segmentStart = 0;
  let quote = null;
  let escaped = false;
  let comment = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (comment) {
      if (character === '*' && next === '/') { comment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '/' && next === '*') { comment = true; index += 1; }
    else if (character === '"' || character === "'") quote = character;
    else if (character === '{') {
      if (depth === 0 && normalizePrelude(source.slice(segmentStart, index)) === expected) {
        return balancedBlockAt(source, index, selector);
      }
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) segmentStart = index + 1;
    }
  }
  throw new Error(`Canonical top-level CSS rule not found: ${selector}`);
}

function declarations(body) {
  const result = {};
  let token = '';
  let depth = 0;
  let quote = null;
  const flush = () => {
    const colon = token.indexOf(':');
    if (colon > 0) result[token.slice(0, colon).trim()] = token.slice(colon + 1).trim().replace(/\s+/g, ' ');
    token = '';
  };
  for (const char of body.replace(/\/\*[\s\S]*?\*\//g, '')) {
    if (quote) { token += char; if (char === quote) quote = null; continue; }
    if (char === '"' || char === "'") { quote = char; token += char; }
    else if (char === '(') { depth += 1; token += char; }
    else if (char === ')') { depth -= 1; token += char; }
    else if (char === ';' && depth === 0) flush();
    else token += char;
  }
  flush();
  return result;
}

function canonicalManifest() {
  const sectionStart = playerCss.indexOf('/* ===== Liquid Glass — material reutilizável');
  const sectionEnd = playerCss.indexOf('/* Player Modal e Screens */', sectionStart);
  if (sectionStart < 0 || sectionEnd < 0) throw new Error('Canonical Liquid Glass manifest section is missing');
  const canonical = playerCss.slice(sectionStart, sectionEnd);
  const supports = balancedBlock(canonical,
    '@supports (backdrop-filter: url(#liquid-glass-refract)) and (background: paint(liquid-glass-probe))');
  const compact = balancedBlock(supports.body, '@media (max-width: 768px)');
  const base = topLevelRule(canonical, '.liquid-glass, .player-glass-btn');
  const neutral = topLevelRule(canonical, '.player-glass-btn');
  const chromium = topLevelRule(supports.body, '.liquid-glass, .player-glass-btn');
  const chromiumNeutral = topLevelRule(supports.body, '.player-glass-btn');
  const compactMaterial = topLevelRule(compact.body, '.liquid-glass, .player-glass-btn');
  const edge = topLevelRule(canonical,
    '.liquid-glass .liquid-glass-edge, .player-glass-btn .liquid-glass-edge');
  const fringe = topLevelRule(canonical, '.liquid-glass::before, .player-glass-btn::before');
  const sheen = topLevelRule(canonical, '.liquid-glass::after, .player-glass-btn::after');
  const content = topLevelRule(canonical,
    '.liquid-glass > i, .liquid-glass > span:not(.liquid-glass-edge), .player-glass-btn > i, .player-glass-btn > span:not(.liquid-glass-edge)');
  return Object.freeze({ base:declarations(base.body), neutral:declarations(neutral.body),
    chromium:declarations(chromium.body), chromiumNeutral:declarations(chromiumNeutral.body),
    compact:declarations(compactMaterial.body), edge:declarations(edge.body),
    fringe:declarations(fringe.body), sheen:declarations(sheen.body), content:declarations(content.body) });
}
const manifest = canonicalManifest();
const MANIFEST_HASH = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');

const REQUIRED_DECLARATIONS = Object.freeze({
  base:['backdrop-filter','-webkit-backdrop-filter','border','box-shadow','isolation','overflow'],
  neutral:['background'], chromium:['backdrop-filter'], chromiumNeutral:['background'], compact:['backdrop-filter'],
  edge:['inset','backdrop-filter','-webkit-backdrop-filter','-webkit-mask','mask','pointer-events','z-index'],
  fringe:['content','inset','padding','background','-webkit-mask','-webkit-mask-composite','mask','mask-composite','pointer-events','z-index'],
  sheen:['content','inset','background','mix-blend-mode','pointer-events','z-index'], content:['position','z-index']
});
const ELIGIBLE = Object.freeze([
  { key:'method-badge', selector:'.exercise-method-pill', content:':scope > .method-icon,:scope > .method-label' },
  { key:'method-tooltip', selector:'.method-tooltip', content:':scope > span:not(.liquid-glass-edge)' },
  { key:'metric-series', selector:'[data-stat-type="series"]', content:':scope > .chip-header,:scope > .stat-value,:scope > .stat-helper,:scope > .stat-progress-bar' },
  { key:'metric-reps', selector:'[data-stat-type="reps"]', content:':scope > .chip-header,:scope > .stat-value,:scope > .stat-helper' },
  { key:'reps-details', selector:'.stat-details', content:':scope > span:not(.liquid-glass-edge)' },
  { key:'metric-rest', selector:'[data-stat-type="rest"]', content:':scope > .chip-header,:scope > .stat-value,:scope > .stat-helper,:scope > .stat-progress-bar' },
  { key:'pending-cta', selector:'.completion-toggle-wrapper', content:':scope > .animated-check-container,:scope > span:not(.liquid-glass-edge)', pendingOnly:true }
]);
const NONELIGIBLE = Object.freeze([
  { key:'card-host', selector:'.workout-card' }, { key:'full-bleed-image', selector:'.exercise-card-image' },
  { key:'scrim', selector:'.absolute.inset-0 > .bg-gradient-to-t' }, { key:'title', selector:'.workout-card h3' },
  { key:'metric-group', selector:'.exercise-stats-chip-group' },
  { key:'completed-cta', selector:'.completion-toggle-wrapper', completedOnly:true },
  { key:'series-progress', selector:'[data-stat-type="series"] .stat-progress-bar' },
  { key:'series-fill', selector:'[data-stat-type="series"] .stat-progress-fill' },
  { key:'check-container', selector:'.animated-check-container' }, { key:'check-svg', selector:'.animated-check-svg' },
  { key:'method-icon', selector:'.method-icon' }, { key:'method-label', selector:'.method-label' },
  { key:'stat-icon', selector:'[data-stat-type="series"] .stat-icon' },
  { key:'stat-label', selector:'[data-stat-type="series"] .stat-label' },
  { key:'stat-value', selector:'[data-stat-type="series"] .stat-value' },
  { key:'stat-helper', selector:'[data-stat-type="series"] .stat-helper' }
]);

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
const shuffle = values => {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
};
const capabilities = ['chromium', 'webkit', 'basic'];
const subjects = [...ELIGIBLE.map(item => ({ ...item, eligible:true })),
  ...NONELIGIBLE.map(item => ({ ...item, eligible:false }))];
const generatedProduct = Array.from({ length:2 }, (_, repetition) => subjects.flatMap(subject =>
  capabilities.map(capability => ({ repetition, subject, capability })))).flat();
const cases = shuffle(generatedProduct).map((entry, index) => ({
  index, repetition:entry.repetition, subjectKey:entry.subject.key, selector:entry.subject.selector,
  eligible:entry.subject.eligible, capability:entry.capability,
  state:entry.subject.completedOnly ? 'completed' : 'pending',
  width:BREAKPOINT_WIDTHS[index % BREAKPOINT_WIDTHS.length],
  context:random() < 0.5 ? 'main' : 'week-sheet', pointer:random() < 0.35 ? 'coarse' : 'fine'
}));

function requireInvariant(condition, assertion, observed) {
  if (!condition) {
    const error = new Error(assertion);
    error.assertion = assertion;
    error.observed = observed;
    throw error;
  }
}
function assertManifest() {
  for (const [section, properties] of Object.entries(REQUIRED_DECLARATIONS)) {
    const missing = properties.filter(property => !(property in manifest[section]));
    requireInvariant(missing.length === 0, `canonical ${section} manifest must be complete`, { missing, actual:manifest[section] });
  }
  requireInvariant(subjects.length === 23 && cases.length === 138,
    'property must generate exactly 23 subjects × 3 capabilities × 2 repetitions',
    { subjects:subjects.length, capabilities:capabilities.length, repetitions:2, cases:cases.length });
  requireInvariant(subjects.every(subject => capabilities.every(capability => cases.filter(item =>
    item.subjectKey === subject.key && item.capability === capability).length === 2)),
  'every eligible/noneligible surface and capability branch must receive two seeded cases', null);
  requireInvariant(BREAKPOINT_WIDTHS.every(width => cases.some(item => item.width === width)),
    'all supported breakpoint neighbors must be covered', BREAKPOINT_WIDTHS);
  requireInvariant(cases.some(item => item.pointer === 'coarse') && cases.some(item => item.pointer === 'fine')
    && cases.some(item => item.context === 'main') && cases.some(item => item.context === 'week-sheet'),
  'generator must cover pointer and rendering contexts', null);
}

function extractHead(document) {
  const match = document.match(/<head>([\s\S]*?)<\/head>/i);
  if (!match) throw new Error('Harness document has no head');
  return match[1];
}
function extractFixtureMarkup(document) {
  const match = document.match(/<body>([\s\S]*?)<script>/i);
  if (!match) throw new Error('Harness document has no fixture body');
  return match[1].trim();
}
function capabilityCss() {
  const baseFilter = manifest.base['backdrop-filter'];
  const webkitFilter = manifest.base['-webkit-backdrop-filter'];
  const baseTint = manifest.neutral.background;
  return `
    .canonical-probe-host{position:fixed;left:-10000px;top:0;width:180px;height:80px;pointer-events:none}
    .canonical-reference{width:160px;height:64px;border-radius:16px}
    .property-case[data-capability="webkit"] .player-glass-btn{background:${baseTint}!important;backdrop-filter:${baseFilter}!important;-webkit-backdrop-filter:${webkitFilter}!important}
    .property-case[data-capability="basic"] .player-glass-btn{background:${baseTint}!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
    .property-case[data-capability="basic"] .liquid-glass-edge{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
    .property-case[data-pointer="coarse"] .workout-card .liquid-glass-edge{display:none!important}`;
}

function measurementScript(widthCases) {
  return `(() => {
    document.body.dataset.propertyHarnessState = 'started';
    const expectedCases = ${JSON.stringify(widthCases)};
    const eligibleDefinitions = ${JSON.stringify(ELIGIBLE)};
    const expectedByIndex = new Map(expectedCases.map(item => [String(item.index), item]));
    const encodePayload = value => {
      const bytes = new TextEncoder().encode(value); let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 32768) binary += Array.from(bytes.subarray(offset, offset + 32768), byte => String.fromCharCode(byte)).join('');
      return btoa(binary);
    };
    const css = (style, property) => style.getPropertyValue(property).trim();
    const rect = element => { const value = element.getBoundingClientRect();
      return { left:value.left, right:value.right, top:value.top, bottom:value.bottom, width:value.width, height:value.height }; };
    const recipe = element => { const style = getComputedStyle(element); return {
      backgroundColor:css(style, 'background-color'), backdropFilter:css(style, 'backdrop-filter'),
      webkitBackdropFilter:css(style, '-webkit-backdrop-filter'), borderTopWidth:css(style, 'border-top-width'),
      borderTopStyle:css(style, 'border-top-style'), borderTopColor:css(style, 'border-top-color'),
      boxShadow:css(style, 'box-shadow'), isolation:css(style, 'isolation') }; };
    const edgeLayer = element => { const style = getComputedStyle(element); return {
      display:css(style, 'display'), position:css(style, 'position'), top:css(style, 'top'), right:css(style, 'right'),
      bottom:css(style, 'bottom'), left:css(style, 'left'), borderRadius:css(style, 'border-radius'),
      backdropFilter:css(style, 'backdrop-filter'), webkitBackdropFilter:css(style, '-webkit-backdrop-filter'),
      webkitMaskImage:css(style, '-webkit-mask-image'), maskImage:css(style, 'mask-image'),
      pointerEvents:css(style, 'pointer-events'), zIndex:css(style, 'z-index'), rect:rect(element),
      ariaHidden:element.getAttribute('aria-hidden'), directParent:element.parentElement?.className || '' }; };
    const pseudoLayer = (element, pseudo) => { const style = getComputedStyle(element, pseudo); return {
      content:css(style, 'content'), position:css(style, 'position'), top:css(style, 'top'), right:css(style, 'right'),
      bottom:css(style, 'bottom'), left:css(style, 'left'), borderRadius:css(style, 'border-radius'),
      padding:css(style, 'padding'), backgroundImage:css(style, 'background-image'),
      webkitMaskImage:css(style, '-webkit-mask-image'), maskImage:css(style, 'mask-image'),
      webkitMaskComposite:css(style, '-webkit-mask-composite'), maskComposite:css(style, 'mask-composite'),
      mixBlendMode:css(style, 'mix-blend-mode'), pointerEvents:css(style, 'pointer-events'), zIndex:css(style, 'z-index') }; };
    const contentLayer = element => { const style = getComputedStyle(element); return {
      tag:element.tagName.toLowerCase(), classes:[...element.classList], text:element.textContent,
      opacity:css(style, 'opacity'), zIndex:css(style, 'z-index'), position:css(style, 'position'),
      backdropFilter:css(style, 'backdrop-filter'), webkitBackdropFilter:css(style, '-webkit-backdrop-filter') }; };
    const identify = element => element.matches('.exercise-method-pill') ? 'method-badge'
      : element.matches('.method-tooltip') ? 'method-tooltip'
      : element.matches('[data-stat-type="series"]') ? 'metric-series'
      : element.matches('[data-stat-type="reps"]') ? 'metric-reps'
      : element.matches('.stat-details') ? 'reps-details'
      : element.matches('[data-stat-type="rest"]') ? 'metric-rest'
      : element.matches('.completion-toggle-wrapper') ? 'pending-cta' : 'unknown';
    const measure = container => {
      const generated = expectedByIndex.get(container.dataset.propertyIndex);
      if (!generated) throw new Error('Missing generated case ' + container.dataset.propertyIndex);
      const card = container.querySelector('.workout-card');
      const reference = container.querySelector('.canonical-reference');
      const referenceEdge = reference.querySelector(':scope > .liquid-glass-edge');
      if (!card || !reference || !referenceEdge) throw new Error('Missing card or canonical probe');
      const definitions = eligibleDefinitions.filter(item => !item.pendingOnly || generated.state === 'pending');
      const eligible = definitions.map(definition => {
        const surface = card.querySelector(definition.selector);
        if (!surface) throw new Error('Missing eligible surface ' + definition.key);
        const edge = surface.querySelector(':scope > .liquid-glass-edge');
        if (!edge) throw new Error('Missing direct edge for ' + definition.key);
        reference.style.borderRadius = getComputedStyle(surface).borderRadius;
        return { key:definition.key, classList:[...surface.classList], recipe:recipe(surface), reference:recipe(reference),
          edge:edgeLayer(edge), referenceEdge:edgeLayer(referenceEdge), before:pseudoLayer(surface, '::before'),
          referenceBefore:pseudoLayer(reference, '::before'), after:pseudoLayer(surface, '::after'),
          referenceAfter:pseudoLayer(reference, '::after'), surfaceRect:rect(surface),
          content:[...surface.querySelectorAll(definition.content)].map(contentLayer) };
      });
      const inventory = [...card.querySelectorAll('.player-glass-btn,.liquid-glass')].map(identify);
      const selected = card.matches(generated.selector) ? card : card.querySelector(generated.selector);
      if (!selected) throw new Error('Missing generated subject ' + generated.subjectKey);
      return { caseIndex:Number(container.dataset.propertyIndex), inventory, eligible,
        selected:{ key:generated.subjectKey, eligible:generated.eligible, classList:[...selected.classList],
          recipe:recipe(selected), directEdges:selected.querySelectorAll(':scope > .liquid-glass-edge').length } };
    };
    try {
      document.querySelectorAll('img').forEach(image => { image.removeAttribute('src'); image.removeAttribute('data-src'); image.dataset.harnessMedia = 'stable'; });
      const results = [...document.querySelectorAll('.property-case')].map(container => {
        try { return { ok:true, measurement:measure(container) }; }
        catch (error) { return { ok:false, caseIndex:Number(container.dataset.propertyIndex), error:error.stack || error.message }; }
      });
      document.body.dataset.propertyResults = encodePayload(JSON.stringify(results));
      document.body.dataset.propertyHarnessState = 'complete';
    } catch (error) {
      document.body.dataset.propertyHarnessState = 'error';
      document.body.dataset.propertyError = encodePayload(error.stack || error.message);
    }
  })();`;
}

function groupedDocument(widthCases) {
  const documents = widthCases.map(item => renderFixtureDocument({
    id:`property-07-${item.index}`, width:item.width, context:item.context, pointer:item.pointer,
    motion:'full', capability:item.capability, state:item.state
  }));
  const fixtures = documents.map((document, index) => {
    const item = widthCases[index];
    return `<section class="property-case" data-property-index="${item.index}" data-capability="${item.capability}" data-pointer="${item.pointer}">${extractFixtureMarkup(document)}<div class="canonical-probe-host"><div class="canonical-reference player-glass-btn"><span class="liquid-glass-edge" aria-hidden="true"></span><i></i><span>canonical</span></div></div></section>`;
  }).join('\n');
  return `<!doctype html><html lang="pt-BR"><head>${extractHead(documents[0])}<style>
    body{display:block!important;padding:24px!important;box-sizing:border-box!important}
    .property-case{width:min(100%,560px);margin:0 auto 32px}.property-case .harness-main{width:100%}
    .property-case .hf-week-sheet{position:relative!important;inset:auto!important;z-index:auto!important;overflow:visible!important;width:100%!important}
    .property-case .hf-week-sheet__panel{width:100%!important}${capabilityCss()}</style></head><body>${fixtures}<script>${measurementScript(widthCases)}</script></body></html>`;
}

function runWidthGroup(widthCases) {
  writeFileSync(TEMP_PATH, groupedDocument(widthCases), 'utf8');
  const width = widthCases[0].width;
  const diagnostics = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const profilePath = `${TEMP_PATH}.chrome-${process.pid}-${width}-${attempt}`;
    rmSync(profilePath, { recursive:true, force:true });
    const result = spawnSync(CHROME, ['--headless=new', '--hide-scrollbars', '--disable-background-networking',
      '--disable-extensions', '--disable-component-update', '--disable-default-apps', '--disable-sync',
      '--metrics-recording-only', '--no-first-run', '--host-resolver-rules=MAP * ~NOTFOUND',
      `--user-data-dir=${profilePath}`, `--window-size=${width},7500`, '--dump-dom', pathToFileURL(TEMP_PATH).href],
    { encoding:'utf8', timeout:15_000, maxBuffer:32 * 1024 * 1024 });
    rmSync(profilePath, { recursive:true, force:true });
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const stateMatch = stdout.match(/data-property-harness-state="([^"]+)"/);
    const errorMatch = stdout.match(/data-property-error="([A-Za-z0-9+/=]+)"/);
    const payloadMatch = stdout.match(/data-property-results="([A-Za-z0-9+/=]+)"/);
    if (errorMatch) {
      const error = new Error(`Chromium glass harness errored at width ${width}: ${Buffer.from(errorMatch[1], 'base64').toString('utf8')}`);
      error.observed = { width, attempt, harnessState:stateMatch?.[1] || 'missing' };
      throw error;
    }
    if (result.status === 0 && stateMatch?.[1] === 'complete' && payloadMatch) {
      try {
        const parsed = JSON.parse(Buffer.from(payloadMatch[1], 'base64').toString('utf8'));
        if (!Array.isArray(parsed)) throw new Error('Decoded payload is not an array');
        return parsed;
      } catch (payloadError) {
        diagnostics.push({ attempt, status:result.status, payloadError:payloadError.message });
        continue;
      }
    }
    diagnostics.push({ attempt, status:result.status, signal:result.signal || null,
      spawnError:result.error?.message || null, harnessState:stateMatch?.[1] || 'missing',
      stdoutBytes:Buffer.byteLength(stdout), stderrBytes:Buffer.byteLength(stderr), stderrTail:stderr.slice(-1200) });
  }
  const error = new Error(`Chromium glass harness produced no conclusive payload at width ${width}`);
  error.observed = { width, diagnostics };
  throw error;
}

const exact = value => JSON.stringify(value);
const without = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
const normalizeUnsupportedFilter = value => value === '' || value === 'none' ? 'none' : value;
function assertLayerEquality(testCase, surface) {
  requireInvariant(exact(surface.recipe) === exact(surface.reference),
    `${surface.key} must equal the complete canonical surface recipe`,
    { capability:testCase.capability, expected:surface.reference, actual:surface.recipe });
  const ignoredEdge = ['display','rect','directParent','ariaHidden'];
  requireInvariant(exact(without(surface.edge, ignoredEdge)) === exact(without(surface.referenceEdge, ignoredEdge)),
    `${surface.key} rim must equal the canonical edge recipe exactly`,
    { expected:without(surface.referenceEdge, ignoredEdge), actual:without(surface.edge, ignoredEdge) });
  requireInvariant(exact(surface.before) === exact(surface.referenceBefore),
    `${surface.key} fringe must equal the canonical ::before recipe exactly`,
    { expected:surface.referenceBefore, actual:surface.before });
  requireInvariant(exact(surface.after) === exact(surface.referenceAfter),
    `${surface.key} sheen must equal the canonical ::after recipe exactly`,
    { expected:surface.referenceAfter, actual:surface.after });
  requireInvariant(surface.edge.ariaHidden === 'true' && surface.edge.pointerEvents === 'none',
    `${surface.key} rim must be aria-hidden and pointer-inert`, surface.edge);
  const rimHidden = testCase.width <= 767 || testCase.pointer === 'coarse';
  requireInvariant(surface.edge.display === (rimHidden ? 'none' : surface.referenceEdge.display),
    `${surface.key} rim visibility must follow only the compact/coarse confinement branch`,
    { width:testCase.width, pointer:testCase.pointer, expected:rimHidden ? 'none' : surface.referenceEdge.display,
      actual:surface.edge.display });
  if (!rimHidden) {
    // Geometry alone permits Chromium's fractional layout rounding. The 0.75 CSS px
    // tolerance matches the existing responsive harnesses and is not used for recipe,
    // pseudo-manifest, content, allowlist, pointer, or z-order equality.
    const subpixelTolerance = 0.75;
    const canonicalBorderWidth = Number.parseFloat(surface.recipe.borderTopWidth);
    const insets = {
      left:surface.edge.rect.left - surface.surfaceRect.left,
      top:surface.edge.rect.top - surface.surfaceRect.top,
      right:surface.surfaceRect.right - surface.edge.rect.right,
      bottom:surface.surfaceRect.bottom - surface.edge.rect.bottom
    };
    requireInvariant(Number.isFinite(canonicalBorderWidth)
      && Object.values(insets).every(inset => inset >= -subpixelTolerance),
    `${surface.key} visible rim bounds must not escape its owner`,
    { tolerance:subpixelTolerance, surface:surface.surfaceRect, edge:surface.edge.rect, insets });
    requireInvariant(Object.values(insets).every(inset => inset <= canonicalBorderWidth + subpixelTolerance),
      `${surface.key} visible rim inset must be bounded by its canonical computed border`,
      { tolerance:subpixelTolerance, canonicalBorderWidth, insets,
        surface:surface.surfaceRect, edge:surface.edge.rect });
  }
  for (const [name, layer] of [['rim', surface.edge], ['fringe', surface.before], ['sheen', surface.after]]) {
    requireInvariant(layer.top === '0px' && layer.right === '0px' && layer.bottom === '0px' && layer.left === '0px'
      && layer.borderRadius === surface.before.borderRadius && layer.pointerEvents === 'none',
    `${surface.key} ${name} layer must be inset, radius-confined, and pointer-inert`, layer);
  }
  requireInvariant(surface.content.length > 0, `${surface.key} must retain measurable opaque content`, surface.content);
  surface.content.forEach(content => {
    requireInvariant(content.opacity === '1' && Number(content.zIndex) >= 2,
      `${surface.key} content must remain fully opaque above material layers`, content);
    requireInvariant(normalizeUnsupportedFilter(content.backdropFilter) === 'none'
      && normalizeUnsupportedFilter(content.webkitBackdropFilter) === 'none',
      `${surface.key} content must not receive Liquid Glass itself`, content);
  });
}

function assertCapability(testCase, surface) {
  const filter = surface.reference.backdropFilter;
  const edgeFilter = surface.referenceEdge.backdropFilter;
  if (testCase.capability === 'basic') {
    requireInvariant(filter === 'none' && edgeFilter === 'none',
      'basic fallback must omit unsupported filters while retaining the rest of the canonical recipe', { filter, edgeFilter });
  } else if (testCase.capability === 'webkit') {
    requireInvariant(!filter.includes('url(') && filter !== 'none' && edgeFilter !== 'none',
      'WebKit branch must retain canonical base blur and optical rim without SVG refraction', { filter, edgeFilter });
  } else {
    const expectedId = testCase.width <= 768 ? 'liquid-glass-refract-soft' : 'liquid-glass-refract';
    requireInvariant(filter.includes(expectedId) && (expectedId.endsWith('-soft') || !filter.includes('refract-soft')),
      'Chromium branch must select the exact canonical full/soft refraction filter',
      { width:testCase.width, expectedId, filter });
  }
}

function assertMeasurement(testCase, measurement) {
  requireInvariant(measurement.caseIndex === testCase.index,
    'harness result must retain its generated case index', { expected:testCase.index, actual:measurement.caseIndex });
  const expectedInventory = ELIGIBLE.filter(item => !item.pendingOnly || testCase.state === 'pending').map(item => item.key);
  requireInvariant(exact(measurement.inventory) === exact(expectedInventory),
    'only the explicit allowlist may carry canonical material classes',
    { state:testCase.state, expected:expectedInventory, actual:measurement.inventory });
  requireInvariant(measurement.eligible.length === expectedInventory.length,
    'every allowlisted surface must be checked all-or-nothing', measurement.eligible.map(item => item.key));
  measurement.eligible.forEach(surface => { assertLayerEquality(testCase, surface); assertCapability(testCase, surface); });
  if (testCase.eligible) {
    requireInvariant(measurement.selected.classList.includes('player-glass-btn')
      && measurement.selected.directEdges === 1,
    'generated eligible subject must carry one complete canonical material', measurement.selected);
  } else {
    requireInvariant(!measurement.selected.classList.includes('player-glass-btn')
      && !measurement.selected.classList.includes('liquid-glass')
      && measurement.selected.directEdges === 0
      && normalizeUnsupportedFilter(measurement.selected.recipe.backdropFilter) === 'none'
      && normalizeUnsupportedFilter(measurement.selected.recipe.webkitBackdropFilter) === 'none',
    'generated noneligible subject must have no material class, edge, blur, or refraction', measurement.selected);
  }
}

function persistFailure(testCase, error) {
  const record = {
    feature:FEATURE, property:PROPERTY, seed:SEED,
    seedHex:`0x${SEED.toString(16).padStart(8, '0')}`, combinations:cases.length,
    canonicalManifestSha256:MANIFEST_HASH, counterexample:testCase,
    assertion:error.assertion || error.message, observed:error.observed || null,
    replay:`HF_PBT_SEED=${SEED} node tests/workout-card-premium-redesign/property-07-glass-fidelity.test.mjs`
  };
  writeFileSync(FAILURE_PATH, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  console.error(`COUNTEREXAMPLE ${JSON.stringify(record)}`);
  return record;
}

let checked = 0;
let activeCase = { kind:'manifest-and-generation-contract' };
try {
  if (!CHROME) throw new Error('A local Chromium executable is required by the existing property harness');
  assertManifest();
  for (const width of BREAKPOINT_WIDTHS) {
    const widthCases = cases.filter(item => item.width === width);
    activeCase = { kind:'browser-harness', width, generatedCases:widthCases.length };
    const results = runWidthGroup(widthCases);
    requireInvariant(results.length === widthCases.length,
      'browser harness must return exactly one result per generated case',
      { width, expected:widthCases.length, actual:results.length });
    results.forEach((result, index) => {
      activeCase = widthCases[index];
      requireInvariant(result.ok, 'browser must measure every generated fixture exactly', result.error);
      assertMeasurement(activeCase, result.measurement);
      checked += 1;
    });
  }
  rmSync(FAILURE_PATH, { force:true });
  console.log(`PASS - Feature: ${FEATURE}, ${PROPERTY}`);
  console.log(`Seed: ${SEED} (0x${SEED.toString(16).padStart(8, '0')}); combinations: ${checked}; manifest: sha256:${MANIFEST_HASH}`);
  console.log(`Coverage: ${subjects.length} eligible/noneligible subjects × ${capabilities.length} capability branches × 2; counterexample: none`);
} catch (error) {
  persistFailure(activeCase, error);
  process.exitCode = 1;
} finally {
  rmSync(TEMP_PATH, { force:true });
}
