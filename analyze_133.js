const fs = require('fs');
const path = 'C:\\Users\\iamah\\Downloads\\test\\online_shopping.json';
const json = JSON.parse(fs.readFileSync(path, 'utf8'));

const l133 = json.layers.find(l => l.nm === 'Layer 133' || l.ind === 15);
console.log('Layer 133 shapes structure:');
l133.shapes.forEach(g => {
    if (g.ty === 'gr') {
        processGroup(g, '');
    }
});

function processGroup(g, indent) {
    console.log(indent + 'Group nm:', g.nm);
    if (g.it) {
        g.it.forEach(it => {
            if (it.ty === 'gr') processGroup(it, indent + '  ');
            else console.log(indent + '  Item ty:', it.ty, 'nm:', it.nm);
        });
    }
}
