import { LottieAnimation, LottieLayer, LottieShape, LottieProperty, LottieKeyframe } from './lottieTypes';
import { SceneNode, NodeType, Style, Transform } from '../state/sceneSlice';
import { FlowBlock, Keyframe } from '../state/animationSlice';
import { createNode, generateId, createDefaultTransform, createDefaultStyle } from '../core/SceneNode';
import { matchPreset } from '../core/EasingPresets';

export class LottieParser {
    /**
     * Resolves a Lottie property which might be nested or direct.
     */
    private static resolveProperty(prop: any): any {
        if (!prop) return null;
        if (prop.a !== undefined && prop.k !== undefined) return prop;
        if (prop.k && prop.k.a !== undefined) return prop.k;
        return prop;
    }

    private static getPropertyData<T>(rawProp: any, defaultValue: T): { value: T, keyframes?: Keyframe[] } {
        const prop = this.resolveProperty(rawProp);
        if (!prop) return { value: defaultValue };

        if (prop.a === 0) {
            return { value: prop.k as T };
        }

        if (Array.isArray(prop.k)) {
            const lKeyframes = prop.k as LottieKeyframe<T>[];
            const keyframes: Keyframe[] = lKeyframes.map(lk => {
                // Lottie often wraps scalar keyframe values in single-element arrays
                // e.g., rotation "s": [200] instead of "s": 200
                // Unwrap when we expect a scalar (defaultValue is a number)
                let kfValue = lk.s;
                if (typeof defaultValue === 'number' && Array.isArray(kfValue) && kfValue.length === 1) {
                    kfValue = kfValue[0];
                }
                const kf: Keyframe = {
                    id: generateId(),
                    time: lk.t,
                    value: kfValue,
                    easing: 'linear',
                    spatialOut: lk.to ? { x: this.safeNum(lk.to[0]), y: this.safeNum(lk.to[1]) } : undefined
                };

                if (lk.o && lk.i) {
                    const ox = Array.isArray(lk.o.x) ? lk.o.x[0] : lk.o.x;
                    const oy = Array.isArray(lk.o.y) ? lk.o.y[0] : lk.o.y;
                    const ix = Array.isArray(lk.i.x) ? lk.i.x[0] : lk.i.x;
                    const iy = Array.isArray(lk.i.y) ? lk.i.y[0] : lk.i.y;

                    if (ox !== undefined && oy !== undefined && ix !== undefined && iy !== undefined) {
                        const bezier: [number, number, number, number] = [
                            this.safeNum(ox), this.safeNum(oy),
                            this.safeNum(ix), this.safeNum(iy)
                        ];

                        const preset = matchPreset(bezier);
                        if (preset) {
                            kf.easing = preset as any;
                        } else {
                            kf.easing = 'bezier';
                            kf.bezier = bezier;
                        }
                    }
                }
                return kf;
            }).filter(kf => kf.value !== undefined);

            // Correctly map Lottie's ti (entrance tangent) to the NEXT keyframe's spatialIn
            for (let i = 1; i < keyframes.length; i++) {
                if (i - 1 < lKeyframes.length) {
                    const prevLK = lKeyframes[i - 1];
                    if (prevLK && prevLK.ti) {
                        keyframes[i].spatialIn = { x: this.safeNum(prevLK.ti[0]), y: this.safeNum(prevLK.ti[1]) };
                    }
                }
            }

            // Inherit easing for the last keyframe from the previous one for UI consistency
            if (keyframes.length > 1) {
                const last = keyframes[keyframes.length - 1];
                const prev = keyframes[keyframes.length - 2];
                if (last.easing === 'linear' && prev.easing !== 'linear') {
                    last.easing = prev.easing;
                    last.bezier = prev.bezier;
                }
            }

            const initialValue = keyframes.length > 0 ? keyframes[0].value : defaultValue;
            return { value: initialValue, keyframes };
        }

        return { value: defaultValue };
    }

    private static lottieColorToHex(color: number[]): string {
        const clamp = (v: number) => Math.floor(Math.max(0, Math.min(255, v * 255)));
        const r = clamp(color[0] || 0).toString(16).padStart(2, '0');
        const g = clamp(color[1] || 0).toString(16).padStart(2, '0');
        const b = clamp(color[2] || 0).toString(16).padStart(2, '0');
        return `#${r}${g}${b}`;
    }

    static parse(json: any): { nodes: SceneNode[], fps: number, duration: number, width: number, height: number, backgroundColor?: string, isTransparent?: boolean, flowBlocks: FlowBlock[], importWarnings: Array<{ layerName: string; warnings: string[] }> } {
        const animation = json as LottieAnimation;
        const allNodes: SceneNode[] = [];
        const layerIdMap = new Map<number, string>();
        const flowBlocks: FlowBlock[] = [];

        const fps = animation.fr || 30;
        const ipOffset = animation.ip || 0; // AE compositions can start at non-zero frames; normalize to 0-based
        const duration = (animation.op - animation.ip) || 150;
        const width = animation.w || 800;
        const height = animation.h || 600;
        let backgroundColor = '#ffffff';
        let isTransparent = true;

        const bgLayer = animation.layers.find(l => l.ty === 1 && l.nm?.toLowerCase().includes('background'));
        if (bgLayer && (bgLayer as any).sc) {
            backgroundColor = (bgLayer as any).sc;
            isTransparent = false;
        }

        // Create root artboard for the main composition
        const rootArtboard = createNode('artboard', animation.nm || 'Main Scene', {
            props: { width, height, duration, frameRate: fps, backgroundColor: backgroundColor, isTransparent: isTransparent },
            style: { opacity: 1 },
            children: [],
            inPoint: 0,
            outPoint: duration
        });
        allNodes.push(rootArtboard);

        const assetMetadata = new Map<string, { w: number, h: number }>();

        // Parse Assets (Pre-compositions and Images)
        if (animation.assets && Array.isArray(animation.assets)) {
            animation.assets.forEach(asset => {
                if (asset.id) {
                    assetMetadata.set(asset.id, { w: asset.w || 0, h: asset.h || 0 });
                }

                if (asset.p && asset.id) {
                    // Image asset
                    const src = asset.e === 1 ? asset.p : (asset.u || '') + asset.p;
                    const imageNode = createNode('image', asset.nm || 'Asset', { id: asset.id });
                    imageNode.props = { src, width: asset.w, height: asset.h };
                    allNodes.push(imageNode);
                } else if (asset.layers && asset.id) {
                    // Precomp asset dimensions: look for first layer that references this asset if w/h missing
                    const findRef = (layers: LottieLayer[]): LottieLayer | undefined => {
                        for (const l of layers) {
                            if (l.ty === 0 && (l as any).refId === asset.id) return l;
                        }
                        return undefined;
                    };

                    let refLayer = findRef(animation.layers);
                    if (!refLayer && animation.assets) {
                        for (const a of animation.assets) {
                            if (a.layers) {
                                refLayer = findRef(a.layers);
                                if (refLayer) break;
                            }
                        }
                    }

                    const assetW = asset.w || (refLayer as any)?.w || width;
                    const assetH = asset.h || (refLayer as any)?.h || height;

                    // Update metadata with resolved dimensions to help children
                    assetMetadata.set(asset.id, { w: assetW, h: assetH });

                    const artboardNode = createNode('artboard', asset.nm || `Asset ${asset.id}`, {
                        id: asset.id, // Use asset ID as the artboard ID for refId linkage
                        props: { width: assetW, height: assetH, duration, frameRate: fps, transparent: true },
                        style: { opacity: 1 },
                        children: [],
                        inPoint: 0,
                        outPoint: duration
                    });
                    allNodes.push(artboardNode);

                    const assetLayerMap = new Map<number, string>();
                    const sortedAssetLayers = [...asset.layers].sort((a, b) => a.ind - b.ind);

                    for (let i = asset.layers.length - 1; i >= 0; i--) {
                        const layer = asset.layers[i];
                        const { baseNode, children } = this.parseLayer(layer, assetMetadata); // Asset layer
                        if (baseNode) {
                            assetLayerMap.set(layer.ind, baseNode.id);
                            baseNode.parentId = artboardNode.id;
                            artboardNode.children.push(baseNode.id);
                            allNodes.push(baseNode, ...children);
                        }
                    }

                    // Handle parenting within asset
                    for (const layer of asset.layers) {
                        if (layer.parent !== undefined && assetLayerMap.has(layer.parent)) {
                            const childId = assetLayerMap.get(layer.ind);
                            const parentId = assetLayerMap.get(layer.parent);
                            const childNode = allNodes.find(n => n.id === childId);
                            if (childNode && parentId) childNode.parentLayerId = parentId;
                        }
                    }

                    // Resolve Track Mattes for this asset
                    this.resolveTrackMattes(asset.layers, assetLayerMap, allNodes);
                }
            });
        }

        const validLayers = animation.layers.filter(l => l.ty !== 1 || !l.nm?.toLowerCase().includes('background'));

        // Process layers in reverse order (Bottom to Top) for our renderer
        for (let i = validLayers.length - 1; i >= 0; i--) {
            const layer = validLayers[i];
            const { baseNode, children } = this.parseLayer(layer, assetMetadata); // Main layer
            if (baseNode) {
                // Normalize main-composition layer timing to 0-based when the AE project has a
                // non-zero start frame (ip > 0). Precomp asset layers are NOT adjusted here
                // because they reference their own asset timeline which is already 0-based.
                if (ipOffset !== 0) {
                    baseNode.inPoint = (baseNode.inPoint ?? 0) - ipOffset;
                    baseNode.outPoint = (baseNode.outPoint ?? 0) - ipOffset;
                    if ((baseNode as any).startTime !== undefined) {
                        (baseNode as any).startTime = ((baseNode as any).startTime as number) - ipOffset;
                    }
                }
                baseNode.parentId = rootArtboard.id;
                rootArtboard.children.push(baseNode.id);
                if (layer.ind !== undefined) layerIdMap.set(layer.ind, baseNode.id);
                allNodes.push(baseNode, ...children);
            }
        }

        // Deduplicate layer names so ThorVG getLayerBoundingBox() queries hit the right layer.
        // ThorVG resolves by name and returns the first match — duplicate names cause wrong-layer returns.
        {
            const nameCounts = new Map<string, number>();
            for (const id of rootArtboard.children) {
                const n = allNodes.find(node => node.id === id);
                if (n?.name) nameCounts.set(n.name, (nameCounts.get(n.name) || 0) + 1);
            }
            const nameIndex = new Map<string, number>();
            for (const id of rootArtboard.children) {
                const n = allNodes.find(node => node.id === id);
                if (n?.name && (nameCounts.get(n.name) || 0) > 1) {
                    const idx = (nameIndex.get(n.name) || 0) + 1;
                    nameIndex.set(n.name, idx);
                    n.name = `${n.name} #${idx}`;
                }
            }
        }

        // Resolve Parenting for main layers
        animation.layers.forEach(layer => {
            if (layer.parent !== undefined && layer.ind !== undefined) {
                const childId = layerIdMap.get(layer.ind);
                const parentId = layerIdMap.get(layer.parent);
                if (childId && parentId) {
                    const childNode = allNodes.find(n => n.id === childId);
                    if (childNode) {
                        childNode.parentLayerId = parentId;
                    }
                }
            }
        });

        // Resolve Track Mattes
        this.resolveTrackMattes(animation.layers, layerIdMap, allNodes);

        // Final Pass: Simplify Hierarchy and Resolve Pre-composition Artboard Parents
        this.postProcessNodes(allNodes);

        // Extract Flow Blocks from Markers
        if (animation.markers && Array.isArray(animation.markers)) {
            animation.markers.forEach(marker => {
                flowBlocks.push({
                    id: 'flow_' + generateId(),
                    name: marker.cm || 'Segment',
                    startFrame: marker.tm || 0,
                    endFrame: (marker.tm || 0) + (marker.dr || 0),
                    loop: true // default
                });
            });
        }

        // Collect import warnings from all nodes that have them
        const importWarnings = allNodes
            .filter(n => n._importWarnings && n._importWarnings.length > 0)
            .map(n => ({ layerName: n.name, warnings: n._importWarnings! }));

        return { nodes: allNodes, fps, duration, width, height, backgroundColor, isTransparent, flowBlocks, importWarnings };
    }

