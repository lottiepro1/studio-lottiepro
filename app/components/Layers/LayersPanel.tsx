'use client';

import { useMemo, useRef, useCallback, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCreatorStore } from '@/lib/creator/state/store';
import { LayerItem } from './LayerItem';
import { Layers as LayersIcon, Plus, Trash2 } from 'lucide-react';

const PANEL_BG      = '#18191B';
const SEG_CONT_BG   = '#27292C';
const SEG_BORDER    = 'rgba(221,234,248,0.08)';
const ACTIVE_TAB_BG = '#111113';
const ACTIVE_TAB_BD = 'rgba(211,237,248,0.11)';
const TEXT_ON       = 'rgba(252,253,255,0.94)';
const TEXT_OFF      = 'rgba(252,253,255,0.50)';
const NAME_COLOR    = 'rgba(241,247,254,0.71)';

const ROW_HEIGHT = 36; // 32px item + 4px gap

export default function LayersPanel() {
  const activeTab    = useCreatorStore(s => s.activeLayersTab);
  const setActiveTab = useCreatorStore(s => s.setActiveLayersTab);

  // Layers
  const nodes             = useCreatorStore(s => s.nodes);
  const selectedIds       = useCreatorStore(s => s.selectedIds);
  const lastSelectedId    = useCreatorStore(s => s.lastSelectedId);
  const setSelection      = useCreatorStore(s => s.setSelection);
  const addToSelection    = useCreatorStore(s => s.addToSelection);
  const removeFromSelection = useCreatorStore(s => s.removeFromSelection);
  const setActivePanel    = useCreatorStore(s => s.setActivePanel);
  const activeArtboardId  = useCreatorStore(s => s.activeArtboardId);
  const previewNode       = useCreatorStore(s => s.previewNode);

  // Segments
  const flowBlocks   = useCreatorStore(s => s.flowBlocks);
  const fps          = useCreatorStore(s => s.fps);
  const addFlowBlock = useCreatorStore(s => s.addFlowBlock);
  const updateFlowBlock = useCreatorStore(s => s.updateFlowBlock);
  const deleteFlowBlock = useCreatorStore(s => s.deleteFlowBlock);
  const setWorkArea  = useCreatorStore(s => s.setWorkArea);
  const setCurrentTime = useCreatorStore(s => s.setCurrentTime);

  const artboard = activeArtboardId
    ? nodes.get(activeArtboardId)
    : Array.from(nodes.values()).find(n => n.type === 'artboard');

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
      const endIdx   = flatOrderedIds.indexOf(nodeId);
      if (startIdx !== -1 && endIdx !== -1) {
        const min   = Math.min(startIdx, endIdx);
        const max   = Math.max(startIdx, endIdx);
        // Skip locked layers in range selections
        const range = flatOrderedIds.slice(min, max + 1).filter(id => !nodes.get(id)?.locked);
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
  }, [flatOrderedIds, lastSelectedId, selectedIds, nodes, setSelection, addToSelection, removeFromSelection, setActivePanel]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const formatTime = (frames: number) => {
    const s = Math.floor(frames / fps);
    const f = frames % fps;
    if (s > 0) return f > 0 ? `${s}s ${f}f` : `${s}s`;
    return `${f}f`;
  };

  return (
    <div className="h-full flex flex-col select-none" style={{ background: PANEL_BG, padding: '12px', gap: '12px' }}>

      {/* Segmented control */}
      <div
        className="flex items-stretch shrink-0 rounded-[6px] p-[2px] gap-[1px]"
        style={{ background: SEG_CONT_BG, border: `1px solid ${SEG_BORDER}` }}
      >
        {(['layers', 'segments'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="flex-1 h-[30px] rounded-[4px] text-[13px] transition-colors capitalize"
            style={
              activeTab === tab
                ? { background: ACTIVE_TAB_BG, border: `1px solid ${ACTIVE_TAB_BD}`, color: TEXT_ON, fontWeight: 510 }
                : { background: 'transparent', border: '1px solid transparent', color: TEXT_OFF, fontWeight: 400 }
            }
          >
            {tab === 'layers' ? 'Layers' : 'Segments'}
          </button>
        ))}
      </div>

      {/* ── Content panels — both always mounted, fade between them ── */}
      <div className="flex-1 relative min-h-0 overflow-hidden">

        {/* Layers panel */}
        <div
          ref={scrollContainerRef}
          className="absolute inset-0 overflow-y-auto overflow-x-hidden custom-scrollbar"
          style={{
            opacity: activeTab === 'layers' ? 1 : 0,
            transition: 'opacity 0.18s ease',
            pointerEvents: activeTab === 'layers' ? 'auto' : 'none',
          }}
        >
          {previewNode && (
            <div
              className="flex items-center h-8 px-3 gap-3 rounded mb-1 border border-white/[0.10] shrink-0"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              <LayersIcon size={16} className="shrink-0" />
              <span className="text-[13px] italic truncate flex-1">{previewNode.name} (creating…)</span>
            </div>
          )}

          {flatRows.length === 0 && !previewNode ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 opacity-40">
              <LayersIcon size={28} style={{ color: NAME_COLOR }} />
              <p className="text-[12px] text-center" style={{ color: NAME_COLOR }}>No layers yet</p>
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
                      paddingBottom: '4px',
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

        {/* Segments panel */}
        <div
          className="absolute inset-0 flex flex-col gap-2"
          style={{
            opacity: activeTab === 'segments' ? 1 : 0,
            transition: 'opacity 0.18s ease',
            pointerEvents: activeTab === 'segments' ? 'auto' : 'none',
          }}
        >
          <div className="flex-1 overflow-y-auto flex flex-col gap-1.5 custom-scrollbar min-h-0">
            {flowBlocks.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 opacity-40 py-8 px-4">
                <Plus size={28} style={{ color: NAME_COLOR }} />
                <p className="text-[12px] text-center" style={{ color: NAME_COLOR }}>
                  Define animation segments by right-clicking the timeline work area.
                </p>
              </div>
            ) : (
              flowBlocks.map(block => (
                <div
                  key={block.id}
                  draggable
                  onDragStart={e => {
                    e.dataTransfer.setData('lottiepro/segment-id', block.id);
                    e.dataTransfer.setData('lottiepro/segment-name', block.name);
                  }}
                  onClick={() => { setWorkArea(block.startFrame, block.endFrame); setCurrentTime(block.startFrame); }}
                  className="rounded-lg p-2 border border-white/[0.06] flex flex-col gap-2 group hover:border-accent/20 hover:bg-accent/[0.03] transition-all cursor-pointer active:scale-[0.98]"
                  style={{ background: 'var(--bg-surface)' }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col flex-1 min-w-0">
                      <input
                        type="text"
                        value={block.name}
                        onClick={e => e.stopPropagation()}
                        onChange={e => updateFlowBlock(block.id, { name: e.target.value })}
                        className="bg-transparent text-xs font-medium text-secondary border-none outline-none focus:text-primary rounded px-0 py-0 truncate"
                        placeholder="Segment Name"
                      />
                      <span className="text-[9px] text-white/20 font-medium uppercase tracking-tighter mt-0.5 pointer-events-none">
                        {formatTime(block.endFrame - block.startFrame)}
                      </span>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); deleteFlowBlock(block.id); }}
                      className="w-6 h-6 flex items-center justify-center rounded-md text-white/20 hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(['startFrame', 'endFrame'] as const).map((key, i) => (
                      <div
                        key={key}
                        className="bg-black/20 rounded border border-white/5 px-1.5 py-1 focus-within:border-white/20 transition-colors flex items-center"
                        onClick={e => e.stopPropagation()}
                      >
                        <span className="text-[8px] text-muted uppercase mr-1 pointer-events-none">{i === 0 ? 'In' : 'Out'}</span>
                        <input
                          type="number"
                          value={block[key]}
                          onChange={e => updateFlowBlock(block.id, { [key]: parseInt(e.target.value) || 0 })}
                          className="w-full bg-transparent text-[10px] text-white/60 font-mono outline-none"
                          min={0}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
          <button
            onClick={() => {
              const state = useCreatorStore.getState();
              addFlowBlock({
                name: `Segment ${state.flowBlocks.length + 1}`,
                startFrame: state.workAreaStart ?? 0,
                endFrame: state.workAreaEnd ?? state.duration,
                loop: true,
              });
            }}
            className="w-full h-8 rounded-lg text-[13px] font-medium flex items-center justify-center gap-2 transition-all active:scale-95 shrink-0 text-white"
            style={{ background: 'var(--accent)' }}
          >
            <Plus size={14} /> Add Segment
          </button>
        </div>

      </div>
    </div>
  );
}
