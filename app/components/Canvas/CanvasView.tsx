'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { useCreatorStore } from '@/lib/creator/state/store';
import { WorkerRenderer } from '@/lib/creator/render/WorkerRenderer';
import { findNodeAtPoint, hitTestNode, isNodeSelectable } from '@/lib/creator/core/HitTest';
import { RectTool } from '@/lib/creator/tools/RectTool';
import { EllipseTool } from '@/lib/creator/tools/EllipseTool';
import { PenTool, VectorPoint } from '@/lib/creator/tools/PenTool';
import { TextTool } from '@/lib/creator/tools/TextTool';
import { StarTool } from '@/lib/creator/tools/StarTool';
import SelectionOverlay from './SelectionOverlay';
import MotionPathOverlay from './MotionPathOverlay';
import TextEditOverlay from './TextEditOverlay';
import {
  TextEditState,
  createTextEditState,
  insertText as tcInsertText,
  deleteBackward,
  deleteForward,
  moveCursorLeft,
  moveCursorRight,
  moveCursorHome,
  moveCursorEnd,
  selectAll as tcSelectAll,
  getSelectedText,
} from '@/lib/creator/text/TextCursor';
import { getCharIndexAtPoint, getTextLocalBounds } from '@/lib/creator/text/TextMeasurer';
import { DotLottiePlayback } from './DotLottiePlayback';
import { dotlottieRef } from '@/lib/creator/state/dotlottieRef';
import { SceneNode } from '@/lib/creator/state/sceneSlice';
import { getWorldMatrix, getBoundingBox, localToScreen, createTransformMatrix, getGroupLocalBounds, getPathLocalBounds, getCollectiveBoundingBox, decomposeMatrix, getAnimatedAnchor, getAnchorOffset } from '@/lib/creator/core/Matrix';
import { AnimationUtils } from '@/lib/creator/core/Animation';
import { convertToPath } from '@/lib/creator/core/Convert';
import { createArtboardNode } from '@/lib/creator/core/SceneNode';
import { SVGImporter } from '@/lib/creator/core/SVGImporter';
import { loadFontCSS } from '@/lib/creator/fonts/GoogleFontsService';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Repeat,
  Minus,
  Plus,
  Maximize,
  RotateCcw,
  Clock,
  ChevronDown
} from 'lucide-react';

function checkNodeHierarchy(leafId: string | null, targetId: string, nodes: Map<string, SceneNode>): boolean {
  if (!leafId || !targetId) return false;
  let curr: SceneNode | undefined = nodes.get(leafId);
  while (curr) {
    if (curr.id === targetId) return true;
    if (curr.parentId) curr = nodes.get(curr.parentId);
    else break;
  }
  return false;
}

/**
 * ThorVG hit testing using getLayerBoundingBox() (public API).
 *
 * Uses dl.getLayerBoundingBox(layerName) which returns the tight visual OBB of the rendered
 * layer content — NOT the Lottie layer container (which covers the full artboard and caused
 * the old _player.intersect() to select shapes for any click within the artboard).
 *
 * getLayerBoundingBox returns 8 values: [x0,y0, x1,y1, x2,y2, x3,y3] — 4 OBB corners
 * clockwise from top-left in physical canvas pixels (same space as getLayerBoundingBox in
 * SelectionOverlay). We do a proper OBB point-in-test so rotated shapes are hit correctly.
 *
 * Full-artboard bboxes (ThorVG fallback for unresolvable layers, > 85% of artboard in both
 * axes) are rejected — they would cause every click to match, same as the old bug.
 *
 * Coordinate conversion: container CSS pixel → physical canvas pixel:
 *   cx = (screenX - tx) * dpr   where tx = cw/2 + zoom*pan.x
 */
function hitTestThorVGLayers(
  screenX: number,
  screenY: number,
  canvasWidth: number,
  canvasHeight: number,
  zoom: number,
  pan: { x: number; y: number },
  artboardChildIds: string[],
  nodes: Map<string, SceneNode>,
  currentTime: number,
  artboardW: number,
  artboardH: number,
): string | null {
  const dl = dotlottieRef.current;
  if (!dl) return null;

  const dpr = window.devicePixelRatio || 1;
  const tx = canvasWidth / 2 + zoom * pan.x;
  const ty = canvasHeight / 2 + zoom * pan.y;
  // Container CSS pixel → physical canvas pixel (matches DotLottiePlayback canvas sizing)
  const cx = (screenX - tx) * dpr;
  const cy = (screenY - ty) * dpr;

  // Sync ThorVG to current frame so bounds are frame-accurate (same as SelectionOverlay)
  try {
    if (Math.abs(dl.currentFrame - currentTime) > 0.5) dl.setFrame(currentTime);
  } catch { /* ignore */ }

  // Threshold for rejecting full-artboard bboxes (ThorVG returns canvas size for unresolvable layers)
  const maxW = artboardW * dpr * zoom * 0.85;
  const maxH = artboardH * dpr * zoom * 0.85;

  // children array is back-to-front (last = topmost); iterate in reverse for front-to-back
  for (let i = artboardChildIds.length - 1; i >= 0; i--) {
    const nodeId = artboardChildIds[i];
    const node = nodes.get(nodeId);
    if (!node || !node.name || !node.visible || node.type === 'artboard') continue;
    // getLayerBoundingBox looks up by name — skip duplicate names (ThorVG would return wrong layer)
    const nameIsUnique = artboardChildIds.filter(id => nodes.get(id)?.name === node.name).length === 1;
    if (!nameIsUnique) continue;

    try {
      const bbox = dl.getLayerBoundingBox(node.name);
      // Returns [x0,y0, x1,y1, x2,y2, x3,y3] — 4 OBB corners clockwise from top-left.
      // NOT [x,y,w,h]. Reject if bbox is missing, malformed, or full-artboard fallback.
      if (!bbox || bbox.length < 8) continue;
      const [x0, y0, x1, y1, , , x3, y3] = bbox;
      if (![x0, y0, x1, y1, x3, y3].every(isFinite)) continue;

      // Reject full-canvas fallback bboxes (ThorVG can't resolve layer → returns canvas dims)
      const e0x = x1 - x0, e0y = y1 - y0;
      const e1x = x3 - x0, e1y = y3 - y0;
      const bboxW = Math.sqrt(e0x * e0x + e0y * e0y);
      const bboxH = Math.sqrt(e1x * e1x + e1y * e1y);
      if (bboxW > maxW && bboxH > maxH) continue;

      // OBB point-in-test: project (cx,cy) onto the two edge axes from top-left corner.
      // P is inside iff 0 ≤ P·e0 ≤ |e0|² and 0 ≤ P·e1 ≤ |e1|²
      const dx = cx - x0, dy = cy - y0;
      const dot0 = dx * e0x + dy * e0y;
      const dot1 = dx * e1x + dy * e1y;
      const len0sq = e0x * e0x + e0y * e0y;
      const len1sq = e1x * e1x + e1y * e1y;
      if (dot0 >= 0 && dot0 <= len0sq && dot1 >= 0 && dot1 <= len1sq) {
        return nodeId;
      }
    } catch {
      return null; // getLayerBoundingBox not available — fall through to Canvas2D
    }
  }
  return null;
}

function findHoveredInteractionLayer(artboardLocalX: number, artboardLocalY: number, state: any, artboardId: string | null | undefined, eventName?: string): string | null {
  if (!state.stateMachine || !state.stateMachine.interactions || state.stateMachine.interactions.length === 0) return null;
  const interactions = state.stateMachine.interactions;

  // Find all candidate layers and their ancestors that have the requested interaction
  const candidateLayerIds = new Set<string>();
  interactions.forEach((int: any) => {
    if (int.layerId && (!eventName || int.event === eventName)) {
      candidateLayerIds.add(int.layerId);
    }
  });

  if (candidateLayerIds.size === 0) return null;

  // We perform a standard top-to-bottom hit test using the scene tree order.
  // We return the topmost layer that is either a candidate itself or has a descendant that was hit.
  const frame = state.currentTime;
  const nodes = state.nodes;

  function recursiveHitTest(parentId: string): string | null {
    const parent = nodes.get(parentId);
    if (!parent || !parent.visible) return null;
    if (frame < parent.inPoint || frame > parent.outPoint) return null;

    // Check children in reverse order (top to bottom z-index)
    for (let i = parent.children.length - 1; i >= 0; i--) {
      const childId = parent.children[i];
      const child = nodes.get(childId);
      if (!child || !child.visible) continue;
      // Skip layers that are outside their active time range (inPoint/outPoint)
      if (frame < child.inPoint || frame > child.outPoint) continue;

      // Recursive check for deeper hits
      const hitId = recursiveHitTest(childId);
      if (hitId) return hitId;

      // Check this node itself if it's a candidate
      if (candidateLayerIds.has(childId)) {
        const worldMatrix = getWorldMatrix(childId, nodes, frame, artboardId || undefined);
        const bbox = getBoundingBox(child, worldMatrix, nodes, frame);
        if (
          artboardLocalX >= bbox.x && artboardLocalX <= bbox.x + bbox.width &&
          artboardLocalY >= bbox.y && artboardLocalY <= bbox.y + bbox.height
        ) {
          return childId;
        }
      }
    }
    return null;
  }

  return artboardId ? recursiveHitTest(artboardId) : null;
}

function processStateInteraction(eventName: string, targetId: string | null, state: any, exactTargetMatches: boolean = false) {
  if (!state.stateMachine || !targetId) return;
  const interactions = state.stateMachine.interactions || [];
  interactions.forEach((int: any) => {
    const isMatch = exactTargetMatches
      ? (int.layerId === targetId)
      : checkNodeHierarchy(targetId, int.layerId, state.nodes);

    if (int.event === eventName && isMatch) {
      console.log(`🎯 Interaction matched: ${eventName} on layer ${int.layerId}`, int.actions);
      state.executeSmActions(int.actions);
    }
  });
}

// Minimum screen-pixel dimension (W or H) before resize/rotate handles are hidden.
// Below this size the handles overlap the shape — user must zoom in to access them.
const MIN_HANDLE_SCREEN_PX = 20;

// Custom rotation cursor: a circular arrow with a white outline so it's readable on any background.
const _rotateSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path d="M15 3 A8 8 0 1 0 17 10" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"/><path d="M17 10 L14 6 M17 10 L13 12" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 3 A8 8 0 1 0 17 10" fill="none" stroke="black" stroke-width="1.5" stroke-linecap="round"/><path d="M17 10 L14 6 M17 10 L13 12" fill="none" stroke="black" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(_rotateSVG)}") 10 10, grab`;