    private static resolveTrackMattes(layers: LottieLayer[], layerIdMap: Map<number, string>, allNodes: SceneNode[]) {
        for (let i = 0; i < layers.length; i++) {
            const layer = layers[i];
            const nodeId = layer.ind !== undefined ? layerIdMap.get(layer.ind) : undefined;
            if (!nodeId) continue;

            const node = allNodes.find(n => n.id === nodeId);
            if (!node) continue;

            // tp (Track Matte Parent) - Modern way
            if (layer.tp !== undefined && layer.tp !== null) {
                const sourceId = layerIdMap.get(layer.tp as number);
                if (sourceId) {
                    node.matteSourceId = sourceId;
                    node.matteType = layer.tt || 1; // Default to Alpha if not specified
                    const sourceNode = allNodes.find(n => n.id === sourceId);
                    if (sourceNode) {
                        if (!sourceNode.matteTargetIds) sourceNode.matteTargetIds = [];
                        if (!sourceNode.matteTargetIds.includes(node.id)) {
                            sourceNode.matteTargetIds.push(node.id);
                        }
                        sourceNode.visible = false; // Hide matte layers by default
                    }
                }
            }
            // tt (Track Matte Type) - Legacy way (layer above is the matte)
            else if (layer.tt !== undefined && layer.tt !== 0 && i > 0) {
                const prevLayer = layers[i - 1]; // Previous layer in the list is visually above
                const sourceId = prevLayer.ind !== undefined ? layerIdMap.get(prevLayer.ind) : undefined;
                if (sourceId) {
                    node.matteSourceId = sourceId;
                    node.matteType = layer.tt;
                    const sourceNode = allNodes.find(n => n.id === sourceId);
                    if (sourceNode) {
                        if (!sourceNode.matteTargetIds) sourceNode.matteTargetIds = [];
                        if (!sourceNode.matteTargetIds.includes(node.id)) {
                            sourceNode.matteTargetIds.push(node.id);
                        }
                        sourceNode.visible = false; // Hide matte layers by default
                    }
                }
            }
        }
    }

    private static parseLayer(layer: LottieLayer, assetMetadata: Map<string, { w: number, h: number }>): { baseNode: SceneNode | null, children: SceneNode[] } {
        const id = generateId();
        const st = (layer as any).st || 0;
        const children: SceneNode[] = [];
        const animations: Record<string, Keyframe[]> = {};

        const pData = this.getPropertyData(layer.ks.p, [0, 0]);
        const rData = this.getPropertyData(layer.ks.r, 0);
        const sData = this.getPropertyData(layer.ks.s, [100, 100]);
        const aData = this.getPropertyData(layer.ks.a, [0, 0]);
        const oData = this.getPropertyData(layer.ks.o, 100);

        if (pData.keyframes) {
            animations['transform.x'] = pData.keyframes.map(kf => ({
                ...kf,
                time: kf.time,
                value: kf.value[0],
                // Preserve full spatial handles to maintain motion curve fidelity in the editor
                spatialOut: kf.spatialOut,
                spatialIn: kf.spatialIn
            }));
            animations['transform.y'] = pData.keyframes.map(kf => ({
                ...kf,
                time: kf.time,
                value: kf.value[1],
                // Preserve full spatial handles to maintain motion curve fidelity in the editor
                spatialOut: kf.spatialOut,
                spatialIn: kf.spatialIn
            }));
        }
        if (aData.keyframes) {
            animations['transform.anchorX'] = aData.keyframes.map(kf => ({ ...kf, time: kf.time, value: kf.value[0] }));
            animations['transform.anchorY'] = aData.keyframes.map(kf => ({ ...kf, time: kf.time, value: kf.value[1] }));
        }
        if (rData.keyframes) animations['transform.rotation'] = rData.keyframes.map(kf => ({ ...kf, time: kf.time }));
        if (sData.keyframes) {
            animations['transform.scaleX'] = sData.keyframes.map(kf => ({ ...kf, time: kf.time, value: kf.value[0] / 100 }));
            animations['transform.scaleY'] = sData.keyframes.map(kf => ({ ...kf, time: kf.time, value: kf.value[1] / 100 }));
        }
        if (oData.keyframes) animations['style.opacity'] = oData.keyframes.map(kf => ({ ...kf, time: kf.time, value: kf.value / 100 }));

        const transform: Transform = {
            x: pData.value[0], y: pData.value[1], rotation: rData.value,
            scaleX: sData.value[0] / 100, scaleY: sData.value[1] / 100,
            anchorX: aData.value[0], anchorY: aData.value[1], scaleLink: true
        };

        const blendModes: Record<number, string> = {
            0: 'normal', 1: 'multiply', 2: 'screen', 3: 'overlay',
            4: 'darken', 5: 'lighten', 6: 'color-dodge', 7: 'color-burn',
            8: 'hard-light', 9: 'soft-light', 10: 'difference', 11: 'exclusion',
            12: 'hue', 13: 'saturation', 14: 'color', 15: 'luminosity'
        };
        const blendMode = blendModes[(layer as any).bm || 0] || 'normal';

        const { effects, effectAnimations } = this.parseEffects(layer);
        const style = {
            ...createDefaultStyle(),
            fillVisible: false, // Default to invisible, enabled by 'fl' or 'gf'
            strokeWidth: 0,    // Default to 0, enabled by 'st' or 'gs'
            opacity: oData.value / 100,
            blendMode: blendMode as any,
            effects: effects
        };

        // Standard Layer (Shape, Solid, Null, Precomp, Text, Image)
        if (layer.ty === 4 || layer.ty === 1 || layer.ty === 3 || layer.ty === 0 || layer.ty === 5 || layer.ty === 2) {
            let nodeType: NodeType = 'group';
            if (layer.ty === 0) {
                nodeType = 'precomp';
                // Don't force anchorAlign for precomps, rely on ks.a
            }
            else if (layer.ty === 1) nodeType = 'rect'; // Solids are Rects
            else if (layer.ty === 3) nodeType = 'group'; // Nulls are groups
            else if (layer.ty === 5) nodeType = 'text'; // Text
            else if (layer.ty === 2) nodeType = 'image'; // Image

            let baseNode = createNode(nodeType, layer.nm || 'Layer', {
                id, transform, style,
                visible: layer.hd === 1 ? false : true,
                animations: { ...animations, ...effectAnimations },
                inPoint: layer.ip,
                outPoint: layer.op,
                startTime: st,
                props: { isLayer: true } // Mark as a Lottie Layer to preserve identity during flattening
            });

            if (layer.ty === 1) {
                // Handle Solid specifically
                baseNode.props = {
                    width: (layer as any).sw || 100,
                    height: (layer as any).sh || 100,
                    roundness: 0
                };
                baseNode.style.fill = (layer as any).sc || '#ffffff';
                baseNode.style.fillType = 'solid';
                baseNode.style.fillVisible = true;
            }

            if (layer.ty === 0 && (layer as any).refId) {
                baseNode.refId = (layer as any).refId;
                // Precomp layers often have their own width/height
                if ((layer as any).w) baseNode.props.width = (layer as any).w;
                if ((layer as any).h) baseNode.props.height = (layer as any).h;
            }

            if (layer.ty === 2 && (layer as any).refId) {
                const refId = (layer as any).refId;
                const meta = assetMetadata.get(refId);
                baseNode.refId = refId;
                baseNode.props = {
                    width: (layer as any).w || meta?.w || 100,
                    height: (layer as any).h || meta?.h || 100
                };
            }

            if (layer.ty === 5 && (layer as any).t) {
                const textData = (layer as any).t.d.k[0].s;
                const isPointText = !textData.sz || (textData.sz[0] === 0 && textData.sz[1] === 0);

                baseNode.props = {
                    text: textData.t,
                    fontSize: textData.s,
                    fontFamily: textData.f,
                    letterSpacing: textData.tr || 0,
                    lineHeight: textData.lh ? (textData.lh / textData.s) : 1.2,
                    textAlign: textData.j === 2 ? 'center' : (textData.j === 1 ? 'right' : 'left'),
                    verticalAlign: isPointText ? 'baseline' : (textData.vj === 1 ? 'middle' : (textData.vj === 2 ? 'bottom' : 'top')),
                    width: textData.sz ? textData.sz[0] : undefined,
                    height: textData.sz ? textData.sz[1] : undefined
                };
                if (textData.fc) {
                    baseNode.style.fill = this.lottieColorToHex(textData.fc);
                    baseNode.style.fillVisible = true;
                }
            }

            if (layer.ty === 4 && layer.shapes) {
                const styleAnims: Record<string, Keyframe[]> = {};
                Object.keys(animations).forEach(k => {
                    if (k.startsWith('style.') && k !== 'style.opacity') styleAnims[k] = animations[k];
                });

                const tempChildren: SceneNode[] = [];
                // CRITICAL: We pass opacity: 1 to children because the parent layer's opacity 
                // is already applied to the baseNode and inherited natively by the renderer.
                this.parseShapes(layer.shapes, baseNode, (child) => tempChildren.push(child), {
                    style: { ...style, opacity: 1 },
                    animations: styleAnims
                }, baseNode);

                // Collapse intermediate gr-wrapper groups that contain a single leaf shape.
                // These arise from our own exporter (old format) or simple third-party animations.
                // The function only collapses groups whose transforms/animations can be safely merged;
                // groups with real transforms, animations, or multiple children are preserved.
                const { remaining: flattenedChildren } = LottieParser.flattenSingleShapeGroups(baseNode, tempChildren);
                children.push(...flattenedChildren);
            }

            // Parse masks for all layer types
            const masks = this.parseMasks(layer);
            if (masks) {
                baseNode.masks = masks;
            }

            // Store original Lottie layer JSON for lossless round-trip export.
            // The exporter uses this to preserve complex shapes, gradients, expressions,
            // merge paths, and any features our authoring model doesn't fully represent.
            baseNode._rawLottieData = layer;

            // Snapshot the style values as they were at import time.
            // The exporter compares current vs. original to determine if the user actually
            // changed a property — if unchanged, overlayStyleOnShapes is skipped to preserve
            // the layer's full multi-color shape hierarchy.
            baseNode._originalParsedFill = baseNode.style.fill;
            baseNode._originalParsedStroke = baseNode.style.stroke;
            baseNode._originalParsedStrokeWidth = baseNode.style.strokeWidth;
            baseNode._originalParsedX = baseNode.transform.x;
            baseNode._originalParsedY = baseNode.transform.y;
            baseNode._originalParsedRotation = baseNode.transform.rotation;
            baseNode._originalParsedScaleX = baseNode.transform.scaleX;
            baseNode._originalParsedScaleY = baseNode.transform.scaleY;
            baseNode._originalParsedOpacity = baseNode.style.opacity;

            // Phase 3: tag import fidelity and collect warnings
            baseNode._importSupport = 'partial'; // transform/opacity editable; shapes are passthrough

            const warnings: string[] = [];
            if (layer.ty === 4 && layer.shapes) {
                const unsupported = this.findUnsupportedShapeTypes(layer.shapes);
                if (unsupported.length > 0) warnings.push(`Contains unsupported shapes: ${unsupported.join(', ')}`);
                if (this.hasExpressions(layer)) warnings.push('Contains expressions (not editable)');
            }
            if ((layer as any).ef && Array.isArray((layer as any).ef) && (layer as any).ef.length > 0) {
                warnings.push(`${(layer as any).ef.length} effect(s) (partially editable)`);
            }
            if (warnings.length > 0) baseNode._importWarnings = warnings;

            return { baseNode, children };
        }

        return { baseNode: null, children: [] };
    }

