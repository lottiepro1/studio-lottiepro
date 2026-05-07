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

The store type `CreatorStore` also holds compound methods (groupNodes, booleanOperations, alignment, distribution).

### Core Math & Logic (`lib/creator/core/`)
- `SceneNode.ts` — factory functions for every node type
- `Matrix.ts` — world/local transform math, bounding box, decomposition
- `Animation.ts` — keyframe evaluation and interpolation
- `HitTest.ts` — canvas hit testing for selection
- `BooleanOps.ts` — union/subtract/intersect/exclude via `polygon-clipping` + Paper.js
- `SVGImporter.ts` — SVG → internal scene graph

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

### UI (`app/creator/components/`)
- `Canvas/` — CanvasView (main viewport, event handling), SelectionOverlay, MotionPathOverlay
- `Inspector/` — property panels (color, gradient, font, effects, keyframe easing)
- `Layers/` — layer hierarchy panel
- `Timeline/` — timeline panel, keyframe tracks, easing curve editor
- `StateMachine/` — state machine editor (nodes, edges, inputs, actions)
- `Toolbar/` — tool buttons

## Key Data Flows

**Scene edit:** user interaction → tool creates `SceneNode` → stored in `nodes` Map → `WorkerRenderer` re-renders

**Animation:** user adds keyframe in timeline → stored in node's `animations` property → evaluated at `currentTime` during playback

**Export:** scene graph + animations → `LottieExporter` → Lottie JSON → `.json` or `.lottie` (dotLottie zip)

**Import:** drop `.json`/`.lottie` → `LottieParser` → `sceneSlice` hydrated

**Rendering pipeline:** `CanvasView` requests frame → `WorkerRenderer.render()` → postMessage to `renderWorker` → `CanvasRenderer` draws to OffscreenCanvas

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

## Path Alias

`@/*` maps to the repository root (see `tsconfig.json`).

## Strategic Context

`docs/lottiepro-creator-rebuild-blueprint.md` contains the full architectural blueprint and feature inventory (~1000 lines). Read it before making large structural changes — it documents the intended direction toward a dotlottie-rs / ThorVG WASM runtime.
