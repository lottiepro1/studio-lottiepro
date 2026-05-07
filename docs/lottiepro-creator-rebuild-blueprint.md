# LottiePro Creator Rebuild Blueprint

## Purpose

This document is the rebuild plan for LottiePro Creator if we start again from scratch and deliberately align the runtime and packaging side with the public LottieFiles stack for loading, previewing, and playing Lottie and dotLottie animations.

The goal is not "copy their UI". The goal is:

- match or exceed LottieFiles-level playback smoothness and fidelity
- preserve our editor strengths
- remove architecture choices that create lag, drift, or export mismatches
- build a system that is robust enough to support full editing, state machines, and large animations without shortcuts

---

## Executive Summary

### Short answer

Yes, we should use ThorVG, but not as the whole editor architecture.

We should use:

- a **native/WASM playback engine** centered on **dotlottie-rs**
- **ThorVG** as the underlying vector/Lottie renderer for preview/runtime
- our own **editor document model, commands, UI panels, and authoring workflows**
- strict **import -> canonical model -> runtime snapshot -> export** boundaries

### Most important conclusion

Our current product is already feature-rich, but the rendering and evaluation path is too editor-centric and too JavaScript-heavy. LottieFiles is smoother mainly because their public stack is built around a compiled runtime and renderer, not because of one trick like shape flattening.

Flattening can help in some cases, but it is **not** the main reason LottieFiles plays heavy files smoothly.

### Final recommendation

Build LottiePro Creator v3 around this split:

1. **Authoring model**: our own editor graph, properties, history, selection, timeline, panels.
2. **Runtime model**: a compact playback snapshot generated from the authoring model.
3. **Playback engine**: dotlottie-rs + ThorVG via WASM/worker for preview and QA playback.
4. **Standards layer**: first-class dotLottie v2 packaging, state machines, themes, assets, fonts.

---

## What LottieFiles Publicly Uses

The following points are from official/public primary sources:

- LottieFiles' `dotLottie-web` documentation says the player is powered by `dotlottie-rs`.
- `dotLottieWorker` offloads animation rendering to a dedicated Web Worker.
- `dotlottie-rs` describes itself as the runtime powering all official dotLottie players and says it delivers theming, state machines, multi-animation, and guaranteed visual consistency across platforms.
- The LottieFiles help center says **Lottie Creator is powered by ThorVG** for high-performance rendering in the browser.
- The ThorVG project also says ThorVG powers the canvas engine behind Lottie Creator.
- The dotLottie v2 specification includes packaged animations, images, themes, fonts, and state machines.

### Important inference

Public sources clearly show the official playback/runtime stack and clearly state that Lottie Creator uses ThorVG. They do **not** fully document every private editor implementation detail of Lottie Creator. So when this document says "build like LottieFiles", it means:

- use the same public runtime direction
- design our editor around the same performance principles
- avoid assuming their private editor UI internals are identical to ours

---

## Current Codebase Audit

### Product shape today

The current app is already a serious browser editor, not a toy prototype. It contains:

- a Next.js + React shell
- a Zustand-based editor store
- a custom scene graph
- a custom canvas renderer
- import/export for Lottie JSON and dotLottie
- animation timeline and keyframe tooling
- layers, inspector, segments, and state machine panels
- state machine import/export mapped to dotLottie v2

### Main architecture today

Core areas:

- `app/creator/page.tsx`
- `app/creator/components/Canvas/CanvasView.tsx`
- `app/creator/components/Inspector/InspectorPanel.tsx`
- `app/creator/components/Timeline/TimelinePanel.tsx`
- `app/creator/components/StateMachine/StateMachinePanel.tsx`
- `lib/creator/state/store.ts`
- `lib/creator/state/sceneSlice.ts`
- `lib/creator/state/animationSlice.ts`
- `lib/creator/state/stateMachineSlice.ts`
- `lib/creator/lottie/LottieParser.ts`
- `lib/creator/lottie/LottieExporter.ts`
- `lib/creator/render/CanvasRenderer.ts`
- `lib/creator/render/WorkerRenderer.ts`
- `lib/creator/render/renderWorker.ts`

### Technology choices today

- Next.js 16
- React 19
- Zustand
- JSZip
- file-saver
- `lottie-web` is installed, but preview/edit rendering is mainly done by our own renderer
- `paper`, `svgson`, `svg-path-parser`, `bezier-easing`

