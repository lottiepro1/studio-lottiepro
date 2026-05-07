'use client';

import { SceneNode } from '../state/sceneSlice';
import { AnimationUtils } from './Animation';
import { VectorPoint } from '../tools/PenTool';
import { getWorldMatrix } from './Matrix';

export type BooleanMode = 'union' | 'subtract' | 'intersect' | 'exclude';

type Point = { x: number; y: number };

// ============ Shape to Polygon Conversion ============

export function shapeToWorldPoints(
    node: SceneNode,
    nodes: Map<string, SceneNode>,
    currentTime: number = 0
): VectorPoint[] {
    const worldMatrix = getWorldMatrix(node.id, nodes);
    let localPoints: VectorPoint[] = [];

    if (node.type === 'rect') {
        const width = AnimationUtils.getPropertyValue(node, 'props.width', currentTime) || 0;
        const height = AnimationUtils.getPropertyValue(node, 'props.height', currentTime) || 0;
        const roundness = AnimationUtils.getPropertyValue(node, 'props.roundness', currentTime) || 0;

        if (roundness > 0) {
            const r = Math.min(roundness, width / 2, height / 2);
            // Sample rounded corners
            const segments = 8;
            localPoints = [];

            // Top-right corner
            for (let i = 0; i <= segments; i++) {
                const angle = -Math.PI / 2 + (Math.PI / 2) * (i / segments);
                localPoints.push({
                    x: width - r + r * Math.cos(angle),
                    y: r + r * Math.sin(angle),
                    inX: 0, inY: 0, outX: 0, outY: 0
                });
            }
            // Bottom-right corner
            for (let i = 0; i <= segments; i++) {
                const angle = 0 + (Math.PI / 2) * (i / segments);
                localPoints.push({
                    x: width - r + r * Math.cos(angle),
                    y: height - r + r * Math.sin(angle),
                    inX: 0, inY: 0, outX: 0, outY: 0
                });
            }
            // Bottom-left corner
            for (let i = 0; i <= segments; i++) {
                const angle = Math.PI / 2 + (Math.PI / 2) * (i / segments);
                localPoints.push({
                    x: r + r * Math.cos(angle),
                    y: height - r + r * Math.sin(angle),
                    inX: 0, inY: 0, outX: 0, outY: 0
                });
            }
            // Top-left corner
            for (let i = 0; i <= segments; i++) {
                const angle = Math.PI + (Math.PI / 2) * (i / segments);
                localPoints.push({
                    x: r + r * Math.cos(angle),
                    y: r + r * Math.sin(angle),
                    inX: 0, inY: 0, outX: 0, outY: 0
                });
            }
        } else {
            localPoints = [
                { x: 0, y: 0, inX: 0, inY: 0, outX: 0, outY: 0 },
                { x: width, y: 0, inX: 0, inY: 0, outX: 0, outY: 0 },
                { x: width, y: height, inX: 0, inY: 0, outX: 0, outY: 0 },
                { x: 0, y: height, inX: 0, inY: 0, outX: 0, outY: 0 },
            ];
        }
    } else if (node.type === 'ellipse') {
        const rx = AnimationUtils.getPropertyValue(node, 'props.radiusX', currentTime) || 0;
        const ry = AnimationUtils.getPropertyValue(node, 'props.radiusY', currentTime) || 0;

        // Sample ellipse with many points for accuracy
        const segments = 32;
        localPoints = [];
        for (let i = 0; i < segments; i++) {
            const angle = (2 * Math.PI * i) / segments;
            localPoints.push({
                x: rx + rx * Math.cos(angle),
                y: ry + ry * Math.sin(angle),
                inX: 0, inY: 0, outX: 0, outY: 0
            });
        }
    } else if (node.type === 'path') {
        const points = AnimationUtils.getPropertyValue(node, 'props.points', currentTime) as VectorPoint[];
        if (points && points.length > 0) {
            // Sample bezier curves
            localPoints = sampleBezierPath(points, true);
        }
    }

    return localPoints.map(p => {
        const worldPos = worldMatrix.transformPoint(new DOMPoint(p.x, p.y));
        return { x: worldPos.x, y: worldPos.y, inX: 0, inY: 0, outX: 0, outY: 0 };
    });
}

