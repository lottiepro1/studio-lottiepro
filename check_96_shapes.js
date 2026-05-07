const fs = require('fs');
const path = 'C:\\Users\\iamah\\Downloads\\test\\edc_machine.json';
const json = JSON.parse(fs.readFileSync(path, 'utf8'));

const layer96 = json.layers.find(l => l.ind === 11); // Layer 96 ind is 11? No, 11 is index in array? 
// Actually, check_order.js said Layer 96 ind: 11? i: 9.
// Index 11 is Layer 98.
// Index 9 is Layer 96.
const layer96_def = json.layers[9];
console.log('Layer 96 Shapes Summary:');
layer96_def.shapes.forEach(s => {
    console.log('Shape ty:', s.ty, 'nm:', s.nm);
    if (s.it) {
        s.it.forEach(it => {
            console.log('  Item ty:', it.ty, 'nm:', it.nm);
            if (it.ty === 'tr') console.log('    Transform p:', it.p.k, 'a:', it.a.k);
        });
    }
});
