/**
 * Icon Extractor - extracts item icons from Elden Ring game files.
 * 
 * Pipeline:
 * 1. Decompress menu/hi/01_common.tpf.dcx → TPF with multiple SB_Icon atlas textures
 * 2. Decompress menu/hi/01_common.sblytbnd.dcx → layout XMLs mapping icons to atlas positions
 * 3. For each atlas: decode DDS → crop individual icons → save as PNG
 */
const fs = require('fs');
const path = require('path');
const { findEldenRingDir, findOodleDll } = require('./gameDetector');
const { decompressDCX, isDCX } = require('./dcxDecompressor');
const { parseTPF } = require('./tpfParser');
const { decodeDDS } = require('./ddsDecoder');
const { parseLayoutBundle } = require('./layoutParser');
const { encodePNG } = require('./pngEncoder');

const GRID_SPACING = 164;
const GRID_ICON_SIZE = 160;

class IconExtractor {
    constructor(cacheDir) {
        this.cacheDir = cacheDir;
        this.gameDir = null;
        this.oodleDll = null;
        this.iconMap = new Map();
        this.status = 'idle';
        this.error = null;
        this.progress = { current: 0, total: 0, phase: '' };
    }

    getCacheDir() {
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
        return this.cacheDir;
    }

    isReady() {
        const manifestPath = path.join(this.getCacheDir(), 'manifest.json');
        if (fs.existsSync(manifestPath)) {
            try {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
                if (manifest.iconCount > 0) {
                    const cacheDir = this.getCacheDir();
                    const validMap = new Map();
                    for (const [id, fname] of Object.entries(manifest.icons || {})) {
                        if (fs.existsSync(path.join(cacheDir, fname))) {
                            validMap.set(id, fname);
                        }
                    }
                    this.iconMap = validMap;
                    if (validMap.size > 0) {
                        this.status = 'ready';
                        return true;
                    }
                }
            } catch { /* ignore corrupt manifest */ }
        }
        return false;
    }

    getIconPath(iconId) {
        const id = String(iconId).padStart(5, '0');
        const fname = `icon_${id}.png`;
        const fpath = path.join(this.getCacheDir(), fname);
        if (fs.existsSync(fpath)) return fpath;
        const altFname = this.iconMap.get(String(iconId));
        if (altFname) {
            const altPath = path.join(this.getCacheDir(), altFname);
            if (fs.existsSync(altPath)) return altPath;
        }
        return null;
    }

    detect() {
        this.status = 'detecting';
        this.progress = { current: 0, total: 3, phase: 'Detectando instalação...' };

        this.gameDir = findEldenRingDir();
        if (!this.gameDir) {
            this.status = 'error';
            this.error = 'Elden Ring não encontrado. Verifique sua instalação Steam.';
            return false;
        }

        this.oodleDll = findOodleDll(this.gameDir);
        this.progress.current = 1;
        this.progress.phase = `Jogo encontrado: ${this.gameDir}`;

        return true;
    }

