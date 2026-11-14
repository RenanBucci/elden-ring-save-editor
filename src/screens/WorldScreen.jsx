import { useLocale } from '../i18n/locale';
import { useEffect, useMemo, useState } from 'react';
import { call } from '../api';
import { bossOf } from '../bosses';
import GraceMap from '../components/GraceMap';
import Icon from '../components/Icon';
import { locate, pretty, splitName } from '../world';

const TABS = [['graces', 'Graças'], ['bosses', 'Chefes'], ['maps', 'Mapa']];

const flagOf = (row) => row.flag || row.id;

export default function WorldScreen({ slot, onApplied, toast }) {
    const { tr, lang } = useLocale();
    const [tab, setTab] = useState('graces');
    const [world, setWorld] = useState({ graces: [], bosses: [], maps: [] });
    const [flags, setFlags] = useState({});
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(() => new Set());
    const [focus, setFocus] = useState(null);
    const [busy, setBusy] = useState(false);
    const [showList, setShowList] = useState(false);

    useEffect(() => {
        call('world').then((res) => setWorld({ graces: res?.graces || [], bosses: res?.bosses || [], maps: res?.maps || [] }));
    }, []);

    useEffect(() => {
        const ids = [...world.graces, ...world.bosses, ...world.maps].map(flagOf);
        if (!ids.length) return;
        call('flags', slot, ids).then((res) => {
            const next = {};
            for (const row of res?.flags || []) next[row.id] = row.on;
            setFlags(next);
        });
    }, [slot, world]);

    const arenas = useMemo(() => new Set(world.bosses.map((boss) => boss.name.replace(/^Defeated\s+/, ''))), [world.bosses]);
    const needle = query.trim().toLowerCase();
    const rows = (world[tab] || []).filter((row) => {
        if (!needle) return true;
        const english = (row.name || '').toLowerCase();
        const boss = bossOf(row.name.replace(/^Defeated\s*/, ''));
        return english.includes(needle) || (boss?.name || '').toLowerCase().includes(needle);
    });

    const regions = useMemo(() => {
        const map = new Map();
        for (const row of rows) {
            const region = tab === 'graces' ? splitName(row.name).region
                : tab === 'bosses' ? 'Chefes principais'
                    : (row.name.startsWith('Acquired') ? 'Fragmentos obtidos' : 'Áreas reveladas no mapa');
            if (!map.has(region)) map.set(region, []);
            map.get(region).push(row);
        }
        return [...map.entries()];
    }, [rows, tab]);

    async function setMany(list, on, message) {
        setBusy(true);
        const result = await call('apply', { slot, flags: list.map((row) => ({ id: flagOf(row), on })) });
        setBusy(false);
        if (!result?.ok) { toast(result?.error || tr("Falha"), true); return; }
        setFlags((current) => {
            const next = { ...current };
            for (const row of list) next[flagOf(row)] = on;
            return next;
        });
        toast(message);
        onApplied();
    }

    function toggleRegion(region) {
        const key = tab === 'graces' ? region : `off:${region}`;
        setOpen((current) => {
            const next = new Set(current);
            if (tab === 'graces') {
                if (next.has(region)) next.delete(region);
                else next.add(region);
            } else if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }

    const done = (list) => list.filter((row) => flags[flagOf(row)]).length;
    const focusInfo = focus ? locate(focus) : null;

    return (
        <section className="screen">
            <p className="lead">{tr("Mundo é o progresso gravado no personagem. Graças são os pontos de descanso descobertos, Chefes são as marcas de derrota e Mapa são os fragmentos que revelam o mapa. Marcar liga a marca no save, desmarcar apaga. O personagem não é teletransportado.")}</p>
            <div className="progress-row">
                {TABS.map(([id, label]) => {
                    const list = world[id] || [];
                    const value = done(list);
                    return (
                        <button key={id} className={tab === id ? 'progress-card active' : 'progress-card'} onClick={() => { setTab(id); setShowList(id !== 'graces'); }}>
                            <strong>{tr(label)}</strong>
                            <span>{value} {tr("de")} {list.length}</span>
                            <i style={{ width: `${list.length ? (value / list.length) * 100 : 0}%` }} />
                        </button>
                    );
                })}
            </div>
            <div className="toolbar">
                <input className="search wide" placeholder={tr("Buscar graça, chefe ou região")} value={query} onChange={(event) => setQuery(event.target.value)} />
                <span className="spacer" />
                <button onClick={() => setOpen(tab === 'graces' ? new Set(regions.map(([region]) => region)) : new Set())}>{tr("Abrir todas")}</button>
                <button onClick={() => setOpen(tab === 'graces' ? new Set() : new Set(regions.map(([region]) => `off:${region}`)))}>{tr("Fechar todas")}</button>
            </div>
            {tab === 'bosses' && <p className="lead">{tr("Estes são os chefes principais, os que deixam lembrança ou fecham uma área. Chefes de campo, cavaleiros e avatares menores ainda não estão nesta lista. A seta ao lado do grupo abre e fecha a lista.")}</p>}
            <div className="world-layout">
                {tab === 'graces' && (
                    <aside className="panel map-panel">
                        {!focus && <p className="lead">{tr("Clique num ponto do mapa. Dourado já foi descoberta, escuro ainda não, azul fica no subterrâneo.")}</p>}
                        <GraceMap graces={world.graces} flags={flags} focus={focus} onPick={(row) => {
                            setFocus(row);
                            setOpen((current) => new Set(current).add(splitName(row.name).region));
                        }} />
                        {focusInfo && (
                            <div className="grace-detail">
                                <div>
                                    <h3>{pretty(focusInfo.place)}</h3>
                                    <small>{pretty(focusInfo.region)}{focusInfo.dlc ? ' · Shadow of the Erdtree' : ''}{focusInfo.kind === 'underground' ? tr(" · subterrâneo") : ''}</small>
                                    <p className="lead">{flags[flagOf(focus)] ? tr("Já descoberta neste personagem.") : tr("Ainda não descoberta neste personagem.")}</p>
                                </div>
                                <button className="primary" disabled={busy} onClick={() => {
                                    const on = !flags[flagOf(focus)];
                                    setMany([focus], on, on ? tr("{0} descoberta.", [pretty(focusInfo.place)]) : tr("{0} esquecida.", [pretty(focusInfo.place)]));
                                }}>{flags[flagOf(focus)] ? tr("Esquecer esta graça") : tr("Descobrir esta graça")}</button>
                            </div>
                        )}
                    </aside>
                )}
                <button className="region-toggle list-toggle" onClick={() => setShowList((current) => !current)} aria-expanded={showList}>
                    <span className="chevron">{showList ? '▾' : '▸'}</span>
                    <strong>{tab === 'graces' ? tr("Graças descobertas") : tab === 'bosses' ? tr("Chefes derrotados") : tr("Fragmentos do mapa")}</strong>
                    <em>{done(world[tab] || [])}/{(world[tab] || []).length}</em>
                </button>
                {showList && <div className="panel list">
                    {!rows.length && <p>{tr("Nada encontrado.")}</p>}
                    {regions.map(([region, list]) => {
                        const expanded = !!needle || (tab === 'graces' ? open.has(region) : !open.has(`off:${region}`));
                        const count = done(list);
                        return (
                            <div key={region} className="region">
                                <div className="region-head">
                                    <button className="region-toggle" onClick={() => toggleRegion(region)} aria-expanded={expanded}>
                                        <span className="chevron">{expanded ? '▾' : '▸'}</span>
                                        <strong>{tr(pretty(region))}</strong>
                                        <em>{count}/{list.length}</em>
                                    </button>
                                    <button disabled={busy || count === list.length} onClick={() => setMany(list, true, tr("{0}: tudo marcado.", [tr(pretty(region))]))}>{tr("Marcar todas")}</button>
                                    <button disabled={busy || count === 0} onClick={() => setMany(list, false, tr("{0}: tudo desmarcado.", [tr(pretty(region))]))}>{tr("Limpar")}</button>
                                </div>
                                {expanded && list.map((row) => {
                                    const id = flagOf(row);
                                    const { place } = splitName(row.name);
                                    const title = tab === 'graces' ? place : row.name.replace(/^(Defeated|Reveal Map:|Acquired Map:)\s*/, '');
                                    const boss = tab === 'bosses' ? bossOf(title) : null;
                                    return (
                                        <div key={`${tab}-${row.id}`} className={['option', boss ? 'boss' : '', focus?.id === row.id ? 'focused' : ''].filter(Boolean).join(' ')}>
                                            <input type="checkbox" disabled={busy} checked={!!flags[id]} onChange={(event) => setMany([row], event.target.checked, event.target.checked ? tr("Marcado.") : tr("Desmarcado."))} />
                                            {boss && <Icon id={boss.icon} size={48} />}
                                            <span className={boss ? 'boss-name' : undefined}>
                                                <strong>{lang === 'en' ? pretty(title) : (boss?.name || pretty(title))}</strong>
                                                {boss && <small>{title}</small>}
                                                {tab === 'graces' && arenas.has(place) && <em className="badge">{tr("Arena de chefe")}</em>}
                                            </span>
                                            {tab === 'graces' && (
                                                <button className="icon-button" title={tr("Ver no mapa")} aria-label={tr("Ver {0} no mapa", [place])}
                                                    onClick={() => setFocus(focus?.id === row.id ? null : row)}>{tr("⌖ Mapa")}</button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>}
            </div>
        </section>
    );
}
