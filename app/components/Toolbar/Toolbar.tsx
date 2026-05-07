'use client';

import { useCreatorStore } from '@/lib/creator/state/store';
import { MousePointer2, Square, Circle, PenTool, Type, Image as ImageIcon, GripHorizontal, Compass, Star } from 'lucide-react';
import { useRef } from 'react';
import { createImageNode } from '@/lib/creator/core/SceneNode';
import { SVGImporter } from '@/lib/creator/core/SVGImporter';
import { getPathLocalBounds, getCollectiveBoundingBox, getAnchorOffset } from '@/lib/creator/core/Matrix';
import { SceneNode } from '@/lib/creator/state/sceneSlice';

export default function Toolbar() {
  const activeTool = useCreatorStore((state) => state.activeTool);
  const setActiveTool = useCreatorStore((state) => state.setActiveTool);
  const addNodesBatch = useCreatorStore((state) => state.addNodesBatch);
  const nodes = useCreatorStore((state) => state.nodes);
  const activeArtboardId = useCreatorStore((state) => state.activeArtboardId);
  const isSegmentsPanelOpen = useCreatorStore((state) => state.isSegmentsPanelOpen);
  const setSegmentsPanelOpen = useCreatorStore((state) => state.setSegmentsPanelOpen);
  const isDiscoverModalOpen = useCreatorStore((state) => state.isDiscoverModalOpen);
  const setDiscoverModalOpen = useCreatorStore((state) => state.setDiscoverModalOpen);
  const creatorMode = useCreatorStore((state) => state.creatorMode);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isStateFlowMode = creatorMode === 'state-flow';

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      console.warn('⚠️ No file selected');
      return;
    }

    console.log('📂 File selected for import:', file.name, file.type, file.size);

    let artboardId = activeArtboardId;
    if (!artboardId) {
      const artboard = Array.from(nodes.values()).find(n => n.type === 'artboard');
      artboardId = artboard?.id || null;
    }

    if (!artboardId) {
      console.error('❌ No active artboard found to import into');
      // Ideally show a toast or alert here
      return;
    }
    console.log('🎨 Importing into Artboard:', artboardId);

    const artboard = nodes.get(artboardId);
    // Default center fallback
    const centerX = artboard?.props.width ? artboard.props.width / 2 : 250;
    const centerY = artboard?.props.height ? artboard.props.height / 2 : 250;

    if (file.type.startsWith('image/svg')) {
      console.log('🔹 Processing SVG import...');
      try {
        const text = await file.text();
        const duration = artboard?.props.duration || 100000;
        const importedNodes = await SVGImporter.importFromString(text, duration);
        console.log(`🔹 SVG parsed: ${importedNodes.length} nodes (Duration: ${duration})`);

        const topLevelIds = importedNodes.filter(n => !n.parentId).map(n => n.id);
        const nodesMap = new Map(importedNodes.map(n => [n.id, n]));
        const bounds = getCollectiveBoundingBox(topLevelIds, nodesMap);

        const contentWidth = bounds.width;
        const contentHeight = bounds.height;
        const offsetX = centerX - (bounds.x + contentWidth / 2);
        const offsetY = centerY - (bounds.y + contentHeight / 2);

        // Apply offset and parent
        if (isFinite(offsetX) && isFinite(offsetY)) {
          importedNodes.forEach(n => {
            if (!n.parentId) {
              n.parentId = artboardId;
              n.transform.x += offsetX;
              n.transform.y += offsetY;
            }
          });

          // Auto-scale SVG to fit artboard
          if (artboard && artboard.props.width && artboard.props.height && contentWidth > 0 && contentHeight > 0) {
            const artboardAreaWidth = artboard.props.width * 0.8;
            const artboardAreaHeight = artboard.props.height * 0.8;

            const scaleW = artboardAreaWidth / contentWidth;
            const scaleH = artboardAreaHeight / contentHeight;
            const scale = Math.min(scaleW, scaleH);

            // If significantly different from 1, apply it
            if (Math.abs(scale - 1) > 0.01) {
              console.log(`📉 Auto-scaling SVG by ${scale.toFixed(2)} to fit artboard`);
              importedNodes.forEach(n => {
                if (!n.parentId || n.parentId === artboardId) {
                  // Scale position relative to center
                  const dx = n.transform.x - centerX;
                  const dy = n.transform.y - centerY;
                  n.transform.x = centerX + dx * scale;
                  n.transform.y = centerY + dy * scale;

                  // Scale node
                  n.transform.scaleX *= scale;
                  n.transform.scaleY *= scale;
                }
              });
            }
          }
        } else {
          // Fallback if bounds calc failed (e.g. paths without width props)
          importedNodes.forEach(n => {
            if (!n.parentId) n.parentId = artboardId;
          });
        }

        console.log(`🚀 Adding ${importedNodes.length} SVG nodes to store...`);
        addNodesBatch(importedNodes);
      } catch (err) {
        console.error('❌ Error parsing SVG:', err);
      }

    } else if (file.type.startsWith('image/')) {
      console.log('🖼️ Processing Image import...');
      const reader = new FileReader();
      reader.onload = (event) => {
        const src = event.target?.result as string;
        const img = new Image();
        img.onload = () => {
          const node = createImageNode(
            centerX, centerY,
            img.naturalWidth, img.naturalHeight,
            src,
            file.name.split('.')[0],
            artboardId || null
          );

          // Auto-scale to fit artboard
          if (artboard && artboard.props.width && artboard.props.height) {
            const artboardAreaWidth = artboard.props.width * 0.8;
            const artboardAreaHeight = artboard.props.height * 0.8;

            const scaleW = artboardAreaWidth / img.naturalWidth;
            const scaleH = artboardAreaHeight / img.naturalHeight;
            const scale = Math.min(scaleW, scaleH);

            if (Math.abs(scale - 1) > 0.01) {
              console.log(`📉 Auto-scaling Image by ${scale.toFixed(2)} to fit artboard`);
              node.transform.scaleX = scale;
              node.transform.scaleY = scale;
            }
          }

          console.log('✅ Image node created:', node);
          addNodesBatch([node]);
        };
        img.onerror = (err) => console.error('❌ Failed to load image:', err);
        img.src = src;
      };
      reader.onerror = (err) => console.error('❌ FileReader error:', err);
      reader.readAsDataURL(file);
    } else {
      console.warn('⚠️ Unsupported file type:', file.type);
    }

    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const tools = [
    { id: 'select', name: 'Select', icon: <MousePointer2 size={18} />, key: 'V', editOnly: false },
    { id: 'rect', name: 'Rectangle', icon: <Square size={18} />, key: 'R', editOnly: true },
    { id: 'ellipse', name: 'Ellipse', icon: <Circle size={18} />, key: 'O', editOnly: true },
    { id: 'pen', name: 'Pen', icon: <PenTool size={18} />, key: 'P', editOnly: true },
    { id: 'text', name: 'Text', icon: <Type size={18} />, key: 'T', editOnly: true },
  ];

  const toolBtn = (isActive: boolean, isDisabled: boolean) =>
    isDisabled
      ? 'text-disabled cursor-not-allowed opacity-40'
      : isActive
        ? 'bg-accent/15 text-accent'
        : 'text-secondary hover:text-primary hover:bg-hover';

  return (
    <div className="w-full h-full flex flex-col items-center py-3 gap-0.5">
      {tools.map((tool) => {
        const isActive = activeTool === tool.id;
        const isDisabled = isStateFlowMode && tool.editOnly;
        return (
          <button
            key={tool.id}
            onClick={() => !isDisabled && setActiveTool(tool.id as any)}
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${toolBtn(isActive, isDisabled)}`}
            title={isDisabled ? `${tool.name} (unavailable in State Machines mode)` : `${tool.name} (${tool.key})`}
            disabled={isDisabled}
          >
            {tool.icon}
          </button>
        );
      })}

      <div className="w-6 h-px bg-white/[0.08] my-1.5" />

      <button
        onClick={() => !isStateFlowMode && fileInputRef.current?.click()}
        className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${toolBtn(false, isStateFlowMode)}`}
        title={isStateFlowMode ? 'Import (unavailable in State Machines mode)' : 'Import asset (Image/SVG)'}
        disabled={isStateFlowMode}
      >
        <ImageIcon size={16} />
      </button>

      <button
        onClick={() => setDiscoverModalOpen(true)}
        className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${isDiscoverModalOpen ? 'bg-accent/15 text-accent' : 'text-secondary hover:text-primary hover:bg-hover'}`}
        title="Discover brand logos"
      >
        <Compass size={16} />
      </button>

      <button
        onClick={() => setSegmentsPanelOpen(!isSegmentsPanelOpen)}
        className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${isSegmentsPanelOpen ? 'bg-accent/15 text-accent' : 'text-secondary hover:text-primary hover:bg-hover'}`}
        title="Segments (Flow Blocks)"
      >
        <GripHorizontal size={16} />
      </button>

      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept=".png,.jpg,.jpeg,.svg,.webp"
        onChange={handleFileImport}
      />
    </div>
  );
}