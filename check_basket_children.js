const fs = require('fs');
const path = 'C:\\Users\\iamah\\Downloads\\test\\shopping_basket.json';
const json = JSON.parse(fs.readFileSync(path, 'utf8'));

const childrenOf24 = json.layers.filter(l => l.parent === 24);
console.log('Children of Layer 44 (ind 24):', JSON.stringify(childrenOf24.map(l => ({ nm: l.nm, ind: l.ind, ty: l.ty })), null, 2));

const childrenOf23 = json.layers.filter(l => l.parent === 23);
console.log('Children of Layer 43 (ind 23):', JSON.stringify(childrenOf23.map(l => ({ nm: l.nm, ind: l.ind, ty: l.ty })), null, 2));