function sampleBezierPath(points: VectorPoint[], closed: boolean): VectorPoint[] {
    const result: VectorPoint[] = [];
    const samples = 8;

    for (let i = 0; i < points.length; i++) {
        const current = points[i];
        const nextIndex = closed ? (i + 1) % points.length : i + 1;
        if (nextIndex >= points.length && !closed) break;
        const next = points[nextIndex];

        const hasHandles = Math.abs(current.outX) > 0.01 || Math.abs(current.outY) > 0.01 ||
            Math.abs(next.inX) > 0.01 || Math.abs(next.inY) > 0.01;

        if (hasHandles) {
            for (let j = 0; j < samples; j++) {
                const t = j / samples;
                const pt = sampleBezierPoint(current, next, t);
                result.push({ x: pt.x, y: pt.y, inX: 0, inY: 0, outX: 0, outY: 0 });
            }
        } else {
            result.push({ x: current.x, y: current.y, inX: 0, inY: 0, outX: 0, outY: 0 });
        }
    }

    return result;
}

function sampleBezierPoint(p0: VectorPoint, p1: VectorPoint, t: number): Point {
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;
    const t2 = t * t;
    const t3 = t2 * t;

    const c0x = p0.x + p0.outX;
    const c0y = p0.y + p0.outY;
    const c1x = p1.x + p1.inX;
    const c1y = p1.y + p1.inY;

    return {
        x: mt3 * p0.x + 3 * mt2 * t * c0x + 3 * mt * t2 * c1x + t3 * p1.x,
        y: mt3 * p0.y + 3 * mt2 * t * c0y + 3 * mt * t2 * c1y + t3 * p1.y
    };
}

// ============ Polygon Boolean Operations ============

const EPSILON = 1e-9;

function pointsEqual(a: Point, b: Point): boolean {
    return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;
}

