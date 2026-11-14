import { useLocale } from '../i18n/locale';
import { useEffect, useState } from 'react';
import { call } from '../api';
import { translate } from '../i18n';

const STATS = ['Vigor', 'Mente', 'Vigor físico', 'Força', 'Destreza', 'Inteligência', 'Fé', 'Arcano'];
const CLASSES = ['Vagabundo', 'Guerreiro', 'Herói', 'Bandido', 'Astrólogo', 'Profeta', 'Confessor', 'Samurai', 'Prisioneiro', 'Desgraçado'];

const clampStat = (value) => Math.max(1, Math.min(99, Math.round(Number(value)) || 1));

export default function EditorScreen({ slot, lang, onApplied, toast }) {
    const { tr } = useLocale();
    const t = (key) => translate(lang, key);
    const [ops, setOps] = useState([]);
    const [tab, setTab] = useState('Personagem');
    const [selected, setSelected] = useState(() => new Set());
    const [amounts, setAmounts] = useState({});
    const [character, setCharacter] = useState(null);
    const [draft, setDraft] = useState(null);
    const [busy, setBusy] = useState(false);
    const [version, setVersion] = useState(0);

    useEffect(() => {
        call('operations').then((res) => setOps(res?.operations || []));
    }, []);

    useEffect(() => {
        call('character', slot).then((res) => {
            setCharacter(res?.character || null);
            setDraft(res?.character ? { ...res.character, stats: res.character.stats.slice() } : null);
        });
    }, [slot, version]);

    const categories = [...new Set(ops.map((op) => op.category))];
    const activeTab = categories.includes(tab) ? tab : categories[0];
    const visible = ops.filter((op) => op.category === activeTab);

    function toggle(id) {
        setSelected((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    async function apply() {
        if (!draft || busy) return;
        const stats = draft.stats.map(clampStat);
        if (stats.reduce((sum, value) => sum + value, 0) < 80) {
            toast(tr('A soma dos atributos deve ser pelo menos 80 (nível 1).'), true);
            return;
        }
        const patch = {};
        if (draft.name !== character.name) patch.name = draft.name;
        if (Number(draft.classId) !== character.classId) patch.classId = Number(draft.classId);
        if (Number(draft.gender) !== character.gender) patch.gender = Number(draft.gender);
        if (stats.some((value, index) => value !== character.stats[index])) patch.stats = stats;
        const changed = Object.keys(patch).length > 0;
        if (!changed && !selected.size) { toast(tr("Nada mudou. Altere algum campo ou marque um atalho.")); return; }
        if (!draft.name.trim()) { toast(tr("O nome não pode ficar vazio."), true); return; }
        setBusy(true);
        const result = await call('apply', {
            slot,
            opIds: [...selected],
            amounts,
            character: changed ? patch : undefined,
        });
        setBusy(false);
        if (!result?.ok) {
            toast(result?.error || tr("Falha ao aplicar"), true);
            return;
        }
        toast(tr("Alterações aplicadas. Um backup foi criado."));
        setSelected(new Set());
        setVersion((value) => value + 1);
        onApplied();
    }

    const level = draft ? draft.stats.reduce((sum, value) => sum + clampStat(value), 0) - 79 : 0;

    return (
        <form id="save-character" className="screen" onSubmit={(event) => { event.preventDefault(); apply(); }}>
            <p className="lead">{tr("Aqui você muda o personagem em si: nome, classe, corpo, os oito atributos e o nível. As caixas abaixo são atalhos. Runas, nível e bênçãos entram junto quando você aplica.")}</p>
            {draft && (
                <div className="panel character-card">
                    <h2>{tr("Personagem")}</h2>
                    <label>{tr("Nome")} <input maxLength={16} value={draft.name || ''} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                    </label>
                    <label>{tr("Classe")} <select value={draft.classId} onChange={(event) => setDraft({ ...draft, classId: Number(event.target.value) })}>
                            {CLASSES.map((name, id) => <option key={name} value={id}>{tr(name)}</option>)}
                        </select>
                    </label>
                    <label>{tr("Corpo")} <select value={draft.gender} onChange={(event) => setDraft({ ...draft, gender: Number(event.target.value) })}>
                            <option value={0}>{tr("Tipo A")}</option>
                            <option value={1}>{tr("Tipo B")}</option>
                        </select>
                    </label>
                    <p className="level">{tr("Nível")} {level}{character && !character.consistent ? tr(" · o save diz {0}", [character.level]) : ''}{tr(". O nível é a soma dos atributos menos 79.")}</p>
                    <div className="stats">
                        {STATS.map((name, index) => (
                            <label key={name}>{tr(name)}
                                <input type="number" min="1" max="99" value={draft.stats[index]}
                                    onChange={(event) => {
                                        const stats = draft.stats.slice();
                                        stats[index] = event.target.value;
                                        setDraft({ ...draft, stats });
                                    }}
                                    onBlur={() => {
                                        const stats = draft.stats.map(clampStat);
                                        setDraft({ ...draft, stats });
                                    }} />
                            </label>
                        ))}
                    </div>
                </div>
            )}
            <h2>{tr("Atalhos")}</h2>
            <p className="lead">{tr("Marque o que quiser e aperte Aplicar. Runas, correção de nível e bênçãos ficam em Personagem. Graças, mapa e chefes ficam em Mundo.")}</p>
            <div className="tabs">
                {categories.map((category) => (
                    <button type="button" key={category} className={activeTab === category ? 'tab active' : 'tab'} onClick={() => setTab(category)}>{tr(category)}</button>
                ))}
            </div>
            <div className="panel">
                {visible.map((op) => (
                    <label key={op.id} className="option">
                        <input type="checkbox" checked={selected.has(op.id)} onChange={() => toggle(op.id)} />
                        <span>
                            <strong>{tr(op.name)}</strong>
                            <small>{tr(op.description)}</small>
                            {op.supportsAmount && (
                                <input
                                    className="amount"
                                    type="number"
                                    min="0"
                                    max={op.amountMax}
                                    value={amounts[op.id] ?? op.amountDefault}
                                    onChange={(event) => setAmounts({ ...amounts, [op.id]: Number(event.target.value) })}
                                    onClick={(event) => event.stopPropagation()}
                                />
                            )}
                        </span>

                    </label>
                ))}
                {!visible.length && <p>{tr("Nenhum atalho nesta aba.")}</p>}
            </div>
            <button type="submit" className="apply" disabled={busy || !draft || character?.readOnly}>{busy ? t('applying') : tr("Salvar alterações")}</button>
        </form>
    );
}
