# Lottie Export Parity Plan
**Goal**: What you design and animate in the editor exports to a Lottie JSON that renders identically in any Lottie player. What you see while editing = what you get after export.

---

## Root Cause Analysis

### 1. The Dual-Pipeline Problem (The Core Issue)

```
Our editor (current):
  Edit → SceneNode → Canvas 2D renderer  → what you see  ← CAN DIVERGE
                   → LottieExporter      → what you export ←

LottieFiles:
  Edit → Lottie JSON model → ThorVG/lottie-web renderer → what you see
                           → serialize JSON              → what you export
                             ↑ ALWAYS IDENTICAL (same data, same renderer)
```

Every feature must be implemented twice in our system: once for Canvas 2D and once for the exporter. Any gap causes export breakage. LottieFiles sidesteps this entirely by using the Lottie JSON itself as the editing model and rendering it directly.

### 2. The Import vs From-Scratch Split

- **Imported files**: The parser stores the original Lottie JSON on each node as `_rawLottieData`. On export, this raw JSON is used as the base and only user-edited properties are overridden. Near-lossless.
- **From-scratch designs**: No `_rawLottieData`. Everything goes through `LottieExporter`. Every bug in the exporter affects from-scratch animations directly.

### 3. Shape Position Bug (Root Cause of Gradient Problem)

**This was the source of the "gradient starts from center" bug.**

In Lottie, the layer transform works as follows:
```
artboard_position = ks.p + (shape_local_point - ks.a)
```
Where `ks.p` = layer world position, `ks.a` = layer anchor in local space.

For a shape's center to land at artboard `ks.p`, its local `p` must equal `ks.a`:
```
artboard = ks.p + (ks.a - ks.a) = ks.p  ✅
```

**Original bug**: The exporter set `rect.p = [transform.x, transform.y]` (world coordinates = same as `ks.p`). This placed the shape center at `ks.p + (ks.p - ks.a)` = DOUBLE-POSITIONED, far off artboard.

**Wrong first fix**: We changed to `rect.p = [0, 0]`. This placed the shape center at `ks.p + (0 - ks.a) = ks.p - ks.a` = top-left of the bounding box, not the center. This made the shape render at the wrong position AND broke the gradient coordinate system.

**Why gradient broke**: With `p = [0, 0]`, local `(0, 0)` in the layer maps to `ks.p - ks.a` (top-left of shape). But gradient start `(0, 0)` also maps to `ks.p - ks.a`... which IS the shape's top-left. Wait — actually the problem was that the local coordinate system changed. With `p = [0,0]`, the rect CENTER was at the wrong artboard position, so gradient local `(0,0)` = rect center in artboard space, not rect top-left. The user saw: "gradient starts from center, ends outside the shape."

**Correct fix** (now applied): `rect.p = [anchorX, anchorY]` where anchor comes from `getAnimatedAnchor(node, nodes)`. This is the same value used for `ks.a`.

```
artboard = ks.p + (anchorXY - ks.a) = ks.p + 0 = ks.p  ✅ rect center at world position
```

With this fix, layer-local coordinate system has:
- `(0, 0)` = top-left of bounding box
- `(anchorX, anchorY)` = shape center = world position
- Gradient stored as `start:(0,0), end:(width, height)` = full top-left → bottom-right ✅
- Canvas 2D and Lottie both interpret the same coordinates the same way ✅

### 4. What LottieFiles Does for Live Preview

LottieFiles does **NOT** use lottie-web as their editor renderer. They use **ThorVG compiled to WASM** (via `@lottiefiles/dotlottie-web`). This package is **already installed in our project** at `node_modules/@lottiefiles/dotlottie-web`.

For live property updates without full JSON reload, ThorVG exposes **slots** — named property handles:
```typescript
dotLottie.setColorSlot('myColor', { r: 1, g: 0, b: 0, a: 1 });  // instant, no reload
dotLottie.setScalarSlot('myOpacity', 0.5);
dotLottie.setVectorSlot('myPosition', { x: 100, y: 200 });
```

For structural changes (add/remove layers), a full reload is needed:
```typescript
dotLottie.load({ data: JSON.stringify(updatedJson), autoplay: false });
dotLottie.setFrame(currentFrame);
```

ThorVG's `load()` is substantially faster than lottie-web's `loadAnimation()` because it uses native WASM instead of JS processing. For a typical 10-layer animation: ~5–15ms vs ~15–60ms for lottie-web.

**How LottieFiles achieves seamless WYSIWYG**: Their editing model IS the Lottie JSON. When the user drags a handle, they mutate the JSON directly. ThorVG re-renders immediately (synchronous WASM call). No "export step" — the data IS the format.

### 5. Why lottie-web Can't Do 60fps Live Editing

