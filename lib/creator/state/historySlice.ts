import { StateCreator } from 'zustand';
import { CreatorStore } from './types';
import { SceneNode } from './sceneSlice';

export interface HistorySnapshot {
    nodes: Map<string, SceneNode>;
    selectedIds: string[];
    selectedKeyframeIds: string[];
    fps: number;
    duration: number;
    lottieModel?: Record<string, unknown> | null;
    label?: string;
}

export interface HistorySlice {
    past: HistorySnapshot[];
    future: HistorySnapshot[];
    undo: () => void;
    redo: () => void;
    pushToHistory: (label?: string) => void;
    lastPushTime: number;
}

export const createHistorySlice: StateCreator<CreatorStore, [["zustand/immer", never]], [], HistorySlice> = (set, get) => ({
    past: [],
    future: [],
    lastPushTime: 0,

    undo: () => {
        const { past, future, nodes, selectedIds, selectedKeyframeIds, fps, duration } = get();
        if (past.length === 0) return;

        const newPast = [...past];
        const snapshot = newPast.pop()!;

        // Save current state to future
        const currentSnapshot: HistorySnapshot = {
            nodes: new Map(nodes),
            selectedIds: [...selectedIds],
            selectedKeyframeIds: [...selectedKeyframeIds],
            fps,
            duration,
            lottieModel: get().lottieModel,
        };

        set({
            nodes: snapshot.nodes,
            selectedIds: snapshot.selectedIds,
            selectedKeyframeIds: snapshot.selectedKeyframeIds,
            fps: snapshot.fps,
            duration: snapshot.duration,
            // Step 4.8: restore lottieModel so lottieNodeMap refs match the restored nodes.
            // structureChangeCounter increment forces DotLottiePlayback to take the slow path
            // (full re-export) after undo — guaranteeing ThorVG shows the correct restored state.
            lottieModel: snapshot.lottieModel ?? null,
            lottieNodeMap: null,
            structureChangeCounter: get().structureChangeCounter + 1,
            past: newPast,
            future: [currentSnapshot, ...future],
            updateCounter: get().updateCounter + 1
        });

    },

    redo: () => {
        const { past, future, nodes, selectedIds, selectedKeyframeIds, fps, duration } = get();
        if (future.length === 0) return;

        const newFuture = [...future];
        const snapshot = newFuture.shift()!;

        // Save current state to past
        const currentSnapshot: HistorySnapshot = {
            nodes: new Map(nodes),
            selectedIds: [...selectedIds],
            selectedKeyframeIds: [...selectedKeyframeIds],
            fps,
            duration,
            lottieModel: get().lottieModel,
        };

        set({
            nodes: snapshot.nodes,
            selectedIds: snapshot.selectedIds,
            selectedKeyframeIds: snapshot.selectedKeyframeIds,
            fps: snapshot.fps,
            duration: snapshot.duration,
            lottieModel: snapshot.lottieModel ?? null,
            lottieNodeMap: null,
            structureChangeCounter: get().structureChangeCounter + 1,
            past: [...past, currentSnapshot],
            future: newFuture,
            updateCounter: get().updateCounter + 1
        });

    },

    pushToHistory: (label) => {
        const { nodes, selectedIds, selectedKeyframeIds, fps, duration, past, lastPushTime } = get();
        const now = Date.now();

        // Smart merging for property changes to avoid history clutter
        // If it's the same label and happened recently (< 2s), overwrite the last state (effectively merging)
        const isPropertyChange = label === 'Change Property' || label?.startsWith('Change');
        const shouldMerge = isPropertyChange &&
            past.length > 0 &&
            past[past.length - 1].label === label &&
            (now - lastPushTime) < 2000;

        const snapshot: HistorySnapshot = {
            nodes: new Map(nodes),
            selectedIds: [...selectedIds],
            selectedKeyframeIds: [...selectedKeyframeIds],
            fps,
            duration,
            lottieModel: get().lottieModel,
            label
        };

        if (shouldMerge) {
            // Replace the last entry instead of adding a new one
            const newPast = [...past];
            // We don't replace the ENTIRE snapshot because we want to KEEP the previous node state
            // but update other things? No, actually we want to keep the "original" state from the first push
            // and just not add a new one.
            // So if we merge, we just DON'T push the new one.
            set({ lastPushTime: now });
            return;
        }

        // Limit history to 50 steps
        const newPast = [...past, snapshot].slice(-50);

        set({
            past: newPast,
            future: [], // Clear future on new action
            lastPushTime: now
        });

    }
});
