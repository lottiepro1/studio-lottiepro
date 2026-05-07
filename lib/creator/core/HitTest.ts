import { SceneNode } from '../state/sceneSlice';
import { getWorldMatrix, screenToLocal, getPathLocalBounds } from './Matrix';
import { AnimationUtils } from './Animation';

// Check if a point is inside a node
export function hitTestNode(
  node: SceneNode,
  screenX: number,
  screenY: number,
  nodes: Map<string, SceneNode>,
  currentTime?: number,
  rootId?: string
): boolean {
  if (!node.visible || node.locked) return false;

  // Temporal visibility check
  if (currentTime !== undefined) {
    if (currentTime < node.inPoint || currentTime > node.outPoint) return false;
  }

  // Get world matrix for this node, stopping at rootId if provided
  const worldMatrix = getWorldMatrix(node.id, nodes, currentTime, rootId);

  // Convert screen coordinates to local node space
  const local = screenToLocal(screenX, screenY, worldMatrix);

  // Check based on node type
  switch (node.type) {
    case 'rect':
      return hitTestRect(node, local.x, local.y, currentTime);
    case 'image':
      return hitTestRect(node, local.x, local.y, currentTime);
    case 'ellipse':
      return hitTestEllipse(node, local.x, local.y, currentTime);
    case 'path':
      return hitTestPath(node, local.x, local.y, currentTime);
    case 'text':
      return hitTestText(node, local.x, local.y, currentTime);
    case 'precomp':
      if (node.refId) {
        const refArtboard = nodes.get(node.refId);
        if (refArtboard) {
          const w = AnimationUtils.getPropertyValue(refArtboard, 'props.width', currentTime || 0) || 0;
          const h = AnimationUtils.getPropertyValue(refArtboard, 'props.height', currentTime || 0) || 0;
          return local.x >= 0 && local.x <= w && local.y >= 0 && local.y <= h;
        }
      }
      return false;
    case 'artboard':
      const aw = AnimationUtils.getPropertyValue(node, 'props.width', currentTime || 0) || 0;
      const ah = AnimationUtils.getPropertyValue(node, 'props.height', currentTime || 0) || 0;
      return local.x >= 0 && local.x <= aw && local.y >= 0 && local.y <= ah;
    default:
      return false;
  }
}

// Hit test for rectangle
function hitTestRect(node: SceneNode, localX: number, localY: number, currentTime: number = 0): boolean {
  const width = (AnimationUtils.getPropertyValue(node, 'props.width', currentTime) as number) || 0;
  const height = (AnimationUtils.getPropertyValue(node, 'props.height', currentTime) as number) || 0;
  return localX >= 0 && localX <= width && localY >= 0 && localY <= height;
}

// Hit test for ellipse
function hitTestEllipse(node: SceneNode, localX: number, localY: number, currentTime: number = 0): boolean {
  const radiusX = (AnimationUtils.getPropertyValue(node, 'props.radiusX', currentTime) as number) || 0;
  const radiusY = (AnimationUtils.getPropertyValue(node, 'props.radiusY', currentTime) as number) || 0;
  const centerX = radiusX;
  const centerY = radiusY;

  // Check if point is inside ellipse using equation
  const dx = localX - centerX;
  const dy = localY - centerY;
  return (dx * dx) / (radiusX * radiusX) + (dy * dy) / (radiusY * radiusY) <= 1;
}

// Hit test for path (using bounding box for now for simplicity)
function hitTestPath(node: SceneNode, localX: number, localY: number, currentTime: number = 0): boolean {
  const points = (AnimationUtils.getPropertyValue(node, 'props.points', currentTime) || []) as any[];
  if (!points || points.length === 0) return false;

  const bounds = getPathLocalBounds(points);
  const padding = 10;
  return localX >= bounds.x - padding && localX <= bounds.x + bounds.width + padding &&
    localY >= bounds.y - padding && localY <= bounds.y + bounds.height + padding;
}

// Hit test for text
function hitTestText(node: SceneNode, localX: number, localY: number, currentTime: number = 0): boolean {
  const text = (AnimationUtils.getPropertyValue(node, 'props.text', currentTime) as string) || '';
  const fontSize = (AnimationUtils.getPropertyValue(node, 'props.fontSize', currentTime) as number) || 24;
  const lineHeight = (AnimationUtils.getPropertyValue(node, 'props.lineHeight', currentTime) as number) || 1.2;
  const textAlign = (AnimationUtils.getPropertyValue(node, 'props.textAlign', currentTime) as string) || 'left';
  const verticalAlign = (AnimationUtils.getPropertyValue(node, 'props.verticalAlign', currentTime) as string) || 'top';

  const lines = text.split('\n');
  let maxChars = 0;
  lines.forEach((l: string) => maxChars = Math.max(maxChars, l.length));

  const width = maxChars * fontSize * 0.5;
  const height = lines.length * fontSize * lineHeight;

  let offsetX = 0;
  if (textAlign === 'center') offsetX = -width / 2;
  else if (textAlign === 'right') offsetX = -width;

  let offsetY = 0;
  if (verticalAlign === 'middle') offsetY = -height / 2;
  else if (verticalAlign === 'bottom') offsetY = -height;
  else if (verticalAlign === 'baseline') offsetY = -fontSize;

  return localX >= offsetX && localX <= offsetX + width && localY >= offsetY && localY <= offsetY + height;
}

// Find the node at a point (reverse order for z-index)
export function findNodeAtPoint(
  screenX: number,
  screenY: number,
  nodes: Map<string, SceneNode>,
  parentId: string | null,
  deep: boolean = true,
  currentTime?: number,
  rootId?: string
): string | null {
  if (!parentId) return null;

  const parent = nodes.get(parentId);
  if (!parent || !parent.visible || parent.locked) return null;

  // Temporal visibility check for parent
  if (currentTime !== undefined) {
    if (currentTime < parent.inPoint || currentTime > parent.outPoint) return null;
  }

  // Check children in reverse order (top to bottom)
  for (let i = parent.children.length - 1; i >= 0; i--) {
    const childId = parent.children[i];
    const child = nodes.get(childId);
    if (!child) continue;

    // Check children recursively first (groups or nested artboards)
    const hitId = findNodeAtPoint(screenX, screenY, nodes, childId, true, currentTime, rootId || parentId || undefined);

    if (hitId) {
      // If we are in "shallow" mode (deep=false), return the immediate child of the current parent
      if (!deep) return childId;
      // Otherwise, return the deepest hit
      return hitId;
    }

    if (child.type === 'precomp' && child.refId) {
      const precompHitId = findNodeAtPoint(screenX, screenY, nodes, child.refId, true, currentTime, child.refId);
      if (precompHitId) {
        if (!deep) return childId;
        return precompHitId;
      }
    }

    // Check if hit this node directly (for shapes)
    // IMPORTANT: We don't hit test 'artboard' nodes directly here.
    // Artboards are only selected via their labels in CanvasView.
    if (child.type !== 'artboard' && hitTestNode(child, screenX, screenY, nodes, currentTime, rootId || parentId || undefined)) {
      return childId;
    }
  }

  return null;
}

/**
 * Checks if a node and ALL its ancestors are visible and NOT locked.
 * This is used for marquee selection and other global operations.
 */
export function isNodeSelectable(nodeId: string, nodes: Map<string, SceneNode>): boolean {
  let curr: SceneNode | undefined = nodes.get(nodeId);
  while (curr) {
    if (!curr.visible || curr.locked) return false;
    if (!curr.parentId) break;
    curr = nodes.get(curr.parentId);
  }
  return true;
}