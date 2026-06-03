'use client';

import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useCreatorStore } from '@/lib/creator/state/store';
import { playbackRef } from '@/lib/creator/state/playbackRef';
import {
  Play, Pause, Square, ChevronLeft, ChevronRight, ChevronDown,
  Settings, Trash2, Timer, Repeat, Plus,
} from 'lucide-react';
import { SkipBack, Play as PhPlay, Pause as PhPause, SkipForward } from '@phosphor-icons/react';
import TimelineSidebarTrack from './TimelineSidebarTrack';
import TimelineKeyframeTrack from './TimelineKeyframeTrack';
import { SceneNode } from '@/lib/creator/state/sceneSlice';
import { getWorldMatrix, decomposeMatrix } from '@/lib/creator/core/Matrix';

// ── Design tokens (Figma design.bottom) ─────────────────────────────────────
const PANEL_BG      = '#2C2C2C';
const TAB_STRIP_BG  = '#383838';
const SIDEBAR_BD    = 'rgba(255,255,255,0.1)';
const RULER_BORDER  = '#444444';
const CONTROLS_BG   = '#383838';
const TEXT_COLOR    = '#FFFFFF';
const TEXT_DIM      = 'rgba(255,255,255,0.4)';
export default function TimelinePanel({ sidebarWidth = 320 }: { sidebarWidth?: number }) {
  const SIDEBAR_W = sidebarWidth;
  const nodes = useCreatorStore((state) => state.nodes);
  const selectedKeyframeIds = useCreatorStore((state) => state.selectedKeyframeIds);
  const selectKeyframes = useCreatorStore((state) => state.selectKeyframes);
  const trackVisibilityAll = useCreatorStore((state) => state.trackVisibility);
  const duration = useCreatorStore((state) => state.duration);
  const fps = useCreatorStore((state) => state.fps);
  const currentTime = useCreatorStore((state) => state.currentTime);
  const setCurrentTime = useCreatorStore((state) => state.setCurrentTime);
  const zoomLevel = useCreatorStore((state) => state.zoomLevel);
  const setZoomLevel = useCreatorStore((state) => state.setZoomLevel);
  const isPlaying = useCreatorStore((state) => state.isPlaying);
  const togglePlaying = useCreatorStore((state) => state.togglePlaying);
  const selectedIds = useCreatorStore((state) => state.selectedIds);
  const toggleTrackVisibility = useCreatorStore((state) => state.toggleTrackVisibility);
  const deleteSelectedKeyframes = useCreatorStore((state) => state.deleteSelectedKeyframes);
  const isLooping = useCreatorStore((state) => state.isLooping);
  const toggleLooping = useCreatorStore((state) => state.toggleLooping);
  const setFps = useCreatorStore((state) => state.setFps);
  const setDuration = useCreatorStore((state) => state.setDuration);
  const workAreaStart = useCreatorStore((state) => state.workAreaStart);
  const workAreaEnd = useCreatorStore((state) => state.workAreaEnd);
  const setWorkArea = useCreatorStore((state) => state.setWorkArea);
  const deleteNode = useCreatorStore((state) => state.deleteNode);
  const setSelection = useCreatorStore((state) => state.setSelection);
  const pushToHistory = useCreatorStore((state) => state.pushToHistory);
  const expandedNodes = useCreatorStore((state) => state.expandedNodes);
  const toggleNodeExpand = useCreatorStore((state) => state.toggleNodeExpand);
  const expandedShapeGroups = useCreatorStore((state) => state.expandedShapeGroups);
  const toggleShapeGroupExpand = useCreatorStore((state) => state.toggleShapeGroupExpand);
  const setActivePanel = useCreatorStore((state) => state.setActivePanel);
  const activeArtboardId = useCreatorStore((state) => state.activeArtboardId);
  const setActiveArtboard = useCreatorStore((state) => state.setActiveArtboard);
  const addFlowBlock = useCreatorStore((state) => state.addFlowBlock);
  const setActiveLayersTab = useCreatorStore((state) => state.setActiveLayersTab);
  const isTimelineCollapsed = useCreatorStore((state) => state.isTimelineCollapsed);
  const setTimelineCollapsed = useCreatorStore((state) => state.setTimelineCollapsed);

  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  type PickWhipState = {
    type: 'matte' | 'parent';
    sourceNodeId: string;
    startX: number; startY: number;
    currentX: number; currentY: number;
    targetNodeId: string | null;
  } | null;
  const [pickWhip, setPickWhip] = useState<PickWhipState>(null);
  const pickWhipLatest = useRef<PickWhipState>(null);
  pickWhipLatest.current = pickWhip;

  const applyPickWhip = useCallback((type: 'matte' | 'parent', sourceId: string, targetId: string) => {
    const state = useCreatorStore.getState();
    if (type === 'matte') {
      state.pushToHistory('Set Matte');
      state.setMatte(sourceId, targetId);
    } else {
      const storeNodes = state.nodes;
      const targetName = storeNodes.get(targetId)?.name ?? targetId;
      const targetIds = state.selectedIds.includes(sourceId) ? state.selectedIds : [sourceId];
      const ct = state.currentTime;

      // Pre-compute all transforms before pushToHistory mutates state
      const updates: Array<{ id: string; parentLayerId: string; transform: any }> = [];
      targetIds.forEach(id => {
        const n = storeNodes.get(id);
        if (!n || id === targetId) return;
        const childWorld = getWorldMatrix(id, storeNodes, ct);
        const parentWorld = getWorldMatrix(targetId, storeNodes, ct);
        const rel = parentWorld.inverse().multiply(childWorld);
        const decomp = decomposeMatrix(rel, { x: n.transform.anchorX, y: n.transform.anchorY });
        updates.push({
          id,
          parentLayerId: targetId,
          transform: { ...n.transform, x: decomp.x, y: decomp.y, rotation: decomp.rotation, scaleX: decomp.scaleX, scaleY: decomp.scaleY }
        });
      });

      state.pushToHistory(`Parent to ${targetName}`);
      updates.forEach(({ id, parentLayerId, transform }) => {
        state.updateNode(id, { parentLayerId, transform });
      });
    }
  }, []);

  const pickWhipActive = !!pickWhip;
  useEffect(() => {
    if (!pickWhipActive) return;

    const onMove = (e: MouseEvent) => {
      let targetId: string | null = null;
      const elements = document.elementsFromPoint(e.clientX, e.clientY);
      for (const el of elements) {
        const track = (el as HTMLElement).closest?.('[data-track-id]');
        if (track) {
          const id = track.getAttribute('data-track-id');
          if (id && id !== pickWhipLatest.current?.sourceNodeId) { targetId = id; break; }
        }
      }
      setPickWhip(prev => prev ? { ...prev, currentX: e.clientX, currentY: e.clientY, targetNodeId: targetId } : null);
    };

    const onUp = () => {
      const pw = pickWhipLatest.current;
      if (pw?.targetNodeId) applyPickWhip(pw.type, pw.sourceNodeId, pw.targetNodeId);
      setPickWhip(null);
      document.body.style.cursor = '';
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setPickWhip(null); document.body.style.cursor = ''; }
    };

    document.body.style.cursor = 'crosshair';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
      document.body.style.cursor = '';
    };
  }, [pickWhipActive]);

  const [marqueeRect, setMarqueeRect] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const [workAreaMenu, setWorkAreaMenu] = useState<{ x: number; y: number } | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(1000);

  const artboards = useMemo(() => Array.from(nodes.values()).filter(n => n.type === 'artboard'), [nodes]);

  const propertyGroups = useMemo(() => [
    { label: 'Position',      mainPath: 'transform.x',       props: [{ label: 'X', path: 'transform.x' }, { label: 'Y', path: 'transform.y' }] },
    { label: 'Size',          mainPath: 'props.width',        hasLink: true, props: [{ label: 'W', path: 'props.width' }, { label: 'H', path: 'props.height' }] },
    { label: 'Roundness',     mainPath: 'props.roundness',    props: [{ label: 'Radius', path: 'props.roundness' }] },
    { label: 'Scale',         mainPath: 'transform.scaleX',   hasLink: true, props: [{ label: 'X', path: 'transform.scaleX', isPercent: true }, { label: 'Y', path: 'transform.scaleY', isPercent: true }] },
    { label: 'Rotation',      mainPath: 'transform.rotation', props: [{ label: 'R', path: 'transform.rotation', isDegree: true }] },
    { label: 'Path',          mainPath: 'props.points',       props: [{ label: 'Path', path: 'props.points' }] },
    { label: 'Opacity',       mainPath: 'style.opacity',      props: [{ label: 'T', path: 'style.opacity', isPercent: true, min: 0, max: 1 }] },
    { label: 'Trim Start',    mainPath: 'style.trimStart',    props: [{ label: 'Start', path: 'style.trimStart', isPercent: true, min: 0, max: 1 }] },
    { label: 'Trim End',      mainPath: 'style.trimEnd',      props: [{ label: 'End', path: 'style.trimEnd', isPercent: true, min: 0, max: 1 }] },
    { label: 'Fill Color',    mainPath: 'style.fill',         props: [{ label: 'Fill', path: 'style.fill' }] },
    { label: 'Fill Gradient', mainPath: 'style.fillGradient', props: [{ label: 'Gradient', path: 'style.fillGradient' }] },
    { label: 'Fill Opacity',  mainPath: 'style.fillOpacity',  props: [{ label: 'Alpha', path: 'style.fillOpacity', isPercent: true, min: 0, max: 1 }] },
    { label: 'Stroke Color',  mainPath: 'style.stroke',       props: [{ label: 'Stroke', path: 'style.stroke' }] },
    { label: 'Stroke Gradient', mainPath: 'style.strokeGradient', props: [{ label: 'Gradient', path: 'style.strokeGradient' }] },
    { label: 'Stroke Width',  mainPath: 'style.strokeWidth',  props: [{ label: 'Width', path: 'style.strokeWidth' }] },
    { label: 'Stroke Opacity', mainPath: 'style.strokeOpacity', props: [{ label: 'Alpha', path: 'style.strokeOpacity', isPercent: true, min: 0, max: 1 }] },
    { label: 'Trim Offset',   mainPath: 'style.trimOffset',   props: [{ label: 'Offset', path: 'style.trimOffset', isDegree: true }] },
  ], []);

  const basePixelsPerFrame = 8;
  const pixelsPerFrame = basePixelsPerFrame * zoomLevel;
  const rowHeight = 28;
  const timelinePaddingLeft = 28;
  const RULER_HEIGHT = 40;

  const fmtTime = (frames: number) => {
    const s = Math.floor(frames / fps);
    const f = Math.round(frames % fps);
    return `${s}:${f.toString().padStart(2, '0')}`;
  };

  const timelineRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const needleLineRef = useRef<HTMLDivElement>(null);
  const needleHeadRef = useRef<HTMLDivElement>(null);
  const needleTimeRef = useRef<HTMLDivElement>(null);
  const rafIdRef = useRef<number | null>(null);

  // ── Zoom via wheel ────────────────────────────────────────────────────────
  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    const handler = (e: WheelEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.95 : 1.05;
        const containerWidth = timeline.clientWidth - timelinePaddingLeft - 40;
        const minPixelsPerFrame = containerWidth / (duration || 1);
        const minZoom = minPixelsPerFrame / basePixelsPerFrame;
        setZoomLevel(Math.max(minZoom, zoomLevel * delta));
      }
    };
    timeline.addEventListener('wheel', handler, { passive: false });
    return () => timeline.removeEventListener('wheel', handler);
  }, [zoomLevel, duration, setZoomLevel]);

  const fitTimeline = () => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    const containerWidth = timeline.clientWidth - timelinePaddingLeft - 80;
    if (containerWidth <= 0) return;
    setZoomLevel((containerWidth / (duration || 1)) / basePixelsPerFrame);
  };

  // ── Auto-fit on mount / resize ────────────────────────────────────────────
  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;

    // Resize only updates viewport width — never resets user zoom (avoids the
    // ResizeObserver feedback loop where scrollbar toggling fires doFit → zoom reset).
    const handleResize = () => {
      if (timeline.clientWidth > 0) setViewportWidth(timeline.clientWidth);
    };

    const handleScroll = () => {
      setScrollLeft(timeline.scrollLeft);
      if (sidebarRef.current) sidebarRef.current.scrollTop = timeline.scrollTop;
    };

    const handleSidebarScroll = () => {
      if (timelineRef.current) timelineRef.current.scrollTop = sidebarRef.current!.scrollTop;
    };

    // Fit to show full duration on mount and whenever duration changes.
    // Use a short delay so the panel has settled its final width.
    const timer = setTimeout(() => {
      const containerWidth = timeline.clientWidth - timelinePaddingLeft - 80;
      if (containerWidth <= 0) return;
      setViewportWidth(timeline.clientWidth);
      setZoomLevel((containerWidth / (duration || 1)) / basePixelsPerFrame);
    }, 50);

    const observer = new ResizeObserver(handleResize);
    observer.observe(timeline);
    timeline.addEventListener('scroll', handleScroll, { passive: true });
    sidebarRef.current?.addEventListener('scroll', handleSidebarScroll, { passive: true });
    const sidebar = sidebarRef.current;
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      timeline.removeEventListener('scroll', handleScroll);
      sidebar?.removeEventListener('scroll', handleSidebarScroll);
    };
  }, [duration]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      const key = e.key.toLowerCase();
      const propertyMap: Record<string, string> = { p: 'transform.x', s: 'transform.scaleX', r: 'transform.rotation', t: 'style.opacity', a: 'transform.anchorX', m: 'props.points', q: 'style.trimStart' };
      const state = useCreatorStore.getState();
      if (key === 'u' && state.activePanel === 'timeline') { e.preventDefault(); selectedIds.forEach(id => state.showAnimatedProperties(id)); return; }
      if (propertyMap[key] && state.activePanel === 'timeline') {
        e.preventDefault();
        selectedIds.forEach(id => {
          if (!nodes.get(id)) return;
          if (key === 's') toggleTrackVisibility(id, 'transform.scaleX');
          else if (key === 'q') { toggleTrackVisibility(id, 'style.trimStart'); toggleTrackVisibility(id, 'style.trimEnd'); toggleTrackVisibility(id, 'style.trimOffset'); }
          else toggleTrackVisibility(id, propertyMap[key]);
        });
      }
      if (key === 'b' && state.activePanel === 'timeline') { e.preventDefault(); const currentEnd = state.workAreaEnd ?? state.duration; state.setWorkArea(state.currentTime, Math.max(state.currentTime + 1, currentEnd)); }
      if (key === 'n' && state.activePanel === 'timeline') { e.preventDefault(); const currentStart = state.workAreaStart ?? 0; state.setWorkArea(Math.min(state.currentTime, currentStart), state.currentTime + 1); }
      if ((e.code === 'BracketLeft' || e.code === 'BracketRight') && state.activePanel === 'timeline') {
        e.preventDefault();
        const isLeft = e.code === 'BracketLeft';
        state.pushToHistory(e.altKey ? 'Trim Layer' : 'Shift Layer');
        state.selectedIds.forEach(id => {
          const node = state.nodes.get(id);
          if (!node || node.type === 'artboard') return;
          if (e.altKey) { if (isLeft) state.updateNode(id, { inPoint: Math.min(node.outPoint - 1, state.currentTime) }); else state.updateNode(id, { outPoint: Math.max(node.inPoint + 1, state.currentTime) }); }
          else { if (isLeft) state.shiftLayers([id], state.currentTime - node.inPoint); else state.shiftLayers([id], state.currentTime - node.outPoint); }
        });
      }
      if ((key === 'delete' || key === 'backspace') && state.activePanel === 'timeline') {
        if (selectedKeyframeIds.length > 0) { e.preventDefault(); deleteSelectedKeyframes(); }
        else if (selectedIds.length > 0) { e.preventDefault(); pushToHistory(`Delete ${selectedIds.length > 1 ? 'Selected Layers' : 'Layer'}`); selectedIds.forEach(id => deleteNode(id)); setSelection([]); }
      }
      if ((e.ctrlKey || e.metaKey) && key === 'c' && state.activePanel === 'timeline') {
        if (selectedKeyframeIds.length > 0) { e.preventDefault(); state.copyKeyframes(); }
        else if (selectedIds.length > 0) { e.preventDefault(); state.copySelection(); }
      }
      if ((e.ctrlKey || e.metaKey) && key === 'v' && state.activePanel === 'timeline') {
        if (state.keyframeClipboard.length > 0) { e.preventDefault(); state.pasteKeyframes(); }
        else if (state.clipboard.length > 0) { e.preventDefault(); state.pasteSelection(); }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, toggleTrackVisibility, selectedKeyframeIds, deleteSelectedKeyframes, togglePlaying, nodes]);

  // ── Scrubbing ─────────────────────────────────────────────────────────────
  const startScrubbing = (gridArea: HTMLElement, e: React.MouseEvent | MouseEvent) => {
    // Stop playback on ruler click/drag — matches AE behaviour.
    if (useCreatorStore.getState().isPlaying) {
      // Pre-set playbackRef.frame to the clicked position so that DotLottiePlayback's
      // isPlaying→false effect syncs currentTime to the right frame instead of
      // the last playing frame (which would override the clicked position).
      const rect = gridArea.getBoundingClientRect();
      const x = (e as MouseEvent).clientX - rect.left - timelinePaddingLeft;
      playbackRef.frame = Math.max(0, Math.min(duration - 1, Math.round(x / pixelsPerFrame)));
      useCreatorStore.getState().setPlaying(false);
    }
    const onMouseMove = (moveE: MouseEvent) => {
      const rect = gridArea.getBoundingClientRect();
      const x = moveE.clientX - rect.left - timelinePaddingLeft;
      setCurrentTime(Math.max(0, Math.min(duration - 1, Math.round(x / pixelsPerFrame))));
    };
    const onMouseUp = () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    onMouseMove(e as MouseEvent);
  };

  // ── Marquee selection ─────────────────────────────────────────────────────
  const startMarqueeSelection = (gridArea: HTMLElement, e: React.MouseEvent | MouseEvent) => {
    const rect = gridArea.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top;
    const isShift = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!isShift) selectKeyframes([]);
    const initialKeyframes = useCreatorStore.getState().selectedKeyframeIds;
    const onMouseMove = (moveE: MouseEvent) => {
      const currentX = moveE.clientX - rect.left;
      const currentY = moveE.clientY - rect.top;
      setMarqueeRect({ startX, startY, endX: currentX, endY: currentY });
      const minX = Math.min(startX, currentX) - timelinePaddingLeft;
      const maxX = Math.max(startX, currentX) - timelinePaddingLeft;
      const minY = Math.min(startY, currentY) - RULER_HEIGHT;
      const maxY = Math.max(startY, currentY) - RULER_HEIGHT;
      const minFrame = minX / pixelsPerFrame;
      const maxFrame = maxX / pixelsPerFrame;
      const newlySelected: string[] = [];
      let nextY = 0;
      sortedNodesData.forEach(({ node }) => {
        nextY += rowHeight;
        const trackVisibility = trackVisibilityAll[node.id] || [];
        const adaptedGroups = propertyGroups.map(group => {
          if (node.type === 'image') { const allowed = ['Position', 'Scale', 'Rotation', 'Opacity']; if (!allowed.includes(group.label)) return null; }
          if (group.label === 'Size') { if (node.type === 'ellipse') return { ...group, mainPath: 'props.radiusX', props: [{ path: 'props.radiusX' }, { path: 'props.radiusY' }] }; if (node.type !== 'rect' && node.type !== 'artboard' && node.type !== 'path') return null; }
          if (group.label === 'Path' && !(node.type === 'path' || node.type === 'rect' || node.type === 'ellipse')) return null;
          if (group.label.startsWith('Trim') && !(node.type === 'rect' || node.type === 'ellipse' || node.type === 'path' || node.type === 'group')) return null;
          if (group.label === 'Roundness' && node.type !== 'rect' && node.type !== 'path') return null;
          return group;
        }).filter(Boolean);
        const isExpanded = !!expandedNodes[node.id];
        const isSolo = trackVisibility.length > 0;
        const visibleGroups = isSolo ? adaptedGroups.filter((g: any) => g && trackVisibility.includes(g.mainPath)) : (isExpanded ? adaptedGroups : []);
        const getAnimatedGroups = (groups: any[]) => groups.filter(group => group.props.some((p: any) => !!node.animations?.[p.path]));
        const coreGroups = getAnimatedGroups(visibleGroups).filter((g: any) => ['Position', 'Scale', 'Rotation', 'Opacity'].includes(g.label));
        const shapeGroups = getAnimatedGroups(adaptedGroups).filter((g: any) => !['Position', 'Scale', 'Rotation', 'Opacity'].includes(g.label));
        const isShapeGroupExpanded = !!expandedShapeGroups[node.id];
        const processGroup = (group: any) => {
          if (!group) return;
          const rowTop = nextY; const rowBottom = nextY + rowHeight;
          if (rowBottom > minY && rowTop < maxY) {
            group.props.forEach((p: any) => { const kfs = node.animations?.[p.path] || []; kfs.forEach((kf: any) => { if (kf.time >= minFrame && kf.time <= maxFrame) newlySelected.push(`${node.id}:${p.path}:${kf.id}`); }); });
          }
          nextY += rowHeight;
        };
        if (isSolo) visibleGroups.forEach(processGroup);
        else if (isExpanded) {
          coreGroups.forEach(processGroup);
          if (shapeGroups.length > 0) { nextY += rowHeight; if (isShapeGroupExpanded) shapeGroups.forEach(processGroup); }
        }
      });
      selectKeyframes(isShift ? Array.from(new Set([...initialKeyframes, ...newlySelected])) : newlySelected, false);
    };
    const onMouseUp = () => { setMarqueeRect(null); window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // ── Layer selection ───────────────────────────────────────────────────────
  const handleLayerSelect = (nodeId: string, isShift: boolean, isCtrl: boolean) => {
    setActivePanel('timeline');
    const state = useCreatorStore.getState();
    const currentSelected = state.selectedIds;
    const lastSelected = state.lastSelectedId;
    if (isShift && lastSelected) {
      const allIds = sortedNodesData.map(d => d.node.id);
      const startIdx = allIds.indexOf(lastSelected);
      const endIdx = allIds.indexOf(nodeId);
      if (startIdx !== -1 && endIdx !== -1) {
        const min = Math.min(startIdx, endIdx);
        const max = Math.max(startIdx, endIdx);
        // Skip locked layers in range selections
        const nodesMap = useCreatorStore.getState().nodes;
        const range = allIds.slice(min, max + 1).filter(id => !nodesMap.get(id)?.locked);
        setSelection(isCtrl ? Array.from(new Set([...currentSelected, ...range])) : range);
        return;
      }
    }
    if (isCtrl) { if (currentSelected.includes(nodeId)) state.removeFromSelection(nodeId); else state.addToSelection(nodeId); }
    else setSelection([nodeId]);
  };

  const handleTimelineClick = (e: React.MouseEvent) => {
    const timelineRect = timelineRef.current?.getBoundingClientRect();
    if (!timelineRect) return;
    const relativeY = e.clientY - timelineRect.top;
    if (relativeY <= RULER_HEIGHT) {
      const gridArea = (e.currentTarget as HTMLElement).closest('[data-timeline-grid]') as HTMLElement;
      if (gridArea) startScrubbing(gridArea, e);
    } else {
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) { setSelection([]); selectKeyframes([]); }
      startMarqueeSelection(e.currentTarget as HTMLElement, e);
    }
  };

  const handleScrubberDrag = (e: React.MouseEvent) => {
    const gridArea = (e.currentTarget as HTMLElement).closest('[data-timeline-grid]') as HTMLElement;
    if (gridArea) startScrubbing(gridArea, e);
  };

  const handleWorkAreaDrag = (e: React.MouseEvent, type: 'start' | 'end') => {
    e.preventDefault(); e.stopPropagation();
    const gridArea = e.currentTarget.parentElement?.parentElement;
    if (!gridArea) return;
    const onMouseMove = (moveE: MouseEvent) => {
      const rect = gridArea.getBoundingClientRect();
      const targetFrame = Math.max(0, Math.min(useCreatorStore.getState().duration, Math.round((moveE.clientX - rect.left - timelinePaddingLeft) / pixelsPerFrame)));
      const state = useCreatorStore.getState();
      const currentStart = state.workAreaStart ?? 0;
      const currentEnd = state.workAreaEnd ?? state.duration;
      if (type === 'start') state.setWorkArea(Math.min(targetFrame, currentEnd), currentEnd);
      else state.setWorkArea(currentStart, Math.max(targetFrame, currentStart));
    };
    const onMouseUp = () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleWorkAreaContextMenu = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); setWorkAreaMenu({ x: e.clientX, y: e.clientY }); };

  useEffect(() => {
    if (!workAreaMenu) return;
    const close = () => setWorkAreaMenu(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [workAreaMenu]);

  // ── Playback loop ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying) return;
    let animationFrameId: number;
    let lastTime = performance.now();
    let frameAccumulator = 0;
    const loop = (now: number) => {
      const delta = now - lastTime; lastTime = now;
      frameAccumulator += (delta / 1000) * fps;
      if (frameAccumulator >= 1) {
        const framesToAdvance = Math.floor(frameAccumulator);
        frameAccumulator -= framesToAdvance;
        const state = useCreatorStore.getState();
        let nextTime = state.currentTime + framesToAdvance;
        const loopStart = state.workAreaStart ?? 0;
        const loopEnd = state.workAreaEnd ?? state.duration;
        if (nextTime >= loopEnd) {
          if (state.isLooping) { const ld = Math.max(1, loopEnd - loopStart); nextTime = loopStart + (nextTime - loopEnd) % ld; }
          else { nextTime = loopEnd - 1; state.setPlaying(false); }
        } else if (nextTime < loopStart) { nextTime = loopStart; }
        state.setCurrentTime(nextTime);
      }
      animationFrameId = requestAnimationFrame(loop);
    };
    animationFrameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationFrameId);
  }, [isPlaying, fps]);

  // ── Scene nodes sorted ────────────────────────────────────────────────────
  const sortedNodesData = useMemo(() => {
    const artboard = activeArtboardId ? nodes.get(activeArtboardId) : Array.from(nodes.values()).find(n => n.type === 'artboard');
    if (!artboard) return [];
    const result: { node: SceneNode; depth: number }[] = [];
    const seen = new Set<string>();
    const traverse = (nodeId: string, depth: number) => {
      if (seen.has(nodeId)) return;
      seen.add(nodeId);
      const node = nodes.get(nodeId);
      if (!node) return;
      if (node.type !== 'artboard') result.push({ node, depth });
      const isArtboard = node.type === 'artboard';
      const isExpanded = !!expandedNodes[nodeId];
      if (isArtboard || isExpanded) {
        const children = node.children || [];
        const nextDepth = isArtboard ? 0 : depth + 1;
        [...children].reverse().forEach(childId => traverse(childId, nextDepth));
      }
    };
    traverse(artboard.id, 0);
    return result;
  }, [nodes, expandedNodes, activeArtboardId]);

  const totalWidth = duration * pixelsPerFrame;

  const rulerTicks = useMemo(() => {
    const ticks = [];
    const targetSpacing = 80;
    const rawInterval = targetSpacing / pixelsPerFrame;
    const niceIntervals = [1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 1200, 1800, 3600];
    const frameInterval = niceIntervals.reduce((prev, curr) => Math.abs(curr - rawInterval) < Math.abs(prev - rawInterval) ? curr : prev);
    const startFrame = Math.max(0, Math.floor((scrollLeft - 400) / pixelsPerFrame));
    const endFrame = Math.min(duration, Math.ceil((scrollLeft + viewportWidth + 400) / pixelsPerFrame));
    for (let f = startFrame; f <= endFrame; f += frameInterval) ticks.push(f);
    return ticks;
  }, [duration, pixelsPerFrame, scrollLeft, viewportWidth]);

  const formatTime = (f: number) => {
    const s = Math.floor(f / fps);
    const frames = Math.round(f % fps);
    return frames === 0 ? `${s}s` : `${s}s ${frames}f`;
  };

  // ── rAF needle update ─────────────────────────────────────────────────────
  const needleMetaRef = useRef({ pixelsPerFrame, timelinePaddingLeft, fps });
  needleMetaRef.current = { pixelsPerFrame, timelinePaddingLeft, fps };

  useEffect(() => {
    const loop = () => {
      rafIdRef.current = requestAnimationFrame(loop);
      if (!playbackRef.active) return;
      const frame = playbackRef.frame;
      const { pixelsPerFrame: ppf, timelinePaddingLeft: tpl, fps: f } = needleMetaRef.current;
      const left = frame * ppf + tpl;
      if (needleLineRef.current) needleLineRef.current.style.left = `${left}px`;
      if (needleHeadRef.current) needleHeadRef.current.style.left = `${left - 18}px`;
      if (needleTimeRef.current) {
        const s = Math.floor(frame / f);
        const fr = Math.round(frame % f);
        needleTimeRef.current.textContent = fr === 0 ? `${s}s` : `${s}s ${fr}f`;
      }
    };
    rafIdRef.current = requestAnimationFrame(loop);
    return () => { if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
    <div className="w-full h-full flex flex-col overflow-hidden select-none" style={{ background: PANEL_BG }}>

      {/* ── Artboard tabs row ───────────────────────────────────────── */}
      <div
        className="shrink-0 flex items-center overflow-x-auto no-scrollbar"
        style={{ background: TAB_STRIP_BG, borderBottom: `1px solid ${SIDEBAR_BD}` }}
      >
        {/* Artboard tabs — each 241px wide (240 sidebar + 1px right border) */}
        {artboards.map(ab => (
          <button
            key={ab.id}
            onClick={() => setActiveArtboard(ab.id)}
            className="shrink-0 flex items-center justify-between transition-colors hover:opacity-80"
            style={{
              width: SIDEBAR_W + 1,
              padding: '7px 8px',
              borderRight: `1px solid ${SIDEBAR_BD}`,
              fontFamily: 'Inter, sans-serif',
              fontWeight: 450,
              fontSize: 11,
              color: TEXT_COLOR,
            }}
          >
            <span className="truncate">{ab.name}</span>
          </button>
        ))}

        {/* Add artboard button */}
        <button
          className="flex items-center justify-center transition-colors hover:opacity-70 shrink-0"
          style={{ padding: '8px 10px', color: TEXT_COLOR }}
          title="Add artboard"
        >
          <Plus size={14} />
        </button>

        {/* Collapse / expand toggle — far right */}
        <button
          onClick={() => setTimelineCollapsed(!isTimelineCollapsed)}
          className="ml-auto flex items-center justify-center shrink-0 transition-colors hover:opacity-70"
          style={{ padding: '8px 10px', color: TEXT_DIM }}
          title={isTimelineCollapsed ? 'Expand timeline' : 'Collapse timeline'}
        >
          {isTimelineCollapsed
            ? <ChevronRight className="w-3.5 h-3.5 -rotate-90" />
            : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* ── Main body: sidebar + scrollable track area ───────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Left Sidebar ────────────────────────────────────────────── */}
        <div
          className="shrink-0 flex flex-col overflow-hidden"
          style={{ width: SIDEBAR_W, background: PANEL_BG, borderRight: `1px solid ${SIDEBAR_BD}` }}
        >
          {/* Playback controls row — aligns with ruler height */}
          <div
            className="shrink-0 flex items-center gap-2 px-2"
            style={{ height: RULER_HEIGHT, borderBottom: `1px solid ${RULER_BORDER}` }}
          >
            {/* Time display: current : duration */}
            <div className="flex items-center gap-1 text-[11px] shrink-0" style={{ fontFamily: 'Inter, sans-serif', fontWeight: 450, color: TEXT_COLOR }}>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtTime(currentTime)}</span>
              <span style={{ color: TEXT_DIM }}>:</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: TEXT_DIM }}>{fmtTime(duration)}</span>
            </div>

            {/* Playback buttons pill */}
            <div className="flex items-center rounded-[5px] shrink-0 ml-auto" style={{ background: CONTROLS_BG }}>
              <button
                onClick={() => setCurrentTime(0)}
                className="flex items-center justify-center w-8 h-6 transition-opacity hover:opacity-70"
                style={{ color: TEXT_COLOR }}
                title="Skip to start"
              >
                <SkipBack size={12} weight="fill" />
              </button>
              <button
                onClick={togglePlaying}
                className="flex items-center justify-center w-8 h-6 transition-opacity hover:opacity-70"
                style={{ color: TEXT_COLOR }}
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <PhPause size={12} weight="fill" /> : <PhPlay size={12} weight="fill" />}
              </button>
              <button
                onClick={() => setCurrentTime(duration - 1)}
                className="flex items-center justify-center w-8 h-6 transition-opacity hover:opacity-70"
                style={{ color: TEXT_COLOR }}
                title="Skip to end"
              >
                <SkipForward size={12} weight="fill" />
              </button>
            </div>
          </div>

          {/* Track list */}
          <div
            ref={sidebarRef}
            className="flex-1 overflow-y-scroll no-scrollbar overflow-x-hidden"
            onMouseDown={(e) => {
              const target = e.target as HTMLElement;
              if (!target.closest('[data-track-id]')) setSelection([]);
            }}
          >
            <div className="flex flex-col gap-0.5 px-1 pb-1">
              {sortedNodesData.map(({ node, depth }) => (
                <TimelineSidebarTrack
                  key={node.id}
                  node={node}
                  depth={depth}
                  rowHeight={rowHeight}
                  isExpanded={!!expandedNodes[node.id]}
                  onToggleExpand={() => toggleNodeExpand(node.id)}
                  onSelect={(isShift, isCtrl) => handleLayerSelect(node.id, isShift, isCtrl)}
                  propertyGroups={propertyGroups}
                  onHoverChange={setHoveredNodeId}
                  isHovered={hoveredNodeId === node.id}
                  onPickWhipStart={(type, nodeId, x, y) => setPickWhip({ type, sourceNodeId: nodeId, startX: x, startY: y, currentX: x, currentY: y, targetNodeId: null })}
                  pickWhipTargetId={pickWhip?.targetNodeId ?? null}
                />
              ))}
            </div>
          </div>
        </div>

        {/* ── Right Track Area (the only part that scrolls) ────────── */}
        <div
          ref={timelineRef}
          className="flex-1 overflow-auto relative timeline-scroll-area"
          style={{
            background: PANEL_BG,
            backgroundImage: [
              `linear-gradient(to right, rgba(255,255,255,${zoomLevel > 1.5 ? '0.06' : zoomLevel > 0.8 ? '0.038' : '0.022'}) 1px, transparent 1px)`,
              `linear-gradient(to right, rgba(255,255,255,${zoomLevel > 1.5 ? '0.02' : zoomLevel > 0.8 ? '0.013' : '0.008'}) 1px, transparent 1px)`,
            ].join(', '),
            backgroundSize: `${fps * pixelsPerFrame}px 100%, ${pixelsPerFrame}px 100%`,
            backgroundPosition: `${timelinePaddingLeft}px 0`,
            backgroundAttachment: 'local',
          }}
        >
          <div className="relative" style={{ width: Math.max(totalWidth + timelinePaddingLeft, viewportWidth) }}>

            {/* ── Grid Area ──────────────────────────────────────────── */}
            <div
              data-timeline-grid="true"
              className="relative"
              onMouseDown={handleTimelineClick}
            >
              {/* Ruler — sticky top */}
              <div className="sticky top-0 z-50 pointer-events-none" style={{ height: RULER_HEIGHT }}>
                <div
                  className="h-full pointer-events-auto relative overflow-hidden flex items-center"
                  style={{ background: PANEL_BG, borderBottom: `1px solid ${RULER_BORDER}` }}
                >
                  {/* Tick marks — Figma style: seconds labels + pipes */}
                  {rulerTicks.map((f, i) => {
                    const s = Math.floor(f / fps);
                    const frames = Math.round(f % fps);
                    const isSec = frames === 0;
                    const label = isSec ? `${s}s` : '|';
                    return (
                      <div
                        key={i}
                        className="absolute flex items-center justify-center"
                        style={{ left: f * pixelsPerFrame + timelinePaddingLeft, height: '100%' }}
                      >
                        <span
                          className="select-none leading-none"
                          style={{
                            fontFamily: 'Inter, sans-serif',
                            fontWeight: isSec ? 450 : 400,
                            fontSize: isSec ? 11 : 9,
                            color: isSec ? TEXT_COLOR : TEXT_DIM,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {label}
                        </span>
                      </div>
                    );
                  })}

                {/* Work area bar */}
                <div
                  className="absolute bottom-0 h-[3px] z-30 rounded-sm"
                  style={{
                    left: timelinePaddingLeft + (workAreaStart ?? 0) * pixelsPerFrame,
                    width: ((workAreaEnd ?? duration) - (workAreaStart ?? 0)) * pixelsPerFrame,
                    background: 'rgba(255,255,255,0.18)',
                  }}
                  onContextMenu={handleWorkAreaContextMenu}
                >
                  <div className="absolute top-0 left-0 w-1.5 h-full cursor-col-resize rounded-sm" style={{ background: 'var(--accent)' }} onMouseDown={(e) => handleWorkAreaDrag(e, 'start')} />
                  <div className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize rounded-sm" style={{ background: 'var(--accent)' }} onMouseDown={(e) => handleWorkAreaDrag(e, 'end')} />
                </div>
              </div>

              {/* Needle head — inside sticky ruler, no overflow */}
              <div
                ref={needleHeadRef}
                className="absolute top-0 flex items-center justify-center pointer-events-auto cursor-ew-resize z-20 rounded-[3px]"
                style={{
                  left: currentTime * pixelsPerFrame + timelinePaddingLeft - 18,
                  height: RULER_HEIGHT - 2,
                  marginTop: 1,
                  minWidth: 36,
                  background: 'var(--accent)',
                }}
                onMouseDown={(e) => { e.stopPropagation(); handleScrubberDrag(e); }}
              >
                <span ref={needleTimeRef} className="text-[10px] font-medium text-white px-1.5 leading-none">
                  {formatTime(currentTime)}
                </span>
              </div>
            </div>

            {/* Marquee selection */}
            {marqueeRect && (
              <div
                className="absolute border border-accent/60 bg-accent/10 z-50 pointer-events-none"
                style={{
                  left: Math.min(marqueeRect.startX, marqueeRect.endX),
                  top: Math.min(marqueeRect.startY, marqueeRect.endY),
                  width: Math.abs(marqueeRect.endX - marqueeRect.startX),
                  height: Math.abs(marqueeRect.endY - marqueeRect.startY),
                }}
              />
            )}

            {/* Keyframe tracks — gap-0.5 matches sidebar */}
            <div className="flex flex-col gap-0.5 px-0 pb-1 relative z-0" style={{ paddingLeft: timelinePaddingLeft }}>
              {sortedNodesData.map(({ node, depth }) => (
                <TimelineKeyframeTrack
                  key={node.id}
                  node={node}
                  depth={depth}
                  rowHeight={rowHeight}
                  pixelsPerFrame={pixelsPerFrame}
                  isExpanded={!!expandedNodes[node.id]}
                  propertyGroups={propertyGroups}
                  onSelect={handleLayerSelect}
                  isHovered={hoveredNodeId === node.id}
                  onHoverChange={setHoveredNodeId}
                  pickWhipTargetId={pickWhip?.targetNodeId ?? null}
                />
              ))}
            </div>
          </div>

          {/* Needle line — absolute in scroll container, top-0 bottom-0 = panel height only, no scroll overflow */}
          <div
            ref={needleLineRef}
            className="absolute top-0 bottom-0 w-px z-10 pointer-events-none"
            style={{ left: currentTime * pixelsPerFrame + timelinePaddingLeft, background: 'var(--accent)', opacity: 0.7 }}
          />
        </div>

        {/* Needle line — bounded to panel height, no scroll-height contribution */}
        <div
          ref={needleLineRef}
          className="absolute top-0 bottom-0 w-px z-10 pointer-events-none"
          style={{ left: currentTime * pixelsPerFrame + timelinePaddingLeft, background: 'var(--accent)', opacity: 0.7 }}
        />

        {/* Work area context menu */}
        {workAreaMenu && (
          <div
            className="fixed rounded-xl w-56 z-[100] py-1 text-sm font-medium"
            style={{ left: workAreaMenu.x, top: workAreaMenu.y, background: '#18181b', border: '1px solid rgba(255,255,255,0.10)', boxShadow: 'var(--shadow-lg)' }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button onClick={() => { addFlowBlock({ name: 'New Segment', startFrame: workAreaStart ?? 0, endFrame: workAreaEnd ?? duration, loop: true }); setActiveLayersTab('segments'); setWorkAreaMenu(null); }} className="w-full text-left px-3 py-2 hover:bg-accent/10 hover:text-accent transition-colors flex items-center gap-2" style={{ color: TEXT_COLOR }}>
              Set work area as segment
            </button>
            <button onClick={() => { const start = workAreaStart ?? 0; const end = workAreaEnd ?? duration; useCreatorStore.getState().setDuration(end - start); useCreatorStore.getState().shiftLayers(Array.from(useCreatorStore.getState().nodes.keys()), -start); useCreatorStore.getState().setWorkArea(null, null); setWorkAreaMenu(null); useCreatorStore.getState().setCurrentTime(0); }} className="w-full text-left px-3 py-2 hover:bg-white/10 transition-colors" style={{ color: TEXT_COLOR }}>
              Trim scene to work area
            </button>
            <button onClick={() => { useCreatorStore.getState().setWorkArea(null, null); setWorkAreaMenu(null); }} className="w-full text-left px-3 py-2 hover:bg-white/10 transition-colors" style={{ color: TEXT_COLOR }}>
              Reset work area
            </button>
          </div>
        )}
      </div>
      </div>

    </div>

    {/* Pick-whip wire — rendered above everything via portal */}
    {pickWhip && typeof document !== 'undefined' && createPortal(
      <svg
        style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 99999 }}
      >
        <line
          x1={pickWhip.startX} y1={pickWhip.startY}
          x2={pickWhip.currentX} y2={pickWhip.currentY}
          stroke={pickWhip.targetNodeId ? '#4ADE80' : '#4AA3F5'}
          strokeWidth={1.5}
          strokeDasharray="5 4"
          opacity={0.85}
        />
        <circle cx={pickWhip.startX} cy={pickWhip.startY} r={3.5} fill="#4AA3F5" />
        <circle
          cx={pickWhip.currentX} cy={pickWhip.currentY}
          r={5} fill={pickWhip.targetNodeId ? '#4ADE80' : '#4AA3F5'}
          opacity={0.9}
        />
      </svg>,
      document.body
    )}
  </>
  );
}
