'use client';

import React, { useState, useEffect } from 'react';
import { Search, Compass, X } from 'lucide-react';
import { useCreatorStore } from '@/lib/creator/state/store';
import { SVGImporter } from '@/lib/creator/core/SVGImporter';
import { getPathLocalBounds, getCollectiveBoundingBox, getAnchorOffset } from '@/lib/creator/core/Matrix';

interface SVGLLogo {
    title: string;
    category: string | string[];
    route: string | { light: string; dark: string };
    wordmark: string | { light: string; dark: string };
    url: string;
}

export default function DiscoverLogosModal() {
    const isDiscoverModalOpen = useCreatorStore((state) => state.isDiscoverModalOpen);
    const setDiscoverModalOpen = useCreatorStore((state) => state.setDiscoverModalOpen);
    const activeArtboardId = useCreatorStore((state) => state.activeArtboardId);
    const nodes = useCreatorStore((state) => state.nodes);
    const addNodesBatch = useCreatorStore((state) => state.addNodesBatch);

    const [logos, setLogos] = useState<SVGLLogo[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    // Fetch logos on mount
    useEffect(() => {
        let isMounted = true;
        const fetchLogos = async () => {
            setIsLoading(true);
            setError('');
            try {
                const response = await fetch('https://api.svgl.app');
                if (!response.ok) throw new Error('Failed to fetch logos');
                const data = await response.json();
                if (isMounted) setLogos(data);
            } catch (err: any) {
                if (isMounted) setError(err.message || 'An error occurred');
            } finally {
                if (isMounted) setIsLoading(false);
            }
        };
        fetchLogos();
        return () => { isMounted = false; };
    }, []);

    if (!isDiscoverModalOpen) return null;

    const handleImportLogo = async (logo: SVGLLogo) => {
        try {
            // route might be an object { dark, light } or a string URL. We prefer the light/default one for canvas.
            let svgUrl = '';
            if (typeof logo.route === 'object' && logo.route) {
                svgUrl = (logo.route as any).light || (logo.route as any).dark;
            } else if (typeof logo.route === 'string') {
                svgUrl = logo.route;
            }

            if (!svgUrl) {
                console.warn('⚠️ No SVG URL found for this logo.');
                return;
            }

            const response = await fetch(`/api/proxy-svg?url=${encodeURIComponent(svgUrl)}`);
            if (!response.ok) throw new Error('Failed to fetch raw SVG via proxy');
            const text = await response.text();

            // Ensure we have an active artboard to drop the SVG into
            let artboardId = activeArtboardId;
            if (!artboardId) {
                const artboard = Array.from(nodes.values()).find(n => n.type === 'artboard');
                artboardId = artboard?.id || null;
            }

            if (!artboardId) {
                console.error('❌ No active artboard found to import into');
                return;
            }

            const artboard = nodes.get(artboardId);
            const centerX = artboard?.props.width ? artboard.props.width / 2 : 250;
            const centerY = artboard?.props.height ? artboard.props.height / 2 : 250;

            // Parse and group nodes
            const duration = artboard?.props.duration || 100000;
            const importedNodes = await SVGImporter.importFromString(text, duration);
            if (!importedNodes || importedNodes.length === 0) return;

            const topLevelIds = importedNodes.filter(n => !n.parentId).map(n => n.id);
            const nodesMap = new Map(importedNodes.map(n => [n.id, n]));
            const bounds = getCollectiveBoundingBox(topLevelIds, nodesMap);

            const contentWidth = bounds.width;
            const contentHeight = bounds.height;
            const offsetX = centerX - (bounds.x + contentWidth / 2);
            const offsetY = centerY - (bounds.y + contentHeight / 2);

            // Apply coordinates and parent injection
            if (isFinite(offsetX) && isFinite(offsetY)) {
                importedNodes.forEach(n => {
                    if (!n.parentId) {
                        n.parentId = artboardId;
                        n.transform.x += offsetX;
                        n.transform.y += offsetY;

                        // Assign name if it's the top level element
                        if (n.name === 'Group') n.name = logo.title;
                    }
                });
            }

            console.log(`🚀 Adding ${importedNodes.length} SVG logic nodes...`);
            addNodesBatch(importedNodes);

            // Close modal smoothly
            setDiscoverModalOpen(false);

        } catch (err) {
            console.error('Failed to import logo:', err);
        }
    };

    const filteredLogos = logos.filter(logo => {
        const query = searchQuery.toLowerCase();
        const titleMatch = (logo.title || '').toLowerCase().includes(query);

        // Handle category which can be a string or an array of strings
        let categoryMatch = false;
        if (typeof logo.category === 'string') {
            categoryMatch = logo.category.toLowerCase().includes(query);
        } else if (Array.isArray(logo.category)) {
            categoryMatch = logo.category.some(cat =>
                typeof cat === 'string' && cat.toLowerCase().includes(query)
            );
        }

        return titleMatch || categoryMatch;
    });

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 text-white">
            <div className="w-full max-w-3xl h-[600px] border border-white/[0.06] rounded-xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200" style={{ background: 'var(--bg-panel)' }}>

                {/* Header */}
                <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between" style={{ background: 'var(--bg-surface)' }}>
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center text-accent">
                            <Compass size={18} />
                        </div>
                        <div>
                            <h3 className="font-bold text-white/90">Discover Brand Logos</h3>
                            <p className="text-[10px] text-white/40">Powered by SVGL API</p>
                        </div>
                    </div>
                    <button
                        onClick={() => setDiscoverModalOpen(false)}
                        className="w-8 h-8 rounded-lg hover:bg-white/5 flex items-center justify-center text-white/30 hover:text-white/60 transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Search Bar */}
                <div className="p-3 border-b border-white/[0.06]">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={14} />
                        <input
                            type="text"
                            placeholder="Search by brand name (e.g. Google, Meta)..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-surface border border-white/[0.06] rounded-lg pl-9 pr-4 py-2.5 text-sm text-secondary placeholder-muted focus:outline-none focus:border-accent/50 transition-colors"
                            autoFocus
                        />
                    </div>
                </div>

                {/* Content Area */}
                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                    {isLoading ? (
                        <div className="h-full flex items-center justify-center text-white/40 text-sm">Loading logos...</div>
                    ) : error ? (
                        <div className="h-full flex items-center justify-center text-accent text-sm">{error}</div>
                    ) : filteredLogos.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-white/40 text-sm">No logos found for "{searchQuery}"</div>
                    ) : (
                        <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-4">
                            {filteredLogos.map((logo, index) => {
                                // Ensure we have a valid route to show as preview image
                                const imgSrc = typeof logo.route === 'object' && logo.route ? ((logo.route as any).light || (logo.route as any).dark) : logo.route;
                                if (!imgSrc || typeof imgSrc !== 'string') return null;

                                return (
                                    <button
                                        key={`${logo.title}-${index}`}
                                        onClick={() => handleImportLogo(logo)}
                                        className="group flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-white/5 border border-transparent hover:border-white/10 transition-all active:scale-95"
                                        title={`Import ${logo.title}`}
                                    >
                                        <div className="w-12 h-12 bg-white flex items-center justify-center rounded-lg p-2 shadow-inner">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={imgSrc} alt={logo.title} className="w-full h-full object-contain" />
                                        </div>
                                        <span className="text-[10px] text-white/50 group-hover:text-white/90 truncate w-full text-center transition-colors">
                                            {logo.title}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
}
