/**
 * BHD5/BDT archive reader for Elden Ring.
 *
 * Elden Ring stores most game assets inside Data0-3.bdt (+ DLC.bdt, sd.bdt).
 * Each .bdt has a companion .bhd header that maps virtual file paths (as hashes)
 * to offsets/sizes within the .bdt.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ER_AES_KEYS = {
    'Data0': Buffer.from('4B034F7482A28F49BFC23B42916E75FE1C606C4E0CF39AF06994D4E33B36D6A8', 'hex'),
    'Data1': Buffer.from('7869B4E05B2F78B2D4C7D2D900519C51FED5B3049CCB40B88CC33CDFA2A01413', 'hex'),
    'Data2': Buffer.from('408D17A6E3CF7E8A9C2DD0EAEC10761C13C45B1AEF2B4D2FA0A93A4E6B72D59A', 'hex'),
    'Data3': Buffer.from('A35CF24B2A7DC18F2A5EB1386C24AEB669E42E3C46B2C01C1C1C0C19C8CFAC24', 'hex'),
    'DLC':   Buffer.from('3C23F983571C4A4E4EA7DA4AA66F43E6C9AA5E0DCAAD068FD42B7D0617C8DA83', 'hex'),
};

/**
 * 64-bit polynomial hash used by FromSoft for file path lookup.
 */
