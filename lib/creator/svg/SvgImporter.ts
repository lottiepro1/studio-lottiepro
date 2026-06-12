/**
 * SVG Importer — clean rebuild.
 *
 * Architecture:
 *  • All geometry is emitted in SVG *viewport* space (viewBox units) by using
 *    the browser's getCTM() for every element. No manual matrix math.
 *  • Gradients carry a `transform` field (gradient-local → viewport) so the
 *    renderer can apply the clip+transform+fill technique, which correctly
 *    handles rotated/skewed/elliptical radials that Canvas2D cannot draw
 *    directly otherwise.
 *  • The whole import tree is wrapped in ONE root group. Navbar centers/scales
 *    that single node, eliminating the per-path jitter during resize/rotate.
 *  • Clip paths are stored as node.masks (VectorPoints), using the existing
 *    applyLayerMasks path in CanvasRenderer — no Path2D.addPath worker issues.
 */

import type {
  SceneNode,
  Style,
  Gradient,
  GradientStop,
  Effect,
} from '../state/sceneSlice';
import { VectorPoint } from '../tools/PenTool';
import { getPathLocalBounds } from '../core/Matrix';
import { AE_BLUR_TO_SIGMA } from '../core/Convert';

// ── Internal types ────────────────────────────────────────────────────────────

interface InheritedStyle {
  fill: string;
  stroke: string;
  fillOpacity: number;
  strokeOpacity: number;
  opacity: number;
  strokeWidth: number;
  fillRule: string;
  display: string;
  visibility: string;
}

const DEFAULT_STYLE: InheritedStyle = {
  fill: '#000000',
  stroke: 'none',
  fillOpacity: 1,
  strokeOpacity: 1,
  opacity: 1,
  strokeWidth: 1,
  fillRule: 'nonzero',
  display: 'inline',
  visibility: 'visible',
};

interface PathResult {
  points: VectorPoint[];
  closed: boolean;
  subPathLengths?: number[];
}

interface RawGradient {
  type: 'linear' | 'radial';
  gradientUnits: 'userSpaceOnUse' | 'objectBoundingBox';
  gradientTransform: DOMMatrix;
  spreadMethod: 'pad' | 'reflect' | 'repeat';
  stops: GradientStop[];
  // linear
  x1: number; y1: number; x2: number; y2: number;
  // radial
  cx: number; cy: number; r: number; fx: number; fy: number;
}

interface Bbox { x: number; y: number; w: number; h: number; }

const SKIP_TAGS = new Set([
  'defs', 'style', 'metadata', 'title', 'desc',
  'lineargradient', 'radialgradient', 'filter',
  'clippath', 'mask', 'symbol',
]);

const SHAPE_TAGS = new Set([
  'path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line',
]);

// Layered (precomp) import mode — set per-import in importFromString. When true,
// clip-paths/masks are NOT baked into geometry; they are recorded on the owning
// group as matte shapes and re-emitted as editable matte-source layers, so a
// crisp matte edge survives even when the matted content is blurred. Triggered by
// the presence of Gaussian-blur filters (which force layer-level rendering).
let _layeredMode = false;

// Per-import sequence counter for generating unique layer names when SVG elements have no id.
// Reset at the start of each importFromString call so names are stable across re-imports.
let _nameSeq = 0;

// ── Public API ────────────────────────────────────────────────────────────────

export class SvgImporter {
  static async parseClipboard(
    clipboardData: DataTransfer,
    duration = 100000,
  ): Promise<SceneNode[]> {
    const html = clipboardData.getData('text/html');
    let svgString = '';
    const m = html.match(/<svg[\s\S]*?<\/svg>/i);
    if (m) {
      svgString = m[0];
    } else {
      const xml = clipboardData.getData('image/svg+xml');
      if (xml) svgString = xml;
      else {
        const plain = clipboardData.getData('text/plain');
        if (plain?.trim().startsWith('<svg')) svgString = plain;
      }
    }
    return svgString ? this.importFromString(svgString, duration) : [];
  }

  static async importFromString(
    svgString: string,
    duration = 100000,
  ): Promise<SceneNode[]> {
    if (typeof window === 'undefined') return [];

    const host = document.createElement('div');
    Object.assign(host.style, {
      position: 'absolute', top: '0', left: '0',
      width: '2000px', height: '2000px',
      opacity: '0', pointerEvents: 'none', overflow: 'hidden',
      zIndex: '-9999',
    });
    document.body.appendChild(host);
    host.innerHTML = svgString;

    const svgEl = host.querySelector('svg') as SVGSVGElement | null;
    if (!svgEl) { document.body.removeChild(host); return []; }

    // Pin to viewBox dimensions so getCTM returns viewport-space coords (0…vbW).
    const vb = svgEl.viewBox?.baseVal;
    const vbW = (vb && vb.width > 0) ? vb.width : (parseFloat(svgEl.getAttribute('width') || '500'));
    const vbH = (vb && vb.height > 0) ? vb.height : (parseFloat(svgEl.getAttribute('height') || '500'));
    svgEl.setAttribute('width', String(vbW));
    svgEl.setAttribute('height', String(vbH));

    // Layered (precomp) mode triggers:
    //  • Blur filters — effects only work on Lottie LAYERS, so each shape must be a layer.
    //  • Any referenced clip-path/mask — imported as EDITABLE matte layers (LottieFiles
    //    behavior) instead of being destructively baked into geometry/pixels.
    // Detection scans for actual *references* on rendered elements (attribute or inline
    // style), not just <clipPath>/<mask> defs — unused defs must not change the structure.
    const hasBlur = !!svgEl.querySelector('feGaussianBlur');
    // A ref only counts if its def actually EXISTS — optimizer-stripped SVGs keep
    // dangling clip-path="url(#…)" attributes that browsers ignore (render unclipped);
    // they must not flip the whole import into layered/precomp mode.
    const refResolves = (id: string | null): boolean => {
      if (!id) return false;
      try { return !!svgEl.querySelector(`#${CSS.escape(id)}`); }
      catch { return !!svgEl.querySelector(`[id="${id}"]`); }
    };
    const hasMatteRefs = !hasBlur && Array.from(svgEl.querySelectorAll('*')).some(e =>
      !e.closest('defs, clipPath, mask, symbol, filter') &&
      (refResolves(getClipRef(e as SVGElement)) || refResolves(getMaskRef(e as SVGElement))),
    );
    _layeredMode = hasBlur || hasMatteRefs;
    _nameSeq = 0;

    try {
      const gradients = parseGradients(svgEl);
      const filters   = parseFilters(svgEl);
      const clipDefs  = parseClipDefs(svgEl);
      const symbols   = parseSymbols(svgEl);

      const nodes: SceneNode[] = [];
      const rootId = makeId('root');

      // Root group — all children go inside this so Navbar centering operates on
      // the whole import as a single unit (fixes resize/rotate jitter).
      const rootGroup: SceneNode = {
        id: rootId,
        name: 'svg',
        type: 'group',
        parentId: null,
        children: [],
        // NOTE: no anchorAlignX/Y here. When set, getAnimatedAnchor RECOMPUTES the
        // anchor from content bounds, which generally differs from the viewBox center
        // and silently shifts the whole import. The stored anchor (viewBox center,
        // which Toolbar/Navbar centering math assumes) must stay authoritative.
        transform: {
          x: vbW / 2, y: vbH / 2, rotation: 0, scaleX: 1, scaleY: 1,
          anchorX: vbW / 2, anchorY: vbH / 2,
          scaleLink: true,
        },
        style: { opacity: 1, fillType: 'solid', strokeType: 'solid', fillVisible: false, strokeWidth: 0 },
        props: { _svgW: vbW, _svgH: vbH },
        visible: true, locked: false, inPoint: 0, outPoint: duration, startTime: 0,
      };
      nodes.push(rootGroup);

      for (const child of Array.from(svgEl.children)) {
        const tag = child.tagName.toLowerCase();
        if (['defs', 'style', 'metadata', 'title', 'desc'].includes(tag)) continue;
        await walkEl(
          child as SVGElement, rootId, nodes, svgEl,
          gradients, filters, clipDefs, symbols, DEFAULT_STYLE, duration,
        );
      }

      rootGroup.children = nodes.filter(n => n.parentId === rootId).map(n => n.id);

      // Layered (precomp) mode: when the SVG uses per-shape blur filters, a flat group
      // can't carry them (Lottie/ThorVG only honor effects on LAYERS). Re-emit the
      // import as a precomp whose internal comp holds each shape as its own layer, so
      // blur and editable mattes work. Plain SVGs keep the flat path.
      if (_layeredMode) {
        return buildPrecompFromFlat(nodes, vbW, vbH, duration);
      }

      return nodes;
    } finally {
      document.body.removeChild(host);
    }
  }
}

