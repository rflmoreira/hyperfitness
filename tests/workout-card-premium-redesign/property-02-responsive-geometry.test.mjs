// Feature: workout-card-premium-redesign, Property 2: Geometria responsiva coordenada
// Usage: node tests/workout-card-premium-redesign/property-02-responsive-geometry.test.mjs
// Geometry uses a 0.75 CSS px tolerance: Chromium lays out fractional grid tracks
// and clamp()/vw results on a 1/64 CSS-pixel grid, then device-pixel conversion can
// expose a final fractional edge. The tolerance covers that subpixel rounding only.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  BREAKPOINT_WIDTHS, INDEX_PATH, renderFixtureDocument
} from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAILURE_PATH = join(HERE, '.property-02-responsive-geometry.failure.json');
const TEMP_PATH = join(HERE, '.tmp-property-02-responsive-geometry.html');
const FEATURE = 'workout-card-premium-redesign';
const PROPERTY = 'Property 2: Geometria responsiva coordenada';
const SUBPIXEL_TOLERANCE_PX = 0.75;
const CASES_PER_WIDTH = 8;
const DEFAULT_SEED = 0x48465032;
const requestedSeed = process.env.HF_PBT_SEED;
const parsedSeed = requestedSeed === undefined ? DEFAULT_SEED : Number(requestedSeed);
const SEED = Number.isFinite(parsedSeed) ? parsedSeed >>> 0 : DEFAULT_SEED;
const CHROME = [
  process.env.HF_CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean).find(existsSync);
const source = readFileSync(INDEX_PATH, 'utf8');

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
const contentProfiles = [
  () => ({
    profile: 'short', name: pick(['Remada', 'Leg Press 45', 'Barra Fixa']),
    series: pick(['3', '4']), rept: pick(['8', '10']), descanso: pick(['Livre', '45 seg']),
    method: pick(['Bi-set', 'Drop-set', 'Pausa'])
  }),
  () => ({
    profile: 'standard', name: pick(['Elevação Pélvica com Barra', 'Desenvolvimento Máquina Aberto']),
    series: pick(['4', '5']), rept: pick(['12/10/8', '20/18/15/12']), descanso: pick(['60 seg', '90 seg']),
    method: pick(['Pirâmide Crescente + Isometria', 'Rest Pause + Drop-set'])
  }),
  () => ({
    profile: 'unicode', name: pick(['Elevação lateral — ação contínua', 'Agachamento: ênfase excêntrica']),
    series: pick(['4', '6']), rept: pick(['12/10/8/6', '15 • 12 • 10']), descanso: pick(['75 seg', '1 min']),
    method: pick(['Ênfase excêntrica • Isometria', 'Contração máxima + ação 🔥'])
  }),
  () => ({
    profile: 'long', name: pick(['Rosca Martelo + Tríceps Francês com Corda', 'Agachamento Smith com Pausa Isométrica']),
    series: pick(['10', '12']), rept: pick(['20/18/15/12/10', '15/12/10/8/6']), descanso: pick(['2 min 30 seg', '120 seg']),
    method: pick(['Pirâmide Crescente + Isometria + Rest Pause', 'Bi-set + Drop-set + Pausa na última série'])
  })
];

