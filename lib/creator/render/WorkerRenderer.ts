/**
 * WorkerRenderer.ts — Bridge class that manages the Web Worker lifecycle.
 * 
 * If OffscreenCanvas is supported, it transfers canvas control to a Worker
 * and proxies render calls via postMessage. Otherwise, it falls back to
 * running CanvasRenderer directly on the main thread.
 * 
 * API matches CanvasRenderer so CanvasView can use it as a drop-in replacement.
 * 
 * Performance: Uses delta-based serialization — only sends changed/new nodes
 * to the Worker each frame instead of the entire Map. For complex files like
 * Quickwork.json (1645 nodes), this reduces per-frame postMessage overhead
 * from ~500KB to near-zero when only `currentTime` changes.
 */

import { CanvasRenderer } from './CanvasRenderer';
import { SceneNode } from '../state/sceneSlice';

export class WorkerRenderer {
    private worker: Worker | null = null;
    private fallbackRenderer: CanvasRenderer | null = null;
    private nodes: Map<string, SceneNode> = new Map();
    private useWorker: boolean = false;
    private canvas: HTMLCanvasElement;
    private transferred: boolean = false; // Guards against double-transfer

    // --- Delta tracking for efficient Worker messaging ---
    // Tracks the last nodes Map identity we sent to the worker.
    // If the identity hasn't changed, we skip serialization entirely.
    private lastSentNodesRef: Map<string, SceneNode> | null = null;
    private workerHasFullSnapshot: boolean = false;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;

        // Feature detection: OffscreenCanvas + transferControlToOffscreen
        if (
            typeof OffscreenCanvas !== 'undefined' &&
            typeof canvas.transferControlToOffscreen === 'function'
        ) {
            try {
                const offscreen = canvas.transferControlToOffscreen();
                this.transferred = true;

                // Create Worker using Next.js-compatible URL constructor pattern
                this.worker = new Worker(
                    new URL('./renderWorker', import.meta.url),
                    { type: 'module' }
                );

                // Transfer the OffscreenCanvas to the worker
                this.worker.postMessage(
                    { type: 'init', payload: { canvas: offscreen } },
                    [offscreen]
                );

                this.useWorker = true;
                console.log('🚀 WorkerRenderer: Off-main-thread rendering enabled');

                // Listen for messages from worker (e.g. fontLoaded notifications).
                this.worker.onmessage = (e: MessageEvent) => {
                    if (e.data?.type === 'fontLoaded') {
                        // Worker finished loading the font — trigger a re-render via a window event.
                        window.dispatchEvent(new CustomEvent('gf-worker-font-ready', { detail: e.data }));
                    }
                };
            } catch (err) {
                console.warn('⚠️ WorkerRenderer: Failed to initialize Worker, falling back to main thread', err);
                // Only attempt fallback if the canvas wasn't already transferred
                if (!this.transferred) {
                    this.initFallback(canvas);
                } else {
                    // Canvas was transferred but Worker failed — we're stuck.
                    // This shouldn't happen in practice, but log it clearly.
                    console.error('❌ WorkerRenderer: Canvas already transferred but Worker creation failed. Cannot recover.');
                }
            }
        } else {
            console.log('ℹ️ WorkerRenderer: OffscreenCanvas not supported, using main-thread rendering');
            this.initFallback(canvas);
        }
    }

    private initFallback(canvas: HTMLCanvasElement) {
        // Guard: cannot get context from a canvas whose control has been transferred
        if (this.transferred) {
            console.warn('⚠️ WorkerRenderer.initFallback: Canvas already transferred, cannot create fallback');
            return;
        }
        const ctx = canvas.getContext('2d');
        if (ctx) {
            this.fallbackRenderer = new CanvasRenderer(ctx);
        }
        this.useWorker = false;
    }

    // Serialize Map<string, SceneNode> to plain object for postMessage
    private serializeNodes(nodes: Map<string, SceneNode>): Record<string, SceneNode> {
        const obj: Record<string, SceneNode> = {};
        nodes.forEach((value, key) => {
            obj[key] = value;
        });
        return obj;
    }

    // Serialize a DOMMatrix to transferable plain object
    private serializeMatrix(m: DOMMatrix): { a: number; b: number; c: number; d: number; e: number; f: number } {
        return { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f };
    }

    /**
     * Load a font into the worker's FontFaceSet so it is usable by OffscreenCanvas.
     * On the main-thread fallback path this is a no-op (CSS @font-face handles it).
     * cssHref: the Google Fonts CSS URL whose @font-face rules define the font file URLs.
     */
    loadFont(family: string, cssHref: string) {
        if (this.useWorker && this.worker) {
            this.worker.postMessage({ type: 'loadFont', payload: { family, cssHref } });
        }
        // On the fallback (main thread) path, fonts are already available via CSS — no action needed.
    }

    /** Update the scene nodes reference */
    setNodes(nodes: Map<string, SceneNode>) {
        this.nodes = nodes;
        if (!this.useWorker && this.fallbackRenderer) {
            this.fallbackRenderer.setNodes(nodes);
        }
    }

    /** Render a frame */
    render(
        rootId: string | null,
        viewTransform: DOMMatrix = new DOMMatrix(),
        currentTime: number = 0,
        editingNodeId: string | null = null,
        textEditingId: string | null = null,
        selectedIds: string[] | null = null,
        skipLottieContent: boolean = false
    ) {
        if (this.useWorker && this.worker) {
            // --- Delta-based serialization ---
            // Only send the full node map when it actually changed.
            // During animation playback, only currentTime changes frame-to-frame;
            // the nodes Map reference stays the same (Zustand immutable updates only
            // create a new Map when the user edits something).
            const nodesChanged = this.nodes !== this.lastSentNodesRef;

            if (nodesChanged || !this.workerHasFullSnapshot) {
                // Full snapshot — needed on first frame or when nodes changed
                this.worker.postMessage({
                    type: 'render',
                    payload: {
                        nodes: this.serializeNodes(this.nodes),
                        rootId,
                        viewTransform: this.serializeMatrix(viewTransform),
                        currentTime,
                        editingNodeId,
                        textEditingId,
                        selectedIds,
                        skipLottieContent
                    }
                });
                this.lastSentNodesRef = this.nodes;
                this.workerHasFullSnapshot = true;
            } else {
                // Lightweight render — reuse existing nodes in the Worker
                this.worker.postMessage({
                    type: 'renderFrame',
                    payload: {
                        rootId,
                        viewTransform: this.serializeMatrix(viewTransform),
                        currentTime,
                        editingNodeId,
                        textEditingId,
                        selectedIds,
                        skipLottieContent
                    }
                });
            }
        } else if (this.fallbackRenderer) {
            this.fallbackRenderer.render(rootId, viewTransform, currentTime, editingNodeId, textEditingId, selectedIds, skipLottieContent);
        }
    }

    /** Resize the canvas (needed for Worker path since main thread can't resize OffscreenCanvas) */
    resize(width: number, height: number) {
        if (this.useWorker && this.worker) {
            this.worker.postMessage({
                type: 'resize',
                payload: { width, height }
            });
        } else if (!this.transferred) {
            // Fallback: canvas size is set directly by React in CanvasView
            this.canvas.width = width;
            this.canvas.height = height;
            // Re-get the context (resizing invalidates it) and recreate renderer
            const ctx = this.canvas.getContext('2d');
            if (ctx) {
                this.fallbackRenderer = new CanvasRenderer(ctx);
                this.fallbackRenderer.setNodes(this.nodes);
            }
        }
    }

    /** Clean up the Worker */
    dispose() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        this.fallbackRenderer = null;
    }
}
