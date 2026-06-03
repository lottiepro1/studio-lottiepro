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
  ChevronDown, Activity, Minus, ArrowRight, ArrowLeft, Layers, Sliders, Eye, EyeOff, Plus, Diamond, Trash2,
  RotateCcw
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
  const [showPresets, setShowPresets] = useState(false);
  // Local hex string while the user is actively typing in the artboard color field.
  // null = not editing (show the stored value).
  const [editingHex, setEditingHex] = useState<string | null>(null);
  const [showBlendMode, setShowBlendMode] = useState(false);
  const [showMatte, setShowMatte] = useState(false);
  const [showFpsMenu, setShowFpsMenu] = useState(false);

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
        <label className="text-[10px] text-muted mb-0.5">{label}</label>
        <div className="flex gap-2">
          <div className="relative w-10 h-8 rounded-md bg-surface border border-[rgba(221,234,248,0.08)] hover:border-white/10 transition-all overflow-hidden cursor-pointer group shadow-sm">
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
            className={`flex-1 bg-surface border ${isMixed ? 'border-orange-500/30' : 'border-[rgba(221,234,248,0.08)]'} rounded-md px-2 py-1 text-[11px] font-mono font-bold text-white/70 uppercase outline-none focus:border-accent/50 hover:border-white/10 transition-all shadow-sm`}
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
          <label className="text-[10px] text-muted">{label}</label>
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
                  <div className="flex-1 flex items-center gap-2.5 bg-surface border border-[rgba(221,234,248,0.08)] hover:border-white/10 rounded-lg p-1.5 transition-all text-left outline-none  cursor-pointer">
                    <div
                      className="w-6 h-6 rounded-md border border-[rgba(221,234,248,0.08)] flex-shrink-0"
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
                <div className="w-[120px] bg-surface border border-[rgba(221,234,248,0.08)] hover:border-white/10 rounded-lg p-1.5 flex items-center gap-2 transition-all">
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

  const parseColorInput = (raw: string): string | null => {
    const s = raw.trim();
    // rgb(r,g,b) or rgba(r,g,b,a)
    const rgbMatch = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (rgbMatch) {
      const toHex = (n: number) => n.toString(16).padStart(2, '0');
      return `#${toHex(+rgbMatch[1])}${toHex(+rgbMatch[2])}${toHex(+rgbMatch[3])}`;
    }
    // hex with or without #
    const hex = s.replace('#', '');
    if (/^[0-9a-fA-F]{3}$/.test(hex)) {
      return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
    }
    if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex}`;
    return null;
  };

  const PRESETS = [
    { label: 'Social Media: 1920 × 1080', w: 1920, h: 1080 },
    { label: 'Instagram Post: 1080 × 1080', w: 1080, h: 1080 },
    { label: 'Instagram Story: 1080 × 1920', w: 1080, h: 1920 },
    { label: 'LinkedIn: 1200 × 627', w: 1200, h: 627 },
    { label: 'Twitter / X: 1200 × 675', w: 1200, h: 675 },
    { label: 'Square 500 × 500', w: 500, h: 500 },
  ] as const;

  // The user explicitly requested that shapes inside groups should have their properties exposed
  // so they can be individually styled and animated (like in After Effects and LottieFiles).
  const isOnlyPrimitivesSelected = false;

  return (
    <div className="w-full h-full flex flex-col overflow-y-auto custom-scrollbar select-none pb-12 min-h-0" style={{ background: '#2C2C2C' }}>

      {/* Alignment Bar */}
      {selectedIds.length > 0 && isRectOrEllipseOrPath && (
        <div className="px-4 py-3 flex items-center justify-between bg-black/10" style={{ borderBottom: '1px solid rgba(221,234,248,0.08)' }}>
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
          <div className="px-3 py-3 space-y-4" style={{ borderBottom: '1px solid rgba(221,234,248,0.08)' }}>
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] font-semibold">Transform</h3>
              {/* Anchor Grid */}
              <div className="grid grid-cols-3 gap-[1.5px] bg-white/[0.02] p-[2px] rounded border border-[rgba(221,234,248,0.08)]">
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
                <label className="text-[11px] pl-0.5">Position</label>
                <div className="flex items-center rounded-[4px] px-1 h-8 transition-all group/pod" style={{ background: 'rgba(221,234,248,0.08)', border: '1px solid rgba(214,235,253,0.19)' }}>
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
                    <label className="text-[11px] pl-0.5">Scale</label>
                    <div className="flex items-center rounded-[4px] px-1 h-8 transition-all group/pod" style={{ background: 'rgba(221,234,248,0.08)', border: '1px solid rgba(214,235,253,0.19)' }}>
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
                      <label className="text-[11px] pl-0.5">Rotation</label>
                      <div className="flex items-center rounded-[4px] px-1 h-8 transition-all group/pod" style={{ background: 'rgba(221,234,248,0.08)', border: '1px solid rgba(214,235,253,0.19)' }}>
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
                      <label className="text-[11px] pl-0.5">Opacity</label>
                      <div className="flex items-center rounded-[4px] px-1 h-8 transition-all group/pod" style={{ background: 'rgba(221,234,248,0.08)', border: '1px solid rgba(214,235,253,0.19)' }}>
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
                    <label className="text-[11px] pl-0.5" style={{ color: 'rgba(241,247,254,0.50)' }}>Blend Mode</label>
                    <div className="relative">
                      <button
                        onClick={() => setShowBlendMode(v => !v)}
                        className="w-full h-8 flex items-center justify-between rounded-[4px] px-3"
                        style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(217,237,255,0.25)' }}
                      >
                        <span className="text-[13px] capitalize" style={{ color: 'rgba(229,237,253,0.80)' }}>
                          {((getCommonValue('style.blendMode') as string) || 'normal').replace(/-/g, ' ')}
                        </span>
                        <ChevronDown size={14} style={{ color: 'rgba(229,237,253,0.48)', flexShrink: 0 }} />
                      </button>
                      {showBlendMode && (
                        <>
                          <div className="fixed inset-0 z-[99]" onClick={() => setShowBlendMode(false)} />
                          <div
                            className="absolute top-full left-0 right-0 mt-1 z-[100] rounded-[4px] overflow-y-auto"
                            style={{ background: '#27292C', border: '1px solid rgba(221,234,248,0.08)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', maxHeight: 220 }}
                          >
                            {['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'].map(mode => (
                              <button
                                key={mode}
                                className="w-full text-left px-3 py-2 text-[13px] capitalize hover:bg-white/5 transition-colors"
                                style={{ color: ((getCommonValue('style.blendMode') as string) || 'normal') === mode ? 'var(--accent)' : '#EDEEF0' }}
                                onClick={() => { handleChange('style.blendMode', mode); setShowBlendMode(false); }}
                              >
                                {mode.replace(/-/g, ' ')}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Boolean Operations Section - Only when 2+ shapes selected */}
          {selectedIds.length >= 2 && (
            <div className="px-3 py-3 space-y-4" style={{ borderBottom: '1px solid rgba(221,234,248,0.08)' }}>
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-semibold">Boolean Operations</h3>
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
                    className="flex flex-col items-center gap-1.5 p-2 rounded transition-all group border bg-white/[0.02] border-[rgba(221,234,248,0.08)] hover:bg-white/[0.05] hover:border-white/10"
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
            <div className="px-3 py-3 space-y-4" style={{ borderBottom: '1px solid rgba(221,234,248,0.08)' }}>
              <h3 className="text-[11px] font-semibold">Shape</h3>

              <div className="space-y-4">
                {(hasSelectionType('rect') || hasSelectionType('group') || hasSelectionType('path') || hasSelectionType('precomp')) && (
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-[11px] pl-0.5">Size</label>
                      <div className="flex items-center rounded-[4px] px-1 h-8 transition-all group/pod" style={{ background: 'rgba(221,234,248,0.08)', border: '1px solid rgba(214,235,253,0.19)' }}>
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
                        <label className="text-[11px] pl-0.5">Roundness</label>
                        <div className="flex items-center rounded-[4px] px-1 h-8 transition-all group/pod" style={{ background: 'rgba(221,234,248,0.08)', border: '1px solid rgba(214,235,253,0.19)' }}>
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
                    <label className="text-[11px] pl-0.5">Radius</label>
                    <div className="flex items-center rounded-[4px] px-1 h-8 transition-all group/pod" style={{ background: 'rgba(221,234,248,0.08)', border: '1px solid rgba(214,235,253,0.19)' }}>
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
                  <div className="space-y-4 pt-4 border-t border-[rgba(221,234,248,0.08)]">
                    <div className="space-y-1.5">
                      <label className="text-[11px] pl-0.5">Type</label>
                      <div className="flex items-center rounded-[4px] px-2 h-8 transition-all group/pod" style={{ background: 'rgba(221,234,248,0.08)', border: '1px solid rgba(214,235,253,0.19)' }}>
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
                      <label className="text-[11px] pl-0.5">Points</label>
                      <div className="flex items-center rounded-[4px] px-1 h-8 transition-all group/pod" style={{ background: 'rgba(221,234,248,0.08)', border: '1px solid rgba(214,235,253,0.19)' }}>
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
                            <label className="text-[11px] pl-0.5">Inner Radius</label>
                            <div className="flex items-center rounded-[4px] px-1 h-8 transition-all group/pod" style={{ background: 'rgba(221,234,248,0.08)', border: '1px solid rgba(214,235,253,0.19)' }}>
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
                            <label className="text-[11px] pl-0.5">Outer Radius</label>
                            <div className="flex items-center rounded-[4px] px-1 h-8 transition-all group/pod" style={{ background: 'rgba(221,234,248,0.08)', border: '1px solid rgba(214,235,253,0.19)' }}>
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
                            <label className="text-[11px] pl-0.5">Inner Rounding</label>
                            <div className="flex items-center rounded-[4px] px-1 h-8 transition-all group/pod" style={{ background: 'rgba(221,234,248,0.08)', border: '1px solid rgba(214,235,253,0.19)' }}>
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
                            <label className="text-[11px] pl-0.5">Outer Rounding</label>
                            <div className="flex items-center rounded-[4px] px-1 h-8 transition-all group/pod" style={{ background: 'rgba(221,234,248,0.08)', border: '1px solid rgba(214,235,253,0.19)' }}>
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
            <div className="px-3 py-3 space-y-4" style={{ borderBottom: '1px solid rgba(221,234,248,0.08)' }}>
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-semibold">Text</h3>
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
                        <label className="text-[11px] pl-0.5">Weight</label>
                        <div className="flex items-center rounded-[4px] px-2 h-8 transition-all group/pod" style={{ background: 'rgba(221,234,248,0.08)', border: '1px solid rgba(214,235,253,0.19)' }}>
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
                    <label className="text-[11px] pl-0.5">Size</label>
                    <div className="flex items-center rounded-[4px] px-1 h-8 transition-all group/pod" style={{ background: 'rgba(221,234,248,0.08)', border: '1px solid rgba(214,235,253,0.19)' }}>
                      {renderNumberInput('props.fontSize', { prefix: 'TS', min: 1 })}
                    </div>
                  </div>
                </div>

                {/* Row: Line Height + Letter Spacing */}
                <div className="flex gap-2">
                  <div className="flex-1 space-y-1.5">
                    <label className="text-[11px] pl-0.5">Line Height</label>
                    <div className="flex items-center rounded-[4px] px-1 h-8 transition-all group/pod" style={{ background: 'rgba(221,234,248,0.08)', border: '1px solid rgba(214,235,253,0.19)' }}>
                      {renderNumberInput('props.lineHeight', { prefix: 'LH', step: 0.1, min: 0 })}
                    </div>
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <label className="text-[11px] pl-0.5">Letter Spacing</label>
                    <div className="flex items-center rounded-[4px] px-1 h-8 transition-all group/pod" style={{ background: 'rgba(221,234,248,0.08)', border: '1px solid rgba(214,235,253,0.19)' }}>
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
                        <label className="text-[11px] pl-0.5">Para Spacing</label>
                        <div className="flex items-center rounded-[4px] px-1 h-8 transition-all group/pod" style={{ background: 'rgba(221,234,248,0.08)', border: '1px solid rgba(214,235,253,0.19)' }}>
                          {renderNumberInput('props.paragraphSpacing', { prefix: 'PS', step: 1, min: 0 })}
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0 pb-[1px]">
                        <button
                          onClick={() => handleChange('props.fontStyle', isItalic ? 'normal' : 'italic')}
                          title="Italic"
                          className={`h-9 w-9 flex items-center justify-center rounded-xl text-sm font-semibold italic transition-all border ${
                            isItalic ? 'bg-accent/15 text-accent border-accent/30' : 'text-white/30 border-[rgba(221,234,248,0.08)] hover:bg-white/[0.03] hover:text-white/60 hover:border-white/10'
                          }`}
                        >I</button>
                        <button
                          onClick={() => toggleDecoration('underline')}
                          title="Underline"
                          className={`h-9 w-9 flex items-center justify-center rounded-xl text-sm font-semibold underline transition-all border ${
                            hasUnderline ? 'bg-accent/15 text-accent border-accent/30' : 'text-white/30 border-[rgba(221,234,248,0.08)] hover:bg-white/[0.03] hover:text-white/60 hover:border-white/10'
                          }`}
                        >U</button>
                        <button
                          onClick={() => toggleDecoration('strikethrough')}
                          title="Strikethrough"
                          className={`h-9 w-9 flex items-center justify-center rounded-xl text-sm font-semibold line-through transition-all border ${
                            hasStrike ? 'bg-accent/15 text-accent border-accent/30' : 'text-white/30 border-[rgba(221,234,248,0.08)] hover:bg-white/[0.03] hover:text-white/60 hover:border-white/10'
                          }`}
                        >S</button>
                      </div>
                    </div>
                  );
                })()}

                {/* Text Type: Point / Area */}
                <div className="space-y-1.5 pt-1">
                  <label className="text-[11px] pl-0.5">Text Type</label>
                  <div className="flex bg-white/[0.02] p-1 rounded-lg border border-[rgba(221,234,248,0.08)] gap-0.5">
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
                      <label className="text-[11px] pl-0.5">Box Width</label>
                      <div className="flex items-center rounded-[4px] px-1 h-8 transition-all group/pod" style={{ background: 'rgba(221,234,248,0.08)', border: '1px solid rgba(214,235,253,0.19)' }}>
                        {renderNumberInput('props.width', { prefix: 'W', min: 1, step: 1 })}
                      </div>
                    </div>
                    <div className="flex-1 space-y-1.5">
                      <label className="text-[11px] pl-0.5">Box Height</label>
                      <div className="flex items-center rounded-[4px] px-1 h-8 transition-all group/pod" style={{ background: 'rgba(221,234,248,0.08)', border: '1px solid rgba(214,235,253,0.19)' }}>
                        {renderNumberInput('props.height', { prefix: 'H', min: 1, step: 1 })}
                      </div>
                    </div>
                  </div>
                )}

                {/* Alignment Toggles */}
                <div className="flex gap-2 pt-2">
                  {/* Horizontal Alignment */}
                  <div className="flex flex-1 bg-white/[0.02] p-1 rounded-lg border border-[rgba(221,234,248,0.08)] gap-0.5">
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
                  <div className="flex flex-1 bg-white/[0.02] p-1 rounded-lg border border-[rgba(221,234,248,0.08)] gap-0.5">
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
                  <label className="text-[10px] text-muted block">Text Content</label>
                  <textarea
                    value={getCommonValue('props.text') === 'mixed' ? "" : (getCommonValue('props.text') as string || '')}
                    onChange={(e) => handleChange('props.text', e.target.value)}
                    className="w-full bg-surface border border-[rgba(221,234,248,0.08)] rounded-md p-2 min-h-[60px] text-[11px] font-bold text-white/70 outline-none focus:border-accent/50 hover:border-white/10 transition-all font-sans resize-none"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Style Section */}
          {(!selectedNode || selectedNode.type !== 'image') && !isOnlyPrimitivesSelected && (
            <div className="px-3 py-3 space-y-4" style={{ borderBottom: '1px solid rgba(221,234,248,0.08)' }}>
              <h3 className="text-[11px] font-semibold">Appearance</h3>
              <div className="space-y-6">
                {renderPaintRow('Fill', 'style.fill', 'style.fillType', 'style.fillGradient', 'style.fillOpacity', 'style.fillVisible')}
                <div className="space-y-4 pt-4 border-t border-[rgba(221,234,248,0.08)]">
                  {renderPaintRow('Stroke', 'style.stroke', 'style.strokeType', 'style.strokeGradient')}

                  {/* New Stroke Settings Grid */}
                  {selectedNode?.style?.stroke !== undefined && (
                    <div className="space-y-2">
                      {/* Row 2: Weight & Alignment */}
                      <div className="flex gap-2">
                        <div className="flex-[4] space-y-1.5">
                          <label className="text-[11px] pl-0.5">Width</label>
                          <div className="flex items-center rounded-[4px] px-1 h-8 transition-all group/pod" style={{ background: 'rgba(221,234,248,0.08)', border: '1px solid rgba(214,235,253,0.19)' }}>
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
                          <label className="text-[11px] pl-0.5">Line Cap</label>
                          <div className="flex items-center rounded-[4px] px-2 h-8 transition-all group/pod" style={{ background: 'rgba(221,234,248,0.08)', border: '1px solid rgba(214,235,253,0.19)' }}>
                            <select
                              value={getCommonValue('style.strokeLinecap') as string || 'round'}
                              onChange={(e) => handleChange('style.strokeLinecap', e.target.value)}
                              className="flex-1 bg-transparent border-none text-[11px] font-bold text-white/60 outline-none cursor-pointer appearance-none"
                            >
                              <option value="butt" className="bg-surface">Butt</option>
                              <option value="round" className="bg-surface">Round</option>
                              <option value="square" className="bg-surface">Square</option>
                            </select>
                            <ChevronDown size={12} className="text-white/20 pointer-events-none" />
                          </div>
                        </div>
                      </div>

                      {/* Row 3: Opacity & Line Join */}
                      <div className="flex gap-2">
                        <div className="flex-[4] space-y-1.5">
                          <label className="text-[11px] pl-0.5">Opacity</label>
                          <div className="flex items-center rounded-[4px] px-1 h-8 transition-all group/pod" style={{ background: 'rgba(221,234,248,0.08)', border: '1px solid rgba(214,235,253,0.19)' }}>
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
                          <label className="text-[11px] pl-0.5">Line Join</label>
                          <div className="flex items-center rounded-[4px] px-2 h-8 transition-all group/pod" style={{ background: 'rgba(221,234,248,0.08)', border: '1px solid rgba(214,235,253,0.19)' }}>
                            <select
                              value={getCommonValue('style.strokeLinejoin') as string || 'round'}
                              onChange={(e) => handleChange('style.strokeLinejoin', e.target.value)}
                              className="flex-1 bg-transparent border-none text-[11px] font-bold text-white/60 outline-none cursor-pointer appearance-none"
                            >
                              <option value="miter" className="bg-surface">Miter</option>
                              <option value="round" className="bg-surface">Round</option>
                              <option value="bevel" className="bg-surface">Bevel</option>
                            </select>
                            <ChevronDown size={12} className="text-white/20 pointer-events-none" />
                          </div>
                        </div>
                      </div>

                      {/* Row 4: Style (Solid/Dash) */}
                      <div className="flex gap-2">
                        <div className="flex-[9] space-y-1.5">
                          <label className="text-[11px] pl-0.5">Style</label>
                          <div className="flex items-center rounded-[4px] px-2 h-8 transition-all group/pod" style={{ background: 'rgba(221,234,248,0.08)', border: '1px solid rgba(214,235,253,0.19)' }}>
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
            <div className="px-3 py-3 space-y-4" style={{ borderBottom: '1px solid rgba(221,234,248,0.08)' }}>
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setTrimPathExpanded(!trimPathExpanded)}
              >
                <h3 className="text-[11px] font-semibold">Trim Path</h3>
                <button className="w-5 h-5 flex items-center justify-center text-white/30 hover:text-white/60 transition-colors">
                  {trimPathExpanded ? <Minus size={12} /> : <Plus size={12} />}
                </button>
              </div>

              {trimPathExpanded && (
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="flex-1 space-y-1.5">
                      <label className="text-[11px] pl-0.5">Start</label>
                      <div className="flex items-center rounded-[4px] px-1 h-8 transition-all group/pod" style={{ background: 'rgba(221,234,248,0.08)', border: '1px solid rgba(214,235,253,0.19)' }}>
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
                      <label className="text-[11px] pl-0.5">End</label>
                      <div className="flex items-center rounded-[4px] px-1 h-8 transition-all group/pod" style={{ background: 'rgba(221,234,248,0.08)', border: '1px solid rgba(214,235,253,0.19)' }}>
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
                    <label className="text-[11px] pl-0.5">Offset</label>
                    <div className="flex items-center rounded-[4px] px-1 h-8 transition-all group/pod" style={{ background: 'rgba(221,234,248,0.08)', border: '1px solid rgba(214,235,253,0.19)' }}>
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
            <div className="px-3 py-3 space-y-4" style={{ borderBottom: '1px solid rgba(221,234,248,0.08)' }}>
              <div
                className="flex items-center justify-between group/header cursor-pointer select-none"
                onClick={() => setEffectsExpanded(!effectsExpanded)}
              >
                <div className="flex items-center gap-2">
                  <h3 className="text-[11px] font-semibold" style={{ color: 'rgba(241,247,254,0.50)' }}>Effects</h3>
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
            <div className="px-3 py-3" style={{ borderBottom: '1px solid rgba(221,234,248,0.08)' }}>
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setMatteExpanded(!matteExpanded)}
              >
                <h3 className="text-[11px] font-semibold">Matte</h3>
                <button className="w-5 h-5 flex items-center justify-center text-white/30 hover:text-white/60 transition-colors">
                  {matteExpanded ? <Minus size={12} /> : <Plus size={12} />}
                </button>
              </div>

              {matteExpanded && (
                <div className="space-y-2 mt-4">
                  <label className="text-[11px]" style={{ color: 'rgba(241,247,254,0.50)' }}>Matte Layer</label>
                  {(() => {
                    const matteOptions = [
                      { id: '', name: '(No matte)' },
                      ...Array.from(nodes.values()).filter(n =>
                        n.type !== 'artboard' &&
                        n.id !== selectedNode.id &&
                        nodes.get(n.parentId || '')?.type === 'artboard' &&
                        (n.id === selectedNode.matteSourceId || !n.matteTargetIds || n.matteTargetIds.length === 0)
                      ).map(n => ({ id: n.id, name: n.name }))
                    ];
                    const currentName = matteOptions.find(o => o.id === (selectedNode.matteSourceId || ''))?.name || '(No matte)';
                    return (
                      <div className="relative">
                        <button
                          onClick={() => setShowMatte(v => !v)}
                          className="w-full h-8 flex items-center justify-between rounded-[4px] px-3"
                          style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(217,237,255,0.25)' }}
                        >
                          <span className="text-[13px] truncate" style={{ color: 'rgba(229,237,253,0.80)' }}>{currentName}</span>
                          <ChevronDown size={14} style={{ color: 'rgba(229,237,253,0.48)', flexShrink: 0 }} />
                        </button>
                        {showMatte && (
                          <>
                            <div className="fixed inset-0 z-[99]" onClick={() => setShowMatte(false)} />
                            <div
                              className="absolute top-full left-0 right-0 mt-1 z-[100] rounded-[4px] overflow-y-auto"
                              style={{ background: '#27292C', border: '1px solid rgba(221,234,248,0.08)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', maxHeight: 200 }}
                            >
                              {matteOptions.map(opt => (
                                <button
                                  key={opt.id}
                                  className="w-full text-left px-3 py-2 text-[13px] hover:bg-white/5 transition-colors"
                                  style={{ color: (selectedNode.matteSourceId || '') === opt.id ? 'var(--accent)' : '#EDEEF0' }}
                                  onClick={() => { setMatte(selectedNode.id, opt.id || null); setShowMatte(false); }}
                                >
                                  {opt.name}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}

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

        const w = targetNode.props.width || 1920;
        const h = targetNode.props.height || 1080;
        const fps = targetNode.props.frameRate || 60;
        const duration = targetNode.props.duration || (fps * 5);

        const matchedPreset = PRESETS.find(p => p.w === w && p.h === h);
        const presetLabel = matchedPreset ? matchedPreset.label : 'Custom Size';

        const bgColor = targetNode.props.backgroundColor || '#FFFFFF';
        const isTransparent = !!targetNode.props.transparent;
        const displayHex = isTransparent ? 'Transparent' : bgColor.replace('#', '').toUpperCase();

        const AB_FONT: React.CSSProperties = { fontFamily: 'Inter, sans-serif', fontWeight: 450, fontSize: 12, color: '#FFFFFF', letterSpacing: '0.04em' };
        const AB_LABEL: React.CSSProperties = { fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 12, color: 'rgba(255,255,255,0.7)' };
        const AB_FIELD: React.CSSProperties = { height: 34, background: '#383838', borderRadius: 6 };
        const AB_DROPDOWN: React.CSSProperties = { height: 34, background: '#2C2C2C', border: '1px solid #444444', borderRadius: 6, paddingLeft: 10 };
        const AB_ROW: React.CSSProperties = { padding: '5px 10px' };

        return (
          <div className="flex flex-col flex-1" style={{ background: '#2C2C2C' }}>

            {/* Content rows */}
            <div style={{ padding: '8px 0' }}>

              {/* Row: Background color */}
              <div style={AB_ROW}>
                <div className="flex items-center justify-between" style={AB_FIELD}>
                  {/* Swatch + hex */}
                  <div className="flex items-center flex-1 min-w-0">
                    <div className="flex items-center justify-center shrink-0" style={{ width: 34, height: 34 }}>
                      <div className="relative overflow-hidden" style={{
                        width: 18, height: 18, borderRadius: 3,
                        border: '1px solid rgba(255,255,255,0.15)',
                        background: isTransparent
                          ? 'repeating-conic-gradient(#666 0% 25%, #999 0% 50%) 0 0 / 6px 6px'
                          : bgColor,
                      }}>
                        {!isTransparent && (
                          <input
                            type="color"
                            value={bgColor.length === 7 ? bgColor : '#FFFFFF'}
                            onChange={e => setNodeProperty(targetId, 'props.backgroundColor', e.target.value, { recordHistory: true })}
                            className="absolute border-none cursor-pointer opacity-0"
                            style={{ inset: '-4px', width: 'calc(100% + 8px)', height: 'calc(100% + 8px)' }}
                          />
                        )}
                      </div>
                    </div>
                    <input
                      type="text"
                      value={editingHex !== null ? editingHex : displayHex}
                      readOnly={isTransparent}
                      onFocus={e => {
                        if (!isTransparent) {
                          setEditingHex(bgColor.replace('#', '').toUpperCase());
                          requestAnimationFrame(() => e.target.select());
                        }
                      }}
                      onChange={e => {
                        if (isTransparent) return;
                        setEditingHex(e.target.value);
                        const parsed = parseColorInput(e.target.value);
                        if (parsed) setNodeProperty(targetId, 'props.backgroundColor', parsed, { recordHistory: false });
                      }}
                      onBlur={e => {
                        const parsed = parseColorInput(e.target.value);
                        if (parsed) setNodeProperty(targetId, 'props.backgroundColor', parsed, { recordHistory: true });
                        setEditingHex(null);
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') { setEditingHex(null); (e.target as HTMLInputElement).blur(); }
                      }}
                      className="bg-transparent outline-none flex-1 min-w-0 truncate"
                      style={AB_FONT}
                    />
                  </div>
                  {/* Visibility toggle */}
                  <button
                    onClick={() => setNodeProperty(targetId, 'props.transparent', !isTransparent)}
                    className="flex items-center justify-center shrink-0 transition-colors"
                    style={{ padding: '0 8px', height: '100%', borderLeft: '2px solid #2C2C2C', color: isTransparent ? '#FFFFFF' : 'rgba(255,255,255,0.5)' }}
                    title={isTransparent ? 'Show background' : 'Transparent background'}
                  >
                    {isTransparent
                      ? <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="m10.79 12.912-1.614-1.615a3.5 3.5 0 0 1-4.474-4.474l-2.06-2.06C.938 6.278 0 8 0 8s3 5.5 8 5.5a7 7 0 0 0 2.79-.588M5.21 3.088A7 7 0 0 1 8 2.5c5 0 8 5.5 8 5.5s-.939 1.721-2.641 3.238l-2.062-2.062a3.5 3.5 0 0 0-4.474-4.474z"/><path d="M5.525 7.646a2.5 2.5 0 0 0 2.829 2.829zm4.95.708-2.829-2.83a2.5 2.5 0 0 1 2.829 2.829zm3.171 6-12-12 .708-.708 12 12z"/></svg>
                      : <svg width="18" height="18" viewBox="6 6 18 12" fill="currentColor"><path d="M21.5248 11.8228C21.5056 11.7796 21.0424 10.752 20.0127 9.72227C18.6405 8.35016 16.9075 7.625 15 7.625C13.0925 7.625 11.3594 8.35016 9.98734 9.72227C8.95757 10.752 8.49218 11.7812 8.47523 11.8228C8.45035 11.8788 8.4375 11.9393 8.4375 12.0005C8.4375 12.0618 8.45035 12.1223 8.47523 12.1783C8.49437 12.2215 8.95757 13.2485 9.98734 14.2783C11.3594 15.6498 13.0925 16.375 15 16.375C16.9075 16.375 18.6405 15.6498 20.0127 14.2783C21.0424 13.2485 21.5056 12.2215 21.5248 12.1783C21.5496 12.1223 21.5625 12.0618 21.5625 12.0005C21.5625 11.9393 21.5496 11.8788 21.5248 11.8228ZM15 14.1875C14.5673 14.1875 14.1444 14.0592 13.7847 13.8188C13.425 13.5785 13.1446 13.2368 12.979 12.8371C12.8134 12.4374 12.7701 11.9976 12.8545 11.5732C12.9389 11.1489 13.1473 10.7591 13.4532 10.4532C13.7591 10.1473 14.1489 9.93894 14.5732 9.85453C14.9976 9.77013 15.4374 9.81345 15.8371 9.97901C16.2368 10.1446 16.5785 10.425 16.8188 10.7847C17.0592 11.1444 17.1875 11.5674 17.1875 12C17.1875 12.5802 16.957 13.1366 16.5468 13.5468C16.1366 13.957 15.5802 14.1875 15 14.1875Z"/></svg>
                    }
                  </button>
                </div>
              </div>

              {/* Row: Preset dropdown */}
              <div style={AB_ROW}>
                <div className="relative">
                  <button
                    onClick={() => setShowPresets(v => !v)}
                    className="flex items-center w-full"
                    style={AB_DROPDOWN}
                  >
                    <span className="flex-1 text-left truncate" style={AB_FONT}>{presetLabel}</span>
                    <div className="flex items-center justify-center shrink-0" style={{ width: 34, height: 34 }}>
                      <svg width="14" height="14" viewBox="6 8 12 8" fill="none"><path d="M13.6464 11.1464C13.8417 10.9512 14.1582 10.9512 14.3535 11.1464C14.5487 11.3417 14.5487 11.6582 14.3535 11.8535L12.3535 13.8535C12.1582 14.0487 11.8417 14.0487 11.6464 13.8535L9.64645 11.8535C9.45118 11.6582 9.45118 11.3417 9.64645 11.1464C9.84171 10.9512 10.1582 10.9512 10.3535 11.1464L12 12.7929L13.6464 11.1464Z" fill="white"/></svg>
                    </div>
                  </button>
                  {showPresets && (
                    <>
                      <div className="fixed inset-0 z-[99]" onClick={() => setShowPresets(false)} />
                      <div className="absolute top-full left-0 right-0 mt-1 z-[100] rounded overflow-hidden"
                        style={{ background: '#27292C', border: '1px solid #444444', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}
                      >
                        {PRESETS.map(p => (
                          <button
                            key={p.label}
                            className="w-full text-left px-3 py-2 hover:bg-white/5 transition-colors"
                            style={{ ...AB_FONT, color: (w === p.w && h === p.h) ? 'var(--accent)' : '#FFFFFF' }}
                            onClick={() => { setNodeProperties(targetId, { 'props.width': p.w, 'props.height': p.h }); setShowPresets(false); }}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Row: W/H dimensions */}
              <div style={AB_ROW}>
                <div className="flex items-center" style={{ ...AB_FIELD, overflow: 'hidden' }}>
                  {/* W */}
                  <div className="flex items-center flex-1">
                    <div className="flex items-center justify-center shrink-0" style={{ width: 34, height: 34 }}>
                      <span style={AB_LABEL}>W</span>
                    </div>
                    <ArtboardInlineInput value={w} min={1}
                      onChange={v => setNodeProperty(targetId, 'props.width', v, { recordHistory: true })} />
                  </div>
                  <div style={{ width: 2, alignSelf: 'stretch', background: '#2C2C2C' }} />
                  {/* H */}
                  <div className="flex items-center flex-1">
                    <div className="flex items-center justify-center shrink-0" style={{ width: 34, height: 34 }}>
                      <span style={AB_LABEL}>H</span>
                    </div>
                    <ArtboardInlineInput value={h} min={1}
                      onChange={v => setNodeProperty(targetId, 'props.height', v, { recordHistory: true })} />
                  </div>
                  {/* Link */}
                  <button
                    onClick={() => setNodeProperty(targetId, 'transform.scaleLink', !targetNode.transform?.scaleLink)}
                    className="flex items-center justify-center shrink-0 transition-colors"
                    style={{ height: '100%', padding: '0 8px', borderLeft: '2px solid #2C2C2C', color: targetNode.transform?.scaleLink ? '#FFFFFF' : 'rgba(255,255,255,0.4)' }}
                  >
                    <svg width="18" height="18" viewBox="6 6 18 12" fill="currentColor"><path d="M9.53125 12C9.53125 12.5221 9.73867 13.0229 10.1079 13.3921C10.4771 13.7613 10.9779 13.9688 11.5 13.9688H13.6875C13.8615 13.9688 14.0285 14.0379 14.1515 14.161C14.2746 14.284 14.3438 14.451 14.3438 14.625C14.3438 14.799 14.2746 14.966 14.1515 15.089C14.0285 15.2121 13.8615 15.2812 13.6875 15.2812H11.5C10.6298 15.2812 9.79516 14.9355 9.17981 14.3202C8.56445 13.7048 8.21875 12.8702 8.21875 12C8.21875 11.1298 8.56445 10.2952 9.17981 9.67981C9.79516 9.06445 10.6298 8.71875 11.5 8.71875H13.6875C13.8615 8.71875 14.0285 8.78789 14.1515 8.91096C14.2746 9.03403 14.3438 9.20095 14.3438 9.375C14.3438 9.54905 14.2746 9.71597 14.1515 9.83904C14.0285 9.96211 13.8615 10.0312 13.6875 10.0312H11.5C10.9779 10.0312 10.4771 10.2387 10.1079 10.6079C9.73867 10.9771 9.53125 11.4779 9.53125 12ZM18.5 8.71875H16.3125C16.1385 8.71875 15.9715 8.78789 15.8485 8.91096C15.7254 9.03403 15.6562 9.20095 15.6562 9.375C15.6562 9.54905 15.7254 9.71597 15.8485 9.83904C15.9715 9.96211 16.1385 10.0312 16.3125 10.0312H18.5C19.0221 10.0312 19.5229 10.2387 19.8921 10.6079C20.2613 10.9771 20.4688 11.4779 20.4688 12C20.4688 12.5221 20.2613 13.0229 19.8921 13.3921C19.5229 13.7613 19.0221 13.9688 18.5 13.9688H16.3125C16.1385 13.9688 15.9715 14.0379 15.8485 14.161C15.7254 14.284 15.6562 14.451 15.6562 14.625C15.6562 14.799 15.7254 14.966 15.8485 15.089C15.9715 15.2121 16.1385 15.2812 16.3125 15.2812H18.5C19.3702 15.2812 20.2048 14.9355 20.8202 14.3202C21.4355 13.7048 21.7812 12.8702 21.7812 12C21.7812 11.1298 21.4355 10.2952 20.8202 9.67981C20.2048 9.06445 19.3702 8.71875 18.5 8.71875Z"/></svg>
                  </button>
                </div>
              </div>

              {/* Row: Duration + FPS */}
              <div className="flex" style={{ ...AB_ROW, gap: 8 }}>
                {/* Duration */}
                <div className="flex items-center flex-1" style={AB_FIELD}>
                  <div className="flex items-center justify-center shrink-0" style={{ width: 34, height: 34 }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="rgba(255,255,255,0.8)">
                      <path d="M12 6C15.3137 6 18 8.68629 18 12C18 15.3137 15.3137 18 12 18C8.68629 18 6 15.3137 6 12C6 8.68629 8.68629 6 12 6ZM12 7C9.23858 7 7 9.23858 7 12C7 14.7614 9.23858 17 12 17C14.7614 17 17 14.7614 17 12C17 9.23858 14.7614 7 12 7ZM12 8.5C12.2761 8.5 12.5 8.72386 12.5 9V11.793L14.0674 13.3604C14.2626 13.5556 14.2626 13.8721 14.0674 14.0674C13.8721 14.2626 13.5556 14.2626 13.3604 14.0674L11.6465 12.3535C11.5527 12.2597 11.5 12.1326 11.5 12V9C11.5 8.72386 11.7239 8.5 12 8.5Z"/>
                    </svg>
                  </div>
                  <ArtboardDurationInput
                    value={duration} fps={fps}
                    onChange={frames => setNodeProperty(targetId, 'props.duration', frames, { recordHistory: true })}
                  />
                </div>
                {/* FPS dropdown */}
                <div className="relative flex-1">
                  <button
                    onClick={() => setShowFpsMenu(v => !v)}
                    className="flex items-center w-full"
                    style={AB_DROPDOWN}
                  >
                    <span className="flex-1 text-left" style={AB_FONT}>{fps} FPS</span>
                    <div className="flex items-center justify-center shrink-0" style={{ width: 34, height: 34 }}>
                      <svg width="14" height="14" viewBox="6 8 12 8" fill="none"><path d="M13.6464 11.1464C13.8417 10.9512 14.1582 10.9512 14.3535 11.1464C14.5487 11.3417 14.5487 11.6582 14.3535 11.8535L12.3535 13.8535C12.1582 14.0487 11.8417 14.0487 11.6464 13.8535L9.64645 11.8535C9.45118 11.6582 9.45118 11.3417 9.64645 11.1464C9.84171 10.9512 10.1582 10.9512 10.3535 11.1464L12 12.7929L13.6464 11.1464Z" fill="white"/></svg>
                    </div>
                  </button>
                  {showFpsMenu && (
                    <>
                      <div className="fixed inset-0 z-[99]" onClick={() => setShowFpsMenu(false)} />
                      <div className="absolute bottom-full left-0 right-0 mb-1 z-[100] rounded overflow-hidden"
                        style={{ background: '#27292C', border: '1px solid #444444', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}
                      >
                        {[12, 24, 25, 30, 60, 120].map(f => (
                          <button
                            key={f}
                            className="w-full text-left px-3 py-2 hover:bg-white/5 transition-colors"
                            style={{ ...AB_FONT, color: fps === f ? 'var(--accent)' : '#FFFFFF' }}
                            onClick={() => {
                              const newDuration = Math.round((duration / fps) * f);
                              setNodeProperties(targetId, { 'props.frameRate': f, 'props.duration': newDuration });
                              setShowFpsMenu(false);
                            }}
                          >
                            {f} FPS
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

            </div>
          </div>
        );
      })()}
    </div>
  );
}

function ArtboardNumInput({
  value, min, max, suffix, onChange,
}: {
  value: number; min?: number; max?: number; suffix?: string;
  onChange: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) { ref.current?.focus(); ref.current?.select(); } }, [editing]);

  const commit = () => {
    setEditing(false);
    const n = parseFloat(local);
    if (!isNaN(n)) {
      const clamped = Math.round(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n)));
      onChange(clamped);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startVal = value;
    let moved = false;
    const onMove = (me: MouseEvent) => {
      const dx = me.clientX - startX;
      if (Math.abs(dx) > 3) moved = true;
      if (moved) {
        const sensitivity = me.shiftKey ? 10 : me.altKey ? 0.1 : 1;
        const next = Math.round(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, startVal + dx * sensitivity)));
        onChange(next);
      }
    };
    const onUp = () => {
      if (!moved) { setLocal(value.toString()); setEditing(true); }
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = 'default';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'ew-resize';
  };

  return (
    <div
      className="flex-1 h-8 flex items-center justify-center rounded-[4px] cursor-ew-resize"
      style={{ background: 'rgba(221,234,248,0.08)', border: '1px solid rgba(214,235,253,0.19)' }}
      onMouseDown={handleMouseDown}
    >
      {editing ? (
        <input
          ref={ref}
          type="text"
          className="w-full h-full bg-transparent outline-none text-[14px] text-center"
          style={{ color: '#EDEEF0' }}
          value={local}
          onChange={e => setLocal(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        />
      ) : (
        <span className="text-[14px]" style={{ color: 'rgba(241,247,254,0.71)', fontWeight: 400 }}>
          {Number.isInteger(value) ? value : Math.round(value)}{suffix ?? ''}
        </span>
      )}
    </div>
  );
}

function ArtboardInlineInput({ value, min, max, onChange }: {
  value: number; min?: number; max?: number; onChange: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) { ref.current?.focus(); ref.current?.select(); } }, [editing]);

  const commit = () => {
    setEditing(false);
    const n = parseFloat(local);
    if (!isNaN(n)) onChange(Math.round(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n))));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (editing || e.button !== 0) return;
    const startX = e.clientX;
    const startVal = value;
    let moved = false;
    const onMove = (me: MouseEvent) => {
      const dx = me.clientX - startX;
      if (Math.abs(dx) > 3) moved = true;
      if (moved) {
        const sensitivity = me.shiftKey ? 10 : me.altKey ? 0.1 : 1;
        onChange(Math.round(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, startVal + dx * sensitivity))));
      }
    };
    const onUp = () => {
      if (!moved) { setLocal(value.toString()); setEditing(true); }
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = 'default';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'ew-resize';
  };

  if (editing) {
    return (
      <input ref={ref} type="text"
        className="flex-1 bg-transparent outline-none text-center"
        style={{ fontFamily: 'Inter, sans-serif', fontWeight: 450, fontSize: 12, color: '#FFFFFF' }}
        value={local}
        onChange={e => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
      />
    );
  }

  return (
    <div className="flex-1 flex items-center justify-center cursor-ew-resize select-none h-full"
      onMouseDown={handleMouseDown}
      onClick={() => { setLocal(value.toString()); setEditing(true); }}
    >
      <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 450, fontSize: 12, color: '#FFFFFF' }}>
        {Number.isInteger(value) ? value : Math.round(value)}
      </span>
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
      <div className="flex items-center h-8 bg-surface border border-[rgba(221,234,248,0.08)] rounded-md hover:border-white/10 transition-all shadow-sm px-2 gap-0.5">
        <TimeSegment value={mins} onValueChange={(v) => handleSegmentChange('m', v)} max={99} />
        <span className="text-white/10 font-mono text-[11px]">:</span>
        <TimeSegment value={secs} onValueChange={(v) => handleSegmentChange('s', v)} max={59} />
        <span className="text-white/10 font-mono text-[11px]">:</span>
        <TimeSegment value={frames} onValueChange={(v) => handleSegmentChange('f', v)} max={fps - 1} />
      </div>
    </div>
  );
}

function ArtboardDurationInput({ value, fps, onChange }: { value: number; fps: number; onChange: (frames: number) => void }) {
  const mins = Math.floor(value / (fps * 60));
  const secs = Math.floor((value % (fps * 60)) / fps);
  const frames = Math.round(value % fps);

  const commit = (segment: 'm' | 's' | 'f', newVal: number) => {
    let m = mins, s = secs, f = frames;
    if (segment === 'm') m = Math.max(0, newVal);
    if (segment === 's') s = Math.max(0, Math.min(59, newVal));
    if (segment === 'f') f = Math.max(0, Math.min(fps - 1, newVal));
    const total = m * 60 * fps + s * fps + f;
    if (total > 0) onChange(total);
  };

  return (
    <div className="flex items-center gap-0.5 w-full justify-center">
      <ArtboardTimeSegment value={mins} max={99} onCommit={v => commit('m', v)} />
      <span style={{ color: 'rgba(255,255,255,0.3)', fontFamily: 'Inter, sans-serif', fontSize: 12 }}>:</span>
      <ArtboardTimeSegment value={secs} max={59} onCommit={v => commit('s', v)} />
      <span style={{ color: 'rgba(255,255,255,0.3)', fontFamily: 'Inter, sans-serif', fontSize: 12 }}>:</span>
      <ArtboardTimeSegment value={frames} max={fps - 1} onCommit={v => commit('f', v)} />
    </div>
  );
}

function ArtboardTimeSegment({ value, max, onCommit }: { value: number; max: number; onCommit: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!editing) setLocal(value.toString().padStart(2, '0')); }, [value, editing]);
  useEffect(() => { if (editing) { ref.current?.focus(); ref.current?.select(); } }, [editing]);

  const commit = () => {
    setEditing(false);
    const n = parseInt(local);
    if (!isNaN(n)) onCommit(Math.min(max, Math.max(0, n)));
  };

  return (
    <input
      ref={ref}
      type="text"
      value={editing ? local : value.toString().padStart(2, '0')}
      onFocus={() => { setEditing(true); setTimeout(() => ref.current?.select(), 0); }}
      onBlur={commit}
      onChange={e => setLocal(e.target.value.replace(/\D/g, '').slice(-2))}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
      className="w-[22px] bg-transparent outline-none text-[12px] text-center cursor-pointer"
      style={{ color: '#FFFFFF', fontWeight: 450, fontFamily: 'Inter, sans-serif' }}
    />
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

