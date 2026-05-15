# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Next.js dev server at http://localhost:3000
npm run build    # Production build
npm run start    # Run production build
npm run lint     # ESLint (eslint-config-next)
```

> **Note:** The build currently fails with `.next` unlink permission errors on Windows. Linting reports numerous issues (heavy `any` usage, missing hook deps, type gaps).

## Architecture Overview

Creator v2 is a browser-based Lottie animation editor. The major layers are:

### State — Zustand (`lib/creator/state/`)
Single store (`store.ts`) composed of slices:
- `sceneSlice` — scene graph: artboards, shapes, groups, text, images, precomps stored in a flat `nodes: Map<string, SceneNode>`
- `animationSlice` — keyframes, timeline, playback, dotLottie flow blocks
- `selectionSlice` — selected node IDs
- `toolSlice` — active drawing tool
- `stateMachineSlice` — state machine nodes/edges/inputs/interactions
- `historySlice` — undo/redo
- `clipboardSlice` — copy/paste

Additional refs in state: `dotlottieRef.ts` (dotLottie player instance), `playbackRef.ts` (playback timing), `types.ts` (shared store types).

The store type `CreatorStore` also holds compound methods (groupNodes, booleanOperations, alignment, distribution).

### Core Math & Logic (`lib/creator/core/`)
- `SceneNode.ts` — factory functions for every node type
- `Matrix.ts` — world/local transform math, bounding box, decomposition
- `Animation.ts` — keyframe evaluation and interpolation
- `HitTest.ts` — canvas hit testing for selection
- `BooleanOps.ts` — union/subtract/intersect/exclude via `polygon-clipping` + Paper.js
- `SVGImporter.ts` — SVG → internal scene graph
- `Convert.ts` — type/unit conversion utilities
- `EasingPresets.ts` — named easing function presets
- `PathUtils.ts` — path manipulation helpers

### Text System (`lib/creator/text/` and `lib/creator/fonts/`)
Rich text editing support, separate from basic text node rendering:
- `text/GlyphExtractor.ts` — extracts glyph outlines via opentype.js
- `text/TextCursor.ts` — cursor position tracking in text nodes
- `text/TextMeasurer.ts` — measures text dimensions for layout
- `text/wrapLines.ts` — line-wrapping logic
- `fonts/GoogleFontsService.ts` — loads and caches Google Fonts

### Rendering (`lib/creator/render/`)
- `WorkerRenderer.ts` — public renderer API, owns the canvas and worker lifecycle
- `renderWorker.ts` — Web Worker; receives draw commands off the main thread
- `CanvasRenderer.ts` — Canvas 2D drawing implementation

### Lottie I/O (`lib/creator/lottie/`)
- `LottieParser.ts` — Lottie JSON → internal scene graph
- `LottieExporter.ts` — internal scene graph → Lottie JSON (exports as `.json` or `.lottie` zip via jszip)
- `lottieTypes.ts` — TypeScript interfaces for Lottie spec v5.5.0

### Tools (`lib/creator/tools/`)
All tools extend `BaseTool.ts`. Current tools: Rect, Ellipse, Pen, Text, Star.

### UI (`app/components/`)
> Note: components live at `app/components/`, not `app/creator/components/`.

- `Canvas/` — CanvasView (main viewport, event handling), SelectionOverlay, MotionPathOverlay, TextEditOverlay, DotLottiePlayback
- `Inspector/` — property panels (color, gradient, font, effects, KeyframeEasingSection, MiniNumberInput)
- `Layers/` — layer hierarchy panel
- `Layout/` — ResizablePanel and other layout containers
- `Timeline/` — timeline panel, keyframe tracks, BezierCanvas, EasingCurveEditor
- `StateMachine/` — StateNode, EdgeInspector, NodeInspector, InputsPanel, ActionEditor, LayerSelector
- `Toolbar/` — tool buttons, DiscoverLogosModal, SegmentsPanel
- `StatusBar.tsx` — bottom status bar

## Key Data Flows

**Scene edit:** user interaction → tool creates `SceneNode` → stored in `nodes` Map → `WorkerRenderer` re-renders

**Animation:** user adds keyframe in timeline → stored in node's `animations` property → evaluated at `currentTime` during playback

**Export:** scene graph + animations → `LottieExporter` → Lottie JSON → `.json` or `.lottie` (dotLottie zip)

**Import:** drop `.json`/`.lottie` → `LottieParser` → `sceneSlice` hydrated

**Rendering pipeline:** `CanvasView` requests frame → `WorkerRenderer.render()` → postMessage to `renderWorker` → `CanvasRenderer` draws to OffscreenCanvas

**Text editing:** text tool activates `TextEditOverlay` → `TextCursor` tracks position → `TextMeasurer`/`wrapLines` handle layout → `GlyphExtractor` produces outlines for export

## Key Technologies

| Layer | Library |
|---|---|
| Framework | Next.js 16, React 19 |
| State | Zustand 5 |
| Styling | Tailwind CSS 4, Radix UI primitives |
| Vector math | Paper.js 0.12, polygon-clipping |
| Animation playback | lottie-web 5.13 |
| File packaging | jszip 3.10, file-saver |
| Path parsing | svg-path-parser, svgson |
| Font rendering | opentype.js 1.3 |
| Auth | better-auth 1.6, PostgreSQL (pg) |

## Path Alias

`@/*` maps to the repository root (see `tsconfig.json`).

## Repo Housekeeping

The project root contains ~56 ad-hoc analysis/debug scripts (`analyze_*.js`, `check_*.js`, `compare_*.js`, `inspect_*.js`, etc.). These are one-off Lottie file inspection utilities, not part of the production build. They can safely be moved to `test/` or deleted. The `test/` directory currently holds planning docs (design.md, bbox_root_cause_and_fix_plan.md, etc.) but no automated test files.

## Strategic Context

`docs/lottiepro-creator-rebuild-blueprint.md` contains the full architectural blueprint and feature inventory (~1000 lines). Read it before making large structural changes — it documents the intended direction toward a dotlottie-rs / ThorVG WASM runtime.
