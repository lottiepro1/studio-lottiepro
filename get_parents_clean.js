const fs = require('fs');
const path = 'C:\\Users\\iamah\\Downloads\\test\\edc_machine.json';
const json = JSON.parse(fs.readFileSync(path, 'utf8'));

const relevantLayers = json.layers.filter(l => l.ind === 14 || l.ind === 15).map(l => ({
    nm: l.nm,
    ind: l.ind,
    parent: l.parent,
    ty: l.ty,
    st: l.st,
    ip: l.ip,
    op: l.op,
    p: l.ks.p.k,
    a: l.ks.a.k,
    r: l.ks.r.k,
    s: l.ks.s.k,
    o: l.ks.o.k
}));
console.log('Relevant Layers Clean:', JSON.stringify(relevantLayers, null, 2));
