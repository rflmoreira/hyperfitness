// Feature: workout-card-premium-redesign, Property 4: Hierarquia tipográfica e contenção integral
// **Validates: Requirements 4.3, 4.4, 4.6, 4.7, 4.8, 4.9, 4.10, 5.5, 5.6, 5.7**
// Usage: node tests/workout-card-premium-redesign/property-04-typography-containment.test.mjs
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BREAKPOINT_WIDTHS, renderFixtureDocument } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAILURE_PATH = join(HERE, '.property-04-typography-containment.failure.json');
const TEMP_PATH = join(HERE, '.tmp-property-04-typography-containment.html');
const FEATURE = 'workout-card-premium-redesign';
const PROPERTY = 'Property 4: Hierarquia tipográfica e contenção integral';
const DEFAULT_SEED = 0x48465034;
const CASES_PER_WIDTH = 8;
const GEOMETRY_TOLERANCE_PX = 0.75;
const requestedSeed = process.env.HF_PBT_SEED ?? process.env.HF_PROPERTY_SEED;
const parsedSeed = requestedSeed === undefined ? DEFAULT_SEED : Number(requestedSeed);
const SEED = Number.isFinite(parsedSeed) ? parsedSeed >>> 0 : DEFAULT_SEED;
const CHROME = [
  process.env.HF_CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
].filter(Boolean).find(existsSync);

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
const pickOffset = length => Math.floor(random() * length);
const titles = [
  'Remada', 'Leg Press 45°', 'Elevação Pélvica com Barra',
  'Desenvolvimento Máquina — pegada neutra',
  'Rosca Martelo + Tríceps Francês com Corda',
  'Agachamento Smith com Pausa Isométrica',
  'Elevação lateral unilateral: ação contínua',
  'Abdução de quadril com contração máxima 🔥'
];
const methods = [
  'Bi-set', 'Drop-set', 'Rest Pause', 'Cluster 4×4',
  'Pirâmide Crescente + Isometria', 'Ênfase excêntrica • cadência 3:1',
  'Bi-set + Drop-set + Pausa', 'Pirâmide + Isometria + Rest Pause'
];
const values = [
  '1', '4', '12', '120', '8–12', '20/18/15/12', '01:30', 'AMRAP'
];
const helpers = [
  'Registrar', 'Toque para iniciar', 'Toque para detalhes',
  'Última série', 'Cadência 3:1', 'Sem pausa',
  'Contração máxima', 'Toque • ação contínua'
];

const cases = BREAKPOINT_WIDTHS.flatMap((width, widthIndex) =>
  Array.from({ length: CASES_PER_WIDTH }, (_, slot) => {
    const title = titles[(slot + pickOffset(titles.length)) % titles.length];
    const method = methods[(slot + widthIndex + pickOffset(methods.length)) % methods.length];
    return {
      index: widthIndex * CASES_PER_WIDTH + slot,
      width,
      context: (slot + widthIndex) % 2 ? 'week-sheet' : 'main',
      pointer: random() < 0.35 ? 'coarse' : 'fine',
      capability: ['chromium', 'webkit', 'basic'][Math.floor(random() * 3)],
      title,
      method,
      values: Array.from({ length: 3 }, (_, metric) =>
        values[(slot + metric + pickOffset(values.length)) % values.length]),
      helpers: Array.from({ length: 3 }, (_, metric) =>
        helpers[(widthIndex + slot + metric + pickOffset(helpers.length)) % helpers.length])
    };
  })
);

