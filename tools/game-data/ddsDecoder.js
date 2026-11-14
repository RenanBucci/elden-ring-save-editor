/**
 * DDS texture decoder - supports BC1 (DXT1), BC3 (DXT5), and BC7 (BPTC).
 * Elden Ring icon atlas (SB_Icon.dds) typically uses BC7.
 * 
 * DDS Header:
 *   0x00: "DDS " magic (4 bytes)
 *   0x04: header size (124)
 *   0x08: flags
 *   0x0C: height
 *   0x10: width
 *   0x14: pitch or linear size
 *   0x18: depth
 *   0x1C: mipmap count
 *   0x4C: pixel format (32 bytes)
 *   0x50: fourCC
 *   ...
 *   0x80: DX10 extended header (if fourCC == "DX10")
 */

// DXGI formats
const DXGI_FORMAT_BC1_UNORM = 71;
const DXGI_FORMAT_BC3_UNORM = 77;
const DXGI_FORMAT_BC7_UNORM = 98;

function parseDDSHeader(buf) {
    if (buf.toString('ascii', 0, 4) !== 'DDS ') {
        throw new Error('Not a DDS file');
    }

    const height = buf.readUInt32LE(0x0C);
    const width = buf.readUInt32LE(0x10);
    const mipmaps = buf.readUInt32LE(0x1C);
    const fourCC = buf.toString('ascii', 0x54, 0x58);

    let format = 'unknown';
    let dataOffset = 0x80; // Standard DDS header size
    let dxgiFormat = 0;

    if (fourCC === 'DX10') {
        // DX10 extended header
        dxgiFormat = buf.readUInt32LE(0x80);
        dataOffset = 0x94; // 0x80 + 20 bytes DX10 header
        if (dxgiFormat === DXGI_FORMAT_BC7_UNORM || dxgiFormat === DXGI_FORMAT_BC7_UNORM + 1) format = 'BC7';
        else if (dxgiFormat === DXGI_FORMAT_BC1_UNORM || dxgiFormat === DXGI_FORMAT_BC1_UNORM + 1) format = 'BC1';
        else if (dxgiFormat === DXGI_FORMAT_BC3_UNORM || dxgiFormat === DXGI_FORMAT_BC3_UNORM + 1) format = 'BC3';
    } else if (fourCC === 'DXT1') {
        format = 'BC1';
    } else if (fourCC === 'DXT5') {
        format = 'BC3';
    }

    return { width, height, format, dataOffset, mipmaps, dxgiFormat, fourCC };
}

/**
 * Decode a DDS texture to RGBA pixels
 */
function decodeDDS(ddsBuffer) {
    const buf = Buffer.isBuffer(ddsBuffer) ? ddsBuffer : Buffer.from(ddsBuffer);
    const header = parseDDSHeader(buf);
    const data = buf.subarray(header.dataOffset);

    const { width, height, format } = header;
    const pixels = Buffer.alloc(width * height * 4);

    if (format === 'BC1') {
        decodeBC1(data, width, height, pixels);
    } else if (format === 'BC3') {
        decodeBC3(data, width, height, pixels);
    } else if (format === 'BC7') {
        decodeBC7(data, width, height, pixels);
    } else {
        throw new Error(`Unsupported DDS format: ${format} (fourCC: ${header.fourCC}, dxgi: ${header.dxgiFormat})`);
    }

    return { width, height, pixels };
}

// ============ BC1 (DXT1) Decoder ============

function decodeBC1(data, width, height, output) {
    const blocksX = Math.ceil(width / 4);
    const blocksY = Math.ceil(height / 4);

    for (let by = 0; by < blocksY; by++) {
        for (let bx = 0; bx < blocksX; bx++) {
            const blockIdx = (by * blocksX + bx) * 8;
            decodeBC1Block(data, blockIdx, bx * 4, by * 4, width, height, output);
        }
    }
}

