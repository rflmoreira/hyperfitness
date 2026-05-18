# Implementation Plan: Builder Screen UI Redesign

## Overview

Convert the feature design into a series of prompts for a code-generation LLM that will implement each step with incremental progress. Make sure that each prompt builds on the previous prompts, and ends with wiring things together. There should be no hanging or orphaned code that isn't integrated into a previous step. Focus ONLY on tasks that involve writing, modifying, or testing code.

The migration is staged so the app stays runnable between waves. All production code lives in `/Users/rafael/hyperfitness/index.html` (CSS in `<style>`, markup in `<body>`, JS in `<script>`). Tests live in a sibling `tests/` folder with its own minimal `package.json` (devDependencies only). The single-file production delivery is never bundled with test artifacts.

Property tests use **fast-check** + **Vitest** with **JSDOM**. Each property test file MUST start with the comment tag `// Feature: builder-screen-ui-redesign, Property {N}: {Title}` and run with `fc.assert(prop, { numRuns: 100 })` (or higher).

## Tasks

- [x] 1. Set up the test infrastructure (sibling `tests/` folder)
  - [x] 1.1 Create `tests/package.json` with `devDependencies` for `vitest`, `fast-check`, and `jsdom` (and only those); add `"test": "vitest --run"` and `"test:watch": "vitest"` scripts; do NOT add anything to or near `index.html`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11_

  - [x] 1.2 Create `tests/vitest.config.js` with `environment: "jsdom"`, `setupFiles: ["./setup.js"]`, and `globals: true`
    - _Requirements: 8.10_

  - [x] 1.3 Create `tests/setup.js` that loads `/Users/rafael/hyperfitness/index.html` into JSDOM, evaluates the inline `<script>` blocks, and re-exports `BUILDER_STATE`, `renderBuilder`, `setPickerOpen`, `addExerciseToActiveWorkout`, `refreshAddedIndicators`, `computeAddedSet`, `computeWorkoutMeta`, `computeActiveDays`, `updateConfigSummary`, `updateSaveButtonState`, `persistCustomProgramFromBuilder`, `openBuilder`, `EXERCISE_DB`, `TRAINING_PROGRAMS`, and `DEFAULT_EXERCISE` for tests
    - Provide a helper `resetBuilder({ mode = "create" } = {})` that resets the DOM and state to a known baseline before each test
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.10_

  - [x] 1.4 Create `tests/generators.js` exposing `arbBuilderState()`, `arbExerciseName()`, `arbViewportWidth()` (uniform integer in `[320, 1920]`), and `arbOperationSequence()`
    - `arbBuilderState()` MUST produce valid `BUILDER_STATE` shapes per the design: name length 0–60, totalWeeks 1–52, ≥3 workouts (keys A/B/C+), 7-day schedule, 0+ exercises per workout drawn from `EXERCISE_DB` plus occasional custom names, and one of the existing keys for `activeWorkoutKey`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.10_

- [x] 2. CSS foundation in the `<style>` block of `index.html`
  - [x] 2.1 Add the `#builder-screen { --bld-* }` token block (gaps, radii, transition durations, easing, content max-width) and the `@media (prefers-reduced-motion: reduce)` override that lowers all `--bld-transition-*` to ≤80ms
    - _Requirements: 1.2, 1.3, 1.8, 4.7, 4.8, 5.1_

  - [x] 2.2 Add new layout classes: `.builder-config-panel`, `.builder-config-summary`, `.builder-config-details`, `.builder-workspace` (desktop grid + mobile flex-column via media query), `.builder-slots-column`, `.builder-picker-panel` (sticky desktop, static mobile), `.builder-picker-scroll`, `.builder-mobile-picker-toggle`, `.builder-workout-meta`, `.meta-pill`; ensure `.builder-workspace[data-picker-open="false"] > .builder-picker-panel { display: none; }` only inside the mobile media query
    - _Requirements: 2.7, 2.8, 5.2, 5.3, 5.4, 7.1, 7.2, 7.3, 7.4_

  - [x] 2.3 Refactor existing `.ex-picker-search-wrapper`, `.ex-picker-filters`, `.ex-picker-list`, `.ex-picker-item`, `.ex-picker-custom-card` rules so they apply under `.builder-picker-panel` instead of `#exercise-picker-modal .modal-card`; add the `.ex-picker-item[data-added="true"] .ex-picker-item-added` overlay rules with the documented fade-in transition
    - _Requirements: 2.1, 2.2, 2.9, 4.6_

  - [x] 2.4 Remove obsolete CSS: the entire `#exercise-picker-modal` overlay block (`position: fixed`, `inset: 0`, full-screen `backdrop-filter`, `z-index: 140`), all `.builder-summary`, `.builder-summary-stat`, `.builder-stat-value`, `.builder-stat-label` rules, and any rule referencing `#builder-add-exercise-btn`
    - _Requirements: 1.6, 2.2, 5.7_

  - [ ]* 2.5 Smoke test: scan the new builder CSS block (between markers added by tasks 2.1–2.3) and assert no hex color literals exist outside `var(--*)` references — only the allowed CSS variables defined in Requirement 1.2
    - _Requirements: 1.2_

  - [ ]* 2.6 Smoke test: scan all new transition declarations under `#builder-screen` and assert each `transition-timing-function` is `ease-out` or a `cubic-bezier(...)` expression
    - _Requirements: 4.7_

  - [ ]* 2.7 Unit test: monkey-patch `window.matchMedia` so `(prefers-reduced-motion: reduce)` returns `matches: true`, render the builder, and assert every `getComputedStyle(...).transitionDuration` on builder elements parses to ≤80ms
    - _Requirements: 4.8_

