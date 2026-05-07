'use client';

import { useCreatorStore } from '@/lib/creator/state/store';
import { X, Trash2, Plus, GripHorizontal } from 'lucide-react';
import React, { useState } from 'react';

export default function SegmentsPanel() {
    const isSegmentsPanelOpen = useCreatorStore((state) => state.isSegmentsPanelOpen);
    const setSegmentsPanelOpen = useCreatorStore((state) => state.setSegmentsPanelOpen);
    const flowBlocks = useCreatorStore((state) => state.flowBlocks);
    const setCurrentTime = useCreatorStore((state) => state.setCurrentTime);
    const addFlowBlock = useCreatorStore((state) => state.addFlowBlock);
    const updateFlowBlock = useCreatorStore((state) => state.updateFlowBlock);
    const deleteFlowBlock = useCreatorStore((state) => state.deleteFlowBlock);
    const setWorkArea = useCreatorStore((state) => state.setWorkArea);
    const fps = useCreatorStore((state) => state.fps);

    const [pos, setPos] = useState({ x: 80, y: 150 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

    const handleMouseDown = (e: React.MouseEvent) => {
        setIsDragging(true);
        setDragOffset({
            x: e.clientX - pos.x,
            y: e.clientY - pos.y
        });
    };

    React.useEffect(() => {
        if (!isDragging) return;

        const handleMouseMove = (e: MouseEvent) => {
            setPos({
                x: e.clientX - dragOffset.x,
                y: e.clientY - dragOffset.y
            });
        };

        const handleMouseUp = () => {
            setIsDragging(false);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, dragOffset]);

    const formatTime = (frames: number) => {
        const s = Math.floor(frames / fps);
        const f = frames % fps;
        if (s > 0) return f > 0 ? `${s}s ${f}f` : `${s}s`;
        return `${f}f`;
    };

    if (!isSegmentsPanelOpen) return null;

    return (
        <div
            className="fixed w-64 border border-white/[0.06] rounded-xl shadow-2xl z-[100] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
            style={{
                background: 'var(--bg-panel)',
                left: pos.x,
                top: pos.y,
                maxHeight: 'calc(100vh - 200px)'
            }}
        >
            <div
                className="flex items-center justify-between p-2.5 border-b border-white/[0.06] cursor-grab active:cursor-grabbing select-none"
                style={{ background: 'var(--bg-surface)' }}
                onMouseDown={handleMouseDown}
            >
                <div className="flex items-center gap-2 text-white/80">
                    <GripHorizontal size={14} className="text-accent" />
                    <span className="text-xs font-medium text-secondary">Segments</span>
                </div>
                <button
                    onClick={() => setSegmentsPanelOpen(false)}
                    className="text-white/40 hover:text-white transition-colors"
                >
                    <X size={16} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5 min-h-0">
                {flowBlocks.length === 0 ? (
                    <div className="text-center py-10 text-xs text-white/20 px-6">
                        <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-3 text-white/10">
                            <Plus size={16} />
                        </div>
                        Define animation segments by right-clicking the timeline work area.
                    </div>
                ) : (
                    flowBlocks.map(block => (
                        <div
                            key={block.id}
                            draggable
                            onDragStart={(e) => {
                                e.dataTransfer.setData('lottiepro/segment-id', block.id);
                                e.dataTransfer.setData('lottiepro/segment-name', block.name);
                            }}
                            onClick={() => {
                                setWorkArea(block.startFrame, block.endFrame);
                                setCurrentTime(block.startFrame);
                            }}
                            className="bg-surface rounded-lg p-2 border border-white/[0.06] flex flex-col gap-2 group hover:border-accent/20 hover:bg-accent/[0.03] transition-all relative cursor-pointer active:scale-[0.98] active:cursor-grabbing"
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex flex-col flex-1 min-w-0">
                                    <input
                                        type="text"
                                        value={block.name}
                                        onClick={e => e.stopPropagation()}
                                        onChange={(e) => updateFlowBlock(block.id, { name: e.target.value })}
                                        className="bg-transparent text-xs font-medium text-secondary border-none outline-none focus:text-primary focus:ring-0 rounded px-0 py-0 transition-all truncate"
                                        placeholder="Segment Name"
                                    />
                                    <span className="text-[9px] text-white/20 font-medium uppercase tracking-tighter mt-0.5 pointer-events-none">
                                        {formatTime(block.endFrame - block.startFrame)}
                                    </span>
                                </div>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        deleteFlowBlock(block.id);
                                    }}
                                    className="w-6 h-6 flex items-center justify-center rounded-md text-white/20 hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                                    title="Remove segment"
                                >
                                    <Trash2 size={12} />
                                </button>
                            </div>

                            <div className="grid grid-cols-2 gap-1.5">
                                <div className="flex flex-col gap-0.5">
                                    <div
                                        className="bg-black/20 rounded border border-white/5 px-1.5 py-1 focus-within:border-white/20 transition-colors flex items-center"
                                        onClick={e => e.stopPropagation()}
                                    >
                                        <span className="text-[8px] text-muted uppercase mr-1 pointer-events-none">In</span>
                                        <input
                                            type="number"
                                            value={block.startFrame}
                                            onChange={(e) => updateFlowBlock(block.id, { startFrame: parseInt(e.target.value) || 0 })}
                                            className="w-full bg-transparent text-[10px] text-white/60 font-mono outline-none"
                                            min={0}
                                        />
                                    </div>
                                </div>
                                <div className="flex flex-col gap-0.5">
                                    <div
                                        className="bg-black/20 rounded border border-white/5 px-1.5 py-1 focus-within:border-white/20 transition-colors flex items-center"
                                        onClick={e => e.stopPropagation()}
                                    >
                                        <span className="text-[8px] text-muted uppercase mr-1 pointer-events-none">Out</span>
                                        <input
                                            type="number"
                                            value={block.endFrame}
                                            onChange={(e) => updateFlowBlock(block.id, { endFrame: parseInt(e.target.value) || 0 })}
                                            className="w-full bg-transparent text-[10px] text-white/60 font-mono outline-none"
                                            min={0}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <div className="p-3 border-t border-white/[0.06]">
                <button
                    onClick={() => {
                        const state = useCreatorStore.getState();
                        addFlowBlock({
                            name: `Segment ${state.flowBlocks.length + 1}`,
                            startFrame: state.workAreaStart ?? 0,
                            endFrame: state.workAreaEnd ?? state.duration,
                            loop: true,
                        });
                    }}
                    className="w-full py-1.5 text-white rounded-lg font-medium text-[11px] flex items-center justify-center gap-2 transition-all duration-200 active:scale-95"
                    style={{ background: 'var(--accent)' }}
                >
                    <Plus size={12} /> Add Segment
                </button>
            </div>
        </div>
    );
}