    /**
     * Collapses a group with exactly one child if the group is a "wrapper" node.
     * Merges transforms, style, and animations from the group into the child.
     */
    private static collapseNodeChain(node: SceneNode, allChildren: SceneNode[]): { node: SceneNode, remaining: SceneNode[] } {
        // ONLY collapse groups, NEVER collapse precomps or other meaningful layer types
        // ALSO: NEVER collapse nodes explicitly marked as Layers (they represent AE timeline layers)
        if (node.type === 'group' && node.children.length === 1 && !node.props?.isLayer) {
            const childId = node.children[0];
            const childIndex = allChildren.findIndex(c => c.id === childId);

            if (childIndex !== -1) {
                const child = allChildren[childIndex];

                // Safety: only collapse if neither has complex conflicting transforms
                const t1 = node.transform;
                const t2 = child.transform;
                const anims1 = node.animations || {};
                const anims2 = child.animations || {};

                const hasComplexT1 = (t1.rotation || 0) !== 0 || (t1.scaleX ?? 1) !== 1 || (t1.scaleY ?? 1) !== 1;
                const hasComplexT2 = (t2.rotation || 0) !== 0 || (t2.scaleX ?? 1) !== 1 || (t2.scaleY ?? 1) !== 1;
                const hasAnims1 = Object.keys(anims1).some(k => k.startsWith('transform.'));
                const hasAnims2 = Object.keys(anims2).some(k => k.startsWith('transform.'));

                // Merge if it's a simple translation-only wrapper
                const canMerge = (!hasComplexT1 && !hasAnims1) || (!hasComplexT2 && !hasAnims2);

                if (canMerge) {
                    const mergedNode: SceneNode = {
                        ...child,
                        id: node.id, // CRITICAL: Preserve the identity of the original node (the Layer) so parenting links don't break
                        // Maintain the identity of the child node but take the name of parent if it's unique
                        name: (node.name && node.name !== 'Group' && node.name !== 'Layer') ? node.name : child.name,
                        parentId: node.parentId,
                        // CRITICAL: Preserve AE parenting link from the wrapper node
                        parentLayerId: node.parentLayerId || child.parentLayerId,
                        // CRITICAL: Inherit structural metadata from the parent wrapper
                        visible: node.visible && child.visible,
                        matteTargetIds: node.matteTargetIds ? [...(node.matteTargetIds || []), ...(child.matteTargetIds || [])] : child.matteTargetIds,
                        matteSourceId: node.matteSourceId || child.matteSourceId,
                        matteType: node.matteType || child.matteType,
                        masks: node.masks ? [...(node.masks || []), ...(child.masks || [])] : child.masks,
                        locked: node.locked || child.locked,
                        transform: {
                            ...child.transform,
                            // Correct transform baking: Account for parent's anchor point subtraction
                            // NewPos = ParentPos - ParentAnchor + ChildPos
                            x: (t1.x || 0) - (t1.anchorX || 0) + (t2.x || 0),
                            y: (t1.y || 0) - (t1.anchorY || 0) + (t2.y || 0),
                            anchorX: t2.anchorX,
                            anchorY: t2.anchorY,
                            rotation: (t1.rotation || 0) + (t2.rotation || 0),
                            scaleX: (t1.scaleX ?? 1) * (t2.scaleX ?? 1),
                            scaleY: (t1.scaleY ?? 1) * (t2.scaleY ?? 1),
                        },
                        style: {
                            ...node.style,
                            ...child.style,
                            // Ensure transparency/visibility is logically combined
                            fillVisible: node.style.fillVisible || child.style.fillVisible,
                            strokeWidth: child.style.strokeWidth || node.style.strokeWidth,
                            opacity: (node.style.opacity ?? 1) * (child.style.opacity ?? 1),
                        },
                        animations: { ...node.animations, ...child.animations },
                        props: { ...child.props, isLayer: node.props?.isLayer || child.props?.isLayer }, // Carry over layer identity
                        inPoint: Math.max(node.inPoint, child.inPoint),
                        outPoint: Math.min(node.outPoint, child.outPoint)
                    };

                    const remaining = allChildren.filter(c => c.id !== childId);
                    return this.collapseNodeChain(mergedNode, remaining);
                }
            }
        }
        return { node, remaining: allChildren };
    }

    private static parseMasks(layer: LottieLayer): any[] | undefined {
        if (!layer.masksProperties || !Array.isArray(layer.masksProperties)) return undefined;

        return layer.masksProperties.map(m => {
            const ptData = this.getPropertyData(m.pt, {} as any);
            const oData = this.getPropertyData(m.o, 100);

            const lottieShapeToPoints = (shape: any) => {
                if (!shape || !shape.v) return [];
                return shape.v.map((v: any, idx: number) => ({
                    x: v[0], y: v[1],
                    inX: shape.i?.[idx]?.[0] || 0, inY: shape.i?.[idx]?.[1] || 0,
                    outX: shape.o?.[idx]?.[0] || 0, outY: shape.o?.[idx]?.[1] || 0
                }));
            };

            let pathView = ptData.value || {};
            if (Array.isArray(pathView) && pathView.length > 0 && pathView[0]?.v) {
                pathView = pathView[0];
            }

            const points = lottieShapeToPoints(pathView);
            const animations: Record<string, Keyframe[]> = {};

            if (ptData.keyframes) {
                animations['points'] = ptData.keyframes.map(kf => {
                    let shapeData = kf.value;
                    if (Array.isArray(shapeData) && shapeData.length > 0 && shapeData[0]?.v) {
                        shapeData = shapeData[0];
                    }
                    return { ...kf, time: kf.time, value: lottieShapeToPoints(shapeData) };
                });
            }
            if (oData.keyframes) {
                animations['style.opacity'] = oData.keyframes.map(kf => ({ ...kf, time: kf.time, value: kf.value / 100 }));
            }

            return {
                id: generateId(),
                name: m.nm || 'Mask',
                inverted: !!m.inv,
                mode: m.mode || 'a',
                props: { points, closed: true },
                style: { opacity: oData.value / 100 },
                animations
            };
        });
    }

    /**
     * Flattens groups that contain a single child.
     */
    private static flattenSingleShapeGroups(
        rootNode: SceneNode,
        allChildren: SceneNode[]
    ): { node: SceneNode, remaining: SceneNode[] } {
        const nodeMap = new Map<string, SceneNode>();
        allChildren.forEach(c => nodeMap.set(c.id, c));
        nodeMap.set(rootNode.id, rootNode);

        const removedIds = new Set<string>();

        const processParent = (parent: SceneNode) => {
            const newChildIds: string[] = [];

            for (const childId of parent.children) {
                const child = nodeMap.get(childId);
                if (!child) { newChildIds.push(childId); continue; }

                // NEVER flatten a node marked as a Lottie Layer or a Lottie shape group (gr item).
                // Shape groups represent the real AE/LottieFiles hierarchy: Layer → Group → Path.
                if (child.type === 'group' && child.children.length === 1 && !child.props?.isLayer && !child.props?.isShapeGroup) {
                    const grandchildId = child.children[0];
                    const grandchild = nodeMap.get(grandchildId);

                    // NEVER flatten an artboard or precomp into a parent group
                    if (grandchild && grandchild.type !== 'artboard' && grandchild.type !== 'precomp') {
                        const t1 = child.transform;
                        const t2 = grandchild.transform;

                        const anims1 = child.animations || {};
                        const anims2 = grandchild.animations || {};
                        const hasComplexT1 = (t1.rotation || 0) !== 0 || (t1.scaleX ?? 1) !== 1 || (t1.scaleY ?? 1) !== 1;
                        const hasComplexT2 = (t2.rotation || 0) !== 0 || (t2.scaleX ?? 1) !== 1 || (t2.scaleY ?? 1) !== 1;
                        const hasAnims1 = Object.keys(anims1).some(k => k.startsWith('transform.'));
                        const hasAnims2 = Object.keys(anims2).some(k => k.startsWith('transform.'));

                        const canFlatten = (!hasComplexT1 && !hasAnims1) || (!hasComplexT2 && !hasAnims2);

                        if (canFlatten) {
                            // Merge child (group) into grandchild
                            grandchild.transform = {
                                ...grandchild.transform,
                                // Correct transform baking: parent's offset (x-ax) + child's position (x)
                                x: (t1.x || 0) - (t1.anchorX || 0) + (t2.x || 0),
                                y: (t1.y || 0) - (t1.anchorY || 0) + (t2.y || 0),
                                anchorX: t2.anchorX,
                                anchorY: t2.anchorY,
                                rotation: (t1.rotation || 0) + (t2.rotation || 0),
                                scaleX: (t1.scaleX ?? 1) * (t2.scaleX ?? 1),
                                scaleY: (t1.scaleY ?? 1) * (t2.scaleY ?? 1),
                            };

                            const mergedAnims: Record<string, Keyframe[]> = { ...(grandchild.animations || {}) };
                            if (child.animations) {
                                Object.entries(child.animations).forEach(([key, kfs]) => {
                                    if (!mergedAnims[key]) mergedAnims[key] = kfs;
                                });
                            }
                            grandchild.animations = mergedAnims;
                            grandchild.style = {
                                ...child.style,
                                ...grandchild.style,
                                fillVisible: child.style.fillVisible || grandchild.style.fillVisible,
                                strokeWidth: grandchild.style.strokeWidth || child.style.strokeWidth,
                                opacity: (child.style.opacity ?? 1) * (grandchild.style.opacity ?? 1),
                            };
                            grandchild.inPoint = Math.max(child.inPoint, grandchild.inPoint);
                            grandchild.outPoint = Math.min(child.outPoint, grandchild.outPoint);
                            grandchild.name = (child.name && child.name !== 'Group') ? child.name : grandchild.name;
                            grandchild.parentId = parent.id;
                            // CRITICAL: Preserve AE parenting link from the collapsed group
                            grandchild.parentLayerId = child.parentLayerId || grandchild.parentLayerId;
                            grandchild.visible = child.visible && grandchild.visible;
                            grandchild.matteTargetIds = child.matteTargetIds ? [...(child.matteTargetIds || []), ...(grandchild.matteTargetIds || [])] : grandchild.matteTargetIds;
                            grandchild.matteSourceId = child.matteSourceId || grandchild.matteSourceId;
                            grandchild.matteType = child.matteType || grandchild.matteType;
                            grandchild.masks = child.masks ? [...(child.masks || []), ...(grandchild.masks || [])] : grandchild.masks;
                            grandchild.locked = child.locked || grandchild.locked;

                            newChildIds.push(grandchild.id);
                            removedIds.add(child.id);

                            // Recurse into the now-moved grandchild
                            processParent(grandchild);
                            continue;
                        }
                    }
                }

                // Normal processing: recurse if group, always keep
                if (child.type === 'group') {
                    processParent(child);
                }
                newChildIds.push(childId);
            }
            parent.children = newChildIds;
        };

        processParent(rootNode);

        const remaining = allChildren.filter(c => !removedIds.has(c.id));
        return { node: rootNode, remaining };
    }