- [x] 3. DOM scaffolding inside `#builder-screen`
  - [x] 3.1 Wrap `.builder-name-section`, `#builder-weeks-section`, and `#builder-schedule-section` inside a new `<section class="builder-config-panel" aria-labelledby="builder-config-title">` containing the summary `<header class="builder-config-summary">` (with `data-field="name|weeks|days"` spans and the toggle button targeting `#builder-config-details`) and the `<div id="builder-config-details" class="builder-config-details">` wrapper around the existing children
    - _Requirements: 1.5, 1.7, 5.2_

  - [x] 3.2 Add `<section class="builder-workspace" data-picker-open="true">` directly after `.builder-workout-tabs`; inside it, add `<div class="builder-slots-column">` containing `<header class="builder-workout-meta">` (two `.meta-pill` placeholders + `.builder-mobile-picker-toggle` button) and the existing `<ol id="builder-slots-list">` (now with `role="list"` and `aria-live="polite"`); also add the empty `<aside id="builder-picker-panel" class="builder-picker-panel" role="region" aria-label="Banco de exercícios">` shell with header, filters, and scroll containers
    - _Requirements: 2.4, 2.7, 5.4, 9.1, 9.2, 9.6_

  - [x] 3.3 Move the inner contents of the old picker modal (`.ex-picker-search-wrapper` with `#exercise-picker-search`, `#exercise-picker-filters`, `#exercise-picker-list`, custom exercise card) inside `.builder-picker-panel`, preserving every existing ID
    - _Requirements: 2.1, 2.9, 2.10_

  - [x] 3.4 Delete the entire `<div id="exercise-picker-modal">` element, the `<div id="builder-summary" class="builder-summary"></div>` block, and the `#builder-add-exercise-btn` button from the markup
    - _Requirements: 1.6, 2.1_

  - [x] 3.5 Update `.builder-workout-tabs` markup so the wrapping element is `<nav role="tablist" aria-label="Treinos do programa">`, each tab button has `role="tab"`, `aria-selected`, `tabindex` (active=0, others=-1), and the inline remove button has `tabindex="-1"` and `aria-label="Remover treino {key}"`
    - _Requirements: 1.1, 9.3_

  - [ ]* 3.6 Unit test: assert `#builder-picker-panel` has `role="region"` and a non-empty `aria-label`; `#builder-slots-list` has `role="list"` and `aria-live="polite"`; `.builder-workout-tabs` has `role="tablist"` and an `aria-label`
    - _Requirements: 9.1, 9.2, 9.3, 9.6_

