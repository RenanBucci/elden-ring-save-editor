/**
 * TPF (Texture Pack Format) parser for FromSoftware games.
 * 
 * TPF is a container for DDS textures. Elden Ring icons are stored in
 * TPF archives (often inside BND4 or DCX).
 * 
 * Header:
 *   0x00: "TPF\0" magic (4 bytes)
 *   0x04: total data size (int32 LE)
 *   0x08: texture count (int32 LE)
 *   0x0C: platform flag (0=PC, 1=Xbox, 2=PS)
 *   0x0D: encoding flag
 *   0x0E-0x0F: padding
 * 
 * Texture entries (starting at 0x10):
 *   0x00: data offset (uint32 LE)
 *   0x04: data size (int32 LE)
 *   0x08: format (DDS format code)
 *   0x09: cubemap flag
 *   0x0A: mipmap count
 *   0x0B: padding
 *   0x0C: name offset (uint32 LE)
 *   0x10: additional flags (varies by version)
 */

function parseTPF(buffer) {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

    const magic = buf.toString('ascii', 0, 3);
    if (magic !== 'TPF') {
        throw new Error(`Not a TPF file (magic: ${magic})`);
    }

    const textureCount = buf.readUInt32LE(0x08);
    const encoding = buf[0x0D];

    const useUTF16Names = (encoding & 1) !== 0;

    const textures = [];
    let entryOffset = 0x10;
    const entrySize = detectEntrySize(buf, textureCount);

    for (let i = 0; i < textureCount; i++) {
        const dataOffset = buf.readUInt32LE(entryOffset);
        const texDataSize = buf.readInt32LE(entryOffset + 0x04);
        const format = buf[entryOffset + 0x08];
        const cubemap = buf[entryOffset + 0x09];
        const mipmaps = buf[entryOffset + 0x0A];
        const nameOffset = buf.readUInt32LE(entryOffset + 0x0C);

        let name = `texture_${i}`;
        if (nameOffset > 0 && nameOffset < buf.length) {
            name = useUTF16Names
                ? readUTF16String(buf, nameOffset)
                : readNullTermString(buf, nameOffset);
        }

        const data = buf.subarray(dataOffset, dataOffset + texDataSize);

        textures.push({
            index: i,
            name,
            data,
            format,
            cubemap,
            mipmaps,
            size: texDataSize,
        });

        entryOffset += entrySize;
    }

    return textures;
}

function detectEntrySize(buf, textureCount) {
    if (textureCount < 2) return 0x14;

    // Try standard 0x14 first, verify entry 1's dataOffset is plausible
    const e0DataOff = buf.readUInt32LE(0x10);
    const e0DataSize = buf.readInt32LE(0x14);
    const expectedNext = e0DataOff + e0DataSize;

    for (const stride of [0x14, 0x18, 0x1C, 0x20]) {
        const e1Off = 0x10 + stride;
        if (e1Off + 4 > buf.length) continue;
        const e1DataOff = buf.readUInt32LE(e1Off);
        if (Math.abs(e1DataOff - expectedNext) < 256) return stride;
    }

    return 0x14;
}

function readUTF16String(buf, offset) {
    let str = '';
    for (let i = offset; i < buf.length - 1; i += 2) {
        const code = buf.readUInt16LE(i);
        if (code === 0) break;
        str += String.fromCharCode(code);
    }
    return str;
}

function readNullTermString(buf, offset) {
    let end = offset;
    while (end < buf.length && buf[end] !== 0) end++;
    return buf.toString('ascii', offset, end);
}

/**
 * Find texture by name pattern
 */
function findTexture(textures, pattern) {
    const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i');
    return textures.find(t => regex.test(t.name));
}

module.exports = { parseTPF, findTexture };
