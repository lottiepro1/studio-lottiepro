const fs = require('fs');
const json = JSON.parse(fs.readFileSync('C:\\Users\\iamah\\Downloads\\test\\online_shopping.json', 'utf8'));

const layer = json.layers.find(l => l.nm === 'Layer 133' || l.ind === 133);

if (layer) {
    fs.writeFileSync('layer_133.json', JSON.stringify(layer, null, 2));
    console.log("Written Layer 133 to layer_133.json");
} else {
    console.log("Layer 133 not found. Listing layers:");
    console.log(json.layers.map(l => ({ nm: l.nm, ind: l.ind })));
}