- [x] 4. Checkpoint - structural shell (CSS + DOM) is in place
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. State extensions and pure helpers in the `<script>` block
  - [x] 5.1 Extend `BUILDER_STATE` with `pickerOpen: true` and `configCollapsed: false` (additive only; never serialized); declare and freeze `DEFAULT_EXERCISE = { series: "3", rept: "8 a 12", descanso: "60 seg", method: "Convencional" }` near the top of the builder section
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 5.2 Implement the pure helpers `computeAddedSet(activeWorkout)`, `computeWorkoutMeta(activeWorkout)`, and `computeActiveDays(schedule)` exactly as specified in the Data Models section of the design
    - _Requirements: 1.7, 4.6, 6.2, 6.3_

  - [x] 5.3 Implement `setPickerOpen(open)` so it mutates `BUILDER_STATE.pickerOpen`, resets `pickerSearch=""` and `pickerFilter="all"` when closing, mirrors the value to `data-picker-open` on `.builder-workspace`, focuses `#exercise-picker-search` on open, returns focus to `.builder-mobile-picker-toggle` on close, and re-renders the picker filters and list
    - _Requirements: 2.6, 2.7, 2.8, 6.5, 9.4_

  - [x] 5.4 Implement `addExerciseToActiveWorkout(name)` that pushes `{ name, ...DEFAULT_EXERCISE }` onto the active workout's `exercises[]`, then calls `renderBuilderSlots()`, `renderBuilderWorkoutMeta(activeWorkout)`, `refreshAddedIndicators()`, `updateSaveButtonState()`, and emits `showNotification("Exercício adicionado", "success")`
    - _Requirements: 2.5, 4.3, 4.6_

  - [x] 5.5 Implement `updateConfigSummary()` that mutates only the `.builder-config-summary [data-field="name|weeks|days"]` span text using current `BUILDER_STATE` values (no other DOM rewrite)
    - _Requirements: 1.7, 6.2, 6.3_

  - [x] 5.6 Implement `updateSaveButtonState()` that sets `#builder-save-btn.disabled = !isSavable(BUILDER_STATE)`, where `isSavable` matches Property 10's predicate (non-empty trimmed name, ≥1 exercise across workouts, ≥3 workout keys, ≥3 active schedule days)
    - _Requirements: 8.11_

  - [ ]* 5.7 Property test - **Property 4: Closing the picker resets search and filter**
    - File header: `// Feature: builder-screen-ui-redesign, Property 4: Closing the picker resets search and filter`
    - For every `arbBuilderState()`, after `setPickerOpen(s, false)`: assert `s'.pickerOpen === false`, `s'.pickerSearch === ""`, `s'.pickerFilter === "all"`, and every other field deep-equals the input
    - **Validates: Requirements 6.5**
    - _Requirements: 6.5_

  - [ ]* 5.8 Property test - **Property 3: Non-picker operations preserve picker state**
    - File header: `// Feature: builder-screen-ui-redesign, Property 3: Non-picker operations preserve picker state`
    - For every `arbBuilderState()` and every op in `{ setName, setTotalWeeks, setSchedule, switchActiveWorkout, addWorkout, removeWorkout, renameActiveWorkout, openExerciseFormModal({mode:'create'}), editSlot, deleteSlot, reorderSlots }`, assert `s'.pickerOpen`, `s'.pickerSearch`, and `s'.pickerFilter` are unchanged
    - **Validates: Requirements 2.10, 6.3, 6.4, 6.6**
    - _Requirements: 2.10, 6.3, 6.4, 6.6_

  - [ ]* 5.9 Property test - **Property 7: Two-way binding between inputs and BUILDER_STATE**
    - File header: `// Feature: builder-screen-ui-redesign, Property 7: Two-way binding between inputs and BUILDER_STATE`
    - For each `t ∈ {name, weeksPreset, weeksCustom, scheduleSelect, workoutNameInput}` and any value `v`, dispatch the input event and assert the matching `BUILDER_STATE` field equals `v` (with `clamp(v, 1, 52)` for `weeksCustom`); assert all other fields stay unchanged
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4**
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [ ]* 5.10 Property test - **Property 10: Save validation predicate is total and stable**
    - File header: `// Feature: builder-screen-ui-redesign, Property 10: Save validation predicate is total and stable`
    - For every `arbBuilderState()`, assert `#builder-save-btn.disabled === !isSavable(s)` after render, and that `saveBuilderProgram(s)` invokes `persistCustomProgramFromBuilder` iff `isSavable(s)` (use a spy)
    - **Validates: Requirements 8.11**
    - _Requirements: 8.11_

  - [ ]* 5.11 Property test - **Property 6: Config summary text contains all configured fields**
    - File header: `// Feature: builder-screen-ui-redesign, Property 6: Config summary text contains all configured fields`
    - For every `arbBuilderState()`, after `updateConfigSummary(s)`, assert `.builder-config-summary` text contains `s.name` (or placeholder when empty), `String(s.totalWeeks)`, and `String(computeActiveDays(s.schedule))`
    - **Validates: Requirements 1.7, 6.2, 6.3**
    - _Requirements: 1.7, 6.2, 6.3_

