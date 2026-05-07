const fs = require('fs');
const path = 'C:\\Users\\iamah\\Downloads\\test\\online_shopping.json';
const json = JSON.parse(fs.readFileSync(path, 'utf8'));

console.log('Layer list:', json.layers.map(l => ({ nm: l.nm, ind: l.ind, ty: l.ty })));
const l133 = json.layers.find(l => l.nm === 'Layer 133');
console.log('Layer 133 refId:', l133 ? (l133 as any).refId : 'Not found');
