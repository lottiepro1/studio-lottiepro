const JSZip = require('./node_modules/jszip');
const fs = require('fs');

async function checkKeys() {
    const originalPath = 'C:\\Users\\iamah\\Downloads\\Interactive test.lottie';
    const data = fs.readFileSync(originalPath);
    const zip = await JSZip.loadAsync(data);
    const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
    const animPath = manifest.animations[0].id ? `a/${manifest.animations[0].id}.json` : 'animations/data.json';
    const json = JSON.parse(await zip.file(animPath).async('string'));

    const layerWithMasks = json.layers.find(l => l.masks || l.masksProperties);
    if (layerWithMasks) {
        console.log(`Layer ${layerWithMasks.nm} has masks!`);
        console.log('Keys:', Object.keys(layerWithMasks));
        if (layerWithMasks.masks) console.log('Key "masks" exists');
        if (layerWithMasks.masksProperties) console.log('Key "masksProperties" exists');
    } else {
        console.log('No layer with masks found in original file.');
    }
}

checkKeys().catch(console.error);