function exerciseFor(testCase) {
  return {
    name: testCase.title,
    method: testCase.method,
    series: testCase.values[0],
    rept: testCase.values[1],
    descanso: '90 seg'
  };
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
    const serializeRect = value => ({
      left:value.left, right:value.right, top:value.top, bottom:value.bottom,
      width:value.width, height:value.height, area:value.width * value.height
    });
    const rect = element => serializeRect(element.getBoundingClientRect());
    const textFragmentRects = element => {
      const fragments = [];
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.nodeValue || !node.nodeValue.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const fragment of range.getClientRects()) {
          if (fragment.width > 0 && fragment.height > 0) fragments.push(serializeRect(fragment));
        }
        range.detach();
      }
      return fragments;
    };
    const unionBounds = fragments => fragments.length === 0 ? null : {
      left:Math.min(...fragments.map(value => value.left)),
      right:Math.max(...fragments.map(value => value.right)),
      top:Math.min(...fragments.map(value => value.top)),
      bottom:Math.max(...fragments.map(value => value.bottom)),
      width:Math.max(...fragments.map(value => value.right)) - Math.min(...fragments.map(value => value.left)),
      height:Math.max(...fragments.map(value => value.bottom)) - Math.min(...fragments.map(value => value.top))
    };
    const style = element => {
      const computed = getComputedStyle(element);
      return { fontSize:Number.parseFloat(computed.fontSize) || 0,
        fontWeight:Number.parseFloat(computed.fontWeight) || 0,
        lineHeight:computed.lineHeight, overflow:computed.overflow,
        overflowX:computed.overflowX, overflowY:computed.overflowY,
        whiteSpace:computed.whiteSpace, textOverflow:computed.textOverflow,
        webkitLineClamp:computed.webkitLineClamp, lineClamp:computed.lineClamp,
        display:computed.display, visibility:computed.visibility };
    };
    const textMetrics = element => {
      const textRects = textFragmentRects(element);
      return {
        text:element.textContent,
        rect:rect(element), textBounds:unionBounds(textRects), textRects, style:style(element),
        clientWidth:element.clientWidth, clientHeight:element.clientHeight,
        scrollWidth:element.scrollWidth, scrollHeight:element.scrollHeight
      };
    };
    const requireElement = (root, selector) => {
      const element = root.querySelector(selector);
      if (!element) throw new Error('Missing typography element: ' + selector);
      return element;
    };
    const measure = container => {
      const expected = expectedByIndex.get(container.dataset.propertyIndex);
      if (!expected) throw new Error('Missing generated input for case ' + container.dataset.propertyIndex);
      const card = requireElement(container, '.workout-card');
      const title = requireElement(card, 'h3');
      const titleFill = requireElement(title, '.workout-card-title__fill');
      const badge = requireElement(card, '.exercise-method-pill');
      const methodIcon = requireElement(badge, ':scope > .method-icon');
      const methodLabel = requireElement(badge, ':scope > .method-label');
      const chips = [...card.querySelectorAll('.exercise-stat-button')];
      if (chips.length !== 3) throw new Error('Expected exactly three metric chips');
      chips.forEach((chip, index) => {
        requireElement(chip, ':scope > .stat-value').textContent = expected.values[index];
        requireElement(chip, ':scope > .stat-helper').textContent = expected.helpers[index];
      });
      void card.offsetHeight;
      const metrics = chips.map(chip => {
        const header = requireElement(chip, ':scope > .chip-header');
        const label = requireElement(header, ':scope > .stat-label');
        const value = requireElement(chip, ':scope > .stat-value');
        const helper = requireElement(chip, ':scope > .stat-helper');
        return {
          owner:rect(chip), header:textMetrics(header), label:textMetrics(label),
          value:textMetrics(value), helper:textMetrics(helper),
          semanticOrder:[...chip.children].filter(child =>
            child.matches('.chip-header,.stat-value,.stat-helper')).map(child =>
              child.classList.contains('chip-header') ? 'label' :
                child.classList.contains('stat-value') ? 'value' : 'helper')
        };
      });
      const auxiliary = [methodLabel,
        ...chips.flatMap(chip => [...chip.querySelectorAll('.stat-label,.stat-value,.stat-helper')]),
        ...card.querySelectorAll('.completion-toggle-wrapper > span')
      ].map(textMetrics);
      return {
        caseIndex:Number(container.dataset.propertyIndex),
        expected:{ title:expected.title, method:expected.method,
          values:expected.values, helpers:expected.helpers },
        card:rect(card), title:textMetrics(title), titleFill:textMetrics(titleFill), badge:{ rect:rect(badge), style:style(badge),
          scrollWidth:badge.scrollWidth, scrollHeight:badge.scrollHeight,
          clientWidth:badge.clientWidth, clientHeight:badge.clientHeight },
        method:{ label:textMetrics(methodLabel), icon:{ rect:rect(methodIcon),
          className:methodIcon.className, ariaHidden:methodIcon.getAttribute('aria-hidden') } },
        metrics, auxiliary
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
        try { return { ok:true, measurement:measure(container) }; }
        catch (error) { return { ok:false, caseIndex:Number(container.dataset.propertyIndex), error:error.stack || error.message }; }
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
    id:`property-04-${item.index}`, width:item.width, context:item.context,
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
      '--disable-component-update', '--disable-default-apps', '--disable-sync',
      '--metrics-recording-only', '--no-first-run', '--host-resolver-rules=MAP * ~NOTFOUND',
      `--user-data-dir=${profilePath}`, `--window-size=${width},6500`,
      '--dump-dom', pathToFileURL(TEMP_PATH).href
    ], { encoding:'utf8', timeout:15_000, maxBuffer:24 * 1024 * 1024 });
    rmSync(profilePath, { recursive:true, force:true });
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const stateMatch = stdout.match(/data-property-harness-state="([^"]+)"/);
    const errorMatch = stdout.match(/data-property-error="([A-Za-z0-9+/=]+)"/);
    const payloadMatch = stdout.match(/data-property-results="([A-Za-z0-9+/=]+)"/);
    if (errorMatch) {
      const browserError = Buffer.from(errorMatch[1], 'base64').toString('utf8');
      const error = new Error(`Chromium typography harness errored at width ${width}: ${browserError}`);
      error.observed = { width, attempt, harnessState:stateMatch?.[1] || 'missing' };
      throw error;
    }
    if (result.status === 0 && stateMatch?.[1] === 'complete' && payloadMatch) {
      try {
        const decoded = Buffer.from(payloadMatch[1], 'base64').toString('utf8');
        const parsed = JSON.parse(decoded);
        if (!Array.isArray(parsed)) throw new Error('Decoded payload is not an array');
        return parsed;
      } catch (payloadError) {
        diagnostics.push({ attempt, status:result.status, harnessState:stateMatch[1],
          payloadError:payloadError.message, payloadBytes:payloadMatch[1].length });
        continue;
      }
    }
    diagnostics.push({ attempt, status:result.status, signal:result.signal || null,
      spawnError:result.error?.message || null, harnessState:stateMatch?.[1] || 'missing',
      stdoutBytes:Buffer.byteLength(stdout), stderrBytes:Buffer.byteLength(stderr),
      stdoutTail:stdout.slice(-400), stderrTail:stderr.slice(-1600) });
  }
  const error = new Error(`Chromium typography harness produced no conclusive payload at width ${width}`);
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

