const fs = require('fs');
const path = 'C:\\Users\\iamah\\Downloads\\test\\edc_machine.json';
const json = JSON.parse(fs.readFileSync(path, 'utf8'));

const layersWithChildren = new Set();
json.layers.forEach(l => {
    if (l.parent !== undefined) {
        layersWithChildren.add(l.parent);
    }
});

console.log('Layers that are parents (by ind):', Array.from(layersWithChildren).sort((a, b) => a - b));

const layer99 = json.layers.find(l => l.ind === 14);
console.log('Layer 99 (ind 14) has children?', layersWithChildren.has(14));

const parent3 = json.layers.find(l => l.parent === 14);
console.log('Sample child of 14:', parent3 ? parent3.nm : 'None');