`lottie.loadAnimation()` runs in a Web Worker asynchronously: parses layers → builds element tree → fires callback. For 10 layers, this takes **15–60ms total**, making it unsuitable for real-time editing at 60fps. Debouncing to ~200ms is required.

**Mutation + `goToAndStop` trick**: lottie-web stores a reference to the animation data object (doesn't deep-copy). If you mutate `animationData.layers[0].ks.p.k` then call `anim.goToAndStop(frame, true)`, lottie-web MAY pick up the change — but its per-property `_caching` can prevent this. Fragile, undocumented, version-dependent.

---

## Current State of Fixes

| Bug | Status | Details |
|---|---|---|
| Rect/ellipse/polystar double-position | ✅ Fixed | `p = [anchorX, anchorY]` (correct) |
| Gradient starts from wrong position | ✅ Fixed | Consequence of shape position fix |
| Text gradient dropped | ✅ Partially fixed | Uses first stop color as `fc` (spec limitation) |
| Font weight hardcoded "Regular" | ✅ Fixed | `fontWeightToStyle()` + `getFontName()` |
| Text animated fill uses wrong format | ✅ Fixed | Snapshot-per-keyframe in `t.d.k` |
| Gradient default coords not shape-relative | ✅ Fixed (Phase 1) | `createShapeGradient(w,h)` in SceneNode.ts; PaintPopover passes nodeSize; gradient covers full shape on first switch |

---

## Remaining Problems

### A. Gradient Default Coordinates Are Not Shape-Relative
`createDefaultGradient()` returns `start:(0,0), end:(100,100)`. For a 400×200 rect, this covers only the top-left 100×100 area, not the full shape. Users need to manually adjust. Should default to cover the full shape bounds.

### B. No On-Canvas Gradient Handles
Users cannot drag gradient start/end points on the canvas. The GradientPicker only edits color stops. Without handles, users can't control gradient direction precisely.

### C. The Fundamental Architecture Gap
Our Canvas 2D renderer and LottieExporter are two separate systems. Any future feature (new fill type, new effect, new animation property) must be implemented in both. This will continue to produce subtle discrepancies.

---

## Phase-Wise Implementation Plan

---

### Phase 1: Fix Default Gradient to Be Shape-Relative ✅ COMPLETE

**File**: `app/components/Inspector/InspectorPanel.tsx` (or `PaintPopover.tsx`)

When a user switches a shape from solid to gradient fill, the default gradient should cover the full shape bounds. Currently `createDefaultGradient()` returns a fixed `(0,0)→(100,100)` regardless of shape size.

**Fix**: When switching to gradient fill, compute the bounds from the selected node and create a shape-specific default:

```typescript
// In the PaintPopover onChange handler when switching to gradient:
const bounds = getNodeBounds(selectedNode); // props.width, props.height or bounding box
const defaultGrad: Gradient = {
    type: 'linear',
    start: { x: 0, y: 0 },                          // top-left of shape
    end: { x: bounds.width, y: 0 },                  // right edge (horizontal default)
    stops: [
        { offset: 0, color: existingFill || '#FF6B6B', opacity: 1 },
        { offset: 1, color: '#4ECDC4', opacity: 1 }
    ]
};
```

This ensures: top-left `(0, 0)` to top-right `(width, 0)` = horizontal gradient covering the full shape. Both Canvas 2D and Lottie export will show the same gradient.

---

### Phase 2: On-Canvas Gradient Handles ✅ COMPLETE

Users need to drag gradient endpoints directly on the canvas to control direction and coverage. This is how LottieFiles, Figma, and After Effects work.

**Status note**: This was already implemented prior to this plan. `SelectionOverlay.tsx` renders circle handles at `gradient.start`/`gradient.end` connected by a dashed line. `CanvasView.tsx` has `getGradientHandleAtPoint` (10px hit radius), sets `interaction.type = 'edit_gradient'`, and the mouse-move handler converts screen → node-local via inverse world matrix and writes `style.fillGradient`/`style.strokeGradient` to the store. History is recorded on first drag.

**Implementation in `SelectionOverlay.tsx`**:

1. When the selected node has `style.fillType === 'gradient'`, render two draggable handles:
   - Circle: `gradient.start` position
   - Diamond: `gradient.end` position
   - Both in local-space coordinates (same as the gradient data)
   - Transform to screen using the node's world matrix

2. On drag:
   - Convert screen delta to local space (multiply by inverse world matrix)
   - Update `style.fillGradient.start` / `style.fillGradient.end` in the store

3. The coordinates updated match exactly what gets exported to Lottie `s` and `e` — no conversion needed.

4. Add stopwatch support so gradient endpoints can be keyframed.

**Coordinate conversion** (screen → local):
```typescript
const worldMatrix = getWorldMatrix(nodeId, nodes);
const inverseWorld = worldMatrix.inverse();
const localPoint = inverseWorld.transformPoint({ x: screenX, y: screenY });
```

---

### Phase 3: ThorVG Live Preview — True WYSIWYG ✅ COMPLETE

**This is the architecture fix that eliminates the dual-pipeline problem.**

The goal: replace Canvas 2D playback with ThorVG (`@lottiefiles/dotlottie-web`) so the canvas renders the actual Lottie JSON. What you see = what exports.

**Implementation notes (completed):**

`DotLottiePlayback` already existed but was gated behind `rawAnimationSource !== null` (imported-only). The changes made:

1. **`DotLottiePlayback.tsx`**: Removed `!rawAnimationSource` early-return from the init effect. For from-scratch scenes with nodes, uses `LottieExporter.export()` as initial data instead of `rawAnimationSource`. Falls through to deferred init only if nodes map is truly empty (blank scene before first node is added).

2. **`CanvasView.tsx`**: Removed `rawAnimationSource &&` gate around `<DotLottiePlayback>` — it now renders for all scenes. All `rawAnimationSource` conditions replaced with `dotlottieRef.current` (the shared ref that's non-null once ThorVG is initialized). Specifically: Canvas2D render loop skips during `isPlaying` (not just `rawAnimationSource && isPlaying`); hit-testing uses ThorVG for from-scratch nodes too; `skipLottieContent` is `!!(dotlottieRef.current)` for all scenes; selection overlay hidden during playback universally.

3. **`CanvasRenderer.ts`**: Changed the content-skip condition from `node.props?.isLayer === true` (only matched imported nodes) to `node.parentId === this.rootId` (matches ALL direct artboard children — both imported and from-scratch). This prevents double-drawing: Canvas2D now defers all layer content to ThorVG regardless of import origin.

4. **`SelectionOverlay.tsx`**: Removed `rawAnimationSource` Zustand subscription. `thorVGReady` now computed as `!!(dotlottieRef.current && !lottieNeedsReload)` — works for both imported and from-scratch.

**Drag feedback**: During active drag/resize, ThorVG is frozen (25ms debounce) and Canvas2D skips the shape (new skip condition). The SVG selection overlay (handles, bounding box) updates instantly. After 25ms, ThorVG reloads and snaps to the new position. This matches the existing behavior for imported animations — per-spec, per plan.

#### How It Works

```typescript
import { DotLottie } from '@lottiefiles/dotlottie-web';

// On initial load / artboard switch:
const dotLottie = new DotLottie({
    canvas: canvasElement,
    autoplay: false,
    loop: true
});
dotLottie.load({ data: JSON.stringify(exportJson()), autoplay: false });

// On every edit (debounced 150ms):
const debouncedReload = debounce(() => {
    const json = LottieExporter.export(nodes, fps, duration);
    dotLottie.load({ data: JSON.stringify(json), autoplay: isPlaying });
    dotLottie.setFrame(currentFrame);
}, 150);

// On timeline scrub (real-time):
dotLottie.setFrame(currentFrame);
```

#### Why 150ms Debounce Is Acceptable

- Structural edits (drag a handle, type text): 150ms latency to update the Lottie render. Canvas 2D handles remain for interactive editing (selection boxes, handles overlay still uses Canvas 2D).
- The ThorVG canvas shows the accurate Lottie output. The Canvas 2D overlay shows handles/guides only.
- Timeline scrubbing is immediate (just `setFrame(frame)` on the existing loaded animation).

#### Architecture

```
┌─────────────────────────────────────────────────────┐
│  Canvas element (single)                            │
│                                                     │
│  Layer 1: ThorVG/dotlottie-web (Lottie content)     │  ← accurate Lottie render
│  Layer 2: Canvas 2D overlay (handles, selection)    │  ← editor chrome only
└─────────────────────────────────────────────────────┘
```

Two canvases stacked: ThorVG renders the animation, Canvas 2D renders editing chrome (selection boxes, handles, guides, grid). No visual gap — they share the same coordinate system.

#### What This Fixes Permanently

Once ThorVG renders the animation, any discrepancy between "what you see" and "what you export" becomes immediately visible and fixable at the exporter level. No more "looks different after export" surprises because the preview IS the export.

#### Implementation Steps

1. Add `DotLottie` instance to `WorkerRenderer` (or replace it)
2. Replace the `renderWorker.ts` / `CanvasRenderer.ts` animation drawing with ThorVG
3. Keep Canvas 2D overlay for selection handles, motion paths, guides
4. Wire the debounced re-export to fire after any store state change
5. Handle artboard resize (recreate DotLottie canvas)
6. Handle playback controls (`play`, `pause`, `setFrame`)

#### What To Keep in Canvas 2D

- Selection boxes and handles (`SelectionOverlay.tsx`)
- Motion path overlay
- Gradient handles (Phase 2)
- Grid / guides
- Artboard border

Everything else moves to ThorVG.

---

### Phase 4: Lottie-Native Data Model (Long Term — 2–3 months)

The ultimate fix: eliminate the SceneNode → Lottie translation entirely. The editor's internal model becomes Lottie JSON. No export step — just serialize.

This is what LottieFiles does. It means:

- Every edit mutates the Lottie JSON object directly (no SceneNode intermediary)
- ThorVG renders from that object in real-time
- "Export" is just `JSON.stringify(animationData)` — truly lossless

**Migration approach**: Incremental, feature-by-feature. Never break existing functionality. Each step is shippable independently.

**Existing infrastructure to build on** (already in the store):
- `lottieJsonCache` — mutable deep copy of `rawAnimationSource` for imported animations
- `lottieLayerMap` — `nodeId → {layers[], index}` mapping inside `lottieJsonCache`
- `patchLottieNode` — surgically patches transform/visibility for imported nodes only
- `DotLottiePlayback.exportCache` — component-level ref caching `LottieExporter.export()` per `updateCounter`

The plan must extend these rather than create parallel systems.

**Systems that depend on SceneNode/node.animations** (must be accounted for before Steps 4.4–4.6):
- **Timeline & keyframe editor** — reads `node.animations` directly for track display, scrubbing, easing
- **Undo/redo** (`historySlice`) — snapshots only `Map<string, SceneNode>`, not Lottie JSON; undo would silently lose edits if writes go to `lottieModel` but aren't in the snapshot
- **Drawing tools** — `RectTool`, `EllipseTool`, `PenTool`, `StarTool` create `SceneNode` objects; would need to produce Lottie layers
- **Text layers** — the most complex Lottie export path; deserves its own sub-step
- **State machine** — `stateMachineSlice` is coupled to `SceneNode` IDs

---

#### Phase 4 — Corrected Step-by-Step Plan

---

**Step 4.1 — Add `lottieModel` to the store and publish from DotLottiePlayback** ✅ COMPLETE

Add `lottieModel: Record<string, unknown> | null` to `animationSlice`. This is separate from `lottieJsonCache` (which is the surgical-patch cache for imported animations). `lottieModel` is the single source of truth for what ThorVG actually has loaded.

- `DotLottiePlayback` calls `setLottieModel(data)` inside its `load` event handler after ThorVG confirms a successful load. This keeps `lottieModel` always in sync with what ThorVG is actually rendering.
- `setLottieModel(null)` is called in the component cleanup (destroy).
- No behavior change — `DotLottiePlayback` still manages its own export cache and debounce.
- **What this unlocks**: future steps can read `lottieModel` to build indexes and perform surgical patches without needing to call `LottieExporter.export()` again.

```typescript
// animationSlice additions:
lottieModel: Record<string, unknown> | null;   // what ThorVG is currently rendering
setLottieModel: (data: Record<string, unknown> | null) => void;
```

---

**Step 4.2 — Build `lottieNodeMap` for from-scratch scenes** ✅ COMPLETE

When `DotLottiePlayback` publishes `lottieModel`, also build an index: `nodeId → layer object ref` inside `lottieModel.layers`. For imported animations this already exists (`lottieLayerMap` from `buildLottieCache`). For from-scratch, we need to inject `_nodeId` metadata into each exported layer in `LottieExporter.export()`, then index by it when building `lottieModel`.

**Implementation:**

- `LottieExporter.exportArtboardLayers`: in the final cleanup pass, copies `_creatorId` to `_nodeId` on each layer before deleting the internal tracking field. `_nodeId` survives in the exported JSON (Lottie players ignore unknown fields).
- `animationSlice.setLottieModel`: updated to walk `data.layers`, collect every layer where `typeof layer._nodeId === 'string'`, and build `lottieNodeMap: Map<string, Record<string, unknown>>`. Both `lottieModel` and `lottieNodeMap` are set atomically in one `set()` call.
- `lottieNodeMap: Map<string, Record<string, unknown>> | null` added to the interface and initialized to `null`.
- Works for both imported and from-scratch scenes — `LottieExporter.export()` is always the source, so `_nodeId` is present on all layers regardless of origin.
- `lottieNodeMap` is used by all subsequent surgical patch steps (4.3+).

---

**Step 4.3 — Surgical patching for from-scratch node transforms** ✅ COMPLETE

Extend `patchLottieNode` to handle from-scratch nodes (those without `_rawLottieData`) using `lottieNodeMap`. Patch `ks.p`, `ks.r`, `ks.s`, `ks.o` directly on the layer ref in `lottieModel`. Set `lottieNeedsReload = true` and let ThorVG reload from the patched model.

**Implementation:**

- `patchLottieNode` early-return guard changed from `if (!lottieJsonCache || !lottieLayerMap)` to checking either imported cache OR from-scratch model being available (`hasImportedCache || hasFromScratchModel`).
- Added second branch `else if (lottieNodeMap?.has(nodeId))` — from-scratch top-level layer path. Reads the layer ref directly from `lottieNodeMap`, patches `hd`, `ks.p`, `ks.r`, `ks.s`, `ks.o` in-place (same values as the imported node path). Sets `lottieNeedsReload = true`.
- Collapsed old `else` (sub-shape) into `else if (lottieLayerMap)` — it requires the imported cache and is skipped for from-scratch sub-shapes (those aren't separate Lottie layers anyway).
- Both call sites updated: `if (get().lottieJsonCache)` → `if (get().lottieJsonCache || get().lottieNodeMap)` (in `sceneSlice.updateNode` and `animationSlice.setNodeProperties`).

**Architecture note**: `lottieNodeMap` refs point into `lottieModel.layers` objects. Mutating them updates `lottieModel` in-place — no `set()` call needed. ThorVG still reloads via `DotLottiePlayback`'s 25ms `updateCounter` debounce (full `LottieExporter.export()`). Step 4.7 will make that debounce use `lottieModel` directly, at which point these in-place patches will skip the re-export entirely — making move/rotate/scale/opacity edits near-instant.

---

**Step 4.4 — Surgical patching for style properties (fill, stroke)** ✅ COMPLETE

Extend the surgical patch to cover fill color, fill opacity, stroke color, stroke width, stroke opacity. These map to specific shape items inside `layer.shapes[].it[]` in the Lottie layer, which requires walking the shape tree inside the layer.

**Implementation:**

Added directly inside the Phase 4.3 from-scratch branch in `patchLottieNode`, after the `ks` transform patch. A `walkShapes(items)` helper recursively descends into `ty: 'gr'` groups and mutates:
- `fl` (solid fill, `c.a === 0` guard to skip animated): patches `c.k` (RGBA array), `o.k` (fill opacity × 100), `hd` (fill visibility)
- `st` (solid stroke, `c.a === 0` guard): patches `c.k`, `w.k` (stroke width), `o.k` (stroke opacity × 100)

Hex → RGB conversion is inlined (3-line helper) to avoid making `LottieExporter.hexToRgbArray` public.

**Limits (by design):**
- Gradient fill (`gf`) / gradient stroke (`gs`) — not patched; rebuilding the flat number array correctly requires `normalizeGradientSet` + `mapGradient`. The 25ms full re-export handles these.
- Animated fill/stroke (`c.a !== 0`) — skipped; keyframe array format differs from static format. Step 4.5 covers animated properties.
- Structural changes (solid ↔ gradient switch, stroke added/removed) — not patchable without rebuilding `shapes[].it`; fall back to full re-export automatically.

---

**Step 4.5 — Animated properties: dual-write to `node.animations` AND `lottieModel`** ✅ COMPLETE

When the user adds/edits a keyframe, write it to BOTH `node.animations` (for the Timeline UI, undo/redo) AND to the Lottie layer's `ks.p`/`ks.r`/`ks.s`/`ks.o` animated format. ThorVG reloads from the patched `lottieModel`.

**What stays unchanged**: Timeline UI, undo/redo — both still read/write `node.animations`. The dual-write is a shim; `node.animations` remains the source of truth for the editing UI.

**Implementation:**

The key insight: `addKeyframe`/`updateKeyframe` do NOT call `patchLottieNode` — they only write `node.animations` and increment `updateCounter`. The `DotLottiePlayback` 25ms debounce then does a full `LottieExporter.export()` → `setLottieModel(freshData)`, correctly regenerating the animated `ks` from `node.animations`. So `lottieModel` is always eventually correct after keyframe edits.

The actual bug to fix was the **inverse**: when `patchLottieNode` is triggered by OTHER property changes (e.g., fill color edit) on a node that ALREADY has animated keyframes (e.g., position animation), the 4.3 code was blindly overwriting the animated `ks.p` (format: `{ a:1, k:[keyframe array] }`) with a static value (`{ a:0, k:[x,y,0] }`), temporarily corrupting `lottieModel`.

**Fix — animation guards on all patched properties:**

In the from-scratch branch of `patchLottieNode`, before writing each `ks` property, check `node.animations` for existing keyframes:
```typescript
const anim = node.animations ?? {};
const hasPosAnims   = (anim['transform.x']?.length ?? 0) > 0 || (anim['transform.y']?.length ?? 0) > 0;
const hasRotAnims   = (anim['transform.rotation']?.length ?? 0) > 0;
const hasScaleAnims = (anim['transform.scaleX']?.length ?? 0) > 0 || (anim['transform.scaleY']?.length ?? 0) > 0;
const hasOpacAnims  = (anim['style.opacity']?.length ?? 0) > 0;

if (!hasPosAnims)   ks.p = { a: 0, k: [...] };
if (!hasRotAnims)   ks.r = { a: 0, k: ... };
if (!hasScaleAnims) ks.s = { a: 0, k: [...] };
if (!hasOpacAnims)  ks.o = { a: 0, k: ... };
```

Same guards added to fill/stroke patching (4.4 path):
```typescript
const hasFillAnims   = (anim['style.fill']?.length ?? 0) > 0;
const hasStrokeAnims = (anim['style.stroke']?.length ?? 0) > 0 || (anim['style.strokeWidth']?.length ?? 0) > 0;
// fl patch only runs if !hasFillAnims; st patch only runs if !hasStrokeAnims
```

**Result:** Animated properties in `lottieModel` are never overwritten by surgical patches. The 25ms re-export corrects `lottieModel` after each keyframe change. Step 4.7 (which will use `lottieModel` directly) is now safe for animated nodes.

---

**Step 4.6 — Shape geometry surgical patching** ✅ COMPLETE

When rect/ellipse/polystar props change (width, height, radius, roundness), patch the Lottie shape primitive directly and update `ks.a` (anchor) to match.

**Implementation:**

All changes are in the from-scratch branch of `patchLottieNode` in `animationSlice.ts`.

**Import**: Added `getAnimatedAnchor` to the existing `Matrix.ts` import.

**Animation guards** (added alongside Phase 4.5 guards):
- `hasAnchorAnims`, `hasWidthAnims`, `hasHeightAnims`, `hasRxAnims`, `hasRyAnims`, `hasRoundAnims`, `hasPtAnims`, `hasOrAnims`, `hasIrAnims`

**`ks.a` patch** (anchor — was missing from 4.3):
- Computed once: `const anchor = geomUnanimated ? getAnimatedAnchor(node, state.nodes) : null`
- `geomUnanimated` = no anchor or size animations
- If anchor is available: `ks.a = { a: 0, k: [anchor.x, anchor.y, 0] }`
- This is critical: anchor must always match the shape's local center for correct ThorVG positioning after resize

**`walkGeom` shape-primitive walk** (added after the existing `walkShapes` style walk, same `shapes` block):
- `rc` (rect): patches `s` (size `[w, h]`), `r` (roundness, deleted if 0), `p` (local center = anchor)
- `el` (ellipse): patches `s` (`[rx*2, ry*2]`), `p` (local center = anchor)
- `sr` (polystar): patches `pt` (points), `or` (outer radius), `ir` (inner radius), `p` (local center = anchor)
- `sh` (path/pen): skipped — bezier serialisation requires `LottieExporter`; falls back to the 25ms re-export
- For `p` (local center): if anchor is `[0,0]`, `p` is deleted (matching exporter behaviour); otherwise created or updated in-place even if it didn't previously exist

**All geometry guards respect the same 4.5 principle**: if a property has keyframes, its corresponding shape field is left untouched to preserve the animated format in `lottieModel`.

---

**Step 4.7 — Replace DotLottiePlayback export with lottieModel (eliminate LottieExporter from the hot path)** ✅ COMPLETE

Make `DotLottiePlayback` use `lottieModel` directly for property-only edits (where surgical patches kept it current), only falling back to `LottieExporter.export()` on structural changes.

**Implementation:**

**`animationSlice.ts`** — Added `structureChangeCounter: number` (initial `0`) to interface and state. No setter needed — structural actions increment it via their own `set()` calls.

**`sceneSlice.ts`** — Added `structureChangeCounter: state.structureChangeCounter + 1` to the `set()` return of: `addNode`, `addNodesBatch`, `deleteNode`, `moveNode`.

**`store.ts`** — Added `structureChangeCounter: state.structureChangeCounter + 1` to the `set()` calls in `groupNodes` and `ungroupNodes` (these do direct `set()` calls, not via slice actions).

**`DotLottiePlayback.tsx`** — Four changes:
1. Added `structureChangeCounter` Zustand subscription
2. Added `lastStructureCounter` ref (initial `-1` — means no full load yet)
3. In the init `load` event handler: `lastStructureCounter.current = state.structureChangeCounter` — initialised after first load so the fast path is available immediately for subsequent property edits
4. Debounced `updateCounter` effect — new two-path logic:
   - **Fast path** (`structureChangeCounter === lastStructureCounter.current && lottieModel !== null && lastLoadedCounter >= 0`): seeds `exportCache` with `lottieModel`, then calls `dlCurrent.load({ data: lottieModel })` — zero `LottieExporter` cost
   - **Slow path** (structural change or first load): updates `lastStructureCounter.current = currentStructureCounter`, then calls `getExportedData(currentCounter)` (full re-export) as before

**Effect dependency** updated: `[updateCounter, structureChangeCounter]` — ensures the effect fires on both property and structural changes.

**Result**: Move/resize/recolor a from-scratch shape → `patchLottieNode` updates `lottieModel` in-place → 25ms later ThorVG reloads from `lottieModel` directly. `LottieExporter.export()` is only called when nodes are added, deleted, moved, grouped, or ungrouped.

---

**Bug Fix (between 4.7 and 4.8) — From-scratch shapes invisible after Phase 4 changes** ✅ COMPLETE

Root cause: Phase 4.3 made ThorVG initialize for from-scratch scenes (with empty layers). This set `sharedDotlottieRef.current` immediately, causing `skipLottieContent = true` in Canvas2D for ALL direct artboard children — including newly drawn from-scratch shapes not yet in `lottieModel`. Canvas2D skipped them, ThorVG hadn't reloaded with them yet → both renderers skipped → shape invisible.

Fix: `CanvasRenderer.ts` skip condition now checks `_rawLottieData` — only IMPORTED nodes are skipped in Canvas2D. From-scratch nodes (no `_rawLottieData`) are always rendered by Canvas2D. Since ThorVG and Canvas2D produce identical output for from-scratch shapes, the overlap is harmless.

```typescript
// Before:
if (this.skipLottieContent && node.parentId === this.rootId) { return; }

// After:
if (this.skipLottieContent && node.parentId === this.rootId && (node as any)._rawLottieData) { return; }
```

Also fixed `animationSlice.ts setNodeProperties` call site (matching the sceneSlice.ts guard fix):
- `if (get().lottieJsonCache || get().lottieNodeMap)` → `if (get().lottieJsonCache || get().lottieNodeMap?.has(nodeId))`

---

**Step 4.8 — Undo/redo migration** ✅ COMPLETE

Update `historySlice` to snapshot `lottieModel` alongside `nodes`. Undo/redo restores both. This is needed before removing `LottieExporter` entirely, because without it, undo of a surgical patch can't reconstruct the Lottie state.

**Implementation:**

- `HistorySnapshot` interface: added `lottieModel?: Record<string, unknown> | null`
- `pushToHistory`: captures `get().lottieModel` in the snapshot
- `undo` and `redo`: restore `lottieModel: snapshot.lottieModel ?? null` and increment `structureChangeCounter` (to force the slow path in DotLottiePlayback — full re-export after every undo/redo, guaranteeing correctness even if the snapshot lottieModel is slightly stale)
- `lottieNodeMap` is rebuilt automatically by `setLottieModel` in the ThorVG load event handler

---

**Step 4.9 — Delete LottieExporter (long term)**

Once `lottieModel` is always current (structural changes also go through direct Lottie mutation), `LottieExporter.export()` becomes `() => state.lottieModel`. At that point: remove the exporter, simplify the store, and `SceneNode` becomes a display-tree metadata node only.

---

**What NOT to attempt before Step 4.5**: migrating Timeline's read path off `node.animations`. The Timeline depends on `node.animations` format for track display, keyframe position rendering, and easing UI. Only migrate the write path first (dual-write shim); the read path comes after the dual-write is validated.

**What NOT to attempt before Step 4.8**: removing `LottieExporter`. Undo/redo without `lottieModel` snapshots would silently corrupt state.

---

### Phase 5: Gradient Stop Count Validation ✅ COMPLETE

Guard against animated gradients where keyframes have different stop counts. The Lottie spec requires all keyframes of a gradient to have the same number of color stops (because `g.p` is set once).

**Fix in LottieExporter.ts** (implemented):

Two bugs fixed by `normalizeGradientSet()`:

1. **Stop count mismatch**: `g.p` was `grad.stops.length` (the static gradient) but keyframes could have different counts. Now uses `max(base, all keyframe counts)` as the canonical count. Gradients with fewer stops are expanded by sampling the gradient at evenly-distributed offsets (linear interpolation between nearest stops).

2. **Alpha stop length mismatch**: `mapGradient` computed `hasAlpha` per-keyframe. If keyframe A was fully opaque (flat array: 4×n) and keyframe B had a semi-transparent stop (6×n), the arrays had different lengths. Now `hasAlpha` is computed as a union across all gradients (base + all keyframes) and passed as `forceAlpha` to every `mapGradient` call for the animated set — all keyframes always produce arrays of the same length.

Both fill gradient (`gf`) and stroke gradient (`gs`) paths are fixed.

---

## Priority Order

| Priority | Phase | Task | Effort | What It Fixes |
|---|---|---|---|---|
| 🔴 P0 | Done | Shape position + gradient position | Done | Rect visible, gradient correct position |
| 🔴 P0 | 1 | Gradient default covers full shape | 1 day | Default gradient works correctly |
| 🟡 P1 | 2 ✅ | On-canvas gradient handles | Done | Precise gradient direction control |
| 🔴 P0 | 3 ✅ | ThorVG live preview (debounced) | Done | **True WYSIWYG — permanent fix** |
| 🟢 P2 | 5 ✅ | Gradient stop count guard | Done | Animated gradient stability |
| ⚪ P3 | 4 | Lottie-native data model | 2–3 months | Clean architecture, no translation |

---

## Verification Steps After Each Phase

**After Phase 1 (gradient defaults)**:
1. Create a new rect, switch to gradient fill
2. Gradient should visually cover the full width of the rect (horizontal)
3. Export → reimport → gradient still covers full width ✅

**After Shape Position Fix (current)**:
1. Create a rect at artboard position (200, 300), size 400×200
2. Switch to gradient fill (top-left to bottom-right)
3. Export → open exported JSON in text editor
4. Verify `s = [0, 0]` (top-left) and `e ≈ [400, 200]` (bottom-right) or similar anchor-relative values
5. Reimport → gradient should appear identical ✅

**After Phase 3 (ThorVG)**:
1. Design any animation from scratch
2. The canvas preview (ThorVG) shows exactly the exported result
3. Export JSON and open in LottieFiles player → visually identical ✅

---

## Key Technical Facts

- `@lottiefiles/dotlottie-web` is **already installed** in this project
- ThorVG `load()` takes ~5–15ms for typical animations (fast enough with 150ms debounce)
- lottie-web `loadAnimation()` takes ~15–60ms + is async (not suitable for live editing)
- Gradient `s`/`e` in Lottie = layer-local pixel coordinates (same space as Canvas 2D after `setTransform(worldMatrix)`)
- Gradient `g.p` = number of COLOR stops only (not alpha stops) — critical for correct parsing
- Text `fc` in Lottie = plain RGB array, no native gradient support in spec
- `fStyle` in font list must use recognized keywords: "Thin", "Light", "Regular", "Medium", "Bold", "ExtraBold", "Black" (no spaces)

---

## Post-Implementation Polish & Bug Fixes (May 2026)

The following critical synchronization and rendering issues were resolved to ensure the Phase 3/4 architecture works seamlessly in real-world usage:

### 1. Visibility Synchronization (Structure Counters) ✅ FIXED
**Issue**: Newly duplicated or pasted shapes were invisible until an undo/redo cycle.
**Root Cause**: Functions like `duplicateSelection` and `pasteSelection` were updating the store nodes but not incrementing `structureChangeCounter`. ThorVG's fast-path reload was skipping the re-export of the new layer structure.
**Fix**: Added `structureChangeCounter` increments to all structural operations, including:
- `duplicateSelection` & `pasteSelection`
- `addNodeToArtboard` (New Shape tool)
- `applyBooleanOperation`
- `precompose`
- `setMatte` (Track Matte assignment)

### 2. Imported Layer "Snap-back" (Dual-Cache Sync) ✅ FIXED
**Issue**: Moving or editing an imported JSON layer would visually "snap back" to its original position upon mouse release, only updating after an undo/redo.
**Root Cause**: `patchLottieNode` was correctly patching the `lottieJsonCache` (used for full exports), but `DotLottiePlayback` reloads from `lottieModel` on the fast path. These two caches diverged for imported layers.
**Fix**: Updated `patchLottieNode` to mirror all surgical patches from `lottieLayerMap` (imported cache) to `lottieNodeMap` (active rendering model) simultaneously.

### 3. Instant Path Point Updates ✅ FIXED
**Issue**: Editing individual anchor points on a path (Pen Tool) was slow and suffered from the snap-back issue because `patchLottieNode` previously skipped bezier serialization.
**Fix**: Implemented native `sh` (shape path) serialization within `patchLottieNode`. Path point drags now trigger instant, surgically-patched updates in ThorVG without requiring a slow structural re-export.

### 4. Immer & Selection Safety ✅ FIXED
**Issue**: "Cannot assign to read only property" crashes after undo/redo; inaccurate bounding box selection for duplicate-named layers.
**Fixes**:
- **Immer**: Implemented deep-cloning of the Lottie model on load and added `Object.isFrozen()` guards to all `patchLottieNode` branches to ensure mutable clones are generated when needed.
- **Selection**: Added a name-uniqueness guard in `SelectionOverlay.tsx` and `CanvasView.tsx` to skip ThorVG name-based bounding box queries when sibling layers share the same default name, falling back to reliable matrix-based calculations.
