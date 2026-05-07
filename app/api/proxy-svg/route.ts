import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get('url');

    if (!url) {
        return NextResponse.json({ error: 'URL parameter is required' }, { status: 400 });
    }

    try {
        const response = await fetch(url);
        if (!response.ok) {
            return NextResponse.json({ error: 'Failed to fetch SVG' }, { status: response.status });
        }

        const svgText = await response.text();
        // Return the SVG text with correct content-type
        return new NextResponse(svgText, {
            headers: {
                'Content-Type': 'image/svg+xml',
                'Cache-Control': 'public, max-age=3600',
            },
        });
    } catch (error) {
        console.error('Error proxying SVG:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