// A viewBox-sized comp artboard (an "asset" reached via a precomp's refId).
function makeCompArtboard(id: string, name: string, vbW: number, vbH: number, duration: number, childIds: string[]): SceneNode {
  return {
    id, name, type: 'artboard', parentId: null, children: childIds,
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, anchorX: 0, anchorY: 0, scaleLink: true },
    style: { opacity: 1 },
    props: { width: vbW, height: vbH, duration, frameRate: 60, transparent: true },
    visible: true, locked: false, inPoint: 0, outPoint: duration, startTime: 0,
  };
}

// A precomp node referencing a comp artboard. `placeable` = the single top-level node
// the entry points center/scale on canvas (carries _svgW/_svgH, anchored at viewBox
// center). Non-placeable inner precomps render their comp 1:1 (identity, anchor 0).
function makePrecompNode(
  id: string, name: string, parentId: string | null, refId: string, vbW: number, vbH: number,
  duration: number, placeable: boolean,
): SceneNode {
  return {
    id, name, type: 'precomp', parentId, refId, children: [],
    transform: placeable
      ? { x: vbW / 2, y: vbH / 2, rotation: 0, scaleX: 1, scaleY: 1, anchorX: vbW / 2, anchorY: vbH / 2, scaleLink: true }
      : { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, anchorX: 0, anchorY: 0, scaleLink: true },
    style: { opacity: 1 },
    props: placeable
      ? { _svgW: vbW, _svgH: vbH, width: vbW, height: vbH }
      : { width: vbW, height: vbH },
    visible: true, locked: false, inPoint: 0, outPoint: duration, startTime: 0,
  };
}

