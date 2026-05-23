import { StateCreator } from 'zustand';

// Scene node types
export type NodeType = 'artboard' | 'rect' | 'ellipse' | 'polystar' | 'path' | 'group' | 'text' | 'image' | 'precomp';

// Transform properties
export interface Transform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  anchorX: number;
  anchorY: number;
  anchorAlignX?: number; // 0, 0.5, 1 (percentage)
  anchorAlignY?: number; // 0, 0.5, 1 (percentage)
  scaleLink?: boolean;
}

// Gradient properties
export interface GradientStop {
  offset: number; // 0-1
  color: string;  // hex string
  opacity: number; // 0-1
}

export interface Gradient {
  type: 'linear' | 'radial';
  start: { x: number, y: number };
  end: { x: number, y: number };
  stops: GradientStop[];
  highlightLength?: number;
  highlightAngle?: number;
  designSize?: { width: number, height: number };
  units?: 'userSpaceOnUse' | 'objectBoundingBox';
}

// Effect properties
export interface Effect {
  id: string;
  type: 'shadow' | 'blur' | 'repeater' | 'offsetPath';
  name: string;
  visible: boolean;
  // Blur/Shadow properties
  blur?: number;
  color?: string;    // for shadow
  opacity?: number;  // for shadow
  distance?: number; // for shadow
  direction?: number; // for shadow (angle)

  // Repeater specific
  copies?: number;
  offset?: number;
  composite?: 'above' | 'below';
  repeaterTransform?: {
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
    startOpacity: number;
    endOpacity: number;
  };

  // Offset Path specific
  amount?: number;
  lineJoin?: 'round' | 'bevel' | 'miter';
  miterLimit?: number;
}

// Style properties
export interface Style {
  fill?: string;
  fillType?: 'solid' | 'gradient';
  fillGradient?: Gradient;
  fillOpacity?: number;
  fillVisible?: boolean;
  stroke?: string;
  strokeType?: 'solid' | 'gradient';
  strokeGradient?: Gradient;
  strokeWidth?: number;
  strokeDash?: string;
  strokeLinecap?: 'butt' | 'round' | 'square';
  strokeLinejoin?: 'miter' | 'round' | 'bevel';
  strokeOpacity?: number;
  strokeAlign?: 'inside' | 'outside' | 'center';
  opacity: number;
  blendMode?: 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light' | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';
  effects?: Effect[];
  // Trim Path
  trimStart?: number;
  trimEnd?: number;
  trimOffset?: number;
  fillRule?: 'nonzero' | 'evenodd';
}

// Scene node
export interface SceneNode {
  id: string;
  name: string;
  type: NodeType;
  parentId: string | null;
  children: string[];
  transform: Transform;
  style: Style;
  visible: boolean;
  locked: boolean;
  props?: any; // Type-specific properties
  animations?: Record<string, import('./animationSlice').Keyframe[]>;
  mergeMode?: 'none' | 'union' | 'subtract' | 'intersect' | 'exclude'; // Boolean operation mode for groups
  // Matte properties
  matteSourceId?: string | null;  // ID of layer being used as matte for this layer
  matteTargetIds?: string[];      // IDs of layers this node is a matte for (used for cleanup)
  inPoint: number;
  outPoint: number;
  startTime: number;
  parentLayerId?: string | null; // AE-style parenting
  refId?: string; // For 'precomp' nodes, points to the target artboard ID
  masks?: any[]; // Layer masks
  matteType?: number; // 0: None, 1: Alpha, 2: Alpha Inv, 3: Luma, 4: Luma Inv
  // Stores original Lottie JSON for this layer — used for lossless round-trip export
  _rawLottieData?: any;
  // Import fidelity level: 'full' = fully authoring-model editable, 'partial' = transform/opacity editable
  // but shapes passthrough raw Lottie data, 'passthrough' = completely opaque to the editor
  _importSupport?: 'full' | 'partial' | 'passthrough';
  // Per-node import warnings collected during parse (expressions, unsupported shape types, etc.)
  _importWarnings?: string[];
  // Original parsed style values — used to detect whether the user has actually changed
  // a property vs. it being set by the importer. Prevents overlayStyleOnShapes from flattening
  // multi-color layers when no user edit has occurred.
  _originalParsedFill?: string;
  _originalParsedStroke?: string;
  _originalParsedStrokeWidth?: number;
  // Original parsed transform values — used to detect user-edited transforms vs importer-set values.
  // Enables selective ks overriding in lossless export without corrupting animated keyframes.
  _originalParsedX?: number;
  _originalParsedY?: number;
  _originalParsedRotation?: number;
  _originalParsedScaleX?: number;
  _originalParsedScaleY?: number;
  _originalParsedOpacity?: number;
}