    /**
     * Post-processing pass to simplify the entire scene hierarchy.
     * Collapses redundant single-child groups iteratively.
     */
    private static postProcessNodes(nodes: SceneNode[]) {
        const artboards = nodes.filter(n => n.type === 'artboard');
        const nodeMap = new Map<string, SceneNode>();
        nodes.forEach(n => nodeMap.set(n.id, n));

        artboards.forEach(artboard => {
            let changed = true;
            let iterations = 0;

            while (changed && iterations < 15) {
                changed = false;
                iterations++;

                const newChildIds: string[] = [];
                for (const childId of artboard.children) {
                    const child = nodeMap.get(childId);

                    // Logic: If a top-level child of this artboard is a Group with exactly 1 non-artboard child...
                    // Safety: NEVER collapse if it's a node marked as a Layer (represents AE Layer identity)
                    if (child && child.type === 'group' && child.children.length === 1 && !child.props?.isLayer) {
                        const grandchildId = child.children[0];
                        const grandchild = nodeMap.get(grandchildId);

                        // Safety: ONLY collapse if the grandchild is physically present and is a simple shape/group
                        // ALSO: Ensure the grandchild isn't already the root of another artboard hierarchy (unlikely but safe)
                        if (grandchild && grandchild.type !== 'artboard' && grandchild.type !== 'precomp') {
                            const t1 = child.transform;
                            const t2 = grandchild.transform;

                            // Safety: ONLY merge if the parent has an identity transform (neutral wrapper)
                            // or if we can safely bake. For now, let's be strict to prevent displacement issues.
                            const isParentIdentity = (t1.x === 0 && t1.y === 0 && (t1.rotation || 0) === 0 && (t1.scaleX ?? 1) === 1 && (t1.scaleY ?? 1) === 1);

                            if (isParentIdentity) {
                                // Merge child properties into grandchild
                                const mergedNode: SceneNode = {
                                    ...grandchild,
                                    id: child.id, // Replace child (group) with grandchild's content but keep child's identity for parenting
                                    name: (child.name && child.name !== 'Group') ? child.name : grandchild.name,
                                    parentId: artboard.id,
                                    // CRITICAL: Preserve AE parenting link from the parent wrapper
                                    parentLayerId: child.parentLayerId || grandchild.parentLayerId,
                                    // CRITICAL: Inherit structural metadata from the parent layer being flattened
                                    visible: child.visible && grandchild.visible,
                                    matteTargetIds: child.matteTargetIds ? [...(child.matteTargetIds || []), ...(grandchild.matteTargetIds || [])] : grandchild.matteTargetIds,
                                    matteSourceId: child.matteSourceId || grandchild.matteSourceId,
                                    matteType: child.matteType || grandchild.matteType,
                                    masks: child.masks ? [...(child.masks || []), ...(grandchild.masks || [])] : grandchild.masks,
                                    locked: child.locked || grandchild.locked,
                                    transform: {
                                        ...grandchild.transform,
                                        // Identity parent means no baking needed
                                    },
                                    animations: { ...child.animations, ...(grandchild.animations || {}) },
                                    inPoint: Math.max(child.inPoint, grandchild.inPoint),
                                    outPoint: Math.min(child.outPoint, grandchild.outPoint)
                                };

                                // Update Map and remove old grandchild node
                                nodeMap.set(child.id, mergedNode);
                                nodeMap.delete(grandchildId); // Remove the original grandchild from the map

                                // Update the main 'nodes' array: replace the child (group) with the merged node, remove the grandchild
                                const childIdxInNodes = nodes.indexOf(child);
                                const grandchildIdxInNodes = nodes.indexOf(grandchild);
                                if (childIdxInNodes !== -1) {
                                    nodes[childIdxInNodes] = mergedNode;
                                }
                                if (grandchildIdxInNodes !== -1) {
                                    nodes.splice(grandchildIdxInNodes, 1);
                                }

                                // Link grandchildren of the merged node to the new parent (which is now 'child.id')
                                if (mergedNode.children) {
                                    mergedNode.children.forEach(gcId => {
                                        const gc = nodeMap.get(gcId);
                                        if (gc) gc.parentId = child.id;
                                    });
                                }

                                newChildIds.push(child.id); // Add the ID of the new merged node (which took child's ID)
                                changed = true;
                                continue;
                            }
                        }
                    }
                    newChildIds.push(childId);
                }
                artboard.children = newChildIds;
            }
        });

        // Pass 2: Collapse isLayer wrapper groups that contain a single leaf shape.
        // Restores round-trip fidelity for standalone shapes exported as Shape Layers:
        //   layer_group(isLayer) → rect   becomes just   rect(isLayer)
        // The transform formula (t1.x - t1.anchorX + t2.x) correctly recovers the original
        // editor position because rc.p is the shape center (w/2, h/2) and ks.p is the
        // original editor position, so the offsets cancel out.
        artboards.forEach(artboard => {
            const newArtboardChildren: string[] = [];
            for (const childId of artboard.children) {
                const child = nodeMap.get(childId);
                if (
                    child &&
                    child.type === 'group' &&
                    child.props?.isLayer &&
                    child.children.length === 1
                ) {
                    const grandchildId = child.children[0];
                    const grandchild = nodeMap.get(grandchildId);
                    // Only collapse when the original layer's shapes were NOT gr items.
                    // If _rawLottieData.shapes contains a 'gr', the layer was a group layer
                    // (group + children) and the layer_group node must be preserved as-is.
                    const rawShapes: any[] = child._rawLottieData?.shapes ?? [];
                    const hadGrItems = rawShapes.some((s: any) => s.ty === 'gr');
                    if (
                        grandchild &&
                        !hadGrItems &&
                        (grandchild.type === 'rect' || grandchild.type === 'ellipse' || grandchild.type === 'path')
                    ) {
                        const t1 = child.transform;
                        const t2 = grandchild.transform;
                        const mergedNode: SceneNode = {
                            ...grandchild,
                            id: child.id,
                            name: (child.name && child.name !== 'Group') ? child.name : grandchild.name,
                            parentId: artboard.id,
                            parentLayerId: child.parentLayerId || grandchild.parentLayerId,
                            props: { ...grandchild.props, isLayer: true },
                            transform: {
                                ...grandchild.transform,
                                x: (t1.x || 0) - (t1.anchorX || 0) + (t2.x || 0),
                                y: (t1.y || 0) - (t1.anchorY || 0) + (t2.y || 0),
                                rotation: (t1.rotation || 0) + (t2.rotation || 0),
                                scaleX: (t1.scaleX ?? 1) * (t2.scaleX ?? 1),
                                scaleY: (t1.scaleY ?? 1) * (t2.scaleY ?? 1),
                            },
                            style: { ...child.style, ...grandchild.style },
                            animations: { ...(child.animations || {}), ...(grandchild.animations || {}) },
                            _rawLottieData: child._rawLottieData,
                            _importSupport: child._importSupport,
                            _importWarnings: child._importWarnings,
                            _originalParsedFill: child._originalParsedFill ?? grandchild._originalParsedFill,
                            _originalParsedStroke: child._originalParsedStroke ?? grandchild._originalParsedStroke,
                            _originalParsedStrokeWidth: child._originalParsedStrokeWidth ?? grandchild._originalParsedStrokeWidth,
                            _originalParsedX: child._originalParsedX,
                            _originalParsedY: child._originalParsedY,
                            _originalParsedRotation: child._originalParsedRotation,
                            _originalParsedScaleX: child._originalParsedScaleX,
                            _originalParsedScaleY: child._originalParsedScaleY,
                            _originalParsedOpacity: child._originalParsedOpacity ?? grandchild._originalParsedOpacity,
                            masks: child.masks ? [...(child.masks || []), ...(grandchild.masks || [])] : grandchild.masks,
                            inPoint: Math.max(child.inPoint, grandchild.inPoint),
                            outPoint: Math.min(child.outPoint, grandchild.outPoint),
                            visible: child.visible && grandchild.visible,
                            locked: child.locked || grandchild.locked,
                        };
                        nodeMap.set(child.id, mergedNode);
                        nodeMap.delete(grandchildId);
                        const gcIdx = nodes.indexOf(grandchild);
                        if (gcIdx !== -1) nodes.splice(gcIdx, 1);
                        const childIdx = nodes.indexOf(child);
                        if (childIdx !== -1) nodes[childIdx] = mergedNode;
                        newArtboardChildren.push(child.id);
                        continue;
                    }
                }
                newArtboardChildren.push(childId);
            }
            artboard.children = newArtboardChildren;
        });

        // Rebuild the array from the map to ensure no duplicates or orphans
        nodes.length = 0;
        nodes.push(...Array.from(nodeMap.values()));

        // Phase 4 Step 2: Merge sibling paths with identical styles. 
        // DISABLED: Lottie does NOT support compound paths within a single 'sh' node. 
        // Concatenating sub-paths causes geometric distortion, connecting lines, 
        // and filled-in holes (e.g., in text letters and icons). Lottie expects 
        // separate paths in a group to rely on the Even-Odd fill rule natively.
        // this.mergeSiblingPaths(nodes);
    }

    /**
     * Phase 4 Step 2: Merge consecutive sibling path/rect/ellipse nodes that share

     * identical styles into compound path nodes. This reduces total node count and
     * enables fewer draw calls at render time.
     *
     * Safety: Only merges nodes that are:
     * - The same type ('path')
     * - Have no animations (static shapes only)
     * - Have identical style properties
     * - Have no effects, blend modes, or mattes
     * - Are 'closed' paths
     */
    private static mergeSiblingPaths(nodes: SceneNode[]) {
        const nodeMap = new Map<string, SceneNode>();
        nodes.forEach(n => nodeMap.set(n.id, n));

        // Find all parent nodes (groups, artboards) that have children
        const parents = nodes.filter(n =>
            n.children && n.children.length > 1 &&
            (n.type === 'group' || n.type === 'artboard' || n.type === 'precomp')
        );

        for (const parent of parents) {
            const children = parent.children;
            if (!children || children.length < 2) continue;

            const newChildren: string[] = [];
            let i = 0;

            while (i < children.length) {
                const childId = children[i];
                const child = nodeMap.get(childId);

                // Check if this child is a merge candidate
                if (child && this.isMergeCandidate(child)) {
                    const styleKey = this.getMergeStyleKey(child);
                    const mergeRun: string[] = [childId];
                    let j = i + 1;

                    // Find consecutive siblings with same style
                    while (j < children.length) {
                        const nextId = children[j];
                        const nextChild = nodeMap.get(nextId);
                        if (!nextChild || !this.isMergeCandidate(nextChild)) break;
                        if (this.getMergeStyleKey(nextChild) !== styleKey) break;
                        mergeRun.push(nextId);
                        j++;
                    }

                    if (mergeRun.length >= 2) {
                        // Merge these paths into a single compound path
                        const mergedNode = this.mergePathNodes(mergeRun, child, parent.id, nodeMap);
                        if (mergedNode) {
                            nodeMap.set(mergedNode.id, mergedNode);
                            newChildren.push(mergedNode.id);

                            // Remove merged children from map
                            for (const id of mergeRun) {
                                nodeMap.delete(id);
                            }
                        } else {
                            // Merge failed, keep individually
                            for (const id of mergeRun) {
                                newChildren.push(id);
                            }
                        }
                    } else {
                        for (const id of mergeRun) {
                            newChildren.push(id);
                        }
                    }
                    i = j;
                } else {
                    newChildren.push(childId);
                    i++;
                }
            }

            parent.children = newChildren;
        }

        // Rebuild array from map
        nodes.length = 0;
        nodes.push(...Array.from(nodeMap.values()));
    }

    private static isMergeCandidate(node: SceneNode): boolean {
        // Only merge path nodes (they support compound paths naturally)
        if (node.type !== 'path') return false;

        // Must not have children
        if (node.children && node.children.length > 0) return false;

        // Must be closed paths
        if (!node.props.closed) return false;

        // We now allow merging for animations as long as they share the exact same animation properties.
        // The getMergeStyleKey handles grouping them cleanly.

        // No effects
        if (node.style.effects && node.style.effects.length > 0) return false;

        // No blend mode override
        if (node.style.blendMode && node.style.blendMode !== 'normal') return false;

        // No matte
        if (node.matteSourceId || (node.matteTargetIds && node.matteTargetIds.length > 0)) return false;

        // No gradient (depends on per-node coordinates)
        if (node.style.fillType === 'gradient' || node.style.strokeType === 'gradient') return false;

        // No trim path
        if ((node.style.trimStart && node.style.trimStart > 0) ||
            (node.style.trimEnd !== undefined && node.style.trimEnd < 1)) return false;

        return true;
    }

