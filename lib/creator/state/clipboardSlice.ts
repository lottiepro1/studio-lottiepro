import { StateCreator } from 'zustand';
import { CreatorStore } from './types';
import { SceneNode } from './sceneSlice';

export interface ClipboardSlice {
    clipboard: SceneNode[];
    keyframeClipboard: {
        propertyPath: string;
        offsetTime: number;
        value: any;
        easing?: any;
        bezier?: any;
    }[];
    copySelection: () => void;
    pasteSelection: () => void;
    duplicateSelection: () => void;
    copyKeyframes: () => void;
    pasteKeyframes: () => void;
}

// Returns a unique name that doesn't collide with any existing node name in the map.
// "Rectangle" → "Rectangle 2" → "Rectangle 3", etc.
function uniqueName(baseName: string, nodes: Map<string, SceneNode>): string {
    const existingNames = new Set(Array.from(nodes.values()).map(n => n.name).filter(Boolean));
    if (!existingNames.has(baseName)) return baseName;
    let suffix = 2;
    while (existingNames.has(`${baseName} ${suffix}`)) suffix++;
    return `${baseName} ${suffix}`;
}

export const createClipboardSlice: StateCreator<CreatorStore, [["zustand/immer", never]], [], ClipboardSlice> = (set, get) => ({
    clipboard: [],
    keyframeClipboard: [],

    copySelection: () => {
        const state = get();
        const selectedNodes = state.selectedIds
            .map(id => state.nodes.get(id))
            .filter((n): n is SceneNode => !!n);

        if (selectedNodes.length === 0) return;

        // Collect deep trees for each selected node
        const clipboardData: SceneNode[] = [];

        const collectDeep = (node: SceneNode) => {
            clipboardData.push(JSON.parse(JSON.stringify(node))); // Deep copy
            if (node.children) {
                node.children.forEach(childId => {
                    const child = state.nodes.get(childId);
                    if (child) collectDeep(child);
                });
            }
        };

        selectedNodes.forEach(node => collectDeep(node));
        set({ clipboard: clipboardData });
    },

    pasteSelection: () => {
        const state = get();
        if (state.clipboard.length === 0) return;

        const newNodes = new Map(state.nodes);
        const idMap = new Map<string, string>();

        // 1. Generate new IDs for all nodes in clipboard
        state.clipboard.forEach(node => {
            const newId = `${node.id.split('_')[0] || node.type}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            idMap.set(node.id, newId);
        });

        // 2. Calculate bounding box of top-level items in clipboard to center them
        const topLevelNodes = state.clipboard.filter(node => !node.parentId || !idMap.has(node.parentId));

        // Simple AABB calculation for clipboard
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        topLevelNodes.forEach(node => {
            const x = node.transform.x;
            const y = node.transform.y;
            // Rough bounds
            const w = node.props?.width || node.props?.radiusX * 2 || 0;
            const h = node.props?.height || node.props?.radiusY * 2 || 0;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + w);
            maxY = Math.max(maxY, y + h);
        });

        const cbWidth = maxX - minX;
        const cbHeight = maxY - minY;
        const cbCenterX = minX + cbWidth / 2;
        const cbCenterY = minY + cbHeight / 2;

        const artboard = Array.from(state.nodes.values()).find(n => n.type === 'artboard');
        const targetX = artboard ? artboard.transform.x + artboard.props.width / 2 : 0;
        const targetY = artboard ? artboard.transform.y + artboard.props.height / 2 : 0;

        const offsetX = targetX - cbCenterX;
        const offsetY = targetY - cbCenterY;

        const topLevelPastedIds: string[] = [];

        // 3. Process and add nodes
        state.clipboard.forEach(originalNode => {
            const node = JSON.parse(JSON.stringify(originalNode)) as SceneNode;
            const newId = idMap.get(node.id)!;

            node.id = newId;
            node.parentId = node.parentId ? (idMap.get(node.parentId) || node.parentId) : null;
            node.children = node.children.map(childId => idMap.get(childId) || childId);

            const isTopLevelInSelection = !originalNode.parentId || !idMap.has(originalNode.parentId);

            if (isTopLevelInSelection) {
                if (artboard) {
                    node.parentId = artboard.id;
                    node.transform.x += offsetX;
                    node.transform.y += offsetY;
                    // Ensure unique name so ThorVG can distinguish pasted layers from originals.
                    if (node.name) node.name = uniqueName(node.name, newNodes);

                    const updatedArtboard = newNodes.get(artboard.id);
                    if (updatedArtboard) {
                        newNodes.set(artboard.id, {
                            ...updatedArtboard,
                            children: [...updatedArtboard.children, newId]
                        });
                    }
                }
                topLevelPastedIds.push(newId);
            }

            newNodes.set(newId, node);
        });

        get().pushToHistory('Paste');
        set({
            nodes: newNodes,
            selectedIds: topLevelPastedIds,
            updateCounter: state.updateCounter + 1,
            structureChangeCounter: state.structureChangeCounter + 1,
        });
    },

    duplicateSelection: () => {
        const state = get();
        if (state.selectedIds.length === 0) return;

        const newNodes = new Map(state.nodes);
        const topLevelDuplicatedIds: string[] = [];

        // Group selection by original order to maintain stacking
        const selectedIds = [...state.selectedIds];

        selectedIds.forEach(originalId => {
            const originalNode = state.nodes.get(originalId);
            if (!originalNode || originalNode.type === 'artboard') return;

            const idMap = new Map<string, string>();

            // Helper to collect and generate IDs for the whole subtree
            const prepareSubtree = (id: string) => {
                const n = state.nodes.get(id);
                if (!n) return;
                const newId = `${n.type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                idMap.set(id, newId);
                n.children.forEach(prepareSubtree);
            };

            prepareSubtree(originalId);

            // Helper to clone nodes with new IDs
            const cloneSubtree = (oldId: string, newParentId: string | null) => {
                const oldNode = state.nodes.get(oldId);
                if (!oldNode) return;

                const newId = idMap.get(oldId)!;
                const newNode: SceneNode = JSON.parse(JSON.stringify(oldNode));

                newNode.id = newId;
                newNode.parentId = newParentId;
                newNode.children = oldNode.children.map(cid => idMap.get(cid)!);

                newNodes.set(newId, newNode);

                oldNode.children.forEach(cid => cloneSubtree(cid, newId));
                return newId;
            };

            const duplicatedId = cloneSubtree(originalId, originalNode.parentId);
            if (duplicatedId) {
                // Give the duplicate a unique name so ThorVG can distinguish it from the original.
                // Duplicate layer names cause ThorVG rendering artifacts (broken clipping, wrong bbox).
                const dupNode = newNodes.get(duplicatedId);
                if (dupNode && dupNode.name) {
                    newNodes.set(duplicatedId, { ...dupNode, name: uniqueName(dupNode.name, newNodes) });
                }
                topLevelDuplicatedIds.push(duplicatedId);

                // Add to parent's children list right after the original
                if (originalNode.parentId) {
                    const parent = newNodes.get(originalNode.parentId);
                    if (parent) {
                        const originalIndex = parent.children.indexOf(originalId);
                        const nextChildren = [...parent.children];
                        nextChildren.splice(originalIndex + 1, 0, duplicatedId);
                        newNodes.set(originalNode.parentId, {
                            ...parent,
                            children: nextChildren
                        });
                    }
                }
            }
        });

        get().pushToHistory('Duplicate');
        set({
            nodes: newNodes,
            selectedIds: topLevelDuplicatedIds,
            updateCounter: state.updateCounter + 1,
            structureChangeCounter: state.structureChangeCounter + 1,
        });
    },

    copyKeyframes: () => {
        const state = get();
        if (state.selectedKeyframeIds.length === 0) return;

        const items: any[] = [];
        let minTime = Infinity;

        state.selectedKeyframeIds.forEach(id => {
            const [nodeId, propertyPath, kfId] = id.split(':');
            const node = state.nodes.get(nodeId);
            const kf = node?.animations?.[propertyPath]?.find((k: any) => k.id === kfId);
            if (kf) {
                minTime = Math.min(minTime, kf.time);
                items.push({
                    propertyPath,
                    time: kf.time,
                    value: JSON.parse(JSON.stringify(kf.value)),
                    easing: kf.easing,
                    bezier: kf.bezier ? [...kf.bezier] : undefined
                });
            }
        });

        const keyframeClipboard = items.map(item => ({
            ...item,
            offsetTime: item.time - minTime
        }));

        set({ keyframeClipboard });
    },

    pasteKeyframes: () => {
        const state = get();
        if (state.keyframeClipboard.length === 0) return;

        // Paste to ALL selected nodes. If no nodes are selected, maybe just the first one?
        // Standard AE behavior: paste to selected layers.
        const targetNodeIds = state.selectedIds.length > 0 ? state.selectedIds : [];
        if (targetNodeIds.length === 0) return;

        get().pushToHistory('Paste Keyframes');

        targetNodeIds.forEach(nodeId => {
            state.keyframeClipboard.forEach(item => {
                const newTime = state.currentTime + item.offsetTime;
                state.addKeyframe(nodeId, item.propertyPath, newTime, item.value);

                // AddKeyframe only adds linear by default in the current implementation? 
                // Let's check updateKeyframe to apply easing too.
                const node = get().nodes.get(nodeId);
                const kf = node?.animations?.[item.propertyPath]?.find((k: any) => k.time === newTime);
                if (kf) {
                    state.updateKeyframe(nodeId, item.propertyPath, kf.id, {
                        easing: item.easing,
                        bezier: item.bezier
                    });
                }
            });
        });
    }
});
