// tests/setup.js
//
// Vitest setup file for the Builder Screen UI Redesign feature.
//
// Purpose: load the single-file production app (`/Users/rafael/hyperfitness/index.html`)
// into the JSDOM test window, evaluate its inline `<script>` blocks so the
// builder state and helpers become available, and re-export the symbols the
// test files need.
//
// Notes:
//   * The production code uses top-level `const`/`let`/`function` declarations
//     inside a single `<script>` block. Those declarations are lexically scoped
//     to the script, so they never appear on `window` automatically. We work
//     around this by concatenating the inline scripts inside an IIFE that
//     captures the named symbols at the end and exposes them on
//     `window.__hf_exports`.
//   * Many of the symbols listed below (`renderBuilder`, `BUILDER_STATE`, ...)
//     already exist in `index.html`. Some (`setPickerOpen`,
//     `addExerciseToActiveWorkout`, `refreshAddedIndicators`, ...) will be
//     added by later tasks in the same spec. Re-exports default to `undefined`
//     so that this setup file is not blocking those later tasks.
//   * External `<script src="...">` tags (Tailwind, Sortable, confetti, the
//     player bundle, etc.) are skipped. Their globals are stubbed below so the
//     inline code does not throw when it touches them.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INDEX_HTML_PATH = path.resolve(__dirname, "..", "index.html");

/**
 * Names of symbols defined inside the inline `<script>` block of `index.html`
 * that test files need to consume. Order matters only for readability.
 */
const EXPORT_NAMES = [
  "BUILDER_STATE",
  "renderBuilder",
  "setPickerOpen",
  "addExerciseToActiveWorkout",
  "refreshAddedIndicators",
  "computeAddedSet",
  "computeWorkoutMeta",
  "computeActiveDays",
  "updateConfigSummary",
  "updateSaveButtonState",
  "persistCustomProgramFromBuilder",
  "openBuilder",
  "EXERCISE_DB",
  "TRAINING_PROGRAMS",
  "DEFAULT_EXERCISE",
  // Helpers reused inside `resetBuilder` if available:
  "getDefaultSchedule",
  "getDefaultWorkouts",
  "DAY_KEYS",
];

// ---------------------------------------------------------------------------
// HTML parsing (cached per process)
// ---------------------------------------------------------------------------

let _parsedIndex = null;

/**
 * Reads `index.html` from disk and splits it into the body markup plus the
 * concatenated inline script bodies. The result is memoized so that multiple
 * test files in the same Vitest worker do not re-read the file.
 *
 * @returns {{ bodyHtml: string, inlineScripts: string[] }}
 */
function parseIndexHtml() {
  if (_parsedIndex) return _parsedIndex;

  const html = fs.readFileSync(INDEX_HTML_PATH, "utf8");

  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : "";

  const inlineScripts = [];
  const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = scriptRegex.exec(html)) !== null) {
    const attrs = m[1] || "";
    if (/\bsrc\s*=/i.test(attrs)) continue; // external script -> skip
    inlineScripts.push(m[2]);
  }

  _parsedIndex = { bodyHtml, inlineScripts };
  return _parsedIndex;
}

/** Strips `<script>` tags from a chunk of HTML so `innerHTML` stays inert. */
function stripScriptTags(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
}

// ---------------------------------------------------------------------------
// External-library stubs
// ---------------------------------------------------------------------------

/**
 * Installs minimal stubs for browser-only or CDN globals that the inline
 * production code touches. Stubs only fill gaps — they never overwrite a real
 * implementation if one exists.
 */
function installExternalStubs(win) {
  // SortableJS — only used when the builder screen renders. Provide a noop
  // implementation that satisfies `BUILDER_STATE.sortable.destroy()` calls.
  if (!win.Sortable) {
    win.Sortable = {
      create() {
        return {
          destroy() {},
          option() {},
        };
      },
    };
  }

  // canvas-confetti is invoked from `initializeApp()` via
  // `confetti.create(canvas, opts)`. We mock it so the call site is harmless.
  if (!win.confetti) {
    const confettiFn = () => {};
    confettiFn.create = () => () => {};
    win.confetti = confettiFn;
  }

  // Tailwind CDN exposes a `tailwind` global with a `config` property. Some
  // inline boot snippets reference it; the setup mocks it defensively.
  if (!win.tailwind) {
    win.tailwind = { config: {} };
  }

  // matchMedia — JSDOM does not implement it. Several builder helpers depend
  // on it (e.g. prefers-reduced-motion overrides).
  if (typeof win.matchMedia !== "function") {
    win.matchMedia = (query) => ({
      matches: false,
      media: String(query || ""),
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    });
  }

  // requestAnimationFrame fallback — JSDOM provides one but some integrations
  // bypass it. Keep a plain setTimeout fallback for safety.
  if (typeof win.requestAnimationFrame !== "function") {
    win.requestAnimationFrame = (cb) => win.setTimeout(() => cb(Date.now()), 16);
    win.cancelAnimationFrame = (id) => win.clearTimeout(id);
  }

  // Notification spy — many builder mutations call `showNotification`. Tests
  // can read or reset `window.__hf_test_notifications` to assert behavior.
  if (!Array.isArray(win.__hf_test_notifications)) {
    win.__hf_test_notifications = [];
  }
  if (typeof win.showNotification !== "function") {
    win.showNotification = function showNotificationStub(message, type) {
      win.__hf_test_notifications.push({ message, type });
    };
  }
}

