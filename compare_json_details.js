const JSZip = require('./node_modules/jszip');
const fs = require('fs');

async function compareJsonDetails() {
    const originalPath = 'C:\\Users\\iamah\\Downloads\\Interactive test.lottie';
    const exportedPath = 'C:\\Users\\iamah\\Downloads\\Main Scene.lottie';

    const originalData = fs.readFileSync(originalPath);
    const exportedData = fs.readFileSync(exportedPath);

    const originalZip = await JSZip.loadAsync(originalData);
    const exportedZip = await JSZip.loadAsync(exportedData);

    const originalManifest = JSON.parse(await originalZip.file('manifest.json').async('string'));
    const exportedManifest = JSON.parse(await exportedZip.file('manifest.json').async('string'));

    const originalJson = JSON.parse(await originalZip.file(`a/${originalManifest.animations[0].id}.json`).async('string'));
    const exportedJson = JSON.parse(await exportedZip.file(`a/${exportedManifest.animations[0].id}.json`).async('string'));

    console.log('--- Stats ---');
    console.log(`Original JSON size: ${JSON.stringify(originalJson).length}`);
    console.log(`Exported JSON size: ${JSON.stringify(exportedJson).length}`);

    // Check precision of a few numbers
    function getPrecisionStats(obj) {
        let count = 0;
        let totalLen = 0;
        let maxPrecision = 0;

        function traverse(o) {
            if (typeof o === 'number') {
                count++;
                const s = o.toString();
                totalLen += s.length;
                if (s.includes('.')) {
                    maxPrecision = Math.max(maxPrecision, s.split('.')[1].length);
                }
            } else if (Array.isArray(o)) {
                o.forEach(traverse);
            } else if (o && typeof o === 'object') {
                Object.values(o).forEach(traverse);
            }
        }
        traverse(obj);
        return { count, avgLen: totalLen / count, maxPrecision };
    }

    const origStats = getPrecisionStats(originalJson);
    const expStats = getPrecisionStats(exportedJson);

    console.log('\n--- Precision Stats ---');
    console.log('Original:', origStats);
    console.log('Exported:', expStats);

    // Check for "nm" fields
    function countNmFields(obj) {
        let count = 0;
        let totalLen = 0;
        function traverse(o) {
            if (o && typeof o === 'object') {
                if (o.nm !== undefined) {
                    count++;
                    totalLen += o.nm.length;
                }
                Object.values(o).forEach(traverse);
            }
        }
        traverse(obj);
        return { count, totalLen };
    }

    console.log('\n--- "nm" Fields ---');
    console.log('Original:', countNmFields(originalJson));
    console.log('Exported:', countNmFields(exportedJson));
}

compareJsonDetails().catch(console.error);
