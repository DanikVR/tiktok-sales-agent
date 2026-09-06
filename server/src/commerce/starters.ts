/**
 * Стартовые подсказки виджета: если владелец не задал свои, подбираем по каталогу —
 * услуги или товары, есть ли цены, доставка в условиях, посты из соцсетей, запись.
 * Тексты — из локалей commerce.json (w.starters.*), 108 языков, fallback en → ru.
 */
import type { CatalogSummary } from './catalog.js';
import { tw } from './i18n.js';

export interface StarterInput { lang: string; summary: CatalogSummary; policies: string; hasPosts: boolean }

function niceBudget(min: number | null, max: number | null): number | null {
  if (max == null || max <= 0) return null;
  const raw = min != null && min > 0 ? min + (max - min) * 0.4 : max * 0.6;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = Math.ceil(raw / mag);
  const step = n <= 2 ? 0.5 : 1;
  return Math.round(Math.ceil(raw / (mag * step)) * mag * step);
}
function fmt(n: number, currency: string, lang: string): string {
  try { return new Intl.NumberFormat(lang, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n); } catch { return `${n} ${currency}`; }
}

export function defaultStarters(i: StarterInput): string[] {
  const lang = i.lang || 'en';
  const t = (k: string, p?: Record<string, string | number>) => tw(lang, `w.starters.${k}`, p);
  const s = i.summary;
  const hasDelivery = /достав|deliver|shipping|dostaw|wysyłk|самовывоз|pickup|liefer|livraison|envío|entrega|consegna/i.test(i.policies);
  const hasBooking = /запис|book|appointment|umów|консультац|consult|termin|rendez|cita|prenot/i.test(i.policies);
  const servicesMode = s.total > 0 && (s.services >= s.total / 2 || s.with_price === 0);
  const budget = niceBudget(s.min_price, s.max_price);
  const cur = s.currency || 'EUR';
  if (!s.total) return [t('empty1'), t('empty2'), t('empty3')];
  if (servicesMode) return [t('services1'), i.hasPosts ? t('servicesExamples') : t('servicesFit'), s.with_price > 0 ? t('servicesPrice') : (hasBooking ? t('servicesBook') : t('servicesQuote'))];
  return [t('products1'), budget ? t('productsBudget', { budget: fmt(budget, cur, lang) }) : t('productsNew'), hasDelivery ? t('productsDelivery') : (i.hasPosts ? t('productsExamples') : t('productsPay'))];
}
