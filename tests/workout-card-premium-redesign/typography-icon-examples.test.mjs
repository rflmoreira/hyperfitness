// Targeted typography/icon examples for workout-card premium redesign task 7.2.
// Usage: node tests/workout-card-premium-redesign/typography-icon-examples.test.mjs
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { load } from 'cheerio';
import { INDEX_PATH, renderFixtureDocument } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(INDEX_PATH, 'utf8');
const pendingBaseline = JSON.parse(readFileSync(join(HERE, 'baselines/fixtures/main-768-fine-full-chromium-pending.json'), 'utf8'));
const methodOpenBaseline = JSON.parse(readFileSync(join(HERE, 'baselines/fixtures/main-768-fine-full-chromium-method-open.json'), 'utf8'));
const WIDTHS = Object.freeze([320, 360, 560]);
const TOLERANCE = 0.75;
const CASES = Object.freeze([
  { id: 'short', exercise: { name: 'Remada', series: '3', rept: '8', descanso: 'Livre', method: 'Bi-set' } },
  { id: 'long-compound', exercise: { name: 'Rosca Martelo + Tríceps Francês com Corda e Pausa Isométrica', series: '12', rept: '12/10/8/6', descanso: '120 seg', method: 'Pirâmide Crescente + Isometria + Rest Pause' } },
  { id: 'unicode', exercise: { name: 'Elevação Pélvica — Unilateral (Ação) 🏋️‍♀️', series: '10', rept: '20/18/15/12', descanso: '90 seg', method: 'Ênfase excêntrica • ação 🔥' } }
]);
const EXPECTED_ICONS = Object.freeze([
  ['ph-bold', 'ph-info', 'method-icon'],
  ['ph-bold', 'ph-stack-simple', 'stat-icon'],
  ['ph-bold', 'ph-repeat', 'stat-icon'],
  ['ph-bold', 'ph-timer', 'stat-icon']
]);
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
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const near = (left, right, tolerance = TOLERANCE) => Math.abs(left - right) <= tolerance;
const area = rect => rect.width * rect.height;

function extractFunction(name) {
  const marker = `    function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Production function not found: ${name}`);
  const tail = source.slice(start + marker.length);
  const next = tail.search(/^    (?:async )?function\s+/m);
  return source.slice(start, next < 0 ? source.length : start + marker.length + next).trim();
}

const methodHandlers = [
  'addEventListenerSafe', 'stopEvent', 'setupMethodButton', 'handleMethodButtonToggle',
  'closeOtherMethodTooltips', 'scheduleMethodAutoClose', 'cancelMethodAutoClose',
  'setupMethodOutsideClickHandler', 'cancelRepsAutoClose'
].map(extractFunction).join('\n\n');

function fixtureMarkup(testCase) {
  const html = renderFixtureDocument({
    id: `typography-${testCase.id}`, width: 639, context: 'main',
    pointer: 'fine', motion: 'full', capability: 'chromium', state: 'pending'
  }, testCase.exercise);
  const $ = load(html);
  return $.html($('.workout-card').first());
}

