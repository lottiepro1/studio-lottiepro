import { SceneNode, Gradient, Style } from '../state/sceneSlice';
import { FlowBlock, Keyframe } from '../state/animationSlice';
import { LottieAnimation, LottieLayer, LottieShape, LottieProperty, LottieKeyframe } from './lottieTypes';
import { getBoundingBox, getWorldMatrix, localToScreen, getCollectiveBoundingBox, getGroupLocalBounds, createTransformMatrix, getPathLocalBounds, getAnimatedAnchor, decomposeMatrix } from '../core/Matrix';
import { VectorPoint } from '../tools/PenTool';
import { EASING_PRESETS } from '../core/EasingPresets';
import { AnimationUtils } from '../core/Animation';
import { measureFontAscent } from '../text/TextMeasurer';

export class LottieExporter {
    static export(nodes: Map<string, SceneNode>, fps: number, duration: number, flowBlocks: FlowBlock[] = [], activeArtboardId?: string): LottieAnimation {
        // 1. Identify Root Artboard
        // When activeArtboardId points to a nested artboard, use it as root so ThorVG renders
        // that artboard's content in isolation — no parent-composition transforms applied.
        // This mirrors AE/LottieFiles behaviour: entering a precomp shows only its own layers.
        const activeArtboard = activeArtboardId ? nodes.get(activeArtboardId) : null;
        const rootArtboard =
            (activeArtboard?.type === 'artboard' ? activeArtboard : null) ||
            Array.from(nodes.values()).find(n => n.type === 'artboard' && !n.parentId) ||
            Array.from(nodes.values()).find(n => n.type === 'artboard');

        if (!rootArtboard) throw new Error('No artboard found for export');

        const safeW = LottieExporter.safeNum(rootArtboard.props?.width, 800);
        const safeH = LottieExporter.safeNum(rootArtboard.props?.height, 600);
        const safeFps = LottieExporter.safeNum(fps, 30);
        const safeDurationFrames = LottieExporter.safeNum(duration, 30);

        // 2. Main Animation Skeleton
        const animation: LottieAnimation = {
            v: '5.5.0',
            fr: Math.round(safeFps),
            ip: 0,
            op: Math.round(safeDurationFrames),
            w: Math.round(safeW),
            h: Math.round(safeH),
            nm: rootArtboard.name || 'LottiePro Animation',
            layers: [],
            assets: []
        };

        // 3. Prepare Image Assets (Deduplicated)
        const imageAssetMap = new Map<string, string>();
        const imageNodes = Array.from(nodes.values()).filter(n => n.type === 'image');

        imageNodes.forEach(node => {
            const src = node.props.src;
            if (!src) return;

            if (!imageAssetMap.has(src)) {
                const assetId = `image_${imageAssetMap.size}`;
                imageAssetMap.set(src, assetId);

                animation.assets!.push({
                    id: assetId,
                    w: Math.round(node.props.width || 100),
                    h: Math.round(node.props.height || 100),
                    u: '',
                    p: src,
                    e: 1
                });
            }
        });

        // 4. Export Root Layers
        animation.layers = this.exportArtboardLayers(rootArtboard, nodes, safeDurationFrames, imageAssetMap);

        // 5. Export artboards that are reachable (referenced by precomp layers) from the root.
        // Only include transitively-referenced artboards so that, e.g., when a nested artboard
        // is the root, its parent artboard is NOT included as an asset (it would create a
        // dangling precomp reference pointing back to the root, confusing ThorVG).
        const otherArtboards = LottieExporter.collectReachableArtboards(rootArtboard, nodes);

        if (otherArtboards.length > 0) {
            const precompAssets = otherArtboards.map(artboard => {
                const w = LottieExporter.safeNum(artboard.props?.width, LottieExporter.safeNum(artboard.props?.w, safeW));
                const h = LottieExporter.safeNum(artboard.props?.height, LottieExporter.safeNum(artboard.props?.h, safeH));

                return {
                    id: artboard.id,
                    nm: artboard.name,
                    w: Math.round(w),
                    h: Math.round(h),
                    layers: this.exportArtboardLayers(artboard, nodes, safeDurationFrames, imageAssetMap)
                };
            });
            animation.assets!.push(...precompAssets);
        }

        // 6. Export Flow Blocks as Lottie Markers
        if (flowBlocks.length > 0) {
            animation.markers = flowBlocks.map(block => ({
                cm: block.name,
                tm: block.startFrame,
                dr: block.endFrame - block.startFrame
            }));
        }

        // 7. Collect and Export Fonts
        const fontMap = new Map<string, { family: string; weight: string | number | undefined }>();
        const traverseForFonts = (ids: string[]) => {
            ids.forEach(id => {
                const node = nodes.get(id);
                if (!node) return;
                if (node.type === 'text' && node.props?.fontFamily) {
                    const family = node.props.fontFamily.split(',')[0].trim();
                    const weight = node.props.fontWeight;
                    const fName = LottieExporter.getFontName(family, weight);
                    if (!fontMap.has(fName)) fontMap.set(fName, { family, weight });
                }
                if (node.children) traverseForFonts(node.children);
            });
        };
        traverseForFonts(rootArtboard.children);

        if (fontMap.size > 0) {
            (animation as any).fonts = {
                list: Array.from(fontMap.entries()).map(([fName, { family, weight }]) => {
                    const { fStyle } = LottieExporter.fontWeightToStyle(weight);
                    return { fName, fFamily: family, fStyle, ascent: 0 };
                })
            };
        }

        return animation;
    }

    /**
     * Helper to export a specific artboard's node hierarchy into a flat list of Lottie Layers.
     * This is used for both the main composition and nested pre-compositions (assets).
     */
    // Recursively collects all artboards that are actually referenced (directly or transitively)
    // by precomp layers inside `root`. Avoids including ancestor artboards as assets when
    // a nested artboard is the export root — that would create dangling refId pointers.
    private static collectReachableArtboards(root: SceneNode, nodes: Map<string, SceneNode>): SceneNode[] {
        const seen = new Set<string>();
        const result: SceneNode[] = [];
        const visit = (node: SceneNode) => {
            node.children.forEach(childId => {
                const child = nodes.get(childId);
                if (!child) return;
                if (child.type === 'precomp' && child.refId && !seen.has(child.refId)) {
                    const refArtboard = nodes.get(child.refId);
                    if (refArtboard?.type === 'artboard') {
                        seen.add(child.refId);
                        result.push(refArtboard);
                        visit(refArtboard);
                    }
                } else if (child.type === 'group') {
                    visit(child);
                }
            });
        };
        visit(root);
        return result;
    }

