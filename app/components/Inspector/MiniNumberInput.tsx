'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useCreatorStore } from '@/lib/creator/state/store';

interface MiniNumberInputProps {
    path?: string;
    value: number;
    isMixed?: boolean;
    step: number;
    min?: number;
    max?: number;
    prefix?: string;
    displayFactor: number;
    onChange: (value: number, recordHistory?: boolean) => void;
    className?: string;
}

export default function MiniNumberInput({
    path,
    value,
    isMixed,
    step,
    min,
    max,
    prefix,
    displayFactor,
    onChange,
    className = ""
}: MiniNumberInputProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [localVal, setLocalVal] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    const displayVal = isMixed ? "Mixed" :
        (value === undefined || value === null || isNaN(value)) ? "0" :
            Math.round((value as number) * displayFactor * 100) / 100;

    const startEditing = () => {
        setLocalVal(isMixed ? "0" : displayVal.toString());
        setIsEditing(true);
    };

    const commitChange = () => {
        setIsEditing(false);
        const next = parseFloat(localVal);
        if (!isNaN(next)) {
            const finalVal = next / displayFactor;
            const clamped = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, finalVal));
            onChange(clamped, true);
        }
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0 || isMixed) return;

        const startX = e.clientX;
        const startValue = value as number;
        let moved = false;
        let hasRecordedHistory = false;

        const onMouseMove = (moveE: MouseEvent) => {
            const dx = moveE.clientX - startX;
            if (Math.abs(dx) > 3) moved = true;

            if (moved) {
                if (!hasRecordedHistory) {
                    useCreatorStore.getState().pushToHistory('Change Property');
                    hasRecordedHistory = true;
                }

                let sensitivity = step / displayFactor;
                if (moveE.shiftKey) sensitivity *= 10;
                if (moveE.altKey) sensitivity /= 10;

                const newValue = startValue + dx * sensitivity;
                const clamped = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, newValue));
                onChange(clamped);
            }
        };

        const onMouseUp = () => {
            if (!moved) startEditing();
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = 'default';
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        document.body.style.cursor = 'ew-resize';
    };

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    return (
        <div
            onMouseDown={handleMouseDown}
            className={`flex-1 h-full min-w-0 relative flex items-center cursor-ew-resize group/input ${className}`}
        >
            {prefix && (
                <span className="absolute left-2 text-[9px] font-semibold text-white/10 uppercase select-none group-hover/input:text-accent/40 transition-colors">
                    {prefix}
                </span>
            )}

            {isEditing ? (
                <input
                    ref={inputRef}
                    type="text"
                    className="w-full h-full text-primary text-[11px] font-mono font-bold text-center outline-none rounded"
                    style={{ background: 'var(--accent-soft)' }}
                    value={localVal}
                    onChange={(e) => setLocalVal(e.target.value)}
                    onBlur={commitChange}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') commitChange();
                        if (e.key === 'Escape') setIsEditing(false);
                    }}
                />
            ) : (
                <div className="flex-1 text-center">
                    <span className={`text-[11px] font-mono ${isMixed ? 'text-orange-400/80 italic' : 'text-secondary group-hover/pod:text-primary'} transition-colors ${prefix ? 'pl-3' : ''}`}>
                        {displayVal}{prefix === '%' ? '%' : prefix === '°' ? '°' : ''}
                    </span>
                </div>
            )}
        </div>
    );
}
