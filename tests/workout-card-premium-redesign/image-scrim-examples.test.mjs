// Targeted image/scrim examples for workout-card premium redesign task 5.2.
// Usage: node tests/workout-card-premium-redesign/image-scrim-examples.test.mjs
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { load } from 'cheerio';
import {
  INDEX_PATH, REAL_RENDERER_SOURCE, renderFixtureDocument
} from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(INDEX_PATH, 'utf8');
const TOLERANCE = 1;
const CHROME = [
  process.env.HF_CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean).find(existsSync);
const EXERCISE = Object.freeze({
  name: 'Agachamento Hack', series: '4', rept: '12/10/8/6',
  descanso: '90 seg', method: 'Ênfase excêntrica • ação 🔥'
});
const MEDIA_FIXTURES = Object.freeze([
  { id: 'light', url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="8" height="8"%3E%3Crect width="8" height="8" fill="%23f4f1e8"/%3E%3C/svg%3E' },
  { id: 'dark', url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="8" height="8"%3E%3Crect width="8" height="8" fill="%2310141b"/%3E%3C/svg%3E' },
  { id: 'gif', url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==' }
]);
const ENVIRONMENTS = Object.freeze([
  { id: 'desktop-chromium', width: 768, context: 'main', pointer: 'fine', capability: 'chromium' },
  { id: 'mobile-coarse-chromium', width: 639, context: 'week-sheet', pointer: 'coarse', capability: 'chromium' },
  { id: 'desktop-safari-fallback', width: 768, context: 'main', pointer: 'fine', capability: 'webkit' },
  { id: 'desktop-basic-fallback', width: 768, context: 'main', pointer: 'fine', capability: 'basic' }
]);

let checks = 0;
let failures = 0;
function check(name, condition, detail = '') {
  checks += 1;
  if (!condition) failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'} - ${name}${condition || !detail ? '' : `: ${detail}`}`);
}
const near = (left, right, tolerance = TOLERANCE) => Math.abs(left - right) <= tolerance;
const area = rect => rect.width * rect.height;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function extractFunction(name) {
  const marker = `    function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Production function not found: ${name}`);
  const tail = source.slice(start + marker.length);
  const next = tail.search(/^    (?:async )?function\s+/m);
  return source.slice(start, next < 0 ? source.length : start + marker.length + next).trim();
}

function mediaMarkup(environment) {
  const html = renderFixtureDocument({ ...environment, state: 'pending', id: environment.id }, EXERCISE);
  const $ = load(html);
  const image = $('.workout-card .exercise-card-image').first();
  return {
    src: image.attr('src') || null,
    dataSrc: image.attr('data-src') || null,
    alt: image.attr('alt'),
    loading: image.attr('loading'),
    decoding: image.attr('decoding'),
    classes: (image.attr('class') || '').split(/\s+/).filter(Boolean)
  };
}

const createExerciseCardSource = extractFunction('createExerciseCard');
function collectorScript(environment) {
  return `(() => {
    const environment = ${JSON.stringify(environment)};
    const fixtures = ${JSON.stringify(MEDIA_FIXTURES)};
    const templateCard = document.querySelector('.workout-card');
    const host = templateCard.parentElement;
    const cards = fixtures.map((fixture, index) => {
      const card = index === 0 ? templateCard : templateCard.cloneNode(true);
      if (index > 0) host.append(card);
      card.dataset.fixture = fixture.id;
      const image = card.querySelector('.exercise-card-image');
      image.src = fixture.url;
      image.removeAttribute('data-src');
      image.dataset.stableFixture = fixture.id;
      return card;
    });
    const round = value => Math.round(value * 1000) / 1000;
    const rect = element => {
      const value = element.getBoundingClientRect();
      return { left: round(value.left), top: round(value.top), right: round(value.right), bottom: round(value.bottom), width: round(value.width), height: round(value.height) };
    };
    const snapshot = card => {
      const media = card.querySelector(':scope > .absolute.inset-0');
      const image = card.querySelector('.exercise-card-image');
      const scrim = card.querySelector(':scope > .absolute.inset-0 > .bg-gradient-to-t');
      const lower = card.querySelector(':scope > .relative.z-10.p-4.space-y-4');
      const method = card.querySelector('[data-method-badge]');
      const title = card.querySelector('h3');
      const metrics = card.querySelector('.exercise-stats-chip-group');
      const cta = card.querySelector('.completion-toggle-wrapper');
      const imageStyle = getComputedStyle(image);
      const scrimStyle = getComputedStyle(scrim);
      const titleStyle = getComputedStyle(title);
      return {
        fixture: card.dataset.fixture,
        rects: { card: rect(card), media: rect(media), image: rect(image), scrim: rect(scrim), method: rect(method), title: rect(title), metrics: rect(metrics), cta: rect(cta) },
        image: {
          objectFit: imageStyle.objectFit,
          objectPosition: imageStyle.objectPosition,
          position: imageStyle.position,
          inset: [imageStyle.top, imageStyle.right, imageStyle.bottom, imageStyle.left],
          width: imageStyle.width,
          height: imageStyle.height,
          opacity: imageStyle.opacity,
          filter: imageStyle.filter,
          backdropFilter: imageStyle.backdropFilter,
          webkitBackdropFilter: imageStyle.webkitBackdropFilter,
          scale: imageStyle.scale,
          loading: image.getAttribute('loading'),
          decoding: image.getAttribute('decoding'),
          alt: image.getAttribute('alt'),
          sourceKind: image.src.startsWith('data:image/gif') ? 'gif' : image.src.startsWith('data:image/svg+xml') ? 'svg' : 'other'
        },
        scrim: {
          backgroundImage: scrimStyle.backgroundImage,
          pointerEvents: scrimStyle.pointerEvents,
          opacity: scrimStyle.opacity,
          lowerBackground: getComputedStyle(lower).backgroundImage,
          hostBeforeDisplay: getComputedStyle(card, '::before').display,
          hostAfterDisplay: getComputedStyle(card, '::after').display
        },
        readability: { titleColor: titleStyle.color, titleShadow: titleStyle.textShadow },
        order: [...media.children].map(node => node === image ? 'image' : node === scrim ? 'scrim' : 'other'),
        contentZ: [method, title, metrics, cta].map(element => getComputedStyle(element.closest('.z-10') || element).zIndex)
      };
    };

    let modalUrl = null;
    const originalMarkup = templateCard.innerHTML;
    const APP_STATE = { completionStatus: {} };
    function isPastWorkoutCheck() { return false; }
    function getExerciseImageUrl() { return 'src/imagens/Agachamento Hack.gif'; }
    function createExerciseCardHTML() { return originalMarkup; }
    function addEventListenerSafe(element, type, handler) { element.addEventListener(type, handler); }
    function stopEvent(event) { event.preventDefault(); event.stopPropagation(); }
    function openExerciseImageModal(url) { modalUrl = url; }
    function initializeExerciseStats() {}
    function initializeMethodBadge() {}
    ${createExerciseCardSource}
    const interactiveCard = createExerciseCard(${JSON.stringify(EXERCISE)}, 0);
    host.append(interactiveCard);
    interactiveCard.querySelector('.exercise-card-image').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const imageModalUrl = modalUrl;
    modalUrl = null;
    interactiveCard.querySelector('.completion-toggle-wrapper').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    const finish = () => {
      const result = { environment, fixtures: cards.map(snapshot), interaction: { imageModalUrl, ctaModalUrl: modalUrl, dataImageUrl: interactiveCard.dataset.imageUrl } };
      document.body.dataset.imageScrimResults = btoa(unescape(encodeURIComponent(JSON.stringify(result))));
    };
    Promise.all(cards.map(card => card.querySelector('img').decode?.().catch(() => undefined))).then(() => requestAnimationFrame(finish));
  })();`;
}

function runEnvironment(environment) {
  if (!CHROME) throw new Error('A local Chromium executable is required by the existing deterministic harness');
  const layoutCss = '<style>.workout-card{margin-bottom:12px}.harness-main,.hf-week-sheet__panel{width:min(100%,560px)!important}</style>';
  const html = renderFixtureDocument({ ...environment, state: 'pending', id: environment.id }, EXERCISE)
    .replace('</head>', `${layoutCss}</head>`)
    .replace('</body>', `<script>${collectorScript(environment)}</script></body>`);
  const tempPath = join(HERE, `.tmp-image-scrim-${environment.id}.html`);
  writeFileSync(tempPath, html, 'utf8');
  try {
    const run = spawnSync(CHROME, [
      '--headless=new', '--hide-scrollbars', '--disable-background-networking', '--disable-component-update',
      '--disable-default-apps', '--disable-sync', '--metrics-recording-only', '--no-first-run',
      '--host-resolver-rules=MAP * ~NOTFOUND', '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=1200', `--window-size=${environment.width},2400`, '--dump-dom', pathToFileURL(tempPath).href
    ], { encoding: 'utf8', timeout: 30000, maxBuffer: 24 * 1024 * 1024 });
    const match = run.stdout.match(/data-image-scrim-results="([A-Za-z0-9+/=]+)"/);
    if (run.status !== 0 || !match) {
      throw new Error(`${environment.id} collection failed (exit ${run.status}): ${run.stderr.slice(-1200)}`);
    }
    return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
  } finally {
    rmSync(tempPath, { force: true });
  }
}

function gradientStops(backgroundImage) {
  const stops = [];
  const expression = /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*([\d.]+)\s*\)\s+([\d.]+)%/g;
  for (const match of backgroundImage.matchAll(expression)) {
    stops.push({ alpha: Number(match[1]), position: Number(match[2]) });
  }
  return stops;
}

function verifyFixture(environment, fixture) {
  const label = `${environment.id}/${fixture.fixture}`;
  const { card, media, image, scrim, method, title, metrics, cta } = fixture.rects;
  const stops = gradientStops(fixture.scrim.backgroundImage);
  const imageCoversCard = image.left <= card.left + TOLERANCE && image.top <= card.top + TOLERANCE
    && image.right >= card.right - TOLERANCE && image.bottom >= card.bottom - TOLERANCE;
  check(`${label}: image fully covers the square card`, near(card.width, card.height) && imageCoversCard,
    `card=${card.width}x${card.height}, image=${image.width}x${image.height}`);
  check(`${label}: center/cover fallback and absolute full-size plane are preserved`,
    fixture.image.objectFit === 'cover' && /^50% 50%$|^center(?: center)?$/.test(fixture.image.objectPosition)
      && fixture.image.position === 'absolute' && fixture.image.width !== 'auto' && fixture.image.height !== 'auto',
    JSON.stringify(fixture.image));
  check(`${label}: media remains the largest visible plane`,
    near(media.width, card.width, 2 * TOLERANCE) && near(media.height, card.height, 2 * TOLERANCE)
      && area(media) > area(scrim),
    `card=${card.width}x${card.height}, media=${media.width}x${media.height}, scrim=${area(scrim)}`);
  const textTop = Math.min(method.top, title.top, metrics.top, cta.top);
  check(`${label}: one scrim is localized from the textual boundary to the base`,
    scrim.top > card.top + TOLERANCE && scrim.top <= textTop + TOLERANCE
      && near(scrim.left, card.left) && near(scrim.right, card.right) && near(scrim.bottom, card.bottom),
    `card.top=${card.top}, scrim=${scrim.top}-${scrim.bottom}, textTop=${textTop}`);
  check(`${label}: gradient has smooth ordered stops with monotonic base-to-top alpha`,
    stops.length >= 6 && stops[0].position === 0 && stops.at(-1).position === 100
      && stops[0].alpha > stops.at(-1).alpha
      && stops.every((stop, index) => index === 0 || (stop.position > stops[index - 1].position && stop.alpha <= stops[index - 1].alpha))
      && stops.every((stop, index) => index === 0 || stop.alpha - stops[index - 1].alpha >= -0.181),
    JSON.stringify(stops));
  check(`${label}: top contribution is exactly zero and no second/global scrim contributes`,
    stops.at(-1)?.alpha === 0 && fixture.scrim.lowerBackground === 'none'
      && fixture.scrim.hostBeforeDisplay === 'none' && fixture.scrim.hostAfterDisplay === 'none');
  check(`${label}: image stays visible behind the scrim and textual content`,
    fixture.order.join(',') === 'image,scrim' && fixture.image.opacity === '1'
      && fixture.image.filter === 'none' && ['none', ''].includes(fixture.image.backdropFilter)
      && stops[0]?.alpha < 1 && fixture.contentZ.every(value => Number(value) >= 10));
  check(`${label}: readability mechanisms remain opaque white text, local shadow and dense base`,
    /rgba?\(255, 255, 255(?:, (?:0\.98|1))?\)/.test(fixture.readability.titleColor)
      && fixture.readability.titleShadow !== 'none' && stops[0]?.alpha >= 0.8
      && fixture.scrim.pointerEvents === 'none');
  check(`${label}: stable fixture keeps media semantics`, fixture.image.loading === 'lazy'
    && fixture.image.decoding === 'async' && fixture.image.alt === `Ilustração do exercício ${EXERCISE.name}`
    && (fixture.fixture === 'gif' ? fixture.image.sourceKind === 'gif' : fixture.image.sourceKind === 'svg'));
}

console.log('\nImage/scrim deterministic fixtures and capability branches');
let results = [];
try {
  results = ENVIRONMENTS.map(runEnvironment);
  check('Chromium, Safari/WebKit fallback, basic fallback and mobile/coarse branches rendered', results.length === ENVIRONMENTS.length);
} catch (error) {
  check('image/scrim browser matrix executed', false, error.stack || error.message);
}
for (const result of results) {
  check(`${result.environment.id}: light, dark and single-frame GIF fixtures are present and stable`,
    same(result.fixtures.map(item => item.fixture), MEDIA_FIXTURES.map(item => item.id))
      && MEDIA_FIXTURES.every(item => item.url.startsWith('data:image/')));
  for (const fixture of result.fixtures) verifyFixture(result.environment, fixture);
  check(`${result.environment.id}: real card image click opens the same local modal URL while CTA is guarded`,
    result.interaction.imageModalUrl === 'src/imagens/Agachamento Hack.gif'
      && result.interaction.imageModalUrl === result.interaction.dataImageUrl
      && result.interaction.ctaModalUrl === null,
    JSON.stringify(result.interaction));
}

console.log('\nMedia behavior preservation and controlled lazy loading');
const markup = Object.fromEntries(ENVIRONMENTS.map(environment => [environment.id, mediaMarkup(environment)]));
const desktopSource = markup['desktop-chromium'].src;
check('desktop Chromium/Safari/basic branches keep identical source, alt and lazy/async behavior',
  desktopSource && same(markup['desktop-chromium'], markup['desktop-safari-fallback'])
    && same(markup['desktop-chromium'], markup['desktop-basic-fallback']),
  JSON.stringify(markup));
check('mobile/coarse week-sheet delays the same local media URL via data-src only',
  markup['mobile-coarse-chromium'].src === null
    && markup['mobile-coarse-chromium'].dataSrc === desktopSource
    && markup['mobile-coarse-chromium'].loading === 'lazy'
    && markup['mobile-coarse-chromium'].decoding === 'async'
    && markup['mobile-coarse-chromium'].alt === markup['desktop-chromium'].alt
    && same(markup['mobile-coarse-chromium'].classes, markup['desktop-chromium'].classes),
  JSON.stringify(markup['mobile-coarse-chromium']));

const lazyPredicate = new Function('window', `${REAL_RENDERER_SOURCE.functions.shouldUseControlledSheetImageLazy}; return shouldUseControlledSheetImageLazy();`);
const branch = (width, pointer) => lazyPredicate({
  matchMedia: query => ({ matches: query.includes('max-width: 640px') && width <= 640 || query.includes('pointer: coarse') && pointer === 'coarse' })
});
check('controlled loading independently covers mobile OR coarse without affecting desktop fine',
  branch(639, 'fine') === true && branch(769, 'coarse') === true && branch(769, 'fine') === false);
const loadWeekSheetImage = new Function(`${extractFunction('loadWeekSheetImage')}; return loadWeekSheetImage;`)();
const lazyImage = {
  dataset: { src: desktopSource }, src: '', removed: [],
  removeAttribute(name) { this.removed.push(name); if (name === 'data-src') delete this.dataset.src; }
};
loadWeekSheetImage(lazyImage);
check('visibility loader promotes the original URL and removes only data-src',
  lazyImage.src === desktopSource && same(lazyImage.removed, ['data-src']));

const treatment = result => result.fixtures.map(fixture => ({
  fixture: fixture.fixture,
  image: fixture.image,
  gradient: gradientStops(fixture.scrim.backgroundImage),
  lowerBackground: fixture.scrim.lowerBackground
}));
const desktopResults = results.filter(result => result.environment.width === 768);
check('Chromium, Safari/WebKit and basic capability branches do not alter image/scrim behavior',
  desktopResults.length === 3 && desktopResults.slice(1).every(result => same(treatment(result), treatment(desktopResults[0]))),
  desktopResults.map(result => result.environment.id).join(', '));
check('mobile/coarse changes loading policy and dimensions only, not the media treatment contract',
  results.length === ENVIRONMENTS.length
    && results.find(result => result.environment.id === 'mobile-coarse-chromium').fixtures.every((fixture, index) => {
      const desktop = results.find(result => result.environment.id === 'desktop-chromium').fixtures[index];
      return fixture.image.objectFit === desktop.image.objectFit
        && fixture.image.objectPosition === desktop.image.objectPosition
        && fixture.image.filter === desktop.image.filter
        && fixture.image.opacity === desktop.image.opacity
        && same(gradientStops(fixture.scrim.backgroundImage), gradientStops(desktop.scrim.backgroundImage));
    }));

check('production image treatment uses no runtime pixel analysis or image-level glass/filter',
  !/getImageData|drawImage|canvas/i.test(REAL_RENDERER_SOURCE.functions.createExerciseCardHTML)
    && /\.workout-card \.exercise-card-image\s*\{[\s\S]*?object-fit:\s*cover;[\s\S]*?object-position:\s*center center;/.test(source));
check('production listener still opens local exercise media and guards only the completion CTA',
  /const isCompletionButton = event\.target\.closest\('\.completion-toggle-wrapper'\);[\s\S]{0,180}openExerciseImageModal\(imageUrl\)/.test(createExerciseCardSource));

console.log(failures
  ? `\n${failures} of ${checks} targeted image/scrim checks failed (tolerance ${TOLERANCE}px)`
  : `\nAll ${checks} targeted image/scrim checks passed (tolerance ${TOLERANCE}px)`);
process.exit(failures ? 1 : 0);
