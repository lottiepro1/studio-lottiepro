
import { LottieParser } from './lib/creator/lottie/LottieParser';
import fs from 'fs';

const path = 'C:\\Users\\iamah\\Downloads\\Logistics_Interaction.json';
const json = JSON.parse(fs.readFileSync(path, 'utf8'));

const { nodes } = LottieParser.parse(json);

const imageNode = nodes.find(n => n.name === 'Mumbai-map.png');

if (imageNode) {
    console.log('Verification Success:');
    console.log('Layer Name:', imageNode.name);
    console.log('Width:', imageNode.props.width);
    console.log('Height:', imageNode.props.height);

    if (imageNode.props.width === 805 && imageNode.props.height === 807) {
        console.log('RESULT: PASSED');
    } else {
        console.log('RESULT: FAILED (Dimension mismatch)');
    }
} else {
    console.log('RESULT: FAILED (Layer not found)');
}
