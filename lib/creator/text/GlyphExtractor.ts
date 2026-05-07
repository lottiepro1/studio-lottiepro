/**
 * GlyphExtractor.ts — Convert font glyphs to Lottie bezier outlines using opentype.js.
 *
 * All glyphs are normalised to size=100; lottie-web scales them by actual_size/100 at
 * render time. Y coordinates are flipped (font y-up → Lottie y-down).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface LottieChar {
    ch: string;      // single character
    fName: string;   // font family name
    size: number;    // always 100 (normalised)
    style: string;   // weight style label, e.g. "Regular", "Bold"
    w: number;       // advance width as percent of size (0–100+)
    data: {
        shapes: any[]; // Lottie shape layer groups
    };
}

// ─── Font cache (URL → parsed font object) ────────────────────────────────────
const fontCache = new Map<string, any>();

async function loadFont(ttfUrl: string): Promise<any> {
    if (fontCache.has(ttfUrl)) return fontCache.get(ttfUrl)!;
    const opentype = (await import('opentype.js')) as any;
    const res = await fetch(ttfUrl);
    if (!res.ok) throw new Error(`[GlyphExtractor] fetch failed for ${ttfUrl}: ${res.status}`);
    const buffer = await res.arrayBuffer();
    const font = opentype.parse(buffer);
    fontCache.set(ttfUrl, font);
    return font;
}

// ─── Path command → Lottie bezier contours ────────────────────────────────────

interface Vertex { x: number; y: number; in: [number, number]; out: [number, number]; }

function commandsToContours(commands: any[], scale: number): Array<{ v: number[][]; i: number[][]; o: number[][]; c: boolean }> {
    const contours: Array<{ v: number[][]; i: number[][]; o: number[][]; c: boolean }> = [];
    let verts: Vertex[] = [];
    let prevX = 0;
    let prevY = 0;
    let startX = 0;
    let startY = 0;

    const flush = () => {
        if (verts.length === 0) return;
        // Drop redundant closing vertex if it duplicates the first
        const last = verts[verts.length - 1];
        const first = verts[0];
        const EPS = 0.01;
        if (verts.length > 1 && Math.abs(last.x - first.x) < EPS && Math.abs(last.y - first.y) < EPS) {
            // Transfer the closing out-tangent to the first vertex's in, then drop last
            first.in = last.in;
            verts.pop();
        }
        if (verts.length < 2) { verts = []; return; }
        contours.push({
            v: verts.map(p => [p.x, p.y]),
            i: verts.map(p => p.in),
            o: verts.map(p => p.out),
            c: true,
        });
        verts = [];
    };

    for (const cmd of commands) {
        switch (cmd.type) {
            case 'M': {
                flush();
                prevX = cmd.x; prevY = cmd.y;
                startX = cmd.x; startY = cmd.y;
                verts.push({ x: cmd.x * scale, y: -cmd.y * scale, in: [0, 0], out: [0, 0] });
                break;
            }
            case 'L': {
                if (verts.length > 0) verts[verts.length - 1].out = [0, 0];
                prevX = cmd.x; prevY = cmd.y;
                verts.push({ x: cmd.x * scale, y: -cmd.y * scale, in: [0, 0], out: [0, 0] });
                break;
            }
            case 'C': {
                // Cubic: C x1 y1 x2 y2 x y
                if (verts.length > 0) {
                    verts[verts.length - 1].out = [
                        (cmd.x1 - prevX) * scale,
                        -(cmd.y1 - prevY) * scale,
                    ];
                }
                prevX = cmd.x; prevY = cmd.y;
                verts.push({
                    x: cmd.x * scale, y: -cmd.y * scale,
                    in: [(cmd.x2 - cmd.x) * scale, -(cmd.y2 - cmd.y) * scale],
                    out: [0, 0],
                });
                break;
            }
            case 'Q': {
                // Quadratic: convert to cubic
                if (verts.length > 0) {
                    verts[verts.length - 1].out = [
                        (2 / 3) * (cmd.x1 - prevX) * scale,
                        -(2 / 3) * (cmd.y1 - prevY) * scale,
                    ];
                }
                prevX = cmd.x; prevY = cmd.y;
                verts.push({
                    x: cmd.x * scale, y: -cmd.y * scale,
                    in: [(2 / 3) * (cmd.x1 - cmd.x) * scale, -(2 / 3) * (cmd.y1 - cmd.y) * scale],
                    out: [0, 0],
                });
                break;
            }
            case 'Z': {
                // Close: if last point is not already at start, add implicit line
                const EPS2 = 0.01 * scale;
                if (verts.length > 0) {
                    const last = verts[verts.length - 1];
                    const dx = Math.abs(last.x - startX * scale);
                    const dy = Math.abs(last.y + startY * scale);
                    if (dx > EPS2 || dy > EPS2) {
                        last.out = [0, 0];
                        verts.push({ x: startX * scale, y: -startY * scale, in: [0, 0], out: [0, 0] });
                    }
                }
                flush();
                prevX = startX; prevY = startY;
                break;
            }
        }
    }
    flush();
    return contours;
}

// ─── Weight → style label ─────────────────────────────────────────────────────
const WEIGHT_STYLE: Record<string, string> = {
    '100': 'Thin', '200': 'ExtraLight', '300': 'Light', '400': 'Regular',
    '500': 'Medium', '600': 'SemiBold', '700': 'Bold', '800': 'ExtraBold', '900': 'Black',
};
function weightToStyle(weight: string): string {
    return WEIGHT_STYLE[weight] ?? 'Regular';
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Extract Lottie glyph data for a set of characters from a font loaded via its TTF URL.
 * Returns one LottieChar per unique character.
 */
