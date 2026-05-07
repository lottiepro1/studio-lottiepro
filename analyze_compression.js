const JSZip = require('./node_modules/jszip');
const fs = require('fs');

async function analyzeCompression() {
    const originalPath = 'C:\\Users\\iamah\\Downloads\\Interactive test.lottie';
    const exportedPath = 'C:\\Users\\iamah\\Downloads\\newww.lottie';

    if (!fs.existsSync(originalPath) || !fs.existsSync(exportedPath)) {
        console.log('Files missing');
        return;
    }

    const originalData = fs.readFileSync(originalPath);
    const exportedData = fs.readFileSync(exportedPath);

    console.log(`Original file size: ${(originalData.length / 1024).toFixed(2)} KB`);
    console.log(`Exported file size: ${(exportedData.length / 1024).toFixed(2)} KB`);

    const originalZip = await JSZip.loadAsync(originalData);
    const exportedZip = await JSZip.loadAsync(exportedData);

    console.log('\n--- Original Archive Contents ---');
    for (const [filename, file] of Object.entries(originalZip.files)) {
        if (!file.dir) {
            const rawContent = await file.async('uint8array');
            // Try to find compression details (JSZip abstracts this, but we can see uncompressed size)
            console.log(`${filename}: Uncompressed Size: ${(rawContent.length / 1024).toFixed(2)} KB`);
        }
    }

    console.log('\n--- Exported Archive Contents ---');
    for (const [filename, file] of Object.entries(exportedZip.files)) {
        if (!file.dir) {
            const rawContent = await file.async('uint8array');
            console.log(`${filename}: Uncompressed Size: ${(rawContent.length / 1024).toFixed(2)} KB`);
        }
    }

    // Compare JSON structures and lengths
    const origManifest = JSON.parse(await originalZip.file('manifest.json').async('string'));
    const expManifest = JSON.parse(await exportedZip.file('manifest.json').async('string'));
    const origAnim = await originalZip.file(`a/${origManifest.animations[0].id}.json`).async('string');
    const expAnim = await exportedZip.file(`a/${expManifest.animations[0].id}.json`).async('string');

    console.log(`\nOriginal JSON strict length: ${origAnim.length} characters`);
    console.log(`Exported JSON strict length: ${expAnim.length} characters`);
}

analyzeCompression().catch(console.error);
