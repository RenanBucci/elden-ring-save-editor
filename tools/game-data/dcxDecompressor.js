/**
 * DCX Decompressor for FromSoftware games.
 * 
 * Supports two compression algorithms used in Elden Ring:
 * - DFLT (Deflate/zlib) - used in some files, handled natively via Node.js zlib
 * - KRAK (Oodle Kraken) - used in most ER files, requires oo2core DLL from game
 * 
 * DCX header format:
 *   0x00: "DCX\0" magic
 *   0x04: 0x11000 (or 0x10000)
 *   0x08-0x0B: header sizes
 *   0x24-0x27: compressed size
 *   0x28-0x2B: compression type marker
 *   0x2C-0x2F: uncompressed size (sometimes at different offset)
 * 
 * The exact layout varies by DCX version, so we detect by scanning for known markers.
 */
const zlib = require('zlib');
const fs = require('fs');

let oodleDecompress = null;

function initOodle(dllPath) {
    if (oodleDecompress) return true;
    if (!dllPath || !fs.existsSync(dllPath)) return false;

    try {
        const koffi = require('koffi');
        const lib = koffi.load(dllPath);
        oodleDecompress = lib.func(
            'int OodleLZ_Decompress(const void *src, int srcLen, void *dst, int dstLen, int fuzzSafe, int checkCRC, int verbosity, void *decBufBase, int decBufSize, void *fpCallback, void *callbackUserData, void *decoderMemory, int decoderMemorySize, int threadPhase)'
        );
        return true;
    } catch (err) {
        console.warn('[IconExtractor] Failed to load Oodle DLL:', err.message);
        return false;
    }
}

function decompressDCX(dcxBuffer, dllPath) {
    const buf = Buffer.isBuffer(dcxBuffer) ? dcxBuffer : Buffer.from(dcxBuffer);

    // Verify DCX magic
    const magic = buf.toString('ascii', 0, 4);
    if (magic !== 'DCX\0') {
        throw new Error(`Not a DCX file (magic: ${magic})`);
    }

    // Read header fields (big-endian)
    const compressionNameOffset = findCompressionName(buf);

    if (compressionNameOffset !== null) {
        const compName = readNullTermString(buf, compressionNameOffset);

        if (compName === 'DFLT') {
            return decompressDFLT(buf);
        } else if (compName === 'KRAK') {
            return decompressKRAK(buf, dllPath);
        } else if (compName === 'ZSTD') {
            return decompressZSTD(buf);
        }
    }

    // Fallback: try to detect by scanning for zlib header
    const compressedDataStart = findCompressedData(buf);
    if (compressedDataStart > 0) {
        const firstByte = buf[compressedDataStart];
        if (firstByte === 0x78) { // zlib header
            return decompressDFLTRaw(buf, compressedDataStart);
        }
    }

    // Try KRAK as last resort (most ER files use it)
    return decompressKRAK(buf, dllPath);
}

function decompressDFLT(buf) {
    // DCX DFLT: uncompressed at 0x1C, compressed at 0x20 (after DCS marker at 0x18)
    // DFLT-specific: data block is typically at 0x4C with zlib header
    
    // Find the zlib stream - scan for 0x78 (zlib header) after the DCX header
    for (let i = 0x40; i < Math.min(buf.length, 0x100); i++) {
        if (buf[i] === 0x78 && (buf[i + 1] === 0x01 || buf[i + 1] === 0x9C || buf[i + 1] === 0xDA)) {
            const compressed = buf.subarray(i);
            return zlib.inflateSync(compressed);
        }
    }

    // Fallback: try from fixed offset
    const compressed = buf.subarray(0x4C);
    return zlib.inflateSync(compressed);
}

function decompressDFLTRaw(buf, offset) {
    const compressed = buf.subarray(offset);
    return zlib.inflateSync(compressed);
}

