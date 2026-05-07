'use client';

import { useState, useRef, useEffect } from 'react';
import { useCreatorStore } from '@/lib/creator/state/store';
import { getBoundingBox, getWorldMatrix, localToScreen, getCollectiveBoundingBox, getGroupLocalBounds, createTransformMatrix, getPathLocalBounds, getAnimatedAnchor } from '@/lib/creator/core/Matrix';
import { getTextLocalBounds } from '@/lib/creator/text/TextMeasurer';
import { AnimationUtils } from '@/lib/creator/core/Animation';
import { Gradient } from '@/lib/creator/state/sceneSlice';
import { dotlottieRef } from '@/lib/creator/state/dotlottieRef';

interface SelectionOverlayProps {
  viewTransform: DOMMatrix;
  interaction?: {
    type: string;
    nodeId?: string;
    vertexIndex?: number;
    gradientHandle?: 'start' | 'end';
    startPos: { x: number; y: number };
    currentPos?: { x: number; y: number };
  };
  hoveredNodeId: string | null;
  textEditingId?: string | null;
}

/**
 * Convert a ThorVG OBB [x0,y0, x1,y1, x2,y2, x3,y3] (4 corners clockwise from top-left,
 * in canvas pixels) to CSS pixel corner points.
 *
 * getLayerBoundingBox() returns 8 values — the 4 OBB corner points, NOT [x,y,w,h].
 * Corner order (clockwise): top-left, top-right, bottom-right, bottom-left.
 *
 * Canvas is sized as artboardW * dpr * zoom (zoom baked in), positioned via
 * CSS transform: translate(tx, ty) with no CSS scale.
 * So canvas pixel cx maps to CSS: tx + cx/dpr.
 *
 * Math: cssX = tx + canvasPixelX / dpr
 *       tx = new DOMPoint(0,0).matrixTransform(viewTransform).x
 *       zoom = viewTransform.a
 */
// Minimum screen-pixel bounding-box dimension before resize/rotate handles are hidden.
// Matches the same constant in CanvasView so hit-test and rendering stay in sync.
const MIN_HANDLE_SCREEN_PX = 20;

function thorVGBoxToCSS(
  bbox: number[],
  viewTransform: DOMMatrix
): { tl: {x:number,y:number}, tr: {x:number,y:number}, br: {x:number,y:number}, bl: {x:number,y:number}, worldW: number, worldH: number } | null {
  if (!bbox || bbox.length < 8) return null;
  const [x0, y0, x1, y1, x2, y2, x3, y3] = bbox;
  if (![x0, y0, x1, y1, x2, y2, x3, y3].every(isFinite)) return null;

  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
  const zoom = viewTransform.a;
  const origin = new DOMPoint(0, 0).matrixTransform(viewTransform); // = (tx, ty)

  const toCss = (cx: number, cy: number) => ({
    x: origin.x + cx / dpr,
    y: origin.y + cy / dpr,
  });

  const tl = toCss(x0, y0);
  const tr = toCss(x1, y1);
  const br = toCss(x2, y2);
  const bl = toCss(x3, y3);

  // Width/height from OBB edge lengths (handles rotated boxes too)
  const widthCss  = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const heightCss = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  if (widthCss <= 0.5 || heightCss <= 0.5) return null;

  return { tl, tr, br, bl, worldW: widthCss / zoom, worldH: heightCss / zoom };
}

