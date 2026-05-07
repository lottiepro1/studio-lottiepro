const fs = require('fs');
const path = 'C:\\Users\\iamah\\Downloads\\test\\edc_machine.json';
const json = JSON.parse(fs.readFileSync(path, 'utf8'));

const layer99 = json.layers.find(l => l.nm === 'Layer 99' || l.ind === 14);
console.log('Layer 99 Shapes Ty:', layer99.shapes.map(s => s.ty));
if (layer99.shapes.length > 0) {
    const last = layer99.shapes[layer99.shapes.length - 1];
    if (last.ty === 'tr') {
        console.log('Top-level Transform found at end of shapes array!');
        console.log('tr.p:', last.p.k, 'tr.a:', last.a.k);
    }
}
