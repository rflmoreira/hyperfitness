// Feature: workout-card-premium-redesign, Property 5: Métricas equivalentes e semântica de estado
// **Validates: Requirements 5.3, 5.5, 5.7, 5.10, 5.11, 8.10, 8.11**
// Usage: node tests/workout-card-premium-redesign/property-05-metric-semantics.test.mjs
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BREAKPOINT_WIDTHS, INDEX_PATH, renderFixtureDocument } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAILURE_PATH = join(HERE, '.property-05-metric-semantics.failure.json');
const TEMP_PATH = join(HERE, '.tmp-property-05-metric-semantics.html');
const FEATURE = 'workout-card-premium-redesign';
const PROPERTY = 'Property 5: Métricas equivalentes e semântica de estado';
const DEFAULT_SEED = 0x48465035;
const CASE_REPETITIONS = 3;
const WIDTH_TOLERANCE_PX = 0.75;
const PROGRESS_TOLERANCE_PERCENT = 0.75;
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
const SERIES_STATES = Object.freeze(['informational', 'idle', 'active', 'complete']);
const REPS_STATES = Object.freeze(['closed', 'open']);
const REST_STATES = Object.freeze(['free', 'idle', 'counting', 'finished', 'cancelled']);
const RGB = Object.freeze({ orange:[255, 122, 31], blue:[137, 180, 250], green:[166, 227, 161] });

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
const shuffle = values => {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
};
const clock = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
const cartesianStates = SERIES_STATES.flatMap(seriesState =>
  REPS_STATES.flatMap(repsState => REST_STATES.map(restState => ({ seriesState, repsState, restState }))));
const repeatedStates = shuffle(Array.from({ length:CASE_REPETITIONS }, () => cartesianStates).flat());

const cases = repeatedStates.map((states, index) => {
  const total = integer(2, 8);
  const current = states.seriesState === 'active' ? integer(1, total - 1)
    : states.seriesState === 'complete' ? total : 0;
  const restSeconds = pick([30, 45, 60, 75, 90, 120]);
  const elapsed = states.restState === 'counting' ? integer(1, restSeconds - 1) : 0;
  const originalSeries = states.seriesState === 'informational' ? pick(['AMRAP', 'Falha técnica', 'Livre']) : String(total);
  const reps = pick(['8', '10–12', '12/10/8', '20/18/15/12', 'Falha controlada']);
  const originalRest = states.restState === 'free' ? pick(['Livre', 'Flexível']) : `${restSeconds} seg`;
  const seriesProgress = total > 0 && states.seriesState !== 'informational' ? current / total * 100 : 0;
  const restProgress = states.restState === 'finished' ? 100
    : states.restState === 'counting' ? elapsed / restSeconds * 100 : 0;
  return {
    index, ...states, total, current, restSeconds, elapsed, originalSeries, reps, originalRest,
    width:BREAKPOINT_WIDTHS[index % BREAKPOINT_WIDTHS.length],
    context:random() < 0.5 ? 'main' : 'week-sheet', pointer:random() < 0.35 ? 'coarse' : 'fine',
    capability:pick(['chromium', 'webkit', 'basic']),
    expected:{
      series:{ value:states.seriesState === 'informational' ? originalSeries : `${current}/${total}`,
        helper:states.seriesState === 'informational' ? 'Informativo'
          : states.seriesState === 'complete' ? 'Séries completas'
            : states.seriesState === 'active' ? 'Toque para avançar' : 'Toque para registrar',
        progress:`${seriesProgress.toFixed(1)}%`, progressNumber:seriesProgress,
        className:states.seriesState === 'active' ? 'is-active' : states.seriesState === 'complete' ? 'is-complete' : null,
        ariaPressed:states.seriesState === 'active' || states.seriesState === 'complete' ? 'true' : 'false',
        ariaDisabled:states.seriesState === 'informational' ? 'true' : null },
      reps:{ value:reps, helper:'Toque para detalhes', className:states.repsState === 'open' ? 'is-open' : null,
        ariaExpanded:states.repsState === 'open' ? 'true' : 'false' },
      rest:{ value:states.restState === 'counting' ? clock(restSeconds - elapsed)
          : states.restState === 'finished' ? 'Pronto!' : originalRest,
        helper:states.restState === 'free' ? 'Descanso livre'
          : states.restState === 'counting' ? 'toque para cancelar'
            : states.restState === 'finished' ? 'Respire e retome' : 'Toque para iniciar',
        progress:`${restProgress.toFixed(1)}%`, progressNumber:restProgress,
        className:states.restState === 'counting' ? 'is-counting' : states.restState === 'finished' ? 'finished' : null,
        ariaPressed:states.restState === 'free' ? null : states.restState === 'counting' ? 'true' : 'false' }
    }
  };
});

