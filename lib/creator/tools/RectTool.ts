import { BaseTool, ToolEvent } from './BaseTool';
import { createRectNode } from '../core/SceneNode';
import { SceneNode } from '../state/sceneSlice';

export class RectTool extends BaseTool {
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

    // Create initial rectangle (1x1)
    this.currentNode = createRectNode(event.x, event.y, 1, 1);

    if (this.onNodeCreate && this.currentNode) {
      this.onNodeCreate(this.currentNode);
    }
  }

  onMouseMove(event: ToolEvent): void {
    if (!this.isDrawing || !this.currentNode) return;

    let width = event.x - this.startX;
    let height = event.y - this.startY;

    // Shift constraint: make it a square
    if (event.shiftKey) {
      const size = Math.max(Math.abs(width), Math.abs(height));
      width = width < 0 ? -size : size;
      height = height < 0 ? -size : size;
    }

    const w = Math.abs(width);
    const h = Math.abs(height);
    const x = width < 0 ? this.startX + width : this.startX;
    const y = height < 0 ? this.startY + height : this.startY;

    this.currentNode.transform.x = x + w / 2;
    this.currentNode.transform.y = y + h / 2;
    this.currentNode.props.width = w;
    this.currentNode.props.height = h;
    this.currentNode.transform.anchorX = w / 2;
    this.currentNode.transform.anchorY = h / 2;

    if (this.onNodeUpdate) {
      this.onNodeUpdate(this.currentNode);
    }
  }

  onMouseUp(event: ToolEvent): void {
    if (!this.isDrawing || !this.currentNode) return;

    this.isDrawing = false;

    // Only finalize if rectangle has meaningful size
    if (this.currentNode.props.width > 0.5 && this.currentNode.props.height > 0.5) {
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