### Repository health today

This matters because a rebuild plan must include engineering discipline:

- `npm run lint` currently reports a very large volume of issues, including heavy `any` usage, hook issues, unused variables, and type-safety gaps.
- `npm run build` currently fails in this workspace due to an `.next` unlink permission error.

This means the codebase proves feature direction, but it is **not yet a clean, production-grade foundation for a zero-regression rebuild**.

---

## Full Current Feature Inventory

This section is the "everything we currently have" inventory that the rebuild must account for.

### 1. Workspace shell and layout

- central canvas viewport
- left toolbar
- layers panel
- inspector panel
- timeline panel
- status bar
- segments panel
- state machine panel
- inputs/interactions panel
- resizable side panels
- resizable timeline area
- mode switching between animation editing and state-flow editing

### 2. Authoring tools

Visible tools in the toolbar today:

- Select
- Rectangle
- Ellipse
- Pen
- Text
- Image/SVG asset import
- Discover brand logos
- Segments panel toggle

Supported in the codebase even if not fully exposed in the toolbar:

- Star / polystar handling
- polygon-related tool typing
- move tool typing

### 3. Scene / layer model

Current node families:

- artboard
- rect
- ellipse
- polystar
- path
- group
- text
- image
- precomp

Current layer model supports:

- parent-child hierarchies
- artboards
- nested groups
- nested precomps
- layer parenting
- visibility
- locking
- renaming
- selection
- multi-selection
- drag-reorder
- drag-reparent
- track mattes
- masks
- in/out points
- blending

### 4. Canvas interactions

- select and transform layers
- move
- resize
- rotate
- marquee selection
- path editing
- motion path editing
- gradient handle editing
- inline text editing
- precomp/artboard drill-in
- guide overlays
- selection overlays
- measurement visuals
- zoom and pan
- state-machine interaction hit testing

### 5. Shapes and drawing features

- rectangles with roundness
- ellipses
- bezier paths
- polystar support
- groups
- text
- images
- fills
- strokes
- fill/stroke opacity
- linear gradients
- radial gradients
- dash patterns
- trim paths
- merge/boolean-path style workflows
- blend modes
- track mattes
- masks

### 6. Effects / appearance

Current effects and appearance controls include:

- blur
- drop shadow
- repeater
- offset path
- fill/stroke gradient editing
- gradient stop editing
- gradient handle editing on canvas
- color replacement patterns in grouped selections
- fill visibility
- stroke controls

### 7. Inspector capabilities

- transform editing
- anchor editing and presets
- width/height/radius/roundness editing
- fill controls
- stroke controls
- dash editor
- gradient editor
- effect editor
- blend mode controls
- matte assignment
- artboard size / background / fps / duration
- keyframe easing controls
- numeric scrubbing
- multi-select common value editing
- timing editing

### 8. Layers panel capabilities

- hierarchical tree
- expand/collapse
- rename
- visibility toggle
- lock toggle
- drag/drop reorder
- drag/drop nesting
- precomp entry
- badges for some modes/features

### 9. Timeline capabilities

- play / pause / loop
- current time
- fps and duration handling
- work area
- timeline zoom
- ruler
- layer bars
- property rows
- stopwatch toggles
- keyframes
- keyframe drag/move
- keyframe selection
- keyframe marquee
- easing support
- spatial handles for motion
- property expansion
- show animated properties shortcuts
- work-area shortcuts
- layer trim shortcuts
- layer shifting
- keyframe copy/paste behavior
- segment/marker handling

### 10. Composition / structural operations

- group
- ungroup
- fit group to content
- precompose selection
- align selected nodes
- distribute selected nodes
- boolean operations
- duplicate
- clipboard copy/paste
- artboard switching

### 11. Import pipeline today

- Lottie JSON import
- dotLottie import
- manifest parsing
- dotLottie v1/v2 path handling
- embedded image extraction from zip
- image import
- SVG import
- mapping imported state machines into internal structures
- mapping markers into flow blocks

### 12. Export pipeline today

- export to Lottie JSON
- export to dotLottie package
- asset deduplication for images
- markers / flow block export
- text export
- precomp asset export
- matte export
- mask export
- effect mapping
- gradient export
- dotLottie state machine manifest generation

### 13. State machines today

