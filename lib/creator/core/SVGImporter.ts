import {
  SceneNode,
  Transform,
  Style,
  Gradient,
  GradientStop,
  Effect,
} from "../state/sceneSlice";
import { VectorPoint } from "../tools/PenTool";
import { decomposeMatrix } from "./Matrix";

export class SVGImporter {
  private static paper: any = null;

  private static async initPaper() {
    if (this.paper || typeof window === "undefined") return;
    // Dynamically import to avoid SSR build errors with Node.js dependencies
    const p = await import("paper/dist/paper-core");
    this.paper = p.default || p;

    // Setup hidden paper context
    const canvas = document.createElement("canvas");
    this.paper.setup(canvas);
  }

  static async parseClipboard(
    clipboardData: DataTransfer,
    duration: number = 100000,
  ): Promise<SceneNode[]> {
    const html = clipboardData.getData("text/html");
    let svgString = "";

    const svgMatch = html.match(/<svg[\s\S]*?<\/svg>/i);
    if (svgMatch) {
      svgString = svgMatch[0];
    } else {
      const svgXml = clipboardData.getData("image/svg+xml");
      if (svgXml) {
        svgString = svgXml;
      } else {
        const plainText = clipboardData.getData("text/plain");
        if (plainText && plainText.trim().startsWith("<svg")) {
          svgString = plainText;
        }
      }
    }

    if (!svgString) return [];
    return this.importFromString(svgString, duration);
  }

  static async importFromString(
    svgString: string,
    duration: number = 100000,
  ): Promise<SceneNode[]> {
    if (typeof window === "undefined") return [];
    await this.initPaper();
    if (!this.paper) return [];

    // Clear previous project state
    this.paper.project.clear();

    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, "image/svg+xml");
    const svgElement = doc.querySelector("svg");
    if (!svgElement) return [];

    const filtersMap = this.parseFilters(svgElement);
    const cssStyles = this.parseStyleBlocks(svgElement);

    // Import into Paper.js project
    const rootItem = this.paper.project.importSVG(svgString, {
      expandShapes: true,
      insert: false,
      applyMatrix: true,
    });

    // Ensure all child items also have their matrices baked into geometry
    const bakeTransforms = (item: any) => {
      if (item.applyMatrix !== undefined) item.applyMatrix = true;
      if (item.children) {
        [...item.children].forEach(bakeTransforms);
      }
    };
    bakeTransforms(rootItem);

    const nodes: SceneNode[] = [];
    // Pre-filter: Remove invisible/metadata items that cause bounding box inflation
    // (Like the invisible 500x500 rect often found in SVGs)
    const cleanup = (item: any) => {
      if (!item.visible || item.data?.isDefs) {
        if (item.remove) item.remove();
        return;
      }
      if (
        item.className === "Shape" ||
        item.className === "Path" ||
        item.className === "CompoundPath"
      ) {
        const hasVisuals = item.fillColor || item.strokeColor;
        if (!hasVisuals && (!item.children || item.children.length === 0)) {
          if (item.remove) item.remove();
          return;
        }
      }
      if (item.children) {
        [...item.children].forEach(cleanup);
      }
    };
    cleanup(rootItem);

    // Map to SceneNodes
    [...rootItem.children].forEach((child) => {
      this.mapItemToNodes(child, null, nodes, filtersMap, cssStyles, duration);
    });

