'use client';

import { useRef, useEffect, useState, useCallback } from 'react';

interface BezierCanvasProps {
    bezier: [number, number, number, number];
    onChange: (bezier: [number, number, number, number]) => void;
    width?: number;
    height?: number;
}

export default function BezierCanvas({
    bezier,
    onChange,
    width = 200,
    height = 200
}: BezierCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [dragging, setDragging] = useState<'p1' | 'p2' | null>(null);

    // Padding for the canvas
    const padding = 20;
    const graphWidth = width - padding * 2;
    const graphHeight = height - padding * 2;

    // Convert bezier control points to canvas coordinates
    const p1ToCanvas = useCallback(() => ({
        x: padding + bezier[0] * graphWidth,
        y: height - padding - bezier[1] * graphHeight
    }), [bezier, graphWidth, graphHeight, height, padding]);

    const p2ToCanvas = useCallback(() => ({
        x: padding + bezier[2] * graphWidth,
        y: height - padding - bezier[3] * graphHeight
    }), [bezier, graphWidth, graphHeight, height, padding]);

    // Convert canvas coordinates to bezier values
    const canvasToP1 = useCallback((x: number, y: number): [number, number] => {
        const bx = Math.max(0, Math.min(1, (x - padding) / graphWidth));
        const by = (height - padding - y) / graphHeight; // Can go outside 0-1 for overshoot
        return [bx, by];
    }, [graphWidth, graphHeight, height, padding]);

    const canvasToP2 = useCallback((x: number, y: number): [number, number] => {
        const bx = Math.max(0, Math.min(1, (x - padding) / graphWidth));
        const by = (height - padding - y) / graphHeight;
        return [bx, by];
    }, [graphWidth, graphHeight, height, padding]);

    // Draw the bezier curve
    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Clear
        ctx.clearRect(0, 0, width, height);

        // Background grid
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const x = padding + (graphWidth / 4) * i;
            const y = padding + (graphHeight / 4) * i;
            ctx.beginPath();
            ctx.moveTo(x, padding);
            ctx.lineTo(x, height - padding);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(padding, y);
            ctx.lineTo(width - padding, y);
            ctx.stroke();
        }

        // Axis lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        // Bottom edge (y=0)
        ctx.beginPath();
        ctx.moveTo(padding, height - padding);
        ctx.lineTo(width - padding, height - padding);
        ctx.stroke();
        // Top edge (y=1)
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(padding, padding);
        ctx.lineTo(width - padding, padding);
        ctx.stroke();
        ctx.setLineDash([]);

        // Start and end points
        const startX = padding;
        const startY = height - padding;
        const endX = width - padding;
        const endY = padding;

        // Control point positions
        const p1 = p1ToCanvas();
        const p2 = p2ToCanvas();

        // Control point lines (dashed)
        ctx.strokeStyle = 'rgba(255, 51, 90, 0.4)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // The bezier curve
        ctx.strokeStyle = '#0A84FF';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, endX, endY);
        ctx.stroke();

        // Start point (filled circle)
        ctx.fillStyle = '#0A84FF';
        ctx.beginPath();
        ctx.arc(startX, startY, 5, 0, Math.PI * 2);
        ctx.fill();

        // End point (filled circle)
        ctx.beginPath();
        ctx.arc(endX, endY, 5, 0, Math.PI * 2);
        ctx.fill();

        // Control point 1 (hollow circle)
        ctx.strokeStyle = '#0A84FF';
        ctx.fillStyle = dragging === 'p1' ? '#0A84FF' : '#1E1E20';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p1.x, p1.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Control point 2 (hollow circle)
        ctx.fillStyle = dragging === 'p2' ? '#0A84FF' : '#1E1E20';
        ctx.beginPath();
        ctx.arc(p2.x, p2.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

    }, [bezier, width, height, graphWidth, graphHeight, padding, p1ToCanvas, p2ToCanvas, dragging]);

    useEffect(() => {
        draw();
    }, [draw]);

    const handleMouseDown = (e: React.MouseEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const p1 = p1ToCanvas();
        const p2 = p2ToCanvas();

        const distP1 = Math.sqrt((x - p1.x) ** 2 + (y - p1.y) ** 2);
        const distP2 = Math.sqrt((x - p2.x) ** 2 + (y - p2.y) ** 2);

        if (distP1 < 12) {
            setDragging('p1');
        } else if (distP2 < 12) {
            setDragging('p2');
        }
    };

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!dragging) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (dragging === 'p1') {
            const [bx, by] = canvasToP1(x, y);
            onChange([bx, by, bezier[2], bezier[3]]);
        } else if (dragging === 'p2') {
            const [bx, by] = canvasToP2(x, y);
            onChange([bezier[0], bezier[1], bx, by]);
        }
    }, [dragging, bezier, canvasToP1, canvasToP2, onChange]);

    const handleMouseUp = useCallback(() => {
        setDragging(null);
    }, []);

    useEffect(() => {
        if (dragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
            return () => {
                window.removeEventListener('mousemove', handleMouseMove);
                window.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [dragging, handleMouseMove, handleMouseUp]);

    return (
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className="cursor-crosshair rounded-md border border-white/[0.06]"
            style={{ background: 'var(--bg-surface)' }}
            onMouseDown={handleMouseDown}
        />
    );
}
