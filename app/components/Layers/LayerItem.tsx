'use client';

import { useState, useRef, useCallback, memo } from 'react';
import { useCreatorStore } from '@/lib/creator/state/store';
import { ChevronRight } from 'lucide-react';
import { Eye, EyeSlash, Lock, LockOpen, RectangleDashed, BoundingBox, Star as PhStar } from '@phosphor-icons/react';

// ── Design tokens (exact from Figma) ─────────────────────────────────────────
const NAME_COLOR     = '#FFFFFF';
const ICON_DIM       = 'rgba(255,255,255,0.5)';
const ICON_ACTIVE    = '#FFFFFF';
const ROW_BG         = 'transparent';
const SEL_BG         = '#0A6DC2';
const CHEVRON_COLOR  = 'rgba(255,255,255,0.35)';

// ── Depth-based scaling ───────────────────────────────────────────────────────
export function getLayerRowHeight(depth: number): number {
  return Math.max(24, 28 - Math.min(depth, 2) * 2); // 28 → 26 → 24
}

// ── Studio icons — accept dynamic size ───────────────────────────────────────
const IconRect = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
    <path d="M12.25 2.625V11.375C12.25 11.6071 12.1578 11.8296 11.9937 11.9937C11.8296 12.1578 11.6071 12.25 11.375 12.25H2.625C2.39294 12.25 2.17038 12.1578 2.00628 11.9937C1.84219 11.8296 1.75 11.6071 1.75 11.375V2.625C1.75 2.39294 1.84219 2.17038 2.00628 2.00628C2.17038 1.84219 2.39294 1.75 2.625 1.75H11.375C11.6071 1.75 11.8296 1.84219 11.9937 2.00628C12.1578 2.17038 12.25 2.39294 12.25 2.625Z" fill="currentColor"/>
  </svg>
);

const IconEllipse = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
    <path d="M12.6875 7C12.6875 8.12488 12.3539 9.2245 11.729 10.1598C11.104 11.0951 10.2158 11.8241 9.17652 12.2546C8.13726 12.685 6.99369 12.7977 5.89043 12.5782C4.78716 12.3588 3.77374 11.8171 2.97833 11.0217C2.18292 10.2263 1.64124 9.21284 1.42179 8.10958C1.20233 7.00631 1.31496 5.86274 1.74544 4.82349C2.17591 3.78423 2.90489 2.89597 3.8402 2.27102C4.7755 1.64607 5.87512 1.3125 7 1.3125C8.50784 1.31438 9.95339 1.9142 11.0196 2.98041C12.0858 4.04661 12.6856 5.49216 12.6875 7Z" fill="currentColor"/>
  </svg>
);

