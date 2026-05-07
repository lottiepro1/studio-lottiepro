/**
 * TextMeasurer.ts — Main-thread canvas text measurement utilities.
 *
 * Uses a hidden singleton Canvas 2D context to measure character positions,
 * selection rects, and line metrics. Mirrors CanvasRenderer.renderText() exactly
 * — same font setup, same wrapLines call, same x-origin logic — so that the
 * cursor and selection overlays align with the worker-rendered glyphs.
 */

import { SceneNode } from '../state/sceneSlice';
import { wrapLines } from './wrapLines';

let _measureCtx: CanvasRenderingContext2D | null = null;

function getMeasureCtx(): CanvasRenderingContext2D {
    if (!_measureCtx) {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        _measureCtx = canvas.getContext('2d')!;
    }
    return _measureCtx;
}

function buildFont(node: SceneNode): string {
    const fontSize = node.props.fontSize || 24;
    const fontWeight = node.props.fontWeight || '400';
    const fontFamily = node.props.fontFamily || 'Inter';
    const fontStyle = node.props.fontStyle || 'normal';
    return `${fontStyle} ${fontWeight} ${fontSize}px "${fontFamily}", sans-serif`;
}

function prepareCtx(ctx: CanvasRenderingContext2D, node: SceneNode) {
    ctx.font = buildFont(node);
    if ('letterSpacing' in ctx) {
        (ctx as any).letterSpacing = `${node.props.letterSpacing || 0}px`;
    }
}

function resetCtx(ctx: CanvasRenderingContext2D) {
    if ('letterSpacing' in ctx) {
        (ctx as any).letterSpacing = '0px';
    }
}

/**
 * Compute the x offset where this line's text STARTS in local node space.
 * Mirrors the CanvasRenderer's x + ctx.textAlign logic.
 *
 *   Area text: renderer draws at x = 0 / boxWidth/2 / boxWidth with ctx.textAlign.
 *   Point text: renderer draws at x = 0 with ctx.textAlign positioning relative to that origin.
 */
function lineXOrigin(node: SceneNode, lineWidth: number): number {
    const boxWidth = node.props.width || 0;
    const textAlign = node.props.textAlign || 'left';
    if (boxWidth > 0) {
        // Area text — canvas draws at a fixed x within the box
        if (textAlign === 'center') return (boxWidth - lineWidth) / 2;
        if (textAlign === 'right') return boxWidth - lineWidth;
        return 0; // left
    } else {
        // Point text — ctx.textAlign positions text relative to x=0
        if (textAlign === 'center') return -lineWidth / 2;
        if (textAlign === 'right') return -lineWidth;
        return 0; // left
    }
}

export interface LineMetric {
    text: string;
    startIndex: number;
    endIndex: number;
    y: number;           // top-left y in local node coords
    lineHeight: number;  // pixel height of this line
    xOrigin: number;     // left edge x of this line's text in local node coords
    lineWidth: number;   // rendered pixel width of this line (includes letter-spacing)
}

/**
 * Build per-line metrics that mirror CanvasRenderer.renderText() positioning.
 * For area text, word-wrap is applied using the same wrapLines() call.
 */
export function getLineMetrics(node: SceneNode): LineMetric[] {
    const fontSize = node.props.fontSize || 24;
    const lineHeightMul = node.props.lineHeight || 1.2;
    const lineHeightPx = fontSize * lineHeightMul;
    const verticalAlign = node.props.verticalAlign || 'top';
    const boxWidth = node.props.width || 0;
    const paragraphSpacing = node.props.paragraphSpacing || 0;
    const rawText = node.props.text || '';

    const ctx = getMeasureCtx();
    prepareCtx(ctx, node);
    const measureFn = (s: string) => ctx.measureText(s).width;
    const wrapped = wrapLines(rawText, boxWidth, measureFn);

    // Total height accounts for paragraph spacing between paragraphs
    let totalHeight = wrapped.length * lineHeightPx;
    for (let i = 1; i < wrapped.length; i++) {
        if (paragraphSpacing > 0 && wrapped[i].startIndex > 0 && rawText[wrapped[i].startIndex - 1] === '\n') {
            totalHeight += paragraphSpacing;
        }
    }

    let startY = 0;
    if (verticalAlign === 'middle') startY = -totalHeight / 2;
    else if (verticalAlign === 'bottom') startY = -totalHeight;

    let accumY = startY;
    const metrics = wrapped.map((wl, i: number) => {
        if (i > 0 && paragraphSpacing > 0 && wl.startIndex > 0 && rawText[wl.startIndex - 1] === '\n') {
            accumY += paragraphSpacing;
        }
        const lineWidth = ctx.measureText(wl.text).width;
        const metric: LineMetric = {
            text: wl.text,
            startIndex: wl.startIndex,
            endIndex: wl.endIndex,
            y: accumY,
            lineHeight: lineHeightPx,
            xOrigin: lineXOrigin(node, lineWidth),
            lineWidth,
        };
        accumY += lineHeightPx;
        return metric;
    });

    resetCtx(ctx);
    return metrics;
}

