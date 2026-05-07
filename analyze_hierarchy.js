const fs = require('fs');
const data = JSON.parse(fs.readFileSync('C:/Users/iamah/Downloads/test/Hold to Delete Interaction.json', 'utf8'));

let output = "--- Animation Info ---\n";
output += `Layers: ${data.layers.length}\n`;
data.layers.forEach(l => {
    output += `Layer [${l.ind}] nm: ${l.nm}, ty: ${l.ty}, refId: ${l.refId}, parent: ${l.parent}, tt: ${l.tt}, td: ${l.td}, tp: ${l.tp}\n`;
});

if (data.assets) {
    output += "\n--- Assets ---\n";
    data.assets.forEach(a => {
        output += `Asset id: ${a.id}, nm: ${a.nm}, layers: ${a.layers ? a.layers.length : 0}\n`;
        if (a.layers) {
            a.layers.forEach(l => {
                output += `  Layer [${l.ind}] nm: ${l.nm}, ty: ${l.ty}, refId: ${l.refId}, parent: ${l.parent}, tt: ${l.tt}, td: ${l.td}, tp: ${l.tp}\n`;
            });
        }
    });
}
fs.writeFileSync('hierarchy_utf8.txt', output, 'utf8');
