import { VectorPoint } from '../tools/PenTool';
import { RenderingContext } from '../render/CanvasRenderer';
import { AnimationUtils } from './Animation';

export interface Point {
    x: number;
    y: number;
}

export class PathUtils {
    /**
     * Splits a cubic bezier curve into two at time t (0 to 1).
     * Uses De Casteljau's algorithm.
     */
    static splitBezier(p1: Point, cp1: Point, cp2: Point, p2: Point, t: number): [Point[], Point[]] {
        const x1 = p1.x, y1 = p1.y;
        const x2 = cp1.x, y2 = cp1.y;
        const x3 = cp2.x, y3 = cp2.y;
        const x4 = p2.x, y4 = p2.y;

        const x12 = x1 + (x2 - x1) * t;
        const y12 = y1 + (y2 - y1) * t;
        const x23 = x2 + (x3 - x2) * t;
        const y23 = y2 + (y3 - y2) * t;
        const x34 = x3 + (x4 - x3) * t;
        const y34 = y3 + (y4 - y3) * t;
        const x123 = x12 + (x23 - x12) * t;
        const y123 = y12 + (y23 - y12) * t;
        const x234 = x23 + (x34 - x23) * t;
        const y234 = y23 + (y34 - y23) * t;
        const x1234 = x123 + (x234 - x123) * t;
        const y1234 = y123 + (y234 - y123) * t;

        return [
            [{ x: x1, y: y1 }, { x: x12, y: y12 }, { x: x123, y: y123 }, { x: x1234, y: y1234 }],
            [{ x: x1234, y: y1234 }, { x: x234, y: y234 }, { x: x34, y: y34 }, { x: x4, y: y4 }]
        ];
    }

    /**
     * Extracts a portion of a bezier curve between t0 and t1.
     */
    static getBezierSegment(p1: Point, cp1: Point, cp2: Point, p2: Point, t0: number, t1: number): Point[] {
        if (t0 === 0 && t1 === 1) return [p1, cp1, cp2, p2];

        // First split at t1 to get the start -> t1 part
        let [left] = this.splitBezier(p1, cp1, cp2, p2, t1);

        // Then split the result at t0 / t1 to get the t0 -> t1 part
        if (t0 > 0) {
            const adjustedT0 = t0 / t1;
            const [, right] = this.splitBezier(left[0], left[1], left[2], left[3], adjustedT0);
            return right;
        }

        return left;
    }

