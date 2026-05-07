const JSZip = require('./node_modules/jszip');
const fs = require('fs');

async function checkEasingFormat() {
    const originalPath = 'C:\\Users\\iamah\\Downloads\\Interactive test.lottie';
    const originalData = fs.readFileSync(originalPath);
    const originalZip = await JSZip.loadAsync(originalData);

    const originalManifest = JSON.parse(await originalZip.file('manifest.json').async('string'));
    const originalJson = JSON.parse(await originalZip.file(`a/${originalManifest.animations[0].id}.json`).async('string'));

    // Look for a multi-dimensional keyframe with easing
    function findKeyframes(obj) {
        if (obj && typeof obj === 'object') {
            if (obj.k && Array.isArray(obj.k) && obj.k.length > 0 && obj.k[0].t !== undefined) {
                const kf = obj.k.find(k => k.s && Array.isArray(k.s) && k.s.length > 1 && k.o);
                if (kf) {
                    console.log('Found multi-dim keyframe easing:');
                    console.log('o:', JSON.stringify(kf.o));
                    console.log('i:', JSON.stringify(kf.i));
                    // Check if they are numbers or arrays
                }
            }
            Object.values(obj).forEach(findKeyframes);
        }
    }
    findKeyframes(originalJson);
}

checkEasingFormat().catch(console.error);
