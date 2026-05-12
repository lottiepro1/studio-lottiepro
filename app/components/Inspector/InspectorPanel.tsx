'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useCreatorStore } from '@/lib/creator/state/store';
import { getAnchorOffset, getPathLocalBounds, getGroupLocalBounds, getAnimatedAnchor } from '@/lib/creator/core/Matrix';
import { getTextLocalBounds } from '@/lib/creator/text/TextMeasurer';
import { AnimationUtils } from '@/lib/creator/core/Animation';
import { EASING_PRESETS, getEasingPreset, matchPreset } from '@/lib/creator/core/EasingPresets';
import {
  Link2, ChevronRight, ChevronLeft, Settings2, AlignLeft, AlignCenter, AlignRight,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical, Palette, Box, Circle,
  ChevronDown, Activity, Minus, ArrowRight, ArrowLeft, Layers, Sliders, Eye, EyeOff, Plus, Diamond, Trash2
} from 'lucide-react';
import FontPicker from './FontPicker';
import { getAvailableWeights, weightLabel, loadFontCSS } from '@/lib/creator/fonts/GoogleFontsService';
import PaintPopover from './PaintPopover';
import { Gradient, SceneNode } from '@/lib/creator/state/sceneSlice';
import BezierCanvas from '../Timeline/BezierCanvas';
import KeyframeEasingSection from './KeyframeEasingSection';
import DashPopover from './DashPopover';
import StrokeDetailsPopover from './StrokeDetailsPopover';
import EffectPopover from './EffectPopover';
import MiniNumberInput from './MiniNumberInput';

