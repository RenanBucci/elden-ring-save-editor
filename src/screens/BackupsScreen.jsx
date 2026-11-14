import { useLocale } from '../i18n/locale';
import { useEffect, useState } from 'react';
import { call } from '../api';

const LABELS = { auto: 'Automático', manual: 'Manual', 'antes-de-restaurar': 'Antes de restaurar', 'antes-de-importar': 'Antes de importar', 'antes-de-apagar': 'Antes de apagar', 'antes-de-desfazer': 'Antes de desfazer' };

export default function BackupsScreen({ onApplied, toast }) {
    const { tr, lang } = useLocale();
    const [rows, setRows] = useState([]);
    const [query, setQuery] = useState('');
    const [version, setVersion] = useState(0);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        call('backups').then((res) => setRows(res?.backups || []));
    }, [version]);

    const reload = () => setVersion((value) => value + 1);
    const needle = query.trim().toLowerCase();
    const shown = rows.filter((row) => !needle || `${row.label} ${row.file}`.toLowerCase().includes(needle));

    async function restore(row) {
        if (!window.confirm(tr("Restaurar o backup de {0}? O save atual vira um backup antes.", [new Date(row.createdAt).toLocaleString(lang)]))) return;
        setBusy(true);
        const result = await call('restore', row.path);
        setBusy(false);
        if (!result?.ok) { toast(result?.error || tr("Falha"), true); return; }
        toast(tr("Backup restaurado."));
        onApplied();
        reload();
    }

    async function prune() {
        const preview = await call('prune', true);
        if (!preview?.ok) { toast(preview?.error || tr("Falha"), true); return; }
        if (!preview.removed) { toast(tr("Nada para limpar. Os 10 automáticos mais novos sempre ficam.")); return; }
        if (!window.confirm(tr("Apagar {0} backups automáticos antigos? Os 10 mais novos e os nomeados ficam.", [preview.removed]))) return;
        const result = await call('prune', false);
        toast(result?.ok ? tr("{0} backups removidos.", [result.removed]) : (result?.error || tr("Falha")), !result?.ok);
        reload();
    }

    return (
        <section className="screen">
            <p className="lead">{tr("Cada gravação faz um backup automático antes. Os backups ficam na pasta _editor_backups, ao lado do save.")}</p>
            <div className="toolbar">
                <input className="search" placeholder={tr("Buscar backups")} value={query} onChange={(event) => setQuery(event.target.value)} />
                <span className="spacer" />
                <button onClick={prune}>{tr("Limpar automáticos")}</button>
            </div>
            <div className="panel list">
                {shown.map((row) => (
                    <article key={row.path} className="option">
                        <span>
                            <strong>{tr(LABELS[row.label] || row.label)}</strong>
                            <small>{new Date(row.createdAt).toLocaleString(lang)} · {(row.bytes / 1048576).toFixed(1)} MB</small>
                        </span>
                        <button disabled={busy} onClick={() => restore(row)}>{tr("Restaurar")}</button>
                    </article>
                ))}
                {!shown.length && <p>{tr("Nenhum backup ainda. Cada aplicação cria um automaticamente.")}</p>}
            </div>
            <div className="danger">
                <div>
                    <strong>{tr("Zona de perigo")}</strong>
                    <p>{tr("Apaga o save atual. Um backup é feito antes.")}</p>
                </div>
                <button onClick={async () => {
                    if (!window.confirm(tr("Apagar o save atual? Um backup fica na pasta _editor_backups."))) return;
                    const result = await call('deleteSave');
                    if (!result?.ok) { toast(result?.error || tr("Falha"), true); return; }
                    toast(tr("Save apagado. O backup continua na pasta."));
                    onApplied(true);
                }}>{tr("Apagar save")}</button>
            </div>
        </section>
    );
}
