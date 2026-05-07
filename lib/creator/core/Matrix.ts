import { Transform, SceneNode } from '../state/sceneSlice';
import { AnimationUtils } from './Animation';

export function getAnimatedAnchor(node: SceneNode, nodes: Map<string, SceneNode>, currentTime?: number): { x: number, y: number } {
  const transform = node.transform;
  let ax = currentTime !== undefined ? AnimationUtils.getPropertyValue(node, 'transform.anchorX', currentTime) : transform.anchorX;
  let ay = currentTime !== undefined ? AnimationUtils.getPropertyValue(node, 'transform.anchorY', currentTime) : transform.anchorY;

  const alignX = currentTime !== undefined ? AnimationUtils.getPropertyValue(node, 'transform.anchorAlignX', currentTime) : transform.anchorAlignX;
  const alignY = currentTime !== undefined ? AnimationUtils.getPropertyValue(node, 'transform.anchorAlignY', currentTime) : transform.anchorAlignY;

  if (alignX !== undefined || alignY !== undefined) {
    let w = 0, h = 0, ox = 0, oy = 0;
    if (node.type === 'rect' || node.type === 'artboard' || node.type === 'image') {
      w = currentTime !== undefined ? AnimationUtils.getPropertyValue(node, 'props.width', currentTime) : (node.props.width || 0);
      h = currentTime !== undefined ? AnimationUtils.getPropertyValue(node, 'props.height', currentTime) : (node.props.height || 0);
    } else if (node.type === 'precomp' && node.refId) {
      const refArtboard = nodes.get(node.refId);
      if (refArtboard) {
        w = currentTime !== undefined ? AnimationUtils.getPropertyValue(refArtboard, 'props.width', currentTime) : (refArtboard.props.width || 0);
        h = currentTime !== undefined ? AnimationUtils.getPropertyValue(refArtboard, 'props.height', currentTime) : (refArtboard.props.height || 0);
      }
    } else if (node.type === 'ellipse') {
      const rx = currentTime !== undefined ? AnimationUtils.getPropertyValue(node, 'props.radiusX', currentTime) : node.props.radiusX;
      const ry = currentTime !== undefined ? AnimationUtils.getPropertyValue(node, 'props.radiusY', currentTime) : node.props.radiusY;
      w = rx * 2; h = ry * 2;
    } else if (node.type === 'path') {
      const points = currentTime !== undefined ? AnimationUtils.getPropertyValue(node, 'props.points', currentTime) : node.props.points;
      const lb = getPathLocalBounds(points || []);
      w = lb.width; h = lb.height; ox = lb.x; oy = lb.y;
    } else if (node.type === 'group') {
      const lb = getGroupLocalBounds(node.id, nodes, currentTime);
      w = lb.width; h = lb.height; ox = lb.x; oy = lb.y;
    } else if (node.type === 'text') {
      const boxW = (currentTime !== undefined ? AnimationUtils.getPropertyValue(node, 'props.width', currentTime) : node.props.width) || 0;
      const boxH = (currentTime !== undefined ? AnimationUtils.getPropertyValue(node, 'props.height', currentTime) : node.props.height) || 0;
      const textAlign = node.props.textAlign || 'left';
      const vertAlign = node.props.verticalAlign || 'top';
      if (boxW > 0) {
        // Area text — exact box dimensions
        const bY = vertAlign === 'middle' ? -boxH / 2 : vertAlign === 'bottom' ? -boxH : 0;
        w = boxW; h = boxH; ox = 0; oy = bY;
      } else {
        // Point text — rough worker-safe estimate (Canvas-2D not available in Web Worker)
        const rawText = node.props.text || '';
        const fontSize = node.props.fontSize || 24;
        const lhMul = node.props.lineHeight || 1.2;
        const lines = rawText.split('\n');
        let maxLen = 0;
        lines.forEach((l: string) => { maxLen = Math.max(maxLen, l.length); });
        w = maxLen * fontSize * 0.55;
        h = lines.length * fontSize * lhMul;
        ox = textAlign === 'center' ? -w / 2 : textAlign === 'right' ? -w : 0;
        oy = vertAlign === 'middle' ? -h / 2 : vertAlign === 'bottom' ? -h : 0;
      }
    }

    if (alignX !== undefined) ax = ox + w * alignX;
    if (alignY !== undefined) ay = oy + h * alignY;
  }
  return { x: ax, y: ay };
}

