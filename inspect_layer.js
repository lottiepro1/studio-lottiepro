const fs = require('fs');
const content = fs.readFileSync('C:\\Users\\iamah\\Downloads\\test\\online_shopping.json', 'utf8');
const json = JSON.parse(content);

// Search in main layers
let layer = json.layers.find(l => l.ind === 137);

// If not found, search in assets
if (!layer && json.assets) {
    for (const asset of json.assets) {
        if (asset.layers) {
            layer = asset.layers.find(l => l.ind === 137);
            if (layer) break;
        }
    }
}

if (layer) {
    console.log(`Layer 137 found: ${layer.nm}`);
    if (layer.shapes) {
        console.log('\n--- SHAPES ---');
        layer.shapes.forEach((s, i) => {
            console.log(`Shape ${i}: ty=${s.ty} nm=${s.nm}`);
            if (s.it) {
                s.it.forEach((it, j) => {
                    console.log(`  Item ${j}: ty=${it.ty} nm=${it.nm || ''}`);
                    if (it.ty === 'gr' && it.it) {
                        it.it.forEach((sub, k) => {
                            console.log(`    SubItem ${k}: ty=${sub.ty} nm=${sub.nm || ''}`);
                            if (sub.ty === 'st') {
                                console.log(`      Found Stroke: width=${JSON.stringify(sub.w)} color=${JSON.stringify(sub.c)}`);
                            }
                        });
                    }
                    if (it.ty === 'st') {
                        console.log(`    Found Stroke: width=${JSON.stringify(it.w)} color=${JSON.stringify(it.c)}`);
                    }
                });
            }
            if (s.ty === 'st') {
                console.log(`  Found Stroke: width=${JSON.stringify(s.w)} color=${JSON.stringify(s.c)}`);
            }
        });
    }
} else {
    console.log('Layer 137 not found');
}
