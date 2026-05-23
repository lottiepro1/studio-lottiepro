import { StateCreator } from 'zustand';

// Selection state interface
export interface SelectionSlice {
  selectedIds: string[];
  lastSelectedId: string | null;
  editingNodeId: string | null;
  /** Stack of group IDs the user has "entered" by double-clicking. Last item is the current active group. */
  activeGroupStack: string[];
  setSelection: (ids: string[]) => void;
  addToSelection: (id: string) => void;
  removeFromSelection: (id: string) => void;
  clearSelection: () => void;
  isSelected: (id: string) => boolean;
  setEditingNode: (id: string | null) => void;
  /** Replace the entire stack. Pass null/undefined to clear. */
  setActiveGroup: (id: string | null) => void;
  /** Enter a nested group — push onto the stack. */
  pushActiveGroup: (id: string) => void;
  /** Exit one level — pop from the stack. */
  popActiveGroup: () => void;
}

// Create the selection slice
export const createSelectionSlice: StateCreator<SelectionSlice> = (set, get) => ({
  selectedIds: [],
  lastSelectedId: null,
  editingNodeId: null,
  activeGroupStack: [],

  setSelection: (ids) => set((state) => ({
    selectedIds: ids,
    lastSelectedId: ids.length > 0 ? ids[ids.length - 1] : state.lastSelectedId,
    editingNodeId: (state.editingNodeId && ids.includes(state.editingNodeId)) ? state.editingNodeId : null
  })),

  addToSelection: (id) => set((state) => ({
    selectedIds: state.selectedIds.includes(id) ? state.selectedIds : [...state.selectedIds, id],
    lastSelectedId: id
  })),

  removeFromSelection: (id) => set((state) => {
    const newSelected = state.selectedIds.filter((selectedId) => selectedId !== id);
    return {
      selectedIds: newSelected,
      lastSelectedId: state.lastSelectedId === id ? (newSelected.length > 0 ? newSelected[newSelected.length - 1] : null) : state.lastSelectedId,
      editingNodeId: state.editingNodeId === id ? null : state.editingNodeId,
    };
  }),

  clearSelection: () => set({ selectedIds: [], lastSelectedId: null, editingNodeId: null, activeGroupStack: [] }),

  isSelected: (id) => get().selectedIds.includes(id),

  setEditingNode: (id) => set({ editingNodeId: id }),

  setActiveGroup: (id) => set({ activeGroupStack: id ? [id] : [] }),

  pushActiveGroup: (id) => set((state) => ({ activeGroupStack: [...state.activeGroupStack, id] })),

  popActiveGroup: () => set((state) => ({ activeGroupStack: state.activeGroupStack.slice(0, -1) })),
});
