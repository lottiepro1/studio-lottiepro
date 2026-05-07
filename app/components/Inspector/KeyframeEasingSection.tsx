'use client';

import { useState, useMemo } from 'react';
import { useCreatorStore } from '@/lib/creator/state/store';
import { EASING_PRESETS, matchPreset, formatBezier, parseBezier } from '@/lib/creator/core/EasingPresets';
import { ChevronDown, Activity, Minus, ArrowRight, ArrowLeft, Zap, Feather } from 'lucide-react';
import BezierCanvas from '../Timeline/BezierCanvas';

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

// Quick preset buttons shown in the main panel
const QUICK_PRESETS = ['linear', 'easy-ease', 'ease-in', 'ease-out'];

export default function KeyframeEasingSection() {
    const nodes = useCreatorStore((state) => state.nodes);
    const selectedKeyframeIds = useCreatorStore((state) => state.selectedKeyframeIds);
    const updateKeyframe = useCreatorStore((state) => state.updateKeyframe);
    const fps = useCreatorStore((state) => state.fps);

    const [showBezierEditor, setShowBezierEditor] = useState(false);
    const [showPresetDropdown, setShowPresetDropdown] = useState(false);

    // Parse selected keyframes into usable data
    const { selectedKeyframes, displayCount } = useMemo(() => {
        const items = selectedKeyframeIds.map(globalId => {
            const [nodeId, path, kfId] = globalId.split(':');
            const node = nodes.get(nodeId);
            if (!node) return null;
            const keyframes = node.animations?.[path] || [];
            const kf = keyframes.find(k => k.id === kfId);
            if (!kf) return null;
            return { nodeId, path, kf, node };
        }).filter(Boolean) as any[];

        // Calculate visual count: group by NodeId + Property Group Label + Time
        // This makes "Position" count as 1 even if it has X and Y keyframes
        const visualSlots = new Set();
        items.forEach(item => {
            // Map specific paths to their UI group labels to ensure correct counting
            let groupKey = item.path;
            if (item.path === 'transform.x' || item.path === 'transform.y') groupKey = 'transform.position';
            if (item.path === 'transform.scaleX' || item.path === 'transform.scaleY') groupKey = 'transform.scale';
            if (item.path === 'props.width' || item.path === 'props.height') groupKey = 'props.size';
            if (item.path === 'props.radiusX' || item.path === 'props.radiusY') groupKey = 'props.radius';
            
            const slotKey = `${item.nodeId}:${groupKey}:${item.kf.time}`;
            visualSlots.add(slotKey);
        });

        return { selectedKeyframes: items, displayCount: visualSlots.size };
    }, [selectedKeyframeIds, nodes]);

    // Get the common easing of selected keyframes
    const commonEasing = useMemo(() => {
        if (selectedKeyframes.length === 0) return null;
        const first = selectedKeyframes[0];
        if (!first) return null;
        const easing = first.kf.easing || 'linear';
        const bezier = first.kf.bezier;

        // Check if all selected keyframes have the same easing
        const allSame = selectedKeyframes.every(item =>
            item && (item.kf.easing || 'linear') === easing
        );

        if (!allSame) return { easing: 'mixed', bezier: null };

        return { easing, bezier };
    }, [selectedKeyframes]);

    // Calculate duration to next keyframe
    const duration = useMemo(() => {
        if (selectedKeyframes.length === 0) return 1;
        const first = selectedKeyframes[0];
        if (!first) return 1;
        const kfs = first.node.animations?.[first.path] || [];
        const idx = kfs.findIndex((k: any) => k.id === first.kf.id);
        if (idx >= 0 && idx < kfs.length - 1) {
            return (kfs[idx + 1].time - first.kf.time) / fps;
        }
        return 1;
    }, [selectedKeyframes, fps]);

    // Handle preset selection
    const handlePresetSelect = (presetKey: string) => {
        const preset = EASING_PRESETS[presetKey];
        if (!preset) return;

        selectedKeyframes.forEach(item => {
            if (item) {
                updateKeyframe(item.nodeId, item.path, item.kf.id, {
                    easing: presetKey as any,
                    bezier: preset.bezier
                });
            }
        });
        setShowPresetDropdown(false);
    };

    // Handle bezier change from canvas
    const handleBezierChange = (newBezier: [number, number, number, number]) => {
        const matchedPreset = matchPreset(newBezier);
        selectedKeyframes.forEach(item => {
            if (item) {
                updateKeyframe(item.nodeId, item.path, item.kf.id, {
                    easing: matchedPreset || 'custom' as any,
                    bezier: newBezier
                });
            }
        });
    };

    // Don't render if no keyframes selected
    if (selectedKeyframes.length === 0) return null;

    const currentBezier = commonEasing?.bezier ||
        (commonEasing?.easing && EASING_PRESETS[commonEasing.easing]?.bezier) ||
        [0, 0, 1, 1] as [number, number, number, number];

    const currentPresetName = commonEasing?.easing === 'mixed'
        ? 'Mixed'
        : (matchPreset(currentBezier) ? EASING_PRESETS[matchPreset(currentBezier)!]?.label : 'Custom') || 'Linear';

    return (
        <div className="p-4 border-b border-white/5 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h3 className="text-[10px] font-semibold text-muted uppercase tracking-widest">Keyframe</h3>
                <span className="text-[10px] font-medium text-accent bg-accent/15 px-2 py-0.5 rounded-full">
                    {displayCount} selected
                </span>
            </div>

            {/* Easing Preset Quick Buttons */}
            <div className="space-y-2">
                <label className="text-[10px] text-muted uppercase tracking-wider">Easing Preset</label>
                <div className="grid grid-cols-2 gap-2">
                    {QUICK_PRESETS.map(presetKey => {
                        const preset = EASING_PRESETS[presetKey];
                        const isActive = commonEasing?.easing === presetKey ||
                            (commonEasing?.bezier && matchPreset(commonEasing.bezier) === presetKey);

                        return (
                            <button
                                key={presetKey}
                                onClick={() => handlePresetSelect(presetKey)}
                                className={`flex items-center justify-center gap-1.5 h-8 rounded-md text-[11px] font-medium transition-all ${isActive
                                    ? 'text-accent border border-accent/40'
                                    : 'text-muted border border-white/[0.06] hover:bg-hover hover:text-secondary'
                                    }`}
                                style={isActive ? { background: 'var(--accent-soft)' } : {}}
                            >
                                <span className="text-current">{PRESET_ICONS[presetKey]}</span>
                                {preset.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Current Easing with Dropdown */}
            <div className="space-y-2">
                <label className="text-[10px] text-muted uppercase tracking-wider">Transition Curve</label>
                <div className="relative">
                    <button
                        onClick={() => setShowBezierEditor(!showBezierEditor)}
                        className="w-full flex items-center justify-between bg-surface border border-white/[0.06] rounded-md px-3 h-9 text-[11px] text-secondary hover:text-primary hover:border-white/10 transition-all"
                    >
                        <div className="flex items-center gap-2">
                            <span className="text-accent">{PRESET_ICONS[commonEasing?.easing || 'linear'] || <Activity size={12} />}</span>
                            {currentPresetName}
                        </div>
                        <ChevronDown size={12} className={`text-white/40 transition-transform ${showBezierEditor ? 'rotate-180' : ''}`} />
                    </button>

                    {/* Preset Dropdown */}
                    {showPresetDropdown && (
                        <div className="absolute left-0 right-0 top-full mt-1 border border-white/[0.06] rounded-lg shadow-xl shadow-black/50 py-1 z-50 max-h-[200px] overflow-y-auto" style={{ background: 'var(--bg-panel)' }}>
                            {Object.entries(EASING_PRESETS).map(([key, preset]) => (
                                <button
                                    key={key}
                                    onClick={() => handlePresetSelect(key)}
                                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left transition-colors ${commonEasing?.easing === key
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

            {/* Bezier Editor Panel */}
            {showBezierEditor && (
                <div className="space-y-4 pt-2">
                    {/* Duration */}
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] text-white/30 font-medium">Duration</span>
                        <span className="text-[11px] font-mono text-white/60 bg-white/[0.03] px-2 py-1 rounded-md">
                            {duration.toFixed(2)} s
                        </span>
                    </div>

                    {/* All Presets Grid */}
                    <div className="grid grid-cols-3 gap-1.5">
                        {Object.entries(EASING_PRESETS).map(([key, preset]) => {
                            const isActive = commonEasing?.easing === key ||
                                (commonEasing?.bezier && matchPreset(commonEasing.bezier) === key);

                            return (
                                <button
                                    key={key}
                                    onClick={() => handlePresetSelect(key)}
                                    className={`flex items-center justify-center gap-1 h-7 rounded text-[9px] font-medium transition-all ${isActive
                                        ? 'text-accent border border-accent/40'
                                        : 'text-muted border border-white/[0.06] hover:bg-hover hover:text-secondary'
                                        }`}
                                    style={isActive ? { background: 'var(--accent-soft)' } : {}}
                                >
                                    {preset.label}
                                </button>
                            );
                        })}
                    </div>

                    {/* Bezier Canvas */}
                    <div className="flex justify-center">
                        <BezierCanvas
                            bezier={currentBezier}
                            onChange={handleBezierChange}
                            width={240}
                            height={160}
                        />
                    </div>

                    {/* Value Input */}
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] text-white/30 font-medium">Value</span>
                        <input
                            type="text"
                            value={formatBezier(currentBezier)}
                            onChange={(e) => {
                                const parsed = parseBezier(e.target.value);
                                if (parsed) handleBezierChange(parsed);
                            }}
                            className="bg-surface border border-white/[0.06] rounded-md px-2 py-1 text-[10px] font-mono text-secondary w-[140px] focus:outline-none focus:border-accent/50 transition-colors"
                            placeholder="0, 0, 1, 1"
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
