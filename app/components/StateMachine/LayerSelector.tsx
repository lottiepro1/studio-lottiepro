import React, { useMemo, useState, useRef, useEffect } from 'react';
import { useCreatorStore } from '@/lib/creator/state/store';
import { ChevronDown, ChevronRight, Hash, Layers, Folder, Box, Search, Check, Globe } from 'lucide-react';

interface LayerSelectorProps {
    value: string;
    onChange: (id: string) => void;
    disabled?: boolean;
}

export function LayerSelector({ value, onChange, disabled }: LayerSelectorProps) {
    const nodes = useCreatorStore(state => state.nodes);
    const activeArtboardId = useCreatorStore(state => state.activeArtboardId);
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    const containerRef = useRef<HTMLDivElement>(null);

    // Build the hierarchical list
    // Returns a flat list and we'll filter it based on expansion in the render phase
    const layerOptions = useMemo(() => {
        const artboard = activeArtboardId ? nodes.get(activeArtboardId) : Array.from(nodes.values()).find(n => n.type === 'artboard');
        if (!artboard) return [];

        const result: any[] = [];
        const seen = new Set<string>();

        const traverse = (nodeId: string, depth: number) => {
            if (seen.has(nodeId)) return;
            seen.add(nodeId);

            const node = nodes.get(nodeId);
            if (!node) return;

            if (node.type !== 'artboard') {
                result.push({
                    id: node.id,
                    name: node.name || node.type,
                    type: node.type,
                    depth,
                    hasChildren: node.children && node.children.length > 0,
                    parentId: node.parentId
                });
            }

            const children = node.children || [];
            [...children].reverse().forEach(childId => traverse(childId, node.type === 'artboard' ? 0 : depth + 1));
        };

        traverse(artboard.id, 0);
        return result;
    }, [nodes, activeArtboardId]);

    const activeArtboard = nodes.get(activeArtboardId || '');
    const selectedNode = nodes.get(value);
    const selectedName = selectedNode ? (selectedNode.name || selectedNode.type) : 'Select Layer';

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const toggleExpand = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const next = new Set(expandedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setExpandedIds(next);
    };

    // Filter by expansion state (unless searching)
    const visibleOptions = useMemo(() => {
        if (searchTerm) return layerOptions.filter(opt =>
            opt.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            opt.type.toLowerCase().includes(searchTerm.toLowerCase())
        );

        const visible: any[] = [];

        layerOptions.forEach(opt => {
            // If any ancestor is closed, hide this child
            let show = true;
            let currentParentId = opt.parentId;
            while (currentParentId && currentParentId !== activeArtboardId) {
                if (!expandedIds.has(currentParentId)) {
                    show = false;
                    break;
                }
                const p = layerOptions.find(o => o.id === currentParentId);
                currentParentId = p?.parentId;
            }
            if (show) visible.push(opt);
        });

        return visible;
    }, [layerOptions, expandedIds, searchTerm, activeArtboardId]);

    return (
        <div className="relative w-full" ref={containerRef}>
            <button
                type="button"
                onClick={() => !disabled && setIsOpen(!isOpen)}
                disabled={disabled}
                className={`w-full flex items-center justify-between gap-2 bg-surface border border-white/[0.06] rounded px-2 py-1.5 text-[10px] text-secondary transition-all ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-accent/40 cursor-pointer'}`}
            >
                <div className="flex items-center gap-2 overflow-hidden">
                    {selectedNode ? <Box size={12} className="text-accent shrink-0" /> : <Layers size={12} className="text-white/20 shrink-0" />}
                    <span className="truncate">{selectedName}</span>
                </div>
                <ChevronDown size={12} className={`text-white/20 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 z-[100] border border-white/[0.06] rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[400px]" style={{ background: 'var(--bg-panel)' }}>
                    <div className="p-2 border-b border-white/[0.06]" style={{ background: 'var(--bg-surface)' }}>
                        <div className="relative">
                            <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-white/20" />
                            <input
                                type="text"
                                autoFocus
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="Search layers..."
                                className="w-full bg-surface border border-white/[0.06] rounded-md pl-7 pr-2 py-1.5 text-[10px] text-secondary outline-none focus:border-accent/50"
                                onClick={(e) => e.stopPropagation()}
                            />
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto py-1 custom-scrollbar min-h-[100px]">
                        {/* Header: Main Scene */}
                        {!searchTerm && (
                            <div className="px-3 py-2 flex items-center gap-2 border-b border-white/5 bg-white/[0.01]">
                                <Globe size={10} className="text-white/20" />
                                <span className="text-[9px] uppercase tracking-widest text-muted">{activeArtboard?.name || 'Main Scene'}</span>
                            </div>
                        )}

                        {visibleOptions.length === 0 ? (
                            <div className="p-4 text-center text-[10px] text-white/20 font-medium">
                                No layers found
                            </div>
                        ) : (
                            visibleOptions.map((opt) => {
                                const isSelected = opt.id === value;
                                const isExpanded = expandedIds.has(opt.id);
                                const canExpand = (opt.type === 'group' || opt.type === 'precomp') && opt.hasChildren;

                                return (
                                    <div
                                        key={opt.id}
                                        onClick={() => {
                                            onChange(opt.id);
                                            setIsOpen(false);
                                        }}
                                        className={`group flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors ${isSelected ? 'bg-accent/10 text-accent' : 'text-secondary hover:bg-hover hover:text-primary'}`}
                                        style={{ paddingLeft: `${(opt.depth * 14) + 12}px` }}
                                    >
                                        <div className="flex items-center gap-2 flex-1 overflow-hidden">
                                            {/* Expand Button */}
                                            {canExpand && !searchTerm ? (
                                                <button
                                                    onClick={(e) => toggleExpand(opt.id, e)}
                                                    className="w-4 h-4 flex items-center justify-center hover:bg-white/10 rounded mr-[-4px]"
                                                >
                                                    {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                                                </button>
                                            ) : (
                                                <div className="w-4 mr-[-4px]" />
                                            )}

                                            {opt.type === 'group' || opt.type === 'precomp' ? (
                                                <Folder size={10} className={isSelected ? 'text-accent' : 'text-white/40'} />
                                            ) : (
                                                <Box size={10} className={isSelected ? 'text-accent' : 'text-white/20'} />
                                            )}
                                            <span className="text-[10px] truncate font-medium">{opt.name}</span>
                                        </div>
                                        {isSelected && <Check size={10} className="text-accent shrink-0" />}
                                        <span className={`text-[8px] uppercase tracking-widest text-white/10 group-hover:text-white/20 transition-colors shrink-0 ml-auto ${isSelected ? 'hidden' : ''}`}>
                                            {opt.type === 'precomp' ? 'Artboard' : opt.type}
                                        </span>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