    private static getMergeStyleKey(node: SceneNode): string {
        // Convert animations to a naive string for hash matching to ensure only identically animated shapes merge
        let animStr = '';
        if (node.animations) {
            animStr = Object.keys(node.animations).sort().map(k => `${k}:${node.animations![k].length}`).join('|');
        }

        return [
            node.style.fill || '',
            node.style.fillOpacity ?? 1,
            node.style.fillVisible ?? true,
            node.style.stroke || '',
            node.style.strokeWidth || 0,
            node.style.strokeOpacity ?? 1,
            node.style.opacity,
            node.style.strokeLinecap || 'butt',
            node.style.strokeLinejoin || 'miter',
            node.style.fillRule || 'nonzero',
            animStr
        ].join('|');
    }

    private static mergePathNodes(
        nodeIds: string[],
        styleRef: SceneNode,
        parentId: string,
        nodeMap: Map<string, SceneNode>
    ): SceneNode | null {
        // Collect all points from all paths, offset by their transform positions
        const allSubPaths: any[] = [];

        for (const nodeId of nodeIds) {
            const node = nodeMap.get(nodeId);
            if (!node) continue;

            const points = node.props.points;
            if (!points || !Array.isArray(points) || points.length === 0) continue;

            // Offset points by the node's position (transform.x, transform.y)
            // and account for anchor offset
            const tx = (node.transform.x || 0) - (node.transform.anchorX || 0);
            const ty = (node.transform.y || 0) - (node.transform.anchorY || 0);

            const offsetPoints = points.map((p: any) => ({
                x: p.x + tx,
                y: p.y + ty,
                inX: p.inX || 0,
                inY: p.inY || 0,
                outX: p.outX || 0,
                outY: p.outY || 0,
            }));

            allSubPaths.push(...offsetPoints);
            // Mark sub-path boundaries with a special separator point for compound paths
            // Actually, for Canvas2D compound paths work naturally with closePath() between sub-paths
            // So we just concatenate all points and mark the node as closed
        }

        if (allSubPaths.length === 0) return null;

        // Create a merged path node
        const mergedId = generateId();
        const merged: SceneNode = {
            ...styleRef,
            id: mergedId,
            name: `Merged Path (${nodeIds.length})`,
            type: 'path',
            parentId: parentId,
            children: [],
            transform: {
                ...styleRef.transform,
                x: 0,
                y: 0,
                anchorX: 0,
                anchorY: 0,
                rotation: 0,
                scaleX: 1,
                scaleY: 1,
            },
            props: {
                ...styleRef.props,
                points: allSubPaths,
                closed: true,
                // Store sub-path info for correct compound path rendering
                subPathLengths: nodeIds.map(id => {
                    const n = nodeMap.get(id);
                    return n?.props?.points?.length || 0;
                }),
            },
            animations: { ...styleRef.animations } // Ensure animations are copied over
        };

        // Text outlines and overlapping shapes from LottieFiles often have same-winding paths.
        // Forcing evenodd winding ensures that holes (e.g. in 'o', 'd', 'e') are properly knocked out.
        if (merged.style) {
            merged.style.fillRule = 'evenodd';
        }

        return merged;
    }

    private static parseEffects(layer: LottieLayer): { effects: any[], effectAnimations: Record<string, Keyframe[]> } {
        if (!layer.ef || !Array.isArray(layer.ef)) return { effects: [], effectAnimations: {} };

        const effects: any[] = [];
        const effectAnimations: Record<string, Keyframe[]> = {};

        layer.ef.forEach((lEffect, index) => {
            const prefix = `style.effects.${index}`;
            const enabled = (lEffect as any).en !== 0;

            if (lEffect.ty === 29) { // Gaussian Blur
                const blurRaw = lEffect.ef?.find((e: any) => e.nm === 'Blurriness' || e.ty === 0);
                if (blurRaw) {
                    const { value, keyframes } = this.getPropertyData(blurRaw.v, 0);
                    effects.push({
                        id: generateId(),
                        type: 'blur',
                        name: lEffect.nm || 'Blur',
                        visible: enabled,
                        blur: value
                    });
                    if (keyframes) effectAnimations[`${prefix}.blur`] = keyframes;
                }
            } else if (lEffect.ty === 25) { // Drop Shadow
                const colorRaw = lEffect.ef?.find((e: any) => e.nm === 'Shadow Color' || e.ty === 2);
                const opacityRaw = lEffect.ef?.find((e: any) => e.nm === 'Opacity' || e.ty === 0);
                const directionRaw = lEffect.ef?.find((e: any) => e.nm === 'Direction' || e.ty === 0);
                const distanceRaw = lEffect.ef?.find((e: any) => e.nm === 'Distance' || e.ty === 0);
                const softnessRaw = lEffect.ef?.find((e: any) => e.nm === 'Softness' || e.ty === 0);

                const colorData = this.getPropertyData(colorRaw?.v, [0, 0, 0, 1]);
                const opacityData = this.getPropertyData(opacityRaw?.v, 128);
                const directionData = this.getPropertyData(directionRaw?.v, 90);
                const distanceData = this.getPropertyData(distanceRaw?.v, 5);
                const softnessData = this.getPropertyData(softnessRaw?.v, 5);

                effects.push({
                    id: generateId(),
                    type: 'shadow',
                    name: lEffect.nm || 'Drop Shadow',
                    visible: enabled,
                    color: this.lottieColorToHex(colorData.value),
                    opacity: colorData.value[3] !== undefined ? colorData.value[3] : (opacityData.value / 255),
                    direction: directionData.value,
                    distance: distanceData.value,
                    blur: softnessData.value
                });

                if (colorData.keyframes) effectAnimations[`${prefix}.color`] = colorData.keyframes.map(k => ({ ...k, time: k.time, value: this.lottieColorToHex(k.value) }));
                if (opacityData.keyframes) effectAnimations[`${prefix}.opacity`] = opacityData.keyframes.map(k => ({ ...k, time: k.time, value: k.value / 255 }));
                if (directionData.keyframes) effectAnimations[`${prefix}.direction`] = directionData.keyframes.map(k => ({ ...k, time: k.time }));
                if (distanceData.keyframes) effectAnimations[`${prefix}.distance`] = distanceData.keyframes.map(k => ({ ...k, time: k.time }));
                if (softnessData.keyframes) effectAnimations[`${prefix}.blur`] = softnessData.keyframes.map(k => ({ ...k, time: k.time }));
            }
        });

        return { effects, effectAnimations };
    }

