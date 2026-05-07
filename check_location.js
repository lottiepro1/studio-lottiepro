const fs = require('fs');
const content = fs.readFileSync('C:\\Users\\iamah\\Downloads\\test\\online_shopping.json', 'utf8');
const json = JSON.parse(content);

function findLayer(layers, ind) {
    return layers.find(l => l.ind === ind);
}

let layer = findLayer(json.layers, 19);
if (layer) {
    console.log('Layer 137 is in main composition');
} else {
    for (const asset of (json.assets || [])) {
        layer = findLayer(asset.layers || [], 19);
        if (layer) {
            console.log(`Layer 137 is in asset ${asset.id} (${asset.nm})`);
            break;
        }
    }
}
