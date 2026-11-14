import { useLocale } from '../i18n/locale';
import { useState } from 'react';
import { call, toBase64 } from '../api';
import SaveChooser from '../components/SaveChooser';

export default function SlotsScreen({ slots, saves, saveFile, onOpen, onApplied, toast }) {
    const { tr } = useLocale();
    const [from, setFrom] = useState(0);
    const [to, setTo] = useState(1);
    const same = from === to;

    async function run(slotOps, message) {
        const result = await call('apply', { slotOps });
        if (!result?.ok) { toast(result?.error || tr("Falha"), true); return; }
        toast(message);
        onApplied();
    }

    async function exportSlot(index) {
        const result = await call('exportSlot', index);
        if (!result?.ok) { toast(result?.error || tr("Falha"), true); return; }
        toast(tr("Exportado para {0}", [result.path]));
    }

    function occupied(index) {
        return slots.some((entry) => entry.index === index && !entry.empty);
    }

    function confirmOverwrite(index, action) {
        if (!occupied(index)) return true;
        const name = slots.find((entry) => entry.index === index)?.name || `slot ${index + 1}`;
        return window.confirm(tr("{0} substitui {1}. Continuar?", [action, name]));
    }

    function importFile(file, dest) {
        if (!confirmOverwrite(dest, tr("Importar"))) return;
        const reader = new FileReader();
        reader.onload = async () => {
            const result = await call('importCharacter', toBase64(reader.result), null, dest);
            if (!result?.ok) { toast(result?.error || tr("Falha"), true); return; }
            toast(tr("Personagem importado e regravado para esta conta."));
            onApplied();
        };
        reader.readAsArrayBuffer(file);
    }

    return (
        <section className="screen">
            <div className="banner">{tr("Exportar grava um arquivo .slot em Documentos\\Elden Ring Save Editor. Importar aceita esse .slot ou um save inteiro (.sl2, usa o primeiro personagem dele) e troca o SteamID para esta conta. Se a Steam avisar conflito de nuvem, escolha enviar os arquivos locais.")}</div>
            <div className="slot-grid">
                {slots.map((slot) => (
                    <article key={slot.index} className={slot.empty ? 'slot empty' : 'slot'}>
                        <strong>{slot.empty ? tr("Slot {0} vazio", [slot.index + 1]) : slot.name}</strong>
                        {!slot.empty && <small>{tr("Nível")} {slot.level}</small>}
                        {!slot.empty && (
                            <span className="row">
                                <button onClick={() => exportSlot(slot.index)}>{tr("Exportar")}</button>
                                <button onClick={() => {
                                    if (!window.confirm(tr("Apagar {0}? Um backup é criado antes.", [slot.name]))) return;
                                    run([{ type: 'delete', slot: slot.index }], tr("Personagem apagado."));
                                }}>{tr("Apagar")}</button>
                            </span>
                        )}
                        <label className="file">{tr("Importar para cá")} <input type="file" accept=".slot,.sl2,.co2" onChange={(event) => {
                                const file = event.target.files?.[0];
                                event.target.value = '';
                                if (file) importFile(file, slot.index);
                            }} />
                        </label>
                    </article>
                ))}
            </div>
            <h2>{tr("Clonar, mover ou trocar")}</h2>
            <div className="row">
                <label>{tr("De")} <select value={from} onChange={(event) => setFrom(Number(event.target.value))}>
                        {slots.map((slot) => <option key={slot.index} value={slot.index}>{slot.index + 1}. {slot.empty ? tr("vazio") : slot.name}</option>)}
                    </select>
                </label>
                <label>{tr("Para")} <select value={to} onChange={(event) => setTo(Number(event.target.value))}>
                        {slots.map((slot) => <option key={slot.index} value={slot.index}>{slot.index + 1}. {slot.empty ? tr("vazio") : slot.name}</option>)}
                    </select>
                </label>
                <button disabled={same || !occupied(from)} onClick={() => confirmOverwrite(to, tr("Clonar")) && run([{ type: 'clone', from, to }], tr("Slot clonado."))}>{tr("Clonar")}</button>
                <button disabled={same || !occupied(from)} onClick={() => confirmOverwrite(to, tr("Mover")) && run([{ type: 'move', from, to }], tr("Slot movido."))}>{tr("Mover")}</button>
                <button disabled={same} onClick={() => run([{ type: 'swap', a: from, b: to }], tr("Slots trocados."))}>{tr("Trocar")}</button>
            </div>
            <h2>{tr("Trocar de save")}</h2>
            <p className="lead">{tr("Aberto agora:")} {saveFile}</p>
            <SaveChooser saves={saves} current={saveFile} onOpen={onOpen} />
        </section>
    );
}
