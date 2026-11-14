import { LocaleContext } from './i18n/locale';
import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from './api';
import { LANGUAGES, translate, translateText, savedLanguage } from './i18n';
import EditorScreen from './screens/EditorScreen';
import InventoryScreen from './screens/InventoryScreen';
import AddItemsScreen from './screens/AddItemsScreen';
import BuildsScreen from './screens/BuildsScreen';
import WorldScreen from './screens/WorldScreen';
import AppearanceScreen from './screens/AppearanceScreen';
import ModsScreen from './screens/ModsScreen';
import BackupsScreen from './screens/BackupsScreen';
import SlotsScreen from './screens/SlotsScreen';
import AboutScreen from './screens/AboutScreen';
import SaveChooser from './components/SaveChooser';

const NAV = [
    ['editor', 'nav.editor'],
    ['gear', 'nav.gear'],
    ['add', 'nav.add'],
    ['builds', 'nav.builds'],
    ['world', 'nav.world'],
    ['appearance', 'nav.appearance'],
    ['mods', 'nav.mods'],
    ['backups', 'nav.backups'],
    ['slots', 'nav.slots'],
    ['about', 'nav.about'],
];

export default function App() {
    const [lang, setLang] = useState(savedLanguage);
    const tr = (message, values) => translateText(lang, message, values);
    const [info, setInfo] = useState(null);
    const [saveFile, setSaveFile] = useState('');
    const [slots, setSlots] = useState([]);
    const [slot, setSlot] = useState(0);
    const [screen, setScreen] = useState('editor');
    const [toast, setToast] = useState(null);
    const [savingCopy, setSavingCopy] = useState(false);
    const [revision, setRevision] = useState(0);
    const toastTimer = useRef(null);
    const t = (key) => translate(lang, key);

    const notify = useCallback((message, isError = false) => {
        setToast({ message, isError });
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 5000);
    }, []);

    const load = useCallback(() => Promise.all([call('detect'), call('slots')]).then(([detected, current]) => {
        setInfo(detected);
        if (current?.ok) {
            setSaveFile(current.file);
            setSlots(current.slots);
            setSlot((index) => {
                if (current.slots[index] && !current.slots[index].empty) return index;
                return current.slots.find((entry) => !entry.empty)?.index ?? 0;
            });
        }
    }), []);
    const refresh = () => { load(); };

    useEffect(() => {
        load();
        return () => clearTimeout(toastTimer.current);
    }, [load]);

    useEffect(() => {
        document.documentElement.lang = lang;
        try { localStorage.setItem('language', lang); } catch { /* Storage may be unavailable. */ }
    }, [lang]);

    async function open(file) {
        const result = await call('openSave', file);
        if (!result?.ok) { notify(result?.error || tr("Não foi possível abrir o save"), true); return; }
        setSaveFile(file);
        setSlots(result.slots);
        const first = result.slots.find((entry) => !entry.empty);
        setSlot(first ? first.index : 0);
        setRevision((value) => value + 1);
        setScreen('editor');
    }

    const current = slots[slot];
    const playable = slots.filter((entry) => !entry.empty);

    return (
        <LocaleContext.Provider value={lang}>
        <div className="shell">
            <header className="topbar">
                <img className="brand-icon" src="/app-icon.png" alt="" />
                <div className="brand">
                    <h1>{t('app.title')}</h1>
                    <p>{t('app.subtitle')}</p>
                </div>
                <button className="file-card" onClick={() => setScreen('slots')}>
                    <span>{info?.gameRunning ? t('top.game') : (current?.name || t('top.detecting'))}</span>
                    <strong>{current && !current.empty ? tr("{0} · nv {1}", [current.name, current.level]) : (saveFile.split(/[/\\]/).pop() || '—')}</strong>
                </button>
                <div className="top-actions">
                    {screen === 'editor' && <button type="submit" form="save-character" disabled={!saveFile || info?.gameRunning}>{tr("Salvar")}</button>}
                    <button disabled={!saveFile || savingCopy || info?.gameRunning} title={tr("Salva uma cópia completa das alterações já aplicadas; aplique os campos pendentes primeiro.")} onClick={async () => {
                        setSavingCopy(true);
                        const result = await call('saveCopy');
                        setSavingCopy(false);
                        notify(result?.ok ? tr("Cópia salva em {0}", [result.path]) : (result?.error || tr("Falha ao salvar cópia.")), !result?.ok);
                    }}>{savingCopy ? tr("Salvando…") : tr("Salvar cópia")}</button>

                    <input className="search backup-name" placeholder={tr("Nome do backup")} id="backup-name" />
                    <button disabled={!saveFile} onClick={async () => {
                        const field = document.getElementById('backup-name');
                        const label = field?.value?.trim() || 'manual';
                        const result = await call('backupNow', label);
                        if (result?.ok && field) field.value = '';
                        notify(result?.ok ? tr("Backup criado.") : (result?.error || tr("Falha")), !result?.ok);
                    }}>{t('top.backup')}</button>
                    <button disabled={!saveFile} onClick={() => setScreen('backups')}>{t('top.restore')}</button>
                    <button disabled={!saveFile} onClick={async () => {
                        const result = await call('undo');
                        if (!result?.ok) { notify(result?.error || tr("Desfazer fica disponível no aplicativo Tauri, depois de gravar."), true); return; }
                        notify(tr("Alteração desfeita."));
                        setRevision((value) => value + 1);
                        refresh();
                    }}>{tr("Desfazer")}</button>
                    <select value={lang} onChange={(event) => setLang(event.target.value)} aria-label={t('lang')}>
                        {LANGUAGES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </select>
                </div>
            </header>
            <div className="banner risk-disclaimer" role="note">{tr("Edite por sua conta e risco. Qualquer alteração no save pode causar perda de progresso, corromper o arquivo ou resultar em banimento, especialmente ao jogar online. Nenhuma operação é garantida como segura. Faça backup e use o editor com o jogo fechado e offline.")}</div>
            {info?.gameRunning && <div className="banner">{t('top.close')}</div>}
            {!saveFile && (
                <section className="welcome">
                    <img src="/app-icon.png" alt="" />
                    <div className="welcome-copy">
                    <h2>{t('app.title')}</h2>
                    <p>{info?.saves?.length ? tr("Escolha um save para começar.") : (tr(info?.error) || tr("Procurando saves…"))}</p>
                    <SaveChooser saves={info?.saves} onOpen={open} />
                    </div>
                </section>
            )}
            {saveFile && (
                <div className="workspace">
                    <aside>
                        <select value={slot} onChange={(event) => { setSlot(Number(event.target.value)); }}>
                            {playable.map((entry) => <option key={entry.index} value={entry.index}>{entry.name} {tr("· nv")} {entry.level}</option>)}
                        </select>
                        {NAV.map(([id, key]) => (
                            <button key={id} className={screen === id ? 'nav active' : 'nav'} onClick={() => setScreen(id)}>{t(key)}</button>
                        ))}
                    </aside>
                    <main key={`${saveFile}:${revision}`}>
                        {screen === 'editor' && <EditorScreen key={slot} slot={slot} lang={lang} toast={notify} onApplied={refresh} />}
                        {screen === 'gear' && <InventoryScreen key={slot} slot={slot} lang={lang} toast={notify} onApplied={refresh} onAdd={() => setScreen('add')} />}
                        {screen === 'add' && <AddItemsScreen key={slot} slot={slot} lang={lang} toast={notify} onApplied={refresh} />}
                        {screen === 'builds' && <BuildsScreen key={slot} slot={slot} slots={slots} lang={lang} toast={notify} onApplied={refresh} />}
                        {screen === 'world' && <WorldScreen key={slot} slot={slot} toast={notify} onApplied={refresh} />}
                        {screen === 'appearance' && <AppearanceScreen key={slot} slot={slot} slots={slots} lang={lang} toast={notify} onApplied={refresh} />}
                        {screen === 'mods' && <ModsScreen gameDir={info?.gameDir} toast={notify} />}
                        {screen === 'backups' && <BackupsScreen toast={notify} onApplied={(reset) => { if (reset) { setSaveFile(''); setSlots([]); } refresh(); }} />}
                        {screen === 'slots' && <SlotsScreen slots={slots} saves={info?.saves} saveFile={saveFile} onOpen={open} toast={notify} onApplied={refresh} />}
                        {screen === 'about' && <AboutScreen />}
                    </main>
                </div>
            )}
            {toast && <div role={toast.isError ? 'alert' : 'status'} className={toast.isError ? 'toast error' : 'toast'}>{tr(toast.message)}</div>}
        </div>
        </LocaleContext.Provider>
    );
}
