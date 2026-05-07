import { useCreatorStore } from '@/lib/creator/state/store';
import React, { useEffect, useState, useRef } from 'react';
import StateNode from './StateNode';
import NodeInspector from './NodeInspector';

export default function StateMachinePanel() {
    const nodes = useCreatorStore(state => state.stateMachine?.nodes) || [];
    const edges = useCreatorStore(state => state.stateMachine?.edges) || [];
    const selectedNodes = useCreatorStore(state => state.selectedSmNodeIds);
    const selectedEdges = useCreatorStore(state => state.selectedSmEdgeIds);
    const initStateMachine = useCreatorStore(state => state.initStateMachine);
    const hasStateMachine = useCreatorStore(state => state.stateMachine !== null);

    // Initialize state machine if not present
    useEffect(() => {
        if (!hasStateMachine) {
            initStateMachine();
        }
    }, [hasStateMachine, initStateMachine]);

    const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
    const isPanning = useRef(false);
    const startPan = useRef({ x: 0, y: 0, viewX: 0, viewY: 0 });
    const panelRef = useRef<HTMLDivElement>(null);
    const [draftEdge, setDraftEdge] = useState<{ sourceId: string, currentX: number, currentY: number } | null>(null);
    const [popupNodeId, setPopupNodeId] = useState<string | null>(null);
    const [popupInitialPos, setPopupInitialPos] = useState({ x: 20, y: 20 });

    // Sync popup with node selection
    useEffect(() => {
        if (selectedNodes.length === 1) {
            const nodeId = selectedNodes[0];
            if (nodeId !== popupNodeId) {
                const selectedNode = nodes.find(n => n.id === nodeId);
                if (selectedNode && selectedNode.type !== 'global') {
                    setPopupNodeId(nodeId);

                    // Calculate position above the node in screen space
                    const panelRect = panelRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
                    const screenX = panelRect.left + (selectedNode.position.x * view.zoom + view.x);
                    const screenY = panelRect.top + (selectedNode.position.y * view.zoom + view.y);

                    setPopupInitialPos({
                        x: Math.max(20, Math.min(window.innerWidth - 340, screenX + (144 * view.zoom / 2) - 150)),
                        y: Math.max(20, Math.min(window.innerHeight - 600, screenY - 600))
                    });
                } else {
                    setPopupNodeId(null);
                }
            }
        } else {
            setPopupNodeId(null);
        }
    }, [selectedNodes, nodes, popupNodeId, view.x, view.y, view.zoom]);

    // State Machine Runtime Engine
    const smIsPlaying = useCreatorStore(state => state.smIsPlaying);
    const toggleSmPlaying = useCreatorStore(state => state.toggleSmPlaying);
    const lastTimeRef = useRef(performance.now());
    const animFrameRef = useRef<number>(0);
    const loopCounterRef = useRef<number>(0);
    const segmentCompletedRef = useRef<boolean>(false);
    const localTimeRef = useRef<number>(0); // SM's own playhead — never clamped

    // Helper: fire actions from a node's action list
    const fireActions = (actions: any[] | undefined, state: any) => {
        if (!actions || actions.length === 0) return;
        state.executeSmActions(actions);
    };

    useEffect(() => {
        if (!smIsPlaying) {
            if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
            loopCounterRef.current = 0;
            segmentCompletedRef.current = false;
            return;
        }

        lastTimeRef.current = performance.now();
        loopCounterRef.current = 0;
        segmentCompletedRef.current = false;
        // Clear the global transition latch on each play start
        (window as any).__sm_global_latch = {};

        // Initial playhead sync for the start node
        const initialState = useCreatorStore.getState();
        if (initialState.smActiveNodeId) {
            const initialNode = initialState.stateMachine?.nodes.find(n => n.id === initialState.smActiveNodeId);
            if (initialNode && initialNode.segmentId) {
                const block = initialState.flowBlocks.find(b => b.id === initialNode.segmentId);
                if (block) {
                    const targetTime = initialNode.mode === 'Reverse' ? block.endFrame : block.startFrame;
                    localTimeRef.current = targetTime;
                    initialState.setCurrentTime(targetTime);
                }
            }
        }

        const loop = (time: number) => {
            const state = useCreatorStore.getState();
            if (!state.smIsPlaying || !state.stateMachine) return;

            // CRITICAL: Always schedule the next frame FIRST, so exceptions can't kill the loop
            animFrameRef.current = requestAnimationFrame(loop);

            try {
                const delta = time - lastTimeRef.current;
                lastTimeRef.current = time;

                // Cap delta to avoid huge jumps when tab is backgrounded
                const cappedDelta = Math.min(delta, 100); // Max ~6fps worth of catch-up
                const rawDeltaFrames = (cappedDelta / 1000) * state.fps;

                // 0. Global Transition Latch
                if (!(window as any).__sm_global_latch) (window as any).__sm_global_latch = {};
                const globalLatch = (window as any).__sm_global_latch;

                const triggersToConsume = state.stateMachine.inputs
                    .filter(input => input.type === 'Trigger' && state.smVariables[input.id] === true)
                    .map(input => input.id);

                // 1. Advance Playhead within the current segment
                const activeNodeForPlayback = state.stateMachine.nodes.find(n => n.id === state.smActiveNodeId);
                let pendingPlaybackActions: any[] = [];
                let segmentJustCompleted = false;

                if (activeNodeForPlayback && activeNodeForPlayback.segmentId) {
                    const block = state.flowBlocks.find(b => b.id === activeNodeForPlayback.segmentId);
                    if (block) {
                        // Should we advance the playhead?
                        const shouldAdvance = activeNodeForPlayback.autoplay !== false || segmentCompletedRef.current || loopCounterRef.current > 0;

                        if (shouldAdvance && !segmentCompletedRef.current) {
                            let direction = 1;
                            if (activeNodeForPlayback.mode === 'Reverse') direction = -1;
                            if (activeNodeForPlayback.mode === 'PingPong') {
                                direction = (loopCounterRef.current % 2 === 0) ? 1 : -1;
                            }

                            const speed = activeNodeForPlayback.speed ?? 1;
                            const deltaFrames = rawDeltaFrames * speed * direction;
                            // Use localTimeRef for calculations — it's never clamped
                            let newPlayTime = localTimeRef.current + deltaFrames;

                            let reachedEnd = false;
                            if (direction > 0) {
                                if (newPlayTime >= block.endFrame) { reachedEnd = true; newPlayTime = block.endFrame; }
                            } else if (direction < 0) {
                                if (newPlayTime <= block.startFrame) { reachedEnd = true; newPlayTime = block.startFrame; }
                            }

                            if (reachedEnd) {
                                loopCounterRef.current++;
                                if (activeNodeForPlayback.onLoopCompleteActions) {
                                    pendingPlaybackActions.push(...activeNodeForPlayback.onLoopCompleteActions);
                                }

                                const shouldLoop = !!activeNodeForPlayback.loop ||
                                    (typeof activeNodeForPlayback.loopCount === 'number' && activeNodeForPlayback.loopCount > 1 && loopCounterRef.current < activeNodeForPlayback.loopCount);

                                if (shouldLoop) {
                                    // Reset to start of segment for the next loop iteration
                                    if (activeNodeForPlayback.mode === 'PingPong') { /* direction flips automatically via loopCounter */ }
                                    else if (direction >= 0) newPlayTime = block.startFrame;
                                    else newPlayTime = block.endFrame;
                                } else {
                                    // Segment truly completed, no more looping
                                    segmentJustCompleted = true;
                                    if (activeNodeForPlayback.onCompleteActions) {
                                        pendingPlaybackActions.push(...activeNodeForPlayback.onCompleteActions);
                                    }
                                }
                            }
                            localTimeRef.current = newPlayTime;
                            state.setCurrentTime(newPlayTime);
                        }
                    }
                }

                // 2. Evaluate Transitions
                const activeEdges = state.stateMachine.edges.filter(e => e.sourceId === state.smActiveNodeId);

                // Skip global transitions if current node is a Final node
                const isAtFinalState = activeNodeForPlayback?.isFinal === true;
                const globalEdges = isAtFinalState ? [] : state.stateMachine.edges.filter(e => {
                    const src = state.stateMachine?.nodes.find(n => n.id === e.sourceId);
                    return src?.type === 'global';
                });

                const edgesToEvaluate = [...activeEdges, ...globalEdges];
                let nextNodeId: string | null = null;
                let matchedEdge: any = null;

                for (const edge of edgesToEvaluate) {
                    if (edge.guards.length === 0 && edge.sourceId !== 'initial-state') continue;

                    let allGuardsPassed = true;
                    for (const guard of edge.guards) {
                        const input = state.stateMachine.inputs.find(i => i.id === guard.inputId);
                        if (!input) { allGuardsPassed = false; break; }

                        const actualValue = state.smVariables[input.id];
                        if (input.type === 'Trigger') {
                            if (actualValue !== true) { allGuardsPassed = false; break; }
                        } else {
                            const expectedValue = guard.value;
                            switch (guard.operator) {
                                case '==': allGuardsPassed = actualValue == expectedValue; break;
                                case '!=': allGuardsPassed = actualValue != expectedValue; break;
                                case '>': allGuardsPassed = Number(actualValue) > Number(expectedValue); break;
                                case '<': allGuardsPassed = Number(actualValue) < Number(expectedValue); break;
                                case '>=': allGuardsPassed = Number(actualValue) >= Number(expectedValue); break;
                                case '<=': allGuardsPassed = Number(actualValue) <= Number(expectedValue); break;
                            }
                        }
                        if (!allGuardsPassed) break;
                    }

                    // Global Guard Latch (supports all types now)
                    const sourceNode = state.stateMachine.nodes.find(n => n.id === edge.sourceId);
                    if (sourceNode?.type === 'global') {
                        const wasAlreadyPassing = globalLatch[edge.id] === true;
                        if (wasAlreadyPassing && allGuardsPassed) continue;
                        globalLatch[edge.id] = allGuardsPassed;
                    }

                    if (allGuardsPassed || (edge.sourceId === 'initial-state' && edge.guards.length === 0)) {
                        // Check Exit Time
                        if (allGuardsPassed && edge.hasExitTime && edge.sourceId === state.smActiveNodeId) {
                            const srcNode = state.stateMachine.nodes.find(n => n.id === edge.sourceId);
                            if (srcNode && srcNode.segmentId) {
                                const block = state.flowBlocks.find(b => b.id === srcNode.segmentId);
                                if (block) {
                                    const totalFrames = Math.abs(block.endFrame - block.startFrame) || 1;
                                    const currentOffset = Math.abs(state.currentTime - (srcNode.mode === 'Reverse' ? block.endFrame : block.startFrame));
                                    const progress = currentOffset / totalFrames;
                                    const exitThreshold = (edge.exitTime || 100) / 100;
                                    if (progress < exitThreshold - 0.001 && !segmentCompletedRef.current && !segmentJustCompleted) continue;
                                }
                            }
                        }
                        nextNodeId = edge.targetId;
                        matchedEdge = edge;

                        edge.guards.forEach(g => {
                            const input = state.stateMachine?.inputs.find(i => i.id === g.inputId);
                            if (input && input.type === 'Trigger') state.setSmVariable(input.id, false);
                        });
                        break;
                    }
                }

                // 3. State Transition or Process Deferred Actions
                if (nextNodeId && nextNodeId !== state.smActiveNodeId) {
                    const currentNode = state.stateMachine.nodes.find(n => n.id === state.smActiveNodeId);
                    if (currentNode) fireActions(currentNode.onExitActions, state);

                    // Fire playback actions (like the RESET) just before transition, so the guard already passed
                    if (pendingPlaybackActions.length > 0) fireActions(pendingPlaybackActions, state);

                    state.setSmActiveNode(nextNodeId);
                    loopCounterRef.current = 0;
                    segmentCompletedRef.current = false;

                    const targetNode = state.stateMachine.nodes.find(n => n.id === nextNodeId);
                    if (targetNode && targetNode.segmentId) {
                        fireActions(targetNode.onEntryActions, state);
                        const block = state.flowBlocks.find(b => b.id === targetNode.segmentId);
                        if (block) {
                            const isReverse = targetNode.mode === 'Reverse';
                            const targetTime = isReverse ? block.endFrame : block.startFrame;
                            const endTime = isReverse ? block.startFrame : block.endFrame;

                            const currentLocalTime = localTimeRef.current;
                            const isOutOfBounds = currentLocalTime > block.endFrame + 0.1 || currentLocalTime < block.startFrame - 0.1;
                            const isAtEnd = isReverse ? (currentLocalTime <= endTime + 0.1) : (currentLocalTime >= endTime - 0.1);
                            const shouldReset = isOutOfBounds || isAtEnd || ((targetNode.resetPlayback !== false) && (!matchedEdge || matchedEdge.playFromCurrent !== true));

                            // If autoplay is false, we don't jump to the start of the segment.
                            // This allows "hold" states where we stay at the last frame of the previous state.
                            const shouldJump = shouldReset && (targetNode.autoplay !== false);

                            if (shouldJump) {
                                localTimeRef.current = targetTime;
                                state.setCurrentTime(targetTime);
                            }
                        }
                    }
                } else {
                    // No transition, fire playback actions now
                    if (pendingPlaybackActions.length > 0) {
                        fireActions(pendingPlaybackActions, state);
                    }
                    if (segmentJustCompleted) segmentCompletedRef.current = true;
                }

                // 4. Trigger Consumption
                triggersToConsume.forEach(inputId => {
                    state.setSmVariable(inputId, false);
                });
            } catch (err) {
                console.error('[SM Engine] Error in loop tick:', err);
            }
        };
        animFrameRef.current = requestAnimationFrame(loop);
        return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
    }, [smIsPlaying]);

    const handlePortDragStart = (e: React.PointerEvent, nodeId: string) => {
        e.stopPropagation();

        const parentRect = e.currentTarget.closest('.outline-none')?.getBoundingClientRect();
        if (!parentRect) return;

        const startX = (e.clientX - parentRect.left - view.x) / view.zoom;
        const startY = (e.clientY - parentRect.top - view.y) / view.zoom;

        setDraftEdge({ sourceId: nodeId, currentX: startX, currentY: startY });

        const handleMove = (ev: PointerEvent) => {
            const newX = (ev.clientX - parentRect.left - view.x) / view.zoom;
            const newY = (ev.clientY - parentRect.top - view.y) / view.zoom;
            setDraftEdge(prev => prev ? { ...prev, currentX: newX, currentY: newY } : null);
        };

        const handleUp = (ev: PointerEvent) => {
            window.removeEventListener('pointermove', handleMove);
            window.removeEventListener('pointerup', handleUp);
            setDraftEdge(null);

            // Temporarily disable pointer events to hit test the underlying port
            const svgLayer = document.getElementById('sm-svg-layer');
            if (svgLayer) svgLayer.style.pointerEvents = 'none';

            const target = document.elementFromPoint(ev.clientX, ev.clientY);
            const inputPort = target?.closest('[data-sm-port="input"]');

            if (svgLayer) svgLayer.style.pointerEvents = 'auto';

            if (inputPort) {
                const targetId = inputPort.getAttribute('data-sm-node-id');
                if (targetId && targetId !== nodeId) {
                    useCreatorStore.getState().addSmEdge({ sourceId: nodeId, targetId, guards: [] });
                }
            }
        };

        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', handleUp);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Backspace' || e.key === 'Delete') {
            const state = useCreatorStore.getState();
            state.selectedSmNodeIds.forEach(id => state.deleteSmNode(id));
            state.selectedSmEdgeIds.forEach(id => state.deleteSmEdge(id));
        }
    };


    useEffect(() => {
        const panel = panelRef.current;
        if (!panel) return;

        const handleNativeWheel = (e: WheelEvent) => {
            e.preventDefault(); // Always prevent default to stop page zoom/scroll

            if (e.ctrlKey || e.metaKey) {
                // Zoom
                const zoomDelta = e.deltaY > 0 ? 0.97 : 1.03;
                setView(prev => ({ ...prev, zoom: Math.max(0.1, Math.min(5, prev.zoom * zoomDelta)) }));
            } else {
                // Pan
                setView(prev => ({ ...prev, x: prev.x - e.deltaX, y: prev.y - e.deltaY }));
            }
        };

        panel.addEventListener('wheel', handleNativeWheel, { passive: false });
        return () => panel.removeEventListener('wheel', handleNativeWheel);
    }, []);

    const handlePointerDown = (e: React.PointerEvent) => {
        if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
            // Middle, Right, or Alt+Left click to pan
            isPanning.current = true;
            startPan.current = { x: e.clientX, y: e.clientY, viewX: view.x, viewY: view.y };
            window.addEventListener('pointermove', handlePointerMove);
            window.addEventListener('pointerup', handlePointerUp);
        } else {
            // Deselect all
            useCreatorStore.getState().setSmNodeSelection([]);
        }
    };

    const handlePointerMove = (e: PointerEvent) => {
        if (!isPanning.current) return;
        const dx = e.clientX - startPan.current.x;
        const dy = e.clientY - startPan.current.y;
        setView({ ...view, x: startPan.current.viewX + dx, y: startPan.current.viewY + dy });
    };

    const handlePointerUp = () => {
        isPanning.current = false;
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
    };

    // Calculate background parameters
    const gridSize = 24 * view.zoom;
    const bgX = view.x % gridSize;
    const bgY = view.y % gridSize;

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();

        // Calculate drop coordinates relative to the canvas internal space
        const rect = e.currentTarget.getBoundingClientRect();
        const x = (e.clientX - rect.left - view.x) / view.zoom;
        const y = (e.clientY - rect.top - view.y) / view.zoom;
        const snappedPos = { x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10 };

        const nodeType = e.dataTransfer.getData('sm-node') as 'global' | 'initial' | 'final' | '';
        if (nodeType) {
            let name = 'State';
            if (nodeType === 'global') name = 'Global State';
            else if (nodeType === 'initial') name = 'Initial State';
            else if (nodeType === 'final') name = 'Final State';

            useCreatorStore.getState().addSmNode({
                type: nodeType,
                name: name,
                position: snappedPos,
                loop: false,
                autoplay: true,
                direction: 1
            });
            return;
        }

        const segmentId = e.dataTransfer.getData('lottiepro/segment-id');
        const segmentName = e.dataTransfer.getData('lottiepro/segment-name');

        if (!segmentId) return;

        useCreatorStore.getState().addSmNode({
            type: 'playback',
            name: segmentName,
            segmentId: segmentId,
            position: snappedPos,
            loop: true,
            autoplay: false,
            direction: 1
        });
    };

    return (
        <div ref={panelRef} className="w-full h-full bg-[#09090b] flex overflow-hidden border-t border-white/5 font-sans relative" onContextMenu={e => e.preventDefault()}>
            {/* Visual Canvas placeholder */}
            <div
                className="flex-1 relative overflow-hidden bg-[#121214] outline-none cursor-default active:cursor-move"
                onPointerDown={handlePointerDown}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onKeyDown={handleKeyDown}
                tabIndex={0}
            >
                {/* Scalable grid background */}
                <div
                    className="absolute inset-0 pointer-events-none opacity-20"
                    style={{
                        backgroundImage: 'radial-gradient(circle at center, white 1px, transparent 1px)',
                        backgroundSize: `${gridSize}px ${gridSize}px`,
                        backgroundPosition: `${bgX}px ${bgY}px`
                    }}
                />

                {/* Nodes & Edges Layer */}
                <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                        transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
                        transformOrigin: '0 0',
                    }}
                >
                    {/* SVG Layer for Edges */}
                    <svg id="sm-svg-layer" className="absolute inset-0 w-[4000px] h-[4000px] overflow-visible -left-[2000px] -top-[2000px] pointer-events-none z-0">
                        <defs>
                            <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                                <path d="M 0 0 L 10 5 L 0 10 z" fill="#0A84FF" opacity="0.8" />
                            </marker>
                            <marker id="arrow-draft" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                                <path d="M 0 0 L 10 5 L 0 10 z" fill="#888" opacity="0.8" />
                            </marker>
                        </defs>
                        <g transform="translate(2000, 2000)">
                            {edges.map(edge => {
                                const srcNode = nodes.find(n => n.id === edge.sourceId);
                                const tgtNode = nodes.find(n => n.id === edge.targetId);
                                if (!srcNode || !tgtNode) return null;

                                const x1 = srcNode.position.x + 144;
                                const y1 = srcNode.position.y + 26;
                                const x2 = tgtNode.position.x - 4;
                                const y2 = tgtNode.position.y + 26;

                                const tension = Math.max(Math.abs(x1 - x2) / 2, 50);
                                const path = `M ${x1} ${y1} C ${x1 + tension} ${y1}, ${x2 - tension} ${y2}, ${x2} ${y2}`;
                                const isSelected = selectedEdges?.includes(edge.id);

                                return (
                                    <path
                                        key={edge.id}
                                        d={path}
                                        fill="none"
                                        stroke={isSelected ? "#FFF" : "#0A84FF"}
                                        strokeWidth={isSelected ? "5" : "3"}
                                        opacity="0.8"
                                        markerEnd="url(#arrow)"
                                        className="transition-all hover:stroke-[5px] hover:stroke-white hover:opacity-100 cursor-pointer pointer-events-auto"
                                        onPointerDown={(e) => {
                                            e.stopPropagation();
                                            useCreatorStore.getState().setSmNodeSelection([]);
                                            useCreatorStore.getState().setSmEdgeSelection([edge.id]);
                                        }}
                                    />
                                );
                            })}

                            {draftEdge && (() => {
                                const srcNode = nodes.find(n => n.id === draftEdge.sourceId);
                                if (!srcNode) return null;
                                const x1 = srcNode.position.x + 144;
                                const y1 = srcNode.position.y + 26;
                                const tension = Math.max(Math.abs(x1 - draftEdge.currentX) / 2, 50);
                                const path = `M ${x1} ${y1} C ${x1 + tension} ${y1}, ${draftEdge.currentX - tension} ${draftEdge.currentY}, ${draftEdge.currentX} ${draftEdge.currentY}`;

                                return (
                                    <path
                                        d={path}
                                        fill="none"
                                        stroke="#888"
                                        strokeWidth="3"
                                        strokeDasharray="5,5"
                                        opacity="0.8"
                                        markerEnd="url(#arrow-draft)"
                                    />
                                );
                            })()}
                        </g>
                    </svg>

                    {/* Nodes Container */}
                    <div className="absolute inset-0 overflow-visible w-full h-full pointer-events-none z-10">
                        {nodes.map(node => (
                            <div key={node.id} className="pointer-events-auto absolute" style={{ left: 0, top: 0 }}>
                                <StateNode node={node} zoom={view.zoom} onPortDragStart={handlePortDragStart} />
                            </div>
                        ))}
                    </div>
                </div>

                {/* Floating Node Inspector Popup */}
                {popupNodeId && (
                    <NodeInspector
                        nodeId={popupNodeId}
                        initialPos={popupInitialPos}
                        onClose={() => {
                            setPopupNodeId(null);
                            useCreatorStore.getState().setSmNodeSelection([]);
                        }}
                    />
                )}

                {/* Minimap / Controls Overlay */}
                <div className="absolute bottom-4 right-4 flex flex-col gap-2 items-end">

                    {/* View Controls */}
                    <div className="flex border border-white/[0.06] rounded-lg p-1 pointer-events-auto shadow-xl" style={{ background: 'var(--bg-surface)' }}>
                        <button
                            className="w-8 h-8 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 rounded font-bold"
                            onClick={() => setView(prev => ({ ...prev, zoom: Math.max(0.1, prev.zoom - 0.2) }))}
                        >-</button>
                        <div className="w-12 h-8 flex items-center justify-center text-xs text-white/70 font-mono">
                            {Math.round(view.zoom * 100)}%
                        </div>
                        <button
                            className="w-8 h-8 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 rounded font-bold"
                            onClick={() => setView(prev => ({ ...prev, zoom: Math.min(5, prev.zoom + 0.2) }))}
                        >+</button>
                        <div className="w-px h-6 bg-white/10 mx-1 my-auto" />
                        <button
                            className="px-3 h-8 flex items-center justify-center text-xs text-white/50 hover:text-white hover:bg-white/10 rounded font-bold"
                            onClick={() => setView({ x: 50, y: 50, zoom: 1 })}
                        >Reset</button>
                    </div>
                </div>

                {/* State Node Adding Pills */}
                <div
                    onPointerDown={(e) => e.stopPropagation()}
                    className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 p-1.5 rounded-xl border border-white/[0.06] shadow-xl pointer-events-auto"
                    style={{ background: 'var(--bg-surface)' }}
                >
                    <div
                        onClick={() => {
                            if (selectedNodes.length === 1) {
                                useCreatorStore.getState().toggleSmInitialNode(selectedNodes[0]);
                            }
                        }}
                        className={`px-5 py-2.5 rounded-xl bg-[#263124] text-[10px] font-bold tracking-widest text-green-400 transition-colors ${selectedNodes.length === 1 ? 'cursor-pointer hover:bg-[#32452e] hover:text-green-300' : 'opacity-50 cursor-not-allowed'}`}
                    >
                        INITIAL STATE
                    </div>
                    <div
                        onClick={() => {
                            if (selectedNodes.length === 1) {
                                useCreatorStore.getState().toggleSmFinalNode(selectedNodes[0]);
                            }
                        }}
                        className={`px-5 py-2.5 rounded-xl bg-[#2f2238] text-[10px] font-bold tracking-widest text-purple-400 transition-colors ${selectedNodes.length === 1 ? 'cursor-pointer hover:bg-[#432d52] hover:text-purple-300' : 'opacity-50 cursor-not-allowed'}`}
                    >
                        FINAL STATE
                    </div>
                    <div draggable onDragStart={(e) => { e.dataTransfer.setData('sm-node', 'global'); }} className="px-5 py-2.5 rounded-xl bg-[#1e2e38] hover:bg-[#253e4d] text-[10px] font-bold tracking-widest text-cyan-400 hover:text-cyan-300 cursor-grab active:cursor-grabbing transition-colors">GLOBAL STATE</div>
                </div>
            </div>
        </div>
    );
}
