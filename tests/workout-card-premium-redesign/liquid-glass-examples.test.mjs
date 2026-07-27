// Targeted canonical Liquid Glass/fallback examples for task 11.3.
// Usage: node tests/workout-card-premium-redesign/liquid-glass-examples.test.mjs
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  INDEX_PATH, PLAYER_CSS_PATH, renderFixtureDocument
} from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(INDEX_PATH, 'utf8');
const playerCss = readFileSync(PLAYER_CSS_PATH, 'utf8');
const CHROME = [
  process.env.HF_CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean).find(existsSync);
const ENVIRONMENTS = Object.freeze([
  { id: 'chromium', width: 769, context: 'main', pointer: 'fine', capability: 'chromium', branch: 'chromium' },
  { id: 'chromium-soft', width: 768, context: 'main', pointer: 'fine', capability: 'chromium', branch: 'chromium-soft' },
  { id: 'webkit', width: 769, context: 'main', pointer: 'fine', capability: 'webkit', branch: 'webkit' },
  { id: 'no-filter', width: 769, context: 'main', pointer: 'fine', capability: 'basic', branch: 'basic' },
  { id: 'week-sheet', width: 769, context: 'week-sheet', pointer: 'fine', capability: 'chromium', branch: 'chromium' },
  { id: 'mobile', width: 639, context: 'week-sheet', pointer: 'fine', capability: 'chromium', branch: 'chromium-soft', hideRim: true },
  { id: 'coarse', width: 769, context: 'week-sheet', pointer: 'coarse', capability: 'chromium', branch: 'chromium', hideRim: true }
]);
const MATERIAL_KEYS = Object.freeze([
  'backgroundColor', 'backdropFilter', 'webkitBackdropFilter', 'borderTopWidth',
  'borderTopStyle', 'borderTopColor', 'boxShadow', 'isolation'
]);
const EDGE_KEYS = Object.freeze([
  'display', 'position', 'backdropFilter', 'webkitBackdropFilter',
  'top', 'right', 'bottom', 'left', 'webkitMaskImage', 'maskImage',
  'pointerEvents', 'zIndex'
]);
const PSEUDO_KEYS = Object.freeze([
  'content', 'position', 'top', 'right', 'bottom', 'left', 'paddingTop',
  'backgroundImage', 'webkitMaskImage', 'maskImage', 'pointerEvents',
  'zIndex', 'mixBlendMode'
]);
let checks = 0;
let failures = 0;
function check(name, condition, detail = '') {
  checks += 1;
  if (!condition) failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'} - ${name}${condition || !detail ? '' : `: ${detail}`}`);
}
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const pick = (record, keys) => Object.fromEntries(keys.map(key => [key, record[key]]));
const noFilter = value => value === undefined || value === '' || value === 'none';

function balancedBlock(source, marker, from = 0) {
  const markerIndex = source.indexOf(marker, from);
  if (markerIndex < 0) throw new Error(`Canonical CSS marker not found: ${marker}`);
  const open = source.indexOf('{', markerIndex + marker.length);
  if (open < 0) throw new Error(`Canonical CSS block has no opening brace: ${marker}`);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) {
      return { markerIndex, open, close: index, body: source.slice(open + 1, index) };
    }
  }
  throw new Error(`Unterminated canonical CSS block: ${marker}`);
}

function declarations(block) {
  const result = {};
  let token = '';
  let depth = 0;
  let quote = null;
  const entries = [];
  for (const character of `${block};`) {
    if (quote) {
      token += character;
      if (character === quote && !token.endsWith(`\\${quote}`)) quote = null;
      continue;
    }
    if (character === '"' || character === "'") { quote = character; token += character; }
    else if (character === '(') { depth += 1; token += character; }
    else if (character === ')') { depth -= 1; token += character; }
    else if (character === ';' && depth === 0) { entries.push(token.trim()); token = ''; }
    else token += character;
  }
  for (const entry of entries) {
    const colon = entry.indexOf(':');
    if (colon < 0) continue;
    const property = entry.slice(0, colon).trim();
    const value = entry.slice(colon + 1).trim().replace(/\s+/g, ' ');
    if (property) result[property] = value;
  }
  return result;
}

