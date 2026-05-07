import { StateCreator } from 'zustand';

// Selection state interface
export interface SelectionSlice {
  selectedIds: string[];
  lastSelectedId: string | null;
  editingNodeId: string | null;
  setSelection: (ids: string[]) => void;
  addToSelection: (id: string) => void;
  removeFromSelection: (id: string) => void;
  clearSelection: () => void;
  isSelected: (id: string) => boolean;
  setEditingNode: (id: string | null) => void;
}

// Create the selection slice
export const createSelectionSlice: StateCreator<SelectionSlice> = (set, get) => ({
  selectedIds: [],
  lastSelectedId: null,
  editingNodeId: null,

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

  clearSelection: () => set({ selectedIds: [], lastSelectedId: null, editingNodeId: null }),

  isSelected: (id) => get().selectedIds.includes(id),

  setEditingNode: (id) => set({ editingNodeId: id }),
});