// Convert a flat import (root group + nested groups + leaf shapes) into a precomp:
//   placeable precomp (placed on the user's artboard) → OUTER comp → layers.
// Leaves with NO matte become layers directly in the outer comp. Leaves that share a
// clip/mask are grouped into an INNER comp and clipped by ONE editable matte-source
// layer (track matte over the inner precomp), exactly like LottieLab/AE — so a single
// silhouette edits the whole group and stays crisp over blurred content (ThorVG-probed).
// Reuses everything the flat import computed (geometry, gradients, normalized anchors).
function buildPrecompFromFlat(
  nodes: SceneNode[], vbW: number, vbH: number, duration: number,
): SceneNode[] {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const outerCompId = makeId('comp');

  // Effects live on ancestor groups (e.g. <g filter=blur>); move them onto the leaf
  // layer so the exporter emits them at layer level. Opacity is already folded into
  // each leaf's style by resolveInheritedStyle, so only effects need collecting.
  const ancestorEffects = (leaf: SceneNode): Effect[] => {
    const fx: Effect[] = [];
    let cur = leaf.parentId ? byId.get(leaf.parentId) : undefined;
    while (cur) {
      if (cur.style.effects?.length) fx.push(...cur.style.effects);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return fx;
  };

  // Matte shape for a leaf (recorded in layered mode):
  //  • paths — the leaf's OWN clip wins, then the closest ancestor group's;
  //  • images — own props ONLY (the image branch picks the outermost chain clip as the
  //    editable matte and pixel-bakes the rest; inheriting an ancestor matte here would
  //    double-clip).
  type MatteInfo = { points: VectorPoint[]; matteType: number; subPathLengths?: number[] };
  const matteOf = (leaf: SceneNode): MatteInfo | null => {
    const p = leaf.props as any;
    if (p?._matteShapePoints) {
      return { points: p._matteShapePoints, matteType: p._matteType ?? 1, subPathLengths: p._matteSubPathLengths };
    }
    if (leaf.type === 'image') return null;
    let cur = leaf.parentId ? byId.get(leaf.parentId) : undefined;
    while (cur) {
      const cp = cur.props as any;
      if (cp?._matteShapePoints) {
        return { points: cp._matteShapePoints, matteType: cp._matteType ?? 1, subPathLengths: cp._matteSubPathLengths };
      }
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return null;
  };

  // Mattes are bucketed by GEOMETRY (not by owning element): exporters like
  // Illustrator/Figma duplicate the same clip path under many def ids — identical
  // silhouettes must merge into ONE shared editable Mask layer (LottieFiles structure,
  // ThorVG-probed: one matte serves many non-adjacent layers via tp).
  const matteKey = (m: MatteInfo): string => {
    const f = (v: number | undefined) => (v === undefined ? '' : v.toFixed(2));
    return m.matteType + '|' + (m.subPathLengths?.join(',') ?? '') + '|' +
      m.points.map(p => `${f(p.x)},${f(p.y)},${f(p.inX)},${f(p.inY)},${f(p.outX)},${f(p.outY)}`).join(';');
  };

  // First pass: prepare each leaf (effects lifted from ancestor groups), wire mattes.
  // Leaves keep strict DOCUMENT ORDER (bottom→top z-order); matte-source layers are
  // appended at the END (top). tp links don't require adjacency (probed), and reordering
  // leaves around matte buckets would permute the painting order of overlapping shapes.
  const layers: SceneNode[] = []; // direct children of the (single) comp
  const matteNodes = new Map<string, SceneNode>();
  let maskCount = 0;
  for (const n of nodes) {
    if (n.type !== 'path' && n.type !== 'image') continue;
    const fx = [...(n.style.effects || []), ...ancestorEffects(n)];
    const matte = matteOf(n);
    n.props = { ...n.props, isLayer: true };
    // Strip internal matte-capture props — consumed here, must not leak into the layer.
    delete (n.props as any)._matteShapePoints;
    delete (n.props as any)._matteType;
    delete (n.props as any)._matteSubPathLengths;
    if (fx.length > 0) n.style = { ...n.style, effects: fx };
    n.parentId = outerCompId;
    if (matte) {
      const key = matteKey(matte);
      let matteNode = matteNodes.get(key);
      if (!matteNode) {
        matteNode = makeMattePath(matte, outerCompId, duration);
        // Unique names: ThorVG getLayerBoundingBox / hit testing look up layers by NAME
        // and skip duplicates, so multiple mattes must not all be called "Mask".
        maskCount++;
        if (maskCount > 1) matteNode.name = `Mask ${maskCount}`;
        matteNode.matteTargetIds = [];
        matteNodes.set(key, matteNode);
      }
      n.matteSourceId = matteNode.id;
      n.matteType = matte.matteType;
      matteNode.matteTargetIds!.push(n.id);
    }
    layers.push(n);
  }
  // Matte sources after all leaves → after the exporter's reversal they sit on top.
  for (const matteNode of matteNodes.values()) layers.push(matteNode);

  // Normalize tiny viewBoxes. The editor renders an artboard at its own pixel size, so
  // a 16×15 comp looks low-res when you zoom into it to edit. Scale the comp + content
  // up to a reasonable size (LottieLab/LottieFiles do the same). We scale each layer's
  // TRANSFORM (position + scale) — never its points/gradients/blur — so geometry,
  // gradient placement and blur all scale together for free and the on-screen result
  // (including blur amount, once the placeable precomp scales back down) is identical.
  const maxDim = Math.max(vbW, vbH);
  const S = maxDim > 0 && maxDim < 512 ? 512 / maxDim : 1;
  if (S !== 1) {
    for (const l of layers) {
      l.transform.x *= S; l.transform.y *= S;
      l.transform.scaleX *= S; l.transform.scaleY *= S;
    }
  }
  const cw = vbW * S, ch = vbH * S;

  const outerComp = makeCompArtboard(outerCompId, 'svg', cw, ch, duration, layers.map(l => l.id));
  const precomp = makePrecompNode(makeId('precomp'), 'svg', null, outerCompId, cw, ch, duration, true);

  return [precomp, outerComp, ...layers];
}

// Build a matte-source path layer from clip/mask points (viewport space). Follows the
// native path convention: points normalized around the shape center, transform.x/y at
// the center, anchor 0. Solid fill so it has alpha/luma for the matte; visible:false
// (renderer skips matte sources, exporter keeps them as td:1 layers).
function makeMattePath(
  matte: { points: VectorPoint[]; matteType: number; subPathLengths?: number[] },
  compId: string, duration: number,
): SceneNode {
  const lb = getPathLocalBounds(matte.points);
  const cx = lb.x + lb.width / 2;
  const cy = lb.y + lb.height / 2;
  const pts = matte.points.map(p => ({ ...p, x: p.x - cx, y: p.y - cy }));
  const props: Record<string, any> = { points: pts, closed: true, isLayer: true };
  if (matte.subPathLengths) props.subPathLengths = matte.subPathLengths;
  return {
    id: makeId('matte'), name: 'Mask', type: 'path', parentId: compId, children: [],
    transform: { x: cx, y: cy, rotation: 0, scaleX: 1, scaleY: 1, anchorX: 0, anchorY: 0, scaleLink: true },
    // Luma mattes (tt:3) clip by LUMINANCE — fill must be white (black would clip
    // everything to nothing). Alpha mattes only use coverage; color is irrelevant.
    style: { opacity: 1, fillType: 'solid', strokeType: 'solid', fillVisible: true, fill: matte.matteType === 3 ? '#ffffff' : '#000000', strokeWidth: 0 },
    visible: false, locked: false, inPoint: 0, outPoint: duration, startTime: 0,
    props,
  };
}

// ── DOM walk ──────────────────────────────────────────────────────────────────

async function walkEl(
  el: SVGElement,
  parentId: string,
  nodes: SceneNode[],
  svgRoot: SVGSVGElement,
  gradients: Map<string, RawGradient>,
  filters: Map<string, Effect[]>,
  clipDefs: Map<string, SVGElement>,
  symbols: Map<string, SVGElement>,
  parentStyle: InheritedStyle,
  duration: number,
  clip: any = null, // inherited clip region as a Paper.js item in viewport space
  ctxCTM: DOMMatrix | null = null, // extra transform context (from <use> expansion)
  // <use> elements whose expansion we are inside. A defs-resident target's DOM ancestors
  // carry no clips — the clips that actually apply live on the use SITE and its ancestors,
  // so layered-mode clip-chain resolution must consult these elements too.
  useSiteEls: SVGElement[] = [],
): Promise<void> {
  const tag = el.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return;

  const elStyle = resolveInheritedStyle(el, parentStyle);
  if (elStyle.display === 'none' || elStyle.visibility === 'hidden') return;

  // ── <use> expansion ────────────────────────────────────────────────────────
  if (tag === 'use') {
    const href = el.getAttribute('xlink:href') || el.getAttribute('href') || '';
    const targetId = href.startsWith('#') ? href.slice(1) : '';
    const target = targetId ? (svgRoot.querySelector(`#${CSS.escape(targetId)}`) as SVGElement | null) : null;
    if (target) {
      // The referenced element renders in the <use>'s coordinate context: the use's
      // own CTM plus its x/y attributes. The target usually lives in <defs> (its own
      // CTM walk yields only its local transform), so compose the context explicitly.
      const useCTM = computeElementCTM(el, svgRoot);
      const ux = pf(el, 'x', 0), uy = pf(el, 'y', 0);
      let composed = ctxCTM ? ctxCTM.multiply(useCTM) : useCTM;
      if (ux !== 0 || uy !== 0) composed = composed.multiply(new DOMMatrix([1, 0, 0, 1, ux, uy]));
      await walkEl(target, parentId, nodes, svgRoot, gradients, filters, clipDefs, symbols, elStyle, duration, clip, composed, [...useSiteEls, el]);
    }
    return;
  }

  // ── <g> / nested <svg> groups ──────────────────────────────────────────────
  if (tag === 'g' || tag === 'svg') {
    const id = makeId('g');
    const fxEffects = resolveFilterEffects(el, filters);

    // Clip-path AND <mask>: bake into geometry via Paper.js boolean intersection so
    // the clip survives every pipeline (Canvas2D, ThorVG/Lottie export — Lottie only
    // supports masks at the LAYER level, so masks on nested groups would be dropped
    // there). resolveClipMasks remains a mask-based fallback when Paper can't help.
    let childClip = clip;
    let masks: any[] = [];
    let matteData: { points: VectorPoint[]; matteType: number; subPathLengths?: number[] } | null = null;
    if (getClipRef(el) || getMaskRef(el)) {
      if (_layeredMode) {
        // Layered mode: capture the clip/mask as a matte shape (don't bake) so it can
        // become an editable matte-source layer clipping the blurred content crisply.
        matteData = extractMatteForElement(el, svgRoot);
      } else {
        childClip = resolveElementClip(el, svgRoot, clip);
        if (childClip === clip && getClipRef(el)) {
          masks = resolveClipMasks(el, svgRoot, clipDefs);
        }
      }
    }

    const groupNode: SceneNode = {
      id,
      name: el.getAttribute('id') || el.getAttribute('inkscape:label') || 'g',
      type: 'group',
      parentId,
      children: [],
      // No anchorAlignX/Y: imported groups must be transform-NEUTRAL (identity).
      // With align set, the anchor gets recomputed to the group's content center c,
      // turning the matrix into T(0,0)·T(−c) — which re-centers the content at the
      // group origin and destroys its true position (each sibling subtree would
      // collapse toward (0,0) independently).
      transform: {
        x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1,
        anchorX: 0, anchorY: 0,
        scaleLink: true,
      },
      style: {
        opacity: elStyle.opacity,
        fillType: 'solid', strokeType: 'solid', fillVisible: false, strokeWidth: 0,
        ...(fxEffects.length > 0 ? { effects: fxEffects } : {}),
      },
      visible: true, locked: false, inPoint: 0, outPoint: duration, startTime: 0,
      ...(masks.length > 0 ? { masks } : {}),
      // Layered-mode matte shape (consumed by buildPrecompFromFlat to wire mattes).
      ...(matteData ? {
        props: {
          _matteShapePoints: matteData.points,
          _matteType: matteData.matteType,
          _matteSubPathLengths: matteData.subPathLengths,
        },
      } : {}),
    };
    nodes.push(groupNode);

    for (const child of Array.from(el.children)) {
      await walkEl(
        child as SVGElement, id, nodes, svgRoot,
        gradients, filters, clipDefs, symbols, elStyle, duration, childClip, ctxCTM, useSiteEls,
      );
    }
    groupNode.children = nodes.filter(n => n.parentId === id).map(n => n.id);
    // Free any clip item created at this level (inherited clips belong to ancestors)
    if (childClip && childClip !== clip) childClip.remove();
    return;
  }

  // ── Shape elements ─────────────────────────────────────────────────────────
  if (SHAPE_TAGS.has(tag)) {
    const ownCTM = computeElementCTM(el, svgRoot);
    const mat = ctxCTM ? ctxCTM.multiply(ownCTM) : ownCTM;

    const d = getPathD(el, tag);
    if (!d) return;

    // A shape can carry its own clip-path/mask in addition to the inherited one.
    // In layered mode, clips are not baked (they become matte layers), so skip here.
    const shapeClip = (!_layeredMode && (getClipRef(el) || getMaskRef(el)))
      ? resolveElementClip(el, svgRoot, clip) : clip;
    const result = pathDToPoints(d, mat, shapeClip);
    if (shapeClip && shapeClip !== clip) shapeClip.remove();
    if (result.points.length === 0) return;

    // Layered mode: a clip/mask sitting directly ON the shape element becomes the
    // shape's own matte (group-level clips are captured on the group node instead).
    // Without this, shape-level clips would be silently dropped in layered mode.
    // Limitation: if the shape ALSO inherits a group matte, its own clip wins
    // (buildPrecompFromFlat picks the nearest); combined clips are not intersected.
    let shapeMatte: { points: VectorPoint[]; matteType: number; subPathLengths?: number[] } | null = null;
    if (_layeredMode && (getClipRef(el) || getMaskRef(el))) {
      shapeMatte = extractMatteForElement(el, svgRoot);
    }

    // Use TIGHT curve bounds (same function getAnimatedAnchor uses) so the
    // recomputed anchor (anchorAlign 0.5 → bounds center) lands exactly at the
    // stored anchor (0,0) after normalization. Tight bounds are also what the SVG
    // spec defines as the objectBoundingBox for gradients.
    const lb = getPathLocalBounds(result.points);
    const cx = lb.x + lb.width / 2;
    const cy = lb.y + lb.height / 2;
    const vpBbox: Bbox = { x: lb.x, y: lb.y, w: lb.width, h: lb.height };

    const style = buildStyle(el, elStyle, gradients, filters, mat, vpBbox, cx, cy);

    // Skip fully-invisible shapes (e.g. SVG spacer rects like <path d="M1 1h22v22H1z"
    // fill="none"/>). They render nothing but would otherwise pollute the layer list and
    // the layer bounding box. A shape is invisible only if it has no fill, no stroke and
    // no effects — gradient fills set fillType='gradient', so those are kept.
    const hasFill = style.fillVisible || style.fillType === 'gradient';
    const hasStroke = (style.strokeWidth || 0) > 0;
    const hasEffects = !!(style.effects && style.effects.length > 0);
    if (!hasFill && !hasStroke && !hasEffects) return;

    // Normalize to the engine's native path convention (see PenTool.finalize):
    // points are centered around (0,0), transform.x/y = shape center, anchor = 0.
    // LottieExporter/ThorVG hard-code this convention, so absolute points would
    // render displaced by their own center.
    const points = result.points.map(p => ({ ...p, x: p.x - cx, y: p.y - cy }));

    const props: Record<string, any> = {
      points,
      closed: result.closed,
    };
    if (result.subPathLengths) props.subPathLengths = result.subPathLengths;
    if (shapeMatte) {
      props._matteShapePoints = shapeMatte.points;
      props._matteType = shapeMatte.matteType;
      props._matteSubPathLengths = shapeMatte.subPathLengths;
    }

    nodes.push({
      id: makeId(tag),
      name: el.getAttribute('id') || `${tag} ${++_nameSeq}`,
      type: 'path',
      parentId,
      children: [],
      transform: {
        x: cx, y: cy, rotation: 0, scaleX: 1, scaleY: 1,
        anchorX: 0, anchorY: 0, anchorAlignX: 0.5, anchorAlignY: 0.5,
        scaleLink: true,
      },
      style,
      visible: true, locked: false, inPoint: 0, outPoint: duration, startTime: 0,
      props,
    });
    return;
  }

  // ── <image> elements (raster content, e.g. gradient bitmaps in logos) ──────
  if (tag === 'image') {
    const href = el.getAttribute('xlink:href') || el.getAttribute('href') || '';
    if (!href) return;
    const ix = pf(el, 'x', 0), iy = pf(el, 'y', 0);
    const iw = pf(el, 'width', 0), ih = pf(el, 'height', 0);
    if (iw <= 0 || ih <= 0) return;

    const ownCTM = computeElementCTM(el, svgRoot);
    const mat = ctxCTM ? ctxCTM.multiply(ownCTM) : ownCTM;

    // Decompose the CTM into position/rotation/scale (skew is dropped — raster
    // placements in practice use translate+scale, occasionally rotate).
    const scaleX = Math.hypot(mat.a, mat.b) || 1;
    const det = mat.a * mat.d - mat.b * mat.c;
    const scaleY = (det / scaleX) || 1;
    const rotation = Math.atan2(mat.b, mat.a) * 180 / Math.PI;
    const center = new DOMPoint(ix + iw / 2, iy + ih / 2).matrixTransform(mat);

    const imgNode: SceneNode = {
      id: makeId('image'),
      name: el.getAttribute('id') || `image ${++_nameSeq}`,
      type: 'image',
      parentId,
      children: [],
      transform: {
        x: center.x, y: center.y, rotation, scaleX, scaleY,
        // Stored anchor must equal the recomputed one (alignX 0.5 → w/2, h/2) so
        // every consumer agrees regardless of whether it recomputes.
        anchorX: iw / 2, anchorY: ih / 2, anchorAlignX: 0.5, anchorAlignY: 0.5,
        scaleLink: true,
      },
      style: { opacity: elStyle.opacity, fillType: 'solid', strokeType: 'solid', fillVisible: false, strokeWidth: 0 },
      props: { src: href, width: iw, height: ih },
      visible: true, locked: false, inPoint: 0, outPoint: duration, startTime: 0,
    };

    // Raster content can't be boolean-clipped, so clips are baked into the image's
    // pixels at native resolution — renders identically in every pipeline.
    //
    // Layered mode (ThorVG-probed: tt/td/tp work over image layers, incl. one matte
    // shared by many non-adjacent layers): the OUTERMOST clip in the effective chain
    // becomes an EDITABLE matte layer (it's the meaningful silhouette, e.g. the logo
    // shape — matches LottieLab). The inner clips (typically per-slice crop rects from
    // the export tool) plus the image's own clip stay pixel-baked.
    //
    // The effective chain must follow the RENDER path, not the raw DOM: a <use>-expanded
    // image lives in <defs> whose ancestors carry no clips — the applying clips sit on
    // the use SITE(s) and their ancestors. Order: outermost use-site chain first, the
    // target's own chain last.
    let imgClip: any;        // region to BAKE into pixels
    let imgMatte: { points: VectorPoint[]; matteType: number; subPathLengths?: number[] } | null = null;
    if (_layeredMode) {
      const chainOf = (leafEl: SVGElement): SVGElement[] => {
        const chain: SVGElement[] = [];
        let cur: SVGElement | null = leafEl;
        while (cur && cur !== (svgRoot as unknown as SVGElement)) {
          if (getClipRef(cur) || getMaskRef(cur)) chain.push(cur);
          cur = cur.parentElement as SVGElement | null;
        }
        return chain.reverse(); // outermost first
      };
      const clipOwners: SVGElement[] = [];
      for (const siteEl of useSiteEls) clipOwners.push(...chainOf(siteEl));
      clipOwners.push(...chainOf(el));

      imgClip = null;
      if (clipOwners.length > 0) {
        imgMatte = extractMatteForElement(clipOwners[0], svgRoot);
        // If matte extraction failed (soft mask etc.), bake the whole chain instead.
        const bakeList = imgMatte ? clipOwners.slice(1) : clipOwners;
        for (const owner of bakeList) {
          const next = resolveElementClip(owner, svgRoot, imgClip);
          if (next !== imgClip && imgClip) imgClip.remove();
          imgClip = next;
        }
      }
      if (imgMatte) {
        imgNode.props._matteShapePoints = imgMatte.points;
        imgNode.props._matteType = imgMatte.matteType;
        imgNode.props._matteSubPathLengths = imgMatte.subPathLengths;
      }
    } else {
      imgClip = (getClipRef(el) || getMaskRef(el)) ? resolveElementClip(el, svgRoot, clip) : clip;
    }
    if (imgClip) {
      const matInv = safeInverse(mat);
      const subpaths = matInv ? clipToLocalSubpaths(imgClip, matInv) : [];
      if (subpaths.length > 0) {
        const baked = await bakeClipIntoImage(href, iw, ih, subpaths);
        if (baked) {
          imgNode.props.src = baked;
        } else {
          // Fallback: vector masks (best effort if pixel-baking is unavailable)
          const masks = clipItemToMasks(imgClip, imgNode);
          if (masks.length > 0) (imgNode as any).masks = masks;
        }
      }
    }
    if (imgClip && imgClip !== clip) imgClip.remove();
    nodes.push(imgNode);
    return;
  }

  // ── Unknown element — try walking children ─────────────────────────────────
  if (el.children && el.children.length > 0) {
    for (const child of Array.from(el.children)) {
      await walkEl(
        child as SVGElement, parentId, nodes, svgRoot,
        gradients, filters, clipDefs, symbols, elStyle, duration, clip, ctxCTM, useSiteEls,
      );
    }
  }
}

// ── Style building ────────────────────────────────────────────────────────────

function buildStyle(
  el: SVGElement,
  elStyle: InheritedStyle,
  gradients: Map<string, RawGradient>,
  filters: Map<string, Effect[]>,
  elementCTM: DOMMatrix,
  vpBbox: Bbox,
  centerX = 0,
  centerY = 0,
): Style {
  const style: Style = {
    opacity: elStyle.opacity,
    fillType: 'solid',
    strokeType: 'solid',
    fillVisible: elStyle.fill !== 'none' && !!elStyle.fill,
    strokeWidth: (elStyle.stroke !== 'none' && elStyle.stroke) ? elStyle.strokeWidth : 0,
    fillRule: (elStyle.fillRule === 'evenodd' ? 'evenodd' : 'nonzero') as any,
  };

  // Fill
  if (elStyle.fill && elStyle.fill !== 'none') {
    const urlId = extractUrlId(elStyle.fill);
    if (urlId && gradients.has(urlId)) {
      style.fillType = 'gradient';
      style.fillGradient = resolveGradient(gradients.get(urlId)!, elementCTM, vpBbox, centerX, centerY);
    } else if (!urlId) {
      style.fill = normalizeColor(elStyle.fill);
      if (elStyle.fillOpacity < 1) {
        style.fillOpacity = elStyle.fillOpacity;
      }
    } else {
      style.fillVisible = false; // url ref not found
    }
  }

  // Stroke
  if (elStyle.stroke && elStyle.stroke !== 'none') {
    const urlId = extractUrlId(elStyle.stroke);
    if (urlId && gradients.has(urlId)) {
      style.strokeType = 'gradient';
      style.strokeGradient = resolveGradient(gradients.get(urlId)!, elementCTM, vpBbox, centerX, centerY);
    } else if (!urlId) {
      style.stroke = normalizeColor(elStyle.stroke);
    }
    style.strokeWidth = elStyle.strokeWidth;
    if (elStyle.strokeOpacity < 1) style.strokeOpacity = elStyle.strokeOpacity;
  }

  const fxEffects = resolveFilterEffects(el, filters);
  if (fxEffects.length > 0) style.effects = fxEffects;

  return style;
}

function resolveInheritedStyle(el: SVGElement, parent: InheritedStyle): InheritedStyle {
  const css = parseInlineStyle(el.getAttribute('style') || '');

  const get = (name: string, fallback: string): string => {
    const v = css.get(name);
    if (v && v !== 'inherit') return v;
    const a = el.getAttribute(name);
    if (a && a !== 'inherit') return a;
    return fallback;
  };
  const getNum = (name: string, fallback: number): number => {
    const v = get(name, String(fallback));
    const n = parseFloat(v);
    return isNaN(n) ? fallback : n;
  };

  const opacity = getNum('opacity', 1) * parent.opacity;

  return {
    fill: get('fill', parent.fill),
    stroke: get('stroke', parent.stroke),
    fillOpacity: getNum('fill-opacity', parent.fillOpacity),
    strokeOpacity: getNum('stroke-opacity', parent.strokeOpacity),
    opacity,
    strokeWidth: getNum('stroke-width', parent.strokeWidth),
    fillRule: get('fill-rule', parent.fillRule),
    display: get('display', parent.display),
    visibility: get('visibility', parent.visibility),
  };
}

// ── Gradient parsing & resolution ─────────────────────────────────────────────

function parseGradients(svgRoot: Element): Map<string, RawGradient> {
  const rawEls = new Map<string, Element>();
  svgRoot.querySelectorAll('linearGradient, radialGradient').forEach(el => {
    const id = el.getAttribute('id');
    if (id) rawEls.set(id, el);
  });

  const result = new Map<string, RawGradient>();
  rawEls.forEach((_, id) => {
    try {
      const raw = resolveRawGradient(id, rawEls, 0);
      if (raw) result.set(id, raw);
    } catch { /* skip malformed */ }
  });
  return result;
}

function resolveRawGradient(id: string, rawEls: Map<string, Element>, depth: number): RawGradient | null {
  if (depth > 8) return null;
  const el = rawEls.get(id);
  if (!el) return null;

  // Inherit from href target
  const href = el.getAttribute('xlink:href') || el.getAttribute('href') || '';
  let base: RawGradient | null = null;
  if (href.startsWith('#')) base = resolveRawGradient(href.slice(1), rawEls, depth + 1);

  const tag = el.tagName.toLowerCase();
  const type: 'linear' | 'radial' = tag === 'radialgradient' ? 'radial' : 'linear';
  const gradientUnits = (el.getAttribute('gradientUnits') || base?.gradientUnits || 'objectBoundingBox') as RawGradient['gradientUnits'];
  const spreadMethod  = (el.getAttribute('spreadMethod')  || base?.spreadMethod  || 'pad') as RawGradient['spreadMethod'];

  const tAttr = el.getAttribute('gradientTransform') || '';
  const gradientTransform = tAttr ? parseDOMMatrix(tAttr) : (base?.gradientTransform ?? new DOMMatrix());

  // Stops: own element first, fallback to href
  let stops = parseGradientStops(el);
  if (stops.length === 0 && base) stops = base.stops;
  if (stops.length === 0) stops = [
    { offset: 0, color: '#000000', opacity: 0 },
    { offset: 1, color: '#000000', opacity: 0 },
  ];

  const isOBB = gradientUnits === 'objectBoundingBox';

  if (type === 'linear') {
    return {
      type, gradientUnits, gradientTransform, spreadMethod, stops,
      x1: parseGradAttr(el, 'x1', base?.x1 ?? 0),
      y1: parseGradAttr(el, 'y1', base?.y1 ?? 0),
      x2: parseGradAttr(el, 'x2', base?.x2 ?? (isOBB ? 1 : 0)),
      y2: parseGradAttr(el, 'y2', base?.y2 ?? 0),
      cx: 0.5, cy: 0.5, r: 0.5, fx: 0.5, fy: 0.5,
    };
  } else {
    const cx = parseGradAttr(el, 'cx', base?.cx ?? 0.5);
    const cy = parseGradAttr(el, 'cy', base?.cy ?? 0.5);
    const r  = parseGradAttr(el, 'r',  base?.r  ?? (isOBB ? 0.5 : 0));
    const fxAttr = el.getAttribute('fx');
    const fyAttr = el.getAttribute('fy');
    const fx = fxAttr ? parseGradAttr(el, 'fx', cx) : (base?.fx ?? cx);
    const fy = fyAttr ? parseGradAttr(el, 'fy', cy) : (base?.fy ?? cy);
    return {
      type, gradientUnits, gradientTransform, spreadMethod, stops,
      x1: 0, y1: 0, x2: 1, y2: 0,
      cx, cy, r, fx, fy,
    };
  }
}

function resolveGradient(raw: RawGradient, elementCTM: DOMMatrix, vpBbox: Bbox, centerX = 0, centerY = 0): Gradient {
  let transform: DOMMatrix;

  if (raw.gradientUnits === 'userSpaceOnUse') {
    // cx/cy/r are in the element's user coordinate system.
    // gradient-local → user space: via gradientTransform
    // user space → viewport: via elementCTM
    transform = elementCTM.multiply(raw.gradientTransform);
  } else {
    // objectBoundingBox: [0,1]×[0,1] → viewport bbox → gradientTransform on top.
    // We compose: translate(vpBbox.x,y) * scale(vpBbox.w,h) * gradientTransform
    if (vpBbox.w > 0 && vpBbox.h > 0) {
      const bboxM = new DOMMatrix([vpBbox.w, 0, 0, vpBbox.h, vpBbox.x, vpBbox.y]);
      transform = bboxM.multiply(raw.gradientTransform);
    } else {
      transform = raw.gradientTransform;
    }
  }

  // Path points are normalized around the shape center (native convention), so
  // node-local space = viewport space shifted by (-centerX, -centerY). Shift the
  // gradient (which is in viewport space) into node-local space to match.
  if (centerX !== 0 || centerY !== 0) {
    transform = new DOMMatrix([1, 0, 0, 1, -centerX, -centerY]).multiply(transform);
  }

  const m: number[] = [transform.a, transform.b, transform.c, transform.d, transform.e, transform.f];

  if (raw.type === 'linear') {
    return {
      type: 'linear',
      start: { x: raw.x1, y: raw.y1 },
      end:   { x: raw.x2, y: raw.y2 },
      stops: raw.stops,
      units: raw.gradientUnits,
      transform: m,
      spread: raw.spreadMethod,
    };
  } else {
    return {
      type: 'radial',
      start: { x: raw.cx, y: raw.cy },
      end:   { x: raw.cx, y: raw.cy },
      focal: { x: raw.fx, y: raw.fy },
      radius: raw.r,
      stops: raw.stops,
      units: raw.gradientUnits,
      transform: m,
      spread: raw.spreadMethod,
    };
  }
}

function parseGradientStops(el: Element): GradientStop[] {
  const stops: GradientStop[] = [];
  el.querySelectorAll('stop').forEach(s => {
    const css = parseInlineStyle(s.getAttribute('style') || '');
    const rawOffset = s.getAttribute('offset') || '0';
    let offset = parseFloat(rawOffset);
    if (rawOffset.endsWith('%')) offset /= 100;
    const color   = css.get('stop-color')   || s.getAttribute('stop-color')   || '#000000';
    const opacity = css.get('stop-opacity') || s.getAttribute('stop-opacity') || '1';
    stops.push({
      offset:  isNaN(offset) ? 0 : Math.max(0, Math.min(1, offset)),
      color:   normalizeColor(color),
      opacity: isNaN(parseFloat(opacity)) ? 1 : Math.max(0, Math.min(1, parseFloat(opacity))),
    });
  });
  return stops;
}

function parseGradAttr(el: Element, name: string, fallback: number): number {
  const v = el.getAttribute(name);
  if (!v) return fallback;
  const n = parseFloat(v);
  return v.endsWith('%') ? n / 100 : (isNaN(n) ? fallback : n);
}

// ── Filter parsing ────────────────────────────────────────────────────────────

function parseFilters(svgRoot: Element): Map<string, Effect[]> {
  const map = new Map<string, Effect[]>();
  svgRoot.querySelectorAll('filter').forEach(filterEl => {
    const id = filterEl.getAttribute('id');
    if (!id) return;
    const effects: Effect[] = [];
    filterEl.querySelectorAll('feGaussianBlur').forEach(b => {
      const std = parseFloat(b.getAttribute('stdDeviation') || '0');
      // SVG stdDeviation IS the Gaussian sigma; Effect.blur is AE Blurriness
      // (ThorVG sigma = blurriness * 0.3) — convert or every blur renders ~3.3× too weak.
      if (std > 0) effects.push({ id: `blur_${id}`, type: 'blur', name: 'Gaussian Blur', visible: true, blur: std / AE_BLUR_TO_SIGMA });
    });
    filterEl.querySelectorAll('feDropShadow').forEach(ds => {
      const dx = parseFloat(ds.getAttribute('dx') || '0');
      const dy = parseFloat(ds.getAttribute('dy') || '0');
      const std = parseFloat(ds.getAttribute('stdDeviation') || '0');
      const flood = ds.getAttribute('flood-color') || '#000000';
      const opacity = parseFloat(ds.getAttribute('flood-opacity') || '1');
      const distance = Math.sqrt(dx * dx + dy * dy);
      const direction = (Math.atan2(dy, dx) * 180 / Math.PI) + 90;
      effects.push({
        id: `shadow_${id}`, type: 'shadow', name: 'Drop Shadow', visible: true,
        blur: std / AE_BLUR_TO_SIGMA, color: normalizeColor(flood), opacity, distance, direction,
      });
    });
    if (effects.length > 0) map.set(id, effects);
  });
  return map;
}

function resolveFilterEffects(el: SVGElement, filterMap: Map<string, Effect[]>): Effect[] {
  const id = extractUrlId(el.getAttribute('filter') || '');
  return (id && filterMap.has(id)) ? filterMap.get(id)! : [];
}

// ── Clip path handling ────────────────────────────────────────────────────────

function parseClipDefs(svgRoot: Element): Map<string, SVGElement> {
  const map = new Map<string, SVGElement>();
  svgRoot.querySelectorAll('clipPath').forEach(cp => {
    const id = cp.getAttribute('id');
    if (id) map.set(id, cp as SVGElement);
  });
  return map;
}

function parseSymbols(svgRoot: Element): Map<string, SVGElement> {
  const map = new Map<string, SVGElement>();
  svgRoot.querySelectorAll('symbol').forEach(s => {
    const id = s.getAttribute('id');
    if (id) map.set(id, s as SVGElement);
  });
  return map;
}

// clip-path may be specified as an XML attribute OR inside the style attribute
// (e.g. style="clip-path:url(#a);" — common in Illustrator/brandlogos exports).
function getClipRef(el: SVGElement): string | null {
  const direct = el.getAttribute('clip-path');
  if (direct) {
    const id = extractUrlId(direct);
    if (id) return id;
  }
  const css = parseInlineStyle(el.getAttribute('style') || '');
  const styleClip = css.get('clip-path');
  if (styleClip) {
    const id = extractUrlId(styleClip);
    if (id) return id;
  }
  return null;
}

// mask="url(#id)" — also possible via the style attribute.
function getMaskRef(el: SVGElement): string | null {
  const direct = el.getAttribute('mask');
  if (direct) {
    const id = extractUrlId(direct);
    if (id) return id;
  }
  const css = parseInlineStyle(el.getAttribute('style') || '');
  const styleMask = css.get('mask');
  if (styleMask) {
    const id = extractUrlId(styleMask);
    if (id) return id;
  }
  return null;
}

// Is a mask child a "keep" shape for clip conversion? Alpha masks keep any opaque
// fill; luminance masks (the SVG default) keep only light fills (white = visible).
function maskChildKeeps(child: SVGElement, maskType: string): boolean {
  const css = parseInlineStyle(child.getAttribute('style') || '');
  const fill = css.get('fill') || child.getAttribute('fill') || '#000000';
  if (fill === 'none') return false;
  if (maskType === 'alpha') return true;
  const hex = normalizeColor(fill);
  const m = hex.match(/^#([0-9a-fA-F]{6})/);
  if (!m) return false; // gradients/transparent in masks — can't convert, be conservative
  const v = parseInt(m[1], 16);
  const luma = (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
  return luma > 0.5;
}

function safeInverse(m: DOMMatrix): DOMMatrix | null {
  try { return m.inverse(); } catch { return null; }
}

// Convert a Paper.js clip item (viewport space) into a set of bezier subpaths in a
// target local space, given the inverse of that space's local→viewport matrix.
// Returns VectorPoint[][] (one entry per subpath), handles kept relative to anchors.
function clipToLocalSubpaths(clipItem: any, matInv: DOMMatrix): VectorPoint[][] {
  const linear = (vx: number, vy: number) => ({ x: matInv.a * vx + matInv.c * vy, y: matInv.b * vx + matInv.d * vy });
  const kids: any[] = (clipItem.children && clipItem.children.length > 0) ? clipItem.children : [clipItem];
  const out: VectorPoint[][] = [];
  for (const k of kids) {
    if (!k.segments || k.segments.length === 0) continue;
    const pts = extractPaperSegments(k).map(p => {
      const x = matInv.a * p.x + matInv.c * p.y + matInv.e;
      const y = matInv.b * p.x + matInv.d * p.y + matInv.f;
      const hi = linear(p.inX, p.inY);
      const ho = linear(p.outX, p.outY);
      return { x, y, inX: hi.x, inY: hi.y, outX: ho.x, outY: ho.y };
    });
    if (pts.length > 0) out.push(pts);
  }
  return out;
}

// Bake a clip region (given as bezier subpaths in image-local pixel space,
// 0..iw × 0..ih) into the image's alpha channel at native resolution. Returns a
// PNG data URL of the pre-clipped image, or null if loading/encoding failed
// (e.g. a cross-origin source that would taint the canvas).
async function bakeClipIntoImage(
  href: string, iw: number, ih: number, subpaths: VectorPoint[][],
): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  try {
    const img = new Image();
    // NOTE: do NOT set crossOrigin for data: URLs — it can mark them cross-origin
    // and taint the canvas, making toDataURL() throw. Only needed for http(s) srcs.
    if (!href.startsWith('data:')) img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('image load failed'));
      img.src = href;
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(iw));
    canvas.height = Math.max(1, Math.round(ih));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    // Keep only the pixels inside the clip region.
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = '#000';
    ctx.beginPath();
    for (const pts of subpaths) {
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 0; i < pts.length; i++) {
        const cur = pts[i];
        const next = pts[(i + 1) % pts.length];
        ctx.bezierCurveTo(
          cur.x + cur.outX, cur.y + cur.outY,
          next.x + next.inX, next.y + next.inY,
          next.x, next.y,
        );
      }
      ctx.closePath();
    }
    ctx.fill();
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

// Vector-mask fallback (used only when pixel-baking is unavailable). Builds layer
// masks in an image node's local space ((0,0)..(width,height), anchored at center).
function clipItemToMasks(clipItem: any, node: SceneNode): any[] {
  const t = node.transform;
  const w = (node.props.width as number) || 0;
  const h = (node.props.height as number) || 0;
  let local = new DOMMatrix();
  local = local.translate(t.x, t.y).rotate(t.rotation).scale(t.scaleX, t.scaleY).translate(-w / 2, -h / 2);
  const inv = safeInverse(local);
  if (!inv) return [];
  return clipToLocalSubpaths(clipItem, inv).map(pts => ({
    mode: 'a',
    style: { opacity: 1, fillType: 'solid', strokeType: 'solid', fillVisible: true, strokeWidth: 0 },
    props: { points: pts, closed: true },
  }));
}

function resolveClipMasks(
  el: SVGElement,
  svgRoot: SVGSVGElement,
  clipDefs: Map<string, SVGElement>,
): any[] {
  const cpId = getClipRef(el);
  if (!cpId) return [];

  let cpEl: SVGElement | null = null;
  try { cpEl = svgRoot.querySelector(`#${CSS.escape(cpId)}`) as SVGElement | null; }
  catch { cpEl = svgRoot.querySelector(`[id="${cpId}"]`) as SVGElement | null; }
  if (!cpEl) return [];

  // "userSpaceOnUse" (default): SVG applies an element's transform BEFORE its
  // clip-path, so clip coordinates live in the referencing element's own
  // post-transform user space → map by el's full CTM (plus any transform attribute
  // on the clip shape itself).
  // clipPathUnits="objectBoundingBox": coords are 0..1 fractions of the element bbox
  // (rare; fall back to identity as an approximation).
  const clipPathUnits = cpEl.getAttribute('clipPathUnits') || 'userSpaceOnUse';
  const baseCTM = computeElementCTM(el, svgRoot);

  // Convert each shape in the clipPath to VectorPoints
  const maskParts: VectorPoint[][] = [];
  for (const child of Array.from(cpEl.children)) {
    const tag = child.tagName.toLowerCase();
    const d = getPathD(child as SVGElement, tag);
    if (!d) continue;
    const tAttr = child.getAttribute('transform');
    const clipMat = clipPathUnits === 'userSpaceOnUse'
      ? (tAttr ? baseCTM.multiply(parseDOMMatrix(tAttr)) : baseCTM)
      : new DOMMatrix();
    const result = pathDToPoints(d, clipMat);
    if (result.points.length > 0) maskParts.push(result.points);
  }
  if (maskParts.length === 0) return [];

  // Flatten all clip shapes into one mask (union via consecutive subpaths)
  const allPoints = maskParts.flat();
  const subPathLengths = maskParts.length > 1 ? maskParts.map(p => p.length) : undefined;

  const maskProps: Record<string, any> = { points: allPoints, closed: true };
  if (subPathLengths) maskProps.subPathLengths = subPathLengths;

  return [{
    mode: 'a',
    style: { opacity: 1, fillType: 'solid', strokeType: 'solid', fillVisible: true, strokeWidth: 0 },
    props: maskProps,
  }];
}

// ── SVG path d-string from element type ───────────────────────────────────────

function getPathD(el: SVGElement, tag: string): string | null {
  switch (tag) {
    case 'path':
      return el.getAttribute('d');

    case 'rect': {
      const x  = pf(el, 'x', 0),  y  = pf(el, 'y', 0);
      const w  = pf(el, 'width', 0), h = pf(el, 'height', 0);
      if (w <= 0 || h <= 0) return null;
      let rx = Math.min(pf(el, 'rx', pf(el, 'ry', 0)), w / 2);
      let ry = Math.min(pf(el, 'ry', pf(el, 'rx', 0)), h / 2);
      if (rx === 0 || ry === 0) return `M${x},${y}H${x+w}V${y+h}H${x}Z`;
      return `M${x+rx},${y}H${x+w-rx}A${rx},${ry},0,0,1,${x+w},${y+ry}`
           + `V${y+h-ry}A${rx},${ry},0,0,1,${x+w-rx},${y+h}`
           + `H${x+rx}A${rx},${ry},0,0,1,${x},${y+h-ry}`
           + `V${y+ry}A${rx},${ry},0,0,1,${x+rx},${y}Z`;
    }

    case 'circle': {
      const cx = pf(el, 'cx', 0), cy = pf(el, 'cy', 0), r = pf(el, 'r', 0);
      if (r <= 0) return null;
      return `M${cx-r},${cy}A${r},${r},0,1,1,${cx+r},${cy}A${r},${r},0,1,1,${cx-r},${cy}Z`;
    }

    case 'ellipse': {
      const cx = pf(el, 'cx', 0), cy = pf(el, 'cy', 0);
      const rx = pf(el, 'rx', 0), ry = pf(el, 'ry', 0);
      if (rx <= 0 || ry <= 0) return null;
      return `M${cx-rx},${cy}A${rx},${ry},0,1,1,${cx+rx},${cy}A${rx},${ry},0,1,1,${cx-rx},${cy}Z`;
    }

    case 'polygon': {
      const pts = splitPoints(el.getAttribute('points') || '');
      if (pts.length < 4) return null;
      return 'M' + pts[0] + ',' + pts[1] + pts.slice(2).reduce(
        (acc, v, i) => acc + (i % 2 === 0 ? 'L' + v : ',' + v), '',
      ) + 'Z';
    }

    case 'polyline': {
      const pts = splitPoints(el.getAttribute('points') || '');
      if (pts.length < 4) return null;
      return 'M' + pts[0] + ',' + pts[1] + pts.slice(2).reduce(
        (acc, v, i) => acc + (i % 2 === 0 ? 'L' + v : ',' + v), '',
      );
    }

    case 'line': {
      const x1 = pf(el,'x1',0), y1 = pf(el,'y1',0), x2 = pf(el,'x2',0), y2 = pf(el,'y2',0);
      return `M${x1},${y1}L${x2},${y2}`;
    }

    default:
      return null;
  }
}

function splitPoints(s: string): string[] {
  return s.trim().split(/[\s,]+/).filter(Boolean);
}

function pf(el: SVGElement, name: string, fallback: number): number {
  const v = parseFloat(el.getAttribute(name) || '');
  return isNaN(v) ? fallback : v;
}

// ── SVG element transform (manual DOM walk) ───────────────────────────────────
// More reliable than getCTM() which can return null for off-screen / hidden elements.
// Walks up the DOM from el to svgRoot, accumulating transform attributes.

function computeElementCTM(el: SVGElement, svgRoot: SVGSVGElement): DOMMatrix {
  const matrices: DOMMatrix[] = [];
  let current: Element | null = el;
  while (current && current !== (svgRoot as Element)) {
    const t = (current as Element).getAttribute('transform');
    if (t) matrices.unshift(parseDOMMatrix(t));
    current = current.parentElement;
  }
  return matrices.reduce((acc, m) => acc.multiply(m), new DOMMatrix());
}

// ── Path d → VectorPoints (Paper.js) ─────────────────────────────────────────
// Paper.js handles all SVG commands (A, S, T, Q, H, V, Z, compound paths)
// internally, including correct arc-to-bezier and smooth bezier reflection.

let _paperScope: any = null;

function getPaperScope(): any {
  if (typeof window === 'undefined') return null;
  if (!_paperScope) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const paperCore = require('paper/dist/paper-core') as any;
      const scope = new paperCore.PaperScope();
      // Use a real canvas element — more reliable than Size-based headless setup
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      scope.setup(canvas);
      _paperScope = scope;
    } catch {
      return null;
    }
  }
  return _paperScope;
}

