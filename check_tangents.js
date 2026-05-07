const fs = require('fs');
const path = 'C:\\Users\\iamah\\Downloads\\test\\edc_machine.json';
const json = JSON.parse(fs.readFileSync(path, 'utf8'));

const layer99 = json.layers.find(l => l.nm === 'Layer 99' || l.ind === 14);
const kf46 = layer99.ks.p.k.find(k => k.t === 46);
console.log('KF 46:', JSON.stringify(kf46, null, 2));
const kf55 = layer99.ks.p.k.find(k => k.t === 55);
console.log('KF 55:', JSON.stringify(kf55, null, 2));