// ---------------------------------------------------------------------------
// Inline-script evaluation
// ---------------------------------------------------------------------------

/**
 * Builds the source string evaluated inside the JSDOM realm. The inline
 * scripts are wrapped in a single IIFE; declarations inside that IIFE remain
 * lexically scoped, so the closing block captures each named symbol (when it
 * exists) and writes it to `window.__hf_exports`.
 */
function buildEvalSource(inlineScripts) {
  const captureLines = EXPORT_NAMES.map((name) => {
    const key = JSON.stringify(name);
    return `  try { __exports[${key}] = (typeof ${name} !== 'undefined') ? ${name} : undefined; } catch (_e) { __exports[${key}] = undefined; }`;
  }).join("\n");

  return [
    ";(function(window){",
    "  'use strict';",
    "  var __exports = window.__hf_exports = window.__hf_exports || {};",
    "  try {",
    inlineScripts.join("\n;\n"),
    "  } catch (_topLevelErr) {",
    "    if (typeof console !== 'undefined') {",
    "      console.warn('[hf-tests/setup] inline script threw at top level:', _topLevelErr && _topLevelErr.message);",
    "    }",
    "  }",
    captureLines,
    "})(window);",
  ].join("\n");
}

/**
 * Loads `index.html` into the current JSDOM document, stubs externals, and
 * evaluates the inline scripts. Idempotent within a single test file.
 */
function loadProductionScripts() {
  if (window.__hf_exports && window.__hf_loaded) return;

  const { bodyHtml, inlineScripts } = parseIndexHtml();

  // Install stubs BEFORE the inline script runs; some references (Sortable,
  // confetti, matchMedia) are touched during top-level execution.
  installExternalStubs(window);

  // Drop any prior body content and replace it with the production markup,
  // sans `<script>` tags (innerHTML never executes them, but stripping makes
  // the resulting tree easier to reason about).
  document.body.innerHTML = stripScriptTags(bodyHtml);

  // localStorage is provided by JSDOM. Start each worker with a clean slate.
  try {
    window.localStorage.clear();
  } catch (_) {
    /* ignore — read-only environments */
  }

  try {
    window.eval(buildEvalSource(inlineScripts));
  } catch (e) {
    console.warn(
      "[hf-tests/setup] failed to evaluate inline scripts:",
      e && e.message
    );
  }

  window.__hf_loaded = true;
}

// Run immediately at module load. Vitest invokes this setup file before each
// test file, in the test file's JSDOM realm.
loadProductionScripts();

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

const _ex = (typeof window !== "undefined" && window.__hf_exports) || {};

export const BUILDER_STATE = _ex.BUILDER_STATE;
export const renderBuilder = _ex.renderBuilder;
export const setPickerOpen = _ex.setPickerOpen;
export const addExerciseToActiveWorkout = _ex.addExerciseToActiveWorkout;
export const refreshAddedIndicators = _ex.refreshAddedIndicators;
export const computeAddedSet = _ex.computeAddedSet;
export const computeWorkoutMeta = _ex.computeWorkoutMeta;
export const computeActiveDays = _ex.computeActiveDays;
export const updateConfigSummary = _ex.updateConfigSummary;
export const updateSaveButtonState = _ex.updateSaveButtonState;
export const persistCustomProgramFromBuilder = _ex.persistCustomProgramFromBuilder;
export const openBuilder = _ex.openBuilder;
export const EXERCISE_DB = _ex.EXERCISE_DB;
export const TRAINING_PROGRAMS = _ex.TRAINING_PROGRAMS;
export const DEFAULT_EXERCISE = _ex.DEFAULT_EXERCISE;

