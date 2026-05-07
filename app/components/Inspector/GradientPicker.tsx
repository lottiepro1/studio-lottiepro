'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { Gradient, GradientStop } from '@/lib/creator/state/sceneSlice';
import { Box, Circle, Trash2, Plus, Zap } from 'lucide-react';

interface GradientPickerProps {
    gradient: Gradient;
    onChange: (gradient: Gradient) => void;
}

export default function GradientPicker({ gradient, onChange }: GradientPickerProps) {
    const barRef = useRef<HTMLDivElement>(null);
    const [selectedStopId, setSelectedStopId] = useState<number>(0);

    // We use stable IDs for stops to handle selection during sorts
    const stopsWithIds = useMemo(() => {
        return gradient.stops.map((s, i) => ({ ...s, id: i }));
    }, [gradient.stops]);

    const sortedStops = useMemo(() => {
        return [...stopsWithIds].sort((a, b) => a.offset - b.offset);
    }, [stopsWithIds]);

    const selectedStop = stopsWithIds[selectedStopId] || stopsWithIds[0];

    const barBackground = useMemo(() => {
        const stopsStr = sortedStops
            .map(s => `${s.color} ${s.offset * 100}%`)
            .join(', ');
        return `linear-gradient(to right, ${stopsStr})`;
    }, [sortedStops]);

    const handleBarClick = (e: React.MouseEvent) => {
        if (!barRef.current) return;
        const rect = barRef.current.getBoundingClientRect();
        const offset = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

        // Add new stop
        const newStops = [...gradient.stops, {
            offset,
            color: selectedStop.color,
            opacity: selectedStop.opacity
        }];
        onChange({ ...gradient, stops: newStops });
        setSelectedStopId(newStops.length - 1);
    };

    const handleStopMouseDown = (e: React.MouseEvent, id: number) => {
        e.stopPropagation();
        setSelectedStopId(id);

        const onMouseMove = (moveE: MouseEvent) => {
            if (!barRef.current) return;
            const rect = barRef.current.getBoundingClientRect();
            const offset = Math.max(0, Math.min(1, (moveE.clientX - rect.left) / rect.width));

            const newStops = [...gradient.stops];
            newStops[id] = { ...newStops[id], offset };
            onChange({ ...gradient, stops: newStops });
        };

        const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    };

    const deleteSelected = () => {
        if (gradient.stops.length <= 2) return;
        const newStops = gradient.stops.filter((_, i) => i !== selectedStopId);
        onChange({ ...gradient, stops: newStops });
        setSelectedStopId(0);
    };

    const updateSelectedOpacity = (opacity: number) => {
        const newStops = [...gradient.stops];
        newStops[selectedStopId] = { ...newStops[selectedStopId], opacity };
        onChange({ ...gradient, stops: newStops });
    };

    const updateSelectedColor = (color: string) => {
        const newStops = [...gradient.stops];
        newStops[selectedStopId] = { ...newStops[selectedStopId], color };
        onChange({ ...gradient, stops: newStops });
    };

    return (
        <div className="space-y-4 select-none">
            {/* Type Switcher */}
            <div className="flex p-0.5 rounded-lg border border-white/[0.06] gap-0.5" style={{ background: 'var(--bg-surface)' }}>
                <button
                    onClick={() => onChange({ ...gradient, type: 'linear' })}
                    className={`flex-1 h-7 flex items-center justify-center gap-2 rounded-md transition-all ${gradient.type === 'linear'
                        ? 'text-primary'
                        : 'text-muted hover:text-secondary'
                        }`}
                    style={gradient.type === 'linear' ? { background: 'var(--bg-active)' } : {}}
                >
                    <Box size={12} className="rotate-45" />
                    <span className="text-[10px] font-medium">Linear</span>
                </button>
                <button
                    onClick={() => onChange({ ...gradient, type: 'radial' })}
                    className={`flex-1 h-7 flex items-center justify-center gap-2 rounded-md transition-all ${gradient.type === 'radial'
                        ? 'text-primary'
                        : 'text-muted hover:text-secondary'
                        }`}
                    style={gradient.type === 'radial' ? { background: 'var(--bg-active)' } : {}}
                >
                    <Circle size={12} />
                    <span className="text-[10px] font-medium">Radial</span>
                </button>
            </div>

            {/* Gradient Bar Container */}
            <div className="relative pt-6 pb-2 px-1">
                {/* Track */}
                <div
                    ref={barRef}
                    onClick={handleBarClick}
                    className="h-4 rounded-md border border-white/10 cursor-crosshair relative overflow-visible shadow-inner"
                    style={{ background: barBackground }}
                >
                    {/* Stops */}
                    {stopsWithIds.map((stop) => (
                        <div
                            key={stop.id}
                            onMouseDown={(e) => handleStopMouseDown(e, stop.id)}
                            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-6 flex cursor-ew-resize group z-10`}
                            style={{ left: `${stop.offset * 100}%` }}
                        >
                            <div className={`w-3 h-3 rounded-full border-2 bg-white mt-auto mb-[-6px] shadow-lg transition-all ${selectedStopId === stop.id ? 'border-accent scale-125' : 'border-white/50 group-hover:border-white'}`}
                                style={{ backgroundColor: stop.color }} />
                            <div className={`absolute top-[-18px] left-1/2 -translate-x-1/2 text-[8px] font-mono font-bold transition-opacity ${selectedStopId === stop.id ? 'opacity-100 text-accent' : 'opacity-0'}`}>
                                {Math.round(stop.offset * 100)}%
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Selected Stop Area */}
            {selectedStop && (
                <div className="bg-white/[0.02] rounded-lg border border-white/5 p-3 space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: selectedStop.color }} />
                            <span className="text-[10px] text-muted uppercase tracking-widest">Selected Stop</span>
                        </div>
                        <button
                            onClick={deleteSelected}
                            disabled={gradient.stops.length <= 2}
                            className="p-1.5 hover:bg-red-500/10 text-white/10 hover:text-red-400 rounded-md transition-all disabled:opacity-30 disabled:hover:bg-transparent"
                        >
                            <Trash2 size={12} />
                        </button>
                    </div>

                    <div className="flex gap-4">
                        {/* Color */}
                        <div className="flex-1 space-y-1.5">
                            <label className="text-[9px] text-muted uppercase tracking-wider">Color</label>
                            <div className="flex gap-2">
                                <div className="relative w-8 h-8 rounded bg-surface border border-white/[0.03] overflow-hidden">
                                    <input
                                        type="color"
                                        value={selectedStop.color}
                                        onChange={(e) => updateSelectedColor(e.target.value)}
                                        className="absolute inset-[-4px] w-[calc(100%+8px)] h-[calc(100%+8px)] bg-transparent cursor-pointer"
                                    />
                                </div>
                                <input
                                    type="text"
                                    value={selectedStop.color.toUpperCase()}
                                    onChange={(e) => updateSelectedColor(e.target.value)}
                                    className="flex-1 min-w-0 bg-surface border border-white/[0.03] rounded px-2 h-8 text-[11px] font-mono font-bold text-white/70 outline-none focus:border-accent/50"
                                />
                            </div>
                        </div>

                        {/* Opacity */}
                        <div className="w-24 space-y-1.5">
                            <label className="text-[9px] text-muted uppercase tracking-wider">Opacity</label>
                            <div className="relative flex items-center h-8 bg-surface border border-white/[0.03] rounded overflow-hidden">
                                <span className="absolute left-2 text-[8px] font-black text-white/10">%</span>
                                <input
                                    type="number"
                                    value={Math.round(selectedStop.opacity * 100)}
                                    onChange={(e) => updateSelectedOpacity(parseInt(e.target.value) / 100)}
                                    className="w-full h-full bg-transparent text-white/70 text-[11px] font-mono font-bold text-center outline-none pr-2"
                                    min="0"
                                    max="100"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
