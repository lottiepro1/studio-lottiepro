const JSZip = require('./node_modules/jszip');
const fs = require('fs');

async function checkMattes() {
    const originalPath = 'C:\\Users\\iamah\\Downloads\\Interactive test.lottie';
    const data = fs.readFileSync(originalPath);
    const zip = await JSZip.loadAsync(data);
    const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
    const animPath = manifest.animations[0].id ? `a/${manifest.animations[0].id}.json` : 'animations/data.json';
    const json = JSON.parse(await zip.file(animPath).async('string'));

    const mattes = json.layers.filter(l => l.td || l.tt);
    console.log(`Found ${mattes.length} matte-related layers`);
    mattes.forEach(l => {
        console.log(`Layer: nm=${l.nm}, ind=${l.ind}, td=${l.td}, tt=${l.tt}, hd=${l.hd}`);
    });
}

checkMattes().catch(console.error);