    private static exportArtboardLayers(artboard: SceneNode, nodes: Map<string, SceneNode>, safeDurationFrames: number, imageAssetMap: Map<string, string>): LottieLayer[] {
        const allProcessedLayers: any[] = [];
        const layerMap = new Map<string, any>();

        const traverse = (nodeId: string) => {
            const node = nodes.get(nodeId);
            if (!node) return;

            // ThorVG does not reliably honor hd:1. Omit hidden nodes entirely so they
            // are never present in the JSON and cannot be rendered.
            // Exception: matte source nodes must be kept — they are marked visible=false by the
            // parser so they don't render directly, but ThorVG needs them present (as td:1 layers)
            // for track mattes to work. Pass 2 below sets td:1 and removes hd for these.
            const isMatteSource = !!(node.matteTargetIds && node.matteTargetIds.length > 0);
            if (node.visible === false && !isMatteSource) return;

            // Lottie Layer Eligibility: only direct artboard children become standalone layers.
            // A node with isLayer:true that has been moved inside a group must be embedded
            // as a gr item, not exported as a separate layer with AE parenting.
            const shouldBeLayer = LottieExporter.shouldBeLayer(node, artboard.id);

            if (shouldBeLayer && node.type !== 'artboard') {
                const layer = LottieExporter.mapNodeToLayerBase(node, safeDurationFrames, nodes, imageAssetMap, LottieExporter.getBakedTransform(node, nodes, artboard.id));

                // Carry metadata for later resolution passes
                (layer as any)._creatorId = node.id;
                (layer as any)._creatorParentId = LottieExporter.findNearestLayerParentId(node, nodes, artboard.id);
                (layer as any)._creatorMatteSourceId = node.matteSourceId;
                (layer as any).matteType = node.matteType;

                allProcessedLayers.push(layer);
                layerMap.set(node.id, layer);
            }

            // CRITICAL: Stop traversal at nested precomps content (it's in assets)
            if (node.type === 'precomp') return;

            // Continue searching for child Layers (e.g. AE Parent-Child hierarchies)
            if (node.children) {
                node.children.forEach(id => traverse(id));
            }
        };

        // Discover all Layers (maintains discovery order)
        artboard.children.forEach(id => traverse(id));

        // AE order: 1 is Top-most. Artboard.children: 0 is Bottom-most.
        // We reverse to get Top-to-Bottom order in Lottie JSON.
        const finalLayers = [...allProcessedLayers].reverse();

        // Pass 1: Assign Sequential Indices
        finalLayers.forEach((l, i) => {
            l.ind = i + 1;
        });

        // Pass 2: Resolve Parenting and Track Mattes
        finalLayers.forEach(l => {
            const creatorL = l as any;

            // Resolve Parenting
            if (creatorL._creatorParentId) {
                const parentLayer = finalLayers.find(p => (p as any)._creatorId === creatorL._creatorParentId);
                if (parentLayer) l.parent = parentLayer.ind;
            }

            // Resolve Track Mattes (Modern 'tp' + legacy 'tt' support)
            if (creatorL._creatorMatteSourceId) {
                const source = finalLayers.find(p => (p as any)._creatorId === creatorL._creatorMatteSourceId);
                if (source) {
                    source.td = 1; // Mark as Matte Source
                    delete source.hd; // CRITICAL FIX: Ensure track matte is not explicitly hidden
                    l.tt = creatorL.matteType || 1; // Default to Alpha Matte
                    l.tp = source.ind; // Link via Track Matte Parent ID
                }
            }
        });

        // Ensure all properties without an explicit 'a' (animated flag) have one
        finalLayers.forEach(l => {
            if (l.ks) {
                ['p', 'a', 's', 'r', 'o'].forEach(prop => {
                    if (l.ks[prop] && l.ks[prop].a === undefined) l.ks[prop].a = 0;
                });
            }
        });



        // Final Cleanup Pass (Second Pass - remove all temporary tracking attributes)
        // _nodeId is intentionally preserved: setLottieModel indexes lottieNodeMap by it (Step 4.2).
        finalLayers.forEach(l => {
            const creatorL = l as any;
            if (creatorL._creatorId) creatorL._nodeId = creatorL._creatorId;
            delete creatorL._creatorId;
            delete creatorL._creatorParentId;
            delete creatorL._creatorMatteSourceId;
            delete creatorL._creatorMatteTargetIds;
        });

        // Add Background (Bottom-most)
        if (!artboard.props?.transparent) {
            finalLayers.push({
                ty: 1, nm: 'Background',
                ind: finalLayers.length + 1,
                ip: 0, op: Math.round(safeDurationFrames), st: 0,
                sw: Math.round(LottieExporter.safeNum(artboard.props.width, 800)),
                sh: Math.round(LottieExporter.safeNum(artboard.props.height, 600)),
                sc: artboard.props?.backgroundColor || '#ffffff',
                ks: {
                    a: { a: 0, k: [0, 0, 0] }, p: { a: 0, k: [0, 0, 0] },
                    s: { a: 0, k: [100, 100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 }
                }
            } as any);
        }

        return finalLayers;
    }

    private static mapNodeToLayerBase(node: SceneNode, safeDurationFrames: number, nodes: Map<string, SceneNode>, imageAssetMap: Map<string, string>, bakedTransform?: any): LottieLayer {
        const blendModes: Record<string, number> = {
            'normal': 0, 'multiply': 1, 'screen': 2, 'overlay': 3,
            'darken': 4, 'lighten': 5, 'color-dodge': 6, 'color-burn': 7,
            'hard-light': 8, 'soft-light': 9, 'difference': 10, 'exclusion': 11,
            'hue': 12, 'saturation': 13, 'color': 14, 'luminosity': 15
        };
        const blendMode = blendModes[node.style.blendMode || 'normal'] || 0;

        // Lossless path: if this node was imported from Lottie, use the original layer JSON as
        // the base and only overlay the fields the user can actually change in the editor
        // (transform, opacity, timing, visibility, name, blend mode).
        // This preserves shapes, gradients, merge paths, expressions, effects, and any features
        // our authoring model doesn't fully represent.
        if (node._rawLottieData) {
            const raw = node._rawLottieData;

            // Lossless transform: preserve raw.ks so all animation keyframes (rotation, position, scale, etc.)
            // are passed through verbatim to ThorVG. Only override the specific scalar properties
            // where the user has made an intentional edit (detected by comparing against the snapshot
            // taken at import time). This prevents mapTransform from flattening animated ks fields.
            const ks: any = { ...raw.ks };
            const t = node.transform;

            // Check whether the user has added Creator keyframes for each property.
            // If so, mapProperty converts them to Lottie keyframe format (preserving animation).
            // Otherwise fall back to the lossless static-override approach (compare against import snapshot).
            const hasPosAnims = (node.animations?.['transform.x']?.length ?? 0) > 0 || (node.animations?.['transform.y']?.length ?? 0) > 0;
            const hasRotAnims = (node.animations?.['transform.rotation']?.length ?? 0) > 0;
            const hasScaleAnims = (node.animations?.['transform.scaleX']?.length ?? 0) > 0 || (node.animations?.['transform.scaleY']?.length ?? 0) > 0;
            const hasOpacityAnims = (node.animations?.['style.opacity']?.length ?? 0) > 0;

            const posEdited = !hasPosAnims && node._originalParsedX !== undefined &&
                (t.x !== node._originalParsedX || t.y !== node._originalParsedY);
            const rotEdited = !hasRotAnims && node._originalParsedRotation !== undefined &&
                t.rotation !== node._originalParsedRotation;
            const scaleEdited = !hasScaleAnims && node._originalParsedScaleX !== undefined &&
                (t.scaleX !== node._originalParsedScaleX || t.scaleY !== node._originalParsedScaleY);
            const opacityEdited = !hasOpacityAnims && node._originalParsedOpacity !== undefined &&
                node.style.opacity !== node._originalParsedOpacity;

            if (hasPosAnims) {
                ks.p = LottieExporter.mapProperty(
                    [LottieExporter.safeNum(t.x), LottieExporter.safeNum(t.y), 0],
                    node.animations!['transform.x'],
                    node.animations!['transform.y']
                );
            } else if (posEdited) {
                ks.p = { a: 0, k: [LottieExporter.safeNum(t.x), LottieExporter.safeNum(t.y), 0] };
            }

            if (hasRotAnims) {
                ks.r = LottieExporter.mapProperty(LottieExporter.safeNum(t.rotation), node.animations!['transform.rotation']);
            } else if (rotEdited) {
                ks.r = { a: 0, k: LottieExporter.safeNum(t.rotation) };
            }

            if (hasScaleAnims) {
                ks.s = LottieExporter.mapProperty(
                    [LottieExporter.safeNum(t.scaleX, 1) * 100, LottieExporter.safeNum(t.scaleY, 1) * 100, 100],
                    node.animations!['transform.scaleX']?.map(k => ({ ...k, value: k.value * 100 })),
                    node.animations!['transform.scaleY']?.map(k => ({ ...k, value: k.value * 100 }))
                );
            } else if (scaleEdited) {
                ks.s = { a: 0, k: [LottieExporter.safeNum(t.scaleX, 1) * 100, LottieExporter.safeNum(t.scaleY, 1) * 100, 100] };
            }

            if (hasOpacityAnims) {
                ks.o = LottieExporter.mapProperty(
                    LottieExporter.safeNum(node.style.opacity, 1) * 100,
                    node.animations!['style.opacity']?.map(k => ({ ...k, value: k.value * 100 }))
                );
            } else if (opacityEdited) {
                ks.o = { a: 0, k: LottieExporter.safeNum(node.style.opacity, 1) * 100 };
            }

            const losslessLayer: any = {
                ...raw,
                nm: node.name || raw.nm,
                ind: 0, // set later by exportArtboardLayers
                ip: LottieExporter.roundNum(node.inPoint ?? raw.ip ?? 0, 2),
                op: LottieExporter.roundNum(node.outPoint ?? raw.op ?? Math.round(safeDurationFrames), 2),
                st: LottieExporter.roundNum((node as any).startTime ?? raw.st ?? 0, 2),
                ks,
                hd: node.visible === false ? 1 : undefined,
                bm: blendMode !== 0 ? blendMode : undefined,
            };
            // Clean up undefined/default fields to keep output tidy
            if (!losslessLayer.hd) delete losslessLayer.hd;
            if (losslessLayer.bm === undefined || losslessLayer.bm === 0) delete losslessLayer.bm;
            if (losslessLayer.st === 0) delete losslessLayer.st;
            if (losslessLayer.ddd === 0) delete losslessLayer.ddd;
            // Re-apply masks if our model has them (may have been edited)
            if (node.masks && node.masks.length > 0) {
                losslessLayer.masksProperties = LottieExporter.mapMasks(node);
                losslessLayer.hasMask = true;
            }

            // Phase 3: overlay user-edited style properties onto the raw shape layer.
            // CRITICAL GUARD: Only apply when the user has actually changed a style property from
            // its originally imported value. Without this check, overlayStyleOnShapes would flatten
            // ALL fills in a multi-color layer to the single color the parser lifted onto the node —
            // completely breaking the visual appearance of complex imported animations.
            if (raw.ty === 4 && Array.isArray(losslessLayer.shapes)) {
                const hasFillAnim = (node.animations?.['style.fill']?.length ?? 0) > 0 || (node.animations?.['style.fillOpacity']?.length ?? 0) > 0;
                const fillEdited = hasFillAnim || (!!node.style.fill && node.style.fill !== node._originalParsedFill);
                
                const hasStrokeAnim = (node.animations?.['style.stroke']?.length ?? 0) > 0 || (node.animations?.['style.strokeWidth']?.length ?? 0) > 0 || (node.animations?.['style.strokeOpacity']?.length ?? 0) > 0;
                const strokeEdited = hasStrokeAnim ||
                    (!!node.style.stroke && node.style.stroke !== node._originalParsedStroke) ||
                    ((node.style.strokeWidth ?? 0) > 0 && node.style.strokeWidth !== node._originalParsedStrokeWidth) ||
                    !!node.style.strokeDash;
                
                const hasTrimAnim = (node.animations?.['style.trimStart']?.length ?? 0) > 0 ||
                    (node.animations?.['style.trimEnd']?.length ?? 0) > 0 ||
                    (node.animations?.['style.trimOffset']?.length ?? 0) > 0;
                const trimEdited = hasTrimAnim ||
                    (node.style.trimStart ?? 0) !== 0 || (node.style.trimEnd ?? 1) !== 1 || (node.style.trimOffset ?? 0) !== 0;

                // Only overlay fill/stroke when those are actually edited.
                // Calling overlayStyleOnShapes when only trim changed would flatten multi-color
                // imported layers to a single fill color (the one the parser lifted onto the node).
                // Trim is handled separately by Phase 3b below.
                // Always overlay style; the function will recursively evaluate edits for both the root layer and its inner shapes.
                losslessLayer.shapes = LottieExporter.overlayStyleOnShapes(losslessLayer.shapes, node, nodes, fillEdited, strokeEdited, trimEdited);

                // Phase 3b: Inject trim path for imported layers.
                // overlayStyleOnShapes only patches EXISTING tm items. If the original layer had
                // no trim path (which is the common case), we must inject one.
                // In Lottie, a `tm` item at the top level of the shapes array trims ALL preceding
                // sibling shapes (including sub-groups). This is how After Effects and lottie-web
                // apply trim paths to entire layers/groups.

                const ts = node.style.trimStart ?? 0;
                const te = node.style.trimEnd ?? 1;
                const to = node.style.trimOffset ?? 0;
                if (trimEdited || hasTrimAnim) {
                    // Remove any existing tm items at top level to avoid duplicates
                    losslessLayer.shapes = losslessLayer.shapes.filter((s: any) => s?.ty !== 'tm');
                    // Append new tm with proper animation support
                    losslessLayer.shapes.push({
                        ty: 'tm', nm: 'Trim Paths',
                        s: LottieExporter.mapProperty(ts * 100, node.animations?.['style.trimStart']?.map(k => ({ ...k, value: k.value * 100 }))),
                        e: LottieExporter.mapProperty(te * 100, node.animations?.['style.trimEnd']?.map(k => ({ ...k, value: k.value * 100 }))),
                        o: LottieExporter.mapProperty(to, node.animations?.['style.trimOffset']),
                        m: 1 // Simultaneously (affects all paths at once)
                    });
                }
            }
            // Overlay effects (blur, shadow) if the user has edited them
            if (node.style.effects && node.style.effects.length > 0) {
                const overlaidEffects = LottieExporter.mapEffects(node);
                if (overlaidEffects && overlaidEffects.length > 0) losslessLayer.ef = overlaidEffects;
            }

            return losslessLayer as LottieLayer;
        }

        let ty: any = 4; // Shape Layer
        if (node.type === 'group') {
            // If it's a layer-marked group with no children, it's a Null Layer
            ty = (node.props?.isLayer && (!node.children || node.children.length === 0)) ? 3 : 4;
        }
        else if (node.type === 'precomp') ty = 0;
        else if (node.type === 'image') ty = 2; // Image Layer
        else if (node.type === 'text') ty = 5;

        const layer: LottieLayer = {
            ty: ty as any,
            nm: node.name || 'Layer',
            ind: 0, // Set later
            ip: LottieExporter.roundNum(node.inPoint ?? 0, 2),
            op: LottieExporter.roundNum(node.outPoint ?? Math.round(safeDurationFrames), 2),
            st: 0,
            ks: LottieExporter.mapTransform(node, nodes, bakedTransform),
            hd: node.visible === false ? 1 : 0
        };

        // From-scratch text nodes: our transform.y means the TOP of the em box (textBaseline='top'),
        // but ThorVG / Lottie place the text BASELINE at ks.p.y.  Add the font's bounding-box ascent
        // so ThorVG's baseline rendering lands at the visual top we intend.
        // Imported text nodes are excluded — their transform.y was already parsed from the original
        // Lottie baseline position, so no correction is needed.
        if (node.type === 'text') {
            const fontSize = LottieExporter.safeNum(node.props?.fontSize, 24);
            const fontFamily = (node.props?.fontFamily || 'Arial').split(',')[0].trim();
            const fontWeight = node.props?.fontWeight || '400';
            const ascent = measureFontAscent(fontFamily, fontWeight, fontSize);
            const ksP = (layer.ks as any).p;
            if (ksP?.a === 0 && Array.isArray(ksP.k)) {
                ksP.k[1] = LottieExporter.safeNum(ksP.k[1]) + ascent;
            }
        }

        // Omit defaults and metadata
        if (blendMode !== 0) layer.bm = blendMode;
        if (layer.st === 0) delete layer.st;
        if (layer.hd === 0) delete layer.hd;
        // Strip 'ln' as it's purely internal for our editor transitions; animates fine without it.
        // If we really need it for state machines, we keep it, but LottieFiles doesn't use it.
        // Actually, let's keep it ONLY if used in state machine interactions, but for now we skip to save 2KB.
        // delete layer.ln; 

        // After reconsidering, keep 'nm' but if it's generic, we could potentially strip it.
        // For now, let's just strip 'ddd' if 0.
        if (layer.ddd === 0) delete layer.ddd;

        if (node.masks && node.masks.length > 0) {
            (layer as any).masksProperties = LottieExporter.mapMasks(node);
            (layer as any).hasMask = true;
        }

        if (node.type === 'precomp' && node.refId) {
            layer.refId = node.refId;
            // CRITICAL: Set layer width/height for precomps. 
            // Most Lottie editors use these for the clipping/viewport bounds of the nested scene.
            const assetArtboard = nodes.get(node.refId);
            if (assetArtboard) {
                layer.w = Math.round(LottieExporter.safeNum(assetArtboard.props?.width, 500));
                layer.h = Math.round(LottieExporter.safeNum(assetArtboard.props?.height, 500));
            }
        } else if (node.type === 'image' && node.props.src) {
            layer.refId = imageAssetMap.get(node.props.src);
        }

        if (node.matteTargetIds && node.matteTargetIds.length > 0) {
            (layer as any)._creatorMatteTargetIds = node.matteTargetIds;
            layer.td = 1; // Mark as matte source
            delete layer.hd; // CRITICAL FIX: Ensure track matte is not explicitly hidden
        }

        // Detect Solid layers: Originally ty=1, parsed as 'rect' with isLayer, fillType='solid', no children
        const isSolidLayer = node.type === 'rect' && node.props?.isLayer &&
            node.style.fillType === 'solid' && (!node.children || node.children.length === 0);

        if (isSolidLayer) {
            layer.ty = 1 as any;
            (layer as any).sw = Math.round(LottieExporter.safeNum(node.props?.width, 100));
            (layer as any).sh = Math.round(LottieExporter.safeNum(node.props?.height, 100));
            (layer as any).sc = node.style.fill || '#ffffff';
        } else if (node.type === 'text') {
            const fontSize = LottieExporter.safeNum(node.props?.fontSize, 24);
            const lhMultiplier = LottieExporter.safeNum(node.props?.lineHeight, 1.2);
            const verticalAlign = node.props?.verticalAlign || 'top';
            const vj = verticalAlign === 'middle' ? 1 : (verticalAlign === 'bottom' ? 2 : 0);

            const family = node.props?.fontFamily?.split(',')[0].trim() || 'Arial';
            const fName = LottieExporter.getFontName(family, node.props?.fontWeight);

            // Compute base fill color: use gradient first stop when gradient fill is active
            const isGradientFill = node.style?.fillType === 'gradient' && (node.style.fillGradient?.stops?.length ?? 0) > 0;
            const baseFc: [number, number, number] = isGradientFill
                ? LottieExporter.hexToRgbArray(node.style.fillGradient!.stops[0].color)
                : LottieExporter.hexToRgbArray(node.style?.fill || '#000000');

            const textData: any = {
                s: fontSize,
                f: fName,
                t: node.props?.text || '',
                j: node.props?.textAlign === 'center' ? 2 : (node.props?.textAlign === 'right' ? 1 : 0),
                tr: LottieExporter.safeNum(node.props?.letterSpacing, 0),
                lh: fontSize * lhMultiplier,
                ls: 0,
                fc: baseFc
            };

            if (LottieExporter.safeNum(node.props?.width, 0) > 0) {
                textData.sz = [
                    LottieExporter.safeNum(node.props?.width, 100),
                    LottieExporter.safeNum(node.props?.height, 100)
                ];
                textData.vj = vj;
            }

            // Build animated text document keyframes (Lottie text animation uses snapshot-per-frame, not nested props)
            const fillAnim = node.animations?.['style.fill'];
            const gradAnim = node.animations?.['style.fillGradient'];

            let textDocKeyframes: any[];
            if (gradAnim && gradAnim.length > 0) {
                textDocKeyframes = gradAnim.map(kf => {
                    const grad = kf.value;
                    const fc: [number, number, number] = grad?.stops?.length > 0
                        ? LottieExporter.hexToRgbArray(grad.stops[0].color)
                        : baseFc;
                    return { t: LottieExporter.safeNum(kf.time), s: { ...textData, fc } };
                });
            } else if (fillAnim && fillAnim.length > 0) {
                textDocKeyframes = fillAnim.map(kf => ({
                    t: LottieExporter.safeNum(kf.time),
                    s: { ...textData, fc: LottieExporter.hexToRgbArray(kf.value || '#000000') }
                }));
            } else {
                textDocKeyframes = [{ s: textData }];
            }

            layer.t = { d: { k: textDocKeyframes } };
        }
        else if (node.type !== 'image') {
            const shapeResult = LottieExporter.mapNodeToShape(node, nodes, true);
            if (shapeResult) {
                layer.shapes = Array.isArray(shapeResult) ? shapeResult : [shapeResult];
            }

            // Add Effects (Blur, Shadow)
            const effects = LottieExporter.mapEffects(node);
            if (effects) {
                (layer as any).ef = effects;
            }
        }

        return layer;
    }

    private static mapEffects(node: SceneNode): any[] | undefined {
        if (!node.style.effects || node.style.effects.length === 0) return undefined;

        return node.style.effects.map((effect, index) => {
            const prefix = `style.effects.${index}`;

            if (effect.type === 'blur') {
                return {
                    ty: 29, // Gaussian Blur
                    nm: effect.name || 'Gaussian Blur',
                    en: effect.visible ? 1 : 0,
                    ef: [
                        {
                            ty: 0,
                            nm: 'Blurriness',
                            v: LottieExporter.mapProperty(effect.blur, node.animations?.[`${prefix}.blur`])
                        },
                        {
                            ty: 7,
                            nm: 'Blur Dimensions',
                            v: { a: 0, k: 1 } // Both Horizontal and Vertical
                        },
                        {
                            ty: 4,
                            nm: 'Repeat Edge Pixels',
                            v: { a: 0, k: 1 }
                        }
                    ]
                };
            } else if (effect.type === 'shadow') {
                return {
                    ty: 25, // Drop Shadow
                    nm: effect.name || 'Drop Shadow',
                    en: effect.visible ? 1 : 0,
                    ef: [
                        {
                            ty: 2,
                            nm: 'Shadow Color',
                            v: LottieExporter.mapProperty(effect.color || '#000000', node.animations?.[`${prefix}.color`])
                        },
                        {
                            ty: 0,
                            nm: 'Opacity',
                            v: LottieExporter.mapProperty(Math.round((effect.opacity ?? 1) * 255), node.animations?.[`${prefix}.opacity`]?.map(k => ({ ...k, value: Math.round(k.value * 255) })))
                        },
                        {
                            ty: 0,
                            nm: 'Direction',
                            v: LottieExporter.mapProperty(effect.direction ?? 90, node.animations?.[`${prefix}.direction`])
                        },
                        {
                            ty: 0,
                            nm: 'Distance',
                            v: LottieExporter.mapProperty(effect.distance ?? 10, node.animations?.[`${prefix}.distance`])
                        },
                        {
                            ty: 0,
                            nm: 'Softness',
                            v: LottieExporter.mapProperty(effect.blur ?? 10, node.animations?.[`${prefix}.blur`])
                        }
                    ]
                };
            }
            return null;
        }).filter(Boolean);
    }

    private static fontWeightToStyle(weight: string | number | undefined): { fStyle: string; suffix: string } {
        const w = parseInt(String(weight ?? '400'), 10) || 400;
        const map: [number, string, string][] = [
            [100, 'Thin', 'Thin'],
            [200, 'ExtraLight', 'Extra Light'],
            [300, 'Light', 'Light'],
            [400, 'Regular', 'Regular'],
            [500, 'Medium', 'Medium'],
            [600, 'SemiBold', 'Semi Bold'],
            [700, 'Bold', 'Bold'],
            [800, 'ExtraBold', 'Extra Bold'],
            [900, 'Black', 'Black'],
        ];
        const [, suffix, fStyle] = map.reduce((prev, curr) =>
            Math.abs(curr[0] - w) < Math.abs(prev[0] - w) ? curr : prev
        );
        return { fStyle, suffix };
    }

    private static getFontName(family: string, weight: string | number | undefined): string {
        const { suffix } = LottieExporter.fontWeightToStyle(weight);
        const familyNormalized = family.replace(/\s+/g, '');
        return suffix === 'Regular' ? familyNormalized : `${familyNormalized}-${suffix}`;
    }

    private static roundNum(val: number, precision: number = 3): number {
        const factor = Math.pow(10, precision);
        return Math.round(val * factor) / factor;
    }

    private static safeNum(val: any, fallback: number = 0, precision: number = 3): number {
        if (typeof val !== 'number' || isNaN(val) || !isFinite(val)) return fallback;
        return LottieExporter.roundNum(val, precision);
    }

    private static hexToRgbArray(hex: any): [number, number, number] {
        if (!hex || typeof hex !== 'string') return [0, 0, 0];
        try {
            let h = hex.replace('#', '');
            if (h.length === 3) h = h.split('').map((c: string) => c + c).join('');
            const r = (parseInt(h.substring(0, 2), 16) || 0) / 255;
            const g = (parseInt(h.substring(2, 4), 16) || 0) / 255;
            const b = (parseInt(h.substring(4, 6), 16) || 0) / 255;
            return [LottieExporter.safeNum(r), LottieExporter.safeNum(g), LottieExporter.safeNum(b)];
        } catch (e) {
            return [0, 0, 0];
        }
    }

    private static mapTransform(node: SceneNode, nodes: Map<string, SceneNode>, transformOverwrite?: any): any {
        const t = transformOverwrite || node.transform;
        const resolvedAnchor = (transformOverwrite && transformOverwrite.anchorX !== undefined) 
            ? { x: transformOverwrite.anchorX, y: transformOverwrite.anchorY }
            : getAnimatedAnchor(node, nodes);

        const transform: any = {
            a: LottieExporter.mapProperty([LottieExporter.safeNum(resolvedAnchor.x), LottieExporter.safeNum(resolvedAnchor.y), 0], node.animations?.['transform.anchorX'], node.animations?.['transform.anchorY']),
            p: LottieExporter.mapProperty([LottieExporter.safeNum(t.x), LottieExporter.safeNum(t.y), 0], node.animations?.['transform.x'], node.animations?.['transform.y']),
            s: LottieExporter.mapProperty(
                [LottieExporter.safeNum(t.scaleX, 1) * 100, LottieExporter.safeNum(t.scaleY, 1) * 100, 100],
                node.animations?.['transform.scaleX']?.map(k => ({ ...k, value: k.value * 100 })),
                node.animations?.['transform.scaleY']?.map(k => ({ ...k, value: k.value * 100 }))
            ),
            r: LottieExporter.mapProperty(LottieExporter.safeNum(t.rotation), node.animations?.['transform.rotation']),
            o: LottieExporter.mapProperty(
                LottieExporter.safeNum(node.style?.opacity, 1) * 100,
                node.animations?.['style.opacity']?.map(k => ({ ...k, value: k.value * 100 }))
            )
        };

        // Omission logic removed for better compatibility with strict Lottie players.
        // We now keep r, o, a, p, and s even if they have default values.
        return transform;
    }


    private static mapNodeToShape(node: SceneNode, nodes: Map<string, SceneNode>, isLayerRoot: boolean = false): any[] | LottieShape | null {
        let it: any[] = [];
        let pathItem: any;

        const hasChildren = node.children && node.children.length > 0;
        const isLeafShape = !hasChildren && (node.type === 'rect' || node.type === 'ellipse' || node.type === 'path' || node.type === 'polystar');

        // For layer-root shapes, the layer transform (ks.p/ks.a) already positions the layer.
        // The shape's `p` (center in layer-local space) must be the shape's GEOMETRIC center,
        // NOT the layer anchor. The layer transform's T(-anchor) handles the anchor offset.
        //
        // In Lottie, `rc` (rect) and `el` (ellipse) draw centered at `p`. If `p` is set to the
        // anchor value, changing the anchor from center to top-left would shift the shape because
        // the shape's visual center would move with the anchor. Using the geometric center ensures
        // the shape stays in place — only the pivot (anchor) moves.
        //
        // Math proof (rect w=200, h=200, default anchor center (100,100), pos (250,250)):
        //   shape.p = (100,100) → rect corners: (0,0)-(200,200)
        //   T(-anchor) = T(-100,-100) → corners: (-100,-100)-(100,100)
        //   T(pos) → corners: (150,150)-(350,350) ✓
        //
        // After anchor change to top-left (0,0), pos compensated to (150,150):
        //   shape.p = (100,100) still → rect corners: (0,0)-(200,200)
        //   T(-anchor) = T(0,0) → corners: (0,0)-(200,200)
        //   T(pos) → corners: (150,150)-(350,350) ✓ (same visual position!)

        if (node.type === 'rect') {
            const w = LottieExporter.safeNum(node.props?.width, 100);
            const h = LottieExporter.safeNum(node.props?.height, 100);
            // Layer-root: shape center is always at geometric center (w/2, h/2)
            const px = isLayerRoot ? LottieExporter.safeNum(w / 2) : LottieExporter.safeNum(node.transform?.x, 0);
            const py = isLayerRoot ? LottieExporter.safeNum(h / 2) : LottieExporter.safeNum(node.transform?.y, 0);
            const pAnimX = isLayerRoot ? undefined : node.animations?.['transform.x'];
            const pAnimY = isLayerRoot ? undefined : node.animations?.['transform.y'];
            pathItem = {
                ty: 'rc', nm: 'Rect',
                s: LottieExporter.mapProperty([w, h], node.animations?.['props.width'], node.animations?.['props.height']),
                p: LottieExporter.mapProperty([px, py], pAnimX, pAnimY),
                r: LottieExporter.mapProperty(LottieExporter.safeNum(node.props?.roundness, 0), node.animations?.['props.roundness'])
            };
            if (pathItem.p.a === 0 && Array.isArray(pathItem.p.k) && pathItem.p.k.every((v: number) => v === 0)) delete pathItem.p;
            if (pathItem.r.a === 0 && pathItem.r.k === 0) delete pathItem.r;
        } else if (node.type === 'ellipse') {
            const rx = LottieExporter.safeNum(node.props?.radiusX, 50);
            const ry = LottieExporter.safeNum(node.props?.radiusY, 50);
            // Layer-root: ellipse center is at (rx, ry) in the editor's 0,0-to-2rx,2ry local space
            const px = isLayerRoot ? LottieExporter.safeNum(rx) : LottieExporter.safeNum(node.transform?.x, 0);
            const py = isLayerRoot ? LottieExporter.safeNum(ry) : LottieExporter.safeNum(node.transform?.y, 0);
            const pAnimX = isLayerRoot ? undefined : node.animations?.['transform.x'];
            const pAnimY = isLayerRoot ? undefined : node.animations?.['transform.y'];
            pathItem = {
                ty: 'el', nm: 'Ellipse',
                s: LottieExporter.mapProperty([rx * 2, ry * 2], node.animations?.['props.radiusX']?.map(k => ({ ...k, value: k.value * 2 })), node.animations?.['props.radiusY']?.map(k => ({ ...k, value: k.value * 2 }))),
                p: LottieExporter.mapProperty([px, py], pAnimX, pAnimY)
            };
            if (pathItem.p.a === 0 && Array.isArray(pathItem.p.k) && pathItem.p.k.every((v: number) => v === 0)) delete pathItem.p;
        } else if (node.type === 'polystar') {
            // Layer-root: polystar is inherently centered at origin (0,0)
            const px = isLayerRoot ? 0 : LottieExporter.safeNum(node.transform?.x, 0);
            const py = isLayerRoot ? 0 : LottieExporter.safeNum(node.transform?.y, 0);
            const pAnimX = isLayerRoot ? undefined : node.animations?.['transform.x'];
            const pAnimY = isLayerRoot ? undefined : node.animations?.['transform.y'];
            pathItem = {
                ty: 'sr', nm: node.name || 'Polystar',
                sy: (node.props?.starType === 'polygon' || node.props?.starType === 2) ? 2 : 1,
                p: LottieExporter.mapProperty([px, py], pAnimX, pAnimY),
                r: LottieExporter.mapProperty(LottieExporter.safeNum(node.transform?.rotation, 0), node.animations?.['transform.rotation']),
                pt: LottieExporter.mapProperty(LottieExporter.safeNum(node.props?.points, 5), node.animations?.['props.points']),
                ir: LottieExporter.mapProperty(LottieExporter.safeNum(node.props?.innerRadius, 25), node.animations?.['props.innerRadius']),
                is: LottieExporter.mapProperty(LottieExporter.safeNum(node.props?.innerRoundness, 0), node.animations?.['props.innerRoundness']),
                or: LottieExporter.mapProperty(LottieExporter.safeNum(node.props?.outerRadius, 50), node.animations?.['props.outerRadius']),
                os: LottieExporter.mapProperty(LottieExporter.safeNum(node.props?.outerRoundness, 0), node.animations?.['props.outerRoundness']),
            };
            if (pathItem.p.a === 0 && Array.isArray(pathItem.p.k) && pathItem.p.k.every((v: number) => v === 0)) delete pathItem.p;
            if (pathItem.r.a === 0 && pathItem.r.k === 0) delete pathItem.r;
        } else if (node.type === 'path') {
            pathItem = {
                ty: 'sh', nm: node.name || 'Path',
                ks: LottieExporter.mapProperty(node.props?.points, node.animations?.['props.points'])
            };
        }

        if (isLeafShape && pathItem) {
            const hasRoundnessAnim = node.animations?.['props.roundness'] && node.animations['props.roundness'].length > 0;
            if (!isLayerRoot) {
                // Non-layer leaf shape: return just geometry (parent group handles styles)
                let shapes = [pathItem];
                if ((LottieExporter.safeNum(node.props?.roundness, 0) > 0) || hasRoundnessAnim) {
                    shapes.push({
                        ty: 'rd', nm: 'Rounded Corners',
                        r: LottieExporter.mapProperty(LottieExporter.safeNum(node.props.roundness, 0), node.animations?.['props.roundness'])
                    });
                }
                return shapes;
            }
            // Layer root leaf shape: push geometry into `it` and fall through
            // to the layer root section below which adds fill/stroke styles + transform
            it.push(pathItem);
            if ((LottieExporter.safeNum(node.props?.roundness, 0) > 0) || hasRoundnessAnim) {
                it.push({
                    ty: 'rd', nm: 'Rounded Corners',
                    r: LottieExporter.mapProperty(LottieExporter.safeNum(node.props.roundness, 0), node.animations?.['props.roundness'])
                });
            }

            // ── Two-group outside stroke (rect / ellipse only, static dims + static strokeWidth) ──
            // Instead of fill-on-top + doubled-width (which creates D-shapes for round-cap dashes),
            // use an expanded path for the stroke so its centerline sits S/2 outside the fill edge.
            // Result: stroke (and its dashes/caps) is entirely outside the fill boundary.
            if (isLayerRoot && (node.type === 'rect' || node.type === 'ellipse')) {
                const sAlign = node.style.strokeAlign ?? 'outside';
                const S = LottieExporter.safeNum(node.style.strokeWidth, 0);
                const hasFill = node.style.fillVisible !== false &&
                    !!(node.style.fill || (node.style.fillType === 'gradient' && node.style.fillGradient));
                const hasStroke = !!(node.style.stroke) && S > 0;
                const hasStrokeAnim  = !!(node.animations?.['style.strokeWidth']?.length);
                const hasSizeAnim    = node.type === 'rect'
                    ? !!(node.animations?.['props.width']?.length || node.animations?.['props.height']?.length)
                    : !!(node.animations?.['props.radiusX']?.length || node.animations?.['props.radiusY']?.length);
                const hasTrimActive  = (node.style.trimStart ?? 0) !== 0 || (node.style.trimEnd ?? 1) !== 1 || (node.style.trimOffset ?? 0) !== 0;
                const hasTrimAnim    = !!(node.animations?.['style.trimStart']?.length || node.animations?.['style.trimEnd']?.length || node.animations?.['style.trimOffset']?.length);
                const hasRepeater    = node.style.effects?.some(e => e.type === 'repeater' && e.visible !== false);

                if (sAlign === 'outside' && hasFill && hasStroke && !hasStrokeAnim && !hasSizeAnim && !hasTrimActive && !hasTrimAnim && !hasRepeater) {
                    // Capture path items already pushed, then clear
                    const fillPathItems = [...it];
                    it.length = 0;

                    // Build expanded path for stroke (centerline S/2 outside fill edge)
                    const zeroTr = { ty: 'tr', p: {a:0,k:[0,0]}, a: {a:0,k:[0,0]}, s: {a:0,k:[100,100]}, r: {a:0,k:0}, o: {a:0,k:100} };
                    let expandedPathItem: any;
                    if (node.type === 'rect') {
                        const w = LottieExporter.safeNum(node.props?.width, 100);
                        const h = LottieExporter.safeNum(node.props?.height, 100);
                        const R = LottieExporter.safeNum(node.props?.roundness, 0);
                        expandedPathItem = {
                            ty: 'rc', nm: 'Rect',
                            s: { a: 0, k: [w + S, h + S] },
                            p: { a: 0, k: [LottieExporter.safeNum(w / 2), LottieExporter.safeNum(h / 2)] }
                        };
                        // Round join: corners become circular arcs of radius S/2, so expand r by S/2.
                        // Miter/bevel join: the stroke corner is handled by the lj property at the
                        // sharp angle of the expanded rect — keep r = R so the corner vertices are
                        // sharp (when R=0) and lj actually takes effect. Adding S/2 here would make
                        // corners smooth bezier curves, which would suppress the lj setting entirely.
                        const lj = node.style.strokeLinejoin ?? 'round';
                        const eR = lj === 'round' ? R + S / 2 : R;
                        if (eR > 0) expandedPathItem.r = { a: 0, k: eR };
                    } else {
                        const rx = LottieExporter.safeNum(node.props?.radiusX, 50);
                        const ry = LottieExporter.safeNum(node.props?.radiusY, 50);
                        expandedPathItem = {
                            ty: 'el', nm: 'Ellipse',
                            s: { a: 0, k: [rx * 2 + S, ry * 2 + S] },
                            p: { a: 0, k: [LottieExporter.safeNum(rx), LottieExporter.safeNum(ry)] }
                        };
                    }

                    // Fill group (lower index = on top in ThorVG)
                    const fillIt: any[] = [...fillPathItems];
                    LottieExporter.addStylesToIt(node, nodes, fillIt, true, { onlyFill: true });
                    fillIt.push(zeroTr);
                    it.push({ ty: 'gr', nm: node.name + ' Fill', it: fillIt });

                    // Stroke group (higher index = behind fill)
                    const strokeIt: any[] = [expandedPathItem];
                    LottieExporter.addStylesToIt(node, nodes, strokeIt, true, { onlyStroke: true, strokeWidth: S });
                    strokeIt.push(zeroTr);
                    it.push({ ty: 'gr', nm: node.name + ' Stroke', it: strokeIt });

                    return it; // Layer root returns flat shapes array; transform is in layer.ks
                }
            }
        }

        // --- GROUP OR LAYER ROOT ---
        // Tracks whether any shape primitives (rc, el, sh, sr) landed directly in `it`
        // (not wrapped in a gr sub-group). Only when true should the parent group's own
        // fill/stroke be emitted at this level — otherwise a stray fl with no sibling
        // shape would cause ThorVG to render a solid rectangle over the entire layer.
        let hasUnwrappedShapesInIt = false;

        if (hasChildren) {
            const isMergeTarget = node.mergeMode && node.mergeMode !== 'none';
            [...node.children].reverse().forEach(childId => {
                const child = nodes.get(childId);
                const isLiftingHidden = child && child.visible === false && isMergeTarget;

                if (child && (child.visible !== false || isLiftingHidden) &&
                    (child.type === 'rect' || child.type === 'ellipse' || child.type === 'path' || child.type === 'group')) {

                    const isChildLeaf = !(child.children && child.children.length > 0) && (child.type === 'rect' || child.type === 'ellipse' || child.type === 'path');

                    const childShape = LottieExporter.mapNodeToShape(child, nodes);
                    if (childShape) {
                        const childHasStyle = (child.style.fill && child.style.fill !== 'none') || (child.style.stroke && child.style.stroke !== 'none') || (child.style.fillType === 'gradient');

                        if (isChildLeaf && childHasStyle) {
                            // Zero rc.p/el.p/sr.p so position is not double-applied.
                            // The full x,y goes into tr.p; tr.s only scales geometry, not position.
                            const rawLeafIt = Array.isArray(childShape) ? [...childShape] : [childShape];
                            const leafIt = rawLeafIt.map((s: any) => {
                                if ((s.ty === 'rc' || s.ty === 'el' || s.ty === 'sr') && s.p !== undefined) {
                                    return { ...s, p: { a: 0, k: [0, 0] } };
                                }
                                return s;
                            });
                            LottieExporter.addStylesToIt(child, nodes, leafIt);

                            // Preserve x,y in wrapper transform — only zero anchor so scale doesn't shift position.
                            const wrapperTransform = { ...child.transform, anchorX: 0, anchorY: 0 };
                            leafIt.push({ ty: 'tr', nm: 'Transform', ...LottieExporter.mapTransform(child, nodes, wrapperTransform) });
                            it.push({ ty: 'gr', nm: child.name || 'Path Group', it: leafIt });
                            // Leaf is wrapped in gr — no raw shape primitive lands in `it`
                        } else if (Array.isArray(childShape)) {
                            it.push(...childShape);
                            if (isChildLeaf) hasUnwrappedShapesInIt = true;
                        } else {
                            it.push(childShape);
                        }
                    }
                }
            });
        }

        if (node.mergeMode && node.mergeMode !== 'none') {
            const mmMap: Record<string, number> = { 'union': 1, 'add': 1, 'merge': 1, 'subtract': 3, 'intersect': 4, 'exclude': 5 };
            let mm = 1;
            if (typeof node.mergeMode === 'number') {
                mm = node.mergeMode;
            } else {
                mm = mmMap[node.mergeMode as string] || 1;
            }
            it.push({ ty: 'mm', nm: 'Merge Paths', mm });
        }

        // Emit the node's own fill/stroke only when there are unwrapped shape primitives
        // directly in `it`. If every child was wrapped in its own `gr` (because childHasStyle),
        // adding a fill here would produce a stray fl with no sibling shape, which ThorVG
        // renders as a solid-color rectangle covering the entire layer area.
        // Exception: boolean merge groups always need a fill to color the merged result.
        const isMergeNode = !!(node.mergeMode && node.mergeMode !== 'none');
        const shouldEmitStyles = hasUnwrappedShapesInIt || (!hasChildren && isLayerRoot) || isMergeNode;
        if (shouldEmitStyles) {
            LottieExporter.addStylesToIt(node, nodes, it, true); // skipTrim=true — emitted separately below
        }

        // Trim is always emitted at the current level as a sibling to all child items.
        // In the Lottie spec (AE/lottie-web), tm applies to all siblings including gr sub-groups,
        // so this correctly trims all child shapes regardless of nesting depth.
        {
            const hasTrimAnim = (node.animations?.['style.trimStart']?.length ?? 0) > 0 ||
                (node.animations?.['style.trimEnd']?.length ?? 0) > 0 ||
                (node.animations?.['style.trimOffset']?.length ?? 0) > 0;
            const ts = node.style.trimStart ?? 0, te = node.style.trimEnd ?? 1, to = node.style.trimOffset ?? 0;
            if (ts !== 0 || te !== 1 || to !== 0 || hasTrimAnim) {
                it.push({
                    ty: 'tm', nm: 'Trim Paths',
                    s: LottieExporter.mapProperty(ts * 100, node.animations?.['style.trimStart']?.map(k => ({ ...k, value: k.value * 100 }))),
                    e: LottieExporter.mapProperty(te * 100, node.animations?.['style.trimEnd']?.map(k => ({ ...k, value: k.value * 100 }))),
                    o: LottieExporter.mapProperty(to, node.animations?.['style.trimOffset']),
                    m: 1
                });
            }
        }

        if (isLayerRoot) {
            // Add Repeaters (Phase 2)
            if (node.style.effects) {
                node.style.effects.forEach((effect, idx) => {
                    if (effect.type === 'repeater' && effect.visible !== false) {
                        const prefix = `style.effects.${idx}`;
                        it.push({
                            ty: 'rp', nm: effect.name || 'Repeater',
                            c: LottieExporter.mapProperty(effect.copies ?? 3, node.animations?.[`${prefix}.copies`]),
                            o: LottieExporter.mapProperty(effect.offset ?? 0, node.animations?.[`${prefix}.offset`]),
                            m: effect.composite === 'above' ? 1 : 2,
                            tr: {
                                p: LottieExporter.mapProperty([effect.repeaterTransform?.x ?? 100, effect.repeaterTransform?.y ?? 0, 0], node.animations?.[`${prefix}.repeaterTransform.x`], node.animations?.[`${prefix}.repeaterTransform.y`]),
                                a: { a: 0, k: [0, 0, 0] },
                                s: LottieExporter.mapProperty(
                                    [(effect.repeaterTransform?.scaleX ?? 1) * 100, (effect.repeaterTransform?.scaleY ?? 1) * 100, 100],
                                    node.animations?.[`${prefix}.repeaterTransform.scaleX`]?.map(k => ({ ...k, value: k.value * 100 })),
                                    node.animations?.[`${prefix}.repeaterTransform.scaleY`]?.map(k => ({ ...k, value: k.value * 100 }))
                                ),
                                r: LottieExporter.mapProperty(effect.repeaterTransform?.rotation ?? 0, node.animations?.[`${prefix}.repeaterTransform.rotation`]),
                                so: LottieExporter.mapProperty((effect.repeaterTransform?.startOpacity ?? 1) * 100, node.animations?.[`${prefix}.repeaterTransform.startOpacity`]?.map(k => ({ ...k, value: k.value * 100 }))),
                                eo: LottieExporter.mapProperty((effect.repeaterTransform?.endOpacity ?? 1) * 100, node.animations?.[`${prefix}.repeaterTransform.endOpacity`]?.map(k => ({ ...k, value: k.value * 100 })))
                            }
                        });
                    }
                });
            }
            // Layer root: always return items flat — no extra gr wrapper.
            // Leaf shapes avoid the Layer→gr→rc nesting; group layers avoid the
            // Layer→outer-gr→inner-gr→rc nesting. The layer's ks carries the transform.
            return it;
        } else {
            it.push({ ty: 'tr', nm: 'Transform', ...LottieExporter.mapTransform(node, nodes) });
        }

        return { ty: 'gr', nm: node.name || 'Group', it: it };
    }

    private static addStylesToIt(
        node: SceneNode,
        nodes: Map<string, SceneNode>,
        it: any[],
        skipTrim = false,
        opt?: { onlyFill?: boolean; onlyStroke?: boolean; strokeWidth?: number }
    ) {
        // In Lottie / ThorVG, LOWER-index items in the `it` array render ON TOP (same as the AE
        // layer stack: index 0 = topmost, index N = bottommost).
        // For correct stroke-over-fill behavior:
        //   center / inside  → push stroke first (index 0, on top), then fill (below)
        //   outside          → double the stroke width, push fill first (index 0, on top);
        //                      fill occludes the inner half of the doubled stroke, exposing only the outer half.
        //   outside (two-group path-expansion mode) → stroke uses expanded path at original width;
        //                      caller handles groups, opt.strokeWidth carries the original width.
        // 'inside' has no native Lottie representation (would need a clip mask); it is rendered as center.
        const strokeAlign = node.style.strokeAlign ?? 'outside';
        const strokeIsOutside = strokeAlign === 'outside';
        // Use caller-supplied strokeWidth when in two-group mode; otherwise use normal/doubled width.
        const effectiveStrokeWidth = opt?.strokeWidth !== undefined
            ? opt.strokeWidth
            : (strokeIsOutside
                ? LottieExporter.safeNum(node.style.strokeWidth, 1) * 2
                : LottieExporter.safeNum(node.style.strokeWidth, 1));

        const fillItems: any[] = [];
        const strokeItems: any[] = [];

        const fillVisible = node.style.fillVisible !== false;
        if (fillVisible) {
            if (node.style.fillType === 'gradient' && node.style.fillGradient) {
                const { base: grad, anim, stopCount, hasAlpha: gradHasAlpha } =
                    LottieExporter.normalizeGradientSet(
                        node.style.fillGradient,
                        node.animations?.['style.fillGradient']
                    );
                // Pre-convert normalized gradients to flat arrays with consistent hasAlpha
                // so mapProperty receives plain number arrays (no per-keyframe hasAlpha drift).
                const gradFlat = LottieExporter.mapGradient(grad, gradHasAlpha);
                const animFlat = anim?.map(kf => ({
                    ...kf,
                    value: kf.value ? LottieExporter.mapGradient(kf.value, gradHasAlpha) : kf.value
                }));
                const fill: any = {
                    ty: 'gf', nm: 'Gradient Fill',
                    o: LottieExporter.mapProperty(LottieExporter.safeNum(node.style.fillOpacity, 1) * 100, node.animations?.['style.fillOpacity']?.map(k => ({ ...k, value: k.value * 100 }))),
                    s: LottieExporter.mapProperty([grad.start.x, grad.start.y], anim?.map(k => ({ ...k, value: [k.value.start.x, k.value.start.y] }))),
                    e: LottieExporter.mapProperty([grad.end.x, grad.end.y], anim?.map(k => ({ ...k, value: [k.value.end.x, k.value.end.y] }))),
                    t: grad.type === 'linear' ? 1 : 2,
                    g: { p: stopCount, k: LottieExporter.mapProperty(gradFlat, animFlat) },
                    r: node.style.fillRule === 'evenodd' ? 2 : 1
                };
                if (grad.type === 'radial') {
                    fill.h = LottieExporter.mapProperty(grad.highlightLength ?? 0, anim?.map(k => ({ ...k, value: k.value.highlightLength ?? 0 })));
                    fill.a = LottieExporter.mapProperty(grad.highlightAngle ?? 0, anim?.map(k => ({ ...k, value: k.value.highlightAngle ?? 0 })));
                }
                if (fill.o.a === 0 && fill.o.k === 100) delete fill.o;
                if (fill.r === 1) delete fill.r;
                fillItems.push(fill);
            } else if (node.style.fill) {
                const fill: any = {
                    ty: 'fl', nm: 'Fill',
                    c: LottieExporter.mapProperty(LottieExporter.hexToRgbArray(node.style.fill), node.animations?.['style.fill']),
                    o: LottieExporter.mapProperty(LottieExporter.safeNum(node.style.fillOpacity, 1) * 100, node.animations?.['style.fillOpacity']?.map(k => ({ ...k, value: k.value * 100 }))),
                    r: node.style.fillRule === 'evenodd' ? 2 : 1
                };
                if (fill.o.a === 0 && fill.o.k === 100) delete fill.o;
                if (fill.r === 1) delete fill.r;
                fillItems.push(fill);
            }
        }

        if (node.style.stroke && node.style.strokeWidth) {
            if (node.style.strokeType === 'gradient' && node.style.strokeGradient) {
                const { base: grad, anim, stopCount, hasAlpha: gradHasAlpha } =
                    LottieExporter.normalizeGradientSet(
                        node.style.strokeGradient,
                        node.animations?.['style.strokeGradient']
                    );
                const gradFlat = LottieExporter.mapGradient(grad, gradHasAlpha);
                const animFlat = anim?.map(kf => ({
                    ...kf,
                    value: kf.value ? LottieExporter.mapGradient(kf.value, gradHasAlpha) : kf.value
                }));
                const stroke: any = {
                    ty: 'gs', nm: 'Gradient Stroke',
                    o: LottieExporter.mapProperty(LottieExporter.safeNum(node.style.strokeOpacity, 1) * 100, node.animations?.['style.strokeOpacity']?.map(k => ({ ...k, value: k.value * 100 }))),
                    w: LottieExporter.mapProperty(effectiveStrokeWidth, node.animations?.['style.strokeWidth']),
                    s: LottieExporter.mapProperty([grad.start.x, grad.start.y], anim?.map(k => ({ ...k, value: [k.value.start.x, k.value.start.y] }))),
                    e: LottieExporter.mapProperty([grad.end.x, grad.end.y], anim?.map(k => ({ ...k, value: [k.value.end.x, k.value.end.y] }))),
                    t: grad.type === 'linear' ? 1 : 2,
                    g: { p: stopCount, k: LottieExporter.mapProperty(gradFlat, animFlat) },
                    lc: node.style.strokeLinecap === 'butt' ? 1 : (node.style.strokeLinecap === 'square' ? 3 : 2),
                    lj: node.style.strokeLinejoin === 'miter' ? 1 : (node.style.strokeLinejoin === 'bevel' ? 3 : 2),
                    ml: 4
                };
                if (grad.type === 'radial') {
                    stroke.h = LottieExporter.mapProperty(grad.highlightLength ?? 0, anim?.map(k => ({ ...k, value: k.value.highlightLength ?? 0 })));
                    stroke.a = LottieExporter.mapProperty(grad.highlightAngle ?? 0, anim?.map(k => ({ ...k, value: k.value.highlightAngle ?? 0 })));
                }
                if (stroke.o.a === 0 && stroke.o.k === 100) delete stroke.o;
                strokeItems.push(stroke);
            } else {
                const stroke: any = {
                    ty: 'st', nm: 'Stroke',
                    c: LottieExporter.mapProperty(LottieExporter.hexToRgbArray(node.style.stroke), node.animations?.['style.stroke']),
                    o: LottieExporter.mapProperty(LottieExporter.safeNum(node.style.strokeOpacity, 1) * 100, node.animations?.['style.strokeOpacity']?.map(k => ({ ...k, value: k.value * 100 }))),
                    w: LottieExporter.mapProperty(effectiveStrokeWidth, node.animations?.['style.strokeWidth']),
                    lc: node.style.strokeLinecap === 'butt' ? 1 : (node.style.strokeLinecap === 'square' ? 3 : 2),
                    lj: node.style.strokeLinejoin === 'miter' ? 1 : (node.style.strokeLinejoin === 'bevel' ? 3 : 2),
                    ml: 4
                };
                if (node.style.strokeDash) {
                    const dashVals = (node.style.strokeDash as string).split(/[\s,]+/).map(Number).filter(n => !isNaN(n) && n >= 0);
                    if (dashVals.length > 0) {
                        const d: any[] = [];
                        for (let i = 0; i < dashVals.length; i += 2) {
                            d.push({ n: 'd', nm: 'Dash', v: { a: 0, k: dashVals[i] } });
                            if (i + 1 < dashVals.length) d.push({ n: 'g', nm: 'Gap', v: { a: 0, k: dashVals[i + 1] } });
                        }
                        stroke.d = d;
                    }
                }
                if (stroke.o.a === 0 && stroke.o.k === 100) delete stroke.o;
                strokeItems.push(stroke);
            }
        }

        // Lower-index = on top. Push in z-order: top item first.
        // outside → fill first (index 0, on top to occlude inner half), stroke second (behind)
        // center/inside → stroke first (index 0, on top), fill second (behind)
        // When opt.onlyFill / opt.onlyStroke are set, only emit that subset (used for two-group outside stroke).
        const emitFill   = !opt?.onlyStroke;
        const emitStroke = !opt?.onlyFill;
        if (strokeIsOutside) {
            if (emitFill)   fillItems.forEach(f => it.push(f));
            if (emitStroke) strokeItems.forEach(s => it.push(s));
        } else {
            if (emitStroke) strokeItems.forEach(s => it.push(s));
            if (emitFill)   fillItems.forEach(f => it.push(f));
        }

        const hasTrimAnim = (node.animations?.['style.trimStart']?.length ?? 0) > 0 ||
            (node.animations?.['style.trimEnd']?.length ?? 0) > 0 ||
            (node.animations?.['style.trimOffset']?.length ?? 0) > 0;
        const ts = node.style.trimStart ?? 0, te = node.style.trimEnd ?? 1, to = node.style.trimOffset ?? 0;
        if (!skipTrim && (ts !== 0 || te !== 1 || to !== 0 || hasTrimAnim)) {
            it.push({
                ty: 'tm', nm: 'Trim Paths',
                s: LottieExporter.mapProperty(ts * 100, node.animations?.['style.trimStart']?.map(k => ({ ...k, value: k.value * 100 }))),
                e: LottieExporter.mapProperty(te * 100, node.animations?.['style.trimEnd']?.map(k => ({ ...k, value: k.value * 100 }))),
                o: LottieExporter.mapProperty(to, node.animations?.['style.trimOffset']),
                m: 1
            });
        }

        // Offset Path (Phase 2)
        if (node.style.effects) {
            node.style.effects.forEach((effect, idx) => {
                if (effect.type === 'offsetPath' && effect.visible !== false) {
                    const prefix = `style.effects.${idx}`;
                    it.push({
                        ty: 'op', nm: effect.name || 'Offset Path',
                        a: LottieExporter.mapProperty(effect.amount ?? 0, node.animations?.[`${prefix}.amount`]),
                        lj: effect.lineJoin === 'round' ? 2 : (effect.lineJoin === 'bevel' ? 3 : 1),
                        ml: LottieExporter.mapProperty(effect.miterLimit ?? 4, node.animations?.[`${prefix}.miterLimit`]),
                    });
                }
            });
        }
    }
    /**
     * Phase 3: Deep-patches a Lottie shapes array with the current SceneNode style values.
     * Only modifies static (non-animated, a===0) fill/stroke/trim properties — animated ones
     * are left completely untouched so keyframe sequences are preserved.
     * Returns a new array (never mutates _rawLottieData).
     */
    private static overlayStyleOnShapes(shapes: any[], fallbackNode: SceneNode | null, nodes: Map<string, SceneNode>, fallbackFillEdited: boolean = false, fallbackStrokeEdited: boolean = false, fallbackTrimEdited: boolean = false): any[] {
        let lastSeenShapeNode: SceneNode | null = null;
        let lastSeenFillEdited = false;
        let lastSeenStrokeEdited = false;
        let lastSeenTrimEdited = false;
        let processedTmForLastShape = false;

        const mappedShapes = shapes.map(item => {
            if (!item) return item;

            // Resolve the active node if tagged
            let activeNode: SceneNode | undefined = undefined;
            if (item._creatorId && nodes.has(item._creatorId)) {
                activeNode = nodes.get(item._creatorId);
            }

            // Recurse into shape groups
            if (item.ty === 'gr' && Array.isArray(item.it)) {
                let groupFillEdited = fallbackFillEdited;
                let groupStrokeEdited = fallbackStrokeEdited;
                let groupTrimEdited = fallbackTrimEdited;
                let groupNode = fallbackNode;

                if (activeNode) {
                    groupNode = activeNode;
                    if (activeNode._originalParsedFill !== undefined) {
                        const hasFillAnim = (activeNode.animations?.['style.fill']?.length ?? 0) > 0 || (activeNode.animations?.['style.fillOpacity']?.length ?? 0) > 0;
                        groupFillEdited = hasFillAnim || (!!activeNode.style.fill && activeNode.style.fill !== activeNode._originalParsedFill);
                        
                        const hasStrokeAnim = (activeNode.animations?.['style.stroke']?.length ?? 0) > 0 || (activeNode.animations?.['style.strokeWidth']?.length ?? 0) > 0 || (activeNode.animations?.['style.strokeOpacity']?.length ?? 0) > 0;
                        groupStrokeEdited = hasStrokeAnim || (!!activeNode.style.stroke && activeNode.style.stroke !== activeNode._originalParsedStroke) ||
                                            ((activeNode.style.strokeWidth ?? 0) > 0 && activeNode.style.strokeWidth !== activeNode._originalParsedStrokeWidth);
                    }
                    
                    const hasTrimAnim = (activeNode.animations?.['style.trimStart']?.length ?? 0) > 0 ||
                                        (activeNode.animations?.['style.trimEnd']?.length ?? 0) > 0 ||
                                        (activeNode.animations?.['style.trimOffset']?.length ?? 0) > 0;
                    groupTrimEdited = hasTrimAnim || (activeNode.style.trimStart ?? 0) !== 0 || (activeNode.style.trimEnd ?? 1) !== 1 || (activeNode.style.trimOffset ?? 0) !== 0;
                }

                let newIt = LottieExporter.overlayStyleOnShapes(item.it, groupNode, nodes, groupFillEdited, groupStrokeEdited, groupTrimEdited);

                // Phase 3b for nested groups: Inject trim path if the group was edited but had no tm item natively
                if (groupTrimEdited && groupNode) {
                    const hasTm = newIt.some((s: any) => s?.ty === 'tm');
                    if (!hasTm) {
                        const ts = groupNode.style.trimStart ?? 0;
                        const te = groupNode.style.trimEnd ?? 1;
                        const to = groupNode.style.trimOffset ?? 0;
                        // Prepend before the transform item (tr) if it exists, otherwise append
                        const trIndex = newIt.findIndex((s: any) => s?.ty === 'tr');
                        const tmItem = {
                            ty: 'tm', nm: 'Trim Paths',
                            s: LottieExporter.mapProperty(ts * 100, groupNode.animations?.['style.trimStart']?.map(k => ({ ...k, value: k.value * 100 }))),
                            e: LottieExporter.mapProperty(te * 100, groupNode.animations?.['style.trimEnd']?.map(k => ({ ...k, value: k.value * 100 }))),
                            o: LottieExporter.mapProperty(to, groupNode.animations?.['style.trimOffset']),
                            m: 1
                        };
                        if (trIndex >= 0) {
                            newIt.splice(trIndex, 0, tmItem);
                        } else {
                            newIt.push(tmItem);
                        }
                    }
                }

                return { ...item, it: newIt };
            }

            // Track nodes of the shapes we encounter before hitting the fill/stroke operators
            if (item.ty === 'rc' || item.ty === 'el' || item.ty === 'sh' || item.ty === 'sr') {
                if (activeNode) {
                    lastSeenShapeNode = activeNode;
                    if (activeNode._originalParsedFill !== undefined) {
                        const hasFillAnim = (activeNode.animations?.['style.fill']?.length ?? 0) > 0 || (activeNode.animations?.['style.fillOpacity']?.length ?? 0) > 0;
                        lastSeenFillEdited = hasFillAnim || (!!activeNode.style.fill && activeNode.style.fill !== activeNode._originalParsedFill);
                        
                        const hasStrokeAnim = (activeNode.animations?.['style.stroke']?.length ?? 0) > 0 || (activeNode.animations?.['style.strokeWidth']?.length ?? 0) > 0 || (activeNode.animations?.['style.strokeOpacity']?.length ?? 0) > 0;
                        lastSeenStrokeEdited = hasStrokeAnim || (!!activeNode.style.stroke && activeNode.style.stroke !== activeNode._originalParsedStroke) ||
                                            ((activeNode.style.strokeWidth ?? 0) > 0 && activeNode.style.strokeWidth !== activeNode._originalParsedStrokeWidth);
                    } else {
                        lastSeenFillEdited = false;
                        lastSeenStrokeEdited = false;
                    }
                    
                    const hasTrimAnim = (activeNode.animations?.['style.trimStart']?.length ?? 0) > 0 ||
                                        (activeNode.animations?.['style.trimEnd']?.length ?? 0) > 0 ||
                                        (activeNode.animations?.['style.trimOffset']?.length ?? 0) > 0;
                    lastSeenTrimEdited = hasTrimAnim || (activeNode.style.trimStart ?? 0) !== 0 || (activeNode.style.trimEnd ?? 1) !== 1 || (activeNode.style.trimOffset ?? 0) !== 0;
                    processedTmForLastShape = false;
                }
                return item;
            }

            // Determine effective node and edit flags for operators (fl, st, tm)
            const nodeToApply = lastSeenShapeNode || fallbackNode;
            if (!nodeToApply) return item;

            const isFillEdited = lastSeenShapeNode ? lastSeenFillEdited : fallbackFillEdited;
            const isStrokeEdited = lastSeenShapeNode ? lastSeenStrokeEdited : fallbackStrokeEdited;
            const isTrimEdited = lastSeenShapeNode ? lastSeenTrimEdited : fallbackTrimEdited;

            if (!isFillEdited && !isStrokeEdited && !isTrimEdited) return item;

            // Fill — overlay color and keyframes
            if (isFillEdited && item.ty === 'fl') {
                const hasFillAnim = (nodeToApply.animations?.['style.fill']?.length ?? 0) > 0;
                const hasOpacAnim = (nodeToApply.animations?.['style.fillOpacity']?.length ?? 0) > 0;

                if (hasFillAnim || item.c?.a === 0) {
                    const result: any = { ...item };
                    result.c = LottieExporter.mapProperty(
                        LottieExporter.hexToRgbArray(nodeToApply.style.fill!),
                        nodeToApply.animations?.['style.fill']
                    );
                    
                    if (hasOpacAnim || item.o?.a === 0 || nodeToApply.style.fillOpacity !== undefined) {
                        result.o = LottieExporter.mapProperty(
                            LottieExporter.safeNum(nodeToApply.style.fillOpacity ?? 1) * 100,
                            nodeToApply.animations?.['style.fillOpacity']?.map(k => ({ ...k, value: k.value * 100 }))
                        );
                    }
                    if (nodeToApply.style.fillRule !== undefined) result.r = nodeToApply.style.fillRule === 'evenodd' ? 2 : 1;
                    return result;
                }
            }

            // Stroke — overlay color, width and keyframes
            if (isStrokeEdited && item.ty === 'st') {
                const hasStrokeAnim = (nodeToApply.animations?.['style.stroke']?.length ?? 0) > 0;
                const hasWidthAnim = (nodeToApply.animations?.['style.strokeWidth']?.length ?? 0) > 0;
                const hasOpacAnim = (nodeToApply.animations?.['style.strokeOpacity']?.length ?? 0) > 0;

                const result: any = { ...item };
                let modified = false;

                if (hasStrokeAnim || item.c?.a === 0) {
                    result.c = LottieExporter.mapProperty(
                        LottieExporter.hexToRgbArray(nodeToApply.style.stroke!),
                        nodeToApply.animations?.['style.stroke']
                    );
                    modified = true;
                }
                
                if (hasWidthAnim || item.w?.a === 0 || nodeToApply.style.strokeWidth !== undefined) {
                    result.w = LottieExporter.mapProperty(
                        LottieExporter.safeNum(nodeToApply.style.strokeWidth),
                        nodeToApply.animations?.['style.strokeWidth']
                    );
                    modified = true;
                }
                
                if (hasOpacAnim || item.o?.a === 0 || nodeToApply.style.strokeOpacity !== undefined) {
                    result.o = LottieExporter.mapProperty(
                        Math.round(LottieExporter.safeNum(nodeToApply.style.strokeOpacity ?? 1) * 100),
                        nodeToApply.animations?.['style.strokeOpacity']?.map(k => ({ ...k, value: k.value * 100 }))
                    );
                    modified = true;
                }

                // Patch dash array for imported layers
                if (nodeToApply.style.strokeDash) {
                    const dashVals = (nodeToApply.style.strokeDash as string).split(/[\s,]+/).map(Number).filter(n => !isNaN(n) && n >= 0);
                    if (dashVals.length > 0) {
                        const d: any[] = [];
                        for (let i = 0; i < dashVals.length; i += 2) {
                            d.push({ n: 'd', nm: 'Dash', v: { a: 0, k: dashVals[i] } });
                            if (i + 1 < dashVals.length) d.push({ n: 'g', nm: 'Gap', v: { a: 0, k: dashVals[i + 1] } });
                        }
                        result.d = d;
                        modified = true;
                    }
                } else if ('d' in result) {
                    delete result.d;
                    modified = true;
                }

                if (modified) return result;
            }

            // Trim path — overlay start/end/offset and keyframes
            if (isTrimEdited && item.ty === 'tm') {
                processedTmForLastShape = true;
                const hasStartAnim = (nodeToApply.animations?.['style.trimStart']?.length ?? 0) > 0;
                const hasEndAnim = (nodeToApply.animations?.['style.trimEnd']?.length ?? 0) > 0;
                const hasOffsetAnim = (nodeToApply.animations?.['style.trimOffset']?.length ?? 0) > 0;

                const result: any = { ...item };
                let modified = false;

                if (hasStartAnim || item.s?.a === 0) {
                    result.s = LottieExporter.mapProperty(
                        LottieExporter.safeNum((nodeToApply.style.trimStart ?? 0) * 100),
                        nodeToApply.animations?.['style.trimStart']?.map(k => ({ ...k, value: k.value * 100 }))
                    );
                    modified = true;
                }

                if (hasEndAnim || item.e?.a === 0) {
                    result.e = LottieExporter.mapProperty(
                        LottieExporter.safeNum((nodeToApply.style.trimEnd ?? 1) * 100),
                        nodeToApply.animations?.['style.trimEnd']?.map(k => ({ ...k, value: k.value * 100 }))
                    );
                    modified = true;
                }

                if (hasOffsetAnim || item.o?.a === 0) {
                    result.o = LottieExporter.mapProperty(
                        LottieExporter.safeNum(nodeToApply.style.trimOffset ?? 0),
                        nodeToApply.animations?.['style.trimOffset']
                    );
                    modified = true;
                }

                if (modified) return result;
            }

            return item;
        });

        // If a shape had trim edits but no tm item followed it in the original JSON, inject one now
        const node = lastSeenShapeNode as any;
        if (lastSeenTrimEdited && !processedTmForLastShape && node) {
            const ts = node.style.trimStart ?? 0;
            const te = node.style.trimEnd ?? 1;
            const to = node.style.trimOffset ?? 0;
            const tmItem = {
                ty: 'tm', nm: 'Trim Paths',
                s: LottieExporter.mapProperty(ts * 100, node.animations?.['style.trimStart']?.map((k: any) => ({ ...k, value: k.value * 100 }))),
                e: LottieExporter.mapProperty(te * 100, node.animations?.['style.trimEnd']?.map((k: any) => ({ ...k, value: k.value * 100 }))),
                o: LottieExporter.mapProperty(to, node.animations?.['style.trimOffset']),
                m: 1
            };
            
            // Append before the transform item (tr) if it exists, otherwise append at the end
            const trIndex = mappedShapes.findIndex((s: any) => s?.ty === 'tr');
            if (trIndex >= 0) {
                mappedShapes.splice(trIndex, 0, tmItem);
            } else {
                mappedShapes.push(tmItem);
            }
        }

        return mappedShapes;
    }

    /**
     * Normalize a set of gradient keyframes so every keyframe has the same stop count and
     * the same alpha-stop presence. The Lottie spec requires `g.p` (stop count) to be constant
     * for all keyframes of a gradient property — if keyframes disagree, Lottie players
     * mis-parse the flat color array and produce garbled or invisible gradients.
     *
     * Strategy:
     * - Target count = max(base.stops.length, max keyframe stop count) — never lose stops.
     * - hasAlpha = true if ANY gradient (base or keyframe) has a stop with opacity < 1.
     * - Gradients with fewer stops are expanded by sampling at evenly-distributed offsets.
     */
    private static normalizeGradientSet(
        base: Gradient,
        anim: Keyframe[] | undefined
    ): { base: Gradient; anim: Keyframe[] | undefined; stopCount: number; hasAlpha: boolean } {
        // Determine canonical stop count (max across all gradients)
        let targetCount = base.stops.length;
        anim?.forEach(kf => {
            const c = kf.value?.stops?.length ?? 0;
            if (c > targetCount) targetCount = c;
        });

        // Determine canonical hasAlpha (union across all gradients)
        const anyAlpha = (g: Gradient | undefined) =>
            g?.stops?.some(s => (s.opacity ?? 1) < 1) ?? false;
        const hasAlpha = anyAlpha(base) || (anim?.some(kf => anyAlpha(kf.value)) ?? false);

        // Sample a gradient at offset t (linear interpolation between nearest stops)
        const sampleGradient = (sorted: Gradient['stops'], t: number) => {
            if (sorted.length === 0) return { color: '#000000', opacity: 1 };
            if (sorted.length === 1) return sorted[0];
            let lo = sorted[0], hi = sorted[sorted.length - 1];
            for (let j = 0; j < sorted.length - 1; j++) {
                if (sorted[j].offset <= t && sorted[j + 1].offset >= t) {
                    lo = sorted[j]; hi = sorted[j + 1]; break;
                }
            }
            const span = hi.offset - lo.offset;
            const f = span < 1e-6 ? 0 : (t - lo.offset) / span;
            const loRgb = LottieExporter.hexToRgbArray(lo.color);
            const hiRgb = LottieExporter.hexToRgbArray(hi.color);
            const r = Math.round((loRgb[0] + f * (hiRgb[0] - loRgb[0])) * 255);
            const g = Math.round((loRgb[1] + f * (hiRgb[1] - loRgb[1])) * 255);
            const b = Math.round((loRgb[2] + f * (hiRgb[2] - loRgb[2])) * 255);
            const hex = (v: number) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
            return {
                color: `#${hex(r)}${hex(g)}${hex(b)}`,
                opacity: (lo.opacity ?? 1) + f * ((hi.opacity ?? 1) - (lo.opacity ?? 1))
            };
        };

        const normalizeGrad = (grad: Gradient): Gradient => {
            if (grad.stops.length === targetCount) return grad;
            const sorted = [...grad.stops].sort((a, b) => a.offset - b.offset);
            const first = sorted[0]?.offset ?? 0;
            const last = sorted[sorted.length - 1]?.offset ?? 1;
            const newStops = Array.from({ length: targetCount }, (_, i) => {
                const t = targetCount === 1 ? first : first + (i / (targetCount - 1)) * (last - first);
                const sampled = sampleGradient(sorted, t);
                return { offset: t, color: sampled.color, opacity: sampled.opacity };
            });
            return { ...grad, stops: newStops };
        };

        return {
            base: normalizeGrad(base),
            anim: anim?.map(kf => ({
                ...kf,
                value: kf.value ? normalizeGrad(kf.value) : kf.value
            })),
            stopCount: targetCount,
            hasAlpha,
        };
    }

    // forceAlpha: when true, always include alpha stops even if all stops are opaque.
    // Use this to keep flat-array length consistent across all keyframes of an animated gradient.
    private static mapGradient(gradient: Gradient, forceAlpha = false): number[] {
        const colorStops: number[] = [];
        const alphaStops: number[] = [];
        const hasAlpha = forceAlpha || gradient.stops.some(s => (s.opacity ?? 1) < 1);

        const sortedStops = [...gradient.stops].sort((a, b) => a.offset - b.offset);

        sortedStops.forEach(stop => {
            const rgb = LottieExporter.hexToRgbArray(stop.color);
            colorStops.push(LottieExporter.safeNum(stop.offset), rgb[0], rgb[1], rgb[2]);
            if (hasAlpha) {
                alphaStops.push(LottieExporter.safeNum(stop.offset), LottieExporter.safeNum(stop.opacity ?? 1));
            }
        });

        return hasAlpha ? [...colorStops, ...alphaStops] : colorStops;
    }

    private static mapProperty(staticValue: any, animX?: Keyframe[], animY?: Keyframe[]): LottieProperty<any> {
        const isGrad = (v: any) => v && typeof v === 'object' && 'stops' in v;
        const isColor = (v: any) => typeof v === 'string' && v.startsWith('#');
        // REFINED Shape detection: Must have 'points' or be an array of objects with x/y
        const isShape = (v: any) => {
            if (!v || typeof v !== 'object') return false;
            if ('points' in v) return true;
            if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && 'x' in v[0]) return true;
            return false;
        };

        if (!animX && !animY) {
            let val = staticValue;
            if (isGrad(val)) val = LottieExporter.mapGradient(val);
            else if (isColor(val)) val = LottieExporter.hexToRgbArray(val);
            else if (isShape(val)) {
                const points = (val.points || val) as VectorPoint[];
                return {
                    a: 0,
                    k: {
                        i: points.map(p => [LottieExporter.safeNum(p.inX), LottieExporter.safeNum(p.inY)]),
                        o: points.map(p => [LottieExporter.safeNum(p.outX), LottieExporter.safeNum(p.outY)]),
                        v: points.map(p => [LottieExporter.safeNum(p.x), LottieExporter.safeNum(p.y)]),
                        c: !!(val.closed ?? true)
                    }
                };
            }

            return { a: 0, k: Array.isArray(val) ? val.map((v: any) => LottieExporter.safeNum(v)) : LottieExporter.safeNum(val) };
        }

        const allTimes = new Set<number>();
        if (animX) animX.forEach(k => allTimes.add(k.time));
        if (animY) animY.forEach(k => allTimes.add(k.time));
        const sortedTimes = Array.from(allTimes).sort((a, b) => a - b);

        const keyframes: LottieKeyframe<any>[] = sortedTimes.map((time) => {
            const kfX = animX?.find(k => k.time === time);
            const kfY = animY?.find(k => k.time === time);
            const kf = kfX || kfY;

            let rawVal: any;
            if ((animX || animY) && Array.isArray(staticValue)) {
                // Even when only one axis is animated, always produce an array so the output
                // format matches what Lottie players expect (e.g. ks.s must be [sx,sy,sz]).
                // getAtTime with undefined animation returns the static fallback value.
                const vx = LottieExporter.getAtTime(animX, time, staticValue[0]);
                const vy = LottieExporter.getAtTime(animY, time, staticValue[1]);
                rawVal = [LottieExporter.safeNum(vx), LottieExporter.safeNum(vy)];
                if (staticValue.length === 3) rawVal.push(LottieExporter.safeNum(LottieExporter.getAtTime(undefined, time, staticValue[2])));
            } else {
                rawVal = LottieExporter.getAtTime(animX, time, staticValue);
            }

            let finalVal: any;
            if (isGrad(rawVal)) {
                finalVal = LottieExporter.mapGradient(rawVal);
            } else if (isColor(rawVal)) {
                finalVal = LottieExporter.hexToRgbArray(rawVal);
            } else if (isShape(rawVal)) {
                const points = (rawVal.points || rawVal) as VectorPoint[];
                finalVal = {
                    i: points.map(p => [LottieExporter.safeNum(p.inX), LottieExporter.safeNum(p.inY)]),
                    o: points.map(p => [LottieExporter.safeNum(p.outX), LottieExporter.safeNum(p.outY)]),
                    v: points.map(p => [LottieExporter.safeNum(p.x), LottieExporter.safeNum(p.y)]),
                    c: !!(rawVal.closed ?? true)
                };
            } else if (Array.isArray(rawVal)) {
                finalVal = rawVal.map((v: any) => LottieExporter.safeNum(v));
            } else {
                finalVal = LottieExporter.safeNum(rawVal);
            }

            return {
                t: LottieExporter.safeNum(time),
                s: finalVal,
                // Store easing/spatial info temporarily for the next pass
                _easing: kf?.easing,
                _bezier: kf?.bezier,
                _spatialOut: {
                    x: kfX?.spatialOut?.x ?? 0,
                    y: kfY?.spatialOut?.y ?? 0
                },
                _spatialIn: {
                    x: kfX?.spatialIn?.x ?? 0,
                    y: kfY?.spatialIn?.y ?? 0
                }
            } as any;
        });

        for (let i = 0; i < keyframes.length - 1; i++) {
            const kf = keyframes[i] as any;
            const nextKf = keyframes[i + 1] as any;
            keyframes[i].e = nextKf.s;

            // 1. Resolve temporal easing to tangents (i, o)
            let bezier: [number, number, number, number] = [0.33, 0, 0.67, 1]; // Standard ease-in-out fallback

            if (kf._bezier) {
                bezier = kf._bezier;
            } else if (kf._easing && EASING_PRESETS[kf._easing]) {
                bezier = EASING_PRESETS[kf._easing].bezier;
            }

            const isArray = Array.isArray(keyframes[i].s);
            const dim = isArray ? (keyframes[i].s as any[]).length : 1;

            const ox = new Array(dim).fill(LottieExporter.roundNum(bezier[0], 2));
            const oy = new Array(dim).fill(LottieExporter.roundNum(bezier[1], 2));
            const ix = new Array(dim).fill(LottieExporter.roundNum(bezier[2], 2));
            const iy = new Array(dim).fill(LottieExporter.roundNum(bezier[3], 2));

            // INTERPOLATION SIMPLIFICATION: If all dimensions have same easing, use single number
            const allSame = (arr: number[]) => arr.every(v => v === arr[0]);
            keyframes[i].o = {
                x: allSame(ox) ? ox[0] : ox,
                y: allSame(oy) ? oy[0] : oy
            };
            keyframes[i].i = {
                x: allSame(ix) ? ix[0] : ix,
                y: allSame(iy) ? iy[0] : iy
            };

            // 2. Resolve spatial tangents (ti, to) for position properties
            // Lottie spatial tangents are [x, y, z] relative to the keyframe value
            const hasSpatial = kf._spatialOut.x !== 0 || kf._spatialOut.y !== 0 ||
                nextKf._spatialIn.x !== 0 || nextKf._spatialIn.y !== 0;

            if (hasSpatial) {
                keyframes[i].to = [LottieExporter.safeNum(kf._spatialOut.x), LottieExporter.safeNum(kf._spatialOut.y), 0];
                keyframes[i].ti = [LottieExporter.safeNum(nextKf._spatialIn.x), LottieExporter.safeNum(nextKf._spatialIn.y), 0];
            }

            // Cleanup temporary properties
            delete kf._easing;
            delete kf._bezier;
            delete kf._spatialOut;
            delete kf._spatialIn;
        }

        return { a: 1, k: keyframes };
    }

