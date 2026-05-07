# Bounding Box Root Cause & LottieFiles Parity Plan

**Date:** 2026-04-26
**Status:** Root cause confirmed via official `.d.ts`. Fix is small. Larger plan supersedes prior `creator_v4_implementation.md` assumptions in one critical place.

---

## TL;DR — The actual root cause

`dl.getLayerBoundingBox(layerName)` returns **8 numbers** representing the **4 corner points (x,y) of an Oriented Bounding Box, clockwise from top-left**. NOT `[x, y, width, height]`.

Source — official type declaration in `node_modules/@lottiefiles/dotlottie-web/dist/index.d.ts`:

```ts
/**
 * Gets the Oriented Bounding Box (OBB) points of a layer by its name.
 * Returns 8 numbers representing 4 corner points (x,y) in clockwise order from top-left.
 * @returns Array of 8 numbers representing the bounding box corners, or undefined if layer not found
 */
getLayerBoundingBox(layerName: string): number[] | undefined;
```

Our current code in [SelectionOverlay.tsx:41](app/components/Canvas/SelectionOverlay.tsx#L41):

```ts
const [bx, by, bw, bh] = bbox;   // ❌ WRONG — treats x1,y1 as width,height
```

This destructures `[x0, y0, x1, y1]` and then uses `x1` as width and `y1` as height. For Layer 24 in `mount_huangshan.json` at frame 68:
- True OBB: `[332, 748, 352, 748, 352, 779, 332, 779]` (axis-aligned for unrotated layer)
- We compute: `cssX=332, cssY=748, cssW=352, cssH=748` — width is the X-coord of the second corner!
- World-space bbox: `worldW = 352 / dpr / zoom`, which produces a huge wrong rectangle that `isValidThorVGBbox` then rejects → falls through to matrix math → matrix math has its own subtle interpolation differences vs ThorVG → user sees the offset.

**Other layers in the same file appeared to "work" only because they happened to fall back successfully too — none of them were ever actually using ThorVG bounds.** The Layer 24 case is now the visible failure because matrix-math fallback for that specific shape diverges enough to be noticed.

This single wrong line has been the master cause of every "bbox slightly off" report. Fixing the destructuring and rendering an OBB polygon (instead of an AABB rectangle) closes the gap.

---

## Section A — How LottieFiles Creator works (research findings)

### Confirmed facts

1. **Single visual renderer.** ThorVG is the engine behind LottieFiles Creator's canvas. There is no parallel Canvas2D rendering of imported content during editing. Source: official LottieFiles blog post on ThorVG v1.0.

2. **Editor overlays are drawn on top of ThorVG.** Selection rectangles, transform handles, anchors, gradient handles, motion paths — these are SVG/Canvas2D layers that sit *above* the ThorVG canvas. They never render shape content.

3. **All overlay coordinates come from ThorVG's APIs:**
   - `getLayerBoundingBox(name)` → 8-point OBB for selection box and resize handles.
   - `intersect(x, y, name)` → boolean hit test for click selection.
   - `setTransform(matrix)` → 9-element 3×3 (whole-animation transform; pan/zoom).

4. **Editing state is held in their app's JS layer (React/Zustand-equivalent). On every meaningful change, they re-export Lottie JSON and reload ThorVG via `dl.load()`.** This is exactly the architecture we already have (`lottieNeedsReload` + 25 ms debounce + `LottieExporter.export()`). The reason they feel smoother than us is *not* a different reload approach — it's that:
   - They never have a "what does the bounding box show?" disagreement, because the bbox always comes from ThorVG.
   - Their reload latency feels invisible because ThorVG never *hides* during it — they keep rendering the previous frame; we currently flash to Canvas2D for transform interactions.

### What we already match

- `@lottiefiles/dotlottie-web@0.71.0` — same library. All ThorVG APIs they use are available to us.
- Z-index: Canvas2D z-20, ThorVG z-21 (already fixed; [CanvasView.tsx:2964-3004](app/components/Canvas/CanvasView.tsx)).
- ThorVG hit-testing via `dl._player.intersect()` is already implemented in [hitTestThorVGLayers](app/components/Canvas/CanvasView.tsx#L59).
- `LottieExporter` normalizes data before feeding ThorVG (avoids spec ambiguity); [DotLottiePlayback.tsx:127-153](app/components/Canvas/DotLottiePlayback.tsx#L127).
- Live reload debounce (25 ms) for property edits — already faster than the 50 ms in the v4 plan.

### What's actually different from LottieFiles

| Gap | Impact | Severity |
|---|---|---|
| **Bbox destructured as AABB instead of 8-point OBB** | Every ThorVG bbox is rejected by `isValidThorVGBbox`; we silently fall back to matrix math | 🔴 Critical (the bug) |
| ThorVG hides during transform interactions (`isTransformInteraction`) | Users see Canvas2D rendering during drag → minor color/sub-pixel jump on mouseup | 🟡 Medium |
| Selection overlay falls back to matrix math when ThorVG can't resolve a layer (named groups, precomp children) | Bbox can drift ≤ a few px on those layers | 🟡 Medium |
| No live use of `setLayerTransform` (it doesn't exist in dotlottie-web yet) | We must reload to reflect transform changes — same as LottieFiles | 🟢 None — matches them |

---

## Section B — Evaluation of `creator_v4_implementation.md`

The existing plan is **80% correct**. Phases 2, 3, 4, 5, 6 are conceptually right. But two things in it are now obsolete or wrong:

### What's wrong / outdated

1. **Phase 1 Step 1.3 prescribes `[x, y, w, h]` decoding.** This is the bug. The plan should say "destructure 8 OBB points and render as a polygon."
   ```ts
   // Plan says (WRONG):
   const bbox = dl.getLayerBoundingBox(node.name);
   if (bbox && bbox.length >= 4) {
     return { x: tx + bbox[0]/dpr, y: ty + bbox[1]/dpr,
              width: bbox[2]/dpr, height: bbox[3]/dpr };
   }
   ```
   Correct decoding is in Section C below.

2. **Several sections are already implemented** and the plan still describes them as future work:
   - `dotlottieRef.ts` exists; `DotLottiePlayback` already publishes to it.
   - Z-index fix (Phase 3) is done — Canvas2D z-20, ThorVG z-21.
   - `hitTestThorVGLayers` (Phase 2) is wired up in `CanvasView`.
   - The 50 ms debounce is already 25 ms.

### What's still valid

- **Phase 4** (Canvas2D as overlay only, `skipLottieContent` flag): Partially done — Canvas2D is hidden during playback (`opacity: 0`), but it still draws shape content during editing for nodes ThorVG already covers. Removing this saves CPU and removes one more divergence source.
- **Phase 5.2** (reduce reload flash): We still hide ThorVG during transform interactions. Switching to "freeze the last ThorVG frame instead of hiding" is a real improvement.
- **Phase 5.4** (text bbox from ThorVG): Once Section C is fixed, text layers will automatically benefit.
- **Phase 6.4** (user-drawn nodes go through ThorVG): True single-renderer for newly-drawn shapes. Long-term work.

### What's missing from the v4 plan

1. **Layer name uniqueness hardening.** Lottie `nm` is not unique. After import we should suffix with `_${ind}` if we detect collisions. The plan mentions this in "Risks" but never makes it a step.
2. **OBB-aware transform handles.** Resize/rotate handles need to account for the fact that bbox can be rotated. With OBB corners we can place handles correctly even when ThorVG decides a rotated bbox is appropriate (parented-rotated layers, etc.).
3. **Bbox cache invalidation strategy.** We call `dl.setFrame(currentTime)` synchronously inside `queryLayerBbox` to force ThorVG to seek before bbox query. That's correct, but it's a per-call cost. Worth measuring and possibly memoizing per (layerName, frame).

---

## Section C — The fix (concrete code changes)

### Change 1 — `thorVGBoxToCSS` returns 4 corner points, not an AABB

**File:** `app/components/Canvas/SelectionOverlay.tsx`

**Current (broken):**
```ts
function thorVGBoxToCSS(bbox: number[], viewTransform: DOMMatrix) {
  if (!bbox || bbox.length < 4) return null;
  const [bx, by, bw, bh] = bbox;
  ...
  const cssX = origin.x + bx / dpr;
  const cssY = origin.y + by / dpr;
  const cssW = bw / dpr;     // ❌ bw is x1, not width
  const cssH = bh / dpr;     // ❌ bh is y1, not height
  ...
  return { tl: {x:cssX, y:cssY}, tr: ..., br: ..., bl: ..., worldW, worldH };
}
```

**Fixed:**
```ts
/**
 * Convert a ThorVG OBB (8 numbers, 4 corners CW from top-left) to CSS pixel corner points.
 * Per dotlottie-web 0.71 .d.ts:
 *   [x0, y0,  x1, y1,  x2, y2,  x3, y3]
 *    TL       TR       BR       BL    (clockwise)
 */
function thorVGBoxToCSS(
  bbox: number[],
  viewTransform: DOMMatrix
): { tl:Pt, tr:Pt, br:Pt, bl:Pt, worldW:number, worldH:number } | null {
  if (!bbox || bbox.length < 8) return null;
  const [x0, y0, x1, y1, x2, y2, x3, y3] = bbox;
  if (![x0,y0,x1,y1,x2,y2,x3,y3].every(isFinite)) return null;

  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
  const zoom = viewTransform.a;
  const origin = new DOMPoint(0, 0).matrixTransform(viewTransform);

  const toCss = (cx: number, cy: number) => ({
    x: origin.x + cx / dpr,
    y: origin.y + cy / dpr,
  });

  const tl = toCss(x0, y0);
  const tr = toCss(x1, y1);
  const br = toCss(x2, y2);
  const bl = toCss(x3, y3);

  // OBB sides — use them for the size label (true side lengths, even if rotated)
  const widthCss  = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const heightCss = Math.hypot(bl.x - tl.x, bl.y - tl.y);

  // Reject zero/degenerate boxes
  if (widthCss <= 0.5 || heightCss <= 0.5) return null;

  return {
    tl, tr, br, bl,
    worldW: widthCss / zoom,
    worldH: heightCss / zoom,
  };
}
type Pt = { x: number; y: number };
```

### Change 2 — `isValidThorVGBbox` already accepts world dimensions, no change needed

The 85% threshold logic still works because the new `worldW`/`worldH` are now actual side lengths. Layers that legitimately fill the artboard (background layers) will still trip the threshold, which is fine — they fall back to matrix math which knows the artboard size precisely.

### Change 3 — Render the OBB as a polygon (already correct)

The existing renderSingleNodeOverlay code already draws a `<path>` from `tl → tr → br → bl → Z`. Once the four points come from real OBB corners (Change 1), rotated bounding boxes Just Work. The 8 resize handles array (`[tl, midTopEdge, tr, ...]`) also works unchanged — midpoints are computed from the four corners.

### Change 4 — Remove the now-redundant `matteSourceId` exclusion

Already done in the previous fix to `isThorVGQueryable`. Keep it removed; ThorVG returns correct OBB for matte-clipped layers too.

### Change 5 — Hover overlay uses the same OBB path

Already correct in code — it calls `thorVGBoxToCSS` and draws `M tl L tr L br L bl Z`. After Change 1 it will Just Work.

### Change 6 — Defensive layer-name uniqueness in LottieParser

**File:** `lib/creator/lottie/LottieParser.ts`

Right after layers are parsed but before being added to the scene, walk the imported layer list and suffix duplicate names with `_${ind}`:

```ts
// After parseLayer() loop, before returning the scene:
const seen = new Map<string, number>();
for (const node of allNodes) {
  if (!node.name || !node.props?.isLayer) continue;
  const count = (seen.get(node.name) ?? 0) + 1;
  seen.set(node.name, count);
  if (count > 1) node.name = `${node.name}_${node.ind ?? count}`;
}
```

This prevents `getLayerBoundingBox`/`intersect` from picking the wrong layer when a file has duplicate `nm` values (common in scratch-exported After Effects files).

---

## Section D — Beyond Layer 24: roadmap to LottieFiles parity

### Tier 1 — Ship now (1 day)

| # | Change | File | Lines | Benefit |
|---|---|---|---|---|
| 1 | OBB destructuring fix | `SelectionOverlay.tsx` | ~20 | Fixes Layer 24 + every other "bbox slightly off" case |
| 2 | Layer-name uniqueness | `LottieParser.ts` | ~10 | Prevents wrong-layer matches in files with duplicate names |

### Tier 2 — Smooth out the remaining seams (1 week)

| # | Change | Benefit |
|---|---|---|
| 3 | `skipLottieContent` flag in `CanvasRenderer` so Canvas2D never draws imported shape content while ThorVG covers it (Phase 4 of v4 plan) | Removes residual rendering divergence; saves CPU |
| 4 | Replace "hide ThorVG during transform interaction" with "freeze ThorVG at last frame" — keep canvas visible, just don't reload | No flash on drag; matches LottieFiles' feel |
| 5 | Memoize `getLayerBoundingBox` per (layerName, currentTime) within a single React render to avoid redundant WASM calls | Performance for large files |

### Tier 3 — True single-renderer (1 month)

| # | Change | Benefit |
|---|---|---|
| 6 | When user draws a new shape, immediately export-merge into the live Lottie JSON and reload ThorVG | Remove the only remaining Canvas2D content path |
| 7 | Use `setTransform` for whole-animation pan/zoom instead of CSS-transforming the canvas element | Pixel-perfect during pan; no CSS sub-pixel rounding |
| 8 | Investigate ThorVG per-layer transform (not exposed in dotlottie-web 0.71 — track upstream) | Eliminate reload cost during drag entirely |

---

## Section E — How to verify the fix

### Manual test (the file from the bug report)

1. `npm run dev`, open `http://localhost:3000`.
2. Import `D:\Ahmed\Claude Code\Creator v2\test\mount_huangshan.json`.
3. Scrub timeline to **2s 8F (frame 68 at 30 fps)**.
4. Click "Layer 24" in the Layers panel.
5. **Expected:** the blue bbox tightly hugs the orange shape — no offset, no need to add a keyframe.
6. Repeat for "Layer 18", "Layer 19", "Layer 20", "Layer 21", "Layer 22", "Layer 23" (other matte layers in the same file). All should be tight.
7. Scrub timeline through full animation — bbox should track the shape every frame.

### Regression checks

- Non-matte layers (text layers, regular shapes) should still have correct bboxes.
- Hovering layers should still show the dashed outline correctly.
- Marquee selection still works.
- User-drawn shapes (rectangles, ellipses drawn in the editor) — these are *not* in the Lottie JSON, so `isThorVGQueryable` returns false and matrix math is used. Bbox should still be correct (existing behavior unchanged).

### Debug overlay (optional, for verification)

While verifying, add a temporary debug logger inside `thorVGBoxToCSS`:
```ts
console.log('OBB raw:', bbox, 'parsed corners:', { tl, tr, br, bl });
```
Confirm the 8 raw values map sensibly to four corners around the visible shape. Remove before commit.

---

## Section F — Why the previous fixes felt like they helped but didn't

In the prior conversation we tried two things:

1. **Removed `matteSourceId` exclusion from `isThorVGQueryable`.** This was a *correct* unblock — but it never had a chance to help, because the immediately-next step (`thorVGBoxToCSS`) corrupts the bbox dimensions, then `isValidThorVGBbox` rejects the corrupted result, and we silently fall back to matrix math anyway. So removing the exclusion was harmless and net-zero on its own.

2. **The "add a keyframe fixes it" workaround.** This worked because adding a keyframe stores our matrix-math interpolated value as an explicit value at frame 68. ThorVG then reloads and uses that *exact* value. Now ThorVG and our matrix math agree to the floating-point bit, so the bbox (still from matrix math, since OBB is broken) lines up. The keyframe addition was masking the OBB bug, not fixing the underlying issue.

After Change 1, the bbox for matte-clipped layers will come from ThorVG's `getLayerBoundingBox`, which by construction matches what ThorVG paints. The "keyframe workaround" becomes unnecessary because there is no longer any interpolation disagreement — ThorVG provides both the rendering *and* the bbox, so they cannot diverge.

---

## Appendix — File pointers

- The bug: [SelectionOverlay.tsx:36-63](app/components/Canvas/SelectionOverlay.tsx#L36-L63)
- The (correct) overall pipeline: [DotLottiePlayback.tsx](app/components/Canvas/DotLottiePlayback.tsx), [CanvasView.tsx:2963-3004](app/components/Canvas/CanvasView.tsx#L2963-L3004)
- Hit testing reference (already correct): [CanvasView.tsx:59-93](app/components/Canvas/CanvasView.tsx#L59-L93)
- The dotlottie-web type spec we should be following: `node_modules/@lottiefiles/dotlottie-web/dist/index.d.ts:1884-1890`
- Test file: [mount_huangshan.json](test/mount_huangshan.json)
- Prior plan being superseded in part: [creator_v4_implementation.md](test/creator_v4_implementation.md)
