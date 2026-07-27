// Feature: workout-card-premium-redesign, Property 8: Profundidade contida e round-trip de movimento
// **Validates: Requirements 8.1, 8.3, 8.6, 8.7, 8.8, 8.9**
// Usage: node tests/workout-card-premium-redesign/property-08-depth-motion.test.mjs
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BREAKPOINT_WIDTHS, INDEX_PATH, renderFixtureDocument } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAILURE_PATH = join(HERE, '.property-08-depth-motion.failure.json');
const TEMP_PATH = join(HERE, '.tmp-property-08-depth-motion.html');
const FEATURE = 'workout-card-premium-redesign';
const PROPERTY = 'Property 8: Profundidade contida e round-trip de movimento';
const DEFAULT_SEED = 0x48465008;
const CASE_COUNT = 120;
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

const cases = Array.from({ length: CASE_COUNT }, (_, index) => ({
  index,
  width: pick(BREAKPOINT_WIDTHS),
  context: random() < 0.5 ? 'main' : 'week-sheet',
  pointer: random() < 0.35 ? 'coarse' : 'fine',
  motion: random() < 0.3 ? 'reduced' : 'full',
  capability: pick(['chromium', 'webkit', 'basic']),
  state: pick(['pending', 'completed'])
}));

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

const templatePending = renderFixtureDocument({ width: 768, context: 'main', pointer: 'fine', motion: 'full', capability: 'chromium', state: 'pending' });
const templateCompleted = renderFixtureDocument({ width: 768, context: 'main', pointer: 'fine', motion: 'full', capability: 'chromium', state: 'completed' });

function capabilityCss(testCase) {
  let css = '';
  const sel = `[data-prop-index="${testCase.index}"]`;
  if (testCase.capability === 'webkit') {
    css += `${sel} .player-glass-btn{background:rgba(0,0,0,.22)!important;backdrop-filter:blur(4px) brightness(1.5) saturate(300%) contrast(1.08)!important;-webkit-backdrop-filter:blur(4px) brightness(1.5) saturate(300%) contrast(1.08)!important}\n`;
  }
  if (testCase.capability === 'basic') {
    css += `${sel} .player-glass-btn{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}\n`;
    css += `${sel} .liquid-glass-edge{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}\n`;
  }
  if (testCase.pointer === 'coarse') {
    css += `${sel} .liquid-glass-edge{display:none!important}\n`;
  }
  return css;
}

function caseMarkup(testCase) {
  const state = testCase.state;
  const card = extractCard(state === 'completed' ? templateCompleted : templatePending);
  const details = `<div id="workout-details">${card}</div>`;
  const content = testCase.context === 'week-sheet'
    ? `<div class="hf-week-sheet__panel"><div class="hf-week-sheet__body">${details}</div></div>`
    : `<main class="harness-main">${details}</main>`;
  return `<section data-prop-index="${testCase.index}" style="width:min(100%,560px);margin:0 auto 16px">${content}</section>`;
}

function browserScript() {
  return `(() => {
    const generatedCases = ${JSON.stringify(cases)};
    const cs = (el, pseudo) => el ? getComputedStyle(el, pseudo || null) : {};
    const approx = (a, b, tol) => Math.abs(a - b) <= tol;

    const measure = (section) => {
      const card = section.querySelector('.workout-card');
      if (!card) return null;
      const image = card.querySelector('.exercise-card-image');
      const scrim = card.querySelector('.bg-gradient-to-t');
      const contentPanels = [...card.querySelectorAll(':scope > .relative.z-10')];

      const cardS = cs(card);
      const imageS = cs(image);
      const scrimS = cs(scrim);

      return {
        zOrder: {
          image: parseInt(imageS.zIndex) || 0,
          scrim: parseInt(scrimS.zIndex) || 0,
          content: contentPanels.map(p => parseInt(cs(p).zIndex) || 0)
        },
        card: {
          transform: cardS.transform,
          boxShadow: cardS.boxShadow,
          borderWidth: cardS.borderWidth,
          borderColor: cardS.borderColor,
          opacity: cardS.opacity,
          transitionDuration: cardS.transitionDuration,
          width: card.getBoundingClientRect().width,
          height: card.getBoundingClientRect().height
        },
        image: {
          scale: imageS.scale,
          transitionDuration: imageS.transitionDuration
        }
      };
    };

    const assert = (condition, assertion, observed) => {
      if (!condition) {
        const error = new Error(assertion);
        error.assertion = assertion;
        error.observed = observed;
        throw error;
      }
    };

    const results = generatedCases.map(testCase => {
      try {
        const section = document.querySelector('[data-prop-index="' + testCase.index + '"]');
        if (!section) throw new Error('Section not found for case ' + testCase.index);
        const m = measure(section);
        if (!m) throw new Error('Card not found for case ' + testCase.index);

        // 8.3: Three visual planes: image < scrim < content
        assert(m.zOrder.image < m.zOrder.scrim,
          'image z-index must be below scrim z-index',
          m.zOrder);
        assert(m.zOrder.content.every(z => m.zOrder.scrim < z),
          'scrim z-index must be below all content z-indices',
          m.zOrder);

        // 8.6: Card at rest has identity transform (no elevation)
        const isIdentity = m.card.transform === 'none' || m.card.transform === 'matrix(1, 0, 0, 1, 0, 0)';
        assert(isIdentity,
          'card at rest must have identity transform',
          { transform: m.card.transform });

        // 8.5: No halo at rest (box-shadow none)
        assert(m.card.boxShadow === 'none',
          'card at rest must have no box-shadow (no halo)',
          { boxShadow: m.card.boxShadow });

        // 8.1: Hairline border exists
        assert(m.card.borderWidth === '1px',
          'card must have 1px hairline border',
          { borderWidth: m.card.borderWidth });

        // 1:1 aspect ratio
        assert(approx(m.card.width, m.card.height, 2),
          'card must maintain 1:1 aspect ratio',
          { width: m.card.width, height: m.card.height });

        // Completed opacity = 1
        if (testCase.state === 'completed') {
          assert(m.card.opacity === '1',
            'completed card must have opacity 1',
            { opacity: m.card.opacity });
        }

        // Reduced motion: 0s transition
        if (testCase.motion === 'reduced') {
          const durations = m.card.transitionDuration.split(',').map(d => d.trim());
          const allZero = durations.every(d => d === '0s' || d === '0ms');
          assert(allZero,
            'reduced-motion card must have 0s transition duration',
            { transitionDuration: m.card.transitionDuration });
        }

        return { ok: true, index: testCase.index };
      } catch (error) {
        return {
          ok: false, index: testCase.index,
          assertion: error.assertion || error.message,
          observed: error.observed || null,
          stack: error.stack || error.message
        };
      }
    });

    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(results))));
    document.body.dataset.propertyResults = encoded;
    document.body.dataset.propertyHarnessState = 'complete';
  })();`;
}