/**
 * Map a character index (into the full text string) to a local {x, y} position.
 * x is the horizontal pixel position of the cursor in local node space.
 */
export function getCharPosition(charIndex: number, node: SceneNode): { x: number; y: number } {
    const text = node.props.text || '';
    const clamped = Math.max(0, Math.min(charIndex, text.length));
    const lines = getLineMetrics(node);
    if (lines.length === 0) return { x: 0, y: 0 };

    const ctx = getMeasureCtx();
    prepareCtx(ctx, node);

    // Find the line that contains this char index
    let targetLine = lines[lines.length - 1];
    for (const line of lines) {
        if (clamped <= line.endIndex) {
            targetLine = line;
            break;
        }
    }

    const indexInLine = clamped - targetLine.startIndex;
    const charOffset = ctx.measureText(targetLine.text.slice(0, indexInLine)).width;
    resetCtx(ctx);
    return { x: targetLine.xOrigin + charOffset, y: targetLine.y };
}

/**
 * Given a click position in local node coords, return the nearest character index.
 */
export function getCharIndexAtPoint(localX: number, localY: number, node: SceneNode): number {
    const lines = getLineMetrics(node);
    if (lines.length === 0) return 0;

    const ctx = getMeasureCtx();
    prepareCtx(ctx, node);

    // Find the visual line whose row contains localY
    let targetLine = lines[lines.length - 1];
    for (const line of lines) {
        if (localY < line.y + line.lineHeight) {
            targetLine = line;
            break;
        }
    }

    // Shift localX into line-relative coords
    const localXInLine = localX - targetLine.xOrigin;

    // Find the char index whose boundary is closest to localXInLine
    const lineText = targetLine.text;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i <= lineText.length; i++) {
        const w = ctx.measureText(lineText.slice(0, i)).width;
        const dist = Math.abs(w - localXInLine);
        if (dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
        }
    }

    resetCtx(ctx);
    return targetLine.startIndex + bestIdx;
}

/**
 * Return local-space rectangles covering the selected character range [start, end).
 * One rect per visual line that has selected content.
 */
export function getSelectionRects(
    start: number,
    end: number,
    node: SceneNode,
): { x: number; y: number; width: number; height: number }[] {
    if (start === end) return [];
    const s = Math.min(start, end);
    const e = Math.max(start, end);

    const lines = getLineMetrics(node);
    const ctx = getMeasureCtx();
    prepareCtx(ctx, node);

    const rects: { x: number; y: number; width: number; height: number }[] = [];

    for (const line of lines) {
        if (e <= line.startIndex || s > line.endIndex) continue;

        const selStart = Math.max(s, line.startIndex) - line.startIndex;
        const selEnd = Math.min(e, line.endIndex) - line.startIndex;

        const xStart = line.xOrigin + ctx.measureText(line.text.slice(0, selStart)).width;
        const xEnd = line.xOrigin + ctx.measureText(line.text.slice(0, selEnd)).width;

        rects.push({ x: xStart, y: line.y, width: xEnd - xStart, height: line.lineHeight });
    }

    resetCtx(ctx);
    return rects;
}

/**
 * Return the tight local-space bounding box of a text node, accounting for font metrics,
 * letter spacing, word-wrap, paragraph spacing, and textAlign offset.
 * Uses the same measurements as getLineMetrics — so it matches what is rendered.
 * Safe to call from any main-thread code (uses the hidden measure canvas).
 */
export function getTextLocalBounds(node: SceneNode): { x: number; y: number; width: number; height: number } {
    const metrics = getLineMetrics(node);
    if (metrics.length === 0) return { x: 0, y: 0, width: 1, height: node.props.fontSize || 24 };

    let minX = Infinity;
    let maxX = -Infinity;
    for (const m of metrics) {
        minX = Math.min(minX, m.xOrigin);
        maxX = Math.max(maxX, m.xOrigin + m.lineWidth);
    }

    const first = metrics[0];
    const last = metrics[metrics.length - 1];
    return {
        x: minX,
        y: first.y,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, last.y + last.lineHeight - first.y),
    };
}