function extractPaperSegments(paperPath: any): VectorPoint[] {
  return (paperPath.segments as any[]).map((seg: any) => ({
    x: seg.point.x as number,
    y: seg.point.y as number,
    inX: seg.handleIn.x as number,
    inY: seg.handleIn.y as number,
    outX: seg.handleOut.x as number,
    outY: seg.handleOut.y as number,
  }));
}

// Build a Paper.js item (in viewport space) for a <clipPath> OR <mask> def
// referenced by `el`. SVG applies an element's `transform` BEFORE its clip/mask,
// so userSpaceOnUse coordinates live in el's own post-transform user space → map
// by el's full CTM (computeElementCTM includes el's own transform attribute).
// Masks are converted geometrically: alpha masks keep all opaque shapes,
// luminance masks keep light-filled shapes (see maskChildKeeps). Soft masks
// (gradients/blur inside the mask) cannot be represented and return null.
function buildClipDefItem(defId: string, el: SVGElement, svgRoot: SVGSVGElement): any | null {
  const scope = getPaperScope();
  if (!scope) return null;

  let defEl: SVGElement | null = null;
  try { defEl = svgRoot.querySelector(`#${CSS.escape(defId)}`) as SVGElement | null; }
  catch { defEl = svgRoot.querySelector(`[id="${defId}"]`) as SVGElement | null; }
  if (!defEl) return null;

  const defTag = defEl.tagName.toLowerCase();
  let maskType = '';
  if (defTag === 'clippath') {
    // objectBoundingBox clip coords depend on each clipped element's bbox — can't
    // be baked as one region; let the mask fallback handle it.
    if ((defEl.getAttribute('clipPathUnits') || 'userSpaceOnUse') !== 'userSpaceOnUse') return null;
  } else if (defTag === 'mask') {
    if ((defEl.getAttribute('maskContentUnits') || 'userSpaceOnUse') !== 'userSpaceOnUse') return null;
    const css = parseInlineStyle(defEl.getAttribute('style') || '');
    maskType = (css.get('mask-type') || defEl.getAttribute('mask-type') || 'luminance').trim();
  } else {
    return null;
  }

  const baseCTM = computeElementCTM(el, svgRoot);
  let combined: any = null;
  try {
    for (const child of Array.from(defEl.children)) {
      const tag = child.tagName.toLowerCase();
      const d = getPathD(child as SVGElement, tag);
      if (!d) continue;
      if (defTag === 'mask' && !maskChildKeeps(child as SVGElement, maskType)) continue;
      const tAttr = child.getAttribute('transform');
      const mat = tAttr ? baseCTM.multiply(parseDOMMatrix(tAttr)) : baseCTM;
      let item: any;
      try { item = new scope.CompoundPath(d); } catch { continue; }
      item.transform(new scope.Matrix(mat.a, mat.b, mat.c, mat.d, mat.e, mat.f));
      if (!combined) {
        combined = item;
      } else {
        // Multiple shapes in a clipPath/mask union together
        const united = combined.unite(item, { insert: false });
        combined.remove();
        item.remove();
        combined = united;
      }
    }
  } catch {
    combined?.remove();
    return null;
  }
  return combined;
}

