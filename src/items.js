import { useEffect, useMemo, useState } from 'react';
import { call } from './api';
import { translateText } from './i18n';

export const CATEGORIES = [
    ['weapon', 'Armas'],
    ['shield', 'Escudos'],
    ['catalyst', 'Cajados e selos'],
    ['ammo', 'Flechas e virotes'],
    ['armor', 'Armaduras'],
    ['talisman', 'Talismãs'],
    ['ash', 'Cinzas de Guerra'],
    ['spirit', 'Cinzas Espirituais'],
    ['sorcery', 'Feitiços'],
    ['incantation', 'Encantamentos'],
    ['consumable', 'Consumíveis'],
    ['material', 'Materiais'],
    ['key', 'Itens-chave'],
];

const LABELS = Object.fromEntries(CATEGORIES);

export const AFFINITIES = ['Padrão', 'Pesada', 'Afiada', 'Qualidade', 'Fogo', 'Arte flamejante', 'Raio', 'Sagrada', 'Mágica', 'Gélida', 'Veneno', 'Sangue', 'Oculta'];

const NOT_UPGRADABLE = new Set([110000, 12500000, 14500000, 16500000, 30510000, 63500000, 64510000]);
const VARIANT = /^(.*?)\s*\+\s*(\d+)$/;

export function categoryLabel(category, lang = 'pt-BR') {
    return translateText(lang, LABELS[category] || category);
}

export function weaponParts(id) {
    const rest = id % 10000;
    return { base: id - rest, infusion: Math.floor(rest / 100), level: rest % 100 };
}

// Internal equipment placeholders and the special multiplayer row are not editable items.
export function isInternalItem(item, data) {
    if (item.kind === 'weapon') return weaponParts(item.paramId).base === 110000;
    if (item.kind === 'armor') return item.paramId < 20000;
    return item.kind === 'goods' && (item.paramId === 166 || data?.metaOf(item.kind, item.paramId)?.goodsType === 13);
}

export function categoryOf(kind, meta) {
    if (kind === 'weapon') {
        const label = meta?.wepTypeLabel || '';
        if (/Arrow|Bolt/.test(label)) return 'ammo';
        if (/Shield/.test(label) || meta?.wepType === 90) return 'shield';
        if (/Staff|Seal/.test(label)) return 'catalyst';
        return 'weapon';
    }
    if (kind === 'armor' || kind === 'talisman' || kind === 'ash') return kind;
    const type = meta?.goodsType;
    if (type === 5 || type === 17) return 'sorcery';
    if (type === 16 || type === 18) return 'incantation';
    if (type === 7 || type === 8) return 'spirit';
    if (type === 2 || type === 14) return 'material';
    if (type === 1 || type === 3 || type === 12 || type === 15) return 'key';
    return 'consumable';
}

let paramsPromise = null;
function loadParams() {
    paramsPromise ||= fetch('/data/itemParams.json').then((res) => res.json()).catch(() => null);
    return paramsPromise;
}

