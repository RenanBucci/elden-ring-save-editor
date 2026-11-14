import pt from './pt-BR.json';
import en from './en.json';
import messages from './messages.en.json';

const PACKS = { 'pt-BR': pt, en };

export function translate(lang, key) {
    const pack = PACKS[lang] || PACKS['pt-BR'];
    return pack[key] || PACKS.en[key] || key;
}

export const LANGUAGES = [
    { id: 'pt-BR', label: 'Português' },
    { id: 'en', label: 'English' },
];

// Source messages are keys; interpolated values (names, paths, counts) stay intact.
export function translateText(lang, message, values = []) {
    const text = lang === 'en' ? (messages[message] ?? message) : message;
    return typeof text === 'string' ? text.replace(/\{(\d+)\}/g, (match, index) => values[index] ?? match) : text;
}

export function savedLanguage() {
    try { return localStorage.getItem('language') === 'en' ? 'en' : 'pt-BR'; }
    catch { return 'pt-BR'; }
}
