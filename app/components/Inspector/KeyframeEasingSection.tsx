'use client';

import { useMemo, useState, useRef, useEffect } from 'react';
import { useCreatorStore } from '@/lib/creator/state/store';
import { EASING_PRESETS, matchPreset } from '@/lib/creator/core/EasingPresets';
import { CaretDown as PhCaretDown, LinkSimple as PhLinkSimple } from '@phosphor-icons/react';
import BezierCanvas from '../Timeline/BezierCanvas';

type Bezier = [number, number, number, number];

const LBL: React.CSSProperties = { fontFamily: 'Inter, sans-serif', fontWeight: 450, fontSize: 12, lineHeight: '16px', letterSpacing: '0.005em', color: '#FFFFFF' };

// Small ease-curve glyph used in the preset dropdown (placeholder for the Figma icon).
function CurveIcon({ size = 14, color = 'rgba(255,255,255,0.7)' }: { size?: number; color?: string }) {
    return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
            <path d="M2 13C6.5 13 9.5 3 14 3" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    );
}

// Influence value box (0–100), drag-to-scrub + click-to-edit, #383838 patch.
function EaseInput({ value, onChange }: { value: number; onChange: (v: number, record?: boolean) => void }) {
    const [editing, setEditing] = useState(false);
    const [local, setLocal] = useState('');
    const ref = useRef<HTMLInputElement>(null);
    useEffect(() => { if (editing) { ref.current?.focus(); ref.current?.select(); } }, [editing]);

    const commit = () => {
        setEditing(false);
        const n = parseFloat(local);
        if (!isNaN(n)) onChange(Math.max(0, Math.min(100, Math.round(n))), true);
    };
    const onDown = (e: React.MouseEvent) => {
        if (editing || e.button !== 0) return;
        const startX = e.clientX; const startVal = value; let moved = false;
        const move = (me: MouseEvent) => {
            const dx = me.clientX - startX;
            if (Math.abs(dx) > 3) moved = true;
            if (moved) onChange(Math.max(0, Math.min(100, Math.round(startVal + dx))), false);
        };
        const up = () => {
            if (!moved) { setLocal(String(value)); setEditing(true); }
            window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
            document.body.style.cursor = 'default';
        };
        window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
        document.body.style.cursor = 'ew-resize';
    };
    return (
        <div className="flex items-center justify-center flex-1 min-w-0 cursor-ew-resize select-none"
            style={{ height: 32, background: '#383838', borderRadius: 6 }} onMouseDown={editing ? undefined : onDown}>
            {editing ? (
                <input ref={ref} type="text" className="w-full bg-transparent outline-none text-center" style={LBL}
                    value={local} onChange={e => setLocal(e.target.value)} onBlur={commit}
                    onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }} />
            ) : (
                <span style={LBL}>{Math.round(value)}</span>
            )}
        </div>
    );
}