const inside = (inner, outer) => inner.left >= outer.left - GEOMETRY_TOLERANCE_PX
  && inner.right <= outer.right + GEOMETRY_TOLERANCE_PX
  && inner.top >= outer.top - GEOMETRY_TOLERANCE_PX
  && inner.bottom <= outer.bottom + GEOMETRY_TOLERANCE_PX;
const before = (upper, lower) => upper.bottom <= lower.top + GEOMETRY_TOLERANCE_PX;
// scroll*/client* expose the scroll container, not glyph ink. They are meaningful for
// clipping only when the computed overflow on that axis establishes a clipping viewport.
const CLIPPING_OVERFLOW = new Set(['auto', 'hidden', 'clip', 'scroll']);
const integerScrollFits = (scrollSize, clientSize) =>
  scrollSize <= Math.ceil(clientSize + GEOMETRY_TOLERANCE_PX);
const notClipped = item =>
  (!CLIPPING_OVERFLOW.has(item.style.overflowX)
    || integerScrollFits(item.scrollWidth, item.clientWidth))
  && (!CLIPPING_OVERFLOW.has(item.style.overflowY)
    || integerScrollFits(item.scrollHeight, item.clientHeight));
const renderedTextInside = (item, owner) => item.textBounds !== null
  && inside(item.textBounds, owner)
  && item.textRects.every(fragment => inside(fragment, owner));
