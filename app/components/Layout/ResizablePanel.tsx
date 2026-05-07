'use client';

import React, { useState, useRef } from 'react';

interface ResizablePanelProps {
    direction: 'horizontal' | 'vertical';
    initialSize: number;
    minSize?: number;
    maxSize?: number;
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
    onResize?: (size: number) => void;
    side: 'left' | 'right' | 'top' | 'bottom';
    collapsed?: boolean;
    collapsedSize?: number;
}

export default function ResizablePanel({
    direction,
    initialSize,
    minSize = 100,
    maxSize = 800,
    children,
    className = '',
    style: externalStyle,
    onResize,
    side,
    collapsed = false,
    collapsedSize = 40,
}: ResizablePanelProps) {
    const [size, setSize] = useState(initialSize);
    const isResizing = useRef(false);

    const handleMouseDown = (e: React.MouseEvent) => {
        if (collapsed) return;
        e.preventDefault();
        isResizing.current = true;
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
        document.body.style.userSelect = 'none';
    };

    const handleMouseMove = (e: MouseEvent) => {
        if (!isResizing.current || collapsed) return;

        let newSize = size;
        const mouseX = e.clientX;
        const mouseY = e.clientY;

        if (direction === 'horizontal') {
            if (side === 'right') {
                const rect = document.getElementById(`panel-${side}`)?.getBoundingClientRect();
                if (rect) newSize = mouseX - rect.left;
            } else if (side === 'left') {
                newSize = window.innerWidth - mouseX;
            }
        } else {
            if (side === 'top') {
                newSize = window.innerHeight - mouseY;
            } else if (side === 'bottom') {
                const rect = document.getElementById(`panel-${side}`)?.getBoundingClientRect();
                if (rect) newSize = mouseY - rect.top;
            }
        }

        if (newSize < minSize) newSize = minSize;
        if (newSize > maxSize) newSize = maxSize;

        setSize(newSize);
        if (onResize) onResize(newSize);
    };

    const handleMouseUp = () => {
        isResizing.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    };

    const effectiveSize = collapsed ? collapsedSize : size;
    const sizeStyle: React.CSSProperties = direction === 'horizontal'
        ? { width: effectiveSize }
        : { height: effectiveSize };

    return (
        <div
            id={`panel-${side}`}
            className={`relative flex-shrink-0 transition-[width,height] duration-300 ease-in-out ${className}`}
            style={{ ...externalStyle, ...sizeStyle }}
        >
            <div className={`h-full w-full ${collapsed ? 'overflow-hidden' : ''}`}>
                {children}
            </div>

            {!collapsed && (
                <div
                    onMouseDown={handleMouseDown}
                    className={`absolute z-50 hover:bg-accent/40 transition-colors ${
                        direction === 'horizontal' ? 'cursor-col-resize' : 'cursor-row-resize'
                    } ${
                        side === 'right'  ? 'top-0 right-0 w-1 h-full' :
                        side === 'left'   ? 'top-0 left-0 w-1 h-full' :
                        side === 'top'    ? 'top-0 left-0 w-full h-1' :
                                            'bottom-0 left-0 w-full h-1'
                    }`}
                />
            )}
        </div>
    );
}