// Resolve an element's own clip-path AND mask into a combined Paper.js region,
// intersected with the inherited one. Returns the inherited item unchanged when
// the element adds nothing (callers must free the result only if it differs).
function resolveElementClip(el: SVGElement, svgRoot: SVGSVGElement, inherited: any): any {
  let result = inherited;
  for (const ref of [getClipRef(el), getMaskRef(el)]) {
    if (!ref) continue;
    const item = buildClipDefItem(ref, el, svgRoot);
    if (!item) continue;
    if (result) {
      let merged: any = null;
      try { merged = result.intersect(item, { insert: false }); } catch { /* keep current */ }
      item.remove();
      if (merged) {
        if (result !== inherited) result.remove();
        result = merged;
      }
    } else {
      result = item;
    }
  }
  return result;
}

// Layered-mode counterpart to resolveElementClip: instead of a Paper.js region for
// baking, return the clip/mask geometry as VectorPoints (viewport space) plus the
// matte type, to be emitted as an editable matte-source layer.
//   matteType: 1 = alpha (clipPaths, mask-type:alpha), 3 = luma (default SVG masks).
function extractMatteForElement(
  el: SVGElement, svgRoot: SVGSVGElement,
): { points: VectorPoint[]; matteType: number; subPathLengths?: number[] } | null {
  const maskRef = getMaskRef(el);
  const ref = maskRef || getClipRef(el);
  if (!ref) return null;
  const item = buildClipDefItem(ref, el, svgRoot);
  if (!item) return null;

  const subs: any[] = (item.children && item.children.length > 0) ? item.children : [item];
  const points: VectorPoint[] = [];
  const subPathLengths: number[] = [];
  for (const k of subs) {
    if (!k.segments || k.segments.length === 0) continue;
    const pts = extractPaperSegments(k);
    if (pts.length === 0) continue;
    points.push(...pts);
    subPathLengths.push(pts.length);
  }
  item.remove();
  if (points.length === 0) return null;

  let matteType = 1; // clipPath behaves like an alpha matte
  if (maskRef) {
    let def: SVGElement | null = null;
    try { def = svgRoot.querySelector(`#${CSS.escape(maskRef)}`) as SVGElement | null; }
    catch { def = svgRoot.querySelector(`[id="${maskRef}"]`) as SVGElement | null; }
    if (def) {
      const mt = (parseInlineStyle(def.getAttribute('style') || '').get('mask-type')
        || def.getAttribute('mask-type') || 'luminance').trim();
      matteType = mt === 'alpha' ? 1 : 3;
    }
  }
  return { points, matteType, subPathLengths: subPathLengths.length > 1 ? subPathLengths : undefined };
}

