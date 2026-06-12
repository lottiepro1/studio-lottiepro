import { StateCreator } from 'zustand';

// Tool types available in the editor
export type ToolType = 'select' | 'move' | 'rect' | 'ellipse' | 'polygon' | 'star' | 'pen' | 'text';

// Tool state interface
export interface ToolSlice {
  activeTool: ToolType;
  setActiveTool: (tool: ToolType) => void;
  isTimelineCollapsed: boolean;
  setTimelineCollapsed: (collapsed: boolean) => void;
  isSegmentsPanelOpen: boolean;
  setSegmentsPanelOpen: (isOpen: boolean) => void;
  creatorMode: 'animate' | 'state-flow';
  setCreatorMode: (mode: 'animate' | 'state-flow') => void;
  isDiscoverModalOpen: boolean;
  setDiscoverModalOpen: (isOpen: boolean) => void;
  activeLayersTab: 'layers' | 'segments';
  setActiveLayersTab: (tab: 'layers' | 'segments') => void;
  viewportZoom: number;
  setViewportZoom: (zoom: number) => void;
}

// Create the tool slice
export const createToolSlice: StateCreator<ToolSlice> = (set) => ({
  activeTool: 'select', // Default tool is select
  setActiveTool: (tool) => set({ activeTool: tool }),
  isTimelineCollapsed: false,
  setTimelineCollapsed: (collapsed) => set({ isTimelineCollapsed: collapsed }),
  isSegmentsPanelOpen: false,
  setSegmentsPanelOpen: (isOpen: boolean) => set({ isSegmentsPanelOpen: isOpen }),
  creatorMode: 'animate',
  setCreatorMode: (mode) => set({ creatorMode: mode }),
  isDiscoverModalOpen: false,
  setDiscoverModalOpen: (isOpen) => set({ isDiscoverModalOpen: isOpen }),
  activeLayersTab: 'layers',
  setActiveLayersTab: (tab) => set({ activeLayersTab: tab }),
  viewportZoom: 1,
  setViewportZoom: (zoom) => set({ viewportZoom: zoom }),
});