function ruleDeclarations(source, marker, from = 0) {
  return declarations(balancedBlock(source, marker, from).body);
}

function parseCanonicalManifest() {
  const start = playerCss.indexOf('/* ===== Liquid Glass — material reutilizável');
  const end = playerCss.indexOf('/* Player Modal e Screens */', start);
  if (start < 0 || end < 0) throw new Error('Canonical Liquid Glass manifest section is missing');
  const canonical = playerCss.slice(start, end);
  const support = balancedBlock(canonical,
    '@supports (backdrop-filter: url(#liquid-glass-refract)) and (background: paint(liquid-glass-probe))');
  const supportCss = support.body;
  const soft = balancedBlock(supportCss, '@media (max-width: 768px)');
  return Object.freeze({
    sourceStart: start,
    sourceEnd: end,
    base: ruleDeclarations(canonical, '.liquid-glass,'),
    neutral: ruleDeclarations(canonical, '.player-glass-btn {'),
    chromium: ruleDeclarations(supportCss, '.liquid-glass,'),
    chromiumNeutral: ruleDeclarations(supportCss, '.player-glass-btn {'),
    soft: ruleDeclarations(soft.body, '.liquid-glass,'),
    edge: ruleDeclarations(canonical, '.liquid-glass .liquid-glass-edge,'),
    before: ruleDeclarations(canonical, '.liquid-glass::before,'),
    after: ruleDeclarations(canonical, '.liquid-glass::after,'),
    content: ruleDeclarations(canonical, '.liquid-glass > i,')
  });
}

const manifest = parseCanonicalManifest();
const cssText = declarationsMap => Object.entries(declarationsMap)
  .map(([property, value]) => `${property}:${value}`).join(';');
const branchFilter = environment => environment.branch === 'chromium-soft'
  ? manifest.soft['backdrop-filter']
  : environment.branch === 'chromium' ? manifest.chromium['backdrop-filter']
    : environment.branch === 'basic' ? 'none' : manifest.base['backdrop-filter'];
const branchBackground = environment => ['chromium', 'chromium-soft'].includes(environment.branch)
  ? manifest.chromiumNeutral.background : manifest.neutral.background;
