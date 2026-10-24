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
import {
  Eye as PhEye, EyeSlash as PhEyeSlash, CaretDown as PhCaretDown, Clock as PhClock, LinkSimple as PhLinkSimple,
  AlignLeft as PhAlignLeft, AlignCenterHorizontal as PhAlignCenterH, AlignRight as PhAlignRight,
  AlignTop as PhAlignTop, AlignCenterVertical as PhAlignCenterV, AlignBottom as PhAlignBottom,
  Rows as PhRows, Columns as PhColumns, Plus as PhPlus, Minus as PhMinus, Faders as PhFaders,
} from '@phosphor-icons/react';
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
  // Appearance is collapsed by default; Fill is open by default once Appearance is expanded.
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [fillOpen, setFillOpen] = useState(true);
  const [strokeOpen, setStrokeOpen] = useState(false);
  const [roundnessOpen, setRoundnessOpen] = useState(false);
  const [layerOpen, setLayerOpen] = useState(false);
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
      } else if (node.type === 'precomp') {
        // Same bounds getAnimatedAnchor uses: the referenced comp's dimensions.
        const refComp = node.refId ? nodes.get(node.refId) : null;
        curW = refComp ? (AnimationUtils.getPropertyValue(refComp, 'props.width', currentTime) || 0) : (node.props.width || 0);
        curH = refComp ? (AnimationUtils.getPropertyValue(refComp, 'props.height', currentTime) || 0) : (node.props.height || 0);
      } else if (node.type === 'rect' || node.type === 'image') {
        curW = AnimationUtils.getPropertyValue(node, 'props.width', currentTime) || 0;
        curH = AnimationUtils.getPropertyValue(node, 'props.height', currentTime) || 0;
      } else {
        // ellipse
        curW = (AnimationUtils.getPropertyValue(node, 'props.radiusX', currentTime) || 0) * 2;
        curH = (AnimationUtils.getPropertyValue(node, 'props.radiusY', currentTime) || 0) * 2;
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
    if (selectedNode.type === 'rect' || selectedNode.type === 'artboard' || selectedNode.type === 'image') {
      width = AnimationUtils.getPropertyValue(selectedNode, 'props.width', currentTime);
      height = AnimationUtils.getPropertyValue(selectedNode, 'props.height', currentTime);
    } else if (selectedNode.type === 'precomp') {
      // Same bounds getAnimatedAnchor uses: the referenced comp's dimensions.
      const refComp = selectedNode.refId ? nodes.get(selectedNode.refId) : null;
      width = refComp ? (AnimationUtils.getPropertyValue(refComp, 'props.width', currentTime) || 0) : (selectedNode.props.width || 0);
      height = refComp ? (AnimationUtils.getPropertyValue(refComp, 'props.height', currentTime) || 0) : (selectedNode.props.height || 0);
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

  // Figma-style Transform input: #383838 field, left-aligned value with an optional
  // prefix slot (X/Y) and suffix (°/%), drag-to-scrub + click-to-edit. Multi-select aware.
  const renderXform = (path: string, options: { step?: number, min?: number, max?: number, prefix?: string, suffix?: string, displayFactor?: number, defaultValue?: number } = {}) => {
    const { step = 1, min, max, prefix, suffix, displayFactor = 1, defaultValue = 0 } = options;
    let val = getCommonValue(path);
    if (val === undefined) val = defaultValue;
    const isMixed = val === 'mixed';
    return (
      <XformInput
        value={isMixed ? 0 : (val as number)}
        isMixed={isMixed}
        prefix={prefix}
        suffix={suffix}
        step={step}
        min={min}
        max={max}
        displayFactor={displayFactor}
        onChange={(newVal: number, recordHistory?: boolean) => {
          const targets = selectedIds.length > 0 ? selectedIds : (previewNode ? [previewNode.id] : []);
          targets.forEach(targetId => setNodeProperty(targetId, path, newVal, { recordHistory }));
        }}
      />
    );
  };

  // Figma swatch + hex field (140px) that opens the paint/gradient picker. Shared by the
  // Appearance Fill and Stroke Color rows so both behave identically.
  const paintColorField = (colorPath: string, typePath: string, gradientPath: string) => {
    const LBL: React.CSSProperties = { fontFamily: 'Inter, sans-serif', fontWeight: 450, fontSize: 12, lineHeight: '16px', letterSpacing: '0.005em', color: '#FFFFFF' };
    const nodeSize = (() => {
      if (!selectedNode) return undefined;
      if (selectedNode.type === 'rect') return { width: selectedNode.props?.width || 100, height: selectedNode.props?.height || 100 };
      if (selectedNode.type === 'ellipse') return { width: (selectedNode.props?.radiusX || 50) * 2, height: (selectedNode.props?.radiusY || 50) * 2 };
      return undefined;
    })();
    const uniqueColors = getUniqueColors(colorPath);
    const colorValue = getCommonValue(colorPath);
    const typeValue = getCommonValue(typePath) as any;
    const isMixed = typeValue === 'mixed' || colorValue === 'mixed' || uniqueColors.length > 1;
    const type: 'solid' | 'gradient' = (typeValue === 'mixed' || !typeValue) ? 'solid' : typeValue;
    const gradient = getCommonValue(gradientPath) as Gradient;
    const pickerColor = colorValue === 'mixed' ? (uniqueColors[0] || '#FF335A') : (colorValue as string || '#FF335A');
    const preview = () => {
      if (isMixed) return 'conic-gradient(#333 90deg, #444 90deg 180deg, #333 180deg 270deg, #444 270deg)';
      if (type === 'solid') return (colorValue as string) || '#000000';
      const sorted = [...(gradient?.stops || [])].sort((a, b) => a.offset - b.offset);
      return `linear-gradient(to right, ${sorted.map(s => `${s.color} ${s.offset * 100}%`).join(', ')})`;
    };
    const label = isMixed ? 'Mixed' : (type === 'solid' ? ((colorValue as string) || '').replace('#', '').toUpperCase() : (gradient?.type === 'linear' ? 'Linear' : 'Radial'));
    return (
      <div className="shrink-0" style={{ width: 140 }}>
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
            <div className="flex items-center cursor-pointer w-full" style={{ height: 32, background: '#383838', borderRadius: 6 }}>
              <div className="flex items-center justify-center shrink-0" style={{ width: 24, height: 32 }}>
                <div style={{ width: 14, height: 14, borderRadius: 2, border: '1px solid rgba(255,255,255,0.1)', background: preview() }} />
              </div>
              <span className="flex-1 min-w-0 truncate" style={{ ...LBL, paddingRight: 8 }}>{label}</span>
            </div>
          }
        />
      </div>
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

      {/* Alignment Bar — Phosphor regular (stroke) icons in a segmented control */}
      {selectedIds.length > 0 && isRectOrEllipseOrPath && (() => {
        const ALIGN_BTN = 'flex-1 flex items-center justify-center transition-colors bg-[#383838] hover:bg-[#454545] text-white/70 hover:text-white disabled:opacity-40 disabled:hover:bg-[#383838] disabled:hover:text-white/70';
        const GROUP: React.CSSProperties = { gap: 1, borderRadius: 6, overflow: 'hidden' };
        const align = (a: any) => useCreatorStore.getState().alignSelectedNodes(a);
        const distribute = (d: any) => useCreatorStore.getState().distributeSelectedNodes(d);
        const canDistribute = selectedIds.length >= 3;
        return (
          <div className="flex items-center" style={{ padding: '8px 10px', gap: 8, borderBottom: '1px solid #444444' }}>
            {/* Horizontal alignment */}
            <div className="flex" style={{ ...GROUP, flex: 3 }}>
              <button className={ALIGN_BTN} style={{ height: 28 }} title="Align Left" onClick={() => align('left')}><PhAlignLeft size={16} /></button>
              <button className={ALIGN_BTN} style={{ height: 28 }} title="Align Horizontal Center" onClick={() => align('center-h')}><PhAlignCenterH size={16} /></button>
              <button className={ALIGN_BTN} style={{ height: 28 }} title="Align Right" onClick={() => align('right')}><PhAlignRight size={16} /></button>
            </div>
            {/* Vertical alignment */}
            <div className="flex" style={{ ...GROUP, flex: 3 }}>
              <button className={ALIGN_BTN} style={{ height: 28 }} title="Align Top" onClick={() => align('top')}><PhAlignTop size={16} /></button>
              <button className={ALIGN_BTN} style={{ height: 28 }} title="Align Vertical Center" onClick={() => align('center-v')}><PhAlignCenterV size={16} /></button>
              <button className={ALIGN_BTN} style={{ height: 28 }} title="Align Bottom" onClick={() => align('bottom')}><PhAlignBottom size={16} /></button>
            </div>
            {/* Distribute */}
            <div className="flex" style={{ ...GROUP, flex: 2 }}>
              <button className={ALIGN_BTN} style={{ height: 28 }} title="Distribute Horizontal Space" disabled={!canDistribute} onClick={() => distribute('horizontal')}><PhColumns size={16} /></button>
              <button className={ALIGN_BTN} style={{ height: 28 }} title="Distribute Vertical Space" disabled={!canDistribute} onClick={() => distribute('vertical')}><PhRows size={16} /></button>
            </div>
          </div>
        );
      })()}


      {/* Keyframe Easing Section — replaces the property sections while keyframes are selected */}
      <KeyframeEasingSection />

      {selectedNode && selectedNode.type !== 'artboard' && selectedKeyframeIds.length === 0 && (
        <>
          {/* Transform Section — label-left + diamond keyframe, input-right (Figma) */}
          {(() => {
            const TF_LABEL: React.CSSProperties = { fontFamily: 'Inter, sans-serif', fontWeight: 450, fontSize: 12, lineHeight: '16px', letterSpacing: '0.005em', color: '#FFFFFF' };
            const linkOn = !!selectedNode.transform?.scaleLink;
            const xformTargets = () => (selectedIds.length > 0 ? selectedIds : (previewNode ? [previewNode.id] : []));
            return (
              <div className="flex flex-col" style={{ padding: '10px 0', gap: 10, borderBottom: '1px solid #444444' }}>
                {/* Section label */}
                <div style={{ padding: '0 10px' }}>
                  <span style={TF_LABEL}>Transform</span>
                </div>

                {/* Position */}
                <div className="flex items-center justify-between" style={{ padding: '0 10px' }}>
                  <div className="flex items-center min-w-0">
                    <KeyframeDiamond nodeId={selectedNode.id} paths={['transform.x', 'transform.y']} />
                    <span className="truncate" style={TF_LABEL}>Position</span>
                  </div>
                  <div className="flex items-center shrink-0" style={{ gap: 6, width: 150 }}>
                    {renderXform('transform.x', { prefix: 'X' })}
                    {renderXform('transform.y', { prefix: 'Y' })}
                  </div>
                </div>

                {/* Scale */}
                <div className="flex items-center justify-between" style={{ padding: '0 10px' }}>
                  <div className="flex items-center min-w-0">
                    <KeyframeDiamond nodeId={selectedNode.id} paths={['transform.scaleX', 'transform.scaleY']} />
                    <span className="truncate" style={TF_LABEL}>Scale</span>
                  </div>
                  <div className="flex items-center shrink-0" style={{ gap: 6, width: 150 }}>
                    {renderXform('transform.scaleX', { suffix: '%', displayFactor: 100 })}
                    <button
                      onClick={() => xformTargets().forEach(t => setNodeProperty(t, 'transform.scaleLink', !linkOn))}
                      className="flex items-center justify-center shrink-0"
                      style={{ width: 20, height: 32 }}
                      title={linkOn ? 'Proportions linked' : 'Proportions unlinked'}
                    >
                      <PhLinkSimple size={14} weight="regular" color={linkOn ? '#FFFFFF' : 'rgba(255,255,255,0.4)'} />
                    </button>
                    {renderXform('transform.scaleY', { suffix: '%', displayFactor: 100 })}
                  </div>
                </div>

                {/* Rotation */}
                <div className="flex items-center justify-between" style={{ padding: '0 10px' }}>
                  <div className="flex items-center min-w-0">
                    <KeyframeDiamond nodeId={selectedNode.id} paths={['transform.rotation']} />
                    <span className="truncate" style={TF_LABEL}>Rotation</span>
                  </div>
                  <div className="flex items-center shrink-0" style={{ width: 72 }}>
                    {renderXform('transform.rotation', { suffix: '°' })}
                  </div>
                </div>

                {/* Opacity */}
                <div className="flex items-center justify-between" style={{ padding: '0 10px' }}>
                  <div className="flex items-center min-w-0">
                    <KeyframeDiamond nodeId={selectedNode.id} paths={['style.opacity']} />
                    <span className="truncate" style={TF_LABEL}>Opacity</span>
                  </div>
                  <div className="flex items-center shrink-0" style={{ width: 72 }}>
                    {renderXform('style.opacity', { suffix: '%', displayFactor: 100, min: 0, max: 1 })}
                  </div>
                </div>

                {/* Anchor Point — 3×3 grid, center blue by default */}
                <div className="flex items-start justify-between" style={{ padding: '0 10px' }}>
                  <span className="shrink-0" style={{ ...TF_LABEL, marginTop: 8 }}>Anchor Point</span>
                  <div className="shrink-0" style={{ width: 140, padding: 8, background: '#2C2C2C', border: '1px solid #383838', borderRadius: 6 }}>
                    <div className="grid grid-cols-3">
                      {['top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right'].map(p => (
                        <button key={p} onClick={() => handleAnchorChange(p as any)} className="flex items-center justify-center group" style={{ height: 24 }} title={p.replace('-', ' ')}>
                          <div
                            className={`rounded-full transition-colors ${isAnchorSelected(p) ? '' : 'bg-[#383838] group-hover:bg-white/25'}`}
                            style={{ width: 11, height: 11, ...(isAnchorSelected(p) ? { background: '#0A6DC2' } : {}) }}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

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

                    {/* Roundness moved to the Appearance section. */}
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

          {/* Appearance Section — collapsible (closed by default); Fill open by default */}
          {(!selectedNode || selectedNode.type !== 'image') && !isOnlyPrimitivesSelected && (() => {
            const AP_LABEL: React.CSSProperties = { fontFamily: 'Inter, sans-serif', fontWeight: 450, fontSize: 12, lineHeight: '16px', letterSpacing: '0.005em', color: '#FFFFFF' };
            const TOGGLE = 'rgba(255,255,255,0.5)';

            // Stroke state — drives add-vs-toggle and the dashed sub-settings.
            const hasStroke = !!(selectedNode!.style?.stroke && selectedNode!.style.stroke !== 'none');
            // NOTE: ''.split(/\s+/) === [''] and Number('') === 0, so an empty dash must be
            // guarded explicitly — otherwise a solid stroke parses as [0] and reads as "Dashed".
            const dashStr = String(getCommonValue('style.strokeDash') || '').trim();
            const dashArr = dashStr ? dashStr.split(/\s+/).map(Number).filter(n => !isNaN(n)) : [];
            const isDashed = dashArr.length > 0;
            const dashLen = dashArr[0] || 10;
            const gapLen = dashArr[1] ?? dashArr[0] ?? 10;
            const showRoundness = selectedNode!.type === 'rect' || selectedNode!.type === 'path';
            const addStroke = () => {
              const targets = selectedIds.length > 0 ? selectedIds : (previewNode ? [previewNode.id] : []);
              useCreatorStore.getState().pushToHistory('Add Stroke');
              targets.forEach(t => {
                const n = nodes.get(t);
                setNodeProperty(t, 'style.stroke', '#000000', { recordHistory: false });
                setNodeProperty(t, 'style.strokeType', 'solid', { recordHistory: false });
                setNodeProperty(t, 'style.strokeWidth', 2, { recordHistory: false });
                setNodeProperty(t, 'style.strokeOpacity', 1, { recordHistory: false });
                if (n?.style?.strokeLinecap === undefined) setNodeProperty(t, 'style.strokeLinecap', 'round', { recordHistory: false });
                if (n?.style?.strokeLinejoin === undefined) setNodeProperty(t, 'style.strokeLinejoin', 'round', { recordHistory: false });
              });
              setStrokeOpen(true);
            };

            const collapseBtn = (open: boolean, onClick: () => void) => (
              <button onClick={(e) => { e.stopPropagation(); onClick(); }} className="flex items-center justify-center shrink-0" style={{ width: 24, height: 24 }}>
                {open ? <PhMinus size={14} color={TOGGLE} /> : <PhPlus size={14} color={TOGGLE} />}
              </button>
            );

            return (
              <div className="flex flex-col" style={{ padding: 10, gap: 10, borderBottom: '1px solid #444444' }}>
                {/* Appearance header */}
                <div className="flex items-center justify-between cursor-pointer" onClick={() => setAppearanceOpen(v => !v)}>
                  <span style={AP_LABEL}>Appearance</span>
                  {collapseBtn(appearanceOpen, () => setAppearanceOpen(v => !v))}
                </div>

                {appearanceOpen && (
                  <>
                    {/* Fill */}
                    <div className="flex flex-col" style={{ gap: 10 }}>
                      <div className="flex items-center justify-between cursor-pointer" onClick={() => setFillOpen(v => !v)}>
                        <span style={AP_LABEL}>Fill</span>
                        {collapseBtn(fillOpen, () => setFillOpen(v => !v))}
                      </div>

                      {fillOpen && (
                        <div className="flex flex-col" style={{ gap: 10 }}>
                          {/* Color */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center min-w-0">
                              <KeyframeDiamond nodeId={selectedNode!.id} paths={['style.fill', 'style.fillGradient']} />
                              <span className="truncate" style={AP_LABEL}>Color</span>
                            </div>
                            {paintColorField('style.fill', 'style.fillType', 'style.fillGradient')}
                          </div>

                          {/* Opacity */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center min-w-0">
                              <KeyframeDiamond nodeId={selectedNode!.id} paths={['style.fillOpacity']} />
                              <span className="truncate" style={AP_LABEL}>Opacity</span>
                            </div>
                            <div className="flex items-center shrink-0" style={{ width: 140 }}>
                              {renderXform('style.fillOpacity', { suffix: '%', displayFactor: 100, min: 0, max: 1, defaultValue: 1 })}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Stroke — clicking when no stroke adds a 2px black default and opens it */}
                    <div className="flex flex-col" style={{ gap: 10 }}>
                      <div className="flex items-center justify-between cursor-pointer" onClick={() => { if (!hasStroke) addStroke(); else setStrokeOpen(v => !v); }}>
                        <span style={AP_LABEL}>Stroke</span>
                        <button onClick={(e) => { e.stopPropagation(); if (!hasStroke) addStroke(); else setStrokeOpen(v => !v); }} className="flex items-center justify-center shrink-0" style={{ width: 24, height: 24 }}>
                          {(hasStroke && strokeOpen) ? <PhMinus size={14} color={TOGGLE} /> : <PhPlus size={14} color={TOGGLE} />}
                        </button>
                      </div>

                      {hasStroke && strokeOpen && (
                        <div className="flex flex-col" style={{ gap: 10 }}>
                          {/* Color */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center min-w-0">
                              <KeyframeDiamond nodeId={selectedNode!.id} paths={['style.stroke', 'style.strokeGradient']} />
                              <span className="truncate" style={AP_LABEL}>Color</span>
                            </div>
                            {paintColorField('style.stroke', 'style.strokeType', 'style.strokeGradient')}
                          </div>

                          {/* Opacity */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center min-w-0">
                              <KeyframeDiamond nodeId={selectedNode!.id} paths={['style.strokeOpacity']} />
                              <span className="truncate" style={AP_LABEL}>Opacity</span>
                            </div>
                            <div className="flex items-center shrink-0" style={{ width: 140 }}>
                              {renderXform('style.strokeOpacity', { suffix: '%', displayFactor: 100, min: 0, max: 1, defaultValue: 1 })}
                            </div>
                          </div>

                          {/* Width */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center min-w-0">
                              <KeyframeDiamond nodeId={selectedNode!.id} paths={['style.strokeWidth']} />
                              <span className="truncate" style={AP_LABEL}>Width</span>
                            </div>
                            <div className="flex items-center shrink-0" style={{ width: 140 }}>
                              {renderXform('style.strokeWidth', { min: 0, defaultValue: 1 })}
                            </div>
                          </div>

                          {/* Line Cap */}
                          <PropDropdown label="Line Cap"
                            value={(getCommonValue('style.strokeLinecap') as string) || 'round'}
                            options={[{ value: 'butt', label: 'Butt' }, { value: 'round', label: 'Round' }, { value: 'square', label: 'Square' }]}
                            onChange={(v) => handleChange('style.strokeLinecap', v)} />

                          {/* Line Join */}
                          <PropDropdown label="Line Join"
                            value={(getCommonValue('style.strokeLinejoin') as string) || 'round'}
                            options={[{ value: 'miter', label: 'Miter' }, { value: 'round', label: 'Round' }, { value: 'bevel', label: 'Bevel' }]}
                            onChange={(v) => handleChange('style.strokeLinejoin', v)} />

                          {/* Style (solid / dashed) */}
                          <PropDropdown label="Style"
                            value={isDashed ? 'dashed' : 'solid'}
                            options={[{ value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }]}
                            onChange={(v) => handleChange('style.strokeDash', v === 'dashed' ? '10 10' : '')} />

                          {/* Dashed sub-settings */}
                          {isDashed && (
                            <>
                              <div className="flex items-center justify-between">
                                <span className="truncate" style={AP_LABEL}>Dash</span>
                                <div className="flex items-center shrink-0" style={{ width: 140 }}>
                                  <XformInput value={dashLen} min={0} onChange={(v, rec) => {
                                    const str = `${Math.max(0, Math.round(v))} ${Math.round(gapLen)}`;
                                    (selectedIds.length > 0 ? selectedIds : (previewNode ? [previewNode.id] : [])).forEach(t => setNodeProperty(t, 'style.strokeDash', str, { recordHistory: rec }));
                                  }} />
                                </div>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="truncate" style={AP_LABEL}>Gap</span>
                                <div className="flex items-center shrink-0" style={{ width: 140 }}>
                                  <XformInput value={gapLen} min={0} onChange={(v, rec) => {
                                    const str = `${Math.round(dashLen)} ${Math.max(0, Math.round(v))}`;
                                    (selectedIds.length > 0 ? selectedIds : (previewNode ? [previewNode.id] : [])).forEach(t => setNodeProperty(t, 'style.strokeDash', str, { recordHistory: rec }));
                                  }} />
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Roundness (rect / path) */}
                    {showRoundness && (
                      <div className="flex flex-col" style={{ gap: 10 }}>
                        <div className="flex items-center justify-between cursor-pointer" onClick={() => setRoundnessOpen(v => !v)}>
                          <span style={AP_LABEL}>Roundness</span>
                          {collapseBtn(roundnessOpen, () => setRoundnessOpen(v => !v))}
                        </div>
                        {roundnessOpen && (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center min-w-0">
                              <KeyframeDiamond nodeId={selectedNode!.id} paths={['props.roundness']} />
                              <span className="truncate" style={AP_LABEL}>Radius</span>
                            </div>
                            <div className="flex items-center shrink-0" style={{ width: 140 }}>
                              {renderXform('props.roundness', { min: 0, defaultValue: 0 })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })()}

          {/* Layer Section — Matte / Blend Mode / Set Parent (collapsed by default) */}
          {selectedNode && (() => {
            if (!selectedNode) return null;
            const LBL: React.CSSProperties = { fontFamily: 'Inter, sans-serif', fontWeight: 450, fontSize: 12, lineHeight: '16px', letterSpacing: '0.005em', color: '#FFFFFF' };
            const node = selectedNode;

            // Matte source is implicitly the layer directly above (children[i+1] — higher index
            // is on top, per the exporter's "index 0 = bottom-most" convention).
            const parentNode = nodes.get(node.parentId || '');
            const siblings = parentNode?.children || [];
            const selfIdx = siblings.indexOf(node.id);
            const aboveId = selfIdx >= 0 ? siblings[selfIdx + 1] : undefined;
            const matteValue = node.matteSourceId ? String(node.matteType || 1) : '0';
            const setMatteType = (typeStr: string) => {
              const t = parseInt(typeStr, 10);
              if (t === 0) { setMatte(node.id, null); updateNode(node.id, { matteType: 0 }); }
              else if (aboveId) { setMatte(node.id, aboveId); updateNode(node.id, { matteType: t }); }
            };

            const blendModes = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];
            const cap = (s: string) => s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            const blendValue = (getCommonValue('style.blendMode') as string) || 'normal';

            // Set Parent: any sibling layer (same parent), excluding self.
            const parentCandidates = siblings.map(id => nodes.get(id)).filter(n => n && n.id !== node.id && n.type !== 'artboard') as SceneNode[];
            const parentOptions = [{ value: '', label: 'None' }, ...parentCandidates.map(n => ({ value: n.id, label: n.name }))];

            return (
              <div className="flex flex-col" style={{ padding: 10, gap: 10, borderBottom: '1px solid #444444' }}>
                <div className="flex items-center justify-between cursor-pointer" onClick={() => setLayerOpen(v => !v)}>
                  <span style={LBL}>Layer</span>
                  <CollapseToggle open={layerOpen} onClick={() => setLayerOpen(v => !v)} />
                </div>
                {layerOpen && (
                  <>
                    <PropDropdown label="Matte" value={matteValue}
                      options={[{ value: '0', label: 'No Matte' }, { value: '1', label: 'Alpha' }, { value: '2', label: 'Alpha Inverted' }, { value: '3', label: 'Luma' }, { value: '4', label: 'Luma Inverted' }]}
                      onChange={setMatteType} />
                    <PropDropdown label="Blend Mode" value={blendValue}
                      options={blendModes.map(m => ({ value: m, label: cap(m) }))}
                      onChange={(v) => handleChange('style.blendMode', v)} />
                    <PropDropdown label="Set Parent" value={node.parentLayerId || ''}
                      options={parentOptions}
                      onChange={(v) => updateNode(node.id, { parentLayerId: v || null })} />
                  </>
                )}
              </div>
            );
          })()}

          {/* Trim Path Section (collapsed by default) */}
          {isRectOrEllipseOrPath && (!selectedNode || selectedNode.type !== 'image') && !isOnlyPrimitivesSelected && (() => {
            const LBL: React.CSSProperties = { fontFamily: 'Inter, sans-serif', fontWeight: 450, fontSize: 12, lineHeight: '16px', letterSpacing: '0.005em', color: '#FFFFFF' };
            return (
              <div className="flex flex-col" style={{ padding: 10, gap: 10, borderBottom: '1px solid #444444' }}>
                <div className="flex items-center justify-between cursor-pointer" onClick={() => setTrimPathExpanded(v => !v)}>
                  <span style={LBL}>Trim Path</span>
                  <CollapseToggle open={trimPathExpanded} onClick={() => setTrimPathExpanded(v => !v)} />
                </div>
                {trimPathExpanded && (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center min-w-0"><KeyframeDiamond nodeId={selectedNode!.id} paths={['style.trimStart']} /><span className="truncate" style={LBL}>Start</span></div>
                      <div className="flex items-center shrink-0" style={{ width: 140 }}>{renderXform('style.trimStart', { suffix: '%', displayFactor: 100, min: 0, max: 1, defaultValue: 0 })}</div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center min-w-0"><KeyframeDiamond nodeId={selectedNode!.id} paths={['style.trimEnd']} /><span className="truncate" style={LBL}>End</span></div>
                      <div className="flex items-center shrink-0" style={{ width: 140 }}>{renderXform('style.trimEnd', { suffix: '%', displayFactor: 100, min: 0, max: 1, defaultValue: 1 })}</div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center min-w-0"><KeyframeDiamond nodeId={selectedNode!.id} paths={['style.trimOffset']} /><span className="truncate" style={LBL}>Offset</span></div>
                      <div className="flex items-center shrink-0" style={{ width: 140 }}>{renderXform('style.trimOffset', { suffix: '°', defaultValue: 0 })}</div>
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          {/* Effects Section — '+' adds a Drop Shadow; switch type or edit via the settings popover */}
          {selectedNode && (() => {
            if (!selectedNode) return null;
            const LBL: React.CSSProperties = { fontFamily: 'Inter, sans-serif', fontWeight: 450, fontSize: 12, lineHeight: '16px', letterSpacing: '0.005em', color: '#FFFFFF' };
            const effects = selectedNode.style.effects || [];
            return (
              <div className="flex flex-col" style={{ padding: 10, gap: 10, borderBottom: '1px solid #444444' }}>
                <div className="flex items-center justify-between">
                  <span style={LBL}>Effects</span>
                  <button onClick={() => handleAddEffect('shadow')} title="Add Effect" className="flex items-center justify-center shrink-0" style={{ width: 24, height: 24 }}>
                    <PhPlus size={14} color="rgba(255,255,255,0.5)" />
                  </button>
                </div>
                {effects.map(effect => (
                  <div key={effect.id} className="flex items-center" style={{ gap: 6 }}>
                    <div className="flex-1 min-w-0">
                      <BareDropdown value={effect.type}
                        options={[{ value: 'shadow', label: 'Drop Shadow' }, { value: 'blur', label: 'Blur' }]}
                        onChange={(v) => handleEffectChange(effect.id, { type: v, name: v === 'shadow' ? 'Drop Shadow' : 'Blur' })} />
                    </div>
                    <EffectPopover effect={effect} onChange={(u) => handleEffectChange(effect.id, u)}
                      trigger={<button className="flex items-center justify-center shrink-0 text-white/50 hover:text-white transition-colors" style={{ width: 24, height: 24 }} title="Effect Settings"><PhFaders size={16} /></button>} />
                    <button onClick={() => handleRemoveEffect(effect.id)} className="flex items-center justify-center shrink-0 text-white/50 hover:text-white transition-colors" style={{ width: 24, height: 24 }} title="Remove Effect">
                      <PhMinus size={14} />
                    </button>
                  </div>
                ))}
              </div>
            );
          })()}

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

        // Figma layout/structure, scaled to match the app's other panels (Layers/Timeline/
        // Transform): 32px fields (h-8), 12px text, 16–18px icons.
        const AB_FONT: React.CSSProperties = { fontFamily: 'Inter, sans-serif', fontWeight: 450, fontSize: 12, lineHeight: '16px', color: '#FFFFFF', letterSpacing: '0.005em' };
        const AB_LABEL: React.CSSProperties = { fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 12, color: 'rgba(255,255,255,0.7)' };
        const AB_FIELD: React.CSSProperties = { height: 32, background: '#383838', borderRadius: 6 };
        const AB_DROPDOWN: React.CSSProperties = { height: 32, background: '#2C2C2C', border: '1px solid #444444', borderRadius: 6, paddingLeft: 10 };
        const ICON_MUTED = 'rgba(255,255,255,0.7)';
        const ICON_SLOT: React.CSSProperties = { width: 32, height: 32 };
        const scaleLink = !!targetNode.transform?.scaleLink;

        return (
          <div className="flex flex-col flex-1" style={{ background: '#2C2C2C' }}>

            {/* Heading */}
            <div className="flex items-center" style={{ padding: '10px', borderBottom: '1px solid #444444' }}>
              <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 12, lineHeight: '16px', letterSpacing: '0.005em', color: '#FFFFFF' }}>Artboard</span>
            </div>

            {/* Content rows */}
            <div className="flex flex-col" style={{ padding: '10px 0', gap: 10 }}>

              {/* Row: Preset dropdown (Custom Size) */}
              <div style={{ padding: '0 10px' }}>
                <div className="relative">
                  <button
                    onClick={() => setShowPresets(v => !v)}
                    className="flex items-center w-full"
                    style={AB_DROPDOWN}
                  >
                    <span className="flex-1 text-left truncate" style={AB_FONT}>{presetLabel}</span>
                    <div className="flex items-center justify-center shrink-0" style={ICON_SLOT}>
                      <PhCaretDown size={14} weight="regular" color={ICON_MUTED} />
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

              {/* Row: Background color */}
              <div style={{ padding: '0 10px' }}>
                <div className="flex items-center" style={{ gap: 6 }}>
                  {/* Swatch + hex field */}
                  <div className="flex items-center flex-1 min-w-0" style={AB_FIELD}>
                    <div className="flex items-center justify-center shrink-0" style={ICON_SLOT}>
                      <div className="relative overflow-hidden" style={{
                        width: 16, height: 16, borderRadius: 3,
                        border: '1px solid rgba(255,255,255,0.1)',
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
                  {/* Visibility toggle (eye — Phosphor fill) */}
                  <button
                    onClick={() => setNodeProperty(targetId, 'props.transparent', !isTransparent)}
                    className="flex items-center justify-center shrink-0 transition-colors"
                    style={{ ...ICON_SLOT, borderRadius: 5 }}
                    title={isTransparent ? 'Show background' : 'Transparent background'}
                  >
                    {isTransparent
                      ? <PhEyeSlash size={18} weight="fill" color="rgba(255,255,255,0.4)" />
                      : <PhEye size={18} weight="fill" color={ICON_MUTED} />}
                  </button>
                </div>
              </div>

              {/* Row: W/H dimensions */}
              <div style={{ padding: '0 10px' }}>
                <div className="flex items-center" style={{ gap: 6 }}>
                  {/* W */}
                  <div className="flex items-center flex-1 min-w-0" style={{ ...AB_FIELD, overflow: 'hidden' }}>
                    <div className="flex items-center justify-center shrink-0" style={ICON_SLOT}>
                      <span style={AB_LABEL}>W</span>
                    </div>
                    <ArtboardInlineInput value={w} min={1}
                      onChange={v => setNodeProperty(targetId, 'props.width', v, { recordHistory: true })} />
                  </div>
                  {/* H */}
                  <div className="flex items-center flex-1 min-w-0" style={{ ...AB_FIELD, overflow: 'hidden' }}>
                    <div className="flex items-center justify-center shrink-0" style={ICON_SLOT}>
                      <span style={AB_LABEL}>H</span>
                    </div>
                    <ArtboardInlineInput value={h} min={1}
                      onChange={v => setNodeProperty(targetId, 'props.height', v, { recordHistory: true })} />
                  </div>
                  {/* Link (proportional lock) — blue background when on */}
                  <button
                    onClick={() => setNodeProperty(targetId, 'transform.scaleLink', !scaleLink)}
                    className="flex items-center justify-center shrink-0 transition-colors"
                    style={{ ...ICON_SLOT, borderRadius: 5, background: scaleLink ? '#0A6DC2' : 'transparent' }}
                    title={scaleLink ? 'Proportional scaling on' : 'Proportional scaling off'}
                  >
                    <PhLinkSimple size={16} weight="regular" color={scaleLink ? '#FFFFFF' : 'rgba(255,255,255,0.4)'} />
                  </button>
                </div>
              </div>

              {/* Row: Duration + FPS */}
              <div style={{ padding: '0 10px' }}>
                <div className="flex items-center" style={{ gap: 6 }}>
                  {/* Duration */}
                  <div className="flex items-center flex-1 min-w-0" style={AB_FIELD}>
                    <div className="flex items-center justify-center shrink-0" style={ICON_SLOT}>
                      <PhClock size={18} weight="regular" color={ICON_MUTED} />
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
                      <div className="flex items-center justify-center shrink-0" style={ICON_SLOT}>
                        <PhCaretDown size={14} weight="regular" color={ICON_MUTED} />
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
        className="flex-1 min-w-0 bg-transparent outline-none text-left"
        style={{ fontFamily: 'Inter, sans-serif', fontWeight: 450, fontSize: 12, color: '#FFFFFF' }}
        value={local}
        onChange={e => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
      />
    );
  }

  return (
    <div className="flex-1 min-w-0 flex items-center justify-start cursor-ew-resize select-none h-full"
      onMouseDown={handleMouseDown}
      onClick={() => { setLocal(value.toString()); setEditing(true); }}
    >
      <span className="truncate" style={{ fontFamily: 'Inter, sans-serif', fontWeight: 450, fontSize: 12, color: '#FFFFFF' }}>
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

// Keyframe toggle rendered as a solid diamond (Figma Transform rows). Reuses the same
// toggleStopwatch logic as StopwatchButton; dim white when un-animated, accent when the
// property is animated, ringed when a keyframe sits at the current time.
function KeyframeDiamond({ nodeId, paths }: { nodeId: string; paths: string[] }) {
  const nodes = useCreatorStore((state) => state.nodes);
  const currentTime = useCreatorStore((state) => state.currentTime);
  const node = nodes.get(nodeId);
  if (!node) return null;
  const animations = node.animations || {};
  const hasAnimation = paths.some(p => !!animations[p]);
  const hasKeyframe = hasAnimation && paths.some(p => animations[p]?.some(k => Math.abs(k.time - currentTime) < 0.1));
  return (
    <button
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); paths.forEach(p => useCreatorStore.getState().toggleStopwatch(nodeId, p)); }}
      className="flex items-center justify-center shrink-0 transition-all"
      style={{ height: 24, paddingRight: 9 }}
      title="Toggle keyframe animation"
    >
      <div
        className="rotate-45 transition-all"
        style={{
          width: 9, height: 9, borderRadius: 1.5,
          background: hasAnimation ? 'var(--accent)' : 'rgba(255,255,255,0.7)',
          outline: hasKeyframe ? '1.5px solid rgba(255,255,255,0.9)' : 'none',
          outlineOffset: 1,
        }}
      />
    </button>
  );
}

// Figma-style numeric field: #383838 pill, optional centered prefix slot (X/Y), left-aligned
// value with optional suffix (°/%), horizontal drag-to-scrub and click-to-edit. Multi-select
// aware via the onChange callback; rAF-coalesced so downstream updates stay one-per-frame.
function XformInput({ value, isMixed, prefix, suffix, min, max, step = 1, displayFactor = 1, onChange }: {
  value: number; isMixed?: boolean; prefix?: string; suffix?: string;
  min?: number; max?: number; step?: number; displayFactor?: number;
  onChange: (v: number, recordHistory?: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const rafId = useRef<number | null>(null);
  const pending = useRef<number | null>(null);

  const display = isMixed ? 'Mixed' : String(Math.round(value * displayFactor * 100) / 100);

  useEffect(() => { if (editing) { ref.current?.focus(); ref.current?.select(); } }, [editing]);
  useEffect(() => () => { if (rafId.current !== null) cancelAnimationFrame(rafId.current); }, []);

  const commit = () => {
    setEditing(false);
    const n = parseFloat(local);
    if (!isNaN(n)) onChange(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n / displayFactor)), true);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (editing || e.button !== 0 || isMixed) return;
    const startX = e.clientX;
    const startVal = value;
    let moved = false, recorded = false;
    const onMove = (me: MouseEvent) => {
      const dx = me.clientX - startX;
      if (Math.abs(dx) > 3) moved = true;
      if (!moved) return;
      if (!recorded) {
        recorded = true;
        useCreatorStore.getState().pushToHistory('Change Property');
      }
      let sens = step / displayFactor;
      if (me.shiftKey) sens *= 10;
      if (me.altKey) sens /= 10;
      pending.current = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, startVal + dx * sens));
      if (rafId.current === null) {
        rafId.current = requestAnimationFrame(() => {
          rafId.current = null;
          if (pending.current !== null) { onChange(pending.current, false); pending.current = null; }
        });
      }
    };
    const onUp = () => {
      if (rafId.current !== null) { cancelAnimationFrame(rafId.current); rafId.current = null; }
      if (pending.current !== null) { onChange(pending.current, false); pending.current = null; }
      if (!moved) { setLocal(display); setEditing(true); }
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = 'default';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'ew-resize';
  };

  const valStyle: React.CSSProperties = { fontFamily: 'Inter, sans-serif', fontWeight: 450, fontSize: 12, color: isMixed ? 'rgba(255,170,90,0.85)' : '#FFFFFF', paddingLeft: prefix ? 0 : 8, paddingRight: 8 };

  return (
    <div
      className="flex items-center flex-1 min-w-0 cursor-ew-resize select-none"
      style={{ height: 32, background: '#383838', borderRadius: 6 }}
      onMouseDown={handleMouseDown}
    >
      {prefix && (
        <div className="flex items-center justify-center shrink-0" style={{ width: 24, height: 32 }}>
          <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{prefix}</span>
        </div>
      )}
      {editing ? (
        <input
          ref={ref}
          type="text"
          className="flex-1 min-w-0 bg-transparent outline-none text-left"
          style={valStyle}
          value={local}
          onChange={e => setLocal(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        />
      ) : (
        <span className="flex-1 min-w-0 truncate text-left" style={valStyle}>{display}{isMixed ? '' : (suffix || '')}</span>
      )}
    </div>
  );
}

// Figma-style dropdown row: label on the left, a 140px #383838 dropdown on the right.
// Self-contained open state; used for Line Cap / Line Join / Stroke Style.
// +/− section collapse toggle (Appearance / Layer / Trim Path headers).
function CollapseToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }} className="flex items-center justify-center shrink-0" style={{ width: 24, height: 24 }}>
      {open ? <PhMinus size={14} color="rgba(255,255,255,0.5)" /> : <PhPlus size={14} color="rgba(255,255,255,0.5)" />}
    </button>
  );
}

// The dropdown control itself (button + menu), no label. Fills its container by default.
function BareDropdown({ value, options, onChange, openUp = false }: {
  value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; openUp?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const LBL: React.CSSProperties = { fontFamily: 'Inter, sans-serif', fontWeight: 450, fontSize: 12, lineHeight: '16px', letterSpacing: '0.005em', color: '#FFFFFF' };
  const current = options.find(o => o.value === value) || options[0];
  return (
    <div className="relative w-full">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center justify-between" style={{ height: 32, background: '#383838', borderRadius: 6, paddingLeft: 8 }}>
        <span className="truncate" style={LBL}>{current?.label}</span>
        <div className="flex items-center justify-center shrink-0" style={{ width: 24, height: 32 }}>
          <PhCaretDown size={14} weight="regular" color="rgba(255,255,255,0.7)" />
        </div>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[99]" onClick={() => setOpen(false)} />
          <div className={`absolute left-0 right-0 z-[100] rounded overflow-y-auto ${openUp ? 'bottom-full mb-1' : 'top-full mt-1'}`} style={{ background: '#27292C', border: '1px solid #444444', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', maxHeight: 240 }}>
            {options.map(o => (
              <button key={o.value} className="w-full text-left px-3 py-2 hover:bg-white/5 transition-colors"
                style={{ ...LBL, color: o.value === value ? 'var(--accent)' : '#FFFFFF' }}
                onClick={() => { onChange(o.value); setOpen(false); }}>
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Label-left + 140px dropdown-right row (Line Cap, Line Join, Style, Matte, Blend Mode, Set Parent).
function PropDropdown({ label, value, options, onChange, width = 140 }: {
  label: string; value: string; options: { value: string; label: string }[];
  onChange: (v: string) => void; width?: number;
}) {
  const LBL: React.CSSProperties = { fontFamily: 'Inter, sans-serif', fontWeight: 450, fontSize: 12, lineHeight: '16px', letterSpacing: '0.005em', color: '#FFFFFF' };
  return (
    <div className="flex items-center justify-between">
      <span className="truncate" style={LBL}>{label}</span>
      <div className="shrink-0" style={{ width }}>
        <BareDropdown value={value} options={options} onChange={onChange} />
      </div>
    </div>
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

