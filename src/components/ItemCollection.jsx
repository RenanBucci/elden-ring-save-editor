import { useLocale } from '../i18n/locale';
import Icon from './Icon';

const MODES = [['large', 'Grande'], ['medium', 'Média'], ['table', 'Tabela']];

export function ViewToggle({ mode, onChange }) {
    const { tr } = useLocale();
    return (
        <div className="segmented" role="group" aria-label={tr("Exibição")}>
            {MODES.map(([id, label]) => (
                <button key={id} className={mode === id ? 'active' : ''} onClick={() => onChange(id)}>{tr(label)}</button>
            ))}
        </div>
    );
}

export default function ItemCollection({ items, mode, actions, onOpen, badges, selectedKey }) {
    const { tr } = useLocale();
    const open = (item) => (onOpen ? () => onOpen(item) : undefined);
    const stop = (event) => event.stopPropagation();
    if (mode === 'table') {
        return (
            <div className="panel table-wrap">
                <table className="item-table">
                    <thead>
                        <tr><th aria-label={tr("Ícone")} /><th>{tr("Nome")}</th><th>{tr("Tipo")}</th><th>{tr("Qtd.")}</th><th aria-label={tr("Ações")} /></tr>
                    </thead>
                    <tbody>
                        {items.map((item) => (
                            <tr key={item.key} onClick={open(item)} className={`${onOpen ? 'clickable' : ''} ${selectedKey === item.key ? 'selected' : ''}`}>
                                <td><Icon id={item.iconId} size={32} /></td>
                                <td><strong>{item.name}</strong> {badges?.(item)}</td>
                                <td>{tr(item.categoryLabel)}</td>
                                <td>{item.quantity ?? ''}</td>
                                <td className="item-actions" onClick={stop}>{actions?.(item)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    }
    return (
        <div className={`item-grid ${mode}`}>
            {items.map((item) => (
                <article key={item.key} onClick={open(item)}
                    className={`item-card ${onOpen ? 'clickable' : ''} ${selectedKey === item.key ? 'selected' : ''}`}>
                    <Icon id={item.iconId} size={null} />
                    <div className="item-body">
                        <strong title={item.name}>{item.name}</strong>
                        <small>{tr(item.categoryLabel)}</small>
                        {badges && <span className="badges">{badges(item)}</span>}
                        {actions && <div className="item-actions" onClick={stop}>{actions(item)}</div>}
                    </div>
                </article>
            ))}
        </div>
    );
}
