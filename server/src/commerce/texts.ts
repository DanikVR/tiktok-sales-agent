/**
 * Commerce Agents — автоматические тексты витрины после анализа: приветствие виджета, заголовок и
 * описание превью для ссылки. Один короткий вызов Claude с жёсткой схемой; заполняются только
 * пустые поля, владелец потом правит их в разделе «Виджет».
 */

import { makeAnthropicClient, resolveAnthropicKey, shoppingModel } from './anthropic.js';
import { getSettings, updateSettings } from './settings.js';

export interface StorefrontTextInput {
  brand: string;
  summary?: string | null;
  categories?: string[];
  sampleTitles?: string[];
  kind?: 'products' | 'services' | 'mixed';
  langHint?: string | null;
  source?: string;
}

const TOOL = {
  name: 'emit_texts',
  description: 'Короткие тексты витрины для чата и превью ссылки.',
  input_schema: {
    type: 'object' as const,
    properties: {
      greeting: { type: 'string', description: 'Первая фраза ассистента в чате, 1–2 предложения, ≤ 160 символов, на языке каталога. Тёплая, конкретная: что поможет подобрать.' },
      share_title: { type: 'string', description: 'Заголовок превью ссылки, ≤ 60 символов: название и суть в 2–5 словах.' },
      share_description: { type: 'string', description: 'Описание превью, ≤ 140 символов: что можно спросить у ассистента, с 1–2 примерами категорий.' },
    },
    required: ['greeting', 'share_title', 'share_description'],
  },
};

/** Заполняет пустые поля greeting / share_title / share_description. Best-effort: ошибки глотает. */
export async function fillStorefrontTexts(tenantId: string, input: StorefrontTextInput): Promise<Record<string, string>> {
  try {
    const s = await getSettings(tenantId);
    const need = { greeting: !(s.greeting || '').trim(), share_title: !(s.share_title || '').trim(), share_description: !(s.share_description || '').trim() };
    if (!need.greeting && !need.share_title && !need.share_description) return {};
    const key = await resolveAnthropicKey(tenantId);
    if (!key) return {};
    const client = makeAnthropicClient(key.key);
    const ctx = [
      `Бренд: ${input.brand || s.brand_name || '—'}`,
      input.kind ? `Тип каталога: ${input.kind === 'services' ? 'услуги' : input.kind === 'mixed' ? 'товары и услуги' : 'товары'}` : '',
      input.categories?.length ? `Категории: ${input.categories.slice(0, 8).join(', ')}` : '',
      input.sampleTitles?.length ? `Примеры позиций: ${input.sampleTitles.slice(0, 8).join('; ')}` : '',
      input.summary ? `О бизнесе: ${input.summary.slice(0, 600)}` : '',
      input.langHint ? `Язык каталога: ${input.langHint}` : 'Язык: как у названий позиций и описания бизнеса.',
    ].filter(Boolean).join('\n');
    const res = await client.messages.create({
      model: shoppingModel(s.shopping_model), max_tokens: 400,
      system: 'Ты пишешь короткие тексты для чат-ассистента магазина. Только по данным ниже, без выдумок и без обещаний скидок. Без восклицательных знаков подряд, без эмодзи.',
      tools: [TOOL as any], tool_choice: { type: 'tool', name: 'emit_texts' },
      messages: [{ role: 'user', content: `<store_data>\n${ctx}\n</store_data>\n\nВызови emit_texts.` }],
    });
    const tu: any = res.content.find((b: any) => b.type === 'tool_use');
    const out: Record<string, string> = {};
    const clean = (v: unknown, max: number) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
    if (need.greeting && tu?.input?.greeting) out.greeting = clean(tu.input.greeting, 300);
    if (need.share_title && tu?.input?.share_title) out.share_title = clean(tu.input.share_title, 120);
    if (need.share_description && tu?.input?.share_description) out.share_description = clean(tu.input.share_description, 300);
    if (Object.keys(out).length) await updateSettings(tenantId, out as any);
    return out;
  } catch (e) {
    console.warn('[commerce/texts] не удалось сгенерировать тексты:', (e as Error).message);
    return {};
  }
}
