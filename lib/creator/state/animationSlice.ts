import { StateCreator } from 'zustand';
import { SceneSlice, SceneNode } from './sceneSlice';
import { AnimationUtils } from '../core/Animation';
import { CreatorStore } from './types';
import { getPathLocalBounds, getAnimatedAnchor } from '../core/Matrix';
import { measureFontAscent } from '../text/TextMeasurer';

export interface Keyframe {
    id: string;
    time: number; // In frames
    value: any;
    easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'bezier';
    bezier?: [number, number, number, number]; // [p1x, p1y, p2x, p2y]
    spatialIn?: { x: number, y: number };  // Handle relative to keyframe position
    spatialOut?: { x: number, y: number }; // Handle relative to keyframe position
}

export interface FlowBlock {
    id: string;
    name: string;
    startFrame: number;
    endFrame: number;
    loop: boolean;
}

export interface AnimationSlice {
    currentTime: number;
    isPlaying: boolean;
    isLooping: boolean;
    fps: number;
    duration: number;
    workAreaStart: number | null; // start bounds for playback loop
    workAreaEnd: number | null;   // end bounds for playback loop
    zoomLevel: number;
    selectedKeyframeIds: string[];
    trackVisibility: Record<string, string[]>; // nodeId -> list of property paths shown
    expandedNodes: Record<string, boolean>;
    expandedShapeGroups: Record<string, boolean>;
    flowBlocks: FlowBlock[];
    // Original Lottie JSON stored on import — used for ThorVG/dotlottie-web playback
    rawAnimationSource: any | null;
    setRawAnimationSource: (source: any | null) => void;

    // Lottie JSON cache — mutable deep copy of rawAnimationSource, surgically patched on edits.
    // Eliminates full LottieExporter.export() traversal on every SceneNode change.
    lottieJsonCache: any | null;
    // Maps nodeId → { layers array ref inside lottieJsonCache, array index }
    lottieLayerMap: Map<string, { layers: any[]; index: number }> | null;
    // True after patchLottieNode mutates the cache, until ThorVG confirms reload via 'load' event.
    // CanvasView uses this to hide ThorVG (display:none) during the reload window.
    lottieNeedsReload: boolean;
    buildLottieCache: () => void;
    patchLottieNode: (nodeId: string) => void;
    setLottieNeedsReload: (v: boolean) => void;

    // Phase 4.1 — The Lottie JSON that ThorVG is currently rendering.
    // Published by DotLottiePlayback after each successful ThorVG load event.
    // This is the single source of truth for what the renderer has; future surgical-patch
    // steps (4.2+) mutate this object directly instead of calling LottieExporter.export().
    lottieModel: Record<string, unknown> | null;
    setLottieModel: (data: Record<string, unknown> | null) => void;

    // Phase 4.2 — Index of nodeId → layer object ref inside lottieModel.layers.
    // Built by setLottieModel from the _nodeId field injected by LottieExporter into each layer.
    // Surgical patch steps (4.3+) use this to mutate the live Lottie model without re-exporting.
    lottieNodeMap: Map<string, Record<string, unknown>> | null;

    // Phase 4.7 — Incremented only on structural changes (node add/delete/move/group).
    // DotLottiePlayback skips LottieExporter.export() when this hasn't changed since the last
    // full load, using lottieModel directly instead (surgical patches kept it current).
    structureChangeCounter: number;

    setCurrentTime: (time: number) => void;
    togglePlaying: () => void;
    toggleLooping: () => void;
    setPlaying: (playing: boolean) => void;
    setDuration: (duration: number) => void;
    setWorkArea: (start: number | null, end: number | null) => void;
    setFps: (fps: number) => void;
    setZoomLevel: (zoom: number) => void;

    // Flow Blocks actions
    addFlowBlock: (block: Omit<FlowBlock, 'id'>) => void;
    updateFlowBlock: (id: string, updates: Partial<FlowBlock>) => void;
    deleteFlowBlock: (id: string) => void;

    // Track actions
    toggleTrackVisibility: (nodeId: string, propertyPath: string) => void;
    toggleStopwatch: (nodeId: string, propertyPath: string) => void;
    toggleNodeExpand: (nodeId: string, force?: boolean) => void;
    toggleShapeGroupExpand: (nodeId: string, force?: boolean) => void;

    // Keyframe actions
    addKeyframe: (nodeId: string, propertyPath: string, time: number, value: any) => void;
    removeKeyframe: (nodeId: string, propertyPath: string, keyframeId: string) => void;
    updateKeyframe: (nodeId: string, propertyPath: string, keyframeId: string, updates: Partial<Keyframe>, options?: { recordHistory?: boolean }) => void;
    selectKeyframes: (ids: string[], multi?: boolean) => void;
    deleteSelectedKeyframes: () => void;
    setNodeProperty: (nodeId: string, propertyPath: string, value: any, options?: { ignoreLink?: boolean, recordHistory?: boolean }) => void;
    setNodeProperties: (nodeId: string, updates: Record<string, any>, options?: { ignoreLink?: boolean, recordHistory?: boolean, ignoreAnimation?: boolean }) => void;
    ensureExpansion: (nodeId: string, propertyPath: string) => void;
    showAnimatedProperties: (nodeId: string) => void;
    shiftLayers: (nodeIds: string[], deltaFrames: number) => void;
}

// Defaults matching what the renderer applies via `?? default` when a style property is unset.
// When a keyframe is created for an unset property, we store these defaults so interpolation
// between keyframes produces correct in-between values instead of snapping to the static value.
const PROP_DEFAULTS: Record<string, number> = {
    'style.trimStart': 0,
    'style.trimEnd': 1,
    'style.trimOffset': 0,
    'style.opacity': 1,
    'style.fillOpacity': 1,
    'style.strokeOpacity': 1,
};

function safeKfValue(val: any, propertyPath: string): any {
    if (typeof val === 'number' && isNaN(val)) return 0;
    if (val !== undefined && val !== null) return val;
    return propertyPath in PROP_DEFAULTS ? PROP_DEFAULTS[propertyPath] : val;
}

