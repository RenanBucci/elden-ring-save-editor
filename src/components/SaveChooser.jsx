import { useLocale } from '../i18n/locale';
import { useState } from 'react';

export default function SaveChooser({ saves, current, onOpen }) {
    const { tr, lang } = useLocale();
    const [path, setPath] = useState('');
    return (
        <div className="save-chooser">
            {(saves || []).map((save) => (
                <button key={save.path} className={save.path === current ? 'active' : ''} onClick={() => onOpen(save.path)}>
                    <strong>{save.fileName}</strong>
                    <small>Steam {save.steamId} · {new Date(save.modifiedAt).toLocaleString(lang)}</small>
                </button>
            ))}
            <form className="row" onSubmit={(event) => {
                event.preventDefault();
                const value = path.trim().replace(/^"|"$/g, '');
                if (value) onOpen(value);
            }}>
                <input className="search wide" placeholder={tr("Ou cole o caminho de um .sl2 ou .co2")} value={path} onChange={(event) => setPath(event.target.value)} />
                <button type="submit" disabled={!path.trim()}>{tr("Abrir")}</button>
            </form>
        </div>
    );
}