// Create a DOMMatrix from transform properties
export function createTransformMatrix(transform: Transform, nodes: Map<string, SceneNode>, node?: SceneNode, currentTime?: number, includeAnchor: boolean = true): DOMMatrix {
  const matrix = new DOMMatrix();

  let { x, y, rotation, scaleX, scaleY } = transform;
  let ax = transform.anchorX;
  let ay = transform.anchorY;

  if (node && currentTime !== undefined) {
    x = AnimationUtils.getPropertyValue(node, 'transform.x', currentTime) ?? x;
    y = AnimationUtils.getPropertyValue(node, 'transform.y', currentTime) ?? y;
    rotation = AnimationUtils.getPropertyValue(node, 'transform.rotation', currentTime) ?? rotation;
    scaleX = AnimationUtils.getPropertyValue(node, 'transform.scaleX', currentTime) ?? scaleX;
    scaleY = AnimationUtils.getPropertyValue(node, 'transform.scaleY', currentTime) ?? scaleY;

    const animatedAnchor = getAnimatedAnchor(node, nodes, currentTime);
    ax = animatedAnchor.x;
    ay = animatedAnchor.y;
  } else if (node) {
    const staticAnchor = getAnimatedAnchor(node, nodes);
    ax = staticAnchor.x;
    ay = staticAnchor.y;
  }

  // Apply transformations in order: translate -> rotate -> scale -> anchor offset
  matrix.translateSelf(x, y);
  matrix.rotateSelf(rotation);
  matrix.scaleSelf(scaleX, scaleY);

  if (includeAnchor) {
    matrix.translateSelf(-ax, -ay);
  }

  return matrix;
}

// Get world matrix by multiplying parent chain
export function getWorldMatrix(
  nodeId: string,
  nodes: Map<string, SceneNode>,
  currentTime?: number,
  rootId?: string // Optional root to stop at (useful for nested compositions)
): DOMMatrix {
  const matrices: DOMMatrix[] = [];
  let currentId: string | null = nodeId;
  const visited = new Set<string>();

  // Collect all parent matrices
  while (currentId) {
    if (visited.has(currentId)) {
      console.warn('⚠️ Circular parenting detected for node:', currentId);
      break;
    }
    visited.add(currentId);

    const node = nodes.get(currentId);
    if (!node) break;

    // If we've reached the specified root, we stop BEFORE adding its matrix 
    // because the viewport transform handles the root's placement.
    if (rootId && currentId === rootId) break;

    // In After Effects and Lottie, a parent's coordinate space natively includes its anchor point shift.
    // Lottie encodes AE-parented children's positions as (parentAnchor + relativeOffset), so applying
    // T(-anchor) for every node in the chain is the correct math for this data format.
    matrices.unshift(createTransformMatrix(node.transform, nodes, node, currentTime, true));

    // AE Parenting: prioritize parentLayerId, fallback to parentId
    currentId = (node.parentLayerId && nodes.has(node.parentLayerId)) ? node.parentLayerId : node.parentId;
  }

  // Multiply all matrices together
  return matrices.reduce(
    (acc, matrix) => acc.multiply(matrix),
    new DOMMatrix()
  );
}

// Convert screen coordinates to local node coordinates
export function screenToLocal(
  screenX: number,
  screenY: number,
  worldMatrix: DOMMatrix
): { x: number; y: number } {
  const inverse = worldMatrix.inverse();
  const point = new DOMPoint(screenX, screenY);
  const transformed = point.matrixTransform(inverse);

  return {
    x: transformed.x,
    y: transformed.y,
  };
}

