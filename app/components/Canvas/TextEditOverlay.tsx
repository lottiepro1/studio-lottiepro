'use client';

/**
 * TextEditOverlay.tsx — Canvas-aligned cursor and selection highlight overlay.
 *
 * Absolutely positioned over the canvas container (pointer-events: none).
 * Draws cursor blink and selection rectangles as HTML divs, positioned using
 * the same world matrix math as CanvasRenderer so they align pixel-perfectly
 * with the worker-rendered text glyphs.
 *
 * Local coords (artboard pixels) → screen coords via viewTransform * worldMatrix.
 * Scale (zoom) is already baked into the combined matrix, so we just use
 * localToScreen() for every point.
 */

import { useEffect, useRef, useState } from 'react';
import { SceneNode } from '@/lib/creator/state/sceneSlice';
import { TextEditState } from '@/lib/creator/text/TextCursor';
import { getCharPosition, getSelectionRects, getTextLocalBounds } from '@/lib/creator/text/TextMeasurer';
import { getWorldMatrix, localToScreen } from '@/lib/creator/core/Matrix';

interface Props {
    textEditState: TextEditState;
    node: SceneNode;
    nodes: Map<string, SceneNode>;
    viewTransform: DOMMatrix;
    currentTime: number;
    activeArtboardId: string | null;
}

export default function TextEditOverlay({
    textEditState,
    node,
    nodes,
    viewTransform,
    currentTime,
    activeArtboardId,
}: Props) {
    const [cursorVisible, setCursorVisible] = useState(true);
    const blinkRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Reset blink and make cursor visible whenever the cursor moves or selection changes
    useEffect(() => {
        setCursorVisible(true);
        if (blinkRef.current) clearInterval(blinkRef.current);
        blinkRef.current = setInterval(() => setCursorVisible(v => !v), 530);
        return () => {
            if (blinkRef.current) clearInterval(blinkRef.current);
        };
    }, [textEditState.cursorIndex, textEditState.selectionStart, textEditState.selectionEnd]);

    // Combined transform: viewTransform * worldMatrix maps local → screen
    const worldMatrix = getWorldMatrix(
        textEditState.nodeId,
        nodes,
        currentTime,
        activeArtboardId ?? undefined,
    );
    const combined = viewTransform.multiply(worldMatrix);

    // Rotation angle from the combined matrix (for div transform)
    const angleDeg = Math.atan2(combined.b, combined.a) * (180 / Math.PI);

    // Scale factor (zoom * node scale) — used for sizing cursor and selection rects
    const scaleX = Math.hypot(combined.a, combined.b);
    const scaleY = Math.hypot(combined.c, combined.d);

    // Cursor position in local coords → screen coords
    const cursorLocal = getCharPosition(textEditState.cursorIndex, node);
    const cursorScreen = localToScreen(cursorLocal.x, cursorLocal.y, combined);

    // Cursor height = one line in screen pixels
    const lineHeightLocal = (node.props.fontSize || 24) * (node.props.lineHeight || 1.2);
    const cursorHeightScreen = lineHeightLocal * scaleY;
    const cursorWidthPx = Math.max(1.5, 1.5 / scaleX); // always ~1.5 screen px

    // Selection rectangles in local coords
    const selRects = getSelectionRects(
        textEditState.selectionStart,
        textEditState.selectionEnd,
        node,
    );

    // Live bounding box — shows the extent of the current text content as the user types.
    // Uses textEditState.text so the box always reflects what's been typed, not the
    // (potentially stale) node prop.
    const liveText = textEditState.text;
    const boundsNode = liveText
        ? { ...node, props: { ...node.props, text: liveText } }
        : null;
    const textBounds = boundsNode ? getTextLocalBounds(boundsNode) : null;
    const boundsTL = textBounds ? localToScreen(textBounds.x, textBounds.y, combined) : null;

    return (
        <div className="absolute inset-0 pointer-events-none z-[99]">
            {/* Live bounding box outline — expands as text is typed */}
            {textBounds && boundsTL && (
                <div
                    className="absolute"
                    style={{
                        left: boundsTL.x,
                        top: boundsTL.y,
                        width: textBounds.width * scaleX,
                        height: textBounds.height * scaleY,
                        transform: `rotate(${angleDeg}deg)`,
                        transformOrigin: '0 0',
                        border: '1px solid rgba(59, 130, 246, 0.75)',
                        boxSizing: 'border-box',
                        pointerEvents: 'none',
                    }}
                />
            )}

            {/* Selection highlight rects */}
            {selRects.map((rect, i) => {
                const tl = localToScreen(rect.x, rect.y, combined);
                return (
                    <div
                        key={i}
                        className="absolute"
                        style={{
                            left: tl.x,
                            top: tl.y,
                            width: rect.width * scaleX,
                            height: rect.height * scaleY,
                            transform: `rotate(${angleDeg}deg)`,
                            transformOrigin: '0 0',
                            backgroundColor: 'rgba(59, 130, 246, 0.35)',
                        }}
                    />
                );
            })}

            {/* Blinking cursor line */}
            {cursorVisible && (
                <div
                    className="absolute"
                    style={{
                        left: cursorScreen.x,
                        top: cursorScreen.y,
                        width: cursorWidthPx,
                        height: cursorHeightScreen,
                        transform: `rotate(${angleDeg}deg)`,
                        transformOrigin: '0 0',
                        backgroundColor: 'white',
                        mixBlendMode: 'difference',
                    }}
                />
            )}

            {/* IME composition underline */}
            {textEditState.composing && textEditState.compositionText && (() => {
                // Underline spans the composition text from the cursor anchor
                const anchorIdx = Math.min(textEditState.selectionStart, textEditState.selectionEnd);
                const compRects = getSelectionRects(
                    anchorIdx,
                    anchorIdx + textEditState.compositionText.length,
                    { ...node, props: { ...node.props, text: textEditState.text } },
                );
                return compRects.map((rect, i) => {
                    const tl = localToScreen(rect.x, rect.y + rect.height - 2 / scaleY, combined);
                    return (
                        <div
                            key={`comp-${i}`}
                            className="absolute"
                            style={{
                                left: tl.x,
                                top: tl.y,
                                width: rect.width * scaleX,
                                height: 2,
                                transform: `rotate(${angleDeg}deg)`,
                                transformOrigin: '0 0',
                                backgroundColor: 'white',
                                opacity: 0.8,
                            }}
                        />
                    );
                });
            })()}
        </div>
    );
}