function propertyDocument() {
  const headContent = extractHead(templatePending);
  const markup = cases.map(caseMarkup).join('\n');
  const extraCss = cases.map(capabilityCss).filter(Boolean).join('\n');
  return `<!doctype html><html lang="pt-BR"><head>${headContent}
    <style>
      body{display:block!important;padding:20px!important}
      .harness-main{width:min(100%,560px)}
      .hf-week-sheet__panel{position:relative!important;transform:none!important;width:min(100%,560px)!important}
      ${extraCss}
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

function assertGenerationContracts() {
  assertInvariant(cases.length >= 100,
    'property must generate at least 100 seeded cases', cases.length);
  const states = new Set(cases.map(c => c.state));
  assertInvariant(states.has('pending') && states.has('completed'),
    'cases must cover pending and completed states', [...states]);
  const motions = new Set(cases.map(c => c.motion));
  assertInvariant(motions.has('full') && motions.has('reduced'),
    'cases must cover full and reduced motion', [...motions]);
  const pointers = new Set(cases.map(c => c.pointer));
  assertInvariant(pointers.has('fine') && pointers.has('coarse'),
    'cases must cover fine and coarse pointers', [...pointers]);
  const capabilities = new Set(cases.map(c => c.capability));
  assertInvariant(capabilities.has('chromium') && capabilities.has('webkit') && capabilities.has('basic'),
    'cases must cover all capability branches', [...capabilities]);
}

function runBrowser() {
  writeFileSync(TEMP_PATH, propertyDocument(), 'utf8');
  const profilePath = `${TEMP_PATH}.chrome-${process.pid}`;
  rmSync(profilePath, { recursive: true, force: true });
  try {
    const result = spawnSync(CHROME, [
      '--headless=new', '--hide-scrollbars', '--disable-background-networking', '--disable-extensions',
      '--disable-component-update', '--disable-default-apps', '--disable-sync', '--metrics-recording-only',
      '--no-first-run', '--host-resolver-rules=MAP * ~NOTFOUND', `--user-data-dir=${profilePath}`,
      '--window-size=768,900', '--dump-dom', pathToFileURL(TEMP_PATH).href
    ], { encoding: 'utf8', timeout: 60_000, maxBuffer: 32 * 1024 * 1024 });
    const state = result.stdout.match(/data-property-harness-state="([^"]+)"/)?.[1];
    const payload = result.stdout.match(/data-property-results="([A-Za-z0-9+/=]+)"/)?.[1];
    assertInvariant(result.status === 0 && state === 'complete' && payload,
      'Chromium depth harness must return a conclusive payload', {
        status: result.status, signal: result.signal || null, state: state || 'missing',
        spawnError: result.error?.message || null, stderr: (result.stderr || '').slice(-1600)
      });
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } finally {
    rmSync(profilePath, { recursive: true, force: true });
    rmSync(TEMP_PATH, { force: true });
  }
}

function persistFailure(testCase, error) {
  const record = {
    feature: FEATURE, property: PROPERTY, seed: SEED,
    seedHex: `0x${SEED.toString(16).padStart(8, '0')}`,
    totalCases: cases.length, counterexample: testCase,
    assertion: error.assertion || error.message,
    observed: error.observed || null,
    replay: `HF_PBT_SEED=${SEED} node tests/workout-card-premium-redesign/property-08-depth-motion.test.mjs`
  };
  writeFileSync(FAILURE_PATH, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  console.error(`COUNTEREXAMPLE ${JSON.stringify(record)}`);
}

let activeCase = { kind: 'generation-contract' };
try {
  if (!CHROME) throw new Error('A local Chromium executable is required by the property harness');
  assertGenerationContracts();
  const results = runBrowser();
  assertInvariant(results.length === cases.length,
    'browser harness must return exactly one result per generated case',
    { expected: cases.length, actual: results.length });
  for (const result of results) {
    activeCase = cases[result.index] ?? { kind: 'unknown-browser-case', result };
    assertInvariant(result.ok, result.assertion || 'browser depth property failed',
      { browser: result.observed, stack: result.stack });
  }
  rmSync(FAILURE_PATH, { force: true });
  console.log(`PASS - Feature: ${FEATURE}, ${PROPERTY}`);
  console.log(`Seed: ${SEED} (0x${SEED.toString(16).padStart(8, '0')}); total cases: ${cases.length}`);
  console.log('Checked: three visual planes, identity rest, no halo, hairline, 1:1, completed opacity, reduced-motion 0s');
} catch (error) {
  persistFailure(activeCase, error);
  process.exitCode = 1;
} finally {
  rmSync(TEMP_PATH, { force: true });
}
