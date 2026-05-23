'use client';

import { useEffect, useRef } from 'react';
import { DotLottie, type FrameEvent } from '@lottiefiles/dotlottie-web';
import { useCreatorStore } from '@/lib/creator/state/store';
import { LottieExporter } from '@/lib/creator/lottie/LottieExporter';
import { playbackRef } from '@/lib/creator/state/playbackRef';
import { dotlottieRef as sharedDotlottieRef } from '@/lib/creator/state/dotlottieRef';

interface Props {
  /** Width of the active artboard (animation natural width) */
  artboardWidth: number;
  /** Height of the active artboard (animation natural height) */
  artboardHeight: number;
  /** Editor viewport zoom (0.37 = 37%) */
  viewportZoom: number;
  /** Editor viewport pan in world units */
  viewportPan: { x: number; y: number };
  /** Canvas container width in CSS pixels */
  containerWidth: number;
  /** Canvas container height in CSS pixels */
  containerHeight: number;
  /** Whether the ThorVG canvas is visible */
  visible: boolean;
  /** When true the canvas stays in the DOM (so setFrame() keeps running) but is invisible.
   *  Used during path/text editing so Canvas2D can show live edits without ThorVG covering them. */
  transparent?: boolean;
}

// Clamp zoom for canvas sizing — avoid creating excessively large textures
const MAX_CANVAS_ZOOM = 8;

/**
 * Renders all animation content via ThorVG (through @lottiefiles/dotlottie-web WASM).
 * Sits above the Canvas2D layer (z-21 vs z-20) and is always visible — hiding the canvas
 * while a reload is in progress causes the WASM renderer to skip setFrame(), leaving a
 * blank canvas when the element reappears. Keeping it always visible guarantees every
 * setFrame() call commits a real frame to the GPU.
 *
 * Canvas2D (z-20) handles editor chrome only (selection handles, guides, grid). It yields
 * all artboard-level content to ThorVG via skipLottieContent=true in CanvasRenderer.
 *
 * lottieNeedsReload: signals that ThorVG is mid-reload (hit testing falls back to Canvas2D
 * matrix math during the brief WASM load window). Does NOT control canvas visibility.
 *
 * Export cache: LottieExporter.export() is called at most once per unique updateCounter value.
 * Load cache: if ThorVG already has the latest data loaded (debounced sync pre-loaded it),
 * play-start skips dl.load() entirely and calls dl.play() directly — zero WASM reload cost.
 *
 * sharedDotlottieRef: the active DotLottie instance is published here so SelectionOverlay
 * can call getLayerBoundingBox() for pixel-perfect bbox coordinates.
 */
