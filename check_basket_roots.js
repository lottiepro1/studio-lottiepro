const fs = require('fs');
const path = 'C:\\Users\\iamah\\Downloads\\test\\shopping_basket.json';
const json = JSON.parse(fs.readFileSync(path, 'utf8'));

const l11 = json.layers.find(l => l.ind === 11);
const l20 = json.layers.find(l => l.ind === 20);

console.log('Layer 11:', l11 ? { nm: l11.nm, ind: l11.ind, parent: l11.parent } : 'Not found');
console.log('Layer 20:', l20 ? { nm: l20.nm, ind: l20.ind, parent: l20.parent } : 'Not found');