Current system includes:

- Boolean inputs
- Number inputs
- String inputs
- Trigger inputs
- playback states
- global states
- initial/final concepts
- guards
- edges/transitions
- pointer interactions
- layer-scoped interactions
- actions such as SetInput, FireEvent, OpenURL, Toggle, Increment, Decrement, Reset, SetProgress, SetFrame, SetTheme, FireCustomEvent
- runtime testing inside the editor
- event-driven playback
- loop and playback-mode handling
- dotLottie v2 import/export mapping

### 14. Performance work already present

The codebase is not naive. It already attempts:

- OffscreenCanvas rendering
- worker-based rendering bridge
- delta-based worker messaging
- memoized world matrices
- frame caches
- viewport culling
- some temporal culling
- precomp caching
- batched drawing for simpler cases

This is an important strength: the team already understands the right direction.

---

## Strong Points We Can Reuse

These are real assets, not just "code that exists".

### Product strengths

- the feature surface is already unusually broad for a web Lottie editor
- the team already understands authoring workflows, not just playback
- the app already thinks in artboards, compositions, and nested structures
- dotLottie v2 and state-machine direction is already present
- the editor already has serious timeline and inspector thinking

### Architectural strengths

- Zustand slices give us a recognizable separation of concerns
- the custom scene graph is rich enough to inform a better canonical document model
- import/export knowledge is valuable even if parser/exporter code is rewritten
- the worker-rendering attempt proves the team has already attacked the right bottleneck
- the state machine feature set is strategically strong and aligns with dotLottie v2

### UX strengths

- panels are already organized around professional animation workflows
- many editing affordances already exist
- the feature vocabulary is close to what a full creator needs

---

## What We Should Reuse vs Rewrite

### Reuse mostly as product/design reference

These are worth preserving conceptually, even if implementation changes:

- panel layout and workflow structure
- tool vocabulary
- timeline behaviors and shortcuts
- inspector grouping and editing flows
- state machine editor concepts
- segments / flow block concepts
- artboard and precomp workflow

### Reuse with refactor

These likely have reusable code or at least reusable logic:

- `stateMachineSlice.ts`
- dotLottie v2 mapping logic in `app/creator/page.tsx`
- parts of `LottieExporter.ts`
- parts of `LottieParser.ts`
- scene-node definitions from `sceneSlice.ts`
- boolean/align/distribute/precompose logic from store helpers
- SVG/image import placement logic

### Rewrite cleanly

These should not remain the long-term core if the goal is LottieFiles-level smoothness and fewer errors:

- `CanvasRenderer.ts` as the main runtime/preview renderer
- large parts of `CanvasView.tsx` where editing, hit-testing, rendering concerns, and playback are tightly mixed
- the current render worker architecture as the final runtime path
- the current import path if it directly mutates editor-facing nodes too early
- any code path where UI state and playback state are too coupled

### Keep only as migration scaffolding

- current exporter/importer parity logic
- current custom playback behavior for unsupported or editor-only features
- compatibility shims during transition

---

## Why Heavy Animations Lag in Our Creator

### Main reason

Our current renderer is still fundamentally a **custom TypeScript canvas engine**. Even with workers and caching, it is doing too much of the following at runtime:

- property evaluation in JavaScript
- path construction in JavaScript
- scene traversal in JavaScript
- effect handling in JavaScript
- render orchestration tied to editor structures
- frequent coordination between editor state and playback state

LottieFiles' public path is much more runtime-oriented:

- compiled runtime
- WASM
- worker support
- ThorVG rendering backend
- consistent player logic across platforms

### Why LottieFiles can feel smoother

They likely win because of a combination of:

- compiled runtime execution instead of most evaluation happening in app-level JS
- a dedicated playback engine separated from authoring UI
- better frame stepping and interpolation controls
- worker/off-main-thread rendering path designed as a core product path, not a fallback enhancement
- tighter control over state machines, themes, and animation packaging inside the dotLottie runtime
- rendering via ThorVG instead of our general-purpose custom canvas drawing logic

### Is shape flattening the reason?

Probably not as the primary reason.

Flattening can reduce:

- transform stack complexity
- draw call count
- path combination overhead
- nested-group traversal cost

But flattening is only one optimization lever. If the whole evaluation and rendering architecture remains JS-heavy and editor-coupled, flattening alone will not make large files feel like LottieFiles.