function collectorScript(width, extraCards) {
  return `(() => {
    const fixtures = ${JSON.stringify(CASES)};
    const host = document.querySelector('#workout-details');
    ${JSON.stringify(extraCards)}.forEach(markup => host.insertAdjacentHTML('beforeend', markup));
    const cards = [...host.querySelectorAll('.workout-card')];
    cards.forEach((card, index) => {
      card.dataset.typographyCase = fixtures[index].id;
      const image = card.querySelector('.exercise-card-image');
      image?.removeAttribute('src');
      image?.removeAttribute('data-src');
      if (image) image.dataset.harnessMedia = 'stable';
    });

    let now = 0, nextTimerId = 1;
    const timers = new Map();
    window.setTimeout = (callback, delay = 0) => {
      const id = nextTimerId++;
      timers.set(id, { callback, at: now + Number(delay) });
      return id;
    };
    window.clearTimeout = id => timers.delete(Number(id));
    const tick = milliseconds => {
      const target = now + milliseconds;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
        if (!due) break;
        const [id, timer] = due;
        timers.delete(id);
        now = timer.at;
        timer.callback();
      }
      now = target;
    };
    const METHOD_TOOLTIP_TIMEOUTS = new Map();
    const REPS_TOOLTIP_TIMEOUTS = new Map();
    let methodOutsideClickBound = false;
    ${methodHandlers}

    const method = cards[0].querySelector('[data-method-badge]');
    const methodState = () => ({
      open: method.classList.contains('is-open'),
      ariaExpanded: method.getAttribute('aria-expanded'),
      focused: document.activeElement === method,
      role: method.querySelector('.method-tooltip')?.getAttribute('role'),
      ariaLabel: method.querySelector('.method-tooltip')?.getAttribute('aria-label')
    });
    setupMethodButton(method);
    const interaction = { initial: methodState() };
    method.click();
    interaction.open = methodState();
    method.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    interaction.escapeClosed = methodState();
    method.click();
    tick(4999);
    interaction.beforeAutoClose = methodState();
    tick(1);
    interaction.autoClosed = methodState();
    interaction.pendingTimers = timers.size;
    interaction.timeoutMapSize = METHOD_TOOLTIP_TIMEOUTS.size;

    const round = value => Math.round(value * 1000) / 1000;
    const rect = element => {
      const value = element.getBoundingClientRect();
      return { left: round(value.left), top: round(value.top), right: round(value.right), bottom: round(value.bottom), width: round(value.width), height: round(value.height) };
    };
    const textRect = element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const value = range.getBoundingClientRect();
      return { left: round(value.left), top: round(value.top), right: round(value.right), bottom: round(value.bottom), width: round(value.width), height: round(value.height) };
    };
    const style = element => {
      const value = getComputedStyle(element);
      return {
        display: value.display, fontFamily: value.fontFamily, fontSize: value.fontSize,
        fontWeight: value.fontWeight, lineHeight: value.lineHeight,
        letterSpacing: value.letterSpacing, textTransform: value.textTransform,
        whiteSpace: value.whiteSpace, overflow: value.overflow,
        overflowWrap: value.overflowWrap, color: value.color,
        textShadow: value.textShadow, webkitTextStrokeWidth: value.webkitTextStrokeWidth,
        webkitLineClamp: value.webkitLineClamp, lineClamp: value.lineClamp,
        fontVariantNumeric: value.fontVariantNumeric,
        fontFeatureSettings: value.fontFeatureSettings,
        width: value.width, height: value.height, verticalAlign: value.verticalAlign
      };
    };
    const attrs = (element, names) => Object.fromEntries(names
      .filter(name => element.hasAttribute(name))
      .map(name => [name, element.getAttribute(name)]));

    const snapshot = (card, fixture) => {
      const title = card.querySelector('h3');
      const badge = card.querySelector('[data-method-badge]');
      const methodLabel = badge.querySelector('.method-label');
      const metrics = [...card.querySelectorAll('.exercise-stat-button')];
      const values = metrics.map(chip => chip.querySelector('.stat-value'));
      const labels = metrics.map(chip => chip.querySelector('.stat-label'));
      const helpers = metrics.map(chip => chip.querySelector('.stat-helper'));
      const icons = [badge.querySelector('.method-icon'), ...metrics.map(chip => chip.querySelector('.stat-icon'))];
      const restValue = card.querySelector('[data-role="rest-value"]');
      const originalRest = restValue.textContent;
      const timerWidths = ['12:59', '11:11', '08:08', '00:00'].map(text => {
        restValue.textContent = text;
        return { glyph: textRect(restValue).width, box: rect(restValue).width };
      });
      restValue.textContent = originalRest;
      const textElements = [methodLabel, title, ...labels, ...values, ...helpers,
        card.querySelector('.completion-toggle-wrapper span.font-bold')].filter(Boolean);
      return {
        id: fixture.id,
        expected: fixture.exercise,
        copy: {
          title: title.textContent.trim(), method: methodLabel.textContent.trim(),
          labels: labels.map(element => element.textContent.trim()),
          values: values.map(element => element.textContent.trim()),
          helpers: helpers.map(element => element.textContent.trim())
        },
        rects: {
          card: rect(card), title: rect(title), titleText: textRect(title), badge: rect(badge),
          methodLabel: rect(methodLabel), methodIcon: rect(icons[0]),
          chips: metrics.map(rect), values: values.map(textRect),
          headers: metrics.map(chip => rect(chip.querySelector('.chip-header'))),
          labels: labels.map(rect), icons: icons.map(rect)
        },
        containment: {
          title: { clientWidth: title.clientWidth, scrollWidth: title.scrollWidth, clientHeight: title.clientHeight, scrollHeight: title.scrollHeight },
          badge: { clientWidth: badge.clientWidth, scrollWidth: badge.scrollWidth, clientHeight: badge.clientHeight, scrollHeight: badge.scrollHeight }
        },
        styles: {
          title: style(title), fill: style(title.querySelector('.workout-card-title__fill')),
          badge: style(badge), methodLabel: style(methodLabel),
          labels: labels.map(style), values: values.map(style), helpers: helpers.map(style),
          icons: icons.map(style), allText: textElements.map(style), restValue: style(restValue)
        },
        childOrder: metrics.map(chip => [...chip.children].map(child =>
          child.classList.contains('chip-header') ? 'label' : child.classList.contains('stat-value') ? 'value'
            : child.classList.contains('stat-helper') ? 'helper' : 'auxiliary')),
        icons: icons.map(icon => ({ classes: [...icon.classList], ariaHidden: icon.getAttribute('aria-hidden') })),
        checkIcon: {
          viewBox: card.querySelector('.animated-check-svg')?.getAttribute('viewBox'),
          path: card.querySelector('.animated-check-path')?.getAttribute('d')
        },
        timerWidths,
        aria: {
          method: attrs(badge, ['type', 'data-method-badge', 'data-exercise-index', 'aria-expanded']),
          series: attrs(metrics[0], ['type', 'data-stat-type', 'data-exercise-index', 'data-total-series', 'data-original-value', 'aria-pressed']),
          reps: attrs(metrics[1], ['type', 'data-stat-type', 'data-exercise-index', 'data-reps', 'aria-expanded']),
          rest: attrs(metrics[2], ['type', 'data-stat-type', 'data-exercise-index', 'data-rest-seconds', 'data-original-value', 'aria-live', 'aria-pressed']),
          methodDialog: attrs(badge.querySelector('.method-tooltip'), ['role', 'aria-label']),
          repsDialog: attrs(metrics[1].querySelector('.stat-details'), ['role', 'aria-label'])
        }
      };
    };

    const finish = () => {
      const result = { width: ${width}, cards: cards.map((card, index) => snapshot(card, fixtures[index])), interaction };
      document.body.dataset.typographyIconResults = btoa(unescape(encodeURIComponent(JSON.stringify(result))));
    };
    finish();
  })();`;
}