    private static parseShapes(
        shapes: LottieShape[],
        parentNode: SceneNode,
        onChild: (node: SceneNode) => void,
        inherited: { style: Style, animations: Record<string, Keyframe[]> },
        liftingTarget?: SceneNode
    ) {
        let currentStyle = { ...inherited.style };
        let currentAnimations = { ...inherited.animations };
        const createdNodesInThisScope: SceneNode[] = [];
        const allNodesInScope = new Map<string, SceneNode>(); // Track all nodes including nested
        const trackOnChild = (node: SceneNode) => { allNodesInScope.set(node.id, node); onChild(node); };

        for (const item of shapes) {
            if (item.ty === 'fl') {
                const cData = this.getPropertyData(item.c, [1, 1, 1, 1]);
                const oData = this.getPropertyData(item.o, 100);

                currentStyle.fillType = 'solid';
                currentStyle.fill = this.lottieColorToHex(cData.value);
                currentStyle.fillOpacity = oData.value / 100;
                currentStyle.fillVisible = true;
                currentStyle.fillRule = (item as any).r === 2 ? 'evenodd' : 'nonzero';

                if (cData.keyframes) {
                    currentAnimations['style.fill'] = cData.keyframes.map(kf => ({ ...kf, time: kf.time, value: this.lottieColorToHex(kf.value) }));
                }
                if (oData.keyframes) {
                    currentAnimations['style.fillOpacity'] = oData.keyframes.map(kf => ({ ...kf, time: kf.time, value: kf.value / 100 }));
                }

                createdNodesInThisScope.forEach(n => {
                    n.style.fill = currentStyle.fill;
                    n.style.fillType = 'solid';
                    n.style.fillOpacity = currentStyle.fillOpacity;
                    n.style.fillVisible = true;
                    n.style.fillRule = currentStyle.fillRule;
                    n.animations = { ...n.animations, ...currentAnimations };
                });

                // Lift static style to parent/layer so Inspector shows the color when group is selected.
                // Animations are NOT lifted — color keyframes live only on the leaf shape nodes.
                parentNode.style.fill = currentStyle.fill;
                parentNode.style.fillType = 'solid';
                parentNode.style.fillOpacity = currentStyle.fillOpacity;
                parentNode.style.fillVisible = true;
                parentNode.style.fillRule = currentStyle.fillRule;

                if (liftingTarget && liftingTarget.id !== parentNode.id) {
                    liftingTarget.style.fill = currentStyle.fill;
                    liftingTarget.style.fillType = 'solid';
                    liftingTarget.style.fillOpacity = currentStyle.fillOpacity;
                    liftingTarget.style.fillVisible = true;
                    liftingTarget.style.fillRule = currentStyle.fillRule;
                }
            }
            else if (item.ty === 'gf' || item.ty === 'gs') {
                const isFill = item.ty === 'gf';
                const gProp = (item as any).g;
                const sProp = (item as any).s;
                const eProp = (item as any).e;
                const oProp = (item as any).o;
                const gType = (item as any).t === 2 ? 'radial' : 'linear';

                // Robust stop count detection
                let stopCount = gProp?.p;
                if (stopCount === undefined && gProp?.k?.p !== undefined) stopCount = gProp.k.p;

                const gData = this.getPropertyData(gProp, []);

                // Inference fallback if p is missing
                if (stopCount === undefined) {
                    const len = gData.value.length;
                    if (len > 0) {
                        if (len % 6 === 0) stopCount = len / 6;
                        else if (len % 4 === 0) stopCount = len / 4;
                        else stopCount = Math.floor(len / 4);
                    } else {
                        stopCount = 2;
                    }
                }
                const sData = this.getPropertyData(sProp, [0, 0]);
                const eData = this.getPropertyData(eProp, [100, 100]);
                const oData = this.getPropertyData(oProp, 100);

                const parseGrad = (gVal: any, sVal: any, eVal: any, nodeOriginX: number = 0, nodeOriginY: number = 0) => {
                    const res = this.parseGradientData(Array.isArray(gVal) ? gVal : gData.value as number[], stopCount, gType,
                        [sVal[0] - nodeOriginX, sVal[1] - nodeOriginY],
                        [eVal[0] - nodeOriginX, eVal[1] - nodeOriginY]);
                    return res;
                };

                const propKey = isFill ? 'style.fillGradient' : 'style.strokeGradient';
                const opacKey = isFill ? 'style.fillOpacity' : 'style.strokeOpacity';

                if (!isFill) {
                    const wData = this.getPropertyData((item as any).w, 1);
                    currentStyle.strokeWidth = wData.value;
                    currentStyle.strokeLinecap = (item as any).lc === 1 ? 'butt' : ((item as any).lc === 3 ? 'square' : 'round');
                    currentStyle.strokeLinejoin = (item as any).lj === 1 ? 'miter' : ((item as any).lj === 3 ? 'bevel' : 'round');
                    if (wData.keyframes) {
                        currentAnimations['style.strokeWidth'] = wData.keyframes;
                    }
                }

                if (oData.keyframes) {
                    currentAnimations[opacKey] = oData.keyframes.map(kf => ({ ...kf, value: kf.value / 100 }));
                }

                createdNodesInThisScope.forEach(n => {
                    const originX = n.transform.x - n.transform.anchorX;
                    const originY = n.transform.y - n.transform.anchorY;

                    n.style[isFill ? 'fillType' : 'strokeType'] = 'gradient';
                    n.style[isFill ? 'fillOpacity' : 'strokeOpacity'] = oData.value / 100;
                    n.style[isFill ? 'fillGradient' : 'strokeGradient'] = parseGrad(gData.value, sData.value, eData.value, originX, originY);
                    if (isFill) n.style.fillRule = (item as any).r === 2 ? 'evenodd' : 'nonzero';

                    if (isFill) {
                        n.style.fillVisible = true;
                    } else {
                        n.style.strokeWidth = currentStyle.strokeWidth;
                        n.style.strokeLinecap = currentStyle.strokeLinecap;
                        n.style.strokeLinejoin = currentStyle.strokeLinejoin;
                        n.style.strokeType = 'gradient';
                    }

                    if (gData.keyframes || sData.keyframes || eData.keyframes) {
                        const allTimes = new Set<number>();
                        [gData, sData, eData].forEach(d => d.keyframes?.forEach(k => allTimes.add(k.time)));
                        const sortedTimes = Array.from(allTimes).sort((a, b) => a - b);

                        if (!n.animations) n.animations = {};
                        n.animations[propKey] = sortedTimes.map(time => {
                            const gVal = gData.keyframes?.find(k => k.time === time)?.value || gData.value;
                            const sVal = sData.keyframes?.find(k => k.time === time)?.value || sData.value;
                            const eVal = eData.keyframes?.find(k => k.time === time)?.value || eData.value;
                            return { id: generateId(), time, value: parseGrad(gVal, sVal, eVal, originX, originY) };
                        });
                    }
                    n.animations = { ...n.animations, ...currentAnimations };
                });

                // Lift static gradient style to parent/layer so Inspector shows it when group is selected.
                // Animations are NOT lifted — gradient keyframes live only on the leaf shape nodes.
                parentNode.style[isFill ? 'fillGradient' : 'strokeGradient'] = parseGrad(gData.value, sData.value, eData.value, 0, 0);
                if (isFill) {
                    parentNode.style.fillVisible = true;
                    parentNode.style.fillType = 'gradient';
                } else {
                    parentNode.style.strokeWidth = currentStyle.strokeWidth || parentNode.style.strokeWidth;
                    parentNode.style.strokeType = 'gradient';
                }

                if (liftingTarget && liftingTarget.id !== parentNode.id) {
                    liftingTarget.style[isFill ? 'fillGradient' : 'strokeGradient'] = parseGrad(gData.value, sData.value, eData.value, 0, 0);
                    if (isFill) {
                        liftingTarget.style.fillVisible = true;
                        liftingTarget.style.fillType = 'gradient';
                    } else {
                        liftingTarget.style.strokeWidth = currentStyle.strokeWidth || liftingTarget.style.strokeWidth;
                        liftingTarget.style.strokeType = 'gradient';
                    }
                }

                currentStyle[isFill ? 'fillGradient' : 'strokeGradient'] = parseGrad(gData.value, sData.value, eData.value, 0, 0);
                if (isFill) currentStyle.fillVisible = true;
            }
            else if (item.ty === 'st') {
                const cData = this.getPropertyData(item.c, [0, 0, 0, 1]);
                const oData = this.getPropertyData(item.o, 100);
                const wData = this.getPropertyData(item.w, 1);

                currentStyle.strokeType = 'solid';
                currentStyle.stroke = this.lottieColorToHex(cData.value);
                currentStyle.strokeWidth = wData.value;
                currentStyle.strokeOpacity = oData.value / 100;
                currentStyle.strokeLinecap = (item as any).lc === 1 ? 'butt' : ((item as any).lc === 3 ? 'square' : 'round');
                currentStyle.strokeLinejoin = (item as any).lj === 1 ? 'miter' : ((item as any).lj === 3 ? 'bevel' : 'round');

                if (cData.keyframes) {
                    currentAnimations['style.stroke'] = cData.keyframes.map(kf => ({ ...kf, time: kf.time, value: this.lottieColorToHex(kf.value) }));
                }
                if (oData.keyframes) {
                    currentAnimations['style.strokeOpacity'] = oData.keyframes.map(kf => ({ ...kf, time: kf.time, value: kf.value / 100 }));
                }
                if (wData.keyframes) {
                    currentAnimations['style.strokeWidth'] = wData.keyframes.map(kf => ({ ...kf, time: kf.time }));
                }

                createdNodesInThisScope.forEach(n => {
                    n.style.stroke = currentStyle.stroke;
                    n.style.strokeWidth = currentStyle.strokeWidth;
                    n.style.strokeOpacity = currentStyle.strokeOpacity;
                    n.style.strokeType = 'solid';
                    n.style.strokeLinecap = currentStyle.strokeLinecap;
                    n.style.strokeLinejoin = currentStyle.strokeLinejoin;
                    n.animations = { ...n.animations, ...currentAnimations };
                });

                // Lift static stroke style to parent/layer so Inspector shows it when group is selected.
                // Animations are NOT lifted — stroke keyframes live only on the leaf shape nodes.
                parentNode.style.stroke = currentStyle.stroke;
                parentNode.style.strokeWidth = currentStyle.strokeWidth;
                parentNode.style.strokeOpacity = currentStyle.strokeOpacity;
                parentNode.style.strokeType = 'solid';
                parentNode.style.strokeLinecap = currentStyle.strokeLinecap;
                parentNode.style.strokeLinejoin = currentStyle.strokeLinejoin;

                if (liftingTarget && liftingTarget.id !== parentNode.id) {
                    liftingTarget.style.stroke = currentStyle.stroke;
                    liftingTarget.style.strokeWidth = currentStyle.strokeWidth;
                    liftingTarget.style.strokeOpacity = currentStyle.strokeOpacity;
                    liftingTarget.style.strokeType = 'solid';
                    liftingTarget.style.strokeLinecap = currentStyle.strokeLinecap;
                    liftingTarget.style.strokeLinejoin = currentStyle.strokeLinejoin;
                }
            }
            else if (item.ty === 'tr') {
                const pData = this.getPropertyData(item.p, [0, 0]);
                const rData = this.getPropertyData(item.r, 0);
                const sData = this.getPropertyData(item.s, [100, 100]);
                const aData = this.getPropertyData(item.a, [0, 0]);
                const oData = this.getPropertyData(item.o, 100);

                // Only overwrite parentNode transform if this is a nested group operator,
                // not the root transform of a shape layer (which is handled by ks)
                const isShapeOperator = ['group', 'rect', 'ellipse', 'path'].includes(parentNode.type);

                if (isShapeOperator) {
                    const isIdentity = pData.value[0] === 0 && pData.value[1] === 0 &&
                        rData.value === 0 &&
                        sData.value[0] === 100 && sData.value[1] === 100 &&
                        aData.value[0] === 0 && aData.value[1] === 0;

                    // Only apply if it's NOT an identity transform on a freshly created node
                    // OR if it has animations that we need to keep.
                    if (!isIdentity || pData.keyframes || rData.keyframes || sData.keyframes || aData.keyframes) {
                        parentNode.transform = {
                            ...parentNode.transform,
                            x: pData.value[0], y: pData.value[1], rotation: rData.value,
                            scaleX: sData.value[0] / 100, scaleY: sData.value[1] / 100,
                            anchorX: aData.value[0], anchorY: aData.value[1], scaleLink: true
                        };
                        // Carry over animations
                        if (pData.keyframes) {
                            parentNode.animations!['transform.x'] = pData.keyframes.map(k => ({ ...k, value: k.value[0] }));
                            parentNode.animations!['transform.y'] = pData.keyframes.map(k => ({ ...k, value: k.value[1] }));
                        }
                        if (sData.keyframes) {
                            parentNode.animations!['transform.scaleX'] = sData.keyframes.map(k => ({ ...k, value: k.value[0] / 100 }));
                            parentNode.animations!['transform.scaleY'] = sData.keyframes.map(k => ({ ...k, value: k.value[1] / 100 }));
                        }
                        if (rData.keyframes) {
                            parentNode.animations!['transform.rotation'] = rData.keyframes;
                        }
                    }

                    if (oData.keyframes) {
                        parentNode.animations!['style.opacity'] = oData.keyframes.map(k => ({ ...k, value: k.value / 100 }));
                    }
                    parentNode.style.opacity = oData.value / 100;
                }
            }
            else if (item.ty === 'gr') {
                const groupNode = createNode('group', item.nm || 'Group', {
                    parentId: parentNode.id,
                    inPoint: parentNode.inPoint,
                    outPoint: parentNode.outPoint,
                    style: { ...currentStyle, opacity: 1 },
                    // Inherit style animations (excluding transform opacity which is handled by tr)
                    animations: Object.fromEntries(Object.entries(currentAnimations).filter(([k]) => k.startsWith('style.') && k !== 'style.opacity')),
                    // Mark as a Lottie shape group (gr item) so the flattener never collapses it.
                    // AE/LottieFiles always shows this level: Layer → Group → Path/Shape.
                    props: { isShapeGroup: true }
                });
                parentNode.children.push(groupNode.id);
                (item as any)._creatorId = groupNode.id;
                trackOnChild(groupNode);
                createdNodesInThisScope.push(groupNode);
                if (item.it) {
                    this.parseShapes(item.it, groupNode, (gChild) => trackOnChild(gChild), {
                        style: { ...currentStyle, opacity: 1 },
                        // Isolate inherited transform animations. 
                        // Exclude style.opacity because it comes from the group's transform and is inherited natively by the renderer.
                        animations: Object.fromEntries(Object.entries(currentAnimations).filter(([k]) => k.startsWith('style.') && k !== 'style.opacity'))
                    }, liftingTarget);
                }
            }
            else if (item.ty === 'rc') {
                const sProp = this.getPropertyData(item.s, [100, 100]);
                const pProp = this.getPropertyData(item.p, [0, 0]);
                const rProp = this.getPropertyData(item.r, 0);
                const w = sProp.value[0], h = sProp.value[1];

                const rectAnims = { ...currentAnimations };
                if (sProp.keyframes) {
                    rectAnims['props.width'] = sProp.keyframes.map(kf => ({ ...kf, time: kf.time, value: kf.value[0] }));
                    rectAnims['props.height'] = sProp.keyframes.map(kf => ({ ...kf, time: kf.time, value: kf.value[1] }));
                    rectAnims['transform.anchorX'] = sProp.keyframes.map(kf => ({ ...kf, time: kf.time, value: kf.value[0] / 2 }));
                    rectAnims['transform.anchorY'] = sProp.keyframes.map(kf => ({ ...kf, time: kf.time, value: kf.value[1] / 2 }));
                }
                if (pProp.keyframes) {
                    rectAnims['transform.x'] = pProp.keyframes.map(kf => ({ ...kf, time: kf.time, value: kf.value[0] }));
                    rectAnims['transform.y'] = pProp.keyframes.map(kf => ({ ...kf, time: kf.time, value: kf.value[1] }));
                }
                if (rProp.keyframes) {
                    rectAnims['props.roundness'] = rProp.keyframes.map(kf => ({ ...kf, time: kf.time }));
                }

                const rect = createNode('rect', item.nm || 'Rectangle', {
                    parentId: parentNode.id,
                    transform: { ...createDefaultTransform(), x: pProp.value[0], y: pProp.value[1], anchorX: w / 2, anchorY: h / 2 },
                    props: { width: w, height: h, roundness: rProp.value },
                    style: { ...currentStyle },
                    animations: rectAnims,
                    inPoint: parentNode.inPoint,
                    outPoint: parentNode.outPoint
                });

                this.realignNodeGradients(rect, rect.transform.x - rect.transform.anchorX, rect.transform.y - rect.transform.anchorY);
                parentNode.children.push(rect.id);
                (item as any)._creatorId = rect.id;
                createdNodesInThisScope.push(rect);
                trackOnChild(rect);

                // Lift shape properties to parent and root lifting target so they show in the Inspector
                const shapeProps = { width: w, height: h, roundness: rProp.value };
                const filteredAnims = Object.fromEntries(Object.entries(rectAnims).filter(([k]) => k.startsWith('props.')));

                // Lift to immediate parent (the Shape Group)
                parentNode.props = { ...parentNode.props, ...shapeProps };
                parentNode.animations = { ...parentNode.animations, ...filteredAnims };

                // Bubble up to root lifting target (the Layer)
                if (liftingTarget && liftingTarget.id !== parentNode.id) {
                    liftingTarget.props = { ...liftingTarget.props, ...shapeProps };
                    liftingTarget.animations = { ...liftingTarget.animations, ...filteredAnims };
                }
            }
            else if (item.ty === 'el') {
                const sProp = this.getPropertyData(item.s, [100, 100]);
                const pProp = this.getPropertyData(item.p, [0, 0]);
                const rw = sProp.value[0] / 2, rh = sProp.value[1] / 2;

                const ellAnims = { ...currentAnimations };
                if (sProp.keyframes) {
                    ellAnims['props.radiusX'] = sProp.keyframes.map(kf => ({ ...kf, time: kf.time, value: kf.value[0] / 2 }));
                    ellAnims['props.radiusY'] = sProp.keyframes.map(kf => ({ ...kf, time: kf.time, value: kf.value[1] / 2 }));
                    ellAnims['transform.anchorX'] = sProp.keyframes.map(kf => ({ ...kf, time: kf.time, value: kf.value[0] / 2 }));
                    ellAnims['transform.anchorY'] = sProp.keyframes.map(kf => ({ ...kf, time: kf.time, value: kf.value[1] / 2 }));
                }
                if (pProp.keyframes) {
                    ellAnims['transform.x'] = pProp.keyframes.map(kf => ({ ...kf, time: kf.time, value: kf.value[0] }));
                    ellAnims['transform.y'] = pProp.keyframes.map(kf => ({ ...kf, time: kf.time, value: kf.value[1] }));
                }

                const ellipse = createNode('ellipse', item.nm || 'Ellipse', {
                    parentId: parentNode.id,
                    transform: { ...createDefaultTransform(), x: pProp.value[0], y: pProp.value[1], anchorX: rw, anchorY: rh },
                    props: { radiusX: rw, radiusY: rh },
                    style: { ...currentStyle },
                    animations: ellAnims,
                    inPoint: parentNode.inPoint,
                    outPoint: parentNode.outPoint
                });

                this.realignNodeGradients(ellipse, ellipse.transform.x - ellipse.transform.anchorX, ellipse.transform.y - ellipse.transform.anchorY);
                parentNode.children.push(ellipse.id);
                (item as any)._creatorId = ellipse.id;
                createdNodesInThisScope.push(ellipse);
                trackOnChild(ellipse);

                // Lift shape properties to parent and root lifting target so they show in the Inspector
                const shapeProps = { radiusX: rw, radiusY: rh };
                const filteredAnims = Object.fromEntries(Object.entries(ellAnims).filter(([k]) => k.startsWith('props.')));

                // Lift to immediate parent (the Shape Group)
                parentNode.props = { ...parentNode.props, ...shapeProps };
                parentNode.animations = { ...parentNode.animations, ...filteredAnims };

                // Bubble up to root lifting target (the Layer)
                if (liftingTarget && liftingTarget.id !== parentNode.id) {
                    liftingTarget.props = { ...liftingTarget.props, ...shapeProps };
                    liftingTarget.animations = { ...liftingTarget.animations, ...filteredAnims };
                }
            }
            else if (item.ty === 'sh') {
                const ksProp = this.getPropertyData(item.ks, {} as any);

                // Helper: convert Lottie shape data {v, i, o, c} to VectorPoint[]
                const lottieShapeToPoints = (shape: any) => {
                    if (!shape || !shape.v) return [];
                    return shape.v.map((v: any, idx: number) => ({
                        x: v[0], y: v[1],
                        inX: shape.i?.[idx]?.[0] || 0, inY: shape.i?.[idx]?.[1] || 0,
                        outX: shape.o?.[idx]?.[0] || 0, outY: shape.o?.[idx]?.[1] || 0
                    }));
                };

                // Lottie animated paths wrap shape data in an array: s = [{v, i, o, c}]
                // Static paths use the shape object directly: k = {v, i, o, c}
                let pathView = ksProp.value || {};
                if (Array.isArray(pathView) && pathView.length > 0 && pathView[0]?.v) {
                    pathView = pathView[0]; // Unwrap the array
                }

                const pathAnims: Record<string, any> = { ...currentAnimations };

                // Convert animated path keyframes to VectorPoint[] format
                if (ksProp.keyframes && ksProp.keyframes.length > 0) {
                    pathAnims['props.points'] = ksProp.keyframes.map(kf => {
                        // Each keyframe value is either [{v, i, o, c}] or {v, i, o, c}
                        let shapeData = kf.value;
                        if (Array.isArray(shapeData) && shapeData.length > 0 && shapeData[0]?.v) {
                            shapeData = shapeData[0];
                        }
                        return { ...kf, time: kf.time, value: lottieShapeToPoints(shapeData) };
                    });
                }

                const path = createNode('path', item.nm || 'Path', {
                    parentId: parentNode.id, transform: createDefaultTransform(),
                    props: {
                        points: lottieShapeToPoints(pathView),
                        closed: !!pathView.c,
                        roundness: 0
                    },
                    style: { ...currentStyle },
                    animations: pathAnims,
                    inPoint: parentNode.inPoint,
                    outPoint: parentNode.outPoint
                });
                parentNode.children.push(path.id);
                (item as any)._creatorId = path.id;
                createdNodesInThisScope.push(path);
                trackOnChild(path);
            }
            else if (item.ty === 'sr') {
                // Polystar (Star / Polygon) — convert to path points
                const srItem = item as any;
                const numPoints = this.getPropertyData(srItem.pt, 5).value;
                const posData = this.getPropertyData(srItem.p, [0, 0]);
                const rotData = this.getPropertyData(srItem.r, 0);
                const outerR = this.getPropertyData(srItem.or, 100).value;
                const outerRound = this.getPropertyData(srItem.os, 0).value;
                const isStar = srItem.sy === 1;
                const innerR = isStar ? this.getPropertyData(srItem.ir, 50).value : outerR;
                const innerRound = isStar ? this.getPropertyData(srItem.is, 0).value : 0;
                const direction = srItem.d === 3 ? -1 : 1; // 3 = counter-clockwise

                const cx = posData.value[0] || 0;
                const cy = posData.value[1] || 0;
                const rotDeg = rotData.value || 0;
                const rotRad = (rotDeg - 90) * Math.PI / 180; // Lottie starts from top

                const points: Array<{ x: number, y: number, inX: number, inY: number, outX: number, outY: number }> = [];

                if (isStar) {
                    // Star: alternate outer (tip) and inner (valley) vertices
                    const totalVerts = numPoints * 2;
                    const angleStep = (Math.PI * 2) / totalVerts * direction;

                    for (let i = 0; i < totalVerts; i++) {
                        const angle = rotRad + i * angleStep;
                        const isOuter = i % 2 === 0;
                        const radius = isOuter ? outerR : innerR;
                        const roundness = isOuter ? outerRound : innerRound;

                        const x = cx + radius * Math.cos(angle);
                        const y = cy + radius * Math.sin(angle);

                        // Roundness creates tangent handles perpendicular to the radius
                        let inX = 0, inY = 0, outX = 0, outY = 0;
                        if (roundness !== 0) {
                            const tangentLen = radius * roundness * Math.PI / (totalVerts * 50);
                            const perpAngle = angle + Math.PI / 2 * direction;
                            outX = tangentLen * Math.cos(perpAngle);
                            outY = tangentLen * Math.sin(perpAngle);
                            inX = -outX;
                            inY = -outY;
                        }

                        points.push({ x, y, inX, inY, outX, outY });
                    }
                } else {
                    // Polygon: only outer radius vertices
                    const angleStep = (Math.PI * 2) / numPoints * direction;

                    for (let i = 0; i < numPoints; i++) {
                        const angle = rotRad + i * angleStep;
                        const x = cx + outerR * Math.cos(angle);
                        const y = cy + outerR * Math.sin(angle);

                        let inX = 0, inY = 0, outX = 0, outY = 0;
                        if (outerRound !== 0) {
                            const tangentLen = outerR * outerRound * Math.PI / (numPoints * 50);
                            const perpAngle = angle + Math.PI / 2 * direction;
                            outX = tangentLen * Math.cos(perpAngle);
                            outY = tangentLen * Math.sin(perpAngle);
                            inX = -outX;
                            inY = -outY;
                        }

                        points.push({ x, y, inX, inY, outX, outY });
                    }
                }

                const srAnims = { ...currentAnimations };
                // Add animations for position, rotation, outerR, innerR, etc. if they exist
                if (posData.keyframes) {
                    srAnims['transform.x'] = posData.keyframes.map(kf => ({ ...kf, time: kf.time, value: kf.value[0] }));
                    srAnims['transform.y'] = posData.keyframes.map(kf => ({ ...kf, time: kf.time, value: kf.value[1] }));
                }
                if (rotData.keyframes) {
                    srAnims['transform.rotation'] = rotData.keyframes.map(kf => ({ ...kf, time: kf.time }));
                }
                // Note: Animating points directly for polystar is complex due to dynamic point generation.
                // For now, we'll animate the transform properties and static shape properties.

                const polypath = createNode('path', srItem.nm || 'Polystar', {
                    parentId: parentNode.id,
                    transform: { ...createDefaultTransform(), x: cx, y: cy },
                    props: { points, closed: true, roundness: 0 },
                    style: { ...currentStyle },
                    animations: srAnims,
                    inPoint: parentNode.inPoint,
                    outPoint: parentNode.outPoint
                });
                parentNode.children.push(polypath.id);
                (item as any)._creatorId = polypath.id;
                createdNodesInThisScope.push(polypath);
                trackOnChild(polypath);
            }
            else if (item.ty === 'rd') {
                // Rounded corners operator - apply to the last created node in this scope
                const rProp = this.getPropertyData((item as any).r, 0);
                const lastNode = createdNodesInThisScope[createdNodesInThisScope.length - 1];
                if (lastNode) {
                    if (lastNode.type === 'group') {
                        // Apply roundness to all shape children inside the group
                        const applyRdToChildren = (node: SceneNode) => {
                            for (const cid of node.children) {
                                const child = allNodesInScope.get(cid);
                                if (!child) continue;
                                if (child.type === 'group') {
                                    applyRdToChildren(child);
                                } else {
                                    child.props.roundness = rProp.value;
                                    if (rProp.keyframes) {
                                        child.animations!['props.roundness'] = rProp.keyframes.map(kf => ({ ...kf, time: kf.time }));
                                    }
                                }
                            }
                        };
                        applyRdToChildren(lastNode);
                    } else {
                        lastNode.props.roundness = rProp.value;
                        if (rProp.keyframes) {
                            lastNode.animations!['props.roundness'] = rProp.keyframes.map(kf => ({ ...kf, time: kf.time }));
                        }
                    }
                }
            }
            else if (item.ty === 'tm') {
                const sData = this.getPropertyData((item as any).s, 0);
                const eData = this.getPropertyData((item as any).e, 100);
                const oData = this.getPropertyData((item as any).o, 0);

                currentStyle.trimStart = sData.value / 100;
                currentStyle.trimEnd = eData.value / 100;
                currentStyle.trimOffset = oData.value;

                if (sData.keyframes) {
                    currentAnimations['style.trimStart'] = sData.keyframes.map(kf => ({ ...kf, time: kf.time, value: kf.value / 100 }));
                }
                if (eData.keyframes) {
                    currentAnimations['style.trimEnd'] = eData.keyframes.map(kf => ({ ...kf, time: kf.time, value: kf.value / 100 }));
                }
                if (oData.keyframes) {
                    currentAnimations['style.trimOffset'] = oData.keyframes.map(kf => ({ ...kf, time: kf.time }));
                }

                // Determine where trim animations belong based on shape count in scope.
                // Single leaf shape → animations on the shape (LottieFiles behavior: trim is per-shape).
                // Multiple shapes (or 0 — tm placed before shape items) → animations on the parent group
                // so the group-level trim operator applies to the compound path.
                const leafTypes = new Set(['rect', 'ellipse', 'path', 'polystar']);
                const directLeafShapes = createdNodesInThisScope.filter(n => leafTypes.has(n.type));
                const isSingleShapeTrim = directLeafShapes.length === 1;

                allNodesInScope.forEach(n => {
                    n.style.trimStart = currentStyle.trimStart;
                    n.style.trimEnd = currentStyle.trimEnd;
                    n.style.trimOffset = currentStyle.trimOffset;
                    if (isSingleShapeTrim) {
                        // Trim animations live on the single shape, matching LottieFiles display
                        n.animations = { ...n.animations, ...currentAnimations };
                    }
                    // Multiple shapes: individual shapes get static style only; animations go on the group
                });

                [parentNode, liftingTarget].forEach(target => {
                    if (target) {
                        target.style.trimStart = currentStyle.trimStart;
                        target.style.trimEnd = currentStyle.trimEnd;
                        target.style.trimOffset = currentStyle.trimOffset;
                        if (!isSingleShapeTrim) {
                            // Multiple shapes: trim is a group-level operation
                            target.animations = { ...target.animations, ...currentAnimations };
                        }
                        // Single shape: don't lift trim animations to parent group
                    }
                });
            }
            else if (item.ty === 'mm') {
                // Merge Paths operator
                const mm = (item as any).mm;
                // Mode 1: Normal, 2: Add, 3: Subtract, 4: Intersect, 5: Exclude
                let mode: 'union' | 'subtract' | 'intersect' | 'exclude' | 'none' = 'none';
                if (mm === 1 || mm === 2) mode = 'union';
                else if (mm === 3) mode = 'subtract';
                else if (mm === 4) mode = 'intersect';
                else if (mm === 5) mode = 'exclude';

                if (mode !== 'none') {
                    parentNode.mergeMode = mode;
                    // Tag group as a boolean operation group for the renderer
                    parentNode.name = `${parentNode.name} (${mode})`;
                }
            }
        }

        // --- Phase 4 Step 3: Boolean Style Lifting ---
        // If this is a merge mode group, we move the styles to the group itself
        // so the renderer can apply them to the combined binary result.
        if (parentNode.mergeMode && parentNode.mergeMode !== 'none') {
            const childrenNodes = createdNodesInThisScope.filter(n => parentNode.children.includes(n.id));
            const styleLeader = childrenNodes.find(n => n.style.fillVisible || (n.style.strokeWidth && n.style.strokeWidth > 0));

            if (styleLeader) {
                // Lift style to parent group
                parentNode.style = {
                    ...parentNode.style,
                    fill: styleLeader.style.fill,
                    fillType: styleLeader.style.fillType,
                    fillGradient: styleLeader.style.fillGradient ? JSON.parse(JSON.stringify(styleLeader.style.fillGradient)) : undefined,
                    fillOpacity: styleLeader.style.fillOpacity,
                    fillVisible: styleLeader.style.fillVisible,
                    fillRule: styleLeader.style.fillRule,
                    stroke: styleLeader.style.stroke,
                    strokeWidth: styleLeader.style.strokeWidth,
                    strokeOpacity: styleLeader.style.strokeOpacity,
                    strokeGradient: styleLeader.style.strokeGradient ? JSON.parse(JSON.stringify(styleLeader.style.strokeGradient)) : undefined,
                    strokeLinecap: styleLeader.style.strokeLinecap,
                    strokeLinejoin: styleLeader.style.strokeLinejoin,
                };

                // ADJUST GRADIENT POINTS BACK TO PARENT SPACE
                // styleLeader was shifted by its own transform, but the parentGroup
                // needs those points relative to its identity origin (0,0).
                const shiftX = (styleLeader.transform.x || 0) - (styleLeader.transform.anchorX || 0);
                const shiftY = (styleLeader.transform.y || 0) - (styleLeader.transform.anchorY || 0);
                if (shiftX !== 0 || shiftY !== 0) {
                    LottieParser.realignNodeGradients(parentNode, -shiftX, -shiftY);
                }

                // Clear from children to prevent double-draw or internal overlap lines
                childrenNodes.forEach(n => {
                    n.style.fillVisible = false;
                    n.style.strokeWidth = 0;
                });
            }
        }

        // Lottie shapes array is ordered front-to-back (first = topmost in layer panel),
        // but Canvas draws first items at the bottom. Reverse to get correct visual stacking.
        parentNode.children.reverse();

        // Snapshot original styles for all nodes in this scope so the exporter can detect edits
        createdNodesInThisScope.forEach(n => {
            n._originalParsedFill = n.style.fill;
            n._originalParsedStroke = n.style.stroke;
            n._originalParsedStrokeWidth = n.style.strokeWidth;
            n._originalParsedOpacity = n.style.opacity;
        });
    }

