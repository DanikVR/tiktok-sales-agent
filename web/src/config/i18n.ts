import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../../../locales/en/commerce.json';
import ru from '../../../locales/ru/commerce.json';

const saved = (() => { try { return localStorage.getItem('eca_lang') || ''; } catch { return ''; } })();
const browser = (typeof navigator !== 'undefined' ? navigator.language : 'en').slice(0, 2);

void i18n.use(initReactI18next).init({
  resources: { en: { commerce: en }, ru: { commerce: ru } },
  lng: saved || (browser === 'ru' ? 'ru' : 'en'),
  fallbackLng: 'en',
  ns: ['commerce'],
  defaultNS: 'commerce',
  interpolation: { escapeValue: false },
});

export function setLanguage(lng: string) { try { localStorage.setItem('eca_lang', lng); } catch { /* ignore */ } void i18n.changeLanguage(lng); }
export default i18n;