export default function CanvasView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<WorkerRenderer | null>(null);
  const rectToolRef = useRef<RectTool | null>(null);
  const ellipseToolRef = useRef<EllipseTool | null>(null);
  const starToolRef = useRef<StarTool | null>(null);
  const penToolRef = useRef<PenTool | null>(null);
  const textToolRef = useRef<TextTool | null>(null);
  const mouseScreenPosRef = useRef({ x: 0, y: 0 });
  const mouseCanvasPosRef = useRef({ x: 0, y: 0 });
  const activePointerTargetRef = useRef<string | null>(null);

  const [viewport, setViewport] = useState({ zoom: 1, pan: { x: 0, y: 0 } });
  const [hoveredHandle, setHoveredHandle] = useState<{ nodeId: string, handleIndex: number, type: 'resize' | 'rotate' } | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [textEditState, setTextEditState] = useState<TextEditState | null>(null);
  const hiddenInputRef = useRef<HTMLInputElement>(null);
  const [fontsLoaded, setFontsLoaded] = useState(0);
  const [activeGuides, setActiveGuides] = useState<{ x: number | null, y: number | null }>({ x: null, y: null });
  const [isAltPressed, setIsAltPressed] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [spacePressedAt, setSpacePressedAt] = useState<number>(0);
  const [hasMovedDuringSpace, setHasMovedDuringSpace] = useState(false);
  const [measurementTargetId, setMeasurementTargetId] = useState<string | null>(null);

  // Interaction state
  const [interaction, setInteraction] = useState<{
    type: 'none' | 'move' | 'resize' | 'rotate' | 'marquee' | 'edit_path' | 'edit_gradient' | 'pan' | 'edit_motion_path';
    nodeId?: string;
    handleIndex?: number;
    vertexIndex?: number;
    handleType?: 'vertex' | 'in' | 'out' | 'kf' | 'outerRadius' | 'innerRadius';
    gradientHandle?: 'start' | 'end';
    time?: number; // For motion path editing
    timeEnd?: number; // For segment bending
    isSegment?: boolean;
    initialPos?: { x: number, y: number };
    initialHandle?: { x: number, y: number };
    startPos: { x: number; y: number };
    currentPos?: { x: number; y: number };
    initialTransform?: any;
    initialTransforms?: Record<string, { x: number; y: number }>;
    initialProps?: any;
    initialScreenFixedPoint?: { x: number; y: number };
    initialLocalMousePos?: { x: number; y: number };
    initialFixedParentPos?: DOMPoint;
    initialFixedLocalPos?: { x: number; y: number };
    initialWorldMatrix?: DOMMatrix;
    initialOffsetX?: number;
    initialOffsetY?: number;
    initialWidth?: number;
    initialHeight?: number;
    initialComputedAnchor?: { x: number; y: number };
    initialPan?: { x: number; y: number };
    initialViewTransform?: DOMMatrix;
    lastAngle?: number;
    totalRotation?: number;
    hasRecordedHistory?: boolean;
    hasMoved?: boolean; // true once cursor moves >3px from mousedown — gates Canvas2D z-20 swap
    initialClickId?: string; // ID of the node clicked on mousedown
    initialSelectionData?: {
      center: { x: number, y: number },
      fixedPoint: { x: number, y: number },
      bounds: { x: number, y: number, width: number, height: number },
      nodes: Record<string, {
        worldMatrix: DOMMatrix,
        parentWorldMatrixInverse: DOMMatrix,
        localToSelectionMatrix: DOMMatrix
      }>
    };
    initialSelectionBounds?: { x: number, y: number, width: number, height: number };
    isAnchorHandleX?: boolean;
    isAnchorHandleY?: boolean;
    initialChildrenData?: Record<string, {
      id: string,
      transform: any,
      worldMatrix: DOMMatrix,
      parentWorldMatrix: DOMMatrix,
      localPosition: { x: number, y: number }
    }>;
  }>({ type: 'none', startPos: { x: 0, y: 0 } });

  const interactionRef = useRef(interaction);
  useEffect(() => {
    interactionRef.current = interaction;
  }, [interaction]);

  // Handle Ctrl+Shift+C for Pre-compose
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const state = useCreatorStore.getState();
      if (state.creatorMode === 'state-flow') return;
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
        if (state.selectedIds.length > 0) {
          e.preventDefault();
          state.precompose(state.selectedIds);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Store state
  const nodes = useCreatorStore((state) => state.nodes);
  const addNode = useCreatorStore((state) => state.addNode);
  const updateNode = useCreatorStore((state) => state.updateNode);
  const setSelection = useCreatorStore((state) => state.setSelection);
  const addToSelection = useCreatorStore((state) => state.addToSelection);
  const removeFromSelection = useCreatorStore((state) => state.removeFromSelection);
  const isSelected = useCreatorStore((state) => state.isSelected);
  const selectedIds = useCreatorStore((state) => state.selectedIds);
  const deleteNode = useCreatorStore((state) => state.deleteNode);
  const activeTool = useCreatorStore((state) => state.activeTool);
  const activePanel = useCreatorStore((state) => state.activePanel);
  const setActiveTool = useCreatorStore((state) => state.setActiveTool);
  const setActivePanel = useCreatorStore((state) => state.setActivePanel);
  const groupNodes = useCreatorStore((state) => state.groupNodes);
  const ungroupNodes = useCreatorStore((state) => state.ungroupNodes);
  const fitGroupToContent = useCreatorStore((state) => state.fitGroupToContent);
  const previewNode = useCreatorStore((state) => state.previewNode);
  const setPreviewNode = useCreatorStore((state) => state.setPreviewNode);
  const currentTime = useCreatorStore((state) => state.currentTime);
  const setCurrentTime = useCreatorStore((state) => state.setCurrentTime);
  const isPlaying = useCreatorStore((state) => state.isPlaying);
  const lottieNeedsReload = useCreatorStore((state) => state.lottieNeedsReload);
  const rawAnimationSource = useCreatorStore((state) => state.rawAnimationSource);
  const togglePlaying = useCreatorStore((state) => state.togglePlaying);
  const smIsPlaying = useCreatorStore((state) => state.smIsPlaying);
  const toggleSmPlaying = useCreatorStore((state) => state.toggleSmPlaying);
  const creatorMode = useCreatorStore((state) => state.creatorMode);
  const isLooping = useCreatorStore((state) => state.isLooping);
  const toggleLooping = useCreatorStore((state) => state.toggleLooping);
  const fps = useCreatorStore((state) => state.fps);
  const duration = useCreatorStore((state) => state.duration);
  const setFps = useCreatorStore((state) => state.setFps);
  const setDuration = useCreatorStore((state) => state.setDuration);
  const editingNodeId = useCreatorStore((state) => state.editingNodeId);
  const setEditingNode = useCreatorStore((state) => state.setEditingNode);
  const setNodeProperty = useCreatorStore((state) => state.setNodeProperty);
  const setNodeProperties = useCreatorStore((state) => state.setNodeProperties);
  const activeArtboardId = useCreatorStore((state) => state.activeArtboardId);
  const setActiveArtboard = useCreatorStore((state) => state.setActiveArtboard);
  const precompose = useCreatorStore((state) => state.precompose);

  // Helper: Detect if a mouse is over a handle or in the "rotate zone"
  const getHandleAtPoint = (
    screenX: number,
    screenY: number,
    currentSelectedIds: string[],
    currentNodes: Map<string, SceneNode>,
    currentViewTransform: DOMMatrix,
    currentTick: number
  ) => {
    const resizeRadius = 8;
    const rotateRadiusInner = 10;
    const rotateRadiusOuter = 35; // The "Figma zone" outside corners

    const targets = currentSelectedIds.length > 0 ? currentSelectedIds : [];

    // --- NEW: Collective Selection Handles ---
    if (currentSelectedIds.length > 1) {
      const bounds = getCollectiveBoundingBox(currentSelectedIds, currentNodes, currentTick);
      if (!isNaN(bounds.x) && !isNaN(bounds.y) && bounds.width > 0 && bounds.height > 0) {
        const tl = localToScreen(bounds.x, bounds.y, currentViewTransform);
        const br = localToScreen(bounds.x + bounds.width, bounds.y + bounds.height, currentViewTransform);
        const w = br.x - tl.x;
        const h = br.y - tl.y;

        // Don't register handle hits when the collective box is too small on screen
        if (w < MIN_HANDLE_SCREEN_PX || h < MIN_HANDLE_SCREEN_PX) return null;

        const handles = [
          { x: tl.x, y: tl.y, index: 0 },
          { x: tl.x + w / 2, y: tl.y, index: 1 },
          { x: br.x, y: tl.y, index: 2 },
          { x: br.x, y: tl.y + h / 2, index: 3 },
          { x: br.x, y: br.y, index: 4 },
          { x: tl.x + w / 2, y: br.y, index: 5 },
          { x: tl.x, y: br.y, index: 6 },
          { x: tl.x, y: tl.y + h / 2, index: 7 },
        ];

        // 0. Check for Motion Path handles (highest priority for selected items)
        // Handled by pointer-events in MotionPathOverlay component which stops propagation.

        // 1. Check for Resize
        for (const handle of handles) {
          const dist = Math.sqrt((screenX - handle.x) ** 2 + (screenY - handle.y) ** 2);
          if (dist < resizeRadius) return { nodeId: 'selection', handleIndex: handle.index, type: 'resize' as const };
        }

        // 2. Check for Rotation Zone
        const corners = [handles[0], handles[2], handles[4], handles[6]];
        for (const c of corners) {
          const dist = Math.sqrt((screenX - c.x) ** 2 + (screenY - c.y) ** 2);
          if (dist >= rotateRadiusInner && dist <= rotateRadiusOuter) {
            // Check if it's NOT inside the collective bounds
            if (screenX < tl.x || screenX > br.x || screenY < tl.y || screenY > br.y) {
              return { nodeId: 'selection', handleIndex: c.index, type: 'rotate' as const };
            }
          }
        }
      }
    }

    // Convert screen mouse to scene coordinates for hit testing nodes
    const invView = currentViewTransform.inverse();
    const scenePoint = new DOMPoint(screenX, screenY).matrixTransform(invView);

    for (const nodeId of targets) {
      if (nodeId === editingNodeId) continue;
      const node = currentNodes.get(nodeId);
      if (!node || !isNodeSelectable(nodeId, currentNodes)) continue;

      const worldMatrix = getWorldMatrix(nodeId, currentNodes, currentTick);
      const combinedMatrix = currentViewTransform.multiply(worldMatrix);

      // Get dimensions
      let width = 0;
      let height = 0;
      let offsetX = 0;
      let offsetY = 0;

      if (node.type === 'rect' || node.type === 'artboard' || node.type === 'image') {
        width = AnimationUtils.getPropertyValue(node, 'props.width', currentTick) || 0;
        height = AnimationUtils.getPropertyValue(node, 'props.height', currentTick) || 0;
      } else if (node.type === 'precomp' && node.refId) {
        const refArtboard = currentNodes.get(node.refId);
        if (refArtboard) {
          width = (AnimationUtils.getPropertyValue(refArtboard, 'props.width', currentTick) || 0);
          height = (AnimationUtils.getPropertyValue(refArtboard, 'props.height', currentTick) || 0);
        }
      } else if (node.type === 'ellipse') {
        width = (node.props.radiusX || 0) * 2;
        height = (node.props.radiusY || 0) * 2;
      } else if (node.type === 'path') {
        const points = AnimationUtils.getPropertyValue(node, 'props.points', currentTick);
        const lb = getPathLocalBounds(points || []);
        width = lb.width;
        height = lb.height;
        offsetX = lb.x;
        offsetY = lb.y;
      } else if (node.type === 'group' || node.type === 'precomp') {
        const lb = getGroupLocalBounds(nodeId, currentNodes, currentTick);
        width = lb.width;
        height = lb.height;
        offsetX = lb.x;
        offsetY = lb.y;
      } else if (node.type === 'text') {
        const lb = getTextLocalBounds(node);
        width = lb.width; height = lb.height; offsetX = lb.x; offsetY = lb.y;
      }

      const handles = [
        { ...localToScreen(offsetX, offsetY, combinedMatrix), index: 0 },         // nw
        { ...localToScreen(offsetX + width / 2, offsetY, combinedMatrix), index: 1 }, // n
        { ...localToScreen(offsetX + width, offsetY, combinedMatrix), index: 2 },     // ne
        { ...localToScreen(offsetX + width, offsetY + height / 2, combinedMatrix), index: 3 }, // e
        { ...localToScreen(offsetX + width, offsetY + height, combinedMatrix), index: 4 },     // se
        { ...localToScreen(offsetX + width / 2, offsetY + height, combinedMatrix), index: 5 }, // s
        { ...localToScreen(offsetX, offsetY + height, combinedMatrix), index: 6 },         // sw
        { ...localToScreen(offsetX, offsetY + height / 2, combinedMatrix), index: 7 },     // w
      ];

      // Skip handle detection when the shape is too small on screen — handles would
      // overlap the node and be impossible to use. User must zoom in first.
      const screenW = Math.hypot(handles[2].x - handles[0].x, handles[2].y - handles[0].y);
      const screenH = Math.hypot(handles[6].x - handles[0].x, handles[6].y - handles[0].y);
      if (screenW < MIN_HANDLE_SCREEN_PX || screenH < MIN_HANDLE_SCREEN_PX) continue;

      // 1. Check for Resize (priority)
      for (const h of handles) {
        const dist = Math.sqrt((screenX - h.x) ** 2 + (screenY - h.y) ** 2);
        if (dist < resizeRadius) return { nodeId, handleIndex: h.index, type: 'resize' as const };
      }

      // 2. Check for Rotation Zone (only on corners: 0, 2, 4, 6)
      if (node.type !== 'artboard') {
        const corners = [handles[0], handles[2], handles[4], handles[6]];
        for (const c of corners) {
          const dist = Math.sqrt((screenX - c.x) ** 2 + (screenY - c.y) ** 2);
          if (dist >= rotateRadiusInner && dist <= rotateRadiusOuter) {
            // Only allow rotation if NOT inside the actual node geometry
            if (!hitTestNode(node, scenePoint.x, scenePoint.y, currentNodes, currentTick)) {
              return { nodeId, handleIndex: c.index, type: 'rotate' as const };
            }
          }
        }
      }
    }
    return null;
  };

  const getGradientHandleAtPoint = (
    screenX: number,
    screenY: number,
    id: string,
    currentNodes: Map<string, SceneNode>,
    currentViewTransform: DOMMatrix,
    currentTick: number
  ) => {
    const node = currentNodes.get(id);
    if (!node || !isNodeSelectable(id, currentNodes)) return null;

    const checkGradient = (gradient: any, path: string) => {
      if (!gradient) return null;
      const worldMatrix = getWorldMatrix(id, currentNodes, currentTick);
      const combinedMatrix = currentViewTransform.multiply(worldMatrix);

      const start = localToScreen(gradient.start.x, gradient.start.y, combinedMatrix);
      const end = localToScreen(gradient.end.x, gradient.end.y, combinedMatrix);

      const dxStart = screenX - start.x;
      const dyStart = screenY - start.y;
      const dxEnd = screenX - end.x;
      const dyEnd = screenY - end.y;

      if (dxStart * dxStart + dyStart * dyStart < 100) return { type: 'start' as const, path, gradient };
      if (dxEnd * dxEnd + dyEnd * dyEnd < 100) return { type: 'end' as const, path, gradient };
      return null;
    };

    if (node.style.fillType === 'gradient') {
      const res = checkGradient(node.style.fillGradient, 'style.fillGradient');
      if (res) return res;
    }
    if (node.style.strokeType === 'gradient') {
      const res = checkGradient(node.style.strokeGradient, 'style.strokeGradient');
      if (res) return res;
    }
    return null;
  };

  // --- Font Loading ---
  // When GoogleFontsService confirms a font is loaded on the main thread, also load it in
  // the Web Worker (which has its own isolated FontFaceSet) and trigger a canvas re-render.
  useEffect(() => {
    const onFontReady = (e: Event) => {
      const { family, cssHref } = (e as CustomEvent).detail ?? {};
      // Forward to worker so OffscreenCanvas can use the font too.
      if (family && cssHref && rendererRef.current) {
        rendererRef.current.loadFont(family, cssHref);
      }
      // Re-render immediately (covers the main-thread fallback path).
      setFontsLoaded(prev => prev + 1);
    };
    window.addEventListener('gf-font-ready', onFontReady);
    return () => window.removeEventListener('gf-font-ready', onFontReady);
  }, []);

  // When the worker finishes loading a font into its own FontFaceSet, trigger a re-render
  // so the OffscreenCanvas picks up the now-available font.
  useEffect(() => {
    const onWorkerFont = () => setFontsLoaded(prev => prev + 1);
    window.addEventListener('gf-worker-font-ready', onWorkerFont);
    return () => window.removeEventListener('gf-worker-font-ready', onWorkerFont);
  }, []);

  // Scene font preloader: ensure every font used in scene nodes is loaded via the service.
  // The service fires 'gf-font-ready' when each font is confirmed usable by Canvas 2D.
  useEffect(() => {
    nodes.forEach(node => {
      if (node.type === 'text' && node.props.fontFamily) {
        loadFontCSS(node.props.fontFamily);
      }
    });
  }, [nodes]);


  const screenToCanvas = (screenX: number, screenY: number, currentTransform: DOMMatrix | null) => {
    if (!currentTransform) return { x: 0, y: 0 };
    const inverse = currentTransform.inverse();
    const point = new DOMPoint(screenX, screenY);
    const transformed = point.matrixTransform(inverse);
    return { x: transformed.x, y: transformed.y };
  };

  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  // Init & Resize Handling
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setCanvasSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        });
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Renderer lifecycle — only create/destroy on mount/unmount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Use WorkerRenderer: auto-detects OffscreenCanvas, falls back to main thread
    if (!rendererRef.current) {
      rendererRef.current = new WorkerRenderer(canvas);
    }

    const artboard = activeArtboardId ? nodes.get(activeArtboardId) : Array.from(nodes.values()).find(n => n.type === 'artboard');

    const commonCallbacks = {
      onNodeCreate: (node: SceneNode) => {
        if (artboard) node.parentId = artboard.id;
        setPreviewNode(node);
      },
      onNodeUpdate: (node: SceneNode) => {
        if (artboard) node.parentId = artboard.id;
        setPreviewNode({ ...node });
      },
      onNodeFinalize: (node: SceneNode) => {
        if (!node || node.id === 'dummy') {
          setPreviewNode(null);
          setActiveTool('select');
          return;
        }
        useCreatorStore.getState().addNodeToArtboard(node);
        setPreviewNode(null);
        setSelection([node.id]);
        setActiveTool('select');

        if (node.type === 'text') {
          setTimeout(() => {
            setTextEditState(createTextEditState(node.id, node.props.text || ''));
            hiddenInputRef.current?.focus();
          }, 50);
        }
      },
    };

    rectToolRef.current = new RectTool(commonCallbacks);
    ellipseToolRef.current = new EllipseTool(commonCallbacks);
    starToolRef.current = new StarTool(commonCallbacks);
    penToolRef.current = new PenTool(commonCallbacks);
    textToolRef.current = new TextTool(commonCallbacks);

    if (nodes.size === 0) {
      const artboard = createArtboardNode(500, 500, false);
      addNode(artboard);
    }

    return () => {
      // Cleanup worker on unmount
      if (rendererRef.current) {
        rendererRef.current.dispose();
        rendererRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resize handler — runs whenever canvasSize changes, without recreating the renderer
  useEffect(() => {
    if (rendererRef.current && canvasSize.width > 0 && canvasSize.height > 0) {
      rendererRef.current.resize(canvasSize.width, canvasSize.height);
    }
  }, [canvasSize]);

  // Optimized View Transform
  const viewTransform = useMemo(() => {
    if (canvasSize.width === 0) return null;
    const { zoom, pan } = viewport;
    const transform = new DOMMatrix();
    transform.translateSelf(canvasSize.width / 2, canvasSize.height / 2);
    transform.scaleSelf(zoom, zoom);
    transform.translateSelf(pan.x, pan.y);
    return transform;
  }, [canvasSize.width, canvasSize.height, viewport]);

  const getArtboardLocalPos = (p: { x: number, y: number }) => {
    const artboard = activeArtboardId ? nodes.get(activeArtboardId) : Array.from(nodes.values()).find(n => n.type === 'artboard');
    if (!artboard) return p;
    const worldMatrix = getWorldMatrix(artboard.id, nodes, currentTime, activeArtboardId || undefined);
    const localPoint = new DOMPoint(p.x, p.y).matrixTransform(worldMatrix.inverse());
    return { x: localPoint.x, y: localPoint.y };
  };

  // Zoom towards cursor
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      // Delta normalization for consistent feel across devices
      let deltaY = e.deltaY;
      if (e.deltaMode === 1) deltaY *= 20; // Lower multiplier for lines to keep it precise
      else if (e.deltaMode === 2) deltaY *= 400;

      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();

        setViewport(prev => {
          const currentZoom = prev.zoom;
          const currentPan = prev.pan;

          // Increased zoomSpeed for a more responsive, snappier feel (Figma/Lottielab style)
          const zoomSpeed = 0.01;
          const factor = Math.exp(-deltaY * zoomSpeed);
          const nextZoom = Math.min(Math.max(0.01, currentZoom * factor), 100);

          const rect = container.getBoundingClientRect();
          const screenX = e.clientX - rect.left;
          const screenY = e.clientY - rect.top;

          const viewCenterX = container.clientWidth / 2;
          const viewCenterY = container.clientHeight / 2;

          const worldAtMouseX = (screenX - viewCenterX) / currentZoom - currentPan.x;
          const worldAtMouseY = (screenY - viewCenterY) / currentZoom - currentPan.y;

          const nextPanX = (screenX - viewCenterX) / nextZoom - worldAtMouseX;
          const nextPanY = (screenY - viewCenterY) / nextZoom - worldAtMouseY;

          return { zoom: nextZoom, pan: { x: nextPanX, y: nextPanY } };
        });
      } else {
        // Panning logic
        e.preventDefault();
        let dx = e.deltaX;
        let dy = e.deltaY;

        if (e.deltaMode === 1) { dx *= 20; dy *= 20; }
        if (e.deltaMode === 2) { dx *= 400; dy *= 400; }

        // If Shift is held, vertical scroll becomes horizontal
        if (e.shiftKey && dy !== 0 && dx === 0) {
          dx = dy;
          dy = 0;
        }

        setViewport(prev => ({
          ...prev,
          pan: {
            x: prev.pan.x - dx / prev.zoom,
            y: prev.pan.y - dy / prev.zoom
          }
        }));
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [nodes]); // Reduced dependencies as we use viewportRef

  // Arrow Keys & Delete
  // Global Shortcuts for Undo/Redo & Tool Switching
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const state = useCreatorStore.getState();
      const activeEl = document.activeElement;
      const isInput = activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA' || (activeEl as HTMLElement)?.isContentEditable;
      const key = e.key.toUpperCase();

      // DIAGNOSTIC LOG
      if ((e.ctrlKey || e.metaKey)) {
        console.log(`🪄 Shortcut detected: ${e.metaKey ? 'Cmd' : 'Ctrl'}+${e.key}`);
      }

      // In state-flow mode, block all editing shortcuts (only allow Undo/Redo/Escape)
      if (state.creatorMode === 'state-flow') {
        // Allow undo/redo (handled above) and escape, block everything else
        if (key !== 'ESCAPE') return;
      }

      // 1. Tool-specific high priority handling (e.g., Pen Tool undoing a point)
      if (state.activeTool === 'pen' && penToolRef.current && state.previewNode) {
        const handled = penToolRef.current.onKeyDown(e.key, e);
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }

      // Undo / Redo
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'z')) {
        if (e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          console.log('➡️ Triggering REDO');
          state.redo();
          return;
        } else {
          // Check if we are in an input field
          if (isInput) return; // Let browser handle it

          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          console.log('⬅️ Triggering UNDO');
          state.undo();
          return;
        }
      }

      // Cmd+Y for Redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        state.redo();
        return;
      }

      const isTextEditing = isInput;
      if (isTextEditing) return;

      if (key === 'ESCAPE') {
        if (state.editingNodeId) {
          state.setEditingNode(null);
          return;
        }

        // Cancel any active interaction
        const currentInteraction = interactionRef.current;
        if (currentInteraction.type !== 'none') {
          if (currentInteraction.hasRecordedHistory) {
            state.undo();
          }
          setInteraction({ type: 'none', startPos: { x: 0, y: 0 } });
          return;
        }
      }

      if ((key === 'DELETE' || key === 'BACKSPACE') && state.activePanel === 'timeline') {
        // Handled by TimelinePanel listener to avoid double-fire
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (key === 'G')) {
        e.preventDefault();
        if (e.shiftKey) {
          if (state.selectedIds.length === 1) state.ungroupNodes(state.selectedIds[0]);
        } else {
          if (state.selectedIds.length > 0) state.groupNodes(state.selectedIds);
        }
        return;
      }

      // Select All (Ctrl+A)
      if ((e.ctrlKey || e.metaKey) && key === 'A') {
        if (!isInput) {
          e.preventDefault();
          e.stopPropagation();

          // Filter nodes to only include those within the active artboard
          const targetIds: string[] = [];
          if (state.activeArtboardId) {
            const traverse = (parentId: string) => {
              const p = state.nodes.get(parentId);
              if (p) {
                p.children.forEach(childId => {
                  const child = state.nodes.get(childId);
                  if (child && child.type !== 'artboard') {
                    targetIds.push(childId);
                    traverse(childId);
                  }
                });
              }
            };
            traverse(state.activeArtboardId);
          } else {
            // Fallback
            state.nodes.forEach((n, id) => {
              if (n.type !== 'artboard') targetIds.push(id);
            });
          }
          state.setSelection(targetIds);
        }
        return;
      }

      // Duplicate (Ctrl+D)
      if ((e.ctrlKey || e.metaKey) && key === 'D') {
        e.preventDefault();
        e.stopPropagation();
        state.duplicateSelection();
        return;
      }

      // Copy (Ctrl+C)
      if ((e.ctrlKey || e.metaKey) && key === 'C') {
        // Only trigger if not in an input
        if (!isInput) {
          e.preventDefault();
          e.stopPropagation();
          state.copySelection();
        }
        return;
      }

      // Paste (Ctrl+V)
      // Paste (Ctrl+V)
      if ((e.ctrlKey || e.metaKey) && key === 'V') {
        // Handled by global 'paste' event listener for clipboard data access
        return;
      }


      // Delete Node (Only if Canvas or Layers is active and not in an input field)
      if ((key === 'DELETE' || key === 'BACKSPACE') && !isInput && (state.activePanel === 'canvas' || state.activePanel === 'layers')) {
        if (state.selectedIds.length > 0) {
          e.preventDefault();
          state.pushToHistory(`Delete ${state.selectedIds.length > 1 ? 'Selected Layers' : 'Layer'}`);
          state.selectedIds.forEach(id => state.deleteNode(id));
          state.setSelection([]);
          return;
        }
      }

      // Tool switching shortcuts (Only if Canvas is active)
      if (!isInput && state.activePanel === 'canvas') {
        console.log('🖌️ Canvas Shortcut Triggered:', key);
        if (key === 'V') state.setActiveTool('select');
        if (key === 'R') state.setActiveTool('rect');
        if (key === 'O') state.setActiveTool('ellipse');
        if (key === 'P') state.setActiveTool('pen');
        if (key === 'T') state.setActiveTool('text');
      }

      // Arrow Key Nudging
      if (state.selectedIds.length === 0) return;
      const step = e.shiftKey ? 10 : 1;

      if (e.key.startsWith('Arrow')) {
        if (!isInput && state.activePanel === 'canvas') {
          e.preventDefault();
          state.pushToHistory('Nudge Objects');

          state.selectedIds.forEach(id => {
            const node = state.nodes.get(id);
            if (!node) return;

            const curX = AnimationUtils.getPropertyValue(node, 'transform.x', state.currentTime) || 0;
            const curY = AnimationUtils.getPropertyValue(node, 'transform.y', state.currentTime) || 0;

            if (e.key === 'ArrowLeft') state.setNodeProperty(id, 'transform.x', curX - step);
            if (e.key === 'ArrowRight') state.setNodeProperty(id, 'transform.x', curX + step);
            if (e.key === 'ArrowUp') state.setNodeProperty(id, 'transform.y', curY - step);
            if (e.key === 'ArrowDown') state.setNodeProperty(id, 'transform.y', curY + step);
          });
        }
      }
    };
    const handlePaste = async (e: ClipboardEvent) => {
      const state = useCreatorStore.getState();
      const activeEl = document.activeElement;
      const isInput = activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA' || (activeEl as HTMLElement)?.isContentEditable;

      if (isInput) return;

      // Allow pasting if focused on main editor areas
      const allowedPanels = ['canvas', 'layers', 'timeline', 'none'];
      if (!allowedPanels.includes(state.activePanel)) return;

      console.log('📋 Paste event detected, active panel:', state.activePanel);

      // 1. Check if we have internal clipboard data
      if (state.clipboard && state.clipboard.length > 0) {
        console.log('📦 Using internal clipboard data');
        e.preventDefault();
        state.pasteSelection();
        return;
      }

      // 2. Otherwise try to parse system SVG (Figma, etc.)
      if (e.clipboardData && e.clipboardData.types.some(t => t.includes('svg') || t.includes('plain') || t.includes('html'))) {
        console.log('🎨 Attempting to parse system clipboard as SVG...');
        const artboard = (state as any).activeArtboardId ? state.nodes.get((state as any).activeArtboardId) : Array.from(state.nodes.values()).find(n => n.type === 'artboard');
        const duration = artboard?.props.duration || 100000;
        const nodes = await SVGImporter.parseClipboard(e.clipboardData, duration);
        if (nodes && nodes.length > 0) {
          console.log(`✅ Successfully parsed ${nodes.length} SVG nodes from clipboard`);
          e.preventDefault();

          // Find artboard to center the new nodes
          const artboard = (state as any).activeArtboardId ? state.nodes.get((state as any).activeArtboardId) : Array.from(state.nodes.values()).find(n => n.type === 'artboard');
          if (artboard) {
            // Calculate center of imported nodes to offset them
            const topLevelNodes = nodes.filter(n => !n.parentId);
            const topLevelIds = topLevelNodes.map(n => n.id);

            // Name top-level nodes according to 'svg', 'svg_1', 'svg_2' pattern
            const existingNames = new Set(Array.from(state.nodes.values()).map(n => n.name));
            topLevelNodes.forEach(node => {
              let newName = 'svg';
              if (existingNames.has(newName)) {
                let i = 1;
                while (existingNames.has(`svg_${i}`)) {
                  i++;
                }
                newName = `svg_${i}`;
              }
              node.name = newName;
              existingNames.add(newName);
            });

            const bounds = getCollectiveBoundingBox(topLevelIds, new Map(nodes.map(n => [n.id, n])));

            const targetX = artboard.transform.x + artboard.props.width / 2;
            const targetY = artboard.transform.y + artboard.props.height / 2;

            const offsetX = targetX - (bounds.x + bounds.width / 2);
            const offsetY = targetY - (bounds.y + bounds.height / 2);

            nodes.forEach(node => {
              if (!node.parentId) {
                node.parentId = artboard.id;
                if (!node.transform) node.transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, anchorAlignX: 0.5, anchorAlignY: 0.5 };
                
                // Apply the artboard-centering offset
                node.transform.x += offsetX;
                node.transform.y += offsetY;
              }
            });

            state.addNodesBatch(nodes);
            state.setSelection(topLevelIds);

            // Link top level nodes to artboard children
            const updatedArtboard = { ...artboard, children: [...artboard.children, ...topLevelIds] };
            state.updateNode(artboard.id, updatedArtboard);
          } else {
            const topLevelNodes = nodes.filter(n => !n.parentId);
            const topLevelIds = topLevelNodes.map(n => n.id);

            // Name top-level nodes according to 'svg', 'svg_1', 'svg_2' pattern
            const existingNames = new Set(Array.from(state.nodes.values()).map(n => n.name));
            topLevelNodes.forEach(node => {
              let newName = 'svg';
              if (existingNames.has(newName)) {
                let i = 1;
                while (existingNames.has(`svg_${i}`)) {
                  i++;
                }
                newName = `svg_${i}`;
              }
              node.name = newName;
              existingNames.add(newName);
            });

            state.addNodesBatch(nodes);
            state.setSelection(topLevelIds);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('paste', handlePaste);
    };
  }, []);

  // --- P0 Performance: Standalone Render Loop ---
  // React-driven scene sync: updates nodes/viewTransform/etc. when the scene changes.
  // Does NOT depend on currentTime — that's handled by the rAF loop below.
  const renderDirtyRef = useRef(0); // Monotonic counter bumped on scene changes

  useEffect(() => {
    if (!rendererRef.current || !canvasRef.current || canvasSize.width === 0) return;
    const artboard = activeArtboardId ? nodes.get(activeArtboardId) : Array.from(nodes.values()).find(n => n.type === 'artboard');
    if (!artboard) return;

    // Performance: only copy the Map when there's a preview node
    let renderNodes: Map<string, typeof artboard>;
    if (previewNode) {
      renderNodes = new Map(nodes);
      renderNodes.set(previewNode.id, previewNode);
      const artboardCopy = { ...artboard, children: [...artboard.children, previewNode.id] };
      renderNodes.set(artboard.id, artboardCopy);
    } else {
      renderNodes = nodes;
    }

    rendererRef.current.setNodes(renderNodes);
    renderDirtyRef.current++; // Signal the rAF loop to redraw
  }, [nodes, viewTransform, previewNode, editingNodeId, textEditState, fontsLoaded, activeArtboardId]);

  // Standalone rAF render loop — renders every frame WITHOUT triggering React.
  // Reads currentTime directly from Zustand's getState() (no React subscription needed for rendering).
  useEffect(() => {
    let rafId: number;
    let lastRenderedTime = -1;
    let lastDirty = -1;

    const renderLoop = () => {
      rafId = requestAnimationFrame(renderLoop);

      if (!rendererRef.current || !canvasRef.current || canvasSize.width === 0) return;

      const storeState = useCreatorStore.getState();
      const storeTime = storeState.currentTime;
      const dirty = renderDirtyRef.current;

      // Skip Canvas2D during ThorVG playback — ThorVG is the renderer during play.
      // While paused, Canvas2D renders on top for instant drag/resize/rotate feedback.
      if (storeState.isPlaying) return;

      // Only render if something changed: currentTime advanced OR scene was modified
      if (storeTime === lastRenderedTime && dirty === lastDirty) return;

      lastRenderedTime = storeTime;
      lastDirty = dirty;

      const artboard = activeArtboardId
        ? nodes.get(activeArtboardId)
        : Array.from(nodes.values()).find(n => n.type === 'artboard');
      if (!artboard || !viewTransform) return;

      // ThorVG (z-21) covers all shape content — Canvas2D only draws artboard chrome
      // (background, border, grid, guides). Skip layer content whenever ThorVG is active.
      const skipLottieContent = !!(dotlottieRef.current);

      rendererRef.current.render(
        artboard.id,
        viewTransform,
        storeTime,
        editingNodeId || (previewNode ? previewNode.id : null),
        null,  // Phase 3: always render text on canvas; cursor/selection via TextEditOverlay
        null,
        skipLottieContent
      );
    };

    rafId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(rafId);
  }, [canvasSize.width, canvasSize.height, nodes, viewTransform, activeArtboardId, editingNodeId, previewNode]);

  // Initial Centering Logic
  useEffect(() => {
    const artboard = activeArtboardId ? nodes.get(activeArtboardId) : Array.from(nodes.values()).find(n => n.type === 'artboard');
    if (artboard && canvasSize.width > 0) {
      // Set initial pan to center the artboard
      // We want artboard center (W/2, H/2) to map to world (0,0) in our centered view
      setViewport(prev => ({
        ...prev,
        pan: {
          x: -(artboard.transform.x + artboard.props.width / 2),
          y: -(artboard.transform.y + artboard.props.height / 2)
        }
      }));
    }
  }, [canvasSize.width > 0, nodes.size > 0, activeArtboardId]);

  // Cursor Calculation
  const RESIZE_CURSORS = ['nw-resize', 'n-resize', 'ne-resize', 'e-resize', 'se-resize', 's-resize', 'sw-resize', 'w-resize'];
  const getCursor = () => {
    if (isSpacePressed) return interaction.type === 'pan' ? 'grabbing' : 'grab';
    if (interaction.type === 'marquee') return 'crosshair';
    // During an active resize keep showing the directional arrow for the grabbed handle
    if (interaction.type === 'resize') return RESIZE_CURSORS[interaction.handleIndex ?? 0] || 'nw-resize';
    // During an active rotate keep the rotation cursor
    if (interaction.type === 'rotate') return ROTATE_CURSOR;
    if (interaction.type !== 'none') return 'grabbing';
    if (activeTool !== 'select') return 'crosshair';

    if (hoveredHandle) {
      if (editingNodeId === hoveredHandle.nodeId) return 'default';
      if (hoveredHandle.type === 'rotate') return ROTATE_CURSOR;
      return RESIZE_CURSORS[hoveredHandle.handleIndex] || 'default';
    }

    if (hoveredNodeId) {
      const node = nodes.get(hoveredNodeId);
      if (node && node.type !== 'artboard') return 'move';
    }

    return 'default';
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setActivePanel('canvas');
    const container = containerRef.current;
    if (!container || !viewTransform) return;
    const rect = container.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const canvasPos = screenToCanvas(screenX, screenY, viewTransform);

    const state = useCreatorStore.getState();

    // Stop playback immediately on canvas click — lets user scrub/select at that frame
    if (state.isPlaying) {
      state.setPlaying(false);
      return;
    }

    // In state-flow mode OR during SM playback: only fire interaction events, no editing
    if (state.smIsPlaying || state.creatorMode === 'state-flow') {
      const artboard = state.activeArtboardId ? state.nodes.get(state.activeArtboardId) : Array.from(state.nodes.values()).find((n: any) => n.type === 'artboard');
      const artboardLocal = getArtboardLocalPos(canvasPos);
      const hitInteractionLayerId = findHoveredInteractionLayer(artboardLocal.x, artboardLocal.y, state, artboard?.id);

      if (hitInteractionLayerId) {
        activePointerTargetRef.current = hitInteractionLayerId;
        processStateInteraction('PointerDown', hitInteractionLayerId, state, true);
      } else {
        activePointerTargetRef.current = null;
      }

      // Still allow panning with space bar in state-flow mode
      if (state.creatorMode === 'state-flow' && !state.smIsPlaying && isSpacePressed) {
        setInteraction({
          type: 'pan',
          startPos: { x: screenX, y: screenY },
          initialPan: { ...viewport.pan }
        });
      }
      return;
    }

    if (isSpacePressed) {
      setInteraction({
        type: 'pan',
        startPos: { x: screenX, y: screenY },
        initialPan: { ...viewport.pan }
      });
      return;
    }

    // Phase 3: Canvas-native text editing — click to position cursor
    if (textEditState) {
      const node = nodes.get(textEditState.nodeId);
      if (node && viewTransform) {
        const worldMatrix = getWorldMatrix(textEditState.nodeId, nodes, currentTime, activeArtboardId || undefined);
        const combined = viewTransform.multiply(worldMatrix);
        const inv = combined.inverse();
        const localMouse = new DOMPoint(screenX, screenY).matrixTransform(inv);
        const idx = getCharIndexAtPoint(localMouse.x, localMouse.y, node);
        setTextEditState(prev => prev ? {
          ...prev,
          cursorIndex: idx,
          selectionStart: e.shiftKey ? prev.selectionStart : idx,
          selectionEnd: idx,
        } : null);
        hiddenInputRef.current?.focus();
        e.stopPropagation();
        return;
      }
      // Clicked outside the text node — exit edit mode
      setTextEditState(null);
    }

    if (activeTool === 'select') {
      // 1. Check for path editing hits if in isolation mode
      if (editingNodeId) {
        const node = nodes.get(editingNodeId);
        if (node && node.type === 'path') {
          const worldMatrix = getWorldMatrix(editingNodeId, nodes, currentTime, activeArtboardId || undefined);
          const combinedMatrix = viewTransform.multiply(worldMatrix);
          const inv = combinedMatrix.inverse();
          const localMouse = new DOMPoint(screenX, screenY).matrixTransform(inv);

          const points = (AnimationUtils.getPropertyValue(node, 'props.points', currentTime) || []) as any[];
          const hitRadius = 10 / viewport.zoom; // Visual radius adjusted for zoom

          for (let i = 0; i < points.length; i++) {
            const p = points[i];

            // Check Vertex
            if (Math.sqrt((localMouse.x - p.x) ** 2 + (localMouse.y - p.y) ** 2) < hitRadius) {
              setInteraction({
                type: 'edit_path',
                nodeId: editingNodeId,
                vertexIndex: i,
                handleType: 'vertex',
                startPos: { x: screenX, y: screenY },
                initialProps: { ...node.props, points },
                initialLocalMousePos: { x: localMouse.x, y: localMouse.y }
              });
              return;
            }

            // Check Control Handles
            const inH = { x: p.x + p.inX, y: p.y + p.inY };
            const outH = { x: p.x + p.outX, y: p.y + p.outY };

            if (Math.sqrt((localMouse.x - inH.x) ** 2 + (localMouse.y - inH.y) ** 2) < hitRadius) {
              setInteraction({
                type: 'edit_path',
                nodeId: editingNodeId,
                vertexIndex: i,
                handleType: 'in',
                startPos: { x: screenX, y: screenY },
                initialProps: { ...node.props, points },
                initialLocalMousePos: { x: localMouse.x, y: localMouse.y }
              });
              return;
            }

            if (Math.sqrt((localMouse.x - outH.x) ** 2 + (localMouse.y - outH.y) ** 2) < hitRadius) {
              setInteraction({
                type: 'edit_path',
                nodeId: editingNodeId,
                vertexIndex: i,
                handleType: 'out',
                startPos: { x: screenX, y: screenY },
                initialProps: { ...node.props, points },
                initialLocalMousePos: { x: localMouse.x, y: localMouse.y }
              });
              return;
            }
          }
        }

        // If we reach here, we are in isolation mode but didn't hit a vertex/handle.
        // Check if we hit another node to exit isolation.
        const artboard = activeArtboardId ? nodes.get(activeArtboardId) : Array.from(nodes.values()).find(n => n.type === 'artboard');
        const artboardLocal = getArtboardLocalPos(canvasPos);
        const hNodeId = findNodeAtPoint(artboardLocal.x, artboardLocal.y, nodes, artboard?.id || null, e.ctrlKey || e.metaKey, currentTime, artboard?.id || undefined);
        if (hNodeId !== editingNodeId) {
          setEditingNode(null);
        }
      }

      // 1.5. Check for gradient handle hits
      if (selectedIds.length === 1) {
        const gradHandle = getGradientHandleAtPoint(screenX, screenY, selectedIds[0], nodes, viewTransform, currentTime);
        if (gradHandle) {
          setInteraction({
            type: 'edit_gradient',
            nodeId: selectedIds[0],
            gradientHandle: gradHandle.type,
            initialProps: gradHandle.path,
            startPos: { x: screenX, y: screenY },
            initialLocalMousePos: { ...(gradHandle.type === 'start' ? gradHandle.gradient.start : gradHandle.gradient.end) },
            initialWorldMatrix: getWorldMatrix(selectedIds[0], nodes, currentTime, activeArtboardId || undefined)
          });
          return;
        }
      }
      
      // 1.8. Check for Polystar handle hits
      if (selectedIds.length === 1) {
        const nodeId = selectedIds[0];
        const node = nodes.get(nodeId);
        if (node && node.type === 'polystar') {
           const worldMatrix = getWorldMatrix(nodeId, nodes, currentTime, activeArtboardId || undefined);
           const combinedMatrix = viewTransform.multiply(worldMatrix);
           const inv = combinedMatrix.inverse();
           const localMouse = new DOMPoint(screenX, screenY).matrixTransform(inv);
           const hitRadius = 15 / viewport.zoom;

           // Outer Radius Handle (at top: 0, -outerRadius)
           const outerRadius = AnimationUtils.getPropertyValue(node, 'props.outerRadius', currentTime) ?? 50;
           if (Math.sqrt(localMouse.x**2 + (localMouse.y - (-outerRadius))**2) < hitRadius) {
             setInteraction({
               type: 'adjust_polystar' as any,
               nodeId,
               handleType: 'outerRadius',
               startPos: { x: screenX, y: screenY },
               initialProps: { ...node.props }
             });
             return;
           }
           
           // Inner Radius Handle
           const isStar = node.props?.starType === 'star' || !node.props?.starType;
           if (isStar) {
             const innerRadius = AnimationUtils.getPropertyValue(node, 'props.innerRadius', currentTime) ?? 25;
             const angle = -Math.PI/2 + (Math.PI * 2 / (node.props.points * 2));
             const hx = innerRadius * Math.cos(angle);
             const hy = innerRadius * Math.sin(angle);
             if (Math.sqrt((localMouse.x - hx)**2 + (localMouse.y - hy)**2) < hitRadius) {
                setInteraction({
                  type: 'adjust_polystar' as any,
                  nodeId,
                  handleType: 'innerRadius',
                  startPos: { x: screenX, y: screenY },
                  initialProps: { ...node.props }
                });
                return;
             }
           }
        }
      }

      const handleHit = getHandleAtPoint(screenX, screenY, selectedIds, nodes, viewTransform, currentTime);
      // Disable resize/rotate for the node being edited in isolation mode
      if (handleHit && handleHit.nodeId === editingNodeId) {
        // Do nothing, let it fall through to potential move or marquee
      } else if (handleHit) {
        if (handleHit.nodeId === 'selection') {
          // --- Multi-Selection Logic ---
          const bounds = getCollectiveBoundingBox(selectedIds, nodes, currentTime);
          const selectionCenter = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
          const selectionWorldMatrix = new DOMMatrix().translate(selectionCenter.x, selectionCenter.y);
          const selectionWorldInverse = selectionWorldMatrix.inverse();

          // Determine fixed point for resizing (opposite of handle)
          let fx = bounds.x + bounds.width / 2;
          let fy = bounds.y + bounds.height / 2;
          const { handleIndex } = handleHit;
          if ([0, 1, 2].includes(handleIndex)) fy = bounds.y + bounds.height;
          if ([4, 5, 6].includes(handleIndex)) fy = bounds.y;
          if ([0, 6, 7].includes(handleIndex)) fx = bounds.x + bounds.width;
          if ([2, 3, 4].includes(handleIndex)) fx = bounds.x;

          const selectionNodesData: Record<string, any> = {};
          selectedIds.forEach(id => {
            const node = nodes.get(id);
            if (!node) return;

            const worldMatrix = getWorldMatrix(id, nodes, currentTime, activeArtboardId || undefined);
            const parentId = (node.parentLayerId && nodes.has(node.parentLayerId)) ? node.parentLayerId : node.parentId;
            const parentWorldInverse = parentId ? getWorldMatrix(parentId, nodes, currentTime, activeArtboardId || undefined).inverse() : new DOMMatrix();

            selectionNodesData[id] = {
              worldMatrix,
              parentWorldMatrixInverse: parentWorldInverse,
              localToSelectionMatrix: selectionWorldInverse.multiply(worldMatrix)
            };
          });

          // For collective rotation, find screen center of selection
          const screenCenter = localToScreen(selectionCenter.x, selectionCenter.y, viewTransform);

          setInteraction({
            type: handleHit.type,
            nodeId: 'selection',
            handleIndex: handleHit.handleIndex,
            startPos: { x: screenX, y: screenY },
            initialSelectionData: {
              center: selectionCenter,
              fixedPoint: { x: fx, y: fy },
              bounds: bounds,
              nodes: selectionNodesData
            },
            initialViewTransform: viewTransform,
            lastAngle: Math.atan2(screenY - screenCenter.y, screenX - screenCenter.x) * 180 / Math.PI,
            totalRotation: 0, // Selection starts at 0 relative rotation
            currentPos: { x: screenX, y: screenY }
          });
          return;
        }

        const node = nodes.get(handleHit.nodeId);
        if (node) {
          const worldMatrix = getWorldMatrix(handleHit.nodeId, nodes, currentTime, activeArtboardId || undefined);
          const combinedMatrix = viewTransform.multiply(worldMatrix);

          let initialWidth = 0, initialHeight = 0, offsetX = 0, offsetY = 0;
          if (node.type === 'rect' || node.type === 'artboard' || node.type === 'image') {
            initialWidth = AnimationUtils.getPropertyValue(node, 'props.width', currentTime) || 0;
            initialHeight = AnimationUtils.getPropertyValue(node, 'props.height', currentTime) || 0;
          } else if (node.type === 'precomp' && node.refId) {
            const refArtboard = nodes.get(node.refId);
            if (refArtboard) {
              initialWidth = (AnimationUtils.getPropertyValue(refArtboard, 'props.width', currentTime) || 0);
              initialHeight = (AnimationUtils.getPropertyValue(refArtboard, 'props.height', currentTime) || 0);
            }
          } else if (node.type === 'ellipse') {
            initialWidth = (AnimationUtils.getPropertyValue(node, 'props.radiusX', currentTime) || 0) * 2;
            initialHeight = (AnimationUtils.getPropertyValue(node, 'props.radiusY', currentTime) || 0) * 2;
          } else if (node.type === 'path') {
            const points = AnimationUtils.getPropertyValue(node, 'props.points', currentTime);
            const lb = getPathLocalBounds(points || []);
            initialWidth = lb.width; initialHeight = lb.height; offsetX = lb.x; offsetY = lb.y;
          } else if (node.type === 'group' || node.type === 'precomp') {
            const lb = getGroupLocalBounds(handleHit.nodeId, nodes, currentTime);
            initialWidth = lb.width; initialHeight = lb.height; offsetX = lb.x; offsetY = lb.y;
          } else if (node.type === 'text') {
            const boxW = AnimationUtils.getPropertyValue(node, 'props.width', currentTime) || 0;
            const boxH = AnimationUtils.getPropertyValue(node, 'props.height', currentTime) || 0;
            if (boxW > 0) {
              // Area text — use exact box
              initialWidth = boxW; initialHeight = boxH;
              const vert = node.props.verticalAlign || 'top';
              offsetY = vert === 'middle' ? -boxH / 2 : vert === 'bottom' ? -boxH : 0;
            } else {
              // Point text — accurate measurement via TextMeasurer
              const lb = getTextLocalBounds(node);
              initialWidth = lb.width; initialHeight = lb.height; offsetX = lb.x; offsetY = lb.y;
            }
          }

          const anchor = getAnimatedAnchor(node, nodes, currentTime);
          let fixedX = anchor.x;
          let fixedY = anchor.y;

          let movingX = 0, movingY = 0;
          switch (handleHit.handleIndex) {
            case 0: movingX = offsetX; movingY = offsetY; break;
            case 1: movingX = offsetX + initialWidth / 2; movingY = offsetY; break;
            case 2: movingX = offsetX + initialWidth; movingY = offsetY; break;
            case 3: movingX = offsetX + initialWidth; movingY = offsetY + initialHeight / 2; break;
            case 4: movingX = offsetX + initialWidth; movingY = offsetY + initialHeight; break;
            case 5: movingX = offsetX + initialWidth / 2; movingY = offsetY + initialHeight; break;
            case 6: movingX = offsetX; movingY = offsetY + initialHeight; break;
            case 7: movingX = offsetX; movingY = offsetY + initialHeight / 2; break;
          }

          const isStandardResize = e.ctrlKey || e.metaKey;
          if (isStandardResize) {
            // "Standard" behavior: Opposite handle remains fixed
            switch (handleHit.handleIndex) {
              case 0: fixedX = offsetX + initialWidth; fixedY = offsetY + initialHeight; break;
              case 1: fixedX = offsetX + initialWidth / 2; fixedY = offsetY + initialHeight; break;
              case 2: fixedX = offsetX; fixedY = offsetY + initialHeight; break;
              case 3: fixedX = offsetX; fixedY = offsetY + initialHeight / 2; break;
              case 4: fixedX = offsetX; fixedY = offsetY; break;
              case 5: fixedX = offsetX + initialWidth / 2; fixedY = offsetY; break;
              case 6: fixedX = offsetX + initialWidth; fixedY = offsetY; break;
              case 7: fixedX = offsetX + initialWidth; fixedY = offsetY + initialHeight / 2; break;
            }
          }

          const inv = combinedMatrix.inverse();
          const localMouse = new DOMPoint(screenX, screenY).matrixTransform(inv);

          const interactionTransform = {
            x: AnimationUtils.getPropertyValue(node, 'transform.x', currentTime),
            y: AnimationUtils.getPropertyValue(node, 'transform.y', currentTime),
            rotation: AnimationUtils.getPropertyValue(node, 'transform.rotation', currentTime),
            scaleX: AnimationUtils.getPropertyValue(node, 'transform.scaleX', currentTime),
            scaleY: AnimationUtils.getPropertyValue(node, 'transform.scaleY', currentTime),
            anchorX: AnimationUtils.getPropertyValue(node, 'transform.anchorX', currentTime),
            anchorY: AnimationUtils.getPropertyValue(node, 'transform.anchorY', currentTime),
          };

          // To keep a point fixed in PARENT space, we must transform the local fixed point
          // through the node's own local matrix (which is Local -> Parent).
          const nodeLocalMatrix = createTransformMatrix(interactionTransform, nodes, node);
          const fixedParentPos = nodeLocalMatrix.transformPoint(new DOMPoint(fixedX, fixedY));

          setInteraction({
            type: handleHit.type,
            nodeId: handleHit.nodeId,
            handleIndex: handleHit.handleIndex,
            startPos: { x: screenX, y: screenY },
            initialTransform: interactionTransform,
            initialProps: { ...node.props },
            initialWorldMatrix: worldMatrix,
            initialFixedParentPos: fixedParentPos,
            initialFixedLocalPos: { x: fixedX, y: fixedY },
            initialOffsetX: (offsetX as number) || 0,
            initialOffsetY: (offsetY as number) || 0,
            initialWidth: initialWidth,
            initialHeight: initialHeight,
            initialComputedAnchor: { x: anchor.x, y: anchor.y },
            initialScreenFixedPoint: localToScreen(fixedX, fixedY, combinedMatrix),
            initialLocalMousePos: { x: localMouse.x, y: localMouse.y },
            isAnchorHandleX: Math.abs(movingX - anchor.x) < 0.1,
            isAnchorHandleY: Math.abs(movingY - anchor.y) < 0.1,
            initialPan: { ...viewport.pan },
            initialViewTransform: viewTransform,
            lastAngle: Math.atan2(screenY - localToScreen(offsetX + initialWidth / 2, offsetY + initialHeight / 2, combinedMatrix).y, screenX - localToScreen(offsetX + initialWidth / 2, offsetY + initialHeight / 2, combinedMatrix).x) * 180 / Math.PI,
            totalRotation: interactionTransform.rotation,
            initialChildrenData: Array.from(nodes.entries()).reduce((acc, [childId, child]) => {
              if (child.parentLayerId === handleHit.nodeId) {
                acc[childId] = {
                  id: childId,
                  transform: { ...child.transform },
                  worldMatrix: getWorldMatrix(childId, nodes, currentTime, activeArtboardId || undefined),
                  parentWorldMatrix: worldMatrix,
                  localPosition: { x: child.transform.x, y: child.transform.y }
                };
              }
              return acc;
            }, {} as Record<string, any>)
          });
          return;
        }
      }

      const artboard = activeArtboardId ? nodes.get(activeArtboardId) : Array.from(nodes.values()).find(n => n.type === 'artboard');

      // Check for Artboard Metadata Label Hit (specific area above top-left)
      if (artboard) {
        const worldMatrix = getWorldMatrix(artboard.id, nodes, currentTime, activeArtboardId || undefined);
        const combinedMatrix = viewTransform.multiply(worldMatrix);
        const tl = localToScreen(0, 0, combinedMatrix);

        // Detect hit in a small rectangle above the artboard (where the label is)
        if (screenX >= tl.x && screenX <= tl.x + 150 && screenY >= tl.y - 30 && screenY <= tl.y) {
          setSelection([artboard.id]);
          setInteraction({
            type: 'move',
            nodeId: artboard.id,
            hasMoved: false,
            startPos: { x: canvasPos.x, y: canvasPos.y },
            currentPos: { x: screenX, y: screenY },
            initialTransform: {
              x: AnimationUtils.getPropertyValue(artboard, 'transform.x', currentTime),
              y: AnimationUtils.getPropertyValue(artboard, 'transform.y', currentTime),
            }
          });
          return;
        }
      }

      const artboardLocal = getArtboardLocalPos(canvasPos);

      // Try ThorVG pixel-level hit testing first (accurate for both imported and from-scratch).
      // Falls back to Canvas2D matrix-based hit testing when ThorVG is not available/loaded.
      let hitNodeId: string | null = null;
      if (dotlottieRef.current && !lottieNeedsReload && artboard) {
        hitNodeId = hitTestThorVGLayers(
          screenX, screenY,
          canvasSize.width, canvasSize.height,
          viewport.zoom, viewport.pan,
          artboard.children,
          nodes,
          currentTime,
          AnimationUtils.getPropertyValue(artboard, 'props.width', currentTime) || 0,
          AnimationUtils.getPropertyValue(artboard, 'props.height', currentTime) || 0,
        );
      }
      if (!hitNodeId) {
        hitNodeId = findNodeAtPoint(artboardLocal.x, artboardLocal.y, nodes, artboard?.id || null, e.ctrlKey || e.metaKey, currentTime, artboard?.id || undefined);
      }

      if (hitNodeId) {
        let nextSelectedIds = selectedIds;
        if (e.shiftKey) {
          if (isSelected(hitNodeId)) {
            removeFromSelection(hitNodeId);
            nextSelectedIds = selectedIds.filter(id => id !== hitNodeId);
          } else {
            addToSelection(hitNodeId);
            nextSelectedIds = [...selectedIds, hitNodeId];
          }
        } else {
          // New: if hit item is NOT selected, select only it and move.
          // If it IS already selected, keep group selected to move group (standard tool behavior).
          if (!isSelected(hitNodeId)) {
            setSelection([hitNodeId]);
            nextSelectedIds = [hitNodeId];
          }
        }

        // Prepare initial transforms for all nodes that will be moved
        const moveInitialTransforms: Record<string, { x: number, y: number }> = {};
        nextSelectedIds.forEach(id => {
          const n = nodes.get(id);
          if (n) {
            moveInitialTransforms[id] = {
              x: AnimationUtils.getPropertyValue(n, 'transform.x', currentTime),
              y: AnimationUtils.getPropertyValue(n, 'transform.y', currentTime)
            };
          }
        });

        const initialBounds = getCollectiveBoundingBox(nextSelectedIds, nodes, currentTime, activeArtboardId || undefined);
        setInteraction({
          type: 'move',
          nodeId: hitNodeId,
          initialClickId: hitNodeId,
          hasMoved: false,
          startPos: { x: canvasPos.x, y: canvasPos.y },
          currentPos: { x: screenX, y: screenY },
          initialTransforms: moveInitialTransforms,
          initialTransform: moveInitialTransforms[hitNodeId],
          initialSelectionBounds: initialBounds
        });
      } else {
        if (!e.shiftKey) {
          setSelection([]);
        }
        setInteraction({ type: 'marquee', startPos: { x: screenX, y: screenY }, currentPos: { x: screenX, y: screenY } });
      }
    } else {
      const localPos = getArtboardLocalPos(canvasPos);
      const toolEvent = { x: localPos.x, y: localPos.y, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey };
      if (activeTool === 'rect' && rectToolRef.current) rectToolRef.current.onMouseDown(toolEvent);
      if (activeTool === 'ellipse' && ellipseToolRef.current) ellipseToolRef.current.onMouseDown(toolEvent);
      if (activeTool === 'star' && starToolRef.current) starToolRef.current.onMouseDown(toolEvent);
      if (activeTool === 'pen' && penToolRef.current) penToolRef.current.onMouseDown(toolEvent);
      if (activeTool === 'text' && textToolRef.current) textToolRef.current.onMouseDown(toolEvent);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

      if (e.altKey) setIsAltPressed(true);
      if (e.key === ' ') {
        if (!isSpacePressed) {
          setIsSpacePressed(true);
          setSpacePressedAt(Date.now());
          setHasMovedDuringSpace(false);
        }
        e.preventDefault();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      if (!e.altKey) setIsAltPressed(false);
      if (e.key === ' ') {
        setIsSpacePressed(false);
        const duration = Date.now() - spacePressedAt;
        if (duration < 300 && !hasMovedDuringSpace) {
          const state = useCreatorStore.getState();
          if (state.creatorMode === 'state-flow') {
            state.toggleSmPlaying();
          } else {
            state.togglePlaying();
          }
        }
      }
    };
    const handleForceRender = () => setCanvasSize(s => ({...s}));
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('editor:forceRender', handleForceRender);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('editor:forceRender', handleForceRender);
    };
  }, [isSpacePressed, spacePressedAt, hasMovedDuringSpace, selectedIds]); // Changed back to correct logic

  // Re-calculate measurement when Alt or Selection changes
  useEffect(() => {
    if (interaction.type === 'none' && activeTool === 'select' && isAltPressed && selectedIds.length > 0) {
      const artboard = activeArtboardId ? nodes.get(activeArtboardId) : Array.from(nodes.values()).find(n => n.type === 'artboard');
      const artboardLocal = getArtboardLocalPos(mouseCanvasPosRef.current);
      const hoveredId = findNodeAtPoint(artboardLocal.x, artboardLocal.y, nodes, artboard?.id || null, false, currentTime, artboard?.id || undefined);

      let targetArtboard = activeArtboardId ? nodes.get(activeArtboardId) : null;
      if (!targetArtboard && selectedIds.length > 0) {
        let curr = nodes.get(selectedIds[0]);
        while (curr && curr.parentId) {
          const parent = nodes.get(curr.parentId);
          if (parent?.type === 'artboard') { targetArtboard = parent; break; }
          curr = parent;
        }
      }
      if (!targetArtboard) targetArtboard = Array.from(nodes.values()).find(n => n.type === 'artboard');

      if (hoveredId && !selectedIds.includes(hoveredId)) {
        setMeasurementTargetId(hoveredId);
      } else if (targetArtboard && !selectedIds.includes(targetArtboard.id)) {
        setMeasurementTargetId(targetArtboard.id);
      } else {
        setMeasurementTargetId(null);
      }
    } else {
      setMeasurementTargetId(null);
    }
  }, [isAltPressed, selectedIds, interaction.type, activeTool, activeArtboardId, nodes, currentTime]);

  useEffect(() => {
    if (interaction.type === 'none') {
      setActiveGuides({ x: null, y: null });
    }
  }, [interaction.type]);

  // Tool Switching Cleanup
  const prevToolRef = useRef(activeTool);
  useEffect(() => {
    if (prevToolRef.current === 'pen' && activeTool !== 'pen' && penToolRef.current) {
      penToolRef.current.finalize();
    }
    prevToolRef.current = activeTool;
  }, [activeTool]);

  useEffect(() => {
    (window as any).startMotionPathDrag = (nodeId: string, time: number, handleType: 'kf' | 'in' | 'out', initialPos: { x: number, y: number }, initialHandle: { x: number, y: number }, startScreenPos: { x: number, y: number }, isSegment?: boolean, timeEnd?: number) => {
      setInteraction({
        type: 'edit_motion_path',
        nodeId,
        time,
        timeEnd,
        isSegment,
        handleType,
        startPos: startScreenPos,
        initialPos,
        initialHandle,
        initialViewTransform: viewTransform!
      } as any);
    };
    return () => { delete (window as any).startMotionPathDrag; };
  }, [viewTransform]);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!viewTransform) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const canvasPos = screenToCanvas(screenX, screenY, viewTransform);

    mouseScreenPosRef.current = { x: screenX, y: screenY };
    mouseCanvasPosRef.current = { x: canvasPos.x, y: canvasPos.y };

    const state = useCreatorStore.getState();
    // In state-flow mode OR during SM playback: only fire interaction events, allow pan
    if (state.smIsPlaying || state.creatorMode === 'state-flow') {
      // Allow panning in state-flow mode
      if (interaction.type === 'pan') {
        const dx = screenX - interaction.startPos.x;
        const dy = screenY - interaction.startPos.y;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) setHasMovedDuringSpace(true);
        setViewport(prev => ({
          ...prev,
          pan: {
            x: (interaction.initialPan?.x || 0) + dx / prev.zoom,
            y: (interaction.initialPan?.y || 0) + dy / prev.zoom
          }
        }));
        return;
      }

      const artboard = state.activeArtboardId ? state.nodes.get(state.activeArtboardId) : Array.from(state.nodes.values()).find((n: any) => n.type === 'artboard');
      const artboardLocal = getArtboardLocalPos(canvasPos);
      const hoveredInteractionLayerId = findHoveredInteractionLayer(artboardLocal.x, artboardLocal.y, state, artboard?.id);

      const hoveredBefore = (window as any).__lastSmHoveredLayerId;
      if (hoveredBefore !== hoveredInteractionLayerId) {
        if (hoveredBefore) processStateInteraction('PointerExit', hoveredBefore, state, true);
        if (hoveredInteractionLayerId) processStateInteraction('PointerEnter', hoveredInteractionLayerId, state, true);
        (window as any).__lastSmHoveredLayerId = hoveredInteractionLayerId;
      }

      if (hoveredInteractionLayerId) processStateInteraction('PointerMove', hoveredInteractionLayerId, state, true);
      return;
    }

    if (interaction.type === 'pan') {
      const dx = screenX - interaction.startPos.x;
      const dy = screenY - interaction.startPos.y;

      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        setHasMovedDuringSpace(true);
      }

      setViewport(prev => ({
        ...prev,
        pan: {
          x: (interaction.initialPan?.x || 0) + dx / prev.zoom,
          y: (interaction.initialPan?.y || 0) + dy / prev.zoom
        }
      }));
      return;
    }

    if (interaction.type === 'none' && activeTool === 'select') {
      const hit = getHandleAtPoint(screenX, screenY, selectedIds, nodes, viewTransform, currentTime);
      setHoveredHandle(hit);
      const artboard = activeArtboardId ? nodes.get(activeArtboardId) : Array.from(nodes.values()).find(n => n.type === 'artboard');
      const artboardLocal = getArtboardLocalPos(canvasPos);

      // ThorVG hit testing for hover (same priority as click)
      let hoveredId: string | null = null;
      if (dotlottieRef.current && !lottieNeedsReload && artboard) {
        hoveredId = hitTestThorVGLayers(
          screenX, screenY,
          canvasSize.width, canvasSize.height,
          viewport.zoom, viewport.pan,
          artboard.children,
          nodes,
          currentTime,
          AnimationUtils.getPropertyValue(artboard, 'props.width', currentTime) || 0,
          AnimationUtils.getPropertyValue(artboard, 'props.height', currentTime) || 0,
        );
      }
      if (!hoveredId) {
        hoveredId = findNodeAtPoint(artboardLocal.x, artboardLocal.y, nodes, artboard?.id || null, e.ctrlKey || e.metaKey, currentTime, artboard?.id || undefined);
      }
      setHoveredNodeId(hoveredId);

      // Measurement logic
      if ((isAltPressed || e.altKey) && selectedIds.length > 0) {
        if (hoveredId && !selectedIds.includes(hoveredId)) {
          setMeasurementTargetId(hoveredId);
        } else {
          // Find relevant artboard for selection
          let targetArtboard = activeArtboardId ? nodes.get(activeArtboardId) : null;
          if (!targetArtboard && selectedIds.length > 0) {
            let curr = nodes.get(selectedIds[0]);
            while (curr && curr.parentId) {
              const parent = nodes.get(curr.parentId);
              if (parent?.type === 'artboard') { targetArtboard = parent; break; }
              curr = parent;
            }
          }
          if (!targetArtboard) targetArtboard = Array.from(nodes.values()).find(n => n.type === 'artboard');

          if (targetArtboard && !selectedIds.includes(targetArtboard.id)) {
            setMeasurementTargetId(targetArtboard.id);
          } else {
            setMeasurementTargetId(null);
          }
        }
      } else {
        setMeasurementTargetId(null);
      }
    } else if (interaction.type === 'marquee') {
      setInteraction(prev => ({ ...prev, currentPos: { x: screenX, y: screenY } }));
    } else if (interaction.type === 'edit_motion_path' && interaction.nodeId) {
      const node = nodes.get(interaction.nodeId);
      if (node && node.animations) {
        // 1. Get the parent's coordinate system to translate screen mouse -> parent scale/rotation
        const parentId = (node.parentLayerId && nodes.has(node.parentLayerId)) ? node.parentLayerId : node.parentId;
        const parentWorldMatrix = parentId ? getWorldMatrix(parentId, nodes, currentTime, activeArtboardId || undefined) : new DOMMatrix();
        const combinedMatrix = viewTransform.multiply(parentWorldMatrix);
        const invMatrix = combinedMatrix.inverse();

        // 2. Project screen mouse into parent-local space
        const currentLocal = new DOMPoint(screenX, screenY).matrixTransform(invMatrix);

        const xKf = node.animations['transform.x']?.find(k => k.time === interaction.time);
        const yKf = node.animations['transform.y']?.find(k => k.time === interaction.time);

        if (interaction.handleType === 'kf') {
          // Strictly follow cursor: set value to current project position
          if (xKf) useCreatorStore.getState().updateKeyframe(interaction.nodeId, 'transform.x', xKf.id, { value: currentLocal.x });
          if (yKf) useCreatorStore.getState().updateKeyframe(interaction.nodeId, 'transform.y', yKf.id, { value: currentLocal.y });
        } else {
          // Handling handles: Handle pos is currentLocal - keyframeValue
          const kfXVal = xKf ? xKf.value : (AnimationUtils.getPropertyValue(node, 'transform.x', interaction.time!) || 0);
          const kfYVal = yKf ? yKf.value : (AnimationUtils.getPropertyValue(node, 'transform.y', interaction.time!) || 0);

          let newHX = currentLocal.x - kfXVal;
          let newHY = currentLocal.y - kfYVal;

          if (interaction.isSegment && interaction.timeEnd !== undefined) {
            // Symmetrical bending logic: Both handles point to the current mouse position
            let xKfEnd = node.animations['transform.x']?.find(k => k.time === interaction.timeEnd);
            let yKfEnd = node.animations['transform.y']?.find(k => k.time === interaction.timeEnd);

            const kfXEndVal = xKfEnd ? xKfEnd.value : (AnimationUtils.getPropertyValue(node, 'transform.x', interaction.timeEnd) || 0);
            const kfYEndVal = yKfEnd ? yKfEnd.value : (AnimationUtils.getPropertyValue(node, 'transform.y', interaction.timeEnd) || 0);

            // Ensure keyframes exist at both ends if they don't
            if (!xKf) useCreatorStore.getState().addKeyframe(interaction.nodeId, 'transform.x', interaction.time!, kfXVal);
            if (!yKf) useCreatorStore.getState().addKeyframe(interaction.nodeId, 'transform.y', interaction.time!, kfYVal);
            if (!xKfEnd) useCreatorStore.getState().addKeyframe(interaction.nodeId, 'transform.x', interaction.timeEnd, kfXEndVal);
            if (!yKfEnd) useCreatorStore.getState().addKeyframe(interaction.nodeId, 'transform.y', interaction.timeEnd, kfYEndVal);

            // Re-fetch now that they are guaranteed
            const currentNodes = useCreatorStore.getState().nodes;
            const updatedNode = currentNodes.get(interaction.nodeId)!;
            const curXKf = updatedNode.animations?.['transform.x']?.find(k => k.time === interaction.time);
            const curYKf = updatedNode.animations?.['transform.y']?.find(k => k.time === interaction.time);
            const curXKfEnd = updatedNode.animations?.['transform.x']?.find(k => k.time === interaction.timeEnd);
            const curYKfEnd = updatedNode.animations?.['transform.y']?.find(k => k.time === interaction.timeEnd);

            if (curXKf) useCreatorStore.getState().updateKeyframe(interaction.nodeId, 'transform.x', curXKf.id, { spatialOut: { x: newHX, y: newHY } });
            if (curYKf) useCreatorStore.getState().updateKeyframe(interaction.nodeId, 'transform.y', curYKf.id, { spatialOut: { x: newHX, y: newHY } });
            if (curXKfEnd) useCreatorStore.getState().updateKeyframe(interaction.nodeId, 'transform.x', curXKfEnd.id, { spatialIn: { x: currentLocal.x - kfXEndVal, y: currentLocal.y - kfYEndVal } });
            if (curYKfEnd) useCreatorStore.getState().updateKeyframe(interaction.nodeId, 'transform.y', curYKfEnd.id, { spatialIn: { x: currentLocal.x - kfXEndVal, y: currentLocal.y - kfYEndVal } });
          } else {
            // Ensure both exist at current time
            if (!xKf) useCreatorStore.getState().addKeyframe(interaction.nodeId, 'transform.x', interaction.time!, kfXVal);
            if (!yKf) useCreatorStore.getState().addKeyframe(interaction.nodeId, 'transform.y', interaction.time!, kfYVal);

            const updatedNode = useCreatorStore.getState().nodes.get(interaction.nodeId)!;
            const curXKf = updatedNode.animations?.['transform.x']?.find(k => k.time === interaction.time);
            const curYKf = updatedNode.animations?.['transform.y']?.find(k => k.time === interaction.time);

            if (interaction.handleType === 'out') {
              if (curXKf) useCreatorStore.getState().updateKeyframe(interaction.nodeId, 'transform.x', curXKf.id, { spatialOut: { x: newHX, y: newHY } });
              if (curYKf) useCreatorStore.getState().updateKeyframe(interaction.nodeId, 'transform.y', curYKf.id, { spatialOut: { x: newHX, y: newHY } });
            } else {
              if (curXKf) useCreatorStore.getState().updateKeyframe(interaction.nodeId, 'transform.x', curXKf.id, { spatialIn: { x: newHX, y: newHY } });
              if (curYKf) useCreatorStore.getState().updateKeyframe(interaction.nodeId, 'transform.y', curYKf.id, { spatialIn: { x: newHX, y: newHY } });
            }
          }
        }
      }
    } else if (interaction.type === 'adjust_polystar' as any) {
       const node = interaction.nodeId ? nodes.get(interaction.nodeId) : undefined;
       if (node) {
         if (!interaction.hasRecordedHistory) {
           useCreatorStore.getState().pushToHistory('Adjust Polystar');
           setInteraction(prev => ({ ...prev, hasRecordedHistory: true }));
         }

         if (!interaction.nodeId) return;
         const worldMatrix = getWorldMatrix(interaction.nodeId, nodes, currentTime, activeArtboardId || undefined);
         const combinedMatrix = viewTransform.multiply(worldMatrix);
         const inv = combinedMatrix.inverse();
         const localMouse = new DOMPoint(screenX, screenY).matrixTransform(inv);

         if (interaction.handleType === 'outerRadius') {
           const val = Math.max(1, Math.sqrt(localMouse.x**2 + localMouse.y**2));
           useCreatorStore.getState().setNodeProperty(interaction.nodeId, 'props.outerRadius', val);
         } else if (interaction.handleType === 'innerRadius') {
           const val = Math.max(1, Math.sqrt(localMouse.x**2 + localMouse.y**2));
           useCreatorStore.getState().setNodeProperty(interaction.nodeId, 'props.innerRadius', val);
         }
       }
    } else if (interaction.type === 'move' && (interaction.nodeId || interaction.initialTransforms)) {
      if (!interaction.hasRecordedHistory) {
        useCreatorStore.getState().pushToHistory('Move Objects');
        setInteraction(prev => ({ ...prev, hasRecordedHistory: true }));
      }

      // Fix A: detect first actual movement past threshold so Canvas2D only covers ThorVG
      // when the user is genuinely dragging, not just clicking to select.
      if (!interaction.hasMoved) {
        const sdx = Math.abs(screenX - (interaction.currentPos?.x ?? 0));
        const sdy = Math.abs(screenY - (interaction.currentPos?.y ?? 0));
        if (sdx > 3 || sdy > 3) {
          setInteraction(prev => ({ ...prev, hasMoved: true }));
        }
      }

      let dx = canvasPos.x - interaction.startPos.x;
      let dy = canvasPos.y - interaction.startPos.y;

      // Smart Guides & Snapping
      const initialBounds = interaction.initialSelectionBounds;
      let guides: { x: number | null, y: number | null } = { x: null, y: null };

      if (initialBounds && !e.altKey) {
        const snapThreshold = 6 / viewport.zoom;
        const currentBounds = {
          x: initialBounds.x + dx,
          y: initialBounds.y + dy,
          width: initialBounds.width,
          height: initialBounds.height
        };

        const currentXPoints = [currentBounds.x, currentBounds.x + currentBounds.width / 2, currentBounds.x + currentBounds.width];
        const currentYPoints = [currentBounds.y, currentBounds.y + currentBounds.height / 2, currentBounds.y + currentBounds.height];

        const candidates: { x: number[], y: number[] } = { x: [], y: [] };
        const artboard = activeArtboardId ? nodes.get(activeArtboardId) : Array.from(nodes.values()).find(n => n.type === 'artboard');
        if (artboard) {
          candidates.x.push(0, artboard.props.width / 2, artboard.props.width);
          candidates.y.push(0, artboard.props.height / 2, artboard.props.height);
        }

        nodes.forEach((node, id) => {
          if (selectedIds.includes(id) || node.type === 'artboard') return;

          // Only suggest nodes within the current artboard context for snapping
          if (activeArtboardId) {
            let belongs = false;
            let curr: any = node;
            while (curr && curr.parentId) {
              if (curr.parentId === activeArtboardId) { belongs = true; break; }
              curr = nodes.get(curr.parentId);
            }
            if (!belongs) return;
          }

          const worldMatrix = getWorldMatrix(id, nodes, currentTime, activeArtboardId || undefined);
          const bounds = getBoundingBox(node, worldMatrix, nodes, currentTime);
          candidates.x.push(bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width);
          candidates.y.push(bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height);
        });

        let bestDiffX = snapThreshold;
        let bestDiffY = snapThreshold;
        let snapX: number | null = null;
        let snapY: number | null = null;
        let sxOffset = 0;
        let syOffset = 0;

        currentXPoints.forEach((p) => {
          candidates.x.forEach(c => {
            const diff = Math.abs(p - c);
            if (diff < bestDiffX) {
              bestDiffX = diff;
              snapX = c;
              sxOffset = c - p;
            }
          });
        });
        dx += sxOffset;

        currentYPoints.forEach((p) => {
          candidates.y.forEach(c => {
            const diff = Math.abs(p - c);
            if (diff < bestDiffY) {
              bestDiffY = diff;
              snapY = c;
              syOffset = c - p;
            }
          });
        });
        dy += syOffset;

        guides = { x: snapX, y: snapY };
      }

      setActiveGuides(guides);

      if (interaction.initialTransforms) {
        Object.entries(interaction.initialTransforms).forEach(([id, start]) => {
          setNodeProperties(id, {
            'transform.x': start.x + dx,
            'transform.y': start.y + dy
          }, { ignoreLink: true });
        });
      } else if (interaction.nodeId && interaction.initialTransform) {
        setNodeProperties(interaction.nodeId, {
          'transform.x': interaction.initialTransform.x + dx,
          'transform.y': interaction.initialTransform.y + dy
        }, { ignoreLink: true });
      }
    } else if (interaction.type === 'rotate' && interaction.nodeId === 'selection') {
      if (!interaction.hasRecordedHistory) {
        useCreatorStore.getState().pushToHistory('Rotate Selection');
        setInteraction(prev => ({ ...prev, hasRecordedHistory: true }));
      }
      const data = interaction.initialSelectionData;
      if (!data) return;

      const screenCenter = localToScreen(data.center.x, data.center.y, viewTransform);
      const currentAngle = Math.atan2(screenY - screenCenter.y, screenX - screenCenter.x) * 180 / Math.PI;

      let diff = currentAngle - (interaction.lastAngle || 0);
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;

      let newRelativeRotation = (interaction.totalRotation || 0) + diff;
      setInteraction(prev => ({ ...prev, lastAngle: currentAngle, totalRotation: newRelativeRotation }));

      const finalRotation = e.shiftKey ? Math.round(newRelativeRotation / 15) * 15 : newRelativeRotation;

      // Create temporary group rotation matrix around center
      const rotMatrix = new DOMMatrix()
        .translate(data.center.x, data.center.y)
        .rotate(finalRotation)
        .translate(-data.center.x, -data.center.y);

      // Apply to all nodes
      Object.entries(data.nodes).forEach(([id, nodeData]) => {
        const node = nodes.get(id);
        if (!node) return;

        // NewWorldMatrix = RotMatrix * InitialWorldMatrix
        const newWorldMatrix = rotMatrix.multiply(nodeData.worldMatrix);
        const relativeToParent = nodeData.parentWorldMatrixInverse.multiply(newWorldMatrix);
        const currentAnchor = getAnimatedAnchor(node, nodes, currentTime);
        const decomp = decomposeMatrix(relativeToParent, currentAnchor);

        setNodeProperties(id, {
          'transform.x': decomp.x,
          'transform.y': decomp.y,
          'transform.rotation': decomp.rotation,
        }, { ignoreLink: true });
      });

    } else if (interaction.type === 'rotate' && interaction.nodeId && interaction.initialWorldMatrix) {
      if (!interaction.hasRecordedHistory) {
        useCreatorStore.getState().pushToHistory('Rotate Object');
        setInteraction(prev => ({ ...prev, hasRecordedHistory: true }));
      }
      const node = nodes.get(interaction.nodeId);
      if (node && interaction.initialViewTransform && interaction.lastAngle !== undefined && interaction.totalRotation !== undefined) {
        const initialCombinedMatrix = interaction.initialViewTransform.multiply(interaction.initialWorldMatrix!);
        const lb = getGroupLocalBounds(interaction.nodeId, nodes, currentTime);
        const center = localToScreen(lb.x + lb.width / 2, lb.y + lb.height / 2, initialCombinedMatrix);

        const currentAngle = Math.atan2(screenY - center.y, screenX - center.x) * 180 / Math.PI;

        // Calculate relative change between frames
        let diff = currentAngle - interaction.lastAngle;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;

        let newRotation = interaction.totalRotation + diff;

        // Update interaction state for next frame
        setInteraction(prev => ({
          ...prev,
          lastAngle: currentAngle,
          totalRotation: newRotation
        }));

        const finalRotation = e.shiftKey ? Math.round(newRotation / 15) * 15 : newRotation;
        setNodeProperty(interaction.nodeId, 'transform.rotation', finalRotation);
      }
    } else if (interaction.type === 'resize' && interaction.nodeId === 'selection') {
      if (!interaction.hasRecordedHistory) {
        useCreatorStore.getState().pushToHistory('Resize Selection');
        setInteraction(prev => ({ ...prev, hasRecordedHistory: true }));
      }
      const data = interaction.initialSelectionData;
      if (!data) return;

      const { handleIndex, startPos } = interaction;
      const { fixedPoint, bounds } = data;

      const startCanvasPos = screenToCanvas(startPos.x, startPos.y, viewTransform);
      const dx_init = startCanvasPos.x - fixedPoint.x;
      const dy_init = startCanvasPos.y - fixedPoint.y;

      let sx = (dx_init !== 0) ? (canvasPos.x - fixedPoint.x) / dx_init : 1;
      let sy = (dy_init !== 0) ? (canvasPos.y - fixedPoint.y) / dy_init : 1;

      // Handle aspect ratio
      if (e.shiftKey) {
        const h = [0, 1, 2, 4, 5, 6].includes(handleIndex!);
        const v = [0, 2, 3, 4, 6, 7].includes(handleIndex!);
        if (h && v) {
          const s = Math.max(Math.abs(sx), Math.abs(sy));
          sx = (sx < 0 ? -s : s);
          sy = (sy < 0 ? -s : s);
        } else if (h) {
          sy = sx;
        } else {
          sx = sy;
        }
      }

      // Constrain handles (only scale on specific axes)
      if (![0, 2, 4, 6, 7, 3].includes(handleIndex!)) sx = 1;
      if (![0, 1, 2, 4, 5, 6].includes(handleIndex!)) sy = 1;

      const scaleMatrix = new DOMMatrix()
        .translate(fixedPoint.x, fixedPoint.y)
        .scale(sx, sy)
        .translate(-fixedPoint.x, -fixedPoint.y);

      Object.entries(data.nodes).forEach(([id, nodeData]) => {
        const node = nodes.get(id);
        if (!node) return;

        const newWorldMatrix = scaleMatrix.multiply(nodeData.worldMatrix);
        const relativeToParent = nodeData.parentWorldMatrixInverse.multiply(newWorldMatrix);
        const currentAnchor = getAnimatedAnchor(node, nodes, currentTime);
        const decomp = decomposeMatrix(relativeToParent, currentAnchor);

        if (node.type === 'group' || node.type === 'text') {
          setNodeProperties(id, {
            'transform.x': decomp.x,
            'transform.y': decomp.y,
            'transform.scaleX': decomp.scaleX,
            'transform.scaleY': decomp.scaleY,
            'transform.rotation': decomp.rotation,
          }, { ignoreLink: true });
        } else if (node.type === 'rect' || node.type === 'artboard' || node.type === 'image' || node.type === 'precomp') {
          // Decompose back to position and dimensions
          // This is tricky because rotation is baked in if we just use decomp scale
          // Standard: for temporary selection resize, treat as group (scale transform)
          setNodeProperties(id, {
            'transform.x': decomp.x,
            'transform.y': decomp.y,
            'transform.scaleX': decomp.scaleX,
            'transform.scaleY': decomp.scaleY,
            'transform.rotation': decomp.rotation,
          }, { ignoreLink: true });
        } else if (node.type === 'ellipse') {
          setNodeProperties(id, {
            'transform.x': decomp.x,
            'transform.y': decomp.y,
            'transform.scaleX': decomp.scaleX,
            'transform.scaleY': decomp.scaleY,
            'transform.rotation': decomp.rotation,
          }, { ignoreLink: true });
        } else if (node.type === 'path') {
          setNodeProperties(id, {
            'transform.x': decomp.x,
            'transform.y': decomp.y,
            'transform.scaleX': decomp.scaleX,
            'transform.scaleY': decomp.scaleY,
            'transform.rotation': decomp.rotation,
          }, { ignoreLink: true });
        }
      });

    } else if (interaction.type === 'resize' && interaction.nodeId && interaction.initialWorldMatrix) {
      if (!interaction.hasRecordedHistory) {
        useCreatorStore.getState().pushToHistory('Resize Object');
        setInteraction(prev => ({ ...prev, hasRecordedHistory: true }));
      }
      const node = nodes.get(interaction.nodeId);
      if (!node) return;

      const { handleIndex, initialTransform, initialProps } = interaction;
      if (handleIndex === undefined || !initialTransform || !initialProps) return;
      const initialOffsetX = interaction.initialOffsetX || 0;
      const initialOffsetY = interaction.initialOffsetY || 0;

      const worldMatrix = interaction.initialWorldMatrix;
      if (!worldMatrix || !interaction.initialViewTransform) return;
      const combinedMatrix = interaction.initialViewTransform.multiply(worldMatrix);

      let w = interaction.initialWidth || 0;
      let h = interaction.initialHeight || 0;
      if (w === 0 || h === 0) {
        if (node.type === 'rect' || node.type === 'artboard' || node.type === 'image') {
          w = (initialProps?.width as number) || 1;
          h = (initialProps?.height as number) || 1;
        } else if (node.type === 'precomp' && node.refId) {
          const refArtboard = nodes.get(node.refId);
          if (refArtboard) {
            w = (AnimationUtils.getPropertyValue(refArtboard, 'props.width', currentTime) || 1);
            h = (AnimationUtils.getPropertyValue(refArtboard, 'props.height', currentTime) || 1);
          }
        } else if (node.type === 'ellipse') {
          w = ((initialProps?.radiusX as number) || 0) * 2;
          h = ((initialProps?.radiusY as number) || 0) * 2;
        } else {
          const lb = getPathLocalBounds(node.props.points || []);
          w = lb.width || 1; h = lb.height || 1;
        }
      }

      // --- REFINED RESIZE MATH ---

      // 1. Determine handle attributes
      const isRight = [2, 3, 4].includes(handleIndex);
      const isLeft = [0, 6, 7].includes(handleIndex);
      const isBottom = [4, 5, 6].includes(handleIndex);
      const isTop = [0, 1, 2].includes(handleIndex);
      const horizontal = isLeft || isRight;
      const vertical = isTop || isBottom;

      // 2. Local mouse and initial moving point
      const invCombined = combinedMatrix.inverse();
      const currentLocalMouse = new DOMPoint(screenX, screenY).matrixTransform(invCombined);
      const startLocalMouse = interaction.initialLocalMousePos;
      if (!startLocalMouse) return;

      const fx_loc = interaction.initialFixedLocalPos?.x || 0;
      const fy_loc = interaction.initialFixedLocalPos?.y || 0;

      const dx_init = startLocalMouse.x - fx_loc;
      const dy_init = startLocalMouse.y - fy_loc;

      // 3. Calculate signed Ratios (for flipping)
      const handleDirections = [
        { x: -1, y: -1 }, // 0: TL
        { x: 0, y: -1 },  // 1: TC
        { x: 1, y: -1 },  // 2: TR
        { x: 1, y: 0 },   // 3: RC
        { x: 1, y: 1 },   // 4: BR
        { x: 0, y: 1 },   // 5: BC
        { x: -1, y: 1 },  // 6: BL
        { x: -1, y: 0 },  // 7: LC
      ];
      const hDir = handleDirections[handleIndex];

      let rx = 1, ry = 1;

      if (horizontal) {
        if (interaction.isAnchorHandleX) {
          rx = 1 + ((currentLocalMouse.x - startLocalMouse.x) * hDir.x) / (w || 1);
        } else if (dx_init !== 0) {
          rx = (currentLocalMouse.x - fx_loc) / dx_init;
        }
      }

      if (vertical) {
        if (interaction.isAnchorHandleY) {
          ry = 1 + ((currentLocalMouse.y - startLocalMouse.y) * hDir.y) / (h || 1);
        } else if (dy_init !== 0) {
          ry = (currentLocalMouse.y - fy_loc) / dy_init;
        }
      }

      if (e.shiftKey) {
        if (horizontal && !vertical) ry = rx;
        else if (vertical && !horizontal) rx = ry;
        else {
          const r = Math.max(Math.abs(rx), Math.abs(ry));
          rx = rx < 0 ? -r : r;
          ry = ry < 0 ? -r : r;
        }
      }

      // Apply minimum size limits
      const minW = node.type === 'artboard' ? 100 : 1;
      const minH = node.type === 'artboard' ? 100 : 1;

      const thresholdX = minW / Math.max(1, w);
      const thresholdY = minH / Math.max(1, h);

      if (Math.abs(rx) < thresholdX) rx = (rx < 0 ? -1 : 1) * thresholdX;
      if (Math.abs(ry) < thresholdY) ry = (ry < 0 ? -1 : 1) * thresholdY;

      const finalW = w * Math.abs(rx);
      const finalH = h * Math.abs(ry);
      const sgnX = rx < 0 ? -1 : 1;
      const sgnY = ry < 0 ? -1 : 1;

      // 4. Update Properties
      const updates: any = {};
      if (node.type === 'rect' || node.type === 'artboard') {
        updates['props.width'] = Math.max(1, finalW);
        updates['props.height'] = Math.max(1, finalH);

        if (node.type !== 'artboard') {
          updates['transform.scaleX'] = initialTransform.scaleX * sgnX;
          updates['transform.scaleY'] = initialTransform.scaleY * sgnY;
        }

        if (node.transform.anchorAlignX !== undefined) {
          updates['transform.anchorAlignX'] = node.transform.anchorAlignX;
        } else {
          updates['transform.anchorX'] = initialTransform.anchorX * Math.abs(rx);
        }
        if (node.transform.anchorAlignY !== undefined) {
          updates['transform.anchorAlignY'] = node.transform.anchorAlignY;
        } else {
          updates['transform.anchorY'] = initialTransform.anchorY * Math.abs(ry);
        }
      } else if (node.type === 'ellipse') {
        updates['props.radiusX'] = Math.max(0.5, finalW / 2);
        updates['props.radiusY'] = Math.max(0.5, finalH / 2);

        updates['transform.scaleX'] = initialTransform.scaleX * sgnX;
        updates['transform.scaleY'] = initialTransform.scaleY * sgnY;

        if (node.transform.anchorAlignX !== undefined) {
          updates['transform.anchorAlignX'] = node.transform.anchorAlignX;
        } else {
          updates['transform.anchorX'] = initialTransform.anchorX * Math.abs(rx);
        }
        if (node.transform.anchorAlignY !== undefined) {
          updates['transform.anchorAlignY'] = node.transform.anchorAlignY;
        } else {
          updates['transform.anchorY'] = initialTransform.anchorY * Math.abs(ry);
        }
      } else if (node.type === 'path') {
        const initialPoints = (initialProps.points as any[]) || [];
        // Paths handle flipping by moving points directly relative to the fixed point.
        // This keeps the anchor (if it's the fixed point) or the opposite handle perfectly stable.
        updates['props.points'] = initialPoints.map(p => ({
          ...p,
          x: (p.x - fx_loc) * rx + fx_loc,
          y: (p.y - fy_loc) * ry + fy_loc,
          inX: (p.inX || 0) * rx,
          inY: (p.inY || 0) * ry,
          outX: (p.outX || 0) * rx,
          outY: (p.outY || 0) * ry,
        }));

        if (node.transform.anchorAlignX !== undefined) {
          updates['transform.anchorAlignX'] = node.transform.anchorAlignX;
        } else {
          updates['transform.anchorX'] = initialTransform.anchorX * Math.abs(rx);
        }
        if (node.transform.anchorAlignY !== undefined) {
          updates['transform.anchorAlignY'] = node.transform.anchorAlignY;
        } else {
          updates['transform.anchorY'] = initialTransform.anchorY * Math.abs(ry);
        }
      }
      else if (node.type === 'group' || node.type === 'precomp' || node.type === 'image') {
        // Safe scale update
        const minScale = 0.001;
        const newScaleX = initialTransform.scaleX * rx;
        const newScaleY = initialTransform.scaleY * ry;

        updates['transform.scaleX'] = Math.abs(newScaleX) < minScale ? (newScaleX < 0 ? -minScale : minScale) : newScaleX;
        updates['transform.scaleY'] = Math.abs(newScaleY) < minScale ? (newScaleY < 0 ? -minScale : minScale) : newScaleY;

        // Group anchor remains at its relative position
        if (node.transform.anchorAlignX !== undefined) {
          updates['transform.anchorAlignX'] = node.transform.anchorAlignX;
        } else {
          updates['transform.anchorX'] = initialTransform.anchorX; // Groups usually don't scale content pixels
        }
        if (node.transform.anchorAlignY !== undefined) {
          updates['transform.anchorAlignY'] = node.transform.anchorAlignY;
        } else {
          updates['transform.anchorY'] = initialTransform.anchorY;
        }
      } else if (node.type === 'text') {
        const boxWidth = (initialProps?.width as number) || 0;
        if (boxWidth > 0) {
          // Area text: resize the text box dimensions
          updates['props.width'] = Math.max(10, finalW);
          updates['props.height'] = Math.max(10, finalH);
          if (node.transform.anchorAlignX !== undefined) {
            updates['transform.anchorAlignX'] = node.transform.anchorAlignX;
          } else {
            updates['transform.anchorX'] = initialTransform.anchorX * Math.abs(rx);
          }
          if (node.transform.anchorAlignY !== undefined) {
            updates['transform.anchorAlignY'] = node.transform.anchorAlignY;
          } else {
            updates['transform.anchorY'] = initialTransform.anchorY * Math.abs(ry);
          }
        } else {
          // Point text: scale transform (After Effects / LottieFiles style)
          const minScale = 0.001;
          const newScaleX = initialTransform.scaleX * rx;
          const newScaleY = initialTransform.scaleY * ry;
          updates['transform.scaleX'] = Math.abs(newScaleX) < minScale ? (newScaleX < 0 ? -minScale : minScale) : newScaleX;
          updates['transform.scaleY'] = Math.abs(newScaleY) < minScale ? (newScaleY < 0 ? -minScale : minScale) : newScaleY;
          if (node.transform.anchorAlignX !== undefined) {
            updates['transform.anchorAlignX'] = node.transform.anchorAlignX;
          }
          if (node.transform.anchorAlignY !== undefined) {
            updates['transform.anchorAlignY'] = node.transform.anchorAlignY;
          }
        }
      }

      // 7. World Anchoring (Fixed Point)
      // Use the anchor frozen at mousedown — NOT getAnimatedAnchor() on the current node,
      // because for resizable nodes (rect, ellipse, area-text) the anchor is proportional
      // to width/height and would drift each frame as props update, causing visible jumps.
      const frozenAnchor = interaction.initialComputedAnchor;
      const initAnchorX = frozenAnchor ? frozenAnchor.x : initialTransform.anchorX;
      const initAnchorY = frozenAnchor ? frozenAnchor.y : initialTransform.anchorY;

      const v_fixed_init_rel_anchor = {
        x: fx_loc - initAnchorX,
        y: fy_loc - initAnchorY
      };

      const isPointText = node.type === 'text' && !((initialProps?.width as number) > 0);
      const isGroup = node.type === 'group' || node.type === 'precomp' || node.type === 'image' || isPointText;

      const v_fixed_new_rel_anchor = {
        // Paths bake the scale/flip into points directly, so use signed rx/ry.
        // Other shapes (rect/ellipse) bake scale into props but flip into the scale transform.
        // Groups keep local geometry the same and only scale via the transform.
        x: v_fixed_init_rel_anchor.x * (isGroup ? 1 : (node.type === 'path' ? rx : Math.abs(rx))),
        y: v_fixed_init_rel_anchor.y * (isGroup ? 1 : (node.type === 'path' ? ry : Math.abs(ry)))
      };

      const m = new DOMMatrix();
      if (initialTransform.rotation) m.rotateSelf(initialTransform.rotation);

      // Always include current scale in the transform matrix
      const targetScaleX = updates['transform.scaleX'] !== undefined ? updates['transform.scaleX'] : initialTransform.scaleX;
      const targetScaleY = updates['transform.scaleY'] !== undefined ? updates['transform.scaleY'] : initialTransform.scaleY;
      m.scaleSelf(targetScaleX, targetScaleY);

      const rotatedRel = new DOMPoint(v_fixed_new_rel_anchor.x, v_fixed_new_rel_anchor.y).matrixTransform(m);

      const fixedParentPos = interaction.initialFixedParentPos;
      if (fixedParentPos) {
        const currentAnchorX = updates['transform.anchorX'] !== undefined ? updates['transform.anchorX'] : initialTransform.anchorX;
        const currentAnchorY = updates['transform.anchorY'] !== undefined ? updates['transform.anchorY'] : initialTransform.anchorY;

        updates['transform.x'] = fixedParentPos.x - rotatedRel.x;
        updates['transform.y'] = fixedParentPos.y - rotatedRel.y;
      }

      // 5. Apply the updates to the main node
      setNodeProperties(interaction.nodeId, updates, { ignoreLink: true });

      // 6. PROPAGATE TO CHILDREN (Group-Style Behavior)
      if (interaction.initialChildrenData && Object.keys(interaction.initialChildrenData).length > 0 && (rx !== 1 || ry !== 1)) {
        // A. Find the fixed point in world space
        const sfy = interaction.initialScreenFixedPoint!;
        const fixedPointWorld = screenToCanvas(sfy.x, sfy.y, viewTransform);

        // B. Create the uniform scaling matrix (exactly like multi-selection group resize)
        const groupScaleMatrix = new DOMMatrix()
          .translate(fixedPointWorld.x, fixedPointWorld.y)
          .scale(rx, ry)
          .translate(-fixedPointWorld.x, -fixedPointWorld.y);

        // C. Calculate the Parent's NEW World Matrix from current updates
        const pIdOfP = node.parentLayerId || node.parentId;
        const pOfPWorld = pIdOfP ? getWorldMatrix(pIdOfP, nodes, currentTime, activeArtboardId || undefined) : new DOMMatrix();

        const currentParentProps = { ...node.props };
        Object.entries(updates).forEach(([key, val]) => {
          if (key.startsWith('props.')) {
            const propName = key.split('.')[1];
            currentParentProps[propName] = val;
          }
        });

        const currentParentTransform = {
          ...interaction.initialTransform,
          x: updates['transform.x'] !== undefined ? updates['transform.x'] : interaction.initialTransform.x,
          y: updates['transform.y'] !== undefined ? updates['transform.y'] : interaction.initialTransform.y,
          anchorX: updates['transform.anchorX'] !== undefined ? updates['transform.anchorX'] : interaction.initialTransform.anchorX,
          anchorY: updates['transform.anchorY'] !== undefined ? updates['transform.anchorY'] : interaction.initialTransform.anchorY,
          scaleX: updates['transform.scaleX'] !== undefined ? updates['transform.scaleX'] : interaction.initialTransform.scaleX,
          scaleY: updates['transform.scaleY'] !== undefined ? updates['transform.scaleY'] : interaction.initialTransform.scaleY,
          rotation: updates['transform.rotation'] !== undefined ? updates['transform.rotation'] : interaction.initialTransform.rotation,
          anchorAlignX: updates['transform.anchorAlignX'] !== undefined ? updates['transform.anchorAlignX'] : interaction.initialTransform.anchorAlignX,
          anchorAlignY: updates['transform.anchorAlignY'] !== undefined ? updates['transform.anchorAlignY'] : interaction.initialTransform.anchorAlignY,
        };

        const nextParentWorld = pOfPWorld.multiply(createTransformMatrix(currentParentTransform, { ...node, props: currentParentProps } as any));
        const invNextParentWorld = nextParentWorld.inverse();

        Object.values(interaction.initialChildrenData).forEach((childData: any) => {
          const childNode = nodes.get(childData.id);
          if (!childNode) return;

          // 1. Calculate child's new World Matrix (Group logic: just scale around the fixed point)
          const childNewWorld = groupScaleMatrix.multiply(childData.worldMatrix);

          // 2. Project into the Parent's NEW Local Space
          const childNewLocal = invNextParentWorld.multiply(childNewWorld);

          // 3. Decompose back to local properties
          const childAnchor = getAnimatedAnchor(childNode, nodes, currentTime);
          const decomp = decomposeMatrix(childNewLocal, childAnchor);

          setNodeProperties(childData.id, {
            'transform.x': decomp.x,
            'transform.y': decomp.y,
            'transform.scaleX': decomp.scaleX,
            'transform.scaleY': decomp.scaleY,
            'transform.rotation': decomp.rotation,
          }, { ignoreLink: true, ignoreAnimation: true });
        });
      }

      // --- STICKY ARTBOARD ANCHORED RESIZE ---
      // (Artboard is special: it often needs to keep children at same world coords 
      // UNLESS the user explicitly wanted a scaled resize. We keep the world-stability 
      // for Artboard position shifts but allow the propagation above to handle scaling).
      if (node.type === 'artboard') {
        const dx = (updates['transform.x'] !== undefined) ? (updates['transform.x'] - initialTransform.x) : 0;
        const dy = (updates['transform.y'] !== undefined) ? (updates['transform.y'] - initialTransform.y) : 0;

        if (dx !== 0 || dy !== 0) {
          node.children.forEach(childId => {
            const child = nodes.get(childId);
            if (child) {
              // Adjust for the parent's anchor shift to keep world position stable
              updateNode(childId, {
                transform: {
                  ...child.transform,
                  x: child.transform.x - dx,
                  y: child.transform.y - dy
                }
              });
            }
          });
        }
      }
    } else if (interaction.type === 'edit_path' && interaction.nodeId) {
      if (!interaction.hasRecordedHistory) {
        useCreatorStore.getState().pushToHistory('Edit Path');
        setInteraction(prev => ({ ...prev, hasRecordedHistory: true }));
      }
      const node = nodes.get(interaction.nodeId);
      if (!node || node.type !== 'path') return;

      const worldMatrix = interaction.initialWorldMatrix || getWorldMatrix(interaction.nodeId, nodes, currentTime);
      const combinedMatrix = viewTransform.multiply(worldMatrix);
      const inv = combinedMatrix.inverse();
      const currentLocalMouse = new DOMPoint(screenX, screenY).matrixTransform(inv);

      const { vertexIndex, handleType, initialProps } = interaction;
      if (vertexIndex === undefined || !handleType) return;

      const points = [...(initialProps.points as any[])];
      const p = { ...points[vertexIndex] };

      if (handleType === 'vertex') {
        const dx = currentLocalMouse.x - interaction.initialLocalMousePos!.x;
        const dy = currentLocalMouse.y - interaction.initialLocalMousePos!.y;
        p.x += dx;
        p.y += dy;
      } else if (handleType === 'in') {
        p.inX = currentLocalMouse.x - p.x;
        p.inY = currentLocalMouse.y - p.y;
        if (!e.altKey) { // Symmetrical handles by default
          p.outX = -p.inX;
          p.outY = -p.inY;
        }
      } else if (handleType === 'out') {
        p.outX = currentLocalMouse.x - p.x;
        p.outY = currentLocalMouse.y - p.y;
        if (!e.altKey) { // Symmetrical handles by default
          p.inX = -p.outX;
          p.inY = -p.outY;
        }
      }

      points[vertexIndex] = p;
      setNodeProperty(interaction.nodeId, 'props.points', points);
    } else if (interaction.type === 'edit_gradient' && interaction.nodeId) {
      if (!interaction.hasRecordedHistory) {
        useCreatorStore.getState().pushToHistory('Edit Gradient');
        setInteraction(prev => ({ ...prev, hasRecordedHistory: true }));
      }
      const worldMatrix = interaction.initialWorldMatrix || getWorldMatrix(interaction.nodeId, nodes, currentTime, activeArtboardId || undefined);
      const combinedMatrix = viewTransform.multiply(worldMatrix);
      const inv = combinedMatrix.inverse();
      const currentLocalMouse = new DOMPoint(screenX, screenY).matrixTransform(inv);

      const path = interaction.initialProps; // 'style.fillGradient' or 'style.strokeGradient'
      const node = nodes.get(interaction.nodeId);
      if (!node) return;

      const gradient = { ...((path === 'style.fillGradient' ? node.style.fillGradient : node.style.strokeGradient) || {}) };
      if (interaction.gradientHandle === 'start') {
        gradient.start = { x: currentLocalMouse.x, y: currentLocalMouse.y };
      } else {
        gradient.end = { x: currentLocalMouse.x, y: currentLocalMouse.y };
      }

      setNodeProperty(interaction.nodeId, path, gradient);
    } else {
      const localPos = getArtboardLocalPos(canvasPos);
      const toolEvent = { x: localPos.x, y: localPos.y, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey };
      if (activeTool === 'rect' && rectToolRef.current) rectToolRef.current.onMouseMove(toolEvent);
      if (activeTool === 'ellipse' && ellipseToolRef.current) ellipseToolRef.current.onMouseMove(toolEvent);
      if (activeTool === 'star' && starToolRef.current) starToolRef.current.onMouseMove(toolEvent);
      if (activeTool === 'pen' && penToolRef.current) penToolRef.current.onMouseMove(toolEvent);
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    const state = useCreatorStore.getState();
    // In state-flow mode OR during SM playback: only fire interaction events
    if (state.smIsPlaying || state.creatorMode === 'state-flow') {
      // Release panning in state-flow mode
      if (interaction.type === 'pan') {
        setInteraction({ type: 'none', startPos: { x: 0, y: 0 } });
      }

      const container = containerRef.current;
      if (container && viewTransform) {
        const rect = container.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const canvasPos = screenToCanvas(screenX, screenY, viewTransform);
        const artboard = state.activeArtboardId ? state.nodes.get(state.activeArtboardId) : Array.from(state.nodes.values()).find((n: any) => n.type === 'artboard');
        const artboardLocal = getArtboardLocalPos(canvasPos);
        const hitInteractionLayerId = findHoveredInteractionLayer(artboardLocal.x, artboardLocal.y, state, artboard?.id);

        // Always fire PointerUp on the element that was originally pressed, even if dragged away,
        // UNLESS the layer has disappeared from the timeline (Lottiefiles behavior)
        if (activePointerTargetRef.current) {
          const targetNode = state.nodes.get(activePointerTargetRef.current);
          const isStillActive = targetNode && state.currentTime >= targetNode.inPoint && state.currentTime <= targetNode.outPoint;

          if (isStillActive) {
            processStateInteraction('PointerUp', activePointerTargetRef.current, state, true);
          }
        }

        // Fire PointerUp on the layer currently under the mouse if it's different and has a listener
        if (hitInteractionLayerId && hitInteractionLayerId !== activePointerTargetRef.current) {
          processStateInteraction('PointerUp', hitInteractionLayerId, state, true);
        }

        // Only fire Click if we released over the same element we pressed on
        if (hitInteractionLayerId && hitInteractionLayerId === activePointerTargetRef.current) {
          processStateInteraction('Click', hitInteractionLayerId, state, true);
        }

        activePointerTargetRef.current = null;
      }
      return;
    }

    if (interaction.type === 'marquee' && interaction.currentPos) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect && viewTransform) {
        const x1 = Math.min(interaction.startPos.x, interaction.currentPos.x);
        const y1 = Math.min(interaction.startPos.y, interaction.currentPos.y);
        const x2 = Math.max(interaction.startPos.x, interaction.currentPos.x);
        const y2 = Math.max(interaction.startPos.y, interaction.currentPos.y);

        const newlySelected: string[] = [];
        const artboard = activeArtboardId ? nodes.get(activeArtboardId) : Array.from(nodes.values()).find(n => n.type === 'artboard');

        // Phase 5.1: ThorVG-driven marquee for imported animation layers.
        // Uses getLayerBoundingBox (pixel-perfect coords from ThorVG) to check overlap
        // rather than our Matrix.ts approximation. Only queries top-level artboard children
        // since those have unique layer names in the Lottie animation tree.
        const thorVGActive = !!(!lottieNeedsReload && dotlottieRef.current && artboard);

        if (thorVGActive) {
          const dpr = window.devicePixelRatio || 1;
          const tx = canvasSize.width / 2 + viewport.zoom * viewport.pan.x;
          const ty = canvasSize.height / 2 + viewport.zoom * viewport.pan.y;

          artboard!.children.forEach(nodeId => {
            const node = nodes.get(nodeId);
            if (!node || !node.name || !node.visible || node.type === 'artboard') return;
            if (!isNodeSelectable(nodeId, nodes)) return;

            // Skip duplicate-named layers — ThorVG looks up by name, so duplicates
            // would return the wrong layer's bbox. Let them fall through to matrix-based hit test.
            const nameCount = artboard!.children.filter(sibId => {
              const sib = nodes.get(sibId);
              return sib && sib.name === node.name;
            }).length;
            if (nameCount > 1) return;

            const bbox = dotlottieRef.current!.getLayerBoundingBox(node.name);
            // getLayerBoundingBox returns [x0,y0, x1,y1, x2,y2, x3,y3] — 4 OBB corners
            // clockwise from top-left in physical canvas pixels. NOT [x,y,w,h].
            if (!bbox || bbox.length < 8) return;
            const [x0, y0, x1obb, y1obb, x2obb, y2obb, x3obb, y3obb] = bbox;
            if (![x0, y0, x1obb, y1obb, x2obb, y2obb, x3obb, y3obb].every(isFinite)) return;

            // AABB of OBB corners for marquee overlap test (sufficient for marquee — no need for OBB precision)
            const minX = Math.min(x0, x1obb, x2obb, x3obb);
            const maxX = Math.max(x0, x1obb, x2obb, x3obb);
            const minY = Math.min(y0, y1obb, y2obb, y3obb);
            const maxY = Math.max(y0, y1obb, y2obb, y3obb);
            const bboxW = maxX - minX;
            const bboxH = maxY - minY;
            if (bboxW <= 0 || bboxH <= 0) return;

            // Reject full-artboard fallback bboxes (> 85% of artboard in both axes)
            const artW = (artboard!.props?.width as number) || 0;
            const artH = (artboard!.props?.height as number) || 0;
            if (artW > 0 && artH > 0 && bboxW > artW * dpr * viewport.zoom * 0.85 && bboxH > artH * dpr * viewport.zoom * 0.85) return;

            // Convert ThorVG canvas pixels → CSS pixels (cssX = tx + canvasPixelX / dpr)
            const cssx = tx + minX / dpr;
            const cssy = ty + minY / dpr;
            const cssw = bboxW / dpr;
            const cssh = bboxH / dpr;

            if (cssx <= x2 && cssx + cssw >= x1 && cssy <= y2 && cssy + cssh >= y1) {
              newlySelected.push(nodeId);
            }
          });
        } else {
          // Fallback: Canvas2D matrix-based marquee (used when ThorVG is not active or
          // lottieNeedsReload=true, and for user-drawn nodes with no animation source).
          nodes.forEach((node, id) => {
            if (node.type === 'artboard') return;

            if (activeArtboardId) {
              let belongs = false;
              let curr: any = node;
              while (curr && curr.parentId) {
                if (curr.parentId === activeArtboardId) { belongs = true; break; }
                curr = nodes.get(curr.parentId);
              }
              if (!belongs) return;
            }

            const combined = viewTransform.multiply(getWorldMatrix(id, nodes, currentTime, activeArtboardId || undefined));
            const screenBounds = getBoundingBox(node, combined, nodes, currentTime);

            if (
              screenBounds.x <= x2 &&
              screenBounds.x + screenBounds.width >= x1 &&
              screenBounds.y <= y2 &&
              screenBounds.y + screenBounds.height >= y1 &&
              isNodeSelectable(id, nodes)
            ) {
              newlySelected.push(id);
            }
          });
        }

        if (e.shiftKey) {
          newlySelected.forEach(id => addToSelection(id));
        } else {
          setSelection(newlySelected);
        }
      }
    } else if (interaction.type === 'move' && interaction.initialClickId) {
      // If it was a simple click (not much movement), select ONLY the clicked item
      // This is Figma behavior: Clicking a selected item in a group doesn't change selection on mousedown,
      // but selects ONLY that item on mouseup if no drag occurred.
      const moveThreshold = 3;
      const dx = Math.abs(e.clientX - (containerRef.current?.getBoundingClientRect().left || 0) - (interaction.currentPos?.x || 0));
      const dy = Math.abs(e.clientY - (containerRef.current?.getBoundingClientRect().top || 0) - (interaction.currentPos?.y || 0));

      if (dx < moveThreshold && dy < moveThreshold && !e.shiftKey) {
        if (isNodeSelectable(interaction.initialClickId, nodes)) {
          setSelection([interaction.initialClickId]);
        }
      }
    }
    setInteraction({ type: 'none', startPos: { x: 0, y: 0 } });
    setActiveGuides({ x: null, y: null });
    if (activeTool !== 'pen') setPreviewNode(null);

    const container = containerRef.current;
    if (container && viewTransform) {
      const rect = container.getBoundingClientRect();
      const canvasPos = screenToCanvas(e.clientX - rect.left, e.clientY - rect.top, viewTransform);
      const localPos = getArtboardLocalPos(canvasPos);
      const toolEvent = { x: localPos.x, y: localPos.y, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey };
      if (activeTool === 'rect' && rectToolRef.current) rectToolRef.current.onMouseUp(toolEvent);
      if (activeTool === 'ellipse' && ellipseToolRef.current) ellipseToolRef.current.onMouseUp(toolEvent);
      if (activeTool === 'star' && starToolRef.current) starToolRef.current.onMouseUp(toolEvent);
      if (activeTool === 'pen' && penToolRef.current) penToolRef.current.onMouseUp(toolEvent);
    }
  };

  // Render Pen Tool Overlays (Handles/Points)
  const penOverlay = useMemo(() => {
    if (activeTool !== 'pen' || !previewNode || !viewTransform) return null;
    const points = previewNode.props.points as VectorPoint[];
    if (!points || points.length === 0) return null;

    const nextMousePos = previewNode.props.nextMousePos;
    const lastPoint = points[points.length - 1];

    return (
      <svg className="absolute inset-0 pointer-events-none w-full h-full z-[80]">
        {/* Render actual segments in preview */}
        <g opacity="0.5">
          {points.map((p, i) => {
            if (i === 0) return null;
            const prev = points[i - 1];
            const p1 = new DOMPoint(prev.x, prev.y).matrixTransform(viewTransform);
            const p2 = new DOMPoint(p.x, p.y).matrixTransform(viewTransform);
            const cp1 = new DOMPoint(prev.x + prev.outX, prev.y + prev.outY).matrixTransform(viewTransform);
            const cp2 = new DOMPoint(p.x + p.inX, p.y + p.inY).matrixTransform(viewTransform);
            return (
              <path
                key={`seg-${i}`}
                d={`M ${p1.x},${p1.y} C ${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${p2.x},${p2.y}`}
                stroke="#0A84FF"
                strokeWidth="2"
                fill="none"
              />
            );
          })}
        </g>

        {/* Rubber band line */}
        {nextMousePos && !previewNode.props.closed && (
          <path
            d={`M ${new DOMPoint(lastPoint.x, lastPoint.y).matrixTransform(viewTransform).x},${new DOMPoint(lastPoint.x, lastPoint.y).matrixTransform(viewTransform).y} 
                C ${new DOMPoint(lastPoint.x + lastPoint.outX, lastPoint.y + lastPoint.outY).matrixTransform(viewTransform).x},${new DOMPoint(lastPoint.x + lastPoint.outX, lastPoint.y + lastPoint.outY).matrixTransform(viewTransform).y} 
                ${new DOMPoint(nextMousePos.x, nextMousePos.y).matrixTransform(viewTransform).x},${new DOMPoint(nextMousePos.x, nextMousePos.y).matrixTransform(viewTransform).y} 
                ${new DOMPoint(nextMousePos.x, nextMousePos.y).matrixTransform(viewTransform).x},${new DOMPoint(nextMousePos.x, nextMousePos.y).matrixTransform(viewTransform).y}`}
            stroke="#0A84FF"
            strokeWidth="1.5"
            fill="none"
            strokeDasharray="4,4"
            opacity="0.8"
          />
        )}

        {/* Handles and Points */}
        {points.map((p, i) => {
          const screen = new DOMPoint(p.x, p.y).matrixTransform(viewTransform);
          const outH = new DOMPoint(p.x + p.outX, p.y + p.outY).matrixTransform(viewTransform);
          const inH = new DOMPoint(p.x + p.inX, p.y + p.inY).matrixTransform(viewTransform);

          const hasHandles = p.inX !== 0 || p.inY !== 0 || p.outX !== 0 || p.outY !== 0;

          return (
            <g key={i}>
              {hasHandles && (
                <>
                  <line x1={screen.x} y1={screen.y} x2={outH.x} y2={outH.y} stroke="#0A84FF" strokeWidth="1" opacity="0.6" />
                  <line x1={screen.x} y1={screen.y} x2={inH.x} y2={inH.y} stroke="#0A84FF" strokeWidth="1" opacity="0.6" />
                  <circle cx={outH.x} cy={outH.y} r="3" fill="white" stroke="#0A84FF" strokeWidth="1" />
                  <circle cx={inH.x} cy={inH.y} r="3" fill="white" stroke="#0A84FF" strokeWidth="1" />
                </>
              )}
              <rect
                x={screen.x - 3}
                y={screen.y - 3}
                width="6"
                height="6"
                fill={i === points.length - 1 ? "#0A84FF" : "white"}
                stroke="#0A84FF"
                strokeWidth="1.5"
                className="pointer-events-auto cursor-pointer"
              />
            </g>
          );
        })}
      </svg>
    );
  }, [previewNode, activeTool, viewTransform]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    const state = useCreatorStore.getState();
    if (state.smIsPlaying || state.creatorMode === 'state-flow') return;
    const container = containerRef.current;
    if (!container || !viewTransform) return;
    const rect = container.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const canvasPos = screenToCanvas(screenX, screenY, viewTransform);
    const artboard = activeArtboardId ? nodes.get(activeArtboardId) : Array.from(nodes.values()).find(n => n.type === 'artboard');
    const artboardLocal = getArtboardLocalPos(canvasPos);

    // ThorVG hit testing for double-click
    let hitNodeId: string | null = null;
    if (dotlottieRef.current && !lottieNeedsReload && artboard) {
      hitNodeId = hitTestThorVGLayers(
        screenX, screenY,
        canvasSize.width, canvasSize.height,
        viewport.zoom, viewport.pan,
        artboard.children,
        nodes,
        currentTime,
        AnimationUtils.getPropertyValue(artboard, 'props.width', currentTime) || 0,
        AnimationUtils.getPropertyValue(artboard, 'props.height', currentTime) || 0,
      );
    }
    if (!hitNodeId) {
      hitNodeId = findNodeAtPoint(artboardLocal.x, artboardLocal.y, nodes, artboard?.id || null, e.ctrlKey || e.metaKey, currentTime, artboard?.id || undefined);
    }

    if (hitNodeId) {
      const node = nodes.get(hitNodeId);
      if (node) {
        setSelection([hitNodeId]);

        if (node.type === 'precomp' && node.refId) {
          // Switch to nested artboard
          setSelection([]); // Clear selection when entering
          setActiveArtboard(node.refId);
        } else if (node.type === 'rect' || node.type === 'ellipse') {
          // Convert to path for editing
          const points = convertToPath(node);
          updateNode(hitNodeId, {
            type: 'path',
            props: {
              ...node.props,
              points,
              closed: true
            }
          });
          setEditingNode(hitNodeId);
        } else if (node.type === 'path') {
          // Path nodes (including boolean operation results) can be edited directly
          setEditingNode(hitNodeId);
        } else if (node.type === 'text') {
          setTextEditState(createTextEditState(hitNodeId, node.props.text || ''));
          hiddenInputRef.current?.focus();
        }

        // Clear any interaction that started with the first click
        setInteraction({ type: 'none', startPos: { x: 0, y: 0 } });
      }
    } else {
      setEditingNode(null);
      setTextEditState(null);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`w-full h-full relative overflow-hidden ${activeTool === 'pen' ? 'cursor-crosshair' : ''}`}
      style={{ background: 'var(--bg-canvas)', cursor: getCursor() }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDoubleClick={handleDoubleClick}
      onMouseLeave={() => {
        setHoveredNodeId(null);
        const state = useCreatorStore.getState();
        if (state.smIsPlaying) {
          const hoveredBefore = (window as any).__lastSmHovered;
          if (hoveredBefore) {
            processStateInteraction('PointerExit', hoveredBefore, state);
            (window as any).__lastSmHovered = null;
          }
        }
      }}
    >
      {/* ThorVG playback layer — always at z-21 (above Canvas2D at z-20).
          Always visible: hiding the canvas during reload causes setFrame() to skip rendering,
          leaving ThorVG blank. Keeping it visible ensures the WASM renderer always commits
          frames to the GPU. lottieNeedsReload controls hit-testing fallback only. */}
      {(() => {
        const artboard = activeArtboardId ? nodes.get(activeArtboardId) : Array.from(nodes.values()).find(n => n.type === 'artboard');
        const aw = artboard?.props?.width ?? 800;
        const ah = artboard?.props?.height ?? 600;
        return (
          <DotLottiePlayback
            visible={true}
            artboardWidth={aw}
            artboardHeight={ah}
            viewportZoom={viewport.zoom}
            viewportPan={viewport.pan}
            containerWidth={canvasSize.width}
            containerHeight={canvasSize.height}
          />
        );
      })()}

      {/* Main authoring canvas — always z-20 (below ThorVG at z-21).
          ThorVG covers it continuously; Canvas2D handles user-drawn nodes and overlay math.
          Hidden during playback so ThorVG renders unobstructed. */}
      <canvas
        ref={canvasRef}
        className="w-full h-full pointer-events-none absolute inset-0"
        style={{
          opacity: isPlaying ? 0 : 1,
          zIndex: 20,
        }}
      />

      {viewTransform && (
        <MotionPathOverlay viewTransform={viewTransform} />
      )}

      {viewTransform && !isPlaying && (
        <SelectionOverlay
          viewTransform={viewTransform}
          interaction={interaction}
          hoveredNodeId={hoveredNodeId}
          textEditingId={textEditState?.nodeId ?? null}
        />
      )}

      {/* Alignment & Measurement Guides Overlay */}
      {viewTransform && (activeGuides.x !== null || activeGuides.y !== null || measurementTargetId !== null) && (
        <svg className="absolute inset-0 pointer-events-none w-full h-full z-[150]">
          {/* Snap Guides */}
          {activeGuides.x !== null && (() => {
            const p = new DOMPoint(activeGuides.x, 0).matrixTransform(viewTransform);
            return <line x1={p.x} y1={0} x2={p.x} y2="100%" stroke="#0A84FF" strokeWidth="1" />;
          })()}
          {activeGuides.y !== null && (() => {
            const p = new DOMPoint(0, activeGuides.y).matrixTransform(viewTransform);
            return <line x1={0} y1={p.y} x2="100%" y2={p.y} stroke="#0A84FF" strokeWidth="1" />;
          })()}

          {/* Figma-style Spacing Measurements */}
          {measurementTargetId && (() => {
            const sourceBounds = getCollectiveBoundingBox(selectedIds, nodes, currentTime, activeArtboardId || undefined);
            const targetNode = nodes.get(measurementTargetId);
            if (!targetNode || isNaN(sourceBounds.x)) return null;

            const targetWorldMatrix = getWorldMatrix(measurementTargetId, nodes, currentTime, activeArtboardId || undefined);
            const targetBounds = getBoundingBox(targetNode, targetWorldMatrix, nodes, currentTime);
            if (isNaN(targetBounds.x)) return null;

            const renderLabel = (val: number, x: number, y: number, horizontal: boolean, labelKey: string) => {
              const v = Math.abs(Math.round(val));
              if (v === 0 || isNaN(v)) return null;
              const screen = new DOMPoint(x, y).matrixTransform(viewTransform);

              return (
                <g key={`label-${labelKey}`}>
                  <rect
                    x={screen.x - 15}
                    y={screen.y - 10}
                    width="30"
                    height="20"
                    rx="4"
                    fill="#0A84FF"
                    className="drop-shadow-sm"
                  />
                  <text
                    x={screen.x}
                    y={screen.y + 1}
                    fill="white"
                    fontSize="11"
                    textAnchor="middle"
                    alignmentBaseline="middle"
                    style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600 }}
                  >
                    {v}
                  </text>
                </g>
              );
            };

            const renderTLine = (x1: number, y1: number, x2: number, y2: number, horizontal: boolean, lineKey: string) => {
              const p1 = new DOMPoint(x1, y1).matrixTransform(viewTransform);
              const p2 = new DOMPoint(x2, y2).matrixTransform(viewTransform);
              if (isNaN(p1.x) || isNaN(p2.x)) return null;

              const tSize = 5;
              const elements = [];

              elements.push(<line key={`l-${lineKey}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#0A84FF" strokeWidth="1.2" />);

              if (horizontal) {
                elements.push(<line key={`t1-${lineKey}`} x1={p1.x} y1={p1.y - tSize} x2={p1.x} y2={p1.y + tSize} stroke="#0A84FF" strokeWidth="1.2" />);
                elements.push(<line key={`t2-${lineKey}`} x1={p2.x} y1={p2.y - tSize} x2={p2.x} y2={p2.y + tSize} stroke="#0A84FF" strokeWidth="1.2" />);
              } else {
                elements.push(<line key={`t1-${lineKey}`} x1={p1.x - tSize} y1={p1.y} x2={p1.x + tSize} y2={p1.y} stroke="#0A84FF" strokeWidth="1.2" />);
                elements.push(<line key={`t2-${lineKey}`} x1={p2.x - tSize} y1={p2.y} x2={p2.x + tSize} y2={p2.y} stroke="#0A84FF" strokeWidth="1.2" />);
              }
              return elements;
            };

            const renderProjection = (x1: number, y1: number, x2: number, y2: number, projKey: string) => {
              const p1 = new DOMPoint(x1, y1).matrixTransform(viewTransform);
              const p2 = new DOMPoint(x2, y2).matrixTransform(viewTransform);
              if (isNaN(p1.x) || isNaN(p2.x)) return null;
              return <line key={`p-${projKey}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#0A84FF" strokeWidth="1" strokeDasharray="3,2" opacity="0.5" />;
            };

            const elements: any[] = [];
            const sCenterX = sourceBounds.x + sourceBounds.width / 2;
            const sCenterY = sourceBounds.y + sourceBounds.height / 2;

            // Horizontal Logic
            if (sourceBounds.x + sourceBounds.width < targetBounds.x) {
              // Gap to the right
              const midX = (sourceBounds.x + sourceBounds.width + targetBounds.x) / 2;
              elements.push(renderTLine(sourceBounds.x + sourceBounds.width, sCenterY, targetBounds.x, sCenterY, true, 'h-right'));
              elements.push(renderLabel(targetBounds.x - (sourceBounds.x + sourceBounds.width), midX, sCenterY, true, 'h-right'));
              // Projections
              elements.push(renderProjection(targetBounds.x, targetBounds.y, targetBounds.x, sCenterY, 'h-right-1'));
              elements.push(renderProjection(targetBounds.x, targetBounds.y + targetBounds.height, targetBounds.x, sCenterY, 'h-right-2'));
            } else if (sourceBounds.x > targetBounds.x + targetBounds.width) {
              // Gap to the left
              const midX = (targetBounds.x + targetBounds.width + sourceBounds.x) / 2;
              elements.push(renderTLine(targetBounds.x + targetBounds.width, sCenterY, sourceBounds.x, sCenterY, true, 'h-left'));
              elements.push(renderLabel(sourceBounds.x - (targetBounds.x + targetBounds.width), midX, sCenterY, true, 'h-left'));
              // Projections
              elements.push(renderProjection(targetBounds.x + targetBounds.width, targetBounds.y, targetBounds.x + targetBounds.width, sCenterY, 'h-left-1'));
              elements.push(renderProjection(targetBounds.x + targetBounds.width, targetBounds.y + targetBounds.height, targetBounds.x + targetBounds.width, sCenterY, 'h-left-2'));
            } else {
              // Overlap/Inside
              // Distance to left edge
              elements.push(renderTLine(targetBounds.x, sCenterY, sourceBounds.x, sCenterY, true, 'h-in-left'));
              elements.push(renderLabel(sourceBounds.x - targetBounds.x, (targetBounds.x + sourceBounds.x) / 2, sCenterY, true, 'h-in-left'));
              // Distance to right edge
              elements.push(renderTLine(sourceBounds.x + sourceBounds.width, sCenterY, targetBounds.x + targetBounds.width, sCenterY, true, 'h-in-right'));
              elements.push(renderLabel(targetBounds.x + targetBounds.width - (sourceBounds.x + sourceBounds.width), (sourceBounds.x + sourceBounds.width + targetBounds.x + targetBounds.width) / 2, sCenterY, true, 'h-in-right'));
            }

            // Vertical Logic
            if (sourceBounds.y + sourceBounds.height < targetBounds.y) {
              // Gap below
              const midY = (sourceBounds.y + sourceBounds.height + targetBounds.y) / 2;
              elements.push(renderTLine(sCenterX, sourceBounds.y + sourceBounds.height, sCenterX, targetBounds.y, false, 'v-below'));
              elements.push(renderLabel(targetBounds.y - (sourceBounds.y + sourceBounds.height), sCenterX, midY, false, 'v-below'));
              // Projections
              elements.push(renderProjection(targetBounds.x, targetBounds.y, sCenterX, targetBounds.y, 'v-below-1'));
              elements.push(renderProjection(targetBounds.x + targetBounds.width, targetBounds.y, sCenterX, targetBounds.y, 'v-below-2'));
            } else if (sourceBounds.y > targetBounds.y + targetBounds.height) {
              // Gap above
              const midY = (targetBounds.y + targetBounds.height + sourceBounds.y) / 2;
              elements.push(renderTLine(sCenterX, targetBounds.y + targetBounds.height, sCenterX, sourceBounds.y, false, 'v-above'));
              elements.push(renderLabel(sourceBounds.y - (targetBounds.y + targetBounds.height), sCenterX, midY, false, 'v-above'));
              // Projections
              elements.push(renderProjection(targetBounds.x, targetBounds.y + targetBounds.height, sCenterX, targetBounds.y + targetBounds.height, 'v-above-1'));
              elements.push(renderProjection(targetBounds.x + targetBounds.width, targetBounds.y + targetBounds.height, sCenterX, targetBounds.y + targetBounds.height, 'v-above-2'));
            } else {
              // Overlap/Inside
              // Top edge
              elements.push(renderTLine(sCenterX, targetBounds.y, sCenterX, sourceBounds.y, false, 'v-in-top'));
              elements.push(renderLabel(sourceBounds.y - targetBounds.y, sCenterX, (targetBounds.y + sourceBounds.y) / 2, false, 'v-in-top'));
              // Bottom edge
              elements.push(renderTLine(sCenterX, sourceBounds.y + sourceBounds.height, sCenterX, targetBounds.y + targetBounds.height, false, 'v-in-bottom'));
              elements.push(renderLabel(targetBounds.y + targetBounds.height - (sourceBounds.y + sourceBounds.height), sCenterX, (sourceBounds.y + sourceBounds.height + targetBounds.y + targetBounds.height) / 2, false, 'v-in-bottom'));
            }

            return elements;
          })()}
        </svg>
      )}

      {penOverlay}

      {/* Hidden input — captures keyboard/IME events for canvas-native text editing */}
      <input
        ref={hiddenInputRef}
        type="text"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        style={{ opacity: 0, position: 'absolute', left: -9999, top: -9999, width: 1, height: 1, pointerEvents: 'none' }}
        onKeyDown={(e) => {
          if (!textEditState) return;
          e.stopPropagation();
          const node = nodes.get(textEditState.nodeId);
          if (!node) return;

          let next = textEditState;

          switch (e.key) {
            case 'Enter':
              if (e.shiftKey) {
                next = tcInsertText(textEditState, '\n');
                break;
              }
              setTextEditState(null);
              return;
            case 'Escape':
              updateNode(textEditState.nodeId, { props: { ...node.props, text: textEditState.originalText } });
              setTextEditState(null);
              return;
            case 'Backspace':
              next = deleteBackward(textEditState);
              break;
            case 'Delete':
              next = deleteForward(textEditState);
              break;
            case 'ArrowLeft':
              next = moveCursorLeft(textEditState, e.shiftKey);
              break;
            case 'ArrowRight':
              next = moveCursorRight(textEditState, e.shiftKey);
              break;
            case 'Home':
              next = moveCursorHome(textEditState, e.shiftKey);
              break;
            case 'End':
              next = moveCursorEnd(textEditState, e.shiftKey);
              break;
            case 'a':
              if (e.ctrlKey || e.metaKey) {
                next = tcSelectAll(textEditState);
                break;
              }
              return;
            case 'c':
              if (e.ctrlKey || e.metaKey) {
                const sel = getSelectedText(textEditState);
                if (sel) navigator.clipboard.writeText(sel);
              }
              return;
            case 'x':
              if (e.ctrlKey || e.metaKey) {
                const sel = getSelectedText(textEditState);
                if (sel) {
                  navigator.clipboard.writeText(sel);
                  next = tcInsertText(textEditState, '');
                  break;
                }
              }
              return;
            default:
              return;
          }

          e.preventDefault();
          setTextEditState(next);
          if (next.text !== node.props.text) {
            updateNode(next.nodeId, { props: { ...node.props, text: next.text } });
          }
        }}
        onInput={(e) => {
          if (!textEditState || textEditState.composing) return;
          const data = (e.nativeEvent as InputEvent).data;
          if (!data) return;
          const node = nodes.get(textEditState.nodeId);
          if (!node) return;
          (e.target as HTMLInputElement).value = '';
          const next = tcInsertText(textEditState, data);
          setTextEditState(next);
          updateNode(next.nodeId, { props: { ...node.props, text: next.text } });
        }}
        onCompositionStart={() => {
          setTextEditState(prev => prev ? { ...prev, composing: true, compositionText: '' } : null);
        }}
        onCompositionUpdate={(e) => {
          setTextEditState(prev => prev ? { ...prev, compositionText: e.data } : null);
        }}
        onCompositionEnd={(e) => {
          if (!textEditState) return;
          const node = nodes.get(textEditState.nodeId);
          if (!node) return;
          (e.target as HTMLInputElement).value = '';
          const next = tcInsertText({ ...textEditState, composing: false, compositionText: '' }, e.data);
          setTextEditState(next);
          updateNode(next.nodeId, { props: { ...node.props, text: next.text } });
        }}
        onPaste={(e) => {
          if (!textEditState) return;
          e.preventDefault();
          const node = nodes.get(textEditState.nodeId);
          if (!node) return;
          const pasted = e.clipboardData.getData('text/plain');
          const next = tcInsertText(textEditState, pasted);
          setTextEditState(next);
          updateNode(next.nodeId, { props: { ...node.props, text: next.text } });
        }}
        onBlur={() => {
          setTimeout(() => {
            if (document.activeElement !== hiddenInputRef.current) {
              setTextEditState(null);
            }
          }, 100);
        }}
      />

      {/* Canvas-native text edit cursor + selection overlay */}
      {textEditState && (() => {
        const node = nodes.get(textEditState.nodeId);
        if (!node || !viewTransform) return null;
        return (
          <TextEditOverlay
            textEditState={textEditState}
            node={node}
            nodes={nodes}
            viewTransform={viewTransform}
            currentTime={currentTime}
            activeArtboardId={activeArtboardId}
          />
        );
      })()}


      <div
        className="absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-1 p-0.5 rounded-[12px] border border-white/20 shadow-[0_15px_30px_-10px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.05)] pointer-events-auto z-[100] transition-all duration-700 cubic-bezier(0.16,1,0.3,1) hover:scale-[1.03]"
        style={{
          background: 'linear-gradient(180deg, rgba(30, 30, 35, 0.9) 0%, rgba(15, 15, 18, 0.98) 100%)',
          backdropFilter: 'blur(20px) saturate(250%) contrast(110%)',
          WebkitBackdropFilter: 'blur(20px) saturate(250%) contrast(110%)',
        }}
      >
        {/* Time Tracking (Micro Pod) */}
        <div className="px-2 py-0.5 bg-black/40 rounded-[8px] border border-white/5 flex items-center justify-center min-w-[64px] shadow-inner">
          <span className="text-[10px] font-mono font-medium text-accent tracking-tighter">
            {Math.floor(currentTime / fps)}s {Math.round(currentTime % fps)}f
          </span>
        </div>

        {/* Navigation Group (Micro Well) */}
        <div className="flex items-center gap-0.5 bg-white/[0.03] p-0.5 rounded-[8px] border border-white/5 shadow-inner">
          <button
            onClick={() => setCurrentTime(Math.max(0, currentTime - 1))}
            className="w-6 h-6 flex items-center justify-center hover:bg-white/10 rounded-[6px] text-white/20 hover:text-white transition-all active:scale-90"
            title="Step Backward"
          >
            <SkipBack size={10} fill="currentColor" />
          </button>

          <button
            onClick={() => {
              if (creatorMode === 'state-flow') toggleSmPlaying();
              else togglePlaying();
            }}
            className={`w-7 h-7 flex items-center justify-center rounded-[7px] transition-all duration-300 active:scale-90 ${(creatorMode === 'state-flow' ? smIsPlaying : isPlaying) ? 'text-white' : 'bg-white/10 text-white hover:bg-white/20'}`}
            style={(creatorMode === 'state-flow' ? smIsPlaying : isPlaying) ? { background: 'var(--accent)' } : {}}
          >
            {(creatorMode === 'state-flow' ? smIsPlaying : isPlaying) ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" className="ml-0.5" />}
          </button>

          <button
            onClick={() => setCurrentTime(Math.min(duration, currentTime + 1))}
            className="w-6 h-6 flex items-center justify-center hover:bg-white/10 rounded-[6px] text-white/20 hover:text-white transition-all active:scale-90"
            title="Step Forward"
          >
            <SkipForward size={10} fill="currentColor" />
          </button>
        </div>

        {/* Secondary Controls Group (Micro) */}
        <div className="flex items-center gap-0.5 bg-white/[0.02] p-0.5 rounded-[8px] border border-white/5">
          <button
            onClick={toggleLooping}
            className={`w-6 h-6 flex items-center justify-center rounded-[6px] transition-all duration-300 ${isLooping ? 'text-accent bg-accent/15' : 'text-white/20 hover:text-white/40'}`}
            title="Toggle Loop"
          >
            <Repeat size={12} />
          </button>

          <div className="w-px h-2.5 bg-white/10 mx-0.5" />

          {/* Zoom Section */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setViewport(prev => ({ ...prev, zoom: Math.max(0.01, prev.zoom * 0.8) }))}
              className="w-5 h-5 flex items-center justify-center hover:bg-white/10 rounded-[4px] text-white/20 hover:text-white transition-colors"
            >
              <Minus size={10} />
            </button>
            <div className="min-w-[28px] text-center">
              <span className="text-[9px] font-mono font-bold text-white/40 tracking-tight">
                {Math.round(viewport.zoom * 100)}%
              </span>
            </div>
            <button
              onClick={() => setViewport(prev => ({ ...prev, zoom: Math.min(100, prev.zoom * 1.25) }))}
              className="w-5 h-5 flex items-center justify-center hover:bg-white/10 rounded-[4px] text-white/20 hover:text-white transition-colors"
            >
              <Plus size={10} />
            </button>
          </div>
        </div>
      </div>

      {/* Font Preloader (Hidden) to keep fonts "hot" in the browser */}
      <div style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', visibility: 'hidden', height: 0, overflow: 'hidden' }}>
        {Array.from(new Set(Array.from(nodes.values()).filter(n => n.type === 'text').map(n => n.props.fontFamily || 'Inter'))).map(font => (
          <span key={font} style={{ fontFamily: font }}>.</span>
        ))}
      </div>
    </div>
  );
}
