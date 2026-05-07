const JSZip = require('./node_modules/jszip');
const fs = require('fs');

async function inspectGroupDetails() {
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
        console.log(`\n\n=== ${name} ===`);
        const origL = findLayer(originalJson, name);
        const expL = findLayer(exportedJson, name);

        console.log('\nOriginal Structure:');
        printStructure(origL.shapes);
        console.log('\nExported Structure:');
        printStructure(expL.shapes);
    }
}

function printStructure(shapes, depth = 0) {
    if (!shapes) return;
    shapes.forEach(s => {
        let info = `Type: ${s.ty}, Name: ${s.nm}`;
        if (s.ty === 'mm') info += `, Mode: ${s.mm}`;
        if (s.ty === 'fl') info += `, Color: ${JSON.stringify(s.c?.k)}`;
        if (s.ty === 'tr') {
            info += `, Opacity: ${typeof s.o?.k === 'number' ? s.o.k : JSON.stringify(s.o?.k)}`;
        }
        console.log('  '.repeat(depth) + info);
        if (s.it) printStructure(s.it, depth + 1);
    });
}

inspectGroupDetails().catch(console.error);
