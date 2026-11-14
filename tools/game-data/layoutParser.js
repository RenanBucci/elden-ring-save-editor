/**
 * Layout parser for SBLYTBND files (Shoebox layout bundles).
 * 
 * The SBLYTBND contains XML layout files that define where each icon
 * sits within sprite atlas textures.
 * 
 * Format: <TextureAtlas imagePath="SB_Icon_00.dds">
 *   <SubTexture name="MENU_ItemIcon_00001.png" x="0" y="0" width="128" height="128"/>
 *   ...
 * </TextureAtlas>
 * 
 * The SBLYTBND itself is a BND4 container with layout XML files inside.
 * Multiple XML files exist for different game screens; we merge them all
 * to build a comprehensive icon map.
 */
const { parseBND4 } = require('./bnd4Parser');

/**
 * Parse all layout files from a BND4 bundle.
 * Returns Map<iconName, { name, x, y, width, height, iconId, atlas }>
 * where atlas is the imagePath (e.g. "SB_Icon_00.png").
 * 
 * When duplicate iconIds exist across files, the entry with the
 * largest dimensions wins.
 */
function parseLayoutBundle(data) {
    const files = parseBND4(data);
    const icons = new Map();

    for (const file of files) {
        const xml = decodeXmlBuffer(file.data);
        if (!xml || !xml.includes('<SubTexture')) continue;
        parseLayoutXML(xml, icons);
    }

    return icons;
}

function decodeXmlBuffer(buf) {
    if (buf.length < 4) return null;

    if (buf[0] === 0xFF && buf[1] === 0xFE) {
        return buf.toString('utf16le', 2);
    }
    if (buf[0] === 0xFE && buf[1] === 0xFF) {
        const swapped = Buffer.alloc(buf.length - 2);
        for (let i = 2; i < buf.length - 1; i += 2) {
            swapped[i - 2] = buf[i + 1];
            swapped[i - 1] = buf[i];
        }
        return swapped.toString('utf16le');
    }

    if (buf[0] === 0x3C && buf[1] === 0x00) {
        return buf.toString('utf16le');
    }

    const sample = buf.subarray(0, Math.min(200, buf.length));
    let nullCount = 0;
    for (let i = 0; i < sample.length; i++) {
        if (sample[i] === 0) nullCount++;
    }
    if (nullCount > sample.length * 0.3) {
        return buf.toString('utf16le');
    }

    return buf.toString('utf-8');
}

/**
 * Parse a layout XML string for SubTexture definitions.
 * Handles multiple <TextureAtlas> elements, each with its own imagePath.
 */
function parseLayoutXML(xml, icons) {
    const atlasRegex = /<TextureAtlas[^>]*imagePath\s*=\s*"([^"]*)"/gi;
    let atlasMatch;

    while ((atlasMatch = atlasRegex.exec(xml)) !== null) {
        const atlas = atlasMatch[1];
        const atlasStart = atlasMatch.index;
        const closeTag = xml.indexOf('</TextureAtlas>', atlasStart);
        const section = xml.substring(atlasStart, closeTag !== -1 ? closeTag : undefined);

        const subtexRegex = /<SubTexture\s+([^>]+)\/?>/gi;
        let match;

        while ((match = subtexRegex.exec(section)) !== null) {
            const attrs = match[1];
            const name = extractAttr(attrs, 'name');
            const x = parseInt(extractAttr(attrs, 'x'), 10);
            const y = parseInt(extractAttr(attrs, 'y'), 10);
            const width = parseInt(extractAttr(attrs, 'width'), 10);
            const height = parseInt(extractAttr(attrs, 'height'), 10);

            if (name && !isNaN(x) && !isNaN(y) && !isNaN(width) && !isNaN(height)) {
                const idMatch = name.match(/MENU_ItemIcon_(\d+)/i);
                const iconId = idMatch ? parseInt(idMatch[1], 10) : null;

                const entry = { name, x, y, width, height, iconId, atlas };

                const existing = icons.get(name);
                if (!existing || (width * height > existing.width * existing.height)) {
                    icons.set(name, entry);
                }
            }
        }
    }
}

function extractAttr(attrs, name) {
    const regex = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i');
    const match = attrs.match(regex);
    return match ? match[1] : null;
}

/**
 * Try to parse directly as XML if not inside a BND4
 */
function parseDirectXML(data) {
    const icons = new Map();
    const xml = Buffer.isBuffer(data) ? decodeXmlBuffer(data) : data;
    if (xml) parseLayoutXML(xml, icons);
    return icons;
}

module.exports = { parseLayoutBundle, parseDirectXML };
