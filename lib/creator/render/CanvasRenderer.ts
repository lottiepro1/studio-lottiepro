import { SceneNode } from '../state/sceneSlice';
import { createTransformMatrix, getWorldMatrix, getBoundingBox } from '../core/Matrix';
import { AnimationUtils } from '../core/Animation';
import { VectorPoint } from '../tools/PenTool';
import { PathUtils } from '../core/PathUtils';
import { wrapLines } from '../text/wrapLines';

// Type alias for contexts that work in both main thread and Worker
export type RenderingContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export class CanvasRenderer {
  private ctx: RenderingContext;
  private nodes: Map<string, SceneNode>;
  private viewTransform: DOMMatrix = new DOMMatrix();
  private rootId: string | null = null;
  private imageCache: Map<string, HTMLImageElement | ImageBitmap> = new Map();
  private isWorker: boolean;

  // --- Phase 3: Matrix Memoization ---
  // Per-frame cache: avoids redundant getWorldMatrix calls in deep hierarchies
  private matrixCache: Map<string, DOMMatrix> = new Map();
  private isBooleanSession = false;

  // When true, skip all direct artboard children — ThorVG (z-21) is the sole renderer for
  // animation content. Applies to both imported (isLayer=true) and from-scratch nodes.
  // Canvas2D only draws artboard background and editor chrome (guides, grid).
  private skipLottieContent: boolean = false;

  // Fix B: when non-null, only partial-support imported nodes whose IDs are in this set
  // will be rendered. All other partial nodes are left transparent so ThorVG shows through.
  private partialOnlyIds: Set<string> | null = null;

  // --- Phase 3: Pre-comp Caching ---
  // Caches rendered precomp content to avoid re-rendering unchanged nested artboards
  private precompCache: Map<string, {
    canvas: HTMLCanvasElement | OffscreenCanvas;
    width: number;
    height: number;
    currentTime: number;
    nodesVersion: number;
  }> = new Map();
  private nodesVersion: number = 0;
  private prevNodesRef: Map<string, SceneNode> | null = null;
  private static MAX_PRECOMP_CACHE_SIZE = 32; // LRU limit

  constructor(ctx: RenderingContext) {
    this.ctx = ctx;
    this.nodes = new Map();
    this.isWorker = typeof document === 'undefined';
  }

  // Helper: create an offscreen canvas compatible with both main-thread and Worker
  private createOffscreen(width: number, height: number): { canvas: HTMLCanvasElement | OffscreenCanvas, ctx: RenderingContext } | null {
    let canvas: HTMLCanvasElement | OffscreenCanvas;
    if (this.isWorker) {
      canvas = new OffscreenCanvas(width, height);
    } else {
      canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d') as RenderingContext | null;
    if (!ctx) return null;
    return { canvas, ctx };
  }

  // --- Phase 3: Matrix Memoization ---
  // Cached wrapper for getWorldMatrix — returns memoized result within a single frame
  private getWorldMatrixCached(nodeId: string, currentTime: number, rootId?: string): DOMMatrix {
    const cacheKey = rootId ? `${nodeId}::${rootId}` : nodeId;
    const cached = this.matrixCache.get(cacheKey);
    if (cached) return cached;
    const matrix = getWorldMatrix(nodeId, this.nodes, currentTime, rootId);
    this.matrixCache.set(cacheKey, matrix);
    return matrix;
  }

  // --- Phase 3: Dirty Tracking ---
  // Update nodes reference and bump version if the Map identity changed
  setNodes(nodes: Map<string, SceneNode>) {
    if (nodes !== this.prevNodesRef) {
      this.nodesVersion++;
      this.prevNodesRef = nodes;
    }
    this.nodes = nodes;
  }

  // Clear canvas
  clear() {
    const canvas = this.ctx.canvas;
    this.ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // Render all nodes
  render(rootId: string | null, viewTransform: DOMMatrix = new DOMMatrix(), currentTime: number = 0, editingNodeId: string | null = null, textEditingId: string | null = null, selectedIds: string[] | null = null, skipLottieContent: boolean = false) {
    this.rootId = rootId;
    this.skipLottieContent = skipLottieContent;
    this.partialOnlyIds = selectedIds ? new Set(selectedIds) : null;

    // --- Phase 3: Clear per-frame caches ---
    this.matrixCache.clear();
    AnimationUtils.beginFrame();

    try {
      this.clear();

      // Apply view transform (zoom/pan)
      this.viewTransform = viewTransform;
      this.ctx.save();
      this.ctx.setTransform(viewTransform);

      if (rootId) {
        this.renderNode(rootId, currentTime, editingNodeId, textEditingId, false, { s: 0, e: 1, o: 0 });
      }
    } finally {
      this.ctx.restore();
      // Disable the per-frame cache so main-thread callers (React components)
      // always get fresh computed values
      AnimationUtils.endFrame();
    }
  }

  // Phase 2: Check if a node's screen-space bounding box intersects the viewport
  private isNodeInViewport(node: SceneNode, worldMatrix: DOMMatrix, currentTime: number): boolean {
    // Artboards and groups always pass — their children handle their own culling
    if (node.type === 'artboard' || node.type === 'group' || node.type === 'precomp') {
      return true;
    }

    const canvasWidth = this.ctx.canvas.width;
    const canvasHeight = this.ctx.canvas.height;

    // Get the screen-space bounding box (viewTransform is already baked into worldMatrix here)
    const screenBounds = getBoundingBox(node, worldMatrix, this.nodes, currentTime);

    // Inflate bounds slightly to account for strokes and effects (blur, shadow)
    const padding = 50; // generous padding for effects
    const bx = screenBounds.x - padding;
    const by = screenBounds.y - padding;
    const bw = screenBounds.width + padding * 2;
    const bh = screenBounds.height + padding * 2;

    // Fast AABB check: is the bounding box completely outside the viewport?
    if (bx + bw < 0 || by + bh < 0 || bx > canvasWidth || by > canvasHeight) {
      return false;
    }

    return true;
  }

  // Render a single node and its children
  private renderNode(nodeId: string, currentTime: number, editingNodeId: string | null = null, textEditingId: string | null = null, parentIsDimmed: boolean = false, inheritedTrim = { s: 0, e: 1, o: 0 }) {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    if (!node.visible && !this.isBooleanSession) return;

    // --- Phase 2: Temporal Culling (enhanced) ---
    // Artboard is always visible, other nodes respect in/out points
    if (node.type !== 'artboard') {
      const inPoint = node.inPoint ?? 0;
      const outPoint = node.outPoint ?? 10000; // High default
      if (currentTime < inPoint || currentTime >= outPoint) {
        return;
      }
    }

    // --- Phase 2: Repeater Support ---
    const repeaterIdx = node.style.effects?.findIndex(e => e.type === 'repeater');
    const hasRepeater = repeaterIdx !== undefined && repeaterIdx !== -1 && node.style.effects?.[repeaterIdx].visible !== false;

    if (hasRepeater) {
      this.renderWithRepeater(node, repeaterIdx!, currentTime, editingNodeId, textEditingId, parentIsDimmed, inheritedTrim);
      return;
    }

    // --- Phase 2: Offset Path Support ---
    const offsetPathIdx = node.style.effects?.findIndex(e => e.type === 'offsetPath');
    const hasOffsetPath = offsetPathIdx !== undefined && offsetPathIdx !== -1 && node.style.effects?.[offsetPathIdx].visible !== false;

    if (hasOffsetPath) {
      this.renderWithOffsetPath(node, offsetPathIdx!, currentTime, editingNodeId, textEditingId, parentIsDimmed, inheritedTrim);
      return;
    }

    // ThorVG is always visible and is the sole renderer for all animation content.
    // Canvas2D skips every direct artboard child when ThorVG is active so there is no
    // double-draw and no z-ordering conflict (ThorVG z-21, Canvas2D z-20).
    if (this.skipLottieContent && node.parentId === this.rootId) {
      return;
    }

    // Fix B: during active interactions with an imported animation, skip partial-support nodes
    // that are not in the selected set. Canvas2D stays transparent for them so ThorVG (z-11)
    // shows through at full fidelity. The early return also skips all children of the node.
    if (this.partialOnlyIds !== null &&
        (node as any)._importSupport === 'partial' &&
        !this.partialOnlyIds.has(nodeId)) {
      return;
    }

    // Skip nodes that are used as mattes (they're only for clipping)
    if (node.matteTargetIds && node.matteTargetIds.length > 0) {
      return;
    }

    // --- Phase 2: Early-exit for zero-opacity nodes ---
    const opacity = AnimationUtils.getPropertyValue(node, 'style.opacity', currentTime);
    if (opacity <= 0 && node.type !== 'artboard') {
      return;
    }

    // --- Phase 2: Early-exit for zero-size scale ---
    const scaleX = AnimationUtils.getPropertyValue(node, 'transform.scaleX', currentTime);
    const scaleY = AnimationUtils.getPropertyValue(node, 'transform.scaleY', currentTime);
    if ((scaleX === 0 || scaleY === 0) && node.type !== 'artboard') {
      return;
    }

    // --- Phase 2: Spatial Culling (uses Phase 3 memoized matrix) ---
    const worldMatrix = this.getWorldMatrixCached(nodeId, currentTime, this.rootId || undefined);
    const finalMatrix = this.viewTransform.multiply(worldMatrix);

    // Check if node is within the visible viewport (uses screen-space bounds)
    if (!this.isNodeInViewport(node, finalMatrix, currentTime)) {
      return;
    }

    // Isolation Mode Dimming - Only apply if not already dimmed by a parent
    let isolationOpacity = 1;
    let currentIsDimmed = parentIsDimmed;

    if (editingNodeId && !parentIsDimmed && nodeId !== editingNodeId && node.type !== 'artboard') {
      // Check if this node is a parent of the editing node
      let isAncestor = false;
      let checkId = editingNodeId;
      while (checkId) {
        const checkNode = this.nodes.get(checkId);
        if (checkNode?.parentId === nodeId) {
          isAncestor = true;
          break;
        }
        checkId = checkNode?.parentId || '';
      }

      if (!isAncestor) {
        isolationOpacity = 0.2; // Fade out non-editing elements
        currentIsDimmed = true;
      }
    }

    this.ctx.save();

    // worldMatrix and finalMatrix already computed above (Phase 2 spatial culling)
    this.ctx.setTransform(finalMatrix);

    // Apply matte clipping if this node has a matte
    if (node.matteSourceId) {
      const matteNode = this.nodes.get(node.matteSourceId);
      if (matteNode) {
        this.applyMatteClip(matteNode, currentTime, node.matteType);
      }
    }

    // Apply layer masks if present
    if (node.masks && node.masks.length > 0) {
      this.applyLayerMasks(node, currentTime);
    }

    // Apply opacity (multiplicative to inherit from parents)
    this.ctx.globalAlpha *= (opacity * isolationOpacity);

    // Apply blend mode (only override if not normal, to allow parent blend modes to propagate to children)
    const blendMode = (AnimationUtils.getPropertyValue(node, 'style.blendMode', currentTime) || node.style.blendMode || 'normal') as string;
    if (blendMode !== 'normal') {
      this.ctx.globalCompositeOperation = blendMode as GlobalCompositeOperation;
    }

    // Apply effects
    this.applyEffects(node, currentTime);

    // Combine with inherited trim
    const nodeTrimStart = AnimationUtils.getPropertyValue(node, 'style.trimStart', currentTime) ?? 0;
    const nodeTrimEnd = AnimationUtils.getPropertyValue(node, 'style.trimEnd', currentTime) ?? 1;
    const nodeTrimOffset = AnimationUtils.getPropertyValue(node, 'style.trimOffset', currentTime) ?? 0;

    const currentTrim = {
      s: inheritedTrim.s + nodeTrimStart * (inheritedTrim.e - inheritedTrim.s),
      e: inheritedTrim.s + nodeTrimEnd * (inheritedTrim.e - inheritedTrim.s),
      o: inheritedTrim.o + nodeTrimOffset
    };

    // Render based on type
    switch (node.type) {
      case 'rect':
        this.renderRect(node, currentTime, currentTrim);
        break;
      case 'ellipse':
        this.renderEllipse(node, currentTime, currentTrim);
        break;
      case 'path':
        this.renderPath(node, currentTime, currentTrim);
        break;
      case 'polystar':
        this.renderPolystar(node, currentTime, currentTrim);
        break;
      case 'artboard':
        this.renderArtboard(node);
        break;
      case 'text':
        if (nodeId !== textEditingId) {
          this.renderText(node, currentTime);
        }
        break;
      case 'precomp':
        const refId = node.refId;
        if (refId) {
          this.renderPrecomp(node, refId, currentTime, editingNodeId, textEditingId, currentIsDimmed, currentTrim);
        }
        break;
      case 'image':
        this.renderImage(node, currentTime);
        break;
      case 'group':
        // Handle boolean merge modes
        if (node.mergeMode && node.mergeMode !== 'none') {
          this.renderMergedGroup(node, currentTime, editingNodeId, textEditingId);
          this.ctx.restore();
          return; // Skip normal child rendering
        }
        break;
    }

    // --- Phase 4: Batched children rendering ---
    this.renderChildrenBatched(node, currentTime, editingNodeId, textEditingId, currentIsDimmed, currentTrim);

    // Dynamic Pixel Grid (Figma Style) - Shows on top of EVERYTHING inside the artboard when zoomed in
    if (node.type === 'artboard') {
      const zoom = this.ctx.getTransform().a;
      if (zoom > 10) {
        this.ctx.save();
        // Adaptive color: light grid for dark backgrounds, dark grid for light backgrounds
        const isDark = node.props.transparent || this.isColorDark(node.props.backgroundColor || '#ffffff');
        this.ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)';
        this.ctx.lineWidth = 1 / zoom;
        this.ctx.beginPath();

        const { width, height } = node.props;
        for (let y = 0; y <= height; y++) {
          this.ctx.moveTo(0, y);
          this.ctx.lineTo(width, y);
        }
        for (let x = 0; x <= width; x++) {
          this.ctx.moveTo(x, 0);
          this.ctx.lineTo(x, height);
        }
        this.ctx.stroke();
        this.ctx.restore();
      }
    }

    this.ctx.restore();
  }

  // --- Phase 2: Style property inheritance from Groups down to Shapes ---
  private resolveStyleProperty(node: SceneNode, path: string, currentTime: number): any {
    // 1. First, check if the node itself has an explicit property or animation for it
    let val = AnimationUtils.getPropertyValue(node, path, currentTime);
    if (val !== undefined && val !== null) {
      return val;
    }

    // 2. If it's an appearance property and the node doesn't have it, check if a parent Group EXPLICITLY provides this styling.
    // In Lottie, if a Group has an explicit Fill/Stroke, it cascades down to children that lack it.
    const isAppearance = path.startsWith('style.');
    if (isAppearance && node.parentId) {
      let currentParentId: string | undefined = node.parentId;
      while (currentParentId) {
        const parent = this.nodes.get(currentParentId);
        if (parent && parent.type === 'group') {
          const hasAnimation = !!(parent.animations && parent.animations[path] && parent.animations[path].length > 0);
          const styleKey = path.replace('style.', '');

          // Lottie layer nodes (isLayer) have fill/stroke lifted onto them purely for
          // Inspector display — not as actual owned style items. Don't cascade those
          // appearance properties from layer containers; only cascade animations (e.g. trim).
          const isFillOrStroke = styleKey === 'fill' || styleKey === 'stroke' ||
            styleKey === 'fillType' || styleKey === 'strokeType' ||
            styleKey === 'fillGradient' || styleKey === 'strokeGradient' ||
            styleKey === 'fillOpacity' || styleKey === 'strokeOpacity' ||
            styleKey === 'fillVisible' || styleKey === 'strokeWidth' ||
            styleKey === 'strokeLinecap' || styleKey === 'strokeLinejoin' || styleKey === 'fillRule';
          const isLayerContainer = !!parent.props?.isLayer;

          const hasStaticStyle = parent.style && (parent.style as any)[styleKey] !== undefined
            && !(isLayerContainer && isFillOrStroke);

          if (hasAnimation || hasStaticStyle) {
            // This group provides the style! Resolve it from this group
            return AnimationUtils.getPropertyValue(parent, path, currentTime);
          }
        }
        currentParentId = parent?.parentId || undefined;
      }
    }

    // 3. Keep fallback logic compatible with existing code if neither node nor parent has it
    if (path === 'style.fillVisible') return node.style.fillVisible ?? true;
    if (path === 'style.fillOpacity') return node.style.fillOpacity ?? 1;
    if (path === 'style.strokeOpacity') return node.style.strokeOpacity ?? 1;
    if (path === 'style.strokeWidth') return node.style.strokeWidth ?? 0;
    if (path === 'style.strokeType' || path === 'style.fillType') return 'solid';

    return undefined;
  }

  // ===== Phase 4: Draw Call Batching =====

  // Check if a node qualifies for batching (simple leaf shape, no complex features)
  private isBatchCandidate(node: SceneNode, currentTime: number): boolean {
    // Only leaf shapes (no children to render, no sub-tree)
    if (!['rect', 'ellipse', 'path'].includes(node.type)) return false;
    if (node.children && node.children.length > 0) return false;

    // Must be visible and in time range
    if (!node.visible) return false;
    if (node.type !== 'artboard') {
      const inPoint = node.inPoint ?? 0;
      const outPoint = node.outPoint ?? 10000;
      if (currentTime < inPoint || currentTime >= outPoint) return false;
    }

    // --- Fix: Alpha Accumulation (Figma-style blending) ---
    // If a shape has any opacity < 1, batching it with siblings into a single 'fill()' 
    // call will 'flatten' the transparency instead of overlapping and darkening.
    const opacity = (AnimationUtils.getPropertyValue(node, 'style.opacity', currentTime) ?? 1);
    const fillOpacity = (AnimationUtils.getPropertyValue(node, 'style.fillOpacity', currentTime) ?? 1);
    const strokeOpacity = (AnimationUtils.getPropertyValue(node, 'style.strokeOpacity', currentTime) ?? 1);
    const fillVisible = (AnimationUtils.getPropertyValue(node, 'style.fillVisible', currentTime) ?? true);
    const strokeWidth = (AnimationUtils.getPropertyValue(node, 'style.strokeWidth', currentTime) ?? 0);

    if (opacity < 0.999) return false;
    if (fillVisible && fillOpacity < 0.999) return false;
    if (strokeWidth > 0 && strokeOpacity < 0.999) return false;

    // No effects (blur, shadow)
    if (node.style.effects && node.style.effects.length > 0) return false;

    // No special blend mode
    const blendMode = this.resolveStyleProperty(node, 'style.blendMode', currentTime) || node.style.blendMode || 'normal';
    if (blendMode !== 'normal') return false;

    // No trim path on this node
    const trimStart = this.resolveStyleProperty(node, 'style.trimStart', currentTime) ?? 0;
    const trimEnd = this.resolveStyleProperty(node, 'style.trimEnd', currentTime) ?? 1;
    if (trimStart > 0 || trimEnd < 1) return false;

    // No matte
    if (node.matteSourceId) return false;
    if (node.matteTargetIds && node.matteTargetIds.length > 0) return false;

    // No gradient fills/strokes (they depend on per-shape coordinates)
    const fillType = this.resolveStyleProperty(node, 'style.fillType', currentTime) || 'solid';
    const strokeType = this.resolveStyleProperty(node, 'style.strokeType', currentTime) || 'solid';
    if (fillType !== 'solid' || strokeType !== 'solid') return false;

    return true;
  }

  // Generate a style key for grouping batch-compatible siblings
  private getStyleKey(node: SceneNode, currentTime: number): string {
    const fill = this.resolveStyleProperty(node, 'style.fill', currentTime) || '';
    const fillVisible = this.resolveStyleProperty(node, 'style.fillVisible', currentTime) ?? (node.style.fillVisible ?? true);
    const fillOpacity = this.resolveStyleProperty(node, 'style.fillOpacity', currentTime) ?? (node.style.fillOpacity ?? 1);
    const stroke = this.resolveStyleProperty(node, 'style.stroke', currentTime) || '';
    const strokeWidth = this.resolveStyleProperty(node, 'style.strokeWidth', currentTime) || 0;
    const strokeOpacity = this.resolveStyleProperty(node, 'style.strokeOpacity', currentTime) ?? (node.style.strokeOpacity ?? 1);
    const opacity = this.resolveStyleProperty(node, 'style.opacity', currentTime);
    const lineJoin = this.resolveStyleProperty(node, 'style.strokeLinejoin', currentTime) || node.style.strokeLinejoin || 'miter';
    const lineCap = this.resolveStyleProperty(node, 'style.strokeLinecap', currentTime) || node.style.strokeLinecap || 'butt';

    return `${fillVisible}|${fill}|${fillOpacity}|${stroke}|${strokeWidth}|${strokeOpacity}|${opacity}|${lineJoin}|${lineCap}`;
  }

  // Build a Path2D for a single shape in its local coordinate space
  private buildShapePath2D(node: SceneNode, currentTime: number): Path2D | null {
    const path = new Path2D();

    if (node.type === 'rect') {
      const width = AnimationUtils.getPropertyValue(node, 'props.width', currentTime) || 0;
      const height = AnimationUtils.getPropertyValue(node, 'props.height', currentTime) || 0;
      const roundness = AnimationUtils.getPropertyValue(node, 'props.roundness', currentTime) || 0;

      if (roundness > 0) {
        const r = Math.min(roundness, width / 2, height / 2);
        path.moveTo(r, 0);
        path.lineTo(width - r, 0);
        path.arcTo(width, 0, width, r, r);
        path.lineTo(width, height - r);
        path.arcTo(width, height, width - r, height, r);
        path.lineTo(r, height);
        path.arcTo(0, height, 0, height - r, r);
        path.lineTo(0, r);
        path.arcTo(0, 0, r, 0, r);
        path.closePath();
      } else {
        path.rect(0, 0, width, height);
      }
    } else if (node.type === 'ellipse') {
      const radiusX = AnimationUtils.getPropertyValue(node, 'props.radiusX', currentTime) || 0;
      const radiusY = AnimationUtils.getPropertyValue(node, 'props.radiusY', currentTime) || 0;
      path.ellipse(radiusX, radiusY, radiusX, radiusY, 0, 0, Math.PI * 2);
    } else if (node.type === 'path') {
      const points = (AnimationUtils.getPropertyValue(node, 'props.points', currentTime) || []) as VectorPoint[];
      if (points.length === 0) return null;

      const subPathLengths = node.props.subPathLengths as number[] | undefined;
      const closed = node.props.closed;

      if (subPathLengths && subPathLengths.length > 1) {
        let offset = 0;
        for (const len of subPathLengths) {
          if (len <= 0) continue;
          const subPoints = points.slice(offset, offset + len);
          offset += len;
          if (subPoints.length === 0) continue;

          path.moveTo(subPoints[0].x, subPoints[0].y);
          for (let i = 0; i < subPoints.length; i++) {
            const current = subPoints[i];
            const next = subPoints[(i + 1) % subPoints.length];
            if (i < subPoints.length - 1 || closed) {
              path.bezierCurveTo(
                current.x + (current.outX || 0), current.y + (current.outY || 0),
                next.x + (next.inX || 0), next.y + (next.inY || 0),
                next.x, next.y
              );
            }
          }
          if (closed) path.closePath();
        }
      } else {
        path.moveTo(points[0].x, points[0].y);
        for (let i = 0; i < points.length; i++) {
          const current = points[i];
          const next = points[(i + 1) % points.length];
          if (i < points.length - 1 || closed) {
            path.bezierCurveTo(
              current.x + (current.outX || 0), current.y + (current.outY || 0),
              next.x + (next.inX || 0), next.y + (next.inY || 0),
              next.x, next.y
            );
          }
        }
        if (closed) path.closePath();
      }
    } else {
      return null;
    }

    return path;
  }

  // Render a batch of shapes with a single fill/stroke call
  private renderBatch(
    batch: string[],
    styleNode: SceneNode,
    currentTime: number,
    currentIsDimmed: boolean
  ) {
    if (batch.length === 0) return;

    // Build compound Path2D with per-shape transforms
    const compoundPath = new Path2D();

    for (const childId of batch) {
      const child = this.nodes.get(childId);
      if (!child) continue;

      const shapePath = this.buildShapePath2D(child, currentTime);
      if (!shapePath) continue;

      // Get the child's world matrix (memoized) and include view transform
      const worldMatrix = this.getWorldMatrixCached(childId, currentTime, this.rootId || undefined);
      const finalMatrix = this.viewTransform.multiply(worldMatrix);

      // addPath applies the transform to the path coordinates
      compoundPath.addPath(shapePath, finalMatrix);
    }

    // Draw the compound path with shared style, in identity transform (coordinates are pre-transformed)
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Apply opacity (use first node's opacity since they're all the same per batch key)
    const opacity = this.resolveStyleProperty(styleNode, 'style.opacity', currentTime);
    const isolationOpacity = currentIsDimmed ? 0.2 : 1;
    this.ctx.globalAlpha *= (opacity * isolationOpacity);

    // Fill
    const fillVisible = this.resolveStyleProperty(styleNode, 'style.fillVisible', currentTime) ?? (styleNode.style.fillVisible ?? true);
    if (fillVisible) {
      const fillOpacity = this.resolveStyleProperty(styleNode, 'style.fillOpacity', currentTime) ?? (styleNode.style.fillOpacity ?? 1);
      const fill = this.resolveStyleProperty(styleNode, 'style.fill', currentTime);
      if (fill) {
        this.ctx.save();
        this.ctx.globalAlpha *= fillOpacity;
        this.ctx.fillStyle = fill;
        const fillRule = styleNode.style.fillRule || 'nonzero';
        this.ctx.fill(compoundPath, fillRule);
        this.ctx.restore();
      }
    }

    // Stroke
    const strokeWidth = this.resolveStyleProperty(styleNode, 'style.strokeWidth', currentTime) || 0;
    if (strokeWidth > 0) {
      const stroke = this.resolveStyleProperty(styleNode, 'style.stroke', currentTime);
      if (stroke) {
        // For batched strokes, we use the first node's transform scale to adjust stroke width
        // This works correctly when all batched siblings share the same scale
        const firstWorld = this.getWorldMatrixCached(batch[0], currentTime, this.rootId || undefined);
        const firstFinal = this.viewTransform.multiply(firstWorld);
        const avgScale = Math.sqrt(Math.abs(firstFinal.a * firstFinal.d - firstFinal.b * firstFinal.c));

        this.ctx.save();
        const strokeOpacity = this.resolveStyleProperty(styleNode, 'style.strokeOpacity', currentTime) ?? 1;
        this.ctx.globalAlpha *= strokeOpacity;
        this.ctx.strokeStyle = stroke;
        this.ctx.lineWidth = strokeWidth * avgScale;
        this.ctx.lineJoin = (this.resolveStyleProperty(styleNode, 'style.strokeLinejoin', currentTime) || styleNode.style.strokeLinejoin || 'miter') as CanvasLineJoin;
        this.ctx.lineCap = (this.resolveStyleProperty(styleNode, 'style.strokeLinecap', currentTime) || styleNode.style.strokeLinecap || 'butt') as CanvasLineCap;

        const dashes = this.resolveStyleProperty(styleNode, 'style.lineDash', currentTime);
        if (dashes && Array.isArray(dashes) && dashes.length > 0) {
          this.ctx.setLineDash(dashes.map((d: number) => d * avgScale));
        }

        this.ctx.stroke(compoundPath);
        this.ctx.restore();
      }
    }

    this.ctx.restore();
  }

  // Orchestrate batched children rendering: finds runs of batchable siblings and draws them efficiently
  private renderChildrenBatched(
    parent: SceneNode,
    currentTime: number,
    editingNodeId: string | null,
    textEditingId: string | null,
    currentIsDimmed: boolean,
    currentTrim: { s: number; e: number; o: number }
  ) {
    const children = parent.children;
    if (!children || children.length === 0) return;

    let i = 0;
    while (i < children.length) {
      const childId = children[i];
      const child = this.nodes.get(childId);

      // Check if this child is a batch candidate
      if (child && this.isBatchCandidate(child, currentTime) && currentTrim.s === 0 && currentTrim.e === 1) {
        // Find a consecutive run of batchable siblings with the same style key
        const styleKey = this.getStyleKey(child, currentTime);
        const batch: string[] = [childId];
        let j = i + 1;

        while (j < children.length) {
          const nextId = children[j];
          const nextChild = this.nodes.get(nextId);
          if (!nextChild || !this.isBatchCandidate(nextChild, currentTime)) break;
          if (this.getStyleKey(nextChild, currentTime) !== styleKey) break;
          batch.push(nextId);
          j++;
        }

        if (batch.length >= 2) {
          // Worth batching (≥3 shapes with same style = meaningful win)
          this.renderBatch(batch, child, currentTime, currentIsDimmed);
        } else {
          // Only 1-2 shapes, not worth the overhead of Path2D batching
          for (const id of batch) {
            this.renderNode(id, currentTime, editingNodeId, textEditingId, currentIsDimmed, currentTrim);
          }
        }
        i = j;
      } else {
        // Not batchable — render individually
        this.renderNode(childId, currentTime, editingNodeId, textEditingId, currentIsDimmed, currentTrim);
        i++;
      }
    }
  }

  // --- Phase 3: Pre-comp Caching ---
  // Renders a precomp node, using a cached offscreen canvas when possible.
  // If the precomp's content hasn't changed (same nodesVersion and currentTime),
  // we skip re-rendering all its children and just drawImage the cached result.
  private renderPrecomp(
    precompNode: SceneNode,
    refId: string,
    currentTime: number,
    editingNodeId: string | null,
    textEditingId: string | null,
    currentIsDimmed: boolean,
    currentTrim: { s: number; e: number; o: number }
  ) {
    const refArtboard = this.nodes.get(refId);
    if (!refArtboard) {
      this.renderNode(refId, currentTime, editingNodeId, textEditingId, currentIsDimmed, currentTrim);
      return;
    }

    // Render precomp directly (no offscreen cache) for crisp vector quality.
    //
    // How coordinate spaces work here:
    // - Children compute worldMatrix relative to the precomp artboard (rootId = refId)
    // - finalMatrix = viewTransform * childWorldMatrix
    // - We need viewTransform to map from precomp-local space → screen space
    // - That means: viewTransform = mainViewTransform * precompWorldMatrix
    //
    // This way, a child at local [0,0] in the precomp renders at the precomp's
    // screen position, which is exactly correct.
    const shiftedTime = currentTime - precompNode.startTime;
    const prevRootId = this.rootId;
    const prevViewTransform = this.viewTransform;

    // Compute the precomp's world matrix in the CURRENT coordinate space
    const precompWorldMatrix = this.getWorldMatrixCached(precompNode.id, currentTime, this.rootId || undefined);
    // New viewTransform = old viewTransform * precomp's world matrix
    this.viewTransform = prevViewTransform.multiply(precompWorldMatrix);
    this.rootId = refId;

    this.renderNode(refId, shiftedTime, editingNodeId, textEditingId, currentIsDimmed, currentTrim);

    this.rootId = prevRootId;
    this.viewTransform = prevViewTransform;
  }

  // Render a group with boolean merge mode
  private renderMergedGroup(node: SceneNode, currentTime: number, editingNodeId: string | null, textEditingId: string | null) {
    const children = node.children.map(id => this.nodes.get(id)).filter(Boolean) as SceneNode[];
    if (children.length === 0) return;

    const mode = node.mergeMode;

    // Create an offscreen canvas for proper compositing
    const canvas = this.ctx.canvas;
    const offResult = this.createOffscreen(canvas.width, canvas.height);
    if (!offResult) return;
    const { canvas: offscreen, ctx: offCtx } = offResult;

    // Save current context and swap to offscreen
    const mainCtx = this.ctx;
    this.ctx = offCtx;
    const wasBoolean = this.isBooleanSession;
    this.isBooleanSession = true;

    // Sync transform to offscreen
    offCtx.setTransform(mainCtx.getTransform());

    // Render children to offscreen based on mode
    for (let i = 0; i < node.children.length; i++) {
        if (i > 0) {
            if (mode === 'subtract') offCtx.globalCompositeOperation = 'destination-out';
            else if (mode === 'intersect') offCtx.globalCompositeOperation = 'destination-in';
            else if (mode === 'exclude') offCtx.globalCompositeOperation = 'xor';
            else offCtx.globalCompositeOperation = 'source-over';
        }

      // This will call the standard render methods using offCtx
      this.renderNode(node.children[i], currentTime, editingNodeId, textEditingId, false, { s: 0, e: 1, o: 0 });
    }

    // Restore state
    this.ctx = mainCtx;
    this.isBooleanSession = wasBoolean;

    // Step 2: Apply the GROUP's styles to the resulting combined alpha mask
    // We use source-in to color the pixels we just created
    const fillVisible = AnimationUtils.getPropertyValue(node, 'style.fillVisible', currentTime) ?? (node.style.fillVisible ?? true);
    if (fillVisible) {
      offCtx.save();
      offCtx.setTransform(1, 0, 0, 1, 0, 0);
      offCtx.globalCompositeOperation = 'source-in';

      const fillType = node.style.fillType || 'solid';
      if (fillType === 'solid' && node.style.fill) {
        offCtx.fillStyle = node.style.fill;
        offCtx.fillRect(0, 0, canvas.width, canvas.height);
      } else if (fillType === 'gradient' && node.style.fillGradient) {
        // Transform back to the group space to render gradient correctly
        offCtx.setTransform(mainCtx.getTransform());
        offCtx.fillStyle = this.createCanvasGradient(node.style.fillGradient);
        offCtx.setTransform(1, 0, 0, 1, 0, 0); // Back to screen space for full coverage
        offCtx.fillRect(0, 0, canvas.width, canvas.height);
      }
      offCtx.restore();
    }

    // Step 3: Stroke the merged result if group has a stroke
    const strokeWidth = AnimationUtils.getPropertyValue(node, 'style.strokeWidth', currentTime) ?? (node.style.strokeWidth || 0);
    const strokeColor = AnimationUtils.getPropertyValue(node, 'style.stroke', currentTime) ?? node.style.stroke;

    if (strokeColor && strokeWidth > 0) {
      offCtx.save();
      offCtx.setTransform(mainCtx.getTransform()); // Use group's screen transform
      this.tracePathAgain(offCtx, node, currentTime);

      const strokeOpacity = AnimationUtils.getPropertyValue(node, 'style.strokeOpacity', currentTime) ?? (node.style.strokeOpacity ?? 1);
      offCtx.globalAlpha *= strokeOpacity;
      offCtx.strokeStyle = strokeColor;
      offCtx.lineWidth = strokeWidth;
      offCtx.lineCap = (node.style.strokeLinecap || 'round') as CanvasLineCap;
      offCtx.lineJoin = (node.style.strokeLinejoin || 'round') as CanvasLineJoin;
      offCtx.stroke();
      offCtx.restore();
    }

    // Step 4: Draw result back to main canvas
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0); // Draw in screen space
    this.ctx.drawImage(offscreen, 0, 0);
    this.ctx.restore();
  }




  private renderPath(node: SceneNode, currentTime: number, trim = { s: 0, e: 1, o: 0 }) {
    const points = AnimationUtils.getPropertyValue(node, 'props.points', currentTime) as VectorPoint[];
    if (!points || points.length === 0) return;

    const roundness = AnimationUtils.getPropertyValue(node, 'props.roundness', currentTime) || 0;
    const closed = node.props.closed;

    const isTrimmed = trim.s !== 0 || trim.e !== 1 || trim.o !== 0;

    this.ctx.beginPath();

    // --- Phase 4: Compound path support (for merged paths from import) ---
    const subPathLengths = node.props.subPathLengths as number[] | undefined;
    if (subPathLengths && subPathLengths.length > 1 && !isTrimmed && roundness <= 0) {
      // Draw each sub-path separately for correct compound rendering
      let offset = 0;
      for (const len of subPathLengths) {
        if (len <= 0) continue;
        const subPoints = points.slice(offset, offset + len);
        offset += len;
        if (subPoints.length === 0) continue;

        const first = subPoints[0];
        this.ctx.moveTo(first.x, first.y);
        for (let i = 0; i < subPoints.length; i++) {
          const current = subPoints[i];
          const next = subPoints[(i + 1) % subPoints.length];
          if (i < subPoints.length - 1 || closed) {
            this.ctx.bezierCurveTo(
              current.x + (current.outX || 0), current.y + (current.outY || 0),
              next.x + (next.inX || 0), next.y + (next.inY || 0),
              next.x, next.y
            );
          }
        }
        if (closed) this.ctx.closePath();
      }
      this.applyStyles(node, currentTime);
      return;
    }

    if (isTrimmed) {
      PathUtils.drawTrimmedPath(this.ctx, points, trim.s, trim.e, trim.o, closed, node.props.subPathLengths);
    }
    else if (roundness > 0) {
      // Premium path rounding logic
      const K = 0.552284749831;
      const r = roundness;

      for (let i = 0; i < points.length; i++) {
        const curr = points[i];
        const next = points[(i + 1) % points.length];
        const prev = points[(i - 1 + points.length) % points.length];

        // Is this vertex "sharp"? (no handles)
        const isSharp = (curr.inX === 0 && curr.inY === 0 && curr.outX === 0 && curr.outY === 0);

        if (isSharp && (closed || (i > 0 && i < points.length - 1))) {
          // Calculate unit vectors to adjacent points
          const vPrev = { x: prev.x - curr.x, y: prev.y - curr.y };
          const vNext = { x: next.x - curr.x, y: next.y - curr.y };
          const dPrev = Math.sqrt(vPrev.x * vPrev.x + vPrev.y * vPrev.y);
          const dNext = Math.sqrt(vNext.x * vNext.x + vNext.y * vNext.y);

          if (dPrev > 0.1 && dNext > 0.1) {
            const actualR = Math.min(r, dPrev / 2, dNext / 2);
            const p1 = { x: curr.x + (vPrev.x / dPrev) * actualR, y: curr.y + (vPrev.y / dPrev) * actualR };
            const p2 = { x: curr.x + (vNext.x / dNext) * actualR, y: curr.y + (vNext.y / dNext) * actualR };

            if (i === 0) this.ctx.moveTo(p1.x, p1.y);
            else this.ctx.lineTo(p1.x, p1.y);

            this.ctx.bezierCurveTo(
              p1.x + (curr.x - p1.x) * K, p1.y + (curr.y - p1.y) * K,
              p2.x + (curr.x - p2.x) * K, p2.y + (curr.y - p2.y) * K,
              p2.x, p2.y
            );
          } else {
            if (i === 0) this.ctx.moveTo(curr.x, curr.y);
            else this.ctx.lineTo(curr.x, curr.y);
          }
        } else {
          if (i === 0) {
            this.ctx.moveTo(curr.x, curr.y);
          }
          // Standard Bezier segment
          if (i < points.length - 1 || closed) {
            this.ctx.bezierCurveTo(
              curr.x + (curr.outX || 0), curr.y + (curr.outY || 0),
              next.x + (next.inX || 0), next.y + (next.inY || 0),
              next.x, next.y
            );
          }
        }
      }
      if (node.props.closed) this.ctx.closePath();
    } else {
      const first = points[0];
      this.ctx.moveTo(first.x, first.y);

      for (let i = 0; i < points.length; i++) {
        const current = points[i];
        const next = points[(i + 1) % points.length];

        if (i < points.length - 1 || node.props.closed) {
          this.ctx.bezierCurveTo(
            current.x + (current.outX || 0), current.y + (current.outY || 0),
            next.x + (next.inX || 0), next.y + (next.inY || 0),
            next.x, next.y
          );
        }
      }

      if (node.props.closed) {
        this.ctx.closePath();
      }
    }

    this.applyStyles(node, currentTime);
  }

  private getShapeLength(node: SceneNode, currentTime: number): number {
    switch (node.type) {
      case 'rect': {
        const w = AnimationUtils.getPropertyValue(node, 'props.width', currentTime) || 0;
        const h = AnimationUtils.getPropertyValue(node, 'props.height', currentTime) || 0;
        const r = AnimationUtils.getPropertyValue(node, 'props.roundness', currentTime) || 0;
        const radius = Math.min(r, w / 2, h / 2);
        if (radius <= 0) return 2 * (w + h);
        // Perimeter of rounded rect: 2(w+h) - 8r + 2*PI*r
        return 2 * (w + h) - radius * (8 - 2 * Math.PI);
      }
      case 'ellipse': {
        const rx = AnimationUtils.getPropertyValue(node, 'props.radiusX', currentTime) || 0;
        const ry = AnimationUtils.getPropertyValue(node, 'props.radiusY', currentTime) || 0;
        // Ramanujan approximation
        const h = Math.pow(rx - ry, 2) / Math.pow(rx + ry, 2);
        return Math.PI * (rx + ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
      }
      case 'path': {
        const points = AnimationUtils.getPropertyValue(node, 'props.points', currentTime) as VectorPoint[];
        if (!points || points.length < 2) return 0;
        let total = 0;
        for (let i = 0; i < points.length; i++) {
          const current = points[i];
          const next = points[(i + 1) % points.length];
          if (i < points.length - 1 || node.props.closed) {
            // Cubic Bezier length approximation (chord + midpoint distance)
            const d = Math.sqrt((next.x - current.x) ** 2 + (next.y - current.y) ** 2);
            // Simple approximation: average of chord and control point polygon
            const controlPoly = Math.sqrt((current.outX) ** 2 + (current.outY) ** 2) +
              Math.sqrt((next.inX) ** 2 + (next.inY) ** 2) +
              Math.sqrt((next.x - (current.x + current.outX)) ** 2 + (next.y - (current.y + current.outY)) ** 2);
            total += (d + controlPoly) / 2; // Rough but fast
          }
        }
        return total;
      }
      default:
        return 0;
    }
  }

  private renderImage(node: SceneNode, currentTime: number) {
    const width = AnimationUtils.getPropertyValue(node, 'props.width', currentTime) || 0;
    const height = AnimationUtils.getPropertyValue(node, 'props.height', currentTime) || 0;
    let src = node.props.src;

    // If it's a Lottie-style image, it might be in assets and referenced by refId
    if (!src && node.refId) {
      const assetNode = this.nodes.get(node.refId);
      if (assetNode && assetNode.props.src) {
        src = assetNode.props.src;
      }
    }

    if (!src) return;

    let img = this.imageCache.get(src);
    if (!img) {
      if (this.isWorker) {
        // In Worker: use fetch + createImageBitmap (async, cached on completion)
        fetch(src)
          .then(res => res.blob())
          .then(blob => createImageBitmap(blob))
          .then(bitmap => {
            this.imageCache.set(src, bitmap);
          })
          .catch(() => { /* silently fail */ });
        return; // Skip rendering until cached
      } else {
        img = new Image();
        (img as HTMLImageElement).src = src;
        img.onload = () => { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('editor:forceRender')); };
        this.imageCache.set(src, img);
      }
    }

    // Draw if ready
    if (img instanceof ImageBitmap) {
      this.ctx.drawImage(img, 0, 0, width, height);
    } else if ((img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth !== 0) {
      this.ctx.drawImage(img as HTMLImageElement, 0, 0, width, height);
    }

    this.applyStyles(node, currentTime);
  }

  // Apply individual layer masks (AE-style masks)
  private applyLayerMasks(node: SceneNode, currentTime: number) {
    if (!node.masks || node.masks.length === 0) return;

    // Save context to restore after clipping
    this.ctx.beginPath();

    let hasValidMask = false;
    for (const mask of node.masks) {
      // Support 'add' mode for now. 
      // Subtract (m.mode === 's') would require a huge inverse path or destination-out.
      if (mask.mode !== 'a' && mask.mode !== 'add' && mask.mode !== 'f') continue;

      const opacity = AnimationUtils.getPropertyValue(mask as any, 'style.opacity', currentTime) ?? 1;
      if (opacity <= 0) continue;

      const points = AnimationUtils.getPropertyValue(mask as any, 'props.points', currentTime) as VectorPoint[];
      if (!points || points.length === 0) continue;

      hasValidMask = true;
      this.ctx.moveTo(points[0].x, points[0].y);
      for (let i = 0; i < points.length; i++) {
        const current = points[i];
        const next = points[(i + 1) % points.length];
        this.ctx.bezierCurveTo(
          current.x + (current.outX || 0), current.y + (current.outY || 0),
          next.x + (next.inX || 0), next.y + (next.inY || 0),
          next.x, next.y
        );
      }
      this.ctx.closePath();
    }

    if (hasValidMask) {
      this.ctx.clip();
    }
  }

  private createCanvasGradient(gradient: any): CanvasGradient {
    let canvasGradient: CanvasGradient;

    const startX = gradient.start?.x ?? 0;
    const startY = gradient.start?.y ?? 0;
    const endX = gradient.end?.x ?? 100;
    const endY = gradient.end?.y ?? 100;

    if (gradient.type === 'linear') {
      canvasGradient = this.ctx.createLinearGradient(startX, startY, endX, endY);
    } else {
      const radius = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2)) || 1;
      canvasGradient = this.ctx.createRadialGradient(startX, startY, 0, startX, startY, radius);
    }

    const stops = Array.isArray(gradient.stops) ? gradient.stops : [];
    const sortedStops = [...stops].sort((a, b) => a.offset - b.offset);

    if (sortedStops.length === 0) {
      canvasGradient.addColorStop(0, 'rgba(0,0,0,0)');
      canvasGradient.addColorStop(1, 'rgba(0,0,0,0)');
    } else {
      sortedStops.forEach(stop => {
        const offset = Math.max(0, Math.min(1, stop.offset || 0));
        canvasGradient.addColorStop(offset, this.hexToRgba(stop.color || '#000000', stop.opacity ?? 1));
      });
    }

    return canvasGradient;
  }

  private hexToRgba(hex: string, opacity: number): string {
    const safeHex = (typeof hex === 'string' && hex.startsWith('#')) ? hex : '#000000';
    const fullHex = safeHex.length === 4 ?
      `#${safeHex[1]}${safeHex[1]}${safeHex[2]}${safeHex[2]}${safeHex[3]}${safeHex[3]}` : safeHex;

    const r = parseInt(fullHex.slice(1, 3), 16) || 0;
    const g = parseInt(fullHex.slice(3, 5), 16) || 0;
    const b = parseInt(fullHex.slice(5, 7), 16) || 0;
    const a = Math.max(0, Math.min(1, opacity));

    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  // Apply visual effects (Blur, Shadow) using ctx.filter
  private applyEffects(node: SceneNode, currentTime: number) {
    if (!node.style.effects || node.style.effects.length === 0) {
      this.ctx.filter = 'none';
      return;
    }

    const filters: string[] = [];

    node.style.effects.forEach((effect, index) => {
      const prefix = `style.effects.${index}`;
      const visible = AnimationUtils.getPropertyValue(node, `${prefix}.visible`, currentTime) ?? effect.visible;
      if (!visible) return;

      if (effect.type === 'blur') {
        const blurAmount = AnimationUtils.getPropertyValue(node, `${prefix}.blur`, currentTime) ?? effect.blur;
        filters.push(`blur(${blurAmount}px)`);
      } else if (effect.type === 'shadow') {
        const color = AnimationUtils.getPropertyValue(node, `${prefix}.color`, currentTime) ?? effect.color ?? '#000000';
        const opacity = AnimationUtils.getPropertyValue(node, `${prefix}.opacity`, currentTime) ?? effect.opacity ?? 1;
        const shadowColor = this.hexToRgba(color as string, opacity as number);

        // Calculate offset from distance and direction (angle)
        const direction = AnimationUtils.getPropertyValue(node, `${prefix}.direction`, currentTime) ?? effect.direction ?? 90;
        const distance = AnimationUtils.getPropertyValue(node, `${prefix}.distance`, currentTime) ?? effect.distance ?? 0;
        const blur = AnimationUtils.getPropertyValue(node, `${prefix}.blur`, currentTime) ?? effect.blur ?? 0;

        const angleRad = ((direction as number) - 90) * (Math.PI / 180);
        const dx = Math.cos(angleRad) * (distance as number);
        const dy = Math.sin(angleRad) * (distance as number);

        filters.push(`drop-shadow(${dx}px ${dy}px ${blur}px ${shadowColor})`);
      }
    });

    if (filters.length > 0) {
      this.ctx.filter = filters.join(' ');
    } else {
      this.ctx.filter = 'none';
    }
  }

  // Shared styling logic
  private applyStyles(node: SceneNode, currentTime: number) {
    if (this.isBooleanSession) {
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fill(node.style.fillRule || 'nonzero');
      return;
    }

    const fillVisible = this.resolveStyleProperty(node, 'style.fillVisible', currentTime) ?? (node.style.fillVisible ?? true);
    const fillOpacity = this.resolveStyleProperty(node, 'style.fillOpacity', currentTime) ?? (node.style.fillOpacity ?? 1);

    // Fill
    if (fillVisible) {
      const fillType = this.resolveStyleProperty(node, 'style.fillType', currentTime) || 'solid';
      const fillRule = node.style.fillRule || 'nonzero';
      if (fillType === 'solid') {
        const fill = this.resolveStyleProperty(node, 'style.fill', currentTime);
        if (fill) {
          this.ctx.save();
          this.ctx.globalAlpha *= fillOpacity;
          this.ctx.fillStyle = fill;
          this.ctx.fill(fillRule);
          this.ctx.restore();
        }
      } else {
        const fillGradient = this.resolveStyleProperty(node, 'style.fillGradient', currentTime);
        if (fillGradient) {
          this.ctx.save();
          this.ctx.globalAlpha *= fillOpacity;
          this.ctx.fillStyle = this.createCanvasGradient(fillGradient);
          this.ctx.fill(fillRule);
          this.ctx.restore();
        }
      }
    }

    // Stroke
    const strokeType = this.resolveStyleProperty(node, 'style.strokeType', currentTime) || 'solid';
    const strokeColor = this.resolveStyleProperty(node, 'style.stroke', currentTime);
    const strokeGradient = this.resolveStyleProperty(node, 'style.strokeGradient', currentTime);
    const strokeWidth = this.resolveStyleProperty(node, 'style.strokeWidth', currentTime);
    const strokeOpacity = this.resolveStyleProperty(node, 'style.strokeOpacity', currentTime) ?? (node.style.strokeOpacity ?? 1);
    const strokeAlign = node.style.strokeAlign || 'center';

    const hasStrokeColor = strokeType === 'solid' ? !!strokeColor : !!strokeGradient;

    if (hasStrokeColor && strokeWidth) {
      this.ctx.save();

      if (strokeType === 'solid') {
        this.ctx.strokeStyle = strokeColor!;
      } else {
        this.ctx.strokeStyle = this.createCanvasGradient(strokeGradient!);
      }

      this.ctx.lineWidth = strokeAlign === 'center' ? strokeWidth : strokeWidth * 2;
      this.ctx.lineCap = (this.resolveStyleProperty(node, 'style.strokeLinecap', currentTime) || node.style.strokeLinecap || 'round') as CanvasLineCap;
      this.ctx.lineJoin = (this.resolveStyleProperty(node, 'style.strokeLinejoin', currentTime) || node.style.strokeLinejoin || 'round') as CanvasLineJoin;

      const baseAlpha = this.ctx.globalAlpha;

      const strokeDash = this.resolveStyleProperty(node, 'style.strokeDash', currentTime) || node.style.strokeDash;
      if (strokeDash) {
        const dash = strokeDash.split(/[\s,]+/).map(Number).filter((n: number) => !isNaN(n));
        if (dash.length > 0) this.ctx.setLineDash(dash);
      } else {
        this.ctx.setLineDash([]);
      }

      if (strokeAlign === 'center') {
        this.ctx.globalAlpha = baseAlpha * strokeOpacity;
        this.ctx.stroke();
      } else if (strokeAlign === 'inside') {
        this.ctx.save();
        this.ctx.clip();
        this.ctx.globalAlpha = baseAlpha * strokeOpacity;
        this.ctx.stroke();
        this.ctx.restore();
      } else if (strokeAlign === 'outside') {
        const canvas = this.ctx.canvas;
        const offResult = this.createOffscreen(canvas.width, canvas.height);
        if (offResult) {
          const { canvas: offscreen, ctx: offCtx } = offResult;
          offCtx.setTransform(this.ctx.getTransform());
          offCtx.strokeStyle = this.ctx.strokeStyle;
          offCtx.lineWidth = this.ctx.lineWidth;
          offCtx.lineCap = this.ctx.lineCap;
          offCtx.lineJoin = this.ctx.lineJoin;
          offCtx.setLineDash(this.ctx.getLineDash());

          // Trace the same path again
          this.tracePathAgain(offCtx, node, currentTime);
          offCtx.stroke();

          // Clear the inside
          offCtx.globalCompositeOperation = 'destination-out';
          this.tracePathAgain(offCtx, node, currentTime);
          offCtx.fill();

          // Draw the offscreen result
          this.ctx.save();
          this.ctx.setTransform(1, 0, 0, 1, 0, 0);
          this.ctx.globalAlpha = baseAlpha * strokeOpacity;
          this.ctx.drawImage(offscreen, 0, 0);
          this.ctx.restore();
        }
      }

      this.ctx.restore();
    }
  }

  // Helper to re-trace the path of a node (needed for complex stroke effects or mattes)
  private tracePathAgain(ctx: RenderingContext, node: SceneNode, currentTime: number) {
    if (node.type === 'group' || node.type === 'artboard' || node.type === 'precomp') {
      const childrenIds = node.type === 'precomp'
        ? this.nodes.get(node.refId || '')?.children
        : node.children;

      if (childrenIds) {
        for (const childId of childrenIds) {
          const child = this.nodes.get(childId);
          if (child) {
            const childTransform = createTransformMatrix(child.transform, this.nodes, child, currentTime);
            const det = childTransform.a * childTransform.d - childTransform.b * childTransform.c;
            if (Math.abs(det) < 1e-10) continue;

            ctx.save();
            ctx.transform(childTransform.a, childTransform.b, childTransform.c, childTransform.d, childTransform.e, childTransform.f);
            this.tracePathAgain(ctx, child, currentTime);
            ctx.restore();
          }
        }
      }
      return;
    }

    if (node.type === 'rect') {
      const width = AnimationUtils.getPropertyValue(node, 'props.width', currentTime) || 0;
      const height = AnimationUtils.getPropertyValue(node, 'props.height', currentTime) || 0;
      const r = AnimationUtils.getPropertyValue(node, 'props.roundness', currentTime) || 0;
      if (r > 0) {
        const rad = Math.min(r, width / 2, height / 2);
        ctx.moveTo(rad, 0);
        ctx.lineTo(width - rad, 0);
        ctx.arcTo(width, 0, width, rad, rad);
        ctx.lineTo(width, height - rad);
        ctx.arcTo(width, height, width - rad, height, rad);
        ctx.lineTo(rad, height);
        ctx.arcTo(0, height, 0, height - rad, rad);
        ctx.lineTo(0, rad);
        ctx.arcTo(0, 0, rad, 0, rad);
        ctx.closePath();
      } else {
        ctx.rect(0, 0, width, height);
      }
    } else if (node.type === 'text') {
      // For clipping/mattes, we use the bounding box of the text as a reasonable approximation
      // Since we can't easily get the vector paths of the font characters in Canvas2D
      const text = AnimationUtils.getPropertyValue(node, 'props.text', currentTime) || '';
      const fontSize = AnimationUtils.getPropertyValue(node, 'props.fontSize', currentTime) || 24;
      const fontFamily = AnimationUtils.getPropertyValue(node, 'props.fontFamily', currentTime) || 'Inter';
      const fontWeight = AnimationUtils.getPropertyValue(node, 'props.fontWeight', currentTime) || '400';
      const lineHeight = AnimationUtils.getPropertyValue(node, 'props.lineHeight', currentTime) || 1.2;
      const textAlign = AnimationUtils.getPropertyValue(node, 'props.textAlign', currentTime) || 'left';
      const verticalAlign = AnimationUtils.getPropertyValue(node, 'props.verticalAlign', currentTime) || 'top';

      const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
      const tempCtx = canvas?.getContext('2d');
      if (tempCtx) {
        tempCtx.font = `${fontWeight} ${fontSize}px "${fontFamily}"`;
        const lines = text.split('\n');
        let maxW = 0;
        lines.forEach((line: string) => {
          maxW = Math.max(maxW, tempCtx.measureText(line).width);
        });
        const width = maxW;
        const height = lines.length * fontSize * lineHeight;

        let offsetX = 0;
        let offsetY = 0;
        if (textAlign === 'center') offsetX = -width / 2;
        else if (textAlign === 'right') offsetX = -width;
        if (verticalAlign === 'middle') offsetY = -height / 2;
        else if (verticalAlign === 'bottom') offsetY = -height;

        ctx.rect(offsetX, offsetY, width, height);
      }
    } else if (node.type === 'ellipse') {
      const rx = AnimationUtils.getPropertyValue(node, 'props.radiusX', currentTime) || 0;
      const ry = AnimationUtils.getPropertyValue(node, 'props.radiusY', currentTime) || 0;
      // CRITICAL: Start a new sub-path before the ellipse.
      // Per Canvas2D spec, ctx.ellipse() draws a connecting LINE from
      // the previous sub-path's last point to the ellipse start. When
      // combining multiple shapes (rect + ellipses) into a single clip path,
      // these connecting lines create triangular artifacts that cut holes
      // in the mask. moveTo() breaks the connection.
      ctx.moveTo(rx * 2, ry); // Start of ellipse arc at angle 0
      ctx.ellipse(rx, ry, rx, ry, 0, 0, Math.PI * 2);
    } else if (node.type === 'path') {
      const points = AnimationUtils.getPropertyValue(node, 'props.points', currentTime) as VectorPoint[];
      if (points && points.length > 0) {
        const subPathLengths = node.props.subPathLengths as number[] | undefined;
        const closed = node.props.closed;

        if (subPathLengths && subPathLengths.length > 1) {
          let offset = 0;
          for (const len of subPathLengths) {
            if (len <= 0) continue;
            const subPoints = points.slice(offset, offset + len);
            offset += len;
            if (subPoints.length === 0) continue;

            ctx.moveTo(subPoints[0].x, subPoints[0].y);
            for (let i = 0; i < subPoints.length; i++) {
              const current = subPoints[i];
              const next = subPoints[(i + 1) % subPoints.length];
              if (i < subPoints.length - 1 || closed) {
                ctx.bezierCurveTo(
                  current.x + (current.outX || 0), current.y + (current.outY || 0),
                  next.x + (next.inX || 0), next.y + (next.inY || 0),
                  next.x, next.y
                );
              }
            }
            if (closed) ctx.closePath();
          }
        } else {
          ctx.moveTo(points[0].x, points[0].y);
          for (let i = 0; i < points.length; i++) {
            const current = points[i];
            const next = points[(i + 1) % points.length];
            if (i < points.length - 1 || closed) {
              ctx.bezierCurveTo(
                current.x + (current.outX || 0), current.y + (current.outY || 0),
                next.x + (next.inX || 0), next.y + (next.inY || 0),
                next.x, next.y
              );
            }
          }
          if (closed) ctx.closePath();
        }
      }
    } else if (node.type === 'polystar') {
      const points = PathUtils.generatePolystarPoints(
        AnimationUtils.getPropertyValue(node, 'props.points', currentTime) ?? 5,
        AnimationUtils.getPropertyValue(node, 'props.innerRadius', currentTime) ?? 25,
        AnimationUtils.getPropertyValue(node, 'props.outerRadius', currentTime) ?? 50,
        AnimationUtils.getPropertyValue(node, 'props.innerRoundness', currentTime) ?? 0,
        AnimationUtils.getPropertyValue(node, 'props.outerRoundness', currentTime) ?? 0,
        (node.props?.starType === 'polygon' || node.props?.starType === 2) ? 'polygon' : 'star'
      );
      if (points.length > 0) {
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 0; i < points.length; i++) {
          const curr = points[i];
          const next = points[(i + 1) % points.length];
          ctx.bezierCurveTo(curr.x + curr.outX, curr.y + curr.outY, next.x + next.inX, next.y + next.inY, next.x, next.y);
        }
        ctx.closePath();
      }
    }
  }

  // Render rectangle
  private renderRect(node: SceneNode, currentTime: number, trim = { s: 0, e: 1, o: 0 }) {
    const width = AnimationUtils.getPropertyValue(node, 'props.width', currentTime) || 0;
    const height = AnimationUtils.getPropertyValue(node, 'props.height', currentTime) || 0;
    const roundness = AnimationUtils.getPropertyValue(node, 'props.roundness', currentTime) || 0;

    const isTrimmed = trim.s !== 0 || trim.e !== 1 || trim.o !== 0;

    this.ctx.beginPath();

    if (isTrimmed) {
      // For trimming, convert to a set of points
      const r = Math.min(roundness, width / 2, height / 2);
      const K = 0.552284749831;

      if (r > 0) {
        // Proper rounded rect points with beziers:
        const bezierPoints: VectorPoint[] = [
          { x: r, y: 0, inX: -r * K, inY: 0, outX: 0, outY: 0 }, // P0
          { x: width - r, y: 0, inX: 0, inY: 0, outX: r * K, outY: 0 }, // P1
          { x: width, y: r, inX: 0, inY: -r * K, outX: 0, outY: 0 }, // P2
          { x: width, y: height - r, inX: 0, inY: 0, outX: 0, outY: r * K }, // P3
          { x: width - r, y: height, inX: r * K, inY: 0, outX: 0, outY: 0 }, // P4
          { x: r, y: height, inX: 0, inY: 0, outX: -r * K, outY: 0 }, // P5
          { x: 0, y: height - r, inX: 0, inY: r * K, outX: 0, outY: 0 }, // P6
          { x: 0, y: r, inX: 0, inY: 0, outX: 0, outY: -r * K } // P7
        ];

        PathUtils.drawTrimmedPath(this.ctx, bezierPoints, trim.s, trim.e, trim.o, true);
      } else {
        const rectPoints: VectorPoint[] = [
          { x: 0, y: 0, inX: 0, inY: 0, outX: 0, outY: 0 },
          { x: width, y: 0, inX: 0, inY: 0, outX: 0, outY: 0 },
          { x: width, y: height, inX: 0, inY: 0, outX: 0, outY: 0 },
          { x: 0, y: height, inX: 0, inY: 0, outX: 0, outY: 0 }
        ];
        PathUtils.drawTrimmedPath(this.ctx, rectPoints, trim.s, trim.e, trim.o, true);
      }
    } else {
      if (roundness > 0) {
        const r = Math.min(roundness, width / 2, height / 2);
        this.ctx.moveTo(r, 0);
        this.ctx.lineTo(width - r, 0);
        this.ctx.arcTo(width, 0, width, r, r);
        this.ctx.lineTo(width, height - r);
        this.ctx.arcTo(width, height, width - r, height, r);
        this.ctx.lineTo(r, height);
        this.ctx.arcTo(0, height, 0, height - r, r);
        this.ctx.lineTo(0, r);
        this.ctx.arcTo(0, 0, r, 0, r);
        this.ctx.closePath();
      } else {
        this.ctx.rect(0, 0, width, height);
      }
    }


    this.applyStyles(node, currentTime);
  }

  // Render ellipse
  private renderEllipse(node: SceneNode, currentTime: number, trim = { s: 0, e: 1, o: 0 }) {
    const radiusX = AnimationUtils.getPropertyValue(node, 'props.radiusX', currentTime) || 0;
    const radiusY = AnimationUtils.getPropertyValue(node, 'props.radiusY', currentTime) || 0;

    const isTrimmed = trim.s !== 0 || trim.e !== 1 || trim.o !== 0;

    this.ctx.beginPath();

    if (isTrimmed) {
      const K = 0.552284749831;
      const points: VectorPoint[] = [
        { x: radiusX, y: 0, inX: 0, inY: 0, outX: radiusX * K, outY: 0 },
        { x: 2 * radiusX, y: radiusY, inX: 0, inY: -radiusY * K, outX: 0, outY: radiusY * K },
        { x: radiusX, y: 2 * radiusY, inX: radiusX * K, inY: 0, outX: -radiusX * K, outY: 0 },
        { x: 0, y: radiusY, inX: 0, inY: radiusY * K, outX: 0, outY: -radiusY * K },
        { x: radiusX, y: 0, inX: -radiusX * K, inY: 0, outX: 0, outY: 0 }
      ];
      // Note: we need 4 segments. The last point's "in" handle will be used by the first point's segment if closed.
      const ellipsePoints: VectorPoint[] = [
        { x: radiusX, y: 0, inX: -radiusX * K, inY: 0, outX: radiusX * K, outY: 0 },
        { x: 2 * radiusX, y: radiusY, inX: 0, inY: -radiusY * K, outX: 0, outY: radiusY * K },
        { x: radiusX, y: 2 * radiusY, inX: radiusX * K, inY: 0, outX: -radiusX * K, outY: 0 },
        { x: 0, y: radiusY, inX: 0, inY: radiusY * K, outX: 0, outY: -radiusY * K }
      ];
      PathUtils.drawTrimmedPath(this.ctx, ellipsePoints, trim.s, trim.e, trim.o, true);
    } else {
      this.ctx.ellipse(radiusX, radiusY, radiusX, radiusY, 0, 0, Math.PI * 2);
    }

    this.applyStyles(node, currentTime);
  }

  // Render artboard background
  private renderArtboard(node: SceneNode) {
    const { width, height, backgroundColor, transparent, showGrid } = node.props;

    // Background
    if (!transparent) {
      this.ctx.fillStyle = backgroundColor || '#ffffff';
      this.ctx.fillRect(0, 0, width, height);
    } else {
      // Transparency mode - premium LottieLab style
      this.ctx.save();

      // 1. Subtle "dimmed" background to define artboard area vs canvas background
      this.ctx.fillStyle = '#171717';
      this.ctx.fillRect(0, 0, width, height);

      // 2. Tiny subtle dots grid
      const spacing = 16;
      const dotRadius = 0.75;
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';

      for (let y = 0; y < height; y += spacing) {
        for (let x = 0; x < width; x += spacing) {
          this.ctx.beginPath();
          this.ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
          this.ctx.fill();
        }
      }
      this.ctx.restore();
    }

    // Grid
    if (showGrid) {
      this.ctx.save();
      this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.05)';
      this.ctx.lineWidth = 0.5;
      const step = 50;
      this.ctx.beginPath();
      for (let x = 0; x <= width; x += step) {
        this.ctx.moveTo(x, 0);
        this.ctx.lineTo(x, height);
      }
      for (let y = 0; y <= height; y += step) {
        this.ctx.moveTo(0, y);
        this.ctx.lineTo(width, y);
      }
      this.ctx.stroke();

      // Major grid
      this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
      const majorStep = 100;
      this.ctx.beginPath();
      for (let x = 0; x <= width; x += majorStep) {
        this.ctx.moveTo(x, 0);
        this.ctx.lineTo(x, height);
      }
      for (let y = 0; y <= height; y += majorStep) {
        this.ctx.moveTo(0, y);
        this.ctx.lineTo(width, y);
      }
      this.ctx.stroke();
      this.ctx.restore();
    }


    // Artboard Border
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(0, 0, width, height);
  }

  // Render text
  private renderText(node: SceneNode, currentTime: number) {
    const text = AnimationUtils.getPropertyValue(node, 'props.text', currentTime) || '';
    const fontSize = AnimationUtils.getPropertyValue(node, 'props.fontSize', currentTime) || 24;
    const fontFamily = AnimationUtils.getPropertyValue(node, 'props.fontFamily', currentTime) || 'Inter';
    const fontWeight = AnimationUtils.getPropertyValue(node, 'props.fontWeight', currentTime) || '400';
    const fontStyle = AnimationUtils.getPropertyValue(node, 'props.fontStyle', currentTime) || 'normal';
    const textAlign = AnimationUtils.getPropertyValue(node, 'props.textAlign', currentTime) || 'left';
    const verticalAlign = AnimationUtils.getPropertyValue(node, 'props.verticalAlign', currentTime) || 'top';
    const lineHeight = AnimationUtils.getPropertyValue(node, 'props.lineHeight', currentTime) || 1.2;
    const letterSpacing = AnimationUtils.getPropertyValue(node, 'props.letterSpacing', currentTime) || 0;
    const paragraphSpacing = AnimationUtils.getPropertyValue(node, 'props.paragraphSpacing', currentTime) || 0;
    const textDecoration: string[] = AnimationUtils.getPropertyValue(node, 'props.textDecoration', currentTime) || [];
    const boxWidth = AnimationUtils.getPropertyValue(node, 'props.width', currentTime) || 0;
    const boxHeight = AnimationUtils.getPropertyValue(node, 'props.height', currentTime) || 0;
    const isArea = boxWidth > 0;

    const fontStr = `${fontStyle} ${fontWeight} ${fontSize}px "${fontFamily}", sans-serif`;
    this.ctx.font = fontStr;
    this.ctx.textAlign = textAlign as CanvasTextAlign;
    if (verticalAlign === 'baseline') {
      this.ctx.textBaseline = 'alphabetic';
    } else {
      this.ctx.textBaseline = 'top';
    }
    if ('letterSpacing' in this.ctx) {
      (this.ctx as any).letterSpacing = `${letterSpacing}px`;
    }

    // Word-wrap for area text, hard-break-only for point text
    const measureFn = (s: string) => this.ctx.measureText(s).width;
    const wrapped = wrapLines(text, isArea ? boxWidth : 0, measureFn);

    // x origin: area text positions within the box; point text uses ctx.textAlign at x=0
    let x = 0;
    if (isArea) {
      if (textAlign === 'center') x = boxWidth / 2;
      else if (textAlign === 'right') x = boxWidth;
    }

    // Total height including paragraph spacing for vertical alignment
    let totalHeight = wrapped.length * fontSize * lineHeight;
    for (let i = 1; i < wrapped.length; i++) {
      if (paragraphSpacing > 0 && wrapped[i].startIndex > 0 && text[wrapped[i].startIndex - 1] === '\n') {
        totalHeight += paragraphSpacing;
      }
    }

    let y = 0;
    if (verticalAlign !== 'baseline') {
      if (verticalAlign === 'middle') y = -totalHeight / 2;
      else if (verticalAlign === 'bottom') y = -totalHeight;
    }

    // Clip to the area text box so overflow text is hidden
    let needsRestore = false;
    if (isArea && boxHeight > 0) {
      const clipY = verticalAlign === 'middle'
        ? -boxHeight / 2
        : verticalAlign === 'bottom' ? -boxHeight : 0;
      this.ctx.save();
      needsRestore = true;
      this.ctx.beginPath();
      this.ctx.rect(0, clipY, boxWidth, boxHeight);
      this.ctx.clip();
    }

    // Resolve fill — solid or gradient, honouring keyframe animation on the text node.
    // Must use resolveStyleProperty (same as shape rendering) so keyframes are evaluated
    // at currentTime instead of always reading the latest stored value from node.style.
    const fillType = (this.resolveStyleProperty(node, 'style.fillType', currentTime) || 'solid') as string;
    const animatedFill = this.resolveStyleProperty(node, 'style.fill', currentTime);
    const animatedFillGradient = this.resolveStyleProperty(node, 'style.fillGradient', currentTime);
    const fillStyle: string | CanvasGradient | null =
      fillType === 'gradient' && animatedFillGradient
        ? this.createCanvasGradient(animatedFillGradient)
        : (animatedFill ?? null);

    // Resolve stroke outside the loop — same reasoning as fill above
    const animatedStroke = this.resolveStyleProperty(node, 'style.stroke', currentTime);
    const animatedStrokeWidth = this.resolveStyleProperty(node, 'style.strokeWidth', currentTime);

    const hasDecoration = textDecoration.length > 0;
    const decoThickness = Math.max(1, fontSize / 15);

    for (let i = 0; i < wrapped.length; i++) {
      const line = wrapped[i];

      // Paragraph spacing: extra gap before a line that begins a new paragraph
      if (i > 0 && paragraphSpacing > 0 && line.startIndex > 0 && text[line.startIndex - 1] === '\n') {
        y += paragraphSpacing;
      }

      if (fillStyle) {
        this.ctx.fillStyle = fillStyle;
        this.ctx.fillText(line.text, x, y);
      }
      if (animatedStroke && animatedStrokeWidth) {
        this.ctx.strokeStyle = animatedStroke;
        this.ctx.lineWidth = animatedStrokeWidth;
        this.ctx.strokeText(line.text, x, y);
      }

      // Text decorations: underline and strikethrough
      if (hasDecoration && fillStyle) {
        this.ctx.fillStyle = fillStyle;
        const lw = this.ctx.measureText(line.text).width;
        // Compute left edge of the text (independent of ctx.textAlign draw anchor)
        let decoX: number;
        if (isArea) {
          if (textAlign === 'center') decoX = x - lw / 2;
          else if (textAlign === 'right') decoX = x - lw;
          else decoX = x;
        } else {
          if (textAlign === 'center') decoX = -lw / 2;
          else if (textAlign === 'right') decoX = -lw;
          else decoX = 0;
        }
        if (textDecoration.includes('underline')) {
          this.ctx.fillRect(decoX, y + fontSize * 0.92, lw, decoThickness);
        }
        if (textDecoration.includes('strikethrough')) {
          this.ctx.fillRect(decoX, y + fontSize * 0.45, lw, decoThickness);
        }
      }

      y += fontSize * lineHeight;
    }

    if (needsRestore) {
      this.ctx.restore();
    }

    // Reset letter spacing for subsequent nodes
    if ('letterSpacing' in this.ctx) {
      (this.ctx as any).letterSpacing = '0px';
    }
  }

  // Apply matte (mask) clipping from another node
  // Apply matte (mask) clipping from another node
  private applyMatteClip(matteNode: SceneNode, currentTime: number, type: number = 1) {
    const prevMatrix = this.ctx.getTransform();

    const worldMatrix = this.getWorldMatrixCached(matteNode.id, currentTime, this.rootId || undefined);
    const finalMatrix = this.viewTransform.multiply(worldMatrix);

    this.ctx.setTransform(finalMatrix);
    this.ctx.beginPath();

    if (type === 2) {
      this.ctx.rect(-1000000, -1000000, 2000000, 2000000);
      this.tracePathAgain(this.ctx, matteNode, currentTime);
      this.ctx.clip('evenodd');
    } else {
      this.tracePathAgain(this.ctx, matteNode, currentTime);
      this.ctx.clip();
    }

    this.ctx.setTransform(prevMatrix);
  }

  private renderWithRepeater(node: SceneNode, effectIdx: number, currentTime: number, editingNodeId: string | null, textEditingId: string | null, parentIsDimmed: boolean, inheritedTrim: any) {
    const effect = node.style.effects![effectIdx];
    const prefix = `style.effects.${effectIdx}`;
    const copies = Math.max(1, Math.round(AnimationUtils.getPropertyValue(node, `${prefix}.copies`, currentTime) ?? 3));
    const offset = AnimationUtils.getPropertyValue(node, `${prefix}.offset`, currentTime) ?? 0;
    const composite = effect.composite || 'above';

    const rTransform = effect.repeaterTransform || { x: 100, y: 0, scaleX: 1, scaleY: 1, rotation: 0, startOpacity: 1, endOpacity: 1 };
    
    // Resolve animated repeater transform properties
    const rx = AnimationUtils.getPropertyValue(node, `${prefix}.repeaterTransform.x`, currentTime) ?? rTransform.x;
    const ry = AnimationUtils.getPropertyValue(node, `${prefix}.repeaterTransform.y`, currentTime) ?? rTransform.y;
    const rsx = AnimationUtils.getPropertyValue(node, `${prefix}.repeaterTransform.scaleX`, currentTime) ?? rTransform.scaleX;
    const rsy = AnimationUtils.getPropertyValue(node, `${prefix}.repeaterTransform.scaleY`, currentTime) ?? rTransform.scaleY;
    const rr = AnimationUtils.getPropertyValue(node, `${prefix}.repeaterTransform.rotation`, currentTime) ?? rTransform.rotation;
    const rso = AnimationUtils.getPropertyValue(node, `${prefix}.repeaterTransform.startOpacity`, currentTime) ?? rTransform.startOpacity;
    const reo = AnimationUtils.getPropertyValue(node, `${prefix}.repeaterTransform.endOpacity`, currentTime) ?? rTransform.endOpacity;

    const renderIndices = [];
    if (composite === 'above') {
      for (let i = 0; i < copies; i++) renderIndices.push(i);
    } else {
      for (let i = copies - 1; i >= 0; i--) renderIndices.push(i);
    }

    for (const i of renderIndices) {
      this.ctx.save();
      
      // Calculate opacity for this copy
      const t = copies > 1 ? i / (copies - 1) : 0;
      const copyOpacity = rso + (reo - rso) * t;
      this.ctx.globalAlpha *= copyOpacity;

      // Apply cumulative transform: T = (RepeaterTransform)^(i + offset)
      const factor = i + offset;
      if (factor !== 0) {
        this.ctx.translate(rx * factor, ry * factor);
        this.ctx.rotate((rr * factor * Math.PI) / 180);
        this.ctx.scale(Math.pow(rsx, factor), Math.pow(rsy, factor));
      }

      // Temporarily clear repeater from node style to avoid infinite loop
      const originalEffects = node.style.effects;
      (node.style as any).effects = originalEffects?.filter((_, idx) => idx !== effectIdx);
      
      this.renderNode(node.id, currentTime, editingNodeId, textEditingId, parentIsDimmed, inheritedTrim);
      
      node.style.effects = originalEffects;
      this.ctx.restore();
    }
  }

  private renderPolystar(node: SceneNode, currentTime: number, trim: any) {
    const points = PathUtils.generatePolystarPoints(
        AnimationUtils.getPropertyValue(node, 'props.points', currentTime) ?? 5,
        AnimationUtils.getPropertyValue(node, 'props.innerRadius', currentTime) ?? 25,
        AnimationUtils.getPropertyValue(node, 'props.outerRadius', currentTime) ?? 50,
        AnimationUtils.getPropertyValue(node, 'props.innerRoundness', currentTime) ?? 0,
        AnimationUtils.getPropertyValue(node, 'props.outerRoundness', currentTime) ?? 0,
        (node.props?.starType === 'polygon' || node.props?.starType === 2) ? 'polygon' : 'star'
    );

    const isTrimmed = trim.s !== 0 || trim.e !== 1 || trim.o !== 0;
    this.ctx.beginPath();
    
    if (isTrimmed) {
      PathUtils.drawTrimmedPath(this.ctx, points, trim.s, trim.e, trim.o, true);
    } else {
      if (points.length > 0) {
        const first = points[0];
        this.ctx.moveTo(first.x, first.y);
        for (let i = 0; i < points.length; i++) {
          const curr = points[i];
          const next = points[(i + 1) % points.length];
          this.ctx.bezierCurveTo(
            curr.x + curr.outX, curr.y + curr.outY,
            next.x + next.inX, next.y + next.inY,
            next.x, next.y
          );
        }
        this.ctx.closePath();
      }
    }

    this.applyStyles(node, currentTime);
  }

  private renderWithOffsetPath(node: SceneNode, effectIdx: number, currentTime: number, editingNodeId: string | null, textEditingId: string | null, parentIsDimmed: boolean, inheritedTrim: any) {
    const effect = node.style.effects![effectIdx];
    const amount = AnimationUtils.getPropertyValue(node, `style.effects.${effectIdx}.amount`, currentTime) ?? 10;
    
    // Convert current node to a temporary path if it's a primitive
    if (['rect', 'ellipse', 'polystar', 'path'].includes(node.type)) {
      this.ctx.save();
      const worldMatrix = this.getWorldMatrixCached(node.id, currentTime, this.rootId || undefined);
      const finalMatrix = this.viewTransform.multiply(worldMatrix);
      this.ctx.setTransform(finalMatrix);

      let points: VectorPoint[] = [];
      if (node.type === 'rect') {
          const w = AnimationUtils.getPropertyValue(node, 'props.width', currentTime) || 100;
          const h = AnimationUtils.getPropertyValue(node, 'props.height', currentTime) || 100;
          points = [{x:0,y:0,inX:0,inY:0,outX:0,outY:0},{x:w,y:0,inX:0,inY:0,outX:0,outY:0},{x:w,y:h,inX:0,inY:0,outX:0,outY:0},{x:0,y:h,inX:0,inY:0,outX:0,outY:0}];
      } else if (node.type === 'polystar') {
          points = PathUtils.generatePolystarPoints(
            AnimationUtils.getPropertyValue(node, 'props.points', currentTime) ?? 5,
            AnimationUtils.getPropertyValue(node, 'props.innerRadius', currentTime) ?? 25,
            AnimationUtils.getPropertyValue(node, 'props.outerRadius', currentTime) ?? 50,
            AnimationUtils.getPropertyValue(node, 'props.innerRoundness', currentTime) ?? 0,
            AnimationUtils.getPropertyValue(node, 'props.outerRoundness', currentTime) ?? 0,
            (node.props?.starType === 'polygon' || node.props?.starType === 2) ? 'polygon' : 'star'
          );
      } else if (node.type === 'path') {
          points = AnimationUtils.getPropertyValue(node, 'props.points', currentTime) || [];
      } else if (node.type === 'ellipse') {
          const rx = AnimationUtils.getPropertyValue(node, 'props.radiusX', currentTime) || 50;
          const ry = AnimationUtils.getPropertyValue(node, 'props.radiusY', currentTime) || 50;
          const K = 0.552284749831;
          points = [
              {x:rx*2, y:ry, inX:0, inY:-ry*K, outX:0, outY:ry*K},
              {x:rx, y:ry*2, inX:rx*K, inY:0, outX:-rx*K, outY:0},
              {x:0, y:ry, inX:0, inY:ry*K, outX:0, outY:-ry*K},
              {x:rx, y:0, inX:-rx*K, inY:0, outX:rx*K, outY:0}
          ];
      }

      const offsetPoints = PathUtils.offsetPoints(points, amount, true);
      this.ctx.beginPath();
      if (offsetPoints.length > 0) {
          this.ctx.moveTo(offsetPoints[0].x, offsetPoints[0].y);
          for (let i = 0; i < offsetPoints.length; i++) {
              const curr = offsetPoints[i];
              const next = offsetPoints[(i + 1) % offsetPoints.length];
              this.ctx.bezierCurveTo(curr.x + (curr.outX || 0), curr.y + (curr.outY || 0), next.x + (next.inX || 0), next.y + (next.inY || 0), next.x, next.y);
          }
          this.ctx.closePath();
      }
      
      this.applyStyles(node, currentTime);
      this.ctx.restore();
    } else {
        const originalEffects = node.style.effects;
        (node.style as any).effects = originalEffects?.filter((_, idx) => idx !== effectIdx);
        this.renderNode(node.id, currentTime, editingNodeId, textEditingId, parentIsDimmed, inheritedTrim);
        node.style.effects = originalEffects;
    }
  }

  private isColorDark(hex: string): boolean {
    const fullHex = hex.length === 4 ?
      `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
    const r = parseInt(fullHex.slice(1, 3), 16) || 0;
    const g = parseInt(fullHex.slice(3, 5), 16) || 0;
    const b = parseInt(fullHex.slice(5, 7), 16) || 0;
    // Simple black/white threshold for grid visibility
    return (r * 0.299 + g * 0.587 + b * 0.114) < 160;
  }
}
