/**
 * Detects the Elden Ring game installation directory via Steam's libraryfolders.vdf.
 * Also locates the Oodle DLL (oo2core_6_win64.dll) shipped with the game.
 */
const fs = require('fs');
const path = require('path');

const STEAM_APP_ID = '1245620'; // Elden Ring

function findSteamPath() {
    const candidates = [
        path.join(process.env.ProgramFiles || '', 'Steam'),
        path.join(process.env['ProgramFiles(x86)'] || '', 'Steam'),
        'C:\\Program Files (x86)\\Steam',
        'C:\\Program Files\\Steam',
        'D:\\Steam',
        'E:\\Steam',
        'D:\\SteamLibrary',
        'E:\\SteamLibrary',
    ];

    for (const p of candidates) {
        if (fs.existsSync(path.join(p, 'steam.exe')) || fs.existsSync(path.join(p, 'steamapps'))) {
            return p;
        }
    }
    return null;
}

function parseLibraryFolders(steamPath) {
    const vdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
    if (!fs.existsSync(vdfPath)) return [steamPath];

    const content = fs.readFileSync(vdfPath, 'utf-8');
    const paths = [steamPath];

    // Simple VDF parser: extract "path" values
    const pathRegex = /"path"\s+"([^"]+)"/gi;
    let match;
    while ((match = pathRegex.exec(content)) !== null) {
        const libPath = match[1].replace(/\\\\/g, '\\');
        if (!paths.includes(libPath)) paths.push(libPath);
    }

    return paths;
}

function findEldenRingDir() {
    const steamPath = findSteamPath();
    if (!steamPath) return null;

    const libraries = parseLibraryFolders(steamPath);

    for (const lib of libraries) {
        // Check standard Steam app location
        const gamePath = path.join(lib, 'steamapps', 'common', 'ELDEN RING', 'Game');
        if (fs.existsSync(gamePath)) return gamePath;

        // Also check without 'Game' subfolder
        const altPath = path.join(lib, 'steamapps', 'common', 'ELDEN RING');
        if (fs.existsSync(altPath) && fs.existsSync(path.join(altPath, 'eldenring.exe'))) {
            return altPath;
        }
    }

    return null;
}

function findOodleDll(gameDir) {
    if (!gameDir) return null;

    const candidates = [
        path.join(gameDir, 'oo2core_6_win64.dll'),
        path.join(gameDir, '..', 'oo2core_6_win64.dll'),
        path.join(gameDir, 'oo2core_8_win64.dll'),
    ];

    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

function getIconAssetsPath(gameDir) {
    if (!gameDir) return null;
    const menuHi = path.join(gameDir, 'menu', 'hi');
    if (fs.existsSync(menuHi)) return menuHi;

    // Some installations have different structure
    const altMenu = path.join(gameDir, 'menu');
    if (fs.existsSync(altMenu)) return altMenu;

    return null;
}

module.exports = { findEldenRingDir, findOodleDll, findSteamPath, getIconAssetsPath };