- [x] 6. Decompose `renderBuilder()` into per-panel renderers
  - [x] 6.1 Implement `renderBuilderHeader()` that updates `#builder-header-title` text from `BUILDER_STATE.mode` (`"Editar Treino"` vs `"Monte Seu Treino"`)
    - _Requirements: 1.1, 8.10_

  - [x] 6.2 Implement `renderBuilderConfigPanel()` that mounts the panel scaffold once, delegates to existing `renderBuilderName`, `renderBuilderWeeks`, `renderBuilderSchedule` for inner detail content, wires the collapse toggle to `BUILDER_STATE.configCollapsed` (toggling `[hidden]` on `#builder-config-details` and `aria-expanded`), and ends with `updateConfigSummary()`
    - _Requirements: 1.5, 1.7, 5.2_

  - [x] 6.3 Refactor `renderBuilderWorkoutTabs()` to render the simplified tablist markup; on tab activation update `BUILDER_STATE.activeWorkoutKey` and call `renderBuilderSlots()`, `renderBuilderWorkoutMeta()`, `renderPickerPanel()` (for indicator refresh), and `updateConfigSummary()` — never the full `renderBuilder()`
    - _Requirements: 1.1, 6.1, 6.4, 6.6_

  - [x] 6.4 Implement `renderBuilderWorkspace()` that ensures the `<section class="builder-workspace">` containers exist and orchestrates `renderBuilderSlots()`, `renderBuilderWorkoutMeta(activeWorkout)`, and `renderPickerPanel()`; `renderPickerPanel()` itself sets `data-picker-open` from `BUILDER_STATE.pickerOpen`, calls `renderPickerFilters()` and `renderPickerList()`, and never replaces the panel root node
    - _Requirements: 2.3, 2.4, 2.7, 2.8, 5.4_

  - [x] 6.5 Implement `renderBuilderFooter()` that calls `updateSaveButtonState()`; verify `#builder-save-btn` text contains `"Criar treino"` when `mode==="create"` and `"Salvar alterações"` when `mode==="edit"`
    - _Requirements: 8.8_

  - [x] 6.6 Replace the body of `renderBuilder()` with the orchestrator that calls, in order, `renderBuilderHeader()`, `renderBuilderConfigPanel()`, `renderBuilderWorkoutTabs()`, `renderBuilderWorkspace()`, `renderBuilderFooter()`; remove `updateBuilderSummary` and any reference to the old `#builder-summary` cards
    - _Requirements: 1.6, 6.1, 6.2_

  - [ ]* 6.7 Property test - **Property 5: Core DOM identity is preserved across non-destructive renders**
    - File header: `// Feature: builder-screen-ui-redesign, Property 5: Core DOM identity is preserved across non-destructive renders`
    - Capture references to `#builder-screen`, `#builder-slots-list`, `#builder-picker-panel`, `.builder-footer` before `op`; for every op in the Property 3 set plus `setPickerOpen`, assert post-op the same node instances are still attached to `document`
    - **Validates: Requirements 2.3, 2.4, 6.1**
    - _Requirements: 2.3, 2.4, 6.1_

  - [ ]* 6.8 Property test - **Property 12: Save button label matches mode**
    - File header: `// Feature: builder-screen-ui-redesign, Property 12: Save button label matches mode`
    - For every `arbBuilderState()` and every `m ∈ {"create","edit"}`, after `renderBuilder()` assert `#builder-save-btn` text contains the expected label
    - **Validates: Requirements 8.8**
    - _Requirements: 8.8_

  - [ ]* 6.9 Property test - **Property 8: Slot CRUD operations are deterministic on `exercises[]`**
    - File header: `// Feature: builder-screen-ui-redesign, Property 8: Slot CRUD operations are deterministic on exercises[]`
    - For arbitrary `(state, oldIndex, newIndex)` assert `reorderSlots` moves the item and preserves length; for arbitrary `(state, i, e)` assert `editSlot` deep-equals `e` at `i` and leaves other indices intact; for arbitrary `(state, i)` assert `deleteSlot` removes exactly the item at `i` and decrements length by 1
    - **Validates: Requirements 8.5, 8.6**
    - _Requirements: 8.5, 8.6_

  - [ ]* 6.10 Property test - **Property 9: Removing a workout never reduces the workout count below 1**
    - File header: `// Feature: builder-screen-ui-redesign, Property 9: Removing a workout never reduces the workout count below 1`
    - For every state with exactly one workout, assert `removeWorkout(s, k)` is identity on `s.workouts` and `showNotification` was called with the warning copy
    - **Validates: Requirements 6.7**
    - _Requirements: 6.7_

  - [ ]* 6.11 Property test - **Property 11: Edit-mode load is a faithful round-trip**
    - File header: `// Feature: builder-screen-ui-redesign, Property 11: Edit-mode load is a faithful round-trip`
    - Generate a savable program `p`, register it in `TRAINING_PROGRAMS`, call `openBuilder({ mode: "edit", programId: p.id })`, then `buildProgramFromBuilder()` produces `p'` whose name, totalWeeks, schedule, and workouts deep-equal `p`
    - **Validates: Requirements 8.10**
    - _Requirements: 8.10_