const cases = [];
for (const width of BREAKPOINT_WIDTHS) {
  for (const context of ['main', 'week-sheet']) {
    for (let profileIndex = 0; profileIndex < contentProfiles.length; profileIndex += 1) {
      const generated = contentProfiles[profileIndex]();
      const { profile, ...exercise } = generated;
      cases.push({
        index: cases.length, width, context, profile, exercise,
        pointer: random() < 0.35 ? 'coarse' : 'fine'
      });
    }
  }
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

function measurementScript() {
  return `
  (() => {
    document.body.dataset.propertyHarnessState = 'started';
    const encodePayload = value => {
      const bytes = new TextEncoder().encode(value);
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 32768) {
        binary += Array.from(bytes.subarray(offset, offset + 32768), byte => String.fromCharCode(byte)).join('');
      }
      return btoa(binary);
    };
    const rectangle = element => {
      const value = element.getBoundingClientRect();
      return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height };
    };
    const px = value => Number.parseFloat(value) || 0;
    const select = (root, selector) => {
      const element = root.querySelector(selector);
      if (!element) throw new Error('Missing geometry element: ' + selector);
      return element;
    };
    const contentRectangles = (root, selectors) => {
      const selectorList = Array.isArray(selectors) ? selectors : [selectors];
      const elements = selectorList.flatMap(selector => [...root.querySelectorAll(selector)]);
      return [...new Set(elements)].map(rectangle);
    };
    const measure = container => {
      const card = select(container, '.workout-card');
      const badge = select(card, '.exercise-method-pill');
      const title = select(card, 'h3');
      const group = select(card, '.exercise-stats-chip-group');
      const chips = [...card.querySelectorAll('.exercise-stat-button')];
      const cta = select(card, '.completion-toggle-wrapper');
      const topWrapper = title.closest('.relative.z-10.p-4');
      const bottomWrapper = group.closest('.relative.z-10.p-4');
      const cardStyle = getComputedStyle(card);
      const groupStyle = getComputedStyle(group);
      const ctaStyle = getComputedStyle(cta);
      const token = name => {
        const probe = document.createElement('i');
        probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;height:0;width:var(' + name + ');';
        card.appendChild(probe);
        const resolved = px(getComputedStyle(probe).width);
        probe.remove();
        return resolved;
      };
      return {
        card: rectangle(card), badge: rectangle(badge), title: rectangle(title),
        group: rectangle(group), cta: rectangle(cta), chips: chips.map(rectangle),
        badgeContent: contentRectangles(badge, ':scope > .method-icon, :scope > .method-label'),
        chipContent: chips.map(chip => contentRectangles(chip,
          ':scope > .chip-header, :scope > .stat-value, :scope > .stat-helper, :scope > .stat-progress-bar')),
        ctaContent: contentRectangles(cta, ':scope > .animated-check-container, :scope > span'),
        tokens: {
          outer: token('--wc-radius-outer'), control: token('--wc-radius-control'),
          pill: token('--wc-radius-pill'), gutter: token('--wc-gutter'),
          tight: token('--wc-gap-tight'), normal: token('--wc-gap-normal'),
          section: token('--wc-gap-section'), borderLeft: px(cardStyle.borderLeftWidth),
          borderRight: px(cardStyle.borderRightWidth)
        },
        computed: {
          aspectRatio: cardStyle.aspectRatio,
          cardRadius: px(cardStyle.borderTopLeftRadius),
          mediaRadius: px(getComputedStyle(select(card, ':scope > .absolute.inset-0')).borderTopLeftRadius),
          topPaddingLeft: px(getComputedStyle(topWrapper).paddingLeft),
          topPaddingRight: px(getComputedStyle(topWrapper).paddingRight),
          bottomPaddingLeft: px(getComputedStyle(bottomWrapper).paddingLeft),
          bottomPaddingRight: px(getComputedStyle(bottomWrapper).paddingRight),
          groupDisplay: groupStyle.display, gridTemplateColumns: groupStyle.gridTemplateColumns,
          groupGap: px(groupStyle.columnGap),
          chipRadii: chips.map(chip => px(getComputedStyle(chip).borderTopLeftRadius)),
          badgeRadius: px(getComputedStyle(badge).borderTopLeftRadius),
          ctaRadius: px(ctaStyle.borderTopLeftRadius), ctaMarginTop: px(ctaStyle.marginTop),
          ctaMinHeight: px(ctaStyle.minHeight), ctaDisplay: ctaStyle.display,
          ctaJustify: ctaStyle.justifyContent, ctaAlign: ctaStyle.alignItems
        },
        dom: { chipCount: chips.length, ctaImmediatelyAfterGroup: group.nextElementSibling === cta }
      };
    };
    const finish = () => {
      document.body.dataset.propertyHarnessState = 'measuring';
      document.querySelectorAll('img').forEach(image => {
        image.removeAttribute('src'); image.removeAttribute('data-src');
        image.dataset.harnessMedia = 'stable';
      });
      void document.documentElement.offsetHeight;
      const results = [...document.querySelectorAll('.property-case')].map(container => {
        try { return { ok: true, geometry: measure(container) }; }
        catch (error) { return { ok: false, error: error.stack || error.message }; }
      });
      document.body.dataset.propertyResults = encodePayload(JSON.stringify(results));
      document.body.dataset.propertyHarnessState = 'complete';
    };
    try { finish(); }
    catch (error) {
      document.body.dataset.propertyHarnessState = 'error';
      document.body.dataset.propertyError = encodePayload(error.stack || error.message);
    }
  })();`;
}

function groupedDocument(widthCases) {
  const documents = widthCases.map(item => renderFixtureDocument({
    id: `property-02-${item.index}`, width: item.width, context: item.context,
    pointer: item.pointer, motion: 'full', capability: 'chromium', state: 'pending'
  }, item.exercise));
  const fixtures = documents.map((document, index) =>
    `<section class="property-case" data-property-index="${widthCases[index].index}">${extractFixtureMarkup(document)}</section>`).join('\n');
  return `<!doctype html><html lang="pt-BR"><head>${extractHead(documents[0])}
    <style>
      body{display:block!important;padding:24px!important;box-sizing:border-box!important}
      .property-case{width:min(100%,560px);margin:0 auto 32px}
      .property-case .harness-main{width:100%}
      .property-case .hf-week-sheet{position:relative!important;inset:auto!important;z-index:auto!important;overflow:visible!important;width:100%!important}
      .property-case .hf-week-sheet__panel{width:100%!important}
    </style></head><body><div class="property-cases">${fixtures}</div>
    <script>${measurementScript()}</script></body></html>`;
}

function runWidthGroup(widthCases) {
  writeFileSync(TEMP_PATH, groupedDocument(widthCases), 'utf8');
  const width = widthCases[0].width;
  const diagnostics = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const profilePath = `${TEMP_PATH}.chrome-${process.pid}-${width}-${attempt}`;
    rmSync(profilePath, { recursive: true, force: true });
    const result = spawnSync(CHROME, [
      '--headless=new', '--hide-scrollbars', '--disable-background-networking', '--disable-extensions',
      '--disable-component-update', '--disable-default-apps', '--disable-sync',
      '--metrics-recording-only', '--no-first-run', '--host-resolver-rules=MAP * ~NOTFOUND',
      `--user-data-dir=${profilePath}`, `--window-size=${width},6500`,
      '--dump-dom', pathToFileURL(TEMP_PATH).href
    ], { encoding: 'utf8', timeout: 15000, maxBuffer: 24 * 1024 * 1024 });
    rmSync(profilePath, { recursive: true, force: true });
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const stateMatch = stdout.match(/data-property-harness-state="([^"]+)"/);
    const errorMatch = stdout.match(/data-property-error="([A-Za-z0-9+/=]+)"/);
    const match = stdout.match(/data-property-results="([A-Za-z0-9+/=]+)"/);
    if (errorMatch) {
      const browserError = Buffer.from(errorMatch[1], 'base64').toString('utf8');
      const error = new Error(`Chromium geometry harness errored at width ${width}: ${browserError}`);
      error.observed = { width, attempt, harnessState: stateMatch?.[1] || 'missing' };
      throw error;
    }
    if (result.status === 0 && stateMatch?.[1] === 'complete' && match) {
      try { return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')); }
      catch (parseError) {
        diagnostics.push({ attempt, status: result.status, harnessState: stateMatch[1], payloadError: parseError.message });
        continue;
      }
    }
    diagnostics.push({
      attempt, status: result.status, signal: result.signal || null,
      spawnError: result.error?.message || null, harnessState: stateMatch?.[1] || 'missing',
      stdoutBytes: Buffer.byteLength(stdout), stderrBytes: Buffer.byteLength(stderr),
      stdoutTail: stdout.slice(-400), stderrTail: stderr.slice(-1600)
    });
  }
  const error = new Error(`Chromium geometry harness produced no conclusive payload at width ${width}`);
  error.observed = { width, diagnostics };
  throw error;
}

