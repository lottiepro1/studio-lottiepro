const fs = require('fs');

const origPath = 'D:\\Arkam\\LottiePro\\For Upload\\50. Postcard Designs\\08- Animated Landmarks in Spain\\JSON\\la_sagrada_familia_barcelona.json';
const expPath = 'C:\\Users\\iamah\\Downloads\\la_sagrada_familia_barcelona.json';

try {
  const orig = JSON.parse(fs.readFileSync(origPath, 'utf-8'));
  const exp = JSON.parse(fs.readFileSync(expPath, 'utf-8'));

  const analyzeLayers = (name, data) => {
    console.log(`\n--- ${name} Layers ---`);
    data.layers.forEach((l, i) => {
      let typeStr = '';
      if (l.td) typeStr += ` MatteSource(td:${l.td})`;
      if (l.tt) typeStr += ` Matted(tt:${l.tt})`;
      if (l.tp) typeStr += ` MatteParent(tp:${l.tp})`;
      if (l.parent) typeStr += ` Parent(parent:${l.parent})`;
      
      console.log(`[ind: ${l.ind}] nm: "${l.nm}" ty: ${l.ty} hd: ${l.hd} |${typeStr}`);
    });
  };

  analyzeLayers('Original', orig);
  analyzeLayers('Exported', exp);

} catch(err) {
  console.error("Error reading or processing files:", err);
}
