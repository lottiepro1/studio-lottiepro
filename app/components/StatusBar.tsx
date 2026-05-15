'use client';

import { useCreatorStore } from '@/lib/creator/state/store';
import { Minus, Plus } from 'lucide-react';

const TOGGLE_BG    = 'rgba(211,237,248,0.11)';
const TOGGLE_TEXT  = '#EDEEF0';
const SLIDER_RANGE = '#D6E1FF';
const SLIDER_TRACK = 'rgba(221,234,248,0.08)';
const SLIDER_BD    = 'rgba(217,237,254,0.15)';

export default function StatusBar() {
  const activeTool = useCreatorStore((state) => state.activeTool);
  const selectedIds = useCreatorStore((state) => state.selectedIds);
  const zoomLevel = useCreatorStore((state) => state.zoomLevel);
  const setZoomLevel = useCreatorStore((state) => state.setZoomLevel);

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

  const sliderPct = Math.min(100, Math.max(0, ((zoomLevel - 0.05) / (10 - 0.05)) * 100));

  return (
    <div
      className="h-6 shrink-0 flex items-center px-3 gap-4 border-t border-white/[0.06]"
      style={{ background: 'var(--bg-panel)', color: 'var(--text-muted)' }}
    >
      {/* Tool / selection info */}
      <span className="text-[11px]">
        Tool: <span style={{ color: 'var(--text-secondary)' }}>{toolNames[activeTool] ?? activeTool}</span>
      </span>
      <span className="text-[11px]">
        Selected: <span style={{ color: 'var(--text-secondary)' }}>{selectedIds.length}</span>
      </span>

      {/* Toggle Switches / Modes (no-op) */}
      <button
        className="h-5 px-2.5 rounded text-[11px] font-medium transition-colors hover:opacity-80 shrink-0"
        style={{ background: TOGGLE_BG, color: TOGGLE_TEXT }}
      >
        Toggle Switches / Modes
      </button>

      {/* Zoom controls */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={() => setZoomLevel(Math.max(0.05, zoomLevel / 1.3))}
          className="w-5 h-5 flex items-center justify-center rounded transition-colors hover:bg-white/10"
          style={{ color: 'var(--text-muted)' }}
          title="Zoom out"
        >
          <Minus size={11} strokeWidth={2} />
        </button>

        {/* Slider */}
        <div className="relative flex items-center" style={{ width: 88, height: 16 }}>
          <div
            className="absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full"
            style={{ height: 5, background: SLIDER_TRACK, border: `1px solid ${SLIDER_BD}` }}
          />
          <div
            className="absolute left-0 top-1/2 -translate-y-1/2 rounded-full pointer-events-none"
            style={{ height: 5, width: `${sliderPct}%`, background: SLIDER_RANGE }}
          />
          <input
            type="range"
            min={5}
            max={1000}
            value={Math.round(zoomLevel * 100)}
            onChange={e => setZoomLevel(Number(e.target.value) / 100)}
            className="absolute inset-0 w-full opacity-0 cursor-pointer"
            title={`Zoom: ${Math.round(zoomLevel * 100)}%`}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 pointer-events-none rounded-[3px]"
            style={{
              width: 8, height: 8,
              left: `calc(${sliderPct}% - 4px)`,
              background: '#FFFFFF',
              border: '1px solid #43484E',
            }}
          />
        </div>

        <button
          onClick={() => setZoomLevel(Math.min(10, zoomLevel * 1.3))}
          className="w-5 h-5 flex items-center justify-center rounded transition-colors hover:bg-white/10"
          style={{ color: 'var(--text-muted)' }}
          title="Zoom in"
        >
          <Plus size={11} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
