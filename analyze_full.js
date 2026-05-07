const fs = require('fs');
const animation = JSON.parse(fs.readFileSync('src/assets/animation.json', 'utf8'));

// Minimal implementation of SceneNode creation
function analyze() {
    console.log('Main Artboard Layers:');
    animation.layers.forEach(l => {
        console.log(`[${l.ind}] nm: ${l.nm}, ty: ${l.ty}, parent: ${l.parent}, tt: ${l.tt}, tp: ${l.tp}`);
    });

    console.log('\nAssets:');
    animation.assets.forEach(a => {
        if (a.layers) {
            console.log(`\nAsset ID: ${a.id} (${a.layers.length} layers)`);
            a.layers.forEach(l => {
                console.log(`  [${l.ind}] nm: ${l.nm}, ty: ${l.ty}, parent: ${l.parent}, tt: ${l.tt}, tp: ${l.tp}`);
            });
        }
    });
}

analyze();
