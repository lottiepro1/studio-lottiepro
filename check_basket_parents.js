const fs = require('fs');
const path = 'C:\\Users\\iamah\\Downloads\\test\\shopping_basket.json';
const json = JSON.parse(fs.readFileSync(path, 'utf8'));

const p23 = json.layers.find(l => l.ind === 23);
const p24 = json.layers.find(l => l.ind === 24);

console.log('Parent 23:', p23 ? { nm: p23.nm, ty: p23.ty, st: p23.st, ip: p23.ip, op: p23.op } : 'Not found');
console.log('Parent 24:', p24 ? { nm: p24.nm, ty: p24.ty, st: p24.st, ip: p24.ip, op: p24.op } : 'Not found');
