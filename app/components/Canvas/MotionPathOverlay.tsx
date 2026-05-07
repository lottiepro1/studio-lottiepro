'use client';

import { useCreatorStore } from '@/lib/creator/state/store';
import { AnimationUtils } from '@/lib/creator/core/Animation';
import { getWorldMatrix, localToScreen } from '@/lib/creator/core/Matrix';

interface MotionPathOverlayProps {
    viewTransform: DOMMatrix;
}

export default function MotionPathOverlay({ viewTransform }: MotionPathOverlayProps) {
    const nodes = useCreatorStore((state) => state.nodes);
    const selectedIds = useCreatorStore((state) => state.selectedIds);
    const currentTime = useCreatorStore((state) => state.currentTime);
    const activeArtboardId = useCreatorStore((state) => state.activeArtboardId);

    if (selectedIds.length !== 1) return null;
    const nodeId = selectedIds[0];
    const node = nodes.get(nodeId);
    if (!node || !node.animations) return null;

    const xKfs = node.animations['transform.x'] || [];
    const yKfs = node.animations['transform.y'] || [];

    // Only show if at least one dimension has more than one keyframe, or both have at least one
    if (xKfs.length + yKfs.length < 2) return null;

    // 1. Get all unique keyframe times that define position
    const times = Array.from(new Set([
        ...xKfs.map(k => k.time),
        ...yKfs.map(k => k.time)
    ])).sort((a, b) => a - b);

    if (times.length < 2) return null;


    // 2. Determine parent coordinate system. 
    // In AE, layer parenting (parentLayerId) takes precedence over structural nesting (parentId).
    const parentIdForTransform = (node.parentLayerId && nodes.has(node.parentLayerId)) ? node.parentLayerId : node.parentId;
    const parentWorldMatrix = parentIdForTransform ? getWorldMatrix(parentIdForTransform, nodes, currentTime, activeArtboardId || undefined) : new DOMMatrix();
    const screenMatrix = viewTransform.multiply(parentWorldMatrix);

    // Helper to get position at time T (relative to parent)
    const getPosAtTime = (t: number) => {
        return {
            x: AnimationUtils.getPropertyValue(node, 'transform.x', t),
            y: AnimationUtils.getPropertyValue(node, 'transform.y', t)
        };
    };

    // Helper to get spatial handles for a segment starting at t0 and ending at t1
    // We look for spatial handles in the keyframes exactly at those times
    const getSpatialHandles = (t0: number, t1: number) => {
        const kfX0 = xKfs.find(k => k.time === t0);
        const kfX1 = xKfs.find(k => k.time === t1);
        const kfY0 = yKfs.find(k => k.time === t0);
        const kfY1 = yKfs.find(k => k.time === t1);

        return {
            out: {
                x: kfX0?.spatialOut?.x ?? 0,
                y: kfY0?.spatialOut?.y ?? 0
            },
            in: {
                x: kfX1?.spatialIn?.x ?? 0,
                y: kfY1?.spatialIn?.y ?? 0
            }
        };
    };

    const setInteraction = (interaction: any) => {
        // Find setInteraction in CanvasView/Parent usually, 
        // but here we might need to access it from the store or props.
        // Actually, I should pass it via props.
    };

    const handleMouseDownSegment = (e: React.MouseEvent, t0: number, t1: number) => {
        e.stopPropagation();
        const pMid = {
            x: (AnimationUtils.getPropertyValue(node, 'transform.x', t0) + AnimationUtils.getPropertyValue(node, 'transform.x', t1)) / 2,
            y: (AnimationUtils.getPropertyValue(node, 'transform.y', t0) + AnimationUtils.getPropertyValue(node, 'transform.y', t1)) / 2
        };

        // Transition to dragging handles for both ends
        (window as any).startMotionPathDrag?.(nodeId, t0, 'out', pMid, { x: 0, y: 0 }, { x: e.clientX, y: e.clientY }, true, t1);
    };

    const handleMouseDown = (e: React.MouseEvent, type: 'kf' | 'in' | 'out', t: number) => {
        e.stopPropagation();
        const p = getPosAtTime(t);
        const kfX = xKfs.find(k => k.time === t);
        const kfY = yKfs.find(k => k.time === t);

        let initialHandle = { x: 0, y: 0 };
        if (type === 'out') initialHandle = { x: kfX?.spatialOut?.x ?? 0, y: kfY?.spatialOut?.y ?? 0 };
        if (type === 'in') initialHandle = { x: kfX?.spatialIn?.x ?? 0, y: kfY?.spatialIn?.y ?? 0 };

        (window as any).startMotionPathDrag?.(nodeId, t, type, { x: p.x, y: p.y }, initialHandle, { x: e.clientX, y: e.clientY });
    };

    return (
        <svg
            className="absolute inset-0 z-[90]"
            style={{ overflow: 'visible', pointerEvents: 'none' }}
        >
            <g style={{ pointerEvents: 'auto' }}>
                {times.map((t, i) => {
                    if (i === times.length - 1) return null;

                    const t0 = t;
                    const t1 = times[i + 1];
                    const p0 = getPosAtTime(t0);
                    const p1 = getPosAtTime(t1);
                    const handles = getSpatialHandles(t0, t1);

                    const s0 = localToScreen(p0.x, p0.y, screenMatrix);
                    const s1 = localToScreen(p1.x, p1.y, screenMatrix);

                    const isBent = handles.out.x !== 0 || handles.out.y !== 0 || handles.in.x !== 0 || handles.in.y !== 0;

                    if (isBent) {
                        const cp0 = localToScreen(p0.x + handles.out.x, p0.y + handles.out.y, screenMatrix);
                        const cp1 = localToScreen(p1.x + handles.in.x, p1.y + handles.in.y, screenMatrix);

                        return (
                            <g key={`${nodeId}-path-${i}`}>
                                <path
                                    d={`M ${s0.x} ${s0.y} C ${cp0.x} ${cp0.y}, ${cp1.x} ${cp1.y}, ${s1.x} ${s1.y}`}
                                    fill="none"
                                    stroke="#0A84FF"
                                    strokeOpacity="0.6"
                                    strokeWidth="1.5"
                                    strokeDasharray="4 4"
                                />
                                {/* Spatial Tangent Lines */}
                                <line x1={s0.x} y1={s0.y} x2={cp0.x} y2={cp0.y} stroke="#0A84FF" strokeOpacity="0.4" strokeWidth="1" />
                                <line x1={s1.x} y1={s1.y} x2={cp1.x} y2={cp1.y} stroke="#0A84FF" strokeOpacity="0.4" strokeWidth="1" />

                                <circle
                                    cx={cp0.x} cy={cp0.y} r="4.5"
                                    fill="white"
                                    stroke="#0A84FF"
                                    strokeWidth="1.5"
                                    className="cursor-move hover:fill-[#0A84FF] transition-colors"
                                    onMouseDown={(e) => handleMouseDown(e, 'out', t0)}
                                />
                                <circle
                                    cx={cp1.x} cy={cp1.y} r="4.5"
                                    fill="white"
                                    stroke="#0A84FF"
                                    strokeWidth="1.5"
                                    className="cursor-move hover:fill-[#0A84FF] transition-colors"
                                    onMouseDown={(e) => handleMouseDown(e, 'in', t1)}
                                />
                            </g>
                        );
                    }

                    return (
                        <g key={`${nodeId}-path-${i}`}>
                            {/* Hit area for bending (invisible thicker path) */}
                            <line
                                x1={s0.x} y1={s0.y} x2={s1.x} y2={s1.y}
                                stroke="transparent"
                                strokeWidth="10"
                                className="cursor-pointer group"
                                onMouseDown={(e) => {
                                    handleMouseDownSegment(e, t0, t1);
                                }}
                            />
                            <line
                                x1={s0.x} y1={s0.y} x2={s1.x} y2={s1.y}
                                stroke="#0A84FF"
                                strokeOpacity="0.4"
                                strokeWidth="1.5"
                                strokeDasharray="4 4"
                                className="transition-opacity group-hover:stroke-opacity-100"
                            />
                        </g>

                    );
                })}

                {/* Keyframe Points (Dots) */}
                {times.map((t, i) => {
                    const p = getPosAtTime(t);
                    const s = localToScreen(p.x, p.y, screenMatrix);
                    const isCurrent = Math.abs(t - currentTime) < 0.1;

                    return (
                        <circle
                            key={`${nodeId}-kf-${i}`}
                            cx={s.x} cy={s.y} r={isCurrent ? "5.5" : "4"}
                            fill={isCurrent ? "#0A84FF" : "white"}
                            stroke="#0A84FF"
                            strokeWidth={isCurrent ? "2" : "1.5"}
                            className="cursor-move pointer-events-auto hover:r-5 transition-all"
                            onMouseDown={(e) => handleMouseDown(e, 'kf', t)}
                        />
                    );
                })}
            </g>
        </svg>
    );
}