function pathDToPoints(d: string, worldTransform: DOMMatrix, clip?: any): PathResult {
  if (!d) return { points: [], closed: false };

  const scope = getPaperScope();
  if (!scope) return { points: [], closed: false };
  let item: any;
  try {
    item = new scope.CompoundPath(d);
  } catch {
    return { points: [], closed: false };
  }

  let target: any = item;
  try {
    item.transform(new scope.Matrix(
      worldTransform.a, worldTransform.b,
      worldTransform.c, worldTransform.d,
      worldTransform.e, worldTransform.f,
    ));

    // Bake an inherited clip-path region into the geometry (boolean intersection).
    // Only meaningful for closed (fillable) geometry; open strokes stay unclipped.
    if (clip) {
      const subpaths: any[] = item.children?.length ? item.children : [item];
      const allClosed = subpaths.every((p: any) => p.closed);
      if (allClosed) {
        try {
          const clipped = item.intersect(clip, { insert: false });
          if (clipped) target = clipped;
        } catch { /* keep unclipped geometry */ }
      }
    }

    // Normalize: boolean results may be a plain Path (no children) or a CompoundPath
    const kids: any[] = (target.children && target.children.length > 0)
      ? target.children
      : ((target.segments && target.segments.length > 0) ? [target] : []);
    if (kids.length === 0) return { points: [], closed: false };

    if (kids.length === 1) {
      const path = kids[0];
      const points = extractPaperSegments(path);
      if (points.length === 0) return { points: [], closed: false };
      return { points, closed: path.closed as boolean };
    }

    // Multiple subpaths
    const allPoints: VectorPoint[] = [];
    const subPathLengths: number[] = [];
    let isClosed = false;
    for (const path of kids) {
      const pts = extractPaperSegments(path);
      if (pts.length === 0) continue;
      allPoints.push(...pts);
      subPathLengths.push(pts.length);
      if (path.closed) isClosed = true;
    }
    if (allPoints.length === 0) return { points: [], closed: false };
    return { points: allPoints, closed: isClosed, subPathLengths };
  } finally {
    if (target && target !== item) target.remove();
    item.remove();
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function normalizeColor(c: string): string {
  if (!c || c === 'none' || c === 'transparent') return 'rgba(0,0,0,0)';
  c = c.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(c))
    return '#' + c[1]+c[1]+c[2]+c[2]+c[3]+c[3];
  if (/^#[0-9a-fA-F]{6,8}$/.test(c)) return c;

  const rgbMatch = c.match(/^rgba?\(\s*([^)]+)\)/i);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(/[\s,/]+/).map(s => s.trim());
    const r = Math.round(Math.min(255, parseFloat(parts[0]) * (parts[0].endsWith('%') ? 2.55 : 1)));
    const g = Math.round(Math.min(255, parseFloat(parts[1]) * (parts[1].endsWith('%') ? 2.55 : 1)));
    const b = Math.round(Math.min(255, parseFloat(parts[2]) * (parts[2].endsWith('%') ? 2.55 : 1)));
    const a = parts[3] !== undefined ? parseFloat(parts[3]) : 1;
    const hex = '#' + [r, g, b].map(v => Math.max(0, v).toString(16).padStart(2, '0')).join('');
    return a >= 1 ? hex : `rgba(${r},${g},${b},${a.toFixed(3)})`;
  }

  // Named colors — delegate to browser via a hidden canvas trick
  try {
    const ctx2 = document.createElement('canvas').getContext('2d')!;
    ctx2.fillStyle = c;
    const filled = ctx2.fillStyle;
    if (filled && filled !== '#000000' || c.toLowerCase() === 'black') return filled;
  } catch {}
  return '#000000';
}

