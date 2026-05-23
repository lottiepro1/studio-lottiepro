import { SceneNode } from '../state/sceneSlice';
import { Keyframe } from '../state/animationSlice';
import { EASING_PRESETS } from './EasingPresets';

export class AnimationUtils {
    // --- Performance: Per-frame property value cache ---
    // Only active DURING a CanvasRenderer.render() cycle (between beginFrame/endFrame).
    // Outside of rendering (e.g., React components like SelectionOverlay), the cache
    // is bypassed entirely to prevent stale values.
    public static _frameCache: Map<string, any> = new Map();
    public static _cacheActive: boolean = false;

    // --- Performance: Path split cache ---
    // Caches the result of path.split('.') to avoid repeated string splitting
    private static _pathSplitCache: Map<string, string[]> = new Map();

    /** Call at the START of each render frame to enable and reset the per-frame cache */
    static beginFrame() {
        this._frameCache.clear();
        this._cacheActive = true;
    }

    /** Call at the END of each render frame to disable the cache */
    static endFrame() {
        this._cacheActive = false;
        this._frameCache.clear();
    }

    static getPropertyValue(node: SceneNode, propertyPath: string, currentTime: number): any {
        // --- Per-frame cache lookup (only within a render cycle) ---
        let cacheKey: string | undefined;
        if (this._cacheActive) {
            cacheKey = `${node.id}::${propertyPath}::${currentTime}`;
            if (this._frameCache.has(cacheKey)) return this._frameCache.get(cacheKey);
        }

        const keyframes = node.animations?.[propertyPath];

        // Fallback to static value if no keyframes
        if (!keyframes || keyframes.length === 0) {
            let result = this.getObjectValue(node, propertyPath);
            result = this.applyDynamicScaling(node, propertyPath, result, currentTime);

            // Global safety net: ensure numeric values are NEVER NaN
            if (typeof result === 'number' && isNaN(result)) result = 0;

            if (cacheKey) this._frameCache.set(cacheKey, result);
            return result;
        }

        let result: any;
        // 1. Before first keyframe
        if (currentTime <= keyframes[0].time) {
            const val = keyframes[0].value;
            result = (typeof val === 'number' && isNaN(val)) ? 0 : val;
        }
        // 2. After last keyframe
        else if (currentTime >= keyframes[keyframes.length - 1].time) {
            const val = keyframes[keyframes.length - 1].value;
            result = (typeof val === 'number' && isNaN(val)) ? 0 : val;
        }
        // 3. Between keyframes — use binary search for O(log n) instead of O(n)
        else {
            let lo = 0, hi = keyframes.length - 2;
            while (lo <= hi) {
                const mid = (lo + hi) >>> 1;
                const start = keyframes[mid];
                const end = keyframes[mid + 1];
                if (currentTime < start.time) {
                    hi = mid - 1;
                } else if (currentTime >= end.time) {
                    lo = mid + 1;
                } else {
                    const t = (currentTime - start.time) / (end.time - start.time);
                    result = this.interpolate(start, end, t, propertyPath);
                    break;
                }
            }
        }

        if (result === undefined) result = this.getObjectValue(node, propertyPath);
        result = this.applyDynamicScaling(node, propertyPath, result, currentTime);

        // Global safety net: ensure numeric values are NEVER NaN
        if (typeof result === 'number' && isNaN(result)) result = 0;

        if (cacheKey) this._frameCache.set(cacheKey, result);
        return result;
    }

    private static applyDynamicScaling(node: any, path: string, value: any, currentTime: number): any {
        if (!value || typeof value !== 'object' || !('designSize' in value)) {
            return value;
        }

        const gradient = value;
        const designSize = gradient.designSize;
        if (!designSize || (designSize.width === 0 && designSize.height === 0)) return value;

        // Use getPropertyValue recursively but avoid infinite loop by checking path
        // We need the ACTUAL current size of the node
        let curW = 0, curH = 0;
        if (node.type === 'rect' || node.type === 'artboard') {
            const w = path === 'props.width' ? value : this.getPropertyValue(node, 'props.width', currentTime);
            const h = path === 'props.height' ? value : this.getPropertyValue(node, 'props.height', currentTime);
            curW = w; curH = h;
        } else if (node.type === 'ellipse') {
            const rx = path === 'props.radiusX' ? value : this.getPropertyValue(node, 'props.radiusX', currentTime);
            const ry = path === 'props.radiusY' ? value : this.getPropertyValue(node, 'props.radiusY', currentTime);
            curW = rx * 2; curH = ry * 2;
        } else if (node.type === 'path') {
            const points = path === 'props.points' ? value : this.getPropertyValue(node, 'props.points', currentTime);
            if (Array.isArray(points)) {
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (const p of points) {
                    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
                    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
                }
                curW = maxX - minX; curH = maxY - minY;
            }
        }

        const scaleX = (designSize.width && !isNaN(designSize.width) && designSize.width !== 0) ? curW / designSize.width : 1;
        const scaleY = (designSize.height && !isNaN(designSize.height) && designSize.height !== 0) ? curH / designSize.height : 1;

        if (scaleX === 1 && scaleY === 1) return value;

        const res = { ...gradient };
        if (res.start) {
            res.start = { x: res.start.x * scaleX, y: res.start.y * scaleY };
        }
        if (res.end) {
            res.end = { x: res.end.x * scaleX, y: res.end.y * scaleY };
        }
        return res;
    }