const IconNestedGroup = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
    <path d="M11.8125 2.1875H2.1875C1.95544 2.1875 1.73288 2.27969 1.56878 2.44378C1.40469 2.60788 1.3125 2.83044 1.3125 3.0625V10.9375C1.3125 11.1696 1.40469 11.3921 1.56878 11.5562C1.73288 11.7203 1.95544 11.8125 2.1875 11.8125H11.8125C12.0446 11.8125 12.2671 11.7203 12.4312 11.5562C12.5953 11.3921 12.6875 11.1696 12.6875 10.9375V3.0625C12.6875 2.83044 12.5953 2.60788 12.4312 2.44378C12.2671 2.27969 12.0446 2.1875 11.8125 2.1875ZM4.375 10.5H3.5C3.26794 10.5 3.04538 10.4078 2.88128 10.2437C2.71719 10.0796 2.625 9.85706 2.625 9.625V7.875C2.625 7.75897 2.67109 7.64769 2.75314 7.56564C2.83519 7.48359 2.94647 7.4375 3.0625 7.4375C3.17853 7.4375 3.28981 7.48359 3.37186 7.56564C3.45391 7.64769 3.5 7.75897 3.5 7.875V9.625H4.375C4.49103 9.625 4.60231 9.67109 4.68436 9.75314C4.76641 9.83519 4.8125 9.94647 4.8125 10.0625C4.8125 10.1785 4.76641 10.2898 4.68436 10.3719C4.60231 10.4539 4.49103 10.5 4.375 10.5ZM4.375 4.375H3.5V6.125C3.5 6.24103 3.45391 6.35231 3.37186 6.43436C3.28981 6.51641 3.17853 6.5625 3.0625 6.5625C2.94647 6.5625 2.83519 6.51641 2.75314 6.43436C2.67109 6.35231 2.625 6.24103 2.625 6.125V4.375C2.625 4.14294 2.71719 3.92038 2.88128 3.75628C3.04538 3.59219 3.26794 3.5 3.5 3.5H4.375C4.49103 3.5 4.60231 3.54609 4.68436 3.62814C4.76641 3.71019 4.8125 3.82147 4.8125 3.9375C4.8125 4.05353 4.76641 4.16481 4.68436 4.24686C4.60231 4.32891 4.49103 4.375 4.375 4.375ZM7.875 10.5H6.125C6.00897 10.5 5.89769 10.4539 5.81564 10.3719C5.73359 10.2898 5.6875 10.1785 5.6875 10.0625C5.6875 9.94647 5.73359 9.83519 5.81564 9.75314C5.89769 9.67109 6.00897 9.625 6.125 9.625H7.875C7.99103 9.625 8.10231 9.67109 8.18436 9.75314C8.26641 9.83519 8.3125 9.94647 8.3125 10.0625C8.3125 10.1785 8.26641 10.2898 8.18436 10.3719C8.10231 10.4539 7.99103 10.5 7.875 10.5ZM7.875 4.375H6.125C6.00897 4.375 5.89769 4.32891 5.81564 4.24686C5.73359 4.16481 5.6875 4.05353 5.6875 3.9375C5.6875 3.82147 5.73359 3.71019 5.81564 3.62814C5.89769 3.54609 6.00897 3.5 6.125 3.5H7.875C7.99103 3.5 8.10231 3.54609 8.18436 3.62814C8.26641 3.71019 8.3125 3.82147 8.3125 3.9375C8.3125 4.05353 8.26641 4.16481 8.18436 4.24686C8.10231 4.32891 7.99103 4.375 7.875 4.375ZM11.375 9.625C11.375 9.85706 11.2828 10.0796 11.1187 10.2437C10.9546 10.4078 10.7321 10.5 10.5 10.5H9.625C9.50897 10.5 9.39769 10.4539 9.31564 10.3719C9.23359 10.2898 9.1875 10.1785 9.1875 10.0625C9.1875 9.94647 9.23359 9.83519 9.31564 9.75314C9.39769 9.67109 9.50897 9.625 9.625 9.625H10.5V7.875C10.5 7.75897 10.5461 7.64769 10.6281 7.56564C10.7102 7.48359 10.8215 7.4375 10.9375 7.4375C11.0535 7.4375 11.1648 7.48359 11.2469 7.56564C11.3289 7.64769 11.375 7.75897 11.375 7.875V9.625ZM11.375 6.125C11.375 6.24103 11.3289 6.35231 11.2469 6.43436C11.1648 6.51641 11.0535 6.5625 10.9375 6.5625C10.8215 6.5625 10.7102 6.51641 10.6281 6.43436C10.5461 6.35231 10.5 6.24103 10.5 6.125V4.375H9.625C9.50897 4.375 9.39769 4.32891 9.31564 4.24686C9.23359 4.16481 9.1875 4.05353 9.1875 3.9375C9.1875 3.82147 9.23359 3.71019 9.31564 3.62814C9.39769 3.54609 9.50897 3.5 9.625 3.5H10.5C10.7321 3.5 10.9546 3.59219 11.1187 3.75628C11.2828 3.92038 11.375 4.14294 11.375 4.375V6.125Z" fill="currentColor"/>
  </svg>
);