function decodeBC1Block(data, offset, px, py, w, h, out) {
    const c0 = data.readUInt16LE(offset);
    const c1 = data.readUInt16LE(offset + 2);
    const indices = data.readUInt32LE(offset + 4);

    const colors = [unpackR5G6B5(c0), unpackR5G6B5(c1), [0, 0, 0, 255], [0, 0, 0, 255]];

    if (c0 > c1) {
        colors[2] = mixColors(colors[0], colors[1], 2, 1);
        colors[3] = mixColors(colors[0], colors[1], 1, 2);
    } else {
        colors[2] = mixColors(colors[0], colors[1], 1, 1);
        colors[3] = [0, 0, 0, 0]; // transparent
    }

    for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
            const fx = px + x, fy = py + y;
            if (fx >= w || fy >= h) continue;
            const idx = (indices >> ((y * 4 + x) * 2)) & 3;
            const color = colors[idx];
            const off = (fy * w + fx) * 4;
            out[off] = color[0]; out[off + 1] = color[1]; out[off + 2] = color[2]; out[off + 3] = color[3];
        }
    }
}

// ============ BC3 (DXT5) Decoder ============

function decodeBC3(data, width, height, output) {
    const blocksX = Math.ceil(width / 4);
    const blocksY = Math.ceil(height / 4);

    for (let by = 0; by < blocksY; by++) {
        for (let bx = 0; bx < blocksX; bx++) {
            const blockIdx = (by * blocksX + bx) * 16;

            // Alpha block (8 bytes)
            const a0 = data[blockIdx];
            const a1 = data[blockIdx + 1];
            const alphaLookup = decodeAlphaBlock(a0, a1, data, blockIdx + 2);

            // Color block (8 bytes)
            decodeBC1Block(data, blockIdx + 8, bx * 4, by * 4, width, height, output);

            // Apply alpha
            for (let y = 0; y < 4; y++) {
                for (let x = 0; x < 4; x++) {
                    const fx = bx * 4 + x, fy = by * 4 + y;
                    if (fx >= width || fy >= height) continue;
                    const off = (fy * width + fx) * 4;
                    output[off + 3] = alphaLookup[y * 4 + x];
                }
            }
        }
    }
}

function decodeAlphaBlock(a0, a1, data, offset) {
    const alphas = new Uint8Array(8);
    alphas[0] = a0;
    alphas[1] = a1;

    if (a0 > a1) {
        for (let i = 2; i < 8; i++) alphas[i] = ((8 - i) * a0 + (i - 1) * a1) / 7;
    } else {
        for (let i = 2; i < 6; i++) alphas[i] = ((6 - i) * a0 + (i - 1) * a1) / 5;
        alphas[6] = 0;
        alphas[7] = 255;
    }

    // 48 bits of indices (3 bits each, 16 pixels)
    let bits = 0n;
    for (let i = 0; i < 6; i++) bits |= BigInt(data[offset + i]) << BigInt(i * 8);

    const result = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
        result[i] = alphas[Number((bits >> BigInt(i * 3)) & 7n)];
    }
    return result;
}

// ============ BC7 Decoder ============
// BC7 has 8 modes with varying bit allocations for partitions, endpoints, and indices.

const BC7_PARTITION_TABLE_2 = [
    0xCCCC,0x8888,0xEEEE,0xECC8,0xC880,0xFEEC,0xFEC8,0xEC80,0xC800,0xFFEC,0xFE80,0xE800,0xFFE8,0xFF00,0xFFF0,0xF000,
    0xF710,0x008E,0x7100,0x08CE,0x008C,0x7310,0x3100,0x8CCE,0x088C,0x3110,0x6666,0x366C,0x17E8,0x0FF0,0x718E,0x399C,
    0xAAAA,0xF0F0,0x5A5A,0x33CC,0x3C3C,0x55AA,0x9696,0xA55A,0x73CE,0x13C8,0x324C,0x3BDC,0x6996,0xC33C,0x9966,0x0660,
    0x0272,0x04E4,0x4E40,0x2720,0xC936,0x936C,0x39C6,0x639C,0x9336,0x9CC6,0x817E,0xE718,0xCCF0,0x0FCC,0x7744,0xEE22,
];

