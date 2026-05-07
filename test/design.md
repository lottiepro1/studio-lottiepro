# LottiePro — Design System

A minimal, macOS-native design language for a motion animation editor.
Clean surfaces, soft dividers, one restrained accent, generous breathing room.

---

## 1. Design Philosophy

**Style.** Minimal, modern, SaaS-grade. Inspired by native macOS app chrome (Sketch, Linear, Raycast) with a side-panel inspector layout. Premium without being decorative.

**Core principles.**
- **Canvas-first.** The workspace is the hero. Chrome is quiet and pulls back so the art leads.
- **Generous negative space.** Labels breathe, rows never feel crowded, panels group by whitespace before they group by borders.
- **One accent, used sparingly.** Blue marks selection, focus, and the single primary action — nothing else.
- **Soft hierarchy.** Light separators, subtle elevation, never hard lines or heavy shadows.
- **Feel native.** Rounded window chrome, traffic lights, pill-shaped segmented controls, iOS-style toggles.
- **Clarity over cleverness.** Every label is plain English; every value is readable at a glance.

---

## 2. Color System

### 2.1 Light Mode

| Token              | HEX       | RGB                 | Use                                      |
| ------------------ | --------- | ------------------- | ---------------------------------------- |
| `bg/canvas`        | `#EFEFEF` | `239, 239, 239`     | Outer window / desktop backdrop          |
| `bg/app`           | `#FFFFFF` | `255, 255, 255`     | Main window body, canvas                 |
| `bg/panel`         | `#F7F7F7` | `247, 247, 247`     | Inspector / sidebar                      |
| `bg/surface`       | `#FFFFFF` | `255, 255, 255`     | Input fields, cards                      |
| `bg/hover`         | `#F0F0F0` | `240, 240, 240`     | Row hover                                |
| `bg/active`        | `#E6E6E6` | `230, 230, 230`     | Pressed / selected neutral               |
| `border/subtle`    | `#ECECEC` | `236, 236, 236`     | Hairline dividers                        |
| `border/default`   | `#E1E1E1` | `225, 225, 225`     | Input / card borders                     |
| `border/strong`    | `#D0D0D0` | `208, 208, 208`     | Emphasis borders                         |
| `text/primary`     | `#1A1A1A` | `26, 26, 26`        | Headings, values                         |
| `text/secondary`   | `#555555` | `85, 85, 85`        | Labels                                   |
| `text/muted`       | `#8A8A8A` | `138, 138, 138`     | Placeholders, hints                      |
| `text/disabled`    | `#B8B8B8` | `184, 184, 184`     | Disabled                                 |
| `accent`           | `#0A84FF` | `10, 132, 255`      | Selection, focus, primary                |
| `accent/hover`     | `#0070E0` | `0, 112, 224`       | Hover on primary                         |
| `accent/soft`      | `#E8F1FF` | `232, 241, 255`     | Selected row tint                        |
| `state/success`    | `#30C759` | `48, 199, 89`       | Success toast                            |
| `state/error`      | `#FF3B30` | `255, 59, 48`       | Destructive / error                      |
| `window/shadow`    | `rgba(0,0,0,0.08)` | —          | Window drop shadow                       |

### 2.2 Dark Mode

| Token              | HEX       | RGB                 | Use                                      |
| ------------------ | --------- | ------------------- | ---------------------------------------- |
| `bg/canvas`        | `#8A8A8A` | `138, 138, 138`     | Outer desktop backdrop                   |
| `bg/app`           | `#2B2B2D` | `43, 43, 45`        | Main window body, canvas                 |
| `bg/panel`         | `#1E1E20` | `30, 30, 32`        | Inspector / sidebar                      |
| `bg/surface`       | `#2A2A2C` | `42, 42, 44`        | Input fields, cards                      |
| `bg/hover`         | `#333335` | `51, 51, 53`        | Row hover                                |
| `bg/active`        | `#3A3A3C` | `58, 58, 60`        | Pressed / selected neutral               |
| `border/subtle`    | `rgba(255,255,255,0.06)` | —    | Hairline dividers                        |
| `border/default`   | `rgba(255,255,255,0.10)` | —    | Input / card borders                     |
| `border/strong`    | `rgba(255,255,255,0.14)` | —    | Emphasis borders                         |
| `text/primary`     | `#F2F2F2` | `242, 242, 242`     | Headings, values                         |
| `text/secondary`   | `#B0B0B0` | `176, 176, 176`     | Labels                                   |
| `text/muted`       | `#7A7A7A` | `122, 122, 122`     | Placeholders, hints                      |
| `text/disabled`    | `#555555` | `85, 85, 85`        | Disabled                                 |
| `accent`           | `#0A84FF` | `10, 132, 255`      | Selection, focus, primary                |
| `accent/hover`     | `#3396FF` | `51, 150, 255`      | Hover on primary                         |
| `accent/soft`      | `rgba(10,132,255,0.18)` | —     | Selected row tint                        |
| `state/success`    | `#30D158` | `48, 209, 88`       | Success                                  |
| `state/error`      | `#FF453A` | `255, 69, 58`       | Destructive / error                      |
| `window/shadow`    | `rgba(0,0,0,0.4)` | —           | Window drop shadow                       |