    private static getAtTime(keyframes: Keyframe[] | undefined, time: number, fallback: any): any {
        if (!keyframes || keyframes.length === 0) return fallback;
        const exact = keyframes.find(k => k.time === time);
        if (exact) return exact.value;

        const before = [...keyframes].reverse().find(k => k.time < time);
        const after = keyframes.find(k => k.time > time);

        if (!before) return keyframes[0].value;
        if (!after) return keyframes[keyframes.length - 1].value;

        const t = (time - before.time) / (after.time - before.time);

        const v1 = before.value;
        const v2 = after.value;

        if (typeof v1 === 'number' && typeof v2 === 'number') {
            return v1 + (v2 - v1) * t;
        }

        if (typeof v1 === 'string' && v1.startsWith('#') && typeof v2 === 'string' && v2.startsWith('#')) {
            const c1 = LottieExporter.hexToRgbArray(v1);
            const c2 = LottieExporter.hexToRgbArray(v2);
            return '#' + c1.map((v, i) => Math.round((v + (c2[i] - v) * t) * 255).toString(16).padStart(2, '0')).join('');
        }

        if (v1 && typeof v1 === 'object' && 'stops' in v1 && v2 && typeof v2 === 'object') {
            const res = { ...v1 };
            if (v1.start && v2.start) {
                res.start = { x: v1.start.x + (v2.start.x - v1.start.x) * t, y: v1.start.y + (v2.start.y - v1.start.y) * t };
            }
            if (v1.end && v2.end) {
                res.end = { x: v1.end.x + (v2.end.x - v1.end.x) * t, y: v1.end.y + (v2.end.y - v1.end.y) * t };
            }
            if (v1.stops && v2.stops) {
                res.stops = v1.stops.map((s1: any, i: number) => {
                    const s2 = v2.stops[i] || s1;
                    return {
                        offset: s1.offset + (s2.offset - s1.offset) * t,
                        color: s1.color,
                        opacity: (s1.opacity ?? 1) + ((s2.opacity ?? 1) - (s1.opacity ?? 1)) * t
                    };
                });
            }
            return res;
        }

        if (Array.isArray(v1) && Array.isArray(v2)) {
            return v1.map((v, i) => {
                if (typeof v === 'number' && typeof v2[i] === 'number') return v + (v2[i] - v) * t;
                return v;
            });
        }

        return v1;
    }