    async extract(onProgress) {
        const report = (phase, current, total) => {
            this.progress = { phase, current, total };
            if (onProgress) onProgress(this.progress);
        };

        try {
            this.status = 'extracting';

            if (!this.gameDir) {
                if (!this.detect()) throw new Error(this.error);
            }
            report('Jogo detectado', 1, 7);

            report('Descomprimindo texturas (01_common.tpf.dcx)...', 2, 7);
            const textures = this.loadAllTextures();
            if (!textures || textures.length === 0) {
                throw new Error(
                    `Não foi possível encontrar texturas de ícones em: ${this.gameDir}. ` +
                    `Verifique se a pasta contém menu/hi/01_common.tpf.dcx.`
                );
            }

            const iconTextures = textures.filter(t => /^SB_Icon/i.test(t.name));
            console.log(`[IconExtractor] Found ${iconTextures.length} icon atlas textures out of ${textures.length} total`);

            report('Lendo layout dos ícones (sblytbnd)...', 3, 7);
            const iconLayout = this.extractLayout();
            console.log(`[IconExtractor] Layout has ${iconLayout ? iconLayout.size : 0} entries`);

            report('Organizando mapa de ícones...', 4, 7);
            const byAtlas = new Map();
            if (iconLayout) {
                for (const [, info] of iconLayout) {
                    if (info.iconId == null) continue;
                    const atlasKey = info.atlas
                        ? info.atlas.replace(/\.(png|dds)$/i, '')
                        : null;
                    if (!atlasKey) continue;
                    if (!byAtlas.has(atlasKey)) byAtlas.set(atlasKey, []);
                    byAtlas.get(atlasKey).push(info);
                }
            }
            console.log(`[IconExtractor] Icons grouped into ${byAtlas.size} atlas keys:`,
                [...byAtlas.entries()].map(([k, v]) => `${k}(${v.length})`).join(', '));

            let totalSaved = 0;
            const cacheDir = this.getCacheDir();
            const totalAtlases = iconTextures.length;

            for (let ai = 0; ai < iconTextures.length; ai++) {
                const tex = iconTextures[ai];
                report(`Decodificando atlas ${ai + 1}/${totalAtlases}: ${tex.name}...`, 5, 7);

                let decoded;
                try {
                    decoded = decodeDDS(tex.data);
                } catch (err) {
                    console.warn(`[IconExtractor] Failed to decode ${tex.name}: ${err.message}`);
                    continue;
                }
                console.log(`[IconExtractor] ${tex.name}: ${decoded.width}x${decoded.height}`);

                const layoutEntries = (byAtlas.get(tex.name) || [])
                    .filter(e => /MENU_ItemIcon/i.test(e.name));

                const coveredCells = new Set();
                for (const info of layoutEntries) {
                    const { x, y, width, height, iconId } = info;
                    if (width <= 0 || height <= 0) continue;
                    if (x + width > decoded.width || y + height > decoded.height) continue;

                    const col = Math.round(x / GRID_SPACING);
                    const row = Math.round(y / GRID_SPACING);
                    coveredCells.add(`${col},${row}`);

                    if (this.iconMap.has(String(iconId))) continue;

                    try {
                        const iconPixels = cropRegion(decoded.pixels, decoded.width, x, y, width, height);
                        const png = encodePNG(width, height, iconPixels);
                        const fname = `icon_${String(iconId).padStart(5, '0')}.png`;
                        fs.writeFileSync(path.join(cacheDir, fname), png);
                        this.iconMap.set(String(iconId), fname);
                        totalSaved++;
                    } catch (err) {
                        console.warn(`[IconExtractor] Failed to crop icon ${iconId}: ${err.message}`);
                    }
                }

                const gridCount = this.cropIconsGridUncovered(decoded, tex.name, coveredCells);
                totalSaved += gridCount;
                console.log(`[IconExtractor] ${tex.name}: ${layoutEntries.length} layout + ${gridCount} grid = ${layoutEntries.length + gridCount}`);
            }

            const charaTextures = textures.filter(t => /^SB_Chara/i.test(t.name));
            for (const tex of charaTextures) {
                const layoutEntries = byAtlas.get(tex.name) || [];
                const itemIcons = layoutEntries.filter(e => e.iconId != null && /ItemIcon/i.test(e.name));
                if (itemIcons.length === 0) continue;

                report(`Extraindo ícones de ${tex.name}...`, 6, 7);
                let decoded;
                try {
                    decoded = decodeDDS(tex.data);
                } catch (err) {
                    console.warn(`[IconExtractor] Failed to decode ${tex.name}: ${err.message}`);
                    continue;
                }

                for (const info of itemIcons) {
                    const { x, y, width, height, iconId } = info;
                    if (width <= 0 || height <= 0) continue;
                    if (x + width > decoded.width || y + height > decoded.height) continue;
                    if (this.iconMap.has(String(iconId))) continue;

                    try {
                        const iconPixels = cropRegion(decoded.pixels, decoded.width, x, y, width, height);
                        const png = encodePNG(width, height, iconPixels);
                        const fname = `icon_${String(iconId).padStart(5, '0')}.png`;
                        fs.writeFileSync(path.join(cacheDir, fname), png);
                        this.iconMap.set(String(iconId), fname);
                        totalSaved++;
                    } catch { /* skip */ }
                }
            }

            report('Salvando manifesto...', 7, 7);
            this.saveManifest(totalSaved);

            this.status = 'ready';
            console.log(`[IconExtractor] Done! ${totalSaved} icons extracted.`);
            return { success: true, count: totalSaved };

        } catch (err) {
            this.status = 'error';
            this.error = err.message;
            console.error('[IconExtractor] Extraction failed:', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Load all textures from 01_common.tpf.dcx
     */
    loadAllTextures() {
        const menuDir = path.join(this.gameDir, 'menu');
        const candidates = [
            path.join(menuDir, 'hi', '01_common.tpf.dcx'),
            path.join(menuDir, '01_common.tpf.dcx'),
        ];

        for (const tpfPath of candidates) {
            if (!fs.existsSync(tpfPath)) continue;
            console.log(`[IconExtractor] Loading TPF: ${tpfPath}`);

            try {
                let data = fs.readFileSync(tpfPath);
                if (isDCX(data)) {
                    console.log(`[IconExtractor] Decompressing DCX (${data.length} bytes)...`);
                    data = decompressDCX(data, this.oodleDll);
                    console.log(`[IconExtractor] Decompressed to ${data.length} bytes`);
                }

                const textures = parseTPF(data);
                console.log(`[IconExtractor] TPF has ${textures.length} textures: ${textures.map(t => t.name).join(', ')}`);
                return textures;
            } catch (err) {
                console.warn(`[IconExtractor] Failed to load ${tpfPath}: ${err.message}`);
            }
        }

        return null;
    }

    extractLayout() {
        const menuDir = path.join(this.gameDir, 'menu');
        const candidates = [
            path.join(menuDir, 'hi', '01_common.sblytbnd.dcx'),
            path.join(menuDir, '01_common.sblytbnd.dcx'),
        ];

        for (const layoutPath of candidates) {
            if (!fs.existsSync(layoutPath)) continue;
            console.log(`[IconExtractor] Loading layout: ${layoutPath}`);

            try {
                let data = fs.readFileSync(layoutPath);
                if (isDCX(data)) {
                    data = decompressDCX(data, this.oodleDll);
                }

                const icons = parseLayoutBundle(data);
                if (icons.size > 0) {
                    console.log(`[IconExtractor] Layout parsed: ${icons.size} entries`);
                    return icons;
                }
            } catch (err) {
                console.warn(`[IconExtractor] Failed to load layout ${layoutPath}: ${err.message}`);
            }
        }

        console.warn('[IconExtractor] No layout files found');
        return null;
    }

    /**
     * Grid-based fallback for atlas textures without layout data.
     * Assigns icon IDs based on atlas name prefix + grid position.
     */
    cropIconsGrid(decoded, atlasName) {
        const cacheDir = this.getCacheDir();
        const cols = Math.floor(decoded.width / GRID_SPACING);
        const rows = Math.floor(decoded.height / GRID_SPACING);

        const baseMatch = atlasName.match(/SB_Icon_(\d+)/i);
        const atlasIdx = baseMatch ? parseInt(baseMatch[1], 10) : 0;
        const suffix = atlasName.replace(/^SB_Icon_\d+/i, '').replace(/_/g, '');
        const suffixOffset = suffix ? 500 : 0;
        const baseId = 50000 + atlasIdx * 1000 + suffixOffset;

        let count = 0;
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const x = col * GRID_SPACING;
                const y = row * GRID_SPACING;

                if (x + GRID_ICON_SIZE > decoded.width || y + GRID_ICON_SIZE > decoded.height) continue;
                if (isTransparent(decoded.pixels, decoded.width, x, y, GRID_ICON_SIZE, GRID_ICON_SIZE)) continue;

                const iconId = baseId + row * cols + col;
                try {
                    const iconPixels = cropRegion(decoded.pixels, decoded.width, x, y, GRID_ICON_SIZE, GRID_ICON_SIZE);
                    const png = encodePNG(GRID_ICON_SIZE, GRID_ICON_SIZE, iconPixels);
                    const fname = `icon_${String(iconId).padStart(5, '0')}.png`;
                    fs.writeFileSync(path.join(cacheDir, fname), png);
                    this.iconMap.set(String(iconId), fname);
                    count++;
                } catch { /* skip */ }
            }
        }

        return count;
    }

    cropIconsGridUncovered(decoded, atlasName, coveredCells) {
        const cacheDir = this.getCacheDir();
        const cols = Math.floor(decoded.width / GRID_SPACING);
        const rows = Math.floor(decoded.height / GRID_SPACING);

        const baseMatch = atlasName.match(/SB_Icon_(\d+)/i);
        const atlasIdx = baseMatch ? parseInt(baseMatch[1], 10) : 0;
        const baseId = 50000 + atlasIdx * 1000;

        let count = 0;
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                if (coveredCells.has(`${col},${row}`)) continue;

                const x = col * GRID_SPACING;
                const y = row * GRID_SPACING;

                if (x + GRID_ICON_SIZE > decoded.width || y + GRID_ICON_SIZE > decoded.height) continue;
                if (isTransparent(decoded.pixels, decoded.width, x, y, GRID_ICON_SIZE, GRID_ICON_SIZE)) continue;

                const iconId = baseId + row * cols + col;
                try {
                    const iconPixels = cropRegion(decoded.pixels, decoded.width, x, y, GRID_ICON_SIZE, GRID_ICON_SIZE);
                    const png = encodePNG(GRID_ICON_SIZE, GRID_ICON_SIZE, iconPixels);
                    const fname = `icon_${String(iconId).padStart(5, '0')}.png`;
                    fs.writeFileSync(path.join(cacheDir, fname), png);
                    this.iconMap.set(String(iconId), fname);
                    count++;
                } catch { /* skip */ }
            }
        }