### 2.3 State overlays

| State      | Light                        | Dark                         |
| ---------- | ---------------------------- | ---------------------------- |
| Hover      | `bg/hover`                   | `bg/hover`                   |
| Pressed    | `bg/active`                  | `bg/active`                  |
| Selected   | `accent/soft`                | `accent/soft`                |
| Focused    | 2px `accent` ring, 2px offset | 2px `accent` ring, 2px offset |
| Disabled   | 50% opacity + `text/disabled` | 50% opacity + `text/disabled` |

---

## 3. Typography

- **Family:** `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif`
- **Mono:** `"SF Mono", ui-monospace, Menlo, monospace` — used for numeric values
- **Letter-spacing:** `-0.01em` on display, `0` on body, `+0.02em` on 10–11px UPPER labels

| Role         | Size | Weight | Line-height |
| ------------ | ---- | ------ | ----------- |
| H1 / Display | 28px | 600    | 1.2         |
| H2           | 20px | 600    | 1.3         |
| H3           | 16px | 600    | 1.4         |
| H4           | 14px | 600    | 1.4         |
| Body         | 13px | 400    | 1.5         |
| Label        | 12px | 400    | 1.4         |
| Small        | 11px | 400    | 1.4         |
| Micro UPPER  | 10px | 500    | 1.3         |

**Weights used:** 400 (body), 500 (labels, micro), 600 (headings, emphasis, buttons). Avoid 700+.

---

## 4. Spacing System

4-px base scale:

`2 · 4 · 6 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64`

- Panel padding: `16px`
- Section gap inside panel: `20–24px`
- Row vertical rhythm: `8–12px`
- Input internal padding: `8px 12px`
- Button padding: `8px 14px` (default), `10px 18px` (primary)
- Section dividers: 1px border + 16px padding above/below

---

## 5. Layout & Grid

- **Window container:** fluid, rounded 12px, max 1280px wide for the preview doc; centered with ~24–40px of desktop margin.
- **Inspector width:** 280–320px, fixed on the right.
- **Content:** 12-column grid, 16px gutters (only where needed; most screens use flex).
- **Section spacing:** 32px between unrelated sections, 20px within a section.

---

## 6. Components

### 6.1 Window chrome

- Height: 44px title bar
- Radius: 12px (outer), 0 (inner split)
- Traffic lights: 12px circles · red `#FF5F57` · yellow `#FEBC2E` · green `#28C840`, 8px spacing, 16px left inset
- Title: 13px `text/secondary`, centered
- Shadow: `0 20px 50px window/shadow, 0 2px 6px window/shadow`

### 6.2 Buttons

| Variant    | Bg              | Text           | Border             | Radius | Padding   |
| ---------- | --------------- | -------------- | ------------------ | ------ | --------- |
| Primary    | `accent`        | `#fff`         | —                  | 6px    | 8px 14px  |
| Secondary  | `bg/surface`    | `text/primary` | `border/default`   | 6px    | 8px 14px  |
| Ghost      | transparent     | `text/primary` | —                  | 6px    | 8px 12px  |
| Icon       | transparent     | `text/secondary`| —                 | 6px    | 6px       |

Hover: darken bg by one step. Pressed: `bg/active`. Focus: 2px `accent` ring @ 2px offset.

### 6.3 Inputs

- Bg: `bg/surface`
- Border: `border/default`, 1px
- Radius: `6px`
- Height: `28px` (compact), `32px` (default)
- Padding: `0 10px`
- Focus: border → `accent`, 2px soft ring `accent @ 20%`
- Numeric values right-aligned, mono

### 6.4 Cards / Groups

- Bg: `bg/surface` (on panel) or none
- Border: `border/subtle`
- Radius: `8px`
- Padding: `12–16px`
- Shadow: none (rely on border + bg contrast)

### 6.5 Navbar / Title bar

See §6.1 window chrome. No additional top nav in the inspector view.

### 6.6 Sidebar / Inspector

