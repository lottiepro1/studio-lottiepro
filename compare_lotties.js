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

    console.log('Original Manifest:', JSON.stringify(originalManifest));
    console.log('Exported Manifest:', JSON.stringify(exportedManifest));

    // Guessing paths based on manifest
    const originalAnimPath = originalManifest.animations[0].id ? `a/${originalManifest.animations[0].id}.json` : 'animations/data.json';
    const exportedAnimPath = `a/${exportedManifest.animations[0].id}.json`;

    console.log('Original Anim Path:', originalAnimPath);
    console.log('Exported Anim Path:', exportedAnimPath);

    const originalJson = JSON.parse(await originalZip.file(originalAnimPath).async('string'));
    const exportedJson = JSON.parse(await exportedZip.file(exportedAnimPath).async('string'));

    console.log('--- Summary ---');
    console.log('Original Layers Count:', originalJson.layers.length);
    console.log('Exported Layers Count:', exportedJson.layers.length);

    // List top 10 layers ty and names
    console.log('\n--- Original Top 10 Layers ---');
    originalJson.layers.slice(0, 10).forEach((l, i) => {
        console.log(`${i}: nm=${l.nm}, ty=${l.ty}, hd=${l.hd}, bm=${l.bm}, td=${l.td}, tt=${l.tt}`);
    });

    console.log('\n--- Exported Top 10 Layers ---');
    exportedJson.layers.slice(0, 10).forEach((l, i) => {
        console.log(`${i}: nm=${l.nm}, ty=${l.ty}, hd=${l.hd}, bm=${l.bm}, td=${l.td}, tt=${l.tt}`);
    });

    // Check for hd=1 mismatch
    const originalHidden = originalJson.layers.filter(l => l.hd === 1).length;
    const exportedHidden = exportedJson.layers.filter(l => l.hd === 1).length;
    console.log(`\nHidden Layers - Original: ${originalHidden}, Exported: ${exportedHidden}`);

    // Check for td/tt (Track Mattes)
    const originalMattes = originalJson.layers.filter(l => l.td || l.tt).length;
    const exportedMattes = exportedJson.layers.filter(l => l.td || l.tt).length;
    console.log(`Matte Layers - Original: ${originalMattes}, Exported: ${exportedMattes}`);
}

compare().catch(console.error);