        if (count > 0) {
            console.log(`[IconExtractor] ${atlasName}: extracted ${count} uncovered grid cells`);
        }
        return count;
    }

    saveManifest(iconCount) {
        const manifest = {
            version: 2,
            gameDir: this.gameDir,
            extractedAt: new Date().toISOString(),
            iconCount,
            icons: Object.fromEntries(this.iconMap),
        };

        fs.writeFileSync(
            path.join(this.getCacheDir(), 'manifest.json'),
            JSON.stringify(manifest, null, 2)
        );
    }

    getStatus() {
        return {
            status: this.status,
            error: this.error,
            progress: this.progress,
            gameDir: this.gameDir,
            iconCount: this.iconMap.size,
            cacheDir: this.cacheDir,
        };
    }

    /**
     * Scan a directory recursively for files matching a pattern.
     */
    scanForFiles(dir, pattern, maxDepth = 4, depth = 0) {
        const results = [];
        if (depth > maxDepth || !fs.existsSync(dir)) return results;
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    results.push(...this.scanForFiles(fullPath, pattern, maxDepth, depth + 1));
                } else if (pattern.test(entry.name)) {
                    results.push(fullPath);
                }
            }
        } catch { /* permission denied, etc */ }
        return results;
    }
}

function cropRegion(pixels, srcWidth, x, y, w, h) {
    const result = Buffer.alloc(w * h * 4);
    for (let row = 0; row < h; row++) {
        const srcOffset = ((y + row) * srcWidth + x) * 4;
        const dstOffset = row * w * 4;
        pixels.copy(result, dstOffset, srcOffset, srcOffset + w * 4);
    }
    return result;
}

function isTransparent(pixels, srcWidth, x, y, w, h) {
    const samples = [[0, 0], [w >> 1, h >> 1], [w - 1, h - 1], [w >> 2, h >> 2]];
    for (const [sx, sy] of samples) {
        const off = ((y + sy) * srcWidth + (x + sx)) * 4;
        if (pixels[off + 3] > 10) return false;
    }
    return true;
}

module.exports = { IconExtractor };
