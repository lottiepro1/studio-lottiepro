const JSZip = require('jszip');
const fs = require('fs');
const path = require('path');

async function main() {
    const data = fs.readFileSync('C:\\Users\\iamah\\Downloads\\Interactive test.lottie');
    const zip = await JSZip.loadAsync(data);

    let output = '=== ZIP STRUCTURE ===\n';
    for (const [p, entry] of Object.entries(zip.files)) {
        if (entry.dir) {
            output += `[DIR] ${p}\n`;
        } else {
            const content = await entry.async('string');
            output += `\n--- ${p} (${content.length} chars) ---\n`;
            if (p.endsWith('.json') && content.length < 8000) {
                output += content + '\n';
            } else if (p.endsWith('.json')) {
                output += content.substring(0, 3000) + '\n... [TRUNCATED] ...\n';
            } else {
                output += `[BINARY or non-JSON: ${content.length} chars]\n`;
            }
        }
    }

    const outPath = path.join(__dirname, 'dotlottie_analysis.txt');
    fs.writeFileSync(outPath, output);
    console.log('Done! Output written to ' + outPath);
}

main().catch(e => console.error(e));
