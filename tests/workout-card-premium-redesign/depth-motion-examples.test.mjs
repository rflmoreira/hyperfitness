// Feature: workout-card-premium-redesign, Task 15.2: Depth, focus and motion examples
// **Validates: Requirements 8.1–8.9, 9.3–9.5, 9.8–9.12**
// Usage: node tests/workout-card-premium-redesign/depth-motion-examples.test.mjs
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BREAKPOINT_WIDTHS, INDEX_PATH, renderFixtureDocument } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = [
  process.env.HF_CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
].filter(Boolean).find(existsSync);
const source = readFileSync(INDEX_PATH, 'utf8');

let checks = 0;
let failures = 0;
function check(name, condition, detail = '') {
  checks += 1;
  if (!condition) failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'} - ${name}${condition || !detail ? '' : `: ${detail}`}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const approx = (a, b, tol = 1) => Math.abs(a - b) <= tol;

// --- Environment configurations ---
const ENVIRONMENTS = Object.freeze([
  { id: 'rest-fine-768', width: 768, pointer: 'fine', motion: 'full', capability: 'chromium', state: 'pending' },
  { id: 'rest-fine-640', width: 640, pointer: 'fine', motion: 'full', capability: 'chromium', state: 'pending' },
  { id: 'rest-completed', width: 768, pointer: 'fine', motion: 'full', capability: 'chromium', state: 'completed' },
  { id: 'rest-coarse', width: 768, pointer: 'coarse', motion: 'full', capability: 'chromium', state: 'pending' },
  { id: 'rest-reduced', width: 768, pointer: 'fine', motion: 'reduced', capability: 'chromium', state: 'pending' },
  { id: 'rest-webkit', width: 768, pointer: 'fine', motion: 'full', capability: 'webkit', state: 'pending' },
  { id: 'rest-basic', width: 768, pointer: 'fine', motion: 'full', capability: 'basic', state: 'pending' },
  { id: 'week-sheet', width: 769, pointer: 'fine', motion: 'full', capability: 'chromium', state: 'pending', context: 'week-sheet' },
]);

function capabilityCss(env) {
  let css = '';
  if (env.capability === 'webkit') {
    css += `.player-glass-btn{background:rgba(0,0,0,.22)!important;backdrop-filter:blur(4px) brightness(1.5) saturate(300%) contrast(1.08)!important;-webkit-backdrop-filter:blur(4px) brightness(1.5) saturate(300%) contrast(1.08)!important}\n`;
    css += `.liquid-glass-edge{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}\n`;
  }
  if (env.capability === 'basic') {
    css += `.player-glass-btn{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}\n`;
    css += `.liquid-glass-edge{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}\n`;
  }
  if (env.pointer === 'coarse') {
    css += `.liquid-glass-edge{display:none!important}\n`;
  }
  return css;
}

function measureScript(envList) {
  return `(() => {
    const envs = ${JSON.stringify(envList)};
    const results = [];
    for (const env of envs) {
      const section = document.querySelector('[data-env-id="' + env.id + '"]');
      if (!section) { results.push({ id: env.id, error: 'section not found' }); continue; }
      const card = section.querySelector('.workout-card');
      if (!card) { results.push({ id: env.id, error: 'card not found' }); continue; }
      const image = card.querySelector('.exercise-card-image');
      const scrimGradient = card.querySelector('.bg-gradient-to-t');
      const contentPanels = card.querySelectorAll(':scope > .relative.z-10');

      const cs = (el, pseudo) => el ? getComputedStyle(el, pseudo || null) : {};
      const cardStyle = cs(card);
      const imageStyle = cs(image);
      const scrimStyle = cs(scrimGradient);

      // z-index ordering
      const imageZ = imageStyle.zIndex;
      const scrimZ = scrimStyle.zIndex;
      const contentZValues = [...contentPanels].map(p => cs(p).zIndex);

      // Card rest state
      const cardTransform = cardStyle.transform;
      const cardBoxShadow = cardStyle.boxShadow;
      const cardBorderColor = cardStyle.borderColor;
      const cardBorderWidth = cardStyle.borderWidth;
      const cardOpacity = cardStyle.opacity;
      const cardTransition = cardStyle.transition || cardStyle.transitionProperty;
      const cardTransitionDuration = cardStyle.transitionDuration;
      const cardOverflow = cardStyle.overflow;

      // Image state
      const imageScale = imageStyle.scale;
      const imageTransform = imageStyle.transform;
      const imageTransition = imageStyle.transitionDuration;

      // Card rect
      const cardRect = card.getBoundingClientRect();
      const imageRect = image ? image.getBoundingClientRect() : null;

      // Completed state
      const isCompleted = card.classList.contains('exercise-completed');

      results.push({
        id: env.id,
        zOrder: { image: imageZ, scrim: scrimZ, content: contentZValues },
        card: {
          transform: cardTransform, boxShadow: cardBoxShadow,
          borderColor: cardBorderColor, borderWidth: cardBorderWidth,
          opacity: cardOpacity, transition: cardTransition,
          transitionDuration: cardTransitionDuration,
          overflow: cardOverflow, isCompleted,
          width: cardRect.width, height: cardRect.height
        },
        image: {
          scale: imageScale, transform: imageTransform,
          transitionDuration: imageTransition,
          width: imageRect?.width, height: imageRect?.height
        }
      });
    }
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(results))));
    document.body.dataset.depthResults = encoded;
    document.body.dataset.depthHarnessState = 'complete';
  })();`;
}

function buildTestDocument() {
  const sections = ENVIRONMENTS.map(env => {
    const context = env.context || 'main';
    const doc = renderFixtureDocument({ ...env, id: env.id, context });
    const headMatch = doc.match(/<head>([\s\S]*?)<\/head>/i);
    const cardMatch = doc.match(/<article class="workout-card[\s\S]*?<\/article>/i);
    if (!headMatch || !cardMatch) throw new Error(`Harness render failed for ${env.id}`);
    const card = cardMatch[0];
    const details = `<div id="workout-details">${card}</div>`;
    const content = context === 'week-sheet'
      ? `<div class="hf-week-sheet__panel"><div class="hf-week-sheet__body">${details}</div></div>`
      : `<main class="harness-main">${details}</main>`;
    return `<section data-env-id="${env.id}" style="width:min(100%,560px);margin:0 auto 24px">${content}</section>`;
  }).join('\n');

  const baseDoc = renderFixtureDocument({ width: 768, pointer: 'fine', motion: 'full', capability: 'chromium', state: 'pending' });
  const headMatch = baseDoc.match(/<head>([\s\S]*?)<\/head>/i);
  const extraCss = ENVIRONMENTS.map(env => {
    const branch = capabilityCss(env);
    return branch ? `[data-env-id="${env.id}"] ${branch}` : '';
  }).filter(Boolean).join('\n');

  return `<!doctype html><html lang="pt-BR"><head>${headMatch[1]}
    <style>
      body{display:block!important;padding:20px!important}
      .harness-main,.hf-week-sheet__panel{position:relative!important;transform:none!important;width:min(100%,560px)!important}
      ${extraCss}
    </style></head><body>${sections}<script>${measureScript(ENVIRONMENTS)}</script></body></html>`;
}

function runBrowser() {
  if (!CHROME) throw new Error('Chrome not found');
  const tempPath = join(HERE, '.tmp-depth-motion-examples.html');
  writeFileSync(tempPath, buildTestDocument(), 'utf8');
  const profilePath = `${tempPath}.chrome-${process.pid}`;
  rmSync(profilePath, { recursive: true, force: true });
  try {
    const result = spawnSync(CHROME, [
      '--headless=new', '--hide-scrollbars', '--disable-background-networking',
      '--disable-extensions', '--disable-component-update', '--disable-default-apps',
      '--disable-sync', '--metrics-recording-only', '--no-first-run',
      '--host-resolver-rules=MAP * ~NOTFOUND', `--user-data-dir=${profilePath}`,
      '--window-size=768,900', '--dump-dom', pathToFileURL(tempPath).href
    ], { encoding: 'utf8', timeout: 30_000, maxBuffer: 32 * 1024 * 1024 });
    const payload = result.stdout.match(/data-depth-results="([A-Za-z0-9+/=]+)"/)?.[1];
    const state = result.stdout.match(/data-depth-harness-state="([^"]+)"/)?.[1];
    if (result.status !== 0 || state !== 'complete' || !payload) {
      throw new Error(`Harness failed: status=${result.status}, state=${state || 'missing'}, stderr=${(result.stderr || '').slice(-800)}`);
    }
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } finally {
    rmSync(profilePath, { recursive: true, force: true });
    rmSync(tempPath, { force: true });
  }
}

// --- Production source contract checks ---
console.log('\nProduction source: depth and plane contracts');
check('premium override defines z-index 0 for image plane',
  /\.workout-card\s+\.exercise-card-image\s*\{[^}]*z-index:\s*0/s.test(source));
check('premium override defines z-index 1 for scrim plane',
  /\.workout-card\s*>\s*\.absolute\.inset-0\s*>\s*\.bg-gradient-to-t\s*\{[^}]*z-index:\s*1/s.test(source));
check('premium override defines z-index 10 for content plane',
  /\.workout-card\s*>\s*\.relative\.z-10\s*\{[^}]*z-index:\s*10/s.test(source));
check('card active press uses scale(0.97)',
  /\.workout-card:active\s*\{[^}]*transform:\s*scale\(0\.97\)/s.test(source));
check('card hover uses translateY with --wc-motion-short',
  /\.workout-card:hover[\s\S]*?transform:\s*translateY\(calc\(-1\s*\*\s*var\(--wc-motion-short\)\)\)/s.test(source));
check('--wc-motion-short token is 3px',
  /--wc-motion-short:\s*3px/.test(source));
check('card hover has contained shadow without orange/green glow',
  /\.workout-card:hover[\s\S]*?box-shadow:\s*0\s+4px\s+12px\s+-4px\s+rgba\(0,\s*0,\s*0/.test(source));
check('completed card has opacity 1',
  /\.workout-card\.exercise-completed\s*\{[^}]*opacity:\s*1/s.test(source));
check('reduced-motion sets transition-duration to 0s for card',
  /prefers-reduced-motion:\s*reduce[\s\S]*?\.workout-card\s*\{[^}]*transition-duration:\s*0s/s.test(source));
check('coarse pointer disables hover elevation',
  /pointer:\s*coarse[\s\S]*?\.workout-card:hover\s*\{[^}]*transform:\s*none/s.test(source));
check('card ::before and ::after are hidden (no glossy overlay)',
  /\.workout-card::before[\s\S]*?\.workout-card::after\s*\{[^}]*display:\s*none/s.test(source));
check('box-shadow transition included in card base',
  /\.workout-card\s*\{[^}]*transition:[^}]*box-shadow/s.test(source));

// --- Browser-based checks ---
console.log('\nBrowser-based depth and plane checks');
let results = [];
try {
  results = runBrowser();
  check('all environments rendered', results.length === ENVIRONMENTS.length);
} catch (error) {
  check('browser harness executed', false, error.stack || error.message);
}

for (const r of results) {
  if (r.error) { check(`${r.id}: rendered`, false, r.error); continue; }

  console.log(`\n${r.id}`);

  // Three visual planes: image (0) < scrim (1) < content (10)
  const imageZ = parseInt(r.zOrder.image) || 0;
  const scrimZ = parseInt(r.zOrder.scrim) || 0;
  const contentZs = r.zOrder.content.map(v => parseInt(v) || 0);
  check(`${r.id}: image z-index (${imageZ}) < scrim z-index (${scrimZ})`,
    imageZ < scrimZ, JSON.stringify(r.zOrder));
  check(`${r.id}: scrim z-index (${scrimZ}) < content z-index (${contentZs[0]})`,
    contentZs.every(z => scrimZ < z), JSON.stringify(r.zOrder));

  // Card at rest: no transform (matrix identity or none)
  const isIdentityTransform = r.card.transform === 'none' || r.card.transform === 'matrix(1, 0, 0, 1, 0, 0)';
  check(`${r.id}: card at rest has identity transform`, isIdentityTransform, r.card.transform);

  // Card at rest: box-shadow is none (no halo at rest)
  check(`${r.id}: card at rest has no box-shadow`, r.card.boxShadow === 'none', r.card.boxShadow);

  // Card border exists (hairline)
  check(`${r.id}: card has 1px hairline border`,
    r.card.borderWidth === '1px', r.card.borderWidth);

  // 1:1 aspect ratio
  check(`${r.id}: card maintains 1:1 aspect ratio`,
    approx(r.card.width, r.card.height, 2), `${r.card.width}x${r.card.height}`);

  // Completed card: opacity 1
  const env = ENVIRONMENTS.find(e => e.id === r.id);
  if (env.state === 'completed') {
    check(`${r.id}: completed card has opacity 1`, r.card.opacity === '1', r.card.opacity);
  }

  // Reduced motion: transition duration is 0s
  if (env.motion === 'reduced') {
    check(`${r.id}: reduced-motion card has 0s transition`,
      r.card.transitionDuration?.includes('0s'), r.card.transitionDuration);
    check(`${r.id}: reduced-motion image has 0s transition`,
      r.image.transitionDuration?.includes('0s'), r.image.transitionDuration);
  }

  // Image scale at rest is 1.03
  if (r.image.scale) {
    const scaleValue = parseFloat(r.image.scale);
    check(`${r.id}: image base scale is ~1.03`,
      approx(scaleValue, 1.03, 0.02), r.image.scale);
  }
}

// --- Final summary ---
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${failures === 0 ? `all ${checks}` : `${checks - failures}/${checks}`} targeted depth-motion checks ${failures === 0 ? 'passed' : 'passed'}\n`);
process.exitCode = failures > 0 ? 1 : 0;
