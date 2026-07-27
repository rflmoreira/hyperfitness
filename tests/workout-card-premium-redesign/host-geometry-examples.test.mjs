// Targeted host-geometry examples for workout-card premium redesign task 3.2.
// Usage: node tests/workout-card-premium-redesign/host-geometry-examples.test.mjs
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BREAKPOINT_WIDTHS, renderFixtureDocument } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MINIMUM_WIDTH = BREAKPOINT_WIDTHS[0];
const WIDTHS = BREAKPOINT_WIDTHS;
const TOLERANCE = 0.75;
const EXPECTED_ORDER = Object.freeze(['image', 'method', 'title', 'series', 'reps', 'rest', 'cta']);
const EXERCISE = Object.freeze({
  name: 'Rosca Martelo + Tríceps Francês com Corda e Pausa Isométrica',
  series: '12',
  rept: '20/18/15/12',
  descanso: '120 seg',
  method: 'Pirâmide + Isometria • Ênfase excêntrica'
});
const CHROME = [
  process.env.HF_CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean).find(existsSync);

let checks = 0;
let failures = 0;
function check(name, condition, detail = '') {
  checks += 1;
  if (!condition) failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'} - ${name}${condition || !detail ? '' : `: ${detail}`}`);
}
const near = (left, right, tolerance = TOLERANCE) => Math.abs(left - right) <= tolerance;
const px = value => Number.parseFloat(value) || 0;
const compactRect = rect => `${rect.width.toFixed(2)}×${rect.height.toFixed(2)} @ ${rect.left.toFixed(2)},${rect.top.toFixed(2)}`;
function collectorScript(requestedWidth) {
  return `(() => {
    const mainCard = document.querySelector('.harness-main .workout-card');
    const sheet = document.createElement('section');
    sheet.className = 'hf-week-sheet is-open is-settled geometry-week-sheet';
    sheet.innerHTML = '<div class="hf-week-sheet__panel"><div class="hf-week-sheet__panel-bg"></div><div class="hf-week-sheet__body"><div data-week-workout-details></div></div></div>';
    sheet.querySelector('[data-week-workout-details]').append(mainCard.cloneNode(true));
    document.body.append(sheet);
    document.querySelectorAll('.exercise-card-image').forEach(image => {
      image.removeAttribute('src');
      image.removeAttribute('data-src');
      image.dataset.harnessMedia = 'stable';
    });
    const round = value => Math.round(value * 1000) / 1000;
    const rect = element => {
      const value = element.getBoundingClientRect();
      return { left: round(value.left), top: round(value.top), right: round(value.right), bottom: round(value.bottom), width: round(value.width), height: round(value.height) };
    };
    const semanticKey = element => element.matches('.exercise-card-image') ? 'image'
      : element.matches('[data-method-badge]') ? 'method'
      : element.matches('h3') ? 'title'
      : element.dataset.statType || (element.matches('.completion-toggle-wrapper') ? 'cta' : null);
    const geometry = (card, context) => {
      const topBlock = card.querySelector(':scope > .relative.z-10.p-4.flex');
      const lowerBlock = card.querySelector(':scope > .relative.z-10.p-4.space-y-4');
      const media = card.querySelector(':scope > .absolute.inset-0');
      const method = card.querySelector('[data-method-badge]');
      const title = card.querySelector('h3');
      const group = card.querySelector('.exercise-stats-chip-group');
      const chips = [...card.querySelectorAll('.exercise-stat-button')];
      const cta = card.querySelector('.completion-toggle-wrapper');
      const style = element => getComputedStyle(element);
      const cardStyle = style(card), topStyle = style(topBlock), lowerStyle = style(lowerBlock), groupStyle = style(group);
      const resolveToken = name => {
        const probe = document.createElement('i');
        probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:var(' + name + ');height:0';
        card.append(probe);
        const value = style(probe).width;
        probe.remove();
        return value;
      };
      const visibleContent = [
        ['method label', method.querySelector('.method-label'), method],
        ['title', title, card],
        ...chips.flatMap((chip, index) => [
          [\`chip \${index + 1} header\`, chip.querySelector('.chip-header'), chip],
          [\`chip \${index + 1} value\`, chip.querySelector('.stat-value'), chip],
          [\`chip \${index + 1} helper\`, chip.querySelector('.stat-helper'), chip]
        ]),
        ['CTA label', cta.querySelector('span.font-bold'), cta]
      ].map(([name, element, surface]) => ({ name, rect: rect(element), surface: rect(surface) }));
      return {
        context,
        requestedWidth: ${requestedWidth},
        viewportWidth: window.innerWidth,
        bodyWidth: round(document.body.getBoundingClientRect().width),
        semanticOrder: [...card.querySelectorAll('.exercise-card-image,[data-method-badge],h3,[data-stat-type],.completion-toggle-wrapper')].map(semanticKey),
        copy: { title: title.textContent.trim(), method: method.querySelector('.method-label').textContent.trim() },
        rects: { card: rect(card), media: rect(media), topBlock: rect(topBlock), lowerBlock: rect(lowerBlock), method: rect(method), title: rect(title), group: rect(group), chips: chips.map(rect), cta: rect(cta) },
        visibleContent,
        radii: { card: style(card).borderTopLeftRadius, media: style(media).borderTopLeftRadius, method: style(method).borderTopLeftRadius, chips: chips.map(chip => style(chip).borderTopLeftRadius), cta: style(cta).borderTopLeftRadius },
        spacing: { topLeft: topStyle.paddingLeft, topRight: topStyle.paddingRight, lowerLeft: lowerStyle.paddingLeft, lowerRight: lowerStyle.paddingRight, cardBorderLeft: cardStyle.borderLeftWidth, cardBorderRight: cardStyle.borderRightWidth, columnGap: groupStyle.columnGap, ctaMarginTop: style(cta).marginTop, methodMarginBottom: style(method).marginBottom },
        tokens: { outer: resolveToken('--wc-radius-outer'), control: resolveToken('--wc-radius-control'), pill: resolveToken('--wc-radius-pill'), gutter: resolveToken('--wc-gutter'), tightGap: resolveToken('--wc-gap-tight'), normalGap: resolveToken('--wc-gap-normal'), sectionGap: resolveToken('--wc-gap-section') },
        overflow: { cardClientWidth: card.clientWidth, topScrollWidth: topBlock.scrollWidth, topClientWidth: topBlock.clientWidth, lowerScrollWidth: lowerBlock.scrollWidth, lowerClientWidth: lowerBlock.clientWidth }
      };
    };
    const collect = () => {
      const data = [geometry(mainCard, 'main'), geometry(sheet.querySelector('.workout-card'), 'week-sheet')];
      document.body.dataset.hostGeometry = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
    };
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => requestAnimationFrame(collect));
  })();`;
}
function runWidth(width) {
  if (!CHROME) throw new Error('A local Chromium executable is required by the existing deterministic harness');
  const harnessWidth = BREAKPOINT_WIDTHS.includes(width) ? width : BREAKPOINT_WIDTHS[0];
  const captureCase = { id: `host-geometry-${width}`, width: harnessWidth, context: 'main', pointer: 'fine', motion: 'full', capability: 'chromium', state: 'pending' };
  const layoutCss = `<style>html,body{width:${width}px!important;max-width:${width}px!important}body{display:block!important}.harness-main,.geometry-week-sheet,.geometry-week-sheet .hf-week-sheet__panel{width:100%!important;max-width:100%!important;margin-inline:auto}.geometry-week-sheet{position:relative!important;inset:auto!important;transform:none!important}</style>`;
  const html = renderFixtureDocument(captureCase, EXERCISE)
    .replace('</head>', `${layoutCss}</head>`)
    .replace('</body>', `<script>${collectorScript(width)}</script></body>`);
  const tempPath = join(HERE, `.tmp-host-geometry-${width}.html`);
  writeFileSync(tempPath, html, 'utf8');
  try {
    const run = spawnSync(CHROME, [
      '--headless=new', '--hide-scrollbars', '--disable-background-networking', '--disable-component-update',
      '--disable-default-apps', '--disable-sync', '--metrics-recording-only', '--no-first-run',
      '--host-resolver-rules=MAP * ~NOTFOUND', '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=1200', `--window-size=${width},1600`, '--dump-dom', pathToFileURL(tempPath).href
    ], { encoding: 'utf8', timeout: 30000, maxBuffer: 24 * 1024 * 1024 });
    const match = run.stdout.match(/data-host-geometry="([A-Za-z0-9+/=]+)"/);
    if (run.status !== 0 || !match) {
      throw new Error(`geometry collection failed at ${width}px (exit ${run.status}): ${run.stderr.slice(-1200)}`);
    }
    return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
  } finally {
    rmSync(tempPath, { force: true });
  }
}