function hashPath64(filePath) {
    const normalized = filePath.toLowerCase().replace(/\//g, '\\');
    let hash = 0n;
    for (let i = 0; i < normalized.length; i++) {
        hash = ((hash * 37n) + BigInt(normalized.charCodeAt(i))) & 0xFFFFFFFFFFFFFFFFn;
    }
    return hash;
}

/**
 * Parse a BHD5 header and return all file entries.
 * Supports variable entry sizes found across FromSoft games.
 */
function parseBHD5(bhdPath) {
    const buf = fs.readFileSync(bhdPath);

    const magic = buf.toString('ascii', 0, 4);
    if (magic !== 'BHD5') {
        throw new Error(`Not a BHD5 file: ${magic}`);
    }

    const bigEndian = buf[0x05] !== 0;
    const r32 = bigEndian ? (o) => buf.readInt32BE(o) : (o) => buf.readInt32LE(o);
    const ru32 = bigEndian ? (o) => buf.readUInt32BE(o) : (o) => buf.readUInt32LE(o);
    const ru64 = bigEndian ? (o) => buf.readBigUInt64BE(o) : (o) => buf.readBigUInt64LE(o);

    const bucketCount = r32(0x0C);

    console.log(`[BHD5] File: ${path.basename(bhdPath)}, size=${buf.length}, buckets=${bucketCount}, bigEndian=${bigEndian}`);

    const entries = [];

    // Bucket table starts at offset 0x10
    for (let b = 0; b < bucketCount; b++) {
        const bucketOff = 0x10 + b * 8;
        if (bucketOff + 8 > buf.length) break;

        const entryCount = r32(bucketOff);
        const entriesOffset = ru32(bucketOff + 4);

        if (entryCount <= 0 || entriesOffset >= buf.length) continue;

        for (let e = 0; e < entryCount; e++) {
            // Try multiple entry sizes - ER typically uses 24-byte entries
            // Format: hash(8) + paddedSize(4) + padding(4) + offset(8) = 24
            // Some have: hash(8) + paddedSize(4) + padding(4) + offset(8) + salt(8) + aesCount(4) = 36
            const entryOff = entriesOffset + e * 24;
            if (entryOff + 24 > buf.length) break;

            try {
                const fileHash = ru64(entryOff);
                const paddedSize = ru32(entryOff + 0x08);
                const dataOffset = Number(ru64(entryOff + 0x10));

                if (paddedSize === 0 || dataOffset < 0) continue;

                entries.push({
                    hash: fileHash,
                    paddedSize,
                    dataOffset,
                    encrypted: false,
                    aesRanges: [],
                });
            } catch {
                // Skip bad entries
            }
        }
    }

    // If we got very few entries, the entry size might be 36 bytes instead of 24
    if (entries.length < 10) {
        console.log(`[BHD5] Only ${entries.length} entries with 24-byte stride, trying 36-byte stride...`);
        entries.length = 0;

        for (let b = 0; b < bucketCount; b++) {
            const bucketOff = 0x10 + b * 8;
            if (bucketOff + 8 > buf.length) break;

            const entryCount = r32(bucketOff);
            const entriesOffset = ru32(bucketOff + 4);

            if (entryCount <= 0 || entriesOffset >= buf.length) continue;

            for (let e = 0; e < entryCount; e++) {
                const entryOff = entriesOffset + e * 36;
                if (entryOff + 36 > buf.length) break;

                try {
                    const fileHash = ru64(entryOff);
                    const paddedSize = ru32(entryOff + 0x08);
                    const dataOffset = Number(ru64(entryOff + 0x10));
                    const aesRangeCount = r32(entryOff + 0x20);

                    if (paddedSize === 0 || dataOffset < 0) continue;

                    const aesRanges = [];
                    for (let a = 0; a < aesRangeCount && a < 8; a++) {
                        const rangeOff = entryOff + 0x24 + a * 8;
                        if (rangeOff + 8 > buf.length) break;
                        aesRanges.push({
                            start: r32(rangeOff),
                            length: r32(rangeOff + 4),
                        });
                    }

                    entries.push({
                        hash: fileHash,
                        paddedSize,
                        dataOffset,
                        encrypted: aesRangeCount > 0,
                        aesRanges,
                    });
                } catch {
                    // Skip
                }
            }
        }
    }

    console.log(`[BHD5] Parsed ${entries.length} entries from ${path.basename(bhdPath)}`);
    return entries;
}

/**
 * Read raw file data from a BDT archive given a BHD5 entry.
 */
function readFromBDT(bdtPath, entry, aesKey) {
    const fd = fs.openSync(bdtPath, 'r');
    try {
        const size = entry.paddedSize;
        const buffer = Buffer.alloc(size);
        fs.readSync(fd, buffer, 0, size, entry.dataOffset);

        // Decrypt AES ranges if needed
        if (entry.encrypted && aesKey && entry.aesRanges.length > 0) {
            for (const range of entry.aesRanges) {
                if (range.start + range.length > buffer.length) continue;
                if (range.length < 16) continue;
                try {
                    const iv = Buffer.alloc(16, 0);
                    const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
                    decipher.setAutoPadding(false);
                    const alignedLen = Math.floor(range.length / 16) * 16;
                    const enc = buffer.subarray(range.start, range.start + alignedLen);
                    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
                    dec.copy(buffer, range.start, 0, alignedLen);
                } catch { /* decryption failed for this range */ }
            }
        }

        return buffer;
    } finally {
        fs.closeSync(fd);
    }
}

/**
 * Try to decrypt an entire buffer with AES-256-CBC (for files with no marked ranges).
 */
function tryFullDecrypt(buffer, aesKey) {
    if (!aesKey || buffer.length < 16) return null;
    try {
        const iv = Buffer.alloc(16, 0);
        const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
        decipher.setAutoPadding(false);
        const alignedLen = Math.floor(buffer.length / 16) * 16;
        return Buffer.concat([
            decipher.update(buffer.subarray(0, alignedLen)),
            decipher.final(),
        ]);
    } catch {
        return null;
    }
}

const KNOWN_MAGICS = new Set(['DCX\0', 'TPF\0', 'BND4', 'DDS ']);

function hasKnownMagic(buf) {
    if (!buf || buf.length < 4) return false;
    const magic = buf.toString('ascii', 0, 4);
    return KNOWN_MAGICS.has(magic) || magic.startsWith('TPF') || magic.startsWith('BND');
}

/**
 * Search for a specific virtual file path across all BDT archives.
 * Tries multiple path normalizations.
 */
function extractFileFromArchives(gameDir, virtualPath) {
    // Generate all hash variants for this path
    const pathVariants = [
        virtualPath,                                             // /menu/hi/01_common.tpf.dcx
        virtualPath.replace(/^\//, ''),                          // menu/hi/01_common.tpf.dcx
        virtualPath.replace(/\//g, '\\'),                        // \menu\hi\01_common.tpf.dcx
        virtualPath.replace(/^\//, '').replace(/\//g, '\\'),     // menu\hi\01_common.tpf.dcx
    ];

    const targetHashes = new Set(pathVariants.map(p => hashPath64(p)));
    console.log(`[BHD5] Looking for "${virtualPath}" with ${targetHashes.size} hash variants:`);
    for (const h of targetHashes) {
        console.log(`  hash: 0x${h.toString(16).padStart(16, '0')}`);
    }

    const archiveOrder = ['Data3', 'Data1', 'Data2', 'Data0', 'DLC'];

    for (const name of archiveOrder) {
        const bhdPath = path.join(gameDir, `${name}.bhd`);
        const bdtPath = path.join(gameDir, `${name}.bdt`);
        if (!fs.existsSync(bhdPath) || !fs.existsSync(bdtPath)) continue;

        try {
            const entries = parseBHD5(bhdPath);

            for (const targetHash of targetHashes) {
                const match = entries.find(e => e.hash === targetHash);
                if (!match) continue;

                console.log(`[BHD5] MATCH in ${name}! offset=${match.dataOffset}, size=${match.paddedSize}, encrypted=${match.encrypted}`);

                const aesKey = ER_AES_KEYS[name] || null;
                let data = readFromBDT(bdtPath, match, aesKey);
                const magic = data.toString('ascii', 0, 4);
                console.log(`[BHD5] Data magic: "${magic}" (0x${data.slice(0, 4).toString('hex')}), ${data.length} bytes`);

                if (hasKnownMagic(data)) return data;

                // Might be fully encrypted without marked ranges
                const decrypted = tryFullDecrypt(data, aesKey);
                if (decrypted && hasKnownMagic(decrypted)) {
                    console.log(`[BHD5] Full AES decrypt succeeded! Magic: ${decrypted.toString('ascii', 0, 4)}`);
                    return decrypted;
                }

                console.warn(`[BHD5] Extracted but unrecognized format from ${name}`);
            }
        } catch (err) {
            console.warn(`[BHD5] Error reading ${name}: ${err.message}`);
        }
    }

    return null;
}

/**
 * Quick summary of all BDT archives for diagnostics.
 */
function listArchiveContents(gameDir) {
    const results = {};
    for (const name of ['Data0', 'Data1', 'Data2', 'Data3', 'DLC']) {
        const bhdPath = path.join(gameDir, `${name}.bhd`);
        if (!fs.existsSync(bhdPath)) continue;
        try {
            const entries = parseBHD5(bhdPath);
            results[name] = {
                entries: entries.length,
                encrypted: entries.filter(e => e.encrypted).length,
            };
        } catch (err) {
            results[name] = { error: err.message };
        }
    }
    return results;
}

module.exports = { extractFileFromArchives, parseBHD5, listArchiveContents, hashPath64 };
