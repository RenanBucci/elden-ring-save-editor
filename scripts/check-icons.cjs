const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');

function checkIcons(directory = path.join(root, 'public/icons')) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'src/icon-manifest.json'), 'utf8'));
    for (const [file, expected] of Object.entries(manifest.files)) {
        const bytes = fs.readFileSync(path.join(directory, file));
        if (crypto.createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error(`Invalid bundled icon: ${file}`);
    }
    const catalog = require('../public/data/itemParams.json');
    for (const key of ['weapons', 'armor', 'accessories', 'goods', 'gems']) {
        for (const item of catalog[key] || []) {
            if (key === 'armor' && item.paramId < 20000) continue; // Empty body slots have no item icon.
            if (!item.iconId || (!item.name && key !== 'gems')) continue;
            const file = `icon_${String(item.iconId).padStart(5, '0')}.png`;
            if (!manifest.files[file]) throw new Error(`Missing catalog icon ${key}:${item.paramId}: ${file}`);
        }
    }
    console.log(`Verified ${Object.keys(manifest.files).length} bundled icons in ${directory}`);
    return manifest;
}
if (require.main === module) checkIcons(process.argv[2]);
module.exports = { checkIcons };
