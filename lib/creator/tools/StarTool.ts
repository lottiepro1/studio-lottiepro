import { BaseTool, ToolEvent } from './BaseTool';
import { createPolystarNode } from '../core/SceneNode';
import { SceneNode } from '../state/sceneSlice';

export class StarTool extends BaseTool {
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

    // Create initial star (1 radius)
    this.currentNode = createPolystarNode(event.x, event.y, 1);

    if (this.onNodeCreate && this.currentNode) {
      this.onNodeCreate(this.currentNode);
    }
  }

  onMouseMove(event: ToolEvent): void {
    if (!this.isDrawing || !this.currentNode) return;

    const dx = event.x - this.startX;
    const dy = event.y - this.startY;
    const radius = Math.sqrt(dx * dx + dy * dy);

    this.currentNode.props.outerRadius = radius;
    this.currentNode.props.innerRadius = radius / 2;

    if (this.onNodeUpdate) {
      this.onNodeUpdate(this.currentNode);
    }
  }

  onMouseUp(event: ToolEvent): void {
    if (!this.isDrawing || !this.currentNode) return;

    this.isDrawing = false;

    // Only finalize if star has meaningful size
    if (this.currentNode.props.outerRadius > 2) {
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
  }

  reset(): void {
    this.isDrawing = false;
    this.currentNode = null;
  }
}
