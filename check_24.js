const fs = require('fs');
const path = 'C:\\Users\\iamah\\Downloads\\test\\edc_machine.json';
const json = JSON.parse(fs.readFileSync(path, 'utf8'));

const layer24 = json.layers.find(l => l.nm === 'edc_machine' || l.ind === 24);
console.log('Layer 24:', JSON.stringify(layer24, null, 2));
