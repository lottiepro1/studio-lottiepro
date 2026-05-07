'use client';

import { useCreatorStore } from '@/lib/creator/state/store';

export default function StatusBar() {
  const activeTool = useCreatorStore((state) => state.activeTool);
  const selectedIds = useCreatorStore((state) => state.selectedIds);

  const toolNames: Record<string, string> = {
    select:  'Select',
    move:    'Move',
    rect:    'Rectangle',
    ellipse: 'Ellipse',
    polygon: 'Polygon',
    star:    'Star',
    pen:     'Pen',
    text:    'Text',
  };

  return (
    <div
      className="h-6 shrink-0 flex items-center px-4 gap-6 text-[11px] border-t border-white/[0.06]"
      style={{ background: 'var(--bg-panel)', color: 'var(--text-muted)' }}
    >
      <span>
        Tool: <span style={{ color: 'var(--text-secondary)' }}>{toolNames[activeTool] ?? activeTool}</span>
      </span>
      <span>
        Selected: <span style={{ color: 'var(--text-secondary)' }}>{selectedIds.length}</span>
      </span>
    </div>
  );
}
