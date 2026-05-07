'use client';

import { useRef, useEffect, useMemo, useState } from 'react';
import { useCreatorStore } from '@/lib/creator/state/store';
import { playbackRef } from '@/lib/creator/state/playbackRef';
import { Play, Pause, Square, ChevronLeft, ChevronRight, ChevronDown, Settings, Trash2, Timer, Repeat } from 'lucide-react';
import TimelineSidebarTrack from './TimelineSidebarTrack';
import TimelineKeyframeTrack from './TimelineKeyframeTrack';
import { SceneNode } from '@/lib/creator/state/sceneSlice';

export default function TimelinePanel() {
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
  const [marqueeRect, setMarqueeRect] = useState<{ startX: number, startY: number, endX: number, endY: number } | null>(null);
  const [workAreaMenu, setWorkAreaMenu] = useState<{ x: number, y: number } | null>(null);
  const addFlowBlock = useCreatorStore((state) => state.addFlowBlock);
  const setSegmentsPanelOpen = useCreatorStore((state) => state.setSegmentsPanelOpen);
  
  // Virtualization state
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(1000);

  const artboards = useMemo(() => {
    return Array.from(nodes.values()).filter(n => n.type === 'artboard');
  }, [nodes]);

  const propertyGroups = useMemo(() => [
    {
      label: 'Position',
      mainPath: 'transform.x',
      props: [
        { label: 'X', path: 'transform.x' },
        { label: 'Y', path: 'transform.y' }
      ]
    },
    {
      label: 'Size',
      mainPath: 'props.width',
      hasLink: true,
      props: [
        { label: 'W', path: 'props.width' },
        { label: 'H', path: 'props.height' }
      ]
    },
    {
      label: 'Roundness',
      mainPath: 'props.roundness',
      props: [
        { label: 'Radius', path: 'props.roundness' }
      ]
    },
    {
      label: 'Scale',
      mainPath: 'transform.scaleX',
      hasLink: true,
      props: [
        { label: 'X', path: 'transform.scaleX', isPercent: true },
        { label: 'Y', path: 'transform.scaleY', isPercent: true }
      ]
    },
    {
      label: 'Rotation',
      mainPath: 'transform.rotation',
      props: [
        { label: 'R', path: 'transform.rotation', isDegree: true }
      ]
    },
    {
      label: 'Path',
      mainPath: 'props.points',
      props: [
        { label: 'Path', path: 'props.points' }
      ]
    },
    {
      label: 'Opacity',
      mainPath: 'style.opacity',
      props: [
        { label: 'T', path: 'style.opacity', isPercent: true, min: 0, max: 1 }
      ]
    },

    {
      label: 'Trim Start',
      mainPath: 'style.trimStart',
      props: [
        { label: 'Start', path: 'style.trimStart', isPercent: true, min: 0, max: 1 }
      ]
    },
    {
      label: 'Trim End',
      mainPath: 'style.trimEnd',
      props: [
        { label: 'End', path: 'style.trimEnd', isPercent: true, min: 0, max: 1 }
      ]
    },
    {
      label: 'Fill Color',
      mainPath: 'style.fill',
      props: [
        { label: 'Fill', path: 'style.fill' }
      ]
    },
    {
      label: 'Fill Gradient',
      mainPath: 'style.fillGradient',
      props: [
        { label: 'Gradient', path: 'style.fillGradient' }
      ]
    },
    {
      label: 'Fill Opacity',
      mainPath: 'style.fillOpacity',
      props: [
        { label: 'Alpha', path: 'style.fillOpacity', isPercent: true, min: 0, max: 1 }
      ]
    },
    {
      label: 'Stroke Color',
      mainPath: 'style.stroke',
      props: [
        { label: 'Stroke', path: 'style.stroke' }
      ]
    },
    {
      label: 'Stroke Gradient',
      mainPath: 'style.strokeGradient',
      props: [
        { label: 'Gradient', path: 'style.strokeGradient' }
      ]
    },
    {
      label: 'Stroke Width',
      mainPath: 'style.strokeWidth',
      props: [
        { label: 'Width', path: 'style.strokeWidth' }
      ]
    },
    {
      label: 'Stroke Opacity',
      mainPath: 'style.strokeOpacity',
      props: [
        { label: 'Alpha', path: 'style.strokeOpacity', isPercent: true, min: 0, max: 1 }
      ]
    },
    {
      label: 'Trim Offset',
      mainPath: 'style.trimOffset',
      props: [
        { label: 'Offset', path: 'style.trimOffset', isDegree: true }
      ]
    },
  ], []);
  const basePixelsPerFrame = 8;
  const pixelsPerFrame = basePixelsPerFrame * zoomLevel;
  const rowHeight = 32;
  const timelinePaddingLeft = 28; // Space between sidebar and grid
  const RULER_HEIGHT = 44;
  const timelineRef = useRef<HTMLDivElement>(null);
  // Direct DOM refs for scrubber needle — updated via rAF during playback (zero React re-renders)
  const needleLineRef = useRef<HTMLDivElement>(null);
  const needleHeadRef = useRef<HTMLDivElement>(null);
  const needleTimeRef = useRef<HTMLDivElement>(null);
  const rafIdRef = useRef<number | null>(null);

  // Handle Wheel (Zoom & Scroll)
  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;

    const handleWheelListener = (e: WheelEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.95 : 1.05;

        const sidebarWidth = 320;
        const containerWidth = timeline.clientWidth - sidebarWidth - timelinePaddingLeft - 40;
        const minPixelsPerFrame = containerWidth / (duration || 1);
        const minZoom = minPixelsPerFrame / basePixelsPerFrame;

        setZoomLevel(Math.max(minZoom, zoomLevel * delta));
      }
    };

    timeline.addEventListener('wheel', handleWheelListener, { passive: false });
    return () => timeline.removeEventListener('wheel', handleWheelListener);
  }, [zoomLevel, duration, setZoomLevel]);

  const fitTimeline = () => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    const sidebarWidth = 320;
    const padding = timelinePaddingLeft + 80;
    const containerWidth = timeline.clientWidth - sidebarWidth - padding;
    if (containerWidth <= 0) return;
    const targetPixelsPerFrame = containerWidth / (duration || 1);
    setZoomLevel(targetPixelsPerFrame / basePixelsPerFrame);
  };

  // Auto-fit timeline on mount and when duration changes
  // This ensures we never have a massive blank area on the right upon import or duration adjustments
  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;

    const handleResize = () => {
      const state = useCreatorStore.getState();
      const sidebarWidth = 320;
      const padding = timelinePaddingLeft + 80;
      const containerWidth = timeline.clientWidth - sidebarWidth - padding;
      if (containerWidth <= 0) return;

      const currentContentWidth = duration * basePixelsPerFrame * state.zoomLevel;
      
      setViewportWidth(timeline.clientWidth);

      // Only auto-fit if the content is too small for the screen (to resolve the "blank area" issue)
      // or if we have a very small default zoom level.
      if (currentContentWidth < containerWidth || state.zoomLevel < 0.1) {
        const targetPixelsPerFrame = containerWidth / (duration || 1);
        setZoomLevel(targetPixelsPerFrame / basePixelsPerFrame);
      }
    };

    const handleScroll = () => {
      setScrollLeft(timeline.scrollLeft);
    };

    // Initial check after a short delay to ensure DOM is ready
    const timer = setTimeout(handleResize, 50);

    const observer = new ResizeObserver(handleResize);
    observer.observe(timeline);
    timeline.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      clearTimeout(timer);
      observer.disconnect();
      timeline.removeEventListener('scroll', handleScroll);
    };
  }, [duration]); // Only re-run if duration changes

  // AE Property Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only trigger if we're not typing in an input and timeline is active
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

      const key = e.key.toLowerCase();
      const propertyMap: Record<string, string> = {
        'p': 'transform.x',       // Position
        's': 'transform.scaleX',  // Scale
        'r': 'transform.rotation',
        't': 'style.opacity',     // Transparency/Opacity
        'a': 'transform.anchorX', // Anchor Point
        'm': 'props.points',      // Mask/Path
        'q': 'style.trimStart',   // Trim Paths
      };

      const state = useCreatorStore.getState();
      if (key === 'u' && state.activePanel === 'timeline') {
        e.preventDefault();
        selectedIds.forEach(id => {
          state.showAnimatedProperties(id);
        });
        return;
      }

      if (propertyMap[key] && state.activePanel === 'timeline') {
        console.log(`🎬 Timeline Shortcut: ${key} for ${propertyMap[key]}`);
        e.preventDefault();
        selectedIds.forEach(id => {
          const node = nodes.get(id);
          if (!node) return;

          // Visibility logic in tracks handles showing solo properties even if collapsed

          if (key === 's') {
            toggleTrackVisibility(id, 'transform.scaleX');
          } else if (key === 'q') {
            // Toggle all trim properties together
            toggleTrackVisibility(id, 'style.trimStart');
            toggleTrackVisibility(id, 'style.trimEnd');
            toggleTrackVisibility(id, 'style.trimOffset');
          } else {
            toggleTrackVisibility(id, propertyMap[key]);
          }
        });
      }

      // Work Area Shortcuts (AE Style)
      if (key === 'b' && state.activePanel === 'timeline') {
        e.preventDefault();
        const currentEnd = state.workAreaEnd ?? state.duration;
        state.setWorkArea(state.currentTime, Math.max(state.currentTime + 1, currentEnd));
      }
      if (key === 'n' && state.activePanel === 'timeline') {
        e.preventDefault();
        const currentStart = state.workAreaStart ?? 0;
        state.setWorkArea(Math.min(state.currentTime, currentStart), state.currentTime + 1);
      }

      // Layer Timeframe Shortcuts (AE Style)
      // Use e.code (BracketLeft/Right) because Option+[ on Mac results in different chars
      if ((e.code === 'BracketLeft' || e.code === 'BracketRight') && state.activePanel === 'timeline') {
        e.preventDefault();
        const isLeft = e.code === 'BracketLeft';
        state.pushToHistory(e.altKey ? 'Trim Layer' : 'Shift Layer');

        state.selectedIds.forEach(id => {
          const node = state.nodes.get(id);
          if (!node || node.type === 'artboard') return;

          const currentDuration = node.outPoint - node.inPoint;

          if (e.altKey) {
            // Trim (Option+[ or Option+])
            if (isLeft) {
              state.updateNode(id, { inPoint: Math.min(node.outPoint - 1, state.currentTime) });
            } else {
              state.updateNode(id, { outPoint: Math.max(node.inPoint + 1, state.currentTime) });
            }
          } else {
            // Shift ([ or ])
            if (isLeft) {
              const delta = state.currentTime - node.inPoint;
              state.shiftLayers([id], delta);
            } else {
              const delta = state.currentTime - node.outPoint;
              state.shiftLayers([id], delta);
            }
          }
        });
      }

      if ((key === 'delete' || key === 'backspace') && state.activePanel === 'timeline') {
        if (selectedKeyframeIds.length > 0) {
          e.preventDefault();
          deleteSelectedKeyframes();
        } else if (selectedIds.length > 0) {
          e.preventDefault();
          pushToHistory(`Delete ${selectedIds.length > 1 ? 'Selected Layers' : 'Layer'}`);
          selectedIds.forEach(id => deleteNode(id));
          setSelection([]);
          return;
        }
      }

      // Copy / Paste
      if ((e.ctrlKey || e.metaKey) && key === 'c' && state.activePanel === 'timeline') {
        if (selectedKeyframeIds.length > 0) {
          e.preventDefault();
          state.copyKeyframes();
        } else if (selectedIds.length > 0) {
          e.preventDefault();
          state.copySelection();
        }
      }

      if ((e.ctrlKey || e.metaKey) && key === 'v' && state.activePanel === 'timeline') {
        // Prioritize keyframe paste if there's keyframe data and keyframes were the last thing copied? 
        // Actually standard AE behavior: if you have keyframe data, paste it to selected layers.
        if (state.keyframeClipboard.length > 0) {
          e.preventDefault();
          state.pasteKeyframes();
        } else if (state.clipboard.length > 0) {
          e.preventDefault();
          state.pasteSelection();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, toggleTrackVisibility, selectedKeyframeIds, deleteSelectedKeyframes, togglePlaying, nodes]);

  const startScrubbing = (gridArea: HTMLElement, e: React.MouseEvent | MouseEvent) => {
    const onMouseMove = (moveE: MouseEvent) => {
      const rect = gridArea.getBoundingClientRect();
      const x = moveE.clientX - rect.left - timelinePaddingLeft;
      const frame = Math.max(0, Math.min(duration - 1, Math.round(x / pixelsPerFrame)));
      setCurrentTime(frame);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    // Initial update for the click point
    onMouseMove(e as MouseEvent);
  };

  const startMarqueeSelection = (gridArea: HTMLElement, e: React.MouseEvent | MouseEvent) => {
    const rect = gridArea.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top;
    const isShift = e.shiftKey || e.ctrlKey || e.metaKey;

    if (!isShift) {
      selectKeyframes([]);
    }

    const initialKeyframes = useCreatorStore.getState().selectedKeyframeIds;

    const onMouseMove = (moveE: MouseEvent) => {
      const currentX = moveE.clientX - rect.left;
      const currentY = moveE.clientY - rect.top;

      setMarqueeRect({ startX, startY, endX: currentX, endY: currentY });

      // Calculate selection
      const minX = Math.min(startX, currentX) - timelinePaddingLeft;
      const maxX = Math.max(startX, currentX) - timelinePaddingLeft;
      const minY = Math.min(startY, currentY) - RULER_HEIGHT; // Subtract ruler height
      const maxY = Math.max(startY, currentY) - RULER_HEIGHT;

      const minFrame = minX / pixelsPerFrame;
      const maxFrame = maxX / pixelsPerFrame;

      const newlySelected: string[] = [];
      let nextY = 0;

      sortedNodesData.forEach(({ node }) => {
        // Main Row (Layer Bar) - Height: rowHeight
        nextY += rowHeight;

        // Property Rows
        const trackVisibility = trackVisibilityAll[node.id] || [];
        const adaptedGroups = propertyGroups.map(group => {
          if (node.type === 'image') {
            const allowed = ['Position', 'Scale', 'Rotation', 'Opacity'];
            if (!allowed.includes(group.label)) return null;
          }

          if (group.label === 'Size') {
            if (node.type === 'ellipse') return { ...group, mainPath: 'props.radiusX', props: [{ path: 'props.radiusX' }, { path: 'props.radiusY' }] };
            if (node.type !== 'rect' && node.type !== 'artboard' && node.type !== 'path') return null;
          }
          if (group.label === 'Path' && !(node.type === 'path' || node.type === 'rect' || node.type === 'ellipse')) return null;
          if (group.label.startsWith('Trim') && !(node.type === 'rect' || node.type === 'ellipse' || node.type === 'path' || node.type === 'group')) return null;
          if (group.label === 'Roundness' && (node.type !== 'rect' && node.type !== 'path')) {
            return null;
          }

          return group;
        }).filter(Boolean);

        const isExpanded = !!expandedNodes[node.id];
        const isSolo = trackVisibility.length > 0;

        const visibleGroups = isSolo
          ? adaptedGroups.filter((g: any) => g && trackVisibility.includes(g.mainPath))
          : (isExpanded ? adaptedGroups : []);

        const getAnimatedGroups = (groups: any[]) => {
          return groups.filter(group => group.props.some((p: any) => !!node.animations?.[p.path]));
        };

        const coreGroups = getAnimatedGroups(visibleGroups).filter((g: any) => ['Position', 'Scale', 'Rotation', 'Opacity'].includes(g.label));
        const shapeGroups = getAnimatedGroups(adaptedGroups).filter((g: any) => !['Position', 'Scale', 'Rotation', 'Opacity'].includes(g.label));
        const isShapeGroupExpanded = !!expandedShapeGroups[node.id];

        const processGroup = (group: any) => {
          if (!group) return;
          const rowTop = nextY;
          const rowBottom = nextY + rowHeight;
          if (rowBottom > minY && rowTop < maxY) {
            group.props.forEach((p: any) => {
              const kfs = node.animations?.[p.path] || [];
              kfs.forEach((kf: any) => {
                if (kf.time >= minFrame && kf.time <= maxFrame) {
                  newlySelected.push(`${node.id}:${p.path}:${kf.id}`);
                }
              });
            });
          }
          nextY += rowHeight;
        };

        if (isSolo) {
          visibleGroups.forEach(processGroup);
        } else if (isExpanded) {
          coreGroups.forEach(processGroup);

          if (shapeGroups.length > 0) {
            nextY += rowHeight; // Shape Header Row
            if (isShapeGroupExpanded) {
              shapeGroups.forEach(processGroup);
            }
          }
        }
      });

      const finalSelection = isShift
        ? Array.from(new Set([...initialKeyframes, ...newlySelected]))
        : newlySelected;

      selectKeyframes(finalSelection, false);
    };

    const onMouseUp = () => {
      setMarqueeRect(null);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

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
        const range = allIds.slice(min, max + 1);

        if (isCtrl) {
          // Add range to existing selection
          const nextSelection = Array.from(new Set([...currentSelected, ...range]));
          setSelection(nextSelection);
        } else {
          // Replace selection with range
          setSelection(range);
        }
        return;
      }
    }

    if (isCtrl) {
      if (currentSelected.includes(nodeId)) {
        state.removeFromSelection(nodeId);
      } else {
        state.addToSelection(nodeId);
      }
    } else {
      setSelection([nodeId]);
    }
  };

  const handleTimelineClick = (e: React.MouseEvent) => {
    // Determine if we clicked the ruler (top sticky area)
    const timelineRect = timelineRef.current?.getBoundingClientRect();
    if (!timelineRect) return;

    // Use viewport-relative Y coordinate relative to the timeline panel top
    const relativeY = e.clientY - timelineRect.top;

    if (relativeY <= RULER_HEIGHT) {
      const gridArea = (e.currentTarget as HTMLElement).closest('[data-timeline-grid]') as HTMLElement;
      if (gridArea) startScrubbing(gridArea, e);
    } else {
      // If clicking on the background (empty space below tracks or even on a track background)
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
        setSelection([]);
        selectKeyframes([]);
      }
      startMarqueeSelection(e.currentTarget as HTMLElement, e);
    }
  };

  const handleScrubberDrag = (e: React.MouseEvent) => {
    const gridArea = (e.currentTarget as HTMLElement).closest('[data-timeline-grid]') as HTMLElement;
    if (gridArea) startScrubbing(gridArea, e);
  };

  const handleWorkAreaDrag = (e: React.MouseEvent, type: 'start' | 'end') => {
    e.preventDefault();
    e.stopPropagation();

    // The handle is inside [sticky overlay] -> [Grid Area]
    const gridArea = e.currentTarget.parentElement?.parentElement;
    if (!gridArea) return;

    const onMouseMove = (moveE: MouseEvent) => {
      const rect = gridArea.getBoundingClientRect();
      const clickX = moveE.clientX - rect.left - timelinePaddingLeft;
      const state = useCreatorStore.getState();
      const targetFrame = Math.max(0, Math.min(state.duration, Math.round(clickX / pixelsPerFrame)));

      const currentStart = state.workAreaStart ?? 0;
      const currentEnd = state.workAreaEnd ?? state.duration;

      if (type === 'start') {
        const newStart = Math.min(targetFrame, currentEnd);
        useCreatorStore.getState().setWorkArea(newStart, currentEnd);
      } else {
        const newEnd = Math.max(targetFrame, currentStart);
        useCreatorStore.getState().setWorkArea(currentStart, newEnd);
      }
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleWorkAreaContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setWorkAreaMenu({ x: e.clientX, y: e.clientY });
  };

  // Close context menu on outside click
  useEffect(() => {
    if (!workAreaMenu) return;
    const closeMenu = () => setWorkAreaMenu(null);
    window.addEventListener('mousedown', closeMenu);
    return () => window.removeEventListener('mousedown', closeMenu);
  }, [workAreaMenu]);

  // Playback Loop
  useEffect(() => {
    if (!isPlaying) return;

    let animationFrameId: number;
    let lastTime = performance.now();
    let frameAccumulator = 0;

    const loop = (now: number) => {
      const delta = now - lastTime;
      lastTime = now;
      frameAccumulator += (delta / 1000) * fps;

      if (frameAccumulator >= 1) {
        const framesToAdvance = Math.floor(frameAccumulator);
        frameAccumulator -= framesToAdvance;

        // Access latest values via store.getState() to avoid dependency on currentTime/isLooping/duration
        const state = useCreatorStore.getState();
        let nextTime = state.currentTime + framesToAdvance;

        const loopStart = state.workAreaStart ?? 0;
        const loopEnd = state.workAreaEnd ?? state.duration;

        if (nextTime >= loopEnd) {
          if (state.isLooping) {
            // Loop back to start, preserving remainder for smooth fps
            const loopDuration = Math.max(1, loopEnd - loopStart);
            const remainder = (nextTime - loopEnd) % loopDuration;
            nextTime = loopStart + remainder;
          } else {
            nextTime = loopEnd - 1;
            state.setPlaying(false); // Stop at end
          }
        } else if (nextTime < loopStart) {
          // If scrubber is placed before loop start, jump into the loop immediately
          nextTime = loopStart;
        }

        state.setCurrentTime(nextTime);
      }
      animationFrameId = requestAnimationFrame(loop);
    };

    animationFrameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationFrameId);
  }, [isPlaying, fps]); // Only restart if isPlaying or fps changes

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

      if (node.type !== 'artboard') {
        result.push({ node, depth });
      }

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

  // Ruler markings in frames (AE Style: 0s, 10f, 20f, 1s...)
  const rulerTicks = useMemo(() => {
    const ticks = [];
    const targetSpacing = 80; // Ideal pixel spacing between labels
    const rawInterval = targetSpacing / pixelsPerFrame;

    // Nice frame intervals for 60fps (or generic)
    const niceIntervals = [1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 1200, 1800, 3600];
    const frameInterval = niceIntervals.reduce((prev, curr) =>
      Math.abs(curr - rawInterval) < Math.abs(prev - rawInterval) ? curr : prev
    );

    // Virtualization limits
    const startFrame = Math.max(0, Math.floor((scrollLeft - 400) / pixelsPerFrame));
    const endFrame = Math.min(duration, Math.ceil((scrollLeft + viewportWidth + 400) / pixelsPerFrame));

    for (let f = startFrame; f <= endFrame; f += frameInterval) {
      // Snap to whole frames
      ticks.push(f);
    }
    return ticks;
  }, [duration, pixelsPerFrame, scrollLeft, viewportWidth]);


  const formatTime = (f: number) => {
    const s = Math.floor(f / fps);
    const frames = Math.round(f % fps);
    return `${s}s ${frames}f`;
  };

  // Keep a stable ref to the values needed inside the rAF loop (avoids re-creating the loop on every render)
  const needleMetaRef = useRef({ pixelsPerFrame, timelinePaddingLeft, fps });
  needleMetaRef.current = { pixelsPerFrame, timelinePaddingLeft, fps };

  // rAF loop: directly mutate needle DOM elements during ThorVG playback — no React re-renders
  useEffect(() => {
    const loop = () => {
      rafIdRef.current = requestAnimationFrame(loop);
      if (!playbackRef.active) return;
      const frame = playbackRef.frame;
      const { pixelsPerFrame: ppf, timelinePaddingLeft: tpl, fps: f } = needleMetaRef.current;
      const left = frame * ppf + tpl;
      if (needleLineRef.current) needleLineRef.current.style.left = `${left}px`;
      if (needleHeadRef.current) needleHeadRef.current.style.left = `${left - 25}px`;
      if (needleTimeRef.current) {
        const s = Math.floor(frame / f);
        const fr = Math.round(frame % f);
        needleTimeRef.current.textContent = `${s}s ${fr}f`;
      }
    };
    rafIdRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isTimelineCollapsed = useCreatorStore((state) => state.isTimelineCollapsed);
  const setTimelineCollapsed = useCreatorStore((state) => state.setTimelineCollapsed);

  return (
    <div className="w-full h-full flex flex-col overflow-hidden select-none border-t border-white/[0.06]" style={{ background: 'var(--bg-panel)' }}>
      {/* Scene Tabs & Header */}
      <div className="h-10 border-b border-white/[0.06] flex items-center px-2 shrink-0 justify-between" style={{ background: 'var(--bg-panel)' }}>
        <div className="flex items-center">
          <button
            onClick={() => setTimelineCollapsed(!isTimelineCollapsed)}
            className="w-8 h-8 flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-hover rounded-md transition-all group"
            title={isTimelineCollapsed ? "Expand Timeline" : "Minimize Timeline"}
          >
            {isTimelineCollapsed ? <ChevronRight className="w-4 h-4 -rotate-90" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          <div className="h-full flex items-center ml-1 overflow-x-auto no-scrollbar scroll-smooth">
            {artboards.map(ab => {
              const isActive = ab.id === (activeArtboardId || artboards[0]?.id);
              return (
                <button
                  key={ab.id}
                  onClick={() => setActiveArtboard(ab.id)}
                  className={`px-4 h-full flex items-center gap-2 border-b-2 transition-all duration-300 relative shrink-0 ${isActive
                    ? "border-accent text-primary"
                    : "border-transparent text-muted hover:text-secondary hover:bg-white/[0.02]"
                    }`}
                >
                  {isActive && <div className="w-1.5 h-1.5 rounded-full bg-accent" />}
                  <span className={`text-[11px] font-medium whitespace-nowrap`}>
                    {ab.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {isTimelineCollapsed && (
          <button
            onClick={() => setTimelineCollapsed(false)}
            className="px-3 py-1 flex items-center gap-1.5 text-[11px] font-medium text-accent hover:text-accent transition-all bg-accent/10 hover:bg-accent/15 rounded-md border border-accent/20 mr-2"
          >
            <span>Expand</span>
            <ChevronRight className="w-3 h-3 -rotate-90" />
          </button>
        )}
      </div>

      <div
        ref={timelineRef}
        className="flex-1 overflow-auto relative timeline-scroll-area"
      style={{ background: 'var(--bg-panel)' }}
      >
        <div className="flex relative items-start" style={{ minWidth: '100%', width: totalWidth + 320 + 200, minHeight: '100%' }}>
          {/* Left: Tracks Sidebar (STAY STICKY LEFT) */}
          <div
            className="w-80 border-r border-white/[0.06] flex flex-col sticky left-0 z-[60] shrink-0 min-h-full"
            style={{ background: 'var(--bg-panel)' }}
            onMouseDown={(e) => {
              const target = e.target as HTMLElement;
              const hitTrack = target.closest('[data-track-id]');
              if (!hitTrack) {
                setSelection([]);
              }
            }}
          >
            <div className="h-10 border-b border-white/[0.06] flex items-center px-3 justify-between sticky top-0 z-[70] sidebar-header" style={{ background: 'var(--bg-panel)' }}>
              <div className="flex-1 flex items-center justify-between pointer-events-none">
                <span className="text-xs font-medium text-secondary">Layers</span>
                <span className="text-[10px] text-muted mr-8">Parent & Link</span>
              </div>
            </div>
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
              />
            ))}
          </div>

          {/* Right: Keyframe Grid Area */}
          <div
            data-timeline-grid="true"
            className="flex-1 relative min-h-full"
            onMouseDown={handleTimelineClick}
          >
            {/* Timeline Ruler & Scrubber Sticky Header */}
            <div className="sticky top-0 z-50 pointer-events-none" style={{ height: RULER_HEIGHT }}>
              <div
                className="h-full border-b border-white/[0.06] bg-white/[0.02] pointer-events-auto relative overflow-hidden"
              >
                {/* Ruler Ticks */}
                {rulerTicks.map((f, i) => {
                  const s = Math.floor(f / fps);
                  const frames = f % fps;
                  const label = frames === 0 ? `${s}s` : `${frames}f`;

                  return (
                    <div
                      key={i}
                      className="absolute bottom-2 h-4 flex flex-col justify-end pb-1 border-l border-white/10"
                      style={{ left: f * pixelsPerFrame + timelinePaddingLeft }}
                    >
                      <span className={`text-[9px] pl-1.5 font-mono font-medium transition-colors ${frames === 0 ? 'text-accent' : 'text-muted'}`}>
                        {label}
                      </span>
                    </div>
                  );
                })}

                {/* Work Area Bar */}
                <div
                  className="absolute bottom-0 h-1.5 bg-white/20 z-30"
                  style={{
                    left: timelinePaddingLeft + (workAreaStart ?? 0) * pixelsPerFrame,
                    width: ((workAreaEnd ?? duration) - (workAreaStart ?? 0)) * pixelsPerFrame
                  }}
                  onContextMenu={handleWorkAreaContextMenu}
                >
                  {/* Start Handle */}
                  <div
                    className="absolute top-0 left-0 w-2 h-full bg-accent cursor-col-resize transform -translate-x-1 hover:w-3 hover:-translate-x-1.5 transition-all"
                    onMouseDown={(e) => handleWorkAreaDrag(e, 'start')}
                  />
                  {/* End Handle */}
                  <div
                    className="absolute top-0 right-0 w-2 h-full bg-accent cursor-col-resize transform translate-x-1 hover:w-3 hover:translate-x-1.5 transition-all"
                    onMouseDown={(e) => handleWorkAreaDrag(e, 'end')}
                  />
                </div>
              </div>

              {/* Scrubber Handle Overlay - Also sticky */}
              <div className="absolute top-0 left-0 w-full h-[10000px] pointer-events-none overflow-visible">
                {/* Scrubber Line */}
                <div
                  ref={needleLineRef}
                  className="absolute top-0 w-px bg-accent/50 z-10"
                  style={{
                    left: currentTime * pixelsPerFrame + timelinePaddingLeft,
                    height: '100%'
                  }}
                />

                {/* Scrubber Head (Handle) */}
                <div
                  ref={needleHeadRef}
                  className="absolute top-0 flex flex-col items-center group pointer-events-auto cursor-ew-resize active:cursor-grabbing z-20"
                  style={{ left: currentTime * pixelsPerFrame + timelinePaddingLeft - 25 }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    handleScrubberDrag(e);
                  }}
                >
                  <div ref={needleTimeRef} className="px-2 py-0.5 text-white text-[10px] font-mono font-medium rounded flex items-center justify-center min-w-[50px] border border-accent/40 transform translate-y-1" style={{ background: 'var(--accent)' }}>
                    {formatTime(currentTime)}
                  </div>
                  <div className="w-px h-3 bg-accent/80 mt-1.5" />
                </div>
              </div>
            </div>

            {/* Grid Area Offset */}
            <div className="relative" style={{ height: 0 }}>
              {/* Grid Lines Background - Optimized with CSS Pattern (No more 100k DOM nodes!) */}
              <div 
                className="absolute inset-x-0 top-0 bottom-[-100vh] z-0 pointer-events-none transition-opacity duration-300"
                style={{
                  paddingLeft: timelinePaddingLeft,
                  backgroundImage: `
                    linear-gradient(to right, rgba(255, 255, 255, 0.08) 1px, transparent 1px),
                    linear-gradient(to right, rgba(255, 255, 255, 0.02) 1px, transparent 1px)
                  `,
                  backgroundSize: `
                    ${fps * pixelsPerFrame}px 100%,
                    ${pixelsPerFrame}px 100%
                  `,
                  backgroundPosition: `0 0`,
                  opacity: zoomLevel > 1.5 ? 1 : (zoomLevel > 0.8 ? 0.6 : 0.4),
                  width: totalWidth
                }}
              />
            </div>

            {/* Marquee Selection Overlay */}
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

            {/* Tracks Content (Grid Part) */}
            <div data-bg="true" className="overflow-visible relative z-0 flex-1 min-h-full" style={{ paddingLeft: timelinePaddingLeft }}>
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
                />
              ))}
            </div>
          </div>
        </div>

        {/* Work Area Context Menu */}
        {workAreaMenu && (
          <div
            className="fixed bg-[#18181b] border border-white/10 shadow-2xl rounded-xl w-56 z-[100] py-1 text-sm font-medium animate-in fade-in zoom-in-95 duration-100"
            style={{ left: workAreaMenu.x, top: workAreaMenu.y }}
            onMouseDown={(e) => e.stopPropagation()} // Prevent auto-close when clicking inside
          >
            <button
              onClick={() => {
                const start = workAreaStart ?? 0;
                const end = workAreaEnd ?? duration;
                addFlowBlock({
                  name: 'New Segment',
                  startFrame: start,
                  endFrame: end,
                  loop: true
                });
                setSegmentsPanelOpen(true);
                setWorkAreaMenu(null);
              }}
              className="w-full text-left px-3 py-2 text-secondary hover:bg-accent/10 hover:text-accent transition-colors flex items-center gap-2"
            >
              Set work area as segment
            </button>
            <button
              onClick={() => {
                // Trim scene to work area
                const start = workAreaStart ?? 0;
                const end = workAreaEnd ?? duration;

                // Keep duration correct
                useCreatorStore.getState().setDuration(end - start);

                // Shift all layers back by 'start'
                const allNodes = Array.from(useCreatorStore.getState().nodes.keys());
                useCreatorStore.getState().shiftLayers(allNodes, -start);

                // Reset work area
                useCreatorStore.getState().setWorkArea(null, null);
                setWorkAreaMenu(null);

                useCreatorStore.getState().setCurrentTime(0);
              }}
              className="w-full text-left px-3 py-2 text-white/90 hover:bg-white/10 transition-colors"
            >
              Trim scene to work area
            </button>
            <button
              onClick={() => {
                useCreatorStore.getState().setWorkArea(null, null);
                setWorkAreaMenu(null);
              }}
              className="w-full text-left px-3 py-2 text-white/90 hover:bg-white/10 transition-colors"
            >
              Reset work area
            </button>
          </div>
        )}

      </div>
    </div>
  );
}