// Convert local coordinates to screen coordinates
export function localToScreen(
  localX: number,
  localY: number,
  worldMatrix: DOMMatrix
): { x: number; y: number } {
  const point = new DOMPoint(localX, localY);
  const transformed = point.matrixTransform(worldMatrix);

  return {
    x: transformed.x,
    y: transformed.y,
  };
}

// Get bounding box of a node in screen space
export function getBoundingBox(
  node: SceneNode,
  worldMatrix: DOMMatrix,
  nodes?: Map<string, SceneNode>,
  currentTime?: number
): { x: number; y: number; width: number; height: number } {
  let width = 0;
  let height = 0;

  // Get dimensions based on node type
  if (node.type === 'rect' || node.type === 'artboard') {
    width = (currentTime !== undefined)
      ? AnimationUtils.getPropertyValue(node, 'props.width', currentTime)
      : node.props.width;
    height = (currentTime !== undefined)
      ? AnimationUtils.getPropertyValue(node, 'props.height', currentTime)
      : node.props.height;

    width = width || 0;
    height = height || 0;
  } else if (node.type === 'image') {
    width = (currentTime !== undefined)
      ? AnimationUtils.getPropertyValue(node, 'props.width', currentTime)
      : node.props.width;
    height = (currentTime !== undefined)
      ? AnimationUtils.getPropertyValue(node, 'props.height', currentTime)
      : node.props.height;

    width = width || 0;
    height = height || 0;
  } else if (node.type === 'ellipse') {
    const rx = (currentTime !== undefined)
      ? AnimationUtils.getPropertyValue(node, 'props.radiusX', currentTime)
      : node.props.radiusX;
    const ry = (currentTime !== undefined)
      ? AnimationUtils.getPropertyValue(node, 'props.radiusY', currentTime)
      : node.props.radiusY;

    width = (rx || 0) * 2;
    height = (ry || 0) * 2;
  } else if (node.type === 'path') {
    const points = (currentTime !== undefined)
      ? AnimationUtils.getPropertyValue(node, 'props.points', currentTime)
      : node.props.points;

    const lb = getPathLocalBounds(points || []);
    width = lb.width;
    height = lb.height;
    const offsetX = lb.x;
    const offsetY = lb.y;

    const corners = [
      localToScreen(offsetX, offsetY, worldMatrix),
      localToScreen(offsetX + width, offsetY, worldMatrix),
      localToScreen(offsetX + width, offsetY + height, worldMatrix),
      localToScreen(offsetX, offsetY + height, worldMatrix),
    ];
    return calculateBoundsFromPoints(corners);
  } else if (node.type === 'group' && node.id && nodes) {
    // For groups, use children's collective bounds in this group's local space
    const lb = getGroupLocalBounds(node.id, nodes, currentTime);
    // Adjust logic to use the actual bounds box
    const corners = [
      localToScreen(lb.x, lb.y, worldMatrix),
      localToScreen(lb.x + lb.width, lb.y, worldMatrix),
      localToScreen(lb.x + lb.width, lb.y + lb.height, worldMatrix),
      localToScreen(lb.x, lb.y + lb.height, worldMatrix),
    ];
    return calculateBoundsFromPoints(corners);
  } else if (node.type === 'text') {
    width = (currentTime !== undefined)
      ? AnimationUtils.getPropertyValue(node, 'props.width', currentTime)
      : node.props.width;
    height = (currentTime !== undefined)
      ? AnimationUtils.getPropertyValue(node, 'props.height', currentTime)
      : node.props.height;

    if (!width || !height) {
      const text = (currentTime !== undefined)
        ? AnimationUtils.getPropertyValue(node, 'props.text', currentTime)
        : node.props.text || '';
      const fontSize = (currentTime !== undefined)
        ? AnimationUtils.getPropertyValue(node, 'props.fontSize', currentTime)
        : node.props.fontSize || 24;
      const lineHeight = (currentTime !== undefined)
        ? AnimationUtils.getPropertyValue(node, 'props.lineHeight', currentTime)
        : node.props.lineHeight || 1.2;
      const textAlign = (currentTime !== undefined)
        ? AnimationUtils.getPropertyValue(node, 'props.textAlign', currentTime)
        : node.props.textAlign || 'left';
      const verticalAlign = (currentTime !== undefined)
        ? AnimationUtils.getPropertyValue(node, 'props.verticalAlign', currentTime)
        : node.props.verticalAlign || 'top';

      const lines = text.split('\n');
      let maxChars = 0;
      lines.forEach((l: string) => maxChars = Math.max(maxChars, l.length));

      width = maxChars * fontSize * 0.5; // Rough estimaton
      height = lines.length * fontSize * lineHeight;

      let offsetX = 0;
      let offsetY = 0;
      if (textAlign === 'center') offsetX = -width / 2;
      else if (textAlign === 'right') offsetX = -width;

      if (verticalAlign === 'middle') offsetY = -height / 2;
      else if (verticalAlign === 'bottom') offsetY = -height;
      else if (verticalAlign === 'baseline') offsetY = -fontSize;

      const corners = [
        localToScreen(offsetX, offsetY, worldMatrix),
        localToScreen(offsetX + width, offsetY, worldMatrix),
        localToScreen(offsetX + width, offsetY + height, worldMatrix),
        localToScreen(offsetX, offsetY + height, worldMatrix),
      ];
      return calculateBoundsFromPoints(corners);
    }
  } else if (node.type === 'precomp' && nodes) {
    const refArtboard = node.refId ? nodes.get(node.refId) : null;
    width = node.props?.width || refArtboard?.props?.width || 0;
    height = node.props?.height || refArtboard?.props?.height || 0;
  }

  // Transform corners to screen space
  const corners = [
    localToScreen(0, 0, worldMatrix),
    localToScreen(width, 0, worldMatrix),
    localToScreen(width, height, worldMatrix),
    localToScreen(0, height, worldMatrix),
  ];

  return calculateBoundsFromPoints(corners);
}

