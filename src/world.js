const DLC_REGIONS = new Set([
    'Gravesite Plain', 'Castle Ensis', 'Scadu Altus', 'Rauh Base', 'Ancient Ruins of Rauh', 'Cerulean Coast',
    "Charo's Hidden Grave", 'Foot of the Jagged Peak', 'Jagged Peak', 'Abyssal Woods', 'Scaduview',
    'Belurat, Tower Settlement', 'Enir-Ilim', 'Shadow Keep', 'Shadow Keep, Church District', 'Specimen Storehouse',
    'Stone Coffin Fissure', "Midra's Manse", 'Finger Birthing Grounds', 'Stone Platform',
]);

const NEAR = {
    'Stormveil Castle': 'Stormhill',
    'Leyndell, Royal Capital': 'Capital Outskirts',
    'Leyndell, Ashen Capital': 'Capital Outskirts',
    'Subterranean Shunning,Grounds': 'Capital Outskirts',
    'Academy of Raya Lucaria': 'Liurnia of the Lakes',
    'Volcano Manor': 'Mt. Gelmir',
    'Stranded Graveyard': 'Limgrave',
    'Ruin,Strewn Precipice': 'Liurnia of the Lakes',
    'Elphael, Brace of the Haligtree': 'Consecrated Snowfield',
    "Miquella's Haligtree": 'Consecrated Snowfield',
    'Belurat, Tower Settlement': 'Gravesite Plain',
    'Shadow Keep': 'Scadu Altus',
    'Shadow Keep, Church District': 'Scadu Altus',
    'Specimen Storehouse': 'Scadu Altus',
    "Midra's Manse": 'Abyssal Woods',
    'Stone Coffin Fissure': 'Cerulean Coast',
};

const UNDERGROUND = new Set(['Ainsel River', 'Ainsel River Main', 'Lake of Rot', 'Nokron, Eternal City', 'Siofra River', 'Deeproot Depths', 'Mohgwyn Palace']);

export function pretty(text = '') {
    return text.replace(/,(?=\S)/g, '-');
}

export function splitName(name = '') {
    const match = /^\[([^\]]+)\]\s*(.*)$/.exec(name);
    return match ? { region: match[1].trim(), place: match[2].trim() } : { region: 'Outros', place: name };
}

export function isDlcRegion(region) {
    return DLC_REGIONS.has(region);
}

export function tileOf(id) {
    if (id < 10_000_000) return null;
    return { x: Math.floor(id / 10000) % 100, z: Math.floor(id / 100) % 100 };
}

export function locate(grace) {
    const { region, place } = splitName(grace.name);
    const tile = tileOf(grace.id);
    if (tile) return { region, place, kind: 'exact', tile, dlc: isDlcRegion(region) };
    if (UNDERGROUND.has(region)) return { region, place, kind: 'underground', dlc: false };
    const near = NEAR[region] || region;
    return { region, place, kind: 'near', near, dlc: isDlcRegion(region) || isDlcRegion(near) };
}
