import React from 'react';
import { StateMachineAction } from '@/lib/creator/state/stateMachineSlice';
import { Trash2 } from 'lucide-react';

interface ActionEditorProps {
    action: StateMachineAction;
    inputs: any[];
    onUpdate: (updates: Partial<StateMachineAction>) => void;
    onDelete?: () => void;
    readOnly?: boolean;
}

export function ActionEditor({ action, inputs, onUpdate, onDelete, readOnly }: ActionEditorProps) {
    const handleTypeChange = (type: any) => {
        if (readOnly) return;
        onUpdate({ type });
    };

    return (
        <div className="flex flex-col gap-2 bg-white/5 p-2 rounded border border-white/10 group relative mt-1">
            <div className="flex items-center gap-2">
                <select
                    value={action.type}
                    onChange={(e) => handleTypeChange(e.target.value)}
                    disabled={readOnly}
                    className="bg-black/40 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white/90 outline-none flex-1 font-bold cursor-pointer"
                >
                    <option value="SetInput">Set Input value</option>
                    <option value="FireEvent">Fire Event</option>
                    <option value="OpenURL">Open URL</option>
                    <option value="Toggle">Toggle Boolean</option>
                    <option value="Increment">Increment</option>
                    <option value="Decrement">Decrement</option>
                    <option value="Reset">Reset</option>
                    <option value="SetProgress">Set Progress</option>
                    <option value="SetFrame">Set Frame</option>
                    <option value="SetTheme">Set Theme</option>
                    <option value="FireCustomEvent">Fire Custom Event</option>
                </select>
                {onDelete && !readOnly && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onDelete(); }}
                        className="w-5 h-5 flex items-center justify-center rounded-md text-white/20 hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-all"
                    >
                        <Trash2 size={12} />
                    </button>
                )}
            </div>

            <div className="flex items-center gap-2 mt-1">
                {/* Depending on action type, show different fields */}

                {['SetInput', 'FireEvent', 'Toggle', 'Increment', 'Decrement', 'Reset'].includes(action.type) && (
                    <select
                        value={action.inputId || ''}
                        onChange={(e) => !readOnly && onUpdate({ inputId: e.target.value })}
                        disabled={readOnly}
                        className="bg-black/40 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white/80 outline-none flex-1 cursor-pointer"
                    >
                        <option value="">Select Input...</option>
                        {inputs.map((i: any) => {
                            // Filter inputs depending on action
                            if (action.type === 'FireEvent' && i.type !== 'Trigger') return null;
                            if (action.type === 'Toggle' && i.type !== 'Boolean') return null;
                            if ((action.type === 'Increment' || action.type === 'Decrement') && i.type !== 'Number') return null;
                            return <option key={i.id} value={i.id}>{i.name}</option>;
                        })}
                    </select>
                )}

                {action.type === 'SetInput' && (
                    <>
                        {inputs.find(i => i.id === action.inputId)?.type === 'Boolean' && (
                            <select
                                value={String(action.value)}
                                onChange={(e) => !readOnly && onUpdate({ value: e.target.value === 'true' })}
                                disabled={readOnly}
                                className="bg-black/40 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white/80 outline-none w-16"
                            >
                                <option value="true">True</option>
                                <option value="false">False</option>
                            </select>
                        )}
                        {inputs.find(i => i.id === action.inputId)?.type === 'Number' && (
                            <input
                                type="number"
                                value={action.value as number ?? 0}
                                onChange={(e) => !readOnly && onUpdate({ value: parseFloat(e.target.value) || 0 })}
                                disabled={readOnly}
                                className="w-16 bg-black/40 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white/80 outline-none text-right"
                            />
                        )}
                        {inputs.find(i => i.id === action.inputId)?.type === 'String' && (
                            <input
                                type="text"
                                value={action.value as string ?? ''}
                                onChange={(e) => !readOnly && onUpdate({ value: e.target.value })}
                                disabled={readOnly}
                                className="flex-1 bg-black/40 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white/80 outline-none"
                            />
                        )}
                        {inputs.find(i => i.id === action.inputId)?.type === 'Trigger' && (
                            <span className="text-[10px] text-white/40 font-mono py-1 px-1.5">= true</span>
                        )}
                    </>
                )}

                {['Increment', 'Decrement'].includes(action.type) && (
                    <input
                        type="number"
                        placeholder="Step"
                        value={action.value as number ?? 1}
                        onChange={(e) => !readOnly && onUpdate({ value: parseFloat(e.target.value) || 0 })}
                        disabled={readOnly}
                        className="w-16 bg-black/40 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white/80 outline-none text-right"
                    />
                )}

                {action.type === 'OpenURL' && (
                    <input
                        type="text"
                        placeholder="https://..."
                        value={action.url || ''}
                        onChange={(e) => !readOnly && onUpdate({ url: e.target.value })}
                        disabled={readOnly}
                        className="flex-1 bg-black/40 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white/80 outline-none"
                    />
                )}

                {['SetProgress', 'SetFrame'].includes(action.type) && (
                    <input
                        type="number"
                        placeholder={action.type === 'SetProgress' ? "0.0 - 1.0" : "Frame #"}
                        value={action.value as number ?? 0}
                        onChange={(e) => !readOnly && onUpdate({ value: parseFloat(e.target.value) || 0 })}
                        disabled={readOnly}
                        className="flex-1 bg-black/40 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white/80 outline-none"
                    />
                )}

                {action.type === 'SetTheme' && (
                    <input
                        type="text"
                        placeholder="Theme Name..."
                        value={action.value as string ?? ''}
                        onChange={(e) => !readOnly && onUpdate({ value: e.target.value })}
                        disabled={readOnly}
                        className="flex-1 bg-black/40 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white/80 outline-none"
                    />
                )}

                {action.type === 'FireCustomEvent' && (
                    <input
                        type="text"
                        placeholder="Event Name..."
                        value={action.eventName || ''}
                        onChange={(e) => !readOnly && onUpdate({ eventName: e.target.value })}
                        disabled={readOnly}
                        className="flex-1 bg-black/40 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white/80 outline-none"
                    />
                )}
            </div>
        </div>
    );
}