export function getPathLocalBounds(points: any[]): { x: number; y: number; width: number; height: number } {
  if (!points || points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of points) {
    const px = p.x || 0;
    const py = p.y || 0;
    const inX = p.inX || 0;
    const inY = p.inY || 0;
    const outX = p.outX || 0;
    const outY = p.outY || 0;

    // Basic bounds from anchor
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);

    // Include handles
    minX = Math.min(minX, px + inX);
    minY = Math.min(minY, py + inY);
    maxX = Math.max(maxX, px + inX);
    maxY = Math.max(maxY, py + inY);

    minX = Math.min(minX, px + outX);
    minY = Math.min(minY, py + outY);
    maxX = Math.max(maxX, px + outX);
    maxY = Math.max(maxY, py + outY);
  }

  return {
    x: isFinite(minX) ? minX : 0,
    y: isFinite(minY) ? minY : 0,
    width: (isFinite(maxX) && isFinite(minX)) ? Math.max(0, maxX - minX) : 0,
    height: (isFinite(maxY) && isFinite(minY)) ? Math.max(0, maxY - minY) : 0
  };
}

function calculateBoundsFromPoints(points: { x: number, y: number }[]): { x: number; y: number; width: number; height: number } {
  const xs = points.map(c => c.x);
  const ys = points.map(c => c.y);

  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

// Get the visual bounds of a group in its own local space
export function getGroupLocalBounds(nodeId: string, nodes: Map<string, SceneNode>, currentTime?: number): { x: number, y: number, width: number, height: number } {
  const group = nodes.get(nodeId);
  if (!group || group.type !== 'group' || group.children.length === 0) {
    return { x: 0, y: 0, width: group?.props?.width || 0, height: group?.props?.height || 0 };
  }

  // --- Optimization: Frame-level Cache ---
  // In deep hierarchies, group bounds are often requested multiple times per frame.
  // We use AnimationUtils._frameCache (if active) to memoize these results.
  const cacheKey = currentTime !== undefined ? `bounds::${nodeId}::${currentTime}` : undefined;
  if (cacheKey && AnimationUtils._cacheActive) {
    const cached = AnimationUtils._frameCache.get(cacheKey);
    if (cached) return cached;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const childId of group.children) {
    const child = nodes.get(childId);
    if (!child || child.props?.clipping) continue;

    // A child's matrix in its parent group's space is just its own local transform
    const childLocalToGroup = createTransformMatrix(child.transform, nodes, child, currentTime, true);

    // Get child bounds in group-local space
    const cb = getBoundingBox(child, childLocalToGroup, nodes, currentTime);
    minX = Math.min(minX, cb.x);
    minY = Math.min(minY, cb.y);
    maxX = Math.max(maxX, cb.x + cb.width);
    maxY = Math.max(maxY, cb.y + cb.height);
  }

  const result = minX === Infinity 
    ? { x: 0, y: 0, width: group.props?.width || 0, height: group.props?.height || 0 }
    : { x: minX, y: minY, width: maxX - minX, height: maxY - minY };

  // Store in cache for this frame
  if (cacheKey && AnimationUtils._cacheActive) {
    AnimationUtils._frameCache.set(cacheKey, result);
  }

  return result;
}

// Calculate necessary position offset when changing anchor point without moving the node on screen
export function getAnchorOffset(
  oldAnchor: { x: number; y: number },
  newAnchor: { x: number; y: number },
  transform: Transform
): { dx: number; dy: number } {
  // 1. Calculate the vector from old anchor to new anchor in local space
  const dx = newAnchor.x - oldAnchor.x;
  const dy = newAnchor.y - oldAnchor.y;

  // 2. We need to rotate and scale this vector to find its equivalent in parent space
  // Create a matrix representing just the rotation and scale
  const m = new DOMMatrix();
  m.rotateSelf(transform.rotation);
  m.scaleSelf(transform.scaleX, transform.scaleY);

  // 3. Transform the local vector
  const point = new DOMPoint(dx, dy);
  const transformed = point.matrixTransform(m);

  return {
    dx: transformed.x,
    dy: transformed.y,
  };
}

// Get collective bounding box for multiple nodes in world space
export function getCollectiveBoundingBox(
  nodeIds: string[],
  nodes: Map<string, SceneNode>,
  currentTime?: number,
  rootId?: string
): { x: number; y: number; width: number; height: number } {
  if (nodeIds.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const id of nodeIds) {
    const node = nodes.get(id);
    if (!node || node.props?.clipping) continue;

    const worldMatrix = getWorldMatrix(id, nodes, currentTime, rootId);
    const bounds = getBoundingBox(node, worldMatrix, nodes, currentTime);

    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

// Decompose matrix (2D) into transform components
export function decomposeMatrix(
  matrix: DOMMatrix,
  anchor: { x: number, y: number } = { x: 0, y: 0 }
): { x: number, y: number, rotation: number, scaleX: number, scaleY: number } {
  // To correctly decompose x/y when an anchor is involved:
  // M = T(x,y) * R(r) * S(sx,sy) * T(-ax,-ay)
  // We want to recover T(x,y). 
  // We can do this by multiplying M by the inverse of T(-ax,-ay) on the right.
  const m = new DOMMatrix().multiply(matrix);
  m.translateSelf(anchor.x, anchor.y);

  const x = m.e;
  const y = m.f;

  const rotation = Math.atan2(m.b, m.a) * (180 / Math.PI);
  const scaleX = Math.sqrt(m.a * m.a + m.b * m.b);

  // To handle negative scales, we look at the determinant
  const determinant = m.a * m.d - m.b * m.c;
  const scaleY = (determinant / scaleX) || 0;

  return {
    x: isNaN(x) ? 0 : x,
    y: isNaN(y) ? 0 : y,
    rotation: isNaN(rotation) ? 0 : rotation,
    scaleX: isNaN(scaleX) ? 1 : scaleX,
    scaleY: isNaN(scaleY) ? 1 : scaleY
  };
}