function runWidth(width) {
  if (!CHROME) throw new Error('A local Chromium executable is required by the existing deterministic harness');
  const markup = CASES.map(fixtureMarkup);
  const layoutCss = `<style>
    html,body{width:${width}px!important;max-width:${width}px!important}
    body{display:block!important;padding:0!important}
    .harness-main{width:100%!important;max-width:none!important}
    #workout-details{display:grid;gap:12px;width:100%}
  </style>`;
  const html = renderFixtureDocument({
    id: `typography-icons-${width}`, width: 639, context: 'main',
    pointer: 'fine', motion: 'full', capability: 'chromium', state: 'pending'
  }, CASES[0].exercise)
    .replace('</head>', `${layoutCss}</head>`)
    .replace('</body>', `<script>${collectorScript(width, markup.slice(1))}</script></body>`);
  const tempPath = join(HERE, `.tmp-typography-icons-${width}.html`);
  writeFileSync(tempPath, html, 'utf8');
  try {
    const run = spawnSync(CHROME, [
      '--headless=new', '--hide-scrollbars', '--disable-background-networking', '--disable-component-update',
      '--disable-default-apps', '--disable-sync', '--metrics-recording-only', '--no-first-run',
      '--host-resolver-rules=MAP * ~NOTFOUND', '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=1200', `--window-size=${Math.max(width, 500)},3000`, '--dump-dom', pathToFileURL(tempPath).href
    ], { encoding: 'utf8', timeout: 30000, maxBuffer: 24 * 1024 * 1024 });
    const match = run.stdout.match(/data-typography-icon-results="([A-Za-z0-9+/=]+)"/);
    if (run.status !== 0 || !match) {
      throw new Error(`typography/icon collection failed at ${width}px (exit ${run.status}): ${run.stderr.slice(-1200)}`);
    }
    return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
  } finally {
    rmSync(tempPath, { force: true });
  }
}

