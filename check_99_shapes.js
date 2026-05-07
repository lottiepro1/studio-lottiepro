const fs = require('fs');
const path = 'C:\\Users\\iamah\\Downloads\\test\\edc_machine.json';
const json = JSON.parse(fs.readFileSync(path, 'utf8'));

const layer99 = json.layers.find(l => l.nm === 'Layer 99' || l.ind === 14);
console.log('Layer 99 Group Details:');
layer99.shapes.forEach(g => {
    if (g.ty === 'gr') {
        console.log('Group nm:', g.nm);
        const tr = g.it.find(it => it.ty === 'tr');
        if (tr) console.log('  Transform p:', tr.p.k, 'a:', tr.a.k);
    }
});