### Real likely bottlenecks in our current system

- runtime uses the same rich scene objects the editor uses
- `CanvasRenderer` is large and responsible for too much
- preview still depends on custom JS property evaluation
- heavy path and style work is rebuilt too often
- the main thread still carries too much UI + state + orchestration work
- imported animations are normalized into our graph before we have a dedicated optimized runtime snapshot
- worker mode reduces thread pressure, but it does not magically turn JS scene evaluation into a native-grade runtime

---

## Should We Use ThorVG?

### Recommendation

Yes, for preview/runtime/rendering.

### Why

ThorVG gives us:

- production-grade Lottie rendering
- strong vector rendering features
- browser/WASM support
- consistency with the public LottieFiles stack
- better chances of matching playback fidelity across platforms
- a renderer already proven in Lottie Creator and dotLottie player contexts

### What ThorVG should not be

ThorVG should **not** become our editor state model, undo/redo system, or panel architecture.

We should not build the whole app as "just send everything directly to ThorVG objects and mutate those forever".

That would create:

- editor complexity leakage into runtime objects
- poor diff/history ergonomics
- harder collaboration/versioning
- harder import/export validation

### Correct role for ThorVG

ThorVG should be:

- the preview renderer
- the QA playback renderer
- the performance reference path
- one of the final export/runtime validation backends

---

## Recommended Rebuild Architecture

## 1. Core principle: separate authoring from playback

We need two models:

- **Authoring Document Model**
- **Runtime Playback Snapshot**

The authoring model is rich, ergonomic, history-friendly, and UI-friendly.

The runtime snapshot is compact, immutable for the current frame range, and optimized for preview playback and export validation.

### Why this separation matters

Without it, we keep paying performance cost for:

- editor metadata during playback
- selection/edit handles mixed with runtime nodes
- property shapes designed for UI rather than runtime
- store churn affecting playback

## 2. Canonical document model

Build a strict canonical document schema with:

- project metadata
- artboards/comps
- layers/nodes
- shapes and paths
- fills/strokes/gradients
- transforms
- masks/mattes
- effects
- text/image assets
- timeline data
- markers/segments
- themes/slots
- interactions/state machines
- editor-only metadata separated from export/runtime data

Rules:

- stable IDs everywhere
- immutable command-based updates
- explicit typing for every animatable property
- no `any` in document boundaries
- no renderer-specific fields in canonical document nodes

## 3. Import subsystem

Build import in stages:

1. **Raw parser**
   - read JSON or dotLottie
   - unpack assets, fonts, themes, state machines, images
2. **Spec-normalizer**
   - normalize Lottie/dotLottie variants into a clean intermediate format
3. **Capability mapper**
   - map imported content into the canonical authoring model
4. **Loss report**
   - if any feature is partially supported, record it explicitly
5. **Validation**
   - compare imported playback against reference runtime

Do not let the parser directly become the editor model.

## 4. Export subsystem

Export should be the mirror image:

1. canonical model
2. runtime/export normalization
3. Lottie JSON generation
4. dotLottie v2 packaging
5. post-export validation against runtime playback

This must include:

- animations
- images
- fonts
- themes
- state machines
- manifest
- markers/segments
- generator metadata

## 5. Playback engine

Primary recommendation:

- use `dotlottie-rs` in web/WASM for preview and packaged playback checks
- use ThorVG-backed rendering through that runtime path where possible

Editor preview should have two modes:

- **Authoring preview**
  - interactive, selection-aware, editable overlays
- **Truth preview**
  - runtime-accurate playback using the final playback engine

If these are not separated, debugging fidelity problems becomes painful.

## 6. Render architecture

Recommended layers:

1. **Editing overlay layer**
   - handles
   - guides
   - motion paths
   - selection visuals
2. **Authoring content preview layer**
   - fast preview of the current editor snapshot
3. **Runtime truth layer**
   - ThorVG/dotlottie-rs playback

The user should be able to switch between authoring and truth preview, and QA should compare both.

## 7. Worker architecture

Workers should be first-class, not optional polish.

Move off the main thread:

- runtime playback
- large import parsing
- diff snapshot generation
- expensive path preprocessing
- comparison/validation runs

Keep on main thread:

- React UI
- pointer interactions
- lightweight selection math
- minimal overlay orchestration