const near = (actual, expected) => Math.abs(actual - expected) <= SUBPIXEL_TOLERANCE_PX;
const inside = (inner, outer) => inner.left >= outer.left - SUBPIXEL_TOLERANCE_PX
  && inner.right <= outer.right + SUBPIXEL_TOLERANCE_PX
  && inner.top >= outer.top - SUBPIXEL_TOLERANCE_PX
  && inner.bottom <= outer.bottom + SUBPIXEL_TOLERANCE_PX;
const before = (upper, lower) => upper.bottom <= lower.top + SUBPIXEL_TOLERANCE_PX;
const centerX = rect => (rect.left + rect.right) / 2;
const centerY = rect => (rect.top + rect.bottom) / 2;
const union = rectangles => ({
  left: Math.min(...rectangles.map(rect => rect.left)),
  right: Math.max(...rectangles.map(rect => rect.right)),
  top: Math.min(...rectangles.map(rect => rect.top)),
  bottom: Math.max(...rectangles.map(rect => rect.bottom))
});

function requireInvariant(condition, assertion, observed) {
  if (!condition) {
    const error = new Error(assertion);
    error.assertion = assertion;
    error.observed = observed;
    throw error;
  }
}

function assertGeometry(testCase, geometry) {
  const { card, badge, title, group, cta, chips, tokens, computed } = geometry;
  requireInvariant(near(card.width, card.height), 'card must remain exactly 1:1', { card });
  requireInvariant(computed.aspectRatio === '1 / 1', 'computed aspect-ratio must remain 1 / 1', computed.aspectRatio);

  for (const [name, rect] of Object.entries({ badge, title, group, cta })) {
    requireInvariant(inside(rect, card), `${name} must not overflow the card`, { name, rect, card });
  }
  for (const [name, rectangles] of [
    ['badge', geometry.badgeContent], ['cta', geometry.ctaContent]
  ]) {
    const owner = name === 'badge' ? badge : cta;
    requireInvariant(rectangles.every(rect => inside(rect, owner)), `${name} content must remain contained`, { owner, rectangles });
  }
  geometry.chipContent.forEach((rectangles, index) => {
    requireInvariant(rectangles.every(rect => inside(rect, chips[index])), `chip ${index} content must remain contained`, { chip: chips[index], rectangles });
  });
  requireInvariant(before(badge, title) && before(title, group) && before(group, cta),
    'badge, title, metric track and CTA must not overlap and must preserve vertical order',
    { badge, title, group, cta });

  requireInvariant(near(badge.left, title.left) && near(title.left, group.left) && near(group.left, cta.left),
    'badge, title, metric track and CTA must share the left internal axis', { badge, title, group, cta });
  requireInvariant(near(group.right, cta.right),
    'metric track and CTA must share the right internal axis', { group, cta });
  requireInvariant(title.width <= (card.width * 0.5) + SUBPIXEL_TOLERANCE_PX,
    'title max-width must remain approximately half the card', { title, card });
  requireInvariant(near(title.left - card.left, tokens.gutter + tokens.borderLeft)
    && near(card.right - group.right, tokens.gutter + tokens.borderRight),
    'shared axis must resolve from the symmetric --wc-gutter token inside the host hairline', { card, title, group, tokens });

  requireInvariant(geometry.dom.chipCount === 3 && chips.length === 3,
    'metric track must contain exactly three chips', geometry.dom);
  const widths = chips.map(chip => chip.width);
  requireInvariant(Math.max(...widths) - Math.min(...widths) <= SUBPIXEL_TOLERANCE_PX,
    'three metric chips must have equivalent widths', widths);
  requireInvariant(chips.every(chip => near(chip.top, chips[0].top) && near(chip.bottom, chips[0].bottom)),
    'three metric chips must remain on one horizontal row', chips);
  requireInvariant(chips.every(chip => inside(chip, group)), 'metric chips must not overflow their track', { chips, group });

  requireInvariant(geometry.dom.ctaImmediatelyAfterGroup && before(group, cta),
    'CTA must remain immediately below the metric track', { dom: geometry.dom, group, cta });
  requireInvariant(near(cta.left, group.left) && near(cta.right, group.right),
    'CTA lateral edges must align with metric-track edges', { group, cta });
  const ctaContent = union(geometry.ctaContent);
  requireInvariant(near(centerX(ctaContent), centerX(cta))
    && geometry.ctaContent.every(rect => near(centerY(rect), centerY(cta))),
  'CTA icon and text must be centered as one aligned group', { cta, content: geometry.ctaContent });
  requireInvariant(computed.ctaDisplay === 'flex' && computed.ctaJustify === 'center' && computed.ctaAlign === 'center',
    'CTA centering must resolve through the existing flex relationship', computed);

  requireInvariant(near(computed.cardRadius, tokens.outer) && near(computed.mediaRadius, tokens.outer),
    'host and clipped image plane radii must resolve from --wc-radius-outer', { tokens, computed });
  requireInvariant(computed.chipRadii.every(radius => near(radius, tokens.control)),
    'chip radii must resolve from --wc-radius-control', { tokens, computed });
  requireInvariant(near(computed.badgeRadius, tokens.pill) && near(computed.ctaRadius, tokens.pill),
    'badge and CTA radii must resolve from --wc-radius-pill', { tokens, computed });
  requireInvariant([
    computed.topPaddingLeft, computed.topPaddingRight,
    computed.bottomPaddingLeft, computed.bottomPaddingRight
  ].every(value => near(value, tokens.gutter)),
  'both content wrappers must derive symmetric padding from --wc-gutter', { tokens, computed });
  requireInvariant(computed.groupDisplay === 'grid'
    && computed.gridTemplateColumns.split(/\s+/).filter(Boolean).length === 3
    && near(computed.groupGap, tokens.tight),
  'metric geometry must derive from the three-track grid and --wc-gap-tight', { tokens, computed });
  requireInvariant(near(computed.ctaMarginTop, tokens.section),
    'CTA spacing must resolve from --wc-gap-section', { tokens, computed });
  requireInvariant(computed.ctaMinHeight >= 48 - SUBPIXEL_TOLERANCE_PX
    && computed.ctaMinHeight <= 54 + SUBPIXEL_TOLERANCE_PX,
  'CTA min-height must remain inside its current clamp(48px, 9vw, 54px)', { testCase, computed });
}