function extractUrlId(s: string): string | null {
  const m = s?.match(/url\(["']?#([^"')]+)["']?\)/);
  return m ? m[1] : null;
}

function parseInlineStyle(s: string): Map<string, string> {
  const m = new Map<string, string>();
  s.split(';').forEach(d => {
    const i = d.indexOf(':');
    if (i < 0) return;
    m.set(d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).trim());
  });
  return m;
}

// Parse an SVG transform list into a DOMMatrix. We must NOT delegate to the CSS
// DOMMatrix(string) constructor: SVG transforms are UNITLESS (e.g.
// `translate(.29 .14) scale(.15)`), but CSS `translate()` requires length units,
// so the CSS parser throws on them and silently yields identity. We parse each
// transform function ourselves and compose via post-multiplication (left-to-right
// in the list = applied right-to-left to the geometry, per the SVG spec).
function parseDOMMatrix(s: string): DOMMatrix {
  let m = new DOMMatrix();
  if (!s) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(s)) !== null) {
    const fn = match[1];
    const args = match[2].trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
    switch (fn) {
      case 'matrix':
        if (args.length === 6) m = m.multiply(new DOMMatrix(args));
        break;
      case 'translate':
        m = m.translate(args[0] || 0, args[1] || 0);
        break;
      case 'scale':
        m = m.scale(args[0] ?? 1, args[1] ?? args[0] ?? 1);
        break;
      case 'rotate':
        if (args.length >= 3) m = m.translate(args[1], args[2]).rotate(args[0] || 0).translate(-args[1], -args[2]);
        else m = m.rotate(args[0] || 0);
        break;
      case 'skewX':
        m = m.skewX(args[0] || 0);
        break;
      case 'skewY':
        m = m.skewY(args[0] || 0);
        break;
    }
  }
  return m;
}

let _idCounter = 0;
function makeId(prefix: string): string {
  return `${prefix}_${++_idCounter}_${Math.random().toString(36).slice(2, 7)}`;
}
