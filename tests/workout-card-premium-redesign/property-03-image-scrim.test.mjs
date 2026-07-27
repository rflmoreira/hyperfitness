// Feature: workout-card-premium-redesign, Property 3: Imagem full-bleed e domínio monotônico do scrim
// **Validates: Requirements 3.1, 3.3, 3.4, 3.5, 3.6, 3.7, 3.9, 3.10**
// Numerical strategy: sample the computed piecewise-linear alpha profile at 129
// evenly spaced points from card base to scrim top (128 intervals). Alpha uses a
// 1e-4 tolerance; geometry uses 0.75 CSS px for subpixel layout rounding. A separate
// 1.25 CSS px allowance accounts for the host's intentional 1px hairline border.
// Usage: node tests/workout-card-premium-redesign/property-03-image-scrim.test.mjs
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BREAKPOINT_WIDTHS, INDEX_PATH, STATES, renderFixtureDocument } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAILURE_PATH = join(HERE, '.property-03-image-scrim.failure.json');
const TEMP_PATH = join(HERE, '.tmp-property-03-image-scrim.html');
const FEATURE = 'workout-card-premium-redesign';
const PROPERTY = 'Property 3: Imagem full-bleed e domínio monotônico do scrim';
const DEFAULT_SEED = 0x48465033;
const SAMPLE_COUNT = 129;
const ALPHA_TOLERANCE = 1e-4;
const SUBPIXEL_TOLERANCE_PX = 0.75;
const BORDER_ALLOWANCE_PX = 1.25;
const requestedSeed = process.env.HF_PBT_SEED;
const parsedSeed = requestedSeed === undefined ? DEFAULT_SEED : Number(requestedSeed);
const SEED = Number.isFinite(parsedSeed) ? parsedSeed >>> 0 : DEFAULT_SEED;
const CHROME = [
  process.env.HF_CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
].filter(Boolean).find(existsSync);
const CHROME_PROFILE_PATH = mkdtempSync(join(tmpdir(), 'hf-property-03-chrome-'));
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
const cases = BREAKPOINT_WIDTHS.flatMap(width => STATES.map(state => ({
  index: 0, width, state,
  context: pick(['main', 'week-sheet']),
  pointer: pick(['fine', 'coarse']),
  capability: pick(['chromium', 'webkit', 'basic'])
}))).map((testCase, index) => ({ ...testCase, index }));

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
    const rect = element => {
      const value = element.getBoundingClientRect();
      return { left:value.left, right:value.right, top:value.top, bottom:value.bottom,
        width:value.width, height:value.height, area:value.width * value.height };
    };
    const z = element => {
      const value = getComputedStyle(element).zIndex;
      return value === 'auto' ? 0 : Number(value) || 0;
    };
    const parseStops = background => [...background.matchAll(/(rgba?\\([^)]*\\))\\s+([\\d.]+)%/g)].map(match => {
      const channels = match[1].match(/[\\d.]+/g).map(Number);
      return { position:Number(match[2]) / 100, alpha:channels.length > 3 ? channels[3] : 1 };
    });
    const measure = container => {
      const card = container.querySelector('.workout-card');
      const media = card.querySelector(':scope > .absolute.inset-0');
      const image = media.querySelector('.exercise-card-image');
      const scrim = media.querySelector(':scope > .bg-gradient-to-t');
      const top = card.querySelector(':scope > .relative.z-10.p-4.flex');
      const bottom = card.querySelector(':scope > .relative.z-10.p-4.space-y-4');
      const badge = card.querySelector('.exercise-method-pill');
      const title = card.querySelector('h3');
      const group = card.querySelector('.exercise-stats-chip-group');
      const cta = card.querySelector('.completion-toggle-wrapper');
      if (![card, media, image, scrim, top, bottom, badge, title, group, cta].every(Boolean))
        throw new Error('Missing image/scrim fixture element');
      const cardChildren = [...card.children];
      const mediaChildren = [...media.children];
      const mediaRect = rect(media);
      const scrimRect = rect(scrim);
      const probeY = mediaRect.top + Math.max(1, (scrimRect.top - mediaRect.top) / 2);
      return {
        card:rect(card), media:mediaRect, image:rect(image), scrim:scrimRect,
        textual:[badge, title, group, cta].map(element => ({ className:element.className, rect:rect(element) })),
        styles:{
          image:{ position:getComputedStyle(image).position, width:getComputedStyle(image).width,
            height:getComputedStyle(image).height, objectFit:getComputedStyle(image).objectFit,
            objectPosition:getComputedStyle(image).objectPosition, opacity:getComputedStyle(image).opacity,
            filter:getComputedStyle(image).filter },
          scrim:{ position:getComputedStyle(scrim).position, background:getComputedStyle(scrim).backgroundImage,
            pointerEvents:getComputedStyle(scrim).pointerEvents },
          bottomBackground:getComputedStyle(bottom).backgroundImage,
          cardBeforeDisplay:getComputedStyle(card, '::before').display,
          cardAfterDisplay:getComputedStyle(card, '::after').display
        },
        stops:parseStops(getComputedStyle(scrim).backgroundImage),
        order:{ mediaBeforeTop:cardChildren.indexOf(media) < cardChildren.indexOf(top),
          topBeforeBottom:cardChildren.indexOf(top) < cardChildren.indexOf(bottom),
          imageBeforeScrim:mediaChildren.indexOf(image) < mediaChildren.indexOf(scrim),
          mediaZ:z(media), scrimZ:z(scrim), topZ:z(top), bottomZ:z(bottom) },
        above:{ excludedHeight:scrimRect.top - mediaRect.top,
          hitsScrim:document.elementsFromPoint((mediaRect.left + mediaRect.right) / 2, probeY).includes(scrim) }
      };
    };
    const finish = () => {
      document.body.dataset.propertyHarnessState = 'measuring';
      document.querySelectorAll('img').forEach(image => {
        image.removeAttribute('src'); image.removeAttribute('data-src'); image.dataset.harnessMedia = 'stable';
      });
      void document.documentElement.offsetHeight;
      const results = [...document.querySelectorAll('.property-case')].map(container => {
        try { return { ok:true, measurement:measure(container) }; }
        catch (error) { return { ok:false, error:error.stack || error.message }; }
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
    id:`property-03-${item.index}`, width:item.width, context:item.context, pointer:item.pointer,
    motion:'full', capability:item.capability, state:item.state
  }));
  const fixtures = documents.map((document, index) =>
    `<section class="property-case" data-property-index="${widthCases[index].index}">${extractFixtureMarkup(document)}</section>`).join('\n');
  return `<!doctype html><html lang="pt-BR"><head>${extractHead(documents[0])}
    <style>
      body{display:block!important;padding:24px!important;box-sizing:border-box!important}
      .property-case{width:min(100%,560px);margin:0 auto 32px}.property-case .harness-main{width:100%}
      .property-case .hf-week-sheet{position:relative!important;inset:auto!important;z-index:auto!important;overflow:visible!important;width:100%!important}
      .property-case .hf-week-sheet__panel{width:100%!important}
    </style></head><body>${fixtures}<script>${measurementScript()}</script></body></html>`;
}
function runWidthGroup(widthCases) {
  writeFileSync(TEMP_PATH, groupedDocument(widthCases), 'utf8');
  const width = widthCases[0].width;
  const diagnostics = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = spawnSync(CHROME, [
      '--headless=new', '--hide-scrollbars', '--disable-background-networking', '--disable-extensions',
      '--disable-component-update', '--disable-default-apps', '--disable-sync',
      '--metrics-recording-only', '--no-first-run', '--host-resolver-rules=MAP * ~NOTFOUND',
      `--user-data-dir=${CHROME_PROFILE_PATH}`, `--window-size=${width},6500`,
      '--dump-dom', pathToFileURL(TEMP_PATH).href
    ], { encoding:'utf8', timeout:10000, maxBuffer:24 * 1024 * 1024 });
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const stateMatch = stdout.match(/data-property-harness-state="([^"]+)"/);
    const errorMatch = stdout.match(/data-property-error="([A-Za-z0-9+/=]+)"/);
    const match = stdout.match(/data-property-results="([A-Za-z0-9+/=]+)"/);
    if (errorMatch) {
      const browserError = Buffer.from(errorMatch[1], 'base64').toString('utf8');
      const error = new Error(`Chromium image/scrim harness errored at width ${width}: ${browserError}`);
      error.observed = { width, attempt, harnessState:stateMatch?.[1] || 'missing' };
      throw error;
    }
    if (result.status === 0 && match) {
      return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
    }
    diagnostics.push({
      attempt, status:result.status, signal:result.signal || null,
      spawnError:result.error?.message || null, harnessState:stateMatch?.[1] || 'missing',
      stdoutBytes:Buffer.byteLength(stdout), stderrBytes:Buffer.byteLength(stderr),
      stdoutTail:stdout.slice(-400), stderrTail:stderr.slice(-1600)
    });
  }
  const error = new Error(`Chromium image/scrim harness produced no conclusive payload at width ${width}`);
  error.observed = { width, diagnostics };
  throw error;
}

