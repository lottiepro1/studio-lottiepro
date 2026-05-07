import { BaseTool, ToolEvent } from './BaseTool';
import { createPathNode } from '../core/SceneNode';
import { SceneNode } from '../state/sceneSlice';
import { getPathLocalBounds } from '../core/Matrix';

export interface VectorPoint {
    x: number;
    y: number;
    inX: number;
    inY: number;
    outX: number;
    outY: number;
}

export class PenTool extends BaseTool {
    private isEditing = false;
    private isDraggingHandle = false;
    private currentNode: SceneNode | null = null;
    private activePointIndex: number = -1;

    private onNodeCreate?: (node: SceneNode) => void;
    private onNodeUpdate?: (node: SceneNode) => void;
    private onNodeFinalize?: (node: SceneNode) => void;

    constructor(callbacks: {
        onNodeCreate?: (node: SceneNode) => void;
        onNodeUpdate?: (node: SceneNode) => void;
        onNodeFinalize?: (node: SceneNode) => void;
    }) {
        super();
        this.onNodeCreate = callbacks.onNodeCreate;
        this.onNodeUpdate = callbacks.onNodeUpdate;
        this.onNodeFinalize = callbacks.onNodeFinalize;
    }

    onMouseDown(event: ToolEvent): void {
        if (!this.currentNode) {
            // Start a new path
            this.currentNode = createPathNode(0, 0); // Origin at top-left of artboard
            this.isEditing = true;

            const newPoint: VectorPoint = {
                x: event.x,
                y: event.y,
                inX: 0,
                inY: 0,
                outX: 0,
                outY: 0
            };

            this.currentNode.props.points = [newPoint];
            this.currentNode.props.nextMousePos = { x: event.x, y: event.y };
            this.activePointIndex = 0;
            this.isDraggingHandle = true;

            if (this.onNodeCreate) this.onNodeCreate(this.currentNode);
        } else {
            const points = this.currentNode.props.points as VectorPoint[];

            // Check for closing path
            const firstPoint = points[0];
            const dist = Math.sqrt((event.x - firstPoint.x) ** 2 + (event.y - firstPoint.y) ** 2);

            if (dist < 6 && points.length > 2) {
                this.currentNode.props.closed = true;
                this.currentNode.style.fillVisible = true;
                this.finalize();
                return;
            }

            if (event.shiftKey) {
                const prevPoint = points[points.length - 1];
                const dx = event.x - prevPoint.x;
                const dy = event.y - prevPoint.y;
                const angle = Math.atan2(dy, dx);
                const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
                const dist = Math.sqrt(dx * dx + dy * dy);

                const newPoint: VectorPoint = {
                    x: prevPoint.x + Math.cos(snappedAngle) * dist,
                    y: prevPoint.y + Math.sin(snappedAngle) * dist,
                    inX: 0,
                    inY: 0,
                    outX: 0,
                    outY: 0
                };
                points.push(newPoint);
            } else {
                const newPoint: VectorPoint = {
                    x: event.x,
                    y: event.y,
                    inX: 0,
                    inY: 0,
                    outX: 0,
                    outY: 0
                };
                points.push(newPoint);
            }
            this.currentNode.props.nextMousePos = { x: event.x, y: event.y };
            this.activePointIndex = points.length - 1;
            this.isDraggingHandle = true;

            if (this.onNodeUpdate) this.onNodeUpdate(this.currentNode);
        }
    }