const IconImage = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
    <path d="M11.375 1.75H2.625C2.39294 1.75 2.17038 1.84219 2.00628 2.00628C1.84219 2.17038 1.75 2.39294 1.75 2.625V11.375C1.75 11.6071 1.84219 11.8296 2.00628 11.9937C2.17038 12.1578 2.39294 12.25 2.625 12.25H11.375C11.6071 12.25 11.8296 12.1578 11.9937 11.9937C12.1578 11.8296 12.25 11.6071 12.25 11.375V2.625C12.25 2.39294 12.1578 2.17038 11.9937 2.00628C11.8296 1.84219 11.6071 1.75 11.375 1.75ZM2.625 2.625H11.375V6.85672L10.0248 5.50594C9.86069 5.34197 9.63822 5.24986 9.40625 5.24986C9.17428 5.24986 8.95181 5.34197 8.78773 5.50594L2.91867 11.375H2.625V2.625ZM4.375 5.25C4.375 5.07694 4.42632 4.90777 4.52246 4.76388C4.61861 4.61998 4.75527 4.50783 4.91515 4.44161C5.07504 4.37538 5.25097 4.35805 5.4207 4.39181C5.59044 4.42557 5.74635 4.50891 5.86872 4.63128C5.99109 4.75365 6.07443 4.90956 6.10819 5.0793C6.14195 5.24903 6.12462 5.42496 6.05839 5.58485C5.99217 5.74473 5.88002 5.88139 5.73612 5.97754C5.59223 6.07368 5.42306 6.125 5.25 6.125C5.01794 6.125 4.79538 6.03281 4.63128 5.86872C4.46719 5.70462 4.375 5.48206 4.375 5.25Z" fill="currentColor"/>
  </svg>
);

const IconPath = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
    <g clipPath="url(#layer-pen-clip)">
      <path d="M9.55058 13.306L13.3065 9.55009C13.3878 9.46883 13.4523 9.37237 13.4962 9.26619C13.5402 9.16002 13.5629 9.04622 13.5629 8.9313C13.5629 8.81637 13.5402 8.70258 13.4962 8.5964C13.4523 8.49023 13.3878 8.39376 13.3065 8.31251L11.7512 6.7572L10.5612 3.58532C10.5076 3.44119 10.4169 3.31374 10.2983 3.21581C10.1798 3.11789 10.0375 3.05294 9.88581 3.02751L3.07175 1.89165C3.02606 1.88403 2.97913 1.89112 2.93773 1.91188C2.89632 1.93265 2.86258 1.96602 2.84135 2.00719C2.82013 2.04836 2.81252 2.09521 2.81963 2.14098C2.82673 2.18675 2.84819 2.22908 2.88089 2.26188L5.99808 5.37907C6.20356 5.28031 6.43133 5.23713 6.6587 5.25384C6.93842 5.27417 7.20427 5.38357 7.41728 5.566C7.6303 5.74843 7.77928 5.99429 7.84238 6.26755C7.90549 6.54082 7.8794 6.82711 7.76795 7.08447C7.6565 7.34183 7.46554 7.55672 7.22306 7.69765C6.98058 7.83857 6.69934 7.89812 6.42055 7.86757C6.14177 7.83702 5.8801 7.71797 5.6739 7.52787C5.4677 7.33777 5.32782 7.08662 5.27475 6.81123C5.22168 6.53584 5.25822 6.2507 5.37902 5.99759L2.26183 2.8804C2.22903 2.84769 2.1867 2.82624 2.14092 2.81914C2.09515 2.81203 2.04831 2.81964 2.00714 2.84086C1.96596 2.86209 1.93259 2.89583 1.91183 2.93724C1.89107 2.97864 1.88398 3.02557 1.89159 3.07126L3.02745 9.88587C3.05268 10.0373 3.11731 10.1794 3.21483 10.298C3.31236 10.4165 3.43936 10.5073 3.58308 10.5613L6.75878 11.7518L8.31245 13.306C8.39371 13.3873 8.49017 13.4518 8.59635 13.4958C8.70252 13.5397 8.81632 13.5624 8.93124 13.5624C9.04617 13.5624 9.15996 13.5397 9.26614 13.4958C9.37231 13.4518 9.46878 13.3873 9.55003 13.306L9.55058 13.306ZM7.61902 11.375L11.375 7.61907L12.6875 8.93157L8.93151 12.6875L7.61902 11.375Z" fill="currentColor"/>
    </g>
    <defs>
      <clipPath id="layer-pen-clip">
        <rect width="14" height="14" fill="white" transform="translate(14) rotate(90)"/>
      </clipPath>
    </defs>
  </svg>
);

