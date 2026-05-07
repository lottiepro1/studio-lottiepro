import React, { useRef } from 'react';
import { useCreatorStore } from '@/lib/creator/state/store';
import { StateMachineNode } from '@/lib/creator/state/stateMachineSlice';

interface StateNodeProps {
    node: StateMachineNode;
    zoom: number;
    onPortDragStart: (e: React.PointerEvent, nodeId: string) => void;
}

export default function StateNode({ node, zoom, onPortDragStart }: StateNodeProps) {
    const updateSmNode = useCreatorStore(state => state.updateSmNode);
    const setSmNodeSelection = useCreatorStore(state => state.setSmNodeSelection);
    const selectedNodes = useCreatorStore(state => state.selectedSmNodeIds);
    const smActiveNodeId = useCreatorStore(state => state.smActiveNodeId);
    const smIsPlaying = useCreatorStore(state => state.smIsPlaying);

    const isSelected = selectedNodes.includes(node.id);
    const isActive = smIsPlaying && smActiveNodeId === node.id;
    const isDragging = useRef(false);
    const startPos = useRef({ x: 0, y: 0 });
    const initialNodePos = useRef({ x: 0, y: 0 });

    const handlePointerDown = (e: React.PointerEvent) => {
        // Prevent pan from triggering
        e.stopPropagation();

        // Select node
        if (!process.env.NEXT_PUBLIC_DEBUG) {
            setSmNodeSelection([node.id]);
        }

        if (e.button === 0) { // Left click
            isDragging.current = true;
            startPos.current = { x: e.clientX, y: e.clientY };
            initialNodePos.current = { ...node.position };

            // Attach window listeners
            window.addEventListener('pointermove', handlePointerMove);
            window.addEventListener('pointerup', handlePointerUp);
        }
    };

    const handlePointerMove = (e: PointerEvent) => {
        if (!isDragging.current) return;

        const dx = (e.clientX - startPos.current.x) / zoom;
        const dy = (e.clientY - startPos.current.y) / zoom;

        // Snap to grid (e.g. 10px grid)
        const snap = 10;
        const newX = Math.round((initialNodePos.current.x + dx) / snap) * snap;
        const newY = Math.round((initialNodePos.current.y + dy) / snap) * snap;

        updateSmNode(node.id, { position: { x: newX, y: newY } });
    };

    const handlePointerUp = () => {
        isDragging.current = false;
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
    };

    let config = {
        global: { color: 'bg-cyan-400 text-cyan-400', label: 'GLOBAL' },
        initial: { color: 'bg-green-500 text-green-500', label: 'INITIAL' },
        final: { color: 'bg-purple-500 text-purple-500', label: 'FINAL' },
        playback: { color: 'bg-white/40 text-white/40', label: 'PLAYBACK' }
    }[node.type] || { color: 'bg-white/40 text-white/40', label: 'UNKNOWN' };

    if (node.isInitial) {
        config = { color: 'bg-green-500 text-green-500', label: 'INITIAL' };
    } else if (node.isFinal) {
        config = { color: 'bg-purple-500 text-purple-500', label: 'FINAL' };
    }

    return (
        <div
            className={`absolute rounded-lg px-4 py-3 shadow-[0_4px_20px_rgba(0,0,0,0.4)] flex flex-col items-center w-36 cursor-grab active:cursor-grabbing transition-all duration-300 ${isActive ? 'border-2 border-green-500 scale-105 z-50' : isSelected ? 'border-2 border-accent z-10' : 'border border-white/[0.08] hover:border-white/20 z-0'}`}
            style={{
                background: 'var(--bg-surface)',
                left: node.position.x,
                top: node.position.y,
                willChange: isDragging.current ? 'transform' : 'auto'
            }}
            onPointerDown={handlePointerDown}
        >
            {/* Input Port (Left) */}
            {node.type !== 'global' && (
                <div
                    data-sm-port="input"
                    data-sm-node-id={node.id}
                    className="absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-white/10 bg-white/20 hover:bg-accent cursor-crosshair hover:scale-125 transition-all"
                />
            )}

            <div className="flex items-center gap-2 mb-1 w-full justify-center pointer-events-none">
                <div className={`w-2 h-2 rounded-full shadow-[0_0_8px_currentColor] ${config.color}`} />
                <span className="text-xs font-medium text-primary">{node.name}</span>
            </div>
            <div className="px-3 py-1 mt-2 rounded-md text-[9px] uppercase tracking-widest bg-white/[0.04] text-muted font-mono pointer-events-none">
                {config.label} STATE
            </div>

            {/* Output Port (Right) */}
            {node.type !== 'final' && !node.isFinal && (
                <div
                    onPointerDown={(e) => onPortDragStart(e, node.id)}
                    className={`absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-white/10 cursor-crosshair hover:scale-125 transition-all ${node.type === 'global' ? 'bg-cyan-400' : 'bg-accent'}`}
                />
            )}
        </div>
    );
}