function completedMarkup(environment) {
  const html = renderFixtureDocument({ ...environment, state: 'completed', id: `${environment.id}-completed` });
  const match = html.match(/<article class="workout-card[\s\S]*?<\/article>/);
  if (!match) throw new Error('Completed real-renderer card markup was not found');
  return match[0];
}

function branchOverrideCss(environment) {
  const surface = '.workout-card .player-glass-btn';
  const edge = '.workout-card .liquid-glass-edge';
  const declarationsList = [];
  if (environment.branch === 'webkit') {
    declarationsList.push(`${surface}{background:${manifest.neutral.background}!important;backdrop-filter:${manifest.base['backdrop-filter']}!important;-webkit-backdrop-filter:${manifest.base['-webkit-backdrop-filter']}!important}`);
  }
  if (environment.branch === 'basic') {
    declarationsList.push(`${surface}{background:${manifest.neutral.background}!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}`);
    declarationsList.push(`${edge}{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}`);
  }
  // The standalone harness exposes pointer capability through a deterministic
  // data attribute; mirror the production (pointer: coarse) branch exactly.
  if (environment.pointer === 'coarse') declarationsList.push(`${edge}{display:none!important}`);
  return declarationsList.join('\n');
}

function collectorScript(environment) {
  const expectedSurface = {
    ...manifest.base,
    background: branchBackground(environment),
    'backdrop-filter': branchFilter(environment),
    '-webkit-backdrop-filter': branchFilter(environment)
  };
  if (environment.branch === 'basic') {
    expectedSurface['backdrop-filter'] = 'none';
    expectedSurface['-webkit-backdrop-filter'] = 'none';
  }
  const expectedEdge = { ...manifest.edge };
  if (environment.branch === 'basic') {
    expectedEdge['backdrop-filter'] = 'none';
    expectedEdge['-webkit-backdrop-filter'] = 'none';
  }
  if (environment.hideRim) expectedEdge.display = 'none';

  return `(() => {
    const environment = ${JSON.stringify(environment)};
    const manifest = ${JSON.stringify(manifest)};
    const expected = ${JSON.stringify({ surface: expectedSurface, edge: expectedEdge })};
    const completedHost = document.createElement('div');
    completedHost.innerHTML = ${JSON.stringify(completedMarkup(environment))};
    const completedCard = completedHost.firstElementChild;
    completedCard.dataset.materialCard = 'completed';
    document.querySelector('#workout-details').append(completedCard);
    const pendingCard = document.querySelector('.workout-card:not(.exercise-completed)');
    pendingCard.dataset.materialCard = 'pending';

    const camel = property => property.replace(/^-webkit-/, 'webkit-').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const apply = (element, values) => Object.entries(values).forEach(([property, value]) => {
      element.style.setProperty(property, value);
    });
    const probe = document.createElement('div');
    probe.id = 'canonical-material-probe';
    probe.style.cssText = 'position:absolute;left:-10000px;top:0;width:180px;height:80px;border-radius:16px';
    apply(probe, expected.surface);
    const probeEdge = document.createElement('span');
    probeEdge.className = 'probe-edge';
    apply(probeEdge, expected.edge);
    probe.append(probeEdge);
    const probeContent = document.createElement('span');
    probeContent.textContent = 'Probe';
    apply(probeContent, manifest.content);
    probe.append(probeContent);
    const pseudoStyle = document.createElement('style');
    pseudoStyle.textContent = ${JSON.stringify(`#canonical-material-probe::before{${cssText(manifest.before)}}#canonical-material-probe::after{${cssText(manifest.after)}}`)};
    document.head.append(pseudoStyle);
    document.body.append(probe);

    const styleRecord = style => ({
      position: style.position, display: style.display, backgroundColor: style.backgroundColor,
      backdropFilter: style.backdropFilter, webkitBackdropFilter: style.webkitBackdropFilter,
      borderTopWidth: style.borderTopWidth, borderTopStyle: style.borderTopStyle,
      borderTopColor: style.borderTopColor, boxShadow: style.boxShadow,
      isolation: style.isolation, overflow: style.overflow, borderRadius: style.borderRadius,
      content: style.content, top: style.top, right: style.right, bottom: style.bottom, left: style.left,
      paddingTop: style.paddingTop, backgroundImage: style.backgroundImage,
      webkitMaskImage: style.webkitMaskImage, maskImage: style.maskImage,
      pointerEvents: style.pointerEvents, zIndex: style.zIndex, mixBlendMode: style.mixBlendMode,
      opacity: style.opacity, color: style.color
    });
    const computed = (element, pseudo = null) => styleRecord(getComputedStyle(element, pseudo));
    const round = value => Math.round(value * 1000) / 1000;
    const rect = element => {
      const value = element.getBoundingClientRect();
      return { left: round(value.left), top: round(value.top), right: round(value.right),
        bottom: round(value.bottom), width: round(value.width), height: round(value.height) };
    };
    const contentSnapshot = surface => [...surface.querySelectorAll('i, .method-label, .stat-label, .stat-value, .stat-helper, .stat-progress-bar, .stat-progress-fill, .animated-check-container, :scope > span:not(.liquid-glass-edge)')]
      .filter(element => element.closest('.player-glass-btn') === surface)
      .map(element => {
        let layer = element;
        while (layer.parentElement && layer.parentElement !== surface) layer = layer.parentElement;
        return { tag: element.tagName.toLowerCase(), classes: [...element.classList], text: element.textContent.trim(),
          style: computed(element), layerStyle: computed(layer) };
      });
    const surfaceSnapshot = (id, element) => {
      const edge = element.querySelector(':scope > .liquid-glass-edge');
      return { id, classes: [...element.classList], rect: rect(element), style: computed(element),
        edge: edge ? { style: computed(edge), rect: rect(edge), ariaHidden: edge.getAttribute('aria-hidden'),
          firstChild: element.firstElementChild === edge } : null,
        before: computed(element, '::before'), after: computed(element, '::after'),
        content: contentSnapshot(element) };
    };
    const surfaces = [
      ['method-badge', pendingCard.querySelector('[data-method-badge]')],
      ['method-tooltip', pendingCard.querySelector('.method-tooltip')],
      ['series', pendingCard.querySelector('[data-stat-type="series"]')],
      ['reps', pendingCard.querySelector('[data-stat-type="reps"]')],
      ['reps-details', pendingCard.querySelector('.stat-details')],
      ['rest', pendingCard.querySelector('[data-stat-type="rest"]')],
      ['pending-cta', pendingCard.querySelector('.completion-toggle-wrapper')]
    ].map(([id, element]) => surfaceSnapshot(id, element));
    const outside = [
      ['host', pendingCard], ['image', pendingCard.querySelector('.exercise-card-image')],
      ['scrim', pendingCard.querySelector(':scope > .absolute.inset-0 > .bg-gradient-to-t')],
      ['title', pendingCard.querySelector('h3')], ['metric-group', pendingCard.querySelector('.exercise-stats-chip-group')],
      ['completed-cta', completedCard.querySelector('.completion-toggle-wrapper')],
      ['series-progress', pendingCard.querySelector('[data-stat-type="series"] .stat-progress-bar')],
      ['series-fill', pendingCard.querySelector('[data-stat-type="series"] .stat-progress-fill')],
      ['check-svg', pendingCard.querySelector('.animated-check-svg')],
      ['method-icon', pendingCard.querySelector('.method-icon')],
      ['title-text', pendingCard.querySelector('h3')]
    ].map(([id, element]) => ({ id, classes: [...element.classList], style: computed(element),
      before: computed(element, '::before'), after: computed(element, '::after'),
      directEdge: Boolean(element.querySelector(':scope > .liquid-glass-edge')) }));
    const reference = { style: computed(probe), edge: { style: computed(probeEdge) },
      before: computed(probe, '::before'), after: computed(probe, '::after'), content: computed(probeContent) };
    const result = { environment, surfaces, outside, reference,
      counts: { pending: pendingCard.querySelectorAll('.player-glass-btn').length,
        completed: completedCard.querySelectorAll('.player-glass-btn').length } };
    document.body.dataset.liquidGlassResults = btoa(unescape(encodeURIComponent(JSON.stringify(result))));
  })();`;
}
function runEnvironment(environment) {
  if (!CHROME) throw new Error('A local Chromium executable is required by the deterministic harness');
  const errorCapture = `<script>window.addEventListener('error',event=>{document.body.dataset.liquidGlassError=btoa(unescape(encodeURIComponent(event.message+' @ '+event.filename+':'+event.lineno+':'+event.colno)))})</script>`;
  const html = renderFixtureDocument({ ...environment, state: 'pending', id: `liquid-glass-${environment.id}` })
    .replace('</head>', `<style>${branchOverrideCss(environment)}</style></head>`)
    .replace('</body>', `${errorCapture}<script>${collectorScript(environment)}</script></body>`);
  const tempPath = join(HERE, `.tmp-liquid-glass-${environment.id}.html`);
  writeFileSync(tempPath, html, 'utf8');
  try {
    const run = spawnSync(CHROME, [
      '--headless=new', '--hide-scrollbars', '--disable-background-networking', '--disable-component-update',
      '--disable-default-apps', '--disable-sync', '--metrics-recording-only', '--no-first-run',
      '--host-resolver-rules=MAP * ~NOTFOUND', '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=1200', `--window-size=${environment.width},1800`, '--dump-dom', pathToFileURL(tempPath).href
    ], { encoding: 'utf8', timeout: 30000, maxBuffer: 24 * 1024 * 1024 });
    const match = run.stdout.match(/data-liquid-glass-results="([A-Za-z0-9+/=]+)"/);
    if (run.status !== 0 || !match) {
      const browserError = run.stdout.match(/data-liquid-glass-error="([A-Za-z0-9+/=]+)"/);
      const detail = browserError
        ? Buffer.from(browserError[1], 'base64').toString('utf8')
        : `stdout tail: ${run.stdout.slice(-1200)}`;
      throw new Error(`${environment.id} material collection failed (exit ${run.status}): ${detail}; stderr: ${run.stderr.slice(-600)}`);
    }
    return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
  } finally {
    rmSync(tempPath, { force: true });
  }
}

function equalRects(left, right, tolerance = 0.75) {
  return ['left', 'top', 'right', 'bottom', 'width', 'height']
    .every(key => Math.abs(left[key] - right[key]) <= tolerance);
}
function parseColor(value) {
  const match = String(value).match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/);
  return match ? { rgb: match.slice(1, 4).map(Number), alpha: match[4] === undefined ? 1 : Number(match[4]) } : null;
}
function composite(color, background = [9, 9, 13]) {
  const parsed = parseColor(color);
  return parsed ? parsed.rgb.map((channel, index) => channel * parsed.alpha + background[index] * (1 - parsed.alpha)) : null;
}
function luminance(rgb) {
  const channels = rgb.map(value => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
function contrast(color, background = [9, 9, 13]) {
  const foreground = composite(color, background);
  if (!foreground) return Infinity;
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

console.log('\nCanonical player.css manifest');
check('real player.css canonical section was parsed (not copied into the test)',
  manifest.sourceStart >= 0 && manifest.sourceEnd > manifest.sourceStart
    && manifest.base['backdrop-filter'] && manifest.edge['backdrop-filter']
    && manifest.before.background && manifest.after.background);
check('parsed manifest contains the complete base material contract',
  manifest.base.position === 'relative'
    && manifest.base.border === '1px solid transparent'
    && manifest.base.isolation === 'isolate' && manifest.base.overflow === 'visible'
    && manifest.neutral.background === 'rgba(0, 0, 0, 0.22)');
check('parsed manifest contains Chromium full/soft and WebKit-compatible recipes',
  manifest.chromium['backdrop-filter'].includes('url(#liquid-glass-refract)')
    && manifest.soft['backdrop-filter'].includes('url(#liquid-glass-refract-soft)')
    && manifest.base['-webkit-backdrop-filter'] === manifest.base['backdrop-filter']);
check('parsed decoration/content layer manifest is pointer-inert and ordered',
  manifest.edge['pointer-events'] === 'none' && manifest.edge['z-index'] === '0'
    && manifest.before['pointer-events'] === 'none' && manifest.before['z-index'] === '3'
    && manifest.after['pointer-events'] === 'none' && manifest.after['z-index'] === '1'
    && manifest.content.position === 'relative' && manifest.content['z-index'] === '2');

console.log('\nComputed material and fallback matrix');
let results = [];
try {
  results = ENVIRONMENTS.map(runEnvironment);
  check('all Chromium, WebKit, no-filter, week-sheet, mobile and coarse branches rendered',
    results.length === ENVIRONMENTS.length);
} catch (error) {
  check('standalone browser material matrix executed', false, error.stack || error.message);
}

for (const result of results) {
  const label = result.environment.id;
  check(`${label}: exact allowlist is present with no extra pending-card material`,
    result.surfaces.length === 7 && result.counts.pending === 7 && result.counts.completed === 6
      && same(result.surfaces.map(surface => surface.id),
        ['method-badge', 'method-tooltip', 'series', 'reps', 'reps-details', 'rest', 'pending-cta']),
    JSON.stringify(result.counts));
  for (const surface of result.surfaces) {
    const surfaceLabel = `${label}/${surface.id}`;
    check(`${surfaceLabel}: computed tint/filter/border/depth equals parsed canonical manifest`,
      same(pick(surface.style, MATERIAL_KEYS), pick(result.reference.style, MATERIAL_KEYS)),
      JSON.stringify({ actual: pick(surface.style, MATERIAL_KEYS), expected: pick(result.reference.style, MATERIAL_KEYS) }));
    check(`${surfaceLabel}: rim values equal the manifest and decoration is inert`,
      surface.edge?.ariaHidden === 'true' && surface.edge.firstChild
        && same(pick(surface.edge.style, EDGE_KEYS), pick(result.reference.edge.style, EDGE_KEYS)),
      JSON.stringify({ actual: pick(surface.edge?.style || {}, EDGE_KEYS), expected: pick(result.reference.edge.style, EDGE_KEYS) }));
    const rimConfined = surface.edge.style.display === 'none'
      || (surface.edge.rect.left >= surface.rect.left - 0.75
        && surface.edge.rect.top >= surface.rect.top - 0.75
        && surface.edge.rect.right <= surface.rect.right + 0.75
        && surface.edge.rect.bottom <= surface.rect.bottom + 0.75);
    check(`${surfaceLabel}: rim/fringe/sheen stay attached to the isolated surface bounds`,
      surface.style.isolation === 'isolate' && rimConfined
        && surface.before.position === 'absolute' && surface.after.position === 'absolute'
        && ['0px', '0'].includes(surface.before.top) && ['0px', '0'].includes(surface.before.right)
        && ['0px', '0'].includes(surface.before.bottom) && ['0px', '0'].includes(surface.before.left)
        && ['0px', '0'].includes(surface.after.top) && ['0px', '0'].includes(surface.after.right)
        && ['0px', '0'].includes(surface.after.bottom) && ['0px', '0'].includes(surface.after.left));
    check(`${surfaceLabel}: computed fringe and sheen exactly match parsed pseudo manifests`,
      same(pick(surface.before, PSEUDO_KEYS), pick(result.reference.before, PSEUDO_KEYS))
        && same(pick(surface.after, PSEUDO_KEYS), pick(result.reference.after, PSEUDO_KEYS)),
      JSON.stringify({ before: pick(surface.before, PSEUDO_KEYS), after: pick(surface.after, PSEUDO_KEYS) }));
    check(`${surfaceLabel}: opaque content/indicators remain above rim and sheen`,
      surface.content.length > 0 && surface.content.every(content => content.style.opacity === '1'
        && Number(content.layerStyle.zIndex) >= 2
        && Number(content.layerStyle.zIndex) > Number(surface.edge.style.zIndex)
        && Number(content.layerStyle.zIndex) > Number(surface.after.zIndex)),
      JSON.stringify(surface.content));
  }

  check(`${label}: excluded host/image/scrim/title/group/completed CTA/content have zero glass material`,
    result.outside.every(item => !item.classes.includes('player-glass-btn')
      && !item.classes.includes('liquid-glass') && !item.directEdge
      && noFilter(item.style.backdropFilter) && noFilter(item.style.webkitBackdropFilter)),
    JSON.stringify(result.outside.filter(item => item.classes.includes('player-glass-btn')
      || !['none', ''].includes(item.style.backdropFilter))));
}
const byId = id => results.find(result => result.environment.id === id);
const allSurfaceFilters = result => result?.surfaces.map(surface => surface.style.backdropFilter) || [];
const chromium = byId('chromium');
const soft = byId('chromium-soft');
const webkit = byId('webkit');
const basic = byId('no-filter');
const weekSheet = byId('week-sheet');
const mobile = byId('mobile');
const coarse = byId('coarse');

console.log('\nBranch-specific guarantees');
check('Chromium desktop selects the full refraction filter for every allowlisted surface',
  chromium && allSurfaceFilters(chromium).every(filter => filter.includes('liquid-glass-refract')
    && !filter.includes('liquid-glass-refract-soft')),
  JSON.stringify(allSurfaceFilters(chromium)));
check('Chromium at 768px selects only the canonical soft refraction filter',
  soft && allSurfaceFilters(soft).every(filter => filter.includes('liquid-glass-refract-soft')),
  JSON.stringify(allSurfaceFilters(soft)));
check('Safari/WebKit branch keeps canonical base blur and never selects SVG refraction',
  webkit && allSurfaceFilters(webkit).every(filter => filter === webkit.reference.style.backdropFilter
    && !filter.includes('url(')), JSON.stringify(allSurfaceFilters(webkit)));
check('week-sheet specificity exception preserves the exact Chromium recipe',
  chromium && weekSheet
    && same(weekSheet.surfaces.map(surface => pick(surface.style, MATERIAL_KEYS)),
      chromium.surfaces.map(surface => pick(surface.style, MATERIAL_KEYS))),
  JSON.stringify(allSurfaceFilters(weekSheet)));
check('mobile and coarse branches hide every 14px rim while retaining base surface material',
  mobile && coarse
    && [...mobile.surfaces, ...coarse.surfaces].every(surface => surface.edge.style.display === 'none')
    && allSurfaceFilters(mobile).every(filter => filter.includes('blur(4px)'))
    && allSurfaceFilters(coarse).every(filter => filter.includes('blur(4px)')));
check('no-filter fallback keeps parsed base tint/border/decorations with no backdrop filtering',
  basic && basic.surfaces.every(surface => noFilter(surface.style.backdropFilter)
    && noFilter(surface.style.webkitBackdropFilter)
    && surface.style.backgroundColor === basic.reference.style.backgroundColor
    && surface.style.borderTopWidth === '1px'
    && surface.before.content !== 'none' && surface.after.content !== 'none'));
if (basic) {
  const readableContent = basic.surfaces.flatMap(surface => surface.content)
    .filter(content => content.text.length > 0);
  check('no-filter fallback preserves opaque readable content contrast over the base surface',
    readableContent.length > 0 && readableContent.every(content => content.style.opacity === '1'
      && contrast(content.style.color) >= 3),
    JSON.stringify(readableContent.map(content => ({ text: content.text, color: content.style.color,
      contrast: contrast(content.style.color) }))));
}

console.log('\nProduction confinement/source contract');
check('real renderers add aria-hidden edge children only to existing eligible surfaces',
  /exercise-method-pill player-glass-btn[\s\S]*?<span class="liquid-glass-edge" aria-hidden="true"><\/span>/.test(indexSource)
    && /exercise-stat-button player-glass-btn/.test(indexSource)
    && /stat-details player-glass-btn/.test(indexSource)
    && /completion-toggle-wrapper \$\{isCompleted \? '' : 'player-glass-btn'\}/.test(indexSource));
check('week-sheet suppression explicitly exempts canonical player-glass surfaces',
  /exercise-stat-button:not\(\.player-glass-btn\)[\s\S]*?completion-toggle-wrapper:not\(\.player-glass-btn\)[\s\S]*?exercise-method-pill:not\(\.player-glass-btn\)/.test(indexSource));
check('production mobile/coarse rule hides only the rim, not the base material',
  /@media \(max-width: 767\.98px\), \(pointer: coarse\)\s*\{\s*\.workout-card \.liquid-glass-edge\s*\{\s*display:\s*none\s*!important;\s*\}/.test(indexSource));
check('workout-card CSS does not duplicate canonical material recipe values',
  !/\.workout-card[^{}]*player-glass-btn[^{}]*\{[^{}]*(?:saturate\(300%\)|brightness\(1\.5\)|blur\(14px\)|liquid-glass-refract)/s.test(indexSource));

console.log(failures
  ? `\nFAIL: ${failures} of ${checks} targeted canonical-material checks failed`
  : `\nPASS: all ${checks} targeted canonical-material checks passed`);
process.exit(failures ? 1 : 0);
