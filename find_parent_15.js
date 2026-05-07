const fs = require('fs');
const path = 'C:\\Users\\iamah\\Downloads\\test\\edc_machine.json';
const json = JSON.parse(fs.readFileSync(path, 'utf8'));

const layer15 = json.layers.find(l => l.ind === 15);
console.log('Layer 15:', JSON.stringify(layer15, null, 2));
