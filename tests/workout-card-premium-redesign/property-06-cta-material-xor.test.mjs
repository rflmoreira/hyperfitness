// Feature: workout-card-premium-redesign, Property 6: Exclusividade material do CTA
// **Validates: Requirements 6.4, 6.5, 6.6, 6.7, 6.8, 6.9**
// Usage: node tests/workout-card-premium-redesign/property-06-cta-material-xor.test.mjs
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BREAKPOINT_WIDTHS, renderFixtureDocument } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAILURE_PATH = join(HERE, '.property-06-cta-material-xor.failure.json');
const TEMP_PATH = join(HERE, '.tmp-property-06-cta-material-xor.html');
const FEATURE = 'workout-card-premium-redesign';
const PROPERTY = 'Property 6: Exclusividade material do CTA';
const DEFAULT_SEED = 0x48465036;
const REPETITIONS = 10;
const requestedSeed = process.env.HF_PBT_SEED ?? process.env.HF_PROPERTY_SEED;
const parsedSeed = requestedSeed === undefined ? DEFAULT_SEED : Number(requestedSeed);
const SEED = Number.isFinite(parsedSeed) ? parsedSeed >>> 0 : DEFAULT_SEED;
const CHROME = [process.env.HF_CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
const CAPABILITIES = Object.freeze(['chromium', 'webkit', 'basic']);
const SCENARIOS = Object.freeze([
  { key:'pending', source:'pending', target:'pending', transition:false },
  { key:'completed', source:'completed', target:'completed', transition:false },
  { key:'pending-to-completed', source:'pending', target:'completed', transition:true },
  { key:'completed-to-pending', source:'completed', target:'pending', transition:true }
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
const product = Array.from({ length:REPETITIONS }, (_, repetition) =>
  SCENARIOS.flatMap(scenario => CAPABILITIES.map(capability => ({ repetition, scenario, capability })))).flat();
const cases = shuffle(product).map((entry, index) => ({
  index, repetition:entry.repetition, scenario:entry.scenario.key,
  sourceState:entry.scenario.source, targetState:entry.scenario.target,
  transition:entry.scenario.transition, capability:entry.capability,
  width:BREAKPOINT_WIDTHS[index % BREAKPOINT_WIDTHS.length],
  context:random() < 0.5 ? 'main' : 'week-sheet',
  pointer:random() < 0.35 ? 'coarse' : 'fine'
}));

function requireInvariant(condition, assertion, observed) {
  if (!condition) {
    const error = new Error(assertion);
    error.assertion = assertion;
    error.observed = observed;
    throw error;
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
function extractCtaMarkup(document) {
  const markup = extractFixtureMarkup(document);
  const match = markup.match(/<button class="completion-toggle-wrapper[\s\S]*?<\/button>/i);
  if (!match) throw new Error('Real fixture has no completion CTA');
  return match[0];
}
function capabilityCss() {
  return `
    .canonical-probe-host{position:fixed;left:-10000px;top:0;width:180px;height:80px;pointer-events:none}
    .canonical-reference{width:160px;height:64px;border-radius:9999px}
    .property-case[data-capability="webkit"] .player-glass-btn{background:rgba(0,0,0,.22)!important;backdrop-filter:blur(4px) brightness(1.5) saturate(300%) contrast(1.08)!important;-webkit-backdrop-filter:blur(4px) brightness(1.5) saturate(300%) contrast(1.08)!important}
    .property-case[data-capability="basic"] .player-glass-btn{background:rgba(0,0,0,.22)!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
    .property-case[data-capability="basic"] .liquid-glass-edge{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
    .property-case[data-pointer="coarse"] .workout-card .liquid-glass-edge{display:none!important}`;
}
function measurementScript(widthCases) {
  return `(() => {
    document.body.dataset.propertyHarnessState = 'started';
    const expectedCases = ${JSON.stringify(widthCases)};
    const expectedByIndex = new Map(expectedCases.map(item => [String(item.index), item]));
    const encodePayload = value => {
      const bytes = new TextEncoder().encode(value); let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 32768) {
        binary += Array.from(bytes.subarray(offset, offset + 32768), byte => String.fromCharCode(byte)).join('');
      }
      return btoa(binary);
    };
    const css = (style, property) => style.getPropertyValue(property).trim();
    const recipe = element => { const style = getComputedStyle(element); return {
      backgroundColor:css(style,'background-color'), backgroundImage:css(style,'background-image'),
      opacity:css(style,'opacity'), backdropFilter:css(style,'backdrop-filter'),
      webkitBackdropFilter:css(style,'-webkit-backdrop-filter'), filter:css(style,'filter'),
      boxShadow:css(style,'box-shadow'), borderTopWidth:css(style,'border-top-width'),
      borderTopStyle:css(style,'border-top-style'), borderTopColor:css(style,'border-top-color'),
      isolation:css(style,'isolation') }; };
    const edge = element => { const style = getComputedStyle(element); return {
      display:css(style,'display'), position:css(style,'position'), top:css(style,'top'),
      right:css(style,'right'), bottom:css(style,'bottom'), left:css(style,'left'),
      borderRadius:css(style,'border-radius'), backdropFilter:css(style,'backdrop-filter'),
      webkitBackdropFilter:css(style,'-webkit-backdrop-filter'),
      webkitMaskImage:css(style,'-webkit-mask-image'), maskImage:css(style,'mask-image'),
      pointerEvents:css(style,'pointer-events'), zIndex:css(style,'z-index'),
      ariaHidden:element.getAttribute('aria-hidden') }; };
    const pseudo = (element, selector) => { const style = getComputedStyle(element, selector); return {
      content:css(style,'content'), display:css(style,'display'), position:css(style,'position'),
      top:css(style,'top'), right:css(style,'right'), bottom:css(style,'bottom'), left:css(style,'left'),
      borderRadius:css(style,'border-radius'), padding:css(style,'padding'),
      backgroundImage:css(style,'background-image'), mixBlendMode:css(style,'mix-blend-mode'),
      webkitMaskImage:css(style,'-webkit-mask-image'), maskImage:css(style,'mask-image'),
      pointerEvents:css(style,'pointer-events'), zIndex:css(style,'z-index') }; };
    const snapshot = (card, reference) => {
      const cta = card.querySelector('.completion-toggle-wrapper');
      if (!cta) throw new Error('Missing completion CTA');
      reference.style.borderRadius = getComputedStyle(cta).borderRadius;
      const rim = cta.querySelector(':scope > .liquid-glass-edge');
      const referenceRim = reference.querySelector(':scope > .liquid-glass-edge');
      return { cardCompleted:card.classList.contains('exercise-completed'),
        classList:[...cta.classList], directEdges:cta.querySelectorAll(':scope > .liquid-glass-edge').length,
        recipe:recipe(cta), before:pseudo(cta,'::before'), after:pseudo(cta,'::after'),
        edge:rim ? edge(rim) : null, reference:{ recipe:recipe(reference),
          before:pseudo(reference,'::before'), after:pseudo(reference,'::after'), edge:edge(referenceRim) } };
    };
    const measure = container => {
      const generated = expectedByIndex.get(container.dataset.propertyIndex);
      if (!generated) throw new Error('Missing generated case ' + container.dataset.propertyIndex);
      const card = container.querySelector('.workout-card');
      const reference = container.querySelector('.canonical-reference');
      const targetTemplate = container.querySelector('template.property-target');
      if (!card || !reference || !targetTemplate) throw new Error('Missing card, reference, or transition template');
      const initial = snapshot(card, reference);
      if (generated.transition) {
        const current = card.querySelector('.completion-toggle-wrapper');
        const replacement = targetTemplate.content.firstElementChild.cloneNode(true);
        card.classList.toggle('exercise-completed', generated.targetState === 'completed');
        current.replaceWith(replacement);
        void card.offsetHeight;
      }
      return { caseIndex:Number(container.dataset.propertyIndex), initial, settled:snapshot(card, reference) };
    };
    try {
      document.querySelectorAll('img').forEach(image => {
        image.removeAttribute('src'); image.removeAttribute('data-src'); image.dataset.harnessMedia = 'stable';
      });
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
  const sourceDocuments = widthCases.map(item => renderFixtureDocument({
    id:`property-06-source-${item.index}`, width:item.width, context:item.context, pointer:item.pointer,
    motion:'full', capability:item.capability, state:item.sourceState
  }));
  const targetDocuments = widthCases.map(item => renderFixtureDocument({
    id:`property-06-target-${item.index}`, width:item.width, context:item.context, pointer:item.pointer,
    motion:'full', capability:item.capability, state:item.targetState
  }));
  const fixtures = sourceDocuments.map((document, index) => {
    const item = widthCases[index];
    return `<section class="property-case" data-property-index="${item.index}" data-capability="${item.capability}" data-pointer="${item.pointer}">${extractFixtureMarkup(document)}<template class="property-target">${extractCtaMarkup(targetDocuments[index])}</template><div class="canonical-probe-host"><div class="canonical-reference player-glass-btn"><span class="liquid-glass-edge" aria-hidden="true"></span><span>canonical</span></div></div></section>`;
  }).join('\n');
  return `<!doctype html><html lang="pt-BR"><head>${extractHead(sourceDocuments[0])}<style>
    body{display:block!important;padding:24px!important;box-sizing:border-box!important}
    .property-case{width:min(100%,560px);margin:0 auto 32px}.property-case .harness-main{width:100%}
    .property-case .hf-week-sheet{position:relative!important;inset:auto!important;z-index:auto!important;overflow:visible!important;width:100%!important}
    .property-case .hf-week-sheet__panel{width:100%!important}${capabilityCss()}</style></head><body>${fixtures}<script>${measurementScript(widthCases)}</script></body></html>`;
}
function runWidthGroup(widthCases) {
  writeFileSync(TEMP_PATH, groupedDocument(widthCases), 'utf8');
  const width = widthCases[0].width;
  const diagnostics = [];
  const startTime = Date.now();
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const attemptStart = Date.now();
    const profilePath = `${TEMP_PATH}.chrome-${process.pid}-${width}-${attempt}`;
    rmSync(profilePath, { recursive:true, force:true });
    const result = spawnSync(CHROME, ['--headless=new', '--hide-scrollbars', '--disable-background-networking',
      '--disable-extensions', '--disable-component-update', '--disable-default-apps', '--disable-sync',
      '--metrics-recording-only', '--no-first-run', '--host-resolver-rules=MAP * ~NOTFOUND',
      '--disable-images', '--blink-settings=imagesEnabled=false',
      `--user-data-dir=${profilePath}`, `--window-size=${width},6500`, '--dump-dom', pathToFileURL(TEMP_PATH).href],
    { encoding:'utf8', timeout:60_000, maxBuffer:24 * 1024 * 1024 });
    const attemptDuration = Date.now() - attemptStart;
    rmSync(profilePath, { recursive:true, force:true });
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const stateMatch = stdout.match(/data-property-harness-state="([^"]+)"/);
    const errorMatch = stdout.match(/data-property-error="([A-Za-z0-9+/=]+)"/);
    const payloadMatch = stdout.match(/data-property-results="([A-Za-z0-9+/=]+)"/);
    if (errorMatch) {
      const error = new Error(`Chromium CTA harness errored at width ${width}: ${Buffer.from(errorMatch[1], 'base64').toString('utf8')}`);
      error.observed = { width, attempt, harnessState:stateMatch?.[1] || 'missing' };
      throw error;
    }
    if (result.status === 0 && stateMatch?.[1] === 'complete' && payloadMatch) {
      try {
        const parsed = JSON.parse(Buffer.from(payloadMatch[1], 'base64').toString('utf8'));
        if (!Array.isArray(parsed)) throw new Error('Decoded payload is not an array');
        console.log(`    Chrome succeeded on attempt ${attempt} (${attemptDuration}ms)`);
        return parsed;
      } catch (payloadError) {
        diagnostics.push({ attempt, status:result.status, payloadError:payloadError.message, duration:attemptDuration });
        continue;
      }
    }
    console.log(`    Chrome attempt ${attempt} failed (${attemptDuration}ms, status=${result.status}, signal=${result.signal || 'none'})`);
    diagnostics.push({ attempt, status:result.status, signal:result.signal || null,
      spawnError:result.error?.message || null, harnessState:stateMatch?.[1] || 'missing',
      stdoutBytes:Buffer.byteLength(stdout), stderrBytes:Buffer.byteLength(stderr), stderrTail:stderr.slice(-1200), duration:attemptDuration });
  }
  const error = new Error(`Chromium CTA harness produced no conclusive payload at width ${width}`);
  error.observed = { width, diagnostics, totalDuration:Date.now() - startTime };
  throw error;
}

const exact = value => JSON.stringify(value);
const without = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
const noFilter = value => value === '' || value === 'none';
function rgba(value) {
  const match = String(value).match(/rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])] : null;
}
const isSolidGreen = value => exact(rgba(value)) === exact([57, 255, 20, 1]);
function assertPending(testCase, snapshot, phase) {
  requireInvariant(!snapshot.cardCompleted, `${phase} pending card must not retain completed state`, snapshot);
  requireInvariant(snapshot.classList.includes('player-glass-btn')
    && !snapshot.classList.includes('liquid-glass') && snapshot.directEdges === 1,
  `${phase} pending CTA must carry exactly one canonical compact glass material`, snapshot);
  requireInvariant(!isSolidGreen(snapshot.recipe.backgroundColor),
    `${phase} pending CTA must not retain the completed solid green`, snapshot.recipe);
  requireInvariant(exact(snapshot.recipe) === exact(snapshot.reference.recipe),
    `${phase} pending CTA must equal the canonical player glass surface recipe`,
    { expected:snapshot.reference.recipe, actual:snapshot.recipe });
  requireInvariant(exact(snapshot.before) === exact(snapshot.reference.before)
    && exact(snapshot.after) === exact(snapshot.reference.after),
  `${phase} pending CTA fringe and sheen must equal the canonical recipe`,
  { before:snapshot.before, expectedBefore:snapshot.reference.before,
    after:snapshot.after, expectedAfter:snapshot.reference.after });
  const ignoredEdge = ['display','ariaHidden'];
  requireInvariant(exact(without(snapshot.edge, ignoredEdge)) === exact(without(snapshot.reference.edge, ignoredEdge)),
    `${phase} pending CTA rim must equal the canonical confined edge recipe`,
    { expected:without(snapshot.reference.edge, ignoredEdge), actual:without(snapshot.edge, ignoredEdge) });
  requireInvariant(snapshot.edge.ariaHidden === 'true' && snapshot.edge.pointerEvents === 'none'
    && snapshot.edge.top === '0px' && snapshot.edge.right === '0px'
    && snapshot.edge.bottom === '0px' && snapshot.edge.left === '0px',
  `${phase} pending CTA rim must remain aria-hidden, pointer-inert, and confined`, snapshot.edge);
  const rimHidden = testCase.width <= 767 || testCase.pointer === 'coarse';
  requireInvariant(snapshot.edge.display === (rimHidden ? 'none' : snapshot.reference.edge.display),
    `${phase} pending rim visibility must follow compact/coarse protection`,
    { width:testCase.width, pointer:testCase.pointer, expected:rimHidden ? 'none' : snapshot.reference.edge.display,
      actual:snapshot.edge.display });
  const filter = snapshot.recipe.backdropFilter;
  if (testCase.capability === 'basic') {
    requireInvariant(noFilter(filter) && noFilter(snapshot.recipe.webkitBackdropFilter),
      `${phase} basic pending CTA must retain canonical no-filter fallback`, snapshot.recipe);
  } else if (testCase.capability === 'webkit') {
    requireInvariant(!noFilter(filter) && !filter.includes('url('),
      `${phase} WebKit pending CTA must use canonical base blur without SVG refraction`, snapshot.recipe);
  } else {
    const expectedId = testCase.width <= 768 ? 'liquid-glass-refract-soft' : 'liquid-glass-refract';
    requireInvariant(filter.includes(expectedId),
      `${phase} Chromium pending CTA must select canonical responsive refraction`,
      { width:testCase.width, expectedId, filter });
  }
}
function assertCompleted(snapshot, phase) {
  requireInvariant(snapshot.cardCompleted, `${phase} completed card must retain completed state`, snapshot);
  requireInvariant(!snapshot.classList.includes('player-glass-btn')
    && !snapshot.classList.includes('liquid-glass') && snapshot.directEdges === 0 && snapshot.edge === null,
  `${phase} completed CTA must have no glass class or rim`, snapshot);
  requireInvariant(isSolidGreen(snapshot.recipe.backgroundColor) && snapshot.recipe.opacity === '1'
    && snapshot.recipe.backgroundImage === 'none',
  `${phase} completed CTA must use only the opaque #39ff14 surface`, snapshot.recipe);
  requireInvariant(noFilter(snapshot.recipe.backdropFilter)
    && noFilter(snapshot.recipe.webkitBackdropFilter) && noFilter(snapshot.recipe.filter),
  `${phase} completed CTA must have no blur, refraction, translucency filter, or residual filter`, snapshot.recipe);
  requireInvariant(snapshot.recipe.boxShadow === 'none',
    `${phase} completed CTA must retain no glass depth`, snapshot.recipe);
  for (const [name, layer] of [['fringe', snapshot.before], ['sheen', snapshot.after]]) {
    requireInvariant((layer.content === 'none' || layer.content === 'normal')
      && layer.display === 'none' && layer.backgroundImage === 'none'
      && layer.mixBlendMode === 'normal',
    `${phase} completed CTA must have no ${name} layer`, layer);
  }
}
function assertState(testCase, state, snapshot, phase) {
  if (state === 'pending') assertPending(testCase, snapshot, phase);
  else assertCompleted(snapshot, phase);
  const pendingMaterial = snapshot.classList.includes('player-glass-btn') && snapshot.directEdges === 1;
  const completedMaterial = isSolidGreen(snapshot.recipe.backgroundColor) && snapshot.recipe.opacity === '1';
  requireInvariant(pendingMaterial !== completedMaterial,
    `${phase} CTA must satisfy material XOR`, { pendingMaterial, completedMaterial, snapshot });
}
function assertGeneration() {
  requireInvariant(cases.length >= 100,
    'property must generate at least 100 seeded completion/capability combinations', cases.length);
  for (const scenario of SCENARIOS) {
    for (const capability of CAPABILITIES) {
      requireInvariant(cases.filter(item => item.scenario === scenario.key
        && item.capability === capability).length === REPETITIONS,
      'every completion scenario/capability tuple must receive equal seeded coverage',
      { scenario:scenario.key, capability });
    }
  }
  requireInvariant(BREAKPOINT_WIDTHS.every(width => cases.filter(item => item.width === width).length === 8),
    'all supported breakpoint neighbors must receive equal seeded coverage',
    Object.fromEntries(BREAKPOINT_WIDTHS.map(width => [width, cases.filter(item => item.width === width).length])));
  requireInvariant(cases.some(item => item.pointer === 'coarse') && cases.some(item => item.pointer === 'fine')
    && cases.some(item => item.context === 'main') && cases.some(item => item.context === 'week-sheet'),
  'seeded cases must cover pointer modes and both rendering contexts', null);
}
function persistFailure(testCase, error) {
  const record = {
    feature:FEATURE, property:PROPERTY, seed:SEED,
    seedHex:`0x${SEED.toString(16).padStart(8, '0')}`, combinations:cases.length,
    completionScenarios:SCENARIOS.map(item => item.key), capabilities:CAPABILITIES,
    counterexample:testCase, assertion:error.assertion || error.message,
    observed:error.observed || null,
    replay:`HF_PBT_SEED=${SEED} node tests/workout-card-premium-redesign/property-06-cta-material-xor.test.mjs`
  };
  writeFileSync(FAILURE_PATH, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  console.error(`COUNTEREXAMPLE ${JSON.stringify(record)}`);
  return record;
}

let checked = 0;
let activeCase = { kind:'generation-contract' };
try {
  if (!CHROME) throw new Error('A local Chromium executable is required by the existing property harness');
  console.log(`Starting property test with SEED=${SEED}, ${cases.length} total cases`);
  assertGeneration();
  console.log('Generation assertions passed');
  const BATCH_SIZE = 1; // Must be 1 - Chrome times out with larger batches on complex backdrop-filter rendering
  for (const width of BREAKPOINT_WIDTHS) {
    const widthCases = cases.filter(item => item.width === width);
    console.log(`Processing width ${width}: ${widthCases.length} cases in ${Math.ceil(widthCases.length / BATCH_SIZE)} batches`);
    // Process cases in smaller batches to prevent Chrome timeout
    for (let offset = 0; offset < widthCases.length; offset += BATCH_SIZE) {
      const batch = widthCases.slice(offset, offset + BATCH_SIZE);
      console.log(`  Batch ${Math.floor(offset / BATCH_SIZE) + 1}/${Math.ceil(widthCases.length / BATCH_SIZE)}: cases ${batch.map(c => c.index).join(', ')}`);
      activeCase = { kind:'browser-harness', width, generatedCases:batch.length, offset };
      const results = runWidthGroup(batch);
      requireInvariant(results.length === batch.length,
        'browser harness must return exactly one result per generated case',
        { width, expected:batch.length, actual:results.length });
      results.forEach((result, index) => {
        activeCase = batch[index];
        requireInvariant(result.ok, 'browser must measure every generated CTA fixture', result.error);
        requireInvariant(result.measurement.caseIndex === activeCase.index,
          'harness result must retain its generated case index',
          { expected:activeCase.index, actual:result.measurement.caseIndex });
        assertState(activeCase, activeCase.sourceState, result.measurement.initial, 'initial');
        assertState(activeCase, activeCase.targetState, result.measurement.settled, 'settled');
        if (activeCase.transition) {
          requireInvariant(activeCase.sourceState !== activeCase.targetState,
            'transition cases must settle in the opposite material state', activeCase);
        }
        checked += 1;
      });
    }
  }
  rmSync(FAILURE_PATH, { force:true });
  console.log(`PASS - Feature: ${FEATURE}, ${PROPERTY}`);
  console.log(`Seed: ${SEED} (0x${SEED.toString(16).padStart(8, '0')}); combinations: ${checked}`);
  console.log(`Coverage: ${SCENARIOS.length} completion scenarios × ${CAPABILITIES.length} capability branches × ${REPETITIONS}; settled transitions: ${cases.filter(item => item.transition).length}; counterexample: none`);
} catch (error) {
  persistFailure(activeCase, error);
  process.exitCode = 1;
} finally {
  rmSync(TEMP_PATH, { force:true });
}
