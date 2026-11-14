import { useLocale } from '../i18n/locale';
import { useEffect, useMemo, useState } from 'react';
import { call } from '../api';
import ItemCollection, { ViewToggle } from '../components/ItemCollection';
import { AFFINITIES, CATEGORIES, describe, isInternalItem, useItemData, useViewMode, weaponParts } from '../items';

export default function InventoryScreen({ slot, lang, onApplied, toast, onAdd }) {
    const { tr } = useLocale();
    const { data } = useItemData(lang);
    const [place, setPlace] = useState('inventory');
    const [items, setItems] = useState([]);
    const [equipped, setEquipped] = useState([]);
    const [category, setCategory] = useState('all');
    const [query, setQuery] = useState('');
    const [mode, setMode] = useViewMode('view.inventory', 'medium');
    const [busy, setBusy] = useState(false);
    const [version, setVersion] = useState(0);

    useEffect(() => {
        let alive = true;
        call('inventory', slot, place).then((res) => { if (alive) setItems(res?.items || []); });
        call('equipment', slot).then((res) => { if (alive) setEquipped(res?.items || []); });
        return () => { alive = false; };
    }, [slot, place, version]);

    const rows = useMemo(() => items.filter((item) => !isInternalItem(item, data)).map((item) => describe(data, item)), [items, data]);
    const locked = useMemo(() => new Set(equipped.filter((item) => !item.empty).map((item) => item.handle)), [equipped]);

    const counts = useMemo(() => {
        const map = new Map();
        for (const row of rows) map.set(row.category, (map.get(row.category) || 0) + 1);
        return map;
    }, [rows]);
    const needle = query.trim().toLowerCase();
    const shown = rows.filter((row) => (category === 'all' || row.category === category) && (!needle || row.name.toLowerCase().includes(needle)));

    async function commit(request, message) {
        setBusy(true);
        const result = await call('apply', { slot, ...request });
        setBusy(false);
        if (!result?.ok) { toast(result?.error || tr("Falha"), true); return false; }
        toast(message);
        onApplied();
        setVersion((value) => value + 1);
        return true;
    }

    function actions(item) {
        const controls = [];
        const stackable = item.kind === 'goods' || item.category === 'ammo';
        if (stackable) {
            controls.push(
                <input key={`qty-${item.quantity}`} type="number" min="1" max={item.maxNum} defaultValue={item.quantity} disabled={busy} title={tr("Quantidade. Saia do campo para gravar.")}
                    onBlur={async (event) => {
                        const field = event.target;
                        const next = Math.max(1, Math.min(item.maxNum, Math.floor(Number(field.value)) || 1));
                        event.target.value = String(next);
                        if (next !== item.quantity) {
                            const ok = await commit({ quantities: [{ container: item.container, index: item.index, quantity: next }] }, `${item.name}: ${next}.`);
                            if (!ok && field.isConnected) field.value = String(item.quantity);
                        }
                    }} />,
            );
        }
        if (item.kind === 'weapon' && item.category !== 'ammo') {
            const { base, infusion, level } = weaponParts(item.paramId);
            const options = data?.affinitiesOf(base) || [infusion];
            const max = data?.maxLevel(base, level) ?? Math.max(level, 10);
            if (options.length > 1) {
                controls.push(
                    <select key="aff" value={infusion} disabled={busy} title={tr("Afinidade")}
                        onChange={(event) => commit({ transform: [{ handle: item.handle, paramId: item.paramId, infusion: Number(event.target.value) }] }, tr("Afinidade alterada."))}>
                        {options.map((id) => <option key={id} value={id}>{tr(AFFINITIES[id])}</option>)}
                    </select>,
                );
            }
            controls.push(
                <select key="lvl" value={level} disabled={busy} title={tr("Nível de melhoria")}
                    onChange={(event) => commit({ transform: [{ handle: item.handle, paramId: item.paramId, level: Number(event.target.value) }] }, tr("Nível alterado."))}>
                    {Array.from({ length: max + 1 }, (_, value) => <option key={value} value={value}>+{value}</option>)}
                </select>,
            );
        }
        if ((item.kind === 'weapon' || item.kind === 'armor' || item.kind === 'ash') && item.category !== 'ammo') {
            const isLocked = locked.has(item.handle);
            controls.push(
                <button key="rm" disabled={busy || isLocked} title={isLocked ? tr("Está equipado. Tire no jogo antes de remover.") : tr("Tira o item do personagem")}
                    onClick={() => commit({ remove: [item.handle] }, tr("{0} removido.", [item.name]))}>{tr("Remover")}</button>,
            );
        }
        return controls.length ? controls : null;
    }

    const badges = (item) => (
        <>
            {locked.has(item.handle) && <em className="badge owned">{tr("Equipado")}</em>}
            {item.dlc && <em className="badge dlc">DLC</em>}
        </>
    );

    return (
        <section className="screen">
            <div className="toolbar">
                <div className="segmented">
                    <button disabled={busy} className={place === 'inventory' ? 'active' : ''} onClick={() => { setPlace('inventory'); }}>{tr("Bolsa")}</button>
                    <button disabled={busy} className={place === 'storage' ? 'active' : ''} onClick={() => { setPlace('storage'); }}>{tr("Baú")}</button>
                </div>
                <input className="search" placeholder={tr("Buscar no que você tem")} value={query} onChange={(event) => setQuery(event.target.value)} />
                <span className="spacer" />
                <ViewToggle mode={mode} onChange={setMode} />
                <button className="primary" onClick={onAdd}>{tr("+ Adicionar itens")}</button>
            </div>
            <p className="lead">{place === 'inventory'
                ? tr("Bolsa é o que o personagem carrega. Mude quantidade, afinidade e nível direto no item. O que está equipado não pode ser removido daqui.")
                : tr("Baú é o depósito que o jogo abre nos locais de graça. Itens guardados aqui não aparecem na bolsa.")}</p>

            <div className="chips">
                <button className={category === 'all' ? 'chip active' : 'chip'} onClick={() => setCategory('all')}>{tr("Tudo")}<em>{rows.length}</em></button>
                {CATEGORIES.filter(([id]) => counts.has(id)).map(([id, label]) => (
                    <button key={id} className={category === id ? 'chip active' : 'chip'} onClick={() => setCategory(id)}>{tr(label)}<em>{counts.get(id)}</em></button>
                ))}
            </div>

            {!shown.length && <p className="lead">{tr("Nada aqui. Use “Adicionar itens” para colocar algo no personagem.")}</p>}
            <ItemCollection items={shown} mode={mode} actions={actions} badges={badges} />
        </section>
    );
}