export default function KeyframeEasingSection() {
    const nodes = useCreatorStore((state) => state.nodes);
    const selectedKeyframeIds = useCreatorStore((state) => state.selectedKeyframeIds);
    const updateKeyframe = useCreatorStore((state) => state.updateKeyframe);

    const [showPresets, setShowPresets] = useState(false);
    // Ease In/Out linked (symmetric) by default, like After Effects' Easy Ease.
    const [linked, setLinked] = useState(true);

    // Resolve the selected keyframes.
    const selectedKeyframes = useMemo(() => {
        return selectedKeyframeIds.map(globalId => {
            const [nodeId, path, kfId] = globalId.split(':');
            const node = nodes.get(nodeId);
            if (!node) return null;
            const kf = (node.animations?.[path] || []).find(k => k.id === kfId);
            if (!kf) return null;
            return { nodeId, path, kf };
        }).filter(Boolean) as { nodeId: string; path: string; kf: any }[];
    }, [selectedKeyframeIds, nodes]);

    // Common easing across the selection.
    const commonEasing = useMemo(() => {
        if (selectedKeyframes.length === 0) return null;
        const first = selectedKeyframes[0];
        const easing = first.kf.easing || 'linear';
        const allSame = selectedKeyframes.every(it => (it.kf.easing || 'linear') === easing);
        return { easing: allSame ? easing : 'mixed', bezier: allSame ? first.kf.bezier : null };
    }, [selectedKeyframes]);

    const applyBezier = (b: Bezier) => {
        const preset = matchPreset(b);
        selectedKeyframes.forEach(it => updateKeyframe(it.nodeId, it.path, it.kf.id, { easing: (preset || 'custom') as any, bezier: b }));
    };

    const handlePresetSelect = (key: string) => {
        const preset = EASING_PRESETS[key];
        if (!preset) return;
        selectedKeyframes.forEach(it => updateKeyframe(it.nodeId, it.path, it.kf.id, { easing: key as any, bezier: preset.bezier }));
        setShowPresets(false);
    };

    if (selectedKeyframes.length === 0) return null;

    const currentBezier: Bezier = (commonEasing?.bezier
        || (commonEasing?.easing && commonEasing.easing !== 'mixed' && EASING_PRESETS[commonEasing.easing]?.bezier)
        || [0, 0, 1, 1]) as Bezier;

    const matched = matchPreset(currentBezier);
    const presetLabel = commonEasing?.easing === 'mixed' ? 'Mixed' : (matched ? EASING_PRESETS[matched].label : 'Custom');

    // Influence values: easeOut = handle-1 X, easeIn = (1 − handle-2 X).
    const easeOut = Math.round(currentBezier[0] * 100);
    const easeIn = Math.round((1 - currentBezier[2]) * 100);

    const setEaseOut = (v: number) => {
        const x1 = v / 100;
        applyBezier([x1, currentBezier[1], linked ? 1 - x1 : currentBezier[2], currentBezier[3]]);
    };
    const setEaseIn = (v: number) => {
        const x2 = 1 - v / 100;
        applyBezier([linked ? 1 - x2 : currentBezier[0], currentBezier[1], x2, currentBezier[3]]);
    };

    return (
        <div className="flex flex-col" style={{ padding: 10, gap: 10, borderBottom: '1px solid #444444', background: '#2C2C2C' }}>
            <span style={LBL}>Easing</span>

            {/* Preset dropdown */}
            <div className="relative">
                <button onClick={() => setShowPresets(v => !v)} className="w-full flex items-center justify-between"
                    style={{ height: 32, background: '#383838', borderRadius: 6, paddingLeft: 8 }}>
                    <span className="flex items-center gap-2 truncate" style={LBL}>
                        <CurveIcon />
                        {presetLabel}
                    </span>
                    <div className="flex items-center justify-center shrink-0" style={{ width: 24, height: 32 }}>
                        <PhCaretDown size={14} weight="regular" color="rgba(255,255,255,0.7)" />
                    </div>
                </button>
                {showPresets && (
                    <>
                        <div className="fixed inset-0 z-[99]" onClick={() => setShowPresets(false)} />
                        <div className="absolute top-full left-0 right-0 mt-1 z-[100] rounded overflow-y-auto"
                            style={{ background: '#27292C', border: '1px solid #444444', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', maxHeight: 260 }}>
                            {Object.entries(EASING_PRESETS).map(([key, preset]) => (
                                <button key={key} onClick={() => handlePresetSelect(key)}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors"
                                    style={{ ...LBL, color: matched === key ? 'var(--accent)' : '#FFFFFF' }}>
                                    <CurveIcon color={matched === key ? 'var(--accent)' : 'rgba(255,255,255,0.7)'} />
                                    {preset.label}
                                </button>
                            ))}
                        </div>
                    </>
                )}
            </div>

            {/* Editable graph */}
            <div className="flex justify-center">
                <BezierCanvas bezier={currentBezier} onChange={(b) => applyBezier(b)} width={218} height={130} />
            </div>

            {/* Ease Out / Ease In values + link (symmetric) */}
            <div className="flex items-center" style={{ gap: 6 }}>
                <EaseInput value={easeOut} onChange={(v) => setEaseOut(v)} />
                <button onClick={() => setLinked(v => !v)}
                    className="flex items-center justify-center shrink-0 transition-colors"
                    style={{ width: 28, height: 32, borderRadius: 6, background: linked ? '#0A6DC2' : 'transparent' }}
                    title={linked ? 'Ease in/out linked' : 'Ease in/out independent'}>
                    <PhLinkSimple size={14} weight="regular" color={linked ? '#FFFFFF' : 'rgba(255,255,255,0.4)'} />
                </button>
                <EaseInput value={easeIn} onChange={(v) => setEaseIn(v)} />
            </div>
        </div>
    );
}