## 8. Timeline architecture

The timeline should operate on typed property tracks, not free-form property strings everywhere.

Track categories:

- transform tracks
- paint tracks
- shape/path tracks
- text tracks
- effect tracks
- timing tracks
- state-machine event tracks if needed

Requirements:

- keyframe schema with typed interpolators
- consistent easing model
- spatial interpolation support
- layer in/out timing
- work area
- segments/markers
- clipboard and transform operations on time selections

## 9. Inspector architecture

The inspector should bind to typed property descriptors, not ad hoc path strings wherever possible.

It should support:

- single-select
- multi-select
- mixed-state values
- per-property animation enablement
- property-level validation
- property metadata for export support

## 10. State machine architecture

State machines should be a first-class subsystem aligned with dotLottie v2:

- typed inputs
- playback states
- global states
- transitions
- guards
- interactions
- actions
- runtime simulation
- export/import schemas

Important rule:

State machine runtime behavior in the editor should be tested against the dotLottie runtime semantics, especially around:

- guard matching
- event consumption
- loop completion
- entry/exit timing
- tween transition behavior

## 11. Theming and slots

Because dotLottie v2 includes themes, the rebuild should include theme support as a core feature, even if the current product only partially exposes it.

We should design:

- theme assets
- theme application by animation or state
- runtime slot overrides
- export-safe color/text/scalar replacement pipelines

## 12. Assets and fonts

We should treat assets as managed package members, not casual attachments:

- images
- fonts
- external references
- embedded resources
- deduplication
- licensing metadata if needed

## 13. Command/history system

A no-shortcuts rebuild needs a formal command model:

- command objects
- undo/redo
- transaction grouping
- patch generation
- deterministic replay

This is safer than letting random store mutations define history.

## 14. Validation system

This is mandatory if "we don't want any errors" is a real requirement.

Validation layers:

- schema validation
- import validation
- export validation
- runtime playback comparison
- visual regression tests
- golden-file tests
- state-machine conformance tests
- large-file stress tests

---

## Smart Build Strategy

This is how we build smartly without cutting corners.

### Principle 1: keep the product shape, replace the weak foundations

Do not throw away the entire UX just because the renderer needs to change.

### Principle 2: build correctness harnesses before large rewrites

Before rewriting import/export/runtime, create:

- test fixtures
- fidelity baselines
- supported-feature matrix
- visual comparison tools

### Principle 3: build for parity, then acceleration

Order matters:

1. correct import/export/runtime parity
2. stable editing model
3. performance optimization
4. advanced polish

### Principle 4: do not use the editor model as the player model

This is one of the main lessons from the current architecture.

### Principle 5: always have a runtime truth source

If the editor preview differs from the runtime truth preview, we need tooling to show exactly where and why.

---

## Phased Rebuild Plan

## Phase 0: Freeze requirements and build the truth matrix

Deliverables:

- full feature matrix from current product
- spec coverage matrix for Lottie + dotLottie v2
- fixture library of simple, medium, and pathological animations
- explicit support levels: full, partial, unsupported, editor-only

Must include:

- shapes
- gradients
- trim paths
- mattes
- masks
- text
- images
- precomps
- markers
- segments
- state machines
- themes
- effects

## Phase 1: Define the canonical document model

Deliverables:

- typed schema
- property taxonomy
- animatable property definitions
- editor-only metadata separation
- versioned document format

Rules:

- every node/property is typed
- every animatable property has explicit interpolation support
- every exportable property has a mapping definition

## Phase 2: Build the import pipeline

Deliverables:

- Lottie JSON importer
- dotLottie v1/v2 importer
- asset unpacker
- theme importer
- state machine importer
- import diagnostics

Output of this phase:

- canonical project document
- import warnings/loss report
- previewable runtime snapshot

## Phase 3: Build the runtime snapshot compiler

Deliverables:

- authoring model -> runtime snapshot transformer
- invalidation rules
- incremental recompilation
- comp/precomp flattening rules where beneficial
- layer visibility/timing resolution

This compiler is where we apply safe optimizations.

## Phase 4: Integrate ThorVG/dotlottie-rs playback

Deliverables:

- runtime playback worker
- truth-preview canvas
- playback controls
- frame stepping
- segment playback
- theme/state-machine runtime hooks

Quality requirement:

