'use client';

import React, { useState, useRef, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

interface StrokeDetailsPopoverProps {
    linecap: string;
    linejoin: string;
    onChange: (path: string, value: string) => void;
    trigger: React.ReactNode;
}

export default function StrokeDetailsPopover({ linecap = 'round', linejoin = 'round', onChange, trigger }: StrokeDetailsPopoverProps) {
    const [open, setOpen] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);

    // Resilience against abrupt closures
    useEffect(() => {
        if (!open) return;

        const handleGlobalPointer = (e: PointerEvent) => {
            if (!contentRef.current) return;
            const target = e.target as HTMLElement;
            if (contentRef.current.contains(target)) return;
            if (!document.body.contains(target)) return;
            const triggerEl = document.querySelector('[data-state="open"]');
            if (triggerEl?.contains(target)) return;
            setOpen(false);
        };

        window.addEventListener('pointerdown', handleGlobalPointer, true);
        return () => window.removeEventListener('pointerdown', handleGlobalPointer, true);
    }, [open]);

    const caps = [
        {
            id: 'butt', label: 'Butt', icon: (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M4 8H12" stroke="currentColor" strokeWidth="2.5" />
                    <path d="M4 5V11" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M12 5V11" stroke="currentColor" strokeWidth="1.5" />
                </svg>
            )
        },
        {
            id: 'round', label: 'Round', icon: (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M4 8H12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
            )
        },
        {
            id: 'square', label: 'Square', icon: (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M3 8H13" stroke="currentColor" strokeWidth="2.5" />
                    <path d="M3 5V11" stroke="currentColor" strokeWidth="1" />
                    <path d="M13 5V11" stroke="currentColor" strokeWidth="1" />
                </svg>
            )
        },
    ];

    const joins = [
        {
            id: 'miter', label: 'Miter', icon: (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M4 12V4H12" stroke="currentColor" strokeWidth="2.5" />
                </svg>
            )
        },
        {
            id: 'round', label: 'Round', icon: (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M4 12V7C4 5.34315 5.34315 4 7 4H12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            )
        },
        {
            id: 'bevel', label: 'Bevel', icon: (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M4 12V7L7 4H12" stroke="currentColor" strokeWidth="2.5" />
                </svg>
            )
        },
    ];

    return (
        <Dialog.Root open={open} onOpenChange={setOpen} modal={false}>
            <Dialog.Trigger asChild>
                {trigger}
            </Dialog.Trigger>
            <Dialog.Portal>
                <Dialog.Content
                    ref={contentRef}
                    onInteractOutside={(e) => e.preventDefault()}
                    className="fixed top-24 right-[336px] w-[200px] border border-white/[0.06] rounded-xl shadow-[0_20px_40px_rgba(0,0,0,0.5)] z-[1002] overflow-hidden focus:outline-none flex flex-col animate-in fade-in slide-in-from-right-4 duration-200 pointer-events-auto"
                    style={{ background: 'var(--bg-panel)' }}
                >
                    <Dialog.Title className="sr-only">Stroke Details</Dialog.Title>

                    {/* Header */}
                    <div className="flex items-center justify-between p-3 border-b border-white/[0.06]" style={{ background: 'var(--bg-surface)' }}>
                        <span className="text-xs font-medium text-secondary">Stroke Details</span>
                        <Dialog.Close asChild>
                            <button className="p-1.5 hover:bg-white/10 rounded-full text-white/20 hover:text-white/60 transition-all">
                                <X size={12} />
                            </button>
                        </Dialog.Close>
                    </div>

                    <div className="p-4 space-y-5">
                        {/* Line Cap */}
                        <div className="space-y-2">
                            <label className="text-[9px] text-muted uppercase tracking-widest block pl-0.5">Line Cap</label>
                            <div className="flex p-0.5 rounded-lg border border-white/[0.06] gap-0.5">
                                {caps.map(c => (
                                    <button
                                        key={c.id}
                                        onClick={() => onChange('style.strokeLinecap', c.id)}
                                        className={`flex-1 h-8 flex items-center justify-center rounded-md transition-all ${linecap === c.id ? 'text-primary' : 'text-white/20 hover:bg-white/5 hover:text-white/40'}`}
                                        title={c.label}
                                    >
                                        {c.icon}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Line Join */}
                        <div className="space-y-2">
                            <label className="text-[9px] text-muted uppercase tracking-widest block pl-0.5">Line Join</label>
                            <div className="flex p-0.5 rounded-lg border border-white/[0.06] gap-0.5">
                                {joins.map(j => (
                                    <button
                                        key={j.id}
                                        onClick={() => onChange('style.strokeLinejoin', j.id)}
                                        className={`flex-1 h-8 flex items-center justify-center rounded-md transition-all ${linejoin === j.id ? 'text-primary' : 'text-white/20 hover:bg-white/5 hover:text-white/40'}`}
                                        title={j.label}
                                    >
                                        {j.icon}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