export default function InspectorPanel() {
  const nodes = useCreatorStore((state) => state.nodes);
  const selectedIds = useCreatorStore((state) => state.selectedIds);
  const previewNode = useCreatorStore((state) => state.previewNode);
  const currentTime = useCreatorStore((state) => state.currentTime);
  const setNodeProperty = useCreatorStore((state) => state.setNodeProperty);
  const setNodeProperties = useCreatorStore((state) => state.setNodeProperties);
  const selectedKeyframeIds = useCreatorStore((state) => state.selectedKeyframeIds);
  const updateKeyframe = useCreatorStore((state) => state.updateKeyframe);
  const updateNode = useCreatorStore((state) => state.updateNode);
  const setMatte = useCreatorStore((state) => state.setMatte);
  const activeArtboardId = useCreatorStore((state) => state.activeArtboardId);

  const [matteExpanded, setMatteExpanded] = useState(false);
  const [trimPathExpanded, setTrimPathExpanded] = useState(false);
  const [effectsExpanded, setEffectsExpanded] = useState(false);

  // Get current active artboard or fallback to first one
  const artboard = activeArtboardId ? nodes.get(activeArtboardId) : Array.from(nodes.values()).find(n => n.type === 'artboard');
  const selectedNode = selectedIds.length > 0 ? nodes.get(selectedIds[0]) : (previewNode || (selectedKeyframeIds.length === 0 ? artboard : null));

  if (!selectedNode && selectedKeyframeIds.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 py-12 opacity-40" style={{ background: 'var(--bg-panel)' }}>
        <div className="w-6 h-6 border border-dashed rounded-md" style={{ borderColor: 'var(--text-muted)' }} />
        <p className="text-[11px] text-muted text-center">Select an object to inspect</p>
      </div>
    );
  }

  const handleChange = (path: string, value: any) => {
    const targets = selectedIds.length > 0 ? selectedIds : (previewNode ? [previewNode.id] : []);
    if (targets.length === 0) return;

    // List of properties that should ALWAYS be treated as numbers
    const numericPaths = [
      'transform.x', 'transform.y', 'transform.rotation',
      'transform.scaleX', 'transform.scaleY', 'transform.anchorX', 'transform.anchorY',
      'props.fontSize', 'props.lineHeight', 'props.letterSpacing', 'props.paragraphSpacing',
      'props.width', 'props.height', 'props.radiusX', 'props.radiusY',
      'style.opacity', 'style.strokeWidth', 'style.strokeOpacity',
      'style.trimStart', 'style.trimEnd', 'style.trimOffset'
    ];

    const parsedValue = numericPaths.includes(path)
      ? parseFloat(value) || 0
      : value;

    const isAppearancePath = path.startsWith('style.fill') || path.startsWith('style.stroke');
    const isShapePath = path.startsWith('props.width') || path.startsWith('props.height') || path.startsWith('props.radius') || path.startsWith('props.roundness');
    const isSyncablePath = isAppearancePath || isShapePath;

    const applyRecursive = (nodeId: string, val: any) => {
      const node = nodes.get(nodeId);
      if (!node) return;

      // Apply to the node itself
      setNodeProperty(nodeId, path, val, { recordHistory: false });

      // If it's a group or precomp, propagate style/shape changes to children
      if (isSyncablePath && (node.type === 'group' || node.type === 'precomp')) {
        node.children.forEach(cid => applyRecursive(cid, val));
      }
    };

    useCreatorStore.getState().pushToHistory(`Change ${path.split('.').pop()}`);
    targets.forEach(id => applyRecursive(id, parsedValue));
  };

  const toggleDecoration = (decoration: 'underline' | 'strikethrough') => {
    const targets = selectedIds.length > 0 ? selectedIds : (previewNode ? [previewNode.id] : []);
    if (targets.length === 0) return;
    useCreatorStore.getState().pushToHistory(`Toggle ${decoration}`);
    targets.forEach(id => {
      const node = nodes.get(id);
      if (!node) return;
      const current: string[] = (node.props.textDecoration as string[]) || [];
      const next = current.includes(decoration)
        ? current.filter((d: string) => d !== decoration)
        : [...current, decoration];
      setNodeProperty(id, 'props.textDecoration', next, { recordHistory: false });
    });
  };

  const getCommonValue = (path: string) => {
    const targets = selectedIds.length > 0
      ? selectedIds.map(id => nodes.get(id)).filter(Boolean)
      : (previewNode ? [previewNode] : []);

    if (targets.length === 0) return undefined;

    // For appearance properties, we look at the whole subtree if selection contains groups
    const isAppearancePath = path.startsWith('style.fill') || path.startsWith('style.stroke');
    const isShapePath = path.startsWith('props.width') || path.startsWith('props.height') || path.startsWith('props.radius') || path.startsWith('props.roundness');
    const isSyncablePath = isAppearancePath || isShapePath;

    const getValuesRecursive = (nodeId: string): any[] => {
      const node = nodes.get(nodeId);
      if (!node) return [];

      // Only iterate inner shapes if its a geometric shape path. Appearance should be read natively off groups first.
      if (isShapePath && (node.type === 'group' || node.type === 'precomp')) {
        return node.children.flatMap(getValuesRecursive);
      }

      return [AnimationUtils.getPropertyValue(node, path, currentTime)];
    };

    const values = targets.flatMap(node => getValuesRecursive(node!.id));
    if (values.length === 0) return undefined;

    const first = values[0];
    const isSame = (a: any, b: any) => {
      if (a === b) return true;
      if (typeof a === 'number' && typeof b === 'number' && isNaN(a) && isNaN(b)) return true;
      if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
        // Fast enough for small style objects like gradients/points
        return JSON.stringify(a) === JSON.stringify(b);
      }
      return false;
    };

    if (values.every(v => isSame(v, first))) return first;
    return 'mixed';
  };

  const handleAnchorChange = (preset: 'top-left' | 'top-center' | 'top-right' | 'center-left' | 'center' | 'center-right' | 'bottom-left' | 'bottom-center' | 'bottom-right') => {
    const targets = selectedIds.length > 0 ? selectedIds : (previewNode ? [previewNode.id] : []);
    if (targets.length === 0) return;

    useCreatorStore.getState().pushToHistory('Change Anchor');

    targets.forEach(id => {
      const node = nodes.get(id) || (previewNode?.id === id ? previewNode : null);
      if (!node) return;

      let curW = 0, curH = 0, offX = 0, offY = 0;

      if (node.type === 'path') {
        const points = AnimationUtils.getPropertyValue(node, 'props.points', currentTime);
        const bounds = getPathLocalBounds(points || []);
        curW = bounds.width; curH = bounds.height; offX = bounds.x; offY = bounds.y;
      } else if (node.type === 'group') {
        const lb = getGroupLocalBounds(id, nodes, currentTime);
        curW = lb.width; curH = lb.height; offX = lb.x; offY = lb.y;
      } else if (node.type === 'text') {
        const lb = getTextLocalBounds(node);
        curW = lb.width; curH = lb.height; offX = lb.x; offY = lb.y;
      } else {
        curW = node.type === 'rect' ? AnimationUtils.getPropertyValue(node, 'props.width', currentTime) : (AnimationUtils.getPropertyValue(node, 'props.radiusX', currentTime) * 2);
        curH = node.type === 'rect' ? AnimationUtils.getPropertyValue(node, 'props.height', currentTime) : (AnimationUtils.getPropertyValue(node, 'props.radiusY', currentTime) * 2);
      }

      const newAnchor = { x: 0, y: 0 };
      switch (preset) {
        case 'top-left': newAnchor.x = offX; newAnchor.y = offY; break;
        case 'top-center': newAnchor.x = offX + curW / 2; newAnchor.y = offY; break;
        case 'top-right': newAnchor.x = offX + curW; newAnchor.y = offY; break;
        case 'center-left': newAnchor.x = offX; newAnchor.y = offY + curH / 2; break;
        case 'center': newAnchor.x = offX + curW / 2; newAnchor.y = offY + curH / 2; break;
        case 'center-right': newAnchor.x = offX + curW; newAnchor.y = offY + curH / 2; break;
        case 'bottom-left': newAnchor.x = offX; newAnchor.y = offY + curH; break;
        case 'bottom-center': newAnchor.x = offX + curW / 2; newAnchor.y = offY + curH; break;
        case 'bottom-right': newAnchor.x = offX + curW; newAnchor.y = offY + curH; break;
      }

      const animAnchor = getAnimatedAnchor(node, nodes, currentTime);
      const curTransform = {
        x: AnimationUtils.getPropertyValue(node, 'transform.x', currentTime),
        y: AnimationUtils.getPropertyValue(node, 'transform.y', currentTime),
        rotation: AnimationUtils.getPropertyValue(node, 'transform.rotation', currentTime),
        scaleX: AnimationUtils.getPropertyValue(node, 'transform.scaleX', currentTime),
        scaleY: AnimationUtils.getPropertyValue(node, 'transform.scaleY', currentTime),
        anchorX: animAnchor.x,
        anchorY: animAnchor.y,
      };

      const offset = getAnchorOffset(
        { x: curTransform.anchorX, y: curTransform.anchorY },
        newAnchor,
        curTransform as any
      );

      // Text nodes store a raw pixel anchor — no anchorAlignX/Y — because
      // their bounding box changes as text is typed and a dynamic ratio would drift.
      if (node.type === 'text') {
        setNodeProperties(id, {
          'transform.x': curTransform.x + offset.dx,
          'transform.y': curTransform.y + offset.dy,
          'transform.anchorX': newAnchor.x,
          'transform.anchorY': newAnchor.y,
        }, { ignoreAnimation: true });
      } else {
        const align = { x: 0, y: 0 };
        switch (preset) {
          case 'top-left': align.x = 0; align.y = 0; break;
          case 'top-center': align.x = 0.5; align.y = 0; break;
          case 'top-right': align.x = 1; align.y = 0; break;
          case 'center-left': align.x = 0; align.y = 0.5; break;
          case 'center': align.x = 0.5; align.y = 0.5; break;
          case 'center-right': align.x = 1; align.y = 0.5; break;
          case 'bottom-left': align.x = 0; align.y = 1; break;
          case 'bottom-center': align.x = 0.5; align.y = 1; break;
          case 'bottom-right': align.x = 1; align.y = 1; break;
        }
        setNodeProperties(id, {
          'transform.x': curTransform.x + offset.dx,
          'transform.y': curTransform.y + offset.dy,
          'transform.anchorX': newAnchor.x,
          'transform.anchorY': newAnchor.y,
          'transform.anchorAlignX': align.x,
          'transform.anchorAlignY': align.y
        }, { ignoreAnimation: true });
      }
    });
  };

  const handleAddEffect = (type: 'shadow' | 'blur' | 'repeater' | 'offset-path') => {
    if (!selectedNode) return;
    const currentEffects = (selectedNode.style.effects || []);
    
    let newEffect: any = {
      id: Math.random().toString(36).substr(2, 9),
      type,
      name: type === 'shadow' ? 'Drop Shadow' : (type === 'blur' ? 'Blur' : (type === 'repeater' ? 'Repeater' : 'Offset Path')),
      visible: true,
    };

    if (type === 'shadow') {
      newEffect.color = '#000000';
      newEffect.opacity = 0.5;
      newEffect.distance = 10;
      newEffect.direction = 90;
      newEffect.blur = 10;
    } else if (type === 'blur') {
      newEffect.blur = 20;
    } else if (type === 'repeater') {
      newEffect.copies = 3;
      newEffect.offset = 0;
      newEffect.repeaterTransform = { x: 100, y: 0, scaleX: 1, scaleY: 1, rotation: 0, startOpacity: 1, endOpacity: 1 };
    } else if (type === 'offset-path') {
      newEffect.amount = 10;
      newEffect.linejoin = 'round';
    }

    setNodeProperty(selectedNode.id, 'style.effects', [...currentEffects, newEffect], { recordHistory: true });
    setEffectsExpanded(true); // Ensure expanded when adding
  };

  const handleToggleEffect = (id: string) => {
    if (!selectedNode) return;
    const nextEffects = (selectedNode.style.effects || []).map(e =>
      e.id === id ? { ...e, visible: !e.visible } : e
    );
    setNodeProperty(selectedNode.id, 'style.effects', nextEffects, { recordHistory: true });
  };

  const handleRemoveEffect = (id: string) => {
    if (!selectedNode) return;
    const nextEffects = (selectedNode.style.effects || []).filter(e => e.id !== id);
    setNodeProperty(selectedNode.id, 'style.effects', nextEffects, { recordHistory: true });
  };

  const handleEffectChange = (id: string, updates: any) => {
    if (!selectedNode) return;
    const nextEffects = (selectedNode.style.effects || []).map(e =>
      e.id === id ? { ...e, ...updates } : e
    );
    setNodeProperty(selectedNode.id, 'style.effects', nextEffects, { recordHistory: true });
  };

  const isAnchorSelected = (preset: string) => {
    if (!selectedNode) return false;

    // Check by alignment flags first (more robust for animations)
    const alignX = getCommonValue('transform.anchorAlignX');
    const alignY = getCommonValue('transform.anchorAlignY');

    if (alignX !== 'mixed' && alignY !== 'mixed' && alignX !== undefined && alignY !== undefined) {
      let currentAlign: { x: number, y: number } = { x: -1, y: -1 };
      switch (preset) {
        case 'top-left': currentAlign = { x: 0, y: 0 }; break;
        case 'top-center': currentAlign = { x: 0.5, y: 0 }; break;
        case 'top-right': currentAlign = { x: 1, y: 0 }; break;
        case 'center-left': currentAlign = { x: 0, y: 0.5 }; break;
        case 'center': currentAlign = { x: 0.5, y: 0.5 }; break;
        case 'center-right': currentAlign = { x: 1, y: 0.5 }; break;
        case 'bottom-left': currentAlign = { x: 0, y: 1 }; break;
        case 'bottom-center': currentAlign = { x: 0.5, y: 1 }; break;
        case 'bottom-right': currentAlign = { x: 1, y: 1 }; break;
      }
      if (alignX === currentAlign.x && alignY === currentAlign.y) return true;
      return false; // If alignment is set but doesn't match, it's NOT this preset
    }

    // Fallback to pixel check (for static/legacy nodes)
    const ax = getCommonValue('transform.anchorX');
    const ay = getCommonValue('transform.anchorY');
    if (ax === 'mixed' || ay === 'mixed') return false;

    let width = 0, height = 0, offX = 0, offY = 0;
    if (selectedNode.type === 'rect' || selectedNode.type === 'artboard') {
      width = AnimationUtils.getPropertyValue(selectedNode, 'props.width', currentTime);
      height = AnimationUtils.getPropertyValue(selectedNode, 'props.height', currentTime);
    } else if (selectedNode.type === 'ellipse') {
      width = AnimationUtils.getPropertyValue(selectedNode, 'props.radiusX', currentTime) * 2;
      height = AnimationUtils.getPropertyValue(selectedNode, 'props.radiusY', currentTime) * 2;
    } else if (selectedNode.type === 'path') {
      const points = AnimationUtils.getPropertyValue(selectedNode, 'props.points', currentTime);
      const bounds = getPathLocalBounds(points || []);
      width = bounds.width; height = bounds.height; offX = bounds.x; offY = bounds.y;
    } else if (selectedNode.type === 'group') {
      const lb = getGroupLocalBounds(selectedNode.id, nodes, currentTime);
      width = lb.width; height = lb.height; offX = lb.x; offY = lb.y;
    } else if (selectedNode.type === 'text') {
      const lb = getTextLocalBounds(selectedNode);
      width = lb.width; height = lb.height; offX = lb.x; offY = lb.y;
    }

    const target = { x: 0, y: 0 };
    switch (preset) {
      case 'top-left': target.x = offX; target.y = offY; break;
      case 'top-center': target.x = offX + width / 2; target.y = offY; break;
      case 'top-right': target.x = offX + width; target.y = offY; break;
      case 'center-left': target.x = offX; target.y = offY + height / 2; break;
      case 'center': target.x = offX + width / 2; target.y = offY + height / 2; break;
      case 'center-right': target.x = offX + width; target.y = offY + height / 2; break;
      case 'bottom-left': target.x = offX; target.y = offY + height; break;
      case 'bottom-center': target.x = offX + width / 2; target.y = offY + height; break;
      case 'bottom-right': target.x = offX + width; target.y = offY + height; break;
    }

    return Math.abs((ax as number) - target.x) < 0.1 &&
      Math.abs((ay as number) - target.y) < 0.1;
  };

  const renderNumberInput = (path: string, options: { step?: number, min?: number, max?: number, prefix?: string, displayFactor?: number, defaultValue?: number, targetId?: string } = {}) => {
    const { step = 1, min, max, prefix, displayFactor = 1, defaultValue = 0, targetId: overrideTargetId } = options;
    let val = overrideTargetId ? AnimationUtils.getPropertyValue(nodes.get(overrideTargetId)!, path, currentTime) : getCommonValue(path);
    if (val === undefined) val = defaultValue;
    const isMixed = val === 'mixed';

    return (
      <MiniNumberInput
        path={path}
        value={val}
        isMixed={isMixed}
        step={step}
        min={min}
        max={max}
        prefix={prefix}
        displayFactor={displayFactor}
        onChange={(newVal: number, recordHistory?: boolean) => {
          const targets = overrideTargetId ? [overrideTargetId] : (selectedIds.length > 0 ? selectedIds : (previewNode ? [previewNode.id] : []));
          targets.forEach(targetId => {
            setNodeProperty(targetId, path, newVal, { recordHistory });
          });
        }}
      />
    );
  };

  const getUniqueColors = (path: string) => {
    const targets = selectedIds.length > 0
      ? selectedIds.map(id => nodes.get(id)).filter(Boolean)
      : (previewNode ? [previewNode] : []);

    const colors = new Set<string>();

    const collectColors = (node: SceneNode) => {
      if (node.type === 'group' || node.type === 'precomp') {
        node.children.forEach((childId: string) => {
          const child = nodes.get(childId);
          if (child) collectColors(child);
        });
      } else {
        const val = AnimationUtils.getPropertyValue(node, path, currentTime);
        if (typeof val === 'string' && val.startsWith('#')) {
          colors.add(val.toUpperCase());
        }
      }
    };

    targets.forEach(node => collectColors(node as SceneNode));
    return Array.from(colors);
  };

  const replaceColorInSelection = (path: string, oldColor: string, newColor: string) => {
    const targets = selectedIds.length > 0 ? selectedIds : (previewNode ? [previewNode.id] : []);

    // We don't push to history on every drag frame, handled by PaintPopover's close or initial click
    // But for safety, the caller should handle pushToHistory.

    const updateRecursive = (nodeId: string) => {
      const node = nodes.get(nodeId);
      if (!node) return;

      if (node.type === 'group' || node.type === 'precomp') {
        const val = AnimationUtils.getPropertyValue(node, path, currentTime);
        if (typeof val === 'string' && val.toUpperCase() === oldColor.toUpperCase()) {
          setNodeProperty(nodeId, path, newColor, { recordHistory: false });
        }
        node.children.forEach(updateRecursive);
      } else {
        const val = AnimationUtils.getPropertyValue(node, path, currentTime);
        if (typeof val === 'string' && val.toUpperCase() === oldColor.toUpperCase()) {
          setNodeProperty(nodeId, path, newColor, { recordHistory: false });
        }
      }
    };

    targets.forEach(updateRecursive);
  };

  const renderColorInput = (label: string, path: string) => {
    const val = getCommonValue(path);
    const isMixed = val === 'mixed';

    return (
      <div className="flex flex-col gap-1 w-full">
        <label className="text-[10px] text-muted uppercase tracking-wider mb-0.5">{label}</label>
        <div className="flex gap-2">
          <div className="relative w-10 h-8 rounded-md bg-surface border border-white/[0.06] hover:border-white/10 transition-all overflow-hidden cursor-pointer group shadow-sm">
            <input
              type="color"
              value={(isMixed || !val) ? "#000000" : (val as string || '#000000')}
              onChange={(e) => handleChange(path, e.target.value)}
              className="absolute inset-[-4px] w-[calc(100%+8px)] h-[calc(100%+8px)] bg-transparent border-none cursor-pointer"
            />
          </div>
          <input
            type="text"
            placeholder={isMixed ? "Mixed" : ""}
            value={isMixed ? "" : (val as string || '')}
            onChange={(e) => handleChange(path, e.target.value)}
            className={`flex-1 bg-surface border ${isMixed ? 'border-orange-500/30' : 'border-white/[0.06]'} rounded-md px-2 py-1 text-[11px] font-mono font-bold text-white/70 uppercase outline-none focus:border-accent/50 hover:border-white/10 transition-all shadow-sm`}
          />
        </div>
      </div>
    );
  };

  const renderStopwatch = (nodeId: string, path: string) => {
    return <StopwatchButton nodeId={nodeId} path={path} />;
  };

  const renderPaintRow = (label: string, colorPath: string, typePath: string, gradientPath: string, opacityPath?: string, visibilityPath?: string) => {
    // Compute shape dimensions so PaintPopover can create a shape-covering gradient default
    const nodeSize = (() => {
      if (!selectedNode) return undefined;
      if (selectedNode.type === 'rect') return { width: selectedNode.props?.width || 100, height: selectedNode.props?.height || 100 };
      if (selectedNode.type === 'ellipse') return { width: (selectedNode.props?.radiusX || 50) * 2, height: (selectedNode.props?.radiusY || 50) * 2 };
      return undefined;
    })();

    const uniqueColors = getUniqueColors(colorPath);
    const colorValue = getCommonValue(colorPath);
    const typeValue = getCommonValue(typePath) as any;

    const isMixedType = typeValue === 'mixed';
    const isMixedColor = colorValue === 'mixed' || uniqueColors.length > 1;
    const isMixed = isMixedType || isMixedColor;

    // For the picker, if it's mixed, we pick the first child color or a fallback
    const pickerColor = colorValue === 'mixed' ? (uniqueColors[0] || '#FF335A') : (colorValue as string || '#FF335A');

    let type: 'solid' | 'gradient' = (typeValue === 'mixed' || !typeValue) ? 'solid' : typeValue;
    const gradient = getCommonValue(gradientPath) as Gradient;
    const fillValue = getCommonValue(opacityPath || '');
    const fillOpacity = fillValue === 'mixed' ? 'mixed' : (fillValue as number ?? 1);
    const isVisible = (getCommonValue(visibilityPath || '') as boolean) ?? true;

    const hasValue = colorValue !== undefined || gradient !== undefined || uniqueColors.length > 0;

    const getPreviewBackground = () => {
      if (isMixed) return 'conic-gradient(#333 90deg, #444 90deg 180deg, #333 180deg 270deg, #444 270deg)';
      if (type === 'solid') return colorValue as string;
      const sorted = [...(gradient?.stops || [])].sort((a, b) => a.offset - b.offset);
      const stops = sorted.map(s => `${s.color} ${s.offset * 100}%`).join(', ');
      return `linear-gradient(to right, ${stops})`;
    };

    const getLabelText = () => {
      if (isMixed) return 'Mixed Colors';
      if (type === 'solid') return (colorValue as string)?.toUpperCase() || '';
      return (gradient?.type === 'linear' ? 'Linear' : 'Radial');
    };

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-[10px] text-muted uppercase tracking-wider">{label}</label>
          <div className="flex items-center gap-1.5">
            {label === 'Stroke' && (
              <StrokeDetailsPopover
                linecap={getCommonValue('style.strokeLinecap') as string}
                linejoin={getCommonValue('style.strokeLinejoin') as string}
                onChange={handleChange}
                trigger={
                  <button className="p-1 hover:bg-hover rounded-md text-white/20 hover:text-white/60 transition-all">
                    <Sliders size={12} />
                  </button>
                }
              />
            )}
            {!hasValue && (
              <button
                onClick={() => {
                  const isStroke = label === 'Stroke';
                  selectedIds.forEach(id => {
                    const defaultColor = isStroke ? '#E62E51' : '#FF335A';
                    handleChange(colorPath, defaultColor);
                    if (isStroke) {
                      handleChange('style.strokeWidth', 2);
                    }
                    if (visibilityPath) handleChange(visibilityPath, true);
                    if (opacityPath) handleChange(opacityPath, 1);
                  });
                }}
                className="p-1 hover:bg-hover rounded-md text-white/20 hover:text-white/60 transition-all"
              >
                <Plus size={14} />
              </button>
            )}
          </div>
        </div>

        {hasValue && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 group">
              <PaintPopover
                type={type}
                color={pickerColor}
                gradient={gradient}
                groupColors={uniqueColors}
                nodeSize={nodeSize}
                onChange={(updates) => {
                  if (updates.originalColor && updates.color) {
                    replaceColorInSelection(colorPath, updates.originalColor, updates.color);
                  } else {
                    if (updates.type) handleChange(typePath, updates.type);
                    if (updates.color) handleChange(colorPath, updates.color);
                    if (updates.gradient) handleChange(gradientPath, updates.gradient);
                  }
                }}
                trigger={
                  <div className="flex-1 flex items-center gap-2.5 bg-surface border border-white/[0.06] hover:border-white/10 rounded-lg p-1.5 transition-all text-left outline-none  cursor-pointer">
                    <div
                      className="w-6 h-6 rounded-md border border-white/[0.06] flex-shrink-0"
                      style={{ background: getPreviewBackground(), opacity: isVisible ? 1 : 0.3 }}
                    />
                    <span className={`flex-1 text-[11px] truncate ${isVisible ? 'text-secondary' : 'text-muted line-through'}`}>
                      {getLabelText()}
                    </span>
                    <div className="w-px h-3 bg-white/10" />
                    {selectedNode && renderStopwatch(selectedNode.id, type === 'solid' ? colorPath : gradientPath)}
                  </div>
                }
              />
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                {visibilityPath && (
                  <button
                    onClick={() => handleChange(visibilityPath, !isVisible)}
                    className={`p-1.5 hover:bg-hover rounded-md transition-all ${isVisible ? 'text-white/20 hover:text-white/60' : 'text-accent'}`}
                  >
                    {isVisible ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                )}
                <button
                  onClick={() => {
                    selectedIds.forEach(id => {
                      handleChange(colorPath, undefined);
                      handleChange(typePath, undefined);
                      if (gradientPath) handleChange(gradientPath, undefined);
                    });
                  }}
                  className="p-1.5 hover:bg-hover rounded-md text-white/20 hover:text-white/60 transition-all"
                >
                  <Minus size={14} />
                </button>
              </div>
            </div>

            {/* Opacity Row */}
            {opacityPath && isVisible && (
              <div className="flex items-center gap-2">
                <div className="w-[120px] bg-surface border border-white/[0.06] hover:border-white/10 rounded-lg p-1.5 flex items-center gap-2 transition-all">
                  <Layers size={13} className="text-white/20" />
                  <input
                    type="text"
                    value={fillOpacity === 'mixed' ? '' : String(Math.round((Number(fillOpacity) || 0) * 100))}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      if (!isNaN(val)) handleChange(opacityPath, val / 100);
                    }}
                    className="flex-1 bg-transparent border-none text-[11px] font-bold text-white/60 outline-none w-8"
                  />
                  <span className="text-[10px] text-white/20 font-bold mr-1">%</span>
                  <div className="w-px h-3 bg-white/10" />
                  {selectedNode && renderStopwatch(selectedNode.id, opacityPath)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const hasSelectionType = (type: string) => {
    const targets = selectedIds.length > 0 ? selectedIds.map(id => nodes.get(id)) : (previewNode ? [previewNode] : []);
    return targets.some(node => node?.type === type);
  };

  const isRectOrEllipseOrPath = hasSelectionType('rect') || hasSelectionType('ellipse') || hasSelectionType('path') || hasSelectionType('polystar') || hasSelectionType('precomp') || hasSelectionType('group') || hasSelectionType('image');

  // The user explicitly requested that shapes inside groups should have their properties exposed
  // so they can be individually styled and animated (like in After Effects and LottieFiles).
  const isOnlyPrimitivesSelected = false;

  return (
    <div className="w-80 h-full bg-transparent flex flex-col overflow-y-auto custom-scrollbar select-none pb-12 min-h-0">
      {/* Header - Solid background for visual consistency */}
      <div className="h-10 px-3 border-b border-white/[0.06] flex items-center justify-between shrink-0 sticky top-0 z-20" style={{ background: 'var(--bg-panel)' }}>
        <div className="flex flex-col">
          <h2 className="text-xs font-medium text-secondary">{selectedKeyframeIds.length > 0 ? 'Animation' : 'Properties'}</h2>
          {selectedNode && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-white/80 tracking-tight">{selectedNode.name}</span>
            </div>
          )}
        </div>
        {selectedNode && (
          <div className={`w-6 h-6 rounded-md flex items-center justify-center bg-white/5 border border-white/[0.06] text-white/40 text-[10px]`}>
            {selectedNode.type === 'rect' ? '■' : selectedNode.type === 'ellipse' ? '●' : selectedNode.type === 'artboard' ? '回' : selectedNode.type === 'text' ? 'T' : '⦽'}
          </div>
        )}
      </div>

      {/* Alignment Bar */}
      {selectedIds.length > 0 && isRectOrEllipseOrPath && (
        <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between bg-black/10">
          <div className="flex items-center gap-1">
            <button
              onClick={() => useCreatorStore.getState().alignSelectedNodes('left')}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-hover text-white/40 hover:text-white/80 transition-all"
              title="Align Left"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 2V12" />
                <path d="M5 4H12" />
                <path d="M5 10H9" />
              </svg>
            </button>
            <button
              onClick={() => useCreatorStore.getState().alignSelectedNodes('center-h')}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-hover text-white/40 hover:text-white/80 transition-all"
              title="Align Horizontal Center"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 1V13" />
                <path d="M3 4H11" />
                <path d="M4 10H10" />
              </svg>
            </button>
            <button
              onClick={() => useCreatorStore.getState().alignSelectedNodes('right')}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-hover text-white/40 hover:text-white/80 transition-all"
              title="Align Right"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2V12" />
                <path d="M2 4H9" />
                <path d="M5 10H9" />
              </svg>
            </button>
          </div>

          <div className="w-[1px] h-4 bg-white/5 mx-1" />

          <div className="flex items-center gap-1">
            <button
              onClick={() => useCreatorStore.getState().alignSelectedNodes('top')}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-hover text-white/40 hover:text-white/80 transition-all"
              title="Align Top"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 2H12" />
                <path d="M4 5V12" />
                <path d="M10 5V9" />
              </svg>
            </button>
            <button
              onClick={() => useCreatorStore.getState().alignSelectedNodes('center-v')}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-hover text-white/40 hover:text-white/80 transition-all"
              title="Align Vertical Center"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 7H13" />
                <path d="M4 3V11" />
                <path d="M10 4V10" />
              </svg>
            </button>
            <button
              onClick={() => useCreatorStore.getState().alignSelectedNodes('bottom')}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-hover text-white/40 hover:text-white/80 transition-all"
              title="Align Bottom"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12H12" />
                <path d="M4 2V9" />
                <path d="M10 5V9" />
              </svg>
            </button>
          </div>

          <div className="w-[1px] h-4 bg-white/5 mx-1" />

          <div className="flex items-center gap-1">
            <button
              onClick={() => useCreatorStore.getState().distributeSelectedNodes('horizontal')}
              disabled={selectedIds.length < 3}
              className={`w-7 h-7 flex items-center justify-center rounded-md transition-all ${selectedIds.length < 3 ? 'opacity-30 cursor-not-allowed' : 'hover:bg-hover text-white/40 hover:text-white/80'}`}
              title="Distribute Horizontal Space"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 2V12" />
                <path d="M12 2V12" />
                <rect x="5.5" y="4" width="3" height="6" rx="0.5" />
              </svg>
            </button>
            <button
              onClick={() => useCreatorStore.getState().distributeSelectedNodes('vertical')}
              disabled={selectedIds.length < 3}
              className={`w-7 h-7 flex items-center justify-center rounded-md transition-all ${selectedIds.length < 3 ? 'opacity-30 cursor-not-allowed' : 'hover:bg-hover text-white/40 hover:text-white/80'}`}
              title="Distribute Vertical Space"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 2H12" />
                <path d="M2 12H12" />
                <rect x="4" y="5.5" width="6" height="3" rx="0.5" />
              </svg>
            </button>
          </div>
        </div>
      )}


      {/* Keyframe Easing Section - Appears at TOP when keyframes are selected */}
      <KeyframeEasingSection />

      {selectedNode && selectedNode.type !== 'artboard' && (
        <>
          {/* Transform Section */}
          <div className="p-4 border-b border-white/[0.06] space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-semibold text-muted uppercase tracking-widest">Transform</h3>
              {/* Anchor Grid */}
              <div className="grid grid-cols-3 gap-[1.5px] bg-white/[0.02] p-[2px] rounded border border-white/[0.06]">
                {['top-left', 'top-center', 'top-right',
                  'center-left', 'center', 'center-right',
                  'bottom-left', 'bottom-center', 'bottom-right'].map((p) => (
                    <button
                      key={p}
                      onClick={() => handleAnchorChange(p as any)}
                      className={`w-2.5 h-2.5 rounded-[1px] transition-all ${isAnchorSelected(p)
                        ? 'bg-accent'
                        : 'bg-white/5 hover:bg-white/20'
                        }`}
                      title={p.replace('-', ' ')}
                    />
                  ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">Position</label>
                <div className="flex items-center bg-surface border border-white/[0.06] hover:border-white/10 rounded-xl px-1 h-9 transition-all group/pod">
                  {renderNumberInput('transform.x', { prefix: 'X' })}
                  <div className="w-px h-3 bg-white/5 mx-1" />
                  {renderNumberInput('transform.y', { prefix: 'Y' })}
                  {selectedNode && (
                    <>
                      <div className="w-[1px] h-3 bg-white/10 mx-1" />
                      <MultiStopwatchButton nodeId={selectedNode.id} paths={['transform.x', 'transform.y']} />
                    </>
                  )}
                </div>
              </div>

              {!isOnlyPrimitivesSelected && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">Scale</label>
                    <div className="flex items-center bg-surface border border-white/[0.06] hover:border-white/10 rounded-xl px-1 h-9 transition-all group/pod">
                      {renderNumberInput('transform.scaleX', { prefix: 'W', displayFactor: 100 })}
                      <button
                        onClick={() => setNodeProperty(selectedNode.id, 'transform.scaleLink', !selectedNode.transform?.scaleLink)}
                        className={`p-1 mx-0.5 rounded transition-colors ${selectedNode.transform?.scaleLink ? 'text-accent bg-accent/15' : 'text-white/10 hover:text-white/30'}`}
                      >
                        <Link2 size={12} />
                      </button>
                      {renderNumberInput('transform.scaleY', { prefix: 'H', displayFactor: 100 })}
                      {selectedNode && (
                        <>
                          <div className="w-[1px] h-3 bg-white/10 mx-1" />
                          <MultiStopwatchButton nodeId={selectedNode.id} paths={['transform.scaleX', 'transform.scaleY']} />
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="flex-1 space-y-1.5">
                      <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">Rotation</label>
                      <div className="flex items-center bg-surface border border-white/[0.06] hover:border-white/10 rounded-xl px-1 h-9 transition-all group/pod">
                        {renderNumberInput('transform.rotation', { prefix: '°', step: 1 })}
                        {selectedNode && (
                          <>
                            <div className="w-[1px] h-3 bg-white/10 mx-1" />
                            <StopwatchButton nodeId={selectedNode.id} path="transform.rotation" />
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex-1 space-y-1.5">
                      <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">Opacity</label>
                      <div className="flex items-center bg-surface border border-white/[0.06] hover:border-white/10 rounded-xl px-1 h-9 transition-all group/pod">
                        {renderNumberInput('style.opacity', { prefix: '%', step: 1.0, min: 0, max: 1, displayFactor: 100 })}
                        {selectedNode && (
                          <>
                            <div className="w-[1px] h-3 bg-white/10 mx-1" />
                            <StopwatchButton nodeId={selectedNode.id} path="style.opacity" />
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">Blend Mode</label>
                    <div className="flex items-center bg-surface border border-white/[0.06] hover:border-white/10 rounded-xl px-2 h-9 transition-all group/pod">
                      <select
                        value={getCommonValue('style.blendMode') || 'normal'}
                        onChange={(e) => handleChange('style.blendMode', e.target.value)}
                        className="flex-1 bg-transparent border-none text-[11px] font-bold text-white/60 outline-none cursor-pointer appearance-none capitalize"
                      >
                        {['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'].map(mode => (
                          <option key={mode} value={mode} className="bg-surface capitalize">{mode}</option>
                        ))}
                      </select>
                      <ChevronDown size={12} className="text-white/20 pointer-events-none" />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Boolean Operations Section - Only when 2+ shapes selected */}
          {selectedIds.length >= 2 && (
            <div className="p-4 border-b border-white/[0.06] space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[10px] font-semibold text-muted uppercase tracking-widest">Boolean Operations</h3>
                <Activity size={12} className="text-white/20" />
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { id: 'union', label: 'Union', icon: '∪' },
                  { id: 'subtract', label: 'Subtract', icon: '−' },
                  { id: 'intersect', label: 'Intersect', icon: '∩' },
                  { id: 'exclude', label: 'Exclude', icon: '⊞' },
                ].map((op) => (
                  <button
                    key={op.id}
                    onClick={() => {
                      useCreatorStore.getState().applyBooleanOperation(selectedIds, op.id as any);
                    }}
                    className="flex flex-col items-center gap-1.5 p-2 rounded transition-all group border bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.05] hover:border-white/10"
                    title={op.label}
                  >
                    <span className="text-xl transition-colors leading-none text-white/40 group-hover:text-white/80">{op.icon}</span>
                    <span className="text-[8px] font-bold uppercase tracking-tighter truncate w-full text-center text-white/10 group-hover:text-white/30">{op.label}</span>
                  </button>
                ))}
              </div>
              <p className="text-[9px] text-white/20 text-center">Select 2+ shapes to merge into a path</p>
            </div>
          )}

          {/* Shape Properties Section */}
          {isRectOrEllipseOrPath && (
            <div className="p-4 border-b border-white/[0.06] space-y-6">
              <h3 className="text-[10px] font-semibold text-muted uppercase tracking-widest">Shape</h3>

              <div className="space-y-4">
                {(hasSelectionType('rect') || hasSelectionType('group') || hasSelectionType('path') || hasSelectionType('precomp')) && (
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">Size</label>
                      <div className="flex items-center bg-surface border border-white/[0.06] hover:border-white/10 rounded-xl px-1 h-9 transition-all group/pod">
                        {renderNumberInput('props.width', { prefix: 'W' })}
                        <button
                          onClick={() => setNodeProperty(selectedNode.id, 'transform.scaleLink', !selectedNode.transform.scaleLink)}
                          className={`p-1 mx-0.5 rounded transition-colors ${selectedNode.transform.scaleLink ? 'text-accent bg-accent/15' : 'text-white/10 hover:text-white/30'}`}
                        >
                          <Link2 size={12} />
                        </button>
                        {renderNumberInput('props.height', { prefix: 'H' })}
                        {selectedNode && (
                          <>
                            <div className="w-[1px] h-3 bg-white/10 mx-1" />
                            <MultiStopwatchButton nodeId={selectedNode.id} paths={['props.width', 'props.height']} />
                          </>
                        )}
                      </div>
                    </div>

                    {(hasSelectionType('rect') || hasSelectionType('path')) && (
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">Roundness</label>
                        <div className="flex items-center bg-surface border border-white/[0.06] hover:border-white/10 rounded-xl px-1 h-9 transition-all group/pod">
                          {renderNumberInput('props.roundness', { step: 1, min: 0 })}
                          {selectedNode && (
                            <>
                              <div className="w-[1px] h-3 bg-white/10 mx-1" />
                              <StopwatchButton nodeId={selectedNode.id} path="props.roundness" />
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {hasSelectionType('ellipse') && (
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">Radius</label>
                    <div className="flex items-center bg-surface border border-white/[0.06] hover:border-white/10 rounded-xl px-1 h-9 transition-all group/pod">
                      {renderNumberInput('props.radiusX', { prefix: 'X', displayFactor: 2 })}
                      <div className="w-px h-3 bg-white/5 mx-1" />
                      {renderNumberInput('props.radiusY', { prefix: 'Y', displayFactor: 2 })}
                      {selectedNode && (
                        <>
                          <div className="w-[1px] h-3 bg-white/10 mx-1" />
                          <MultiStopwatchButton nodeId={selectedNode.id} paths={['props.radiusX', 'props.radiusY']} />
                        </>
                      )}
                    </div>
                  </div>
                )}

                {hasSelectionType('polystar') && (
                  <div className="space-y-4 pt-4 border-t border-white/[0.06]">
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">Type</label>
                      <div className="flex items-center bg-surface border border-white/[0.06] hover:border-white/10 rounded-xl px-2 h-9 transition-all group/pod">
                        <select
                          value={getCommonValue('props.starType') || 'star'}
                          onChange={(e) => handleChange('props.starType', e.target.value)}
                          className="flex-1 bg-transparent border-none text-[11px] font-bold text-white/60 outline-none cursor-pointer appearance-none capitalize"
                        >
                          <option value="star" className="bg-surface">Star</option>
                          <option value="polygon" className="bg-surface">Polygon</option>
                        </select>
                        <ChevronDown size={12} className="text-white/20 pointer-events-none" />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">Points</label>
                      <div className="flex items-center bg-surface border border-white/[0.06] hover:border-white/10 rounded-xl px-1 h-9 transition-all group/pod">
                        {renderNumberInput('props.points', { step: 1, min: 3 })}
                        {selectedNode && (
                          <>
                            <div className="w-[1px] h-3 bg-white/10 mx-1" />
                            <StopwatchButton nodeId={selectedNode.id} path="props.points" />
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2">
                        <div className="flex-1 space-y-1.5">
                            <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">Inner Radius</label>
                            <div className="flex items-center bg-surface border border-white/[0.06] hover:border-white/10 rounded-xl px-1 h-9 transition-all group/pod">
                                {renderNumberInput('props.innerRadius', { min: 0 })}
                                {selectedNode && (
                                    <>
                                        <div className="w-[1px] h-3 bg-white/10 mx-1" />
                                        <StopwatchButton nodeId={selectedNode.id} path="props.innerRadius" />
                                    </>
                                )}
                            </div>
                        </div>
                        <div className="flex-1 space-y-1.5">
                            <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">Outer Radius</label>
                            <div className="flex items-center bg-surface border border-white/[0.06] hover:border-white/10 rounded-xl px-1 h-9 transition-all group/pod">
                                {renderNumberInput('props.outerRadius', { min: 0 })}
                                {selectedNode && (
                                    <>
                                        <div className="w-[1px] h-3 bg-white/10 mx-1" />
                                        <StopwatchButton nodeId={selectedNode.id} path="props.outerRadius" />
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <div className="flex-1 space-y-1.5">
                            <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">Inner Rounding</label>
                            <div className="flex items-center bg-surface border border-white/[0.06] hover:border-white/10 rounded-xl px-1 h-9 transition-all group/pod">
                                {renderNumberInput('props.innerRoundness', { min: 0 })}
                                {selectedNode && (
                                    <>
                                        <div className="w-[1px] h-3 bg-white/10 mx-1" />
                                        <StopwatchButton nodeId={selectedNode.id} path="props.innerRoundness" />
                                    </>
                                )}
                            </div>
                        </div>
                        <div className="flex-1 space-y-1.5">
                            <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">Outer Rounding</label>
                            <div className="flex items-center bg-surface border border-white/[0.06] hover:border-white/10 rounded-xl px-1 h-9 transition-all group/pod">
                                {renderNumberInput('props.outerRoundness', { min: 0 })}
                                {selectedNode && (
                                    <>
                                        <div className="w-[1px] h-3 bg-white/10 mx-1" />
                                        <StopwatchButton nodeId={selectedNode.id} path="props.outerRoundness" />
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Text Properties Section */}
          {hasSelectionType('text') && (
            <div className="p-4 border-b border-white/[0.06] space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-[10px] font-semibold text-muted uppercase tracking-widest">Text</h3>
                <Settings2 size={12} className="text-white/20" />
              </div>

              <div className="space-y-4">
                {/* Font Family */}
                <div className="space-y-1.5">
                  <FontPicker
                    value={getCommonValue('props.fontFamily') || 'Open Sans'}
                    onChange={(font) => {
                      handleChange('props.fontFamily', font);
                      loadFontCSS(font);
                    }}
                  />
                </div>

                <div className="flex gap-2">
                  {/* Font Weight — named dropdown for all fonts (variable and discrete) */}
                  {(() => {
                    const currentFamily = getCommonValue('props.fontFamily') || 'Open Sans';
                    const currentWeight = getCommonValue('props.fontWeight') || '400';
                    const available = getAvailableWeights(currentFamily);
                    const clampedWeight = available.includes(currentWeight)
                      ? currentWeight
                      : (available.reduce((best, w) =>
                          Math.abs(Number(w) - Number(currentWeight)) < Math.abs(Number(best) - Number(currentWeight)) ? w : best,
                          available[0] ?? '400'));
                    return (
                      <div className="flex-1 space-y-1.5">
                        <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">Weight</label>
                        <div className="flex items-center bg-surface border border-white/[0.06] hover:border-white/10 rounded-xl px-2 h-9 transition-all group/pod">
                          <select
                            value={clampedWeight}
                            onChange={e => {
                              handleChange('props.fontWeight', e.target.value);
                              loadFontCSS(currentFamily);
                            }}
                            className="flex-1 bg-transparent border-none text-[11px] font-medium text-white/70 outline-none cursor-pointer appearance-none"
                          >
                            {available.map(w => (
                              <option key={w} value={w} className="bg-surface">{weightLabel(w)}</option>
                            ))}
                          </select>
                          <ChevronDown size={12} className="text-white/20 pointer-events-none" />
                        </div>
                      </div>
                    );
                  })()}

                  {/* Font Size */}
                  <div className="w-24 space-y-1.5">
                    <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">Size</label>
                    <div className="flex items-center bg-surface border border-white/[0.06] hover:border-white/10 rounded-xl px-1 h-9 transition-all group/pod">
                      {renderNumberInput('props.fontSize', { prefix: 'TS', min: 1 })}
                    </div>
                  </div>
                </div>

                {/* Row: Line Height + Letter Spacing */}
                <div className="flex gap-2">
                  <div className="flex-1 space-y-1.5">
                    <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">Line Height</label>
                    <div className="flex items-center bg-surface border border-white/[0.06] hover:border-white/10 rounded-xl px-1 h-9 transition-all group/pod">
                      {renderNumberInput('props.lineHeight', { prefix: 'LH', step: 0.1, min: 0 })}
                    </div>
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">Letter Spacing</label>
                    <div className="flex items-center bg-surface border border-white/[0.06] hover:border-white/10 rounded-xl px-1 h-9 transition-all group/pod">
                      {renderNumberInput('props.letterSpacing', { prefix: 'LS', step: 1 })}
                    </div>
                  </div>
                </div>

                {/* Row: Para Spacing + Style buttons (I / U / S) */}
                {(() => {
                  const currentFontStyle = getCommonValue('props.fontStyle') || 'normal';
                  const currentDecoration: string[] = (getCommonValue('props.textDecoration') as string[]) || [];
                  const isItalic = currentFontStyle === 'italic';
                  const hasUnderline = currentDecoration.includes('underline');
                  const hasStrike = currentDecoration.includes('strikethrough');
                  return (
                    <div className="flex gap-2 items-end">
                      <div className="flex-1 space-y-1.5">
                        <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">Para Spacing</label>
                        <div className="flex items-center bg-surface border border-white/[0.06] hover:border-white/10 rounded-xl px-1 h-9 transition-all group/pod">
                          {renderNumberInput('props.paragraphSpacing', { prefix: 'PS', step: 1, min: 0 })}
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0 pb-[1px]">
                        <button
                          onClick={() => handleChange('props.fontStyle', isItalic ? 'normal' : 'italic')}
                          title="Italic"
                          className={`h-9 w-9 flex items-center justify-center rounded-xl text-sm font-semibold italic transition-all border ${
                            isItalic ? 'bg-accent/15 text-accent border-accent/30' : 'text-white/30 border-white/[0.06] hover:bg-white/[0.03] hover:text-white/60 hover:border-white/10'
                          }`}
                        >I</button>
                        <button
                          onClick={() => toggleDecoration('underline')}
                          title="Underline"
                          className={`h-9 w-9 flex items-center justify-center rounded-xl text-sm font-semibold underline transition-all border ${
                            hasUnderline ? 'bg-accent/15 text-accent border-accent/30' : 'text-white/30 border-white/[0.06] hover:bg-white/[0.03] hover:text-white/60 hover:border-white/10'
                          }`}
                        >U</button>
                        <button
                          onClick={() => toggleDecoration('strikethrough')}
                          title="Strikethrough"
                          className={`h-9 w-9 flex items-center justify-center rounded-xl text-sm font-semibold line-through transition-all border ${
                            hasStrike ? 'bg-accent/15 text-accent border-accent/30' : 'text-white/30 border-white/[0.06] hover:bg-white/[0.03] hover:text-white/60 hover:border-white/10'
                          }`}
                        >S</button>
                      </div>
                    </div>
                  );
                })()}

                {/* Text Type: Point / Area */}
                <div className="space-y-1.5 pt-1">
                  <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">Text Type</label>
                  <div className="flex bg-white/[0.02] p-1 rounded-lg border border-white/[0.06] gap-0.5">
                    {(['point', 'area'] as const).map(type => {
                      const currentWidth = getCommonValue('props.width') as number | undefined;
                      const isArea = (currentWidth || 0) > 0;
                      const isActive = type === 'area' ? isArea : !isArea;
                      return (
                        <button
                          key={type}
                          onClick={() => {
                            if (type === 'area') {
                              handleChange('props.width', 200);
                              handleChange('props.height', 100);
                            } else {
                              handleChange('props.width', 0);
                              handleChange('props.height', 0);
                            }
                          }}
                          className={`flex-1 h-8 flex items-center justify-center rounded-md transition-all text-[11px] font-medium ${
                            isActive
                              ? 'bg-accent/15 text-accent'
                              : 'text-white/20 hover:bg-white/[0.03] hover:text-white/40'
                          }`}
                        >
                          {type === 'point' ? 'Point' : 'Area'}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Area text box dimensions */}
                {((getCommonValue('props.width') as number) || 0) > 0 && (
                  <div className="flex gap-2">
                    <div className="flex-1 space-y-1.5">
                      <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">Box Width</label>
                      <div className="flex items-center bg-surface border border-white/[0.06] hover:border-white/10 rounded-xl px-1 h-9 transition-all group/pod">
                        {renderNumberInput('props.width', { prefix: 'W', min: 1, step: 1 })}
                      </div>
                    </div>
                    <div className="flex-1 space-y-1.5">
                      <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">Box Height</label>
                      <div className="flex items-center bg-surface border border-white/[0.06] hover:border-white/10 rounded-xl px-1 h-9 transition-all group/pod">
                        {renderNumberInput('props.height', { prefix: 'H', min: 1, step: 1 })}
                      </div>
                    </div>
                  </div>
                )}

                {/* Alignment Toggles */}
                <div className="flex gap-2 pt-2">
                  {/* Horizontal Alignment */}
                  <div className="flex flex-1 bg-white/[0.02] p-1 rounded-lg border border-white/[0.06] gap-0.5">
                    {[
                      { id: 'left', icon: AlignLeft },
                      { id: 'center', icon: AlignCenter },
                      { id: 'right', icon: AlignRight }
                    ].map(align => (
                      <button
                        key={align.id}
                        onClick={() => handleChange('props.textAlign', align.id)}
                        className={`flex-1 h-8 flex items-center justify-center rounded-md transition-all ${getCommonValue('props.textAlign') === align.id
                          ? 'bg-accent/15 text-accent '
                          : 'text-white/20 hover:bg-white/[0.03] hover:text-white/40'
                          }`}
                      >
                        <align.icon size={14} />
                      </button>
                    ))}
                  </div>

                  {/* Vertical Alignment */}
                  <div className="flex flex-1 bg-white/[0.02] p-1 rounded-lg border border-white/[0.06] gap-0.5">
                    {[
                      { id: 'top', icon: AlignStartVertical },
                      { id: 'middle', icon: AlignCenterVertical },
                      { id: 'bottom', icon: AlignEndVertical }
                    ].map(align => (
                      <button
                        key={align.id}
                        onClick={() => handleChange('props.verticalAlign', align.id)}
                        className={`flex-1 h-8 flex items-center justify-center rounded-md transition-all ${getCommonValue('props.verticalAlign') === align.id
                          ? 'bg-accent/15 text-accent '
                          : 'text-white/20 hover:bg-white/[0.03] hover:text-white/40'
                          }`}
                      >
                        <align.icon size={14} />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Content Area */}
                <div className="space-y-1.5 pt-2">
                  <label className="text-[10px] text-muted uppercase tracking-wider block">Text Content</label>
                  <textarea
                    value={getCommonValue('props.text') === 'mixed' ? "" : (getCommonValue('props.text') as string || '')}
                    onChange={(e) => handleChange('props.text', e.target.value)}
                    className="w-full bg-surface border border-white/[0.06] rounded-md p-2 min-h-[60px] text-[11px] font-bold text-white/70 outline-none focus:border-accent/50 hover:border-white/10 transition-all font-sans resize-none"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Style Section */}
          {(!selectedNode || selectedNode.type !== 'image') && !isOnlyPrimitivesSelected && (
            <div className="p-4 border-b border-white/[0.06] space-y-6">
              <h3 className="text-[10px] font-semibold text-muted uppercase tracking-widest">Appearance</h3>
              <div className="space-y-6">
                {renderPaintRow('Fill', 'style.fill', 'style.fillType', 'style.fillGradient', 'style.fillOpacity', 'style.fillVisible')}
                <div className="space-y-4 pt-4 border-t border-white/[0.06]">
                  {renderPaintRow('Stroke', 'style.stroke', 'style.strokeType', 'style.strokeGradient')}

                  {/* New Stroke Settings Grid */}
                  {selectedNode?.style?.stroke !== undefined && (
                    <div className="space-y-2">
                      {/* Row 2: Weight & Alignment */}
                      <div className="flex gap-2">
                        <div className="flex-[4] space-y-1.5">
                          <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">Width</label>
                          <div className="flex items-center bg-surface border border-white/[0.06] hover:border-white/10 rounded-xl px-1 h-9 transition-all group/pod">
                            {renderNumberInput('style.strokeWidth', { prefix: 'W', min: 0, step: 1 })}
                            {selectedNode && (
                              <>
                                <div className="w-[1px] h-3 bg-white/10 mx-1" />
                                <StopwatchButton nodeId={selectedNode.id} path="style.strokeWidth" />
                              </>
                            )}
                          </div>
                        </div>

                        <div className="flex-[5] space-y-1.5">
                          <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">Alignment</label>
                          <div className="flex items-center bg-surface border border-white/[0.06] hover:border-white/10 rounded-xl px-2 h-9 transition-all group/pod">
                            <select
                              value={getCommonValue('style.strokeAlign') || 'center'}
                              onChange={(e) => handleChange('style.strokeAlign', e.target.value)}
                              className="flex-1 bg-transparent border-none text-[11px] font-bold text-white/60 outline-none cursor-pointer appearance-none"
                            >
                              <option value="inside" className="bg-surface">Inside</option>
                              <option value="center" className="bg-surface">Center</option>
                              <option value="outside" className="bg-surface">Outside</option>
                            </select>
                            <ChevronDown size={12} className="text-white/20 pointer-events-none" />
                          </div>
                        </div>
                      </div>

                      {/* Row 3: Opacity & Type (Solid/Dash) */}
                      <div className="flex gap-2">
                        <div className="flex-[4] space-y-1.5">
                          <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">Opacity</label>
                          <div className="flex items-center bg-surface border border-white/[0.06] hover:border-white/10 rounded-xl px-1 h-9 transition-all group/pod">
                            {renderNumberInput('style.strokeOpacity', { prefix: '%', min: 0, max: 1, step: 1, displayFactor: 100 })}
                            {selectedNode && (
                              <>
                                <div className="w-[1px] h-3 bg-white/10 mx-1" />
                                <StopwatchButton nodeId={selectedNode.id} path="style.strokeOpacity" />
                              </>
                            )}
                          </div>
                        </div>

                        <div className="flex-[5] space-y-1.5">
                          <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">Style</label>
                          <div className="flex items-center bg-surface border border-white/[0.06] hover:border-white/10 rounded-xl px-2 h-9 transition-all group/pod">
                            <select
                              value={(getCommonValue('style.strokeDash') || '').length > 0 ? 'dashed' : 'solid'}
                              onChange={(e) => {
                                if (e.target.value === 'solid') handleChange('style.strokeDash', '');
                                else handleChange('style.strokeDash', '10 10');
                              }}
                              className="flex-1 bg-transparent border-none text-[11px] font-bold text-white/60 outline-none cursor-pointer appearance-none"
                            >
                              <option value="solid" className="bg-surface">Solid</option>
                              <option value="dashed" className="bg-surface">Dashed</option>
                            </select>

                            <div className="flex items-center gap-1">
                              <DashPopover
                                dashArray={getCommonValue('style.strokeDash') as string || ''}
                                onChange={(val) => handleChange('style.strokeDash', val)}
                                trigger={
                                  <button
                                    className={`p-1.5 rounded transition-all active:scale-95 ${(getCommonValue('style.strokeDash') || '').length > 0
                                      ? 'text-accent hover:bg-accent/15'
                                      : 'text-white/10 hover:text-white/30 pointer-events-none opacity-0'
                                      }`}
                                  >
                                    <Sliders size={12} strokeWidth={2.5} />
                                  </button>
                                }
                              />
                              {(getCommonValue('style.strokeDash') || '').length > 0 && (
                                <div className="w-px h-3 bg-white/10" />
                              )}
                            </div>
                            <ChevronDown size={12} className="text-white/20 mr-2 pointer-events-none" />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Trim Path Section */}
          {isRectOrEllipseOrPath && (!selectedNode || selectedNode.type !== 'image') && !isOnlyPrimitivesSelected && (
            <div className="p-4 border-b border-white/[0.06] space-y-4">
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setTrimPathExpanded(!trimPathExpanded)}
              >
                <h3 className="text-[10px] font-semibold text-muted uppercase tracking-widest">Trim Path</h3>
                <button className="w-5 h-5 flex items-center justify-center text-white/30 hover:text-white/60 transition-colors">
                  {trimPathExpanded ? <Minus size={12} /> : <Plus size={12} />}
                </button>
              </div>

              {trimPathExpanded && (
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="flex-1 space-y-1.5">
                      <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">Start</label>
                      <div className="flex items-center bg-surface border border-white/[0.06] hover:border-white/10 rounded-xl px-1 h-9 transition-all group/pod">
                        {renderNumberInput('style.trimStart', { prefix: '%', min: 0, max: 1, step: 1, displayFactor: 100, defaultValue: 0 })}
                        {selectedNode && (
                          <>
                            <div className="w-[1px] h-3 bg-white/10 mx-1" />
                            <StopwatchButton nodeId={selectedNode.id} path="style.trimStart" />
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex-1 space-y-1.5">
                      <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">End</label>
                      <div className="flex items-center bg-surface border border-white/[0.06] hover:border-white/10 rounded-xl px-1 h-9 transition-all group/pod">
                        {renderNumberInput('style.trimEnd', { prefix: '%', min: 0, max: 1, step: 1, displayFactor: 100, defaultValue: 1 })}
                        {selectedNode && (
                          <>
                            <div className="w-[1px] h-3 bg-white/10 mx-1" />
                            <StopwatchButton nodeId={selectedNode.id} path="style.trimEnd" />
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">Offset</label>
                    <div className="flex items-center bg-surface border border-white/[0.06] hover:border-white/10 rounded-xl px-1 h-9 transition-all group/pod">
                      {renderNumberInput('style.trimOffset', { prefix: '°', step: 1, defaultValue: 0 })}
                      {selectedNode && (
                        <>
                          <div className="w-[1px] h-3 bg-white/10 mx-1" />
                          <StopwatchButton nodeId={selectedNode.id} path="style.trimOffset" />
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Effects Section */}
          {selectedNode && (
            <div className="p-4 border-b border-white/[0.06] space-y-4">
              <div
                className="flex items-center justify-between group/header cursor-pointer select-none"
                onClick={() => setEffectsExpanded(!effectsExpanded)}
              >
                <div className="flex items-center gap-2">
                  <h3 className={`text-[10px] font-semibold uppercase tracking-widest transition-colors ${effectsExpanded ? 'text-secondary' : 'text-muted group-hover/header:text-secondary'}`}>Effects</h3>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const count = (selectedNode.style.effects || []).length;
                      if (count < 2) {
                        handleAddEffect('shadow');
                      } else {
                        setNodeProperty(selectedNode.id, 'style.effects', [], { recordHistory: true });
                      }
                    }}
                    className={`w-6 h-6 flex items-center justify-center rounded-lg transition-all active:scale-90 ${(selectedNode.style.effects || []).length >= 2
                      ? 'text-white/20 hover:text-white/60 hover:bg-hover'
                      : 'text-white/30 hover:text-white/60 hover:bg-hover'
                      }`}
                    title={(selectedNode.style.effects || []).length >= 2 ? "Clear All Effects" : "Add Effect"}
                  >
                    {(selectedNode.style.effects || []).length >= 2 ? <Minus size={14} /> : <Plus size={14} />}
                  </button>
                </div>
              </div>

              {effectsExpanded && (selectedNode.style.effects || []).length > 0 && (
                <div className="space-y-2">
                  <div className="space-y-1">
                    {selectedNode.style.effects?.map((effect) => (
                      <div
                        key={effect.id}
                        className="flex items-center gap-2 transition-all group/item"
                      >
                        <EffectPopover
                          effect={effect}
                          onChange={(updates) => handleEffectChange(effect.id, updates)}
                          trigger={
                            <button className="p-1.5 text-white/20 hover:text-white/60 hover:bg-hover rounded-lg transition-all" title="Effect Settings">
                              <Sliders size={12} />
                            </button>
                          }
                        />

                        <div className="relative flex-1 group/select">
                          <select
                            value={effect.type}
                            onChange={(e) => handleEffectChange(effect.id, {
                              type: e.target.value as 'shadow' | 'blur',
                              name: e.target.value === 'shadow' ? 'Drop Shadow' : 'Blur'
                            })}
                            className="w-full bg-transparent appearance-none text-[11px] font-bold text-white/60 hover:text-white transition-colors cursor-pointer outline-none py-1.5 pr-6"
                          >
                            <option value="shadow" className="bg-surface text-white">Drop Shadow</option>
                            <option value="blur" className="bg-surface text-white">Blur</option>
                            <option value="repeater" className="bg-surface text-white">Repeater</option>
                            <option value="offset-path" className="bg-surface text-white">Offset Path</option>
                          </select>
                          <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-white/20 pointer-events-none group-hover/select:text-white/40 transition-colors" />
                        </div>

                        <div className="flex items-center gap-1 opacity-0 group-hover/item:opacity-100 transition-all">
                          <button
                            onClick={() => handleToggleEffect(effect.id)}
                            className={`p-1.5 rounded-lg transition-all ${effect.visible ? 'text-white/20 hover:text-white' : 'text-accent hover:text-accent'}`}
                          >
                            {effect.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                          </button>
                          <button
                            onClick={() => handleRemoveEffect(effect.id)}
                            className="p-1.5 rounded-lg text-white/20 hover:text-white/60 transition-all"
                          >
                            <Minus size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Matte Section */}
          {selectedNode && (
            <div className="p-4 border-b border-white/[0.06]">
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setMatteExpanded(!matteExpanded)}
              >
                <h3 className="text-[10px] font-semibold text-muted uppercase tracking-widest">Matte</h3>
                <button className="w-5 h-5 flex items-center justify-center text-white/30 hover:text-white/60 transition-colors">
                  {matteExpanded ? <Minus size={12} /> : <Plus size={12} />}
                </button>
              </div>

              {matteExpanded && (
                <div className="space-y-2 mt-4">
                  <label className="text-[10px] text-muted uppercase tracking-wider">
                    Matte Layer
                  </label>
                  <select
                    value={selectedNode.matteSourceId || ''}
                    onChange={(e) => setMatte(selectedNode.id, e.target.value || null)}
                    className="w-full bg-surface border border-white/[0.06] rounded-md px-3 py-2 text-[11px] font-bold text-white/70 outline-none focus:border-accent/50 hover:border-white/10 transition-all cursor-pointer appearance-none"
                    style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.3)' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
                  >
                    <option value="">(No matte)</option>
                    {Array.from(nodes.values())
                      .filter(n =>
                        n.type !== 'artboard' &&
                        n.id !== selectedNode.id &&
                        // Only show top-level nodes as matte options (children of an artboard)
                        nodes.get(n.parentId || '')?.type === 'artboard' &&
                        // Include: the currently selected matte OR layers not already used as matte
                        (n.id === selectedNode.matteSourceId || !n.matteTargetIds || n.matteTargetIds.length === 0)
                      )
                      .map(layer => (
                        <option key={layer.id} value={layer.id}>
                          {layer.name}
                        </option>
                      ))
                    }
                  </select>

                  {selectedNode.matteSourceId && (
                    <div className="flex items-center gap-2 mt-2 text-[10px] text-purple-400/70">
                      <span className="w-2 h-2 rounded-full bg-purple-500/50" />
                      <span>Masked by: {nodes.get(selectedNode.matteSourceId)?.name || 'Unknown'}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {selectedNode && (selectedNode.type === 'artboard' || selectedNode.type === 'precomp') && (() => {
        const targetId = selectedNode.type === 'precomp' ? selectedNode.refId! : selectedNode.id;
        const targetNode = nodes.get(targetId);
        if (!targetNode) return null;

        return (
          <div className="p-4 space-y-6">
            <h3 className="text-[10px] font-semibold text-muted uppercase tracking-widest">Artboard</h3>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] text-muted uppercase tracking-wider mb-1.5 block">Name</label>
                <input
                  type="text"
                  value={targetNode.name || 'Think Motion'}
                  onChange={(e) => updateNode(targetId, { name: e.target.value })}
                  className="w-full bg-surface border border-white/[0.06] rounded-md px-2 h-8 text-[11px] font-bold text-white/70 outline-none focus:border-accent/50 hover:border-white/10 transition-all font-sans"
                />
              </div>
              <div className="space-y-6 pt-2">
                <div className="space-y-1.5">
                  <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">Dimensions</label>
                  <div className="flex items-center bg-surface border border-white/[0.06] hover:border-white/10 rounded-xl px-1 h-9 transition-all group/pod">
                    {renderNumberInput('props.width', { prefix: 'W', targetId })}
                    <button
                      onClick={() => setNodeProperty(targetId, 'transform.scaleLink', !targetNode.transform?.scaleLink)}
                      className={`p-1 mx-0.5 rounded transition-colors ${targetNode.transform?.scaleLink ? 'text-accent bg-accent/15' : 'text-white/10 hover:text-white/30'}`}
                    >
                      <Link2 size={12} />
                    </button>
                    {renderNumberInput('props.height', { prefix: 'H', targetId })}
                  </div>
                </div>

                {/* Redesigned Background Section */}
                <div className="space-y-2">
                  <label className="text-[10px] text-muted uppercase tracking-wider">Background</label>
                  <div className="flex items-center gap-2 bg-surface border border-white/[0.06] rounded-lg p-1 hover:border-white/10 transition-all group">
                    <div className="relative w-7 h-7 rounded-md border border-white/[0.06] overflow-hidden flex-shrink-0">
                      <input
                        type="color"
                        value={targetNode.props.backgroundColor || '#ffffff'}
                        onChange={(e) => setNodeProperty(targetId, 'props.backgroundColor', e.target.value, { recordHistory: true })}
                        className="absolute inset-[-4px] w-[calc(100%+8px)] h-[calc(100%+8px)] bg-transparent border-none cursor-pointer"
                      />
                    </div>
                    <input
                      type="text"
                      readOnly={targetNode.props.transparent}
                      value={targetNode.props.transparent ? 'Transparent' : (targetNode.props.backgroundColor || '')}
                      onChange={(e) => setNodeProperty(targetId, 'props.backgroundColor', e.target.value, { recordHistory: true })}
                      className={`flex-1 bg-transparent border-none text-[11px] font-mono font-bold ${targetNode.props.transparent ? 'text-white/20' : 'text-white/70'} uppercase outline-none px-1`}
                    />
                    <button
                      onClick={() => setNodeProperty(targetId, 'props.transparent', !targetNode.props.transparent)}
                      className={`p-1.5 rounded-md transition-all ${targetNode.props.transparent ? 'text-white/20' : 'text-accent bg-accent/15'}`}
                      title={targetNode.props.transparent ? "Show Background" : "Hide Background (Transparent)"}
                    >
                      {targetNode.props.transparent ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-4 pt-4 border-t border-white/[0.06]">
                  <div className="flex-1 space-y-1.5">
                    <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">FPS</label>
                    <div className="flex items-center bg-surface border border-white/[0.06] hover:border-white/10 rounded-xl px-1 h-9 transition-all group/pod">
                      {renderNumberInput('props.frameRate', { step: 1, min: 1, max: 120, targetId })}
                    </div>
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <label className="text-[10px] text-muted uppercase tracking-widest pl-0.5">Duration</label>
                    <DurationTimeInput
                      label="Duration"
                      value={targetNode.props.duration}
                      fps={targetNode.props.frameRate || 60}
                      onValueChange={(newFrames: number) => setNodeProperty(targetId, 'props.duration', newFrames, { recordHistory: true })}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function DurationTimeInput({ label, value, fps, onValueChange }: { label: string, value: number, fps: number, onValueChange: (val: number) => void }) {
  const mins = Math.floor(value / (fps * 60));
  const secs = Math.floor((value % (fps * 60)) / fps);
  const frames = Math.round(value % fps);

  const handleSegmentChange = (segment: 'm' | 's' | 'f', newVal: number) => {
    let newM = mins, newS = secs, newF = frames;
    if (segment === 'm') newM = newVal;
    if (segment === 's') newS = newVal;
    if (segment === 'f') newF = newVal;

    const total = (newM * 60 * fps) + (newS * fps) + newF;
    if (total > 0) onValueChange(total);
  };

  return (
    <div className="flex flex-col gap-1 w-full group/field">
      <div className="flex items-center h-8 bg-surface border border-white/[0.06] rounded-md hover:border-white/10 transition-all shadow-sm px-2 gap-0.5">
        <TimeSegment value={mins} onValueChange={(v) => handleSegmentChange('m', v)} max={99} />
        <span className="text-white/10 font-mono text-[11px]">:</span>
        <TimeSegment value={secs} onValueChange={(v) => handleSegmentChange('s', v)} max={59} />
        <span className="text-white/10 font-mono text-[11px]">:</span>
        <TimeSegment value={frames} onValueChange={(v) => handleSegmentChange('f', v)} max={fps - 1} />
      </div>
    </div>
  );
}

function TimeSegment({ value, onValueChange, max }: { value: number, onValueChange: (v: number) => void, max: number }) {
  const [localVal, setLocalVal] = useState(value.toString().padStart(2, '0'));
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) setLocalVal(value.toString().padStart(2, '0'));
  }, [value, isEditing]);

  const commit = () => {
    setIsEditing(false);
    const parsed = parseInt(localVal);
    if (!isNaN(parsed)) {
      onValueChange(Math.min(max, Math.max(0, parsed)));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      commit();
      inputRef.current?.blur();
    }
    if (e.key === 'Escape') {
      setIsEditing(false);
      setLocalVal(value.toString().padStart(2, '0'));
      inputRef.current?.blur();
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={isEditing ? localVal : value.toString().padStart(2, '0')}
      onFocus={() => {
        setIsEditing(true);
        setTimeout(() => inputRef.current?.select(), 0);
      }}
      onBlur={commit}
      onChange={(e) => {
        const val = e.target.value.replace(/\D/g, '').slice(-2);
        setLocalVal(val);
      }}
      onKeyDown={handleKeyDown}
      className={`w-[18px] bg-transparent text-[11px] font-mono font-bold text-center outline-none transition-colors ${isEditing ? 'text-white' : 'text-accent/80 hover:text-white cursor-pointer'}`}
    />
  );
}

function StopwatchButton({ nodeId, path }: { nodeId: string, path: string }) {
  const nodes = useCreatorStore((state) => state.nodes);
  const currentTime = useCreatorStore((state) => state.currentTime);
  const node = nodes.get(nodeId);
  if (!node) return null;

  const animations = node.animations || {};
  const hasAnimation = !!animations[path];
  const hasKeyframe = hasAnimation && animations[path].some(k => Math.abs(k.time - currentTime) < 0.1);

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        useCreatorStore.getState().toggleStopwatch(nodeId, path);
      }}
      className={`p-1 flex items-center justify-center rounded transition-all ${hasAnimation ? 'text-accent' : 'text-white/10 hover:text-white/30'}`}
    >
      <div className={`w-2 h-2 rotate-45 border-[1.5px] rounded-[0.5px] transition-all ${hasAnimation ? 'bg-accent border-accent' : 'border-current bg-transparent'} ${hasKeyframe ? 'scale-110  border-white' : 'scale-100 shadow-none'}`} />
    </button>
  );
}

function MultiStopwatchButton({ nodeId, paths }: { nodeId: string, paths: string[] }) {
  const nodes = useCreatorStore((state) => state.nodes);
  const currentTime = useCreatorStore((state) => state.currentTime);
  const node = nodes.get(nodeId);
  if (!node) return null;

  const animations = node.animations || {};
  const hasAnimation = paths.some(path => !!animations[path]);
  const hasKeyframe = hasAnimation && paths.some(path => animations[path]?.some(k => Math.abs(k.time - currentTime) < 0.1));

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        paths.forEach(path => useCreatorStore.getState().toggleStopwatch(nodeId, path));
      }}
      className={`p-1 flex items-center justify-center rounded transition-all ${hasAnimation ? 'text-accent' : 'text-white/10 hover:text-white/30'}`}
    >
      <div className={`w-2 h-2 rotate-45 border-[1.5px] rounded-[0.5px] transition-all ${hasAnimation ? 'bg-accent border-accent' : 'border-current bg-transparent'} ${hasKeyframe ? 'scale-110  border-white' : 'scale-100 shadow-none'}`} />
    </button>
  );
}

