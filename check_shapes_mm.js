const JSZip = require('./node_modules/jszip');
const fs = require('fs');

async function checkShapes() {
    const originalPath = 'C:\\Users\\iamah\\Downloads\\Interactive test.lottie';
    const data = fs.readFileSync(originalPath);
    const zip = await JSZip.loadAsync(data);
    const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
    const animPath = manifest.animations[0].id ? `a/${manifest.animations[0].id}.json` : 'animations/data.json';
    const json = JSON.parse(await zip.file(animPath).async('string'));

    let foundMM = false;
    const findMM = (shapes) => {
        if (!shapes) return;
        shapes.forEach(s => {
            if (s.ty === 'mm') {
                foundMM = true;
                console.log(`Found mm (Merge Mode) in shape ${s.nm}, mode=${s.mm}`);
            }
            if (s.it) findMM(s.it);
        });
    }

    json.layers.forEach(l => {
        findMM(l.shapes);
    });

    if (!foundMM) console.log('No Merge Paths (Boolean Ops) found in original shapes.');
}

checkShapes().catch(console.error);