function decompressKRAK(buf, dllPath) {
    if (!initOodle(dllPath)) {
        throw new Error('Oodle DLL not found - needed for KRAK decompression. Ensure Elden Ring is installed.');
    }

    // DCX header layout (big-endian):
    //   0x00: "DCX\0"
    //   0x04: version (0x10000 or 0x11000)
    //   0x08: dcsOffset
    //   0x0C: dcpOffset
    //   0x18: "DCS\0"
    //   0x1C: uncompressed size   <-- correct offset
    //   0x20: compressed size     <-- correct offset
    //   0x24: "DCP\0"
    //   0x28: compression name ("KRAK", "DFLT", etc.)
    //   0x44: start of compressed data (typical)

    let uncompressedSize = buf.readUInt32BE(0x1C);
    let compressedSize = buf.readUInt32BE(0x20);

    // Validate: "DCS\0" marker should be at 0x18
    const dcsMarker = buf.toString('ascii', 0x18, 0x1C);
    if (dcsMarker !== 'DCS\0') {
        // Try alternative offsets if standard layout doesn't match
        for (let i = 0x10; i < 0x30; i += 4) {
            if (buf.toString('ascii', i, i + 4) === 'DCS\0') {
                uncompressedSize = buf.readUInt32BE(i + 4);
                compressedSize = buf.readUInt32BE(i + 8);
                break;
            }
        }
    }

    if (uncompressedSize === 0 || uncompressedSize > 500000000) {
        throw new Error('Could not determine DCX decompressed size');
    }

    // Find compressed data start: look for "DCA\0" marker, data follows after it + 8 bytes
    let dataStart = 0x44;
    for (let i = 0x30; i < Math.min(0x60, buf.length); i += 4) {
        if (buf.toString('ascii', i, i + 4) === 'DCA\0') {
            dataStart = i + 8;
            break;
        }
    }

    // Fallback: compute from compressed size
    if (buf.length - dataStart < compressedSize) {
        dataStart = buf.length - compressedSize;
    }

    const compressedData = buf.subarray(dataStart, dataStart + compressedSize);
    const output = Buffer.alloc(uncompressedSize);

    const result = oodleDecompress(
        compressedData, compressedData.length,
        output, output.length,
        0, 0, 0, null, 0, null, null, null, 0, 0
    );

    if (result !== uncompressedSize) {
        throw new Error(`Oodle decompression failed (got ${result} bytes, expected ${uncompressedSize})`);
    }

    return output;
}

function decompressZSTD(buf) {
    let fzstd;
    try { fzstd = require('fzstd'); } catch {
        throw new Error('ZSTD compression detected. Install fzstd: npm install fzstd');
    }

    // Find DCS marker for sizes, DCA for data start
    let uncompressedSize = 0, compressedSize = 0;
    for (let i = 0x10; i < Math.min(buf.length, 0x40); i += 4) {
        if (buf.toString('ascii', i, i + 4) === 'DCS\0') {
            uncompressedSize = buf.readUInt32BE(i + 4);
            compressedSize = buf.readUInt32BE(i + 8);
            break;
        }
    }
    if (!uncompressedSize) {
        uncompressedSize = buf.readUInt32BE(0x1C);
        compressedSize = buf.readUInt32BE(0x20);
    }

    let dataStart = 0x44;
    for (let i = 0x30; i < Math.min(0x60, buf.length); i += 4) {
        if (buf.toString('ascii', i, i + 4) === 'DCA\0') {
            dataStart = i + 8;
            break;
        }
    }

    const compressed = buf.subarray(dataStart, compressedSize ? dataStart + compressedSize : undefined);
    return Buffer.from(fzstd.decompress(compressed));
}

function findCompressionName(buf) {
    // Scan for known compression type strings
    const names = ['DFLT', 'KRAK', 'ZSTD', 'EDGE'];
    for (let i = 0x20; i < Math.min(buf.length, 0x60); i++) {
        for (const name of names) {
            const candidate = buf.toString('ascii', i, i + name.length);
            if (candidate === name) return i;
        }
    }
    return null;
}

function findCompressedData(buf) {
    // Heuristic: find where the actual compressed payload starts
    // DCX headers are typically 0x40-0x50 bytes
    for (let i = 0x40; i < Math.min(buf.length, 0x80); i++) {
        // Check for zlib header (DFLT)
        if (buf[i] === 0x78) return i;
    }
    return 0x44; // default
}

function readNullTermString(buf, offset) {
    let end = offset;
    while (end < buf.length && buf[end] !== 0) end++;
    return buf.toString('ascii', offset, end);
}

/**
 * Check if a buffer is DCX-compressed
 */
function isDCX(buf) {
    return buf.length > 4 && buf.toString('ascii', 0, 4) === 'DCX\0';
}

module.exports = { decompressDCX, isDCX, initOodle };
