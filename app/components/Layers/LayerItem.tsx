'use client';

import { useState, useRef, memo } from 'react';
import { useCreatorStore } from '@/lib/creator/state/store';
import { SceneNode } from '@/lib/creator/state/sceneSlice';
import {
    ChevronDown,
    ChevronRight,
    Eye,
    EyeOff,
    Lock,
    Unlock,
    Square,
    Circle,
    Folder,
    Type,
    Image as ImageIcon,
    MousePointer2,
    Box
} from 'lucide-react';

interface LayerItemProps {
    nodeId: string;
    depth: number;
    onSelect: (isShift: boolean, isCtrl: boolean) => void;
    isExpanded?: boolean;
    onToggleExpand?: () => void;
}

export const LayerItem = memo(function LayerItem({ nodeId, depth, onSelect, isExpanded = true, onToggleExpand }: LayerItemProps) {
    const node = useCreatorStore((state) => state.nodes.get(nodeId));
    const selectedIds = useCreatorStore((state) => state.selectedIds);
    const setSelection = useCreatorStore((state) => state.setSelection);
    const updateNode = useCreatorStore((state) => state.updateNode);
    const moveNode = useCreatorStore((state) => state.moveNode);
    const setActiveArtboard = useCreatorStore((state) => state.setActiveArtboard);
    // NOTE: Do NOT subscribe to the entire `nodes` Map here — it would re-render all 334 LayerItem
    // instances on every edit (the Map reference changes on every updateNode). We read nodes
    // imperatively inside event handlers via useCreatorStore.getState() instead.

    const [isEditing, setIsEditing] = useState(false);
    const [tempName, setTempName] = useState(node?.name || '');
    const [dropPosition, setDropPosition] = useState<'before' | 'after' | 'inside' | null>(null);

    const itemRef = useRef<HTMLDivElement>(null);

    // Get basic properties for render, but handle null node gracefully
    const isSelected = !!node && selectedIds.includes(node.id);
    const hasChildren = !!node && node.children && node.children.length > 0;

    const getIcon = () => {
        if (!node) return null;
        switch (node.type) {
            case 'rect': return <Square className="w-3.5 h-3.5" />;
            case 'ellipse': return <Circle className="w-3.5 h-3.5" />;
            case 'group':
                // Show merge mode icon if applicable
                if (node.mergeMode && node.mergeMode !== 'none') {
                    const icons: Record<string, string> = { union: '∪', subtract: '−', intersect: '∩', exclude: '⊞' };
                    return <span className="w-3.5 h-3.5 flex items-center justify-center text-[10px] font-bold text-accent">{icons[node.mergeMode]}</span>;
                }
                return <Folder className="w-3.5 h-3.5" />;
            case 'text': return <Type className="w-3.5 h-3.5" />;
            case 'image': return <ImageIcon className="w-3.5 h-3.5" />;
            case 'precomp': return <Box className="w-3.5 h-3.5 text-accent" />;
            default: return <MousePointer2 className="w-3.5 h-3.5" />;
        }
    };

    const handleToggleVisibility = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (node) {
            useCreatorStore.getState().pushToHistory(`${node.visible ? 'Hide' : 'Show'} ${node.name}`);
            updateNode(node.id, { visible: !node.visible });
        }
    };

    const handleToggleLock = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (node) {
            useCreatorStore.getState().pushToHistory(`${node.locked ? 'Unlock' : 'Lock'} ${node.name}`);
            updateNode(node.id, { locked: !node.locked });
        }
    };

    const handleRename = () => {
        if (node && tempName.trim() && tempName.trim() !== node.name) {
            useCreatorStore.getState().pushToHistory(`Rename ${node.name}`);
            updateNode(node.id, { name: tempName.trim() });
        }
        setIsEditing(false);
    };


    if (!node) return null;

    // Drag and Drop Handlers
    const onDragStart = (e: React.DragEvent) => {
        e.dataTransfer.setData('nodeId', node.id);
        e.dataTransfer.effectAllowed = 'move';
        // Visual feedback
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

        if (node.type === 'group' || node.type === 'artboard') {
            // For groups, use 3 zones: before, inside, after
            if (y < height * 0.25) {
                setDropPosition('before');
            } else if (y > height * 0.75) {
                setDropPosition('after');
            } else {
                setDropPosition('inside');
            }
        } else {
            // For others, just before or after
            if (y < height / 2) {
                setDropPosition('before');
            } else {
                setDropPosition('after');
            }
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

        const currentNodes = useCreatorStore.getState().nodes;
        const draggedNode = currentNodes.get(draggedId);
        if (!draggedNode) return;

        // Prevent dropping a parent into its own child
        let currentParentId = node.parentId;
        while (currentParentId) {
            if (currentParentId === draggedId) {
                setDropPosition(null);
                return;
            }
            currentParentId = currentNodes.get(currentParentId)?.parentId || null;
        }

        if (dropPosition === 'inside') {
            moveNode(draggedId, node.id, node.children.length); // Place at top of group
            if (!isExpanded) onToggleExpand?.();
        } else {
            const parentId = node.parentId;
            if (parentId) {
                const parent = currentNodes.get(parentId);
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

    return (
        <>
            <div
                ref={itemRef}
                draggable
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                onClick={(e) => {
                    e.stopPropagation();
                    onSelect(e.shiftKey, e.ctrlKey || e.metaKey);
                }}
                onDoubleClick={() => {
                    if (node.type === 'precomp' && node.refId) {
                        setActiveArtboard(node.refId);
                    } else {
                        setIsEditing(true);
                        setTempName(node.name);
                    }
                }}
                className={`group flex items-center px-2 py-[7px] cursor-pointer rounded-md mb-0.5 transition-all relative border ${isSelected
                    ? 'border-accent/30 text-primary'
                    : 'border-transparent text-secondary hover:text-primary hover:bg-hover'
                    } ${dropPosition === 'inside' ? 'ring-1 ring-accent/60' : ''}`}
                style={{
                    paddingLeft: `${depth * 12 + 8}px`,
                    ...(isSelected || dropPosition === 'inside' ? { background: 'var(--accent-soft)' } : {})
                }}
            >
                {/* Indentation Line Guide (Figma style) */}
                {depth > 0 && (
                    <div
                        className="absolute left-0 top-0 bottom-0 border-l border-white/[0.06]"
                        style={{ left: `${(depth - 1) * 12 + 14}px` }}
                    />
                )}

                {/* Refined Drop Indicators (Figma Style) */}
                {(dropPosition === 'before' || dropPosition === 'after') && (
                    <div
                        className={`absolute left-0 right-0 h-[2px] bg-accent z-50 pointer-events-none ${dropPosition === 'before' ? '-top-[2px]' : '-bottom-[2px]'}`}
                    >
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[6px] h-[6px] rounded-full bg-accent" />
                    </div>
                )}

                {/* Expand/Collapse Toggle */}
                <div className="w-4 flex items-center justify-center mr-1">
                    {hasChildren && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onToggleExpand?.();
                            }}
                            className="hover:bg-hover rounded p-0.5 transition-colors"
                        >
                            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        </button>
                    )}
                </div>

                {/* Type Icon */}
                <div className={`mr-2.5 flex items-center justify-center w-4 h-4 transition-colors ${isSelected ? 'text-accent' : 'text-muted group-hover:text-secondary'}`}>
                    {getIcon()}
                </div>

                {/* Name */}
                <div className="flex-1 overflow-hidden">
                    {isEditing ? (
                        <input
                            autoFocus
                            className="text-primary text-[11px] w-full px-1 focus:outline-none focus:ring-1 focus:ring-accent rounded"
                            style={{ background: 'var(--bg-surface)' }}
                            value={tempName}
                            onChange={(e) => setTempName(e.target.value)}
                            onBlur={handleRename}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleRename();
                                if (e.key === 'Escape') setIsEditing(false);
                            }}
                            onClick={(e) => e.stopPropagation()}
                        />
                    ) : (
                        <span className="text-[11px] font-medium truncate block">{node.name}</span>
                    )}
                </div>

                {/* Action Buttons */}
                <div className={`flex items-center gap-0.5 ml-2 transition-all duration-200 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                    <button
                        onClick={handleToggleVisibility}
                        className={`p-1.5 hover:bg-hover rounded-md transition-colors ${!node.visible ? 'text-accent' : 'text-muted hover:text-secondary'}`}
                    >
                        {node.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    </button>
                    <button
                        onClick={handleToggleLock}
                        className={`p-1.5 hover:bg-hover rounded-md transition-colors ${node.locked ? 'text-accent' : 'text-muted hover:text-secondary'}`}
                    >
                        {node.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                    </button>
                </div>
            </div>

        </>
    );
});