- Bg: `bg/panel`
- Border-left: `1px solid border/subtle`
- Padding: `14px 16px`
- Section header: 11px `text/muted`, UPPER, `+0.04em` tracking, 12px bottom margin
- Row: 28–32px tall, `label` left (`text/secondary`), `value` right (mono, `text/primary`)

### 6.7 Segmented control

- Container: `bg/panel`, `border/default`, radius `8px`, 2px inner padding
- Segment: radius `6px`, 28px tall, 12px padding
- Active: `bg/surface`, `text/primary`, soft shadow `0 1px 2px rgba(0,0,0,0.06)` (light) / none (dark)
- Inactive: `text/secondary`

### 6.8 Tile grid (Motion presets)

- 4-column grid
- Cell: 64×64, radius 8px, 1px `border/subtle`
- Active: 2px `text/primary` border (dark: 2px `text/primary`), no fill
- Label below: 11px `text/secondary`, 8px gap

### 6.9 Toggle switch

- Track: 32×18, radius 99px
- Off: `bg/active` (light: `#E1E1E1`; dark: `rgba(255,255,255,0.12)`)
- On: `text/primary` (black/white toggle, matching screenshots — not accent)
- Knob: 14px, white, shadow `0 1px 2px rgba(0,0,0,0.15)`

### 6.10 Modals

- Overlay: `rgba(0,0,0,0.4)` light / `rgba(0,0,0,0.6)` dark
- Window: radius `12px`, padding `24px`, max-width `480px`
- Shadow: `0 24px 64px rgba(0,0,0,0.18)` light / `0 24px 64px rgba(0,0,0,0.5)` dark

### 6.11 Tags / badges

- Height: 20px
- Padding: `2px 8px`
- Radius: `4px` (subtle) or `99px` (pill)
- Bg: `bg/active`, text: `text/secondary`

### 6.12 Selection frame (canvas)

- 1px dashed `text/primary` at full opacity
- 6×6 square handles, white fill, 1px `text/primary` border

---

## 7. Iconography & Visual Style

- **Style:** 1.5-stroke outline, 16–18px, rounded line caps. Solid fills only for logos.
- **Color:** `text/secondary` default, `text/primary` active, `accent` when on a primary surface.
- **Spacing:** 8px minimum between icon and adjacent text.
- **Illustrations / Lottie assets:** center-stage in the canvas area. Never decorate the UI chrome itself with illustrations.
- **Brand logos:** rendered as dropped assets, never as UI decoration.

---

## 8. Effects

- **Shadows (light mode):**
  - `sm`: `0 1px 2px rgba(0,0,0,0.04)`
  - `md`: `0 4px 12px rgba(0,0,0,0.06)`
  - `window`: `0 20px 50px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04)`
- **Shadows (dark mode):** use larger, darker values — `0 24px 64px rgba(0,0,0,0.5)` for modals; most inline surfaces use **no shadow**, relying on background contrast.
- **Borders:** 1px hairlines only. No 2px borders anywhere except active states.
- **Blur / glass:** avoided. If used, only on fullscreen overlays at `backdrop-filter: blur(20px)` with 80% tinted background.
- **Corner radii:** `4 · 6 · 8 · 12` — nothing larger except toggle tracks and traffic lights.

---

## 9. Dark Mode Guidelines

- **Canvas is not pure black.** Use `#2B2B2D` / `#1E1E20` to feel warm and premium.
- **Borders become transparent white** (`rgba(255,255,255,0.06–0.14)`) so they read as a diffused edge rather than a drawn line.
- **Shadows mostly disappear** on inline UI — background contrast does the work.
- **Accent is identical** in both modes (`#0A84FF`) so brand feel stays consistent.
- **Selection tint** shifts from `#E8F1FF` (light) to `rgba(10,132,255,0.18)` (dark) — same hue, different alpha.
- **Toggles stay monochrome** (black in light, white in dark) for a native iOS feel — accent is reserved.

---

## 10. Accessibility

- **Contrast:**
  - `text/primary` on `bg/app`: 15:1 (light) · 13:1 (dark) — AAA
  - `text/secondary` on `bg/panel`: ≥ 7:1 — AAA
  - `accent` on white: 4.6:1 — AA
- **Focus:** always visible via `:focus-visible` — 2px `accent` ring + 2px offset; never suppressed.
- **Hit targets:** minimum 28px; primary actions 32px+.
- **Motion:** respect `prefers-reduced-motion` — kill non-essential transitions.
- **Color is never the only signal** for state — pair with text, icon, or position.

---

_LottiePro · v0.2 · macOS-native minimal_
