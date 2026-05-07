import { useCreatorStore } from '@/lib/creator/state/store';
import { ToggleLeft, ToggleRight, Plus, Trash2, X, Play } from 'lucide-react';
import { StateMachineAction } from '@/lib/creator/state/stateMachineSlice';
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ActionEditor } from './ActionEditor';

interface NodeInspectorProps {
    nodeId: string;
    onClose: () => void;
    initialPos?: { x: number, y: number };
}

function ActionList({ title, actions, onAdd, onUpdate, onDelete, inputs }: {
    title: string,
    actions: StateMachineAction[],
    onAdd: () => void,
    onUpdate: (id: string, act: Partial<StateMachineAction>) => void,
    onDelete: (id: string) => void,
    inputs: any[]
}) {
    return (
        <div className="flex flex-col gap-2 border-t border-white/10 pt-3 mt-1">
            <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted uppercase tracking-wider">{title}</span>
                    <div className="w-4 h-4 rounded-full bg-white/10 flex items-center justify-center text-white/40 text-[9px] font-bold cursor-help">i</div>
                </div>
                <button
                    onClick={(e) => { e.stopPropagation(); onAdd(); }}
                    className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                >
                    <Plus size={16} />
                </button>
            </div>
            {actions.map(act => (
                <ActionEditor
                    key={act.id}
                    action={act}
                    inputs={inputs}
                    onUpdate={(updates) => onUpdate(act.id, updates)}
                    onDelete={() => onDelete(act.id)}
                />
            ))}
        </div>
    );
}

