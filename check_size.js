const fs = require('fs');

function checkSize() {
    const original = 'C:\\Users\\iamah\\Downloads\\Main Scene.lottie';
    const exported = 'C:\\Users\\iamah\\Downloads\\newww.lottie';

    if (fs.existsSync(original)) {
        console.log(`Original Size: ${(fs.statSync(original).size / 1024).toFixed(2)} KB`);
    } else {
        console.log('Original not found');
    }

    if (fs.existsSync(exported)) {
        console.log(`Exported Size: ${(fs.statSync(exported).size / 1024).toFixed(2)} KB`);
    } else {
        console.log('Exported not found');
    }
}

checkSize();