export function buildItemData(params, rows, lang = 'pt-BR') {
    const meta = new Map();
    const names = new Map();
    const dlc = new Set();
    const affinities = new Map();
    for (const [kind, key] of [['weapon', 'weapons'], ['armor', 'armor'], ['talisman', 'accessories'], ['goods', 'goods'], ['ash', 'gems']]) {
        for (const item of params?.[key] || []) {
            meta.set(`${kind}:${item.paramId}`, item);
            if (item.name && lang !== 'en') names.set(`${kind}:${item.paramId}`, item.name);
            if (kind === 'weapon') {
                const { base, infusion } = weaponParts(item.paramId);
                if (!affinities.has(base)) affinities.set(base, new Set());
                affinities.get(base).add(infusion);
            }
        }
    }
    for (const [rawKind, id, name, isDlc] of rows || []) {
        const kind = rawKind === 'gem' ? 'ash' : rawKind;
        names.set(`${kind}:${id}`, name);
        if (isDlc) dlc.add(`${kind}:${id}`);
    }

    const variants = new Map();
    const baseOf = new Map();
    const catalog = [];
    const seen = new Set();
    const push = (kind, id, item) => {
        if (isInternalItem({kind, paramId: id}) || (kind === 'goods' && item?.goodsType === 13)) return;
        const key = `${kind}:${id}`;
        const name = names.get(key) || (item ? `${categoryLabel(categoryOf(kind, item), lang)} #${id}` : null);
        if (!name) return;
        const category = categoryOf(kind, item);
        if (kind === 'armor' && id < 20000) return;
        if (category === 'spirit') {
            const match = VARIANT.exec(name);
            if (match) {
                const base = `${match[1]}|${category}`;
                if (!variants.has(base)) variants.set(base, []);
                variants.get(base).push({ paramId: id, level: Number(match[2]) });
                return;
            }
        }
        const unique = `${category}|${name}`;
        if (seen.has(unique)) return;
        seen.add(unique);
        catalog.push({
            key, kind, paramId: id, name, category,
            categoryLabel: categoryLabel(category, lang),
            iconId: item?.iconId,
            maxNum: kind === 'goods' ? (item?.maxNum || 999) : (category === 'ammo' ? 99 : 1),
            dlc: dlc.has(key),
        });
    };
    for (const item of params?.weapons || []) if (item.paramId % 10000 === 0) push('weapon', item.paramId, item);
    for (const item of params?.armor || []) push('armor', item.paramId, item);
    for (const item of params?.accessories || []) push('talisman', item.paramId, item);
    for (const item of params?.goods || []) if (item.paramId < 9000 || item.paramId >= 10000) push('goods', item.paramId, item);
    for (const [rawKind, id] of rows || []) if (rawKind === 'gem' && id >= 10000) push('ash', id, meta.get(`ash:${id}`));

    for (const entry of catalog) {
        if (entry.category !== 'spirit') continue;
        const list = variants.get(`${entry.name}|spirit`);
        if (!list) continue;
        entry.variants = [{ paramId: entry.paramId, level: 0 }, ...list.sort((a, b) => a.level - b.level)];
        for (const variant of list) baseOf.set(`goods:${variant.paramId}`, entry.paramId);
    }
    catalog.sort((a, b) => a.name.localeCompare(b.name, lang));
    const byKey = new Map(catalog.map((entry) => [entry.key, entry]));

    return {
        catalog, lang,
        entry(kind, id) {
            return byKey.get(`${kind}:${id}`) || null;
        },
        fromGame: !!rows?.length,
        nameOf(kind, id) {
            if (kind === 'weapon') {
                const { base, infusion, level } = weaponParts(id);
                const name = names.get(`weapon:${base + infusion * 100}`) || names.get(`weapon:${base}`);
                if (!name) return null;
                const prefix = infusion && !names.has(`weapon:${base + infusion * 100}`) ? `${translateText(lang, AFFINITIES[infusion])} · ` : '';
                return `${prefix}${name}${level ? ` +${level}` : ''}`;
            }
            return names.get(`${kind}:${id}`) || null;
        },
        metaOf(kind, id) {
            return meta.get(`${kind}:${kind === 'weapon' ? weaponParts(id).base : id}`) || null;
        },
        affinitiesOf(base) {
            return [...(affinities.get(base) || [0])].sort((a, b) => a - b);
        },
        maxLevel(base, current = 0) {
            if (NOT_UPGRADABLE.has(base)) return current;
            return Math.max((affinities.get(base)?.size || 0) > 1 ? 25 : 10, current);
        },
        ownedKey(kind, id) {
            if (kind === 'weapon') return `weapon:${weaponParts(id).base}`;
            const base = baseOf.get(`${kind}:${id}`);
            return `${kind}:${base ?? id}`;
        },
        isDlc(kind, id) {
            return dlc.has(`${kind}:${kind === 'weapon' ? weaponParts(id).base : id}`);
        },
    };
}

export function describe(data, item) {
    const meta = data?.metaOf(item.kind, item.paramId);
    const category = categoryOf(item.kind, meta);
    return {
        ...item,
        key: `${item.container || 'x'}-${item.index ?? item.slot}-${item.handle ?? item.paramId}`,
        name: data?.nameOf(item.kind, item.paramId) || `${categoryLabel(category, data?.lang)} #${item.paramId}`,
        iconId: meta?.iconId,
        category,
        categoryLabel: categoryLabel(category, data?.lang),
        maxNum: item.kind === 'goods' ? (meta?.maxNum || 999) : (category === 'ammo' ? 99 : 1),
        dlc: data?.isDlc(item.kind, item.paramId) || false,
    };
}

export function useViewMode(key, fallback = 'medium') {
    const [mode, setMode] = useState(() => {
        try {
            const saved = localStorage.getItem(key);
            return ['large', 'medium', 'table'].includes(saved) ? saved : fallback;
        } catch { return fallback; }
    });
    return [mode, (next) => {
        if (!['large', 'medium', 'table'].includes(next)) return;
        try { localStorage.setItem(key, next); } catch { /* Storage may be unavailable. */ }
        setMode(next);
    }];
}

const cache = new Map();
let building = null;

export function invalidateItemData() {
    cache.clear();
    building = null;
}

async function loadFor(lang) {
    const params = await loadParams();
    const res = await call('catalogAll', lang);
    return { params, res };
}

export function useItemData(lang) {
    const empty = useMemo(() => buildItemData(null, null, lang), [lang]);
    const [state, setState] = useState(() => ({ data: cache.get(lang) || null, status: cache.has(lang) ? 'game' : 'loading' }));

    useEffect(() => {
        let alive = true;
        if (cache.has(lang)) {
            setState({ data: cache.get(lang), status: 'game' });
            return undefined;
        }
        (async () => {
            const { params, res } = await loadFor(lang);
            if (res?.ok) {
                const data = buildItemData(params, res.rows, lang);
                cache.set(lang, data);
                if (alive) setState({ data, status: 'game' });
                return;
            }
            const local = buildItemData(params, null, lang);
            if (alive) setState({ data: local, status: res?.missing && res.gameDir ? 'building' : 'local' });
            if (!res?.missing || !res.gameDir) return;
            building ||= call('catalogBuild');
            const result = await building;
            if (!result?.ok) building = null;
            const again = result?.ok ? await call('catalogAll', lang) : null;
            if (again?.ok) {
                const data = buildItemData(params, again.rows, lang);
                cache.set(lang, data);
                if (alive) setState({ data, status: 'game' });
            } else if (alive) {
                setState({ data: local, status: 'local' });
            }
        })();
        return () => { alive = false; };
    }, [lang]);

    // Never expose the previous language while the new catalog is loading.
    return state.data?.lang === lang ? state : { data: cache.get(lang) || empty, status: 'loading' };
}