export function DotLottiePlayback({
  artboardWidth,
  artboardHeight,
  viewportZoom,
  viewportPan,
  containerWidth,
  containerHeight,
  visible,
  transparent = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dotLottieRef = useRef<DotLottie | null>(null);
  const isInitialized = useRef(false);
  // True once the first 'load' event has ever fired — never reset to false.
  // The debounced effect uses this to distinguish "ThorVG never started" (skip timer)
  // from "ThorVG mid-reload" (should still schedule the next reload).
  const wasEverInitialized = useRef(false);
  // True when the in-flight dl.load() used fresh LottieExporter output (slow path or init).
  // False for fast-path loads that reload from the existing lottieModel.
  // The 'load' event only calls setLottieModel when this is true — fast-path loads must NOT
  // overwrite lottieModel because patchLottieNode may have advanced it to a newer version
  // between the dl.load() call and the load event firing.
  const pendingLoadIsFreshExport = useRef(false);
  // When true, the 'load' event should immediately start playback (after a dl.load() hot-swap)
  const pendingPlay = useRef(false);
  // Throttle Zustand setCurrentTime to ~8fps during playback.
  const lastZustandUpdateMs = useRef(0);
  // Debounce timer for live sync
  const liveReloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Snapshot overlay: img element shown during dl.load() to hide the ThorVG flash
  const overlayImgRef = useRef<HTMLImageElement | null>(null);
  // rAF used to hide the overlay exactly one frame after ThorVG commits the new frame
  const afterLoadRafRef = useRef<number | null>(null);

  // --- Export / load caches (Tier 2) ---
  // exportCache: last LottieExporter output, keyed by updateCounter + activeArtboardId.
  // activeArtboardId is part of the key because switching artboards changes which artboard
  // is the Lottie root — the same updateCounter with a different artboardId is a different export.
  const exportCache = useRef<{ counter: number; artboardId: string | null; data: Record<string, unknown> } | null>(null);
  // Which updateCounter value is currently loaded in ThorVG (set in 'load' event handler)
  const lastLoadedCounter = useRef<number>(-1);
  // Which updateCounter we sent to dl.load() most recently (captures the value before load fires)
  const pendingLoadCounter = useRef<number>(-1);
  // Phase 4.7: structureChangeCounter at the time of the last full LottieExporter.export() load.
  // When structureChangeCounter hasn't changed, surgical patches keep lottieModel current and
  // DotLottiePlayback can reload from lottieModel directly — skipping LottieExporter entirely.
  const lastStructureCounter = useRef<number>(-1);
  // childUpdateCounter at last full re-export. When it has advanced, a child-of-group node
  // was edited (patchLottieNode skips these) and lottieModel is stale — must use slow path.
  const lastChildUpdateCounter = useRef<number>(-1);
  // Which activeArtboardId was in effect when ThorVG last finished loading. Switching artboards
  // without any node edits leaves updateCounter unchanged, so lastLoadedCounter alone can't
  // detect the change — the early-exit guard must also compare artboard IDs.
  const lastLoadedArtboardId = useRef<string | null>(null);

  const rawAnimationSource = useCreatorStore(s => s.rawAnimationSource);
  const isPlaying = useCreatorStore(s => s.isPlaying);
  const isLooping = useCreatorStore(s => s.isLooping);
  const currentTime = useCreatorStore(s => s.currentTime);
  const updateCounter = useCreatorStore(s => s.updateCounter);
  const structureChangeCounter = useCreatorStore(s => s.structureChangeCounter);
  const childUpdateCounter = useCreatorStore(s => s.childUpdateCounter);

  const dprRef = useRef(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  // Track last zoom used to size the canvas so we only resize when it actually changes
  const lastCanvasZoomRef = useRef<number>(0);

  // Capture the current ThorVG frame to an <img> overlay so the canvas appears frozen
  // (rather than flashing through frame-0 then frame-1) while WASM rebuilds the scene.
  const showSnapshotOverlay = () => {
    const canvas = canvasRef.current;
    const overlay = overlayImgRef.current;
    if (!canvas || !overlay) return;
    try {
      const dataUrl = canvas.toDataURL();
      // 'data:,' is what browsers return for a blank/uninitialized canvas — skip it
      if (dataUrl && dataUrl !== 'data:,') {
        overlay.src = dataUrl;
        overlay.style.display = 'block';
      }
    } catch {
      // Canvas may be unreadable (cross-origin content or WebGL without preserveDrawingBuffer).
      // Silent failure is fine — the load still happens, just without the seamless overlay.
    }
  };

  // Hide the overlay one rAF after setFrame() so ThorVG has committed the new frame to the
  // GPU before we remove the overlay. Removing it any earlier risks showing a blank canvas.
  const hideSnapshotOverlay = () => {
    if (afterLoadRafRef.current !== null) cancelAnimationFrame(afterLoadRafRef.current);
    afterLoadRafRef.current = requestAnimationFrame(() => {
      afterLoadRafRef.current = null;
      if (overlayImgRef.current) overlayImgRef.current.style.display = 'none';
    });
  };

  const makeDlConfig = () => ({
    autoplay: false,
    loop: isLooping,
    speed: 1,
    layout: { fit: 'fill' as const, align: [0, 0] as [number, number] },
    renderConfig: { devicePixelRatio: dprRef.current },
  });

  // Returns cached export data if counter AND activeArtboardId both match, otherwise re-exports.
  // activeArtboardId controls which artboard is the Lottie root — a different artboard with
  // the same updateCounter still requires a fresh export.
  const getExportedData = (counter: number, artboardId: string | null): Record<string, unknown> => {
    if (exportCache.current?.counter === counter && exportCache.current?.artboardId === artboardId) {
      return exportCache.current.data;
    }
    const state = useCreatorStore.getState();
    const data = LottieExporter.export(
      state.nodes, state.fps, state.duration, state.flowBlocks ?? [], artboardId ?? undefined
    ) as unknown as Record<string, unknown>;
    exportCache.current = { counter, artboardId, data };
    return data;
  };

  // Initialize (or re-initialize) when the source animation or artboard dimensions change.
  // Works for both imported animations (rawAnimationSource set) and from-scratch designs
  // (rawAnimationSource null — initial data comes from LottieExporter.export()).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      isInitialized.current = false;
      sharedDotlottieRef.current = null;
      return;
    }

    if (dotLottieRef.current) {
      dotLottieRef.current.destroy();
      dotLottieRef.current = null;
      sharedDotlottieRef.current = null;
    }

    // Reset caches — new animation means stale cached exports are invalid
    exportCache.current = null;
    pendingLoadCounter.current = -1;
    lastLoadedCounter.current = -1;
    lastLoadedArtboardId.current = null;

    const dpr = dprRef.current;
    const clampedZoom = Math.min(viewportZoom, MAX_CANVAS_ZOOM);
    lastCanvasZoomRef.current = clampedZoom;
    canvas.width = Math.round(artboardWidth * dpr * clampedZoom);
    canvas.height = Math.round(artboardHeight * dpr * clampedZoom);

    // Prefer exported data over rawAnimationSource for the initial ThorVG load.
    //
    // Why: rawAnimationSource may contain Lottie formats that ThorVG renders correctly
    // but computes wrong bounds for (e.g. separated-position keyframes with "s":true that
    // have split X/Y). LottieExporter always normalises to combined [x,y,0] keyframes —
    // the format ThorVG's get_layer_bounds() handles correctly.
    //
    // This is the same approach LottieFiles uses: they never pass raw JSON straight to
    // ThorVG; they always pipe through their own export normalisation first.
    //
    // The debounced live-sync (updateCounter effect) would eventually do this re-export,
    // but it fires after 25 ms and exits early if ThorVG hasn't finished its WASM init by
    // then (isInitialized.current === false). Pre-exporting here closes that gap.
    let initialData: Record<string, unknown> | null = null;
    let initialCounter = -1;
    try {
      const st = useCreatorStore.getState();
      if (st.nodes.size > 0) {
        const counter = st.updateCounter;
        initialData = getExportedData(counter, st.activeArtboardId ?? null);  // also warms exportCache
        initialCounter = counter;
      } else if (rawAnimationSource) {
        initialData = rawAnimationSource as Record<string, unknown>;
      }
    } catch {
      if (rawAnimationSource) initialData = rawAnimationSource as Record<string, unknown>;
    }

    // Nothing to render yet (blank scene, no import) — wait for updateCounter to fire
    if (!initialData) {
      isInitialized.current = false;
      sharedDotlottieRef.current = null;
      return;
    }
    pendingLoadCounter.current = initialCounter;
    // Initial load always uses fresh exported data — setLottieModel should fire in load event.
    pendingLoadIsFreshExport.current = true;

    const dl = new DotLottie({
      canvas,
      data: initialData,
      ...makeDlConfig(),
    });

    // Publish to shared ref so SelectionOverlay can query getLayerBoundingBox()
    dotLottieRef.current = dl;
    sharedDotlottieRef.current = dl;

    dl.addEventListener('load', () => {
      isInitialized.current = true;
      wasEverInitialized.current = true;
      // Record which updateCounter is now live in ThorVG
      lastLoadedCounter.current = pendingLoadCounter.current;
      // Record which artboard was loaded — switching artboards with the same updateCounter
      // must not be skipped by the early-exit guard in the debounced effect.
      lastLoadedArtboardId.current = useCreatorStore.getState().activeArtboardId ?? null;
      // Phase 4.7: sync lastStructureCounter so the debounced effect knows the structure
      // that was in effect at the time of this load — enabling the fast path immediately.
      lastStructureCounter.current = useCreatorStore.getState().structureChangeCounter;

      // Force ThorVG to render: after dl.load(), its internal frame counter resets to 0.
      // Calling setFrame(0) is a no-op when ThorVG is already at frame 0 — the canvas stays
      // blank. Seeking to any non-zero frame first breaks ThorVG out of the "at start" state
      // and guarantees a real render call when we seek back to the target frame.
      const { currentTime: targetFrame, fps, duration } = useCreatorStore.getState();
      const totalFrames = fps * duration;
      if (targetFrame === 0 && totalFrames > 1) {
        dl.setFrame(1);
      }
      dl.setFrame(targetFrame);
      // New frame is now queued in ThorVG — hide the snapshot overlay one rAF later
      // so the GPU has flushed the new frame before we reveal the canvas.
      hideSnapshotOverlay();
      if (pendingPlay.current) {
        pendingPlay.current = false;
        dl.play();
      }
      useCreatorStore.getState().setLottieNeedsReload(false);
      // Phase 4.1: publish the loaded Lottie JSON to the store — but only for slow-path
      // (fresh LottieExporter output) loads. Fast-path loads reload from the existing
      // lottieModel; calling setLottieModel here would revert lottieModel to the snapshot
      // that was passed to dl.load(), discarding any patchLottieNode updates that ran
      // between the dl.load() call and this load event.
      if (pendingLoadIsFreshExport.current) {
        pendingLoadIsFreshExport.current = false;
        const loadedData = exportCache.current?.data ?? null;
        useCreatorStore.getState().setLottieModel(loadedData);
      }
    });

    dl.addEventListener('frame', (e: FrameEvent) => {
      if (!useCreatorStore.getState().isPlaying) return;

      playbackRef.frame = e.currentFrame;
      playbackRef.active = true;

      const now = performance.now();
      if (now - lastZustandUpdateMs.current < 120) return;
      lastZustandUpdateMs.current = now;
      useCreatorStore.getState().setCurrentTime(e.currentFrame);
    });

    dl.addEventListener('complete', () => {
      playbackRef.active = false;
      useCreatorStore.getState().setCurrentTime(playbackRef.frame);
      useCreatorStore.getState().setPlaying(false);
    });

    return () => {
      dl.destroy();
      isInitialized.current = false;
      pendingPlay.current = false;
      sharedDotlottieRef.current = null;
      useCreatorStore.getState().setLottieModel(null);
      if (liveReloadTimer.current) {
        clearTimeout(liveReloadTimer.current);
        liveReloadTimer.current = null;
      }
      if (afterLoadRafRef.current !== null) {
        cancelAnimationFrame(afterLoadRafRef.current);
        afterLoadRafRef.current = null;
      }
      if (overlayImgRef.current) overlayImgRef.current.style.display = 'none';
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawAnimationSource, artboardWidth, artboardHeight]);

  // Resize canvas when zoom changes — keeps ThorVG pixel-perfect at any zoom level
  useEffect(() => {
    const canvas = canvasRef.current;
    const dl = dotLottieRef.current;
    if (!canvas || !dl || !isInitialized.current) return;

    const clampedZoom = Math.min(viewportZoom, MAX_CANVAS_ZOOM);
    if (clampedZoom === lastCanvasZoomRef.current) return;
    lastCanvasZoomRef.current = clampedZoom;

    const dpr = dprRef.current;
    canvas.width = Math.round(artboardWidth * dpr * clampedZoom);
    canvas.height = Math.round(artboardHeight * dpr * clampedZoom);

    // ThorVG reads the new canvas dimensions automatically via resize()
    dl.resize();
    if (!useCreatorStore.getState().isPlaying) {
      dl.setFrame(useCreatorStore.getState().currentTime);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewportZoom, artboardWidth, artboardHeight]);

  // Sync loop setting
  useEffect(() => {
    dotLottieRef.current?.setLoop(isLooping);
  }, [isLooping]);

  // Respond to play/pause
  useEffect(() => {
    const dl = dotLottieRef.current;
    if (!dl) return;

    if (!isPlaying) {
      pendingPlay.current = false;
      playbackRef.active = false;
      if (isInitialized.current) {
        dl.pause();
        useCreatorStore.getState().setCurrentTime(playbackRef.frame);
      }
      return;
    }

    const currentCounter = useCreatorStore.getState().updateCounter;

    // Fast path: debounced sync already pre-loaded ThorVG with the latest data — just play.
    if (lastLoadedCounter.current === currentCounter && isInitialized.current) {
      dl.play();
      return;
    }

    // Slow path: export (cached if possible) and reload ThorVG before playing.
    try {
      const lottieData = getExportedData(currentCounter, useCreatorStore.getState().activeArtboardId ?? null);
      pendingPlay.current = true;
      pendingLoadCounter.current = currentCounter;
      isInitialized.current = false;
      pendingLoadIsFreshExport.current = true;
      showSnapshotOverlay();
      dl.load({ data: lottieData, ...makeDlConfig() });
      // dl.play() is called inside the 'load' event handler
    } catch (err) {
      console.warn('[DotLottiePlayback] Live sync failed, using original source:', err);
      pendingPlay.current = false;
      if (isInitialized.current) dl.play();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  // Debounced live sync — pre-loads ThorVG with current scene state while paused so that
  // play-start hits the fast path above and is instant.
  //
  // Guard: wasEverInitialized (not isInitialized) — isInitialized is false while a reload
  // is in progress, which would incorrectly drop structural changes (addNode) that fire
  // while a property-change reload is still completing. wasEverInitialized is set once on
  // the first 'load' event and never reset, so we only skip the timer before ThorVG has
  // ever been ready, not during subsequent mid-reload windows.
  useEffect(() => {
    const dl = dotLottieRef.current;
    if (!dl || !wasEverInitialized.current) return;

    if (liveReloadTimer.current) {
      clearTimeout(liveReloadTimer.current);
      liveReloadTimer.current = null;
    }

    // Structural changes (node added/removed) use 0ms delay so ThorVG has the new shape
    // data before the browser's next paint. Property-only changes use 25ms to batch
    // rapid slider/drag updates.
    const isStructural = structureChangeCounter !== lastStructureCounter.current;
    const delay = isStructural ? 0 : 25;

    liveReloadTimer.current = setTimeout(() => {
      liveReloadTimer.current = null;
      const state = useCreatorStore.getState();
      if (state.isPlaying) return;
      const dlCurrent = dotLottieRef.current;
      // Allow reload even when isInitialized=false (mid-previous-reload). dotlottie-web
      // handles overlapping load() calls gracefully — the new one supersedes the old.
      if (!dlCurrent) return;

      const currentCounter = state.updateCounter;
      const currentArtboardId = state.activeArtboardId ?? null;

      // ThorVG already has this exact artboard + data — nothing to do.
      // Must check artboardId too: switching artboards leaves updateCounter unchanged but
      // requires a full re-export with the new artboard as the Lottie root.
      if (lastLoadedCounter.current === currentCounter && lastLoadedArtboardId.current === currentArtboardId) return;

      const currentStructureCounter = state.structureChangeCounter;

      // Signal that ThorVG is reloading (hit testing falls back to Canvas2D matrix math
      // during the brief WASM load window). Cleared in the 'load' event handler.
      useCreatorStore.getState().setLottieNeedsReload(true);

      // Phase 4.7 — Fast path: structure unchanged, no child-of-group edits, lottieModel current.
      // patchLottieNode (steps 4.3–4.6) already updated lottieModel in-place for all
      // top-level property edits. Reload directly from lottieModel — zero LottieExporter cost.
      // Fast path is skipped when childUpdateCounter advanced: child-of-group edits bypass
      // patchLottieNode so lottieModel is stale and a full re-export is required.
      // exportCache is updated so the 'load' handler calls setLottieModel correctly.
      if (
        currentStructureCounter === lastStructureCounter.current &&
        state.childUpdateCounter === lastChildUpdateCounter.current &&
        state.lottieModel !== null &&
        lastLoadedCounter.current >= 0
      ) {
        try {
          const model = state.lottieModel as Record<string, unknown>;
          exportCache.current = { counter: currentCounter, artboardId: state.activeArtboardId ?? null, data: model };
          pendingPlay.current = false;
          pendingLoadCounter.current = currentCounter;
          isInitialized.current = false;
          // Fast path: reloading from existing lottieModel — do NOT let the load event
          // call setLottieModel, as patchLottieNode may advance lottieModel further
          // between now and when the load event fires.
          pendingLoadIsFreshExport.current = false;
          showSnapshotOverlay();
          dlCurrent.load({ data: model, ...makeDlConfig() });
        } catch (err) {
          console.warn('[DotLottiePlayback] Fast-path reload failed, falling back:', err);
          isInitialized.current = true;
          useCreatorStore.getState().setLottieNeedsReload(false);
        }
        return;
      }

      // Slow path: structural change or child-of-group edit — full re-export.
      lastStructureCounter.current = currentStructureCounter;
      lastChildUpdateCounter.current = state.childUpdateCounter;
      try {
        const lottieData = getExportedData(currentCounter, state.activeArtboardId ?? null);
        pendingPlay.current = false;
        pendingLoadCounter.current = currentCounter;
        isInitialized.current = false;
        // Slow path uses fresh LottieExporter output — setLottieModel should fire in load event.
        pendingLoadIsFreshExport.current = true;
        showSnapshotOverlay();
        dlCurrent.load({ data: lottieData, ...makeDlConfig() });
      } catch (err) {
        console.warn('[DotLottiePlayback] Live edit sync failed:', err);
        isInitialized.current = true;
        useCreatorStore.getState().setLottieNeedsReload(false);
      }
    }, delay);

    return () => {
      if (liveReloadTimer.current) {
        clearTimeout(liveReloadTimer.current);
        liveReloadTimer.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateCounter, structureChangeCounter, childUpdateCounter]);

  // Seek when user scrubs the timeline while paused
  useEffect(() => {
    const dl = dotLottieRef.current;
    if (!dl || !isInitialized.current || isPlaying) return;
    dl.setFrame(currentTime);
  }, [currentTime, isPlaying]);

  // Mirror the Canvas2D viewTransform: world (wx,wy) → canvas pixel (cw/2 + zoom*(pan.x+wx), ch/2 + zoom*(pan.y+wy)).
  // getWorldMatrix(artboard, rootId=artboard) returns identity — Canvas2D treats the artboard as world origin.
  // So ThorVG canvas top-left must be at (cw/2 + zoom*pan.x, ch/2 + zoom*pan.y), no artboard offset added.
  const tx = containerWidth / 2 + viewportZoom * viewportPan.x;
  const ty = containerHeight / 2 + viewportZoom * viewportPan.y;
  const cssWidth = artboardWidth * viewportZoom;
  const cssHeight = artboardHeight * viewportZoom;

  return (
    <>
      {/* Snapshot overlay: displays the last good ThorVG frame while WASM rebuilds the scene,
          eliminating the frame-0 → frame-1 → target flash visible during dl.load(). Hidden by
          default; shown imperatively in showSnapshotOverlay() and hidden in hideSnapshotOverlay(). */}
      <img
        ref={overlayImgRef}
        alt=""
        aria-hidden="true"
        style={{
          display: 'none',
          position: 'absolute',
          left: 0,
          top: 0,
          width: cssWidth,
          height: cssHeight,
          transform: `translate(${tx}px, ${ty}px)`,
          transformOrigin: '0 0',
          zIndex: 22,
          pointerEvents: 'none',
          imageRendering: 'auto',
        }}
      />
      <canvas
        ref={canvasRef}
        style={{
          // Keep display:block even when transparent so setFrame() keeps committing frames.
          // opacity:0 hides the canvas visually while allowing Canvas2D (z-20) to show through.
          display: visible ? 'block' : 'none',
          opacity: transparent ? 0 : 1,
          position: 'absolute',
          left: 0,
          top: 0,
          width: cssWidth,
          height: cssHeight,
          transform: `translate(${tx}px, ${ty}px)`,
          transformOrigin: '0 0',
          // z-21: above Canvas2D (z-20). ThorVG is always the sole renderer for animation content.
          // Canvas2D (z-20) handles editor chrome only; skipLottieContent skips all artboard shapes.
          zIndex: 21,
          pointerEvents: 'none',
          imageRendering: 'auto',
        }}
      />
    </>
  );
}