- large animations must be benchmarked here before UI polish continues

## Phase 5: Rebuild authoring canvas interactions

Deliverables:

- selection system
- transform controls
- path editing
- text editing
- gradient editing
- overlay rendering

Important:

- overlays should remain separate from runtime rendering
- edit hit-testing should not contaminate runtime playback code

## Phase 6: Rebuild panels around typed bindings

Deliverables:

- layers panel
- inspector panel
- timeline panel
- status bar
- assets panel if needed
- segments/state-machine side panels

Must preserve:

- current professional workflow feel
- multi-select editing
- keyboard shortcuts
- timing operations

## Phase 7: Rebuild composition and structure tools

Deliverables:

- group/ungroup
- align/distribute
- boolean operations
- precompose
- parenting
- artboard management
- asset placement/import positioning

## Phase 8: Rebuild full state machine system

Deliverables:

- visual graph editor
- input management
- transition/guard editor
- interaction binding
- runtime simulation
- import/export conformance tests

## Phase 9: Rebuild exporter and packaging

Deliverables:

- Lottie exporter
- dotLottie v2 packager
- images/fonts/themes/state-machine packaging
- post-export validation pipeline

## Phase 10: Performance hardening

Deliverables:

- large-file benchmarks
- frame-time dashboards
- import latency metrics
- memory metrics
- worker saturation metrics
- fidelity/performance decision logs

Optimizations to evaluate here:

- cached runtime snapshots
- path simplification where safe
- comp flattening where safe
- static subtree prerendering where safe
- off-main-thread import preprocessing
- draw/update separation

## Phase 11: QA and release gating

Release should require:

- zero unsupported regressions in promised features
- green import/export regression suite
- visual diff thresholds met
- state machine conformance suite green
- large animation performance targets met

---

## Reuse Map From Current Codebase

### Highest-value logic to preserve mentally or structurally

- `LottieParser.ts`
  - valuable for feature coverage understanding
  - should be mined for mapping knowledge, not kept as-is blindly
- `LottieExporter.ts`
  - valuable for export edge-case knowledge
  - should be rewritten around a cleaner canonical model
- `stateMachineSlice.ts`
  - strong starting point for concepts and schemas
- `store.ts`
  - useful for operation inventory: align, distribute, group, precompose, boolean ops, matte operations
- `CanvasView.tsx`
  - useful mainly as a UX behavior reference and shortcut map
- `InspectorPanel.tsx`
  - useful as a property surface inventory
- `TimelinePanel.tsx`
  - useful as a workflow and capability inventory

### What we should actively keep as product DNA

- layered editor workflow
- animation + state-flow dual mode
- advanced timeline shortcuts
- flow blocks / segment thinking
- artboards + precomps
- inspector depth
- interaction/state machine ambition

---

## Specific Engineering Decisions

### 1. Use dotLottie v2 as the package-native target

Reason:

- supports animations, themes, state machines, fonts, images
- aligns with the public ecosystem direction
- makes our creator future-safe

### 2. Keep JSON Lottie as an interchange/export format

Reason:

- ecosystem compatibility
- many users still exchange raw JSON

### 3. Build with strict TypeScript boundaries

Reason:

- current lint profile shows the cost of loose typing
- rebuild must reduce silent data-shape errors

### 4. Build a fixture-driven development process

Reason:

- animation tools fail at edges
- correctness without fixtures is guesswork

### 5. Separate unsupported editor-only effects from export-safe effects

Every property/effect must declare:

- preview support
- export support
- runtime support
- import support

No ambiguity.

---

## Performance Plan in Detail

### Targets

We should define targets such as:

- stable playback on large imported animations
- minimal frame-jump under stress
- predictable import time on large `.json` and `.lottie`
- no UI freeze while preview plays

### Required tactics

- compiled playback engine
- worker-first runtime playback
- authoring/runtime model split
- incremental runtime snapshot compilation
- static subtree caching
- asset decode caching
- text layout caching
- geometry/path caching
- explicit invalidation rules

### Optimizations that are useful but secondary

- flattening where safe
- group simplification
- path simplification
- batched draw calls
- reduced overlay redraw

These are valuable, but they are not substitutes for the architecture shift.

---

## Risks and What To Watch

### 1. Renderer mismatch risk

If editor preview and ThorVG truth preview diverge, users will lose trust.