// ---------------------------------------------------------------------------
// globalThis mirror (vitest config has `globals: true`)
// ---------------------------------------------------------------------------
//
// Tests can rely on these names being available without an explicit import.
// We do not overwrite values that already exist on `globalThis` (e.g. real
// Vitest globals such as `expect`) — every name below is unique to the app.

for (const name of EXPORT_NAMES) {
  // Re-read from `window.__hf_exports` so future-task symbols added after
  // the first IIFE pass can still be picked up if the loader is re-run.
  const value = (typeof window !== "undefined" && window.__hf_exports)
    ? window.__hf_exports[name]
    : undefined;
  if (typeof globalThis !== "undefined") {
    try {
      globalThis[name] = value;
    } catch (_) {
      /* read-only — ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// resetBuilder helper
// ---------------------------------------------------------------------------

/**
 * Baseline schedule: 7 OFF days. Tests may override individual days.
 */
function makeBaselineSchedule() {
  return {
    Seg: "OFF",
    Ter: "OFF",
    Qua: "OFF",
    Qui: "OFF",
    Sex: "OFF",
    "Sáb": "OFF",
    Dom: "OFF",
  };
}

/**
 * Baseline workouts: A/B/C with empty exercise lists. Mirrors the production
 * `getDefaultWorkouts()` so that tests start in a deterministic state.
 */
function makeBaselineWorkouts() {
  return {
    A: { name: "Treino A", exercises: [] },
    B: { name: "Treino B", exercises: [] },
    C: { name: "Treino C", exercises: [] },
  };
}

/**
 * Builds a fresh, deeply-cloned `BUILDER_STATE`-shaped object. Tests can
 * mutate it freely without bleeding into other tests because every reset
 * produces a new object graph.
 */
function makeBaselineBuilderState(mode) {
  return {
    mode,
    programId: null,
    name: "",
    totalWeeks: 4,
    workouts: makeBaselineWorkouts(),
    schedule: makeBaselineSchedule(),
    activeWorkoutKey: "A",
    sortable: null,
    pickerFilter: "all",
    pickerSearch: "",
    pickerCallback: null,
    cameFromProgramScreen: false,
    formMode: "create",
    formIndex: null,
    pickerOpen: true,
    configCollapsed: false,
  };
}

/**
 * Resets the shared `BUILDER_STATE` object and the builder DOM to a known
 * baseline. Tests should call this in `beforeEach` to guarantee isolation.
 *
 * The function mutates `BUILDER_STATE` in place (preserving its identity so
 * any cached references in production code remain valid) and re-runs
 * `renderBuilder()` if it exists.
 *
 * @param {{ mode?: "create" | "edit" }} [options]
 */
export function resetBuilder({ mode = "create" } = {}) {
  // Refuse to fail loudly if production code has not loaded — this lets
  // earlier-wave tests run before later-wave symbols are wired.
  if (!BUILDER_STATE || typeof BUILDER_STATE !== "object") return BUILDER_STATE;

  const baseline = makeBaselineBuilderState(mode);

  // Tear down any live Sortable instance to avoid stale handlers.
  if (BUILDER_STATE.sortable && typeof BUILDER_STATE.sortable.destroy === "function") {
    try {
      BUILDER_STATE.sortable.destroy();
    } catch (_) {
      /* ignore */
    }
  }

  // Wipe existing keys so we don't leak fields written by a previous test.
  for (const key of Object.keys(BUILDER_STATE)) {
    delete BUILDER_STATE[key];
  }
  Object.assign(BUILDER_STATE, baseline);

  // Reset the notification spy buffer.
  if (Array.isArray(window.__hf_test_notifications)) {
    window.__hf_test_notifications.length = 0;
  }

  // Reset localStorage between tests so persistence checks start clean.
  try {
    window.localStorage.clear();
  } catch (_) {
    /* ignore */
  }

  // Re-render the builder if the renderer is wired up. Tolerate failures so a
  // partial implementation does not break unrelated tests.
  if (typeof renderBuilder === "function") {
    try {
      renderBuilder();
    } catch (e) {
      if (typeof console !== "undefined") {
        console.warn(
          "[hf-tests/setup] renderBuilder() threw inside resetBuilder:",
          e && e.message
        );
      }
    }
  }

  return BUILDER_STATE;
}

// Mirror `resetBuilder` onto `globalThis` so test files can use it without an
// explicit import (vitest config has `globals: true`).
if (typeof globalThis !== "undefined") {
  try {
    globalThis.resetBuilder = resetBuilder;
  } catch (_) {
    /* ignore */
  }
}
