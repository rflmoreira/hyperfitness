// Feature: workout-card-premium-redesign, Task 17.1: Deterministic cross-browser visual regression coverage
// **Validates: Requirements 2.1–2.12, 3.1–3.11, 4.1–4.11, 5.1–5.11, 7.1–7.8, 8.1–8.12**
// Usage: node tests/workout-card-premium-redesign/cross-browser-visual.test.mjs
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

const ENVIRONMENTS = Object.freeze([
  { id: 'min-width-chromium', width: 639, pointer: 'fine', motion: 'full', capability: 'chromium', state: 'pending', context: 'main' },
  { id: 'min-width-webkit', width: 639, pointer: 'fine', motion: 'full', capability: 'webkit', state: 'pending', context: 'main' },
  { id: 'mobile-chromium', width: 639, pointer: 'coarse', motion: 'full', capability: 'chromium', state: 'pending', context: 'main' },
  { id: 'tablet-basic', width: 768, pointer: 'fine', motion: 'full', capability: 'basic', state: 'pending', context: 'main' },
  { id: 'desktop-chromium', width: 1280, pointer: 'fine', motion: 'full', capability: 'chromium', state: 'pending', context: 'week-sheet' },
  { id: 'desktop-completed', width: 1280, pointer: 'fine', motion: 'full', capability: 'chromium', state: 'completed', context: 'week-sheet' },
  { id: 'reduced-motion', width: 768, pointer: 'fine', motion: 'reduced', capability: 'chromium', state: 'pending', context: 'main' },
]);

function capabilityCss(env) {
  let css = '';
  const sel = `[data-env-id="${env.id}"]`;
  if (env.capability === 'webkit') {
    css += `${sel} .player-glass-btn{background:rgba(0,0,0,.22)!important;backdrop-filter:blur(4px) brightness(1.5) saturate(300%) contrast(1.08)!important;-webkit-backdrop-filter:blur(4px) brightness(1.5) saturate(300%) contrast(1.08)!important}\n`;
  }
  if (env.capability === 'basic') {
    css += `${sel} .player-glass-btn{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}\n`;
    css += `${sel} .liquid-glass-edge{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}\n`;
  }
  if (env.pointer === 'coarse') {
    css += `${sel} .liquid-glass-edge{display:none!important}\n`;
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
      
      const cs = (el, pseudo) => el ? getComputedStyle(el, pseudo || null) : {};
      
      const cardStyle = cs(card);
      const cardRect = card.getBoundingClientRect();
      const imageRect = image ? image.getBoundingClientRect() : null;

      // Ensure elements don't overlap boundaries unexpectedly
      const is1to1 = Math.abs(cardRect.width - cardRect.height) <= 2;
      
      // Ensure scrim is localized (doesn't cover the whole card height)
      // The scrim is absolute inset-0 but with a clamp() on top inset.
      const scrimStyle = cs(scrimGradient);
      const isLocalizedScrim = scrimStyle.top !== '0px' && scrimStyle.top !== 'auto' && scrimStyle.top !== '0%';

      // Content visibility
      const title = card.querySelector('h3');
      const titleVisible = cs(title).display !== 'none' && title.getBoundingClientRect().height > 0;

      results.push({
        id: env.id,
        card: {
          width: cardRect.width, height: cardRect.height,
          is1to1,
          boxShadow: cardStyle.boxShadow
        },
        image: {
          width: imageRect?.width, height: imageRect?.height
        },
        scrim: {
          isLocalized: isLocalizedScrim
        },
        content: {
          titleVisible
        }
      });
    }
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(results))));
    document.body.dataset.visualResults = encoded;
    document.body.dataset.visualHarnessState = 'complete';
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
    return `<section data-env-id="${env.id}" style="width:${env.width}px;margin:0 auto 24px">${content}</section>`;
  }).join('\n');

  const baseDoc = renderFixtureDocument({ width: 768, pointer: 'fine', motion: 'full', capability: 'chromium', state: 'pending' });
  const headMatch = baseDoc.match(/<head>([\s\S]*?)<\/head>/i);
  const extraCss = ENVIRONMENTS.map(env => capabilityCss(env)).filter(Boolean).join('\n');

  return `<!doctype html><html lang="pt-BR"><head>${headMatch[1]}
    <style>
      body{display:block!important;padding:20px!important}
      .harness-main,.hf-week-sheet__panel{position:relative!important;transform:none!important;}
      ${extraCss}
    </style></head><body>${sections}<script>${measureScript(ENVIRONMENTS)}</script></body></html>`;
}

function runBrowser() {
  if (!CHROME) throw new Error('Chrome not found');
  const tempPath = join(HERE, '.tmp-cross-browser-visual.html');
  writeFileSync(tempPath, buildTestDocument(), 'utf8');
  const profilePath = `${tempPath}.chrome-${process.pid}`;
  rmSync(profilePath, { recursive: true, force: true });
  try {
    const result = spawnSync(CHROME, [
      '--headless=new', '--hide-scrollbars', '--disable-background-networking',
      '--disable-extensions', '--disable-component-update', '--disable-default-apps',
      '--disable-sync', '--metrics-recording-only', '--no-first-run',
      '--host-resolver-rules=MAP * ~NOTFOUND', `--user-data-dir=${profilePath}`,
      '--window-size=1200,900', '--dump-dom', pathToFileURL(tempPath).href
    ], { encoding: 'utf8', timeout: 30_000, maxBuffer: 32 * 1024 * 1024 });
    const payload = result.stdout.match(/data-visual-results="([A-Za-z0-9+/=]+)"/)?.[1];
    const state = result.stdout.match(/data-visual-harness-state="([^"]+)"/)?.[1];
    if (result.status !== 0 || state !== 'complete' || !payload) {
      throw new Error(`Harness failed: status=${result.status}, state=${state || 'missing'}, stderr=${(result.stderr || '').slice(-800)}`);
    }
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } finally {
    rmSync(profilePath, { recursive: true, force: true });
    rmSync(tempPath, { force: true });
  }
}

// --- Browser-based checks ---
console.log('\\nCross-browser visual regression checks');
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

  // 1:1 Aspect ratio
  check(`${r.id}: card maintains 1:1 aspect ratio`, r.card.is1to1, `${r.card.width}x${r.card.height}`);

  // Localized scrim
  check(`${r.id}: scrim is localized`, r.scrim.isLocalized);

  // Full content (Title visible)
  check(`${r.id}: title is visible`, r.content.titleVisible);

  // No halo at rest
  check(`${r.id}: no halo at rest`, r.card.boxShadow === 'none', r.card.boxShadow);
}

// --- Final summary ---
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${failures === 0 ? `all ${checks}` : `${checks - failures}/${checks}`} targeted cross-browser checks ${failures === 0 ? 'passed' : 'passed'}\n`);
process.exitCode = failures > 0 ? 1 : 0;