    /**
     * Calculates the approximate length of a cubic bezier curve.
     */
    static getBezierLength(p1: Point, cp1: Point, cp2: Point, p2: Point, steps: number = 10): number {
        let length = 0;
        let prevX = p1.x;
        let prevY = p1.y;

        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const cx = (1 - t) * (1 - t) * (1 - t) * p1.x + 3 * (1 - t) * (1 - t) * t * cp1.x + 3 * (1 - t) * t * t * cp2.x + t * t * t * p2.x;
            const cy = (1 - t) * (1 - t) * (1 - t) * p1.y + 3 * (1 - t) * (1 - t) * t * cp1.y + 3 * (1 - t) * t * t * cp2.y + t * t * t * p2.y;
            length += Math.sqrt((cx - prevX) ** 2 + (cy - prevY) ** 2);
            prevX = cx;
            prevY = cy;
        }
        return length;
    }

    /**
     * Trims a full path (array of VectorPoints) geometrically.
     * Returns a function that draws the path on a canvas context.
     * We don't return VectorPoints because a segment might be cut in the middle.
     */
    static drawTrimmedPath(ctx: RenderingContext, points: VectorPoint[], start: number, end: number, offset: number, closed: boolean, subPathLengths?: number[]) {
        if (points.length < 2) return;

        // 1. Normalize parameters
        let s = start;
        let e = end;
        const o = (((offset % 360) + 360) % 360) / 360;

        if (s > e) {
            [s, e] = [e, s];
        }

        // If the trimmed range is a full 100% or more, just draw the full path
        if (e - s >= 0.9999) {
            this.drawFullPath(ctx, points, closed);
            return;
        }

        const totalLength = this.getPathLength(points, closed);
        if (totalLength === 0) return;

        // Apply offset and normalize to 0-1
        s += o;
        e += o;

        const ts = ((s % 1) + 1) % 1;
        const te = ((e % 1) + 1) % 1;

        if (Math.abs(ts - te) < 0.0001) {
            return;
        }

        if (ts < te) {
            this.internalDrawSubPath(ctx, points, ts, te, closed, totalLength, false, subPathLengths);
        } else {
            // Wrap around: draw as a single continuous contour if possible
            // ONLY continue without moveTo if the path is actually closed (loop)
            const drawing = this.internalDrawSubPath(ctx, points, ts, 1, closed, totalLength, false, subPathLengths);
            this.internalDrawSubPath(ctx, points, 0, te, closed, totalLength, closed && drawing, subPathLengths);
        }
    }

    private static drawFullPath(ctx: RenderingContext, points: VectorPoint[], closed: boolean) {
        if (points.length === 0) return;
        const first = points[0];
        ctx.moveTo(first.x, first.y);
        for (let i = 0; i < points.length; i++) {
            const nextIdx = (i + 1) % points.length;
            if (i < points.length - 1 || closed) {
                const p1 = points[i];
                const p2 = points[nextIdx];
                ctx.bezierCurveTo(
                    p1.x + p1.outX, p1.y + p1.outY,
                    p2.x + p2.inX, p2.y + p2.inY,
                    p2.x, p2.y
                );
            }
        }
        if (closed) ctx.closePath();
    }

    private static getPathLength(points: VectorPoint[], closed: boolean): number {
        let total = 0;
        for (let i = 0; i < points.length; i++) {
            const nextIdx = (i + 1) % points.length;
            if (i < points.length - 1 || closed) {
                const p1 = points[i];
                const p2 = points[nextIdx];
                total += this.getBezierLength(
                    p1,
                    { x: p1.x + p1.outX, y: p1.y + p1.outY },
                    { x: p2.x + p2.inX, y: p2.y + p2.inY },
                    p2
                );
            }
        }
        return total;
    }

    private static internalDrawSubPath(
        ctx: RenderingContext,
        points: VectorPoint[],
        tStart: number,
        tEnd: number,
        closed: boolean,
        totalLength: number,
        isContinuation: boolean,
        subPathLengths?: number[]
    ): boolean {
        if (Math.abs(tStart - tEnd) < 0.0001) {
            return false;
        }
        const startDist = tStart * totalLength;
        const endDist = tEnd * totalLength;

        let currentDist = 0;
        let drawing = false;

        let subPathIndex = 0;
        let pointsInCurrentSubPath = subPathLengths ? subPathLengths[0] : points.length;
        let pointsProcessedInSubPaths = 0;

        for (let i = 0; i < points.length; i++) {
            const isEndOfSubPath = subPathLengths
                ? (i === pointsProcessedInSubPaths + pointsInCurrentSubPath - 1)
                : (i === points.length - 1);

            const nextIdx = isEndOfSubPath
                ? (subPathLengths ? pointsProcessedInSubPaths : 0)
                : i + 1;

            if (!isEndOfSubPath || closed) {
                const p1 = points[i];
                const p2 = points[nextIdx];
                const cp1 = { x: p1.x + p1.outX, y: p1.y + p1.outY };
                const cp2 = { x: p2.x + p2.inX, y: p2.y + p2.inY };

                const segLen = this.getBezierLength(p1, cp1, cp2, p2);

                if (currentDist + segLen >= startDist && currentDist <= endDist) {
                    const segmentStartT = Math.max(0, (startDist - currentDist) / segLen);
                    const segmentEndT = Math.min(1, (endDist - currentDist) / segLen);
                    const subSegment = this.getBezierSegment(p1, cp1, cp2, p2, segmentStartT, segmentEndT);

                    if (!drawing && !isContinuation) {
                        ctx.moveTo(subSegment[0].x, subSegment[0].y);
                    }
                    drawing = true;
                    ctx.bezierCurveTo(subSegment[1].x, subSegment[1].y, subSegment[2].x, subSegment[2].y, subSegment[3].x, subSegment[3].y);
                }

                currentDist += segLen;
                if (currentDist > endDist) break;
            }

            if (isEndOfSubPath) {
                const wasDrawingInThisSubPath = drawing;
                // We've finished one sub-path. 
                // Any subsequent segment MUST start with a moveTo.
                drawing = false;
                isContinuation = false;

                if (subPathLengths) {
                    pointsProcessedInSubPaths += pointsInCurrentSubPath;
                    subPathIndex++;
                    pointsInCurrentSubPath = subPathLengths[subPathIndex] || 0;
                }

                // If this was the last segment of the entire call, return its drawing status
                if (i === points.length - 1) {
                    return wasDrawingInThisSubPath;
                }
            }
        }
        return false;
    }

    /**
     * Generates a circular array of VectorPoints for a Polystar (Star or Polygon).
     * This allows parametric shapes to be treated as paths for rendering and export.
     */
    static generatePolystarPoints(
        points: number,
        innerRadius: number,
        outerRadius: number,
        innerRoundness: number,
        outerRoundness: number,
        type: 'star' | 'polygon'
    ): VectorPoint[] {
        const pts: VectorPoint[] = [];
        const isStar = type === 'star';
        const vertices = isStar ? points * 2 : points;
        const angleStep = (Math.PI * 2) / vertices;
        const startAngle = -Math.PI / 2; // Start from top

        // Lottie Magic Constant for Bezier tangents (approx 4/3 * tan(pi/2n))
        const K = 0.552284749831;

        for (let i = 0; i < vertices; i++) {
            const angle = startAngle + i * angleStep;
            const isInner = isStar && i % 2 === 1;
            const r = isInner ? innerRadius : outerRadius;
            const roundness = (isInner ? innerRoundness : outerRoundness) / 100;

            const x = Math.cos(angle) * r;
            const y = Math.sin(angle) * r;

            let inX = 0, inY = 0, outX = 0, outY = 0;

            if (roundness !== 0) {
                // Tangent is perpendicular to the radius vector
                const tanAngle = angle + Math.PI / 2;
                const tanLen = r * roundness * (Math.PI / vertices) * (isStar ? 0.5 : 1) * K;
                
                inX = -Math.cos(tanAngle) * tanLen;
                inY = -Math.sin(tanAngle) * tanLen;
                outX = Math.cos(tanAngle) * tanLen;
                outY = Math.sin(tanAngle) * tanLen;
            }

            pts.push({ x, y, inX, inY, outX, outY });
        }

        return pts;
    }

    /**
     * Offsets a path by a specific amount. 
     * Uses a simple vertex-normal expansion.
     */
    static offsetPoints(points: VectorPoint[], amount: number, closed: boolean): VectorPoint[] {
        if (amount === 0 || points.length < 2) return points;
        
        return points.map((p, i) => {
            const prev = points[(i - 1 + points.length) % points.length];
            const next = points[(i + 1) % points.length];
            
            const v1 = { x: p.x - prev.x, y: p.y - prev.y };
            const v2 = { x: next.x - p.x, y: next.y - p.y };
            
            // Standard right-hand normals
            const n1 = { x: -v1.y, y: v1.x };
            const n2 = { x: -v2.y, y: v2.x };
            
            const l1 = Math.sqrt(n1.x**2 + n1.y**2);
            const l2 = Math.sqrt(n2.x**2 + n2.y**2);
            
            const norm1 = { x: n1.x / (l1 || 1), y: n1.y / (l1 || 1) };
            const norm2 = { x: n2.x / (l2 || 1), y: n2.y / (l2 || 1) };
            
            // Average normal
            let nx = (norm1.x + norm2.x) / 2;
            let ny = (norm1.y + norm2.y) / 2;
            let nl = Math.sqrt(nx*nx + ny*ny);
            
            if (nl < 0.1) { // Degenerate cases
                nx = norm1.x;
                ny = norm1.y;
                nl = 1;
            }

            // Mitre length factor: 1 / cos(half-angle)
            // dot = cos(angle)
            const dot = norm1.x * norm2.x + norm1.y * norm2.y;
            const mitreLimit = 4;
            let factor = amount / (nl || 1);
            
            // Cap mitre to avoid infinite spikes at sharp angles
            if (factor > amount * mitreLimit) factor = amount * mitreLimit;

            return {
                ...p,
                x: p.x + nx * factor,
                y: p.y + ny * factor
            };
        });
    }
}
