'use client';

import { useState, useRef, memo } from 'react';
import { useCreatorStore } from '@/lib/creator/state/store';
import {
  ChevronRight,
  Eye, EyeOff,
  Lock, Unlock,
  Square, Circle, Folder, Type,
  Image as ImageIcon, MousePointer2, Box, PenTool,
} from 'lucide-react';

const ICON_COLOR  = '#808B9D';
const NAME_COLOR  = 'rgba(241,247,254,0.71)';
const ROW_BG      = 'rgba(221,234,248,0.08)';
const SEL_BG      = 'rgba(221,234,248,0.30)';

interface LayerItemProps {
  nodeId: string;
  depth: number;
  onSelect: (isShift: boolean, isCtrl: boolean) => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

export const LayerItem = memo(function LayerItem({
  nodeId, depth, onSelect, isExpanded = true, onToggleExpand,
}: LayerItemProps) {
  const node       = useCreatorStore(s => s.nodes.get(nodeId));
  const selectedIds = useCreatorStore(s => s.selectedIds);
  const updateNode = useCreatorStore(s => s.updateNode);
  const moveNode   = useCreatorStore(s => s.moveNode);
  const setActiveArtboard = useCreatorStore(s => s.setActiveArtboard);

  const [isEditing, setIsEditing]   = useState(false);
  const [tempName,  setTempName]    = useState(node?.name || '');
  const [dropPos,   setDropPos]     = useState<'before' | 'after' | 'inside' | null>(null);
  const itemRef = useRef<HTMLDivElement>(null);

  const isSelected   = !!node && selectedIds.includes(node.id);
  const hasChildren  = !!node && !!node.children?.length;

  const getIcon = () => {
    if (!node) return null;
    switch (node.type) {
      case 'rect':    return <Square    size={16} strokeWidth={1.75} />;
      case 'ellipse': return <Circle    size={16} strokeWidth={1.75} />;
      case 'path':    return <PenTool   size={16} strokeWidth={1.75} />;
      case 'text':    return <Type      size={16} strokeWidth={1.75} />;
      case 'image':   return <ImageIcon size={16} strokeWidth={1.75} />;
      case 'precomp': return <Box       size={16} strokeWidth={1.75} style={{ color: 'var(--accent)' }} />;
      case 'group':
        if (node.mergeMode && node.mergeMode !== 'none') {
          const sym: Record<string, string> = { union: '∪', subtract: '−', intersect: '∩', exclude: '⊞' };
          return (
            <span className="w-4 h-4 flex items-center justify-center text-[10px] font-bold" style={{ color: 'var(--accent)' }}>
              {sym[node.mergeMode]}
            </span>
          );
        }
        return <Folder size={16} strokeWidth={1.75} />;
      default:        return <MousePointer2 size={16} strokeWidth={1.75} />;
    }
  };

  const handleToggleVisibility = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!node) return;
    useCreatorStore.getState().pushToHistory(`${node.visible ? 'Hide' : 'Show'} ${node.name}`);
    updateNode(node.id, { visible: !node.visible });
  };