function crossProduct(o: Point, a: Point, b: Point): number {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

// Check if point is inside polygon using ray casting
function isPointInPolygon(point: Point, polygon: Point[]): boolean {
    let inside = false;
    const n = polygon.length;

    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;

        if (((yi > point.y) !== (yj > point.y)) &&
            (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }

    return inside;
}

// Find intersection of two line segments
function lineSegmentIntersection(
    p1: Point, p2: Point,
    p3: Point, p4: Point
): Point | null {
    const d1x = p2.x - p1.x;
    const d1y = p2.y - p1.y;
    const d2x = p4.x - p3.x;
    const d2y = p4.y - p3.y;

    const cross = d1x * d2y - d1y * d2x;
    if (Math.abs(cross) < EPSILON) return null;

    const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / cross;
    const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / cross;

    if (t >= -EPSILON && t <= 1 + EPSILON && u >= -EPSILON && u <= 1 + EPSILON) {
        return {
            x: p1.x + t * d1x,
            y: p1.y + t * d1y
        };
    }

    return null;
}

// Find all intersection points between two polygons
function findIntersections(poly1: Point[], poly2: Point[]): { point: Point; edge1: number; edge2: number; t1: number; t2: number }[] {
    const intersections: { point: Point; edge1: number; edge2: number; t1: number; t2: number }[] = [];

    for (let i = 0; i < poly1.length; i++) {
        const p1 = poly1[i];
        const p2 = poly1[(i + 1) % poly1.length];

        for (let j = 0; j < poly2.length; j++) {
            const p3 = poly2[j];
            const p4 = poly2[(j + 1) % poly2.length];

            const d1x = p2.x - p1.x;
            const d1y = p2.y - p1.y;
            const d2x = p4.x - p3.x;
            const d2y = p4.y - p3.y;

            const cross = d1x * d2y - d1y * d2x;
            if (Math.abs(cross) < EPSILON) continue;

            const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / cross;
            const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / cross;

            if (t > EPSILON && t < 1 - EPSILON && u > EPSILON && u < 1 - EPSILON) {
                intersections.push({
                    point: { x: p1.x + t * d1x, y: p1.y + t * d1y },
                    edge1: i,
                    edge2: j,
                    t1: t,
                    t2: u
                });
            }
        }
    }

    return intersections;
}

// Trace the union boundary of two polygons
function traceUnionBoundary(poly1: Point[], poly2: Point[]): Point[] {
    // Find all intersections
    const intersections = findIntersections(poly1, poly2);

    if (intersections.length === 0) {
        // No intersections - check containment
        if (isPointInPolygon(poly1[0], poly2)) {
            return [...poly2]; // poly1 is inside poly2
        }
        if (isPointInPolygon(poly2[0], poly1)) {
            return [...poly1]; // poly2 is inside poly1
        }
        // Disjoint - return larger one (simplified)
        return poly1.length >= poly2.length ? [...poly1] : [...poly2];
    }

    // Build the union by tracing the outer boundary
    const result: Point[] = [];
    const visited = new Set<string>();

    // Start from a point that's definitely on the outer boundary
    // Find the leftmost point of both polygons
    let startPoly = poly1;
    let otherPoly = poly2;
    let startIdx = 0;
    let minX = Infinity;

    for (let i = 0; i < poly1.length; i++) {
        if (poly1[i].x < minX) {
            minX = poly1[i].x;
            startIdx = i;
            startPoly = poly1;
            otherPoly = poly2;
        }
    }
    for (let i = 0; i < poly2.length; i++) {
        if (poly2[i].x < minX) {
            minX = poly2[i].x;
            startIdx = i;
            startPoly = poly2;
            otherPoly = poly1;
        }
    }

    // Trace the boundary
    let currentPoly = startPoly;
    let otherPolyRef = otherPoly;
    let idx = startIdx;
    let maxIterations = (poly1.length + poly2.length) * 2 + intersections.length * 2;
    let iterations = 0;

    while (iterations < maxIterations) {
        iterations++;
        const current = currentPoly[idx];
        const key = `${current.x.toFixed(4)},${current.y.toFixed(4)}`;

        if (visited.has(key) && result.length > 2) {
            break;
        }
        visited.add(key);
        result.push({ ...current });

        const nextIdx = (idx + 1) % currentPoly.length;
        const next = currentPoly[nextIdx];

        // Check for intersection on this edge
        let foundIntersection = false;
        let nearestT = Infinity;
        let nearestInt: typeof intersections[0] | null = null;

        for (const int of intersections) {
            const isOnCurrentEdge = (currentPoly === poly1 && int.edge1 === idx) ||
                (currentPoly === poly2 && int.edge2 === idx);
            if (isOnCurrentEdge) {
                const t = currentPoly === poly1 ? int.t1 : int.t2;
                if (t < nearestT && t > EPSILON) {
                    nearestT = t;
                    nearestInt = int;
                    foundIntersection = true;
                }
            }
        }

        if (foundIntersection && nearestInt) {
            // Add intersection point and switch polygons
            const intKey = `${nearestInt.point.x.toFixed(4)},${nearestInt.point.y.toFixed(4)}`;
            if (!visited.has(intKey)) {
                result.push({ ...nearestInt.point });
                visited.add(intKey);
            }

            // Switch to the other polygon
            if (currentPoly === poly1) {
                currentPoly = poly2;
                otherPolyRef = poly1;
                idx = (nearestInt.edge2 + 1) % poly2.length;
            } else {
                currentPoly = poly1;
                otherPolyRef = poly2;
                idx = (nearestInt.edge1 + 1) % poly1.length;
            }

            // Skip points that are inside the other polygon
            while (isPointInPolygon(currentPoly[idx], otherPolyRef)) {
                idx = (idx + 1) % currentPoly.length;
                if (idx === startIdx && currentPoly === startPoly) break;
            }
        } else {
            // Move to next vertex if it's outside the other polygon
            if (!isPointInPolygon(next, otherPolyRef)) {
                idx = nextIdx;
            } else {
                // Skip vertices inside the other polygon
                idx = nextIdx;
                while (isPointInPolygon(currentPoly[idx], otherPolyRef)) {
                    idx = (idx + 1) % currentPoly.length;
                    if (idx === startIdx && currentPoly === startPoly) break;
                }
            }
        }

        // Check if we've returned to start
        if (currentPoly === startPoly && idx === startIdx && result.length > 2) {
            break;
        }
    }

    return result;
}

// Trace intersection boundary
function traceIntersectionBoundary(poly1: Point[], poly2: Point[]): Point[] {
    const intersections = findIntersections(poly1, poly2);

    if (intersections.length === 0) {
        // Check containment
        if (isPointInPolygon(poly1[0], poly2)) {
            return [...poly1];
        }
        if (isPointInPolygon(poly2[0], poly1)) {
            return [...poly2];
        }
        return []; // No intersection
    }

    // Collect all points that are inside both polygons
    const result: Point[] = [];

    // Add intersection points
    for (const int of intersections) {
        result.push({ ...int.point });
    }

    // Add vertices of poly1 that are inside poly2
    for (const p of poly1) {
        if (isPointInPolygon(p, poly2)) {
            result.push({ ...p });
        }
    }

    // Add vertices of poly2 that are inside poly1
    for (const p of poly2) {
        if (isPointInPolygon(p, poly1)) {
            result.push({ ...p });
        }
    }

    // Sort by angle from centroid to get proper order
    if (result.length < 3) return result;

    const cx = result.reduce((s, p) => s + p.x, 0) / result.length;
    const cy = result.reduce((s, p) => s + p.y, 0) / result.length;

    result.sort((a, b) => {
        const angleA = Math.atan2(a.y - cy, a.x - cx);
        const angleB = Math.atan2(b.y - cy, b.x - cx);
        return angleA - angleB;
    });

    // Remove duplicates
    return result.filter((p, i) => {
        if (i === 0) return true;
        return !pointsEqual(p, result[i - 1]);
    });
}

// Trace subtraction boundary (poly1 - poly2) using proper boundary tracing
function traceSubtractionBoundary(poly1: Point[], poly2: Point[]): Point[] {
    const intersections = findIntersections(poly1, poly2);

    if (intersections.length === 0) {
        if (isPointInPolygon(poly1[0], poly2)) {
            return []; // poly1 is completely inside poly2
        }
        if (isPointInPolygon(poly2[0], poly1)) {
            // poly2 is inside poly1 - for now return poly1 (proper hole handling would need compound paths)
            return [...poly1];
        }
        return [...poly1]; // Disjoint
    }

    // Sort intersections by position on poly1 edges
    const sortedInts = [...intersections].sort((a, b) => {
        if (a.edge1 !== b.edge1) return a.edge1 - b.edge1;
        return a.t1 - b.t1;
    });

    // Find starting point - a point on poly1 that is OUTSIDE poly2
    let startIdx = -1;
    for (let i = 0; i < poly1.length; i++) {
        if (!isPointInPolygon(poly1[i], poly2)) {
            startIdx = i;
            break;
        }
    }

    if (startIdx === -1) {
        // All points of poly1 are inside poly2
        return [];
    }

    const result: Point[] = [];
    const visited = new Set<string>();
    let idx = startIdx;
    let onPoly1 = true;
    let poly2Idx = 0;
    let poly2Direction = -1; // -1 = reverse, 1 = forward
    let maxIterations = (poly1.length + poly2.length) * 3;
    let iterations = 0;

    while (iterations < maxIterations) {
        iterations++;

        if (onPoly1) {
            const current = poly1[idx];
            const key = `${current.x.toFixed(3)},${current.y.toFixed(3)}`;

            if (visited.has(key) && result.length > 2) {
                break;
            }

            // Only add if outside poly2
            if (!isPointInPolygon(current, poly2)) {
                visited.add(key);
                result.push({ ...current });
            }

            const nextIdx = (idx + 1) % poly1.length;

            // Check for intersection on this edge
            const edgeInts = sortedInts
                .filter(int => int.edge1 === idx)
                .sort((a, b) => a.t1 - b.t1);

            if (edgeInts.length > 0) {
                // We're about to enter or exit poly2
                const int = edgeInts[0];
                const intKey = `${int.point.x.toFixed(3)},${int.point.y.toFixed(3)}`;

                if (!visited.has(intKey)) {
                    result.push({ ...int.point });
                    visited.add(intKey);
                }

                // Check if we're entering poly2 (next point is inside) or exiting
                const midPoint = {
                    x: poly1[idx].x + (int.t1 + 0.01) * (poly1[nextIdx].x - poly1[idx].x),
                    y: poly1[idx].y + (int.t1 + 0.01) * (poly1[nextIdx].y - poly1[idx].y)
                };

                if (isPointInPolygon(midPoint, poly2)) {
                    // Entering poly2 - switch to tracing poly2's boundary in REVERSE
                    onPoly1 = false;
                    poly2Idx = int.edge2;
                    poly2Direction = -1; // Go backwards to trace the "hole" edge
                } else {
                    // Exiting poly2 - continue on poly1
                    idx = nextIdx;
                }
            } else {
                idx = nextIdx;
            }

            if (idx === startIdx && onPoly1 && result.length > 2) {
                break;
            }
        } else {
            // Tracing poly2's boundary (going around the cut-out area)
            const current = poly2[poly2Idx];
            const key = `${current.x.toFixed(3)},${current.y.toFixed(3)}`;

            // Add points on poly2 that are inside poly1 (these form the cut edge)
            if (isPointInPolygon(current, poly1) && !visited.has(key)) {
                result.push({ ...current });
                visited.add(key);
            }

            // Move along poly2
            const nextPoly2Idx = (poly2Idx + poly2Direction + poly2.length) % poly2.length;

            // Check if we're at an intersection back to poly1
            const edgeToCheck = poly2Direction === 1 ? poly2Idx : nextPoly2Idx;
            const edgeInts = sortedInts.filter(int => int.edge2 === edgeToCheck);

            let foundExit = false;
            for (const int of edgeInts) {
                const intKey = `${int.point.x.toFixed(3)},${int.point.y.toFixed(3)}`;

                // Check if this intersection leads back outside poly2
                const testPoint = {
                    x: poly1[int.edge1].x + (int.t1 + 0.01) * (poly1[(int.edge1 + 1) % poly1.length].x - poly1[int.edge1].x),
                    y: poly1[int.edge1].y + (int.t1 + 0.01) * (poly1[(int.edge1 + 1) % poly1.length].y - poly1[int.edge1].y)
                };

                if (!isPointInPolygon(testPoint, poly2)) {
                    // This intersection leads outside - switch back to poly1
                    if (!visited.has(intKey)) {
                        result.push({ ...int.point });
                        visited.add(intKey);
                    }
                    onPoly1 = true;
                    idx = (int.edge1 + 1) % poly1.length;
                    foundExit = true;
                    break;
                }
            }

            if (!foundExit) {
                poly2Idx = nextPoly2Idx;
            }
        }
    }

    // Remove duplicates and ensure proper ordering
    const filtered = result.filter((p, i) => {
        if (i === 0) return true;
        return !pointsEqual(p, result[i - 1]);
    });
    return filtered.length >= 3 ? filtered : poly1;
}

// XOR operation - areas in either polygon but not both (excludes overlap)
// Creates a compound path: outer union + reversed intersection to create hole effect
function traceXorBoundary(poly1: Point[], poly2: Point[]): Point[] {
    const intersections = findIntersections(poly1, poly2);

    if (intersections.length === 0) {
        // No overlap - check containment
        if (isPointInPolygon(poly1[0], poly2)) {
            return [...poly2];
        }
        if (isPointInPolygon(poly2[0], poly1)) {
            return [...poly1];
        }
        // Disjoint - return poly1
        return [...poly1];
    }

    // Get the union boundary (outer contour)
    const unionBoundary = traceUnionBoundary(poly1, poly2);

    // Get the intersection boundary (the overlap area)
    const intersectionBoundary = traceIntersectionBoundary(poly1, poly2);

    if (intersectionBoundary.length < 3) {
        return unionBoundary;
    }

    // Find closest points between union and intersection to create bridge
    let minDist = Infinity;
    let unionIdx = 0;
    let intIdx = 0;

    for (let i = 0; i < unionBoundary.length; i++) {
        for (let j = 0; j < intersectionBoundary.length; j++) {
            const dx = unionBoundary[i].x - intersectionBoundary[j].x;
            const dy = unionBoundary[i].y - intersectionBoundary[j].y;
            const dist = dx * dx + dy * dy;
            if (dist < minDist) {
                minDist = dist;
                unionIdx = i;
                intIdx = j;
            }
        }
    }

    // Build compound path: union -> bridge -> reversed intersection -> bridge back
    const result: Point[] = [];

    // Trace union starting from connection point
    for (let i = 0; i < unionBoundary.length; i++) {
        const idx = (unionIdx + i) % unionBoundary.length;
        result.push({ ...unionBoundary[idx] });
    }
    // Close back to connection point
    result.push({ ...unionBoundary[unionIdx] });

    // Bridge to intersection
    result.push({ ...intersectionBoundary[intIdx] });

    // Trace intersection in REVERSE (creates hole with winding rule)
    for (let i = intersectionBoundary.length; i > 0; i--) {
        const idx = (intIdx + i) % intersectionBoundary.length;
        result.push({ ...intersectionBoundary[idx] });
    }

    // Bridge back
    result.push({ ...intersectionBoundary[intIdx] });
    result.push({ ...unionBoundary[unionIdx] });

    // Remove duplicates
    const filtered = result.filter((p, i) => {
        if (i === 0) return true;
        return !pointsEqual(p, result[i - 1]);
    });

    return filtered.length >= 3 ? filtered : unionBoundary;
}

// Perform boolean operation on multiple polygons
function performBooleanOperation(polygons: Point[][], mode: BooleanMode): Point[] {
    if (polygons.length === 0) return [];
    if (polygons.length === 1) return polygons[0];

    let result = polygons[0];

    for (let i = 1; i < polygons.length; i++) {
        switch (mode) {
            case 'union':
                result = traceUnionBoundary(result, polygons[i]);
                break;
            case 'subtract':
                result = traceSubtractionBoundary(result, polygons[i]);
                break;
            case 'intersect':
                result = traceIntersectionBoundary(result, polygons[i]);
                break;
            case 'exclude':
                result = traceXorBoundary(result, polygons[i]);
                break;
        }

        if (result.length < 3) break;
    }

    return result;
}

// ============ Main Export ============

function polygonToPath(polygon: Point[]): VectorPoint[] {
    return polygon.map(p => ({
        x: p.x,
        y: p.y,
        inX: 0,
        inY: 0,
        outX: 0,
        outY: 0,
    }));
}

function getBounds(points: VectorPoint[]): { x: number; y: number; width: number; height: number } {
    if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const p of points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
    }

    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function normalizeToLocal(points: VectorPoint[]): { points: VectorPoint[]; offset: Point } {
    const bounds = getBounds(points);

    return {
        points: points.map(p => ({ ...p, x: p.x - bounds.x, y: p.y - bounds.y })),
        offset: { x: bounds.x, y: bounds.y },
    };
}

export function applyBooleanToShapes(
    nodeIds: string[],
    mode: BooleanMode,
    nodes: Map<string, SceneNode>,
    currentTime: number = 0
): { points: VectorPoint[]; bounds: { x: number; y: number; width: number; height: number }; style: SceneNode['style'] } | null {
    if (nodeIds.length < 2) return null;

    const polygons: Point[][] = [];
    let firstNode: SceneNode | undefined;

    for (const id of nodeIds) {
        const node = nodes.get(id);
        if (!node) continue;

        if (!firstNode) firstNode = node;

        const worldPoints = shapeToWorldPoints(node, nodes, currentTime);
        const polygon = worldPoints.map(p => ({ x: p.x, y: p.y }));

        if (polygon.length >= 3) {
            polygons.push(polygon);
        }
    }

    if (polygons.length < 2 || !firstNode) return null;

    const resultPolygon = performBooleanOperation(polygons, mode);

    if (resultPolygon.length < 3) {
        console.warn('Boolean operation produced empty result');
        return null;
    }

    const pathPoints = polygonToPath(resultPolygon);
    const { points: localPoints, offset } = normalizeToLocal(pathPoints);
    const bounds = getBounds(pathPoints);

    return {
        points: localPoints,
        bounds: { x: offset.x, y: offset.y, width: bounds.width, height: bounds.height },
        style: { ...firstNode.style },
    };
}
