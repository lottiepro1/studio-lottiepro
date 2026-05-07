const fs = require('fs');
const content = fs.readFileSync('C:\\Users\\iamah\\Downloads\\test\\online_shopping.json', 'utf8');
const json = JSON.parse(content);

function findLayersByNm(layers, nm, res = []) {
    layers.forEach(l => {
        if (l.nm === nm) res.push(l);
        if (l.ty === 0 && l.refId) {
            const asset = json.assets.find(a => a.id === l.refId);
            if (asset && asset.layers) {
                findLayersByNm(asset.layers, nm, res);
            }
        }
    });
    return res;
}

const targets = findLayersByNm(json.layers, 'Layer 137');
console.log(`Found ${targets.length} layers named "Layer 137"`);
targets.forEach(t => {
    console.log(`Layer: ind=${t.ind} parent=${t.parent} shapes=${t.shapes ? t.shapes.length : 0}`);
    if (t.shapes) {
        t.shapes.forEach((s, i) => console.log(`  Shape ${i}: ty=${s.ty} nm=${s.nm}`));
    }
});
