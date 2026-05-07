import { useState } from 'react';
import { useCreatorStore } from '@/lib/creator/state/store';
import { Plus, Trash2, ArrowLeft } from 'lucide-react';
import EdgeInspector from './EdgeInspector';
import { InteractionEvent } from '@/lib/creator/state/stateMachineSlice';
import { ActionEditor } from './ActionEditor';
import { LayerSelector } from './LayerSelector';

export default function InputsPanel() {
    const inputs = useCreatorStore(state => state.stateMachine?.inputs) || [];
    const interactions = useCreatorStore(state => state.stateMachine?.interactions) || [];

    const addSmInput = useCreatorStore(state => state.addSmInput);
    const updateSmInput = useCreatorStore(state => state.updateSmInput);
    const deleteSmInput = useCreatorStore(state => state.deleteSmInput);

    const addSmInteraction = useCreatorStore(state => state.addSmInteraction);
    const updateSmInteraction = useCreatorStore(state => state.updateSmInteraction);
    const deleteSmInteraction = useCreatorStore(state => state.deleteSmInteraction);

    const selectedSmEdgeIds = useCreatorStore(state => state.selectedSmEdgeIds);
    const setSmEdgeSelection = useCreatorStore(state => state.setSmEdgeSelection);

    const [activeTab, setActiveTab] = useState<'inputs' | 'interactions'>('inputs');

    // Runtime state
    const smIsPlaying = useCreatorStore(state => state.smIsPlaying);
    const smVariables = useCreatorStore(state => state.smVariables);
    const setSmVariable = useCreatorStore(state => state.setSmVariable);

    const isEdgeSelected = selectedSmEdgeIds.length === 1;

    const clearSelection = () => {
        setSmEdgeSelection([]);
    };

    return (
        <div className="w-full h-full flex flex-col font-sans select-none border-l border-white/[0.06] relative" style={{ background: 'var(--bg-panel)' }}>
            <div className={`h-10 border-b border-white/[0.06] flex items-center px-3 shrink-0 ${isEdgeSelected ? 'gap-2 cursor-pointer hover:bg-hover' : ''}`} style={{ background: 'var(--bg-panel)' }} onClick={isEdgeSelected ? clearSelection : undefined}>
                {isEdgeSelected ? (
                    <>
                        <ArrowLeft size={14} className="text-white/40" />
                        <span className="text-xs font-medium text-secondary">
                            Transition Inspector
                        </span>
                    </>
                ) : (
                    <div className="flex items-center gap-4 w-full h-full">
                        <span
                            onClick={() => setActiveTab('inputs')}
                            className={`text-[11px] font-medium cursor-pointer h-full flex items-center border-b-2 transition-all ${activeTab === 'inputs' ? 'text-primary border-accent' : 'text-muted border-transparent hover:text-secondary'}`}
                        >
                            Inputs
                        </span>
                        <span
                            onClick={() => setActiveTab('interactions')}
                            className={`text-[11px] font-medium cursor-pointer h-full flex items-center border-b-2 transition-all ${activeTab === 'interactions' ? 'text-primary border-accent' : 'text-muted border-transparent hover:text-secondary'}`}
                        >
                            Interactions
                        </span>
                    </div>
                )}
            </div>

            {isEdgeSelected ? (
                <EdgeInspector edgeId={selectedSmEdgeIds[0]} />
            ) : (
                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                    {activeTab === 'inputs' ? (
                        <>
                            <div className="flex items-center justify-between mb-4">
                                <span className="text-[10px] uppercase tracking-widest text-muted">Inputs</span>
                                <button
                                    onClick={() => addSmInput({ name: 'New Input', type: 'Boolean', initialValue: false })}
                                    className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                                >
                                    <Plus size={14} />
                                </button>
                            </div>

                            {inputs.length === 0 ? (
                                <div className="text-center py-8 px-4 bg-white/[0.02] border border-white/5 rounded-xl border-dashed">
                                    <p className="text-xs text-white/30 font-medium">No inputs defined yet.</p>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-2">
                                    {inputs.map(input => (
                                        <div key={input.id} className="bg-white/[0.03] border border-white/5 rounded-lg p-3 flex flex-col gap-3 group relative">
                                            <div className="flex items-center justify-between gap-2">
                                                <input
                                                    type="text"
                                                    value={input.name}
                                                    onChange={(e) => !smIsPlaying && updateSmInput(input.id, { name: e.target.value })}
                                                    className="bg-transparent text-xs font-bold text-white/90 border-none outline-none focus:text-accent focus:ring-0 flex-1 min-w-0"
                                                    placeholder="Input Name"
                                                    disabled={smIsPlaying}
                                                />
                                                <button
                                                    onClick={() => deleteSmInput(input.id)}
                                                    className="w-5 h-5 flex items-center justify-center rounded text-white/20 hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-all"
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                            <div className="flex flex-col gap-1.5 bg-black/20 p-2 rounded border border-white/5">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-[9px] uppercase tracking-widest text-muted">Type</span>
                                                    <select
                                                        value={input.type}
                                                        onChange={(e) => !smIsPlaying && updateSmInput(input.id, { type: e.target.value as any })}
                                                        className="bg-transparent text-[10px] text-white/80 font-mono outline-none cursor-pointer"
                                                        disabled={smIsPlaying}
                                                    >
                                                        <option value="Boolean">Boolean</option>
                                                        <option value="Number">Number</option>
                                                        <option value="String">String</option>
                                                        <option value="Trigger">Trigger</option>
                                                    </select>
                                                </div>

                                                {input.type === 'Boolean' && (
                                                    <div className="flex items-center justify-between mt-1">
                                                        <span className="text-[9px] uppercase tracking-widest text-muted">{smIsPlaying ? 'Value' : 'Initial'}</span>
                                                        <button
                                                            onClick={() => smIsPlaying ? setSmVariable(input.id, !smVariables[input.id]) : updateSmInput(input.id, { initialValue: !input.initialValue })}
                                                            className={`w-8 h-4 rounded-full transition-colors relative ${(smIsPlaying ? smVariables[input.id] : input.initialValue) ? 'bg-accent' : 'bg-white/10'}`}
                                                        >
                                                            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${(smIsPlaying ? smVariables[input.id] : input.initialValue) ? 'left-4.5' : 'left-0.5'}`} />
                                                        </button>
                                                    </div>
                                                )}

                                                {input.type === 'Number' && (
                                                    <div className="flex items-center justify-between mt-1">
                                                        <span className="text-[9px] uppercase tracking-widest text-muted">{smIsPlaying ? 'Value' : 'Initial'}</span>
                                                        <input
                                                            type="number"
                                                            value={smIsPlaying ? (smVariables[input.id] || 0) : (input.initialValue as number || 0)}
                                                            onChange={(e) => smIsPlaying ? setSmVariable(input.id, parseFloat(e.target.value) || 0) : updateSmInput(input.id, { initialValue: parseFloat(e.target.value) || 0 })}
                                                            className="w-16 bg-black/40 border border-white/10 rounded px-1.5 py-0.5 text-[10px] text-white/80 font-mono outline-none focus:border-accent/50 text-right"
                                                        />
                                                    </div>
                                                )}

                                                {input.type === 'String' && (
                                                    <div className="flex flex-col gap-1 mt-1">
                                                        <span className="text-[9px] uppercase tracking-widest text-muted">{smIsPlaying ? 'Value' : 'Initial'}</span>
                                                        <input
                                                            type="text"
                                                            value={smIsPlaying ? (smVariables[input.id] || '') : (input.initialValue as string || '')}
                                                            onChange={(e) => smIsPlaying ? setSmVariable(input.id, e.target.value) : updateSmInput(input.id, { initialValue: e.target.value })}
                                                            className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-[10px] text-white/80 outline-none focus:border-accent/50"
                                                            placeholder="Empty string..."
                                                        />
                                                    </div>
                                                )}

                                                {/* Trigger testing button while playing */}
                                                {input.type === 'Trigger' && smIsPlaying && (
                                                    <div className="flex flex-col gap-1 mt-1">
                                                        <button
                                                            onClick={() => setSmVariable(input.id, true)}
                                                            className="w-full py-1 text-[10px] font-bold bg-hover hover:bg-active border border-white/[0.06] rounded text-accent active:scale-95 transition-transform text-[10px]"
                                                        >
                                                            Fire Trigger
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    ) : (
                        <>
                            <div className="flex items-center justify-between mb-4">
                                <span className="text-[10px] uppercase tracking-widest text-muted">Interactions {interactions.length}</span>
                                <button
                                    onClick={() => addSmInteraction({
                                        event: 'PointerEnter',
                                        layerId: '',
                                        actions: [{ id: `act_${Math.random().toString(36).substr(2, 9)}`, type: 'SetInput', inputId: inputs[0]?.id || '', value: true }]
                                    })}
                                    className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                                >
                                    <Plus size={14} />
                                </button>
                            </div>

                            {interactions.length === 0 ? (
                                <div className="text-center py-8 px-4 bg-white/[0.02] border border-white/5 rounded-xl border-dashed">
                                    <p className="text-xs text-white/30 font-medium">No interactions defined.</p>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-2">
                                    {interactions.map(int => (
                                        <div key={int.id} className="bg-white/[0.03] border border-white/5 rounded-lg p-3 flex flex-col gap-3 group relative">
                                            <div className="flex items-center justify-between gap-2">
                                                <select
                                                    value={int.event}
                                                    onChange={(e) => !smIsPlaying && updateSmInteraction(int.id, { event: e.target.value as InteractionEvent })}
                                                    className="bg-transparent text-xs font-bold text-white/90 border-none outline-none focus:text-accent flex-1 cursor-pointer"
                                                    disabled={smIsPlaying}
                                                >
                                                    <option value="Click" className="bg-[#121214] text-white">Click</option>
                                                    <option value="PointerEnter" className="bg-[#121214] text-white">Pointer Enter</option>
                                                    <option value="PointerExit" className="bg-[#121214] text-white">Pointer Exit</option>
                                                    <option value="PointerDown" className="bg-[#121214] text-white">Pointer Down</option>
                                                    <option value="PointerUp" className="bg-[#121214] text-white">Pointer Up</option>
                                                    <option value="PointerMove" className="bg-[#121214] text-white">Pointer Move</option>
                                                </select>
                                                <button
                                                    onClick={() => deleteSmInteraction(int.id)}
                                                    className="w-5 h-5 flex items-center justify-center rounded text-white/20 hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-all"
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>

                                            <div className="flex flex-col gap-1.5 bg-black/20 p-2 rounded border border-white/5">
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-[9px] uppercase tracking-widest text-muted">Layer Name</span>
                                                    <LayerSelector
                                                        value={int.layerId}
                                                        onChange={(layerId) => !smIsPlaying && updateSmInteraction(int.id, { layerId })}
                                                        disabled={smIsPlaying}
                                                    />
                                                </div>
                                            </div>

                                            <div className="flex flex-col gap-2 mt-2">
                                                <span className="text-[9px] uppercase tracking-widest text-muted mb-1">Actions</span>
                                                {int.actions.map(act => (
                                                    <ActionEditor
                                                        key={act.id}
                                                        action={act}
                                                        inputs={inputs}
                                                        onUpdate={(updates: any) => !smIsPlaying && updateSmInteraction(int.id, { actions: int.actions.map(a => a.id === act.id ? { ...a, ...updates } : a) })}
                                                        onDelete={() => !smIsPlaying && updateSmInteraction(int.id, { actions: int.actions.filter(a => a.id !== act.id) })}
                                                        readOnly={smIsPlaying}
                                                    />
                                                ))}
                                                <button
                                                    onClick={() => !smIsPlaying && updateSmInteraction(int.id, { actions: [...int.actions, { id: `act_${Math.random().toString(36).substr(2, 9)}`, type: 'SetInput', inputId: inputs[0]?.id || '', value: true }] })}
                                                    className="w-full flex justify-center py-1 mt-1 text-[10px] text-white/40 hover:text-white hover:bg-white/5 rounded transition-colors"
                                                    disabled={smIsPlaying}
                                                >
                                                    <Plus size={12} /> Add Action
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