const BC7_PARTITION_TABLE_3 = [
    0xAA685050,0x6A5A5040,0x5A5A4200,0x5450A0A8,0xA5A50000,0xA0A05050,0x5555A0A0,0x5A5A5050,
    0xAA550000,0xAA555500,0xAAAA5500,0x90909090,0x94949494,0xA4A4A4A4,0xA9A95050,0x2A0A4242,
    0xA5945040,0x0A425054,0xA5A5A500,0x55A0A0A0,0xA8A85454,0x6A6A4040,0xA4A45000,0x1A1A0600,
    0x0050A4A4,0xAAA59090,0x14696914,0x69691400,0xA08585A0,0xAA821414,0x50A4A450,0x6A5A0200,
    0xA9A58000,0x5090A0A8,0xA8684068,0x6A6A0040,0xA5A56A02,0x56A5A500,0xA2945600,0xDADA0000,
    0xAAA59696,0xA5A50600,0x56A5A5A5,0x96960000,0xAAAA0500,0x56A5A500,0xAAAAA596,0xAA5500AA,
    0xAA55AAAA,0xAA55AA55,0xAA55AA55,0xAA55AA55,0xAA55AA55,0xAA55AA55,0xAA55AA55,0xAA55AA55,
    0xAA55AA55,0xAA55AA55,0xAA55AA55,0xAA55AA55,0xAA55AA55,0xAA55AA55,0xAA55AA55,0xAA55AA55,
];

// Mode definitions: [numSubsets, partitionBits, rotationBits, indexSelBits, colorBits, alphaBits, pBits, indexBits, index2Bits]
const BC7_MODES = [
    { ns: 3, pb: 4, rb: 0, isb: 0, cb: 4, ab: 0, epb: 1, spb: 0, ib: 3, ib2: 0 },
    { ns: 2, pb: 6, rb: 0, isb: 0, cb: 6, ab: 0, epb: 0, spb: 1, ib: 3, ib2: 0 },
    { ns: 3, pb: 6, rb: 0, isb: 0, cb: 5, ab: 0, epb: 0, spb: 0, ib: 2, ib2: 0 },
    { ns: 2, pb: 6, rb: 0, isb: 0, cb: 7, ab: 0, epb: 1, spb: 0, ib: 2, ib2: 0 },
    { ns: 1, pb: 0, rb: 2, isb: 1, cb: 5, ab: 6, epb: 0, spb: 0, ib: 2, ib2: 3 },
    { ns: 1, pb: 0, rb: 2, isb: 0, cb: 7, ab: 8, epb: 0, spb: 0, ib: 2, ib2: 2 },
    { ns: 1, pb: 0, rb: 0, isb: 0, cb: 7, ab: 7, epb: 1, spb: 0, ib: 4, ib2: 0 },
    { ns: 2, pb: 6, rb: 0, isb: 0, cb: 5, ab: 5, epb: 1, spb: 0, ib: 2, ib2: 0 },
];

// Anchor indices for 2-subset partitions
const ANCHOR_2 = [
    15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,2,8,2,2,8,8,15,2,8,2,2,8,8,2,2,
    15,15,6,8,2,8,15,15,2,8,2,2,2,15,15,6,6,2,6,8,15,15,2,2,15,15,15,15,15,2,2,15,
];

// Anchor indices for 3-subset partitions (second and third anchor)
const ANCHOR_3A = [
    3,3,15,15,8,3,15,15,8,8,6,6,6,5,3,3,3,3,8,15,3,3,6,10,5,8,8,6,8,5,15,15,
    8,15,3,5,6,10,8,15,15,3,15,5,15,15,15,15,3,15,5,5,5,8,5,10,5,10,8,13,15,12,3,3,
];
const ANCHOR_3B = [
    15,8,8,3,15,15,3,8,15,15,15,15,15,15,15,8,15,8,15,3,15,8,15,8,3,15,6,10,15,15,10,8,
    15,3,15,10,10,8,9,10,6,15,8,15,3,6,6,8,15,3,15,15,15,15,15,15,15,15,15,15,3,15,15,8,
];

function decodeBC7(data, width, height, output) {
    const blocksX = Math.ceil(width / 4);
    const blocksY = Math.ceil(height / 4);

    for (let by = 0; by < blocksY; by++) {
        for (let bx = 0; bx < blocksX; bx++) {
            const blockOffset = (by * blocksX + bx) * 16;
            decodeBC7Block(data, blockOffset, bx * 4, by * 4, width, height, output);
        }
    }
}

