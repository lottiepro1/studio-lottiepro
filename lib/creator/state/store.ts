import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';

enableMapSet();
import { createToolSlice, ToolSlice } from './toolSlice';
import { createSceneSlice, SceneSlice } from './sceneSlice';
import { createSelectionSlice, SelectionSlice } from './selectionSlice';
import { createAnimationSlice, AnimationSlice } from './animationSlice';
import { SceneNode, Transform } from './sceneSlice';
import { getWorldMatrix, getCollectiveBoundingBox, getBoundingBox, decomposeMatrix, createTransformMatrix, getGroupLocalBounds } from '../core/Matrix';
import { createGroupNode } from '../core/SceneNode';
import { createHistorySlice, HistorySlice } from './historySlice';
import { createClipboardSlice, ClipboardSlice } from './clipboardSlice';
import { createStateMachineSlice } from './stateMachineSlice';
import { CreatorStore } from './types';

// Create the main store
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const useCreatorStore = create<CreatorStore>()(immer((set, get, api) => ({
  ...createToolSlice(set as any, get as any, api as any),
  ...createSceneSlice(set as any, get as any, api as any),
  ...createSelectionSlice(set as any, get as any, api as any),
  ...createAnimationSlice(set as any, get as any, api as any),
  ...createHistorySlice(set as any, get as any, api as any),
  ...createClipboardSlice(set as any, get as any, api as any),
  ...createStateMachineSlice(set as any, get as any, api as any),

  // Helper function to add node and update artboard atomically
  addNodeToArtboard: (node: SceneNode) => {
    const state = get();
    const activeArtboardId = state.activeArtboardId;
    const artboard = activeArtboardId ? state.nodes.get(activeArtboardId) : Array.from(state.nodes.values()).find(n => n.type === 'artboard');

    if (artboard) {
      node.parentId = artboard.id;
      // Default to full duration if not specified
      if (node.inPoint === undefined) node.inPoint = 0;
      if (node.outPoint === undefined) node.outPoint = state.duration || 300;

      // Create new nodes map with the new node
      const newNodes = new Map(state.nodes);
      newNodes.set(node.id, node);

      // Update artboard with new child
      const updatedArtboard = {
        ...artboard,
        children: [...artboard.children, node.id]
      };
      newNodes.set(artboard.id, updatedArtboard);

      get().pushToHistory(`Add ${node.name}`);

      // Set both at once
      set({
        nodes: newNodes,
        updateCounter: state.updateCounter + 1,
        structureChangeCounter: state.structureChangeCounter + 1,
      });

    }
  },

  groupNodes: (nodeIds: string[]) => {
    if (nodeIds.length < 1) return;
    const state = get();
    const nodes = state.nodes;

    // 1. Calculate AABB in absolute scene space
    const bounds = getCollectiveBoundingBox(nodeIds, nodes);
    if (isNaN(bounds.x) || isNaN(bounds.y) || bounds.width <= 0 || bounds.height <= 0) {
      console.warn('❌ Cannot group zero-sized or invalid selection');
      return;
    }

    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    // 2. Identify common parent and sort by z-index
    const firstNodeId = nodeIds[0];
    const firstNode = nodes.get(firstNodeId);
    const parentId = firstNode?.parentId || null;
    const parent = parentId ? nodes.get(parentId) : null;

    if (parent) {
      // Sort a copy to preserve relative z-order (nodeIds may be a frozen Zustand array)
      nodeIds = [...nodeIds].sort((a, b) => parent.children.indexOf(a) - parent.children.indexOf(b));
    }

    // 3. Create Group Node
    const group = createGroupNode();
    group.parentId = parentId;

    // Map bounds to parent's local space
    const parentWorldMatrix = parentId ? getWorldMatrix(parentId, nodes) : new DOMMatrix();
    const localTopLeft = new DOMPoint(bounds.x, bounds.y).matrixTransform(parentWorldMatrix.inverse());
    const localCenter = new DOMPoint(centerX, centerY).matrixTransform(parentWorldMatrix.inverse());

    group.transform.x = localCenter.x;
    group.transform.y = localCenter.y;
    group.transform.anchorX = localCenter.x - localTopLeft.x;
    group.transform.anchorY = localCenter.y - localTopLeft.y;
    group.props = { width: bounds.width, height: bounds.height };

    const newNodes = new Map(nodes);
    newNodes.set(group.id, group);

    // 4. Update children
    // The group's world matrix is now fixed. We map children into it.
    const groupWorldMatrix = parentWorldMatrix.multiply(createTransformMatrix(group.transform, nodes));
    const invGroupMatrix = groupWorldMatrix.inverse();

    group.children = [];
    for (const id of nodeIds) {
      const child = nodes.get(id);
      if (!child) continue;

      const childWorldMatrix = getWorldMatrix(id, nodes);
      const newLocalMatrix = invGroupMatrix.multiply(childWorldMatrix);
      const decomp = decomposeMatrix(newLocalMatrix, { x: child.transform.anchorX, y: child.transform.anchorY });

      const updatedChild = {
        ...child,
        parentId: group.id,
        transform: {
          ...child.transform,
          x: Number.isFinite(decomp.x) ? decomp.x : child.transform.x,
          y: Number.isFinite(decomp.y) ? decomp.y : child.transform.y,
          rotation: Number.isFinite(decomp.rotation) ? decomp.rotation : child.transform.rotation,
          scaleX: Number.isFinite(decomp.scaleX) ? decomp.scaleX : child.transform.scaleX,
          scaleY: Number.isFinite(decomp.scaleY) ? decomp.scaleY : child.transform.scaleY
        }
      };

      newNodes.set(id, updatedChild);
      group.children.push(id);

      // Remove from original parent
      if (child.parentId) {
        const op = newNodes.get(child.parentId);
        if (op) {
          newNodes.set(child.parentId, {
            ...op,
            children: op.children.filter(cid => cid !== id)
          });
        }
      }
    }

    // 5. Place group in parent's z-order (at the top-most original child index)
    if (parentId && parent) {
      const p = newNodes.get(parentId);
      if (p) {
        const originalIndices = nodeIds.map(id => parent.children.indexOf(id));
        const targetIndex = Math.max(...originalIndices);
        const filtered = p.children.filter(id => !nodeIds.includes(id));
        const nextChildren = [...filtered];
        nextChildren.splice(Math.min(targetIndex, filtered.length), 0, group.id);

        newNodes.set(parentId, { ...p, children: nextChildren });
      }
    }

    get().pushToHistory('Group Objects');

    set({
      nodes: newNodes,
      selectedIds: [group.id],
      updateCounter: state.updateCounter + 1,
      structureChangeCounter: state.structureChangeCounter + 1,
    });
  },

  ungroupNodes: (groupId: string) => {
    const state = get();
    const group = state.nodes.get(groupId);
    if (!group || group.type !== 'group') return;

    const newNodes = new Map(state.nodes);
    const parentId = group.parentId;
    const parent = parentId ? state.nodes.get(parentId) : null;
    const parentWorldMatrix = parentId ? getWorldMatrix(parentId, state.nodes) : new DOMMatrix();
    const invParentMatrix = parentWorldMatrix.inverse();

    const childrenToReparent = [...group.children];

    for (const childId of childrenToReparent) {
      const child = state.nodes.get(childId);
      if (!child) continue;

      const childWorldMatrix = getWorldMatrix(childId, state.nodes);
      const newLocalMatrix = invParentMatrix.multiply(childWorldMatrix);
      const decomp = decomposeMatrix(newLocalMatrix, { x: child.transform.anchorX, y: child.transform.anchorY });

      newNodes.set(childId, {
        ...child,
        parentId: parentId,
        transform: {
          ...child.transform,
          x: Number.isFinite(decomp.x) ? decomp.x : child.transform.x,
          y: Number.isFinite(decomp.y) ? decomp.y : child.transform.y,
          rotation: Number.isFinite(decomp.rotation) ? decomp.rotation : child.transform.rotation,
          scaleX: Number.isFinite(decomp.scaleX) ? decomp.scaleX : child.transform.scaleX,
          scaleY: Number.isFinite(decomp.scaleY) ? decomp.scaleY : child.transform.scaleY
        }
      });
    }

    // Replace group with its children in parent
    if (parentId && parent) {
      const p = newNodes.get(parentId);
      if (p) {
        const groupIndex = p.children.indexOf(groupId);
        if (groupIndex !== -1) {
          const nextChildren = [...p.children];
          nextChildren.splice(groupIndex, 1, ...childrenToReparent);
          newNodes.set(parentId, { ...p, children: nextChildren });
        }
      }
    }

    newNodes.delete(groupId);

    get().pushToHistory('Ungroup Objects');

    set({
      nodes: newNodes,
      selectedIds: childrenToReparent,
      updateCounter: state.updateCounter + 1,
      structureChangeCounter: state.structureChangeCounter + 1,
    });
  },

  fitGroupToContent: (groupId: string) => {
    const state = get();
    const group = state.nodes.get(groupId);
    if (!group || group.type !== 'group' || group.children.length === 0) return;

    const nodes = state.nodes;
    const lb = getGroupLocalBounds(groupId, nodes);

    const newAnchorX = lb.x + lb.width / 2;
    const newAnchorY = lb.y + lb.height / 2;

    const worldMatrix = getWorldMatrix(groupId, nodes);
    const oldAnchorWorld = new DOMPoint(group.transform.anchorX, group.transform.anchorY).matrixTransform(worldMatrix);
    const newAnchorWorld = new DOMPoint(newAnchorX, newAnchorY).matrixTransform(worldMatrix);

    const dxWorld = newAnchorWorld.x - oldAnchorWorld.x;
    const dyWorld = newAnchorWorld.y - oldAnchorWorld.y;

    const parentId = group.parentId;
    const parentWorldInverse = parentId ? getWorldMatrix(parentId, nodes).inverse() : new DOMMatrix();
    const posDelta = new DOMPoint(dxWorld, dyWorld).matrixTransform(parentWorldInverse);
    const originParent = new DOMPoint(0, 0).matrixTransform(parentWorldInverse);
    const deltaParent = { x: posDelta.x - originParent.x, y: posDelta.y - originParent.y };

    const newNodes = new Map(nodes);

    const updatedGroup = {
      ...group,
      transform: {
        ...group.transform,
        x: group.transform.x + deltaParent.x,
        y: group.transform.y + deltaParent.y,
        anchorX: newAnchorX,
        anchorY: newAnchorY
      },
      props: {
        ...group.props,
        width: lb.width,
        height: lb.height
      }
    };
    newNodes.set(groupId, updatedGroup);

    get().pushToHistory('Fit Group to Content');

    set({
      nodes: newNodes,
      updateCounter: state.updateCounter + 1
    });
  },

  applyBooleanOperation: (nodeIds: string[], mode: 'union' | 'subtract' | 'intersect' | 'exclude') => {
    if (nodeIds.length < 2) {
      console.warn('⚠️ Boolean operation requires at least 2 shapes');
      return;
    }

    const state = get();
    const nodes = state.nodes;

    // Verify all nodes are shapes (not groups or artboards)
    const validTypes = ['rect', 'ellipse', 'path'];
    const allValid = nodeIds.every(id => {
      const node = nodes.get(id);
      return node && validTypes.includes(node.type);
    });

    if (!allValid) {
      console.warn('⚠️ Boolean operations only work on shapes (rect, ellipse, path)');
      return;
    }

    // Import the boolean ops utility
    const { applyBooleanToShapes } = require('../core/BooleanOps');

    // Apply the boolean operation
    const currentTime = state.currentTime || 0;
    const result = applyBooleanToShapes(nodeIds, mode, nodes, currentTime);

    if (!result || result.points.length === 0) {
      console.warn('❌ Boolean operation produced no result');
      return;
    }

    // Get first node for parent info and z-index
    const firstNodeId = nodeIds[0];
    const firstNode = nodes.get(firstNodeId);
    const parentId = firstNode?.parentId || null;
    const parent = parentId ? nodes.get(parentId) : null;

    // Sort by z-index to get the topmost position
    let sortedIds = [...nodeIds];
    if (parent) {
      sortedIds.sort((a, b) => parent.children.indexOf(a) - parent.children.indexOf(b));
    }

    // Create new path node
    const opNames = { union: 'Union', subtract: 'Subtract', intersect: 'Intersect', exclude: 'Exclude' };
    const newPathId = `path_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const newPathNode: SceneNode = {
      id: newPathId,
      name: opNames[mode],
      type: 'path',
      parentId: parentId,
      children: [],
      transform: {
        x: result.bounds.x,
        y: result.bounds.y,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        anchorX: 0,
        anchorY: 0,
        scaleLink: true, // Enable proportional scaling by default
      },
      style: result.style,
      visible: true,
      locked: false,
      props: {
        points: result.points,
        closed: true,
        width: result.bounds.width,
        height: result.bounds.height,
      },
      inPoint: 0,
      outPoint: 300,
      startTime: 0
    };

    const newNodes = new Map(nodes);

    // Add the new path node
    newNodes.set(newPathId, newPathNode);

    // Delete old nodes and remove from parent
    for (const id of nodeIds) {
      newNodes.delete(id);
    }

    // Update parent's children list: remove old nodes, add new path at topmost position
    if (parentId && parent) {
      const p = newNodes.get(parentId);
      if (p) {
        const originalIndices = nodeIds.map(id => parent.children.indexOf(id)).filter(i => i >= 0);
        const targetIndex = Math.max(...originalIndices, 0);

        // Filter out old nodes
        const filteredChildren = p.children.filter(id => !nodeIds.includes(id));

        // Insert new path at the right position
        const newChildren = [...filteredChildren];
        newChildren.splice(Math.min(targetIndex, filteredChildren.length), 0, newPathId);

        newNodes.set(parentId, { ...p, children: newChildren });
      }
    }

    get().pushToHistory(`${opNames[mode]} Shapes`);

    set({
      nodes: newNodes,
      selectedIds: [newPathId],
      updateCounter: state.updateCounter + 1,
      structureChangeCounter: state.structureChangeCounter + 1,
    });

  },

  // Matte management
  setMatte: (targetId: string, matteId: string | null) => {
    const state = get();
    const newNodes = new Map(state.nodes);

    const target = newNodes.get(targetId);
    if (!target) return;

    get().pushToHistory('Set Matte');

    // Clear previous matte relationship if exists
    if (target.matteSourceId) {
      const prevMatte = newNodes.get(target.matteSourceId);
      if (prevMatte) {
        const newTargets = (prevMatte.matteTargetIds || []).filter(tid => tid !== targetId);
        newNodes.set(target.matteSourceId, {
          ...prevMatte,
          matteTargetIds: newTargets,
          visible: newTargets.length === 0 ? true : prevMatte.visible // Show previous matte layer again if no more targets
        });
      }
    }

    // Set new matte relationship
    if (matteId) {
      const matte = newNodes.get(matteId);
      if (matte) {
        const currentTargets = matte.matteTargetIds || [];
        if (!currentTargets.includes(targetId)) {
          // Mark matte layer
          newNodes.set(matteId, {
            ...matte,
            matteTargetIds: [...currentTargets, targetId],
            visible: false // Hide matte layer (it becomes the mask)
          });
        }
      }
    }

    // Update target layer
    newNodes.set(targetId, {
      ...target,
      matteSourceId: matteId
    });

    set({
      nodes: newNodes,
      updateCounter: state.updateCounter + 1,
      structureChangeCounter: state.structureChangeCounter + 1,
    });

  },

  alignSelectedNodes: (type) => {
    const state = get();
    const selectedIds = state.selectedIds;
    if (selectedIds.length < 1) return;

    const nodes = state.nodes;
    const currentTime = state.currentTime;

    // Find artboard for single-selection alignment
    const artboard = Array.from(nodes.values()).find(n => n.type === 'artboard');
    const useArtboard = selectedIds.length === 1 && !!artboard;

    let collectiveBounds;
    if (useArtboard) {
      collectiveBounds = {
        x: 0,
        y: 0,
        width: artboard.props?.width || 0,
        height: artboard.props?.height || 0
      };
    } else {
      collectiveBounds = getCollectiveBoundingBox(selectedIds, nodes, currentTime);
    }

    state.pushToHistory(`Align ${type}`);
    const newNodes = new Map(nodes);

    selectedIds.forEach((id) => {
      const node = nodes.get(id);
      if (!node || node.type === 'artboard') return;

      const worldMatrix = getWorldMatrix(id, nodes, currentTime);
      const bounds = getBoundingBox(node, worldMatrix, nodes, currentTime);

      let dx = 0;
      let dy = 0;

      switch (type) {
        case 'left':
          dx = collectiveBounds.x - bounds.x;
          break;
        case 'center-h':
          dx = (collectiveBounds.x + collectiveBounds.width / 2) - (bounds.x + bounds.width / 2);
          break;
        case 'right':
          dx = (collectiveBounds.x + collectiveBounds.width) - (bounds.x + bounds.width);
          break;
        case 'top':
          dy = collectiveBounds.y - bounds.y;
          break;
        case 'center-v':
          dy = (collectiveBounds.y + collectiveBounds.height / 2) - (bounds.y + bounds.height / 2);
          break;
        case 'bottom':
          dy = (collectiveBounds.y + collectiveBounds.height) - (bounds.y + bounds.height);
          break;
      }

      if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;

      // Apply shift in world space
      const parentId = (node.parentLayerId && nodes.has(node.parentLayerId)) ? node.parentLayerId : node.parentId;
      const parentWorldMatrix = parentId ? getWorldMatrix(parentId, nodes, currentTime) : new DOMMatrix();
      const invParentMatrix = parentWorldMatrix.inverse();

      // We need to apply translation in world space: NewWorld = Translate(dx, dy) * OldWorld
      // DOMMatrix translate() returns a new matrix with T * M
      const newWorldMatrix = new DOMMatrix().translate(dx, dy).multiply(worldMatrix);
      const newLocalMatrix = invParentMatrix.multiply(newWorldMatrix);
      const decomp = decomposeMatrix(newLocalMatrix, { x: node.transform.anchorX, y: node.transform.anchorY });

      newNodes.set(id, {
        ...node,
        transform: {
          ...node.transform,
          x: decomp.x,
          y: decomp.y,
        },
      });
    });

    set({ nodes: newNodes, updateCounter: state.updateCounter + 1 });
  },

  distributeSelectedNodes: (type) => {
    const state = get();
    const selectedIds = state.selectedIds;
    if (selectedIds.length < 3) return;

    const nodes = state.nodes;
    const currentTime = state.currentTime;

    state.pushToHistory(`Distribute ${type}`);
    const newNodes = new Map(nodes);

    const nodeInfos = selectedIds.map(id => {
      const node = nodes.get(id);
      if (!node) return null;
      const worldMatrix = getWorldMatrix(id, nodes, currentTime);
      const bounds = getBoundingBox(node, worldMatrix, nodes, currentTime);
      return { id, node, bounds, worldMatrix };
    }).filter(Boolean) as any[];

    if (type === 'horizontal') {
      // Sort by left edge
      nodeInfos.sort((a, b) => a.bounds.x - b.bounds.x);

      const first = nodeInfos[0];
      const last = nodeInfos[nodeInfos.length - 1];

      const totalSpan = last.bounds.x + last.bounds.width - first.bounds.x;
      const totalContentWidth = nodeInfos.reduce((acc, info) => acc + info.bounds.width, 0);
      const gap = (totalSpan - totalContentWidth) / (nodeInfos.length - 1);

      let currentX = first.bounds.x;
      nodeInfos.forEach((info, index) => {
        if (index === 0 || index === nodeInfos.length - 1) {
          currentX += info.bounds.width + gap;
          return;
        }

        const targetX = currentX;
        const dx = targetX - info.bounds.x;

        const parentId = (info.node.parentLayerId && nodes.has(info.node.parentLayerId)) ? info.node.parentLayerId : info.node.parentId;
        const parentWorldMatrix = parentId ? getWorldMatrix(parentId, nodes, currentTime) : new DOMMatrix();
        const invParentMatrix = parentWorldMatrix.inverse();

        const newWorldMatrix = new DOMMatrix().translate(dx, 0).multiply(info.worldMatrix);
        const newLocalMatrix = invParentMatrix.multiply(newWorldMatrix);
        const decomp = decomposeMatrix(newLocalMatrix, { x: info.node.transform.anchorX, y: info.node.transform.anchorY });

        newNodes.set(info.id, {
          ...info.node,
          transform: {
            ...info.node.transform,
            x: decomp.x,
          },
        });

        currentX += info.bounds.width + gap;
      });
    } else {
      // Sort by top edge
      nodeInfos.sort((a, b) => a.bounds.y - b.bounds.y);

      const first = nodeInfos[0];
      const last = nodeInfos[nodeInfos.length - 1];

      const totalSpan = last.bounds.y + last.bounds.height - first.bounds.y;
      const totalContentHeight = nodeInfos.reduce((acc, info) => acc + info.bounds.height, 0);
      const gap = (totalSpan - totalContentHeight) / (nodeInfos.length - 1);

      let currentY = first.bounds.y;
      nodeInfos.forEach((info, index) => {
        if (index === 0 || index === nodeInfos.length - 1) {
          currentY += info.bounds.height + gap;
          return;
        }

        const targetY = currentY;
        const dy = targetY - info.bounds.y;

        const parentId = (info.node.parentLayerId && nodes.has(info.node.parentLayerId)) ? info.node.parentLayerId : info.node.parentId;
        const parentWorldMatrix = parentId ? getWorldMatrix(parentId, nodes, currentTime) : new DOMMatrix();
        const invParentMatrix = parentWorldMatrix.inverse();

        const newWorldMatrix = new DOMMatrix().translate(0, dy).multiply(info.worldMatrix);
        const newLocalMatrix = invParentMatrix.multiply(newWorldMatrix);
        const decomp = decomposeMatrix(newLocalMatrix, { x: info.node.transform.anchorX, y: info.node.transform.anchorY });

        newNodes.set(info.id, {
          ...info.node,
          transform: {
            ...info.node.transform,
            y: decomp.y,
          },
        });

        currentY += info.bounds.height + gap;
      });
    }

    set({ nodes: newNodes, updateCounter: state.updateCounter + 1 });
  },
})));

if (typeof window !== 'undefined') {
  (window as any).useCreatorStore = useCreatorStore;
}