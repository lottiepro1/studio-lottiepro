const fs = require('fs');
const data = JSON.parse(fs.readFileSync('C:/Users/iamah/Downloads/test/Hold to Delete Interaction.json', 'utf8'));

const l7 = data.layers.find(l => l.ind === 7);
const l10 = data.layers.find(l => l.ind === 10);

let out = "Layer 7 Transform:\n" + JSON.stringify(l7.ks, null, 2) + "\n\n";
out += "Layer 10 Transform:\n" + JSON.stringify(l10.ks, null, 2) + "\n";
fs.writeFileSync('transforms_utf8.txt', out, 'utf8');
