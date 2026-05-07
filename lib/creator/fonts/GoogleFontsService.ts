// Google Fonts API service — REST API for metadata, CSS API for loading.
// Falls back to a curated built-in list if the API key is missing or the request fails.

export interface FontAxis {
  tag: string;
  min: number;
  max: number;
  defaultValue: number;
}

export interface GoogleFontFamily {
  family: string;
  category: 'sans-serif' | 'serif' | 'display' | 'handwriting' | 'monospace';
  variants: string[];   // numeric weight strings: "100", "300", "400", "700", etc.
  subsets: string[];
  axes?: FontAxis[];    // only present for variable fonts
  files?: Record<string, string>; // TTF file URLs keyed by variant ("regular", "700", etc.) — populated from REST API only
}

// ─── Weight labels ────────────────────────────────────────────────────────────
const WEIGHT_LABELS: Record<string, string> = {
  '100': 'Thin', '200': 'Extra Light', '300': 'Light', '400': 'Regular',
  '500': 'Medium', '600': 'Semi Bold', '700': 'Bold', '800': 'Extra Bold', '900': 'Black',
};

export function weightLabel(w: string): string {
  return WEIGHT_LABELS[w] ?? w;
}

// ─── Normalize Google Fonts variant strings ───────────────────────────────────
// The API returns "regular" for 400 and "italic" for 400italic; filter out italic variants.
function normalizeVariants(raw: string[]): string[] {
  const weights = new Set<string>();
  for (const v of raw) {
    if (v === 'regular') { weights.add('400'); continue; }
    if (v === 'italic') continue;
    const m = v.match(/^(\d+)(?:italic)?$/);
    if (m && !v.endsWith('italic')) weights.add(m[1]);
  }
  return [...weights].sort((a, b) => Number(a) - Number(b));
}

