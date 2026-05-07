# Text Feature: Full Analysis, Research & Implementation Plan

> **Created:** 2026-04-29  
> **Status:** Reference document — update as phases complete  
> **Scope:** Covers everything from current bug root causes to the full phased rebuild plan, including all research findings on LottieFiles, Google Fonts API, glyph export, CJK support, and variable fonts.

---

## Table of Contents

1. [Current Implementation — How It Works](#1-current-implementation--how-it-works)
2. [Current Bugs — Root Cause Analysis](#2-current-bugs--root-cause-analysis)
3. [How LottieFiles Does It](#3-how-lottiefiles-does-it)
4. [Research Findings](#4-research-findings)
   - 4a. Google Fonts API — Key vs No Key
   - 4b. Glyph Export / Font Embedding
   - 4c. CJK Text Input
   - 4d. Variable Fonts
5. [Decisions Made](#5-decisions-made)
6. [Phased Implementation Plan](#6-phased-implementation-plan)
   - Phase 1 — Bug Fixes
   - Phase 2 — Google Fonts API Integration
   - Phase 3 — Canvas-Native Text Editing (kills the size jump)
   - Phase 4 — Area Text & Word Wrap
   - Phase 5 — Glyph Export
   - Phase 6 — Rich Inspector, Variable Fonts & CJK
7. [Tech Stack Reference](#7-tech-stack-reference)
8. [Open Questions / Parking Lot](#8-open-questions--parking-lot)

---

## 1. Current Implementation — How It Works

### Text Node Structure

Text nodes are created via `createTextNode()` in `lib/creator/core/SceneNode.ts` and stored in the Zustand `sceneSlice`. Properties:

```
node.props.text           — string content
node.props.fontSize       — number (pixels, e.g. 24)
node.props.fontFamily     — string (e.g. "Inter")
node.props.fontWeight     — string (e.g. "400")
node.props.letterSpacing  — number (pixels)
node.props.lineHeight     — number (multiplier, e.g. 1.2)
node.props.textAlign      — "left" | "center" | "right"
node.props.verticalAlign  — "top" | "middle" | "bottom" | "baseline"
node.style.fill           — hex color string
```

### Rendering Pipeline

`CanvasRenderer.ts` → `renderText()` → Canvas 2D `fillText()` / `strokeText()`

Font string built as: `` `${fontWeight} ${fontSize}px "${fontFamily}", sans-serif` ``

Text baseline set to `'top'` for non-baseline alignment, `'alphabetic'` for baseline.

### Editing Lifecycle

1. **Create:** Text tool click → `createTextNode(x, y)` → auto-enters edit mode
2. **Double-click existing:** `handleDoubleClick` → `setTextEditingId(nodeId)`
3. **Edit mode UI:** An HTML `<textarea>` is absolutely positioned and overlaid on top of the canvas at the node's world-matrix position
4. **Typing:** Keystroke → `updateNode()` called live → node.props.text updated → canvas re-renders
5. **Exit:** `Enter` key (no Shift) or `onBlur` → `setTextEditingId(null)` → textarea unmounts → canvas takes over rendering

### Font Loading

- **Source:** 44 fonts hardcoded in `FontPicker.tsx`
- **Load trigger:** All 44 fonts loaded at once when FontPicker dropdown is opened
- **CSS URL used:** `https://fonts.googleapis.com/css2?family=X:wght@400;700&display=swap`
- **Weights loaded:** Only 400 and 700 — all other weights fall back silently

### Lottie I/O

- **Parser** (`LottieParser.ts`): `layer.ty === 5` → reads `t.d.k[0].s` → hydrates text props
- **Exporter** (`LottieExporter.ts`): `layer.ty = 5` → writes `t.d.k[0].s` with `s` (size), `f` (family), `t` (text), `j` (align), `tr` (tracking), `lh` (line height in px), `fc` (RGB fill)
- **Font list** exported in `animation.fonts.list[]` with name, family, style metadata

### Font Sources in Lottie JSON

```json
"fonts": {
  "list": [
    {
      "fName": "Inter-Regular",
      "fFamily": "Inter",
      "fStyle": "Regular",
      "fWeight": "400",
      "ascent": 0
    }
  ]
}
```

---

## 2. Current Bugs — Root Cause Analysis

### Bug #1 — Text "jumps small" on Enter, then "jumps big" on double-click (CRITICAL)

**File:** `app/creator/components/Canvas/CanvasView.tsx` (edit mode textarea block, ~line 3157–3253)

**Root cause:** Dual-renderer mismatch.

When in edit mode, a `<textarea>` renders the text using the **browser's CSS font engine**. When you press Enter, the textarea unmounts and **Canvas 2D `fillText()`** takes over — a completely different renderer with different font metrics, baseline origin, and anti-aliasing. These two renderers do not produce identical visual output for the same font/size, so the text appears to jump.

Specifically:
- The canvas uses `textBaseline: 'top'` but applies a `baselineShift = fontSize * 0.82` hack for baseline-aligned text (hardcoded heuristic, line 3178)
- The textarea uses CSS `line-height` which does not exactly match the canvas multiplier calculation
- Any sub-pixel difference in position or sizing becomes visible as a jump

**Proper fix:** Replace the textarea overlay with canvas-native text editing (Phase 3).  
**Partial fix (Phase 1):** Align textarea CSS to match canvas rendering as closely as possible.

### Bug #2 — Letter spacing wrong at non-100% zoom

**File:** `app/creator/components/Canvas/CanvasView.tsx`, line ~3221

**Current code:**
```js
letterSpacing: `${(node.props.letterSpacing || 0) * viewport.zoom}px`
```

**Problem:** The textarea is positioned and scaled using the viewport's world transform — zoom is already baked into the element's visual scale. Multiplying letter spacing by zoom double-applies the scale, making letter spacing appear too wide or too narrow at any zoom other than 100%.

**Fix:**
```js
letterSpacing: `${node.props.letterSpacing || 0}px`
```

### Bug #3 — Font weights 100, 300, 500, 600, 900 don't actually load

**File:** `app/creator/components/Inspector/FontPicker.tsx`, line ~34–55

The CSS URL only loads `wght@400;700`. If the user selects weight 300, the browser silently falls back to 400. The canvas and textarea both show the wrong weight.

**Fix:** Load all 9 weights (`100;200;300;400;500;600;700;800;900`) in the CSS request.

### Bug #4 — Only 44 fonts available

**File:** `app/creator/components/Inspector/FontPicker.tsx`, line ~6–17

Static hardcoded array. No search, no categories, no new fonts, no variable fonts.

**Fix:** Phase 2 — Google Fonts API integration.

### Bug #5 — Escape key does not revert text changes

**File:** `app/creator/components/Canvas/CanvasView.tsx`, line ~3247

`Escape` calls `setTextEditingId(null)` but does NOT restore the original text. Changes are permanent even if the user pressed Escape intending to cancel.

**Fix:** Save original text on edit entry, restore on Escape.

### Bug #6 — Area text (text box with bounds) not editable in UI

Area text width/height are parsed from Lottie JSON and stored in `node.props.width` / `node.props.height` but there are no inspector controls. You can import area text from a Lottie file but cannot create or resize it in the editor.

**Fix:** Phase 4.

---

## 3. How LottieFiles Does It

| Dimension | LottieFiles Creator | Our Current State |
|---|---|---|
| Font source | Google Fonts API (1,500+ families) + Adobe Typekit + custom URL | 44 hardcoded families |
| Font loading | Per-font, on-demand, correct weight variants | All 44 at once, wght@400;700 only |
| Text rendering | ThorVG (C++/WASM, native TTF metrics) | Canvas 2D fillText (browser CSS metrics) |
| Edit mode | Canvas-native (no overlay) | HTML textarea overlay → causes size jump |
| Text types | Point text + area text with word wrap | Point text only (area text not editable) |
| Character animation | Per-character range selectors with keyframes | None |
| Runtime text updates | Motion Tokens / Slots API | None |
| Font export | Font name references in dotLottie | Font name references in Lottie JSON |
| Glyph export | Via Bodymovin plugin (glyph checkbox) | Not supported |
| Variable fonts | Not documented; likely not supported | Not supported |
| CJK text input | Not documented; likely not supported | Not supported |

**Key insight:** LottieFiles' text editing feels smooth because they do not use an HTML overlay. The text you see while typing IS the canvas render. No dual-renderer — no jump.

**ThorVG** (their rendering engine) uses native TTF font metrics, meaning font baselines, kerning, and line height are computed from actual font files — not approximated with heuristics like `fontSize * 0.82`.

---

## 4. Research Findings

### 4a. Google Fonts API — Key vs No Key

**Two separate Google APIs exist:**

| API | URL | Key Required | Returns |
|---|---|---|---|
| CSS API v2 | `https://fonts.googleapis.com/css2` | No | CSS stylesheet to embed fonts |
| Developer REST API | `https://www.googleapis.com/webfonts/v1/webfonts` | Yes | JSON metadata: all families, variants, axes, file URLs |

**What the CSS-only approach can't do:**
- Cannot enumerate all 1,500+ fonts programmatically
- Cannot search or filter by category, language, or popularity
- Cannot get variable font axis metadata
- Cannot get TTF/OTF download URLs for glyph extraction

**What the REST API adds:**
- Full font catalogue as JSON
- Variant/weight list per font (`["100", "100italic", "300", "400", "700"]`)
- Variable font axes (`{"tag": "wght", "min": 100, "max": 900}`)
- Direct file URLs for each font file (needed for glyph extraction)
- Sorting by popularity, alphabetical, date

**Pattern used by LottieFiles and Figma:**
- **Editor UI:** REST API (with key) → build the searchable font picker
- **Exported files:** CSS endpoint (no key) → font name references that any browser can load

**How to get a Google Fonts API key:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or use existing)
3. Enable "Google Fonts Developer API"
4. Go to "APIs & Services" → "Credentials" → "Create Credentials" → "API Key"
5. (Recommended) Restrict the key to the Google Fonts API and your domain
6. Add to `.env.local`:
   ```
   NEXT_PUBLIC_GOOGLE_FONTS_API_KEY=your_key_here
   ```

**Fallback strategy (no key):** The `google-webfonts-helper` project maintains a static JSON dump of the full Google Fonts catalogue, updated weekly. We can host this or bundle it as a static asset — gives us the full font list without requiring an API key. This is the fallback if the user doesn't have a key.

**Decision:** Use the REST API for the font picker. Instructions to get a key are above. Implement a static JSON fallback for development/no-key environments.

---

### 4b. Glyph Export / Font Embedding

**The Lottie spec has two approaches:**

**Approach A — Font Name Reference (current behavior):**
```json
"fonts": {
  "list": [{ "fName": "Inter-Regular", "fFamily": "Inter", "fStyle": "Regular" }]
},
"t": { "d": { "k": [{ "s": { "t": "Hello", "f": "Inter-Regular", "s": 48 } }] } }
```
- Lottie player must load the font at runtime (from Google Fonts or elsewhere)
- Text remains editable at runtime
- File is small
- Rendering differs slightly across platforms/browsers

**Approach B — Glyph Outlines (chars array):**
```json
"chars": [
  {
    "ch": "H",
    "size": 48,
    "width": 32.5,
    "data": { "shapes": [ { "ty": "gr", "it": [ /* bezier paths */ ] } ] }
  }
]
```
- All character shapes baked into the file
- No font loading needed at runtime
- Identical rendering everywhere (cross-platform fidelity)
- Text becomes non-editable at runtime
- File size larger (especially for many unique characters or CJK)

**How to extract glyph paths from Google Fonts:**

Use **opentype.js** (browser-compatible, well-maintained):
```js
import opentype from 'opentype.js';

// Google Fonts REST API gives us the TTF URL
const fontMeta = await fetch(`https://www.googleapis.com/webfonts/v1/webfonts?key=KEY&family=Inter`);
const ttfUrl = fontMeta.files['400']; // e.g. https://fonts.gstatic.com/s/inter/v13/...ttf

const font = await opentype.load(ttfUrl);
const path = font.getPath('H', 0, 0, 48); // x, y, fontSize
const svgPath = path.toSVG(); // → "<path d="M 5.23 0 L ..."/>"
```

The SVG path must then be converted to Lottie bezier format (cubic bezier vertices).

**LottieFiles / Bodymovin behavior:**
- The Bodymovin After Effects plugin has a "Glyphs" checkbox
- When checked, all used characters are converted to bezier outlines and embedded in `chars[]`
- When unchecked, font name is referenced and the runtime loads the font
- LottieFiles Creator (web editor) does not appear to expose this choice — it likely uses font name references by default

**Decision:**
- Default export: **font name references** (matches current behavior, smaller file)
- Add an "Embed fonts as glyphs" toggle in the export dialog
- Use `opentype.js` for glyph extraction
- Show estimated file size difference before exporting

---

### 4c. CJK Text Input

**CJK = Chinese, Japanese, Korean** — languages that require an Input Method Editor (IME) because they have thousands of characters that cannot be typed directly on a standard keyboard.

**How IME works:**
1. User starts typing phonetic input (e.g., "ni" for Chinese)
2. IME shows a candidate popup with matching characters
3. User selects a character
4. `compositionend` event fires with the final committed text

**The canvas problem:**
Canvas 2D has no native text input. You cannot attach an IME to a canvas element. Every canvas-based editor must use a workaround.

**Industry-standard solution (used by Figma, Excalidraw, etc.):**
Use a hidden `<input>` or `<textarea>` element as the IME capture target:
```html
<textarea
  style="opacity: 0; position: absolute; left: -9999px; width: 1px; height: 1px;"
  ref={hiddenInputRef}
/>
```
- Focus this hidden element when entering text edit mode
- Listen to `compositionstart`, `compositionupdate`, `compositionend`, `keydown`, `input`
- During composition: render the pending "pre-edit" text on canvas with underline decoration
- On `compositionend`: commit the final character to `node.props.text`
- This is exactly the same approach needed for Phase 3 (canvas-native editing)

**Does LottieFiles support CJK?**
Not documented. No forum posts, no help articles, no changelog entries about CJK support. This is a **gap in LottieFiles**. Supporting CJK is an opportunity to be better.

**Market importance:**
- China, Japan, Korea are top-3 design markets in Asia
- Lottie is heavily used in WeChat mini-apps, Douyin, Line, KakaoTalk — all CJK-first platforms
- Estimated 15–25% of potential Lottie editor users are in CJK markets
- Missing CJK support means creators in those markets must export text as glyphs from After Effects — a painful workaround

**Decision:** Implement CJK/IME support as part of Phase 3 (canvas-native editing). The hidden-input architecture required for canvas editing naturally enables IME — it's not a separate feature, it's a natural extension of the same implementation. Cost is low; value is high.

---

### 4d. Variable Fonts

**What variable fonts are:**
A single font file that contains a full range of weights, widths, and other axes — instead of separate files for Regular, Bold, Light. A `wght` axis from 100 to 900 is the most common.

**Google Fonts variable font stats:**
- ~288 variable fonts out of ~1,500 total (~19%)
- Popular variable fonts: Inter, Roboto Flex, Nunito, Open Sans, Raleway, Recursive

**Loading a variable font via Google Fonts CSS API:**
```
# Fixed weight:
https://fonts.googleapis.com/css2?family=Inter:wght@450&display=swap

# Weight range (loads full variable font file):
https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap

# Canvas: set font string normally
ctx.font = `450 48px "Inter"`;
```

**How Figma handles variable fonts:**
- Detects if the selected font is a variable font via the REST API response (`axes` field)
- Shows a **slider** for each axis (weight, width, optical size, etc.)
- Weight slider replaces the dropdown for variable fonts
- Non-variable fonts still use a dropdown with available fixed weights

**Does Lottie JSON spec support variable font axes?**
No. The current spec only stores `fWeight` as a static string value. There is no field for font axis ranges. This means:
- Variable weight can be stored as a specific value (e.g., `"fWeight": "450"`)
- The canvas renderer and CSS loader can use that value
- But the Lottie player at runtime uses whatever value is stored — there's no axis animation in the spec

**Decision:**
- Detect variable fonts from the Google Fonts REST API `axes` field
- For variable fonts: show a weight slider (100–900 continuous)
- For non-variable fonts: show a dropdown of available named weights
- Store the selected weight value as-is in `node.props.fontWeight` (no spec change needed)
- For the CSS URL, load the full weight range for variable fonts: `wght@100..900`
- For Canvas rendering: use the stored weight value directly in the font string

---

## 5. Decisions Made

| Decision | Choice | Reason |
|---|---|---|
| Phase order | 1 → 2 → 3 → 4 → 5 → 6 | Quick wins first, then structural fixes |
| Google Fonts | REST API + CSS endpoint | API for picker metadata, CSS for export |
| API key | User must get one (instructions in §4a) | Required for full picker experience |
| Fallback | Static JSON from google-webfonts-helper | Dev/offline environments |
| Glyph export | Optional toggle, default off | Font refs are smaller and editable |
| Glyph library | opentype.js | Browser-compatible, well-maintained |
| CJK support | Yes, implement in Phase 3 | Low added cost, high market value |
| CJK approach | Hidden textarea + composition events | Industry standard (Figma, Excalidraw) |
| Variable fonts | Yes, weight slider for variable, dropdown for fixed | Matches Figma UX |
| Variable font loading | Full range `wght@100..900` in CSS URL | Single request, full slider range |

---

## 6. Phased Implementation Plan

---

### Phase 1 — Bug Fixes
**Estimated effort:** 1–2 days  
**Goal:** Fix the most painful issues without architectural changes  

#### 1a. Fix letter spacing zoom bug
**File:** `app/creator/components/Canvas/CanvasView.tsx`  
**Change:** Line ~3221  
```js
// BEFORE (wrong):
letterSpacing: `${(node.props.letterSpacing || 0) * viewport.zoom}px`

// AFTER (correct):
letterSpacing: `${node.props.letterSpacing || 0}px`
```

#### 1b. Fix font weight loading
**File:** `app/creator/components/Inspector/FontPicker.tsx`  
**Change:** Update the Google Fonts CSS URL in the font loader to include all 9 weights:
```js
// BEFORE:
`https://fonts.googleapis.com/css2?family=${encodedFamilies.join('&family=')}&display=swap`
// where each family uses :wght@400;700

// AFTER:
// Each family entry: Inter:wght@100;200;300;400;500;600;700;800;900
`https://fonts.googleapis.com/css2?family=${families.map(f =>
  `${encodeURIComponent(f)}:wght@100;200;300;400;500;600;700;800;900`
).join('&family=')}&display=swap`
```

#### 1c. Reduce size jump on Enter (partial, without Phase 3)
**File:** `app/creator/components/Canvas/CanvasView.tsx`  
**Change:** In the textarea overlay styling block:
- Set `lineHeight` to the exact pixel value (`${fontSize * lineHeight}px`) not the multiplier
- Set `padding: '0'`, `border: 'none'`, `margin: '0'`, `boxSizing: 'border-box'`
- For non-baseline alignment: remove the `translateY(-baselineShift)` transform
- Match `textBaseline: 'top'` canvas behavior by removing the baseline shift entirely from the textarea (just let it flow from the top)
- Set `verticalAlign: 'top'` on the textarea element

This won't fully eliminate the jump (only Phase 3 does that) but reduces it significantly.

#### 1d. Fix Escape key to revert changes
**File:** `app/creator/components/Canvas/CanvasView.tsx`  
**Change:**
```js
// On edit entry, save original text
const originalTextRef = useRef<string>('');
// When setTextEditingId(id) is called:
originalTextRef.current = node.props.text;

// In the Escape handler:
case 'Escape':
  // Restore original text
  updateNode(textEditingId, { props: { ...node.props, text: originalTextRef.current } });
  setTextEditingId(null);
  break;
```

#### 1e. Fix font inspector weight dropdown
**File:** `app/creator/components/Inspector/InspectorPanel.tsx`  
**Change:** The weight dropdown currently has 7 options. Ensure that when a font is selected, only its available weights are shown. This is a placeholder fix — the full solution comes in Phase 2 with the REST API.

**Deliverables after Phase 1:**
- [ ] Letter spacing correct at all zoom levels
- [ ] All selected font weights actually render
- [ ] Escape cancels edit without saving changes
- [ ] Size jump visually reduced (not eliminated)

---

### Phase 2 — Google Fonts API Integration
**Estimated effort:** 3–5 days  
**Goal:** Replace the 44-font hardcoded list with 1,500+ fonts, searchable, with correct weight/variant loading  

#### Step 1: Setup

Add to `.env.local`:
```
NEXT_PUBLIC_GOOGLE_FONTS_API_KEY=your_key_here
```

Add `opentype.js` to package.json (needed later for Phase 5 glyph export, install now):
```
npm install opentype.js
npm install @types/opentype.js --save-dev
```

#### Step 2: Create `lib/creator/fonts/GoogleFontsService.ts`

Responsibilities:
- Fetch full font catalogue from REST API (`sort=popularity`) on first load
- Cache the JSON response in `localStorage` with a 24-hour TTL
- Fallback: if no API key or API fails, load from bundled static JSON (`/public/google-fonts-fallback.json`)
- Expose:
  - `getFonts(): Promise<FontFamily[]>` — all 1,500+ fonts
  - `searchFonts(query: string): FontFamily[]` — filter by name
  - `loadFont(family: string, weights: string[]): Promise<void>` — inject CSS link tag
  - `loadVariableFont(family: string): Promise<void>` — load full `wght@100..900`
  - `getFontVariants(family: string): FontVariant[]` — returns available weights + whether variable
  - `getAxisInfo(family: string): FontAxis[]` — returns variable font axes if any

```ts
interface FontFamily {
  family: string;
  category: string; // 'sans-serif' | 'serif' | 'monospace' | 'display' | 'handwriting'
  variants: string[]; // ['100', '100italic', '300', '400', '700', ...]
  files: Record<string, string>; // weight → TTF URL
  axes?: FontAxis[]; // only for variable fonts
  subsets: string[];
}

interface FontAxis {
  tag: string; // 'wght', 'wdth', 'opsz', etc.
  min: number;
  max: number;
  defaultValue: number;
}
```

#### Step 3: Rewrite `FontPicker.tsx`

New component architecture:
```
FontPicker
  ├── SearchInput (debounced, 300ms)
  ├── CategoryTabs (All, Serif, Sans-serif, Monospace, Display, Handwriting)
  ├── VirtualizedFontList (using @tanstack/react-virtual — already in deps)
  │     └── FontListItem (shows font name rendered in that font)
  └── FontPreviewLoader (IntersectionObserver per item)
```

Font loading strategy:
1. Render virtualized list — only ~15–20 items in DOM at once
2. IntersectionObserver fires when an item enters viewport
3. Load that font's CSS (`wght@400` for preview only)
4. When user selects a font:
   - If variable: load full range `wght@100..900`
   - If not variable: load all available weights (`wght@100;200;300...` for available variants)
5. Update `node.props.fontFamily`
6. Refresh weight control (see Step 4)

#### Step 4: Update Weight Control in Inspector

**File:** `app/creator/components/Inspector/InspectorPanel.tsx`

After font selection, call `GoogleFontsService.getFontVariants(family)`:
- If font is **variable** (has `wght` axis): show a **slider** from `axis.min` to `axis.max` (usually 100–900)
- If font is **not variable**: show a **dropdown** with only the available named weights
- Store the value as a string in `node.props.fontWeight` either way

CSS font string for variable font:
```js
// Canvas (CanvasRenderer.ts):
ctx.font = `${fontWeight} ${fontSize}px "${fontFamily}", sans-serif`;
// Works for both fixed and variable — browser/canvas handles the axis mapping

// Google Fonts CSS URL for variable:
// https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap
```

#### Step 5: Bundled Fallback JSON

Download and commit to `/public/google-fonts-fallback.json`:
- Use the `google-webfonts-helper` API: `https://gwfh.mranftl.com/api/fonts`
- This gives the full catalogue without a key
- Used when: `NEXT_PUBLIC_GOOGLE_FONTS_API_KEY` is missing, or API request fails

**Deliverables after Phase 2:**
- [ ] 1,500+ fonts in picker with search and category filters
- [ ] Virtualized list (fast, no jank)
- [ ] Fonts load lazily as they scroll into view
- [ ] Selected font loads all available weights
- [ ] Variable fonts show weight slider, fixed fonts show weight dropdown
- [ ] Works without API key (fallback JSON)

---

### Phase 3 — Canvas-Native Text Editing
**Estimated effort:** 1–2 weeks  
**Goal:** Eliminate the size jump on Enter/double-click by removing the textarea overlay and editing directly on canvas  

This is the most impactful phase. After this, text editing feels smooth and native.

#### Architecture Overview

```
User double-clicks text node
  → TextEditState becomes active (nodeId, cursorIndex)
  → Hidden <input> receives focus (for IME / mobile keyboard / copy-paste)
  → Canvas renders: text content + blinking cursor line + selection highlight
  → User types → keydown / compositionend → TextCursor updates node.props.text
  → Canvas re-renders every frame (cursor blink via rAF timer)
  → User presses Enter or clicks elsewhere → TextEditState cleared → cursor gone
```

No overlay. No textarea positioned on top. No dual renderer. What you see IS the canvas render.

#### New Files to Create

**`lib/creator/text/TextCursor.ts`**
```ts
interface TextCursorState {
  nodeId: string;
  charIndex: number;     // insertion point
  selectionStart: number;
  selectionEnd: number;
  composing: boolean;    // true during IME composition
  compositionText: string; // pre-edit text being composed
}

class TextCursor {
  moveLeft(shift: boolean): void
  moveRight(shift: boolean): void
  moveUp(shift: boolean): void
  moveDown(shift: boolean): void
  moveToStart(shift: boolean): void
  moveToEnd(shift: boolean): void
  insertText(text: string): void
  deleteBackward(): void
  deleteForward(): void
  selectAll(): void
  moveToPoint(x: number, y: number, measurer: TextMeasurer): void
}
```

**`lib/creator/text/TextMeasurer.ts`**
```ts
class TextMeasurer {
  // Given a text node and canvas context, map character index → pixel position
  getCharPosition(text: string, charIndex: number, ctx: CanvasRenderingContext2D, node: SceneNode): { x: number; y: number; lineIndex: number }

  // Given a pixel position, return the nearest character index
  getCharIndexAtPoint(x: number, y: number, ctx: CanvasRenderingContext2D, node: SceneNode): number

  // Get bounding rect for a range of characters (for selection highlight)
  getSelectionRects(start: number, end: number, ctx: CanvasRenderingContext2D, node: SceneNode): DOMRect[]

  // Get line metrics for multiline text
  getLineMetrics(text: string, ctx: CanvasRenderingContext2D, node: SceneNode): LineMetric[]
}

interface LineMetric {
  text: string;
  startIndex: number;
  endIndex: number;
  y: number;
  width: number;
}
```

#### Changes to `CanvasRenderer.ts`

Add to `renderText()`: when node is in text edit mode, additionally render:
1. **Selection highlight:** Semi-transparent blue rectangles over selected character range
2. **Cursor line:** 2px vertical line at the cursor character position
3. **Composition underline:** Dotted/wavy underline under `compositionText` (IME pre-edit)
4. **Cursor blink:** Timer-driven alpha (1 → 0 → 1 every 500ms); only blink when no key pressed recently

```ts
if (this.textEditState && this.textEditState.nodeId === node.id) {
  this.renderTextCursor(node, this.textEditState);
  this.renderTextSelection(node, this.textEditState);
  if (this.textEditState.composing) {
    this.renderCompositionUnderline(node, this.textEditState);
  }
}
```

#### Changes to `CanvasView.tsx`

1. **Remove the `<textarea>` overlay block** (lines ~3157–3253)
2. **Add a single hidden input:**
```tsx
<input
  ref={hiddenInputRef}
  type="text"
  style={{ opacity: 0, position: 'absolute', left: -9999, width: 1, height: 1, pointerEvents: 'none' }}
  onKeyDown={handleTextKeyDown}
  onKeyUp={handleTextKeyUp}
  onChange={handleTextChange}
  onCompositionStart={handleCompositionStart}
  onCompositionUpdate={handleCompositionUpdate}
  onCompositionEnd={handleCompositionEnd}
  onCopy={handleTextCopy}
  onPaste={handleTextPaste}
  onCut={handleTextCut}
/>
```

3. **Focus the hidden input** when entering text edit mode
4. **Route all keyboard events** to `TextCursor` when `textEditState` is active
5. **Handle IME events:**
```ts
function handleCompositionStart() {
  setTextEditState(prev => ({ ...prev, composing: true, compositionText: '' }));
}
function handleCompositionUpdate(e: CompositionEvent) {
  setTextEditState(prev => ({ ...prev, compositionText: e.data }));
}
function handleCompositionEnd(e: CompositionEvent) {
  // Commit e.data into the actual text at cursor position
  textCursor.insertText(e.data);
  setTextEditState(prev => ({ ...prev, composing: false, compositionText: '' }));
}
```

#### Click-to-Position

On `mousedown` while in text edit mode, call `TextMeasurer.getCharIndexAtPoint()` to move the cursor to where the user clicked. This is essential for editing inside existing text.

On `mousemove` with button held: update `selectionEnd` for drag-to-select.

#### State Changes

Add to `sceneSlice` (or local `CanvasView` state):
```ts
interface TextEditState {
  nodeId: string;
  cursorIndex: number;
  selectionStart: number;
  selectionEnd: number;
  composing: boolean;
  compositionText: string;
  originalText: string; // for Escape revert
}
```

**Deliverables after Phase 3:**
- [ ] Zero size jump when entering/exiting text edit mode
- [ ] Blinking cursor rendered on canvas
- [ ] Click-to-position cursor
- [ ] Drag-to-select text
- [ ] Keyboard shortcuts: Home/End, Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X
- [ ] CJK / IME composition rendering (underline preview + commit)
- [ ] Escape reverts to original text
- [ ] Enter exits edit mode (Shift+Enter inserts newline)
- [ ] Mobile: hidden input triggers on-screen keyboard

---

### Phase 4 — Area Text & Word Wrap
**Estimated effort:** 1 week  
**Goal:** Properly bounded text boxes with word wrapping  

#### What to Build

**Toggle in inspector:** "Point Text" ↔ "Area Text"  
- Point text: text grows horizontally, no wrap (current behavior)
- Area text: text wraps at `node.props.width`, clips or grows at `node.props.height`

**Resize handles in SelectionOverlay:**  
When a text node is area type, show 8 resize handles. Dragging right edge changes `node.props.width`. Dragging bottom changes `node.props.height`.

**Word wrap algorithm in `CanvasRenderer.ts`:**
```ts
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, node: SceneNode): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';
  for (const word of words) {
    const test = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = test;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}
```

Also handle `\n` (explicit line breaks) within word-wrapped text.

**TextMeasurer updates:**  
The character index → pixel position mapping must account for wrapped lines (a character's visual line may differ from its `\n`-based line).

**Lottie Export:**  
Area text exports `sz: [width, height]` and `vj` (vertical justify). Already supported in `LottieExporter.ts` — just needs the UI to set the values.

**Deliverables after Phase 4:**
- [ ] Toggle between point text and area text in inspector
- [ ] Drag-resize area text bounds in canvas
- [ ] Word wrapping renders correctly in canvas
- [ ] Lottie export/import preserves text box bounds

---

### Phase 5 — Glyph Export
**Estimated effort:** 3–5 days  
**Goal:** Let users embed font glyphs as bezier outlines in exported Lottie files for cross-platform fidelity  

#### Implementation Steps

**1. Add `opentype.js` font loader to `GoogleFontsService.ts`:**
```ts
async loadFontForGlyphs(family: string, weight: string): Promise<opentype.Font> {
  const meta = await this.getFontMeta(family);
  const ttfUrl = meta.files[weight]; // e.g. "https://fonts.gstatic.com/..."
  return opentype.load(ttfUrl);
}
```

**2. Create `lib/creator/text/GlyphExtractor.ts`:**
```ts
function extractGlyphs(text: string, font: opentype.Font, fontSize: number): LottieChar[] {
  const uniqueChars = [...new Set(text.split(''))];
  return uniqueChars.map(char => {
    const glyph = font.charToGlyph(char);
    const path = glyph.getPath(0, 0, fontSize);
    return {
      ch: char,
      size: fontSize,
      width: glyph.advanceWidth * fontSize / font.unitsPerEm,
      data: { shapes: pathToLottieShapes(path) } // convert SVG path → Lottie bezier
    };
  });
}
```

**3. Add export toggle in export dialog:**
```
[ ] Embed fonts as glyphs (offline-safe, ~12KB per character set)
    Font references  (smaller file, requires internet for font loading)
```

**4. Update `LottieExporter.ts`:**
- If glyph mode: collect all unique characters across all text nodes → extract glyphs → add to `animation.chars[]`
- If font reference mode: continue current behavior

**5. SVG Path → Lottie Bezier conversion:**
Lottie bezier format uses `v` (vertices), `i` (in-tangents), `o` (out-tangents) arrays. The opentype.js path has `commands` (M, L, C, Q, Z). A converter function is needed. This is the trickiest part — refer to existing converters in `BooleanOps.ts` and `SVGImporter.ts` which already do similar conversions.

**Deliverables after Phase 5:**
- [ ] "Embed glyphs" checkbox in export dialog
- [ ] File size estimate shown (glyphs vs references)
- [ ] Exported `chars[]` array renders correctly in lottie-web player
- [ ] Only used characters extracted (no full charset)

---

### Phase 6 — Rich Inspector, Variable Fonts & CJK
**Estimated effort:** 1–2 weeks  
**Goal:** Full-featured text inspector; polish the editing experience  

This phase assumes Phases 2 and 3 are complete.

#### 6a. Complete Variable Font Support
- Font weight slider using `node.props.fontWeight` (continuous, not snapped to 100s)
- Show axis name and range label (e.g., "Weight: 450 / 100–900")
- Store axis value as string (e.g., `"450"`) — works in CSS and canvas font strings

#### 6b. Italic Support
- Add italic toggle button in inspector
- Load italic variant via Google Fonts CSS: `family=Inter:ital,wght@1,400`
- Canvas font string: `italic ${weight} ${size}px "${family}"`
- Store in `node.props.fontStyle: 'normal' | 'italic'`

#### 6c. Text Decoration
- Underline and strikethrough toggles
- Canvas 2D does not support these natively — implement manually:
  ```ts
  // Underline: draw a 1px rect below each line of text
  ctx.fillRect(x, y + fontSize * 0.1, lineWidth, 1);
  // Strikethrough: draw at ~50% of font size
  ctx.fillRect(x, y - fontSize * 0.3, lineWidth, 1);
  ```
- Store in `node.props.textDecoration: string[]` (e.g., `['underline']`)

#### 6d. Paragraph Spacing
- `node.props.paragraphSpacing` — extra space added after `\n` line breaks
- Separate from `lineHeight` (which is within-paragraph spacing)

#### 6e. Gradient Fill on Text
- When `node.style.fillType === 'gradient'`, create a `CanvasGradient` and use it as `ctx.fillStyle`
- Linear and radial gradient support (already supported for shapes — extend to text)

#### 6f. CJK Font Recommendations
- In the font picker, add a "Language" filter: "Latin", "Chinese", "Japanese", "Korean", "Arabic"
- For CJK filter, show only Google Fonts with those subsets (from REST API `subsets` field)
- Recommend Noto Sans SC / TC / JP / KR as defaults for CJK content
- These fonts have large character sets — warn user about file size when using glyph export with CJK

**Deliverables after Phase 6:**
- [ ] Continuous weight slider for variable fonts
- [ ] Italic toggle loads correct variant
- [ ] Underline and strikethrough rendered on canvas
- [ ] Paragraph spacing control
- [ ] Gradient fills on text
- [ ] Language filter in font picker
- [ ] CJK font recommendations and file-size warning

---

## 7. Tech Stack Reference

| Purpose | Library | Notes |
|---|---|---|
| Font catalogue | Google Fonts REST API | Requires API key; fallback to static JSON |
| Font CSS loading | Google Fonts CSS API v2 | No key needed; inject `<link>` tags |
| Glyph extraction | `opentype.js` | Browser-compatible TTF/OTF parser |
| Virtualized list | `@tanstack/react-virtual` | Already in package.json |
| Canvas text metrics | Canvas 2D `measureText()` | Built-in; no library needed |
| IME support | Hidden `<input>` + composition events | Native browser; no library |
| State | Zustand (existing) | Add `textEditState` slice or local state |
| Rendering | Canvas 2D (existing `CanvasRenderer.ts`) | Extend for cursor/selection rendering |

**New dependencies to install:**
```bash
npm install opentype.js
npm install @types/opentype.js --save-dev
```

**No other new dependencies needed.** All other tools are already in the project.

---

## 8. Open Questions / Parking Lot

These are questions to answer before or during implementation:

1. **Google Fonts API key** — user needs to get one from Google Cloud Console (instructions in §4a). Add to `.env.local` as `NEXT_PUBLIC_GOOGLE_FONTS_API_KEY`.

2. **Phase 3 cursor rendering performance** — the cursor blink requires a `requestAnimationFrame` loop even when no animation is playing. Need to ensure this doesn't interfere with the existing `WorkerRenderer` rAF loop. Likely solution: integrate cursor blink into the existing render tick.

3. **Phase 3 font metrics accuracy** — `ctx.measureText()` returns `width` but for cursor positioning we also need per-character widths. Must use `ctx.measureText(text.slice(0, i)).width` for each index. For long text strings, this could be O(n²). May need to cache metrics.

4. **Phase 5 CORS** — Google Fonts TTF files at `fonts.gstatic.com` need to be fetched for opentype.js glyph extraction. These are served with CORS headers (`Access-Control-Allow-Origin: *`) so direct browser fetch should work. Verify this in testing.

5. **Phase 5 SVG → Lottie bezier conversion** — this is the most complex part of glyph export. Reference `SVGImporter.ts` for existing SVG path parsing code that can be adapted.

6. **Text animation (keyframes on text properties)** — currently `fontSize` is listed as animatable in the architecture but text content itself is not animatable (no per-frame text changes). This is a future Phase 7 item if needed.

7. **Motion Tokens / Slots API** — LottieFiles' runtime text update feature. Not in scope for current phases but worth tracking as a future Phase 7.

---

*Document last updated: 2026-04-29*  
*Next action: Implement Phase 1 bug fixes*
