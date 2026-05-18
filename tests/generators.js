// Property-based test generators for the builder-screen-ui-redesign feature.
//
// Exposes named arbitraries that produce valid `BUILDER_STATE` shapes,
// exercise names, viewport widths and operation sequences for the picker
// and slot-list state machines described in design.md (Data Models).
//
// EXERCISE_DB resolution:
//   - The setup file (`./setup.js`) hydrates `EXERCISE_DB` lazily once the
//     production `index.html` inline scripts have been evaluated.
//   - This module never imports setup.js directly so it can be loaded in
//     isolation (e.g. ad-hoc REPL, doc generation, jest-style testing).
//   - Names are read at generation time via `globalThis.EXERCISE_DB`, so
//     even if EXERCISE_DB is hydrated AFTER this module is imported, the
//     generators still see the production vocabulary.
//   - A small fallback list keeps `fc.constantFrom(...)` non-empty when the
//     production code has not yet exposed EXERCISE_DB on globalThis.

import * as fc from "fast-check";

// ---------------------------------------------------------------------------
// Constants shared with the production `BUILDER_STATE` shape
// ---------------------------------------------------------------------------

/** 7-day schedule keys used by `index.html` (see TRAINING_PROGRAMS phases). */
const DAY_KEYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

/** Picker filter values rendered by `renderPickerFilters` in production. */
const PICKER_FILTERS = [
  "all",
  "Peito",
  "Costas",
  "Pernas",
  "Ombros",
  "Bíceps",
  "Tríceps"
];

/** Workout key letters allowed by `BUILDER_STATE.workouts`. A/B/C are mandatory. */
const WORKOUT_KEY_POOL = ["A", "B", "C", "D", "E", "F"];

/** Method labels used by Exercise Form. */
const METHODS = [
  "Convencional",
  "Drop-set",
  "Bi-set",
  "Rest-pause",
  "Pirâmide",
  "Cluster"
];

/**
 * Fallback exercise vocabulary used when `globalThis.EXERCISE_DB` is not yet
 * hydrated. Kept small so the generator stays cheap when running stand-alone.
 */
const FALLBACK_EXERCISE_NAMES = [
  "Supino Reto Máquina",
  "Agachamento",
  "Leg Press 45"
];

// ---------------------------------------------------------------------------
// EXERCISE_DB resolution (lazy)
// ---------------------------------------------------------------------------

/**
 * Resolves the current pool of exercise names from `globalThis.EXERCISE_DB`.
 * Returns a non-empty array so `fc.constantFrom(...)` always has at least one
 * value. Tolerates both `{ name }` and `{ nome }` shapes plus plain strings.
 */
function resolveExerciseNames() {
  const db = globalThis.EXERCISE_DB;
  if (!Array.isArray(db) || db.length === 0) {
    return FALLBACK_EXERCISE_NAMES.slice();
  }
  const names = db
    .map(entry => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object") {
        return entry.name || entry.nome || null;
      }
      return null;
    })
    .filter(name => typeof name === "string" && name.length > 0);
  return names.length > 0 ? names : FALLBACK_EXERCISE_NAMES.slice();
}

// ---------------------------------------------------------------------------
// Primitive arbitraries
// ---------------------------------------------------------------------------

/**
 * Uniform integer in [320, 1920] — covers the smallest mobile viewport up to
 * a typical desktop monitor.
 */
export function arbViewportWidth() {
  return fc.integer({ min: 320, max: 1920 });
}

/**
 * Exercise name arbitrary biased ~80% to `EXERCISE_DB` and ~20% to short
 * custom strings to exercise the "custom exercise" path.
 *
 * Implementation note: we wrap the EXERCISE_DB lookup in `fc.constant(null)
 * .map(...)` so the actual `globalThis.EXERCISE_DB` read happens at
 * generation time, not at module import time.
 */
export function arbExerciseName() {
  const dbPick = fc
    .nat({ max: 0xffffffff })
    .map(n => {
      const names = resolveExerciseNames();
      return names[n % names.length];
    });
  return fc.oneof(
    { arbitrary: dbPick, weight: 4 },
    { arbitrary: fc.string({ minLength: 1, maxLength: 30 }), weight: 1 }
  );
}

// ---------------------------------------------------------------------------
// BUILDER_STATE arbitrary
// ---------------------------------------------------------------------------

/** Arbitrary for a single Exercise Form record. */
function arbExerciseEntry() {
  return fc.record({
    name: arbExerciseName(),
    series: fc.constantFrom("1", "2", "3", "4", "5", "6"),
    rept: fc.constantFrom(
      "6 a 8",
      "8 a 10",
      "8 a 12",
      "10 a 12",
      "12 a 15",
      "15 a 20"
    ),
    descanso: fc.constantFrom("30 seg", "45 seg", "60 seg", "90 seg", "120 seg"),
    method: fc.constantFrom(...METHODS)
  });
}

/** Arbitrary for a single workout (`{ name, exercises[] }`). */
function arbWorkout(key) {
  return fc.record({
    name: fc
      .string({ minLength: 0, maxLength: 30 })
      .map(s => (s.trim() ? s : `Treino ${key}`)),
    exercises: fc.array(arbExerciseEntry(), { maxLength: 6 })
  });
}

/**
 * Arbitrary that produces a workout-key set always containing A/B/C and
 * optionally extending with D/E/F (in order).
 */