// Scene state interface
export interface SceneSlice {
  nodes: Map<string, SceneNode>;
  rootId: string | null;
  // Add a counter to force re-renders
  updateCounter: number;
  addNode: (node: SceneNode) => void;
  addNodesBatch: (nodes: SceneNode[]) => void;
  updateNode: (id: string, updates: Partial<SceneNode>) => void;
  deleteNode: (id: string) => void;
  getNode: (id: string) => SceneNode | undefined;
  moveNode: (nodeId: string, targetParentId: string, index: number) => void;
  activePanel: 'canvas' | 'inspector' | 'layers' | 'timeline' | 'none';
  setActivePanel: (panel: 'canvas' | 'inspector' | 'layers' | 'timeline' | 'none') => void;
  previewNode: SceneNode | null;
  setPreviewNode: (node: SceneNode | null) => void;
  activeArtboardId: string | null;
  setActiveArtboard: (id: string) => void;
  precompose: (nodeIds: string[], name?: string) => void;
}

import { CreatorStore } from './types';

// Create the scene slice
export const createSceneSlice: StateCreator<CreatorStore, [["zustand/immer", never]], [], SceneSlice> = (set, get) => ({
  nodes: new Map(),
  rootId: null,
  updateCounter: 0,

  addNode: (node) => set((state) => {
    const newNodes = new Map(state.nodes);
    newNodes.set(node.id, node);

    if (node.type !== 'artboard') {
      get().pushToHistory(`Add ${node.name}`);
    }

    return {
      nodes: newNodes,
      updateCounter: state.updateCounter + 1,
      structureChangeCounter: state.structureChangeCounter + 1,
      // If it's the first artboard, make it active
      activeArtboardId: (node.type === 'artboard' && !state.activeArtboardId) ? node.id : state.activeArtboardId,
      duration: (node.type === 'artboard' && !state.activeArtboardId) ? (node.props?.duration ?? state.duration) : state.duration,
      fps: (node.type === 'artboard' && !state.activeArtboardId) ? (node.props?.frameRate ?? state.fps) : state.fps
    };
  }),

  addNodesBatch: (nodes) => set((state) => {
    get().pushToHistory('Import Objects');
    const newNodes = new Map(state.nodes);

    // 1. Add all new nodes
    nodes.forEach(node => {
      newNodes.set(node.id, node);
    });

    // 2. Link to parents (batch update)
    const processedParents = new Set<string>();

    nodes.forEach(node => {
      if (node.parentId && !processedParents.has(node.parentId)) {
        const parent = newNodes.get(node.parentId);
        if (parent) {
          // Find all *new* children for this parent in this batch
          const newChildren = nodes.filter(n => n.parentId === parent.id).map(n => n.id);
          // Combine with existing children, deduplicating
          const updatedChildren = Array.from(new Set([...(parent.children || []), ...newChildren]));

          newNodes.set(parent.id, {
            ...parent,
            children: updatedChildren
          });
          processedParents.add(parent.id);
        }
      }
    });

    return {
      nodes: newNodes,
      updateCounter: state.updateCounter + 1,
      structureChangeCounter: state.structureChangeCounter + 1,
    };
  }),

  updateNode: (id, updates) => {
    // Track changed categories in closure vars — readable after set() returns.
    let typeChanged = false;
    let visibilityChanged = false;
    set((draft) => {
      const node = draft.nodes.get(id);
      if (!node) return;
      // Type change: shape structure (rc→sh) can't be patched in-place; force slow-path re-export.
      typeChanged = updates.type !== undefined && updates.type !== node.type;
      // Visibility change: ThorVG doesn't reliably pick up in-place hd patches; force slow-path
      // so LottieExporter re-exports with the correct hd flag.
      visibilityChanged = updates.visible !== undefined && updates.visible !== node.visible;
      Object.assign(node, updates);
      draft.updateCounter++;
      if (typeChanged || visibilityChanged) {
        draft.structureChangeCounter++;
      } else {
        // Child-of-group nodes are not in lottieNodeMap, so patchLottieNode skips them.
        // Increment childUpdateCounter to force DotLottiePlayback off the fast path so it
        // runs a full LottieExporter re-export and ThorVG picks up the change.
        const isChildOfGroup = !(draft as any).lottieJsonCache &&
          !(draft as any).lottieNodeMap?.has(id) &&
          (draft as any).lottieModel !== null &&
          node.type !== 'artboard';
        if (isChildOfGroup) (draft as any).childUpdateCounter++;
      }
    });
    // patchLottieNode is only useful for property-only changes on top-level nodes.
    // Type and visibility changes use structureChangeCounter above (slow-path re-export).
    // Child-of-group changes use childUpdateCounter above (also slow-path re-export).
    if (!typeChanged && !visibilityChanged) {
      const state = get();
      if (state.lottieJsonCache || state.lottieNodeMap?.has(id)) state.patchLottieNode(id);
    }
  },

  deleteNode: (id) => set((state) => {
    const node = state.nodes.get(id);
    if (!node) return state;

    get().pushToHistory(`Delete ${node.name}`);

    const newNodes = new Map(state.nodes);

    // Clean up matte relationships
    // If this node has a matte source, clear that source's matteTargetIds
    if (node.matteSourceId) {
      const matteSource = newNodes.get(node.matteSourceId);
      if (matteSource) {
        const newTargets = (matteSource.matteTargetIds || []).filter(tid => tid !== id);
        newNodes.set(node.matteSourceId, {
          ...matteSource,
          matteTargetIds: newTargets,
          visible: newTargets.length === 0 ? true : matteSource.visible // Restore visibility if no more targets
        });
      }
    }

    // If this node is used as a matte, clear all targets' matteSourceId
    if (node.matteTargetIds && node.matteTargetIds.length > 0) {
      node.matteTargetIds.forEach(targetId => {
        const matteTarget = newNodes.get(targetId);
        if (matteTarget) {
          newNodes.set(targetId, {
            ...matteTarget,
            matteSourceId: null
          });
        }
      });
    }

    // Recursive delete children if it's a group
    const deleteRecursive = (nodeId: string, map: Map<string, any>) => {
      const n = map.get(nodeId);
      if (n && n.children) {
        n.children.forEach((childId: string) => deleteRecursive(childId, map));
      }
      map.delete(nodeId);
    };

    // Remove from parent's children list
    if (node.parentId) {
      const parent = newNodes.get(node.parentId);
      if (parent) {
        newNodes.set(node.parentId, {
          ...parent,
          children: parent.children.filter(childId => childId !== id)
        });
      }
    }

    deleteRecursive(id, newNodes);

    return {
      nodes: newNodes,
      updateCounter: state.updateCounter + 1,
      structureChangeCounter: state.structureChangeCounter + 1,
    };
  }),

  getNode: (id) => get().nodes.get(id),

  moveNode: (nodeId, targetParentId, index) => set((state) => {
    const node = state.nodes.get(nodeId);
    if (!node) return state;

    get().pushToHistory('Move Node');

    const newNodes = new Map(state.nodes);

    // 1. Remove from old parent
    if (node.parentId) {
      const oldParent = newNodes.get(node.parentId);
      if (oldParent) {
        newNodes.set(node.parentId, {
          ...oldParent,
          children: oldParent.children.filter(id => id !== nodeId)
        });
      }
    }

    // 2. Add to new parent
    const targetParent = newNodes.get(targetParentId);
    if (targetParent) {
      const newChildren = [...targetParent.children];
      // Adjust index if we removed it from the same parent earlier
      const actualIndex = Math.min(index, newChildren.length);
      newChildren.splice(actualIndex, 0, nodeId);

      newNodes.set(targetParentId, {
        ...targetParent,
        children: newChildren
      });

      // 3. Update node's parent reference
      newNodes.set(nodeId, {
        ...node,
        parentId: targetParentId
      });
    }

    return {
      nodes: newNodes,
      updateCounter: state.updateCounter + 1,
      structureChangeCounter: state.structureChangeCounter + 1,
    };
  }),

  activePanel: 'canvas',
  setActivePanel: (panel) => {
    set({ activePanel: panel });
  },

  previewNode: null,
  setPreviewNode: (node) => set({ previewNode: node }),

  activeArtboardId: null,
  setActiveArtboard: (id) => set((state) => {
    const artboard = state.nodes.get(id);
    if (artboard && artboard.type === 'artboard') {
      return {
        activeArtboardId: id,
        duration: artboard.props?.duration ?? state.duration,
        fps: artboard.props?.frameRate ?? state.fps,
        currentTime: Math.min(state.currentTime, artboard.props?.duration ?? state.duration),
        // Force a full Lottie re-export so ThorVG renders the new artboard as root.
        // Without this, navigating into/out of a nested artboard keeps showing the old
        // composition (with parent-composition transforms applied to the nested content).
        structureChangeCounter: state.structureChangeCounter + 1,
      };
    }
    return { activeArtboardId: id, structureChangeCounter: state.structureChangeCounter + 1 };
  }),

  precompose: (nodeIds, name = 'Nested Scene') => {
    if (nodeIds.length === 0) return;

    const state = get();
    const newNodes = new Map(state.nodes);

    // 1. Get current context
    const activeArtboardId = state.activeArtboardId;
    const currentArtboard = activeArtboardId ? state.nodes.get(activeArtboardId) : Array.from(state.nodes.values()).find(n => n.type === 'artboard');
    if (!currentArtboard) return;

    // Find common parent and insert position
    const firstNode = state.nodes.get(nodeIds[0]);
    const parentId = firstNode?.parentId || currentArtboard.id;
    const parent = newNodes.get(parentId);

    const cleanName = name.replace(/[\[\]]/g, '');
    get().pushToHistory(`Pre-compose ${nodeIds.length} layers`);

    // 2. Create IDs
    const precompId = Math.random().toString(36).substr(2, 9);
    const nestedArtboardId = Math.random().toString(36).substr(2, 9);

    // 3. Create the Nested Artboard
    const nestedArtboard: SceneNode = {
      id: nestedArtboardId,
      name: cleanName,
      type: 'artboard',
      parentId: precompId, // Link to precomp instance
      children: [...nodeIds],
      transform: {
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        anchorX: 0,
        anchorY: 0,
        anchorAlignX: 0,
        anchorAlignY: 0
      },
      style: { opacity: 1 },
      visible: true,
      locked: false,
      inPoint: 0,
      outPoint: currentArtboard.outPoint,
      startTime: 0,
      props: { ...currentArtboard.props, transparent: true }
    };
    newNodes.set(nestedArtboardId, nestedArtboard);

    // 4. Create the Precomp Instance Layer
    const precompLayer: SceneNode = {
      id: precompId,
      name: `[${cleanName}]`,
      type: 'precomp',
      refId: nestedArtboardId,
      parentId: parentId,
      children: [],
      transform: {
        x: (currentArtboard.props.width || 500) / 2,
        y: (currentArtboard.props.height || 500) / 2,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        anchorX: (currentArtboard.props.width || 500) / 2,
        anchorY: (currentArtboard.props.height || 500) / 2,
        anchorAlignX: 0.5,
        anchorAlignY: 0.5
      },
      style: { opacity: 1 },
      visible: true,
      locked: false,
      inPoint: 0,
      outPoint: currentArtboard.outPoint,
      startTime: 0
    };
    newNodes.set(precompId, precompLayer);

    // 5. Move selected nodes to the new artboard and update parent children
    if (parent) {
      // Find the index of the first selected node to insert precomp there
      const firstIndex = parent.children.findIndex(id => nodeIds.includes(id));

      // Filter out all selected nodes from parent
      const newParentChildren = parent.children.filter(id => !nodeIds.includes(id));

      // Insert precomp at the right spot
      newParentChildren.splice(firstIndex === -1 ? newParentChildren.length : firstIndex, 0, precompId);

      newNodes.set(parentId, {
        ...parent,
        children: newParentChildren
      });
    }

    nodeIds.forEach(id => {
      const node = newNodes.get(id);
      if (node) {
        // Clear parent links (now its top-level in the nested artboard)
        newNodes.set(id, { ...node, parentId: nestedArtboardId });
      }
    });

    set({
      nodes: newNodes,
      activeArtboardId: nestedArtboardId,
      duration: nestedArtboard.props?.duration ?? state.duration,
      fps: nestedArtboard.props?.frameRate ?? state.fps,
      updateCounter: state.updateCounter + 1,
      structureChangeCounter: state.structureChangeCounter + 1,
    });

    get().setSelection([]);
  }
});