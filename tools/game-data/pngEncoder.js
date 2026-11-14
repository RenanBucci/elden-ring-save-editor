/**
 * Minimal PNG encoder - converts raw RGBA pixel data to PNG format.
 * Uses Node.js built-in zlib for deflate compression.
 */
const zlib = require('zlib');

function encodePNG(width, height, rgbaPixels) {
    // PNG filter: prepend each row with filter byte 0 (None)
    const rowSize = width * 4;
    const filtered = Buffer.alloc(height * (rowSize + 1));
    for (let y = 0; y < height; y++) {
        filtered[y * (rowSize + 1)] = 0; // Filter: None
        rgbaPixels.copy(filtered, y * (rowSize + 1) + 1, y * rowSize, (y + 1) * rowSize);
    }

    const compressed = zlib.deflateSync(filtered);

    // Build PNG file
    const chunks = [];

    // Signature
    chunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

    // IHDR
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 6;  // color type: RGBA
    ihdr[10] = 0; // compression
    ihdr[11] = 0; // filter
    ihdr[12] = 0; // interlace
    chunks.push(makeChunk('IHDR', ihdr));

    // IDAT
    chunks.push(makeChunk('IDAT', compressed));

    // IEND
    chunks.push(makeChunk('IEND', Buffer.alloc(0)));

    return Buffer.concat(chunks);
}

function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);

    const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = crc32(typeAndData);

    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc >>> 0, 0);

    return Buffer.concat([len, typeAndData, crcBuf]);
}

// CRC32 lookup table
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c;
}

function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
        crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

module.exports = { encodePNG };