    private static interpolate(start: Keyframe, end: Keyframe, t: number, propertyPath?: string): any {
        const v1 = start.value;
        const v2 = end.value;
        const easing = start.easing || 'linear';
        const bezier = start.bezier;

        let easedT = t;

        // 1. Calculate temporal easedT (easing)
        if (bezier && bezier.length === 4) {
            easedT = this.cubicBezier(t, bezier[0], bezier[1], bezier[2], bezier[3]);
        }
        else if (easing && easing !== 'linear' && EASING_PRESETS[easing]) {
            const preset = EASING_PRESETS[easing];
            easedT = this.cubicBezier(t, preset.bezier[0], preset.bezier[1], preset.bezier[2], preset.bezier[3]);
        }
        else if (easing === 'ease-in') {
            easedT = this.cubicBezier(t, 0.42, 0, 1, 1);
        } else if (easing === 'ease-out') {
            easedT = this.cubicBezier(t, 0, 0, 0.58, 1);
        } else if (easing === 'ease-in-out') {
            easedT = this.cubicBezier(t, 0.42, 0, 0.58, 1);
        }

        // 2. Guard: if either endpoint is undefined/null, snap to whichever is defined.
        // This prevents an undefined keyframe from causing a bad fallback to the static style value.
        if (v1 == null && v2 == null) return v1;
        if (v1 == null) return v2;
        if (v2 == null) return v1;

        // 3. Linear/Spatial Interpolation
        if (typeof v1 === 'number' && typeof v2 === 'number') {
            // Check for spatial bezier handles (for position animation)
            // Lottie handles (to/ti) are relative to the current position.
            // If both handles are essentially zero, we MUST fallback to linear interpolation
            // to avoid unintended speed curves (S-curves) in coordinate space.
            const hasSpatialOut = start.spatialOut && (Math.abs(start.spatialOut.x) > 0.01 || Math.abs(start.spatialOut.y) > 0.01);
            const hasSpatialIn = end.spatialIn && (Math.abs(end.spatialIn.x) > 0.01 || Math.abs(end.spatialIn.y) > 0.01);

            if (hasSpatialOut || hasSpatialIn) {
                const isY = propertyPath?.toLowerCase().endsWith('.y') || propertyPath?.toLowerCase().endsWith('.radiusy') || propertyPath?.toLowerCase().endsWith('.scaley');
                const p0 = v1;
                const p1 = v1 + (isY ? (start.spatialOut?.y ?? 0) : (start.spatialOut?.x ?? 0));
                const p2 = v2 + (isY ? (end.spatialIn?.y ?? 0) : (end.spatialIn?.x ?? 0));
                const p3 = v2;

                return this.getCubicValue(easedT, p0, p1, p2, p3);
            }

            const val = v1 + (v2 - v1) * easedT;
            return isNaN(val) ? 0 : val;
        }

        if (typeof v1 === 'string' && v1.startsWith('#') && typeof v2 === 'string' && v2.startsWith('#')) {
            return this.interpolateColor(v1, v2, easedT);
        }

        if (typeof v1 === 'object' && v1 !== null && typeof v2 === 'object' && v2 !== null) {
            // Check if it's a gradient
            if ('stops' in v1 && 'stops' in v2) {
                return this.interpolateGradient(v1, v2, easedT);
            }
        }

        if (Array.isArray(v1) && Array.isArray(v2)) {
            // Check if this is a path points array
            if (v1.length > 0 && typeof v1[0] === 'object' && v1[0] !== null && 'x' in v1[0]) {
                // If point counts differ, snap to the end keyframe rather than silently
                // dropping the extra points (which would produce a broken partial shape).
                if (v1.length !== v2.length) return easedT < 0.5 ? v1 : v2;
                return v1.map((p1, i) => {
                    const p2 = v2[i];
                    if (!p2) return p1;
                    const px1 = p1.x || 0;
                    const py1 = p1.y || 0;
                    const px2 = p2.x || 0;
                    const py2 = p2.y || 0;
                    return {
                        x: px1 + (px2 - px1) * easedT,
                        y: py1 + (py2 - py1) * easedT,
                        inX: (p1.inX || 0) + ((p2.inX || 0) - (p1.inX || 0)) * easedT,
                        inY: (p1.inY || 0) + ((p2.inY || 0) - (p1.inY || 0)) * easedT,
                        outX: (p1.outX || 0) + ((p2.outX || 0) - (p1.outX || 0)) * easedT,
                        outY: (p1.outY || 0) + ((p2.outY || 0) - (p1.outY || 0)) * easedT,
                    };
                });
            }

            return v1.map((val, i) => {
                if (v2[i] === undefined) return val;

                if (typeof val === 'number') {
                    return val + (v2[i] - val) * easedT;
                }

                if (typeof val === 'object' && val !== null) {
                    const res: any = { ...val };
                    for (const key in val) {
                        if (typeof val[key] === 'number' && typeof v2[i][key] === 'number') {
                            res[key] = val[key] + (v2[i][key] - val[key]) * easedT;
                        }
                    }
                    return res;
                }
                return val;
            });
        }

        return v1;
    }