const fullyContainedText = (item, owner) => inside(item.rect, owner)
  && renderedTextInside(item, owner)
  && notClipped(item);
const same = values => Math.max(...values) - Math.min(...values) <= 0.01;

function assertMeasurement(testCase, measurement) {
  const { expected, card, title, titleFill, badge, method, metrics, auxiliary } = measurement;
  requireInvariant(measurement.caseIndex === testCase.index,
    'harness result must retain its generated case index', { expected:testCase.index, actual:measurement.caseIndex });
  requireInvariant(title.text === expected.title && expected.title === testCase.title,
    'complete generated title must be rendered without content loss', { expected:testCase.title, actual:title.text });
  requireInvariant(fullyContainedText(title, card),
    'complete title element and rendered text bounds must remain inside the card without effective clipping',
    { title, card });
  requireInvariant(titleFill.style.overflow === 'hidden'
    && (titleFill.style.webkitLineClamp === '2' || titleFill.style.lineClamp === '2')
    && titleFill.style.textOverflow === 'ellipsis'
    && title.style.whiteSpace !== 'nowrap',
  'title fill must wrap with a 2-line clamp and ellipsize as part of the gradient text',
  { title:title.style, titleFill:titleFill.style });

  const otherSizes = auxiliary.map(item => item.style.fontSize);
  const otherWeights = auxiliary.map(item => item.style.fontWeight);
  requireInvariant(title.style.fontSize + 0.01 >= Math.max(...otherSizes)
    && title.style.fontWeight >= Math.max(...otherWeights),
  'title must retain the greatest scale and weight among card text',
  { title:title.style, maxOtherSize:Math.max(...otherSizes), maxOtherWeight:Math.max(...otherWeights) });
  requireInvariant(title.style.fontSize > badge.style.fontSize
    && title.style.fontWeight > badge.style.fontWeight,
  'title scale and weight must strictly dominate the method badge', { title:title.style, badge:badge.style });

  requireInvariant(method.label.text === expected.method && expected.method === testCase.method,
    'method text must be preserved in full', { expected:testCase.method, actual:method.label.text });
  requireInvariant(method.icon.className.split(/\s+/).includes('ph-info')
    && method.icon.className.split(/\s+/).includes('ph-bold') && method.icon.ariaHidden === 'true',
  'existing method icon and inert semantics must be preserved', method.icon);
  requireInvariant(inside(badge.rect, card)
    && inside(method.icon.rect, badge.rect) && fullyContainedText(method.label, badge.rect),
  'visible badge surface, icon, label element, and rendered label text must remain fully contained',
  { card, badge:badge.rect, method });
  requireInvariant(badge.rect.width < title.rect.width - GEOMETRY_TOLERANCE_PX
    && badge.rect.area < title.rect.area,
  'intrinsically sized badge must remain visually smaller than the title block',
  { badge:badge.rect, title:title.rect });

  requireInvariant(metrics.length === 3, 'all three metric chips must be measured', metrics.length);
  metrics.forEach((metric, index) => {
    requireInvariant(metric.semanticOrder.join('>') === 'label>value>helper',
      `metric ${index} must preserve label → value → helper semantic order`, metric.semanticOrder);
    requireInvariant(before(metric.header.rect, metric.value.rect) && before(metric.value.rect, metric.helper.rect),
      `metric ${index} must preserve label → value → helper visual order`, metric);
    requireInvariant(metric.value.text === expected.values[index]
      && metric.helper.text === expected.helpers[index],
    `metric ${index} must preserve complete generated value and helper content`,
    { expectedValue:expected.values[index], actualValue:metric.value.text,
      expectedHelper:expected.helpers[index], actualHelper:metric.helper.text });
    requireInvariant([metric.header, metric.value, metric.helper].every(item =>
      fullyContainedText(item, metric.owner)),
    `metric ${index} label, value, and helper elements and rendered text bounds must remain fully contained`, metric);
    requireInvariant(metric.value.style.fontSize > metric.label.style.fontSize
      && metric.value.style.fontSize > metric.helper.style.fontSize
      && metric.value.style.fontWeight >= metric.label.style.fontWeight
      && metric.value.style.fontWeight >= metric.helper.style.fontWeight,
    `metric ${index} value must remain typographically dominant`,
    { label:metric.label.style, value:metric.value.style, helper:metric.helper.style });
  });
  requireInvariant(same(metrics.map(metric => metric.label.style.fontSize))
    && same(metrics.map(metric => metric.value.style.fontSize))
    && same(metrics.map(metric => metric.helper.style.fontSize))
    && same(metrics.map(metric => metric.value.style.fontWeight)),
  'all three chips must use the same label/value/helper typographic relationship',
  metrics.map(metric => ({ label:metric.label.style, value:metric.value.style, helper:metric.helper.style })));
}

