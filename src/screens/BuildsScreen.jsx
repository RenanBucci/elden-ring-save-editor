import { useLocale } from '../i18n/locale';
import { useEffect, useMemo, useState } from 'react';
import { call } from '../api';
import Icon from '../components/Icon';
import { describe, useItemData, weaponParts } from '../items';
import { KITS } from '../kits';

const CLASSES = ['Vagabundo', 'Guerreiro', 'Herói', 'Bandido', 'Astrólogo', 'Profeta', 'Confessor', 'Samurai', 'Prisioneiro', 'Desgraçado'];
const PARTS = [['stats', 'Atributos e classe', 'Os oito atributos, a classe, o tipo de corpo e os espaços de talismã. O nível é recalculado.'],
    ['appearance', 'Aparência', 'Rosto, corpo, pele e cabelo.'],
    ['equipment', 'Equipamento', 'Armas das duas mãos, flechas, armadura e talismãs. O que faltar é criado e já vem equipado.'],
    ['spells', 'Magias memorizadas', 'Feitiços e encantamentos nos espaços de memória. Os que faltarem entram na bolsa.']];

export default function BuildsScreen({ slot, slots, lang, onApplied, toast }) {
    const { tr } = useLocale();
    const { data } = useItemData(lang);
    const [owned, setOwned] = useState(new Set());
    const [open, setOpen] = useState(null);
    const [busy, setBusy] = useState(false);
    const [version, setVersion] = useState(0);
    const others = slots.filter((entry) => !entry.empty && entry.index !== slot);
    const current = slots.find((entry) => entry.index === slot);
    const [from, setFrom] = useState(null);
    const [parts, setParts] = useState({ stats: true, appearance: false, equipment: true, spells: true });
    const [sourceGear, setSourceGear] = useState([]);
    const [confirm, setConfirm] = useState(false);
    const source = others.some((entry) => entry.index === from) ? from : (others[0]?.index ?? null);

    useEffect(() => {
        if (!data) return;
        Promise.all([call('inventory', slot, 'inventory'), call('inventory', slot, 'storage')]).then(([bag, chest]) => {
            setOwned(new Set([...(bag?.items || []), ...(chest?.items || [])].map((item) => data.ownedKey(item.kind, item.paramId))));
        });
    }, [slot, data, version]);

    useEffect(() => {
        if (source == null) return;
        call('equipment', source).then((res) => setSourceGear(res?.items || []));
    }, [source]);

    const kits = useMemo(() => KITS.map((kit) => {
        const items = kit.items.map(([kind, id]) => {
            const entry = data?.entry(kind, id);
            const base = entry || describe(data, { kind, paramId: id });
            return { ...base, key: `${kind}:${id}`, kind, paramId: id, have: owned.has(data?.ownedKey(kind, id) ?? `${kind}:${id}`) };
        });
        return { ...kit, items, missing: items.filter((item) => !item.have || item.kind === 'goods') };
    }), [data, owned]);

    async function addKit(kit) {
        if (!kit.missing.length) return;
        const add = kit.missing.map((item) => {
            let paramId = item.paramId;
            if (item.kind === 'weapon') paramId = item.paramId + (data?.maxLevel(weaponParts(item.paramId).base) ?? 0);
            return { kind: item.kind, paramId, quantity: item.maxNum || 1, maxNum: item.maxNum || 1, name: item.name };
        });
        setBusy(true);
        const result = await call('apply', { slot, add });
        setBusy(false);
        if (!result?.ok) { toast(result?.error || tr("Falha ao adicionar o kit"), true); return; }
        toast(tr("{0}: {1} itens na bolsa.", [tr(kit.title), add.length]));
        onApplied();
        setVersion((value) => value + 1);
    }

    async function copy() {
        if (!confirm) { setConfirm(true); return; }
        setConfirm(false);
        setBusy(true);
        const result = await call('apply', { slot, copyBuild: { from: source, ...parts } });
        setBusy(false);
        if (!result?.ok) { toast(result?.error || tr("Falha ao copiar"), true); return; }
        toast(tr("Build copiada. Um backup foi criado antes."));
        onApplied();
        setVersion((value) => value + 1);
    }

    const sourceInfo = slots.find((entry) => entry.index === source);
    const gear = sourceGear.filter((item) => !item.empty && item.group !== 'ammo').map((item) => describe(data, item));
    const anyPart = Object.values(parts).some(Boolean);

    return (
        <section className="screen">
            <p className="lead">{tr("Kits colocam uma build inteira na bolsa com um clique: armas já no nível máximo, talismãs, magias e armadura. Armas, armaduras e talismãs que o personagem já tem ficam de fora. Consumíveis e materiais são completados até o máximo. Para equipar, use Alterar em Inventário.")}</p>
            <div className="kit-grid">
                {kits.map((kit) => (
                    <article key={kit.id} className="panel kit">
                        <header>
                            <h3>{tr(kit.title)}</h3>
                            <em className="badge">{tr(kit.hint)}</em>
                        </header>
                        <p className="lead">{tr(kit.description)}</p>
                        <div className="kit-icons">
                            {kit.items.slice(0, 12).map((item) => (
                                <span key={item.key} className={item.have ? 'kit-icon have' : 'kit-icon'} title={`${item.name}${item.have ? tr(" (já tem)") : ''}`}>
                                    <Icon id={item.iconId} size={40} />
                                </span>
                            ))}
                        </div>
                        <div className="row">
                            <button className="primary" disabled={busy || !kit.missing.length} onClick={() => addKit(kit)}>
                                {kit.missing.length ? tr('Adicionar {0} {1}', [kit.missing.length, kit.missing.length === 1 ? 'item' : tr('itens')]) : tr("Já tem tudo")}
                            </button>
                            <button onClick={() => setOpen(open === kit.id ? null : kit.id)}>{open === kit.id ? tr("Fechar lista") : tr("Ver lista")}</button>
                        </div>
                        {open === kit.id && (
                            <ul className="kit-list">
                                {kit.items.map((item) => (
                                    <li key={item.key} className={item.have ? 'have' : ''}>
                                        <Icon id={item.iconId} size={28} />
                                        <span>{item.name}</span>
                                        <small>{item.have ? tr("já tem") : item.categoryLabel}</small>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </article>
                ))}
            </div>

            <h2>{tr("Copiar de outro personagem")}</h2>
            {!others.length && <p className="lead">{tr("Este save só tem um personagem. Crie ou importe outro na aba Slots para copiar uma build.")}</p>}
            {!!others.length && (
                <div className="copy-layout">
                    <div className="panel">
                        <label>{tr("Copiar de")} <select value={source ?? ''} onChange={(event) => { setFrom(Number(event.target.value)); setConfirm(false); }}>
                                {others.map((entry) => <option key={entry.index} value={entry.index}>{entry.name} {tr("· nv")} {entry.level}</option>)}
                            </select>
                        </label>
                        <p className="lead">{tr("Para")} <strong>{current?.name}</strong>{tr(". O nome e o progresso do mundo continuam os dele.")}</p>
                        {PARTS.map(([id, label, help]) => (
                            <label key={id} className="option">
                                <input type="checkbox" checked={parts[id]} onChange={(event) => { setParts({ ...parts, [id]: event.target.checked }); setConfirm(false); }} />
                                <span><strong>{tr(label)}</strong><small>{tr(help)}</small></span>
                            </label>
                        ))}
                        <p className="lead">{tr("Cinzas de Guerra presas às armas não vêm junto: a arma chega com a habilidade padrão.")}</p>
                        <button className="primary" disabled={busy || !anyPart || source == null} onClick={copy}>
                            {confirm ? tr("Confirmar: sobrescrever {0}", [current?.name]) : tr("Copiar build")}
                        </button>
                        {confirm && <button onClick={() => setConfirm(false)}>{tr("Cancelar")}</button>}
                    </div>
                    <div className="panel">
                        <h3>{sourceInfo?.name}</h3>
                        <small>{tr(CLASSES[sourceInfo?.classId] || '')} {tr("· nível")} {sourceInfo?.level}</small>
                        <div className="equip-preview">
                            {gear.map((item) => (
                                <div key={item.key} className="equip-slot">
                                    <Icon id={item.iconId} size={36} />
                                    <span>{item.name}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
