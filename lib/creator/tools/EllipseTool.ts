import { BaseTool, ToolEvent } from './BaseTool';
import { createEllipseNode } from '../core/SceneNode';
import { SceneNode } from '../state/sceneSlice';

export class EllipseTool extends BaseTool {
  private isDrawing = false;
  private startX = 0;
  private startY = 0;
  private currentNode: SceneNode | null = null;

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
    this.isDrawing = true;
    this.startX = event.x;
    this.startY = event.y;

    // Create initial ellipse (1x1)
    this.currentNode = createEllipseNode(event.x, event.y, 1, 1);

    if (this.onNodeCreate && this.currentNode) {
      this.onNodeCreate(this.currentNode);
    }
  }

  onMouseMove(event: ToolEvent): void {
    if (!this.isDrawing || !this.currentNode) return;

    let width = event.x - this.startX;
    let height = event.y - this.startY;

    // Shift constraint: make it a circle
    if (event.shiftKey) {
      const size = Math.max(Math.abs(width), Math.abs(height));
      width = width < 0 ? -size : size;
      height = height < 0 ? -size : size;
    }

    // Calculate center and radii
    const radiusX = Math.abs(width) / 2;
    const radiusY = Math.abs(height) / 2;
    const centerX = this.startX + width / 2;
    const centerY = this.startY + height / 2;

    this.currentNode.transform.x = centerX;
    this.currentNode.transform.y = centerY;
    this.currentNode.props.radiusX = radiusX;
    this.currentNode.props.radiusY = radiusY;
    this.currentNode.transform.anchorX = radiusX;
    this.currentNode.transform.anchorY = radiusY;

    if (this.onNodeUpdate) {
      this.onNodeUpdate(this.currentNode);
    }
  }

  onMouseUp(event: ToolEvent): void {
    if (!this.isDrawing || !this.currentNode) return;

    this.isDrawing = false;

    // Only finalize if ellipse has meaningful size
    if (this.currentNode.props.radiusX > 0.5 && this.currentNode.props.radiusY > 0.5) {
      if (this.onNodeFinalize) {
        this.onNodeFinalize(this.currentNode);
      }
    }

    this.currentNode = null;
  }

  onKeyDown(key: string, event?: KeyboardEvent): boolean {
    if (key.toUpperCase() === 'ESCAPE' && this.isDrawing) {
      this.reset();
      if (this.onNodeFinalize) this.onNodeFinalize(null as any);
      return true;
    }
    return false;
  }

  onKeyUp(key: string): void {
    // Can add keyboard shortcuts here
  }

  reset(): void {
    this.isDrawing = false;
    this.currentNode = null;
  }
}