export default function SelectionOverlay({ viewTransform, interaction, hoveredNodeId, textEditingId }: SelectionOverlayProps) {
  const nodes = useCreatorStore((state) => state.nodes);
  const selectedIds = useCreatorStore((state) => state.selectedIds);
  const editingNodeId = useCreatorStore((state) => state.editingNodeId);
  const currentTime = useCreatorStore((state) => state.currentTime);
  const activeArtboardId = useCreatorStore((state) => state.activeArtboardId);
  const artboard = activeArtboardId ? nodes.get(activeArtboardId) : Array.from(nodes.values()).find(n => n.type === 'artboard');
  const previewNode = useCreatorStore((state) => state.previewNode);
  const lottieNeedsReload = useCreatorStore((state) => state.lottieNeedsReload);

  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState('');

  const showMarquee = interaction?.type === 'marquee' && interaction.currentPos;
  const marqueeBounds = showMarquee ? {
    x: Math.min(interaction.startPos.x, interaction.currentPos!.x),
    y: Math.min(interaction.startPos.y, interaction.currentPos!.y),
    width: Math.abs(interaction.currentPos!.x - interaction.startPos.x),
    height: Math.abs(interaction.currentPos!.y - interaction.startPos.y),
  } : null;

  if ((selectedIds.length === 0 && !artboard && !showMarquee && !hoveredNodeId && !previewNode) || !viewTransform) return null;

  // True when ThorVG has data loaded and getLayerBoundingBox() will be accurate.
  // Works for both imported (rawAnimationSource set) and from-scratch scenes.
  const thorVGReady = !!(!lottieNeedsReload && dotlottieRef.current);

  // Only query ThorVG bbox for DIRECT artboard children (top-level Lottie layers like "Layer 18",
  // "mask 16", etc.). Nested nodes like "Group 1" and "Path 1" appear many times in the animation
  // tree — ThorVG would return the first match, which is often the wrong layer.
  // Track-matte clipped layers (matteSourceId set) are allowed — ThorVG computes their bounds
  // from actual rendered output, which naturally matches the visual position. isValidThorVGBbox
  // filters out any full-canvas results in case ThorVG can't resolve a specific layer.
  //
  // CRITICAL: getLayerBoundingBox() matches by NAME string. If multiple shapes share the same
  // name (e.g., two "Rectangle" nodes), ThorVG returns whichever it finds first — which may be
  // the wrong shape. We must verify the name is unique among sibling layers before querying.
  const isThorVGQueryable = (nodeId: string) => {
    const node = nodes.get(nodeId);
    if (!node || !thorVGReady || !node.name || node.type === 'artboard') return false;
    if (node.parentId !== artboard?.id) return false;
    // Check name uniqueness among sibling layers — ThorVG looks up by name, so duplicates
    // would return the wrong layer's bbox.
    if (artboard) {
      const siblingCount = artboard.children.filter(sibId => {
        const sib = nodes.get(sibId);
        return sib && sib.name === node.name;
      }).length;
      if (siblingCount > 1) return false;
    }
    return true;
  };

  // Reject ThorVG bbox results that cover nearly the full artboard — this happens when ThorVG
  // cannot resolve a layer and returns its canvas dimensions instead. Threshold: > 85% in both axes.
  const isValidThorVGBbox = (worldW: number, worldH: number): boolean => {
    if (!artboard) return true;
    const artW = (artboard.props?.width as number) || 0;
    const artH = (artboard.props?.height as number) || 0;
    if (artW <= 0 || artH <= 0) return true;
    return !(worldW / artW > 0.85 && worldH / artH > 0.85);
  };

  // Walk up the parent chain from nodeId to find the nearest ancestor that isThorVGQueryable.
  // Used to display the containing layer's bbox when a nested node is selected (mirrors LottieFiles UX).
  const findQueryableAncestor = (nodeId: string): string | null => {
    let cur = nodes.get(nodeId)?.parentId;
    while (cur) {
      if (isThorVGQueryable(cur)) return cur;
      cur = nodes.get(cur)?.parentId;
    }
    return null;
  };

  // Synchronously seek ThorVG to currentTime before querying bbox.
  // SelectionOverlay renders during React's render phase, but DotLottiePlayback's useEffect
  // that calls setFrame() fires only after commit — causing a one-render lag where ThorVG is
  // still at the previous frame when getLayerBoundingBox() is called. Calling setFrame() here
  // forces ThorVG's WASM scene state to update synchronously so the bbox is frame-accurate.
  const queryLayerBbox = (layerName: string): number[] | null => {
    const dl = dotlottieRef.current;
    if (!dl) return null;
    // Only re-seek if ThorVG's internal frame differs from our currentTime
    if (Math.abs(dl.currentFrame - currentTime) > 0.5) {
      dl.setFrame(currentTime);
    }
    return dl.getLayerBoundingBox(layerName) ?? null;
  };

  const renderArtboardMetadata = () => {
    if (!artboard) return null;
    const worldMatrix = getWorldMatrix(artboard.id, nodes, currentTime, activeArtboardId || undefined);
    const combinedMatrix = viewTransform.multiply(worldMatrix);
    const width = AnimationUtils.getPropertyValue(artboard, 'props.width', currentTime) || 0;
    const height = AnimationUtils.getPropertyValue(artboard, 'props.height', currentTime) || 0;
    const tl = localToScreen(0, 0, combinedMatrix);

    if (isEditingName) {
      return (
        <foreignObject x={tl.x + 55} y={tl.y - 30} width="150" height="24">
          <input
            autoFocus
            className="bg-[#2a2a2a] text-white text-[11px] border border-accent rounded px-1.5 outline-none w-full h-full font-semibold"
            value={tempName}
            onChange={(e) => setTempName(e.target.value)}
            onBlur={() => {
              setIsEditingName(false);
              if (tempName.trim()) {
                useCreatorStore.getState().updateNode(artboard.id, { name: tempName.trim() });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                setIsEditingName(false);
                setTempName(artboard.name);
              }
            }}
            onMouseDown={(e) => e.stopPropagation()}
          />
        </foreignObject>
      );
    }

    return (
      <g key="artboard-meta">
        <text
          x={tl.x}
          y={tl.y - 12}
          fill="#a1a1aa"
          fontSize="12"
          fontWeight="600"
          className="select-none cursor-pointer pointer-events-auto"
          onMouseDown={(e) => {
            e.stopPropagation();
            useCreatorStore.getState().setSelection([artboard.id]);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            setTempName(artboard.name || 'Think Motion');
            setIsEditingName(true);
          }}
        >
          <tspan fill="rgba(255,255,255,0.3)" fontWeight="400" fontSize="11">{Math.round(width)} × {Math.round(height)}</tspan>
          <tspan dx="8" fill="white">{artboard.name || 'Think Motion'}</tspan>
        </text>
      </g>
    );
  };

  const renderGradientHandles = (nodeId: string) => {
    const node = nodes.get(nodeId);
    if (!node) return null;

    const renderHandleGroup = (gradient: Gradient, path: string) => {
      const worldMatrix = getWorldMatrix(nodeId, nodes, currentTime, activeArtboardId || undefined);
      const combinedMatrix = viewTransform.multiply(worldMatrix);

      const start = localToScreen(gradient.start.x, gradient.start.y, combinedMatrix);
      const end = localToScreen(gradient.end.x, gradient.end.y, combinedMatrix);

      const isStartHit = interaction?.type === 'edit_gradient' && interaction.nodeId === nodeId && interaction.gradientHandle === 'start';
      const isEndHit = interaction?.type === 'edit_gradient' && interaction.nodeId === nodeId && interaction.gradientHandle === 'end';

      return (
        <g key={path}>
          <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="#0A84FF" strokeWidth="1.5" strokeDasharray="4 2" />
          <circle
            cx={start.x} cy={start.y} r="5"
            fill={isStartHit ? "#0A84FF" : "white"}
            stroke="#0A84FF" strokeWidth="2"
            className="pointer-events-auto cursor-pointer"
          />
          <circle
            cx={end.x} cy={end.y} r="5"
            fill={isEndHit ? "#0A84FF" : "white"}
            stroke="#0A84FF" strokeWidth="2"
            className="pointer-events-auto cursor-pointer shadow-sm"
          />
        </g>
      );
    };

    const overlays = [];
    const fillGradient = AnimationUtils.getPropertyValue(node, 'style.fillGradient', currentTime);
    const strokeGradient = AnimationUtils.getPropertyValue(node, 'style.strokeGradient', currentTime);

    if (node.style.fillType === 'gradient' && fillGradient) {
      overlays.push(renderHandleGroup(fillGradient, 'style.fillGradient'));
    }
    if (node.style.strokeType === 'gradient' && strokeGradient) {
      overlays.push(renderHandleGroup(strokeGradient, 'style.strokeGradient'));
    }

    return overlays.length > 0 ? <g key={`grad-${nodeId}`}>{overlays}</g> : null;
  };

  const renderSingleNodeOverlay = (nodeId: string) => {
    if (nodeId === textEditingId) return null;
    const node = nodes.get(nodeId);
    if (!node) return null;

    const worldMatrix = getWorldMatrix(nodeId, nodes, currentTime, activeArtboardId || undefined);
    const combinedMatrix = viewTransform.multiply(worldMatrix);

    // Path editing mode: render bezier handles only, no bounding box
    if (editingNodeId === nodeId && node.type === 'path') {
      const points = (AnimationUtils.getPropertyValue(node, 'props.points', currentTime) || []) as any[];
      return (
        <g key={nodeId}>
          {points.map((p, i) => {
            const screen = localToScreen(p.x, p.y, combinedMatrix);
            const inH = localToScreen(p.x + p.inX, p.y + p.inY, combinedMatrix);
            const outH = localToScreen(p.x + p.outX, p.y + p.outY, combinedMatrix);
            const isVertexHit = interaction?.type === 'edit_path' && interaction.vertexIndex === i;

            return (
              <g key={i}>
                {(p.inX !== 0 || p.inY !== 0) && <line x1={screen.x} y1={screen.y} x2={inH.x} y2={inH.y} stroke="#0A84FF" strokeWidth="1" opacity="0.5" />}
                {(p.outX !== 0 || p.outY !== 0) && <line x1={screen.x} y1={screen.y} x2={outH.x} y2={outH.y} stroke="#0A84FF" strokeWidth="1" opacity="0.5" />}
                {(p.inX !== 0 || p.inY !== 0) && <circle cx={inH.x} cy={inH.y} r="3" fill="white" stroke="#0A84FF" strokeWidth="1" className="pointer-events-auto cursor-pointer" />}
                {(p.outX !== 0 || p.outY !== 0) && <circle cx={outH.x} cy={outH.y} r="3" fill="white" stroke="#0A84FF" strokeWidth="1" className="pointer-events-auto cursor-pointer" />}
                <rect x={screen.x - 4} y={screen.y - 4} width="8" height="8" fill={isVertexHit ? "#0A84FF" : "white"} stroke="#0A84FF" strokeWidth="2" className="pointer-events-auto cursor-pointer hover:fill-[#0A84FF] transition-colors" />
              </g>
            );
          })}
        </g>
      );
    }

    // Area text: show the text box boundary (width × height) as selection outline
    if (node.type === 'text' && (node.props?.width || 0) > 0) {
      const boxW = node.props.width as number;
      const boxH = (node.props.height as number) || 0;
      const vert = node.props.verticalAlign || 'top';
      const boxY = vert === 'middle' ? -boxH / 2 : vert === 'bottom' ? -boxH : 0;

      const atl = localToScreen(0,    boxY,       combinedMatrix);
      const atr = localToScreen(boxW, boxY,       combinedMatrix);
      const abr = localToScreen(boxW, boxY + boxH, combinedMatrix);
      const abl = localToScreen(0,    boxY + boxH, combinedMatrix);

      const midpoints = [
        { x: (atl.x + atr.x) / 2, y: (atl.y + atr.y) / 2 },
        { x: (atr.x + abr.x) / 2, y: (atr.y + abr.y) / 2 },
        { x: (abr.x + abl.x) / 2, y: (abr.y + abl.y) / 2 },
        { x: (abl.x + atl.x) / 2, y: (abl.y + atl.y) / 2 },
      ];
      const aHandles = [atl, atr, abr, abl, ...midpoints];

      return (
        <g key={nodeId}>
          <path
            d={`M ${atl.x} ${atl.y} L ${atr.x} ${atr.y} L ${abr.x} ${abr.y} L ${abl.x} ${abl.y} Z`}
            fill="none"
            stroke="#0A84FF"
            strokeWidth="1.5"
            strokeDasharray="5 3"
          />
          {aHandles.map((h, i) => (
            <rect key={i} x={h.x - 4} y={h.y - 4} width="8" height="8"
              fill="white" stroke="#0A84FF" strokeWidth="1.5"
              className="pointer-events-auto cursor-pointer" />
          ))}
          <g transform={`translate(${(atl.x + atr.x) / 2}, ${abr.y + 16})`}>
            <rect x="-38" y="-10" width="76" height="20" rx="4" fill="#0A84FF" />
            <text y="4" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">
              {Math.round(boxW)} × {Math.round(boxH)}
            </text>
          </g>
        </g>
      );
    }

    // --- Bounding box corner computation ---
    // Phase 1: try ThorVG's getLayerBoundingBox first (pixel-perfect, matches what ThorVG renders).
    // Skipped for artboards (their size is authoritative from scene graph, not ThorVG) and for
    // non-imported nodes (user-drawn shapes that ThorVG doesn't know about yet).
    let tl: {x:number,y:number}, tr: {x:number,y:number}, br: {x:number,y:number}, bl: {x:number,y:number};
    let displayW = 0, displayH = 0;
    let usedThorVGBbox = false;

    if (isThorVGQueryable(nodeId)) {
      const bbox = queryLayerBbox(node.name);
      const converted = thorVGBoxToCSS(bbox ?? [], viewTransform);
      if (converted && isValidThorVGBbox(converted.worldW, converted.worldH)) {
        tl = converted.tl;
        tr = converted.tr;
        br = converted.br;
        bl = converted.bl;
        displayW = converted.worldW;
        displayH = converted.worldH;
        usedThorVGBbox = true;
      }
    } else if (thorVGReady && node.props?.isLayer === true) {
      // For nested Lottie nodes (groups, paths inside a layer), find the nearest top-level
      // ancestor whose ThorVG bbox is valid and show that layer's boundary instead.
      // This matches LottieFiles UX where sub-components display the containing layer's box.
      const ancestorId = findQueryableAncestor(nodeId);
      if (ancestorId) {
        const ancestorNode = nodes.get(ancestorId)!;
        const bbox = queryLayerBbox(ancestorNode.name);
        const converted = thorVGBoxToCSS(bbox ?? [], viewTransform);
        if (converted && isValidThorVGBbox(converted.worldW, converted.worldH)) {
          tl = converted.tl;
          tr = converted.tr;
          br = converted.br;
          bl = converted.bl;
          displayW = converted.worldW;
          displayH = converted.worldH;
          usedThorVGBbox = true;
        }
      }
    }

    if (!usedThorVGBbox) {
      // Fallback: compute bounding box from our scene graph (matrix math)
      let width = 0, height = 0, offsetX = 0, offsetY = 0;
      if (node.type === 'rect' || node.type === 'artboard' || node.type === 'image') {
        width = AnimationUtils.getPropertyValue(node, 'props.width', currentTime) || 0;
        height = AnimationUtils.getPropertyValue(node, 'props.height', currentTime) || 0;
      } else if (node.type === 'ellipse') {
        width = (AnimationUtils.getPropertyValue(node, 'props.radiusX', currentTime) || 0) * 2;
        height = (AnimationUtils.getPropertyValue(node, 'props.radiusY', currentTime) || 0) * 2;
      } else if (node.type === 'path') {
        const points = AnimationUtils.getPropertyValue(node, 'props.points', currentTime);
        const lb = getPathLocalBounds(points || []);
        width = lb.width; height = lb.height; offsetX = lb.x; offsetY = lb.y;
      } else if (node.type === 'group') {
        const lb = getGroupLocalBounds(nodeId, nodes, currentTime);
        width = lb.width; height = lb.height; offsetX = lb.x; offsetY = lb.y;
      } else if (node.type === 'precomp' && node.refId) {
        const refArtboard = nodes.get(node.refId);
        if (refArtboard) {
          width = refArtboard.props.width || 0;
          height = refArtboard.props.height || 0;
        }
      } else if (node.type === 'text') {
        // Use TextMeasurer for pixel-accurate bounds (includes letter-spacing, word-wrap, alignment offset)
        const lb = getTextLocalBounds(node);
        width = lb.width; height = lb.height; offsetX = lb.x; offsetY = lb.y;
      }

      tl = localToScreen(offsetX, offsetY, combinedMatrix);
      tr = localToScreen(offsetX + width, offsetY, combinedMatrix);
      br = localToScreen(offsetX + width, offsetY + height, combinedMatrix);
      bl = localToScreen(offsetX, offsetY + height, combinedMatrix);

      // Size display: local dims × animated scale
      const scaleX = Math.abs(AnimationUtils.getPropertyValue(node, 'transform.scaleX', currentTime) || 1);
      const scaleY = Math.abs(AnimationUtils.getPropertyValue(node, 'transform.scaleY', currentTime) || 1);
      displayW = width * scaleX;
      displayH = height * scaleY;
    }

    // Guard against NaN from degenerate transforms or missing bounds
    if ([tl!, tr!, br!, bl!].some(p => !isFinite(p.x) || !isFinite(p.y))) return null;

    // Compute screen-space dimensions to decide whether handles fit
    const screenW = Math.hypot(tr!.x - tl!.x, tr!.y - tl!.y);
    const screenH = Math.hypot(bl!.x - tl!.x, bl!.y - tl!.y);
    const showHandles = screenW >= MIN_HANDLE_SCREEN_PX && screenH >= MIN_HANDLE_SCREEN_PX;

    // Midpoints (works for both AABB and oriented bounding box)
    const handles = [
      tl!,
      { x: (tl!.x + tr!.x) / 2, y: (tl!.y + tr!.y) / 2 },
      tr!,
      { x: (tr!.x + br!.x) / 2, y: (tr!.y + br!.y) / 2 },
      br!,
      { x: (br!.x + bl!.x) / 2, y: (br!.y + bl!.y) / 2 },
      bl!,
      { x: (bl!.x + tl!.x) / 2, y: (bl!.y + tl!.y) / 2 },
    ];

    const animatedAnchor = getAnimatedAnchor(node, nodes, currentTime);
    const anchor = localToScreen(animatedAnchor.x, animatedAnchor.y, combinedMatrix);

    const isArtboard = node.type === 'artboard';

    const renderPolystarHandles = () => {
      if (node.type !== 'polystar') return null;
      const innerRadius = AnimationUtils.getPropertyValue(node, 'props.innerRadius', currentTime) ?? 25;
      const outerRadius = AnimationUtils.getPropertyValue(node, 'props.outerRadius', currentTime) ?? 50;
      const isStar = node.props?.starType === 'star' || !node.props?.starType;

      const pOuter = localToScreen(0, -outerRadius, combinedMatrix);
      const pInner = isStar ? localToScreen(
        innerRadius * Math.cos(-Math.PI/2 + (Math.PI * 2 / (node.props.points * 2))),
        innerRadius * Math.sin(-Math.PI/2 + (Math.PI * 2 / (node.props.points * 2))),
        combinedMatrix
      ) : null;

      return (
        <g key={`polystar-handles-${nodeId}`}>
          <circle
            cx={pOuter.x} cy={pOuter.y} r="6"
            fill="white" stroke="#0A84FF" strokeWidth="2"
            className="pointer-events-auto cursor-ns-resize"
          />
          {pInner && (
            <circle
              cx={pInner.x} cy={pInner.y} r="6"
              fill="#0A84FF" stroke="white" strokeWidth="1.5"
              className="pointer-events-auto cursor-pointer"
            />
          )}
        </g>
      );
    };

    return (
      <g key={nodeId}>
        <path
          d={`M ${tl!.x} ${tl!.y} L ${tr!.x} ${tr!.y} L ${br!.x} ${br!.y} L ${bl!.x} ${bl!.y} Z`}
          fill="none"
          stroke="#0A84FF"
          strokeWidth={isArtboard ? "1" : "2"}
          strokeDasharray={isArtboard ? "4 4" : ""}
        />
        {/* Only render resize/rotate handles when the shape is large enough on screen */}
        {showHandles && node.type === 'polystar' && renderPolystarHandles()}
        {showHandles && node.type !== 'polystar' && handles.map((h, i) => (
          <rect key={i} x={h.x - 4} y={h.y - 4} width="8" height="8" fill="white" stroke="#0A84FF" strokeWidth="2" className="pointer-events-auto cursor-pointer" />
        ))}

        {!isArtboard && (
          <g transform={`translate(${(tl!.x + tr!.x) / 2}, ${br!.y + 16})`}>
            <rect x="-35" y="-10" width="70" height="20" rx="4" fill="#0A84FF" />
            <text y="4" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">
              {Math.round(displayW)} × {Math.round(displayH)}
            </text>
          </g>
        )}

        {isArtboard && renderArtboardMetadata()}

        {!isArtboard && (
          <g transform={`translate(${anchor.x}, ${anchor.y})`}>
            <circle r="4" fill="white" stroke="#0A84FF" strokeWidth="1" />
            <line x1="-2.5" y1="0" x2="2.5" y2="0" stroke="#0A84FF" strokeWidth="1" />
            <line x1="0" y1="-2.5" x2="0" y2="2.5" stroke="#0A84FF" strokeWidth="1" />
          </g>
        )}
      </g>
    );
  };

  const renderMultiSelectionOverlay = () => {
    const bounds = getCollectiveBoundingBox(selectedIds, nodes, currentTime, activeArtboardId || undefined);
    if (isNaN(bounds.x) || isNaN(bounds.y) || isNaN(bounds.width) || isNaN(bounds.height) || bounds.width === 0 || bounds.height === 0) return null;

    const tl = localToScreen(bounds.x, bounds.y, viewTransform);
    const br = localToScreen(bounds.x + bounds.width, bounds.y + bounds.height, viewTransform);

    if (isNaN(tl.x) || isNaN(tl.y) || isNaN(br.x) || isNaN(br.y)) return null;

    const width = br.x - tl.x;
    const height = br.y - tl.y;
    const showHandles = width >= MIN_HANDLE_SCREEN_PX && height >= MIN_HANDLE_SCREEN_PX;

    const handles = [
      { x: tl.x, y: tl.y },
      { x: tl.x + width / 2, y: tl.y },
      { x: br.x, y: tl.y },
      { x: br.x, y: tl.y + height / 2 },
      { x: br.x, y: br.y },
      { x: tl.x + width / 2, y: br.y },
      { x: tl.x, y: br.y },
      { x: tl.x, y: tl.y + height / 2 },
    ];

    return (
      <g>
        <rect x={tl.x} y={tl.y} width={width} height={height} fill="none" stroke="#0A84FF" strokeWidth="2" />
        {showHandles && handles.map((h, i) => (
          <rect key={i} x={h.x - 4} y={h.y - 4} width="8" height="8" fill="white" stroke="#0A84FF" strokeWidth="2" className="pointer-events-auto cursor-pointer" />
        ))}
        <g transform={`translate(${tl.x + width / 2}, ${br.y + 16})`}>
          <rect x="-35" y="-10" width="70" height="20" rx="4" fill="#0A84FF" />
          <text y="4" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">
            {Math.round(bounds.width)} × {Math.round(bounds.height)}
          </text>
        </g>
      </g>
    );
  };

  return (
    <svg className="absolute inset-0 pointer-events-none z-[100]" style={{ overflow: 'visible' }}>
      {/* Marquee Box */}
      {showMarquee && marqueeBounds && (
        <rect
          x={marqueeBounds.x}
          y={marqueeBounds.y}
          width={marqueeBounds.width}
          height={marqueeBounds.height}
          fill="rgba(255, 51, 90, 0.1)"
          stroke="#0A84FF"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
      )}

      {/* Artboard Meta (always visible if not selecting artboard directly) */}
      {artboard && !selectedIds.includes(artboard.id) && renderArtboardMetadata()}

      {/* Overlays */}
      {selectedIds.length === 1 ? (
        <>
          {renderSingleNodeOverlay(selectedIds[0])}
          {renderGradientHandles(selectedIds[0])}
        </>
      ) :
        selectedIds.length > 1 ? renderMultiSelectionOverlay() : null}

      {/* Hover Preview Overlay — also uses ThorVG bbox when available */}
      {hoveredNodeId && !selectedIds.includes(hoveredNodeId) && (() => {
        const node = nodes.get(hoveredNodeId);
        if (!node) return null;

        // Try ThorVG bbox first — only for direct artboard children (unique layer names)
        if (isThorVGQueryable(hoveredNodeId)) {
          const bbox = queryLayerBbox(node.name);
          const converted = thorVGBoxToCSS(bbox ?? [], viewTransform);
          if (converted && isValidThorVGBbox(converted.worldW, converted.worldH)) {
            const { tl, tr, br, bl } = converted;
            return (
              <path
                d={`M ${tl.x} ${tl.y} L ${tr.x} ${tr.y} L ${br.x} ${br.y} L ${bl.x} ${bl.y} Z`}
                fill="none"
                stroke="#0A84FF"
                strokeWidth="1"
                strokeDasharray="4 2"
                style={{ opacity: 0.6 }}
              />
            );
          }
        } else if (thorVGReady && node.props?.isLayer === true) {
          // For nested hovered nodes, show the containing layer's outline instead
          const ancestorId = findQueryableAncestor(hoveredNodeId);
          if (ancestorId) {
            const ancestorNode = nodes.get(ancestorId)!;
            const bbox = queryLayerBbox(ancestorNode.name);
            const converted = thorVGBoxToCSS(bbox ?? [], viewTransform);
            if (converted && isValidThorVGBbox(converted.worldW, converted.worldH)) {
              const { tl, tr, br, bl } = converted;
              return (
                <path
                  d={`M ${tl.x} ${tl.y} L ${tr.x} ${tr.y} L ${br.x} ${br.y} L ${bl.x} ${bl.y} Z`}
                  fill="none"
                  stroke="#0A84FF"
                  strokeWidth="1"
                  strokeDasharray="4 2"
                  style={{ opacity: 0.6 }}
                />
              );
            }
          }
        }

        // Fallback: matrix-based hover outline
        const worldMatrix = getWorldMatrix(hoveredNodeId, nodes, currentTime, activeArtboardId || undefined);
        const combinedMatrix = viewTransform.multiply(worldMatrix);
        let w = 0, h = 0, ox = 0, oy = 0;
        if (node.type === 'rect' || node.type === 'artboard') { w = AnimationUtils.getPropertyValue(node, 'props.width', currentTime); h = AnimationUtils.getPropertyValue(node, 'props.height', currentTime); }
        else if (node.type === 'ellipse') { w = AnimationUtils.getPropertyValue(node, 'props.radiusX', currentTime) * 2; h = AnimationUtils.getPropertyValue(node, 'props.radiusY', currentTime) * 2; }
        else if (node.type === 'path') { const lb = getPathLocalBounds(AnimationUtils.getPropertyValue(node, 'props.points', currentTime) || []); w = lb.width; h = lb.height; ox = lb.x; oy = lb.y; }
        else if (node.type === 'group') { const lb = getGroupLocalBounds(hoveredNodeId, nodes, currentTime); w = lb.width; h = lb.height; ox = lb.x; oy = lb.y; }
        else if (node.type === 'text') {
          const lb = getTextLocalBounds(node);
          w = lb.width; h = lb.height; ox = lb.x; oy = lb.y;
        }

        const tl = localToScreen(ox, oy, combinedMatrix);
        const tr = localToScreen(ox + w, oy, combinedMatrix);
        const br = localToScreen(ox + w, oy + h, combinedMatrix);
        const bl = localToScreen(ox, oy + h, combinedMatrix);

        if ([tl, tr, br, bl].some(p => !isFinite(p.x) || !isFinite(p.y))) return null;

        return <path d={`M ${tl.x} ${tl.y} L ${tr.x} ${tr.y} L ${br.x} ${br.y} L ${bl.x} ${bl.y} Z`} fill="none" stroke="#0A84FF" strokeWidth="1" strokeDasharray="4 2" style={{ opacity: 0.6 }} />;
      })()}

      {/* Preview Node (Drawing) */}
      {previewNode && (() => {
        const parentId = previewNode.parentId;
        const actualParentId = parentId || (artboard ? artboard.id : null);
        const parentWorldMatrix = actualParentId ? (nodes.get(actualParentId) ? getWorldMatrix(actualParentId, nodes, undefined, activeArtboardId || undefined) : new DOMMatrix()) : new DOMMatrix();
        const nodeMatrix = parentWorldMatrix.multiply(createTransformMatrix(previewNode.transform, nodes, previewNode));
        const combinedMatrix = viewTransform.multiply(nodeMatrix);
        let w = 0, h = 0;
        if (previewNode.type === 'rect') { w = previewNode.props.width; h = previewNode.props.height; }
        else if (previewNode.type === 'ellipse') { w = previewNode.props.radiusX * 2; h = previewNode.props.radiusY * 2; }
        const tl = localToScreen(0, 0, combinedMatrix);
        const tr = localToScreen(w, 0, combinedMatrix);
        const br = localToScreen(w, h, combinedMatrix);
        const bl = localToScreen(0, h, combinedMatrix);

        return (
          <g>
            <path d={`M ${tl.x} ${tl.y} L ${tr.x} ${tr.y} L ${br.x} ${br.y} L ${bl.x} ${bl.y} Z`} fill="rgba(255, 51, 90, 0.05)" stroke="#0A84FF" strokeWidth="2" strokeDasharray="4 4" />
            <g transform={`translate(${(tl.x + tr.x) / 2}, ${br.y + 12})`}><rect x="-35" y="-10" width="70" height="20" rx="4" fill="#0A84FF" /><text y="4" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">{Math.round(w)} × {Math.round(h)}</text></g>
          </g>
        );
      })()}
    </svg>
  );
}