function arbWorkoutKeySet() {
  return fc
    .integer({ min: 0, max: 3 })
    .map(extra => WORKOUT_KEY_POOL.slice(0, 3 + extra));
}

/** Arbitrary that produces a `{ keys, workouts }` pair. */
function arbWorkoutsRecord() {
  return arbWorkoutKeySet().chain(keys => {
    const recordShape = {};
    for (const k of keys) recordShape[k] = arbWorkout(k);
    return fc.record(recordShape).map(workouts => ({ keys, workouts }));
  });
}

/** Arbitrary for a 7-day schedule whose values are OFF or one of `keys`. */
function arbScheduleForKeys(keys) {
  const valuePool = ["OFF", ...keys];
  const shape = {};
  for (const day of DAY_KEYS) {
    shape[day] = fc.constantFrom(...valuePool);
  }
  return fc.record(shape);
}

/** Arbitrary for `BUILDER_STATE.programId` — null in create mode, string id otherwise. */
function arbProgramId() {
  return fc.oneof(
    fc.constant(null),
    fc
      .tuple(
        fc.integer({ min: 1, max: 0xffffffff }),
        fc
          .array(fc.integer({ min: 0, max: 35 }), { minLength: 1, maxLength: 6 })
          .map(digits => digits.map(d => d.toString(36)).join(""))
      )
      .map(([n, s]) => `custom_${n.toString(36)}_${s}`)
  );
}

/**
 * Arbitrary for the full `BUILDER_STATE` record (additive shape per design):
 *   - `name`: 0..60 chars
 *   - `totalWeeks`: 1..52
 *   - `mode`: "create" | "edit"
 *   - `programId`: null or custom id
 *   - `workouts`: ≥3 keys (A/B/C[+D/E/F])
 *   - `schedule`: 7-day map with values in `["OFF", ...workoutKeys]`
 *   - `activeWorkoutKey`: one of the workout keys
 *   - `pickerOpen`, `configCollapsed`: booleans (new fields from design.md)
 */
export function arbBuilderState() {
  return arbWorkoutsRecord().chain(({ keys, workouts }) =>
    fc.record({
      mode: fc.constantFrom("create", "edit"),
      programId: arbProgramId(),
      name: fc.string({ minLength: 0, maxLength: 60 }),
      totalWeeks: fc.integer({ min: 1, max: 52 }),
      workouts: fc.constant(workouts),
      schedule: arbScheduleForKeys(keys),
      activeWorkoutKey: fc.constantFrom(...keys),
      sortable: fc.constant(null),
      pickerFilter: fc.constantFrom(...PICKER_FILTERS),
      pickerSearch: fc.string({ minLength: 0, maxLength: 30 }),
      pickerCallback: fc.constant(null),
      cameFromProgramScreen: fc.boolean(),
      formMode: fc.constantFrom("create", "edit"),
      formIndex: fc.oneof(fc.constant(null), fc.nat({ max: 20 })),
      pickerOpen: fc.boolean(),
      configCollapsed: fc.boolean()
    })
  );
}

// ---------------------------------------------------------------------------
// Operation-sequence DSL
// ---------------------------------------------------------------------------

/**
 * Arbitrary for a single tagged operation. Each variant matches a state
 * mutation referenced by Properties 1, 3, 4, 7, 8 in design.md.
 */
function arbOperation() {
  const dayKey = fc.constantFrom(...DAY_KEYS);
  const scheduleValue = fc.constantFrom("OFF", ...WORKOUT_KEY_POOL);
  const workoutKey = fc.constantFrom(...WORKOUT_KEY_POOL);
  const slotIndex = fc.nat({ max: 7 });

  return fc.oneof(
    fc.record({
      type: fc.constant("setName"),
      args: fc.record({ value: fc.string({ minLength: 0, maxLength: 60 }) })
    }),
    fc.record({
      type: fc.constant("setTotalWeeks"),
      args: fc.record({ value: fc.integer({ min: 1, max: 52 }) })
    }),
    fc.record({
      type: fc.constant("setSchedule"),
      args: fc.record({ day: dayKey, value: scheduleValue })
    }),
    fc.record({
      type: fc.constant("switchActiveWorkout"),
      args: fc.record({ key: workoutKey })
    }),
    fc.record({
      type: fc.constant("addWorkout"),
      args: fc.constant({})
    }),
    fc.record({
      type: fc.constant("removeWorkout"),
      args: fc.record({ key: workoutKey })
    }),
    fc.record({
      type: fc.constant("renameActiveWorkout"),
      args: fc.record({
        value: fc.string({ minLength: 0, maxLength: 30 })
      })
    }),
    fc.record({
      type: fc.constant("editSlot"),
      args: fc.record({ index: slotIndex, value: arbExerciseEntry() })
    }),
    fc.record({
      type: fc.constant("deleteSlot"),
      args: fc.record({ index: slotIndex })
    }),
    fc.record({
      type: fc.constant("reorderSlots"),
      args: fc.record({ oldIndex: slotIndex, newIndex: slotIndex })
    })
  );
}

/**
 * Sequence of 0..10 tagged operations, suitable for driving the builder
 * state machine in property tests (Properties 3, 5, 8 in design.md).
 */
export function arbOperationSequence() {
  return fc.array(arbOperation(), { maxLength: 10 });
}
