const fs = require('fs');
const data = JSON.parse(fs.readFileSync('C:/Users/iamah/Downloads/test/Hold to Delete Interaction.json', 'utf8'));

// Minimal implementation of LottieParser logic
const nodes = [];
const layerIdMap = new Map();

function parseLayer(l) {
    const node = {
        id: "id_" + l.ind,
        name: l.nm,
        type: l.ty === 0 ? 'precomp' : 'group',
        visible: l.hd === 1 ? false : true,
        matteTargetIds: [],
        refId: l.refId
    };
    return node;
}

data.layers.forEach(l => {
    const node = parseLayer(l);
    layerIdMap.set(l.ind, node.id);
    nodes.push(node);
});

// resolveTrackMattes
data.layers.forEach((layer, i) => {
    const nodeId = layerIdMap.get(layer.ind);
    const node = nodes.find(n => n.id === nodeId);

    if (layer.tp !== undefined) {
        const sourceId = layerIdMap.get(layer.tp);
        if (sourceId) {
            node.matteSourceId = sourceId;
            const sourceNode = nodes.find(n => n.id === sourceId);
            if (sourceNode) {
                if (!sourceNode.matteTargetIds) sourceNode.matteTargetIds = [];
                sourceNode.matteTargetIds.push(node.id);
                sourceNode.visible = false;
            }
        }
    } else if (layer.tt !== undefined && layer.tt !== 0 && i > 0) {
        const prevLayer = data.layers[i - 1]; // In Lottie JSON, layers[i] being target means layers[i-1] is source? 
        // Wait, AE order: top layer is mask. JSON order: layers[0] is top?
        // Let's check my LottieParser code.
    }
});

let log = "";
nodes.forEach(n => {
    log += `Node: ${n.name}, visibility: ${n.visible}, matteTargets: ${n.matteTargetIds.length}\n`;
});
fs.writeFileSync('visibility_utf8.txt', log, 'utf8');