const IconText = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
    <path d="M11.375 1.75H2.625C2.39294 1.75 2.17038 1.84219 2.00628 2.00628C1.84219 2.17038 1.75 2.39294 1.75 2.625V11.375C1.75 11.6071 1.84219 11.8296 2.00628 11.9937C2.17038 12.1578 2.39294 12.25 2.625 12.25H11.375C11.6071 12.25 11.8296 12.1578 11.9937 11.9937C12.1578 11.8296 12.25 11.6071 12.25 11.375V2.625C12.25 2.39294 12.1578 2.17038 11.9937 2.00628C11.8296 1.84219 11.6071 1.75 11.375 1.75ZM10.0625 5.25C10.0625 5.36603 10.0164 5.47731 9.93436 5.55936C9.85231 5.64141 9.74103 5.6875 9.625 5.6875C9.50897 5.6875 9.39769 5.64141 9.31564 5.55936C9.23359 5.47731 9.1875 5.36603 9.1875 5.25V4.8125H7.4375V9.625H8.09375C8.20978 9.625 8.32106 9.67109 8.40311 9.75314C8.48516 9.83519 8.53125 9.94647 8.53125 10.0625C8.53125 10.1785 8.48516 10.2898 8.40311 10.3719C8.32106 10.4539 8.20978 10.5 8.09375 10.5H5.90625C5.79022 10.5 5.67894 10.4539 5.59689 10.3719C5.51484 10.2898 5.46875 10.1785 5.46875 10.0625C5.46875 9.94647 5.51484 9.83519 5.59689 9.75314C5.67894 9.67109 5.79022 9.625 5.90625 9.625H6.5625V4.8125H4.8125V5.25C4.8125 5.36603 4.76641 5.47731 4.68436 5.55936C4.60231 5.64141 4.49103 5.6875 4.375 5.6875C4.25897 5.6875 4.14769 5.64141 4.06564 5.55936C3.98359 5.47731 3.9375 5.36603 3.9375 5.25V4.375C3.9375 4.25897 3.98359 4.14769 4.06564 4.06564C4.14769 3.98359 4.25897 3.9375 4.375 3.9375H9.625C9.74103 3.9375 9.85231 3.98359 9.93436 4.06564C10.0164 4.14769 10.0625 4.25897 10.0625 4.375V5.25Z" fill="currentColor"/>
  </svg>
);

// ── Tree connector SVG column ─────────────────────────────────────────────────
const CONNECTOR_COLOR = 'rgba(255,255,255,0.13)';
const ConnectorCol = ({ variant, rowH }: { variant: 'line' | 'branch-mid' | 'branch-last' | 'empty'; rowH: number }) => {
  const cx = 8, cy = rowH / 2;
  return (
    <svg width={16} height={rowH} style={{ flexShrink: 0, display: 'block' }}>
      {variant === 'line' && (
        <line x1={cx} y1={0} x2={cx} y2={rowH} stroke={CONNECTOR_COLOR} strokeWidth={1} />
      )}
      {variant === 'branch-mid' && (<>
        <line x1={cx} y1={0} x2={cx} y2={rowH} stroke={CONNECTOR_COLOR} strokeWidth={1} />
        <line x1={cx} y1={cy} x2={16} y2={cy} stroke={CONNECTOR_COLOR} strokeWidth={1} />
      </>)}
      {variant === 'branch-last' && (<>
        <line x1={cx} y1={0} x2={cx} y2={cy} stroke={CONNECTOR_COLOR} strokeWidth={1} />
        <line x1={cx} y1={cy} x2={16} y2={cy} stroke={CONNECTOR_COLOR} strokeWidth={1} />
      </>)}
    </svg>
  );
};