function assertSourceContract() {
  const contracts = [
    ['responsive gutter alias', /--wc-gutter:\s*clamp\(0\.75rem,\s*2\.5vw,\s*1rem\)/],
    ['responsive tight-gap alias', /--wc-gap-tight:\s*clamp\(0\.5rem,\s*1vw,\s*0\.65rem\)/],
    ['existing section-gap alias', /--wc-gap-section:\s*1rem/],
    ['1:1 host relationship', /aspect-ratio:\s*1\s*\/\s*1/],
    ['shared gutter consumption', /padding-inline:\s*var\(--wc-gutter\)/],
    ['equal three-track relationship', /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/],
    ['token-derived metric gap', /gap:\s*var\(--wc-gap-tight\)/],
    ['token-derived control radius', /border-radius:\s*var\(--wc-radius-control\)/],
    ['token-derived pill radius', /border-radius:\s*var\(--wc-radius-pill\)/],
    ['current CTA height clamp', /min-height:\s*clamp\(48px,\s*9vw,\s*54px\)/]
  ];
  const missing = contracts.filter(([, pattern]) => !pattern.test(source)).map(([name]) => name);
  requireInvariant(missing.length === 0,
    'geometry source must derive exclusively from current tokens, clamps and responsive relationships', { missing });
}

