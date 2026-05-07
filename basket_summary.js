const fs = require('fs');
const path = 'C:\\Users\\iamah\\Downloads\\test\\shopping_basket.json';
const json = JSON.parse(fs.readFileSync(path, 'utf8'));

const summary = json.layers.map(l => ({ nm: l.nm, ind: l.ind, parent: l.parent }));
console.log('Layer Summary:', JSON.stringify(summary, null, 2));
