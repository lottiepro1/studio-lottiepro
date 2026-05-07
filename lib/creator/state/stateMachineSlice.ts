import { StateCreator } from 'zustand';

// Input Types
export type InputType = 'Boolean' | 'Number' | 'String' | 'Trigger';

export interface StateMachineInput {
    id: string;
    name: string;
    type: InputType;
    initialValue: boolean | number | string | null;
}

// Node Types
export type StateNodeType = 'global' | 'initial' | 'final' | 'playback';

export interface StateMachineNode {
    id: string;
    type: StateNodeType;
    name: string;
    position: { x: number; y: number };
    // Playback specific 
    segmentId?: string; // Reference to a FlowBlock/Segment
    loop?: boolean;
    loopCount?: number;
    enforceLoops?: boolean;
    autoplay?: boolean;
    direction?: 1 | -1;
    mode?: 'Forward' | 'Reverse' | 'PingPong';
    speed?: number;
    isInitial?: boolean;
    isFinal?: boolean;
    onCompleteActions?: StateMachineAction[];
    onLoopCompleteActions?: StateMachineAction[];
    onEntryActions?: StateMachineAction[];
    onExitActions?: StateMachineAction[];
    resetPlayback?: boolean; // If false, transitioning into this state won't reset playhead
}

// Guard Operators
export type GuardOperator = '==' | '!=' | '>' | '<' | '>=' | '<=';

export interface GuardCondition {
    id: string;
    inputId: string;
    operator: GuardOperator;
    value: boolean | number | string;
}

// Edge (Transition)
export interface StateMachineEdge {
    id: string;
    sourceId: string;
    targetId: string;
    guards: GuardCondition[];
    // Transition Settings
    hasExitTime?: boolean;
    exitTime?: number; // 0-100 percentage or frame
    exitTimeType?: 'Percentage' | 'Frame';
    transitionDuration?: number;
    playFromCurrent?: boolean; // If true, maintains normalized playhead position
}

// Interaction Types
export type InteractionEvent = 'Click' | 'PointerEnter' | 'PointerExit' | 'PointerDown' | 'PointerUp' | 'PointerMove';

export type ActionType = 'SetInput' | 'FireEvent' | 'OpenURL' | 'Toggle' | 'Increment' | 'Decrement' | 'Reset' | 'SetProgress' | 'SetFrame' | 'SetTheme' | 'FireCustomEvent';

export interface StateMachineAction {
    id: string;
    type: ActionType;
    inputId?: string;
    value?: boolean | number | string;
    url?: string;
    eventName?: string;
}

export interface StateMachineInteraction {
    id: string;
    event: InteractionEvent;
    layerId: string;
    actions: StateMachineAction[];
}

export interface StateMachineData {
    id: string;
    name: string;
    inputs: StateMachineInput[];
    nodes: StateMachineNode[];
    edges: StateMachineEdge[];
    interactions: StateMachineInteraction[];
}

export interface StateMachineSlice {
    stateMachine: StateMachineData | null;
    selectedSmNodeIds: string[];
    selectedSmEdgeIds: string[];

    // Runtime state (Testing Mode)
    smIsPlaying: boolean;
    smActiveNodeId: string | null;
    smVariables: Record<string, any>;

    toggleSmPlaying: () => void;
    setSmVariable: (name: string, value: any) => void;
    setSmActiveNode: (nodeId: string | null) => void;
    executeSmActions: (actions: StateMachineAction[]) => void;

    // Actions
    initStateMachine: () => void;

    addSmInput: (input: Omit<StateMachineInput, 'id'>) => void;
    updateSmInput: (id: string, updates: Partial<StateMachineInput>) => void;
    deleteSmInput: (id: string) => void;

    addSmNode: (node: Omit<StateMachineNode, 'id'>) => void;
    updateSmNode: (id: string, updates: Partial<StateMachineNode>) => void;
    deleteSmNode: (id: string) => void;
    toggleSmInitialNode: (id: string) => void;
    toggleSmFinalNode: (id: string) => void;

    addSmEdge: (edge: Omit<StateMachineEdge, 'id'>) => void;
    updateSmEdge: (id: string, updates: Partial<StateMachineEdge>) => void;
    deleteSmEdge: (id: string) => void;

