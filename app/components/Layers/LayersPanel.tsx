'use client';

import { useMemo, useState, useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCreatorStore } from '@/lib/creator/state/store';
import { LayerItem } from './LayerItem';
import { Layers as LayersIcon } from 'lucide-react';

const ROW_HEIGHT = 32;

export default function LayersPanel() {
  const nodes = useCreatorStore((state) => state.nodes);
  const selectedIds = useCreatorStore((state) => state.selectedIds);
  const lastSelectedId = useCreatorStore((state) => state.lastSelectedId);
  const setSelection = useCreatorStore((state) => state.setSelection);
  const addToSelection = useCreatorStore((state) => state.addToSelection);
  const removeFromSelection = useCreatorStore((state) => state.removeFromSelection);
  const setActivePanel = useCreatorStore((state) => state.setActivePanel);
  const activeArtboardId = useCreatorStore((state) => state.activeArtboardId);

  const artboard = activeArtboardId ? nodes.get(activeArtboardId) : Array.from(nodes.values()).find(n => n.type === 'artboard');
  const previewNode = useCreatorStore((state) => state.previewNode);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const flatRows = useMemo(() => {
    if (!artboard) return [];
    const result: { nodeId: string; depth: number }[] = [];

    const traverse = (id: string, depth: number) => {
      const node = nodes.get(id);
      if (!node || node.type === 'artboard') return;
      result.push({ nodeId: id, depth });
      if (node.children?.length && (expandedIds.size === 0 || expandedIds.has(id))) {
        [...node.children].reverse().forEach(childId => traverse(childId, depth + 1));
      }
    };

    [...(artboard.children || [])].reverse().forEach(id => traverse(id, 0));
    return result;
  }, [nodes, artboard, expandedIds]);

  const flatOrderedIds = useMemo(() => flatRows.map(r => r.nodeId), [flatRows]);

  const toggleExpand = useCallback((nodeId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.size === 0) {
        const node = useCreatorStore.getState().nodes.get(nodeId);
        if (!node?.children?.length) return prev;
        next.add('__tracking__');
        useCreatorStore.getState().nodes.forEach((n, id) => {
          if (id !== nodeId && n.children?.length) next.add(id);
        });
        return next;
      }
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const isExpanded = useCallback((nodeId: string) => {
    if (expandedIds.size === 0) return true;
    return expandedIds.has(nodeId);
  }, [expandedIds]);

  const handleLayerSelect = useCallback((nodeId: string, isShift: boolean, isCtrl: boolean) => {
    setActivePanel('layers');

    if (isShift && lastSelectedId) {
      const startIdx = flatOrderedIds.indexOf(lastSelectedId);
      const endIdx = flatOrderedIds.indexOf(nodeId);

      if (startIdx !== -1 && endIdx !== -1) {
        const min = Math.min(startIdx, endIdx);
        const max = Math.max(startIdx, endIdx);
        const range = flatOrderedIds.slice(min, max + 1);

        if (isCtrl) setSelection(Array.from(new Set([...selectedIds, ...range])));
        else setSelection(range);
        return;
      }
    }

    if (isCtrl) {
      if (selectedIds.includes(nodeId)) removeFromSelection(nodeId);
      else addToSelection(nodeId);
    } else {
      setSelection([nodeId]);
    }
  }, [flatOrderedIds, lastSelectedId, selectedIds, setSelection, addToSelection, removeFromSelection, setActivePanel]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  return (
    <div className="h-full flex flex-col select-none" style={{ background: 'var(--bg-panel)' }}>
      {/* Header */}
      <div
        className="h-10 px-3 flex items-center justify-between shrink-0 border-b border-white/[0.06]"
        style={{ background: 'var(--bg-panel)' }}
      >
        <div className="flex items-center gap-2">
          <LayersIcon className="w-3.5 h-3.5 text-secondary" />
          <span className="text-xs font-medium text-secondary">Layers</span>
        </div>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded text-muted tabular-nums border border-white/[0.06]"
          style={{ background: 'var(--bg-surface)' }}
        >
          {nodes.size - 1 + (previewNode ? 1 : 0)}
        </span>
      </div>

      {/* Tree */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden px-1 py-1 custom-scrollbar min-h-0"
      >
        {previewNode && (
          <div
            className="px-2 py-1.5 rounded-md mb-0.5 flex items-center gap-2 border border-white/[0.10]"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            <LayersIcon className="w-3.5 h-3.5 shrink-0" />
            <span className="text-[11px] italic truncate">{previewNode.name} (creating…)</span>
          </div>
        )}

        {flatRows.length === 0 && !previewNode ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 py-12 opacity-40">
            <LayersIcon className="w-7 h-7 text-muted" />
            <p className="text-[11px] text-muted text-center">No layers yet</p>
          </div>
        ) : (
          <div style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
            {virtualizer.getVirtualItems().map(virtualItem => {
              const row = flatRows[virtualItem.index];
              if (!row) return null;
              return (
                <div
                  key={row.nodeId}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualItem.size}px`,
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <LayerItem
                    nodeId={row.nodeId}
                    depth={row.depth}
                    isExpanded={isExpanded(row.nodeId)}
                    onToggleExpand={() => toggleExpand(row.nodeId)}
                    onSelect={(isShift, isCtrl) => handleLayerSelect(row.nodeId, isShift, isCtrl)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
