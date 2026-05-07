'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Trash2, Pipette } from 'lucide-react';
import ColorPicker from './ColorPicker';
import { Gradient } from '@/lib/creator/state/sceneSlice';
import { createDefaultGradient, createShapeGradient } from '@/lib/creator/core/SceneNode';

interface PaintPopoverProps {
    type: 'solid' | 'gradient';
    color?: string;
    gradient?: Gradient;
    groupColors?: string[];
    nodeSize?: { width: number; height: number };
    onChange: (updates: { type?: 'solid' | 'gradient', color?: string, gradient?: Gradient, originalColor?: string }) => void;
    trigger: React.ReactNode;
}

export default function PaintPopover({ type, color, gradient, groupColors = [], nodeSize, onChange, trigger }: PaintPopoverProps) {
    const [open, setOpen] = useState(false);
    const [selectedStopId, setSelectedStopId] = useState<number>(0);
    const [targetingColor, setTargetingColor] = useState<string | null>(null);
    const [localColor, setLocalColor] = useState(color);
    const contentRef = useRef<HTMLDivElement>(null);
    const barRef = useRef<HTMLDivElement>(null);

    // Sync local color with prop when NOT targeting
    useEffect(() => {
        if (!targetingColor) {
            setLocalColor(color);
        }
    }, [color, targetingColor]);

    // Reset targeting color when popover closes
    useEffect(() => {
        if (!open) setTargetingColor(null);
    }, [open]);

    // --- Interaction Resilience ---
    useEffect(() => {
        if (!open) return;

        const handleGlobalPointer = (e: PointerEvent) => {
            if (!contentRef.current) return;

            const target = e.target as HTMLElement;
            // If the click is inside the popover content, do nothing
            if (contentRef.current.contains(target)) return;

            // If the element is detached (unmounted during re-render), do nothing
            // This is the CRITICAL fix for the "abrupt closure" issue
            if (!document.body.contains(target)) return;

            // Check if clicking the trigger (to avoid double toggle)
            const triggerEl = document.querySelector('[data-state="open"]');
            if (triggerEl?.contains(target)) return;

            setOpen(false);
        };

        window.addEventListener('pointerdown', handleGlobalPointer, true);
        return () => window.removeEventListener('pointerdown', handleGlobalPointer, true);
    }, [open]);

    // --- Gradient Logic ---
    const stopsWithIds = useMemo(() => {
        // Safety: gradient might be undefined or 'mixed' string when multiple nodes selected
        if (!gradient || typeof gradient !== 'object' || !Array.isArray(gradient.stops)) {
            return [];
        }
        return gradient.stops.map((s, i) => ({ ...s, id: i }));
    }, [gradient]);

    const sortedStops = useMemo(() => {
        return [...stopsWithIds].sort((a, b) => a.offset - b.offset);
    }, [stopsWithIds]);

    const selectedStop = stopsWithIds[selectedStopId] || stopsWithIds[0] || { color: '#ffffff', opacity: 1, offset: 0 };

    const barBackground = useMemo(() => {
        if (!sortedStops.length) return 'linear-gradient(to right, #ffffff 0%, #ffffff 100%)';
        const stopsStr = sortedStops
            .map(s => `${s.color} ${s.offset * 100}%`)
            .join(', ');
        return `linear-gradient(to right, ${stopsStr})`;
    }, [sortedStops]);

    const handleBarClick = (e: React.MouseEvent) => {
        if (!barRef.current || !gradient || typeof gradient !== 'object' || !Array.isArray(gradient.stops)) return;
        const rect = barRef.current.getBoundingClientRect();
        const offset = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

        const newStops = [...gradient.stops, {
            offset,
            color: selectedStop?.color || '#ffffff',
            opacity: selectedStop?.opacity ?? 1
        }];
        onChange({ gradient: { ...gradient, stops: newStops } });
        setSelectedStopId(newStops.length - 1);
    };

    const handleStopMouseDown = (e: React.MouseEvent, id: number) => {
        e.stopPropagation();
        setSelectedStopId(id);

        const onMouseMove = (moveE: MouseEvent) => {
            if (!barRef.current || !gradient || typeof gradient !== 'object' || !Array.isArray(gradient.stops)) return;
            const rect = barRef.current.getBoundingClientRect();
            const offset = Math.max(0, Math.min(1, (moveE.clientX - rect.left) / rect.width));

            const newStops = [...gradient.stops];
            newStops[id] = { ...newStops[id], offset };
            onChange({ gradient: { ...gradient, stops: newStops } });
        };

        const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    };

    const deleteSelectedStop = () => {
        if (!gradient || typeof gradient !== 'object' || !Array.isArray(gradient.stops) || gradient.stops.length <= 2) return;
        const newStops = gradient.stops.filter((_, i) => i !== selectedStopId);
        onChange({ gradient: { ...gradient, stops: newStops } });
        setSelectedStopId(0);
    };

    return (
        <Dialog.Root open={open} onOpenChange={setOpen} modal={false}>
            <Dialog.Trigger asChild>
                {trigger}
            </Dialog.Trigger>
            <Dialog.Portal>
                <Dialog.Content
                    ref={contentRef}
                    onInteractOutside={(e) => {
                        // We handle this manually in the useEffect for much higher stability
                        e.preventDefault();
                    }}
                    className="fixed top-24 right-[336px] w-[240px] border border-white/[0.06] rounded-xl shadow-[0_20px_40px_rgba(0,0,0,0.5)] z-[1001] overflow-hidden focus:outline-none flex flex-col animate-in fade-in slide-in-from-right-4 duration-200 pointer-events-auto"
                    style={{ background: 'var(--bg-panel)' }}
                >
                    <Dialog.Title className="sr-only uppercase font-black tracking-widest text-[10px]">Color Picker</Dialog.Title>

                    {/* Header */}
                    <div className="flex items-center justify-between p-3 border-b border-white/[0.06]" style={{ background: 'var(--bg-surface)' }}>
                        <div className="flex p-0.5 rounded-lg border border-white/[0.06] gap-0.5" style={{ background: 'var(--bg-panel)' }}>
                            <button
                                onClick={() => onChange({ type: 'solid' })}
                                className={`px-2.5 py-1 rounded-md text-[9px] font-medium transition-all ${type === 'solid' ? 'text-primary' : 'text-muted hover:text-secondary'}`}
                                style={type === 'solid' ? { background: 'var(--bg-active)' } : {}}
                            >Solid</button>
                            <button
                                onClick={() => {
                                    const hasExisting = gradient && typeof gradient === 'object' && Array.isArray(gradient.stops);
                                    const baseGrad = hasExisting ? gradient! : (nodeSize ? createShapeGradient(nodeSize.width, nodeSize.height) : createDefaultGradient());
                                    onChange({ type: 'gradient', gradient: { ...baseGrad, type: 'linear' } });
                                }}
                                className={`px-2.5 py-1 rounded-md text-[9px] font-medium transition-all ${type === 'gradient' && (gradient as any)?.type === 'linear' ? 'text-primary' : 'text-muted hover:text-secondary'}`}
                                style={type === 'gradient' && (gradient as any)?.type === 'linear' ? { background: 'var(--bg-active)' } : {}}
                            >Linear</button>
                            <button
                                onClick={() => {
                                    const hasExisting = gradient && typeof gradient === 'object' && Array.isArray(gradient.stops);
                                    const baseGrad = hasExisting ? gradient! : (nodeSize ? createShapeGradient(nodeSize.width, nodeSize.height) : createDefaultGradient());
                                    onChange({ type: 'gradient', gradient: { ...baseGrad, type: 'radial' } });
                                }}
                                className={`px-2.5 py-1 rounded-md text-[9px] font-medium transition-all ${type === 'gradient' && (gradient as any)?.type === 'radial' ? 'text-primary' : 'text-muted hover:text-secondary'}`}
                                style={type === 'gradient' && (gradient as any)?.type === 'radial' ? { background: 'var(--bg-active)' } : {}}
                            >Radial</button>
                        </div>
                        <Dialog.Close asChild>
                            <button className="p-1.5 hover:bg-white/10 rounded-full text-white/20 hover:text-white/60 transition-all">
                                <X size={12} />
                            </button>
                        </Dialog.Close>
                    </div>

                    <div className="p-4 space-y-6 max-h-[80vh] overflow-y-auto custom-scrollbar">
                        {/* Gradient Bar (only if gradient) */}
                        {type === 'gradient' && gradient && typeof gradient === 'object' && Array.isArray(gradient.stops) && (
                            <div className="space-y-4">
                                <div className="relative pt-2 pb-10 px-1 min-h-[50px] flex flex-col justify-start">
                                    {/* The interactive bar - only for adding points */}
                                    <div
                                        ref={barRef}
                                        onClick={handleBarClick}
                                        className="h-3 rounded-full border border-white/10 cursor-crosshair relative shadow-inner z-0"
                                        style={{ background: barBackground }}
                                    />

                                    {/* The handles - siblings to the bar so clicks don't bubble to handleBarClick */}
                                    <div className="absolute inset-x-1 top-0 bottom-0 pointer-events-none">
                                        {stopsWithIds.map((stop) => (
                                            <div
                                                key={stop.id}
                                                onMouseDown={(e) => handleStopMouseDown(e, stop.id)}
                                                onClick={(e) => e.stopPropagation()}
                                                className="absolute top-3 bottom-0 w-6 -translate-x-1/2 flex flex-col items-center cursor-ew-resize group z-10 pointer-events-auto"
                                                style={{ left: `${stop.offset * 100}%` }}
                                            >
                                                {/* Visual tick/anchor */}
                                                <div className={`w-[2px] h-1.5 bg-white/10 group-hover:bg-white/30 transition-colors ${selectedStopId === stop.id ? 'bg-accent/50' : ''}`} />

                                                <div className={`w-3.5 h-3.5 rounded-full border-2 bg-white shadow-lg transition-all ${selectedStopId === stop.id ? 'border-accent scale-125 ring-4 ring-accent/20' : 'border-white/50 group-hover:border-white'}`}
                                                    style={{ backgroundColor: stop.color }} />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-[9px] text-muted uppercase tracking-widest">Gradient Stop</span>
                                    <button
                                        onClick={deleteSelectedStop}
                                        disabled={!gradient || typeof gradient !== 'object' || !Array.isArray(gradient.stops) || gradient.stops.length <= 2}
                                        className="p-1.5 hover:bg-red-500/10 text-white/10 hover:text-red-400 rounded-md transition-all disabled:opacity-10"
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Color Picker Section */}
                        <ColorPicker
                            color={type === 'solid' ? (localColor || '#ffffff') : selectedStop.color}
                            opacity={type === 'solid' ? 1 : selectedStop.opacity}
                            onChange={(newColor, newOpacity) => {
                                setLocalColor(newColor);
                                if (type === 'solid') {
                                    const original = targetingColor;
                                    onChange({ color: newColor, originalColor: original || undefined });
                                    if (original) setTargetingColor(newColor); // Keep following the targeted color
                                } else if (gradient && typeof gradient === 'object' && Array.isArray(gradient.stops)) {
                                    const newStops = [...gradient.stops];
                                    if (newStops[selectedStopId]) {
                                        newStops[selectedStopId] = { ...newStops[selectedStopId], color: newColor, opacity: newOpacity };
                                        onChange({ gradient: { ...gradient, stops: newStops } });
                                    }
                                }
                            }}
                        />
                    </div>

                    {/* Presets / Group Colors */}
                    <div className="p-4 border-t border-white/5 bg-black/20 space-y-4">
                        {groupColors.length > 0 && (
                            <div className="space-y-2" onClick={() => setTargetingColor(null)}>
                                <span className="text-[9px] text-muted uppercase tracking-widest cursor-default">Group Colors</span>
                                <div className="grid grid-cols-8 gap-2">
                                    {groupColors.map(c => (
                                        <button
                                            key={c}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (targetingColor === c) {
                                                    setTargetingColor(null);
                                                    setLocalColor(color); // Revert to global color
                                                } else {
                                                    setTargetingColor(c);
                                                    setLocalColor(c); // Move picker to this color
                                                }
                                            }}
                                            className={`aspect-square rounded border transition-all cursor-pointer ${targetingColor === c ? 'border-accent scale-110 ' : 'border-white/10 hover:scale-110'}`}
                                            style={{ backgroundColor: c }}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="space-y-2">
                            <span className="text-[9px] text-muted uppercase tracking-widest">Presets</span>
                            <div className="grid grid-cols-8 gap-2">
                                {['#000000', '#FFFFFF', '#FF335A', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'].map(preset => (
                                    <button
                                        key={preset}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            const original = targetingColor;
                                            setLocalColor(preset);
                                            if (type === 'solid') {
                                                onChange({ color: preset, originalColor: original || undefined });
                                                if (original) setTargetingColor(preset); // Keep targeting this color even after change
                                            } else if (gradient && typeof gradient === 'object' && Array.isArray(gradient.stops)) {
                                                const newStops = [...gradient.stops];
                                                if (newStops[selectedStopId]) {
                                                    newStops[selectedStopId] = { ...newStops[selectedStopId], color: preset };
                                                    onChange({ gradient: { ...gradient, stops: newStops } });
                                                }
                                            }
                                        }}
                                        className="aspect-square rounded border border-white/10 hover:scale-110 active:scale-95 transition-transform cursor-pointer"
                                        style={{ backgroundColor: preset }}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
