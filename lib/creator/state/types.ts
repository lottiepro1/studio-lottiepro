import { ToolSlice } from './toolSlice';
import { SceneSlice, SceneNode } from './sceneSlice';
import { SelectionSlice } from './selectionSlice';
import { AnimationSlice } from './animationSlice';
import { HistorySlice } from './historySlice';
import { ClipboardSlice } from './clipboardSlice';
import { StateMachineSlice } from './stateMachineSlice';

export type CreatorStore = ToolSlice & SceneSlice & SelectionSlice & AnimationSlice & HistorySlice & ClipboardSlice & StateMachineSlice & {
    addNodeToArtboard: (node: SceneNode) => void;
    addLayerWithShape: (layer: SceneNode, shape: SceneNode) => void;
    groupNodes: (nodeIds: string[]) => void;
    ungroupNodes: (groupId: string) => void;
    fitGroupToContent: (groupId: string) => void;
    applyBooleanOperation: (nodeIds: string[], mode: 'union' | 'subtract' | 'intersect' | 'exclude') => void;
    setMatte: (targetId: string, matteId: string | null) => void;
    // Alignment
    alignSelectedNodes: (type: 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom') => void;
    distributeSelectedNodes: (type: 'horizontal' | 'vertical') => void;
};