    addSmInteraction: (interaction: Omit<StateMachineInteraction, 'id'>) => void;
    updateSmInteraction: (id: string, updates: Partial<StateMachineInteraction>) => void;
    deleteSmInteraction: (id: string) => void;

    setSmNodeSelection: (ids: string[]) => void;
    setSmEdgeSelection: (ids: string[]) => void;
}

const generateId = () => Math.random().toString(36).substr(2, 9);

export const createStateMachineSlice: StateCreator<StateMachineSlice> = (set, get) => ({
    stateMachine: null,
    selectedSmNodeIds: [],
    selectedSmEdgeIds: [],
    smIsPlaying: false,
    smActiveNodeId: null,
    smVariables: {},

    toggleSmPlaying: () => set((state: any) => {
        if (!state.stateMachine) return state;

        const isNowPlaying = !state.smIsPlaying;

        let initialVars: Record<string, any> = {};
        let initialNodeId: string | null = null;

        if (isNowPlaying) {
            // Initialize variables
            state.stateMachine.inputs.forEach((input: any) => {
                initialVars[input.id] = input.initialValue;
            });
            // Find initial node
            const initialNode = state.stateMachine.nodes.find((n: any) => n.isInitial || n.type === 'initial');
            if (initialNode) initialNodeId = initialNode.id;
        }

        return {
            smIsPlaying: isNowPlaying,
            smVariables: initialVars,
            smActiveNodeId: initialNodeId
        };
    }),

    setSmVariable: (name, value) => set((state: any) => ({
        smVariables: { ...state.smVariables, [name]: value }
    })),

    executeSmActions: (actions: StateMachineAction[]) => set((state: any) => {
        if (!state.stateMachine) return state;
        const newVars = { ...state.smVariables };

        actions.forEach(act => {
            switch (act.type) {
                case 'SetInput':
                    if (act.inputId) newVars[act.inputId] = act.value;
                    break;
                case 'FireEvent':
                    if (act.inputId) newVars[act.inputId] = true; // Triggers are true until consumed
                    break;
                case 'Toggle':
                    if (act.inputId) newVars[act.inputId] = !newVars[act.inputId];
                    break;
                case 'Increment':
                    if (act.inputId) newVars[act.inputId] = (Number(newVars[act.inputId]) || 0) + (Number(act.value) || 1);
                    break;
                case 'Decrement':
                    if (act.inputId) newVars[act.inputId] = (Number(newVars[act.inputId]) || 0) - (Number(act.value) || 1);
                    break;
                case 'Reset':
                    if (act.inputId) {
                        const originalInput = state.stateMachine.inputs.find((i: any) => i.id === act.inputId);
                        if (originalInput) newVars[act.inputId] = originalInput.initialValue;
                    }
                    break;
                case 'OpenURL':
                    if (act.url && typeof window !== 'undefined') window.open(act.url, '_blank');
                    break;
                case 'SetProgress':
                    break;
                case 'SetFrame':
                    break;
                case 'SetTheme':
                    break;
                case 'FireCustomEvent':
                    if (act.eventName && typeof window !== 'undefined') {
                        window.dispatchEvent(new CustomEvent(act.eventName));
                    }
                    break;
            }
        });

        return { smVariables: newVars };
    }),

    setSmActiveNode: (nodeId) => set({ smActiveNodeId: nodeId }),

    initStateMachine: () => set((state: any) => {
        if (state.stateMachine) return {}; // Already initialized

        return {
            stateMachine: {
                id: 'sm_default',
                name: 'State Machine 1',
                inputs: [],
                nodes: [],
                edges: [],
                interactions: []
            }
        };
    }),

    addSmInput: (input) => set((state) => {
        if (!state.stateMachine) return state;
        const newInput = { ...input, id: `input_${generateId()}` };
        return {
            stateMachine: {
                ...state.stateMachine,
                inputs: [...state.stateMachine.inputs, newInput]
            }
        };
    }),

    updateSmInput: (id, updates) => set((state) => {
        if (!state.stateMachine) return state;
        return {
            stateMachine: {
                ...state.stateMachine,
                inputs: state.stateMachine.inputs.map(i => i.id === id ? { ...i, ...updates } : i)
            }
        };
    }),

    deleteSmInput: (id) => set((state) => {
        if (!state.stateMachine) return state;
        return {
            stateMachine: {
                ...state.stateMachine,
                inputs: state.stateMachine.inputs.filter(i => i.id !== id),
                edges: state.stateMachine.edges.map(edge => ({
                    ...edge,
                    guards: edge.guards.filter(g => g.inputId !== id)
                }))
            }
        };
    }),

    addSmNode: (node) => set((state) => {
        if (!state.stateMachine) return state;
        const newNode = { ...node, id: `node_${generateId()}` };
        return {
            stateMachine: {
                ...state.stateMachine,
                nodes: [...state.stateMachine.nodes, newNode]
            }
        };
    }),

    updateSmNode: (id, updates) => set((state) => {
        if (!state.stateMachine) return state;
        return {
            stateMachine: {
                ...state.stateMachine,
                nodes: state.stateMachine.nodes.map(n => n.id === id ? { ...n, ...updates } : n)
            }
        };
    }),

    toggleSmInitialNode: (id) => set((state) => {
        if (!state.stateMachine) return state;
        const isCurrentInitial = state.stateMachine.nodes.find(n => n.id === id)?.isInitial;
        return {
            stateMachine: {
                ...state.stateMachine,
                nodes: state.stateMachine.nodes.map(n => ({
                    ...n,
                    isInitial: n.id === id ? !isCurrentInitial : false // Only one can be initial
                }))
            }
        };
    }),

    toggleSmFinalNode: (id) => set((state) => {
        if (!state.stateMachine) return state;
        const isCurrentFinal = state.stateMachine.nodes.find(n => n.id === id)?.isFinal;
        return {
            stateMachine: {
                ...state.stateMachine,
                nodes: state.stateMachine.nodes.map(n => n.id === id ? { ...n, isFinal: !isCurrentFinal } : n)
            }
        };
    }),

    deleteSmNode: (id) => set((state) => {
        if (!state.stateMachine) return state;
        if (id === 'global-state' || id === 'initial-state') return state;

        return {
            stateMachine: {
                ...state.stateMachine,
                nodes: state.stateMachine.nodes.filter(n => n.id !== id),
                edges: state.stateMachine.edges.filter(e => e.sourceId !== id && e.targetId !== id)
            },
            selectedSmNodeIds: state.selectedSmNodeIds.filter(selectedId => selectedId !== id)
        };
    }),

    addSmEdge: (edge) => set((state) => {
        if (!state.stateMachine) return state;
        const newEdge = { ...edge, id: `edge_${generateId()}` };
        return {
            stateMachine: {
                ...state.stateMachine,
                edges: [...state.stateMachine.edges, newEdge]
            }
        };
    }),

    updateSmEdge: (id, updates) => set((state) => {
        if (!state.stateMachine) return state;
        return {
            stateMachine: {
                ...state.stateMachine,
                edges: state.stateMachine.edges.map(e => e.id === id ? { ...e, ...updates } : e)
            }
        };
    }),

    deleteSmEdge: (id) => set((state) => {
        if (!state.stateMachine) return state;
        return {
            stateMachine: {
                ...state.stateMachine,
                edges: state.stateMachine.edges.filter(e => e.id !== id)
            },
            selectedSmEdgeIds: state.selectedSmEdgeIds.filter(selectedId => selectedId !== id)
        };
    }),

    addSmInteraction: (interaction) => set((state) => {
        if (!state.stateMachine) return state;
        const newInteraction = { ...interaction, id: `int_${generateId()}` };
        return {
            stateMachine: {
                ...state.stateMachine,
                interactions: [...(state.stateMachine.interactions || []), newInteraction]
            }
        };
    }),

    updateSmInteraction: (id, updates) => set((state) => {
        if (!state.stateMachine) return state;
        return {
            stateMachine: {
                ...state.stateMachine,
                interactions: (state.stateMachine.interactions || []).map(i => i.id === id ? { ...i, ...updates } : i)
            }
        };
    }),

    deleteSmInteraction: (id) => set((state) => {
        if (!state.stateMachine) return state;
        return {
            stateMachine: {
                ...state.stateMachine,
                interactions: (state.stateMachine.interactions || []).filter(i => i.id !== id)
            }
        };
    }),

    setSmNodeSelection: (ids) => set({ selectedSmNodeIds: ids }),
    setSmEdgeSelection: (ids) => set({ selectedSmEdgeIds: ids }),
});
