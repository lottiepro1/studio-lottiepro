const fs = require('fs');
const content = fs.readFileSync('C:\\Users\\iamah\\Downloads\\test\\online_shopping.json', 'utf8');
const json = JSON.parse(content);

function scan(layers, prefix = '') {
    layers.forEach(l => {
        console.log(`${prefix}Layer: ind=${l.ind} nm=${l.nm} ty=${l.ty}`);
        if (l.ty === 0 && l.refId) {
            const asset = json.assets.find(a => a.id === l.refId);
            if (asset && asset.layers) {
                scan(asset.layers, prefix + '  ');
            }
        }
    });
}

scan(json.layers);
