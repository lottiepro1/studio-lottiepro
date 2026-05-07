const fs = require('fs');
const path = 'C:\\Users\\iamah\\Downloads\\test\\shopping_basket.json';
const json = JSON.parse(fs.readFileSync(path, 'utf8'));

const outlinerLayers = json.layers.filter(l => ['Layer 54', 'Layer 53', 'Layer 52', 'Layer 51', 'Layer 41', 'Layer 42', 'Layer 43', 'Layer 44', 'Layer 45', 'Layer 46', 'Layer 47'].includes(l.nm));
console.log('Outliner Layers:', JSON.stringify(outlinerLayers.map(l => ({ nm: l.nm, ind: l.ind, parent: l.parent })), null, 2));
