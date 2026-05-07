const fs = require('fs');

const origPath = 'D:\\Arkam\\LottiePro\\For Upload\\50. Postcard Designs\\08- Animated Landmarks in Spain\\JSON\\la_sagrada_familia_barcelona.json';
const expPath = 'C:\\Users\\iamah\\Downloads\\la_sagrada_familia_barcelona.json';

try {
  const origRaw = fs.readFileSync(origPath, 'utf-8');
  const expRaw = fs.readFileSync(expPath, 'utf-8');

  console.log(`Original file length: ${origRaw.length}`);
  console.log(`Exported file length: ${expRaw.length}`);

  const orig = JSON.parse(origRaw);
  const exp = JSON.parse(expRaw);

  const compareKeys = (name, obj1, obj2) => {
    if (!obj1 || !obj2) return;
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);

    const missingInExpl = keys1.filter(k => !keys2.includes(k));
    const extraInExpl = keys2.filter(k => !keys1.includes(k));

    if (missingInExpl.length > 0) console.log(`[${name}] Missing in export: ${missingInExpl.join(', ')}`);
    if (extraInExpl.length > 0) console.log(`[${name}] Extra in export: ${extraInExpl.join(', ')}`);
  };

  console.log('--- Root Keys Check ---');
  compareKeys('Root', orig, exp);

  // Compare version, fr, ip, op, w, h
  console.log('\n--- Root Values Check ---');
  ['v', 'fr', 'ip', 'op', 'w', 'h'].forEach(k => {
    if (orig[k] !== exp[k]) {
      console.log(`Mismatch ${k}: original=${orig[k]}, exported=${exp[k]}`);
    }
  });

  // Compare layers length
  console.log('\n--- Layers Length Check ---');
  if (orig.layers && exp.layers) {
    console.log(`Original layers: ${orig.layers.length}`);
    console.log(`Exported layers: ${exp.layers.length}`);

    // If counts are different or same, check layer types
    const origTypes = orig.layers.map(l => l.ty).slice(0, 10);
    const expTypes = exp.layers.map(l => l.ty).slice(0, 10);
    console.log(`Top 10 Original Layer types: ${origTypes.join(', ')}`);
    console.log(`Top 10 Exported Layer types: ${expTypes.join(', ')}`);

    // Let's check the first layer's structure differences
    if (orig.layers[0] && exp.layers[0]) {
      console.log('\n--- First Layer Difference Check ---');
      compareKeys('Layer 0', orig.layers[0], exp.layers[0]);
      console.log('Original Layer 0 preview:', JSON.stringify(orig.layers[0]).substring(0, 200));
      console.log('Exported Layer 0 preview:', JSON.stringify(exp.layers[0]).substring(0, 200));
    }
  } else {
    if (!orig.layers) console.log('Original is missing layers array');
    if (!exp.layers) console.log('Export is missing layers array');
  }

  // Compare assets length
  console.log('\n--- Assets Length Check ---');
  if (orig.assets && exp.assets) {
    console.log(`Original assets: ${orig.assets.length}`);
    console.log(`Exported assets: ${exp.assets.length}`);
  }

} catch(err) {
  console.error("Error reading or processing files:", err);
}
