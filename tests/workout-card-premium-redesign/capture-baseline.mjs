#!/usr/bin/env node
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  BREAKPOINT_WIDTHS, STATES, buildCaptureMatrix, createFixtureWorkspace,
  matrixCoverage, normalizeCase, sourceContract
} from './harness.mjs';

const args = process.argv.slice(2);
const has = flag => args.includes(flag);
const valueOf = (flag, fallback = null) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
};
const chromeCandidates = [
  process.env.HF_CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
].filter(Boolean);
const chromePath = chromeCandidates.find(existsSync) || null;
const safariPath = '/Applications/Safari.app/Contents/MacOS/Safari';
const safariDriverPath = '/usr/bin/safaridriver';

function browserEvidence() {
  const version = chromePath ? spawnSync(chromePath, ['--version'], { encoding: 'utf8' }) : null;
  return {
    chromium: { executable: chromePath, available: !!chromePath, version: version?.stdout?.trim() || null, capture: !!chromePath },
    webkit: {
      executable: existsSync(safariPath) ? safariPath : null,
      driver: existsSync(safariDriverPath) ? safariDriverPath : null,
      available: existsSync(safariPath), capture: false,
      reason: 'Safari has no non-interactive screenshot CLI; safaridriver requires host Remote Automation authorization and this dependency-free harness does not mutate that host setting.'
    },
    basic: { available: !!chromePath, capture: !!chromePath, method: 'Chromium with backdrop filters disabled by harness-only CSS' }
  };
}
function validateContract() {
  const matrix = buildCaptureMatrix();
  const coverage = matrixCoverage(matrix);
  const failures = [];
  if (BREAKPOINT_WIDTHS.some(width => !coverage.widths.includes(width)) || coverage.widths.length !== BREAKPOINT_WIDTHS.length) {
    failures.push('breakpoint-neighbor coverage is incomplete');
  }
  for (const [key, expected] of Object.entries({
    contexts: ['main', 'week-sheet'], pointers: ['coarse', 'fine'],
    motions: ['full', 'reduced'], capabilities: ['basic', 'chromium', 'webkit'], states: [...STATES]
  })) {
    if (expected.some(item => !coverage[key].includes(item))) failures.push(`${key} coverage is incomplete`);
  }
  const contract = sourceContract();
  if (!contract.usesRealPlayerCss || contract.inlineStyleBlocks < 1) failures.push('real styles were not loaded');
  if (!contract.rendererNames.includes('createExerciseCardHTML')) failures.push('real card renderer was not loaded');
  return { ok: failures.length === 0, failures, coverage, contract, browsers: browserEvidence() };
}

function captureOne(captureCase, fixture, outputPath) {
  if (captureCase.capability === 'webkit') return { id: captureCase.id, status: 'unsupported', evidence: browserEvidence().webkit };
  if (!chromePath) return { id: captureCase.id, status: 'unsupported', evidence: browserEvidence().chromium };
  const commandArgs = [
    '--headless=new', '--hide-scrollbars', '--disable-background-networking',
    '--disable-component-update', '--disable-default-apps', '--disable-sync', '--metrics-recording-only',
    '--no-first-run', '--run-all-compositor-stages-before-draw', '--virtual-time-budget=1000',
    `--window-size=${captureCase.width},${captureCase.height}`, `--screenshot=${outputPath}`
  ];
  if (captureCase.motion === 'reduced') commandArgs.push('--force-prefers-reduced-motion=reduce');
  if (captureCase.pointer === 'coarse') commandArgs.push('--touch-events=enabled');
  commandArgs.push(fixture.url);
  const result = spawnSync(chromePath, commandArgs, { encoding: 'utf8', timeout: 30000 });
  return {
    id: captureCase.id, status: result.status === 0 && existsSync(outputPath) ? 'captured' : 'failed',
    output: outputPath, exitCode: result.status,
    stderr: result.stderr?.trim().split('\n').slice(-5).join('\n') || null
  };
}

function selectCases(matrix) {
  const requestedId = valueOf('--case');
  if (requestedId) {
    const found = matrix.find(item => item.id === requestedId);
    if (!found) throw new Error(`Unknown capture case: ${requestedId}`);
    return [found];
  }
  if (has('--all')) return matrix;
  return [matrix.find(item => item.id === 'main-768-fine-full-chromium-pending') || normalizeCase()];
}
const validation = validateContract();
if (!validation.ok) {
  console.error(JSON.stringify(validation, null, 2));
  process.exit(1);
}

const matrix = buildCaptureMatrix();
if (has('--list')) {
  console.log(JSON.stringify({ ...validation, cases: matrix }, null, 2));
  process.exit(0);
}
if (has('--check') && !has('--smoke')) {
  console.log(JSON.stringify(validation, null, 2));
  process.exit(0);
}

const selected = selectCases(matrix);
const workspace = createFixtureWorkspace(selected);
const explicitOutput = valueOf('--output');
const outputDirectory = explicitOutput ? resolve(explicitOutput) : resolve(workspace.directory, 'captures');
mkdirSync(outputDirectory, { recursive: true });
let results;
try {
  results = selected.map((captureCase, index) => captureOne(
    captureCase, workspace.files[index], resolve(outputDirectory, `${captureCase.id}.png`)
  ));
  const report = { ok: results.every(item => ['captured', 'unsupported'].includes(item.status)), smoke: !has('--all'), outputDirectory: explicitOutput ? outputDirectory : null, results, evidence: validation.browsers };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally {
  if (!explicitOutput || has('--smoke')) {
    workspace.cleanup();
    if (explicitOutput && has('--smoke')) rmSync(outputDirectory, { recursive: true, force: true });
  }
}
