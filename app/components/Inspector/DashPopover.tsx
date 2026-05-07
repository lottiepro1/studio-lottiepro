'use client';

import { useState, useRef, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Minus, Plus, Trash2 } from 'lucide-react';

import MiniNumberInput from './MiniNumberInput';

interface DashPopoverProps {
    dashArray: string;
    onChange: (value: string) => void;
    trigger: React.ReactNode;
}

export default function DashPopover({ dashArray, onChange, trigger }: DashPopoverProps) {
    const [open, setOpen] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);
    const [localValues, setLocalValues] = useState<number[]>([]);

    // Sync local values only when popover opens or when not interacting
    useEffect(() => {
        if (!open) {
            setLocalValues((dashArray || '10 10').split(' ').filter(v => v !== '').map(v => parseInt(v) || 0));
        }
    }, [dashArray, open]);

    const handleValueChange = (index: number, val: number) => {
        const next = [...localValues];
        next[index] = val;
        setLocalValues(next);

        // Propagate change
        onChange(next.join(' '));
    };

    const addSegment = () => {
        const next = [...localValues, 10, 10];
        setLocalValues(next);
        onChange(next.join(' '));
    };

    const removeSegment = (index: number) => {
        const next = localValues.filter((_, i) => i !== index);
        setLocalValues(next);
        onChange(next.join(' '));
    };

    return (
        <Dialog.Root open={open} onOpenChange={setOpen} modal={false}>
            <Dialog.Trigger asChild>
                {trigger}
            </Dialog.Trigger>
            <Dialog.Portal>
                {/* 
                   We use a high z-index and pointer-events-auto. 
                   We also aggressively stop propagation on mousedown/pointerdown 
                   to prevent background layers from reacting.
                */}
                <Dialog.Content
                    ref={contentRef}
                    onPointerDown={e => e.stopPropagation()}
                    onMouseDown={e => e.stopPropagation()}
                    onInteractOutside={e => {
                        // Crucial: Prevent Radix from closing it when clicking "outside".
                        // We will handle closure manually if needed, or let the user click the X.
                        // This prevents closures when child elements are swapped during re-renders.
                        e.preventDefault();
                    }}
                    onFocusOutside={e => e.preventDefault()}
                    className="fixed top-24 right-[336px] w-[220px] border border-white/[0.06] rounded-xl shadow-[0_20px_40px_rgba(0,0,0,0.5)] z-[9999] overflow-hidden focus:outline-none flex flex-col animate-in fade-in slide-in-from-right-4 duration-200 pointer-events-auto"
                    style={{ background: 'var(--bg-panel)' }}
                >
                    <Dialog.Title className="sr-only">Dash Settings</Dialog.Title>

                    <div className="flex items-center justify-between p-3 border-b border-white/[0.06]" style={{ background: 'var(--bg-surface)' }}>
                        <span className="text-xs font-medium text-secondary">Dash Settings</span>
                        <Dialog.Close asChild>
                            <button className="p-1.5 hover:bg-white/10 rounded-full text-white/20 hover:text-white/60 transition-all">
                                <X size={12} />
                            </button>
                        </Dialog.Close>
                    </div>

                    <div className="p-4 space-y-3 max-h-[300px] overflow-y-auto custom-scrollbar">
                        {localValues.length === 0 ? (
                            <div className="py-2 text-center text-[10px] text-white/20 italic">No segments</div>
                        ) : (
                            <div className="space-y-3">
                                {localValues.map((val, i) => (
                                    <div key={i} className="flex items-center gap-2 group/item">
                                        <div className={`w-1 h-8 rounded-full ${i % 2 === 0 ? 'bg-accent' : 'bg-white/10'}`} />
                                        <div className="flex-1">
                                            <span className="text-[8px] text-muted uppercase tracking-widest pl-0.5 block mb-0.5">
                                                {i % 2 === 0 ? 'Dash' : 'Gap'}
                                            </span>
                                            <div className="bg-black/40 border border-white/5 rounded-md h-8 flex items-center overflow-hidden group/input hover:border-white/10">
                                                <MiniNumberInput
                                                    value={val}
                                                    onChange={(next) => handleValueChange(i, next)}
                                                    step={1}
                                                    displayFactor={1}
                                                />
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => removeSegment(i)}
                                            onMouseDown={(e) => e.stopPropagation()}
                                            className="p-1.5 opacity-0 group-hover/item:opacity-100 hover:bg-red-500/10 text-white/10 hover:text-red-400 rounded transition-all"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <button
                            onClick={addSegment}
                            onMouseDown={(e) => e.stopPropagation()}
                            className="w-full flex items-center justify-center gap-2 py-2 border border-dashed border-white/10 rounded-lg text-[10px] text-muted hover:text-secondary hover:border-white/20 hover:bg-hover transition-all"
                        >
                            <Plus size={12} />
                            <span>Add Pair</span>
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
