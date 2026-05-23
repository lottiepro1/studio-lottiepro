import { SceneNode, NodeType, Transform, Style, Gradient, Effect } from '../state/sceneSlice';

export function generateId(): string {
    return Math.random().toString(36).substr(2, 9);
}

export function createDefaultTransform(): Transform {
    return {
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        anchorX: 0,
        anchorY: 0,
        scaleLink: true
    };
}

export function createDefaultGradient(): Gradient {
    return {
        type: 'linear',
        start: { x: 0, y: 0 },
        end: { x: 100, y: 100 },
        stops: [
            { offset: 0, color: '#C5C5C5', opacity: 1 },
            { offset: 1, color: '#A0A0A0', opacity: 1 }
        ]
    };
}

// Shape-aware gradient: start = shape top-left (0,0), end = shape top-right (width,0).
// Covers the full width horizontally so the gradient is immediately visible on any shape.
export function createShapeGradient(width: number, height: number): Gradient {
    return {
        type: 'linear',
        start: { x: 0, y: 0 },
        end: { x: width, y: height },
        stops: [
            { offset: 0, color: '#C5C5C5', opacity: 1 },
            { offset: 1, color: '#A0A0A0', opacity: 1 }
        ]
    };
}

export function createDefaultStyle(): Style {
    return {
        fill: '#C5C5C5',
        fillType: 'solid',
        fillGradient: createDefaultGradient(),
        strokeType: 'solid',
        strokeGradient: createDefaultGradient(),
        strokeWidth: 0,
        opacity: 1,
        blendMode: 'normal',
        strokeOpacity: 1,
        strokeAlign: 'outside',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        trimStart: 0,
        trimEnd: 1,
        trimOffset: 0,
        effects: []
    };
}

export function createNode(type: NodeType, name: string, options: Partial<SceneNode> = {}): SceneNode {
    return {
        id: options.id || generateId(),
        name,
        type,
        parentId: options.parentId || null,
        children: options.children || [],
        transform: options.transform || createDefaultTransform(),
        style: options.style || createDefaultStyle(),
        visible: options.visible !== undefined ? options.visible : true,
        locked: options.locked !== undefined ? options.locked : false,
        props: options.props || {},
        animations: options.animations || {},
        inPoint: options.inPoint !== undefined ? options.inPoint : 0,
        outPoint: options.outPoint !== undefined ? options.outPoint : 300,
        startTime: options.startTime !== undefined ? options.startTime : 0
    };
}

export function createArtboardNode(width: number = 500, height: number = 500, transparent: boolean = true): SceneNode {
    const node = createNode('artboard', 'Think Motion', { outPoint: 300 });
    node.transform.anchorX = 0;
    node.transform.anchorY = 0;
    node.props = {
        width,
        height,
        backgroundColor: '#ffffff',
        transparent: transparent,
        showGrid: false,
        showGuides: false,
        frameRate: 60,
        duration: 300
    };
    node.transform.anchorAlignX = 0;
    node.transform.anchorAlignY = 0;
    return node;
}

export function createRectNode(x: number, y: number, w: number, h: number, parentId: string | null = null): SceneNode {
    const node = createNode('rect', 'Rectangle', { parentId });
    node.transform.x = x;
    node.transform.y = y;
    node.transform.anchorX = w / 2;
    node.transform.anchorY = h / 2;
    node.transform.anchorAlignX = 0.5;
    node.transform.anchorAlignY = 0.5;
    node.props = {
        width: w,
        height: h,
        roundness: 0
    };
    return node;
}

export function createEllipseNode(x: number, y: number, rw: number, rh: number, parentId: string | null = null): SceneNode {
    const node = createNode('ellipse', 'Ellipse', { parentId });
    node.transform.x = x;
    node.transform.y = y;
    node.transform.anchorX = rw;
    node.transform.anchorY = rh;
    node.transform.anchorAlignX = 0.5;
    node.transform.anchorAlignY = 0.5;
    node.props = {
        radiusX: rw,
        radiusY: rh
    };
    return node;
}

export function createPathNode(x: number, y: number, parentId: string | null = null): SceneNode {
    const node = createNode('path', 'Path', { parentId });
    node.transform.x = x;
    node.transform.y = y;
    node.transform.anchorX = 0;
    node.transform.anchorY = 0;
    node.style.stroke = '#000000';
    node.style.strokeWidth = 5;
    node.style.fill = '#D7D7D7';
    node.style.fillVisible = false;
    node.props = {
        points: [],
        closed: false,
        roundness: 0
    };
    return node;
}

export function createGroupNode(name: string = 'Group', parentId: string | null = null): SceneNode {
    return createNode('group', name, { parentId, style: createDefaultStyle() });
}

export function createTextNode(x: number, y: number, text: string = 'Text', parentId: string | null = null): SceneNode {
    const node = createNode('text', 'Text', { parentId });
    node.transform.x = x;
    node.transform.y = y;
    node.transform.anchorX = 0;
    node.transform.anchorY = 0;
    // No anchorAlignX/Y for point text — the rendering origin (x=0 in local space)
    // IS the natural anchor: left edge for left-aligned, center for center-aligned,
    // right edge for right-aligned. A dynamic align factor would drift as text grows.
    node.style.fill = '#000000';
    node.props = {
        text: 'Text',
        fontSize: 24,
        fontFamily: 'Open Sans',
        fontWeight: '400',
        letterSpacing: 0,
        lineHeight: 1.2,
        textAlign: 'left',
        verticalAlign: 'top'
    };
    return node;
}

export function createImageNode(x: number, y: number, width: number, height: number, src: string, name: string = 'Image', parentId: string | null = null): SceneNode {
    const node = createNode('image', name, { parentId });
    node.transform.x = x;
    node.transform.y = y;
    // Images anchor at center
    node.transform.anchorX = width / 2;
    node.transform.anchorY = height / 2;
    node.transform.anchorAlignX = 0.5;
    node.transform.anchorAlignY = 0.5;
    node.props = {
        width,
        height,
        src // Base64 string
    };
    return node;
}
export function createPolystarNode(x: number, y: number, r: number, parentId: string | null = null): SceneNode {
    const node = createNode('polystar', 'Polystar', { parentId });
    node.transform.x = x;
    node.transform.y = y;
    // Stars are centered by default in Lottie
    node.transform.anchorX = 0;
    node.transform.anchorY = 0;
    node.transform.anchorAlignX = 0.5;
    node.transform.anchorAlignY = 0.5;
    node.props = {
        starType: 'star',
        points: 5,
        innerRadius: r / 2,
        outerRadius: r,
        innerRoundness: 0,
        outerRoundness: 0
    };
    return node;
}

export function createRepeaterEffect(): Effect {
    return {
        id: generateId(),
        type: 'repeater',
        name: 'Repeater',
        visible: true,
        copies: 3,
        offset: 0,
        composite: 'above',
        repeaterTransform: {
            x: 100,
            y: 0,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            startOpacity: 1,
            endOpacity: 1
        }
    };
}

export function createOffsetPathEffect(): Effect {
    return {
        id: generateId(),
        type: 'offsetPath',
        name: 'Offset Path',
        visible: true,
        amount: 10,
        lineJoin: 'round',
        miterLimit: 4
    };
}