const near = (actual, expected, tolerance = SUBPIXEL_TOLERANCE_PX) => Math.abs(actual - expected) <= tolerance;
const covers = (outer, inner) => outer.left <= inner.left + BORDER_ALLOWANCE_PX
  && outer.right >= inner.right - BORDER_ALLOWANCE_PX
  && outer.top <= inner.top + BORDER_ALLOWANCE_PX
  && outer.bottom >= inner.bottom - BORDER_ALLOWANCE_PX;
function requireInvariant(condition, assertion, observed) {
  if (!condition) {
    const error = new Error(assertion);
    error.assertion = assertion;
    error.observed = observed;
    throw error;
  }
}
function alphaAt(stops, progress) {
  if (progress < 0 || progress > 1 || !stops.length) return 0;
  if (progress <= stops[0].position) return stops[0].alpha;
  for (let index = 1; index < stops.length; index += 1) {
    const right = stops[index];
    const left = stops[index - 1];
    if (progress <= right.position) {
      const span = right.position - left.position;
      const ratio = span ? (progress - left.position) / span : 1;
      return left.alpha + (right.alpha - left.alpha) * ratio;
    }
  }
  return stops.at(-1).alpha;
}
function assertMeasurement(testCase, value) {
  const { card, media, image, scrim, textual, styles, stops, order, above } = value;
  requireInvariant(near(media.width, media.height), 'full-bleed media plane must remain square', { card, media });
  requireInvariant(covers(media, card), 'media plane must cover the complete inner card square', { card, media });
  requireInvariant(covers(image, media), 'rendered image bounds must cover the full media square', { image, media });
  requireInvariant(styles.image.position === 'absolute' && styles.image.objectFit === 'cover'
    && styles.image.objectPosition === '50% 50%', 'image must retain absolute cover geometry and centered fallback', styles.image);

  const largestTextArea = Math.max(...textual.map(item => item.rect.area));
  requireInvariant(media.area > scrim.area && media.area > largestTextArea,
    'image plane must remain the largest visible card plane', { mediaArea:media.area, scrimArea:scrim.area, largestTextArea });
  requireInvariant(Number(styles.image.opacity) > 0 && styles.image.filter === 'none',
    'dominant image must remain visible without a destructive filter', styles.image);

  requireInvariant(order.mediaBeforeTop && order.topBeforeBottom && order.imageBeforeScrim,
    'DOM paint order must remain image, scrim, then textual overlays', order);
  requireInvariant(order.topZ > order.mediaZ && order.bottomZ > order.scrimZ,
    'both textual wrappers must paint above image and scrim', order);
  requireInvariant(textual.every(item => item.rect.top >= scrim.top - SUBPIXEL_TOLERANCE_PX
    && item.rect.bottom <= scrim.bottom + SUBPIXEL_TOLERANCE_PX),
  'all effective textual overlays must remain inside the localized scrim domain', { textual, scrim });

  requireInvariant(near(scrim.bottom, media.bottom) && scrim.top > media.top + SUBPIXEL_TOLERANCE_PX,
    'scrim domain must run from an excluded upper boundary to the card base', { media, scrim });
  requireInvariant(styles.scrim.position === 'absolute' && styles.scrim.pointerEvents === 'none',
    'scrim must remain an inert overlay in the media plane', styles.scrim);
  requireInvariant(above.excludedHeight >= 32 - SUBPIXEL_TOLERANCE_PX
    && above.excludedHeight <= 48 + SUBPIXEL_TOLERANCE_PX && !above.hitsScrim,
  'region above the scrim boundary must receive zero scrim contribution', above);
  requireInvariant(styles.bottomBackground === 'none'
    && styles.cardBeforeDisplay === 'none' && styles.cardAfterDisplay === 'none',
  'no secondary readability gradient may contribute outside the single scrim domain', styles);

  requireInvariant(stops.length >= 2 && near(stops[0].position, 0, ALPHA_TOLERANCE)
    && near(stops.at(-1).position, 1, ALPHA_TOLERANCE),
  'computed scrim stops must span the complete localized domain', stops);
  const samples = Array.from({ length:SAMPLE_COUNT }, (_, index) => alphaAt(stops, index / (SAMPLE_COUNT - 1)));
  requireInvariant(samples.every((alpha, index) => index === 0 || alpha <= samples[index - 1] + ALPHA_TOLERANCE),
    'sampled scrim opacity must be non-increasing from base to top', { samples, stops });
  requireInvariant(samples[0] > samples.at(-1) + ALPHA_TOLERANCE && samples[0] >= 0.75
    && samples.at(-1) <= ALPHA_TOLERANCE,
  'scrim base must be denser than its zero-alpha upper boundary', { base:samples[0], top:samples.at(-1), stops });
  requireInvariant(alphaAt(stops, -0.01) === 0 && alphaAt(stops, 1.01) === 0,
    'sampled scrim contribution must be zero outside its localized domain', { testCase, stops });
}

