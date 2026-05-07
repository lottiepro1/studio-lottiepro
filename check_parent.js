const fs = require('fs');
const content = fs.readFileSync('C:\\Users\\iamah\\Downloads\\test\\online_shopping.json', 'utf8');
const json = JSON.parse(content);
const layer = json.layers.find(l => l.ind === 19);
console.log('Layer 137 parent:', layer.parent);
const parent = json.layers.find(l => l.ind === layer.parent);
console.log('Parent Layer:', parent ? parent.nm : 'NotFound');