export async function extractGlyphs(
    chars: string[],
    fontFamily: string,
    fontWeight: string,
    ttfUrl: string,
): Promise<LottieChar[]> {
    const font = await loadFont(ttfUrl);
    const scale = 100 / font.unitsPerEm;
    const style = weightToStyle(fontWeight);
    const unique = [...new Set(chars)];

    return unique.map(ch => {
        const glyph = font.charToGlyph(ch);
        const path = glyph.getPath(0, 0, font.unitsPerEm); // draw at unitsPerEm size so scale=1 works cleanly
        const commands: any[] = path.commands;
        const contours = commandsToContours(commands, scale);

        const shapePaths = contours.map(c => ({
            ty: 'sh',
            ks: { a: 0, k: { v: c.v, i: c.i, o: c.o, c: c.c } },
        }));

        const shapes: any[] = shapePaths.length > 0
            ? [{
                ty: 'gr',
                nm: ch,
                it: [
                    ...shapePaths,
                    { ty: 'fl', c: { a: 0, k: [0, 0, 0, 1] }, o: { a: 0, k: 100 }, r: 1, nm: 'Fill' },
                    { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
                ],
            }]
            : [];

        const advanceWidth = typeof glyph.advanceWidth === 'number' ? glyph.advanceWidth : font.unitsPerEm;
        const w = (advanceWidth / font.unitsPerEm) * 100;

        return {
            ch,
            fName: fontFamily,
            size: 100,
            style,
            w,
            data: { shapes },
        };
    });
}

/**
 * Given the full scene nodes, collect all text nodes and extract unique glyphs
 * for each (fontFamily, fontWeight) pair. Returns a deduplicated LottieChar[].
 *
 * `getFileUrl(family, weight)` must return the TTF URL or null to skip that font.
 */
export async function extractGlyphsForScene(
    nodes: Map<string, any>,
    getFileUrl: (family: string, weight: string) => string | null,
    onProgress?: (msg: string) => void,
): Promise<LottieChar[]> {
    // Collect unique (family, weight, char) combos across all text nodes
    const fontCharMap = new Map<string, Set<string>>(); // key: "family|weight"

    for (const node of nodes.values()) {
        if (node.type !== 'text') continue;
        const family = node.props?.fontFamily || 'Inter';
        const weight = String(node.props?.fontWeight || '400');
        const text = node.props?.text || '';
        const key = `${family}|${weight}`;
        if (!fontCharMap.has(key)) fontCharMap.set(key, new Set());
        for (const ch of text) {
            if (ch.trim()) fontCharMap.get(key)!.add(ch);
        }
    }

    const allChars: LottieChar[] = [];
    const seen = new Set<string>(); // "family|weight|ch" — dedup across nodes

    for (const [key, charSet] of fontCharMap) {
        const [family, weight] = key.split('|');
        const url = getFileUrl(family, weight);
        if (!url) {
            console.warn(`[GlyphExtractor] No TTF URL for ${family} ${weight} — skipping`);
            onProgress?.(`Skipping ${family} ${weight} (no TTF URL)`);
            continue;
        }

        onProgress?.(`Extracting glyphs for ${family} ${weight}…`);
        try {
            const chars = [...charSet].filter(ch => !seen.has(`${key}|${ch}`));
            const extracted = await extractGlyphs(chars, family, weight, url);
            for (const lc of extracted) {
                seen.add(`${key}|${lc.ch}`);
                allChars.push(lc);
            }
        } catch (err) {
            console.warn(`[GlyphExtractor] Failed for ${family} ${weight}:`, err);
            onProgress?.(`Failed: ${family} ${weight}`);
        }
    }

    return allChars;
}
