'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, X, Zap, ArrowRight, ArrowLeft, Minus, Activity, Feather } from 'lucide-react';
import BezierCanvas from './BezierCanvas';
import { EASING_PRESETS, matchPreset, formatBezier, parseBezier, EasingPreset } from '@/lib/creator/core/EasingPresets';

interface EasingCurveEditorProps {
    isOpen: boolean;
    onClose: () => void;
    easing: string;
    bezier?: [number, number, number, number];
    duration?: number; // in seconds
    onEasingChange: (easing: string, bezier?: [number, number, number, number]) => void;
    anchor?: { x: number, y: number }; // Screen position for popover
}

const PRESET_ICONS: Record<string, React.ReactNode> = {
    'linear': <Minus size={12} />,
    'easy-ease': <Activity size={12} />,
    'ease-in': <ArrowRight size={12} />,
    'ease-out': <ArrowLeft size={12} />,
    'ease-in-out': <Activity size={12} />,
    'smooth': <Feather size={12} />,
    'natural': <Feather size={12} />,
    'slowdown': <ArrowLeft size={12} />,
    'accelerate': <ArrowRight size={12} />,
    'overshoot': <Zap size={12} />,
    'bounce': <Activity size={12} />,
};

export default function EasingCurveEditor({
    isOpen,
    onClose,
    easing,
    bezier,
    duration = 1,
    onEasingChange,
    anchor
}: EasingCurveEditorProps) {
    const [localBezier, setLocalBezier] = useState<[number, number, number, number]>(
        bezier || EASING_PRESETS[easing]?.bezier || [0, 0, 1, 1]
    );
    const [inputValue, setInputValue] = useState(formatBezier(localBezier));
    const [showPresets, setShowPresets] = useState(false);

    // Sync when props change
    useEffect(() => {
        const newBezier = bezier || EASING_PRESETS[easing]?.bezier || [0, 0, 1, 1];
        setLocalBezier(newBezier);
        setInputValue(formatBezier(newBezier));
    }, [easing, bezier]);

    const currentPresetName = useMemo(() => {
        const match = matchPreset(localBezier);
        return match ? EASING_PRESETS[match].label : 'Custom';
    }, [localBezier]);

    const handlePresetSelect = (key: string) => {
        const preset = EASING_PRESETS[key];
        if (preset) {
            setLocalBezier(preset.bezier);
            setInputValue(formatBezier(preset.bezier));
            onEasingChange(key, preset.bezier);
        }
        setShowPresets(false);
    };

    const handleBezierChange = (newBezier: [number, number, number, number]) => {
        setLocalBezier(newBezier);
        setInputValue(formatBezier(newBezier));
        // Check if it matches a preset
        const matchedPreset = matchPreset(newBezier);
        onEasingChange(matchedPreset || 'custom', newBezier);
    };

    const handleInputChange = (value: string) => {
        setInputValue(value);
        const parsed = parseBezier(value);
        if (parsed) {
            setLocalBezier(parsed);
            const matchedPreset = matchPreset(parsed);
            onEasingChange(matchedPreset || 'custom', parsed);
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed z-[100] bg-[#18181b] border border-white/10 rounded-xl shadow-2xl shadow-black/50 p-4 w-[260px]"
            style={{
                left: anchor?.x ?? 100,
                top: anchor?.y ?? 100,
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
        >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-semibold text-white/90">Transition</span>
                <button
                    onClick={onClose}
                    className="p-1 hover:bg-white/10 rounded-md transition-colors text-white/40 hover:text-white/80"
                >
                    <X size={14} />
                </button>
            </div>

            {/* Duration Row */}
            <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-white/40 font-medium">Duration</span>
                <div className="bg-[#0f0f12] border border-white/5 rounded-md px-3 py-1.5 text-sm font-mono text-white/80">
                    {duration.toFixed(2)} s
                </div>
            </div>

            {/* Easing Dropdown */}
            <div className="flex items-center justify-between mb-4">
                <span className="text-xs text-white/40 font-medium">Easing</span>
                <div className="relative">
                    <button
                        onClick={() => setShowPresets(!showPresets)}
                        className="flex items-center gap-2 border border-white/[0.06] rounded-md px-3 py-1.5 text-sm font-medium text-secondary hover:text-primary hover:border-white/10 transition-colors"
                        style={{ background: 'var(--bg-surface)' }}
                    >
                        <span className="text-accent">{PRESET_ICONS[easing] || <Activity size={12} />}</span>
                        {currentPresetName}
                        <ChevronDown size={12} className="text-white/40" />
                    </button>

                    {showPresets && (
                        <div className="absolute right-0 top-full mt-1 border border-white/[0.06] rounded-lg shadow-xl shadow-black/50 py-1 min-w-[160px] z-10 max-h-[200px] overflow-y-auto" style={{ background: 'var(--bg-panel)' }}>
                            {Object.entries(EASING_PRESETS).map(([key, preset]) => (
                                <button
                                    key={key}
                                    onClick={() => handlePresetSelect(key)}
                                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors ${currentPresetName === preset.label
                                        ? 'bg-accent/15 text-accent'
                                        : 'text-secondary hover:bg-hover hover:text-primary'
                                        }`}
                                >
                                    <span className="text-accent">{PRESET_ICONS[key] || <Activity size={12} />}</span>
                                    {preset.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Bezier Canvas */}
            <div className="flex justify-center mb-4">
                <BezierCanvas
                    bezier={localBezier}
                    onChange={handleBezierChange}
                    width={220}
                    height={160}
                />
            </div>

            {/* Value Input */}
            <div className="flex items-center justify-between">
                <span className="text-xs text-white/40 font-medium">Value</span>
                <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => handleInputChange(e.target.value)}
                    className="border border-white/[0.06] rounded-md px-3 py-1.5 text-sm font-mono text-secondary w-[140px] focus:outline-none focus:border-accent/50 transition-colors"
                    style={{ background: 'var(--bg-surface)' }}
                    placeholder="0, 0, 1, 1"
                />
            </div>
        </div>
    );
}
