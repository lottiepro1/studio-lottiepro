'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import * as Slider from '@radix-ui/react-slider';
import { Pipette } from 'lucide-react';

import MiniNumberInput from './MiniNumberInput';

interface ColorPickerProps {
    color: string; // hex
    opacity: number; // 0-1
    onChange: (color: string, opacity: number) => void;
}

// Simple color conversion helpers
const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 255, g: 255, b: 255 };
};

const rgbToHsl = (r: number, g: number, b: number) => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s, l = (max + min) / 2;
    if (max === min) {
        h = s = 0;
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
};

const hslToRgb = (h: number, s: number, l: number) => {
    h /= 360; s /= 100; l /= 100;
    let r, g, b;
    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p: number, q: number, t: number) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
};

const rgbToHex = (r: number, g: number, b: number) => {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
};

export default function ColorPicker({ color, opacity, onChange }: ColorPickerProps) {
    const satAreaRef = useRef<HTMLDivElement>(null);
    const isDragging = useRef(false);

    // Convert current hex to HSL for manipulation
    const initialHsl = useMemo(() => {
        const { r, g, b } = hexToRgb(color);
        return rgbToHsl(r, g, b);
    }, [color]);

    const [h, setH] = useState(initialHsl.h);
    const [s, setS] = useState(initialHsl.s);
    const [v, setV] = useState(100);

    // Sync state with incoming color prop but only if NOT dragging
    useEffect(() => {
        if (isDragging.current) return;
        const { h: nh, s: ns, l: nl } = initialHsl;
        setH(nh);
        // Rough conversion from HSL to HSV
        const v_val = nl + ns * Math.min(nl, 100 - nl) / 100;
        const s_val = v_val === 0 ? 0 : 2 * (1 - nl / v_val);
        setS(s_val * 100);
        setV(v_val);
    }, [color, initialHsl]);

    const handleSatMouseDown = (e: React.MouseEvent) => {
        isDragging.current = true;
        const update = (moveE: MouseEvent | React.MouseEvent) => {
            if (!satAreaRef.current) return;
            const rect = satAreaRef.current.getBoundingClientRect();
            const nextS = Math.max(0, Math.min(100, ((moveE.clientX - rect.left) / rect.width) * 100));
            const nextV = Math.max(0, Math.min(100, (1 - (moveE.clientY - rect.top) / rect.height) * 100));

            setS(nextS);
            setV(nextV);

            const v_norm = nextV / 100;
            const s_norm = nextS / 100;
            const l_norm = v_norm * (1 - s_norm / 2);
            const s_hsl = (l_norm === 0 || l_norm === 1) ? 0 : (v_norm - l_norm) / Math.min(l_norm, 1 - l_norm);

            const { r, g, b } = hslToRgb(h, s_hsl * 100, l_norm * 100);
            onChange(rgbToHex(r, g, b), opacity);
        };

        update(e);

        const onMouseMove = (moveE: MouseEvent) => update(moveE);
        const onMouseUp = () => {
            isDragging.current = false;
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    };

    const handleEyedropper = async () => {
        if (!('EyeDropper' in window)) {
            alert('Eyedropper API not supported in this browser');
            return;
        }
        try {
            const EyeDropperClass = (window as any).EyeDropper;
            const picker = new EyeDropperClass();
            const result = await picker.open();
            onChange(result.sRGBHex, opacity);
        } catch (e) {
            console.log('Eyedropper cancelled or failed', e);
        }
    };

    return (
        <div className="space-y-4 w-full" onMouseDown={(e) => e.stopPropagation()}>
            {/* Saturation/Value Area */}
            <div
                ref={satAreaRef}
                onMouseDown={handleSatMouseDown}
                className="relative w-full aspect-square rounded-lg cursor-crosshair overflow-hidden shadow-inner border border-white/5"
                style={{
                    backgroundColor: `hsl(${h}, 100%, 50%)`,
                    backgroundImage: `
            linear-gradient(to right, #fff, transparent),
            linear-gradient(to top, #000, transparent)
          `
                }}
            >
                <div
                    className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full border-2 border-white shadow-lg pointer-events-none"
                    style={{
                        left: `${s}%`,
                        top: `${100 - v}%`,
                        backgroundColor: color
                    }}
                />
            </div>

            <div className="space-y-3">
                {/* Hue Slider and Eyedropper */}
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleEyedropper}
                        className="w-8 h-8 flex items-center justify-center bg-white/[0.03] border border-white/5 rounded-md hover:bg-white/10 hover:border-white/20 transition-all text-white/40 hover:text-white/80"
                    >
                        <Pipette size={14} />
                    </button>
                    <Slider.Root
                        className="relative flex items-center select-none touch-none w-full h-5"
                        value={[h]}
                        max={360}
                        step={1}
                        onValueChange={([val]) => {
                            setH(val);
                            const v_norm = v / 100;
                            const s_norm = s / 100;
                            const l_norm = v_norm * (1 - s_norm / 2);
                            const s_hsl = (l_norm === 0 || l_norm === 1) ? 0 : (v_norm - l_norm) / Math.min(l_norm, 1 - l_norm);
                            const { r, g, b } = hslToRgb(val, s_hsl * 100, l_norm * 100);
                            onChange(rgbToHex(r, g, b), opacity);
                        }}
                    >
                        <Slider.Track className="bg-white/5 relative grow rounded-full h-[6px]" style={{
                            backgroundImage: 'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)'
                        }}>
                            <Slider.Range className="absolute bg-transparent h-full" />
                        </Slider.Track>
                        <Slider.Thumb className="block w-4 h-4 bg-white border-2 border-white/20 shadow-lg rounded-full hover:scale-110 focus:outline-none transition-transform" aria-label="Hue" />
                    </Slider.Root>
                </div>

                {/* Opacity Slider */}
                <div className="flex items-center gap-3 pl-11">
                    <Slider.Root
                        className="relative flex items-center select-none touch-none w-full h-5"
                        value={[opacity * 100]}
                        max={100}
                        step={1}
                        onValueChange={([val]) => onChange(color, val / 100)}
                    >
                        <Slider.Track className="bg-white/5 relative grow rounded-full h-[6px] overflow-hidden" style={{
                            background: `linear-gradient(45deg, #222 25%, transparent 25%, transparent 75%, #222 75%, #222), linear-gradient(45deg, #222 25%, transparent 25%, transparent 75%, #222 75%, #222)`,
                            backgroundSize: '8px 8px',
                            backgroundPosition: '0 0, 4px 4px'
                        }}>
                            <div className="absolute inset-0" style={{
                                background: `linear-gradient(to right, transparent, ${color})`
                            }} />
                            <Slider.Range className="absolute bg-transparent h-full" />
                        </Slider.Track>
                        <Slider.Thumb className="block w-4 h-4 bg-white border-2 border-white/20 shadow-lg rounded-full hover:scale-110 focus:outline-none transition-transform" aria-label="Opacity" />
                    </Slider.Root>
                </div>
            </div>

            {/* Hex & Opacity Inputs */}
            <div className="flex gap-3 pt-1">
                <div className="flex-1 space-y-1.5 font-bold">
                    <label className="text-[9px] text-muted uppercase tracking-wider pl-1">Hex Code</label>
                    <input
                        type="text"
                        value={color?.toUpperCase().replace('#', '') || ''}
                        onChange={(e) => {
                            let val = e.target.value;
                            if (!val.startsWith('#')) val = '#' + val;
                            if (/^#[0-9A-F]{6}$/i.test(val)) onChange(val, opacity);
                        }}
                        className="w-full h-8 bg-surface border border-white/[0.06] rounded px-2 text-[11px] font-mono text-secondary outline-none focus:border-accent/50"
                    />
                </div>
                <div className="w-20 space-y-1.5">
                    <label className="text-[9px] text-muted uppercase tracking-wider block pl-1">Alpha</label>
                    <div className="h-8 bg-surface border border-white/[0.06] rounded overflow-hidden flex items-center group/input hover:border-white/10">
                        <MiniNumberInput
                            value={opacity}
                            onChange={(val) => onChange(color, val)}
                            step={0.01}
                            displayFactor={100}
                            prefix="%"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
