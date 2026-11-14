import { useLocale } from '../i18n/locale';
import { useEffect, useState } from 'react';
import { call } from '../api';
import Icon from '../components/Icon';
import { describe, useItemData } from '../items';

const GROUPS = [
    { title: 'Corpo', fields: [
        ['Cabeça', 0xB0], ['Peito', 0xB1], ['Abdômen', 0xB2],
        ['Braço direito', 0xB3], ['Braço esquerdo', 0xB5], ['Perna direita', 0xB4], ['Perna esquerda', 0xB6],
    ] },
    { title: 'Pele', fields: [
        ['R', 0xB7], ['G', 0xB8], ['B', 0xB9], ['Brilho', 0xBA],
    ] },
    { title: 'Cabelo', fields: [
        ['R', 0xFA], ['G', 0xFB], ['B', 0xFC], ['Brilho', 0xFD],
    ] },
    { title: 'Rosto', fields: [
        ['Estrutura', 0x30], ['Idade aparente', 0x31], ['Forma', 0x32], ['Assimetria', 0x33],
        ['Olhos', 0x34], ['Nariz', 0x35], ['Boca', 0x36], ['Queixo', 0x37],
    ] },
];

export default function AppearanceScreen({ slot, slots, lang, onApplied, toast }) {
    const { tr } = useLocale();
    const { data } = useItemData(lang);
    const [bytes, setBytes] = useState(null);
    const [gear, setGear] = useState([]);
    const [gender, setGender] = useState(0);
    const [picked, setPicked] = useState(null);
    const others = slots.filter((entry) => !entry.empty && entry.index !== slot);
    const source = others.some((entry) => entry.index === picked) ? picked : (others[0]?.index ?? null);

    useEffect(() => {
        call('appearance', slot).then((res) => {
            if (!res?.ok) { setBytes(null); return; }
            setBytes(res.bytes);
            setGender(res.gender || 0);
        });
        call('equipment', slot).then((res) => setGear(res?.items || []));
    }, [slot]);

    function setByte(offset, value) {
        setBytes((current) => {
            const next = current.slice();
            next[offset] = Math.max(0, Math.min(255, Number(value) || 0));
            return next;
        });
    }

    async function apply() {
        const result = await call('apply', { slot, face: bytes, character: { gender } });
        if (!result?.ok) { toast(result?.error || tr("Falha"), true); return; }
        toast(tr("Aparência aplicada."));
        onApplied();
    }

    async function copyFrom() {
        if (source == null) return;
        const result = await call('apply', { slot, copyFaceFrom: source });
        if (!result?.ok) { toast(result?.error || tr("Falha"), true); return; }
        toast(tr("Aparência copiada."));
        call('appearance', slot).then((res) => {
            if (!res?.ok) return;
            setBytes(res.bytes);
            setGender(res.gender || 0);
        });
        onApplied();
    }

    async function download() {
        const name = slots.find((entry) => entry.index === slot)?.name || 'personagem';
        const result = await call('saveText', `aparencia-${name}.json`, JSON.stringify({ gender, bytes }));
        toast(result?.ok ? tr("Preset salvo em {0}", [result.path]) : (result?.error || tr("Falha")), !result?.ok);
    }

    function upload(file) {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = JSON.parse(reader.result);
                if (!Array.isArray(data.bytes) || data.bytes.length < bytes.length) throw new Error(tr("Esse arquivo não é um preset de aparência deste editor."));
                setBytes(data.bytes.slice(0, bytes.length).map((value) => Math.max(0, Math.min(255, Number(value) || 0))));
                if (data.gender === 0 || data.gender === 1) setGender(data.gender);
                toast(tr("Preset carregado. Aperte Aplicar aparência para gravar."));
            } catch (error) {
                toast(error.message, true);
            }
        };
        reader.readAsText(file);
    }

    if (!bytes) return <section className="screen"><p>{tr("Aparência não encontrada neste personagem.")}</p></section>;

    const worn = (slotIndex) => {
        const item = gear.find((entry) => entry.slot === slotIndex && !entry.empty);
        return item ? describe(data, item) : null;
    };
    const piece = (slotIndex, label) => {
        const item = worn(slotIndex);
        return (
            <span className="equip-slot" title={item?.name || label}>
                <Icon id={item?.iconId} size={56} />
            </span>
        );
    };
    return (
        <section className="screen appearance-layout">
            <aside className="preview-card doll">
                <div className="doll-col">
                    {piece(0, tr("Mão esquerda 1"))}
                    {piece(2, tr("Mão esquerda 2"))}
                    {piece(4, tr("Mão esquerda 3"))}
                </div>
                <div className="doll-center">
                    {piece(12, tr("Cabeça"))}
                    {piece(13, tr("Peito"))}
                    {piece(14, tr("Braços"))}
                    {piece(15, tr("Pernas"))}
                </div>
                <div className="doll-col">
                    {piece(1, tr("Mão direita 1"))}
                    {piece(3, tr("Mão direita 2"))}
                    {piece(5, tr("Mão direita 3"))}
                </div>
                <p>{tr("Isto é o que o personagem está usando agora: armas nas mãos e as quatro peças de armadura. O boneco 3D saiu daqui. Trocar uma peça fica em Inventário, no botão Alterar de cada espaço.")}</p>
            </aside>
            <div className="panel">
                <p className="lead">{tr("Cada controle grava um byte da aparência do personagem. Corpo muda as proporções, Pele e Cabelo mudam a cor, Rosto muda o formato. Nada entra no save até você apertar Aplicar aparência.")}</p>
                <label>{tr("Corpo")} <select value={gender} onChange={(event) => setGender(Number(event.target.value))}>
                        <option value={0}>{tr("Tipo A")}</option>
                        <option value={1}>{tr("Tipo B")}</option>
                    </select>
                </label>
                {GROUPS.map((group) => (
                    <div key={tr(group.title)}>
                        <h3>{tr(group.title)}</h3>
                        <div className="stats">
                            {group.fields.map(([label, offset]) => (
                                <label key={offset}>{tr(label)}
                                    <input type="range" min="0" max="255" value={bytes[offset] || 0} onChange={(event) => setByte(offset, event.target.value)} />
                                </label>
                            ))}
                        </div>
                    </div>
                ))}
                <div className="row">
                    <button onClick={apply}>{tr("Aplicar aparência")}</button>
                    <button onClick={download}>{tr("Exportar preset")}</button>
                    <label className="file">{tr("Importar preset")} <input type="file" accept=".json,application/json" onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = '';
                            if (file) upload(file);
                        }} />
                    </label>
                </div>
                {others.length > 0 && (
                    <div className="row">
                        <select value={source ?? ''} onChange={(event) => setPicked(Number(event.target.value))}>
                            {others.map((entry) => (
                                <option key={entry.index} value={entry.index}>{entry.name} {tr("· nv")} {entry.level}</option>
                            ))}
                        </select>
                        <button onClick={copyFrom}>{tr("Copiar aparência deste personagem")}</button>
                    </div>
                )}
            </div>
        </section>
    );
}