function decodeBC7Block(data, offset, px, py, w, h, out) {
    // Read 128 bits
    const lo = data.readBigUInt64LE(offset);
    const hi = data.readBigUInt64LE(offset + 8);
    const bits = lo | (hi << 64n);

    // Determine mode from leading zeros
    let mode = -1;
    for (let i = 0; i < 8; i++) {
        if ((bits >> BigInt(i)) & 1n) { mode = i; break; }
    }

    if (mode < 0 || mode > 7) {
        // Invalid block - fill with transparent
        fillBlock(px, py, w, h, out, 0, 0, 0, 0);
        return;
    }

    const m = BC7_MODES[mode];
    let bitPos = mode + 1; // Skip mode bits

    // Read partition index
    const partition = readBitsFromU128(bits, bitPos, m.pb); bitPos += m.pb;

    // Read rotation
    const rotation = readBitsFromU128(bits, bitPos, m.rb); bitPos += m.rb;

    // Read index selection
    const indexSel = readBitsFromU128(bits, bitPos, m.isb); bitPos += m.isb;

    // Read color endpoints
    const numEndpoints = m.ns * 2;
    const endpoints = [];
    for (let i = 0; i < numEndpoints; i++) endpoints.push([0, 0, 0, 255]);

    // Color channels (R, G, B)
    for (let ch = 0; ch < 3; ch++) {
        for (let ep = 0; ep < numEndpoints; ep++) {
            endpoints[ep][ch] = Number(readBitsFromU128(bits, bitPos, m.cb)); bitPos += m.cb;
        }
    }

    // Alpha channel
    if (m.ab > 0) {
        for (let ep = 0; ep < numEndpoints; ep++) {
            endpoints[ep][3] = Number(readBitsFromU128(bits, bitPos, m.ab)); bitPos += m.ab;
        }
    }

    // P-bits (endpoint or shared)
    if (m.epb > 0) {
        for (let ep = 0; ep < numEndpoints; ep++) {
            const pbit = Number(readBitsFromU128(bits, bitPos, 1)); bitPos += 1;
            for (let ch = 0; ch < 3; ch++) endpoints[ep][ch] = (endpoints[ep][ch] << 1) | pbit;
            if (m.ab > 0) endpoints[ep][3] = (endpoints[ep][3] << 1) | pbit;
        }
    }
    if (m.spb > 0) {
        for (let i = 0; i < m.ns; i++) {
            const pbit = Number(readBitsFromU128(bits, bitPos, 1)); bitPos += 1;
            for (let ch = 0; ch < 3; ch++) {
                endpoints[i * 2][ch] = (endpoints[i * 2][ch] << 1) | pbit;
                endpoints[i * 2 + 1][ch] = (endpoints[i * 2 + 1][ch] << 1) | pbit;
            }
            if (m.ab > 0) {
                endpoints[i * 2][3] = (endpoints[i * 2][3] << 1) | pbit;
                endpoints[i * 2 + 1][3] = (endpoints[i * 2 + 1][3] << 1) | pbit;
            }
        }
    }

    // Expand endpoints to 8 bits
    const totalColorBits = m.cb + (m.epb || m.spb);
    const totalAlphaBits = m.ab > 0 ? m.ab + (m.epb || m.spb) : 0;

    for (let ep = 0; ep < numEndpoints; ep++) {
        for (let ch = 0; ch < 3; ch++) {
            endpoints[ep][ch] = expandBits(endpoints[ep][ch], totalColorBits);
        }
        if (m.ab > 0) {
            endpoints[ep][3] = expandBits(endpoints[ep][3], totalAlphaBits);
        }
    }

    // Read indices
    const indices = new Uint8Array(16);
    const anchorIndices = getAnchorIndices(m.ns, partition);

    for (let i = 0; i < 16; i++) {
        const isAnchor = anchorIndices.includes(i);
        const numBits = m.ib - (isAnchor ? 1 : 0);
        indices[i] = Number(readBitsFromU128(bits, bitPos, numBits)); bitPos += numBits;
    }

    // Read secondary indices (for modes with ib2 > 0)
    const indices2 = new Uint8Array(16);
    if (m.ib2 > 0) {
        for (let i = 0; i < 16; i++) {
            const isAnchor = i === 0;
            const numBits = m.ib2 - (isAnchor ? 1 : 0);
            indices2[i] = Number(readBitsFromU128(bits, bitPos, numBits)); bitPos += numBits;
        }
    }

    // Interpolate and write pixels
    const partTable = m.ns === 1 ? null : m.ns === 2 ? BC7_PARTITION_TABLE_2 : BC7_PARTITION_TABLE_3;

    for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
            const fx = px + x, fy = py + y;
            if (fx >= w || fy >= h) continue;

            const pixIdx = y * 4 + x;

            // Determine which subset this pixel belongs to
            let subset = 0;
            if (m.ns > 1) {
                const partVal = partTable[partition];
                if (m.ns === 2) {
                    subset = (partVal >> pixIdx) & 1;
                } else {
                    subset = (partVal >> (pixIdx * 2)) & 3;
                }
            }

            const ep0 = endpoints[subset * 2];
            const ep1 = endpoints[subset * 2 + 1];

            // Get color/alpha indices based on mode
            let colorIdx, alphaIdx;
            if (m.ib2 > 0) {
                if (indexSel === 0) {
                    colorIdx = indices[pixIdx];
                    alphaIdx = indices2[pixIdx];
                } else {
                    colorIdx = indices2[pixIdx];
                    alphaIdx = indices[pixIdx];
                }
            } else {
                colorIdx = indices[pixIdx];
                alphaIdx = colorIdx;
            }

            // Interpolate color
            const colorWeight = getWeight(colorIdx, m.ib2 > 0 && indexSel === 1 ? m.ib2 : m.ib);
            const alphaWeight = m.ib2 > 0 ? getWeight(alphaIdx, indexSel === 0 ? m.ib2 : m.ib) : colorWeight;

            const r = interpolate(ep0[0], ep1[0], colorWeight);
            const g = interpolate(ep0[1], ep1[1], colorWeight);
            const b = interpolate(ep0[2], ep1[2], colorWeight);
            let a = m.ab > 0 ? interpolate(ep0[3], ep1[3], alphaWeight) : 255;

            // Apply rotation
            let finalR = r, finalG = g, finalB = b, finalA = a;
            if (rotation === 1) { finalA = r; finalR = a; }
            else if (rotation === 2) { finalA = g; finalG = a; }
            else if (rotation === 3) { finalA = b; finalB = a; }

            const off = (fy * w + fx) * 4;
            out[off] = finalR;
            out[off + 1] = finalG;
            out[off + 2] = finalB;
            out[off + 3] = finalA;
        }
    }
}