  const handleToggleLock = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!node) return;
    useCreatorStore.getState().pushToHistory(`${node.locked ? 'Unlock' : 'Lock'} ${node.name}`);
    updateNode(node.id, { locked: !node.locked });
  };

  const handleRename = () => {
    if (node && tempName.trim() && tempName.trim() !== node.name) {
      useCreatorStore.getState().pushToHistory(`Rename ${node.name}`);
      updateNode(node.id, { name: tempName.trim() });
    }
    setIsEditing(false);
  };

  if (!node) return null;

  // ── Drag & drop ──────────────────────────────────────────────────────────
  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('nodeId', node.id);
    e.dataTransfer.effectAllowed = 'move';
    if (itemRef.current) itemRef.current.style.opacity = '0.5';
  };

  const onDragEnd = () => {
    if (itemRef.current) itemRef.current.style.opacity = '1';
    setDropPos(null);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!itemRef.current) return;
    const rect = itemRef.current.getBoundingClientRect();
    const y    = e.clientY - rect.top;
    const h    = rect.height;
    if (node.type === 'group' || node.type === 'artboard') {
      if (y < h * 0.25)     setDropPos('before');
      else if (y > h * 0.75) setDropPos('after');
      else                   setDropPos('inside');
    } else {
      setDropPos(y < h / 2 ? 'before' : 'after');
    }
  };

  const onDragLeave = () => setDropPos(null);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('nodeId');
    if (!draggedId || draggedId === node.id) { setDropPos(null); return; }
    const currentNodes = useCreatorStore.getState().nodes;
    if (!currentNodes.get(draggedId)) return;
    let pid = node.parentId;
    while (pid) {
      if (pid === draggedId) { setDropPos(null); return; }
      pid = currentNodes.get(pid)?.parentId || null;
    }
    if (dropPos === 'inside') {
      moveNode(draggedId, node.id, node.children.length);
      if (!isExpanded) onToggleExpand?.();
    } else if (node.parentId) {
      const parent = currentNodes.get(node.parentId);
      if (parent) {
        const idx = parent.children.indexOf(node.id);
        moveNode(draggedId, node.parentId, dropPos === 'before' ? idx + 1 : idx);
      }
    }
    setDropPos(null);
  };

  return (
    <div
      ref={itemRef}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={e => { e.stopPropagation(); onSelect(e.shiftKey, e.ctrlKey || e.metaKey); }}
      onDoubleClick={() => {
        if (node.type === 'precomp' && node.refId) setActiveArtboard(node.refId);
        else { setIsEditing(true); setTempName(node.name); }
      }}
      className="group flex items-center h-8 cursor-pointer rounded relative transition-colors"
      style={{
        paddingLeft:  `${depth * 16 + 12}px`,
        paddingRight: '12px',
        gap:          '8px',
        background:   isSelected ? SEL_BG : ROW_BG,
        ...(dropPos === 'inside' ? { outline: '1px solid var(--accent)' } : {}),
      }}
    >
      {/* Drop indicators */}
      {(dropPos === 'before' || dropPos === 'after') && (
        <div className={`absolute left-0 right-0 h-[2px] bg-accent z-50 pointer-events-none ${dropPos === 'before' ? '-top-[1px]' : '-bottom-[1px]'}`}>
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[6px] h-[6px] rounded-full bg-accent" />
        </div>
      )}

      {/* Chevron — 16×16 slot, only visible for groups */}
      <div className="w-4 h-4 flex items-center justify-center shrink-0">
        {hasChildren && (
          <button
            onClick={e => { e.stopPropagation(); onToggleExpand?.(); }}
            className="w-4 h-4 flex items-center justify-center"
            style={{ color: ICON_COLOR }}
          >
            <ChevronRight
              size={16}
              strokeWidth={1.75}
              className={`transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
            />
          </button>
        )}
      </div>

      {/* Layer type icon — 16×16 */}
      <div className="w-4 h-4 flex items-center justify-center shrink-0" style={{ color: ICON_COLOR }}>
        {getIcon()}
      </div>

      {/* Layer name */}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <input
            autoFocus
            className="w-full bg-transparent text-[13px] outline-none rounded"
            style={{ color: NAME_COLOR, caretColor: 'var(--accent)' }}
            value={tempName}
            onChange={e => setTempName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={e => {
              if (e.key === 'Enter')  handleRename();
              if (e.key === 'Escape') setIsEditing(false);
            }}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span className="text-[13px] truncate block" style={{ color: NAME_COLOR, fontWeight: 400 }}>
            {node.name}
          </span>
        )}
      </div>

      {/* Eye — always visible */}
      <button
        onClick={handleToggleVisibility}
        className="w-4 h-4 flex items-center justify-center shrink-0 transition-colors"
        style={{ color: node.visible ? ICON_COLOR : 'var(--accent)' }}
        title={node.visible ? 'Hide layer' : 'Show layer'}
      >
        {node.visible
          ? <Eye     size={16} strokeWidth={1.75} />
          : <EyeOff  size={16} strokeWidth={1.75} />
        }
      </button>

      {/* Lock — always visible when locked, hover to show when unlocked */}
      <button
        onClick={handleToggleLock}
        className="w-4 h-4 flex items-center justify-center shrink-0 transition-colors"
        style={{ color: node.locked ? 'var(--accent)' : ICON_COLOR }}
        title={node.locked ? 'Unlock layer' : 'Lock layer'}
      >
        {node.locked
          ? <Lock   size={16} strokeWidth={1.75} />
          : <Unlock size={16} strokeWidth={1.75} />
        }
      </button>
    </div>
  );
});
