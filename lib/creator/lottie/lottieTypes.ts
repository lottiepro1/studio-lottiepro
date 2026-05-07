export interface LottieAnimation {
    v: string; // Version
    fr: number; // Frame Rate
    ip: number; // In Point
    op: number; // Out Point
    w: number; // Width
    h: number; // Height
    nm?: string; // Name
    layers: LottieLayer[];
    assets?: any[];
    chars?: any[];
    markers?: LottieMarker[];
}

export interface LottieMarker {
    cm: string; // comment / name
    tm: number; // time (in frames)
    dr: number; // duration (in frames)
}

export type LottieLayerType = 0 | 1 | 2 | 3 | 4 | 5; // 0: Precomp, 1: Solid, 2: Image, 3: Null, 4: Shape, 5: Text

export interface LottieLayer {
    ty: LottieLayerType;
    nm?: string;
    ln?: string; // Layer name identifier (used by dotLottie state machine interactions)
    ind?: number; // Index
    parent?: number;
    ks: LottieTransform; // Transform
    ip?: number; // In point
    op?: number; // Out point
    st?: number; // Start time
    bm?: number; // Blend mode
    ddd?: number; // 3D
    shapes?: LottieShape[];
    t?: any; // Text data
    ef?: any[]; // Effects
    sw?: number; // Solid width
    sh?: number; // Solid height
    sc?: string; // Solid color
    tt?: number; // Track matte type
    td?: number; // Track matte definition
    tp?: number; // Track matte parent
    refId?: string; // Asset reference ID (for precomps/images)
    w?: number; // Layer width (for precomps)
    h?: number; // Layer height (for precomps)
    hd?: number; // Hidden
    masksProperties?: LottieMask[];
}

export interface LottieMask {
    inv: boolean;
    nm: string;
    pt: LottieProperty<any>; // Path data
    o: LottieProperty<number>; // Opacity
    mode: 'a' | 's' | 'i' | 'l' | 'd' | 'n'; // add, subtract, intersect, lighten, darken, none
}

export interface LottieTransform {
    a?: LottieProperty<number[]>; // Anchor point [x, y, z]
    p?: LottieProperty<number[]>; // Position [x, y, z]
    s?: LottieProperty<number[]>; // Scale [x, y, z]
    r?: LottieProperty<number>; // Rotation
    o?: LottieProperty<number>; // Opacity
}

export interface LottieProperty<T> {
    a: 0 | 1; // Animated (0: no, 1: yes)
    k: T | LottieKeyframe<T>[];
    ix?: number; // Index
}

export interface LottieKeyframeTangent {
    x: number | number[];
    y: number | number[];
}

export interface LottieKeyframe<T> {
    t: number; // Time
    s: T; // Start value
    e?: T; // End value
    i?: LottieKeyframeTangent; // In tangent
    o?: LottieKeyframeTangent; // Out tangent
    to?: number[]; // Spatial out tangent
    ti?: number[]; // Spatial in tangent
}

export interface LottieShape {
    ty: 'gr' | 'rc' | 'el' | 'sh' | 'fl' | 'st' | 'gf' | 'gs' | 'tr' | 'sr' | 'tm' | 'mm' | 'rp' | 'rd';
    nm?: string;
    it?: LottieShape[]; // For 'gr' (group)
    a?: LottieProperty<number[]>; // Anchor (for tr)
    p?: LottieProperty<number[]>; // Position (for rect/ellipse/tr)
    s?: LottieProperty<number[]>; // Size/Scale (for rect/tr)
    r?: LottieProperty<number>; // Radius/Roundness/Rotation (for tr)
    d?: number; // Direction
    c?: LottieProperty<number[]>; // Color (for fill/stroke)
    o?: LottieProperty<number>; // Opacity
    w?: LottieProperty<number>; // Stroke width
    ks?: LottieProperty<any>; // Path data (for 'sh')
}
