const JSZip = require('./node_modules/jszip');
const fs = require('fs');

async function checkClicker() {
    const exportedPath = 'C:\\Users\\iamah\\Downloads\\interactive newww.lottie';
    const data = fs.readFileSync(exportedPath);
    const zip = await JSZip.loadAsync(data);
    const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
    const animPath = `a/${manifest.animations[0].id}.json`;
    const json = JSON.parse(await zip.file(animPath).async('string'));

    const clicker = json.layers.find(l => l.nm === 'clicker' || l.nm === 'Clicker');
    if (!clicker) {
        console.log('No clicker layer found');
        return;
    }

    console.log('Clicker Layer structure:');
    console.log('Visibility (hd):', clicker.hd);
    console.log('Opacity (ks.o):', JSON.stringify(clicker.ks?.o?.k));

    const printShapes = (shapes, depth = 0) => {
        if (!shapes) return;
        shapes.forEach(s => {
            console.log('  '.repeat(depth) + `Type: ${s.ty}, Name: ${s.nm}, Visibility (hd): ${s.hd}`);
            if (s.it) printShapes(s.it, depth + 1);
        });
    }
    printShapes(clicker.shapes);
}

checkClicker().catch(console.error);
