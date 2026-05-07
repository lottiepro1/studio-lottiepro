const fs = require('fs');
const path = 'C:\\Users\\iamah\\Downloads\\test\\edc_machine.json';
const json = JSON.parse(fs.readFileSync(path, 'utf8'));

// Find Layer 99
const layer99 = json.layers.find(l => l.nm === 'Layer 99' || l.ind === 99);
const childrenOf99 = json.layers.filter(l => l.parent === 99 || (layer99 && l.parent === layer99.ind));

const report = {
    layer99: layer99,
    childrenCount: childrenOf99.length,
    children: childrenOf99.map(l => ({ nm: l.nm, ind: l.ind, parent: l.parent, ks: l.ks }))
};

fs.writeFileSync('edc_debug.json', JSON.stringify(report, null, 2));
console.log('Debug info written to edc_debug.json');