export default function NodeInspector({ nodeId, onClose, initialPos }: NodeInspectorProps) {
    const node = useCreatorStore(state => state.stateMachine?.nodes.find(n => n.id === nodeId));
    const flowBlocks = useCreatorStore(state => state.flowBlocks);
    const updateSmNode = useCreatorStore(state => state.updateSmNode);
    const inputs = useCreatorStore(state => state.stateMachine?.inputs) || [];

    const [pos, setPos] = useState(initialPos || { x: 20, y: 20 });
    const isDragging = useRef(false);
    const dragStart = useRef({ x: 0, y: 0, initialX: 0, initialY: 0 });
    const contentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (initialPos) {
            setPos(initialPos);
        }
    }, [nodeId, initialPos]);

    if (!node) return null;

    const handlePointerDown = (e: React.PointerEvent) => {
        e.stopPropagation();
        isDragging.current = true;
        dragStart.current = {
            x: e.clientX,
            y: e.clientY,
            initialX: pos.x,
            initialY: pos.y
        };
        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
    };

    const handlePointerMove = (e: PointerEvent) => {
        if (!isDragging.current) return;
        const dx = e.clientX - dragStart.current.x;
        const dy = e.clientY - dragStart.current.y;
        setPos({
            x: dragStart.current.initialX + dx,
            y: dragStart.current.initialY + dy
        });
    };

    const handlePointerUp = () => {
        isDragging.current = false;
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
    };

    const segment = flowBlocks.find(b => b.id === node.segmentId);
    const segmentLabel = segment ? `${segment.name} (${segment.startFrame} - ${segment.endFrame})` : null;

    type ActionField = 'onCompleteActions' | 'onLoopCompleteActions' | 'onEntryActions' | 'onExitActions';

    const setActions = (field: ActionField, actions: StateMachineAction[]) => {
        updateSmNode(nodeId, { [field]: actions });
    };

    const addAction = (field: ActionField) => {
        const currentActions = node[field] || [];
        setActions(field, [...currentActions, {
            id: `act_${Math.random().toString(36).substr(2, 9)}`,
            type: 'SetInput',
            inputId: inputs[0]?.id || '',
            value: true
        }]);
    };

    const updateAction = (field: ActionField, actId: string, act: Partial<StateMachineAction>) => {
        const currentActions = node[field] || [];
        setActions(field, currentActions.map(a => a.id === actId ? { ...a, ...act } : a));
    };

    const deleteAction = (field: ActionField, actId: string) => {
        const currentActions = node[field] || [];
        setActions(field, currentActions.filter(a => a.id !== actId));
    };

    const inspectorContent = (
        <div
            className="fixed z-[9999] border border-white/[0.06] rounded-xl shadow-[0_24px_48px_rgba(0,0,0,0.6)] flex flex-col w-[300px] h-[580px] pointer-events-auto select-none overflow-hidden"
            style={{ background: 'var(--bg-panel)', left: pos.x, top: pos.y }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
        >
            {/* Header / Drag Handle */}
            <div
                onPointerDown={handlePointerDown}
                className="flex items-center justify-between px-5 py-4 border-b border-white/5 shrink-0 cursor-move active:cursor-grabbing hover:bg-white/[0.02] transition-colors"
            >
                <span className="text-sm font-bold text-white tracking-tight">{node.name} State</span>
                <div className="flex items-center gap-1.5 shrink-0">
                    <button className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 text-white/40 hover:text-accent transition-all active:scale-95">
                        <Play size={14} />
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); onClose(); }}
                        className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-all active:scale-95"
                    >
                        <X size={16} />
                    </button>
                </div>
            </div>

            {/* Scrollable Content */}
            <div
                ref={contentRef}
                className="flex-1 overflow-y-auto p-5 flex flex-col gap-6 scroll-smooth custom-scrollbar overscroll-contain"
                onPointerDown={e => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
            >
                {node.type === 'global' ? (
                    <div className="flex flex-col items-center text-center opacity-50 py-12">
                        <div className="w-12 h-12 rounded-full mb-6 bg-cyan-400/20 text-cyan-400 flex items-center justify-center shadow-[0_0_24px_rgba(34,211,238,0.2)]">
                            <div className="w-3 h-3 rounded-full bg-cyan-400" />
                        </div>
                        <h4 className="text-white text-sm font-bold mb-2">Global State</h4>
                        <p className="text-[11px] text-white/40 px-6 leading-relaxed">The global state applies transitions starting from anywhere in the machine.</p>
                    </div>
                ) : (
                    <>
                        {/* Segment Selection */}
                        <div className="flex flex-col gap-2">
                            <div className="text-[10px] text-muted uppercase tracking-widest pl-1">Configuration</div>
                            <div className="text-[12px] text-white/90 font-medium bg-white/5 px-4 py-3 rounded-xl border border-white/5 flex items-center justify-between hover:bg-white/[0.08] transition-colors cursor-pointer group">
                                {segmentLabel || 'Select Segment...'}
                                <div className="text-white/20 group-hover:text-white/40 transform scale-75">▼</div>
                            </div>
                        </div>

                        {/* Toggles Group */}
                        <div className="flex flex-col gap-5 bg-white/[0.02] p-4 rounded-lg border border-white/[0.06]">
                            {/* Autoplay */}
                            <div className="flex items-center justify-between">
                                <span className="text-[12px] font-semibold text-white/80">Autoplay</span>
                                <div
                                    onClick={(e) => { e.stopPropagation(); updateSmNode(nodeId, { autoplay: !node.autoplay }); }}
                                    className="cursor-pointer active:scale-95 transition-transform"
                                >
                                    {node.autoplay ? (
                                        <ToggleRight size={28} className="text-accent" />
                                    ) : (
                                        <ToggleLeft size={28} className="text-white/20" />
                                    )}
                                </div>
                            </div>

                            {/* Loop */}
                            <div className="flex items-center justify-between">
                                <span className="text-[12px] font-semibold text-white/80">Loop</span>
                                <div className="flex items-center gap-3">
                                    {!node.loop && (
                                        <select
                                            value={(node.loopCount === undefined ? 1 : node.loopCount).toString()}
                                            onChange={(e) => { e.stopPropagation(); updateSmNode(nodeId, { loopCount: parseInt(e.target.value) || 1 }); }}
                                            onClick={(e) => e.stopPropagation()}
                                            className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white/90 outline-none w-14 text-right font-mono appearance-none"
                                        >
                                            {[1, 2, 3, 4, 5, 10, 20, 50].map(v => (
                                                <option key={v} value={v.toString()}>{v}</option>
                                            ))}
                                        </select>
                                    )}
                                    <div
                                        onClick={(e) => { e.stopPropagation(); updateSmNode(nodeId, { loop: !node.loop }); }}
                                        className="cursor-pointer active:scale-95 transition-transform"
                                    >
                                        {node.loop ? (
                                            <ToggleRight size={28} className="text-accent" />
                                        ) : (
                                            <ToggleLeft size={28} className="text-white/20" />
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Enforce loops */}
                            <div className="flex items-center justify-between">
                                <div className="flex flex-col">
                                    <span className="text-[12px] font-semibold text-white/80">Enforce loops</span>
                                    <span className="text-[10px] text-white/30">State exits only after loops complete</span>
                                </div>
                                <div
                                    onClick={(e) => { e.stopPropagation(); updateSmNode(nodeId, { enforceLoops: !node.enforceLoops }); }}
                                    className="cursor-pointer active:scale-95 transition-transform"
                                >
                                    {node.enforceLoops ? (
                                        <ToggleRight size={28} className="text-accent" />
                                    ) : (
                                        <ToggleLeft size={28} className="text-white/20" />
                                    )}
                                </div>
                            </div>

                            {/* Mode */}
                            <div className="flex items-center justify-between">
                                <span className="text-[12px] font-semibold text-white/80">Mode</span>
                                <select
                                    value={node.mode || 'Forward'}
                                    onChange={(e) => { e.stopPropagation(); updateSmNode(nodeId, { mode: e.target.value as any }); }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-[11px] text-white/90 outline-none font-sans appearance-none hover:bg-white/10 transition-colors"
                                >
                                    <option value="Forward">Forward</option>
                                    <option value="Reverse">Reverse</option>
                                    <option value="PingPong">Ping Pong</option>
                                </select>
                            </div>

                            {/* Animation Speed */}
                            <div className="flex items-center justify-between">
                                <span className="text-[12px] font-semibold text-white/80">Animation Speed</span>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={node.speed ?? 1}
                                    onChange={(e) => { e.stopPropagation(); updateSmNode(nodeId, { speed: parseFloat(e.target.value) || 1 }); }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-[11px] text-white/90 outline-none w-16 text-right font-mono"
                                />
                            </div>

                            {/* Reset Playback */}
                            <div className="flex items-center justify-between">
                                <div className="flex flex-col">
                                    <span className="text-[12px] font-semibold text-white/80">Reset Playback</span>
                                    <span className="text-[10px] text-white/30">Start from segment beginning on entry</span>
                                </div>
                                <div
                                    onClick={(e) => { e.stopPropagation(); updateSmNode(nodeId, { resetPlayback: node.resetPlayback === false ? true : false }); }}
                                    className="cursor-pointer active:scale-95 transition-transform"
                                >
                                    {node.resetPlayback !== false ? (
                                        <ToggleRight size={28} className="text-accent" />
                                    ) : (
                                        <ToggleLeft size={28} className="text-white/20" />
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Action Lists */}
                        <div className="flex flex-col gap-6 pb-4">
                            <ActionList
                                title="On complete actions"
                                actions={node.onCompleteActions || []}
                                onAdd={() => addAction('onCompleteActions')}
                                onUpdate={(id, act) => updateAction('onCompleteActions', id, act)}
                                onDelete={(id) => deleteAction('onCompleteActions', id)}
                                inputs={inputs}
                            />

                            <ActionList
                                title="On loop complete actions"
                                actions={node.onLoopCompleteActions || []}
                                onAdd={() => addAction('onLoopCompleteActions')}
                                onUpdate={(id, act) => updateAction('onLoopCompleteActions', id, act)}
                                onDelete={(id) => deleteAction('onLoopCompleteActions', id)}
                                inputs={inputs}
                            />

                            <ActionList
                                title="Entry actions"
                                actions={node.onEntryActions || []}
                                onAdd={() => addAction('onEntryActions')}
                                onUpdate={(id, act) => updateAction('onEntryActions', id, act)}
                                onDelete={(id) => deleteAction('onEntryActions', id)}
                                inputs={inputs}
                            />

                            <ActionList
                                title="Exit actions"
                                actions={node.onExitActions || []}
                                onAdd={() => addAction('onExitActions')}
                                onUpdate={(id, act) => updateAction('onExitActions', id, act)}
                                onDelete={(id) => deleteAction('onExitActions', id)}
                                inputs={inputs}
                            />
                        </div>
                    </>
                )}
            </div>
        </div>
    );

    // Render using Portal to document.body
    if (typeof document === 'undefined') return null;
    return createPortal(inspectorContent, document.body);
}
