'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Search, Check, ChevronDown, Loader2 } from 'lucide-react';
import {
  initGoogleFonts,
  searchFonts,
  loadFontCSS,
  getFonts,
  type GoogleFontFamily,
} from '@/lib/creator/fonts/GoogleFontsService';

type Category = 'all' | 'sans-serif' | 'serif' | 'monospace' | 'display' | 'handwriting';
type Language = 'all' | 'latin' | 'cjk' | 'arabic' | 'cyrillic';

const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'all',         label: 'All'        },
  { id: 'sans-serif',  label: 'Sans'       },
  { id: 'serif',       label: 'Serif'      },
  { id: 'monospace',   label: 'Mono'       },
  { id: 'display',     label: 'Display'    },
  { id: 'handwriting', label: 'Script'     },
];

const LANGUAGES: { id: Language; label: string }[] = [
  { id: 'all',      label: 'All'      },
  { id: 'latin',    label: 'Latin'    },
  { id: 'cjk',      label: 'CJK'      },
  { id: 'arabic',   label: 'Arabic'   },
  { id: 'cyrillic', label: 'Cyrillic' },
];

const CJK_SUBSETS = ['chinese-simplified', 'chinese-traditional', 'japanese', 'korean'];

function filterByLanguage(fonts: GoogleFontFamily[], lang: Language): GoogleFontFamily[] {
  if (lang === 'all') return fonts;
  return fonts.filter(f => {
    switch (lang) {
      case 'latin':    return f.subsets.includes('latin');
      case 'cjk':      return CJK_SUBSETS.some(s => f.subsets.includes(s));
      case 'arabic':   return f.subsets.includes('arabic');
      case 'cyrillic': return f.subsets.includes('cyrillic');
      default: return true;
    }
  });
}

const ROW_HEIGHT = 44;
const LIST_HEIGHT = 340;

interface FontPickerProps {
  value: string;
  onChange: (font: string) => void;
}

