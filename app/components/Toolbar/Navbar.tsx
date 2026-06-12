'use client';

import { useCreatorStore } from '@/lib/creator/state/store';
import {
  ChevronDown, FileJson, Zap, Upload, FilePlus2, Download,
  RotateCcw, RotateCw, Copy, Clipboard, Settings, Keyboard, LayoutDashboard,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { createImageNode, createArtboardNode } from '@/lib/creator/core/SceneNode';
import { SvgImporter } from '@/lib/creator/svg/SvgImporter';
import { getCollectiveBoundingBox } from '@/lib/creator/core/Matrix';

// ─── Color tokens (Figma — Studio New UI) ─────────────────────────────────────
const NAV_BG          = '#2C2C2C';
const NAV_BORDER      = 'rgba(255,255,255,0.10)';
const SIDEBAR_BORDER  = 'rgba(255,255,255,0.08)';
const ICON_COLOR      = 'rgba(255,255,255,0.88)';
const ICON_MUTED      = 'rgba(255,255,255,0.40)';
const TOOL_ACTIVE_BG  = 'rgba(255,255,255,0.12)';
const TOOL_ACTIVE_BR  = 'rgba(255,255,255,0.16)';
const TOGGLE_ON       = '#3E63DD';
const TOGGLE_OFF      = '#4A4A4E';
const ZOOM_BG         = 'rgba(255,255,255,0.07)';
const ZOOM_BORDER     = 'rgba(255,255,255,0.10)';
const EXPORT_BG       = '#3E63DD';
const MENU_BG         = '#1C1D1F';
const MENU_BORDER     = 'rgba(255,255,255,0.08)';
const MENU_TEXT       = '#F2F2F2';
const MENU_MUTED      = 'rgba(255,255,255,0.38)';
const MENU_ICON       = 'rgba(255,255,255,0.50)';
const MENU_SEPARATOR  = 'rgba(255,255,255,0.08)';

const ZOOM_LEVELS = [25, 50, 75, 100, 150, 200];

// ─── Official Figma toolbar icons (paths verbatim from design file) ───────────
// Source files preserved at: public/icons/toolbar/
// All icons use currentColor so active/inactive state is controlled by the button

function IconCursor() {
  // Cursor arrow only — no background rectangle (active bg handled by button container)
  return (
    <svg width="22" height="22" viewBox="6 6 18 18" fill="none">
      <path
        d="M9.20514 8.5127C9.37295 8.48072 9.5457 8.50065 9.70319 8.56641L9.70416 8.56445L21.7042 13.4395C21.8319 13.4915 21.9456 13.5726 22.0352 13.6758L22.1163 13.7861L22.1797 13.9072C22.2332 14.0329 22.2562 14.17 22.2471 14.3076C22.2349 14.4909 22.1659 14.6661 22.0489 14.8076C21.9317 14.9491 21.7726 15.0504 21.5948 15.0967H21.5938L17.001 16.2822H17.0001C16.8271 16.3267 16.6694 16.4168 16.543 16.543C16.4166 16.6691 16.3261 16.8271 16.2813 17L15.0967 21.5938V21.5947C15.0505 21.7725 14.9492 21.9317 14.8077 22.0488C14.6662 22.1659 14.4909 22.2349 14.3077 22.2471C14.1244 22.2592 13.942 22.2136 13.7862 22.1162C13.6693 22.0431 13.5717 21.944 13.501 21.8271L13.4395 21.7041L8.56451 9.7041L8.56647 9.70312C8.50072 9.54564 8.48079 9.37289 8.51276 9.20508C8.54549 9.03353 8.62852 8.87544 8.75201 8.75195L8.85065 8.66699C8.95518 8.58983 9.07644 8.53725 9.20514 8.5127Z"
        fill="currentColor" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

function IconRect() {
  return (
    <svg width="22" height="22" viewBox="6 6 18 18" fill="none">
      <path
        d="M21.75 9.375V20.625C21.75 20.9234 21.6315 21.2095 21.4205 21.4205C21.2095 21.6315 20.9234 21.75 20.625 21.75H9.375C9.07663 21.75 8.79048 21.6315 8.5795 21.4205C8.36853 21.2095 8.25 20.9234 8.25 20.625V9.375C8.25 9.07663 8.36853 8.79048 8.5795 8.5795C8.79048 8.36853 9.07663 8.25 9.375 8.25H20.625C20.9234 8.25 21.2095 8.36853 21.4205 8.5795C21.6315 8.79048 21.75 9.07663 21.75 9.375Z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconEllipse() {
  return (
    <svg width="22" height="22" viewBox="6 6 18 18" fill="none">
      <path
        d="M22.3125 15C22.3125 16.4463 21.8836 17.8601 21.0801 19.0626C20.2766 20.2651 19.1346 21.2024 17.7984 21.7559C16.4622 22.3093 14.9919 22.4541 13.5734 22.172C12.1549 21.8898 10.852 21.1934 9.82928 20.1707C8.80661 19.148 8.11017 17.8451 7.82801 16.4266C7.54586 15.0081 7.69067 13.5378 8.24413 12.2016C8.7976 10.8654 9.73486 9.72339 10.9374 8.91988C12.1399 8.11637 13.5537 7.6875 15 7.6875C16.9387 7.68992 18.7972 8.46112 20.1681 9.83195C21.5389 11.2028 22.3101 13.0613 22.3125 15Z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconPen() {
  return (
    <svg width="22" height="22" viewBox="6 6 18 18" fill="none">
      <defs>
        <clipPath id="pen-tool-clip">
          <rect width="18" height="18" transform="translate(24 6) rotate(90)" />
        </clipPath>
      </defs>
      <g clipPath="url(#pen-tool-clip)">
        <path
          d="M18.2794 23.1077L23.1085 18.2786C23.2129 18.1741 23.2958 18.0501 23.3524 17.9136C23.4089 17.7771 23.438 17.6308 23.438 17.483C23.438 17.3353 23.4089 17.189 23.3524 17.0524C23.2958 16.9159 23.2129 16.7919 23.1085 16.6874L21.1088 14.6878L19.5788 10.6096C19.5098 10.4243 19.3932 10.2605 19.2408 10.1345C19.0883 10.0086 18.9054 9.92513 18.7104 9.89244L9.94947 8.43205C9.89073 8.42226 9.83039 8.43137 9.77716 8.45806C9.72392 8.48476 9.68054 8.52767 9.65325 8.5806C9.62596 8.63354 9.61618 8.69377 9.62531 8.75261C9.63445 8.81146 9.66203 8.86589 9.70408 8.90806L13.7119 12.9159C13.9761 12.7889 14.2689 12.7334 14.5613 12.7549C14.9209 12.781 15.2627 12.9217 15.5366 13.1562C15.8105 13.3908 16.002 13.7069 16.0831 14.0582C16.1643 14.4096 16.1307 14.7776 15.9874 15.1085C15.8441 15.4394 15.5986 15.7157 15.2869 15.8969C14.9751 16.0781 14.6135 16.1547 14.2551 16.1154C13.8966 16.0761 13.5602 15.923 13.2951 15.6786C13.03 15.4342 12.8501 15.1113 12.7819 14.7572C12.7137 14.4032 12.7606 14.0365 12.916 13.7111L8.90814 9.7033C8.86597 9.66125 8.81154 9.63367 8.75269 9.62453C8.69384 9.6154 8.63361 9.62518 8.58068 9.65247C8.52775 9.67975 8.48484 9.72314 8.45814 9.77638C8.43145 9.82961 8.42234 9.88995 8.43213 9.94869L9.89252 18.7103C9.92495 18.905 10.008 19.0877 10.1334 19.2402C10.2588 19.3926 10.4221 19.5093 10.6069 19.5787L14.6899 21.1094L16.6875 23.1077C16.792 23.2122 16.916 23.2951 17.0525 23.3516C17.189 23.4082 17.3353 23.4373 17.4831 23.4373C17.6309 23.4373 17.7772 23.4082 17.9137 23.3516C18.0502 23.2951 18.1742 23.2122 18.2787 23.1077L18.2794 23.1077ZM15.796 20.6249L20.625 15.7959L22.3125 17.4834L17.4835 22.3124L15.796 20.6249Z"
          fill="currentColor"
        />
      </g>
    </svg>
  );
}

function IconText() {
  return (
    <svg width="22" height="22" viewBox="6 6 18 18" fill="none">
      <path
        d="M20.625 8.25H9.375C9.07663 8.25 8.79048 8.36853 8.5795 8.5795C8.36853 8.79048 8.25 9.07663 8.25 9.375V20.625C8.25 20.9234 8.36853 21.2095 8.5795 21.4205C8.79048 21.6315 9.07663 21.75 9.375 21.75H20.625C20.9234 21.75 21.2095 21.6315 21.4205 21.4205C21.6315 21.2095 21.75 20.9234 21.75 20.625V9.375C21.75 9.07663 21.6315 8.79048 21.4205 8.5795C21.2095 8.36853 20.9234 8.25 20.625 8.25ZM18.9375 12.75C18.9375 12.8992 18.8782 13.0423 18.7727 13.1477C18.6673 13.2532 18.5242 13.3125 18.375 13.3125C18.2258 13.3125 18.0827 13.2532 17.9773 13.1477C17.8718 13.0423 17.8125 12.8992 17.8125 12.75V12.1875H15.5625V18.375H16.4062C16.5554 18.375 16.6985 18.4343 16.804 18.5398C16.9095 18.6452 16.9688 18.7883 16.9688 18.9375C16.9688 19.0867 16.9095 19.2298 16.804 19.3352C16.6985 19.4407 16.5554 19.5 16.4062 19.5H13.5938C13.4446 19.5 13.3015 19.4407 13.196 19.3352C13.0905 19.2298 13.0312 19.0867 13.0312 18.9375C13.0312 18.7883 13.0905 18.6452 13.196 18.5398C13.3015 18.4343 13.4446 18.375 13.5938 18.375H14.4375V12.1875H12.1875V12.75C12.1875 12.8992 12.1282 13.0423 12.0227 13.1477C11.9173 13.2532 11.7742 13.3125 11.625 13.3125C11.4758 13.3125 11.3327 13.2532 11.2273 13.1477C11.1218 13.0423 11.0625 12.8992 11.0625 12.75V11.625C11.0625 11.4758 11.1218 11.3327 11.2273 11.2273C11.3327 11.1218 11.4758 11.0625 11.625 11.0625H18.375C18.5242 11.0625 18.6673 11.1218 18.7727 11.2273C18.8782 11.3327 18.9375 11.4758 18.9375 11.625V12.75Z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconSparkle() {
  // Discover brand logos / AI — 4-point star + 2 small + signs from Figma
  return (
    <svg width="22" height="22" viewBox="6 6 18 18" fill="none">
      <path
        d="M20.625 16.125C20.6264 16.3543 20.5567 16.5785 20.4255 16.7666C20.2943 16.9547 20.108 17.0976 19.8923 17.1755L16.2656 18.5156L14.9297 22.1452C14.8506 22.3601 14.7074 22.5456 14.5196 22.6766C14.3317 22.8076 14.1082 22.8779 13.8792 22.8779C13.6502 22.8779 13.4267 22.8076 13.2388 22.6766C13.051 22.5456 12.9079 22.3601 12.8287 22.1452L11.4844 18.5156L7.85483 17.1797C7.63991 17.1006 7.45442 16.9574 7.3234 16.7696C7.19238 16.5818 7.12213 16.3582 7.12213 16.1292C7.12213 15.9002 7.19238 15.6767 7.3234 15.4888C7.45442 15.301 7.63991 15.1579 7.85483 15.0787L11.4844 13.7344L12.8203 10.1048C12.8994 9.88992 13.0425 9.70443 13.2304 9.57341C13.4182 9.44239 13.6417 9.37214 13.8708 9.37214C14.0998 9.37214 14.3233 9.44239 14.5111 9.57341C14.699 9.70443 14.8421 9.88992 14.9212 10.1048L16.2656 13.7344L19.8951 15.0703C20.111 15.1489 20.2972 15.2926 20.4279 15.4815C20.5586 15.6704 20.6275 15.8953 20.625 16.125ZM16.6875 9.375H17.8125V10.5C17.8125 10.6492 17.8718 10.7923 17.9772 10.8977C18.0827 11.0032 18.2258 11.0625 18.375 11.0625C18.5242 11.0625 18.6672 11.0032 18.7727 10.8977C18.8782 10.7923 18.9375 10.6492 18.9375 10.5V9.375H20.0625C20.2117 9.375 20.3547 9.31574 20.4602 9.21025C20.5657 9.10476 20.625 8.96168 20.625 8.8125C20.625 8.66332 20.5657 8.52024 20.4602 8.41475C20.3547 8.30926 20.2117 8.25 20.0625 8.25H18.9375V7.125C18.9375 6.97582 18.8782 6.83274 18.7727 6.72725C18.6672 6.62176 18.5242 6.5625 18.375 6.5625C18.2258 6.5625 18.0827 6.62176 17.9772 6.72725C17.8718 6.83274 17.8125 6.97582 17.8125 7.125V8.25H16.6875C16.5383 8.25 16.3952 8.30926 16.2897 8.41475C16.1843 8.52024 16.125 8.66332 16.125 8.8125C16.125 8.96168 16.1843 9.10476 16.2897 9.21025C16.3952 9.31574 16.5383 9.375 16.6875 9.375ZM22.875 11.625H22.3125V11.0625C22.3125 10.9133 22.2532 10.7702 22.1477 10.6648C22.0422 10.5593 21.8992 10.5 21.75 10.5C21.6008 10.5 21.4577 10.5593 21.3522 10.6648C21.2468 10.7702 21.1875 10.9133 21.1875 11.0625V11.625H20.625C20.4758 11.625 20.3327 11.6843 20.2272 11.7898C20.1218 11.8952 20.0625 12.0383 20.0625 12.1875C20.0625 12.3367 20.1218 12.4798 20.2272 12.5852C20.3327 12.6907 20.4758 12.75 20.625 12.75H21.1875V13.3125C21.1875 13.4617 21.2468 13.6048 21.3522 13.7102C21.4577 13.8157 21.6008 13.875 21.75 13.875C21.8992 13.875 22.0422 13.8157 22.1477 13.7102C22.2532 13.6048 22.3125 13.4617 22.3125 13.3125V12.75H22.875C23.0242 12.75 23.1672 12.6907 23.2727 12.5852C23.3782 12.4798 23.4375 12.3367 23.4375 12.1875C23.4375 12.0383 23.3782 11.8952 23.2727 11.7898C23.1672 11.6843 23.0242 11.625 22.875 11.625Z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconMonitorPlay() {
  // Preview — monitor with play triangle and link pill at bottom
  return (
    <svg width="22" height="22" viewBox="6 6 18 18" fill="none">
      <path
        d="M17.8125 21.75C17.8125 21.8992 17.7532 22.0423 17.6477 22.1477C17.5423 22.2532 17.3992 22.3125 17.25 22.3125H12.75C12.6008 22.3125 12.4577 22.2532 12.3523 22.1477C12.2468 22.0423 12.1875 21.8992 12.1875 21.75C12.1875 21.6008 12.2468 21.4577 12.3523 21.3523C12.4577 21.2468 12.6008 21.1875 12.75 21.1875H17.25C17.3992 21.1875 17.5423 21.2468 17.6477 21.3523C17.7532 21.4577 17.8125 21.6008 17.8125 21.75ZM22.3125 10.5V18.375C22.3125 18.8226 22.1347 19.2518 21.8182 19.5682C21.5018 19.8847 21.0726 20.0625 20.625 20.0625H9.375C8.92745 20.0625 8.49822 19.8847 8.18176 19.5682C7.86529 19.2518 7.6875 18.8226 7.6875 18.375V10.5C7.6875 10.0524 7.86529 9.62322 8.18176 9.30676C8.49822 8.99029 8.92745 8.8125 9.375 8.8125H20.625C21.0726 8.8125 21.5018 8.99029 21.8182 9.30676C22.1347 9.62322 22.3125 10.0524 22.3125 10.5ZM17.5312 14.4375C17.5312 14.3471 17.5094 14.2581 17.4677 14.1779C17.4259 14.0977 17.3655 14.0288 17.2915 13.977L14.479 12.0082C14.3947 11.9492 14.2958 11.9144 14.1932 11.9076C14.0905 11.9009 13.9879 11.9224 13.8966 11.9699C13.8054 12.0174 13.7288 12.089 13.6754 12.177C13.622 12.2649 13.5938 12.3658 13.5938 12.4688V16.4062C13.5938 16.5092 13.622 16.6101 13.6754 16.698C13.7288 16.786 13.8054 16.8576 13.8966 16.9051C13.9879 16.9526 14.0905 16.9741 14.1932 16.9674C14.2958 16.9606 14.3947 16.9258 14.479 16.8668L17.2915 14.898C17.3655 14.8462 17.4259 14.7773 17.4677 14.6971C17.5094 14.6169 17.5312 14.5279 17.5312 14.4375Z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconShareExport() {
  // Export / Share — upload arrow from tray
  return (
    <svg width="22" height="22" viewBox="6 6 18 18" fill="none">
      <path
        d="M22.0312 16.1249V20.6249C22.0312 20.8487 21.9424 21.0633 21.7841 21.2216C21.6259 21.3798 21.4113 21.4687 21.1875 21.4687H8.8125C8.58872 21.4687 8.37411 21.3798 8.21588 21.2216C8.05764 21.0633 7.96875 20.8487 7.96875 20.6249V16.1249C7.96875 15.9012 8.05764 15.6865 8.21588 15.5283C8.37411 15.3701 8.58872 15.2812 8.8125 15.2812C9.03628 15.2812 9.25089 15.3701 9.40912 15.5283C9.56736 15.6865 9.65625 15.9012 9.65625 16.1249V19.7812H20.3438V16.1249C20.3438 15.9012 20.4326 15.6865 20.5909 15.5283C20.7491 15.3701 20.9637 15.2812 21.1875 15.2812C21.4113 15.2812 21.6259 15.3701 21.7841 15.5283C21.9424 15.6865 22.0312 15.9012 22.0312 16.1249ZM12.7845 11.6594L14.1562 10.289V16.1249C14.1562 16.3487 14.2451 16.5633 14.4034 16.7216C14.5616 16.8798 14.7762 16.9687 15 16.9687C15.2238 16.9687 15.4384 16.8798 15.5966 16.7216C15.7549 16.5633 15.8438 16.3487 15.8438 16.1249V10.289L17.2155 11.6615C17.294 11.74 17.3872 11.8022 17.4898 11.8447C17.5923 11.8872 17.7022 11.9091 17.8132 11.9091C17.9242 11.9091 18.0341 11.8872 18.1367 11.8447C18.2392 11.8022 18.3324 11.74 18.4109 11.6615C18.4893 11.583 18.5516 11.4898 18.5941 11.3873C18.6366 11.2847 18.6584 11.1748 18.6584 11.0638C18.6584 10.9528 18.6366 10.8429 18.5941 10.7404C18.5516 10.6378 18.4893 10.5447 18.4109 10.4662L15.5984 7.65368C15.52 7.57502 15.4268 7.51261 15.3243 7.47002C15.2217 7.42744 15.1118 7.40552 15.0007 7.40552C14.8897 7.40552 14.7797 7.42744 14.6771 7.47002C14.5746 7.51261 14.4814 7.57502 14.403 7.65368L11.5905 10.4662C11.5121 10.5447 11.4498 10.6378 11.4073 10.7404C11.3649 10.8429 11.343 10.9528 11.343 11.0638C11.343 11.288 11.432 11.503 11.5905 11.6615C11.7491 11.82 11.964 11.9091 12.1882 11.9091C12.4124 11.9091 12.6274 11.82 12.7859 11.6615L12.7845 11.6594Z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconImportAsset() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
      <rect x="1.5" y="1.5" width="13" height="13" rx="2" fill="currentColor" fillOpacity="0.10" />
      <rect x="1.5" y="1.5" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <path d="M8 5 L8 11 M5 8 L11 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
    </svg>
  );
}

// ─── Shared menu components ───────────────────────────────────────────────────

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
      style={{ color: disabled ? MENU_MUTED : MENU_TEXT, fontSize: 14, cursor: disabled ? 'default' : 'pointer', background: 'transparent' }}
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

// ─── ToolBtn: reusable icon button ───────────────────────────────────────────

function ToolBtn({
  active = false, disabled = false, title, onClick, children,
}: {
  active?: boolean;
  disabled?: boolean;
  title: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
      style={{
        color: disabled ? 'rgba(255,255,255,0.22)' : (active ? '#fff' : ICON_COLOR),
        background: active ? TOOL_ACTIVE_BG : 'transparent',
        border: `1px solid ${active ? TOOL_ACTIVE_BR : 'transparent'}`,
        cursor: disabled ? 'not-allowed' : 'pointer',
        flexShrink: 0,
      }}
      onMouseEnter={e => { if (!disabled && !active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.07)'; }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      {children}
    </button>
  );
}

// ─── Separator ────────────────────────────────────────────────────────────────

function VSep() {
  return <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.12)', flexShrink: 0 }} />;
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface NavbarProps {
  onImportLottie: () => void;
  onExport: (format: 'json' | 'lottie') => void;
  leftPanelWidth?: number;
  rightPanelWidth?: number;
}

// ─── Navbar ───────────────────────────────────────────────────────────────────

export default function Navbar({ onImportLottie, onExport, leftPanelWidth = 320, rightPanelWidth = 288 }: NavbarProps) {
  const activeTool           = useCreatorStore(s => s.activeTool);
  const setActiveTool        = useCreatorStore(s => s.setActiveTool);
  const addNodesBatch        = useCreatorStore(s => s.addNodesBatch);
  const nodes                = useCreatorStore(s => s.nodes);
  const activeArtboardId     = useCreatorStore(s => s.activeArtboardId);
  const selectedIds          = useCreatorStore(s => s.selectedIds);
  const activeArtboard       = activeArtboardId ? nodes.get(activeArtboardId) : Array.from(nodes.values()).find(n => n.type === 'artboard');
  const fileName             = activeArtboard?.name || 'Untitled';
  const inspectorLabel       = selectedIds.length > 0 ? (nodes.get(selectedIds[0])?.name || 'Layer') : 'Artboard';
  const isDiscoverModalOpen  = useCreatorStore(s => s.isDiscoverModalOpen);
  const setDiscoverModalOpen = useCreatorStore(s => s.setDiscoverModalOpen);
  const creatorMode          = useCreatorStore(s => s.creatorMode);
  const undo                 = useCreatorStore(s => s.undo);
  const redo                 = useCreatorStore(s => s.redo);
  const copySelection        = useCreatorStore(s => s.copySelection);
  const pasteSelection       = useCreatorStore(s => s.pasteSelection);
  const viewportZoom         = useCreatorStore(s => s.viewportZoom);
  const setViewportZoom      = useCreatorStore(s => s.setViewportZoom);

  const zoomLevel = Math.round(viewportZoom * 100);

  const [showLogoMenu,       setShowLogoMenu]       = useState(false);
  const [showExport,         setShowExport]         = useState(false);
  const [showEditSubmenu,    setShowEditSubmenu]     = useState(false);
  const [showNewFileConfirm, setShowNewFileConfirm] = useState(false);
  const [showZoom,           setShowZoom]           = useState(false);

  const assetInputRef  = useRef<HTMLInputElement>(null);
  const editTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        const imported = await SvgImporter.importFromString(text, duration);
        // Comp artboards (precomp-mode assets, reached via refId) are not placed on canvas.
        const isPlaceable = (n: typeof imported[number]) => !n.parentId && n.type !== 'artboard';
        const topIds   = imported.filter(isPlaceable).map(n => n.id);
        const nodesMap = new Map(imported.map(n => [n.id, n]));
        const svgRoot  = imported.find(isPlaceable);
        const bounds   = svgRoot?.props?._svgW
          ? { x: 0, y: 0, width: svgRoot.props._svgW as number, height: svgRoot.props._svgH as number }
          : getCollectiveBoundingBox(topIds, nodesMap);
        const ox = cx - (bounds.x + bounds.width  / 2);
        const oy = cy - (bounds.y + bounds.height / 2);

        imported.forEach(n => {
          if (isPlaceable(n)) { n.parentId = artboardId; n.transform.x += ox; n.transform.y += oy; }
        });

        if (artboard?.props.width && artboard?.props.height && bounds.width > 0 && bounds.height > 0) {
          const scale = Math.min(
            (artboard.props.width  * 0.8) / bounds.width,
            (artboard.props.height * 0.8) / bounds.height,
          );
          if (Math.abs(scale - 1) > 0.01) {
            imported.forEach(n => {
              if ((isPlaceable(n) || n.parentId === artboardId) && n.type !== 'artboard') {
                n.transform.x      = cx + (n.transform.x - cx) * scale;
                n.transform.y      = cy + (n.transform.y - cy) * scale;
                n.transform.scaleX *= scale;
                n.transform.scaleY *= scale;
              }
            });
          }
        }
        addNodesBatch(imported);
      } catch (err) { console.error('SVG import error:', err); }
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

  // ── Toggle Animate ↔ State Machine ───────────────────────────────────────
  const handleToggleMode = () => {
    const s = useCreatorStore.getState();
    if (isStateFlowMode) {
      s.setCreatorMode('animate');
    } else {
      s.setCreatorMode('state-flow');
      s.setSelection([]);
      s.setActiveTool('select');
      (s as any).setEditingNode?.(null);
    }
  };

  // ── Tool definitions ──────────────────────────────────────────────────────
  const tools = [
    { id: 'select',  Icon: IconCursor,  key: 'V', label: 'Select',    editOnly: false },
    { id: 'rect',    Icon: IconRect,    key: 'R', label: 'Rectangle', editOnly: true  },
    { id: 'ellipse', Icon: IconEllipse, key: 'O', label: 'Ellipse',   editOnly: true  },
    { id: 'pen',     Icon: IconPen,     key: 'P', label: 'Pen',       editOnly: true  },
    { id: 'text',    Icon: IconText,    key: 'T', label: 'Text',      editOnly: true  },
  ] as const;

  return (
    <>
      {/* ════════════════════════════════════════════════════════════════════
          HEADER — 48px, full width, #2C2C2C
          Layout: [Logo 240px] | [Center flex-1] | [Placeholder 240px]
         ═══════════════════════════════════════════════════════════════════ */}
      <header
        className="shrink-0 flex items-center z-50"
        style={{ height: 48, background: NAV_BG, borderBottom: `1px solid ${NAV_BORDER}` }}
      >

        {/* ── LEFT: LottiePro logo + dropdown — width synced to Layers panel ── */}
        <div
          className="relative shrink-0 flex items-center h-full"
          style={{ width: leftPanelWidth || 'auto', minWidth: 160, borderRight: leftPanelWidth > 0 ? `1px solid ${SIDEBAR_BORDER}` : 'none' }}
        >
          <button
            className="flex items-center gap-1.5 px-4 h-full w-full transition-colors"
            onClick={() => setShowLogoMenu(v => !v)}
            style={{ color: ICON_COLOR }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            {/* LottiePro brand icon */}
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" style={{ flexShrink: 0 }}>
              <path d="M0 5C0 2.23858 2.23858 0 5 0H27C29.7614 0 32 2.23858 32 5V27C32 29.7614 29.7614 32 27 32H5C2.23858 32 0 29.7614 0 27V5Z" fill="#383838"/>
              <path opacity="0.25" d="M13.3397 23.0208C15.7645 23.0208 17.7302 21.0432 17.7302 18.6036C17.7302 16.164 15.7645 14.1863 13.3397 14.1863C10.9149 14.1863 8.94922 16.164 8.94922 18.6036C8.94922 21.0432 10.9149 23.0208 13.3397 23.0208Z" fill="white"/>
              <path opacity="0.62" d="M15.9272 20.4178C18.3521 20.4178 20.3178 18.4401 20.3178 16.0005C20.3178 13.5609 18.3521 11.5833 15.9272 11.5833C13.5024 11.5833 11.5367 13.5609 11.5367 16.0005C11.5367 18.4401 13.5024 20.4178 15.9272 20.4178Z" fill="white"/>
              <path d="M18.5148 17.8143C20.9396 17.8143 22.9053 15.8366 22.9053 13.397C22.9053 10.9574 20.9396 8.97974 18.5148 8.97974C16.09 8.97974 14.1243 10.9574 14.1243 13.397C14.1243 15.8366 16.09 17.8143 18.5148 17.8143Z" fill="white"/>
            </svg>
            <ChevronDown size={11} style={{ color: 'rgba(255,255,255,0.35)' }} />
            <span className="text-[13px] font-medium truncate" style={{ color: 'rgba(252,253,255,0.85)' }}>{fileName}</span>
          </button>

          {showLogoMenu && (
            <>
              <div className="fixed inset-0 z-[99]" onClick={() => { setShowLogoMenu(false); setShowEditSubmenu(false); }} />
              <div
                className="absolute top-full left-0 mt-1.5 z-[100] py-1.5 rounded-xl"
                style={{ width: 264, background: MENU_BG, border: `1px solid ${MENU_BORDER}`, boxShadow: '0 20px 60px rgba(0,0,0,0.65)', overflow: 'visible' }}
              >
                <MenuItem
                  icon={<FilePlus2 size={15} strokeWidth={1.75} />}
                  label="New File" shortcut="⌘N"
                  onClick={() => { setShowLogoMenu(false); setShowNewFileConfirm(true); }}
                />
                <MenuItem
                  icon={<Upload size={15} strokeWidth={1.75} />}
                  label="Import" shortcut="⌘I"
                  onClick={() => { onImportLottie(); setShowLogoMenu(false); }}
                />
                <MenuItem
                  icon={<Download size={15} strokeWidth={1.75} />}
                  label="Export" shortcut="⌘E"
                  onClick={() => { setShowLogoMenu(false); setShowExport(true); }}
                />
                <MenuSeparator />

                {/* Edit flyout */}
                <div className="relative" onMouseEnter={openEditSubmenu} onMouseLeave={closeEditSubmenu}>
                  <MenuItem
                    icon={<RotateCcw size={15} strokeWidth={1.75} />}
                    label="Edit" arrow
                    onClick={() => setShowEditSubmenu(v => !v)}
                  />
                  {showEditSubmenu && (
                    <div
                      className="absolute py-1.5 rounded-xl z-[101]"
                      style={{ left: '100%', top: 0, marginLeft: 6, width: 224, background: MENU_BG, border: `1px solid ${MENU_BORDER}`, boxShadow: '0 20px 60px rgba(0,0,0,0.65)' }}
                      onMouseEnter={() => { if (editTimeoutRef.current) clearTimeout(editTimeoutRef.current); }}
                      onMouseLeave={closeEditSubmenu}
                    >
                      <MenuItem icon={<RotateCcw size={15} strokeWidth={1.75} />} label="Undo" shortcut="⌘Z"
                        onClick={() => { undo(); setShowLogoMenu(false); setShowEditSubmenu(false); }} />
                      <MenuItem icon={<RotateCw size={15} strokeWidth={1.75} />} label="Redo" shortcut="⌘⇧Z"
                        onClick={() => { redo(); setShowLogoMenu(false); setShowEditSubmenu(false); }} />
                      <MenuSeparator />
                      <MenuItem icon={<Copy size={15} strokeWidth={1.75} />} label="Copy" shortcut="⌘C"
                        onClick={() => { copySelection(); setShowLogoMenu(false); setShowEditSubmenu(false); }} />
                      <MenuItem icon={<Clipboard size={15} strokeWidth={1.75} />} label="Paste" shortcut="⌘V"
                        onClick={() => { pasteSelection(); setShowLogoMenu(false); setShowEditSubmenu(false); }} />
                    </div>
                  )}
                </div>

                <MenuItem icon={<Settings size={15} strokeWidth={1.75} />} label="Settings" arrow onClick={() => {}} />
                <MenuItem icon={<Keyboard size={15} strokeWidth={1.75} />} label="Shortcuts" arrow onClick={() => {}} />
                <MenuSeparator />
                <MenuItem icon={<LayoutDashboard size={15} strokeWidth={1.75} />} label="Dashboard"
                  onClick={() => { setShowLogoMenu(false); }} />
              </div>
            </>
          )}
        </div>

        {/* ── CENTER: Toolbar (flex-1, space-between) ───────────────────── */}
        <div className="flex-1 flex items-center justify-between h-full px-3">

          {/* Left group: Mode toggle + Zoom */}
          <div className="flex items-center gap-2.5">

            {/* Animate / State Machine toggle — pill only, tooltip explains mode */}
            <button
              onClick={handleToggleMode}
              title={isStateFlowMode ? 'State Machine mode — click to switch to Animate' : 'Animate mode — click to switch to State Machine'}
              style={{
                display: 'flex', alignItems: 'center',
                background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
              }}
            >
              <div
                style={{
                  width: 34, height: 18, borderRadius: 9,
                  background: isStateFlowMode ? TOGGLE_ON : TOGGLE_OFF,
                  position: 'relative', flexShrink: 0,
                  transition: 'background 0.2s',
                  boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.25)',
                }}
              >
                <div style={{
                  position: 'absolute', width: 12, height: 12, borderRadius: 6,
                  background: '#fff', top: 3,
                  left: isStateFlowMode ? 17 : 3,
                  transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }} />
              </div>
            </button>

            <VSep />

            {/* Zoom dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowZoom(v => !v)}
                className="flex items-center gap-1 px-2.5 h-7 rounded-md text-[12px] font-medium transition-colors"
                style={{ background: ZOOM_BG, border: `1px solid ${ZOOM_BORDER}`, color: ICON_COLOR, minWidth: 62 }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.12)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ZOOM_BG; }}
              >
                <span style={{ flex: 1, textAlign: 'right' }}>{zoomLevel}%</span>
                <ChevronDown size={10} style={{ color: ICON_MUTED, flexShrink: 0 }} className={showZoom ? 'rotate-180' : ''} />
              </button>

              {showZoom && (
                <>
                  <div className="fixed inset-0 z-[99]" onClick={() => setShowZoom(false)} />
                  <div
                    className="absolute top-full left-0 mt-1.5 py-1 rounded-xl z-[100]"
                    style={{ width: 90, background: MENU_BG, border: `1px solid ${MENU_BORDER}`, boxShadow: '0 12px 40px rgba(0,0,0,0.6)' }}
                  >
                    {ZOOM_LEVELS.map(lvl => (
                      <button
                        key={lvl}
                        onClick={() => { setViewportZoom(lvl / 100); setShowZoom(false); }}
                        className="w-full px-4 py-1.5 text-right text-[13px] transition-colors"
                        style={{
                          color: lvl === zoomLevel ? '#6E8EF7' : MENU_TEXT,
                          background: 'transparent',
                          fontWeight: lvl === zoomLevel ? 600 : 400,
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                      >
                        {lvl}%
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Center group: Drawing tools + AI */}
          <div className="flex items-center gap-1">
            {tools.map(({ id, Icon, key, label, editOnly }) => {
              const active   = activeTool === id;
              const disabled = isStateFlowMode && editOnly;
              return (
                <ToolBtn
                  key={id}
                  active={active}
                  disabled={disabled}
                  title={disabled ? `${label} (unavailable in State Machine mode)` : `${label} (${key})`}
                  onClick={() => setActiveTool(id as any)}
                >
                  <Icon />
                </ToolBtn>
              );
            })}

            <div style={{ width: 6 }} />
            <VSep />
            <div style={{ width: 6 }} />

            {/* Import asset */}
            <ToolBtn
              disabled={isStateFlowMode}
              title="Import asset (SVG / Image)"
              onClick={() => assetInputRef.current?.click()}
            >
              <IconImportAsset />
            </ToolBtn>

            <div style={{ width: 8 }} />

            {/* AI / Discover Logos (sparkle icon) — offset right with extra gap */}
            <ToolBtn
              active={isDiscoverModalOpen}
              title="Discover brand logos"
              onClick={() => setDiscoverModalOpen(true)}
            >
              <IconSparkle />
            </ToolBtn>
          </div>

          {/* Right group: Preview + Export/Share */}
          <div className="flex items-center gap-1">

            {/* Preview placeholder */}
            <ToolBtn title="Preview (coming soon)">
              <IconMonitorPlay />
            </ToolBtn>

            <VSep />

            {/* Export / Share combined button */}
            <div className="relative">
              <ToolBtn
                active={showExport}
                title="Export / Share"
                onClick={() => setShowExport(v => !v)}
              >
                <IconShareExport />
              </ToolBtn>

              {showExport && (
                <>
                  <div className="fixed inset-0 z-[99]" onClick={() => setShowExport(false)} />
                  <div
                    className="absolute top-full right-0 mt-1.5 py-1.5 rounded-xl z-[100]"
                    style={{ width: 210, background: MENU_BG, border: `1px solid ${MENU_BORDER}`, boxShadow: '0 20px 60px rgba(0,0,0,0.65)' }}
                  >
                    <MenuItem
                      icon={
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                          <circle cx="13" cy="3" r="2" />
                          <circle cx="3" cy="8" r="2" />
                          <circle cx="13" cy="13" r="2" />
                          <path d="M5 7.1L11 4.5M5 9l6 2.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
                        </svg>
                      }
                      label="Share"
                      onClick={() => { setShowExport(false); }}
                    />
                    <MenuSeparator />
                    <MenuItem
                      icon={<FileJson size={14} />}
                      label="Export as JSON"
                      onClick={() => { onExport('json'); setShowExport(false); }}
                    />
                    <MenuItem
                      icon={<Zap size={14} />}
                      label="Export as dotLottie"
                      onClick={() => { onExport('lottie'); setShowExport(false); }}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── RIGHT: Inspector label — width synced to Inspector panel ─── */}
        <div
          className="shrink-0 h-full flex items-center"
          style={{ width: rightPanelWidth, borderLeft: `1px solid ${SIDEBAR_BORDER}`, paddingLeft: 16 }}
        >
          <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 550, fontSize: 11, color: '#FFFFFF', letterSpacing: '0.055em' }}>
            {inspectorLabel}
          </span>
        </div>
      </header>

      {/* ── New File confirmation modal ─────────────────────────────────────── */}
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
              style={{ width: 320, background: MENU_BG, border: `1px solid ${MENU_BORDER}`, boxShadow: '0 24px 64px rgba(0,0,0,0.80)' }}
            >
              <h3 className="text-[15px] font-semibold mb-1.5" style={{ color: MENU_TEXT }}>New File</h3>
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