export const createAnimationSlice: StateCreator<CreatorStore, [["zustand/immer", never]], [], AnimationSlice> = (set, get) => ({
    currentTime: 0,
    isPlaying: false,
    isLooping: true, // Default to true for better UX
    fps: 60,
    duration: 300, // 5 seconds default
    workAreaStart: null,
    workAreaEnd: null,
    zoomLevel: 1,
    selectedKeyframeIds: [],
    trackVisibility: {},
    expandedNodes: {},
    expandedShapeGroups: {},
    flowBlocks: [],
    rawAnimationSource: null,
    lottieJsonCache: null,
    lottieLayerMap: null,
    lottieNeedsReload: false,
    lottieModel: null,
    lottieNodeMap: null,
    structureChangeCounter: 0,

    setRawAnimationSource: (source) => {
        if (!source) {
            set({ rawAnimationSource: null, lottieJsonCache: null, lottieLayerMap: null });
        } else {
            set({ rawAnimationSource: source });
        }
    },

    buildLottieCache: () => {
        const state = get();
        if (!state.rawAnimationSource) return;

        const cache = JSON.parse(JSON.stringify(state.rawAnimationSource));

        // Index main-composition layers by ind value
        const mainByInd = new Map<number, { layers: any[]; index: number }>();
        if (Array.isArray(cache.layers)) {
            cache.layers.forEach((layer: any, i: number) => {
                if (layer.ind !== undefined) mainByInd.set(layer.ind, { layers: cache.layers, index: i });
            });
        }

        // Index precomp asset layers by assetId → ind
        const assetByIdByInd = new Map<string, Map<number, { layers: any[]; index: number }>>();
        if (Array.isArray(cache.assets)) {
            cache.assets.forEach((asset: any) => {
                if (!Array.isArray(asset.layers)) return;
                const byInd = new Map<number, { layers: any[]; index: number }>();
                asset.layers.forEach((layer: any, i: number) => {
                    if (layer.ind !== undefined) byInd.set(layer.ind, { layers: asset.layers, index: i });
                });
                assetByIdByInd.set(asset.id, byInd);
            });
        }

        // Walk store nodes, match those with _rawLottieData to their cache entry
        const layerMap = new Map<string, { layers: any[]; index: number }>();
        state.nodes.forEach((node, nodeId) => {
            if (!node._rawLottieData) return;
            const ind = (node._rawLottieData as any).ind;
            if (ind === undefined) return;

            // Determine if this node belongs to a precomp asset by walking parent chain
            let assetId: string | null = null;
            let pid: string | null = node.parentId ?? null;
            while (pid) {
                const parent = state.nodes.get(pid);
                if (!parent) break;
                if (parent.type === 'artboard' && (parent.props as any)?.refId) {
                    assetId = (parent.props as any).refId as string;
                    break;
                }
                pid = parent.parentId ?? null;
            }

            const entry = assetId
                ? assetByIdByInd.get(assetId)?.get(ind)
                : mainByInd.get(ind);

            if (entry) layerMap.set(nodeId, entry);
        });

        set({ lottieJsonCache: cache, lottieLayerMap: layerMap });
    },

    patchLottieNode: (nodeId: string) => {
        
        set((draft) => {
        const hasImportedCache = !!(draft.lottieJsonCache && draft.lottieLayerMap);
        const hasFromScratchModel = !!(draft.lottieModel && draft.lottieNodeMap);
        if (!hasImportedCache && !hasFromScratchModel) return;

        // Something will be patched — ThorVG must reload to reflect the change
        draft.lottieNeedsReload = true;

        const node = draft.nodes.get(nodeId);
        if (!node) return;

        const safeNum = (v: any, def = 0): number => (typeof v === 'number' && isFinite(v)) ? v : def;

        if ((node as any)._rawLottieData) {
            // Imported layer — patch transforms and visibility via lottieLayerMap
            if (!draft.lottieLayerMap) return;
            const entry = draft.lottieLayerMap.get(nodeId);
            if (!entry) return;

            // Immer may have frozen the cache objects; if so, replace with mutable clones.
            if (Object.isFrozen(entry.layers)) {
                entry.layers = [...entry.layers];
            }
            let lottieLayer = entry.layers[entry.index];
            if (Object.isFrozen(lottieLayer)) {
                lottieLayer = JSON.parse(JSON.stringify(lottieLayer));
                entry.layers[entry.index] = lottieLayer;
            }
            lottieLayer.hd = node.visible ? 0 : 1;

            const ks = lottieLayer.ks;
            if (!ks) return;

            // Always override with current node values — patchLottieNode is only called for
            // nodes that were actually edited, so unedited nodes retain their original animated ks.
            ks.p = { a: 0, k: [safeNum(node.transform.x), safeNum(node.transform.y), 0] };
            ks.r = { a: 0, k: safeNum(node.transform.rotation) };
            ks.s = { a: 0, k: [safeNum(node.transform.scaleX, 1) * 100, safeNum(node.transform.scaleY, 1) * 100, 100] };
            ks.o = { a: 0, k: safeNum(node.style.opacity, 1) * 100 };

            // Bug 2 fix: patch text content for imported text layers.
            // patchLottieNode previously patched transforms/visibility only — lottieLayer.t.d.k
            // kept the original "Text" placeholder, so fast-path reloads showed stale text.
            if (node.type === 'text') {
                const td = (lottieLayer as any).t?.d?.k;
                if (Array.isArray(td)) {
                    td.forEach((kf: any) => { if (kf.s) kf.s.t = node.props?.text ?? ''; });
                }
            }

            // ALSO patch lottieModel so the fast-path reload gets the updates instantly.
            // Access through draft.lottieModel.layers[idx] directly — Immer draft proxies always
            // report isFrozen=false, so the frozen-branch guard never fires and lottieModel.layers[idx]
            // must be explicitly accessed to be included in the produced state.
            if (draft.lottieModel && Array.isArray((draft.lottieModel as any).layers)) {
                const modelLayers = (draft.lottieModel as any).layers as any[];
                const mIdx = modelLayers.findIndex((l: any) => l._nodeId === nodeId);
                if (mIdx >= 0) {
                    const modelLayer = modelLayers[mIdx];  // Immer draft for lottieModel.layers[mIdx]
                    (modelLayer as any).hd = node.visible ? 0 : 1;
                    const mks = (modelLayer as any).ks;
                    if (mks) {
                        mks.p = { a: 0, k: [safeNum(node.transform.x), safeNum(node.transform.y), 0] };
                        mks.r = { a: 0, k: safeNum(node.transform.rotation) };
                        mks.s = { a: 0, k: [safeNum(node.transform.scaleX, 1) * 100, safeNum(node.transform.scaleY, 1) * 100, 100] };
                        mks.o = { a: 0, k: safeNum(node.style.opacity, 1) * 100 };
                    }
                    // Bug 2 fix: also patch text content in lottieModel for imported text layers.
                    if (node.type === 'text') {
                        const mtd = (modelLayer as any).t?.d?.k;
                        if (Array.isArray(mtd)) {
                            mtd.forEach((kf: any) => { if (kf.s) kf.s.t = node.props?.text ?? ''; });
                        }
                    }
                }
            }

        } else if (draft.lottieNodeMap?.has(nodeId)) {
            // Phase 4.3 — From-scratch top-level layer: patch transforms and visibility.
            //
            // CRITICAL: Must access the layer through draft.lottieModel.layers[idx], NOT through
            // draft.lottieNodeMap.get(nodeId). Immer is lazy — it only produces updated objects for
            // paths that were explicitly accessed. Immer draft proxies always report isFrozen=false
            // (they implement isExtensible → true), so the Object.isFrozen guard never fires.
            // If we mutate only through lottieNodeMap, the produced lottieModel.layers[idx] stays
            // as the original frozen object (old position) — the fast-path then loads stale data.
            // Accessing layers[idx] here forces Immer to include the update in lottieModel.
            if (!draft.lottieModel || !Array.isArray((draft.lottieModel as any).layers)) return;
            const modelLayers = (draft.lottieModel as any).layers as any[];
            const modelIdx = modelLayers.findIndex((l: any) => l._nodeId === nodeId);
            if (modelIdx < 0) return;
            const lottieLayer = modelLayers[modelIdx];  // Immer draft for lottieModel.layers[idx]

            (lottieLayer as any).hd = node.visible ? 0 : 1;

            const ks = (lottieLayer as any).ks;
            if (!ks) return;

            // Phase 4.5 — Animation guards: never overwrite an animated property with a static value.
            // If the node has keyframes for a property, the current ks entry in lottieModel already
            // holds the animated format (set by the last full re-export). Overwriting it with
            // { a:0, k:[...] } would corrupt lottieModel for Step 4.7. The 25ms DotLottiePlayback
            // debounce regenerates the correct animated format from node.animations via LottieExporter.
            const anim = node.animations ?? {};
            const hasPosAnims    = (anim['transform.x']?.length       ?? 0) > 0 || (anim['transform.y']?.length ?? 0) > 0;
            const hasRotAnims    = (anim['transform.rotation']?.length ?? 0) > 0;
            const hasScaleAnims  = (anim['transform.scaleX']?.length   ?? 0) > 0 || (anim['transform.scaleY']?.length ?? 0) > 0;
            const hasOpacAnims   = (anim['style.opacity']?.length      ?? 0) > 0;
            const hasAnchorAnims = (anim['transform.anchorX']?.length  ?? 0) > 0 || (anim['transform.anchorY']?.length ?? 0) > 0;
            // Phase 4.6 geometry animation guards
            const hasWidthAnims  = (anim['props.width']?.length        ?? 0) > 0;
            const hasHeightAnims = (anim['props.height']?.length       ?? 0) > 0;
            const hasRxAnims     = (anim['props.radiusX']?.length      ?? 0) > 0;
            const hasRyAnims     = (anim['props.radiusY']?.length      ?? 0) > 0;
            const hasRoundAnims  = (anim['props.roundness']?.length    ?? 0) > 0;
            const hasPtAnims     = (anim['props.points']?.length       ?? 0) > 0;
            const hasOrAnims     = (anim['props.outerRadius']?.length  ?? 0) > 0;
            const hasIrAnims     = (anim['props.innerRadius']?.length  ?? 0) > 0;

            if (!hasPosAnims) {
                // Bug 1 fix: from-scratch text nodes store transform.y as the top of the em box
                // (Canvas2D textBaseline='top'), but ThorVG/Lottie place the baseline at ks.p.y.
                // Add font ascent so ThorVG's baseline rendering lands at our intended visual top.
                const posY = node.type === 'text'
                    ? safeNum(node.transform.y) + measureFontAscent(
                        (node.props?.fontFamily || 'Arial').split(',')[0].trim(),
                        node.props?.fontWeight || '400',
                        safeNum(node.props?.fontSize, 24)
                      )
                    : safeNum(node.transform.y);
                ks.p = { a: 0, k: [safeNum(node.transform.x), posY, 0] };
            }
            if (!hasRotAnims)   ks.r = { a: 0, k: safeNum(node.transform.rotation) };
            if (!hasScaleAnims) ks.s = { a: 0, k: [safeNum(node.transform.scaleX, 1) * 100, safeNum(node.transform.scaleY, 1) * 100, 100] };
            if (!hasOpacAnims)  ks.o = { a: 0, k: safeNum(node.style.opacity, 1) * 100 };

            // Phase 4.6 — Patch ks.a (anchor) whenever geometry is static.
            // ks.a is the layer's anchor/pivot point — the point in local space that maps
            // to ks.p in parent space. This is independent of the shape's geometric center
            // (which is stored in the shape primitive's p, e.g., rc.p = [w/2, h/2]).
            const geomUnanimated = !hasAnchorAnims && !hasWidthAnims && !hasHeightAnims && !hasRxAnims && !hasRyAnims;
            const anchor = geomUnanimated ? getAnimatedAnchor(node, draft.nodes) : null;
            if (anchor) {
                ks.a = { a: 0, k: [safeNum(anchor.x), safeNum(anchor.y), 0] };
            }

            // Phase 4.4 — Patch solid fill and stroke style properties in-place.
            // Animated fill/stroke items (c.a !== 0) are skipped — their keyframe arrays have a
            // different format and must not be overwritten with static values (same guard as above).
            // Structural changes (solid↔gradient switch, stroke added/removed) fall back to the
            // full 25ms re-export; only value updates on existing static items are patched here.
            if (Array.isArray((lottieLayer as any).shapes)) {
                const hasFillAnims   = (anim['style.fill']?.length ?? 0) > 0;
                const hasStrokeAnims = (anim['style.stroke']?.length ?? 0) > 0 ||
                                       (anim['style.strokeWidth']?.length ?? 0) > 0;

                const hexToRgb = (hex: string): [number, number, number] => {
                    const h = hex.replace('#', '');
                    return [
                        parseInt(h.slice(0, 2), 16) / 255,
                        parseInt(h.slice(2, 4), 16) / 255,
                        parseInt(h.slice(4, 6), 16) / 255,
                    ];
                };
                const walkShapes = (items: any[]) => {
                    for (const item of items) {
                        if (item.ty === 'gr' && Array.isArray(item.it)) {
                            walkShapes(item.it);
                        } else if (!hasFillAnims && item.ty === 'fl' && item.c?.a === 0) {
                            if (node.style.fill) {
                                const [r, g, b] = hexToRgb(node.style.fill);
                                // Preserve array length: some tools store [r,g,b], others [r,g,b,a]
                                item.c.k = item.c.k.length >= 4
                                    ? [r, g, b, item.c.k[3]]
                                    : [r, g, b];
                            }
                            if (item.o) item.o = { a: 0, k: safeNum(node.style.fillOpacity, 1) * 100 };
                            item.hd = node.style.fillVisible === false ? 1 : 0;
                        } else if (!hasStrokeAnims && item.ty === 'st' && item.c?.a === 0) {
                            if (node.style.stroke) {
                                const [r, g, b] = hexToRgb(node.style.stroke);
                                item.c.k = item.c.k.length >= 4
                                    ? [r, g, b, item.c.k[3]]
                                    : [r, g, b];
                            }
                            if (item.w) item.w = { a: 0, k: safeNum(node.style.strokeWidth, 1) };
                            if (item.o) item.o = { a: 0, k: safeNum(node.style.strokeOpacity, 1) * 100 };
                        }
                    }
                };
                walkShapes((lottieLayer as any).shapes);

                // Phase 4.6 — Patch shape geometry (size, roundness, local center position).
                // Each primitive type maps directly to a Lottie shape item (rc/el/sr).
                // Paths (sh) are skipped — bezier serialisation requires LottieExporter.
                const walkGeom = (items: any[]) => {
                    for (const item of items) {
                        if (item.ty === 'gr' && Array.isArray(item.it)) {
                            walkGeom(item.it);
                        } else if (item.ty === 'rc') {
                            if (!hasWidthAnims && !hasHeightAnims && item.s?.a === 0) {
                                item.s = { a: 0, k: [safeNum(node.props?.width, 100), safeNum(node.props?.height, 100)] };
                            }
                            if (!hasRoundAnims) {
                                const r = safeNum(node.props?.roundness, 0);
                                if (r === 0) { delete item.r; } else { item.r = { a: 0, k: r }; }
                            }
                            // Local center = geometric center of shape (NOT anchor).
                            // The anchor is handled by the layer transform ks.a, while shape.p is
                            // where the shape draws its visual center in layer-local space.
                            {
                                const gx = safeNum(node.props?.width, 100) / 2;
                                const gy = safeNum(node.props?.height, 100) / 2;
                                if (gx === 0 && gy === 0) {
                                    delete item.p;
                                } else if (item.p?.a === 0 || !item.p) {
                                    item.p = { a: 0, k: [safeNum(gx), safeNum(gy)] };
                                }
                            }
                        } else if (item.ty === 'el') {
                            if (!hasRxAnims && !hasRyAnims && item.s?.a === 0) {
                                item.s = { a: 0, k: [safeNum(node.props?.radiusX, 50) * 2, safeNum(node.props?.radiusY, 50) * 2] };
                            }
                            {
                                const gx = safeNum(node.props?.radiusX, 50);
                                const gy = safeNum(node.props?.radiusY, 50);
                                if (gx === 0 && gy === 0) {
                                    delete item.p;
                                } else if (item.p?.a === 0 || !item.p) {
                                    item.p = { a: 0, k: [safeNum(gx), safeNum(gy)] };
                                }
                            }
                        } else if (item.ty === 'sr') {
                            if (!hasPtAnims && item.pt?.a === 0) item.pt = { a: 0, k: safeNum(node.props?.points, 5) };
                            if (!hasOrAnims && item.or?.a === 0) item.or = { a: 0, k: safeNum(node.props?.outerRadius, 50) };
                            if (!hasIrAnims && item.ir?.a === 0) item.ir = { a: 0, k: safeNum(node.props?.innerRadius, 25) };
                            // Polystar is inherently centered at origin
                            {
                                if (item.p?.a === 0 || !item.p) {
                                    item.p = { a: 0, k: [0, 0] };
                                }
                            }
                        } else if (item.ty === 'sh') {
                            const hasPointsAnim = (anim['props.points']?.length ?? 0) > 0;
                            if (!hasPointsAnim && item.ks?.a === 0 && Array.isArray(node.props?.points)) {
                                const points = node.props.points as any[];
                                item.ks.k = {
                                    i: points.map(p => [safeNum(p.inX), safeNum(p.inY)]),
                                    o: points.map(p => [safeNum(p.outX), safeNum(p.outY)]),
                                    v: points.map(p => [safeNum(p.x), safeNum(p.y)]),
                                    c: !!(node.props.closed ?? true)
                                };
                            }
                        }
                    }
                };
                walkGeom((lottieLayer as any).shapes);
            }

            // Bug 2 fix: patch text content for from-scratch text layers.
            // walkGeom/walkShapes above only handle shape geometry — text content lives in t.d.k.
            // Without this patch, lottieModel.t.d.k[0].s.t stays as the original "Text" placeholder
            // and every fast-path reload shows the stale text instead of what the user typed.
            if (node.type === 'text') {
                const td = (lottieLayer as any).t?.d?.k;
                if (Array.isArray(td)) {
                    td.forEach((kf: any) => { if (kf.s) kf.s.t = node.props?.text ?? ''; });
                }
            }

        } else if (draft.lottieLayerMap) {
            // Sub-shape node inside an imported layer — walk up to the ancestor layer and patch shape visibility
            let pid: string | null = node.parentId ?? null;
            let ancestorNode: any = null;
            while (pid) {
                const a = draft.nodes.get(pid);
                if (!a) break;
                if ((a as any)._rawLottieData) { ancestorNode = a; break; }
                pid = a.parentId ?? null;
            }
            if (!ancestorNode) return;

            const entry = draft.lottieLayerMap.get(ancestorNode.id);
            if (!entry) return;

            let lottieLayer = entry.layers[entry.index];
            if (!Array.isArray(lottieLayer.shapes)) return;

            // Walk shape tree to find by name and patch hd (hidden) flag
            const patchHd = (shapes: any[], targetName: string, hidden: boolean): boolean => {
                for (const shape of shapes) {
                    if (shape.nm === targetName) {
                        shape.hd = hidden ? 1 : 0;
                        return true;
                    }
                    if (shape.ty === 'gr' && Array.isArray(shape.it)) {
                        if (patchHd(shape.it, targetName, hidden)) return true;
                    }
                }
                return false;
            };

            patchHd(lottieLayer.shapes, node.name, !node.visible);
            
            // ALSO patch lottieModel so the fast-path reload gets the updates instantly.
            // Access through draft.lottieModel.layers directly (same Immer lazy-draft reason as above).
            if (draft.lottieModel && Array.isArray((draft.lottieModel as any).layers)) {
                const modelLayers = (draft.lottieModel as any).layers as any[];
                const mIdx = modelLayers.findIndex((l: any) => l._nodeId === ancestorNode.id);
                if (mIdx >= 0 && Array.isArray(modelLayers[mIdx].shapes)) {
                    patchHd(modelLayers[mIdx].shapes, node.name, !node.visible);
                }
            }
        }
        });
    },

    setLottieNeedsReload: (v) => set({ lottieNeedsReload: v }),

    setLottieModel: (data) => {
        // Deep-clone the Lottie JSON so that layer object refs stored in lottieNodeMap
        // remain mutable for in-place surgical patches (patchLottieNode steps 4.3–4.6).
        // Without this clone, Immer's set() freezes the objects and subsequent writes
        // throw "Cannot add property hd, object is not extensible".
        const cloned = data ? JSON.parse(JSON.stringify(data)) : null;
        let lottieNodeMap: Map<string, Record<string, unknown>> | null = null;
        if (cloned && Array.isArray((cloned as any).layers)) {
            lottieNodeMap = new Map();
            for (const layer of (cloned as any).layers as Record<string, unknown>[]) {
                if (typeof layer._nodeId === 'string') {
                    lottieNodeMap.set(layer._nodeId, layer);
                }
            }
        }
        set({ lottieModel: cloned, lottieNodeMap });
    },

    setCurrentTime: (time) => set({ currentTime: Math.max(0, Math.min(get().duration, time)) }),

    togglePlaying: () => set((state) => ({ isPlaying: !state.isPlaying })),

    toggleLooping: () => set((state) => ({ isLooping: !state.isLooping })),

    setPlaying: (playing) => set({ isPlaying: playing }),

    setDuration: (duration) => set({ duration: Math.max(1, duration) }),

    setWorkArea: (start, end) => set((state) => {
        // Validation: Ensure valid range within [0, duration]
        const validStart = start !== null ? Math.max(0, Math.min(state.duration, start)) : null;
        const validEnd = end !== null ? Math.max(validStart ?? 0, Math.min(state.duration, end)) : null;
        return { workAreaStart: validStart, workAreaEnd: validEnd };
    }),

    setFps: (fps) => set({ fps: Math.max(1, fps) }),

    setZoomLevel: (zoom) => set({ zoomLevel: Math.max(0.1, Math.min(10, zoom)) }),

    addFlowBlock: (block) => set((state) => {
        const id = 'flow_' + Math.random().toString(36).substr(2, 9);
        return { flowBlocks: [...state.flowBlocks, { ...block, id }] };
    }),

    updateFlowBlock: (id, updates) => set((state) => ({
        flowBlocks: state.flowBlocks.map(b => b.id === id ? { ...b, ...updates } : b)
    })),

    deleteFlowBlock: (id) => set((state) => ({
        flowBlocks: state.flowBlocks.filter(b => b.id !== id)
    })),

    toggleTrackVisibility: (nodeId, propertyPath) => set((state) => {
        const current = state.trackVisibility[nodeId] || [];
        const next = current.includes(propertyPath)
            ? current.filter(p => p !== propertyPath)
            : [...current, propertyPath];

        return {
            trackVisibility: { ...state.trackVisibility, [nodeId]: next }
        };
    }),

    toggleNodeExpand: (nodeId, force) => set((state) => {
        const nextValue = force !== undefined ? force : !state.expandedNodes[nodeId];
        const newTrackVis = { ...state.trackVisibility };

        // If we are collapsing, also clear specific track visibility so it resets for next time
        if (!nextValue) {
            delete newTrackVis[nodeId];
        }

        return {
            expandedNodes: {
                ...state.expandedNodes,
                [nodeId]: nextValue
            },
            trackVisibility: newTrackVis
        };
    }),

    toggleShapeGroupExpand: (nodeId, force) => set((state) => ({
        expandedShapeGroups: {
            ...state.expandedShapeGroups,
            [nodeId]: force !== undefined ? force : !state.expandedShapeGroups[nodeId]
        }
    })),

    ensureExpansion: (nodeId: string, propertyPath: string) => {
        const state = get();
        const expandedNodes = { ...state.expandedNodes };
        const expandedShapeGroups = { ...state.expandedShapeGroups };
        const trackVisibility = { ...state.trackVisibility };
        let changed = false;

        // Map propertyPath to mainPath for soloing logic
        const mapping: Record<string, string> = {
            'transform.y': 'transform.x',
            'transform.scaleY': 'transform.scaleX',
            'props.height': 'props.width',
            'props.radiusY': 'props.radiusX'
        };
        const mainPath = mapping[propertyPath] || propertyPath;

        // Add to visible tracks instead of replacing (Cumulative Focus)
        const currentVis = trackVisibility[nodeId] || [];
        if (!currentVis.includes(mainPath)) {
            trackVisibility[nodeId] = [...currentVis, mainPath];
            changed = true;
        }

        if (!expandedNodes[nodeId]) {
            expandedNodes[nodeId] = true;
            changed = true;
        }

        const corePaths = [
            'transform.x', 'transform.y',
            'transform.scaleX', 'transform.scaleY',
            'transform.rotation',
            'style.opacity',
            'props.width', 'props.height',
            'props.radiusX', 'props.radiusY'
        ];

        if (!corePaths.includes(propertyPath) && !expandedShapeGroups[nodeId]) {
            expandedShapeGroups[nodeId] = true;
            changed = true;
        }

        if (changed) {
            set({ expandedNodes, expandedShapeGroups, trackVisibility });
        }
    },

    showAnimatedProperties: (nodeId: string) => {
        const state = get();
        const node = state.nodes.get(nodeId);
        if (!node) return;

        const expandedNodes = { ...state.expandedNodes };
        const expandedShapeGroups = { ...state.expandedShapeGroups };
        const trackVisibility = { ...state.trackVisibility };

        // 1. First, gather all nodes in the subtree that HAVE animations.
        const animatedNodes = new Set<string>();
        const animatedPathsMap: Record<string, string[]> = {};

        const gatherAnimations = (currentId: string) => {
            const current = state.nodes.get(currentId);
            if (!current) return;

            const paths = current.animations ? Object.keys(current.animations) : [];
            if (paths.length > 0) {
                animatedNodes.add(currentId);
                animatedPathsMap[currentId] = paths;
            }

            if (current.children) {
                current.children.forEach(gatherAnimations);
            }
        };

        gatherAnimations(nodeId);

        if (animatedNodes.size === 0) return; // Nothing to show in this entire branch

        // 2. Determine if we are expanding or collapsing.
        // We collapse if ALL animated properties in the entire subtree are already visible and soloed.
        // Otherwise, we expand everything.
        let isFullyRevealed = true;

        const mapping: Record<string, string> = {
            'transform.y': 'transform.x',
            'transform.scaleY': 'transform.scaleX',
            'props.height': 'props.width',
            'props.radiusY': 'props.radiusX',
            'style.trimEnd': 'style.trimStart',
            'style.trimOffset': 'style.trimStart'
        };

        animatedNodes.forEach(id => {
            const paths = animatedPathsMap[id];
            const visibleTracks = trackVisibility[id] || [];

            const mainPaths = new Set<string>();
            paths.forEach(p => mainPaths.add(mapping[p] || p));

            Array.from(mainPaths).forEach(mp => {
                if (!visibleTracks.includes(mp)) isFullyRevealed = false;
            });

            if (!expandedNodes[id]) isFullyRevealed = false;
        });

        if (!expandedNodes[nodeId]) isFullyRevealed = false;

        if (isFullyRevealed) {
            // COLLAPSE ALL: Close the root node and recursively clear visibility
            const collapseRecursive = (currentId: string) => {
                expandedNodes[currentId] = false;
                delete trackVisibility[currentId];
                delete expandedShapeGroups[currentId];

                const current = state.nodes.get(currentId);
                if (current && current.children) {
                    current.children.forEach(collapseRecursive);
                }
            };
            collapseRecursive(nodeId);
        } else {
            // EXPAND ALL: Open only the paths leading to animated nodes, and solo their tracks
            const expandForNode = (targetId: string, paths: string[]) => {
                expandedNodes[targetId] = true;

                const mainPaths = new Set<string>();
                paths.forEach(p => mainPaths.add(mapping[p] || p));
                trackVisibility[targetId] = Array.from(mainPaths);

                const corePaths = ['transform.x', 'transform.y', 'transform.scaleX', 'transform.scaleY', 'transform.rotation', 'style.opacity', 'props.width', 'props.height', 'props.radiusX', 'props.radiusY'];
                const hasShapeAnim = paths.some(p => !corePaths.includes(p));
                if (hasShapeAnim) expandedShapeGroups[targetId] = true;

                // Expand parents up to the root
                let current = state.nodes.get(targetId);
                while (current && current.id !== nodeId && current.parentId) {
                    expandedNodes[current.parentId] = true;
                    current = state.nodes.get(current.parentId);
                }
            };

            animatedNodes.forEach(id => {
                expandForNode(id, animatedPathsMap[id]);
            });

            // Ensure root itself is expanded
            expandedNodes[nodeId] = true;
        }

        set({ expandedNodes, expandedShapeGroups, trackVisibility });
    },

    toggleStopwatch: (nodeId, propertyPath) => set((state) => {
        const node = state.nodes.get(nodeId);
        if (!node) return state;

        get().pushToHistory('Toggle Animation');

        // Color/style keyframes belong on leaf shapes, not on groups.
        // When the user clicks the keyframe icon for a fill/stroke property while a group is selected,
        // delegate to all leaf shape descendants of that group.
        const isStyleProp = propertyPath.startsWith('style.fill') || propertyPath.startsWith('style.stroke');
        if (isStyleProp && node.type === 'group' && node.children && node.children.length > 0) {
            const leafIds: string[] = [];
            const collectLeaves = (childIds: string[]) => {
                childIds.forEach(id => {
                    const child = state.nodes.get(id);
                    if (!child) return;
                    if (child.type === 'rect' || child.type === 'ellipse' || child.type === 'path' || child.type === 'polystar') {
                        leafIds.push(id);
                    } else if (child.type === 'group' && child.children?.length) {
                        collectLeaves(child.children);
                    }
                });
            };
            collectLeaves(node.children);

            if (leafIds.length > 0) {
                const newNodes = new Map(state.nodes);
                leafIds.forEach(leafId => {
                    const leaf = newNodes.get(leafId);
                    if (!leaf) return;
                    const leafAnims = { ...(leaf.animations || {}) };
                    if (leafAnims[propertyPath]) {
                        const kfs = [...leafAnims[propertyPath]];
                        const existingIdx = kfs.findIndex(k => k.time === state.currentTime);
                        if (existingIdx !== -1) {
                            kfs.splice(existingIdx, 1);
                            if (kfs.length === 0) delete leafAnims[propertyPath];
                            else leafAnims[propertyPath] = kfs;
                        } else {
                            const val = AnimationUtils.getPropertyValue(leaf, propertyPath, state.currentTime);
                            kfs.push({ id: `kf_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, time: state.currentTime, value: safeKfValue(val, propertyPath), easing: 'linear' });
                            kfs.sort((a, b) => a.time - b.time);
                            leafAnims[propertyPath] = kfs;
                        }
                    } else {
                        const val = AnimationUtils.getPropertyValue(leaf, propertyPath, state.currentTime);
                        leafAnims[propertyPath] = [{ id: `kf_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, time: state.currentTime, value: safeKfValue(val, propertyPath), easing: 'linear' }];
                        get().ensureExpansion(leafId, propertyPath);
                    }
                    newNodes.set(leafId, { ...leaf, animations: leafAnims });
                });
                return { nodes: newNodes, updateCounter: state.updateCounter + 1, structureChangeCounter: state.structureChangeCounter + 1 };
            }
        }

        // Trim path keyframes on single-shape groups belong on the shape, not the group.
        // Rule: group with exactly 1 direct leaf child → delegate to that leaf.
        // Rule: group with 0 or 2+ leaf children → fall through (keyframe stays on group).
        const isTrimProp = propertyPath.startsWith('style.trim');
        if (isTrimProp && node.type === 'group' && node.children && node.children.length > 0) {
            const leafTypes = new Set(['rect', 'ellipse', 'path', 'polystar']);
            const directLeafChildren = node.children
                .map(id => state.nodes.get(id))
                .filter((n): n is SceneNode => !!n && leafTypes.has(n.type));

            if (directLeafChildren.length === 1) {
                const leaf = directLeafChildren[0];
                const newNodes = new Map(state.nodes);
                const leafAnims = { ...(leaf.animations || {}) };

                if (leafAnims[propertyPath]) {
                    const kfs = [...leafAnims[propertyPath]];
                    const existingIdx = kfs.findIndex(k => k.time === state.currentTime);
                    if (existingIdx !== -1) {
                        kfs.splice(existingIdx, 1);
                        if (kfs.length === 0) delete leafAnims[propertyPath];
                        else leafAnims[propertyPath] = kfs;
                    } else {
                        const val = AnimationUtils.getPropertyValue(leaf, propertyPath, state.currentTime);
                        kfs.push({ id: `kf_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, time: state.currentTime, value: safeKfValue(val, propertyPath), easing: 'linear' });
                        kfs.sort((a, b) => a.time - b.time);
                        leafAnims[propertyPath] = kfs;
                    }
                } else {
                    const val = AnimationUtils.getPropertyValue(leaf, propertyPath, state.currentTime);
                    leafAnims[propertyPath] = [{ id: `kf_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, time: state.currentTime, value: safeKfValue(val, propertyPath), easing: 'linear' }];
                    get().ensureExpansion(leaf.id, propertyPath);
                }

                newNodes.set(leaf.id, { ...leaf, animations: leafAnims });
                return { nodes: newNodes, updateCounter: state.updateCounter + 1, structureChangeCounter: state.structureChangeCounter + 1 };
            }
            // 0 or 2+ leaf children: fall through to normal path (keyframe on the group itself)
        }

        const animations = { ...(node.animations || {}) };
        const hasAnimation = !!animations[propertyPath];

        const newNodes = new Map(state.nodes);

        if (hasAnimation) {
            // "Keyframe Generator" behavior:
            // If keyframe exists at currentTime, remove it.
            // If no keyframe at currentTime, add one.
            const kfs = [...animations[propertyPath]];
            const existingIndex = kfs.findIndex(k => k.time === state.currentTime);

            if (existingIndex !== -1) {
                // Remove existing keyframe at current time
                kfs.splice(existingIndex, 1);
                if (kfs.length === 0) {
                    delete animations[propertyPath];
                } else {
                    animations[propertyPath] = kfs;
                }
            } else {
                // Add keyframe at current time
                const val = AnimationUtils.getPropertyValue(node, propertyPath, state.currentTime);
                kfs.push({
                    id: `kf_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                    time: state.currentTime,
                    value: safeKfValue(val, propertyPath),
                    easing: 'linear'
                });
                kfs.sort((a, b) => a.time - b.time);
                animations[propertyPath] = kfs;
            }
        } else {
            // If stopwatch clicked when OFF, add keyframe at current time
            const val = AnimationUtils.getPropertyValue(node, propertyPath, state.currentTime);

            animations[propertyPath] = [{
                id: `kf_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                time: state.currentTime,
                value: safeKfValue(val, propertyPath),
                easing: 'linear'
            }];

            // Auto-expand when animation is first turned on
            get().ensureExpansion(nodeId, propertyPath);
        }

        newNodes.set(nodeId, { ...node, animations });
        return { nodes: newNodes, updateCounter: state.updateCounter + 1, structureChangeCounter: state.structureChangeCounter + 1 };
    }),

    addKeyframe: (nodeId, propertyPath, time, value) => set((state) => {
        const node = state.nodes.get(nodeId);
        if (!node) return state;

        get().pushToHistory('Add Keyframe');

        const newNodes = new Map(state.nodes);
        const animations = { ...(node.animations || {}) };
        const propertyKeyframes = [...(animations[propertyPath] || [])];

        // Check if keyframe already exists at this time
        const existingIndex = propertyKeyframes.findIndex(k => k.time === time);

        if (existingIndex !== -1) {
            propertyKeyframes[existingIndex] = { ...propertyKeyframes[existingIndex], value };
        } else {
            propertyKeyframes.push({
                id: `kf_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                time,
                value,
                easing: 'linear'
            });
            // Keep sorted by time
            propertyKeyframes.sort((a, b) => a.time - b.time);
        }

        animations[propertyPath] = propertyKeyframes;
        newNodes.set(nodeId, { ...node, animations });

        // Auto-expand and solo when keyframe is added
        get().ensureExpansion(nodeId, propertyPath);

        return { nodes: newNodes, updateCounter: state.updateCounter + 1, structureChangeCounter: state.structureChangeCounter + 1 };
    }),

    removeKeyframe: (nodeId, propertyPath, keyframeId) => set((state) => {
        const node = state.nodes.get(nodeId);
        if (!node) return state;

        get().pushToHistory('Remove Keyframe');

        const newNodes = new Map(state.nodes);
        const animations = { ...(node.animations || {}) };
        if (!animations[propertyPath]) return state;

        animations[propertyPath] = animations[propertyPath].filter(k => k.id !== keyframeId);
        if (animations[propertyPath].length === 0) {
            delete animations[propertyPath];
        }

        newNodes.set(nodeId, { ...node, animations });
        return { nodes: newNodes, updateCounter: state.updateCounter + 1, structureChangeCounter: state.structureChangeCounter + 1 };
    }),

    selectKeyframes: (ids, multi) => set((state) => ({
        selectedKeyframeIds: multi
            ? state.selectedKeyframeIds.includes(ids[0])
                ? state.selectedKeyframeIds.filter(id => !ids.includes(id))
                : [...state.selectedKeyframeIds, ...ids]
            : ids
    })),

    deleteSelectedKeyframes: () => set((state) => {
        if (state.selectedKeyframeIds.length === 0) return state;

        get().pushToHistory('Delete Keyframes');

        const newNodes = new Map(state.nodes);
        const affectedNodes = new Set<string>();

        // Group by node and property
        const grouped: Record<string, Record<string, string[]>> = {};
        state.selectedKeyframeIds.forEach(id => {
            const [nodeId, propertyPath, kfId] = id.split(':');
            if (!grouped[nodeId]) grouped[nodeId] = {};
            if (!grouped[nodeId][propertyPath]) grouped[nodeId][propertyPath] = [];
            grouped[nodeId][propertyPath].push(kfId);
            affectedNodes.add(nodeId);
        });

        Object.entries(grouped).forEach(([nodeId, props]) => {
            const node = newNodes.get(nodeId);
            if (!node) return;

            const animations = { ...(node.animations || {}) };
            let nodeUpdates: Partial<SceneNode> = {};

            Object.entries(props).forEach(([path, kfIds]) => {
                if (animations[path]) {
                    const currentVal = AnimationUtils.getPropertyValue(node, path, state.currentTime);
                    animations[path] = animations[path].filter(kf => !kfIds.includes(kf.id));

                    if (animations[path].length === 0) {
                        delete animations[path];
                        // Apply current value to static property to avoid jumps
                        const parts = path.split('.');
                        if (parts[0] === 'transform') {
                            nodeUpdates.transform = {
                                ...(nodeUpdates.transform || node.transform),
                                [parts[1]]: currentVal
                            };
                        } else if (parts[0] === 'style') {
                            nodeUpdates.style = {
                                ...(nodeUpdates.style || node.style),
                                [parts[1]]: currentVal
                            };
                        } else if (parts[0] === 'props') {
                            nodeUpdates.props = {
                                ...(nodeUpdates.props || node.props),
                                [parts[1]]: currentVal
                            };
                        }
                    }
                }
            });

            newNodes.set(nodeId, { ...node, ...nodeUpdates, animations });
        });

        return {
            nodes: newNodes,
            selectedKeyframeIds: [],
            updateCounter: state.updateCounter + 1,
            structureChangeCounter: state.structureChangeCounter + 1
        };
    }),

    updateKeyframe: (nodeId, propertyPath, keyframeId, updates, options) => set((state) => {
        const node = state.nodes.get(nodeId);
        if (!node) return state;

        if (options?.recordHistory) {
            get().pushToHistory('Update Keyframe');
        }

        const newNodes = new Map(state.nodes);
        const animations = { ...(node.animations || {}) };
        const propertyKeyframes = [...(animations[propertyPath] || [])];

        const index = propertyKeyframes.findIndex(k => k.id === keyframeId);
        if (index === -1) return state;

        propertyKeyframes[index] = { ...propertyKeyframes[index], ...updates };

        if (updates.time !== undefined) {
            propertyKeyframes.sort((a, b) => a.time - b.time);
        }

        animations[propertyPath] = propertyKeyframes;
        newNodes.set(nodeId, { ...node, animations });
        return { nodes: newNodes, updateCounter: state.updateCounter + 1, structureChangeCounter: state.structureChangeCounter + 1 };
    }),

    setNodeProperty: (nodeId, propertyPath, value, options) => {
        get().setNodeProperties(nodeId, { [propertyPath]: value }, options);
    },

    setNodeProperties: (nodeId, propertyUpdates, options) => {
        const state = get();
        if (options?.recordHistory) {
            state.pushToHistory('Change Property');
        }
        const node = state.nodes.get(nodeId);
        if (!node) return;

        const newNodes = new Map(state.nodes);
        const nodeCopy = {
            ...node,
            transform: { ...node.transform },
            style: { ...node.style },
            props: { ...node.props },
            animations: { ...(node.animations || {}) }
        };

        const processedUpdates = { ...propertyUpdates };

        // Handle scaleLink BEFORE path resizing - add linked property to updates
        if (nodeCopy.transform.scaleLink) {
            const links: Record<string, string> = {
                'props.width': 'props.height',
                'props.height': 'props.width',
                'props.radiusX': 'props.radiusY',
                'props.radiusY': 'props.radiusX',
                'transform.scaleX': 'transform.scaleY',
                'transform.scaleY': 'transform.scaleX'
            };

            Object.entries(propertyUpdates).forEach(([path, value]) => {
                const otherPath = links[path];
                if (otherPath && processedUpdates[otherPath] === undefined) {
                    const currentVal = AnimationUtils.getPropertyValue(node, path, state.currentTime);
                    const currentOtherVal = AnimationUtils.getPropertyValue(node, otherPath, state.currentTime);

                    if (typeof currentVal === 'number' && typeof currentOtherVal === 'number' && currentVal !== 0) {
                        const ratio = (value as number) / currentVal;
                        processedUpdates[otherPath] = currentOtherVal * ratio;
                    }
                }
            });
        }

        const sizePaths = ['props.width', 'props.height', 'props.radiusX', 'props.radiusY', 'props.points'];
        const changingSizes = Object.keys(processedUpdates).filter(p => sizePaths.includes(p));

        // Handle path resizing by scaling points
        if (node.type === 'path') {
            if (processedUpdates['props.width'] !== undefined || processedUpdates['props.height'] !== undefined) {
                const curW = AnimationUtils.getPropertyValue(node, 'props.width', state.currentTime);
                const curH = AnimationUtils.getPropertyValue(node, 'props.height', state.currentTime);
                const newW = processedUpdates['props.width'] ?? curW;
                const newH = processedUpdates['props.height'] ?? curH;

                const scaleX = (curW && !isNaN(curW) && curW !== 0 && !isNaN(newW) && newW !== curW) ? newW / curW : 1;
                const scaleY = (curH && !isNaN(curH) && curH !== 0 && !isNaN(newH) && newH !== curH) ? newH / curH : 1;

                if (scaleX !== 1 || scaleY !== 1) {
                    const points = AnimationUtils.getPropertyValue(node, 'props.points', state.currentTime);
                    const newPoints = points.map((p: any) => ({
                        ...p,
                        x: (p.x || 0) * scaleX,
                        y: (p.y || 0) * scaleY,
                        inX: (p.inX || 0) * scaleX,
                        inY: (p.inY || 0) * scaleY,
                        outX: (p.outX || 0) * scaleX,
                        outY: (p.outY || 0) * scaleY
                    }));
                    processedUpdates['props.points'] = newPoints;
                }
                // We keep width/height in processedUpdates so they can be keyframed if desired,
                // but points will be the source of truth for rendering.
            }
        }

        // Handle gradient metadata (designSize tracking)
        const gradientPaths = ['style.fillGradient', 'style.strokeGradient'];
        gradientPaths.forEach(gPath => {
            if (processedUpdates[gPath] !== undefined) {
                // If the user is setting/editing a gradient, it was "designed" for the current node size
                const curW = (node.type === 'ellipse')
                    ? AnimationUtils.getPropertyValue(node, 'props.radiusX', state.currentTime) * 2
                    : AnimationUtils.getPropertyValue(node, 'props.width', state.currentTime);
                const curH = (node.type === 'ellipse')
                    ? AnimationUtils.getPropertyValue(node, 'props.radiusY', state.currentTime) * 2
                    : AnimationUtils.getPropertyValue(node, 'props.height', state.currentTime);

                if (processedUpdates[gPath] && typeof processedUpdates[gPath] === 'object') {
                    processedUpdates[gPath] = {
                        ...processedUpdates[gPath],
                        designSize: { width: curW, height: curH }
                    };
                }
            } else if (changingSizes.length > 0) {
                // If the size is changing, ensure current gradients HAVE a designSize if they don't already
                const grad = AnimationUtils.getPropertyValue(node, gPath, state.currentTime);
                if (grad && typeof grad === 'object' && !grad.designSize) {
                    const curW = (node.type === 'ellipse')
                        ? AnimationUtils.getPropertyValue(node, 'props.radiusX', state.currentTime) * 2
                        : AnimationUtils.getPropertyValue(node, 'props.width', state.currentTime);
                    const curH = (node.type === 'ellipse')
                        ? AnimationUtils.getPropertyValue(node, 'props.radiusY', state.currentTime) * 2
                        : AnimationUtils.getPropertyValue(node, 'props.height', state.currentTime);

                    processedUpdates[gPath] = {
                        ...grad,
                        designSize: { width: curW, height: curH }
                    };
                }
            }
        });

        let didKeyframe = false;

        const applyUpdate = (path: string, incomingVal: any) => {
            // ULTRA-SAFE GUARD: Never allow NaN into the state
            const val = (typeof incomingVal === 'number' && isNaN(incomingVal)) ? 0 : incomingVal;
            let shouldKeyframe = !!nodeCopy.animations[path];

            // Spatial coupling & Initial keyframe logic
            // Spatial coupling & Initial keyframe logic - Only skip if ignoreAnimation is true
            if (!shouldKeyframe && state.currentTime > 0 && !options?.ignoreAnimation) {
                const couplingGroups = [
                    ['transform.x', 'transform.y'],
                    ['props.width', 'props.height'],
                    ['transform.scaleX', 'transform.scaleY'],
                    ['props.radiusX', 'props.radiusY']
                ];

                const group = couplingGroups.find(g => g.includes(path));
                if (group) {
                    const hasGroupAnimation = group.some(p => !!nodeCopy.animations[p]);
                    if (hasGroupAnimation) {
                        shouldKeyframe = true;
                    }
                }
            }

            // If we are starting to animate at T > 0, insert a keyframe at T=0 with current value
            if (shouldKeyframe && !nodeCopy.animations[path] && state.currentTime > 0) {
                const initialVal = AnimationUtils.getPropertyValue(node, path, 0);
                nodeCopy.animations[path] = [{
                    id: `kf_start_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                    time: 0,
                    value: safeKfValue(initialVal, path),
                    easing: 'linear'
                }];
            }

            if (shouldKeyframe) {
                didKeyframe = true;
                const kfs = [...(nodeCopy.animations[path] || [])];
                const existingIndex = kfs.findIndex(k => k.time === state.currentTime);
                if (existingIndex !== -1) {
                    kfs[existingIndex] = { ...kfs[existingIndex], value: val };
                } else {
                    kfs.push({
                        id: `kf_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        time: state.currentTime,
                        value: val,
                        easing: 'linear'
                    });
                    kfs.sort((a, b) => a.time - b.time);

                    // Auto-expand when a new keyframe is created via auto-keyframing
                    get().ensureExpansion(nodeId, path);
                }
                nodeCopy.animations[path] = kfs;
            }

            // Update static property
            const parts = path.split('.');
            if (parts[0] === 'transform') (nodeCopy.transform as any)[parts[1]] = val;
            else if (parts[0] === 'style') (nodeCopy.style as any)[parts[1]] = val;
            else if (parts[0] === 'props') (nodeCopy.props as any)[parts[1]] = val;
        };

        // Detect if any "size" properties are being updated
        const manualAnchorChange = processedUpdates['transform.anchorX'] !== undefined || processedUpdates['transform.anchorY'] !== undefined;

        // Detect "pinning" before applying updates
        let wasPinnedX: number | undefined = node.transform.anchorAlignX;
        let wasPinnedY: number | undefined = node.transform.anchorAlignY;

        if (changingSizes.length > 0 && !manualAnchorChange) {
            let curW = 0, curH = 0, ox = 0, oy = 0;
            if (node.type === 'rect' || node.type === 'artboard') {
                curW = AnimationUtils.getPropertyValue(node, 'props.width', state.currentTime);
                curH = AnimationUtils.getPropertyValue(node, 'props.height', state.currentTime);
            } else if (node.type === 'ellipse') {
                curW = AnimationUtils.getPropertyValue(node, 'props.radiusX', state.currentTime) * 2;
                curH = AnimationUtils.getPropertyValue(node, 'props.radiusY', state.currentTime) * 2;
            } else if (node.type === 'path') {
                const points = AnimationUtils.getPropertyValue(node, 'props.points', state.currentTime);
                const lb = getPathLocalBounds(points || []);
                curW = lb.width; curH = lb.height; ox = lb.x; oy = lb.y;
            }

            const curAX = AnimationUtils.getPropertyValue(node, 'transform.anchorX', state.currentTime);
            const curAY = AnimationUtils.getPropertyValue(node, 'transform.anchorY', state.currentTime);

            // Only attempt to auto-detect if not already explicitly aligned
            if (wasPinnedX === undefined && curW > 0) {
                if (Math.abs(curAX - (ox + curW / 2)) < 0.1) wasPinnedX = 0.5;
                else if (Math.abs(curAX - (ox + curW)) < 0.1) wasPinnedX = 1;
                else if (Math.abs(curAX - ox) < 0.1) wasPinnedX = 0;
            }
            if (wasPinnedY === undefined && curH > 0) {
                if (Math.abs(curAY - (oy + curH / 2)) < 0.1) wasPinnedY = 0.5;
                else if (Math.abs(curAY - (oy + curH)) < 0.1) wasPinnedY = 1;
                else if (Math.abs(curAY - oy) < 0.1) wasPinnedY = 0;
            }
        }

        // Process all updates
        Object.entries(processedUpdates).forEach(([path, value]) => {
            applyUpdate(path, value);

            if (nodeCopy.transform.scaleLink && !options?.ignoreLink) {
                const links: Record<string, string> = {
                    'transform.scaleX': 'transform.scaleY',
                    'transform.scaleY': 'transform.scaleX',
                };
                const otherPath = links[path];
                if (otherPath && !(otherPath in processedUpdates)) {
                    const currentVal = AnimationUtils.getPropertyValue(node, path, state.currentTime);
                    const currentOtherVal = AnimationUtils.getPropertyValue(node, otherPath, state.currentTime);
                    if (typeof currentVal === 'number' && typeof currentOtherVal === 'number' && currentVal !== 0) {
                        const ratio = (value as number) / currentVal;
                        applyUpdate(otherPath, currentOtherVal * ratio);
                    } else {
                        applyUpdate(otherPath, value);
                    }
                }
            }
        });

        // SMART ANCHOR FOLLOWING: If size changed, naturally maintain the anchor's relative pin
        if (!manualAnchorChange && changingSizes.length > 0) {
            let nextW = 0, nextH = 0, n_ox = 0, n_oy = 0;
            if (nodeCopy.type === 'rect' || nodeCopy.type === 'artboard') {
                nextW = nodeCopy.props.width;
                nextH = nodeCopy.props.height;
            } else if (nodeCopy.type === 'ellipse') {
                nextW = nodeCopy.props.radiusX * 2;
                nextH = nodeCopy.props.radiusY * 2;
            } else if (nodeCopy.type === 'path') {
                const points = AnimationUtils.getPropertyValue(nodeCopy as any, 'props.points', state.currentTime);
                const lb = getPathLocalBounds(points || []);
                nextW = lb.width; nextH = lb.height; n_ox = lb.x; n_oy = lb.y;
            }

            if (wasPinnedX !== undefined) {
                const newAX = n_ox + (wasPinnedX === 1 ? nextW : (wasPinnedX === 0.5 ? nextW / 2 : 0));
                applyUpdate('transform.anchorX', newAX);
            }
            if (wasPinnedY !== undefined) {
                const newAY = n_oy + (wasPinnedY === 1 ? nextH : (wasPinnedY === 0.5 ? nextH / 2 : 0));
                applyUpdate('transform.anchorY', newAY);
            }
        } else if (manualAnchorChange) {
            // If the user manually changed one anchor dimension, clear the alignment flag 
            // ONLY if it wasn't also explicitly provided in this update (e.g. via direct value typing vs grid preset)
            if (processedUpdates['transform.anchorX'] !== undefined && processedUpdates['transform.anchorAlignX'] === undefined) {
                applyUpdate('transform.anchorAlignX', undefined);
            }
            if (processedUpdates['transform.anchorY'] !== undefined && processedUpdates['transform.anchorAlignY'] === undefined) {
                applyUpdate('transform.anchorAlignY', undefined);
            }
        }

        // Gradient changes (solid↔gradient switch, or updating gradient stops/colors) cannot be
        // serialized by patchLottieNode — it only handles fl/st items. Force the slow path so
        // LottieExporter re-exports the full model with the correct gf/gs Lottie items.
        const hasGradientUpdate = 'style.fillGradient' in processedUpdates ||
            'style.strokeGradient' in processedUpdates ||
            ('style.fill' in processedUpdates && !!node.style.fillGradient) ||
            ('style.stroke' in processedUpdates && !!node.style.strokeGradient);

        const hasTrimUpdate = 'style.trimStart' in processedUpdates ||
            'style.trimEnd' in processedUpdates ||
            'style.trimOffset' in processedUpdates;

        // Nested shapes from imported layers (which have parsed snapshots but no raw Lottie data themselves)
        // must trigger a structural reload so the exporter's deep overlay logic can apply their specific edits,
        // bypassing the fast-path which only supports root layers.
        const isNestedImportedShape = !node._rawLottieData && (node._originalParsedFill !== undefined || node._originalParsedOpacity !== undefined);

        const needsStructuralReload = didKeyframe || hasGradientUpdate || hasTrimUpdate || isNestedImportedShape;
        const updates: any = { nodes: newNodes, updateCounter: state.updateCounter + 1, ...(needsStructuralReload && { structureChangeCounter: state.structureChangeCounter + 1 }) };

        if (node.type === 'artboard') {
            const newDuration = processedUpdates['props.duration'];
            if (newDuration !== undefined) {
                // Cascade duration change to all precomp instances in the project
                newNodes.forEach((n, id) => {
                    if (n.type === 'precomp' && n.refId === nodeId) {
                        newNodes.set(id, {
                            ...n,
                            outPoint: n.inPoint + newDuration
                        });
                    }
                });
            }

            if (nodeId === state.activeArtboardId) {
                if (processedUpdates['props.duration'] !== undefined) updates.duration = processedUpdates['props.duration'];
                if (processedUpdates['props.frameRate'] !== undefined) updates.fps = processedUpdates['props.frameRate'];
            }
        }

        newNodes.set(nodeId, nodeCopy);
        set(updates);
        // Surgically patch the Lottie model for this node (no-op when neither cache nor model is available)
        if (get().lottieJsonCache || get().lottieNodeMap?.has(nodeId)) get().patchLottieNode(nodeId);
    },

    shiftLayers: (nodeIds: string[], deltaFrames: number) => {
        if (deltaFrames === 0) return;
        const state = get();
        const newNodes = new Map(state.nodes);
        let changed = false;

        nodeIds.forEach(id => {
            const node = newNodes.get(id);
            if (!node || node.type === 'artboard') return;

            changed = true;
            const newNode = { ...node };
            newNode.inPoint += deltaFrames;
            newNode.outPoint += deltaFrames;

            if (newNode.animations) {
                const newAnimations = { ...newNode.animations };
                Object.keys(newAnimations).forEach(path => {
                    newAnimations[path] = newAnimations[path].map(kf => ({
                        ...kf,
                        time: kf.time + deltaFrames
                    }));
                });
                newNode.animations = newAnimations;
            }
            newNodes.set(id, newNode);
        });

        if (changed) {
            set({ nodes: newNodes, updateCounter: state.updateCounter + 1 });
        }
    },
});
