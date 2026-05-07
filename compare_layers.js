const JSZip = require('./node_modules/jszip');
const fs = require('fs');

async function compareEllipse() {
    const originalPath = 'C:\\Users\\iamah\\Downloads\\Interactive test.lottie';
    const exportedPath = 'C:\\Users\\iamah\\Downloads\\interactive newww.lottie';

    const originalData = fs.readFileSync(originalPath);
    const exportedData = fs.readFileSync(exportedPath);

    const originalZip = await JSZip.loadAsync(originalData);
    const exportedZip = await JSZip.loadAsync(exportedData);

    const originalManifest = JSON.parse(await originalZip.file('manifest.json').async('string'));
    const exportedManifest = JSON.parse(await exportedZip.file('manifest.json').async('string'));

    const originalAnimPath = originalManifest.animations[0].id ? `a/${originalManifest.animations[0].id}.json` : 'animations/data.json';
    const exportedAnimPath = `a/${exportedManifest.animations[0].id}.json`;

    const originalJson = JSON.parse(await originalZip.file(originalAnimPath).async('string'));
    const exportedJson = JSON.parse(await exportedZip.file(exportedAnimPath).async('string'));

    const findLayer = (json, name) => json.layers.find(l => l.nm === name);

    // Let's find any layer that looks like confetti or cake
    const layerNames = ['Ellipse 71179', 'Ellipse 71180', 'Layer 1', 'Main Group'];

    for (const layerName of layerNames) {
        const l1 = findLayer(originalJson, layerName);
        const l2 = findLayer(exportedJson, layerName);

        if (!l1 || !l2) continue;

        console.log(`\n--- Comparison for ${layerName} ---`);
        console.log('Original Layer properties:', Object.keys(l1).filter(k => k !== 'shapes' && k !== 'ks'));
        console.log('Exported Layer properties:', Object.keys(l2).filter(k => k !== 'shapes' && k !== 'ks'));

        console.log('\nOriginal shapes structure:');
        const printShapes = (shapes, depth = 0) => {
            if (!shapes) return;
            shapes.forEach(s => {
                let info = `Type: ${s.ty}, Name: ${s.nm}`;
                if (s.ty === 'fl') info += `, Color: ${JSON.stringify(s.c?.k)}`;
                if (s.ty === 'st') info += `, Width: ${JSON.stringify(s.w?.k)}`;
                console.log('  '.repeat(depth) + info);
                if (s.it) printShapes(s.it, depth + 1);
            });
        }
        printShapes(l1.shapes);

        console.log('\nExported shapes structure:');
        printShapes(l2.shapes);
    }
}

compareEllipse().catch(console.error);