- [x] 7. Picker fast-add flow (no modal intermediary)
  - [x] 7.1 In `renderPickerList`, replace the existing `.ex-picker-item` click handler with `addExerciseToActiveWorkout(item.dataset.name)` and add a `keydown` handler so `Enter` and `Space` (with `preventDefault`) trigger the same call
    - _Requirements: 2.5, 4.2, 9.5_

  - [x] 7.2 Replace remaining `openExercisePickerModal()` call sites with `setPickerOpen(true)` and any `closeExercisePickerModal()` site with `setPickerOpen(false)`; keep thin shim functions with the old names that simply delegate, to avoid breaking external callers
    - _Requirements: 2.1, 2.6_

  - [x] 7.3 Make sure the Custom Exercise Action handler calls `openExerciseFormModal({ mode: "create" })` and does NOT call `setPickerOpen(false)`; the picker stays open and its search/filter are preserved
    - _Requirements: 2.10_

  - [ ]* 7.4 Property test - **Property 1: Picker selection adds exactly one slot and keeps picker state stable**
    - File header: `// Feature: builder-screen-ui-redesign, Property 1: Picker selection adds exactly one slot and keeps picker state stable`
    - For every `arbBuilderState()` with `pickerOpen=true`, every `arbExerciseName()`, and every modality `m ∈ {click, Enter, Space}`, dispatch `m` on the matching item; assert active-workout `exercises.length` increased by 1, the new entry has `series:"3"`, `rept:"8 a 12"`, `descanso:"60 seg"`, `method:"Convencional"`, and `pickerOpen/pickerSearch/pickerFilter` are unchanged
    - **Validates: Requirements 2.5, 4.2, 9.5**
    - _Requirements: 2.5, 4.2, 9.5_

- [x] 8. "Already added" reactive indicator
  - [x] 8.1 Update `renderPickerList` to set `item.dataset.added = String(addedSet.has(item.dataset.name))` using `computeAddedSet(activeWorkout)`, and inject the `<span class="ex-picker-item-added" aria-hidden="true">` overlay markup with the check icon and `Adicionado` label inside each `.ex-picker-item`
    - _Requirements: 4.6_

  - [x] 8.2 Implement `refreshAddedIndicators()` and call it after every active-workout mutation: add slot, edit slot, delete slot, switch active workout, sortable `onEnd`, and at the end of `renderPickerList`
    - _Requirements: 4.6, 6.4_

  - [ ]* 8.3 Property test - **Property 2: "Already added" indicator reflects the active workout**
    - File header: `// Feature: builder-screen-ui-redesign, Property 2: Already-added indicator reflects the active workout`
    - For every `arbBuilderState()`, after `renderBuilder()` and `refreshAddedIndicators()`, every `#exercise-picker-list .ex-picker-item` satisfies `item.dataset.added === String(activeNames.has(item.dataset.name))`
    - **Validates: Requirements 4.6**
    - _Requirements: 4.6_

