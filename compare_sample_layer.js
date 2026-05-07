const JSZip = require('./node_modules/jszip');
const fs = require('fs');

async function compareSampleLayer() {
    const originalPath = 'C:\\Users\\iamah\\Downloads\\Interactive test.lottie';
    const exportedPath = 'C:\\Users\\iamah\\Downloads\\Main Scene.lottie';

    const originalZip = await JSZip.loadAsync(fs.readFileSync(originalPath));
    const exportedZip = await JSZip.loadAsync(fs.readFileSync(exportedPath));

    const originalManifest = JSON.parse(await originalZip.file('manifest.json').async('string'));
    const exportedManifest = JSON.parse(await exportedZip.file('manifest.json').async('string'));

    const originalJson = JSON.parse(await originalZip.file(`a/${originalManifest.animations[0].id}.json`).async('string'));
    const exportedJson = JSON.parse(await exportedZip.file(`a/${exportedManifest.animations[0].id}.json`).async('string'));

    // Compare layer 0 or similar
    console.log('--- Original Layer 0 ---');
    console.log(JSON.stringify(originalJson.layers[0], null, 2).slice(0, 1000));
    console.log('\n--- Exported Layer 0 ---');
    console.log(JSON.stringify(exportedJson.layers[0], null, 2).slice(0, 1000));
}

compareSampleLayer().catch(console.error);
