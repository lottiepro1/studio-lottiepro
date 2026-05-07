import { useCreatorStore } from '@/lib/creator/state/store';
import { Plus, Trash2, ArrowRight } from 'lucide-react';
import { GuardOperator } from '@/lib/creator/state/stateMachineSlice';

interface EdgeInspectorProps {
    edgeId: string;
}

export default function EdgeInspector({ edgeId }: EdgeInspectorProps) {
    const edge = useCreatorStore(state => state.stateMachine?.edges.find(e => e.id === edgeId));
    const nodes = useCreatorStore(state => state.stateMachine?.nodes) || [];
    const inputs = useCreatorStore(state => state.stateMachine?.inputs) || [];
    const updateSmEdge = useCreatorStore(state => state.updateSmEdge);

    if (!edge) return null;

    const sourceNode = nodes.find(n => n.id === edge.sourceId);
    const targetNode = nodes.find(n => n.id === edge.targetId);

    const addGuard = () => {
        if (inputs.length === 0) return;
        const newGuard = {
            id: Math.random().toString(36).substr(2, 9),
            inputId: inputs[0].id,
            operator: '==' as GuardOperator,
            value: inputs[0].type === 'Boolean' ? true : inputs[0].type === 'Number' ? 0 : ''
        };
        updateSmEdge(edgeId, { guards: [...edge.guards, newGuard] });
    };

    const updateGuard = (guardId: string, updates: any) => {
        updateSmEdge(edgeId, {
            guards: edge.guards.map(g => g.id === guardId ? { ...g, ...updates } : g)
        });
    };

    const deleteGuard = (guardId: string) => {
        updateSmEdge(edgeId, {
            guards: edge.guards.filter(g => g.id !== guardId)
        });
    };

    return (
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar flex flex-col gap-4">
            <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3 flex flex-col gap-3">
                <span className="text-[10px] uppercase tracking-widest text-muted mb-1">Transition</span>

                <div className="flex items-center gap-2 text-xs font-bold text-white/90">
                    <div className="px-2 py-1 bg-black/40 rounded border border-white/5 flex-1 text-center truncate">
                        {sourceNode?.name || 'Unknown'}
                    </div>
                    <ArrowRight size={14} className="text-white/30 shrink-0" />
                    <div className="px-2 py-1 bg-black/40 rounded border border-white/5 flex-1 text-center truncate">
                        {targetNode?.name || 'Unknown'}
                    </div>
                </div>
            </div>

            {/* Transition Settings */}
            <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3 flex flex-col gap-4">
                <span className="text-[10px] uppercase tracking-widest text-muted mb-1">Transition settings</span>

                {/* Exit Time */}
                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <div className="flex flex-col">
                            <span className="text-[11px] font-semibold text-white/80">Has Exit Time</span>
                            <span className="text-[9px] text-white/30 italic">Wait until frame/percent reached</span>
                        </div>
                        <button
                            onClick={() => updateSmEdge(edgeId, { hasExitTime: !edge.hasExitTime })}
                            className={`w-8 h-4 rounded-full transition-colors relative ${edge.hasExitTime ? 'bg-accent' : 'bg-white/10'}`}
                        >
                            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${edge.hasExitTime ? 'left-4.5' : 'left-0.5'}`} />
                        </button>
                    </div>

                    {edge.hasExitTime && (
                        <div className="flex items-center gap-2 mt-1">
                            <input
                                type="number"
                                value={edge.exitTime ?? 100}
                                onChange={(e) => updateSmEdge(edgeId, { exitTime: parseFloat(e.target.value) || 0 })}
                                className="bg-black/40 border border-white/10 rounded px-2 py-1 text-[11px] text-white/80 outline-none w-full font-mono"
                                placeholder="100"
                            />
                            <span className="text-[10px] text-white/40 font-bold">%</span>
                        </div>
                    )}
                </div>

                {/* Play from Current / Sync */}
                <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                        <span className="text-[11px] font-semibold text-white/80">Play from Current</span>
                        <span className="text-[9px] text-white/30 italic">Don't reset playhead on target</span>
                    </div>
                    <button
                        onClick={() => updateSmEdge(edgeId, { playFromCurrent: !edge.playFromCurrent })}
                        className={`w-8 h-4 rounded-full transition-colors relative ${edge.playFromCurrent ? 'bg-accent' : 'bg-white/10'}`}
                    >
                        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${edge.playFromCurrent ? 'left-4.5' : 'left-0.5'}`} />
                    </button>
                </div>
            </div>

            <div className="flex items-center justify-between mt-2">
                <span className="text-[10px] uppercase tracking-widest text-muted">Conditions</span>
                <button
                    onClick={addGuard}
                    disabled={inputs.length === 0}
                    className="w-5 h-5 flex items-center justify-center rounded hover:bg-accent/20 text-accent transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                >
                    <Plus size={14} />
                </button>
            </div>

            {inputs.length === 0 && (
                <div className="text-center py-4 px-4 bg-white/[0.02] border border-white/5 rounded-xl border-dashed">
                    <p className="text-xs text-white/30 font-medium">Create inputs first to add conditions.</p>
                </div>
            )}

            <div className="flex flex-col gap-2">
                {edge.guards.map(guard => {
                    const input = inputs.find(i => i.id === guard.inputId);

                    return (
                        <div key={guard.id} className="bg-white/[0.03] border border-white/5 rounded-lg p-3 flex flex-col gap-2 relative group">
                            <button
                                onClick={() => deleteGuard(guard.id)}
                                className="absolute top-2 right-2 w-5 h-5 flex items-center justify-center rounded text-white/20 hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-all z-10"
                            >
                                <Trash2 size={12} />
                            </button>

                            <div className="flex flex-col gap-1">
                                <span className="text-[9px] uppercase tracking-widest text-muted">Input variable</span>
                                <select
                                    value={guard.inputId}
                                    onChange={(e) => {
                                        const newInput = inputs.find(i => i.id === e.target.value);
                                        if (newInput) {
                                            updateGuard(guard.id, {
                                                inputId: newInput.id,
                                                value: newInput.type === 'Boolean' ? true : newInput.type === 'Number' ? 0 : ''
                                            });
                                        }
                                    }}
                                    className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-[10px] text-white/80 outline-none cursor-pointer"
                                >
                                    {inputs.map(i => (
                                        <option key={i.id} value={i.id}>{i.name} ({i.type})</option>
                                    ))}
                                </select>
                            </div>

                            {input && input.type !== 'Trigger' && (
                                <div className="grid grid-cols-2 gap-2 mt-1">
                                    <div className="flex flex-col gap-1">
                                        <span className="text-[9px] uppercase tracking-widest text-muted">Operator</span>
                                        <select
                                            value={guard.operator}
                                            onChange={(e) => updateGuard(guard.id, { operator: e.target.value as GuardOperator })}
                                            className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-[10px] text-white/80 outline-none cursor-pointer text-center font-mono font-bold"
                                        >
                                            <option value="==">==</option>
                                            <option value="!=">!=</option>
                                            {input.type === 'Number' && (
                                                <>
                                                    <option value=">">&gt;</option>
                                                    <option value="<">&lt;</option>
                                                    <option value=">=">&gt;=</option>
                                                    <option value="<=">&lt;=</option>
                                                </>
                                            )}
                                        </select>
                                    </div>

                                    <div className="flex flex-col gap-1">
                                        <span className="text-[9px] uppercase tracking-widest text-muted">Value</span>
                                        {input.type === 'Boolean' ? (
                                            <select
                                                value={guard.value.toString()}
                                                onChange={(e) => updateGuard(guard.id, { value: e.target.value === 'true' })}
                                                className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-[10px] text-white/80 outline-none cursor-pointer font-bold"
                                            >
                                                <option value="true">True</option>
                                                <option value="false">False</option>
                                            </select>
                                        ) : input.type === 'Number' ? (
                                            <input
                                                type="number"
                                                value={guard.value as number}
                                                onChange={(e) => updateGuard(guard.id, { value: parseFloat(e.target.value) || 0 })}
                                                className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 h-[26px] text-[10px] text-white/80 outline-none focus:border-accent/50 text-center font-mono"
                                            />
                                        ) : (
                                            <input
                                                type="text"
                                                value={guard.value as string}
                                                onChange={(e) => updateGuard(guard.id, { value: e.target.value })}
                                                className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 h-[26px] text-[10px] text-white/80 outline-none focus:border-accent/50"
                                            />
                                        )}
                                    </div>
                                </div>
                            )}

                            {input && input.type === 'Trigger' && (
                                <div className="mt-1 px-2 py-1.5 bg-accent/10 border border-accent/20 rounded text-[10px] text-accent text-center font-bold">
                                    Fires on trigger
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
