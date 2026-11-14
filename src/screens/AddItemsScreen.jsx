import { useLocale } from '../i18n/locale';
import { useEffect, useMemo, useState } from 'react';
import { call } from '../api';
import Icon from '../components/Icon';
import ItemCollection, { ViewToggle } from '../components/ItemCollection';
import { AFFINITIES, CATEGORIES, useItemData, useViewMode } from '../items';

const LIMIT = 360;
const BULK_LIMIT = 300;

export default function AddItemsScreen({ slot, lang, onApplied, toast }) {
    const { tr } = useLocale();
    const { data, status } = useItemData(lang);
    const [owned, setOwned] = useState(new Map());
    const [category, setCategory] = useState('all');
    const [query, setQuery] = useState('');
    const [missingOnly, setMissingOnly] = useState(false);
    const [mode, setMode] = useViewMode('view.add', 'medium');
    const [selectedKey, setSelectedKey] = useState(null);
    const selected = data?.catalog.find((item) => item.key === selectedKey) || null;
    const [form, setForm] = useState({ quantity: 1, infusion: 0, level: 0, variant: 0 });
    const [confirmBulk, setConfirmBulk] = useState(false);
    const [busy, setBusy] = useState(false);
    const [version, setVersion] = useState(0);

    useEffect(() => {
        if (!data) return;
        Promise.all([call('inventory', slot, 'inventory'), call('inventory', slot, 'storage')]).then(([bag, chest]) => {
            const map = new Map();
            for (const item of [...(bag?.items || []), ...(chest?.items || [])]) {
                const key = data.ownedKey(item.kind, item.paramId);
                map.set(key, (map.get(key) || 0) + (item.kind === 'goods' ? item.quantity : 1));
            }
            setOwned(map);
        });
    }, [slot, version, data]);

    const catalog = useMemo(() => data?.catalog || [], [data]);
    const counts = useMemo(() => {
        const map = new Map();
        for (const item of catalog) map.set(item.category, (map.get(item.category) || 0) + 1);
        return map;
    }, [catalog]);
    const needle = query.trim().toLowerCase();
    const matches = catalog.filter((item) => (category === 'all' || item.category === category)
        && (!needle || item.name.toLowerCase().includes(needle))
        && (!missingOnly || !owned.has(item.key)));
    const shown = matches.slice(0, LIMIT);
    const canBulk = missingOnly && category !== 'all' && category !== 'key' && matches.length > 0 && matches.length <= BULK_LIMIT;

    function pick(item) {
        setSelectedKey(item.key);
        setConfirmBulk(false);
        setForm({ quantity: item.maxNum > 1 ? Math.min(item.maxNum, 10) : 1, infusion: 0, level: 0, variant: 0 });
    }

    async function commit(add, message) {
        setBusy(true);
        const result = await call('apply', { slot, add });
        setBusy(false);
        if (!result?.ok) { toast(result?.error || tr("Falha ao adicionar"), true); return false; }
        toast(message);
        onApplied();
        setVersion((value) => value + 1);
        return true;
    }

    function request(item, overrides = {}) {
        const options = { ...form, ...overrides };
        let paramId = item.paramId;
        if (item.kind === 'weapon' && item.category !== 'ammo') paramId = item.paramId + options.infusion * 100 + options.level;
        if (item.variants) paramId = item.variants[options.variant]?.paramId ?? item.paramId;
        const stack = item.maxNum > 1;
        return { kind: item.kind, paramId, quantity: stack ? Math.max(1, Math.min(item.maxNum, Math.floor(options.quantity) || 1)) : 1, maxNum: item.maxNum, name: item.name };
    }

    async function addSelected() {
        if (!selected) return;
        await commit([request(selected)], tr("{0} foi para a bolsa.", [selected.name]));
    }

    async function addAll() {
        if (!confirmBulk) { setConfirmBulk(true); return; }
        setConfirmBulk(false);
        const list = matches.map((item) => request(item, { quantity: item.maxNum, infusion: 0, level: 0, variant: 0 }));
        await commit(list, tr("{0} itens adicionados.", [list.length]));
    }

    const badges = (item) => (
        <>
            {owned.has(item.key) ? <em className="badge owned">{tr("Você tem")} {owned.get(item.key)}</em> : <em className="badge">{tr("Não tem")}</em>}
            {item.dlc && <em className="badge dlc">DLC</em>}
        </>
    );

    const affinityOptions = selected?.kind === 'weapon' ? (data?.affinitiesOf(selected.paramId) || [0]) : [0];
    const maxLevel = selected?.kind === 'weapon' ? (data?.maxLevel(selected.paramId) ?? 10) : 0;

    return (
        <section className="screen">
            <p className="lead">{tr("Escolha um item na lista e confirme no painel ao lado. Ele vai para a bolsa do personagem, com backup automático antes.")} {' '}{status === 'building' && tr("Lendo os nomes do jogo instalado, incluindo o DLC. Isso acontece só uma vez.")}
                {status === 'local' && tr("Mostrando a lista embutida. Os nomes de Cinzas de Guerra e alguns do DLC aparecem quando o jogo é encontrado.")}</p>
            <div className="toolbar">
                <input className="search wide" placeholder={tr("Buscar por nome, ex.: Rios de Sangue, Pedra de Forja, Mimic")} value={query} onChange={(event) => { setQuery(event.target.value); setConfirmBulk(false); }} />
                <label className="check"><input type="checkbox" checked={missingOnly} onChange={(event) => { setMissingOnly(event.target.checked); setConfirmBulk(false); }} />{tr("Só o que falta")}</label>
                <span className="spacer" />
                <ViewToggle mode={mode} onChange={setMode} />
            </div>
            <div className="chips">
                <button className={category === 'all' ? 'chip active' : 'chip'} onClick={() => { setCategory('all'); setConfirmBulk(false); }}>{tr("Tudo")}<em>{catalog.length}</em></button>
                {CATEGORIES.filter(([id]) => counts.has(id)).map(([id, label]) => (
                    <button key={id} className={category === id ? 'chip active' : 'chip'} onClick={() => { setCategory(id); setConfirmBulk(false); }}>{tr(label)}<em>{counts.get(id)}</em></button>
                ))}
            </div>
            {canBulk && (
                <div className="banner row">
                    <span>{tr("Faltam")} {matches.length} {tr("itens nesta categoria.")}</span>
                    <button className="primary" disabled={busy} onClick={addAll}>{confirmBulk ? tr("Confirmar: adicionar {0}", [matches.length]) : tr("Adicionar os {0} que faltam", [matches.length])}</button>
                    {confirmBulk && <button onClick={() => setConfirmBulk(false)}>{tr("Cancelar")}</button>}
                </div>
            )}
            <div className="add-layout">
                <div>
                    <ItemCollection items={shown} mode={mode} onOpen={pick} badges={badges} selectedKey={selected?.key} />
                    {matches.length > LIMIT && <p className="lead">{tr("Mostrando")} {LIMIT} {tr("de")} {matches.length}{tr(". Refine a busca ou escolha uma categoria.")}</p>}
                    {!matches.length && <p className="lead">{tr("Nenhum item com esse filtro.")}</p>}
                </div>
                <aside className="panel detail">
                    {!selected && <p className="lead">{tr("Clique em um item para ver as opções e adicionar.")}</p>}
                    {selected && (
                        <>
                            <Icon id={selected.iconId} size={160} />
                            <h3>{selected.name}</h3>
                            <small>{tr(selected.categoryLabel)}{selected.dlc ? ' · Shadow of the Erdtree' : ''}</small>
                            <p className="lead">{owned.has(selected.key) ? tr("O personagem já tem {0}.", [owned.get(selected.key)]) : tr("O personagem ainda não tem este item.")}</p>
                            {selected.kind === 'weapon' && selected.category !== 'ammo' && (
                                <>
                                    {affinityOptions.length > 1 && (
                                        <label>{tr("Afinidade")} <select value={form.infusion} onChange={(event) => setForm({ ...form, infusion: Number(event.target.value) })}>
                                                {affinityOptions.map((id) => <option key={id} value={id}>{tr(AFFINITIES[id])}</option>)}
                                            </select>
                                        </label>
                                    )}
                                    <label>{tr("Nível")} <select value={form.level} onChange={(event) => setForm({ ...form, level: Number(event.target.value) })}>
                                            {Array.from({ length: maxLevel + 1 }, (_, value) => <option key={value} value={value}>+{value}</option>)}
                                        </select>
                                    </label>
                                </>
                            )}
                            {selected.variants && (
                                <label>{tr("Nível")} <select value={form.variant} onChange={(event) => setForm({ ...form, variant: Number(event.target.value) })}>
                                        {selected.variants.map((variant, index) => <option key={variant.paramId} value={index}>+{variant.level}</option>)}
                                    </select>
                                </label>
                            )}
                            {selected.maxNum > 1 && (
                                <label>{tr("Quantidade (máx.")} {selected.maxNum})
                                    <input type="number" min="1" max={selected.maxNum} value={form.quantity}
                                        onChange={(event) => setForm({ ...form, quantity: Number(event.target.value) || 1 })} />
                                </label>
                            )}
                            {selected.category === 'key' && <p className="banner">{tr("Itens-chave mexem em missões. Adicionar um pode pular uma etapa ou travar um diálogo.")}</p>}
                            <button className="primary" disabled={busy} onClick={addSelected}>{busy ? tr("Gravando…") : tr("Adicionar à bolsa")}</button>
                        </>
                    )}
                </aside>
            </div>
        </section>
    );
}