    private static interpolateGradient(g1: any, g2: any, t: number): any {
        const res = { ...g1 };
        if (g1.start && g2.start) {
            res.start = {
                x: g1.start.x + (g2.start.x - g1.start.x) * t,
                y: g1.start.y + (g2.start.y - g1.start.y) * t
            };
        }
        if (g1.end && g2.end) {
            res.end = {
                x: g1.end.x + (g2.end.x - g1.end.x) * t,
                y: g1.end.y + (g2.end.y - g1.end.y) * t
            };
        }
        if (g1.stops && g2.stops) {
            res.stops = g1.stops.map((s1: any, i: number) => {
                const s2 = g2.stops[i] || s1;
                return {
                    offset: s1.offset + (s2.offset - s1.offset) * t,
                    color: this.interpolateColor(s1.color, s2.color, t),
                    opacity: (s1.opacity ?? 1) + ((s2.opacity ?? 1) - (s1.opacity ?? 1)) * t
                };
            });
        }
        return res;
    }

    private static interpolateColor(c1: string, c2: string, t: number): string {
        const parse = (c: string) => {
            if (c.length === 4) {
                return [
                    parseInt(c[1] + c[1], 16),
                    parseInt(c[2] + c[2], 16),
                    parseInt(c[3] + c[3], 16)
                ];
            }
            return [
                parseInt(c.slice(1, 3), 16),
                parseInt(c.slice(3, 5), 16),
                parseInt(c.slice(5, 7), 16)
            ];
        };

        const [r1, g1, b1] = parse(c1);
        const [r2, g2, b2] = parse(c2);

        const r = Math.round(r1 + (r2 - r1) * t);
        const g = Math.round(g1 + (g2 - g1) * t);
        const b = Math.round(b1 + (b2 - b1) * t);

        const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }

    private static cubicBezier(t: number, p1x: number, p1y: number, p2x: number, p2y: number): number {
        if (p1x === p1y && p2x === p2y) return t; // Linear

        const solveT = (x: number) => {
            let tCurrent = x;
            for (let i = 0; i < 8; i++) { // Newton's method
                const xCurrent = this.getCoord(tCurrent, p1x, p2x) - x;
                if (Math.abs(xCurrent) < 1e-6) return tCurrent;
                const dX = this.getSlope(tCurrent, p1x, p2x);
                if (Math.abs(dX) < 1e-6) break;
                tCurrent -= xCurrent / dX;
            }
            return tCurrent;
        };

        const tFinal = solveT(t);
        return this.getCoord(tFinal, p1y, p2y);
    }

    private static getCoord(t: number, p1: number, p2: number): number {
        return 3 * (1 - t) * (1 - t) * t * p1 + 3 * (1 - t) * t * t * p2 + t * t * t;
    }

    private static getCubicValue(t: number, p0: number, p1: number, p2: number, p3: number): number {
        return Math.pow(1 - t, 3) * p0 +
            3 * Math.pow(1 - t, 2) * t * p1 +
            3 * (1 - t) * Math.pow(t, 2) * p2 +
            Math.pow(t, 3) * p3;
    }

    private static getSlope(t: number, p1: number, p2: number): number {
        return 3 * (1 - t) * (1 - t) * p1 + 6 * (1 - t) * t * (p2 - p1) + 3 * t * t * (1 - p2);
    }

    /** Cached path splitter — avoids repeated string allocation */
    private static splitPath(path: string): string[] {
        let parts = this._pathSplitCache.get(path);
        if (!parts) {
            parts = path.split('.');
            this._pathSplitCache.set(path, parts);
        }
        return parts;
    }

    private static getObjectValue(obj: any, path: string): any {
        if (obj && obj.type === 'path' && (path === 'props.width' || path === 'props.height')) {
            const points = obj.props?.points;
            if (!Array.isArray(points) || points.length === 0) return 0;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const p of points) {
                const px = p.x || 0;
                const py = p.y || 0;
                const inX = p.inX || 0;
                const inY = p.inY || 0;
                const outX = p.outX || 0;
                const outY = p.outY || 0;

                minX = Math.min(minX, px, px + inX, px + outX);
                minY = Math.min(minY, py, py + inY, py + outY);
                maxX = Math.max(maxX, px, px + inX, px + outX);
                maxY = Math.max(maxY, py, py + inY, py + outY);
            }
            const width = (maxX - minX);
            const height = (maxY - minY);
            return path === 'props.width' ?
                (isNaN(width) || width === -Infinity || width === Infinity ? 0 : width) :
                (isNaN(height) || height === -Infinity || height === Infinity ? 0 : height);
        }
        // Use cached path split to avoid repeated string allocation
        const parts = this.splitPath(path);
        let current = obj;
        for (let i = 0; i < parts.length; i++) {
            current = current?.[parts[i]];
            if (current === undefined || current === null) return current;
        }
        return current;
    }
}
