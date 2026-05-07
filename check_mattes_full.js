const JSZip = require('./node_modules/jszip');
const fs = require('fs');

async function checkMattes() {
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

    console.log('--- Original Mattes ---');
    originalJson.layers.forEach(l => {
        if (l.tt) console.log(`Layer ${l.nm} (ind ${l.ind}) has matte type ${l.tt} from parent ${l.tp}`);
        if (l.td) console.log(`Layer ${l.nm} (ind ${l.ind}) is a matte source (td: 1)`);
    });

    console.log('\n--- Exported Mattes ---');
    exportedJson.layers.forEach(l => {
        if (l.tt) console.log(`Layer ${l.nm} (ind ${l.ind}) has matte type ${l.tt} from parent ${l.tp}`);
        if (l.td) console.log(`Layer ${l.nm} (ind ${l.ind}) is a matte source (td: 1)`);
    });
}

checkMattes().catch(console.error);