interface LayerItemProps {
  nodeId: string;
  depth: number;
  onSelect: (isShift: boolean, isCtrl: boolean) => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  isLastChild?: boolean;
  showLineAt?: boolean[];
}

export const LayerItem = memo(function LayerItem({
  nodeId, depth, onSelect, isExpanded = true, onToggleExpand,
  isLastChild = true, showLineAt = [],
}: LayerItemProps) {
  const node       = useCreatorStore(s => s.nodes.get(nodeId));
  const selectedIds = useCreatorStore(s => s.selectedIds);
  const updateNode = useCreatorStore(s => s.updateNode);
  const moveNode   = useCreatorStore(s => s.moveNode);
  const setActiveArtboard = useCreatorStore(s => s.setActiveArtboard);

  const [isEditing, setIsEditing]   = useState(false);
  const [tempName,  setTempName]    = useState(node?.name || '');
  const [dropPos,   setDropPos]     = useState<'before' | 'after' | 'inside' | null>(null);
  const [isBlinking, setIsBlinking] = useState(false);
  const itemRef     = useRef<HTMLDivElement>(null);
  const blinkTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerLockBlink = useCallback(() => {
    if (blinkTimer.current) clearTimeout(blinkTimer.current);
    setIsBlinking(true);
    blinkTimer.current = setTimeout(() => setIsBlinking(false), 700);
  }, []);

  const isSelected  = !!node && selectedIds.includes(node.id);
  const hasChildren = !!node && !!node.children?.length;

  // Depth-based scaling — capped at 2 levels of reduction
  const scaledD   = Math.min(depth, 2);
  const rowH      = getLayerRowHeight(depth);
  const iconSz    = 16 - scaledD * 2;          // 16 → 14 → 12
  const fontSize  = 12 - scaledD * 0.5;        // 12 → 11.5 → 11
  const btnSz     = 24 - scaledD * 2;          // 24 → 22 → 20
  const btnIconSz = 16 - scaledD * 2;          // 16 → 14 → 12
  const chevSz    = 13 - scaledD;              // 13 → 12 → 11

  const getIcon = () => {
    if (!node) return null;
    switch (node.type) {
      case 'rect':    return <IconRect size={iconSz} />;
      case 'ellipse': return <IconEllipse size={iconSz} />;
      case 'path':    return <IconPath size={iconSz} />;
      case 'text':    return <IconText size={iconSz} />;
      case 'image':   return <IconImage size={iconSz} />;
      case 'precomp':
      case 'artboard': return <BoundingBox size={iconSz} weight="fill" style={{ color: 'currentColor' }} />;
      case 'group':
        if (node.mergeMode && node.mergeMode !== 'none') {
          const sym: Record<string, string> = { union: '∪', subtract: '−', intersect: '∩', exclude: '⊞' };
          return (
            <span className="flex items-center justify-center text-[10px] font-bold" style={{ width: iconSz, height: iconSz, color: 'var(--accent)' }}>
              {sym[node.mergeMode]}
            </span>
          );
        }
        if (node.props?.isShapeLayer && node.children?.length) {
          const firstChild = useCreatorStore.getState().nodes.get(node.children[0]);
          if (firstChild) {
            switch (firstChild.type) {
              case 'rect':    return <IconRect size={iconSz} />;
              case 'ellipse': return <IconEllipse size={iconSz} />;
              case 'path':    return <IconPath size={iconSz} />;
              case 'polystar': return <PhStar size={iconSz} weight="fill" style={{ color: 'currentColor' }} />;
            }
          }
        }
        return <RectangleDashed size={iconSz} weight="fill" style={{ color: 'currentColor' }} />;
      default: return <IconRect size={iconSz} />;
    }
  };

  const handleToggleVisibility = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!node) return;
    const hiding = node.visible;
    const store = useCreatorStore.getState();
    const targetIds = selectedIds.includes(node.id) && selectedIds.length > 1
      ? selectedIds
      : [node.id];
    store.pushToHistory(targetIds.length > 1
      ? (hiding ? 'Hide Layers' : 'Show Layers')
      : (hiding ? `Hide ${node.name}` : `Show ${node.name}`)
    );
    targetIds.forEach(id => updateNode(id, { visible: !hiding }));
    if (hiding) {
      const remaining = selectedIds.filter(id => !targetIds.includes(id));
      store.setSelection(remaining);
    }
  };

  const handleToggleLock = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!node) return;
    const locking = !node.locked;
    const store = useCreatorStore.getState();
    const targetIds = selectedIds.includes(node.id) && selectedIds.length > 1
      ? selectedIds
      : [node.id];
    store.pushToHistory(targetIds.length > 1
      ? (locking ? 'Lock Layers' : 'Unlock Layers')
      : (locking ? `Lock ${node.name}` : `Unlock ${node.name}`)
    );
    targetIds.forEach(id => updateNode(id, { locked: locking }));
    if (locking) {
      const remaining = selectedIds.filter(id => !targetIds.includes(id));
      store.setSelection(remaining);
    }
  };

  const handleRename = () => {
    if (node && tempName.trim() && tempName.trim() !== node.name) {
      useCreatorStore.getState().pushToHistory(`Rename ${node.name}`);
      updateNode(node.id, { name: tempName.trim() });
    }
    setIsEditing(false);
  };

  if (!node) return null;

  // ── Drag & drop ──────────────────────────────────────────────────────────
  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('nodeId', node.id);
    e.dataTransfer.effectAllowed = 'move';
    if (itemRef.current) itemRef.current.style.opacity = '0.5';
  };

  const onDragEnd = () => {
    if (itemRef.current) itemRef.current.style.opacity = '1';
    setDropPos(null);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!itemRef.current) return;
    const rect = itemRef.current.getBoundingClientRect();
    const y    = e.clientY - rect.top;
    const h    = rect.height;
    if (node.type === 'group' || node.type === 'artboard') {
      if (y < h * 0.25)      setDropPos('before');
      else if (y > h * 0.75) setDropPos('after');
      else                   setDropPos('inside');
    } else {
      setDropPos(y < h / 2 ? 'before' : 'after');
    }
  };

  const onDragLeave = () => setDropPos(null);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('nodeId');
    if (!draggedId || draggedId === node.id) { setDropPos(null); return; }
    const currentNodes = useCreatorStore.getState().nodes;
    if (!currentNodes.get(draggedId)) return;
    let pid = node.parentId;
    while (pid) {
      if (pid === draggedId) { setDropPos(null); return; }
      pid = currentNodes.get(pid)?.parentId || null;
    }
    if (dropPos === 'inside') {
      moveNode(draggedId, node.id, node.children.length);
      if (!isExpanded) onToggleExpand?.();
    } else if (node.parentId) {
      const parent = currentNodes.get(node.parentId);
      if (parent) {
        const idx = parent.children.indexOf(node.id);
        moveNode(draggedId, node.parentId, dropPos === 'before' ? idx + 1 : idx);
      }
    }
    setDropPos(null);
  };

  const iconColor = isSelected ? ICON_ACTIVE : ICON_DIM;

  return (
    <div
      ref={itemRef}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={e => {
        e.stopPropagation();
        if (node.locked) { triggerLockBlink(); return; }
        onSelect(e.shiftKey, e.ctrlKey || e.metaKey);
      }}
      onDoubleClick={() => {
        if (node.locked) return;
        if (node.type === 'precomp' && node.refId) setActiveArtboard(node.refId);
        else { setIsEditing(true); setTempName(node.name); }
      }}
      className={`group flex items-center cursor-pointer rounded-[5px] relative${isBlinking ? ' layer-locked-blink' : ' transition-colors'}${!isSelected ? ' hover:bg-white/[0.06]' : ''}`}
      style={{
        height:       rowH,
        paddingLeft:  '10px',
        paddingRight: '8px',
        gap:          '6px',
        background:   isBlinking ? undefined : (isSelected ? SEL_BG : undefined),
        fontFamily:   'Inter, sans-serif',
        ...(dropPos === 'inside' ? { outline: '1px solid var(--accent)' } : {}),
      }}
    >
      {/* Drop indicators */}
      {(dropPos === 'before' || dropPos === 'after') && (
        <div className={`absolute left-0 right-0 h-[2px] bg-accent z-50 pointer-events-none ${dropPos === 'before' ? '-top-[1px]' : '-bottom-[1px]'}`}>
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[5px] h-[5px] rounded-full bg-accent" />
        </div>
      )}

      {/* Tree connector columns — one 16px SVG per depth level */}
      {depth > 0 && (
        <div className="flex shrink-0" style={{ gap: 0 }}>
          {Array.from({ length: depth }, (_, l) => {
            const isDirectParent = l === depth - 1;
            if (isDirectParent) {
              return <ConnectorCol key={l} variant={isLastChild ? 'branch-last' : 'branch-mid'} rowH={rowH} />;
            }
            return <ConnectorCol key={l} variant={showLineAt[l] ? 'line' : 'empty'} rowH={rowH} />;
          })}
        </div>
      )}

      {/* Chevron — slot for expand/collapse on groups */}
      <div className="flex items-center justify-center shrink-0" style={{ width: chevSz + 3, height: chevSz + 3 }}>
        {hasChildren && (
          <button
            onClick={e => { e.stopPropagation(); onToggleExpand?.(); }}
            className="flex items-center justify-center"
            style={{ width: chevSz + 3, height: chevSz + 3, color: CHEVRON_COLOR }}
          >
            <ChevronRight
              size={chevSz}
              strokeWidth={2}
              className={`transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
            />
          </button>
        )}
      </div>

      {/* Layer type icon */}
      <div className="flex items-center justify-center shrink-0" style={{ width: iconSz, height: iconSz, color: iconColor }}>
        {getIcon()}
      </div>

      {/* Layer name */}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <input
            autoFocus
            className="w-full bg-transparent text-[12px] outline-none rounded"
            style={{ color: NAME_COLOR, caretColor: 'var(--accent)' }}
            value={tempName}
            onChange={e => setTempName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={e => {
              if (e.key === 'Enter')  handleRename();
              if (e.key === 'Escape') setIsEditing(false);
            }}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span className="truncate block" style={{ fontSize, color: NAME_COLOR, fontWeight: 450 }}>
            {node.name}
          </span>
        )}
      </div>

      {/* Divider before lock icon */}
      <div style={{ width: 2, alignSelf: 'stretch', background: '#2C2C2C', flexShrink: 0 }} className={`transition-opacity ${node.locked || isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />

      {/* Lock icon — always visible when selected or locked; hover-only otherwise */}
      <button
        onClick={handleToggleLock}
        className={`flex items-center justify-center shrink-0 transition-opacity ${node.locked || isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        style={{ width: btnSz, height: btnSz, color: isSelected || node.locked ? ICON_ACTIVE : ICON_DIM }}
        title={node.locked ? 'Unlock layer' : 'Lock layer'}
      >
        {node.locked ? <Lock size={btnIconSz} weight="fill" /> : <LockOpen size={btnIconSz} weight="fill" />}
      </button>

      {/* Divider between lock and eye icons */}
      <div style={{ width: 2, alignSelf: 'stretch', background: '#2C2C2C', flexShrink: 0 }} className={`transition-opacity ${!node.visible || isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />

      {/* Eye icon — always visible when selected or hidden; hover-only otherwise */}
      <button
        onClick={handleToggleVisibility}
        className={`flex items-center justify-center shrink-0 transition-opacity ${!node.visible || isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        style={{ width: btnSz, height: btnSz, color: isSelected || !node.visible ? ICON_ACTIVE : ICON_DIM }}
        title={node.visible ? 'Hide layer' : 'Show layer'}
      >
        {node.visible ? <Eye size={btnIconSz} weight="fill" /> : <EyeSlash size={btnIconSz} weight="fill" />}
      </button>
    </div>
  );
});
