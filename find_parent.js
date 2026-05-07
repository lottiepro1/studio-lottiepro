const fs = require('fs');
const json = JSON.parse(fs.readFileSync('C:\\Users\\iamah\\Downloads\\test\\online_shopping.json', 'utf8'));

const parentLayer = json.layers.find(l => l.ind === 15);

if (parentLayer) {
    console.log("Parent Layer (ind: 15):", parentLayer.nm, "Type:", parentLayer.ty);
    if (parentLayer.ty === 4 && parentLayer.shapes) {
        console.log("Shapes in parent layer:", JSON.stringify(parentLayer.shapes, null, 2));
    }
} else {
    console.log("Parent layer not found.");
}
