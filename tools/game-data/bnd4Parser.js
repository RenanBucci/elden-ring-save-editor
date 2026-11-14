/**
 * BND4 archive parser for FromSoftware games (DS2/DS3/BB/Sekiro/Elden Ring).
 *
 * Header (0x40 bytes):
 *   0x00-0x03 : "BND4" magic
 *   0x04      : flag1
 *   0x05      : flag2
 *   0x08      : big-endian flag
 *   0x0C      : file count (i32). On a real regulation.bin this is 194.
 *   0x10      : header size (i32, always 0x40). Not the file count.
 *   0x14      : padding / reserved (i32)
 *   0x18-0x1F : version string (8 chars)
 *   0x20      : entry header size (u32, typically 0x18 / 0x1C / 0x24)
 *   0x28      : data-start offset (u32 or i64)
 *   0x30      : unicode flag (byte)
 *   0x31      : format (byte)  –  0x40, 0x54, 0x74, 0xE0 …
 *   0x32      : extended (byte) – 4 means hash-table is present
 *   0x38      : hash-table offset (i64, only when extended=4)
 */

function parseBND4(buffer) {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

    const magic = buf.toString('ascii', 0, 4);
    if (magic !== 'BND4') {
        throw new Error(`Not a BND4 file (magic: ${magic})`);
    }

    const bigEndian = buf[0x08] !== 0;
    const readI32 = bigEndian ? (o) => buf.readInt32BE(o) : (o) => buf.readInt32LE(o);
    const readU32 = bigEndian ? (o) => buf.readUInt32BE(o) : (o) => buf.readUInt32LE(o);
    const readI64 = bigEndian ? (o) => Number(buf.readBigInt64BE(o)) : (o) => Number(buf.readBigInt64LE(o));

    const fileCount = readI32(0x0C);
    const entrySize = readU32(0x20) || 0x24;
    const unicode = buf[0x30] !== 0;
    const format = buf[0x31];

    const files = [];
    let offset = 0x40;

    for (let i = 0; i < fileCount; i++) {
        const flags = buf[offset];
        let compressedSize, uncompressedSize, dataOffset, nameOffset;
        let id = -1;

        if (entrySize >= 0x24 && (format === 0x74 || format === 0xE0 || format === 0x00)) {
            // Extended format: flags(4) + ID(4) + compSize(8) + uncompSize(8) + dataOff(4) + idx(4) + nameOff(4)
            id = readI32(offset + 0x04);
            compressedSize = readI64(offset + 0x08);
            uncompressedSize = readI64(offset + 0x10);
            dataOffset = readU32(offset + 0x18);
            nameOffset = readU32(offset + 0x20);
        } else if (format === 0x54 || format === 0x40) {
            // Compact format
            id = readI32(offset + 0x04);
            compressedSize = readI64(offset + 0x08);
            dataOffset = readI64(offset + 0x10);
            uncompressedSize = compressedSize;
            if (entrySize >= 0x1C) {
                nameOffset = readU32(offset + 0x18);
            }
        } else {
            // Fallback: try the extended layout (works for regulation.bin)
            id = readI32(offset + 0x04);
            compressedSize = readI64(offset + 0x08);
            uncompressedSize = readI64(offset + 0x10);
            dataOffset = readU32(offset + 0x18);
            nameOffset = readU32(offset + 0x20);
        }

        let name = `file_${i}`;
        if (nameOffset > 0 && nameOffset < buf.length) {
            name = unicode
                ? readUTF16String(buf, nameOffset)
                : readASCIIString(buf, nameOffset);
        }

        if (dataOffset >= 0 && dataOffset + compressedSize <= buf.length) {
            files.push({
                index: i,
                name: name.replace(/\\/g, '/'),
                data: buf.subarray(dataOffset, dataOffset + compressedSize),
                compressedSize,
                uncompressedSize,
                flags,
                id,
            });
        }

        offset += entrySize;
    }

    return files;
}

function readASCIIString(buf, offset) {
    let end = offset;
    while (end < buf.length && buf[end] !== 0) end++;
    return buf.toString('ascii', offset, end);
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

function findFile(files, namePattern) {
    const regex = namePattern instanceof RegExp ? namePattern : new RegExp(namePattern, 'i');
    return files.find(f => regex.test(f.name));
}

module.exports = { parseBND4, findFile };
