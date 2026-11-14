import { useLocale } from '../i18n/locale';
import { useEffect, useState } from 'react';
import { call } from '../api';
import { invalidateItemData } from '../items';

const SCALES = [1, 2, 5, 10];
const FIELDS = [
    ['runes', 'Runas', 'Runas de inimigos e de chefes.'],
    ['drops', 'Quantidade dos drops', 'Quantas unidades cada drop entrega. A chance de cair não muda.'],
    ['enemyHp', 'Vida dos inimigos', 'Vale para inimigos comuns e chefes.'],
    ['enemyDamage', 'Dano dos inimigos', 'Físico, mágico, fogo e raio. Dano sagrado não muda.'],
];

export default function ModsScreen({ gameDir, toast }) {
    const { tr } = useLocale();
    const [status, setStatus] = useState(null);
    const [preset, setPreset] = useState({ runes: 1, drops: 1, enemyHp: 1, enemyDamage: 1, freeUpgrade: false });
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let alive = true;
        call('modsStatus', gameDir).then((res) => {
            if (!alive) return;
            setStatus(res);
            if (res?.preset) setPreset((current) => ({ ...current, ...res.preset }));
        });
        return () => { alive = false; };
    }, [gameDir]);

    async function reload() {
        setStatus(await call('modsStatus', gameDir));
    }

    async function apply() {
        setBusy(true);
        const result = await call('modsApply', gameDir, preset);
        setBusy(false);
        if (!result?.ok) { toast(result?.error || tr("Falha"), true); return; }
        const changed = Object.values(result.counts || {}).reduce((sum, value) => sum + value, 0);
        toast(tr("Mods gravados em mod\\regulation.bin ({0} linhas alteradas). Jogue offline, com ModEngine e o EAC desligado.", [changed]));
        reload();
    }

    async function revert() {
        setBusy(true);
        const result = await call('modsRevert', gameDir);
        setBusy(false);
        if (!result?.ok) { toast(result?.error || tr("Falha"), true); return; }
        toast(tr("Pasta mod voltou ao que era antes do editor."));
        reload();
    }

    async function readGame() {
        setBusy(true);
        const res = await call('buildGameData');
        if (res?.ok) invalidateItemData();
        setBusy(false);
        toast(res?.ok ? tr("Catálogo relido do jogo: {0} armas, {1} armaduras, {2} itens.", [res.stats?.weapons ?? 0, res.stats?.armor ?? 0, res.stats?.goods ?? 0]) : (res?.error || tr("Falha")), !res?.ok);
    }

    const noGame = status && !status.ok;

    return (
        <section className="screen">
            <div className="banner">{tr("Mods só valem com ModEngine, offline e EAC desligado. O editor grava em")} <code>mod\regulation.bin</code>{tr("; o regulation.bin original do jogo não é alterado. Aplicar de novo sempre parte do original, então ×10 duas vezes continua ×10.")}</div>
            <div className="panel">
                {FIELDS.map(([key, label, help]) => (
                    <label key={key} className="option">
                        <span><strong>{tr(label)}</strong><small>{tr(help)}</small></span>
                        <select value={preset[key]} onChange={(event) => setPreset({ ...preset, [key]: Number(event.target.value) })}>
                            {key === 'enemyHp' && <option value={0}>{tr("1 de vida")}</option>}
                            {key === 'enemyDamage' && <option value={0}>{tr("Sem dano")}</option>}
                            {SCALES.map((value) => <option key={value} value={value}>{value === 1 ? 'Normal' : `×${value}`}</option>)}
                        </select>
                    </label>
                ))}
                <label className="option">
                    <input type="checkbox" checked={preset.freeUpgrade} onChange={(event) => setPreset({ ...preset, freeUpgrade: event.target.checked })} />
                    <span><strong>{tr("Forja e lojas por 1")}</strong><small>{tr("Cada melhoria pede 1 material e tudo nas lojas custa 1 runa.")}</small></span>
                </label>
                <p className="lead">{noGame ? (tr(status.error) || tr("regulation.bin não encontrado."))
                    : status?.ours ? tr("Os mods do editor estão gravados na pasta mod.")
                        : status?.usingMod ? tr("Já existe um regulation de outro mod na pasta. Aplicar parte dele, e Reverter devolve ele intacto.")
                            : tr("Ainda não há regulation na pasta mod.")}</p>
                <div className="row">
                    <button className="primary" disabled={busy || noGame} onClick={apply}>{busy ? tr("Gravando…") : tr("Aplicar mods")}</button>
                    <button disabled={busy || !status?.canRevert} onClick={revert}>{tr("Reverter")}</button>
                    <button disabled={busy} onClick={readGame}>{tr("Reler nomes do jogo")}</button>
                </div>
            </div>
        </section>
    );
}
