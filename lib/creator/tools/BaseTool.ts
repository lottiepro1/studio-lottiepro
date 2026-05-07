export interface ToolEvent {
  x: number;
  y: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

export abstract class BaseTool {
  abstract onMouseDown(event: ToolEvent): void;
  abstract onMouseMove(event: ToolEvent): void;
  abstract onMouseUp(event: ToolEvent): void;
  abstract onKeyDown(key: string, event?: KeyboardEvent): void | boolean;
  abstract onKeyUp(key: string): void;
}