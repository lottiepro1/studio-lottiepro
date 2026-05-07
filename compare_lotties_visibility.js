const JSZip = require('./node_modules/jszip');
const fs = require('fs');

async function compare() {
    const originalPath = 'C:\\Users\\iamah\\Downloads\\Interactive test.lottie';
    const exportedPath = 'C:\\Users\\iamah\\Downloads\\Main Scene.lottie';

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

    console.log('--- hd values ---');
    console.log('Original keys in layers[0]:', Object.keys(originalJson.layers[0]).join(', '));
    console.log('Exported keys in layers[0]:', Object.keys(exportedJson.layers[0]).join(', '));

    console.log('\n--- Layer check ---');
    originalJson.layers.slice(0, 10).forEach(l => {
        const exportedLayer = exportedJson.layers.find(el => el.nm === l.nm);
        console.log(`Layer ${l.nm}: Original hd=${l.hd}, Exported hd=${exportedLayer?.hd}`);
    });
}

compare().catch(console.error);