function parseColor(value) {
  const match = String(value).match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (!match) return null;
  return { rgb: match.slice(1, 4).map(Number), alpha: match[4] === undefined ? 1 : Number(match[4]) };
}
function composite(color, background = [9, 9, 13]) {
  const parsed = parseColor(color);
  if (!parsed) return null;
  return parsed.rgb.map((channel, index) => channel * parsed.alpha + background[index] * (1 - parsed.alpha));
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
  if (!foreground) return 0;
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}
function contained(inner, outer) {
  return inner.left >= outer.left - TOLERANCE && inner.right <= outer.right + TOLERANCE
    && inner.top >= outer.top - TOLERANCE && inner.bottom <= outer.bottom + TOLERANCE;
}
const numeric = value => Number.parseFloat(value) || 0;
const centerY = rect => rect.top + rect.height / 2;

const baselineInteractive = pendingBaseline.copyAndData.interactive;
const baselineDialogs = {
  methodDialog: { role: 'dialog', 'aria-label': 'Detalhes do método' },
  repsDialog: { role: 'dialog', 'aria-label': 'Detalhes das repetições' }
};
const baselineIconClasses = pendingBaseline.inventory
  .filter(item => item.tag === 'i' && item.attributes['aria-hidden'] === 'true')
  .map(item => item.classes);
const pendingMethodAria = pendingBaseline.semanticOrder.find(item => item.key === 'method').attributes['aria-expanded'];
const openMethodAria = methodOpenBaseline.semanticOrder.find(item => item.key === 'method').attributes['aria-expanded'];

