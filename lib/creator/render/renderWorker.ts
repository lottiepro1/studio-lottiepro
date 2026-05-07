/**
 * renderWorker.ts — Web Worker for off-main-thread canvas rendering.
 * 
 * This worker receives an OffscreenCanvas and serialized scene data,
 * then uses CanvasRenderer to draw frames without blocking the main thread.
 * 
 * Performance: Supports two render message types:
 * - 'render': Full snapshot — deserializes and sets the full node map
 * - 'renderFrame': Lightweight — reuses existing nodes, only updates render params
 *   This avoids deserializing ~500KB of node data every frame during playback.
 */

import { CanvasRenderer, RenderingContext } from './CanvasRenderer';
import { SceneNode } from '../state/sceneSlice';

let renderer: CanvasRenderer | null = null;
let canvas: OffscreenCanvas | null = null;

// Deserialize a plain object map back into a Map<string, SceneNode>
function deserializeNodes(data: Record<string, SceneNode>): Map<string, SceneNode> {
    const map = new Map<string, SceneNode>();
    for (const key in data) {
        map.set(key, data[key]);
    }
    return map;
}

// Deserialize a DOMMatrix from its 6 values
function deserializeMatrix(m: { a: number; b: number; c: number; d: number; e: number; f: number }): DOMMatrix {
    return new DOMMatrix([m.a, m.b, m.c, m.d, m.e, m.f]);
}

// Tracks font families already loaded (or in-flight) in this worker context.
const workerLoadedFonts = new Set<string>();

/**
 * Fetch a Google Fonts CSS URL, extract the first woff2 src URL, and load the
 * font into this worker's FontFaceSet so OffscreenCanvas can use it.
 */
async function loadFontInWorker(family: string, cssHref: string): Promise<void> {
    if (workerLoadedFonts.has(family)) return;
    workerLoadedFonts.add(family);

    try {
        const cssText = await fetch(cssHref).then(r => r.text());

        // Extract all @font-face blocks and load each into the worker's FontFaceSet.
        // Critical: include unicode-range so the browser picks the right subset file
        // for each character (e.g. latin file for "A", cyrillic file for "Я").
        // Without it, the browser picks the first registered face (often cyrillic-ext)
        // for ALL characters, causing Latin glyphs to fall back to the system font.
        const seenUrls = new Set<string>();
        const blockRegex = /@font-face\s*\{([^}]+)\}/g;
        const loadPromises: Promise<void>[] = [];
        let block: RegExpExecArray | null;

        while ((block = blockRegex.exec(cssText)) !== null) {
            const blockText = block[1];
            const srcMatch = blockText.match(/url\(['"]?([^'")\s]+\.woff2)['"]?\)/);
            // Support single weight ("100") and variable font ranges ("300 800")
            const weightMatch = blockText.match(/font-weight:\s*([\d]+(?:\s+[\d]+)?)/);
            const unicodeRangeMatch = blockText.match(/unicode-range:\s*([^;]+)/);
            if (!srcMatch) continue;

            const fontUrl = srcMatch[1];
            if (seenUrls.has(fontUrl)) continue;
            seenUrls.add(fontUrl);

            const weight = weightMatch ? weightMatch[1].trim() : '400';
            const descriptors: FontFaceDescriptors = { weight };
            if (unicodeRangeMatch) descriptors.unicodeRange = unicodeRangeMatch[1].trim();

            // Wrap each file in its own try/catch so one failing subset (e.g. a
            // slow gstatic.com request) does NOT cancel the entire font family.
            // Roboto has 6 weights × 7 subsets = 42 files; a single failure was
            // rejecting Promise.all, leaving the worker with zero fonts loaded and
            // workerLoadedFonts marking it "done" with no retry possible.
            try {
                const face = new FontFace(family, `url(${fontUrl})`, descriptors);
                loadPromises.push(
                    face.load()
                        .then(loaded => { (self as any).fonts.add(loaded); })
                        .catch(() => { /* subset failed — others continue */ })
                );
            } catch {
                // FontFace constructor threw (invalid descriptor) — skip this block.
            }
        }

        // Wait for all pending downloads. Individual failures are already swallowed above.
        await Promise.all(loadPromises);

        // Notify main thread regardless of partial failures — at least some weights
        // should be loaded, so re-rendering will show the correct font.
        self.postMessage({ type: 'fontLoaded', family });
    } catch (err) {
        // CSS fetch failed — remove from the loaded set so a future call can retry.
        workerLoadedFonts.delete(family);
        console.warn('[Worker] Font CSS fetch failed for', family, err);
    }
}

self.onmessage = (e: MessageEvent) => {
    const { type, payload } = e.data;

    switch (type) {
        case 'init': {
            // Receive the OffscreenCanvas transferred from main thread
            canvas = payload.canvas as OffscreenCanvas;
            const ctx = canvas.getContext('2d') as RenderingContext;
            if (ctx) {
                renderer = new CanvasRenderer(ctx);
            }
            break;
        }

        case 'resize': {
            if (canvas) {
                canvas.width = payload.width;
                canvas.height = payload.height;
            }
            break;
        }

        case 'loadFont': {
            // Load a font into the worker's FontFaceSet so OffscreenCanvas can use it.
            loadFontInWorker(payload.family, payload.cssHref);
            break;
        }

        case 'render': {
            // Full snapshot: deserialize nodes and render
            if (!renderer || !canvas) return;

            const {
                nodes: serializedNodes,
                rootId,
                viewTransform: vtData,
                currentTime,
                editingNodeId,
                textEditingId,
                selectedIds = null,
                skipLottieContent = false
            } = payload;

            // Reconstruct the Map and DOMMatrix
            const nodes = deserializeNodes(serializedNodes);
            const viewTransform = deserializeMatrix(vtData);

            renderer.setNodes(nodes);
            renderer.render(rootId, viewTransform, currentTime, editingNodeId, textEditingId, selectedIds, skipLottieContent);

            // Signal render complete (optional, for perf measurement)
            self.postMessage({ type: 'renderComplete', timestamp: performance.now() });
            break;
        }

        case 'renderFrame': {
            // Lightweight render: reuse existing nodes, only update render params
            // This is the hot path during animation playback
            if (!renderer || !canvas) return;

            const {
                rootId,
                viewTransform: vtData,
                currentTime,
                editingNodeId,
                textEditingId,
                selectedIds = null,
                skipLottieContent = false
            } = payload;

            const viewTransform = deserializeMatrix(vtData);

            // Nodes are already set from the last 'render' message — just render
            renderer.render(rootId, viewTransform, currentTime, editingNodeId, textEditingId, selectedIds, skipLottieContent);

            self.postMessage({ type: 'renderComplete', timestamp: performance.now() });
            break;
        }
    }
};
