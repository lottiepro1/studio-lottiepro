const JSZip = require('./node_modules/jszip');
const fs = require('fs');

async function checkMissingGroups() {
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

    console.log('--- Original Layers ---');
    originalJson.layers.forEach(l => {
        if (l.nm.includes('214722124') || l.nm.includes('Group') || l.nm.includes('Rectangle')) {
            console.log(`Layer ${l.nm} (ind ${l.ind}), hd: ${l.hd}, ty: ${l.ty}, opacity: ${l.ks?.o?.k}`);
        }
    });

    console.log('\n--- Exported Layers ---');
    exportedJson.layers.forEach(l => {
        if (l.nm.includes('214722124') || l.nm.includes('Group') || l.nm.includes('Rectangle')) {
            console.log(`Layer ${l.nm} (ind ${l.ind}), hd: ${l.hd}, ty: ${l.ty}, opacity: ${l.ks?.o?.k}`);
        }
    });

    // Check specific layer in exported
    const targetLayer = exportedJson.layers.find(l => l.nm === 'Group 2147221241 1' || l.nm === 'Group 2147221240');
    if (targetLayer) {
        console.log('\nFound Target Layer in Exported:', targetLayer.nm);
        console.log(JSON.stringify(targetLayer, null, 2));
    }
}

checkMissingGroups().catch(console.error);