- [x] 9. Tab keyboard navigation
  - [x] 9.1 Attach a single delegated `keydown` listener on `.builder-workout-tabs` that moves DOM focus between tab buttons cyclically on `ArrowRight`/`ArrowLeft`; do NOT mutate `BUILDER_STATE.activeWorkoutKey` on focus change (only `Enter`/click activate)
    - _Requirements: 9.3_

  - [x] 9.2 In `renderBuilderWorkoutTabs`, ensure exactly one tab has `tabindex="0"` (the active one) and others have `tabindex="-1"`; update on activation
    - _Requirements: 9.3_

  - [ ]* 9.3 Property test - **Property 16: Workout tabs keyboard navigation is cyclic**
    - File header: `// Feature: builder-screen-ui-redesign, Property 16: Workout tabs keyboard navigation is cyclic`
    - For every `arbBuilderState()` and every focused tab index `i`: simulate `ArrowRight` and assert focused index is `(i+1) mod N`; simulate `ArrowLeft` and assert `(i-1+N) mod N`; assert `BUILDER_STATE.activeWorkoutKey` is unchanged in both cases
    - **Validates: Requirements 9.3**
    - _Requirements: 9.3_

- [x] 10. Footer wiring cleanup and responsive coverage
  - [x] 10.1 Remove the `#builder-add-exercise-btn` listener registration from `initializeBuilderHandlers`; verify `#builder-save-btn` and `#builder-back-btn` listeners remain identical; ensure `updateSaveButtonState()` is invoked from every state-mutating handler (name input, weeks change, schedule change, add/remove workout, slot CRUD, sortable `onEnd`)
    - _Requirements: 8.8, 8.9, 8.11_

  - [ ]* 10.2 Property test - **Property 13: Responsive layout is a pure function of viewport width**
    - File header: `// Feature: builder-screen-ui-redesign, Property 13: Responsive layout is a pure function of viewport width`
    - For every `arbViewportWidth()`, simulate the viewport, render, and assert: `w<768` ⇒ `.builder-workspace` `display==="flex"` and `flex-direction==="column"`; `w≥768` ⇒ `display==="grid"` with exactly two grid tracks; `w≥768` ⇒ `slotsColumnWidth/workspaceWidth ∈ [0.5, 0.6]`
    - **Validates: Requirements 7.1, 7.2, 7.4**
    - _Requirements: 7.1, 7.2, 7.4_

  - [ ]* 10.3 Property test - **Property 14: All builder-mobile interactive controls satisfy the touch-target minimum**
    - File header: `// Feature: builder-screen-ui-redesign, Property 14: Mobile interactive controls satisfy the touch-target minimum`
    - For every `arbBuilderState()` at viewport width `<768`, every element matching `#builder-screen button, #builder-screen input, #builder-screen select, #builder-screen [role="tab"]` has `getBoundingClientRect().width ≥ 40` and `height ≥ 40`
    - **Validates: Requirements 7.5**
    - _Requirements: 7.5_

  - [ ]* 10.4 Property test - **Property 15: Viewport resize preserves UI state**
    - File header: `// Feature: builder-screen-ui-redesign, Property 15: Viewport resize preserves UI state`
    - For every `arbBuilderState()` and every `(w1, w2)` pair from `arbViewportWidth()`, simulate resize from `w1` to `w2` and back; assert `activeWorkoutKey`, `pickerSearch`, `pickerFilter`, `workouts`, `schedule`, `name`, `totalWeeks` are all unchanged
    - **Validates: Requirements 7.6**
    - _Requirements: 7.6_

- [ ] 11. Example, unit, and integration tests
  - [ ]* 11.1 Unit tests for the Exercise Slot Card sizing constants: assert rendered `.builder-slot` height ∈ [64,88]px on mobile and ∈ [72,96]px on desktop; thumbnail ∈ [48,64]px square; action buttons ≥36×36 on mobile and ≥40×40 on desktop
    - _Requirements: 3.1, 3.2, 3.5, 7.5_

  - [ ]* 11.2 Unit tests for the Picker Item sizing: aspect-ratio 1:1, computed min-width ≥140 on desktop and ≥120 on mobile, single border `1px`, no shadow offset >8px in default state
    - _Requirements: 3.6, 3.7, 3.8_

  - [ ]* 11.3 Unit tests for content max-width and padding: desktop builder content `max-width ≥ 1024px` (token at 1200px), mobile padding ∈ [12,20]px
    - _Requirements: 5.1, 5.3_

  - [ ]* 11.4 Unit test for the empty Program Slots List state: when `exercises.length === 0`, `#builder-slots-list` rendered empty state has `getBoundingClientRect().height ≤ 240px`
    - _Requirements: 5.6_

  - [ ]* 11.5 Integration test: in create mode, populate a savable state, click `#builder-save-btn`, capture `localStorage["customPrograms"]`; reopen the builder via `openBuilder({ mode: "edit", programId })`, mutate nothing, save again, and assert `localStorage["customPrograms"]` is byte-identical (round-trip stability)
    - _Requirements: 8.9, 8.10_

  - [ ]* 11.6 Integration test: from create mode, save a new program and assert `TRAINING_PROGRAMS[id]` is registered with the configured name, totalWeeks, schedule, and at least one exercise per workout
    - _Requirements: 8.9_

  - [ ]* 11.7 Integration test: starting from a fresh builder, open the picker, add 2 exercises via click, edit slot 0 via the form modal, reorder slot 1 to position 0, delete slot 1; assert the final `BUILDER_STATE.workouts[A].exercises` matches the expected array shape and length
    - _Requirements: 2.5, 8.5, 8.6_

