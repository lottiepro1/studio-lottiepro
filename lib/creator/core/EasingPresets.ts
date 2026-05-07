// Easing preset definitions for animation curves
// These follow the cubic-bezier format: [p1x, p1y, p2x, p2y]

export interface EasingPreset {
    label: string;
    bezier: [number, number, number, number];
    icon?: string;
}

export const EASING_PRESETS: Record<string, EasingPreset> = {
    'linear': {
        label: 'Linear',
        bezier: [0, 0, 1, 1], // Standard linear
        icon: 'line',
    },
    'smooth': {
        label: 'Smooth',
        bezier: [0.4, 0, 0.2, 1], // Modern "Smooth" (Quartic-like)
        icon: 'feather',
    },
    'easy-ease': {
        label: 'Easy Ease',
        bezier: [0.33, 0, 0.67, 1], // Standard AE 33% influence
        icon: 'wave',
    },
    'ease-in': {
        label: 'Ease In',
        bezier: [0.42, 0, 1, 1],
        icon: 'arrow-right',
    },
    'ease-out': {
        label: 'Ease Out',
        bezier: [0, 0, 0.58, 1],
        icon: 'arrow-left',
    },
    'ease-in-out': {
        label: 'Ease In Out',
        bezier: [0.42, 0, 0.58, 1],
        icon: 'arrows-horizontal',
    },
    'anticipation': {
        label: 'Anticipation',
        bezier: [0.36, 0, 0.66, -0.56], // "Back In"
        icon: 'rewind',
    },
    'overshoot': {
        label: 'Overshoot',
        bezier: [0.34, 1.56, 0.64, 1], // "Back Out"
        icon: 'zap',
    },
    'bounce': {
        label: 'Bounce',
        bezier: [0.68, -0.6, 0.32, 1.6],
        icon: 'activity',
    },
    'expo': {
        label: 'Expo',
        bezier: [0.7, 0, 0.84, 0],
        icon: 'trending-up',
    }
};

// Get preset by name, with fallback to linear
export function getEasingPreset(name: string): EasingPreset {
    return EASING_PRESETS[name] || EASING_PRESETS['linear'];
}

// Check if bezier values match a preset
export function matchPreset(bezier: [number, number, number, number]): string | null {
    for (const [key, preset] of Object.entries(EASING_PRESETS)) {
        if (
            Math.abs(preset.bezier[0] - bezier[0]) < 0.01 &&
            Math.abs(preset.bezier[1] - bezier[1]) < 0.01 &&
            Math.abs(preset.bezier[2] - bezier[2]) < 0.01 &&
            Math.abs(preset.bezier[3] - bezier[3]) < 0.01
        ) {
            return key;
        }
    }
    return null;
}

// Format bezier for display
export function formatBezier(bezier: [number, number, number, number]): string {
    return bezier.map(v => v.toFixed(2)).join(', ');
}

// Parse bezier from string
export function parseBezier(str: string): [number, number, number, number] | null {
    const parts = str.split(',').map(s => parseFloat(s.trim()));
    if (parts.length === 4 && parts.every(n => !isNaN(n))) {
        return parts as [number, number, number, number];
    }
    return null;
}