// ─── Fallback font list ───────────────────────────────────────────────────────
// Used when the API key is absent or the request fails.
// Variable fonts are marked with axes[].
const FALLBACK_FONTS_RAW = [
  // Sans-serif
  { family: 'Inter', category: 'sans-serif', variants: ['100','200','300','400','500','600','700','800','900'], subsets: ['latin'], axes: [{ tag: 'wght', min: 100, max: 900, defaultValue: 400 }] },
  { family: 'Roboto', category: 'sans-serif', variants: ['100','300','400','500','700','900'], subsets: ['latin','cyrillic'] },
  { family: 'Open Sans', category: 'sans-serif', variants: ['300','400','500','600','700','800'], subsets: ['latin'], axes: [{ tag: 'wght', min: 300, max: 800, defaultValue: 400 }] },
  { family: 'Noto Sans', category: 'sans-serif', variants: ['100','200','300','400','500','600','700','800','900'], subsets: ['latin'], axes: [{ tag: 'wght', min: 100, max: 900, defaultValue: 400 }] },
  { family: 'Lato', category: 'sans-serif', variants: ['100','300','400','700','900'], subsets: ['latin'] },
  { family: 'Montserrat', category: 'sans-serif', variants: ['100','200','300','400','500','600','700','800','900'], subsets: ['latin'], axes: [{ tag: 'wght', min: 100, max: 900, defaultValue: 400 }] },
  { family: 'Poppins', category: 'sans-serif', variants: ['100','200','300','400','500','600','700','800','900'], subsets: ['latin'] },
  { family: 'Nunito', category: 'sans-serif', variants: ['200','300','400','500','600','700','800','900'], subsets: ['latin'], axes: [{ tag: 'wght', min: 200, max: 1000, defaultValue: 400 }] },
  { family: 'Ubuntu', category: 'sans-serif', variants: ['300','400','500','700'], subsets: ['latin'] },
  { family: 'Raleway', category: 'sans-serif', variants: ['100','200','300','400','500','600','700','800','900'], subsets: ['latin'], axes: [{ tag: 'wght', min: 100, max: 900, defaultValue: 400 }] },
  { family: 'Work Sans', category: 'sans-serif', variants: ['100','200','300','400','500','600','700','800','900'], subsets: ['latin'], axes: [{ tag: 'wght', min: 100, max: 900, defaultValue: 400 }] },
  { family: 'Oswald', category: 'sans-serif', variants: ['200','300','400','500','600','700'], subsets: ['latin'], axes: [{ tag: 'wght', min: 200, max: 700, defaultValue: 400 }] },
  { family: 'Outfit', category: 'sans-serif', variants: ['100','200','300','400','500','600','700','800','900'], subsets: ['latin'], axes: [{ tag: 'wght', min: 100, max: 900, defaultValue: 400 }] },
  { family: 'Plus Jakarta Sans', category: 'sans-serif', variants: ['200','300','400','500','600','700','800'], subsets: ['latin'], axes: [{ tag: 'wght', min: 200, max: 800, defaultValue: 400 }] },
  { family: 'Space Grotesk', category: 'sans-serif', variants: ['300','400','500','600','700'], subsets: ['latin'], axes: [{ tag: 'wght', min: 300, max: 700, defaultValue: 400 }] },
  { family: 'DM Sans', category: 'sans-serif', variants: ['100','200','300','400','500','600','700'], subsets: ['latin'], axes: [{ tag: 'wght', min: 100, max: 700, defaultValue: 400 }] },
  { family: 'Rubik', category: 'sans-serif', variants: ['300','400','500','600','700','800','900'], subsets: ['latin'], axes: [{ tag: 'wght', min: 300, max: 900, defaultValue: 400 }] },
  { family: 'Mukta', category: 'sans-serif', variants: ['200','300','400','500','600','700','800'], subsets: ['latin'] },
  { family: 'Kanit', category: 'sans-serif', variants: ['100','200','300','400','500','600','700','800','900'], subsets: ['latin','thai'] },
  { family: 'Heebo', category: 'sans-serif', variants: ['100','200','300','400','500','600','700','800','900'], subsets: ['latin','hebrew'], axes: [{ tag: 'wght', min: 100, max: 900, defaultValue: 400 }] },
  { family: 'Quicksand', category: 'sans-serif', variants: ['300','400','500','600','700'], subsets: ['latin'], axes: [{ tag: 'wght', min: 300, max: 700, defaultValue: 400 }] },
  { family: 'Catamaran', category: 'sans-serif', variants: ['100','200','300','400','500','600','700','800','900'], subsets: ['latin'], axes: [{ tag: 'wght', min: 100, max: 900, defaultValue: 400 }] },
  { family: 'Exo 2', category: 'sans-serif', variants: ['100','200','300','400','500','600','700','800','900'], subsets: ['latin'], axes: [{ tag: 'wght', min: 100, max: 900, defaultValue: 400 }] },
  { family: 'Josefin Sans', category: 'sans-serif', variants: ['100','200','300','400','500','600','700'], subsets: ['latin'], axes: [{ tag: 'wght', min: 100, max: 700, defaultValue: 400 }] },
  { family: 'Hind', category: 'sans-serif', variants: ['300','400','500','600','700'], subsets: ['latin'] },
  { family: 'Nunito Sans', category: 'sans-serif', variants: ['200','300','400','600','700','800','900'], subsets: ['latin'], axes: [{ tag: 'wght', min: 200, max: 900, defaultValue: 400 }] },
  { family: 'Cairo', category: 'sans-serif', variants: ['200','300','400','500','600','700','800','900'], subsets: ['latin','arabic'], axes: [{ tag: 'wght', min: 200, max: 1000, defaultValue: 400 }] },
  { family: 'Arimo', category: 'sans-serif', variants: ['400','500','600','700'], subsets: ['latin'], axes: [{ tag: 'wght', min: 400, max: 700, defaultValue: 400 }] },
  { family: 'Figtree', category: 'sans-serif', variants: ['300','400','500','600','700','800','900'], subsets: ['latin'], axes: [{ tag: 'wght', min: 300, max: 900, defaultValue: 400 }] },
  { family: 'Karla', category: 'sans-serif', variants: ['200','300','400','500','600','700','800'], subsets: ['latin'], axes: [{ tag: 'wght', min: 200, max: 800, defaultValue: 400 }] },
  // Serif
  { family: 'Merriweather', category: 'serif', variants: ['300','400','700','900'], subsets: ['latin'] },
  { family: 'Playfair Display', category: 'serif', variants: ['400','500','600','700','800','900'], subsets: ['latin'], axes: [{ tag: 'wght', min: 400, max: 900, defaultValue: 400 }] },
  { family: 'Lora', category: 'serif', variants: ['400','500','600','700'], subsets: ['latin'], axes: [{ tag: 'wght', min: 400, max: 700, defaultValue: 400 }] },
  { family: 'PT Serif', category: 'serif', variants: ['400','700'], subsets: ['latin','cyrillic'] },
  { family: 'Libre Baskerville', category: 'serif', variants: ['400','700'], subsets: ['latin'] },
  { family: 'Crimson Text', category: 'serif', variants: ['400','600','700'], subsets: ['latin'] },
  { family: 'EB Garamond', category: 'serif', variants: ['400','500','600','700','800'], subsets: ['latin'], axes: [{ tag: 'wght', min: 400, max: 800, defaultValue: 400 }] },
  { family: 'Noto Serif', category: 'serif', variants: ['100','200','300','400','500','600','700','800','900'], subsets: ['latin'], axes: [{ tag: 'wght', min: 100, max: 900, defaultValue: 400 }] },
  { family: 'Source Serif 4', category: 'serif', variants: ['200','300','400','500','600','700','800','900'], subsets: ['latin'], axes: [{ tag: 'wght', min: 200, max: 900, defaultValue: 400 }] },
  { family: 'Bree Serif', category: 'serif', variants: ['400'], subsets: ['latin'] },
  { family: 'Cormorant Garamond', category: 'serif', variants: ['300','400','500','600','700'], subsets: ['latin'] },
  { family: 'Alegreya', category: 'serif', variants: ['400','500','700','800','900'], subsets: ['latin'] },
  { family: 'Bitter', category: 'serif', variants: ['100','200','300','400','500','600','700','800','900'], subsets: ['latin'], axes: [{ tag: 'wght', min: 100, max: 900, defaultValue: 400 }] },
  // Monospace
  { family: 'Roboto Mono', category: 'monospace', variants: ['100','200','300','400','500','600','700'], subsets: ['latin'], axes: [{ tag: 'wght', min: 100, max: 700, defaultValue: 400 }] },
  { family: 'Source Code Pro', category: 'monospace', variants: ['200','300','400','500','600','700','800','900'], subsets: ['latin'], axes: [{ tag: 'wght', min: 200, max: 900, defaultValue: 400 }] },
  { family: 'Fira Code', category: 'monospace', variants: ['300','400','500','600','700'], subsets: ['latin'], axes: [{ tag: 'wght', min: 300, max: 700, defaultValue: 400 }] },
  { family: 'JetBrains Mono', category: 'monospace', variants: ['100','200','300','400','500','600','700','800'], subsets: ['latin'], axes: [{ tag: 'wght', min: 100, max: 800, defaultValue: 400 }] },
  { family: 'Space Mono', category: 'monospace', variants: ['400','700'], subsets: ['latin'] },
  { family: 'Ubuntu Mono', category: 'monospace', variants: ['400','700'], subsets: ['latin'] },
  { family: 'Inconsolata', category: 'monospace', variants: ['200','300','400','500','600','700','800','900'], subsets: ['latin'], axes: [{ tag: 'wght', min: 200, max: 900, defaultValue: 400 }] },
  { family: 'Courier Prime', category: 'monospace', variants: ['400','700'], subsets: ['latin'] },
  { family: 'Noto Sans Mono', category: 'monospace', variants: ['100','200','300','400','500','600','700','800','900'], subsets: ['latin'], axes: [{ tag: 'wght', min: 100, max: 900, defaultValue: 400 }] },
  // Display
  { family: 'Bebas Neue', category: 'display', variants: ['400'], subsets: ['latin'] },
  { family: 'Anton', category: 'display', variants: ['400'], subsets: ['latin'] },
  { family: 'Righteous', category: 'display', variants: ['400'], subsets: ['latin'] },
  { family: 'Abril Fatface', category: 'display', variants: ['400'], subsets: ['latin'] },
  { family: 'Bangers', category: 'display', variants: ['400'], subsets: ['latin'] },
  { family: 'Fredoka One', category: 'display', variants: ['400'], subsets: ['latin'] },
  { family: 'Black Han Sans', category: 'display', variants: ['400'], subsets: ['latin'] },
  { family: 'Bungee', category: 'display', variants: ['400'], subsets: ['latin'] },
  { family: 'Russo One', category: 'display', variants: ['400'], subsets: ['latin'] },
  { family: 'Press Start 2P', category: 'display', variants: ['400'], subsets: ['latin'] },
  // Handwriting
  { family: 'Dancing Script', category: 'handwriting', variants: ['400','500','600','700'], subsets: ['latin'], axes: [{ tag: 'wght', min: 400, max: 700, defaultValue: 400 }] },
  { family: 'Pacifico', category: 'handwriting', variants: ['400'], subsets: ['latin'] },
  { family: 'Caveat', category: 'handwriting', variants: ['400','500','600','700'], subsets: ['latin'], axes: [{ tag: 'wght', min: 400, max: 700, defaultValue: 400 }] },
  { family: 'Shadows Into Light', category: 'handwriting', variants: ['400'], subsets: ['latin'] },
  { family: 'Comfortaa', category: 'handwriting', variants: ['300','400','500','600','700'], subsets: ['latin'], axes: [{ tag: 'wght', min: 300, max: 700, defaultValue: 400 }] },
  { family: 'Lobster', category: 'handwriting', variants: ['400'], subsets: ['latin'] },
  { family: 'Patrick Hand', category: 'handwriting', variants: ['400'], subsets: ['latin'] },
  { family: 'Satisfy', category: 'handwriting', variants: ['400'], subsets: ['latin'] },
  { family: 'Kalam', category: 'handwriting', variants: ['300','400','700'], subsets: ['latin'] },
  { family: 'Permanent Marker', category: 'handwriting', variants: ['400'], subsets: ['latin'] },
  { family: 'Courgette', category: 'handwriting', variants: ['400'], subsets: ['latin'] },
];
const FALLBACK_FONTS: GoogleFontFamily[] = (FALLBACK_FONTS_RAW as GoogleFontFamily[]).sort((a, b) => a.family.localeCompare(b.family));