### 2. Import fidelity risk

Lottie edge cases are brutal. Parser correctness must be measured, not assumed.

### 3. State machine semantic drift

Our current internal model is close to dotLottie direction, but timing and event semantics must match the runtime exactly.

### 4. Over-coupling risk

If React/store/editor state keeps driving the playback engine directly, we will reproduce the current performance ceiling.

### 5. "Rewrite everything" risk

The smart move is not deleting all code and starting blind. We should preserve product knowledge while replacing the weak foundations.

---

## What Success Looks Like

If we execute this plan well, the rebuilt LottiePro Creator should:

- import JSON and dotLottie reliably
- preview heavy animations smoothly
- provide a truth-preview path backed by the same runtime principles as LottieFiles
- edit shapes, text, gradients, effects, and timing without export drift
- author and simulate state machines with dotLottie v2 alignment
- export package-complete `.lottie` files with assets, themes, and state machines
- be testable, typed, and maintainable

---

## Recommended Order of Team Work

If multiple people are working in parallel, split by stable ownership:

- **Platform/Schema**
  - canonical document model
  - validation schemas
  - command/history contracts
- **Import/Export**
  - Lottie/dotLottie parsing and generation
  - loss reporting
  - regression fixtures
- **Runtime/Playback**
  - ThorVG/dotlottie-rs integration
  - worker architecture
  - truth preview
- **Editor Canvas**
  - selection, overlays, hit-testing, direct manipulation
- **Panels/UX**
  - layers, inspector, timeline, shortcuts
- **State Machines**
  - graph editor
  - runtime simulator
  - import/export parity
- **QA/Perf**
  - benchmarks
  - visual diffing
  - conformance suite

---

## Non-Negotiable Build Rules

- no feature is called "supported" without import, edit, preview, and export validation
- no performance claims without benchmarks on large fixtures
- no renderer-only hacks in the canonical document model
- no silent lossy import/export
- no `any` across document boundaries
- no coupling of editor overlays with runtime playback core
- no release without truth-preview parity checks

---

## Bottom-Line Recommendation

Rebuild LottiePro Creator around **our own editor model + LottieFiles-style runtime architecture**.

That means:

- keep our editor ambition
- keep our workflow strengths
- keep our state machine and timeline depth
- replace the custom JS-first playback core with a compiled ThorVG-backed runtime path
- treat import/export validation as a product feature

If we do that, we can build something smarter than the current version, not just newer.

---

## Source Notes

### Local code references

- `app/creator/page.tsx`
- `app/creator/components/Canvas/CanvasView.tsx`
- `app/creator/components/Toolbar/Toolbar.tsx`
- `app/creator/components/Inspector/InspectorPanel.tsx`
- `app/creator/components/Timeline/TimelinePanel.tsx`
- `app/creator/components/StateMachine/StateMachinePanel.tsx`
- `lib/creator/lottie/LottieParser.ts`
- `lib/creator/lottie/LottieExporter.ts`
- `lib/creator/render/CanvasRenderer.ts`
- `lib/creator/render/WorkerRenderer.ts`
- `lib/creator/render/renderWorker.ts`
- `lib/creator/state/store.ts`
- `lib/creator/state/toolSlice.ts`
- `lib/creator/state/sceneSlice.ts`
- `lib/creator/state/animationSlice.ts`
- `lib/creator/state/stateMachineSlice.ts`

### External primary sources

- LottieFiles dotLottie Web docs: https://developers.lottiefiles.com/docs/dotlottie-player/dotlottie-web/
- LottieFiles dotLottie Worker docs: https://developers.lottiefiles.com/docs/dotlottie-player/dotlottie-web/worker/
- LottieFiles dotLottie properties docs: https://developers.lottiefiles.com/docs/dotlottie-player/dotlottie-web/properties/
- LottieFiles dotLottie methods docs: https://developers.lottiefiles.com/docs/dotlottie-player/dotlottie-web/methods/
- LottieFiles help center, "What is Lottie Creator?": https://help.lottiefiles.com/hc/en-us/articles/15417977526041-What-is-Lottie-Creator
- dotlottie-rs repository: https://github.com/LottieFiles/dotlottie-rs
- ThorVG repository: https://github.com/thorvg/thorvg
- dotLottie v2 specification: https://dotlottie.io/spec/2.0/