export default function FontPicker({ value, onChange }: FontPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const [language, setLanguage] = useState<Language>('all');
  const [fonts, setFonts] = useState<GoogleFontFamily[]>([]);
  const [catalogueReady, setCatalogueReady] = useState(false);

  const containerRef  = useRef<HTMLDivElement>(null);
  const scrollRef     = useRef<HTMLDivElement>(null);
  const searchRef     = useRef<HTMLInputElement>(null);

  // Load catalogue on first open
  useEffect(() => {
    if (!isOpen || catalogueReady) return;
    setLoading(true);
    initGoogleFonts().then(() => {
      setCatalogueReady(true);
      setLoading(false);
    });
  }, [isOpen, catalogueReady]);

  // Re-filter whenever query, category, language, or catalogue changes
  useEffect(() => {
    if (!catalogueReady) {
      setFonts([]);
      return;
    }
    const byCategory = searchFonts(query, category === 'all' ? undefined : category);
    setFonts(filterByLanguage(byCategory, language));
  }, [query, category, language, catalogueReady]);

  // Focus search box when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchRef.current?.focus(), 50);
    } else {
      setQuery('');
      setCategory('all');
      setLanguage('all');
    }
  }, [isOpen]);

  // Scroll selected font into view on open
  useEffect(() => {
    if (!isOpen || !catalogueReady || fonts.length === 0) return;
    const idx = fonts.findIndex(f => f.family === value);
    if (idx >= 0) {
      rowVirtualizer.scrollToIndex(idx, { align: 'center' });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, catalogueReady]);

  // Close on outside click
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const rowVirtualizer = useVirtualizer({
    count: fonts.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const handleSelect = useCallback((family: string) => {
    loadFontCSS(family);
    onChange(family);
    setIsOpen(false);
  }, [onChange]);

  return (
    <div className="relative" ref={containerRef}>
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(o => !o)}
        className="w-full bg-surface border border-white/[0.06] rounded-md px-3 h-9 flex items-center justify-between text-[11px] text-secondary hover:text-primary hover:border-white/10 transition-all cursor-pointer"
      >
        <span style={{ fontFamily: value }} className="truncate">{value}</span>
        <ChevronDown size={14} className={`shrink-0 ml-1 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          className="absolute top-full left-0 right-0 mt-1 border border-white/[0.06] rounded-lg shadow-2xl z-[500] flex flex-col overflow-hidden"
          style={{ background: 'var(--bg-panel)', width: '260px' }}
        >
          {/* Search */}
          <div className="p-2 border-b border-white/[0.06] flex items-center gap-2" style={{ background: 'var(--bg-surface)' }}>
            <Search size={13} className="text-white/20 shrink-0" />
            <input
              ref={searchRef}
              className="bg-transparent border-none outline-none text-[11px] font-medium text-white placeholder-white/20 w-full"
              placeholder="Search fonts…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.stopPropagation()}
            />
            {loading && <Loader2 size={12} className="text-white/30 animate-spin shrink-0" />}
          </div>

          {/* Category tabs */}
          <div className="flex border-b border-white/[0.06] overflow-x-auto scrollbar-none" style={{ background: 'var(--bg-surface)' }}>
            {CATEGORIES.map(c => (
              <button
                key={c.id}
                onClick={() => setCategory(c.id)}
                className={`px-2.5 py-1.5 text-[10px] font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  category === c.id
                    ? 'text-accent border-b-2 border-accent'
                    : 'text-white/30 hover:text-white/60 border-b-2 border-transparent'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          {/* Language / script tabs */}
          <div className="flex border-b border-white/[0.06] overflow-x-auto scrollbar-none" style={{ background: 'var(--bg-surface)' }}>
            {LANGUAGES.map(l => (
              <button
                key={l.id}
                onClick={() => setLanguage(l.id)}
                className={`px-2.5 py-1 text-[9px] font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  language === l.id
                    ? 'text-accent border-b-2 border-accent'
                    : 'text-white/20 hover:text-white/50 border-b-2 border-transparent'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>

          {/* Font list */}
          {loading ? (
            <div className="flex items-center justify-center h-24 text-[11px] text-white/20">
              Loading fonts…
            </div>
          ) : fonts.length === 0 ? (
            <div className="flex items-center justify-center h-24 text-[11px] text-white/20">
              No fonts found
            </div>
          ) : (
            <div
              ref={scrollRef}
              className="overflow-y-auto"
              style={{ height: LIST_HEIGHT }}
            >
              {/* Spacer to give the virtualizer its full height */}
              <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
                {rowVirtualizer.getVirtualItems().map(vItem => (
                  <FontRow
                    key={vItem.key}
                    font={fonts[vItem.index]}
                    isSelected={fonts[vItem.index].family === value}
                    onSelect={handleSelect}
                    style={{
                      position: 'absolute',
                      top: vItem.start,
                      left: 0,
                      right: 0,
                      height: ROW_HEIGHT,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          {!loading && (
            <div className="border-t border-white/[0.06]" style={{ background: 'var(--bg-surface)' }}>
              {language === 'cjk' && (
                <div className="px-3 py-1.5 text-[9px] text-yellow-400/70 border-b border-white/[0.04]">
                  CJK fonts have large character sets — glyph export will significantly increase file size.
                </div>
              )}
              <div className="px-3 py-1.5 text-[10px] text-white/20">
                {fonts.length.toLocaleString()} font{fonts.length !== 1 ? 's' : ''}
                {query || category !== 'all' || language !== 'all' ? ' matching' : ' available'}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Individual font row ────────────────────────────────────────────────────────
interface FontRowProps {
  font: GoogleFontFamily;
  isSelected: boolean;
  onSelect: (family: string) => void;
  style: React.CSSProperties;
}

function FontRow({ font, isSelected, onSelect, style }: FontRowProps) {
  const loaded = useRef(false);

  // Load font CSS on first render (virtualizer only renders visible rows)
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    loadFontCSS(font.family);
  }, [font.family]);

  return (
    <button
      onClick={() => onSelect(font.family)}
      style={style}
      className={`w-full text-left px-3 flex items-center justify-between gap-2 hover:bg-white/[0.04] transition-colors group ${
        isSelected ? 'bg-accent/10' : ''
      }`}
    >
      <div className="flex flex-col min-w-0">
        <span
          className={`text-[13px] leading-tight truncate ${isSelected ? 'text-accent' : 'text-secondary group-hover:text-primary'}`}
          style={{ fontFamily: font.family }}
        >
          {font.family}
        </span>
        <span className="text-[9px] text-white/20 uppercase tracking-widest mt-0.5">
          {font.category}{font.axes && font.axes.length > 0 ? ' · variable' : ''}
        </span>
      </div>
      {isSelected && <Check size={13} className="text-accent shrink-0" />}
    </button>
  );
}
