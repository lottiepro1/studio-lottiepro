'use client';

import { useMemo, useState, useEffect, useRef, memo } from 'react';
import { useCreatorStore } from '@/lib/creator/state/store';
import { ChevronRight, ChevronDown, Timer, Link2, Box, Circle, Layers, Diamond, Link as LinkIcon, HardDrive, Plus, X, Folder, Image as ImageIcon, Zap, Star, Layout, Component } from 'lucide-react';
import { AnimationUtils } from '@/lib/creator/core/Animation';
import { SceneNode } from '@/lib/creator/state/sceneSlice';
import { getWorldMatrix, decomposeMatrix } from '@/lib/creator/core/Matrix';
import { convertToPath } from '@/lib/creator/core/Convert';

interface TimelineSidebarTrackProps {
    node: SceneNode;
    depth: number;
    rowHeight: number;
    isExpanded: boolean;
    onToggleExpand: () => void;
    onSelect: (isShift: boolean, isCtrl: boolean) => void;
    propertyGroups: any[];
}

const EMPTY_ARRAY: string[] = [];

const TimelineSidebarTrack = memo(function TimelineSidebarTrack({
    node,
    depth,
    rowHeight,
    isExpanded,
    onToggleExpand,
    onSelect,
    propertyGroups
}: TimelineSidebarTrackProps) {
    const currentTime = useCreatorStore((state) => state.currentTime);
    const toggleStopwatch = useCreatorStore((state) => state.toggleStopwatch);
    const selectedIds = useCreatorStore((state) => state.selectedIds);
    const setSelection = useCreatorStore((state) => state.setSelection);
    const setNodeProperty = useCreatorStore((state) => state.setNodeProperty);
    const trackVisibility = useCreatorStore((state) => state.trackVisibility[node.id]) || EMPTY_ARRAY;
    const moveNode = useCreatorStore((state) => state.moveNode);
    const parentNode = useCreatorStore((state) => node.parentId ? state.nodes.get(node.parentId) : null);
    const updateNode = useCreatorStore((state) => state.updateNode);
    const setEditingNode = useCreatorStore((state) => state.setEditingNode);
    const expandedShapeGroups = useCreatorStore((state) => state.expandedShapeGroups);
    const toggleShapeGroupExpand = useCreatorStore((state) => state.toggleShapeGroupExpand);
    const addKeyframe = useCreatorStore((state) => state.addKeyframe);

    const [dropPosition, setDropPosition] = useState<'before' | 'after' | 'inside' | null>(null);
    const itemRef = useRef<HTMLDivElement>(null);
    const [isAnimateMenuOpen, setIsAnimateMenuOpen] = useState(false);
    const [animateMenuPos, setAnimateMenuPos] = useState({ x: 0, y: 0 });
    const [isAnimateMoreOpen, setIsAnimateMoreOpen] = useState(false);
    const animateMenuRef = useRef<HTMLDivElement>(null);

    // Draggable popup logic
    const handleDragStartPopup = (e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();

        const startMouseX = e.clientX;
        const startMouseY = e.clientY;
        const startPopupX = animateMenuPos.x;
        const startPopupY = animateMenuPos.y;

        const handleDrag = (moveEvent: MouseEvent) => {
            setAnimateMenuPos({
                x: startPopupX + (moveEvent.clientX - startMouseX),
                y: startPopupY + (moveEvent.clientY - startMouseY)
            });
        };

        const handleDragEnd = () => {
            document.removeEventListener('mousemove', handleDrag);
            document.removeEventListener('mouseup', handleDragEnd);
        };

        document.addEventListener('mousemove', handleDrag);
        document.addEventListener('mouseup', handleDragEnd);
    };

    // Click outside to close (only if not dragging)
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (isAnimateMenuOpen && animateMenuRef.current && !animateMenuRef.current.contains(e.target as Node)) {
                // Determine if click was inside the trigger button to prevent immediate re-opening
                const target = e.target as Element;
                if (!target.closest('[data-animate-trigger="true"]')) {
                    setIsAnimateMenuOpen(false);
                }
            }
        };

        if (isAnimateMenuOpen) {
            document.addEventListener('mousedown', handleClickOutside);

            // Boundary check and adjustment after opening/expanding
            const adjustPosition = () => {
                if (!animateMenuRef.current) return;
                const rect = animateMenuRef.current.getBoundingClientRect();
                const padding = 10;
                let moved = false;
                let newX = animateMenuPos.x;
                let newY = animateMenuPos.y;

                if (rect.right > window.innerWidth - padding) {
                    newX = window.innerWidth - rect.width - padding;
                    moved = true;
                }
                if (rect.bottom > window.innerHeight - padding) {
                    newY = window.innerHeight - rect.height - padding;
                    moved = true;
                }
                if (rect.left < padding) {
                    newX = padding;
                    moved = true;
                }
                if (rect.top < padding) {
                    newY = padding;
                    moved = true;
                }

                if (moved) {
                    setAnimateMenuPos({ x: newX, y: newY });
                }
            };

            // Small delay to allow DOM to update height if needed
            const timeout = setTimeout(adjustPosition, 0);
            return () => {
                document.removeEventListener('mousedown', handleClickOutside);
                clearTimeout(timeout);
            };
        }
    }, [isAnimateMenuOpen, isAnimateMoreOpen]);

    const isSelected = selectedIds.includes(node.id);

    const adaptedGroups = useMemo(() => {
        return propertyGroups.map(g => {
            // Custom filtering for Image nodes
            if (node.type === 'image') {
                const allowed = ['Position', 'Scale', 'Rotation', 'Opacity'];
                if (!allowed.includes(g.label)) return null;
            }

            // Adapt 'Size' group based on node type
            if (g.label === 'Size') {
                if (node.type === 'rect' || node.type === 'artboard' || node.type === 'path') {
                    return g;
                } else if (node.type === 'ellipse') {
                    return {
                        ...g,
                        mainPath: 'props.radiusX',
                        props: [
                            { label: 'W', path: 'props.radiusX', displayFactor: 2 },
                            { label: 'H', path: 'props.radiusY', displayFactor: 2 }
                        ]
                    };
                }
                return null;
            }

            // Ensure Path group is shown for path types and primitive shapes (for direct conversion)
            if (g.label === 'Path' && !(node.type === 'path' || node.type === 'rect' || node.type === 'ellipse')) {
                return null;
            }

            // Only show Trim properties for shape types, groups, and precomps
            if (g.label.startsWith('Trim') && !(node.type === 'rect' || node.type === 'ellipse' || node.type === 'path' || node.type === 'group' || node.type === 'precomp')) {
                return null;
            }

            if (g.label === 'Roundness' && (node.type !== 'rect' && node.type !== 'path')) {
                return null;
            }

            return g;
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

    // Drag and Drop Handlers
    const onDragStart = (e: React.DragEvent) => {
        e.dataTransfer.setData('nodeId', node.id);
        e.dataTransfer.effectAllowed = 'move';
        if (itemRef.current) {
            itemRef.current.style.opacity = '0.5';
        }
    };

    const onDragEnd = (e: React.DragEvent) => {
        if (itemRef.current) {
            itemRef.current.style.opacity = '1';
        }
        setDropPosition(null);
    };

    const onDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        if (!itemRef.current) return;

        const rect = itemRef.current.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const height = rect.height;

        // In timeline we mostly care about before/after for horizontal reordering in list
        // but it's vertical here. 
        if (node.type === 'group' || node.type === 'artboard') {
            if (y < height * 0.25) setDropPosition('before');
            else if (y > height * 0.75) setDropPosition('after');
            else setDropPosition('inside');
        } else {
            if (y < height / 2) setDropPosition('before');
            else setDropPosition('after');
        }
    };

    const onDragLeave = () => {
        setDropPosition(null);
    };

    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        const draggedId = e.dataTransfer.getData('nodeId');
        if (!draggedId || draggedId === node.id) {
            setDropPosition(null);
            return;
        }

        const storeNodes = useCreatorStore.getState().nodes;
        const draggedNode = storeNodes.get(draggedId);
        if (!draggedNode) return;

        // Prevent dropping a parent into its own child
        let currentParentId = node.parentId;
        while (currentParentId) {
            if (currentParentId === draggedId) {
                setDropPosition(null);
                return;
            }
            currentParentId = storeNodes.get(currentParentId)?.parentId || null;
        }

        if (dropPosition === 'inside') {
            moveNode(draggedId, node.id, node.children.length); // Place at top of collection
        } else {
            const parentId = node.parentId;
            if (parentId) {
                const parent = storeNodes.get(parentId);
                if (parent) {
                    const currentIndex = parent.children.indexOf(node.id);
                    // UI is reversed: 'before' (above) => higher index, 'after' (below) => lower index
                    const targetIndex = dropPosition === 'before' ? currentIndex + 1 : currentIndex;
                    moveNode(draggedId, parentId, targetIndex);
                }
            }
        }

        setDropPosition(null);
    };

    const handleSetParent = (parentId: string | null) => {
        const state = useCreatorStore.getState();
        const targets = isSelected ? selectedIds : [node.id];

        const storeNodes = state.nodes;
        state.pushToHistory(`Parent ${targets.length > 1 ? 'Selected Layers' : node.name} to ${parentId ? storeNodes.get(parentId)?.name : 'None'}`);

        targets.forEach(id => {
            const targetNode = storeNodes.get(id);
            if (!targetNode || id === parentId) return;

            // Calculate relative transform so layer doesn't jump
            const childWorld = getWorldMatrix(id, storeNodes, currentTime);
            const newParentWorld = parentId ? getWorldMatrix(parentId, storeNodes, currentTime) : new DOMMatrix();

            const relativeMatrix = newParentWorld.inverse().multiply(childWorld);
            const decomp = decomposeMatrix(relativeMatrix, { x: targetNode.transform.anchorX, y: targetNode.transform.anchorY });

            state.updateNode(id, {
                parentLayerId: parentId || undefined,
                transform: {
                    ...targetNode.transform,
                    x: decomp.x,
                    y: decomp.y,
                    rotation: decomp.rotation,
                    scaleX: decomp.scaleX,
                    scaleY: decomp.scaleY
                }
            });
        });
    };

    // Get list of potential parents (excluding self and descendants)
    const potentialParents = useMemo(() => {
        const ns = useCreatorStore.getState().nodes;
        const isDescendantOfSelf = (potentialParentId: string): boolean => {
            let current = ns.get(potentialParentId);
            while (current && current.parentLayerId) {
                if (current.parentLayerId === node.id) return true;
                current = ns.get(current.parentLayerId);
            }
            return false;
        };

        return Array.from(ns.values())
            .filter(n =>
                n.type !== 'artboard' &&
                n.id !== node.id &&
                !isDescendantOfSelf(n.id)
            )
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [node.id]);

    return (
        <div data-track-id={node.id} className="flex flex-col border-b border-white/[0.02]">
            <div
                ref={itemRef}
                draggable={node.type !== 'artboard'}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                className={`flex items-center group transition-all duration-200 cursor-default relative border-b border-white/[0.04] ${isSelected ? 'bg-accent/10' : 'hover:bg-white/[0.04]'} ${dropPosition === 'inside' ? 'bg-accent/15' : ''}`}
                style={{ height: rowHeight }}
                onMouseDownCapture={(e) => {
                    const target = e.target as HTMLElement;
                    // If clicking inside the animate popup, don't hijack the event
                    if (target.closest('.animate-popup')) {
                        return;
                    }

                    // Start selection
                    e.stopPropagation();
                    const isInteractive = target.closest('button') || target.closest('select') || target.closest('input');

                    // If clicking interactive element on a node that is ALREADY part of selection, 
                    // DON'T run onSelect (which would reset selection to just this one node)
                    if (isInteractive && isSelected) {
                        return;
                    }

                    onSelect(e.shiftKey, e.ctrlKey || e.metaKey);
                }}
            >
                {/* Indentation Line Guide (Figma Style) */}
                {depth > 0 && (
                    <div
                        className={`absolute left-0 top-0 bottom-0 border-l transition-colors duration-300 ${isSelected ? 'border-accent/30' : 'border-white/[0.08]'}`}
                        style={{
                            left: `${depth * 12 + 18}px`,
                            height: '100%'
                        }}
                    />
                )}

                {/* Refined Drop Indicators (Figma Style) */}
                {(dropPosition === 'before' || dropPosition === 'after') && (
                    <div
                        className={`absolute left-0 right-0 h-[2px] bg-accent z-[100] pointer-events-none ${dropPosition === 'before' ? 'top-0' : 'bottom-0'}`}
                    >
                        {/* Dot at the start of the line */}
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[6px] h-[6px] rounded-full bg-accent " />
                    </div>
                )}

                <div
                    className="flex items-center px-3 w-full h-full gap-2"
                    style={{ paddingLeft: `${depth * 12 + 8}px` }}
                >
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleExpand();
                        }}
                        className={`p-1 rounded-md transition-all ${isExpanded ? 'text-white/60' : 'text-white/20 hover:text-white/60 hover:bg-white/10'}`}
                    >
                        {isExpanded ? <ChevronDown size={12} strokeWidth={3} /> : <ChevronRight size={12} strokeWidth={3} />}
                    </button>

                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                        <div className={`shrink-0 w-5 h-5 rounded flex items-center justify-center transition-all duration-300 ${isSelected
                                ? 'bg-white/20 shadow-[0_0_10px_rgba(255,255,255,0.1)]'
                                : 'bg-white/[0.03] group-hover:bg-white/10'
                            }`}>
                            {(() => {
                                const isTopLevel = parentNode?.type === 'artboard' || !parentNode;

                                if (node.type === 'artboard') return <Layout size={12} className="text-blue-400" />;
                                if (node.type === 'group') {
                                    if (isTopLevel) return <Layers size={12} className="text-orange-400 drop-shadow-[0_0_3px_rgba(251,146,60,0.4)]" />;
                                    return <Folder size={11} className="text-amber-400/80" />;
                                }
                                if (node.type === 'rect') return <Box size={12} className="text-accent" />;
                                if (node.type === 'ellipse') return <Circle size={12} className="text-purple-400" />;
                                if (node.type === 'path') return <Star size={11} strokeWidth={2.5} className="text-emerald-400" />;
                                if (node.type === 'image') return <ImageIcon size={11} className="text-cyan-400" />;
                                if (node.type === 'precomp') return <Zap size={11} className="text-indigo-400" />;

                                return <Layers size={12} className="text-white/40" />;
                            })()}
                        </div>
                        <span className={`text-[11px] font-medium truncate transition-colors ${isSelected ? 'text-primary' : 'text-secondary group-hover:text-primary'}`}>{node.name}</span>

                        {/* Matte indicators */}
                        {node.matteTargetIds && node.matteTargetIds.length > 0 && (
                            <span className="text-[8px] text-purple-400/80 bg-purple-500/10 px-1.5 py-0.5 rounded uppercase tracking-wider">Mask</span>
                        )}
                        {node.matteSourceId && (
                            <span className="text-[8px] text-cyan-400/80 bg-cyan-500/10 px-1.5 py-0.5 rounded uppercase tracking-wider">Clipped</span>
                        )}
                    </div>

                    {/* Parenting Dropdown (AE Style) */}
                    <div className="shrink-0 flex items-center gap-1.5 border-l border-white/5 pl-3 ml-2">
                        <div className="flex items-center group/parent relative">
                            <LinkIcon size={10} className={`transition-colors ${node.parentLayerId ? 'text-accent' : 'text-white/10 group-hover/parent:text-white/40'}`} />
                            <select
                                value={node.parentLayerId || ""}
                                onChange={(e) => handleSetParent(e.target.value || null)}
                                className="appearance-none bg-transparent text-[10px] font-bold text-white/30 hover:text-white/70 outline-none cursor-pointer pl-1 pr-4 max-w-[80px] truncate"
                            >
                                <option value="" className="bg-[#18181b]">None</option>
                                {potentialParents.map(p => (
                                    <option key={p.id} value={p.id} className="bg-[#18181b]">{p.name}</option>
                                ))}
                            </select>
                            <div className="absolute right-0 pointer-events-none opacity-20">
                                <ChevronDown size={8} />
                            </div>
                        </div>
                        <button
                            data-animate-trigger="true"
                            onClick={(e) => {
                                e.stopPropagation();
                                if (!isAnimateMenuOpen) {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const menuWidth = 192; // w-48
                                    let x = rect.right + 10;
                                    let y = rect.top - 10;

                                    // Viewport boundary checks
                                    if (x + menuWidth > window.innerWidth) x = rect.left - menuWidth - 10;
                                    if (y + 400 > window.innerHeight) y = Math.max(10, window.innerHeight - 410);

                                    setAnimateMenuPos({ x, y });
                                    setIsAnimateMenuOpen(true);
                                    setIsAnimateMoreOpen(false);
                                } else {
                                    setIsAnimateMenuOpen(false);
                                }
                            }}
                            className={`p-1 rounded transition-colors ${isAnimateMenuOpen ? 'bg-accent/15 text-accent' : 'text-muted hover:text-secondary hover:bg-hover'}`}
                            title="Animate Properties"
                        >
                            <Plus size={12} strokeWidth={3} />
                        </button>
                    </div>
                </div>

                {/* Animate Properties Popover */}
                {isAnimateMenuOpen && (
                    <div
                        ref={animateMenuRef}
                        className="fixed z-[9999] w-48 bg-[#18181b] border border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden text-sm animate-popup"
                        style={{
                            left: animateMenuPos.x,
                            top: animateMenuPos.y,
                            maxHeight: 'calc(100vh - 40px)' // Ensure it doesn't exceed viewport
                        }}
                        onMouseDown={(e) => e.stopPropagation()} // Prevent row click selection
                    >
                        {/* Header / Drag Handle */}
                        <div
                            className="bg-white/5 border-b border-white/5 px-3 py-2 flex items-center justify-between cursor-move select-none"
                            onMouseDown={handleDragStartPopup}
                        >
                            <span className="font-bold text-white/80 text-xs tracking-wide">Animate</span>
                            <button
                                onClick={() => setIsAnimateMenuOpen(false)}
                                className="text-white/40 hover:text-white hover:bg-white/10 p-0.5 rounded cursor-pointer"
                            >
                                <X size={12} />
                            </button>
                        </div>

                        {/* Property List */}
                        <div className="py-1 flex flex-col flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 select-none">
                            {(() => {
                                // For the popup, we want to show all available property groups for this node type,
                                // but maybe less restricted than the narrowed sidebar view.
                                // We'll use propertyGroups directly but filter by node.type appropriateness.
                                const popupAdaptedGroups = propertyGroups.map(g => {
                                    if (node.type === 'image') {
                                        const allowed = ['Position', 'Scale', 'Rotation', 'Opacity'];
                                        if (!allowed.includes(g.label)) return null;
                                    }

                                    // Adapt 'Size' group based on node type
                                    if (g.label === 'Size') {
                                        if (node.type === 'rect' || node.type === 'artboard' || node.type === 'path') return g;
                                        if (node.type === 'ellipse') {
                                            return {
                                                ...g,
                                                mainPath: 'props.radiusX',
                                                props: [
                                                    { label: 'W', path: 'props.radiusX', displayFactor: 2 },
                                                    { label: 'H', path: 'props.radiusY', displayFactor: 2 }
                                                ]
                                            };
                                        }
                                        return null;
                                    }

                                    if (g.label === 'Path' && !(node.type === 'path' || node.type === 'rect' || node.type === 'ellipse')) return null;
                                    if (g.label.startsWith('Trim') && !(node.type === 'rect' || node.type === 'ellipse' || node.type === 'path' || node.type === 'group' || node.type === 'precomp')) return null;
                                    if (g.label === 'Roundness' && (node.type !== 'rect' && node.type !== 'path')) return null;

                                    return g;
                                }).filter(Boolean);

                                const coreLabels = ['Position', 'Scale', 'Rotation', 'Opacity'];
                                const coreGroups = popupAdaptedGroups.filter(g => coreLabels.includes(g.label));
                                const shapeGroups = popupAdaptedGroups.filter(g => !coreLabels.includes(g.label));

                                const renderMenuItem = (group: any) => {
                                    // For groups, color/style animations live on child shapes — check them too
                                    const isStyleGroup = group.props.some((p: any) => p.path?.startsWith('style.fill') || p.path?.startsWith('style.stroke'));
                                    const isAnimated = group.props.some((p: any) => {
                                        if (node.animations?.[p.path]) return true;
                                        if (isStyleGroup && node.type === 'group' && node.children?.length) {
                                            const storeNodes = useCreatorStore.getState().nodes;
                                            const checkDescendants = (ids: string[]): boolean =>
                                                ids.some(id => {
                                                    const c = storeNodes.get(id);
                                                    if (!c) return false;
                                                    if (c.animations?.[p.path]) return true;
                                                    if (c.type === 'group' && c.children?.length) return checkDescendants(c.children);
                                                    return false;
                                                });
                                            return checkDescendants(node.children);
                                        }
                                        return false;
                                    });

                                    return (
                                        <button
                                            key={group.mainPath}
                                            onClick={(e) => {
                                                e.stopPropagation();

                                                if (group.label === 'Path') {
                                                    let pointsToUse: any[] = [];
                                                    if (node.type === 'rect' || node.type === 'ellipse') {
                                                        pointsToUse = convertToPath(node);
                                                        updateNode(node.id, {
                                                            type: 'path',
                                                            props: {
                                                                ...node.props,
                                                                points: pointsToUse,
                                                                closed: true
                                                            }
                                                        });
                                                    } else if (node.type === 'path') {
                                                        pointsToUse = [...(node.props.points || [])];
                                                    }

                                                    setEditingNode(node.id);
                                                    const state = useCreatorStore.getState();
                                                    state.ensureExpansion(node.id, 'props.points');
                                                    addKeyframe(node.id, 'props.points', currentTime, pointsToUse);
                                                } else {
                                                    group.props.forEach((p: any) => {
                                                        const hasKf = (node.animations?.[p.path] || []).some((kf: any) => kf.time === currentTime);
                                                        if (!hasKf) {
                                                            toggleStopwatch(node.id, p.path);
                                                        }
                                                    });
                                                }
                                            }}
                                            className="px-3 py-1.5 flex items-center justify-between text-left hover:bg-accent/20 hover:text-accent text-white/70 transition-colors"
                                        >
                                            <span className="text-[11px] font-medium tracking-wide">{group.label}</span>
                                            {isAnimated && (
                                                <Diamond size={10} className="text-accent opacity-60" fill="currentColor" />
                                            )}
                                        </button>
                                    );
                                };

                                return (
                                    <>
                                        {coreGroups.length > 0 && (
                                            <div className="flex flex-col">
                                                {coreGroups.map(renderMenuItem)}
                                            </div>
                                        )}

                                        {shapeGroups.length > 0 && (
                                            <>
                                                {coreGroups.length > 0 && <div className="h-[1px] bg-white/[0.05] my-1 mr-1 ml-1" />}
                                                <button
                                                    onClick={() => setIsAnimateMoreOpen(!isAnimateMoreOpen)}
                                                    className="px-3 py-1.5 flex items-center justify-between text-left hover:bg-hover text-muted text-[10px] uppercase tracking-wider transition-colors"
                                                >
                                                    More Options
                                                    <ChevronDown size={10} className={`transition-transform ${isAnimateMoreOpen ? 'rotate-180' : ''}`} />
                                                </button>
                                                {isAnimateMoreOpen && (
                                                    <div className="flex flex-col bg-black/20 pb-1">
                                                        {shapeGroups.map(renderMenuItem)}
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </>
                                );
                            })()}
                        </div>
                    </div>
                )}
            </div>

            {/* Property Tracks Labels */}
            {
                (() => {
                    const isSolo = trackVisibility.length > 0;

                    // Function to filter out groups without keyframes
                    const getAnimatedGroups = (groups: any[]) => {
                        return groups.filter(group => group.props.some((p: any) => !!node.animations?.[p.path]));
                    };

                    // Categorize groups (only show animated ones by default)
                    const coreGroups = getAnimatedGroups(visibleGroups).filter(g => ['Position', 'Scale', 'Rotation', 'Opacity'].includes(g.label));
                    const shapeGroups = getAnimatedGroups(adaptedGroups).filter(g => !['Position', 'Scale', 'Rotation', 'Opacity'].includes(g.label));

                    const isShapeGroupExpanded = expandedShapeGroups[node.id];

                    const renderGroupRow = (group: any) => {
                        const propertyKeyframes = group.props.reduce((acc: any[], p: any) => [...acc, ...(node.animations?.[p.path] || [])], []);
                        const hasKfAtCurrentTime = propertyKeyframes.some((kf: any) => kf.time === currentTime);
                        const isAnimated = group.props.some((p: any) => !!node.animations?.[p.path]);

                        return (
                            <div
                                key={group.mainPath}
                                className="flex items-center hover:bg-white/[0.05] transition-colors bg-black/20 pr-3 border-t border-white/[0.01]"
                                style={{ height: rowHeight, paddingLeft: `${depth * 12 + 40}px` }}
                            >
                                <button
                                    onClick={() => {
                                        const anyKfAtTime = group.props.some((p: any) =>
                                            (node.animations?.[p.path] || []).some((kf: any) => kf.time === currentTime)
                                        );

                                        group.props.forEach((p: any) => {
                                            const hasKf = (node.animations?.[p.path] || []).some((kf: any) => kf.time === currentTime);
                                            if (anyKfAtTime) {
                                                if (hasKf) toggleStopwatch(node.id, p.path);
                                            } else {
                                                toggleStopwatch(node.id, p.path);
                                            }
                                        });
                                    }}
                                    className={`p-1 mr-2 rounded-sm transition-all ${isAnimated ? 'text-accent opacity-100' : 'text-white/10 hover:text-white/30'}`}
                                >
                                    <Diamond size={10} fill={hasKfAtCurrentTime ? "currentColor" : "none"} className={hasKfAtCurrentTime ? "" : ""} />
                                </button>
                                <div className="flex-1 flex items-center justify-between min-w-0">
                                    <span className="text-[10px] font-bold text-white/30 truncate tracking-tight uppercase">{group.label}</span>
                                    <div className="flex items-center gap-2 ml-2 shrink-0">
                                        {group.hasLink && (
                                            <button
                                                onClick={() => setNodeProperty(node.id, 'transform.scaleLink', !node.transform.scaleLink)}
                                                className={`p-0.5 rounded transition-colors ${node.transform.scaleLink ? 'text-accent bg-accent/15' : 'text-white/10 hover:text-white/30 hover:bg-white/5'}`}
                                            >
                                                <Link2 size={10} />
                                            </button>
                                        )}
                                        <div className="flex items-center gap-1.5">
                                            {group.props.map((p: any, i: number) => (
                                                <PropertyInput
                                                    key={p.path}
                                                    nodeId={node.id}
                                                    propertyPath={p.path}
                                                    value={AnimationUtils.getPropertyValue(node, p.path, currentTime)}
                                                    isPercent={p.isPercent}
                                                    isDegree={p.isDegree}
                                                    displayFactor={p.displayFactor}
                                                    setNodeProperty={setNodeProperty}
                                                    showSeparator={i > 0}
                                                    min={p.min}
                                                    max={p.max}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    };

                    if (isSolo) {
                        return visibleGroups.map(renderGroupRow);
                    }

                    if (!isExpanded) return null;

                    return (
                        <>
                            {/* Core Groups */}
                            {coreGroups.map(renderGroupRow)}

                            {/* Transform Shape Toggle Group */}
                            {shapeGroups.length > 0 && (
                                <>
                                    <div
                                        className="flex items-center hover:bg-white/[0.05] transition-colors bg-black/30 pr-3 border-t border-white/[0.02] cursor-pointer"
                                        style={{ height: rowHeight, paddingLeft: `${depth * 12 + 24}px` }}
                                        onClick={() => toggleShapeGroupExpand(node.id)}
                                    >
                                        <button className="p-1 mr-1 text-white/20">
                                            {isShapeGroupExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                                        </button>
                                        <span className="text-[10px] text-muted uppercase tracking-widest pl-1">Transform Shape</span>
                                    </div>
                                    {isShapeGroupExpanded && shapeGroups.map(renderGroupRow)}
                                </>
                            )}
                        </>
                    );
                })()
            }
        </div >
    );
});

export default TimelineSidebarTrack;

function PropertyInput({ nodeId, propertyPath, value, isPercent, isDegree, displayFactor = 1, setNodeProperty, showSeparator, min, max }: any) {
    const [isEditing, setIsEditing] = useState(false);
    const [localVal, setLocalVal] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    let displayVal: any = "-";
    if (typeof value === 'number' && !isNaN(value)) {
        displayVal = Math.round(value * displayFactor * 100) / 100;
        if (isPercent) displayVal = Math.round(value * 100);
    } else if (Array.isArray(value)) {
        displayVal = `[${value.length}]`;
    } else if (value === null || value === undefined) {
        displayVal = "-";
    } else {
        // Handle any weird stuff that stringifies to NaN
        const str = String(value);
        displayVal = str === "NaN" ? "-" : str;
    }

    const startEditing = () => {
        setIsEditing(true);
        setLocalVal(displayVal.toString());
    };

    const commitChange = () => {
        setIsEditing(false);
        const next = parseFloat(localVal);
        if (!isNaN(next)) {
            let finalVal = next / displayFactor;
            if (isPercent) finalVal = next / 100;

            const clamped = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, finalVal));
            setNodeProperty(nodeId, propertyPath, clamped);
        }
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) return; // Only left click

        const startX = e.clientX;
        const startValue = value;
        let moved = false;

        const onMouseMove = (moveE: MouseEvent) => {
            const dx = moveE.clientX - startX;
            if (Math.abs(dx) > 3) moved = true;

            if (moved) {
                // Determine sensitivity
                let sensitivity = 1 / displayFactor;
                if (isPercent) sensitivity = 0.01;

                if (moveE.shiftKey) sensitivity *= 10;
                if (moveE.altKey) sensitivity /= 10;

                const newValue = startValue + dx * sensitivity;
                const clamped = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, newValue));
                setNodeProperty(nodeId, propertyPath, clamped);
            }
        };

        const onMouseUp = () => {
            if (!moved) {
                startEditing();
            }
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = 'default';
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        document.body.style.cursor = 'ew-resize';
    };
    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    return (
        <div className="flex items-center">
            {showSeparator && <span className="text-white/5 mr-1.5 text-[8px] font-bold">,</span>}
            {isEditing ? (
                <input
                    ref={inputRef}
                    type="text"
                    className="w-12 text-white font-mono text-[10px] font-medium text-center rounded outline-none"
                    style={{ background: 'var(--accent)' }}
                    value={localVal}
                    onChange={(e) => setLocalVal(e.target.value)}
                    onBlur={commitChange}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') commitChange();
                        if (e.key === 'Escape') setIsEditing(false);
                    }}
                />
            ) : (
                <span
                    onMouseDown={handleMouseDown}
                    className="text-[10px] font-mono font-bold text-accent/80 hover:text-accent transition-colors bg-accent/15 px-1 rounded-sm cursor-ew-resize border border-transparent hover:border-accent/20 select-none"
                >
                    {displayVal}{isPercent ? '%' : isDegree ? '°' : ''}
                </span>
            )}
        </div>
    );
}