function verifyCard(width, card) {
  const label = `${width}px/${card.id}`;
  const { expected, copy, rects, styles } = card;
  check(`${label}: complete short/long/Unicode title and method text are preserved`,
    copy.title === expected.name && copy.method === expected.method,
    JSON.stringify({ actual: copy, expected }));
  check(`${label}: title wraps up to 2 lines with line-clamp and stays inside the card`,
    styles.title.whiteSpace !== 'nowrap'
      && styles.fill.overflow === 'hidden'
      && (styles.fill.webkitLineClamp === '2' || styles.fill.lineClamp === '2')
      && contained(rects.title, rects.card)
      && ['0px', ''].includes(styles.title.webkitTextStrokeWidth),
    JSON.stringify({ style: styles.title, fill: styles.fill, containment: card.containment.title, title: rects.title }));
  check(`${label}: badge stays above/separate from title and all badge content is contained`,
    rects.badge.bottom < rects.title.top
      && contained(rects.badge, rects.card)
      && contained(rects.methodIcon, rects.badge)
      && contained(rects.methodLabel, rects.badge),
    JSON.stringify({ badge: rects.badge, title: rects.title, label: rects.methodLabel, icon: rects.methodIcon }));
  check(`${label}: intrinsic badge remains visually smaller than the complete title block`,
    styles.badge.width !== 'auto' && area(rects.badge) < area(rects.title),
    `badge=${area(rects.badge).toFixed(2)}, title=${area(rects.title).toFixed(2)}, width=${styles.badge.width}`);

  const otherSizes = styles.allText.slice(0, 1).concat(styles.allText.slice(2)).map(item => numeric(item.fontSize));
  const otherWeights = styles.allText.slice(0, 1).concat(styles.allText.slice(2)).map(item => numeric(item.fontWeight));
  check(`${label}: title is the largest/heaviest text with approved Poppins hierarchy`,
    /Poppins/i.test(styles.title.fontFamily)
      && numeric(styles.title.fontSize) >= Math.max(...otherSizes)
      && numeric(styles.title.fontWeight) > Math.max(...otherWeights)
      && numeric(styles.title.fontWeight) === 900
      && near(numeric(styles.title.lineHeight), numeric(styles.title.fontSize) * 1.2 + 6, 0.5)
      && near(numeric(styles.title.letterSpacing), numeric(styles.title.fontSize) * -0.03, 0.12),
    JSON.stringify({ title: styles.title, otherSizes, otherWeights }));
  check(`${label}: label → value → helper order and value dominance are preserved`,
    card.childOrder.every(order => order.indexOf('label') < order.indexOf('value') && order.indexOf('value') < order.indexOf('helper'))
      && styles.values.every((value, index) => numeric(value.fontSize) > numeric(styles.labels[index].fontSize)
        && numeric(value.fontSize) > numeric(styles.helpers[index].fontSize)
        && numeric(value.fontWeight) >= numeric(styles.labels[index].fontWeight)
        && numeric(value.fontWeight) > numeric(styles.helpers[index].fontWeight)),
    JSON.stringify(card.childOrder));
  check(`${label}: multi-digit values remain complete and contained at this width`,
    copy.values[0] === expected.series && copy.values[1] === expected.rept
      && copy.values.every((value, index) => value.length > 0 && contained(rects.values[index], rects.chips[index])),
    JSON.stringify({ values: copy.values, valueRects: rects.values, chips: rects.chips }));

  const timerBoxWidths = card.timerWidths.map(sample => sample.box);
  const timerSpread = Math.max(...timerBoxWidths) - Math.min(...timerBoxWidths);
  check(`${label}: timer uses tabular numerals with no equal-length layout jitter`,
    /tabular-nums/.test(styles.restValue.fontVariantNumeric)
      && /tnum/.test(styles.restValue.fontFeatureSettings)
      && timerSpread <= 0.2,
    `samples=${JSON.stringify(card.timerWidths)}, boxSpread=${timerSpread}`);
  check(`${label}: exact Phosphor glyph classes and existing check SVG are preserved`,
    same(card.icons.map(icon => icon.classes), EXPECTED_ICONS)
      && same(card.icons.map(icon => icon.classes), baselineIconClasses)
      && card.icons.every(icon => icon.ariaHidden === 'true')
      && card.checkIcon.viewBox === '0 0 24 24' && card.checkIcon.path === 'M7 13l3 3 7-7',
    JSON.stringify({ icons: card.icons, check: card.checkIcon }));

  const statIconRects = rects.icons.slice(1);
  const statIconStyles = styles.icons.slice(1);
  const squareBoxes = rects.icons.every(icon => near(icon.width, icon.height, 0.2));
  const commonMetricBoxes = statIconRects.every(icon => near(icon.width, statIconRects[0].width, 0.2)
    && near(icon.height, statIconRects[0].height, 0.2));
  const alignedMetrics = statIconRects.every((icon, index) => Math.abs(centerY(icon) - centerY(rects.labels[index])) <= 1);
  check(`${label}: icon boxes, line-height and optical baselines are normalized`,
    squareBoxes && commonMetricBoxes && alignedMetrics
      && styles.icons.every(icon => ['flex', 'inline-flex'].includes(icon.display)
        && numeric(icon.lineHeight) === numeric(icon.fontSize)),
    JSON.stringify({ iconRects: rects.icons, labelRects: rects.labels, iconStyles: statIconStyles }));

  const titleContrast = contrast(styles.title.color);
  const labelContrasts = styles.labels.map(item => contrast(item.color));
  const helperContrasts = styles.helpers.map(item => contrast(item.color));
  const iconContrasts = styles.icons.map(item => contrast(item.color));
  check(`${label}: approved text/icon readability and title contrast hierarchy are retained`,
    titleContrast >= 4.5
      && helperContrasts.every(ratio => ratio >= 4.5)
      && iconContrasts.every(ratio => ratio >= 3)
      && labelContrasts.every(ratio => titleContrast > ratio)
      && /^rgb\(255, 255, 255\)$/.test(styles.title.color)
      && styles.title.textShadow !== 'none' && !/255,\s*(?:122|154|200)/.test(styles.title.textShadow),
    JSON.stringify({ titleContrast, labelContrasts, helperContrasts, iconContrasts, shadow: styles.title.textShadow }));
}

console.log('\nTypography, badge, values, timer and icon matrix');
let results = [];
try {
  results = WIDTHS.map(runWidth);
  check('short, long/compound and Unicode fixtures rendered at every narrow/standard width',
    results.length === WIDTHS.length
      && results.every(result => result.cards.length === CASES.length)
      && WIDTHS.every(width => results.some(result => result.width === width)));
} catch (error) {
  check('typography/icon browser matrix executed', false, error.stack || error.message);
}
for (const result of results) {
  for (const card of result.cards) verifyCard(result.width, card);
}