function persistFailure(testCase, error) {
  const record = {
    feature: FEATURE, property: PROPERTY, seed: SEED,
    subpixelToleranceCssPx: SUBPIXEL_TOLERANCE_PX,
    counterexample: testCase,
    assertion: error.assertion || error.message,
    observed: error.observed || null,
    replay: `HF_PBT_SEED=${SEED} node tests/workout-card-premium-redesign/property-02-responsive-geometry.test.mjs`
  };
  writeFileSync(FAILURE_PATH, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  console.error(`COUNTEREXAMPLE ${JSON.stringify(record)}`);
  return record;
}

let checked = 0;
let activeCase = { kind: 'source-contract' };
try {
  if (!CHROME) throw new Error('A local Chromium executable is required by the existing property harness');
  requireInvariant(cases.length >= 100, 'property must generate at least 100 seeded combinations', cases.length);
  requireInvariant(BREAKPOINT_WIDTHS.every(width => cases.some(item => item.width === width)),
    'every supported breakpoint neighbor must be generated', BREAKPOINT_WIDTHS);
  requireInvariant(['main', 'week-sheet'].every(context => cases.some(item => item.context === context)),
    'main and week-sheet contexts must both be generated', [...new Set(cases.map(item => item.context))]);
  assertSourceContract();

  for (const width of BREAKPOINT_WIDTHS) {
    const widthCases = cases.filter(item => item.width === width);
    requireInvariant(widthCases.length === CASES_PER_WIDTH,
      'each width must cover both contexts and all content profiles', { width, count: widthCases.length });
    const results = runWidthGroup(widthCases);
    requireInvariant(results.length === widthCases.length,
      'browser harness must return one result per generated case', { width, expected: widthCases.length, actual: results.length });
    results.forEach((result, index) => {
      activeCase = widthCases[index];
      requireInvariant(result.ok, 'browser must measure every generated fixture', result.error);
      assertGeometry(activeCase, result.geometry);
      checked += 1;
    });
  }

  rmSync(FAILURE_PATH, { force: true });
  console.log(`PASS - Feature: ${FEATURE}, ${PROPERTY}`);
  console.log(`Seed: ${SEED}; combinations: ${checked}; widths: ${BREAKPOINT_WIDTHS.join(',')}; contexts: main,week-sheet`);
  console.log(`Documented subpixel tolerance: ${SUBPIXEL_TOLERANCE_PX} CSS px; counterexample: none`);
} catch (error) {
  persistFailure(activeCase, error);
  process.exitCode = 1;
} finally {
  rmSync(TEMP_PATH, { force: true });
}
