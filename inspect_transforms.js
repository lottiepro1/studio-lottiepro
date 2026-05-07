const JSZip = require('./node_modules/jszip');
const fs = require('fs');

async function inspectTransforms() {
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

    const findLayer = (json, name) => json.layers.find(l => l.nm === name);

    const groupNames = ['Group 2147221241 1', 'Group 2147221240'];

    for (const name of groupNames) {
        console.log(`\n=== Layer: ${name} ===`);
        const origL = findLayer(originalJson, name);
        const expL = findLayer(exportedJson, name);

        console.log('Original Layer Transform (ks):');
        console.log(JSON.stringify(origL?.ks, null, 2));
        console.log('Original Matte props (tt, td):', origL?.tt, origL?.td);

        console.log('\nExported Layer Transform (ks):');
        console.log(JSON.stringify(expL?.ks, null, 2));
        console.log('Exported Matte props (tt, td):', expL?.tt, expL?.td);
    }
}

inspectTransforms().catch(console.error);