console.log('\nBaseline-equivalent ARIA and method behavior');
const canonical = results.find(result => result.width === 560)?.cards.find(card => card.id === 'short');
if (canonical) {
  check('closed-state control ARIA remains exactly baseline-equivalent',
    canonical.aria.method.type === baselineInteractive.method.type
      && canonical.aria.method['aria-expanded'] === baselineInteractive.method['aria-expanded']
      && canonical.aria.series.type === baselineInteractive.series.type
      && canonical.aria.series['aria-pressed'] === baselineInteractive.series['aria-pressed']
      && canonical.aria.reps.type === baselineInteractive.reps.type
      && canonical.aria.reps['aria-expanded'] === baselineInteractive.reps['aria-expanded']
      && canonical.aria.rest.type === baselineInteractive.rest.type
      && canonical.aria.rest['aria-live'] === baselineInteractive.rest['aria-live']
      && canonical.aria.rest['aria-pressed'] === baselineInteractive.rest['aria-pressed'],
    JSON.stringify(canonical.aria));
  check('method/Reps dialogs and decorative icon ARIA remain baseline-equivalent',
    same(canonical.aria.methodDialog, baselineDialogs.methodDialog)
      && same(canonical.aria.repsDialog, baselineDialogs.repsDialog)
      && canonical.icons.every(icon => icon.ariaHidden === 'true'),
    JSON.stringify(canonical.aria));
} else {
  check('canonical ARIA fixture was collected', false);
}

const interaction = results[0]?.interaction;
if (interaction) {
  check('method starts closed with the frozen baseline ARIA state',
    !interaction.initial.open && interaction.initial.ariaExpanded === pendingMethodAria
      && interaction.initial.role === baselineDialogs.methodDialog.role
      && interaction.initial.ariaLabel === baselineDialogs.methodDialog['aria-label'],
    JSON.stringify(interaction.initial));
  check('method click preserves open state and open-baseline ARIA',
    interaction.open.open && interaction.open.ariaExpanded === openMethodAria,
    JSON.stringify(interaction.open));
  check('Escape closes method, restores baseline ARIA and returns focus',
    !interaction.escapeClosed.open
      && interaction.escapeClosed.ariaExpanded === pendingMethodAria
      && interaction.escapeClosed.focused,
    JSON.stringify(interaction.escapeClosed));
  check('method remains open until the exact fake 5s auto-close boundary',
    interaction.beforeAutoClose.open && interaction.beforeAutoClose.ariaExpanded === openMethodAria,
    JSON.stringify(interaction.beforeAutoClose));
  check('method auto-close restores baseline ARIA without pending fake timers',
    !interaction.autoClosed.open
      && interaction.autoClosed.ariaExpanded === pendingMethodAria
      && interaction.pendingTimers === 0 && interaction.timeoutMapSize === 0,
    JSON.stringify(interaction));
} else {
  check('method interaction fixture was collected', false);
}

check('production typography/icon contract uses a 2-line title clamp without CSS-generated replacement text',
  /\.workout-card h3\s*\{[\s\S]*?overflow-wrap:\s*break-word;/.test(source)
    && /\.workout-card h3\s*\{[\s\S]*?max-width:\s*50%;/.test(source)
    && /\.workout-card h3 \.workout-card-title__fill\s*\{[\s\S]*?-webkit-line-clamp:\s*2;/.test(source)
    && /\.workout-card h3 \.workout-card-title__fill\s*\{[\s\S]*?line-clamp:\s*2;/.test(source)
    && /\.workout-card h3 \.workout-card-title__fill\s*\{[\s\S]*?text-overflow:\s*ellipsis;/.test(source)
    && /\.workout-card h3 \.workout-card-title__fill\s*\{[\s\S]*?background-clip:\s*text;/.test(source)
    && !/\.workout-card (?:h3|\.method-label)[^{]*::(?:before|after)\s*\{[^}]*content:\s*["'][^"']+/s.test(source));

console.log(failures
  ? `\nFAIL: ${failures} of ${checks} targeted typography/icon checks failed (tolerance ${TOLERANCE}px)`
  : `\nPASS: all ${checks} targeted typography/icon checks passed (tolerance ${TOLERANCE}px)`);
process.exit(failures ? 1 : 0);