    onMouseMove(event: ToolEvent): void {
        if (!this.currentNode) return;

        if (this.isDraggingHandle) {
            const points = this.currentNode.props.points as VectorPoint[];
            const activePoint = points[this.activePointIndex];

            if (activePoint) {
                // Create symmetrical handles
                let dx = event.x - activePoint.x;
                let dy = event.y - activePoint.y;

                if (event.shiftKey) {
                    const angle = Math.atan2(dy, dx);
                    const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    dx = Math.cos(snappedAngle) * dist;
                    dy = Math.sin(snappedAngle) * dist;
                }

                activePoint.outX = dx;
                activePoint.outY = dy;
                activePoint.inX = -dx;
                activePoint.inY = -dy;
            }
        }

        // Always update mouse pos for rubber-banding
        if (event.shiftKey) {
            const points = this.currentNode.props.points as VectorPoint[];
            const lastPoint = points[points.length - 1];
            const dx = event.x - lastPoint.x;
            const dy = event.y - lastPoint.y;
            const angle = Math.atan2(dy, dx);
            const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
            const dist = Math.sqrt(dx * dx + dy * dy);
            this.currentNode.props.nextMousePos = {
                x: lastPoint.x + Math.cos(snappedAngle) * dist,
                y: lastPoint.y + Math.sin(snappedAngle) * dist
            };
        } else {
            this.currentNode.props.nextMousePos = { x: event.x, y: event.y };
        }
        if (this.onNodeUpdate) this.onNodeUpdate(this.currentNode);
    }

    onMouseUp(event: ToolEvent): void {
        this.isDraggingHandle = false;
    }

    onKeyDown(key: string, event?: KeyboardEvent): boolean {
        const k = key.toUpperCase();
        const isCtrl = event?.ctrlKey || event?.metaKey;

        if (isCtrl && k === 'Z') {
            return this.undo();
        }

        if (k === 'ENTER' || k === 'ESCAPE') {
            this.finalize();
            return true;
        } else if (k === 'BACKSPACE' || k === 'DELETE') {
            return this.undo();
        }
        return false;
    }

    public undo(): boolean {
        if (this.currentNode) {
            const points = this.currentNode.props.points as VectorPoint[];
            if (points.length > 1) {
                points.pop();
                this.activePointIndex = points.length - 1;
                // Move nextMousePos to where the new last point is to avoid jumping rubberband
                this.currentNode.props.nextMousePos = { x: points[this.activePointIndex].x, y: points[this.activePointIndex].y };
                if (this.onNodeUpdate) this.onNodeUpdate(this.currentNode);
                return true;
            } else {
                this.reset();
                if (this.onNodeFinalize) this.onNodeFinalize({ id: 'dummy' } as any); // Trigger reset in canvas
                return true;
            }
        }
        return false;
    }

    onKeyUp(key: string): void {
        // Not used
    }

    public finalize(): void {
        if (!this.currentNode) return;
        const points = this.currentNode.props.points as VectorPoint[];

        if (points && points.length > 1) {
            // Ensure fill is visible when "completed"
            this.currentNode.style.fillVisible = true;

            // 1. Calculate path bounds
            const bounds = getPathLocalBounds(points);
            const centerX = bounds.x + bounds.width / 2;
            const centerY = bounds.y + bounds.height / 2;

            // 2. Normalize points (moving origin to center)
            points.forEach(p => {
                p.x -= centerX;
                p.y -= centerY;
                // No need to adjust handles as they are relative to x,y of the point
            });

            // 3. Set transform to the center
            this.currentNode.transform.x = centerX;
            this.currentNode.transform.y = centerY;
            this.currentNode.transform.anchorX = 0;
            this.currentNode.transform.anchorY = 0;
            this.currentNode.transform.anchorAlignX = 0.5;
            this.currentNode.transform.anchorAlignY = 0.5;

            // Cleanup preview props
            delete this.currentNode.props.nextMousePos;

            if (this.onNodeFinalize) this.onNodeFinalize(this.currentNode);
        } else {
            // If path is invalid/empty, just clear it
            if (this.onNodeFinalize) this.onNodeFinalize(null as any);
        }
        this.reset();
    }

    reset(): void {
        this.currentNode = null;
        this.isEditing = false;
        this.isDraggingHandle = false;
        this.activePointIndex = -1;
    }
}
