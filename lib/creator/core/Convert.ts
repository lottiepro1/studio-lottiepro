import { SceneNode } from '../state/sceneSlice';
import { VectorPoint } from '../tools/PenTool';

// AE/Lottie "Blurriness" → Gaussian sigma. ThorVG (dotlottie-web) renders both the
// Gaussian Blur effect (ty:29) and Drop Shadow softness with sigma = blurriness * 0.3
// (BLUR_TO_SIGMA in tvgLottieBuilder.cpp, verified at thorvg v1.0.0). Effect.blur is
// stored in AE Blurriness units end-to-end (Lottie import/export passes it through
// 1:1); convert at the boundaries: SVG stdDeviation (= sigma) imports as
// std / AE_BLUR_TO_SIGMA, and Canvas2D CSS filters (blur(px) = sigma) apply
// blur * AE_BLUR_TO_SIGMA.
export const AE_BLUR_TO_SIGMA = 0.3;

export function convertToPath(node: SceneNode): VectorPoint[] {
    if (node.type === 'path') {
        return [...(node.props.points || [])];
    }

    if (node.type === 'rect') {
        const w = node.props.width || 0;
        const h = node.props.height || 0;
        // Create points from (0,0) to (w,h) to match rect's local coordinate system
        // Rect is drawn from (0,0) to (width, height) in local space
        return [
            { x: 0, y: 0, inX: 0, inY: 0, outX: 0, outY: 0 },
            { x: w, y: 0, inX: 0, inY: 0, outX: 0, outY: 0 },
            { x: w, y: h, inX: 0, inY: 0, outX: 0, outY: 0 },
            { x: 0, y: h, inX: 0, inY: 0, outX: 0, outY: 0 },
        ];
    }

    if (node.type === 'ellipse') {
        const rx = node.props.radiusX || 0;
        const ry = node.props.radiusY || 0;
        const K = 0.552284749831;
        // Ellipse is drawn with center at (radiusX, radiusY) in local space
        // So points should be centered there too
        const cx = rx;
        const cy = ry;

        return [
            { x: cx, y: cy - ry, inX: -rx * K, inY: 0, outX: rx * K, outY: 0 },
            { x: cx + rx, y: cy, inX: 0, inY: -ry * K, outX: 0, outY: ry * K },
            { x: cx, y: cy + ry, inX: rx * K, inY: 0, outX: -rx * K, outY: 0 },
            { x: cx - rx, y: cy, inX: 0, inY: ry * K, outX: 0, outY: -ry * K },
        ];
    }

    if (node.type === 'polystar') {
        const { PathUtils } = require('./PathUtils');
        return PathUtils.generatePolystarPoints(
            node.props?.points ?? 5,
            node.props?.innerRadius ?? 25,
            node.props?.outerRadius ?? 50,
            node.props?.innerRoundness ?? 0,
            node.props?.outerRoundness ?? 0,
            (node.props?.starType === 'polygon' || node.props?.starType === 2) ? 'polygon' : 'star'
        );
    }

    return [];
}
