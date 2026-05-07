'use client';

import { useState, useRef, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import ColorPicker from './ColorPicker';
import MiniNumberInput from './MiniNumberInput';
import { Effect } from '@/lib/creator/state/sceneSlice';

interface EffectPopoverProps {
    effect: Effect;
    onChange: (updates: Partial<Effect>) => void;
    trigger: React.ReactNode;
}

export default function EffectPopover({ effect, onChange, trigger }: EffectPopoverProps) {
    const [open, setOpen] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);

    // Interaction Resilience (copied from PaintPopover for consistency)
    useEffect(() => {
        if (!open) return;

        const handleGlobalPointer = (e: PointerEvent) => {
            if (!contentRef.current) return;
            const target = e.target as HTMLElement;
            if (contentRef.current.contains(target)) return;
            if (!document.body.contains(target)) return;
            setOpen(false);
        };

        window.addEventListener('pointerdown', handleGlobalPointer, true);
        return () => window.removeEventListener('pointerdown', handleGlobalPointer, true);
    }, [open]);

    const isShadow = effect.type === 'shadow';

    return (
        <Dialog.Root open={open} onOpenChange={setOpen} modal={false}>
            <Dialog.Trigger asChild>
                {trigger}
            </Dialog.Trigger>
            <Dialog.Portal>
                <Dialog.Content
                    ref={contentRef}
                    onInteractOutside={(e) => e.preventDefault()}
                    className="fixed top-24 right-[336px] w-[240px] border border-white/[0.06] rounded-xl shadow-[0_20px_40px_rgba(0,0,0,0.5)] z-[1002] overflow-hidden focus:outline-none flex flex-col animate-in fade-in slide-in-from-right-4 duration-200 pointer-events-auto"
                    style={{ background: 'var(--bg-panel)' }}
                >
                    <Dialog.Title className="sr-only">Effect Settings</Dialog.Title>

                    {/* Header */}
                    <div className="flex items-center justify-between p-3 border-b border-white/[0.06]" style={{ background: 'var(--bg-surface)' }}>
                        <span className="text-xs font-medium text-secondary capitalize">{effect.type} Settings</span>
                        <Dialog.Close asChild>
                            <button className="p-1.5 hover:bg-white/10 rounded-full text-white/20 hover:text-white/60 transition-all">
                                <X size={12} />
                            </button>
                        </Dialog.Close>
                    </div>

                    <div className="p-4 space-y-4 max-h-[80vh] overflow-y-auto custom-scrollbar">
                        {isShadow && (
                            <>
                                {/* Direction (Angle) and Distance */}
                                <div className="flex gap-2">
                                    <div className="flex-1 space-y-1.5">
                                        <label className="text-[8px] text-muted uppercase tracking-[0.2em] pl-0.5">Direction</label>
                                        <div className="bg-black/40 border border-white/5 rounded-md h-8 flex items-center overflow-hidden group/input hover:border-white/10">
                                            <MiniNumberInput
                                                value={effect.direction ?? 0}
                                                onChange={(val) => onChange({ direction: val })}
                                                step={1}
                                                displayFactor={1}
                                                prefix="°"
                                            />
                                        </div>
                                    </div>
                                    <div className="flex-1 space-y-1.5">
                                        <label className="text-[8px] text-muted uppercase tracking-[0.2em] pl-0.5">Distance</label>
                                        <div className="bg-black/40 border border-white/5 rounded-md h-8 flex items-center overflow-hidden group/input hover:border-white/10">
                                            <MiniNumberInput
                                                value={effect.distance ?? 0}
                                                onChange={(val) => onChange({ distance: val })}
                                                step={1}
                                                displayFactor={1}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}

                        {/* Blur Amount */}
                        <div className="space-y-1.5">
                            <label className="text-[8px] text-muted uppercase tracking-[0.2em] pl-0.5">Blur {isShadow ? 'Size' : 'Amount'}</label>
                            <div className="bg-black/40 border border-white/5 rounded-md h-8 flex items-center overflow-hidden group/input hover:border-white/10">
                                <MiniNumberInput
                                    value={effect.blur ?? 0}
                                    onChange={(val) => onChange({ blur: Math.max(0, val) })}
                                    step={1}
                                    displayFactor={1}
                                />
                            </div>
                        </div>

                        {isShadow && (
                            <div className="space-y-4 pt-2">
                                <label className="text-[8px] text-muted uppercase tracking-[0.2em] pl-0.5">Shadow Color</label>
                                <ColorPicker
                                    color={effect.color || '#000000'}
                                    opacity={effect.opacity ?? 1}
                                    onChange={(color, opacity) => onChange({ color, opacity })}
                                />
                            </div>
                        )}

                        {effect.type === 'repeater' && (
                            <>
                                <div className="space-y-4 pt-2">
                                    <div className="flex gap-2">
                                        <div className="flex-1 space-y-1.5">
                                            <label className="text-[8px] text-muted uppercase tracking-[0.2em] pl-0.5">Copies</label>
                                            <div className="bg-black/40 border border-white/5 rounded-md h-8 flex items-center overflow-hidden group/input hover:border-white/10">
                                                <MiniNumberInput
                                                    value={effect.copies ?? 2}
                                                    onChange={(val) => onChange({ copies: Math.max(1, Math.round(val)) })}
                                                    step={1}
                                                    displayFactor={1}
                                                />
                                            </div>
                                        </div>
                                        <div className="flex-1 space-y-1.5">
                                            <label className="text-[8px] text-muted uppercase tracking-[0.2em] pl-0.5">Offset</label>
                                            <div className="bg-black/40 border border-white/5 rounded-md h-8 flex items-center overflow-hidden group/input hover:border-white/10">
                                                <MiniNumberInput
                                                    value={effect.offset ?? 0}
                                                    onChange={(val) => onChange({ offset: val })}
                                                    step={1}
                                                    displayFactor={1}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-[8px] text-muted uppercase tracking-[0.2em] pl-0.5">Transform</label>
                                        <div className="p-3 bg-black/20 rounded-lg border border-white/5 space-y-4">
                                            <div className="flex gap-2">
                                                <div className="flex-1 space-y-1.5">
                                                    <label className="text-[7px] text-muted uppercase tracking-widest">Position X</label>
                                                    <div className="bg-black/40 border border-white/5 rounded-md h-7 flex items-center overflow-hidden">
                                                        <MiniNumberInput
                                                            value={effect.repeaterTransform?.x ?? 0}
                                                            onChange={(val) => onChange({ repeaterTransform: { ...(effect.repeaterTransform || {}), x: val } } as any)}
                                                            step={1}
                                                            displayFactor={1}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="flex-1 space-y-1.5">
                                                    <label className="text-[7px] text-muted uppercase tracking-widest">Position Y</label>
                                                    <div className="bg-black/40 border border-white/5 rounded-md h-7 flex items-center overflow-hidden">
                                                        <MiniNumberInput
                                                            value={effect.repeaterTransform?.y ?? 0}
                                                            onChange={(val) => onChange({ repeaterTransform: { ...(effect.repeaterTransform || {}), y: val } } as any)}
                                                            step={1}
                                                            displayFactor={1}
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex gap-2">
                                                <div className="flex-1 space-y-1.5">
                                                    <label className="text-[7px] text-muted uppercase tracking-widest">Scale X %</label>
                                                    <div className="bg-black/40 border border-white/5 rounded-md h-7 flex items-center overflow-hidden">
                                                        <MiniNumberInput
                                                            value={effect.repeaterTransform?.scaleX ?? 1}
                                                            onChange={(val) => onChange({ repeaterTransform: { ...(effect.repeaterTransform || {}), scaleX: val } } as any)}
                                                            step={1}
                                                            displayFactor={100}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="flex-1 space-y-1.5">
                                                    <label className="text-[7px] text-muted uppercase tracking-widest">Scale Y %</label>
                                                    <div className="bg-black/40 border border-white/5 rounded-md h-7 flex items-center overflow-hidden">
                                                        <MiniNumberInput
                                                            value={effect.repeaterTransform?.scaleY ?? 1}
                                                            onChange={(val) => onChange({ repeaterTransform: { ...(effect.repeaterTransform || {}), scaleY: val } } as any)}
                                                            step={1}
                                                            displayFactor={100}
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="space-y-1.5">
                                                <label className="text-[7px] text-muted uppercase tracking-widest">Rotation °</label>
                                                <div className="bg-black/40 border border-white/5 rounded-md h-7 flex items-center overflow-hidden">
                                                    <MiniNumberInput
                                                        value={effect.repeaterTransform?.rotation ?? 0}
                                                        onChange={(val) => onChange({ repeaterTransform: { ...(effect.repeaterTransform || {}), rotation: val } } as any)}
                                                        step={1}
                                                        displayFactor={1}
                                                    />
                                                </div>
                                            </div>

                                            <div className="flex gap-2">
                                                <div className="flex-1 space-y-1.5">
                                                    <label className="text-[7px] text-muted uppercase tracking-widest">Start Opacity</label>
                                                    <div className="bg-black/40 border border-white/5 rounded-md h-7 flex items-center overflow-hidden">
                                                        <MiniNumberInput
                                                            value={effect.repeaterTransform?.startOpacity ?? 1}
                                                            onChange={(val) => onChange({ repeaterTransform: { ...(effect.repeaterTransform || {}), startOpacity: val } } as any)}
                                                            step={1}
                                                            displayFactor={100}
                                                            min={0}
                                                            max={1}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="flex-1 space-y-1.5">
                                                    <label className="text-[7px] text-muted uppercase tracking-widest">End Opacity</label>
                                                    <div className="bg-black/40 border border-white/5 rounded-md h-7 flex items-center overflow-hidden">
                                                        <MiniNumberInput
                                                            value={effect.repeaterTransform?.endOpacity ?? 1}
                                                            onChange={(val) => onChange({ repeaterTransform: { ...(effect.repeaterTransform || {}), endOpacity: val } } as any)}
                                                            step={1}
                                                            displayFactor={100}
                                                            min={0}
                                                            max={1}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
