const JSZip = require('./node_modules/jszip');
const fs = require('fs');

async function inspectConfetti() {
    const originalPath = 'C:\\Users\\iamah\\Downloads\\Interactive test.lottie';
    const data = fs.readFileSync(originalPath);
    const zip = await JSZip.loadAsync(data);
    const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
    const animPath = manifest.animations[0].id ? `a/${manifest.animations[0].id}.json` : 'animations/data.json';
    const json = JSON.parse(await zip.file(animPath).async('string'));

    // Find confetti layers (they are likely small shapes or precomps)
    const confettiLayers = json.layers.filter(l => l.nm && l.nm.toLowerCase().includes('confetti'));
    if (confettiLayers.length === 0) {
        console.log('No confetti layers found by name. Searching all shapes...');
    }

    const checkShapes = (shapes, depth = 0) => {
        if (!shapes) return;
        shapes.forEach(s => {
            const indent = '  '.repeat(depth);
            console.log(`${indent}Type: ${s.ty}, Name: ${s.nm}`);
            if (s.ty === 'fl') {
                console.log(`${indent}  - Fill Color: ${JSON.stringify(s.c.k)}`);
            }
            if (s.it) checkShapes(s.it, depth + 1);
        });
    }

    json.layers.forEach(l => {
        if (l.nm && (l.nm.includes('confetti') || l.nm.includes('Confetti') || l.nm.includes('Ellipse'))) {
            console.log(`\nLayer: ${l.nm} (ind: ${l.ind})`);
            checkShapes(l.shapes);
        }
    });

}

inspectConfetti().catch(console.error);