    private static realignNodeGradients(node: SceneNode, originX: number, originY: number) {
        ['fillGradient', 'strokeGradient'].forEach(key => {
            const grad = (node.style as any)[key];
            if (grad) {
                grad.start.x -= originX; grad.start.y -= originY;
                grad.end.x -= originX; grad.end.y -= originY;
            }
            const animKey = `style.${key}`;
            if (node.animations?.[animKey]) {
                node.animations[animKey]!.forEach(kf => {
                    if (kf.value && kf.value.start) {
                        kf.value.start.x -= originX; kf.value.start.y -= originY;
                        kf.value.end.x -= originX; kf.value.end.y -= originY;
                    }
                });
            }
        });
    }

    private static parseGradientData(data: number[], p: number, type: 'linear' | 'radial', s: number[], e: number[]): any {
        if (!data || data.length === 0) return { type, start: { x: s[0], y: s[1] }, end: { x: e[0], y: e[1] }, stops: [] };

        const stops: any[] = [];
        // 'p' in Lottie (Gradient Fill/Stroke) is the count of color stops.
        // The data array contains [offset, r, g, b] * p followed by [offset, alpha] * q.
        const numColorStops = p || Math.floor(data.length / 4);
        const colorDataLength = numColorStops * 4;
        const alphaDataLength = data.length - colorDataLength;
        const numAlphaStops = Math.floor(alphaDataLength / 2);

        const colorStops: Array<{ offset: number, r: number, g: number, b: number }> = [];
        for (let i = 0; i < numColorStops; i++) {
            colorStops.push({
                offset: data[i * 4],
                r: data[i * 4 + 1],
                g: data[i * 4 + 2],
                b: data[i * 4 + 3]
            });
        }

        const alphaStops: Array<{ offset: number, alpha: number }> = [];
        for (let i = 0; i < numAlphaStops; i++) {
            alphaStops.push({
                offset: data[colorDataLength + i * 2],
                alpha: data[colorDataLength + i * 2 + 1]
            });
        }

        // Merge stops. We use color stop offsets as the primary keys.
        // For each color stop, find its interpolated alpha value from the alpha stop list.
        for (const cs of colorStops) {
            let alpha = 1;
            if (alphaStops.length > 0) {
                // Find alpha at this specific offset
                const exact = alphaStops.find(a => Math.abs(a.offset - cs.offset) < 0.001);
                if (exact) {
                    alpha = exact.alpha;
                } else {
                    // Interpolate
                    const before = [...alphaStops].reverse().find(a => a.offset < cs.offset);
                    const after = alphaStops.find(a => a.offset > cs.offset);
                    if (!before && after) alpha = after.alpha;
                    else if (before && !after) alpha = before.alpha;
                    else if (before && after) {
                        const t = (cs.offset - before.offset) / (after.offset - before.offset);
                        alpha = before.alpha + (after.alpha - before.alpha) * t;
                    }
                }
            }
            stops.push({
                offset: cs.offset,
                color: this.lottieColorToHex([cs.r, cs.g, cs.b]),
                opacity: alpha
            });
        }

        // Also add alpha stops if they occur at offsets not covered by color stops
        for (const as of alphaStops) {
            const hasColor = colorStops.some(c => Math.abs(c.offset - as.offset) < 0.001);
            if (!hasColor) {
                // Find color at this offset
                const before = [...colorStops].reverse().find(c => c.offset < as.offset);
                const after = colorStops.find(c => c.offset > as.offset);
                let color: number[] = [0, 0, 0];
                if (!before && after) color = [after.r, after.g, after.b];
                else if (before && !after) color = [before.r, before.g, before.b];
                else if (before && after) {
                    const t = (as.offset - before.offset) / (after.offset - before.offset);
                    color = [
                        before.r + (after.r - before.r) * t,
                        before.g + (after.g - before.g) * t,
                        before.b + (after.b - before.b) * t
                    ];
                }
                stops.push({
                    offset: as.offset,
                    color: this.lottieColorToHex(color),
                    opacity: as.alpha
                });
            }
        }

        stops.sort((a, b) => a.offset - b.offset);
        return { type, start: { x: s[0], y: s[1] }, end: { x: e[0], y: e[1] }, stops };
    }