- [ ] 12. Reviewer documentation
  - [ ]* 12.1 Create `tests/QA-CHECKLIST.md` with a manual visual/UX validation checklist covering: ≤3 typographic levels, ≤2 blur layers, premium feedback durations, hover lift on desktop, mobile picker toggle behavior, prefers-reduced-motion verification path, ARIA spot-checks, and a regression list for save/edit flows
    - _Requirements: 1.1, 1.4, 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 4.8, 5.7, 7.3, 9.1, 9.2, 9.6, 9.7_

- [x] 13. Final checkpoint - all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Core implementation tasks (no `*`) MUST be implemented.
- The production single-file delivery (`index.html`) is never bundled with anything from `tests/`. The `tests/` folder has its own `package.json` and is ignored by deployment.
- Every property test file MUST start with the comment tag `// Feature: builder-screen-ui-redesign, Property {N}: {Title}` and call `fc.assert(prop, { numRuns: 100 })` (or higher).
- `BUILDER_STATE` is extended additively (`pickerOpen`, `configCollapsed`); existing fields are never renamed or removed, preserving compatibility with `persistCustomProgramFromBuilder` and the rest of the app.
- The Exercise Form modal (`#exercise-edit-modal`) is left untouched; only the picker becomes inline.
- Checkpoints are placed after the structural shell (CSS+DOM) and at the end so the app can be exercised manually between waves of state/render work.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2"] },
    { "id": 4, "tasks": ["2.3"] },
    { "id": 5, "tasks": ["2.4"] },
    { "id": 6, "tasks": ["2.5", "2.6", "2.7", "3.1"] },
    { "id": 7, "tasks": ["3.2"] },
    { "id": 8, "tasks": ["3.3"] },
    { "id": 9, "tasks": ["3.4"] },
    { "id": 10, "tasks": ["3.5"] },
    { "id": 11, "tasks": ["3.6", "5.1"] },
    { "id": 12, "tasks": ["5.2"] },
    { "id": 13, "tasks": ["5.3"] },
    { "id": 14, "tasks": ["5.4"] },
    { "id": 15, "tasks": ["5.5"] },
    { "id": 16, "tasks": ["5.6"] },
    { "id": 17, "tasks": ["5.7", "5.8", "5.9", "5.10", "5.11", "6.1"] },
    { "id": 18, "tasks": ["6.2"] },
    { "id": 19, "tasks": ["6.3"] },
    { "id": 20, "tasks": ["6.4"] },
    { "id": 21, "tasks": ["6.5"] },
    { "id": 22, "tasks": ["6.6"] },
    { "id": 23, "tasks": ["6.7", "6.8", "6.9", "6.10", "6.11", "7.1"] },
    { "id": 24, "tasks": ["7.2"] },
    { "id": 25, "tasks": ["7.3"] },
    { "id": 26, "tasks": ["7.4", "8.1"] },
    { "id": 27, "tasks": ["8.2"] },
    { "id": 28, "tasks": ["8.3", "9.1"] },
    { "id": 29, "tasks": ["9.2"] },
    { "id": 30, "tasks": ["9.3", "10.1"] },
    { "id": 31, "tasks": ["10.2", "10.3", "10.4", "11.1", "11.2", "11.3", "11.4"] },
    { "id": 32, "tasks": ["11.5", "11.6", "11.7"] },
    { "id": 33, "tasks": ["12.1"] }
  ]
}
```
