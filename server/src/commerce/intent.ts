/**
 * Сигналы намерения покупателя по тексту его сообщений: «куплю», просьба перезвонить, оставленный телефон/email,
 * вопросы о цене, доставке, оплате, наличии. Плюс события (корзина, оформление, заявка, покупка) — их добавляет код.
 * Итог — статус клиента: hot (готов к покупке / оставил контакт), warm (интересуется), cold (смотрит).
 * Многоязычные словари: ru, uk, en, pl, de, es, fr, it.
 */

export interface Signal { k: string; at: string; text?: string }
export type Intent = 'cold' | 'warm' | 'hot';

const RULES: Array<[string, RegExp]> = [
  ['buy', /(куплю|покупаю|беру\b|хочу купить|хочу заказать|заказать|заказываю|оформи(те)?\b|оформить заказ|оформляю|\bbuy( it| this| now)?\b|i'?ll take( it| this)?|\bpurchase\b|order (it|this|now)|place an order|kupuję|zamawiam|chcę zamówić|купую|замовити|замовляю|\bkaufen\b|\bbestellen\b|\bcomprar\b|\bacheter\b|\bcommander\b|\bcompro\b|\bordino\b)/iu],
  ['contact', /(позвони(те)?\b|перезвони(те)?\b|свяжитесь|мой номер|мой телефон|напишите мне|call me|contact me|my number|my phone|zadzwoń|mój numer|подзвоніть|мій номер|ruf mich an|llámame|appelez-moi)/iu],
  ['price', /(сколько стоит|стоимость|\bprice\b|how much|ile kosztuje|\bcena\b|скільки коштує|\bpreis\b|\bkostet\b|\bprecio\b|\bprix\b|\bprezzo\b|\bцена\b|\bцену\b|\bцены\b)/iu],
  ['delivery', /(доставк|delivery|shipping|dostaw|wysyłk|lieferung|versand|env[ií]o|livraison|consegna)/iu],
  ['payment', /(оплат|payment|\bpay\b|płatno|zapłac|zahlung|bezahlen|\bpago\b|paiement|pagamento)/iu],
  ['availability', /(в наличии|есть ли\b|available|in stock|dostępn|в наявності|verfügbar|disponible|disponibile)/iu],
];
const PHONE = /(?:\+|\b)\d[\d\s().-]{7,}\d/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;

export const HOT_SIGNALS = new Set(['buy', 'contact', 'phone_given', 'email_given', 'lead', 'checkout', 'purchase']);
export const WARM_SIGNALS = new Set(['price', 'delivery', 'payment', 'availability', 'cart']);

/** Сигналы и контакт из текста сообщения покупателя. */
export function detectSignals(text: string): { signals: string[]; contact: { phone?: string; email?: string } } {
  const t = String(text || '').slice(0, 2000);
  const signals: string[] = [];
  for (const [k, re] of RULES) if (re.test(t)) signals.push(k);
  const contact: { phone?: string; email?: string } = {};
  const phone = PHONE.exec(t)?.[0];
  if (phone && phone.replace(/\D/g, '').length >= 9) { contact.phone = phone.trim(); signals.push('phone_given'); }
  const email = EMAIL.exec(t)?.[0];
  if (email) { contact.email = email; signals.push('email_given'); }
  return { signals, contact };
}

export function intentOf(signals: Signal[]): Intent {
  if (signals.some((s) => HOT_SIGNALS.has(s.k))) return 'hot';
  if (signals.some((s) => WARM_SIGNALS.has(s.k))) return 'warm';
  return 'cold';
}
