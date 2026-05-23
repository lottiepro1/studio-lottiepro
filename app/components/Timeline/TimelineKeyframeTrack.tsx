'use client';

import { useMemo, useState, useRef, memo } from 'react';
import { useCreatorStore } from '@/lib/creator/state/store';
import { SceneNode } from '@/lib/creator/state/sceneSlice';
import { AnimationUtils } from '@/lib/creator/core/Animation';

interface TimelineKeyframeTrackProps {
    node: SceneNode;
    depth?: number;
    rowHeight: number;
    pixelsPerFrame: number;
    isExpanded: boolean;
    propertyGroups: any[];
    onSelect: (nodeId: string, isShift: boolean, isCtrl: boolean) => void;
}

const EMPTY_ARRAY: string[] = [];

const TimelineKeyframeTrack = memo(function TimelineKeyframeTrack({
    node,
    depth = 0,
    rowHeight,
    pixelsPerFrame,
    isExpanded,
    propertyGroups,
    onSelect
}: TimelineKeyframeTrackProps) {
    const currentTime = useCreatorStore((state) => state.currentTime);
    const selectedKeyframeIds = useCreatorStore((state) => state.selectedKeyframeIds);
    const selectKeyframes = useCreatorStore((state) => state.selectKeyframes);
    const updateKeyframe = useCreatorStore((state) => state.updateKeyframe);
    const trackVisibility = useCreatorStore((state) => state.trackVisibility[node.id]) || EMPTY_ARRAY;
    const selectedIds = useCreatorStore((state) => state.selectedIds);
    const setSelection = useCreatorStore((state) => state.setSelection);
    const expandedShapeGroups = useCreatorStore((state) => state.expandedShapeGroups);

    const isSelected = selectedIds.includes(node.id);

    // Adapt property groups for different node types (Size vs Scale)
    const adaptedGroups = useMemo(() => {
        return propertyGroups.map(group => {
            // Custom filtering for Image nodes
            if (node.type === 'image') {
                const allowed = ['Position', 'Scale', 'Rotation', 'Opacity'];
                if (!allowed.includes(group.label)) return null;
            }

            if (group.label === 'Size') {
                if (node.type === 'ellipse') {
                    return {
                        ...group,
                        label: 'Radius',
                        mainPath: 'props.radiusX',
                        props: [
                            { label: 'X', path: 'props.radiusX', displayFactor: 2 },
                            { label: 'Y', path: 'props.radiusY', displayFactor: 2 }
                        ]
                    };
                }
                if (node.type !== 'rect' && node.type !== 'artboard' && node.type !== 'path') return null;
            }

            // Ensure Path group is shown for path types and primitive shapes
            if (group.label === 'Path' && !(node.type === 'path' || node.type === 'rect' || node.type === 'ellipse')) {
                return null;
            }

            // Only show Trim properties for shape types, groups, and precomps
            if (group.label.startsWith('Trim') && !(node.type === 'rect' || node.type === 'ellipse' || node.type === 'path' || node.type === 'group' || node.type === 'precomp')) {
                return null;
            }

            if (group.label === 'Roundness' && (node.type !== 'rect' && node.type !== 'path')) {
                return null;
            }

            return group;
        }).filter(Boolean);
    }, [propertyGroups, node.type]);

    const visibleGroups = useMemo(() => {
        // Shortcuts (trackVisibility) SOLO the view.
        if (trackVisibility.length > 0) {
            return adaptedGroups.filter(g => trackVisibility.includes(g.mainPath));
        }
        // If NO shortcuts, and node is expanded manually, show everything.
        if (isExpanded) {
            return adaptedGroups;
        }
        // Otherwise hide everything.
        return [];
    }, [adaptedGroups, trackVisibility, isExpanded]);

    const renderGroupKeyframes = (paths: string[]) => {
        // Collect all keyframes from all paths in this group
        const allKeyframes: { time: number, entries: { path: string, kf: any }[] }[] = [];

        paths.forEach(path => {
            const kfs = node.animations?.[path] || [];
            kfs.forEach(kf => {
                let bucket = allKeyframes.find(b => b.time === kf.time);
                if (!bucket) {
                    bucket = { time: kf.time, entries: [] };
                    allKeyframes.push(bucket);
                }
                bucket.entries.push({ path, kf });
            });
        });

        return allKeyframes.map((bucket) => {
            const globalIds = bucket.entries.map(e => `${node.id}:${e.path}:${e.kf.id}`);
            const isAnySelected = globalIds.some(id => selectedKeyframeIds.includes(id));
            const isEased = bucket.entries.some(e => e.kf.easing && e.kf.easing !== 'linear');

            return (
                <div
                    key={bucket.time}
                    className="absolute top-0 bottom-0 flex items-center justify-center cursor-grab active:cursor-grabbing group/kf z-10"
                    style={{ left: bucket.time * pixelsPerFrame, width: 20, transform: 'translateX(-50%)' }}
                    onMouseDown={(e) => {
                        e.stopPropagation();
                        // If clicking a keyframe that isn't selected, select it (or add to selection with Shift)
                        // If it's already selected, don't change selection yet to allow dragging group
                        const isAlreadySelected = globalIds.every(id => selectedKeyframeIds.includes(id));
                        if (!isAlreadySelected || e.shiftKey) {
                            selectKeyframes(globalIds, e.shiftKey);
                        }

                        const startX = e.clientX;
                        const startTime = bucket.time;
                        let moved = false;
                        let hasRecordedHistory = false;

                        // Capture initial times of ALL selected keyframes
                        const selectedKfsSnapshot = useCreatorStore.getState().selectedKeyframeIds.map(id => {
                            const [nId, path, kfId] = id.split(':');
                            const node = useCreatorStore.getState().nodes.get(nId);
                            const kf = node?.animations?.[path]?.find((k: any) => k.id === kfId);
                            return { id, nodeId: nId, path, kfId, initialTime: kf?.time ?? 0 };
                        });

                        const onMouseMove = (moveE: MouseEvent) => {
                            const deltaX = moveE.clientX - startX;
                            if (Math.abs(deltaX) > 2) moved = true;

                            if (moved) {
                                if (!hasRecordedHistory) {
                                    useCreatorStore.getState().pushToHistory('Move Keyframes');
                                    hasRecordedHistory = true;
                                }
                                const deltaFrames = Math.round(deltaX / pixelsPerFrame);

                                // Move ALL selected keyframes based on their unique initial times
                                selectedKfsSnapshot.forEach(item => {
                                    const newTime = Math.max(0, item.initialTime + deltaFrames);
                                    updateKeyframe(item.nodeId, item.path, item.kfId, {
                                        time: newTime
                                    });
                                });
                            }
                        };

                        const onMouseUp = () => {
                            window.removeEventListener('mousemove', onMouseMove);
                            window.removeEventListener('mouseup', onMouseUp);
                        };
                        window.addEventListener('mousemove', onMouseMove);
                        window.addEventListener('mouseup', onMouseUp);
                    }}
                >
                    {isEased ? (
                        /* Sandglass shape for eased keyframes (AE Style) */
                        <div className={`w-3 h-3 flex flex-col items-center justify-center transition-all ${isAnySelected ? 'scale-110' : 'scale-90'}`}>
                            <div className={`w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[4px] ${isAnySelected ? 'border-t-accent' : 'border-t-white/60 group-hover/kf:border-t-white'}`} />
                            <div className={`w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-b-[4px] -mt-[1.5px] ${isAnySelected ? 'border-b-accent' : 'border-b-white/60 group-hover/kf:border-b-white'}`} />
                        </div>
                    ) : (
                        /* Diamond shape for linear keyframes */
                        <div className={`w-2 h-2 rotate-45 border-[1.5px] transition-all z-20 ${isAnySelected
                            ? 'bg-accent border-accent/60 scale-125'
                            : bucket.time === currentTime
                                ? 'bg-white border-white'
                                : 'bg-[#101014] border-white/40 group-hover/kf:border-white/80'
                            }`} />
                    )}
                </div>
            );
        });
    };

    const updateNode = useCreatorStore((state) => state.updateNode);
    const shiftLayers = useCreatorStore((state) => state.shiftLayers);

    const [isBlinking, setIsBlinking] = useState(false);
    const blinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const triggerLockBlink = () => {
        if (blinkTimer.current) clearTimeout(blinkTimer.current);
        setIsBlinking(true);
        blinkTimer.current = setTimeout(() => setIsBlinking(false), 700);
    };

    const handleBarMouseDown = (e: React.MouseEvent, type: 'shift' | 'trim-in' | 'trim-out') => {
        e.stopPropagation();
        if (node.locked) { triggerLockBlink(); return; }
        onSelect(node.id, e.shiftKey, e.ctrlKey || e.metaKey);

        const startX = e.clientX;
        const initialIn = node.inPoint;
        const initialOut = node.outPoint;
        let lastDf = 0;
        let hasRecordedHistory = false;

        const onMouseMove = (moveE: MouseEvent) => {
            const dx = moveE.clientX - startX;
            const df = Math.round(dx / pixelsPerFrame);

            if (df === lastDf) return;
            const stepDf = df - lastDf;
            lastDf = df;

            if (!hasRecordedHistory) {
                useCreatorStore.getState().pushToHistory(
                    type === 'shift' ? 'Shift Layer' : 'Trim Layer'
                );
                hasRecordedHistory = true;
            }

            if (type === 'shift') {
                const selectedIds = useCreatorStore.getState().selectedIds;
                const targetIds = selectedIds.includes(node.id) ? selectedIds : [node.id];
                shiftLayers(targetIds, stepDf);
            } else if (type === 'trim-in') {
                updateNode(node.id, {
                    inPoint: Math.min(initialOut - 1, initialIn + df)
                });
            } else if (type === 'trim-out') {
                updateNode(node.id, {
                    outPoint: Math.max(initialIn + 1, initialOut + df)
                });
            }
        };

        const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = 'default';
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);

        if (type === 'shift') document.body.style.cursor = 'grabbing';
        else document.body.style.cursor = 'ew-resize';
    };

    // Track bar: selected = lighter grey, unselected = grey. Keyframe indicator lives on sidebar '+' button.
    const barBg = isSelected ? '#ACB0B8' : '#808B9D';

    return (
        <div data-track-id={node.id} className="flex flex-col">
            {/* Node Main Row - Layer Bar */}
            <div
                className="relative group/row"
                style={{ height: rowHeight }}
            >
                {/* Visual bar — spans in-point to out-point */}
                {depth === 0 && (
                    <div
                        className={`absolute top-[2px] bottom-[2px] rounded-[4px] flex items-center cursor-grab active:cursor-grabbing hover:opacity-90${isBlinking ? ' layer-locked-blink' : ' transition-opacity duration-150'}`}
                        style={{
                            left: node.inPoint * pixelsPerFrame,
                            width: Math.max(4, (node.outPoint - node.inPoint) * pixelsPerFrame),
                            background: isBlinking ? undefined : barBg,
                        }}
                        onMouseDown={(e) => handleBarMouseDown(e, 'shift')}
                    >
                        {/* Trim handles */}
                        <div
                            className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize rounded-l-[4px] hover:bg-black/20"
                            onMouseDown={(e) => { e.stopPropagation(); handleBarMouseDown(e, 'trim-in'); }}
                        />
                        <div
                            className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize rounded-r-[4px] hover:bg-black/20"
                            onMouseDown={(e) => { e.stopPropagation(); handleBarMouseDown(e, 'trim-out'); }}
                        />
                    </div>
                )}
            </div>

            {/* Property Rows */}
            {(() => {
                const isSolo = trackVisibility.length > 0;

                // Function to filter out groups without keyframes to match sidebar synchronization
                const getAnimatedGroups = (groups: any[]) => {
                    return groups.filter(group => group.props.some((p: any) => !!node.animations?.[p.path]));
                };

                const coreGroups = getAnimatedGroups(visibleGroups).filter(g => ['Position', 'Scale', 'Rotation', 'Opacity'].includes(g.label));
                const shapeGroups = getAnimatedGroups(adaptedGroups).filter(g => !['Position', 'Scale', 'Rotation', 'Opacity'].includes(g.label));

                const isShapeGroupExpanded = expandedShapeGroups[node.id];

                const renderGroupTrack = (group: any) => (
                    <div
                        key={group.mainPath}
                        className="relative"
                        style={{ height: rowHeight, background: 'rgba(221,234,248,0.03)', borderRadius: 4 }}
                    >
                        {renderGroupKeyframes(group.props.map((p: any) => p.path))}
                    </div>
                );

                if (isSolo) {
                    return visibleGroups.map(renderGroupTrack);
                }

                if (!isExpanded) return null;

                return (
                    <>
                        {coreGroups.map(renderGroupTrack)}

                        {shapeGroups.length > 0 && (
                            <>
                                {/* Group header row — empty spacer in keyframe area */}
                                <div
                                    className="relative"
                                    style={{ height: rowHeight, background: 'rgba(221,234,248,0.03)', borderRadius: 4 }}
                                />
                                {isShapeGroupExpanded && shapeGroups.map(renderGroupTrack)}
                            </>
                        )}
                    </>
                );
            })()}
        </div>
    );
});

export default TimelineKeyframeTrack;
