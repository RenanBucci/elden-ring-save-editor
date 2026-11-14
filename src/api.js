function tauriCall(method, args) {
    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke) return Promise.resolve(null);
    const commands = {
        itemIcon: (id) => invoke('item_icon', { id }),
        detect: () => invoke('detect'),
        openSave: (file) => invoke('open_save', { file }),
        slots: () => invoke('slots'),
        saveCopy: () => invoke('save_copy'),
        operations: () => invoke('operations'),
        world: () => invoke('world'),
        character: (slot) => invoke('character', { slot }),
        inventory: (slot, container) => invoke('inventory', { slot, container }),
        equipment: (slot) => invoke('equipment', { slot }),
        catalogAll: (lang) => invoke('catalog_all', { lang }),
        worldMap: () => invoke('world_map'),
        worldMapImage: (file) => invoke('world_map_image', { file }),
        appearance: (slot) => invoke('appearance', { slot }),
        flags: (slot, ids) => invoke('flags', { slot, ids }),
        apply: (request) => invoke('apply', { request }),
        undo: () => invoke('undo'),
        catalogBuild: () => invoke('catalog_build'),
        catalogSearch: (lang, query) => invoke('catalog_search', { lang, query }),
        backups: () => invoke('backups'),
        backupNow: (label) => invoke('backup_now', { label }),
        restore: (file) => invoke('restore', { file }),
        prune: (dryRun) => invoke('prune', { dryRun }),
        deleteSave: () => invoke('delete_save'),
        exportSlot: (slot) => invoke('export_slot', { slot }),
        saveText: (name, text) => invoke('save_text', { name, text }),
        importCharacter: (data, from, to) => invoke('import_character', { data, from, to }),
        modsStatus: (gameDir) => invoke('mods_status', { gameDir }),
        modsApply: (gameDir, preset) => invoke('mods_apply', { gameDir, preset }),
        modsRevert: (gameDir) => invoke('mods_revert', { gameDir }),
        buildGameData: () => invoke('catalog_build'),
    };
    const command = commands[method];
    if (!command) return Promise.resolve({ ok: false, error: 'Comando ainda não ligado ao núcleo Rust.' });
    return command(...args).catch((error) => ({ ok: false, error: String(error) }));
}

export function toBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let text = '';
    for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
    return btoa(text);
}

export function call(method, ...args) {
    if (typeof window !== 'undefined' && window.__TAURI__?.core?.invoke) return tauriCall(method, args);
    const api = typeof window !== 'undefined' ? window.api : null;
    if (!api || typeof api[method] !== 'function') return Promise.resolve(null);
    return Promise.resolve().then(() => api[method](...args)).catch((error) => ({ ok: false, error: error.message }));
}
