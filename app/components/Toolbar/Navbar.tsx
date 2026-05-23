'use client';

import { useCreatorStore } from '@/lib/creator/state/store';
import {
  MousePointer2, Square, Circle, PenTool, Type,
  Image as ImageIcon, Compass, ChevronDown,
  FileJson, Zap, Upload, FilePlus2, Download,
  RotateCcw, RotateCw, Copy, Clipboard, Settings, Keyboard, LayoutDashboard,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { createImageNode } from '@/lib/creator/core/SceneNode';
import { createArtboardNode } from '@/lib/creator/core/SceneNode';
import { SVGImporter } from '@/lib/creator/core/SVGImporter';
import { getCollectiveBoundingBox } from '@/lib/creator/core/Matrix';

// Exact colours extracted from Figma
const NAV_BG            = '#1D1E20';
const NAV_BORDER        = 'rgba(221,234,248,0.08)';
const ICON_COLOR        = 'rgba(252,253,255,0.94)';
const ACTIVE_BG         = '#111113';
const ACTIVE_BORDER     = 'rgba(211,237,248,0.11)';
const SHARE_BORDER      = 'rgba(91,129,254,0.67)';
const SHARE_TEXT        = '#9EB1FF';
const EXPORT_BG         = '#3E63DD';
const SEG_CONTAINER_BG  = 'rgba(0,0,0,0.30)';

// Logo dropdown colours
const MENU_BG           = '#1C1D1F';
const MENU_BORDER       = 'rgba(255,255,255,0.08)';
const MENU_TEXT         = '#F2F2F2';
const MENU_MUTED        = 'rgba(255,255,255,0.38)';
const MENU_ICON         = 'rgba(255,255,255,0.50)';
const MENU_SEPARATOR    = 'rgba(255,255,255,0.08)';

interface NavbarProps {
  onImportLottie: () => void;
  onExport: (format: 'json' | 'lottie') => void;
}

// ── Reusable menu row ───────────────────────────────────────────────────────
function MenuItem({
  icon, label, shortcut, arrow, disabled = false, onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  shortcut?: string;
  arrow?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      className="w-full flex items-center gap-3 px-4 py-[9px] text-left transition-colors"
      style={{
        color: disabled ? MENU_MUTED : MENU_TEXT,
        fontSize: 14,
        cursor: disabled ? 'default' : 'pointer',
        background: 'transparent',
      }}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      {icon && (
        <span style={{ color: disabled ? MENU_MUTED : MENU_ICON, width: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {icon}
        </span>
      )}
      <span className="flex-1 font-[450]">{label}</span>
      {shortcut && <span style={{ color: MENU_MUTED, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{shortcut}</span>}
      {arrow && <span style={{ color: MENU_MUTED, fontSize: 16, lineHeight: 1 }}>›</span>}
    </button>
  );
}

function MenuSeparator() {
  return <div className="my-1 mx-4" style={{ height: 1, background: MENU_SEPARATOR }} />;
}

export default function Navbar({ onImportLottie, onExport }: NavbarProps) {
  const activeTool            = useCreatorStore(s => s.activeTool);
  const setActiveTool         = useCreatorStore(s => s.setActiveTool);
  const addNodesBatch         = useCreatorStore(s => s.addNodesBatch);
  const nodes                 = useCreatorStore(s => s.nodes);
  const activeArtboardId      = useCreatorStore(s => s.activeArtboardId);
  const isDiscoverModalOpen   = useCreatorStore(s => s.isDiscoverModalOpen);
  const setDiscoverModalOpen  = useCreatorStore(s => s.setDiscoverModalOpen);
  const creatorMode           = useCreatorStore(s => s.creatorMode);
  const undo                  = useCreatorStore(s => s.undo);
  const redo                  = useCreatorStore(s => s.redo);
  const copySelection         = useCreatorStore(s => s.copySelection);
  const pasteSelection        = useCreatorStore(s => s.pasteSelection);

  const [showLogoMenu,       setShowLogoMenu]       = useState(false);
  const [showExport,         setShowExport]         = useState(false);
  const [showEditSubmenu,    setShowEditSubmenu]     = useState(false);
  const [showNewFileConfirm, setShowNewFileConfirm] = useState(false);

  const assetInputRef    = useRef<HTMLInputElement>(null);
  const editTimeoutRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isStateFlowMode = creatorMode === 'state-flow';

  // ── New File ─────────────────────────────────────────────────────────────
  const confirmNewFile = () => {
    const artboard = createArtboardNode();
    useCreatorStore.setState({
      nodes: new Map([[artboard.id, artboard]]),
      selectedIds: [],
      activeArtboardId: artboard.id,
      currentTime: 0,
      isPlaying: false,
      past: [],
      future: [],
      clipboard: [],
    });
    setShowNewFileConfirm(false);
    setShowLogoMenu(false);
  };

  // ── Edit submenu hover helpers ────────────────────────────────────────────
  const openEditSubmenu  = () => { if (editTimeoutRef.current) clearTimeout(editTimeoutRef.current); setShowEditSubmenu(true); };
  const closeEditSubmenu = () => { editTimeoutRef.current = setTimeout(() => setShowEditSubmenu(false), 150); };

  // ── Asset (SVG / image) import ───────────────────────────────────────────
  const handleAssetImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    let artboardId = activeArtboardId;
    if (!artboardId) {
      const artboard = Array.from(nodes.values()).find(n => n.type === 'artboard');
      artboardId = artboard?.id || null;
    }
    if (!artboardId) return;

    const artboard = nodes.get(artboardId);
    const cx = artboard?.props.width  ? artboard.props.width  / 2 : 250;
    const cy = artboard?.props.height ? artboard.props.height / 2 : 250;

    if (file.type.startsWith('image/svg')) {
      try {
        const text     = await file.text();
        const duration = artboard?.props.duration || 100000;
        const imported = await SVGImporter.importFromString(text, duration);
        const topIds   = imported.filter(n => !n.parentId).map(n => n.id);
        const nodesMap = new Map(imported.map(n => [n.id, n]));
        const bounds   = getCollectiveBoundingBox(topIds, nodesMap);
        const ox = cx - (bounds.x + bounds.width  / 2);
        const oy = cy - (bounds.y + bounds.height / 2);

        imported.forEach(n => {
          if (!n.parentId) {
            n.parentId    = artboardId;
            n.transform.x += ox;
            n.transform.y += oy;
          }
        });

        if (artboard?.props.width && artboard?.props.height && bounds.width > 0 && bounds.height > 0) {
          const scale = Math.min(
            (artboard.props.width  * 0.8) / bounds.width,
            (artboard.props.height * 0.8) / bounds.height,
          );
          if (Math.abs(scale - 1) > 0.01) {
            imported.forEach(n => {
              if (!n.parentId || n.parentId === artboardId) {
                n.transform.x      = cx + (n.transform.x - cx) * scale;
                n.transform.y      = cy + (n.transform.y - cy) * scale;
                n.transform.scaleX *= scale;
                n.transform.scaleY *= scale;
              }
            });
          }
        }
        addNodesBatch(imported);
      } catch (err) {
        console.error('SVG import error:', err);
      }
    } else if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = ev => {
        const src = ev.target?.result as string;
        const img = new Image();
        img.onload = () => {
          const node = createImageNode(cx, cy, img.naturalWidth, img.naturalHeight, src, file.name.split('.')[0], artboardId || null);
          if (artboard?.props.width && artboard?.props.height) {
            const scale = Math.min(
              (artboard.props.width  * 0.8) / img.naturalWidth,
              (artboard.props.height * 0.8) / img.naturalHeight,
            );
            if (Math.abs(scale - 1) > 0.01) { node.transform.scaleX = scale; node.transform.scaleY = scale; }
          }
          addNodesBatch([node]);
        };
        img.src = src;
      };
      reader.readAsDataURL(file);
    }

    if (assetInputRef.current) assetInputRef.current.value = '';
  };

  // ── Tool definitions ──────────────────────────────────────────────────────
  const tools = [
    { id: 'select',  Icon: MousePointer2, key: 'V', label: 'Select',    editOnly: false },
    { id: 'rect',    Icon: Square,        key: 'R', label: 'Rectangle', editOnly: true  },
    { id: 'ellipse', Icon: Circle,        key: 'O', label: 'Ellipse',   editOnly: true  },
    { id: 'pen',     Icon: PenTool,       key: 'P', label: 'Pen',       editOnly: true  },
    { id: 'text',    Icon: Type,          key: 'T', label: 'Text',      editOnly: true  },
  ] as const;

  const toolBtnCls = (active: boolean, disabled: boolean) =>
    `w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
      disabled ? 'cursor-not-allowed opacity-30' : 'cursor-pointer'
    }`;

  const toolBtnStyle = (active: boolean): React.CSSProperties =>
    active
      ? { background: ACTIVE_BG, border: `1px solid ${ACTIVE_BORDER}`, color: ICON_COLOR }
      : { background: 'transparent', border: '1px solid transparent', color: ICON_COLOR };

  const utilBtnCls = () => `w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-white/[0.07]`;

  const utilBtnStyle = (active: boolean): React.CSSProperties =>
    active
      ? { background: ACTIVE_BG, border: `1px solid ${ACTIVE_BORDER}`, color: ICON_COLOR }
      : { background: 'transparent', border: '1px solid transparent', color: ICON_COLOR };

  return (
    <>
      <header
        className="h-[44px] shrink-0 flex items-center z-50"
        style={{ background: NAV_BG, borderBottom: `1px solid ${NAV_BORDER}` }}
      >
        {/* ── LEFT: logo + tools ────────────────────────────────────────── */}
        <div className="flex items-center h-full flex-1 min-w-0">

          {/* Logo menu trigger */}
          <div className="relative shrink-0">
            <button
              className="flex items-center gap-1.5 pl-3 pr-2.5 h-full hover:bg-white/[0.05] transition-colors"
              onClick={() => setShowLogoMenu(v => !v)}
              style={{ color: ICON_COLOR }}
            >
              <img src="/lottiepro-icon.svg" width={18} height={18} alt="LottiePro" />
              <span className="text-[13px] font-semibold">LottiePro</span>
              <ChevronDown size={11} style={{ color: 'rgba(252,253,255,0.35)' }} />
            </button>

            {/* ── Logo dropdown menu ──────────────────────────────────── */}
            {showLogoMenu && (
              <>
                <div className="fixed inset-0 z-[99]" onClick={() => { setShowLogoMenu(false); setShowEditSubmenu(false); }} />
                <div
                  className="absolute top-full left-0 mt-1.5 z-[100] py-1.5 rounded-xl"
                  style={{
                    width: 264,
                    background: MENU_BG,
                    border: `1px solid ${MENU_BORDER}`,
                    boxShadow: '0 20px 60px rgba(0,0,0,0.65)',
                    overflow: 'visible',
                  }}
                >
                  {/* New File */}
                  <MenuItem
                    icon={<FilePlus2 size={15} strokeWidth={1.75} />}
                    label="New File"
                    shortcut="⌘N"
                    onClick={() => { setShowLogoMenu(false); setShowNewFileConfirm(true); }}
                  />

                  {/* Import */}
                  <MenuItem
                    icon={<Upload size={15} strokeWidth={1.75} />}
                    label="Import"
                    shortcut="⌘I"
                    onClick={() => { onImportLottie(); setShowLogoMenu(false); }}
                  />

                  {/* Export */}
                  <MenuItem
                    icon={<Download size={15} strokeWidth={1.75} />}
                    label="Export"
                    shortcut="⌘E"
                    onClick={() => { setShowLogoMenu(false); setShowExport(true); }}
                  />

                  <MenuSeparator />

                  {/* Edit (with flyout submenu) */}
                  <div
                    className="relative"
                    onMouseEnter={openEditSubmenu}
                    onMouseLeave={closeEditSubmenu}
                  >
                    <MenuItem
                      icon={<RotateCcw size={15} strokeWidth={1.75} />}
                      label="Edit"
                      arrow
                      onClick={() => setShowEditSubmenu(v => !v)}
                    />

                    {showEditSubmenu && (
                      <div
                        className="absolute py-1.5 rounded-xl z-[101]"
                        style={{
                          left: '100%',
                          top: 0,
                          marginLeft: 6,
                          width: 224,
                          background: MENU_BG,
                          border: `1px solid ${MENU_BORDER}`,
                          boxShadow: '0 20px 60px rgba(0,0,0,0.65)',
                        }}
                        onMouseEnter={() => { if (editTimeoutRef.current) clearTimeout(editTimeoutRef.current); }}
                        onMouseLeave={closeEditSubmenu}
                      >
                        <MenuItem
                          icon={<RotateCcw size={15} strokeWidth={1.75} />}
                          label="Undo"
                          shortcut="⌘Z"
                          onClick={() => { undo(); setShowLogoMenu(false); setShowEditSubmenu(false); }}
                        />
                        <MenuItem
                          icon={<RotateCw size={15} strokeWidth={1.75} />}
                          label="Redo"
                          shortcut="⌘⇧Z"
                          onClick={() => { redo(); setShowLogoMenu(false); setShowEditSubmenu(false); }}
                        />
                        <MenuSeparator />
                        <MenuItem
                          icon={<Copy size={15} strokeWidth={1.75} />}
                          label="Copy"
                          shortcut="⌘C"
                          onClick={() => { copySelection(); setShowLogoMenu(false); setShowEditSubmenu(false); }}
                        />
                        <MenuItem
                          icon={<Clipboard size={15} strokeWidth={1.75} />}
                          label="Paste"
                          shortcut="⌘V"
                          onClick={() => { pasteSelection(); setShowLogoMenu(false); setShowEditSubmenu(false); }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Settings (stub) */}
                  <MenuItem
                    icon={<Settings size={15} strokeWidth={1.75} />}
                    label="Settings"
                    arrow
                    onClick={() => {}}
                  />

                  {/* Shortcuts (stub) */}
                  <MenuItem
                    icon={<Keyboard size={15} strokeWidth={1.75} />}
                    label="Shortcuts"
                    arrow
                    onClick={() => {}}
                  />

                  <MenuSeparator />

                  {/* Dashboard */}
                  <MenuItem
                    icon={<LayoutDashboard size={15} strokeWidth={1.75} />}
                    label="Dashboard"
                    onClick={() => { setShowLogoMenu(false); }}
                  />
                </div>
              </>
            )}
          </div>

          {/* Separator */}
          <div className="w-px h-5 mx-1 shrink-0" style={{ background: NAV_BORDER }} />

          {/* Drawing tools */}
          <div className="flex items-center gap-1 px-1">
            {tools.map(({ id, Icon, key, label, editOnly }) => {
              const active   = activeTool === id;
              const disabled = isStateFlowMode && editOnly;
              return (
                <button
                  key={id}
                  onClick={() => !disabled && setActiveTool(id as any)}
                  disabled={disabled}
                  title={disabled ? `${label} (unavailable in State Machine mode)` : `${label} (${key})`}
                  className={toolBtnCls(active, disabled)}
                  style={toolBtnStyle(active)}
                >
                  <Icon size={18} strokeWidth={1.75} />
                </button>
              );
            })}
          </div>

          {/* Separator */}
          <div className="w-px h-5 mx-1 shrink-0" style={{ background: NAV_BORDER }} />

          {/* Utility buttons */}
          <div className="flex items-center gap-0.5 px-1.5">
            <button
              onClick={() => !isStateFlowMode && assetInputRef.current?.click()}
              disabled={isStateFlowMode}
              title="Import asset (SVG / Image)"
              className={utilBtnCls()}
              style={utilBtnStyle(false)}
            >
              <ImageIcon size={16} strokeWidth={1.75} />
            </button>
            <button
              onClick={() => setDiscoverModalOpen(true)}
              title="Discover brand logos"
              className={utilBtnCls()}
              style={utilBtnStyle(isDiscoverModalOpen)}
            >
              <Compass size={16} strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {/* ── RIGHT: [Animate|StateMachine] + [Share] + [Export] ─────────── */}
        <div className="flex items-center gap-3 pr-1.5 shrink-0">

          {/* Animate / State Machine segmented control */}
          <div
            className="flex items-center p-[3px] rounded-lg gap-[2px]"
            style={{ background: SEG_CONTAINER_BG, border: `1px solid ${NAV_BORDER}` }}
          >
            <button
              onClick={() => useCreatorStore.getState().setCreatorMode('animate')}
              className="px-4 h-8 rounded-md text-[13px] font-medium transition-colors"
              style={
                creatorMode === 'animate'
                  ? { background: ACTIVE_BG, border: `1px solid ${ACTIVE_BORDER}`, color: ICON_COLOR }
                  : { background: 'transparent', border: '1px solid transparent', color: 'rgba(252,253,255,0.50)' }
              }
            >
              Animate
            </button>
            <button
              onClick={() => {
                const s = useCreatorStore.getState();
                s.setCreatorMode('state-flow');
                s.setSelection([]);
                s.setActiveTool('select');
                (s as any).setEditingNode?.(null);
              }}
              className="px-4 h-8 rounded-md text-[13px] font-medium transition-colors"
              style={
                creatorMode === 'state-flow'
                  ? { background: ACTIVE_BG, border: `1px solid ${ACTIVE_BORDER}`, color: ICON_COLOR }
                  : { background: 'transparent', border: '1px solid transparent', color: 'rgba(252,253,255,0.50)' }
              }
            >
              State Machine
            </button>
          </div>

          {/* Share */}
          <button
            className="h-9 px-4 rounded-lg text-[13px] font-medium transition-colors hover:opacity-80"
            style={{ border: `1px solid ${SHARE_BORDER}`, color: SHARE_TEXT }}
          >
            Share
          </button>

          {/* Export button + dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowExport(v => !v)}
              className="h-9 px-4 rounded-lg text-[13px] font-medium text-white flex items-center gap-2 transition-colors hover:opacity-90"
              style={{ background: EXPORT_BG }}
            >
              Export
              <ChevronDown
                size={12}
                className={`transition-transform duration-150 ${showExport ? 'rotate-180' : ''}`}
              />
            </button>

            {showExport && (
              <>
                <div className="fixed inset-0 z-[99]" onClick={() => setShowExport(false)} />
                <div
                  className="absolute top-full right-0 mt-1.5 w-52 rounded-xl overflow-hidden z-[100]"
                  style={{ background: 'var(--bg-surface)', border: '1px solid rgba(255,255,255,0.10)', boxShadow: 'var(--shadow-lg)' }}
                >
                  <div className="p-1.5 flex flex-col gap-0.5">
                    <button
                      onClick={() => { onExport('json'); setShowExport(false); }}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-left w-full hover:bg-hover"
                    >
                      <div className="w-7 h-7 rounded-md bg-white/5 flex items-center justify-center text-secondary">
                        <FileJson size={14} />
                      </div>
                      <div>
                        <div className="text-[13px] font-medium text-primary">Lottie JSON</div>
                        <div className="text-[11px] text-muted">Single file .json</div>
                      </div>
                    </button>
                    <button
                      onClick={() => { onExport('lottie'); setShowExport(false); }}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-left w-full hover:bg-hover"
                    >
                      <div className="w-7 h-7 rounded-md bg-accent/10 flex items-center justify-center text-accent">
                        <Zap size={14} />
                      </div>
                      <div>
                        <div className="text-[13px] font-medium text-primary">dotLottie</div>
                        <div className="text-[11px] text-muted">Bundled .lottie</div>
                      </div>
                    </button>
                  </div>
                  <div className="px-3 py-2 border-t border-white/[0.06]">
                    <p className="text-[11px] text-muted text-center">Web · iOS · Android</p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── New File confirmation modal ──────────────────────────────────── */}
      {showNewFileConfirm && (
        <>
          <div
            className="fixed inset-0 z-[200]"
            style={{ background: 'rgba(0,0,0,0.55)' }}
            onClick={() => setShowNewFileConfirm(false)}
          />
          <div className="fixed inset-0 z-[201] flex items-center justify-center pointer-events-none">
            <div
              className="pointer-events-auto rounded-2xl p-6"
              style={{
                width: 320,
                background: MENU_BG,
                border: `1px solid ${MENU_BORDER}`,
                boxShadow: '0 24px 64px rgba(0,0,0,0.80)',
              }}
            >
              <h3 className="text-[15px] font-semibold mb-1.5" style={{ color: MENU_TEXT }}>
                New File
              </h3>
              <p className="text-[13px] leading-relaxed mb-5" style={{ color: MENU_MUTED }}>
                This will clear the current scene. All unsaved changes will be lost.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowNewFileConfirm(false)}
                  className="px-4 py-2 rounded-lg text-[13px] font-medium transition-colors hover:bg-white/[0.08]"
                  style={{ background: 'rgba(255,255,255,0.07)', color: MENU_TEXT }}
                >
                  Cancel
                </button>
                <button
                  onClick={confirmNewFile}
                  className="px-4 py-2 rounded-lg text-[13px] font-medium transition-colors hover:opacity-90"
                  style={{ background: EXPORT_BG, color: '#fff' }}
                >
                  New File
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      <input
        type="file"
        ref={assetInputRef}
        className="hidden"
        accept=".png,.jpg,.jpeg,.svg,.webp"
        onChange={handleAssetImport}
      />
    </>
  );
}
