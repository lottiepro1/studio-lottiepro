const fs = require('fs');

const origPath = 'D:\\Arkam\\LottiePro\\For Upload\\50. Postcard Designs\\08- Animated Landmarks in Spain\\JSON\\la_sagrada_familia_barcelona.json';
const expPath = 'C:\\Users\\iamah\\Downloads\\la_sagrada_familia_barcelona.json';

try {
  const orig = JSON.parse(fs.readFileSync(origPath, 'utf-8'));
  const exp = JSON.parse(fs.readFileSync(expPath, 'utf-8'));

  // Utility to find a layer by name
  const origLayer = orig.layers.find(l => l.nm === 'mask 5');
  const expLayer = exp.layers.find(l => l.nm === 'mask 5');

  console.log('Comparing layer "mask 5" shapes...');
  
  if (origLayer.shapes) console.log(`Orig shapes count: ${origLayer.shapes.length}`);
  else console.log('Orig has no shapes array');

  if (expLayer.shapes) console.log(`Exp shapes count: ${expLayer.shapes.length}`);
  else console.log('Exp has no shapes array');

  console.log('\n--- Original shapes structure ---');
  if (origLayer.shapes) {
      origLayer.shapes.forEach((s, idx) => {
          console.log(`Shape ${idx}: type ${s.ty}, name ${s.nm}`);
          if (s.it) {
              console.log(`  Items: ${s.it.length}`);
              s.it.forEach((i, idx2) => {
                  console.log(`    Item ${idx2}: type ${i.ty}, name ${i.nm}`);
                  if (i.ty === 'sh') {
                      console.log('    Path point keys: ', i.ks?.k ? Object.keys(i.ks.k) : null);
                      if (Array.isArray(i.ks?.k) && i.ks.k.length > 0 && i.ks.k[0].s) {
                          console.log('      Animated Path Keys: ', Object.keys(i.ks.k[0].s[0]));
                      }
                  }
              });
          }
      });
  }

  console.log('\n--- Exported shapes structure ---');
  if (expLayer.shapes) {
      expLayer.shapes.forEach((s, idx) => {
          console.log(`Shape ${idx}: type ${s.ty}, name ${s.nm}`);
          if (s.it) {
              console.log(`  Items: ${s.it.length}`);
              s.it.forEach((i, idx2) => {
                  console.log(`    Item ${idx2}: type ${i.ty}, name ${i.nm}`);
                  if (i.ty === 'sh') {
                      console.log('    Path point keys: ', i.ks?.k ? Object.keys(i.ks.k) : null);
                      if (Array.isArray(i.ks?.k) && i.ks.k.length > 0 && i.ks.k[0].s) {
                          console.log('      Animated Path Keys: ', Object.keys(i.ks.k[0].s[0]));
                      }
                  }
              });
          }
      });
  }

} catch(err) {
  console.error("Error reading or processing files:", err);
}
