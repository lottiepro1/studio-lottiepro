const fs = require('fs');
const path = 'C:\\Users\\iamah\\Downloads\\test\\edc_machine.json';
const json = JSON.parse(fs.readFileSync(path, 'utf8'));

const matteLayers = json.layers.filter(l => l.tt !== undefined && l.tt !== 0);
console.log('Matte Layers:', matteLayers.map(l => ({ nm: l.nm, tt: l.tt, ind: l.ind, td: l.td })));
