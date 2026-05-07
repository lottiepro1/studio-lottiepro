const fs = require('fs');
const content = fs.readFileSync('C:\\Users\\iamah\\Downloads\\test\\online_shopping.json', 'utf8');
const json = JSON.parse(content);
const layer = json.layers.find(l => l.ind === 19);
const stroke = layer.shapes.find(s => s.ty === 'st' || (s.it && s.it.find(it => it.ty === 'st')));
// Actually I'll find it recursively
function findStroke(items) {
    for (const it of items) {
        if (it.ty === 'st') return it;
        if (it.it) {
            const res = findStroke(it.it);
            if (res) return res;
        }
    }
}
const st = findStroke(layer.shapes);
console.log('STROKE:', JSON.stringify(st, null, 2));
