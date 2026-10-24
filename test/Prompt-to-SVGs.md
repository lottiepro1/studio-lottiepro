# Prompt to SVGs — Research Report & Implementation Plan

**Project:** Creator v2 (browser-based Lottie animation editor)
**Date:** 2026-06-13
**Status:** Research complete — implementation plan approved-pending
**Decisions captured from product owner:**
- Monetization: **Free tier + paid tier**
- UX: users pick a **category** before generating (e.g. "Icons & Logos", "Illustrations", "Detailed Art")
- Volume: unknown → cost modeled at 3 tiers below

---

## 1. Executive Summary (TL;DR)

There are **two fundamentally different ways** to do prompt→SVG, and we should use **both**, routed by the category the user picks:

| Approach | How it works | Best for | Examples |
|---|---|---|---|
| **A. LLM code generation** | A text LLM literally writes the `<svg>...</svg>` markup | Icons, logos, flat illustrations, UI graphics | Claude, GPT, Gemini, (Groq-hosted open models) |
| **B. Dedicated vector models** | A generative image model that outputs native vector paths | Detailed/artistic illustrations, complex shading | QuiverAI (Arrow 1.1), Recraft V3 SVG |

**Recommendation:**

1. **Primary engine: Claude (Anthropic API)** — LLM code generation.
   - Free tier → `claude-haiku-4-5` (~$0.02/SVG)
   - Paid tier → `claude-opus-4-8` (~$0.10/SVG), with `claude-sonnet-4-6` as a mid option
   - Claude leads SVG-generation benchmarks (SVGBench: Opus 75.6% vs GPT-5.2 74.4% vs Gemini 3 Pro ~70.3%).
   - **The killer feature for us:** with code generation we *control the markup*. We can instruct the model to emit named, animation-ready layer groups (`<g id="arm-left">`), restrict output to exactly the tags our `SvgImporter` supports, and convert text to paths. No other approach gives us this.
2. **Secondary engine (Phase 3): Recraft V3 SVG API** for the "Detailed Art" category — flat $0.08/vector image, simple REST API, mature. QuiverAI is the more SVG-native alternative (raw SVG markup straight from the API, plus vectorize + animate endpoints) — evaluate both in the Phase 3 spike; pricing is model-specific and must be confirmed via their `GET /v1/models`.
3. **Skip:** Groq (open models score very poorly on SVG validity/quality), raster generators (GPT-Image, DALL·E, Midjourney — would require a lossy vectorization step that destroys layer structure for animation).

**Why quality-for-animation ≠ quality-as-image:** our users generate SVGs **to animate them**. A visually gorgeous SVG made of 900 unnamed `<path>` fragments is *worse* for us than a clean one with 12 semantic groups. This is why LLM code-gen is the right primary engine even though dedicated vector models can look richer.

---

## 2. How Each Approach Works

### 2A. LLM writes SVG code (Claude / GPT / Gemini / Groq)

