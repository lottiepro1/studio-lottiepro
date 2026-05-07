const fs = require('fs');
const content = fs.readFileSync('C:\\Users\\iamah\\Downloads\\test\\online_shopping.json', 'utf8');
const json = JSON.parse(content);

let layer = json.layers.find(l => l.ind === 19);
if (!layer && json.assets) {
    for (const asset of json.assets) {
        if (asset.layers) {
            layer = asset.layers.find(l => l.ind === 19);
            if (layer) break;
        }
    }
}

if (layer) {
    console.log(`\nLayer found: ind=${layer.ind} nm=${layer.nm}`);
    if (layer.shapes) {
        function printShapes(shapes, prefix = '') {
            shapes.forEach((s, i) => {
                console.log(`${prefix}Shape ${i}: ty=${s.ty} nm=${s.nm || ''}`);
                if (s.ty === 'st' || s.ty === 'gs') {
                    console.log(`${prefix}  Found STROKE: ty=${s.ty} width=${JSON.stringify(s.w)} color=${JSON.stringify(s.c)}`);
                }
                if (s.it) {
                    printShapes(s.it, prefix + '  ');
                }
            });
        }
        printShapes(layer.shapes);
    }
} else {
    console.log('Layer with ind 19 not found');
}
