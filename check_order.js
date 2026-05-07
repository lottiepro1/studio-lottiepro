const fs = require('fs');
const path = 'C:\\Users\\iamah\\Downloads\\test\\edc_machine.json';
const json = JSON.parse(fs.readFileSync(path, 'utf8'));

const indices = json.layers.map((l, i) => ({ i, ind: l.ind, nm: l.nm, parent: l.parent }));
console.log('Layer Order:', JSON.stringify(indices, null, 2));