    private static safeNum(v: any, fallback: number = 0): number {
        const n = parseFloat(v);
        return isNaN(n) ? fallback : n;
    }

    // Phase 3 helpers — import fidelity analysis

    /** Returns shape type strings that are in the raw shapes but not fully supported by the authoring model. */
    private static findUnsupportedShapeTypes(shapes: any[]): string[] {
        const unsupported = new Set<string>();
        const SUPPORTED = new Set(['rc', 'el', 'sh', 'sr', 'gr', 'fl', 'st', 'gf', 'gs', 'tm', 'rd', 'tr', 'mm', 'rp', 'op']);
        const LABELS: Record<string, string> = {
            'zz': 'zigzag', 'pb': 'pucker-bloat', 'tw': 'twist',
            'ms': 'offset-paths', 'bd': 'blend', 'no': 'no-style',
        };

        const scan = (items: any[]) => {
            if (!Array.isArray(items)) return;
            for (const item of items) {
                if (!item?.ty) continue;
                if (!SUPPORTED.has(item.ty)) {
                    unsupported.add(LABELS[item.ty] ?? item.ty);
                }
                if (item.ty === 'gr' && Array.isArray(item.it)) scan(item.it);
            }
        };
        scan(shapes);
        return Array.from(unsupported);
    }

    /** Returns true if the layer contains AE expressions on any property. */
    private static hasExpressions(layer: any): boolean {
        const check = (obj: any, depth = 0): boolean => {
            if (!obj || typeof obj !== 'object' || depth > 6) return false;
            if (obj.x && typeof obj.x === 'string') return true; // expression string
            if (obj.xi && typeof obj.xi === 'string') return true;
            return Object.values(obj).some(v => check(v, depth + 1));
        };
        return check(layer.ks) || (Array.isArray(layer.shapes) && layer.shapes.some((s: any) => check(s)));
    }
}
