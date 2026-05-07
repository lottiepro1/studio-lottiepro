const fs = require('fs');
const path = 'C:\\Users\\iamah\\Downloads\\test\\shopping_basket.json';
const json = JSON.parse(fs.readFileSync(path, 'utf8'));

const relevantIndices = [45, 46];
const layers = json.layers.filter(l => l.ind === 45 || l.ind === 46 || l.nm === 'Layer 45' || l.nm === 'Layer 46');

console.log('Layers 45 & 46:', JSON.stringify(layers.map(l => ({
    nm: l.nm,
    ind: l.ind,
    ty: l.ty,
    parent: l.parent
})), null, 2));