    return nodes;
  }

  private static mapItemToNodes(
    item: any,
    parentId: string | null,
    nodes: SceneNode[],
    filtersMap: Map<string, Effect[]>,
    cssStyles: Map<string, Map<string, string>>,
    duration: number = 100000,
  ) {
    if (!item || item.data?.isDefs) return;

    const tagName =
      item._tagName || (item.className === "Group" ? "g" : "path");
    if (tagName === "defs" || tagName === "style" || tagName === "metadata")
      return;

    const id = `${tagName}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const name = item.name || tagName;

    // Since we used applyMatrix: true, item.matrix is identity,
    // and item.bounds are already in "Clean" coordinates.
    const localBounds = item.bounds;

    let cx = localBounds.x + localBounds.width / 2;
    let cy = localBounds.y + localBounds.height / 2;

    // Fallback for empty groups or nodes
    if (!isFinite(cx)) cx = 0;
    if (!isFinite(cy)) cy = 0;

    // Visual coordinates for the center of the node in the parent's coordinate space
    // (Since children were optimized/baked, parent space is the same "Clean" space)
    const transform: Transform = {
      x: cx,
      y: cy,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      anchorX: cx,
      anchorY: cy,
      anchorAlignX: 0.5,
      anchorAlignY: 0.5,
      scaleLink: true,
    };

    const node: SceneNode = {
      id,
      name,
      type: "group" as any,
      parentId,
      children: [],
      transform,
      style: this.extractStyle(item, filtersMap),
      visible: item.visible,
      locked: item.locked,
      inPoint: 0,
      outPoint: duration,
      startTime: 0,
      props: {
        clipping: item.clipMask || false,
      },
    };

    if (item.className === "Path" || item.className === "CompoundPath") {
      node.type = "path";
      const points: VectorPoint[] = [];

      if (item.className === "Path") {
        item.segments.forEach((seg: any) => {
          points.push({
            x: seg.point.x,
            y: seg.point.y,
            inX: seg.handleIn.x,
            inY: seg.handleIn.y,
            outX: seg.handleOut.x,
            outY: seg.handleOut.y,
          });
        });
        node.props.closed = item.closed;
      } else {
        const subLengths: number[] = [];
        item.children.forEach((child: any) => {
          if (child.className === "Path") {
            subLengths.push(child.segments.length);
            child.segments.forEach((seg: any) => {
              points.push({
                x: seg.point.x,
                y: seg.point.y,
                inX: seg.handleIn.x,
                inY: seg.handleIn.y,
                outX: seg.handleOut.x,
                outY: seg.handleOut.y,
              });
            });
          }
        });
        node.props.subPathLengths = subLengths;
        node.props.closed = true;
      }
      node.props.points = points;
    } else if (item.className === "Raster") {
      node.type = "image" as any;
      node.props.url = item.source;
      node.props.width = item.width;
      node.props.height = item.height;
    } else if (item.className === "Group") {
      node.type = "group";
    }

    // Handle Masking
    if (item.clipMask) {
      (item as any)._isClipMask = true;
    }

    nodes.push(node);

    if (item.children) {
      [...item.children].forEach((child) => {
        this.mapItemToNodes(child, id, nodes, filtersMap, cssStyles, duration);
      });
      node.children = nodes
        .filter((n) => n.parentId === node.id)
        .map((n) => n.id);
    }
  }

  private static extractStyle(
    item: any,
    filtersMap: Map<string, Effect[]>,
  ): Style {
    const style: Style = {
      opacity: item.opacity,
      fillType: "solid",
      strokeType: "solid",
      fillVisible: !!item.fillColor,
      strokeWidth: item.strokeColor ? (item.strokeWidth ?? 1) : 0,
    };

    if (item.fillColor) {
      if (item.fillColor.gradient) {
        style.fillType = "gradient";
        style.fillGradient = this.mapPaperGradient(item.fillColor);
      } else {
        style.fill = item.fillColor.toCSS(true);
      }
    }

    if (item.strokeColor) {
      if (item.strokeColor.gradient) {
        style.strokeType = "gradient";
        style.strokeGradient = this.mapPaperGradient(item.strokeColor);
      } else {
        style.stroke = item.strokeColor.toCSS(true);
      }
      style.strokeWidth = item.strokeWidth;
      style.strokeLinecap = item.strokeCap as any;
      style.strokeLinejoin = item.strokeJoin as any;
    }

    if (item.data?.filterId) {
      style.effects = filtersMap.get(item.data.filterId);
    }

    return style;
  }

  private static mapPaperGradient(color: any): Gradient {
    const paperGrad = color.gradient!;
    return {
      type: paperGrad.radial ? "radial" : "linear",
      start: { x: color.origin!.x, y: color.origin!.y },
      end: { x: color.destination!.x, y: color.destination!.y },
      stops: paperGrad.stops.map((s: any) => ({
        offset: s.offset,
        color: s.color.toCSS(true),
        opacity: s.color.alpha,
      })),
      units: "userSpaceOnUse",
    };
  }

  private static parseFilters(svgRoot: SVGSVGElement): Map<string, Effect[]> {
    const map = new Map<string, Effect[]>();
    const filters = svgRoot.querySelectorAll("filter");
    filters.forEach((filterEl: Element) => {
      const id = filterEl.getAttribute("id");
      if (!id) return;
      const effects: Effect[] = [];
      filterEl.querySelectorAll("feGaussianBlur").forEach((blurEl: Element) => {
        const stdDev = parseFloat(blurEl.getAttribute("stdDeviation") || "0");
        effects.push({
          id: `blur_${id}`,
          type: "blur",
          name: "Gaussian Blur",
          visible: true,
          blur: stdDev,
        });
      });
      if (effects.length > 0) map.set(id, effects);
    });
    return map;
  }

  private static parseStyleBlocks(
    svgRoot: SVGSVGElement,
  ): Map<string, Map<string, string>> {
    const stylesMap = new Map<string, Map<string, string>>();
    const styleElements = svgRoot.querySelectorAll("style");
    styleElements.forEach((styleEl) => {
      const cssText = styleEl.textContent || "";
      const ruleRegex = /([^{]+)\s*\{\s*([^}]+)\s*\}/g;
      let match;
      while ((match = ruleRegex.exec(cssText)) !== null) {
        const selector = match[1].trim();
        const declarations = match[2].trim();
        const propMap = new Map<string, string>();
        declarations.split(";").forEach((decl) => {
          const parts = decl.split(":").map((s) => s.trim());
          if (parts.length >= 2)
            propMap.set(parts[0], parts.slice(1).join(":"));
        });
        selector.split(",").forEach((s) => stylesMap.set(s.trim(), propMap));
      }
    });
    return stylesMap;
  }
}