The model receives a system prompt describing SVG constraints + the user prompt, and streams back literal SVG markup. We parse, sanitize, and feed it to `SvgImporter.importFromString()` — the exact entry point already used by paste-import ([Navbar.tsx:307](app/components/Toolbar/Navbar.tsx#L307)) and Discover Logos ([DiscoverLogosModal.tsx:89](app/components/Toolbar/DiscoverLogosModal.tsx#L89)).

**Pros**
- Full control of output structure (named groups, layer order, allowed tags, viewBox).
- Cheap-to-mid cost; streaming preview possible.
- Iterative refinement is natural: send previous SVG back + "make the sun bigger" (conversational editing — a real product differentiator).
- No new vendor for the core flow if we also use Claude elsewhere.

**Cons**
- Complexity ceiling: LLMs produce great icons/flat art, but struggle with painterly detail, complex gradients meshes, photorealism.
- Occasional invalid/degenerate output → needs a validate-and-retry loop (cheap).

**Benchmark context (2026):** SVGBench scores — claude-opus-4.6: 75.6%, gpt-5.2: 74.4%, gemini-3-pro: ~70.3%. Open-source models (what Groq serves) score drastically lower with frequent invalid SVG output. SVGenius reaches the same ordering (Claude > GPT > Gemini).

### 2B. Dedicated vector generation models

| | **QuiverAI (Arrow 1.1 / 1.1 Max)** | **Recraft V3 SVG** |
|---|---|---|
| What it is | AI-native SVG model; a16z-backed; the user's "quiever AI" | Established image platform; "the only major image tool with true SVG output" |
| API | `POST /v1/svgs/generations` → returns **raw SVG markup** in JSON; Bearer auth; 20 req/min default | REST API, ~$0.08 per vector image; also available via aggregators (Atlas Cloud etc.) |
| Extras | Image→SVG **vectorization**; **SVG animation** endpoint (poll task → animated SVG); hosted **MCP server** | Style controls, brand styles, raster + vector |
| Pricing | Credit-based. Retail credits ~$0.30 ea (PAYG); subs $20/mo ≈ 1,000 credits/wk, $40/mo ≈ 3,000/wk (→ effective ~$0.005/credit); ~1 credit per variation. **API rates are model-specific — confirm via `GET /v1/models`** | ~**$0.08/vector**, ~$0.04/raster (API units: vector=80, raster=40) |
| Risk | Young company (seed stage, public beta docs) | Mature, but output is "flattened art" — many paths, no semantic grouping |

**Shared con for animation:** both produce visually rich SVGs but with machine-generated path soup — fine for "import a finished illustration and animate the whole group", poor for "animate the character's arm". Position these for the **Detailed Art** category, where users accept whole-object animation.

### 2C. Rejected: raster image models + vectorization

GPT-Image-2 / DALL·E / Midjourney / Imagen output **raster only** ($0.005–$0.21/image). Converting to SVG needs a tracer (vectorizer.ai ≈ $0.20/img, or potrace = monochrome only). Result: huge files, blurry edges as paths, zero layer semantics. Not worth building. (QuiverAI's vectorize endpoint covers the "user uploads a PNG" use case later if we ever want it.)

### 2D. About Groq specifically

Groq is not a model — it's ultra-fast **inference hosting for open models** (Llama 3.3 70B: $0.59/$0.79 per MTok; Kimi K2: $1/$3). It would make SVG generation nearly free (~$0.003–0.01/SVG) and very fast, **but** open models are the worst performers on every SVG benchmark (invalid markup, poor composition). Verdict: **not for launch.** Revisit only if free-tier costs become painful — and then only with heavy validation/retry and lowered user expectations.

---

## 3. Pricing Comparison

LLM cost assumption per generation: ~1,200 input tokens (system prompt + user prompt) and ~4,000 output tokens (a respectable multi-layer SVG). Prices are per million tokens, current as of June 2026 — **re-verify all pricing before launch.**

| Provider / Model | Input $/M | Output $/M | Est. cost per SVG | SVG quality (for our use) |
|---|---|---|---|---|
| **Claude Haiku 4.5** | $1.00 | $5.00 | **~$0.02** | Good — best free-tier value |
| **Claude Sonnet 4.6** | $3.00 | $15.00 | **~$0.06** | Very good |
| **Claude Opus 4.8** | $5.00 | $25.00 | **~$0.11** | Best-in-class (benchmark leader) |
| Claude Fable 5 | $10.00 | $50.00 | ~$0.21 | Overkill for SVG; not needed |
| GPT-5.x (OpenAI) | ~same class | ~same class | ~$0.06–0.12 | Near-Claude; second choice |
| Gemini 3 Pro | $2.00 | $12.00 | ~$0.05 | Good; can emit animated SVGs |
| Groq · Llama 3.3 70B | $0.59 | $0.79 | ~$0.004 | Poor — invalid SVGs common |
| Groq · Kimi K2 | $1.00 | $3.00 | ~$0.013 | Mediocre |
| **Recraft V3 SVG** | — | — | **$0.08 flat** | Rich art, flattened layers |
| **QuiverAI Arrow 1.1** | — | — | ~$0.005 (sub) – $0.30 (PAYG retail); API rate TBD | Rich art, SVG-native, animation endpoint |

### Monthly cost modeling (primary engine = Claude, mixed tiers)

Assume 70% free-tier (Haiku), 25% paid (Sonnet), 5% paid-premium/detailed (Opus or Recraft @ ~$0.10 avg):

| Volume | Free (Haiku) | Paid (Sonnet) | Premium | **Total/mo** |
|---|---|---|---|---|
| 5,000/mo | 3,500 × $0.02 = $70 | 1,250 × $0.06 = $75 | 250 × $0.10 = $25 | **~$170** |
| 50,000/mo | $700 | $750 | $250 | **~$1,700** |
| 250,000/mo | $3,500 | $3,750 | $1,250 | **~$8,500** |

Levers if costs bite: prompt caching on the (large, static) system prompt cuts its input cost ~90%; Batches API is irrelevant here (interactive); shrink output tokens with "no comments, minified attributes" instructions; per-user daily caps on free tier (essential anyway for abuse control).

**Pricing sanity for paid tier:** at ~$0.06–0.11 raw cost, selling generations at ~$0.25–0.50/credit (or bundling N/month into a subscription) leaves healthy margin and matches market norms (QuiverAI retails $0.30/credit).

---

## 4. Constraints From Our Codebase (what the generated SVG must look like)

`lib/creator/svg/SvgImporter.ts` is the single funnel — anything we generate must survive it:

**Supported (safe to generate):** `path`, `rect`, `circle`, `ellipse`, `polygon`, `polyline`, `line`, `g`, `use`, linear/radial gradients (incl. `gradientTransform`, `userSpaceOnUse`/`objectBoundingBox`), clip-paths/masks (converted to mattes; Gaussian blur triggers layered/precomp mode), `image` (raster baking — avoid in generated output).

**NOT supported (must forbid in the system prompt):**
- `<text>`/`<tspan>` — not in `SHAPE_TAGS`, silently dropped. → Instruct the model: *"render any text as `<path>` outlines"* (LLMs do this acceptably for short words; for the Text category, prefer our own font system instead).
- `<pattern>`, `<symbol>` (skipped), CSS `<style>` blocks (skipped — require presentation attributes instead), `<script>`/event handlers (security: strip anyway), external `href` images, `filter` types other than Gaussian blur.

**Structure rules to enforce via prompt (our animation advantage):**
- Single root `<g>` (importer wraps everything in one root group anyway — aligning avoids surprises).
- Semantic named groups: `<g id="cloud-left">`, `<g id="character/arm-right">` → these become named layers in the Layers panel and animatable nodes.
- `viewBox="0 0 512 512"`, no fixed `width`/`height` needed.
- Flat-ish hierarchy (≤3 levels), 5–40 shapes for icons, ≤150 for illustrations.
- Presentation attributes (`fill="#..."`), not CSS classes.

**Existing integration points (almost everything already exists):**
- Import funnel: `SvgImporter.importFromString(svgString, duration)` — used in 3 places already.
- API route pattern: [app/api/proxy-svg/route.ts](app/api/proxy-svg/route.ts) shows the Next.js route convention.
- Auth + DB: better-auth 1.6 + PostgreSQL — gives us per-user identity for credits/rate-limits.
- Modal pattern: `DiscoverLogosModal.tsx` is the closest UX analog (browse → preview → import) — the Generate modal can mirror its import path verbatim.

---

## 5. Recommended Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Generate Modal (new, app/components/Toolbar/GenerateSvgModal.tsx)
│  category picker · prompt box · variations (1–4) · preview grid
└──────────────┬──────────────────────────────────────────────┘
               │ POST /api/generate-svg  { prompt, category, n }
               ▼
┌─────────────────────────────────────────────────────────────┐
│  app/api/generate-svg/route.ts                              │
│  1. better-auth session  → user id                          │
│  2. credit check (free daily quota / paid balance)          │
│  3. route by category ──► SvgProvider interface             │
│       icons | flat-illustration → ClaudeSvgProvider         │
│       detailed-art (Phase 3)    → RecraftProvider | QuiverProvider
│  4. validate (XML parse, allowed-tag whitelist, viewBox)    │
│  5. sanitize (strip script/event/foreignObject/external refs)│
│  6. retry once on invalid output (cheap insurance)          │
│  7. debit credits, log generation, return { svgs: string[] }│
└──────────────┬──────────────────────────────────────────────┘
               ▼
   client renders previews (sandboxed <img src=data:image/svg+xml>)
   user picks one → SvgImporter.importFromString() → scene graph
```

**Provider abstraction** (so swapping/adding vendors never touches UI):

```ts
// lib/creator/ai/SvgProvider.ts
export interface SvgGenerationRequest {
  prompt: string;
  category: 'icons' | 'flat-illustration' | 'detailed-art';
  n: number;                    // variations
  previousSvg?: string;         // for refine/iterate flows (Phase 4)
  tier: 'free' | 'paid';
}
export interface SvgProvider {
  generate(req: SvgGenerationRequest): Promise<string[]>; // raw sanitized SVG strings
}
```

**Claude provider sketch** (official SDK, streaming — required for 4–8K token outputs):

```ts
// lib/creator/ai/ClaudeSvgProvider.ts
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic(); // ANTHROPIC_API_KEY from env (server-side only)

const MODEL_BY_TIER = { free: 'claude-haiku-4-5', paid: 'claude-opus-4-8' } as const;

export async function generateSvg(req: SvgGenerationRequest): Promise<string[]> {
  const results = await Promise.all(
    Array.from({ length: req.n }, async (_, i) => {
      const stream = client.messages.stream({
        model: MODEL_BY_TIER[req.tier],
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        system: [
          { type: 'text', text: SVG_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content: buildUserPrompt(req, i) }],
      });
      const message = await stream.finalMessage();
      const text = message.content.find((b) => b.type === 'text');
      return extractSvg(text?.type === 'text' ? text.text : '');
    }),
  );
  return results;
}
```

Notes: the big static `SVG_SYSTEM_PROMPT` goes first with `cache_control` → ~90% input-cost reduction across requests within the 5-min cache window; variation diversity comes from `buildUserPrompt(req, i)` adding a per-variation style directive (sampling params don't exist on Opus 4.8). Haiku 4.5 still supports thinking; keep adaptive on for both tiers.

**System prompt skeleton** (the core IP of this feature — iterate on it in Phase 0):

```
You generate a single SVG document and nothing else.

HARD CONSTRAINTS
- Output exactly one <svg> element. No markdown fences, no commentary.
- viewBox="0 0 512 512". No width/height attributes.
- Allowed elements ONLY: svg, g, path, rect, circle, ellipse, polygon,
  polyline, line, defs, linearGradient, radialGradient, stop, clipPath.
- NO <text>. Render any lettering as <path> outlines.
- NO <style>, <script>, <image>, <pattern>, <symbol>, <filter>, event
  handlers, or external references. Presentation attributes only.

ANIMATION-READY STRUCTURE (this SVG will be animated in a Lottie editor)
- Wrap everything in one root <g id="root">.
- Group semantically; give every meaningful part a descriptive kebab-case
  id (e.g. id="sun", id="wave-back", id="character-arm-left").
- Separate parts a motion designer would animate independently.
- Keep hierarchy ≤ 3 levels deep. Prefer fewer, cleaner paths.

CATEGORY: {icons → 5–40 shapes, bold simple geometry, ≤6 colors |
 flat-illustration → ≤150 shapes, flat shading, layered depth (bg/mid/fg)}
```

**Validation/sanitization (server-side, before returning):**
1. Extract first `<svg>...</svg>` block; reject if absent.
2. Parse with an XML parser (e.g. `svgson`, already a dependency) — reject on parse error → one retry with the error appended to the prompt.
3. Whitelist-walk the tree: drop disallowed elements/attributes (anything `on*`, `href` to external origins, `<script>`, `<foreignObject>`).
4. Verify viewBox + at least one drawable shape.

---

## 6. Implementation Plan (phased — this is the doc we follow)

### Phase 0 — Spike & prompt tuning (1–2 days)
- [ ] Get an Anthropic API key; add `ANTHROPIC_API_KEY` to `.env.local` (server-only — never `NEXT_PUBLIC_`).
- [ ] `npm install @anthropic-ai/sdk`.
- [ ] Standalone script (`test/spike-svg-gen.ts`): run ~20 prompts across both categories on Haiku 4.5 / Sonnet 4.6 / Opus 4.8; import each result through `SvgImporter.importFromString` and record: parse success rate, shape count, group-naming quality, visual quality, cost.
- [ ] Iterate the system prompt until ≥95% of outputs import cleanly with named groups.
- **Exit criteria:** model-per-tier decision confirmed with our own data, final v1 system prompt.

### Phase 1 — Backend (2–3 days)
- [ ] `lib/creator/ai/` — `SvgProvider.ts` (interface), `ClaudeSvgProvider.ts`, `svgSanitizer.ts`, `prompts.ts`.
- [ ] `app/api/generate-svg/route.ts` — POST; better-auth session required; zod-validate body; call provider; sanitize; return `{ svgs, creditsUsed, remaining }`.
- [ ] Postgres: `generation_credits` (user_id, balance, free_used_today, reset_at) and `generation_log` (user_id, category, model, prompt_hash, tokens_in/out, cost_usd, status, created_at).
- [ ] Quotas: free tier N/day (start: 10/day); paid tier from balance. Per-user rate limit (e.g. 5 concurrent).
- [ ] Failure handling: provider 429/529 → retry w/ backoff (SDK default), then 503 with friendly message; invalid SVG after 1 retry → refund credit.

### Phase 2 — UI (2–3 days)
- [ ] `GenerateSvgModal.tsx` (mirror `DiscoverLogosModal` patterns): category cards → prompt textarea → variations selector → Generate.
- [ ] Preview grid: render each result via `data:` URI in `<img>` (inert — no script execution), show loading skeletons per variation.
- [ ] "Add to canvas": `SvgImporter.importFromString(svg, duration)` → select imported root group → close modal (identical to DiscoverLogosModal import path).
- [ ] Credits indicator + upsell state when free quota exhausted.
- [ ] Toolbar entry point (sparkle/AI button next to Discover Logos).

### Phase 3 — Detailed Art category (3–4 days, after launch feedback)
- [ ] Spike Recraft V3 SVG vs QuiverAI Arrow 1.1 with the same 20-prompt harness; judge on: import success through `SvgImporter`, path count sanity, visual quality, latency, *confirmed* API pricing (Quiver: `GET /v1/models`).
- [ ] Implement winning `RecraftProvider`/`QuiverProvider`; enable the third category (paid tier only — higher cost).
- [ ] Post-process: collapse degenerate groups, optionally run SVGO-style cleanup before import.

### Phase 4 — Differentiators (ongoing)
- [ ] **Refine loop:** "tweak it" box re-sends previous SVG + instruction (`previousSvg` field) — conversational editing, cheap (cached system prompt + small delta).
- [ ] **Streaming preview:** render the SVG progressively as tokens stream (SVG is valid-ish incrementally; even a "drawing in" effect is a wow moment).
- [ ] **Generate → Animate presets:** since groups are named, offer one-click entrance animations per group (stagger fade/slide) — unique to our code-gen approach.
- [ ] Telemetry: track import-failure rate, retry rate, per-category model performance; prompt A/B.

### Explicitly out of scope (for now)
- Groq/open-model backend (quality), raster→vectorize pipeline (lossy), QuiverAI MCP (we're calling APIs directly from our backend), client-side API keys (never).

---

## 7. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| LLM emits invalid/unsupported SVG | Server-side validate + whitelist sanitize + 1 retry with error feedback; refund credit on final failure |
| Free-tier abuse | Auth-required, daily quota, per-user rate limit, prompt-hash dedupe cache (serve cached result for identical prompts) |
| Cost surprise at scale | `generation_log.cost_usd` from day one; dashboards; prompt caching; quota tuning |
| Vendor pricing drift (all numbers in §3) | Re-verify at Phase 1 start and before launch; provider abstraction makes swapping cheap |
| Detailed art under-delivers via LLM | That's why the category routes to Recraft/Quiver in Phase 3 — don't ship the category until it's good |
| Prompt-injection via user prompt | User prompt is data, not instructions: constraints live in the system prompt; output is sanitized regardless |
| SVG security (script smuggling) | Whitelist sanitizer + previews rendered as `<img>` data-URIs (inert) + importer drops unknown tags anyway |

---

## 8. Sources

- QuiverAI: [quiver.ai](https://quiver.ai/), [pricing](https://quiver.ai/pricing/), [API quickstart](https://docs.quiver.ai/getting-started/quickstart), [Arrow 1.1 announcement](https://quiver.ai/blog/introducing-arrow-1-1/), [MCP](https://quiver.ai/blog/introducing-quiverai-mcp), [a16z investment](https://a16z.com/announcement/investing-in-quiverai/)
- Recraft: [pricing breakdown](https://checkthat.ai/brands/recraft/pricing), [API per-image cost](https://www.atlascloud.ai/models/recraft-ai/recraft-v3-svg), [2026 review](https://www.svggenie.com/blog/recraft-ai-review-2026)
- Benchmarks: [SVGBench](https://github.com/johnbean393/SVGBench), [SVGenius paper](https://arxiv.org/pdf/2506.03139), [Simon Willison's SVG benchmark notes](https://simonwillison.net/2025/Nov/25/llm-svg-generation-benchmark/)
- Groq pricing: [cloudzero](https://www.cloudzero.com/blog/groq-pricing/), [eesel](https://www.eesel.ai/blog/groq-pricing)
- OpenAI image pricing: [buildmvpfast](https://www.buildmvpfast.com/api-costs/ai-image), [costgoat](https://costgoat.com/pricing/openai-images)
- Gemini pricing: [apidog](https://apidog.com/blog/gemini-3-0-api-cost/), [eesel](https://www.eesel.ai/blog/google-gemini-3-pricing)
- Claude pricing: Anthropic platform docs (verified via claude-api skill, 2026-05-26 cache)
