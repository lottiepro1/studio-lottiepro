import { BaseTool, ToolEvent } from './BaseTool';
import { createTextNode } from '../core/SceneNode';
import { SceneNode } from '../state/sceneSlice';

export class TextTool extends BaseTool {
    private onNodeCreate?: (node: SceneNode) => void;
    private onNodeFinalize?: (node: SceneNode) => void;

    constructor(callbacks: {
        onNodeCreate?: (node: SceneNode) => void;
        onNodeFinalize?: (node: SceneNode) => void;
    }) {
        super();
        this.onNodeCreate = callbacks.onNodeCreate;
        this.onNodeFinalize = callbacks.onNodeFinalize;
    }

    onMouseDown(event: ToolEvent): void {
        const node = createTextNode(event.x, event.y);

        if (this.onNodeCreate) {
            this.onNodeCreate(node);
        }

        if (this.onNodeFinalize) {
            this.onNodeFinalize(node);
        }
    }

    onMouseMove(event: ToolEvent): void { }
    onMouseUp(event: ToolEvent): void { }
    onKeyDown(key: string, event?: KeyboardEvent): boolean { return false; }
    onKeyUp(key: string): void { }
}
