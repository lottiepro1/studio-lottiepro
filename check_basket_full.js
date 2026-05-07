const fs = require('fs');
const path = 'C:\\Users\\iamah\\Downloads\\test\\shopping_basket.json';
const json = JSON.parse(fs.readFileSync(path, 'utf8'));

const l25 = json.layers.find(l => l.ind === 25);
const l26 = json.layers.find(l => l.ind === 26);

console.log('Layer 25 (45):', JSON.stringify(l25, (key, value) => (key === 'shapes' ? undefined : value), 2));
console.log('Layer 26 (46):', JSON.stringify(l26, (key, value) => (key === 'shapes' ? undefined : value), 2));