    public static mapMasks(node: SceneNode): any[] | undefined {
        if (!node.masks || node.masks.length === 0) return undefined;

        return node.masks.map(m => {
            // If the mask is already in Lottie wire format (from SVG clip-path import),
            // pass it through directly
            if (m.nm !== undefined && m.pt !== undefined) {
                return m;
            }

            // Otherwise, process as a SceneNode-style mask
            const points = m.props?.points || [];
            return {
                nm: m.name || 'Mask',
                inv: !!m.inverted,
                mode: m.mode || 'a',
                pt: LottieExporter.mapProperty(m.props, m.animations?.['points']),
                o: LottieExporter.mapProperty((m.style?.opacity ?? 1) * 100, m.animations?.['style.opacity']?.map((k: any) => ({ ...k, value: k.value * 100 })))
            };
        });
    }

    private static shouldBeLayer(node: SceneNode, artboardId: string): boolean {
        // A node is a standalone Lottie layer only when it is a direct child of the artboard.
        // isLayer:true is intentionally excluded here: a shape moved inside a group by the user
        // should be embedded as a gr item regardless of any isLayer flag set during a prior import.
        // Precomp/image/text are always layers because they have no gr representation in Lottie.
        const isTopLevel = node.parentId === artboardId;
        return isTopLevel || node.type === 'precomp' || node.type === 'image' || node.type === 'text';
    }