// ============ Helpers ============

function readBitsFromU128(value, bitPos, numBits) {
    if (numBits === 0) return 0n;
    const mask = (1n << BigInt(numBits)) - 1n;
    return (value >> BigInt(bitPos)) & mask;
}

function expandBits(value, fromBits) {
    if (fromBits >= 8) return value & 0xFF;
    if (fromBits === 0) return 0;
    // Expand by replicating top bits into lower positions
    let result = value << (8 - fromBits);
    result |= result >> fromBits;
    return result & 0xFF;
}

const WEIGHT_TABLES = {
    2: [0, 21, 43, 64],
    3: [0, 9, 18, 27, 37, 46, 55, 64],
    4: [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64],
};

function getWeight(index, indexBits) {
    const table = WEIGHT_TABLES[indexBits];
    if (!table || index >= table.length) return 0;
    return table[index];
}

function interpolate(e0, e1, weight) {
    return ((64 - weight) * e0 + weight * e1 + 32) >> 6;
}

function getAnchorIndices(numSubsets, partition) {
    const anchors = [0]; // First pixel is always an anchor
    if (numSubsets >= 2) anchors.push(ANCHOR_2[partition]);
    if (numSubsets >= 3) {
        anchors.push(ANCHOR_3A[partition]);
        anchors.push(ANCHOR_3B[partition]);
    }
    return anchors;
}

function fillBlock(px, py, w, h, out, r, g, b, a) {
    for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
            const fx = px + x, fy = py + y;
            if (fx >= w || fy >= h) continue;
            const off = (fy * w + fx) * 4;
            out[off] = r; out[off + 1] = g; out[off + 2] = b; out[off + 3] = a;
        }
    }
}

function unpackR5G6B5(c) {
    return [
        ((c >> 11) & 0x1F) * 255 / 31,
        ((c >> 5) & 0x3F) * 255 / 63,
        (c & 0x1F) * 255 / 31,
        255,
    ];
}

function mixColors(c0, c1, w0, w1) {
    const total = w0 + w1;
    return [
        (c0[0] * w0 + c1[0] * w1) / total,
        (c0[1] * w0 + c1[1] * w1) / total,
        (c0[2] * w0 + c1[2] * w1) / total,
        255,
    ];
}

module.exports = { decodeDDS, parseDDSHeader };
