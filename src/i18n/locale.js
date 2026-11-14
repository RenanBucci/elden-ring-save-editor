import { createContext, useContext } from 'react';
import { translateText } from './index';

export const LocaleContext = createContext('pt-BR');

export function useLocale() {
    const lang = useContext(LocaleContext);
    return { lang, tr: (message, values) => translateText(lang, message, values) };
}