// ─── Cache ────────────────────────────────────────────────────────────────────
const CACHE_KEY = 'gf_catalogue_v1';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry {
  ts: number;
  fonts: GoogleFontFamily[];
}

function readCache(): GoogleFontFamily[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (Date.now() - entry.ts > CACHE_TTL) return null;
    return entry.fonts;
  } catch {
    return null;
  }
}

function writeCache(fonts: GoogleFontFamily[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), fonts }));
  } catch {
    // localStorage quota exceeded — ignore
  }
}

// ─── Fetch from REST API ──────────────────────────────────────────────────────
async function fetchFromAPI(apiKey: string): Promise<GoogleFontFamily[]> {
  const url = `https://www.googleapis.com/webfonts/v1/webfonts?key=${apiKey}&sort=popularity`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google Fonts API ${res.status}`);
  const data = await res.json();

  return (data.items ?? []).map((item: any): GoogleFontFamily => {
    const axes: FontAxis[] = (item.axes ?? []).map((ax: any) => ({
      tag: ax.tag,
      min: ax.start ?? ax.min ?? 0,
      max: ax.end ?? ax.max ?? 900,
      defaultValue: ax.defaultValue ?? ((ax.start ?? 0) + (ax.end ?? 900)) / 2,
    }));

    return {
      family: item.family,
      category: item.category ?? 'sans-serif',
      variants: normalizeVariants(item.variants ?? []),
      subsets: item.subsets ?? ['latin'],
      ...(axes.length > 0 ? { axes } : {}),
      ...(item.files ? { files: item.files as Record<string, string> } : {}),
    };
  });
}

// ─── Singleton state ──────────────────────────────────────────────────────────
let catalogue: GoogleFontFamily[] = FALLBACK_FONTS;
let loadPromise: Promise<void> | null = null;
const loadedCSSFamilies = new Set<string>(); // tracks injected link tags

// ─── Public API ───────────────────────────────────────────────────────────────

/** Initialise the catalogue. Call once on app start (or on first FontPicker open). */
export async function initGoogleFonts(): Promise<void> {
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    // 1. Try localStorage cache first
    const cached = readCache();
    if (cached && cached.length > 0) {
      catalogue = cached;
      return;
    }

    // 2. Try REST API
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_FONTS_API_KEY;
    if (apiKey) {
      try {
        const fonts = await fetchFromAPI(apiKey);
        if (fonts.length > 0) {
          catalogue = fonts;
          writeCache(fonts);
          return;
        }
      } catch (err) {
        console.warn('[GoogleFonts] REST API failed, using fallback:', err);
      }
    }

    // 3. Fallback — built-in list (already set as default)
  })();

  return loadPromise;
}

/** Returns the full font catalogue, sorted by popularity (API) or alphabetically (fallback). */
export function getFonts(): GoogleFontFamily[] {
  return catalogue;
}

/** Filter fonts by search query and optional category. */
export function searchFonts(query: string, category?: string): GoogleFontFamily[] {
  const q = query.toLowerCase().trim();
  return catalogue.filter(f => {
    if (category && category !== 'all' && f.category !== category) return false;
    if (q && !f.family.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Look up a single font by family name. */
export function getFontByFamily(family: string): GoogleFontFamily | undefined {
  return catalogue.find(f => f.family === family);
}

/** Returns the wght axis if this is a variable font, otherwise undefined. */
export function getWeightAxis(family: string): FontAxis | undefined {
  const font = getFontByFamily(family);
  return font?.axes?.find(ax => ax.tag === 'wght');
}

/** True if the font has a wght variable axis. */
export function isVariableFont(family: string): boolean {
  return !!getWeightAxis(family);
}

/** Returns available numeric weight strings for a font.
 *  For variable fonts, generates standard named steps (100..900) within the axis range.
 *  For discrete fonts, returns the declared variant weights.
 */
export function getAvailableWeights(family: string): string[] {
  const font = getFontByFamily(family);
  if (!font) return ['400'];
  const wghtAxis = getWeightAxis(family);
  if (wghtAxis) {
    const steps = ['100', '200', '300', '400', '500', '600', '700', '800', '900'];
    return steps.filter(w => Number(w) >= wghtAxis.min && Number(w) <= wghtAxis.max);
  }
  return font.variants ?? ['400'];
}

/** Dispatched on window when a font is fully loaded and usable by Canvas 2D. */
export const GF_FONT_READY_EVENT = 'gf-font-ready';

/**
 * Inject a Google Fonts CSS <link> tag for a specific family.
 * For variable fonts, loads the full wght range.
 * For fixed fonts, loads all available weights.
 * Safe to call multiple times — deduplicates by family.
 *
 * Fires a `gf-font-ready` CustomEvent on window when the font is confirmed
 * loaded and usable by Canvas 2D (after CSS parse + font file download).
 */
export function loadFontCSS(family: string, forceReload = false): void {
  if (!forceReload && loadedCSSFamilies.has(family)) return;
  loadedCSSFamilies.add(family);

  const font = getFontByFamily(family);
  const wghtAxis = font?.axes?.find(ax => ax.tag === 'wght');
  const encoded = family.replace(/\s+/g, '+');

  let familyParam: string;
  if (wghtAxis) {
    familyParam = `${encoded}:wght@${wghtAxis.min}..${wghtAxis.max}`;
  } else {
    const weights = font?.variants?.join(';') ?? '400';
    familyParam = `${encoded}:wght@${weights}`;
  }

  const linkId = `gf-${family.replace(/\s+/g, '-')}`;
  const existingLink = document.getElementById(linkId) as HTMLLinkElement | null;
  if (existingLink) {
    // Link already exists — include cssHref so the worker can still load the font
    // if it hasn't done so yet (e.g. race condition on first load).
    const existingHref = existingLink.href;
    const firstWeight = font?.variants?.[0] ?? '400';
    document.fonts.load(`${firstWeight} 12px "${family}"`).then(() => {
      window.dispatchEvent(new CustomEvent(GF_FONT_READY_EVENT, { detail: { family, cssHref: existingHref } }));
    });
    return;
  }

  const link = document.createElement('link');
  link.id = linkId;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${familyParam}&display=swap`;

  // Wait for CSS to load (so @font-face rules are registered), then wait for
  // the font file itself to download before notifying the canvas to re-render.
  const cssHref = link.href;

  link.onload = () => {
    // @font-face rules are now registered — safe to call document.fonts.load().
    // Use the font's first declared weight (not hardcoded 400) so fonts without a 400
    // variant (e.g. a display font with only 700) still resolve correctly.
    const firstWeight = font?.variants?.[0] ?? '400';
    document.fonts.load(`${firstWeight} 12px "${family}"`).then(() => {
      // Include cssHref so callers can forward the CSS URL to Web Workers for their own font loading.
      window.dispatchEvent(new CustomEvent(GF_FONT_READY_EVENT, { detail: { family, cssHref } }));
    });
  };
  link.onerror = () => {
    window.dispatchEvent(new CustomEvent(GF_FONT_READY_EVENT, { detail: { family, cssHref } }));
  };

  document.head.appendChild(link);
}

/** Pre-load a set of fonts (e.g. all fonts used in the current scene). */
export function preloadFonts(families: string[]): void {
  for (const f of families) loadFontCSS(f);
}

/**
 * Return the TTF file URL for a given family and weight, or null if unavailable.
 * File URLs are only present when the catalogue was loaded from the Google Fonts REST API.
 * The API uses "regular" as the key for weight 400; other weights use the numeric string.
 */
export function getFontFileUrl(family: string, weight: string = '400'): string | null {
  const font = getFontByFamily(family);
  if (!font?.files) return null;
  // Weight 400 may be stored as "regular"
  const candidates = weight === '400' ? ['regular', '400'] : [weight];
  for (const k of candidates) {
    if (k in font.files) return font.files[k];
  }
  return null;
}
