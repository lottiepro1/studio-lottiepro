const fs = require('fs');
const path = 'C:\\Users\\iamah\\Downloads\\test\\edc_machine.json';
const json = JSON.parse(fs.readFileSync(path, 'utf8'));

console.log('Artboard Size:', json.w, 'x', json.h);
console.log('FPS:', json.fr);
console.log('Out Point:', json.op);
