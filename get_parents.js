const fs = require('fs');
const path = 'C:\\Users\\iamah\\Downloads\\test\\edc_machine.json';
const json = JSON.parse(fs.readFileSync(path, 'utf8'));

const relevantLayers = json.layers.filter(l => l.ind === 14 || l.ind === 15);
console.log('Relevant Layers:', JSON.stringify(relevantLayers, null, 2));