    private static findNearestLayerParentId(node: SceneNode, nodes: Map<string, SceneNode>, artboardId: string): string | undefined {
        // If node has an explicitly set parentLayerId (e.g. from AE import), use that.
        if (node.parentLayerId) return node.parentLayerId;

        let current = nodes.get(node.parentId || '');
        while (current && current.id !== artboardId) {
            if (LottieExporter.shouldBeLayer(current, artboardId)) return current.id;
            current = nodes.get(current.parentId || '');
        }
        return undefined; // Parent is the artboard itself (no parent layer)
    }

    private static getBakedTransform(node: SceneNode, nodes: Map<string, SceneNode>, artboardId: string): any {
        const parentLayerId = LottieExporter.findNearestLayerParentId(node, nodes, artboardId);

        let matrix = new DOMMatrix();
        let current: SceneNode | undefined = node;

        // Traverse up and accumulate transforms until we hit the parent layer or the artboard
        while (current) {
            // For the target node itself, we do NOT include its anchor in the baked transform
            // because Lottie handles the layer's anchor point separately in ks.a.
            // Including it here would effectively double-apply the anchor offset when rendered.
            const includeAnchor = current.id !== node.id;
            const localMatrix = createTransformMatrix(current.transform, nodes, current, undefined, includeAnchor);
            matrix = localMatrix.multiply(matrix); // current * matrix_so_far

            if (current.parentId === parentLayerId || current.parentId === artboardId || !current.parentId) {
                break;
            }
            current = nodes.get(current.parentId);
        }

        return decomposeMatrix(matrix);
    }
}
