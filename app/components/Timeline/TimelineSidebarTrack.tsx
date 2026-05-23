'use client';

import { useMemo, useState, useEffect, useRef, memo } from 'react';
import { createPortal } from 'react-dom';
import { useCreatorStore } from '@/lib/creator/state/store';
import { ChevronRight, ChevronDown, Timer, Link2, Box, Circle, Layers, Diamond, Link as LinkIcon, HardDrive, Plus, X, Folder, Image as ImageIcon, Zap, Star, Layout, Component, Square, PenTool, Type, MousePointer2 } from 'lucide-react';
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
    const structureChangeCounter = useCreatorStore((state) => state.structureChangeCounter);

    const [dropPosition, setDropPosition] = useState<'before' | 'after' | 'inside' | null>(null);
    const [isBlinking, setIsBlinking] = useState(false);
    const itemRef    = useRef<HTMLDivElement>(null);
    const blinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const triggerLockBlink = () => {
        if (blinkTimer.current) clearTimeout(blinkTimer.current);
        setIsBlinking(true);
        blinkTimer.current = setTimeout(() => setIsBlinking(false), 700);
    };
    const [isAnimateMenuOpen, setIsAnimateMenuOpen] = useState(false);
    const [animateMenuPos, setAnimateMenuPos] = useState({ x: 0, y: 0 });
    const [isAnimateMoreOpen, setIsAnimateMoreOpen] = useState(false);
    const animateMenuRef = useRef<HTMLDivElement>(null);
    const [parentDropdownOpen, setParentDropdownOpen] = useState(false);
    const [parentDropdownPos, setParentDropdownPos] = useState({ x: 0, y: 0, width: 0 });
    const parentTriggerRef = useRef<HTMLButtonElement>(null);

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

    useEffect(() => {
        if (!parentDropdownOpen) return;
        const close = (e: MouseEvent) => {
            if (parentTriggerRef.current && parentTriggerRef.current.contains(e.target as Node)) return;
            setParentDropdownOpen(false);
        };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [parentDropdownOpen]);

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
    }, [node.id, structureChangeCounter]);

    // Design tokens (Figma 2001-1051)
    const ROW_BG     = isSelected ? 'rgba(221,234,248,0.30)' : dropPosition === 'inside' ? 'rgba(221,234,248,0.20)' : 'rgba(221,234,248,0.08)';
    const TEXT_COLOR = 'rgba(241,247,254,0.71)';
    const ICON_COLOR = '#808B9D';
    const SEL_BG     = 'rgba(0,0,0,0.25)';
    const SEL_BD     = 'rgba(217,237,255,0.25)';
    const SEL_TEXT   = 'rgba(229,237,253,0.48)';

    return (
        <div data-track-id={node.id} className="flex flex-col">
            <div
                ref={itemRef}
                draggable={node.type !== 'artboard'}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                className={`flex items-center cursor-default relative${isBlinking ? ' layer-locked-blink' : ' transition-colors'}`}
                style={{ height: rowHeight, background: isBlinking ? undefined : ROW_BG, borderRadius: 4 }}
                onMouseDownCapture={(e) => {
                    const target = e.target as HTMLElement;
                    if (target.closest('.animate-popup')) return;
                    e.stopPropagation();
                    if (node.locked) { triggerLockBlink(); return; }
                    const isInteractive = target.closest('button') || target.closest('select') || target.closest('input');
                    if (isInteractive && isSelected) return;
                    onSelect(e.shiftKey, e.ctrlKey || e.metaKey);
                }}
            >
                {/* Drop indicators */}
                {(dropPosition === 'before' || dropPosition === 'after') && (
                    <div className={`absolute left-0 right-0 h-[2px] bg-accent z-[100] pointer-events-none ${dropPosition === 'before' ? 'top-0' : 'bottom-0'}`}>
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[6px] h-[6px] rounded-full bg-accent" />
                    </div>
                )}

                {/* Row content */}
                <div
                    className="flex items-center w-full h-full"
                    style={{ paddingLeft: `${depth * 12 + 12}px`, paddingRight: 4, gap: 12 }}
                >
                    {/* Chevron */}
                    <button
                        onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
                        className="w-4 h-4 flex items-center justify-center shrink-0 transition-colors"
                        style={{ color: ICON_COLOR }}
                    >
                        <ChevronRight
                            size={14}
                            strokeWidth={1.75}
                            className={`transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                        />
                    </button>

                    {/* Layer type icon — matches LayerItem.tsx */}
                    <div
                        className="shrink-0 flex items-center justify-center"
                        style={{ width: 16, height: 16, color: node.type === 'precomp' ? '#627FE8' : ICON_COLOR }}
                    >
                        {node.type === 'rect'    && <Square      size={14} strokeWidth={1.75} />}
                        {node.type === 'ellipse' && <Circle      size={14} strokeWidth={1.75} />}
                        {node.type === 'path'    && <PenTool     size={14} strokeWidth={1.75} />}
                        {node.type === 'text'    && <Type        size={14} strokeWidth={1.75} />}
                        {node.type === 'image'   && <ImageIcon   size={14} strokeWidth={1.75} />}
                        {node.type === 'precomp' && <Box         size={14} strokeWidth={1.75} />}
                        {node.type === 'group'   && (
                            node.mergeMode && node.mergeMode !== 'none'
                                ? <span className="text-[9px] font-bold leading-none" style={{ color: '#627FE8' }}>
                                    {({ union: '∪', subtract: '−', intersect: '∩', exclude: '⊞' } as any)[node.mergeMode]}
                                  </span>
                                : <Folder size={14} strokeWidth={1.75} />
                        )}
                        {!['rect','ellipse','path','text','image','precomp','group'].includes(node.type) && <MousePointer2 size={14} strokeWidth={1.75} />}
                    </div>

                    {/* Layer name */}
                    <span className="text-[11px] truncate flex-1 min-w-0" style={{ color: TEXT_COLOR, fontWeight: 400 }}>
                        {node.name}
                    </span>

                    {/* Parent / link select (100px, Figma: Select Trigger) — custom dropdown */}
                    <div className="shrink-0 relative" style={{ width: 100 }}>
                        <button
                            ref={parentTriggerRef}
                            onClick={(e) => {
                                e.stopPropagation();
                                if (!parentDropdownOpen) {
                                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                    setParentDropdownPos({ x: rect.left, y: rect.bottom + 2, width: rect.width });
                                }
                                setParentDropdownOpen(v => !v);
                            }}
                            className="flex items-center justify-between w-full h-6 px-2 rounded-[3px] transition-colors hover:opacity-80"
                            style={{ background: SEL_BG, border: `1px solid ${SEL_BD}` }}
                        >
                            <span className="truncate flex-1 text-left" style={{ color: SEL_TEXT, fontSize: 11, lineHeight: '16px' }}>
                                {node.parentLayerId ? (potentialParents.find(p => p.id === node.parentLayerId)?.name ?? 'None') : 'None'}
                            </span>
                            <ChevronDown size={10} style={{ color: SEL_TEXT, flexShrink: 0 }} />
                        </button>

                        {parentDropdownOpen && (
                            <div
                                className="fixed z-[9999] rounded-[6px] overflow-hidden py-1"
                                style={{
                                    left: parentDropdownPos.x,
                                    top: parentDropdownPos.y,
                                    minWidth: parentDropdownPos.width,
                                    maxWidth: 200,
                                    maxHeight: 240,
                                    overflowY: 'auto',
                                    background: '#27292C',
                                    border: '1px solid rgba(221,234,248,0.08)',
                                    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                                }}
                                onMouseDown={(e) => e.stopPropagation()}
                            >
                                {[{ id: '', name: 'None' }, ...potentialParents].map(p => {
                                    const isActive = (node.parentLayerId || '') === p.id;
                                    return (
                                        <button
                                            key={p.id}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleSetParent(p.id || null);
                                                setParentDropdownOpen(false);
                                            }}
                                            className="w-full text-left px-3 py-1.5 text-[11px] transition-colors hover:bg-white/10"
                                            style={{ color: isActive ? 'var(--accent)' : 'rgba(241,247,254,0.71)' }}
                                        >
                                            {p.name}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Animate / keyframe button (+) — accent when layer has any keyframes */}
                    {(() => {
                        const hasAnimations = !!node.animations && Object.values(node.animations).some((arr: any) => arr && arr.length > 0);
                        const isActive = isAnimateMenuOpen || hasAnimations;
                        return (
                            <button
                                data-animate-trigger="true"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (!isAnimateMenuOpen) {
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        const menuWidth = 192;
                                        let x = rect.right + 10;
                                        let y = rect.top - 10;
                                        if (x + menuWidth > window.innerWidth) x = rect.left - menuWidth - 10;
                                        if (y + 400 > window.innerHeight) y = Math.max(10, window.innerHeight - 410);
                                        setAnimateMenuPos({ x, y });
                                        setIsAnimateMenuOpen(true);
                                        setIsAnimateMoreOpen(false);
                                    } else {
                                        setIsAnimateMenuOpen(false);
                                    }
                                }}
                                className="w-6 h-6 flex items-center justify-center rounded transition-colors shrink-0"
                                style={{
                                    color: isActive ? 'var(--accent)' : ICON_COLOR,
                                    background: isActive ? 'rgba(var(--accent-rgb),0.15)' : 'transparent',
                                    border: hasAnimations && !isAnimateMenuOpen ? '1px solid rgba(var(--accent-rgb),0.35)' : '1px solid transparent',
                                }}
                                title="Animate Properties"
                            >
                                <Plus size={14} strokeWidth={2} />
                            </button>
                        );
                    })()}
                </div>

                {/* Animate Properties Popover — rendered via portal so it escapes the
                    timeline panel's stacking context and always appears above the canvas. */}
                {isAnimateMenuOpen && createPortal(
                    <div
                        ref={animateMenuRef}
                        className="fixed z-[9999] w-48 bg-[#18181b] border border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden text-sm animate-popup"
                        style={{
                            left: animateMenuPos.x,
                            top: animateMenuPos.y,
                            maxHeight: 'calc(100vh - 40px)'
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
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
                    </div>,
                    document.body
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
                                className="flex items-center transition-colors"
                                style={{ height: rowHeight, paddingLeft: `${depth * 12 + 40}px`, paddingRight: 8, background: 'rgba(221,234,248,0.04)', borderRadius: 4 }}
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
                                    <span className="text-[11px] font-medium truncate" style={{ color: 'rgba(241,247,254,0.40)' }}>{group.label}</span>
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
                                        className="flex items-center cursor-pointer transition-colors rounded"
                                        style={{ height: rowHeight, paddingLeft: `${depth * 12 + 24}px`, paddingRight: 8, background: 'rgba(221,234,248,0.04)' }}
                                        onClick={() => toggleShapeGroupExpand(node.id)}
                                    >
                                        <button className="p-1 mr-1 transition-colors" style={{ color: 'rgba(241,247,254,0.30)' }}>
                                            <ChevronRight size={12} strokeWidth={1.75} className={`transition-transform duration-150 ${isShapeGroupExpanded ? 'rotate-90' : ''}`} />
                                        </button>
                                        <span className="text-[11px] font-medium" style={{ color: 'rgba(241,247,254,0.40)' }}>Transform Shape</span>
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