function assertSourceContract() {
  const contracts = [
    ['full-bleed image inset', /\.workout-card \.exercise-card-image\s*\{[\s\S]*?inset:\s*0;/],
    ['full image dimensions', /\.workout-card \.exercise-card-image\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;/],
    ['cover image sizing', /\.workout-card \.exercise-card-image\s*\{[\s\S]*?object-fit:\s*cover;/],
    ['center fallback', /\.workout-card \.exercise-card-image\s*\{[\s\S]*?object-position:\s*center center;/],
    ['localized scrim selector', /\.workout-card > \.absolute\.inset-0 > \.bg-gradient-to-t\s*\{/],
    ['localized scrim inset', /inset:\s*var\(--wc-top-inset\)\s+0\s+0;/],
    ['single lower gradient neutralized', /\.workout-card > \.relative\.z-10\.p-4\.space-y-4\.bg-gradient-to-t\s*\{\s*background:\s*none\s*!important;/]
  ];
  const missing = contracts.filter(([, pattern]) => !pattern.test(source)).map(([name]) => name);
  requireInvariant(missing.length === 0, 'image/scrim source contract must remain explicit and localized', { missing });
}
function persistFailure(testCase, error) {
  const record = {
    feature:FEATURE, property:PROPERTY, seed:SEED, samples:SAMPLE_COUNT,
    alphaTolerance:ALPHA_TOLERANCE, subpixelToleranceCssPx:SUBPIXEL_TOLERANCE_PX,
    borderAllowanceCssPx:BORDER_ALLOWANCE_PX, counterexample:testCase,
    assertion:error.assertion || error.message, observed:error.observed || null,
    replay:`HF_PBT_SEED=${SEED} node tests/workout-card-premium-redesign/property-03-image-scrim.test.mjs`
  };
  writeFileSync(FAILURE_PATH, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  console.error(`COUNTEREXAMPLE ${JSON.stringify(record)}`);
}

let checked = 0;
let activeCase = { kind:'source-contract' };
try {
  if (!CHROME) throw new Error('A local Chromium executable is required by the existing property harness');
  requireInvariant(cases.length >= 100, 'property must generate at least 100 seeded width/state combinations', cases.length);
  requireInvariant(BREAKPOINT_WIDTHS.every(width => cases.some(item => item.width === width)),
    'every supported breakpoint neighbor must be generated', BREAKPOINT_WIDTHS);
  requireInvariant(STATES.every(state => cases.some(item => item.state === state)),
    'every supported state must be generated', STATES);
  assertSourceContract();
  for (const width of BREAKPOINT_WIDTHS) {
    const widthCases = cases.filter(item => item.width === width);
    activeCase = { kind:'browser-harness', width, generatedCases:widthCases.length };
    const results = runWidthGroup(widthCases);
    requireInvariant(results.length === widthCases.length,
      'browser harness must return one result per generated case', { width, expected:widthCases.length, actual:results.length });
    results.forEach((result, index) => {
      activeCase = widthCases[index];
      requireInvariant(result.ok, 'browser must measure every generated fixture', result.error);
      assertMeasurement(activeCase, result.measurement);
      checked += 1;
    });
  }
  rmSync(FAILURE_PATH, { force:true });
  console.log(`PASS - Feature: ${FEATURE}, ${PROPERTY}`);
  console.log(`Seed: ${SEED}; combinations: ${checked}; widths: ${BREAKPOINT_WIDTHS.length}; states: ${STATES.length}`);
  console.log(`Sampling: ${SAMPLE_COUNT} points; alpha tolerance: ${ALPHA_TOLERANCE}; subpixel tolerance: ${SUBPIXEL_TOLERANCE_PX} CSS px; counterexample: none`);
} catch (error) {
  persistFailure(activeCase, error);
  process.exitCode = 1;
} finally {
  rmSync(TEMP_PATH, { force:true });
  rmSync(CHROME_PROFILE_PATH, { recursive:true, force:true });
}