function assertGenerationCoverage() {
  requireInvariant(cases.length >= 100,
    'property must generate at least 100 seeded title/method/value/helper/width combinations', cases.length);
  requireInvariant(BREAKPOINT_WIDTHS.every(width => cases.some(item => item.width === width)),
    'every supported breakpoint neighbor must be generated', BREAKPOINT_WIDTHS);
  for (const key of ['title', 'method']) {
    requireInvariant(new Set(cases.map(item => item[key])).size >= 6,
      `seeded generator must exercise varied ${key} content`, [...new Set(cases.map(item => item[key]))]);
  }
  requireInvariant(new Set(cases.flatMap(item => item.values)).size >= 6,
    'seeded generator must exercise varied values', [...new Set(cases.flatMap(item => item.values))]);
  requireInvariant(new Set(cases.flatMap(item => item.helpers)).size >= 6,
    'seeded generator must exercise varied helpers', [...new Set(cases.flatMap(item => item.helpers))]);
  requireInvariant(cases.some(item => /[^\x00-\x7F]/.test(`${item.title}${item.method}${item.values.join('')}${item.helpers.join('')}`)),
    'seeded generator must include Unicode pressure content', null);
}

function persistFailure(testCase, error) {
  const record = {
    feature:FEATURE, property:PROPERTY, seed:SEED,
    seedHex:`0x${SEED.toString(16).padStart(8, '0')}`,
    combinations:cases.length, geometryToleranceCssPx:GEOMETRY_TOLERANCE_PX,
    counterexample:testCase, assertion:error.assertion || error.message,
    observed:error.observed || null,
    replay:`HF_PBT_SEED=${SEED} node tests/workout-card-premium-redesign/property-04-typography-containment.test.mjs`
  };
  writeFileSync(FAILURE_PATH, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  console.error(`COUNTEREXAMPLE ${JSON.stringify(record)}`);
  return record;
}

let checked = 0;
let activeCase = { kind:'generation-contract' };
try {
  if (!CHROME) throw new Error('A local Chromium executable is required by the existing property harness');
  assertGenerationCoverage();
  for (const width of BREAKPOINT_WIDTHS) {
    const widthCases = cases.filter(item => item.width === width);
    activeCase = { kind:'browser-harness', width, generatedCases:widthCases.length };
    requireInvariant(widthCases.length === CASES_PER_WIDTH,
      'each width must receive the configured number of seeded combinations',
      { width, expected:CASES_PER_WIDTH, actual:widthCases.length });
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
  console.log(`Seed: ${SEED} (0x${SEED.toString(16).padStart(8, '0')}); combinations: ${checked}; widths: ${BREAKPOINT_WIDTHS.join(',')}`);
  console.log(`Harness: UTF-8 chunked payload, completion sentinel, isolated profiles, 2 retries; counterexample: none`);
} catch (error) {
  persistFailure(activeCase, error);
  process.exitCode = 1;
} finally {
  rmSync(TEMP_PATH, { force:true });
}