function isContained(inner, outer) {
  return inner.left >= outer.left - TOLERANCE && inner.right <= outer.right + TOLERANCE
    && inner.top >= outer.top - TOLERANCE && inner.bottom <= outer.bottom + TOLERANCE;
}

function verifyGeometry(result) {
  const label = `${result.context} ${result.requestedWidth}px long/Unicode`;
  const { rects, radii, spacing, tokens } = result;
  const structuralRects = [rects.topBlock, rects.lowerBlock, rects.method, rects.title, rects.group, ...rects.chips, rects.cta];
  const chipWidths = rects.chips.map(rect => rect.width);
  const outerRadius = px(radii.card), controlRadius = px(radii.chips[0]), pillRadius = px(radii.cta);
  const leftInsets = [rects.title.left, rects.group.left, rects.cta.left].map(value => value - rects.card.left);
  const rightInsets = [rects.group.right, rects.cta.right].map(value => rects.card.right - value);

  check(`${label}: exact 1:1 host ratio`, near(rects.card.width, rects.card.height), compactRect(rects.card));
  check(`${label}: semantic order remains image → method → title → series → reps → rest → CTA`,
    JSON.stringify(result.semanticOrder) === JSON.stringify(EXPECTED_ORDER), JSON.stringify(result.semanticOrder));
  check(`${label}: long and Unicode fixture is preserved`, result.copy.title === EXERCISE.name && result.copy.method === EXERCISE.method,
    JSON.stringify(result.copy));

  const tokenNamesPresent = Object.values(tokens).every(Boolean);
  const radiiCoordinated = tokenNamesPresent
    && near(outerRadius, px(tokens.outer)) && near(px(radii.media), px(tokens.outer))
    && near(controlRadius, px(tokens.control))
    && radii.chips.every(radius => near(px(radius), px(tokens.control)))
    && near(px(radii.method), px(tokens.pill)) && near(pillRadius, px(tokens.pill))
    && controlRadius < outerRadius && outerRadius < pillRadius;
  check(`${label}: outer/control/pill radii are tokenized and coordinated`, radiiCoordinated,
    `tokens=${JSON.stringify(tokens)} computed=${JSON.stringify(radii)}`);

  const paddingValues = [spacing.topLeft, spacing.topRight, spacing.lowerLeft, spacing.lowerRight].map(px);
  const expectedLeftInset = px(tokens.gutter) + px(spacing.cardBorderLeft);
  const expectedRightInset = px(tokens.gutter) + px(spacing.cardBorderRight);
  const guttersCoordinated = paddingValues.every(value => near(value, px(tokens.gutter)))
    && leftInsets.every(value => near(value, expectedLeftInset))
    && rightInsets.every(value => near(value, expectedRightInset))
    && near(px(spacing.columnGap), px(tokens.tightGap))
    && px(spacing.columnGap) < px(tokens.gutter)
    && near(px(spacing.ctaMarginTop), px(tokens.sectionGap))
    && near(px(spacing.methodMarginBottom), px(tokens.normalGap))
    && rects.title.width <= (rects.card.width * 0.5) + TOLERANCE;
  check(`${label}: gutters, internal axis and token gaps are coordinated`, guttersCoordinated,
    `tokens=${JSON.stringify(tokens)} padding=${paddingValues.join('/')} left=${leftInsets.join('/')} right=${rightInsets.join('/')} gaps=${spacing.columnGap}/${spacing.ctaMarginTop}/${spacing.methodMarginBottom} titleW=${rects.title.width} cardW=${rects.card.width}`);
  const overflowingContent = result.visibleContent.filter(item => !isContained(item.rect, item.surface));
  const noOverflow = structuralRects.every(rect => isContained(rect, rects.card)) && overflowingContent.length === 0;
  check(`${label}: structural blocks and visible content have no host overflow`, noOverflow,
    `card=${compactRect(rects.card)} blocks=${structuralRects.map(compactRect).join(' | ')} visibleOverflow=${overflowingContent.map(item => `${item.name}: ${compactRect(item.rect)} outside ${compactRect(item.surface)}`).join(' | ') || 'none'}`);

  const noOverlap = rects.method.bottom <= rects.title.top + TOLERANCE
    && rects.title.bottom <= rects.group.top + TOLERANCE
    && rects.group.bottom <= rects.cta.top + TOLERANCE
    && rects.topBlock.bottom <= rects.lowerBlock.top + TOLERANCE
    && rects.chips.every((rect, index) => index === 0 || rects.chips[index - 1].right <= rect.left + TOLERANCE);
  check(`${label}: badge/title/metrics/CTA do not overlap`, noOverlap,
    `method.bottom=${rects.method.bottom}, title=${rects.title.top}-${rects.title.bottom}, metrics=${rects.group.top}-${rects.group.bottom}, cta.top=${rects.cta.top}, blocks=${rects.topBlock.bottom}/${rects.lowerBlock.top}`);

  const equalMetrics = Math.max(...chipWidths) - Math.min(...chipWidths) <= TOLERANCE
    && rects.chips.every(rect => near(rect.top, rects.chips[0].top) && near(rect.bottom, rects.chips[0].bottom));
  check(`${label}: metric widths are equal on one row`, equalMetrics,
    rects.chips.map(compactRect).join(' | '));

  const ctaAligned = near(rects.cta.left, rects.group.left) && near(rects.cta.right, rects.group.right)
    && rects.cta.top >= rects.group.bottom - TOLERANCE;
  check(`${label}: CTA aligns to metric-track edges below the metrics`, ctaAligned,
    `metrics=${compactRect(rects.group)} cta=${compactRect(rects.cta)}`);
}

console.log(`\nHost geometry matrix: minimum ${MINIMUM_WIDTH}px + breakpoint neighbours; tolerance ${TOLERANCE}px`);
let matrix;
try {
  matrix = WIDTHS.flatMap(runWidth);
  check('all minimum/breakpoint cases rendered in main and week-sheet contexts',
    matrix.length === WIDTHS.length * 2
      && WIDTHS.every(width => ['main', 'week-sheet'].every(context => matrix.some(item => item.requestedWidth === width && item.context === context))),
    `expected ${WIDTHS.length * 2}, got ${matrix.length}`);
} catch (error) {
  check('geometry browser matrix executed', false, error.stack || error.message);
  matrix = [];
}
for (const result of matrix) verifyGeometry(result);

console.log(failures
  ? `\n${failures} of ${checks} targeted host-geometry checks failed (subpixel tolerance ${TOLERANCE}px)`
  : `\nAll ${checks} targeted host-geometry checks passed (subpixel tolerance ${TOLERANCE}px)`);
process.exit(failures ? 1 : 0);
