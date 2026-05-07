# LottieFiles Creator Parity Plan

**Date:** 2026-04-27
**Status:** In progress — Tier 1 bbox fixes + rendering changes done; feature gaps identified

---

## What's Already Solid ✓

- **Trim paths** — fully implemented: parser + renderer + exporter + UI
- **Core shape types** — rect, ellipse, path, star, groups, fills, strokes, gradients, boolean ops, round corners
- **State machines** — nearly complete (minor handler gaps only)
- **Easing curve editor** — interactive bezier editing with presets
- **Blur + drop shadow effects**
- **Precomp nesting** (basic)
- **Lossless round-trip export** for unmodified content
- **ThorVG bbox** — OBB fix done (`thorVGBoxToCSS` now decodes 8-point OBB correctly)
- **ThorVG always visible** — no more renderer flash on drag start/end (Change 4 done)
- **Canvas2D skip imported content** — `skipLottieContent` always active when animation loaded (Change 3 done)

---

## Critical Gaps vs LottieFiles

### 🔴 HIGH — Blocks real-world files

| # | Gap | What's missing | Effort |
|---|---|---|---|
| 1 | **Shape Repeater (`rp`)** | Declared supported in parser but handler never implemented — silently skipped on import | ~2 days |
| 2 | **Text Animators** | No `t.a` support — per-character/word/line animation doesn't exist; range selectors missing entirely | Large sprint |
| 3 | **Expressions** | Detected and warned but never evaluated — animation is static | Very complex (JS sandbox) |

### 🟡 MEDIUM — Visible quality gap

| # | Gap | What's missing | Effort |
|---|---|---|---|
| 4 | **Path point editing** | Can place paths but can't edit individual bezier vertices in the editor | Medium |
| 5 | **Timeline value/motion graph** | No visual graph of how values change over time (curve between keyframes) | Medium |
| 6 | **Advanced effects** | Glow, color overlay, gradient overlay, zigzag, pucker/bloat, twist — all unsupported | Medium |
| 7 | **Precomp time remapping** | No per-instance playback rate / time offset | Small |
| 8 | **State machine handlers** | `SetProgress`/`SetFrame` actions defined but not wired to anything | Small |

---

## Recommended Priority Order

### Phase 1 — Fix silent failures (1 week)
1. **Shape Repeater** — Highest impact/lowest effort. Parser + renderer bug; breaks a large class of real Lottie files silently.
2. **State machine handlers** — ~90% done already. Wire `SetProgress`/`SetFrame` and `OnComplete`/`OnLoopComplete`.

### Phase 2 — Editor usability (2–3 weeks)
3. **Path point editing** — Users can draw paths but can't refine them. Basic editor expectation.
4. **Timeline value/motion graph** — Professional animators need the graph editor to fine-tune curves.

### Phase 3 — Advanced features (1–2 months)
5. **Text animators** — Per-character/word animation. Dedicated sprint required.
6. **Advanced effects** — Glow, zigzag, pucker/bloat, twist, color overlay.
7. **Precomp time remapping** — Per-instance playback rate.

### Phase 4 — Long-term (3+ months)
8. **Expressions** — JS sandbox evaluation. Don't attempt until everything above is done. LottieFiles took years to ship this.

---

## Completed Work (this session)

| Change | File | Description |
|---|---|---|
| Tier 1 / OBB fix | `SelectionOverlay.tsx` | `thorVGBoxToCSS` now decodes 8-point OBB instead of misreading as `[x,y,w,h]` — fixes Layer 24 and all other bbox offsets |
| Tier 1 / Name uniqueness | `LottieParser.ts` | Duplicate layer names get `#1`, `#2` suffixes so ThorVG queries hit the right layer |
| Change 3 / skipLottieContent | `CanvasView.tsx` | Canvas2D skips imported layer content whenever animation is loaded (not just when ThorVG is fresh) |
| Change 4 / freeze ThorVG | `CanvasView.tsx` | ThorVG always visible — freezes at last-loaded frame during drags instead of hiding, eliminating renderer flash |

---

## Key File Pointers

| Area | File | Notes |
|---|---|---|
| Bbox fix | `app/components/Canvas/SelectionOverlay.tsx:39-67` | `thorVGBoxToCSS` — OBB decoder |
| ThorVG always-on | `app/components/Canvas/CanvasView.tsx:2964-2983` | `visible={true}` on DotLottiePlayback |
| skipLottieContent | `app/components/Canvas/CanvasView.tsx:1125-1128` | Always active when rawAnimationSource set |
| Repeater (broken) | `lib/creator/lottie/LottieParser.ts` | `rp` in SUPPORTED set but no handler |
| Text animators (missing) | `lib/creator/lottie/LottieParser.ts` | `t.a` not parsed |
| State machine actions | `lib/creator/state/stateMachineSlice.ts` | `SetProgress`/`SetFrame` empty handlers |
| Shape types | `lib/creator/render/CanvasRenderer.ts` | Missing: zigzag, pucker/bloat, twist, blend |
| Expressions | `lib/creator/lottie/LottieParser.ts` | Detected via `hasExpressions()`, not evaluated |
