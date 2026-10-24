import { SceneNode } from '../state/sceneSlice';
import { getCollectiveBoundingBox } from './Matrix';

// Imported assets land centered in the artboard, scaled to fill this fraction of it,
// so they're clearly visible with a little breathing room. Users scale freely afterwards.
export const ARTBOARD_FIT_MARGIN = 0.8;

// A placeable import root: a node that sits at the top of the imported tree (no parent yet)
// and is not a comp artboard. Layered (precomp-mode) SVGs return [precomp, outerComp, ...layers];
// only the precomp is placeable — the comp artboard (refId target) and its layers are not.
const isPlaceable = (n: SceneNode) => !n.parentId && n.type !== 'artboard';

// Center an SVG import on the artboard and scale it to ARTBOARD_FIT_MARGIN of the artboard
// (both up and down — vectors stay crisp at any size). Mutates the imported nodes in place
// and parents the placeable root(s) to the artboard. Safe to call from every SVG-import path.
export function centerAndFitSvgImport(
  importedNodes: SceneNode[],
  artboardId: string,
  artboard: SceneNode | undefined,
  margin: number = ARTBOARD_FIT_MARGIN,
): void {
  const cx = artboard?.props.width ? (artboard.props.width as number) / 2 : 250;
  const cy = artboard?.props.height ? (artboard.props.height as number) / 2 : 250;

  const topIds = importedNodes.filter(isPlaceable).map(n => n.id);
  const nodesMap = new Map(importedNodes.map(n => [n.id, n]));
  // Prefer the SVG viewBox size (carried on the placeable root as _svgW/_svgH) so padding
  // inside the viewBox is respected; fall back to the rendered collective bounds.
  const svgRoot = importedNodes.find(isPlaceable);
  const bounds = svgRoot?.props?._svgW
    ? { x: 0, y: 0, width: svgRoot.props._svgW as number, height: svgRoot.props._svgH as number }
    : getCollectiveBoundingBox(topIds, nodesMap);

  const offsetX = cx - (bounds.x + bounds.width / 2);
  const offsetY = cy - (bounds.y + bounds.height / 2);

  // Bounds calc failed (e.g. paths with no measurable extent) — still parent so the
  // import appears on the artboard rather than vanishing.
  if (!isFinite(offsetX) || !isFinite(offsetY)) {
    importedNodes.forEach(n => { if (isPlaceable(n)) n.parentId = artboardId; });
    return;
  }

  importedNodes.forEach(n => {
    if (isPlaceable(n)) {
      n.parentId = artboardId;
      n.transform.x += offsetX;
      n.transform.y += offsetY;
    }
  });

  if (artboard?.props.width && artboard?.props.height && bounds.width > 0 && bounds.height > 0) {
    const scale = Math.min(
      ((artboard.props.width as number) * margin) / bounds.width,
      ((artboard.props.height as number) * margin) / bounds.height,
    );
    if (Math.abs(scale - 1) > 0.01) {
      importedNodes.forEach(n => {
        // After parenting above, the roots now have parentId === artboardId (isPlaceable is
        // false), so match on that. Inner comp layers keep their own parent and are untouched —
        // scaling the precomp root scales its rendered content for free.
        if (n.parentId === artboardId && n.type !== 'artboard') {
          n.transform.x = cx + (n.transform.x - cx) * scale;
          n.transform.y = cy + (n.transform.y - cy) * scale;
          n.transform.scaleX *= scale;
          n.transform.scaleY *= scale;
        }
      });
    }
  }
}

// Scale factor to fit a raster image of natural size (w×h) into ARTBOARD_FIT_MARGIN of the
// artboard. shrinkOnly (default) clamps to ≤1 so small images are never upscaled into blur —
// large images shrink to fit, small ones keep their native pixel size.
export function fitImageScale(
  naturalW: number,
  naturalH: number,
  artboard: SceneNode | undefined,
  margin: number = ARTBOARD_FIT_MARGIN,
  shrinkOnly: boolean = true,
): number {
  const aw = artboard?.props.width as number | undefined;
  const ah = artboard?.props.height as number | undefined;
  if (!aw || !ah || naturalW <= 0 || naturalH <= 0) return 1;
  let scale = Math.min((aw * margin) / naturalW, (ah * margin) / naturalH);
  if (shrinkOnly) scale = Math.min(1, scale);
  return scale;
}