function exerciseFor(testCase) {
  return { name:'Elevação Pélvica com Barra', method:'Pirâmide Crescente + Isometria',
    series:testCase.originalSeries, rept:testCase.reps, descanso:testCase.originalRest };
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

function measurementScript(widthCases) {
  return `
  (() => {
    document.body.dataset.propertyHarnessState = 'started';
    const expectedCases = ${JSON.stringify(widthCases)};
    const expectedByIndex = new Map(expectedCases.map(item => [String(item.index), item]));
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
        width:value.width, height:value.height };
    };
    const rgb = value => {
      const match = String(value).match(/rgba?\\(\\s*([\\d.]+)[, ]+\\s*([\\d.]+)[, ]+\\s*([\\d.]+)/);
      return match ? match.slice(1, 4).map(Number) : null;
    };
    const requireElement = (root, selector) => {
      const element = root.querySelector(selector);
      if (!element) throw new Error('Missing metric element: ' + selector);
      return element;
    };
    const setNullableAttribute = (element, name, value) => {
      if (value === null) element.removeAttribute(name); else element.setAttribute(name, value);
    };
    const applyState = (card, generated) => {
      const series = requireElement(card, '[data-stat-type="series"]');
      const reps = requireElement(card, '[data-stat-type="reps"]');
      const rest = requireElement(card, '[data-stat-type="rest"]');
      series.classList.remove('is-active', 'is-complete');
      if (generated.expected.series.className) series.classList.add(generated.expected.series.className);
      requireElement(series, '[data-role="series-value"]').textContent = generated.expected.series.value;
      requireElement(series, '.stat-helper').textContent = generated.expected.series.helper;
      requireElement(series, '.stat-progress-fill').style.width = generated.expected.series.progress;
      setNullableAttribute(series, 'aria-pressed', generated.expected.series.ariaPressed);
      setNullableAttribute(series, 'aria-disabled', generated.expected.series.ariaDisabled);
      reps.classList.toggle('is-open', generated.repsState === 'open');
      reps.setAttribute('aria-expanded', generated.expected.reps.ariaExpanded);
      rest.classList.remove('is-counting', 'finished');
      if (generated.expected.rest.className) rest.classList.add(generated.expected.rest.className);
      requireElement(rest, '[data-role="rest-value"]').textContent = generated.expected.rest.value;
      requireElement(rest, '[data-role="rest-helper"]').textContent = generated.expected.rest.helper;
      requireElement(rest, '.stat-progress-fill').style.width = generated.expected.rest.progress;
      setNullableAttribute(rest, 'aria-pressed', generated.expected.rest.ariaPressed);
    };
    const measureChip = chip => {
      const computed = getComputedStyle(chip);
      const value = requireElement(chip, ':scope > .stat-value');
      const helper = requireElement(chip, ':scope > .stat-helper');
      const icon = requireElement(chip, '.stat-icon');
      const bars = [...chip.querySelectorAll('.stat-progress-bar')];
      const fills = [...chip.querySelectorAll('.stat-progress-fill')];
      const barRect = bars[0] ? rect(bars[0]) : null;
      const fillRect = fills[0] ? rect(fills[0]) : null;
      return {
        type:chip.dataset.statType, rect:rect(chip), display:computed.display,
        gridTemplateAreas:computed.gridTemplateAreas, gridTemplateRows:computed.gridTemplateRows,
        semanticOrder:[...chip.children].filter(child => child.matches('.chip-header,.stat-value,.stat-helper'))
          .map(child => child.matches('.chip-header') ? 'label' : child.matches('.stat-value') ? 'value' : 'helper'),
        value:value.textContent, helper:helper.textContent,
        classes:[...chip.classList].filter(name => ['is-active','is-complete','is-open','is-counting','finished'].includes(name)),
        aria:{ pressed:chip.getAttribute('aria-pressed'), disabled:chip.getAttribute('aria-disabled'),
          expanded:chip.getAttribute('aria-expanded'), live:chip.getAttribute('aria-live') },
        colors:{ background:rgb(computed.backgroundColor), border:rgb(computed.borderTopColor),
          value:rgb(getComputedStyle(value).color), icon:rgb(getComputedStyle(icon).color),
          fill:fills[0] ? rgb(getComputedStyle(fills[0]).backgroundColor) : null,
          pulse:rgb(getComputedStyle(chip, '::before').borderTopColor) },
        indicators:{ bars:bars.length, fills:fills.length,
          progressLike:chip.querySelectorAll('[class*="progress"],[role="progressbar"]').length,
          inlineWidth:fills[0]?.style.width || null,
          percent:barRect && barRect.width > 0 && fillRect ? fillRect.width / barRect.width * 100 : null },
        overlay:chip.dataset.statType === 'reps' ? {
          count:chip.querySelectorAll('.stat-details').length,
          role:requireElement(chip, '.stat-details').getAttribute('role'),
          opacity:getComputedStyle(requireElement(chip, '.stat-details')).opacity,
          pointerEvents:getComputedStyle(requireElement(chip, '.stat-details')).pointerEvents
        } : null
      };
    };
    const measure = container => {
      const generated = expectedByIndex.get(container.dataset.propertyIndex);
      if (!generated) throw new Error('Missing generated case ' + container.dataset.propertyIndex);
      const card = requireElement(container, '.workout-card');
      applyState(card, generated);
      void card.offsetHeight;
      const group = requireElement(card, '.exercise-stats-chip-group');
      return { caseIndex:Number(container.dataset.propertyIndex),
        group:{ rect:rect(group), display:getComputedStyle(group).display,
          columns:getComputedStyle(group).gridTemplateColumns },
        chips:[...card.querySelectorAll('.exercise-stat-button')].map(measureChip) };
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
    id:`property-05-${item.index}`, width:item.width, context:item.context,
    pointer:item.pointer, motion:'full', capability:item.capability, state:'pending'
  }, exerciseFor(item)));
  const fixtures = documents.map((document, index) =>
    `<section class="property-case" data-property-index="${widthCases[index].index}">${extractFixtureMarkup(document)}</section>`).join('\n');
  return `<!doctype html><html lang="pt-BR"><head>${extractHead(documents[0])}
    <style>
      body{display:block!important;padding:24px!important;box-sizing:border-box!important}
      .property-case{width:min(100%,560px);margin:0 auto 32px}.property-case .harness-main{width:100%}
      .property-case .hf-week-sheet{position:relative!important;inset:auto!important;z-index:auto!important;overflow:visible!important;width:100%!important}
      .property-case .hf-week-sheet__panel{width:100%!important}
    </style></head><body>${fixtures}<script>${measurementScript(widthCases)}</script></body></html>`;
}

function runWidthGroup(widthCases) {
  writeFileSync(TEMP_PATH, groupedDocument(widthCases), 'utf8');
  const width = widthCases[0].width;
  const diagnostics = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const profilePath = `${TEMP_PATH}.chrome-${process.pid}-${width}-${attempt}`;
    rmSync(profilePath, { recursive:true, force:true });
    const result = spawnSync(CHROME, [
      '--headless=new', '--hide-scrollbars', '--disable-background-networking', '--disable-extensions',
      '--disable-component-update', '--disable-default-apps', '--disable-sync', '--metrics-recording-only',
      '--no-first-run', '--host-resolver-rules=MAP * ~NOTFOUND', `--user-data-dir=${profilePath}`,
      `--window-size=${width},6500`, '--dump-dom', pathToFileURL(TEMP_PATH).href
    ], { encoding:'utf8', timeout:15_000, maxBuffer:24 * 1024 * 1024 });
    rmSync(profilePath, { recursive:true, force:true });
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const stateMatch = stdout.match(/data-property-harness-state="([^"]+)"/);
    const errorMatch = stdout.match(/data-property-error="([A-Za-z0-9+/=]+)"/);
    const payloadMatch = stdout.match(/data-property-results="([A-Za-z0-9+/=]+)"/);
    if (errorMatch) {
      const browserError = Buffer.from(errorMatch[1], 'base64').toString('utf8');
      const error = new Error(`Chromium metric harness errored at width ${width}: ${browserError}`);
      error.observed = { width, attempt, harnessState:stateMatch?.[1] || 'missing' };
      throw error;
    }
    if (result.status === 0 && stateMatch?.[1] === 'complete' && payloadMatch) {
      try {
        const parsed = JSON.parse(Buffer.from(payloadMatch[1], 'base64').toString('utf8'));
        if (!Array.isArray(parsed)) throw new Error('Decoded payload is not an array');
        return parsed;
      } catch (payloadError) {
        diagnostics.push({ attempt, status:result.status, harnessState:stateMatch[1], payloadError:payloadError.message });
        continue;
      }
    }
    diagnostics.push({ attempt, status:result.status, signal:result.signal || null,
      spawnError:result.error?.message || null, harnessState:stateMatch?.[1] || 'missing',
      stdoutBytes:Buffer.byteLength(stdout), stderrBytes:Buffer.byteLength(stderr),
      stdoutTail:stdout.slice(-400), stderrTail:stderr.slice(-1600) });
  }
  const error = new Error(`Chromium metric harness produced no conclusive payload at width ${width}`);
  error.observed = { width, diagnostics };
  throw error;
}

function requireInvariant(condition, assertion, observed) {
  if (!condition) {
    const error = new Error(assertion);
    error.assertion = assertion;
    error.observed = observed;
    throw error;
  }
}
const sameRgb = (actual, expected) => Array.isArray(actual)
  && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
const near = (actual, expected, tolerance) => Math.abs(actual - expected) <= tolerance;
const expectedClassList = className => className ? [className] : [];

function assertProgress(metric, expected, label) {
  requireInvariant(metric.indicators.bars === 1 && metric.indicators.fills === 1,
    `${label} must preserve its single existing progress track and fill`, metric.indicators);
  const inlinePercent = Number.parseFloat(metric.indicators.inlineWidth);
  requireInvariant(Number.isFinite(inlinePercent)
    && near(inlinePercent, expected.progressNumber, PROGRESS_TOLERANCE_PERCENT),
    `${label} progress inline width must remain driven by the current state model`,
    { expected:expected.progressNumber, actual:inlinePercent, serialized:metric.indicators.inlineWidth });
  requireInvariant(metric.indicators.percent !== null
    && near(metric.indicators.percent, expected.progressNumber, PROGRESS_TOLERANCE_PERCENT),
  `${label} rendered progress must match the current value`,
  { expected:expected.progressNumber, actual:metric.indicators.percent });
}

function assertMeasurement(testCase, measurement) {
  requireInvariant(measurement.caseIndex === testCase.index,
    'harness result must retain its generated case index', { expected:testCase.index, actual:measurement.caseIndex });
  requireInvariant(measurement.group.display === 'grid',
    'metric track must remain an equal three-column grid', measurement.group);
  const chips = measurement.chips;
  requireInvariant(chips.length === 3 && chips.map(chip => chip.type).join('>') === 'series>reps>rest',
    'metric track must preserve exactly Series, Reps and Rest in order', chips.map(chip => chip.type));
  const widths = chips.map(chip => chip.rect.width);
  requireInvariant(Math.max(...widths) - Math.min(...widths) <= WIDTH_TOLERANCE_PX,
    'all three metric chips must retain equivalent widths', widths);
  requireInvariant(measurement.group.columns.split(/\s+/).filter(Boolean).length === 3,
    'metric group must resolve exactly three grid tracks', measurement.group.columns);
  requireInvariant(chips.every(chip => chip.display === 'grid'
      && chip.gridTemplateAreas === chips[0].gridTemplateAreas
      && chip.gridTemplateRows.split(/\s+/).filter(Boolean).length === 3
      && chip.semanticOrder.join('>') === 'label>value>helper'),
  'all chips must retain the same three-row label → value → helper grid',
  chips.map(chip => ({ type:chip.type, display:chip.display, areas:chip.gridTemplateAreas,
    rows:chip.gridTemplateRows, order:chip.semanticOrder })));

  const [series, reps, rest] = chips;
  requireInvariant(series.value === testCase.expected.series.value
    && series.helper === testCase.expected.series.helper,
  'Series value and helper must match the current state model',
  { expected:testCase.expected.series, actual:{ value:series.value, helper:series.helper } });
  requireInvariant(JSON.stringify(series.classes) === JSON.stringify(expectedClassList(testCase.expected.series.className))
    && series.aria.pressed === testCase.expected.series.ariaPressed
    && series.aria.disabled === testCase.expected.series.ariaDisabled,
  'Series class and ARIA signals must match its current state',
  { state:testCase.seriesState, classes:series.classes, aria:series.aria });
  assertProgress(series, testCase.expected.series, 'Series');

  requireInvariant(reps.value === testCase.expected.reps.value && reps.helper === testCase.expected.reps.helper,
    'Reps value and helper must remain current in closed and open states',
    { expected:testCase.expected.reps, actual:{ value:reps.value, helper:reps.helper } });
  requireInvariant(JSON.stringify(reps.classes) === JSON.stringify(expectedClassList(testCase.expected.reps.className))
    && reps.aria.expanded === testCase.expected.reps.ariaExpanded,
  'Reps open/closed class and aria-expanded signals must be preserved',
  { state:testCase.repsState, classes:reps.classes, aria:reps.aria });
  requireInvariant(reps.indicators.bars === 0 && reps.indicators.fills === 0
    && reps.indicators.progressLike === 0 && reps.indicators.inlineWidth === null,
  'Reps must never acquire a progress indicator', reps.indicators);
  requireInvariant(reps.overlay.count === 1 && reps.overlay.role === 'dialog'
    && reps.overlay.opacity === (testCase.repsState === 'open' ? '1' : '0')
    && reps.overlay.pointerEvents === (testCase.repsState === 'open' ? 'auto' : 'none'),
  'Reps must preserve its existing dialog as the alternate open-state signal', reps.overlay);

  requireInvariant(rest.value === testCase.expected.rest.value && rest.helper === testCase.expected.rest.helper,
    'Rest value and helper must match free, idle, counting, finished and cancelled models',
    { expected:testCase.expected.rest, actual:{ value:rest.value, helper:rest.helper } });
  requireInvariant(JSON.stringify(rest.classes) === JSON.stringify(expectedClassList(testCase.expected.rest.className))
    && rest.aria.pressed === testCase.expected.rest.ariaPressed && rest.aria.live === 'polite',
  'Rest classes, aria-pressed and live-region signals must match its current state',
  { state:testCase.restState, classes:rest.classes, aria:rest.aria });
  assertProgress(rest, testCase.expected.rest, 'Rest');

  requireInvariant(chips.every(chip => sameRgb(chip.colors.icon, RGB.orange)),
    'existing metric action icons must preserve the orange semantic accent', chips.map(chip => chip.colors.icon));
  if (testCase.seriesState === 'active') {
    requireInvariant(sameRgb(series.colors.background, RGB.orange)
      && sameRgb(series.colors.border, RGB.orange) && sameRgb(series.colors.fill, RGB.orange),
    'active Series must map surface, border and progress to orange', series.colors);
  }
  if (testCase.seriesState === 'complete') {
    requireInvariant(sameRgb(series.colors.background, RGB.green) && sameRgb(series.colors.border, RGB.green)
      && sameRgb(series.colors.value, RGB.green) && sameRgb(series.colors.fill, RGB.green),
    'complete Series must map surface, border, value and progress to green', series.colors);
  }
  if (testCase.restState === 'counting') {
    requireInvariant(sameRgb(rest.colors.background, RGB.blue) && sameRgb(rest.colors.border, RGB.blue)
      && sameRgb(rest.colors.value, RGB.blue) && sameRgb(rest.colors.fill, RGB.blue)
      && sameRgb(rest.colors.pulse, RGB.blue),
    'counting Rest must map surface, border, value, progress and pulse to blue', rest.colors);
  }
  if (testCase.restState === 'finished') {
    requireInvariant(sameRgb(rest.colors.background, RGB.green) && sameRgb(rest.colors.border, RGB.green)
      && sameRgb(rest.colors.value, RGB.green) && sameRgb(rest.colors.fill, RGB.green),
    'finished Rest must map surface, border, value and progress to green', rest.colors);
  }
}

function assertGenerationAndSourceContracts() {
  requireInvariant(cases.length >= 100,
    'property must generate at least 100 seeded Series/Reps/Rest combinations', cases.length);
  requireInvariant(cases.length === cartesianStates.length * CASE_REPETITIONS,
    'generator must repeat the complete Cartesian state product',
    { combinations:cases.length, cartesian:cartesianStates.length, repetitions:CASE_REPETITIONS });
  const tuple = item => `${item.seriesState}|${item.repsState}|${item.restState}`;
  const counts = new Map(cases.map(item => [tuple(item), 0]));
  cases.forEach(item => counts.set(tuple(item), counts.get(tuple(item)) + 1));
  requireInvariant(cartesianStates.every(state => counts.get(tuple(state)) === CASE_REPETITIONS),
    'every Series/Reps/Rest state tuple must be covered equally', Object.fromEntries(counts));
  requireInvariant(BREAKPOINT_WIDTHS.every(width => cases.filter(item => item.width === width).length === 8),
    'all supported breakpoint neighbors must receive equal seeded coverage',
    Object.fromEntries(BREAKPOINT_WIDTHS.map(width => [width, cases.filter(item => item.width === width).length])));
  const contracts = [
    ['three equal metric tracks', /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/],
    ['shared internal metric grid', /grid-template-areas:\s*\n\s*"label"\s*\n\s*"value"\s*\n\s*"helper"/],
    ['orange active Series', /data-stat-type="series"\]\.is-active[\s\S]{0,180}rgba\(255,\s*122,\s*31/],
    ['blue counting Rest', /data-stat-type="rest"\]\.is-counting[\s\S]{0,220}rgba\(137,\s*180,\s*250/],
    ['green complete semantics', /is-complete[\s\S]{0,180}var\(--green\)/],
    ['Reps renderer without progress', /data-stat-type="reps"[\s\S]{0,700}stat-details/]
  ];
  const missing = contracts.filter(([, pattern]) => !pattern.test(source)).map(([name]) => name);
  requireInvariant(missing.length === 0,
    'real source must retain the metric layout and semantic-state contracts', { missing });
  const rendererStart = source.indexOf('function createExerciseStatsHTML');
  const rendererEnd = source.indexOf('function parseTotalSeries', rendererStart);
  const renderer = source.slice(rendererStart, rendererEnd);
  const repsStart = renderer.indexOf('data-stat-type="reps"');
  const restStart = renderer.indexOf('data-stat-type="rest"');
  requireInvariant(repsStart >= 0 && restStart > repsStart
    && !/stat-progress-(?:bar|fill)/.test(renderer.slice(repsStart, restStart)),
  'real Reps markup must remain free of progress indicators', null);
}

function persistFailure(testCase, error) {
  const record = {
    feature:FEATURE, property:PROPERTY, seed:SEED,
    seedHex:`0x${SEED.toString(16).padStart(8, '0')}`,
    combinations:cases.length, cartesianStateTuples:cartesianStates.length,
    widthToleranceCssPx:WIDTH_TOLERANCE_PX,
    progressTolerancePercent:PROGRESS_TOLERANCE_PERCENT,
    counterexample:testCase, assertion:error.assertion || error.message,
    observed:error.observed || null,
    replay:`HF_PBT_SEED=${SEED} node tests/workout-card-premium-redesign/property-05-metric-semantics.test.mjs`
  };
  writeFileSync(FAILURE_PATH, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  console.error(`COUNTEREXAMPLE ${JSON.stringify(record)}`);
  return record;
}

let checked = 0;
let activeCase = { kind:'generation-and-source-contract' };
try {
  if (!CHROME) throw new Error('A local Chromium executable is required by the existing property harness');
  assertGenerationAndSourceContracts();
  for (const width of BREAKPOINT_WIDTHS) {
    const widthCases = cases.filter(item => item.width === width);
    activeCase = { kind:'browser-harness', width, generatedCases:widthCases.length };
    const results = runWidthGroup(widthCases);
    requireInvariant(results.length === widthCases.length,
      'browser harness must return exactly one result per generated case',
      { width, expected:widthCases.length, actual:results.length });
    results.forEach((result, index) => {
      activeCase = widthCases[index];
      requireInvariant(result.ok, 'browser must measure every generated fixture', result.error);
      assertMeasurement(activeCase, result.measurement);
      checked += 1;
    });
  }
  rmSync(FAILURE_PATH, { force:true });
  console.log(`PASS - Feature: ${FEATURE}, ${PROPERTY}`);
  console.log(`Seed: ${SEED} (0x${SEED.toString(16).padStart(8, '0')}); combinations: ${checked}; complete state tuples: ${cartesianStates.length}`);
  console.log(`Harness: UTF-8 chunked payload, completion sentinel, isolated profiles, 2 retries; counterexample: none`);
} catch (error) {
  persistFailure(activeCase, error);
  process.exitCode = 1;
} finally {
  rmSync(TEMP_PATH, { force:true });
}
