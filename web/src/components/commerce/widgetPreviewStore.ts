/**
 * Общий предпросмотр виджета Commerce Agents: один iframe на кабинет (правая колонка на десктопе,
 * под формой на телефоне). Страницы шлют черновик настроек через postPreview(), после сохранения
 * зовут refreshPreview() — iframe перезагружается с сохранёнными настройками. Без React-зависимостей,
 * чтобы api.ts мог дёргать refreshPreview() после PUT /settings.
 */

type Listener = () => void;

let frame: HTMLIFrameElement | null = null;
let lastDraft: Record<string, unknown> | null = null;
const listeners = new Set<Listener>();

/** Iframe предпросмотра регистрируется компонентом WidgetPreview (null при размонтировании). */
export function registerPreviewFrame(el: HTMLIFrameElement | null): void {
  frame = el;
  if (el && lastDraft) postPreview(lastDraft);
}

/** Черновик оформления (не сохранённый) — виджет перерисовывается сразу. */
export function postPreview(config: Record<string, unknown>): void {
  lastDraft = config;
  try { frame?.contentWindow?.postMessage({ type: 'comag', action: 'preview', config }, '*'); } catch { /* ignore */ }
}

/** Виджет прислал «ready» после загрузки — досылаем черновик, если он есть. */
export function onPreviewReady(): void { if (lastDraft) postPreview(lastDraft); }

/** Настройки сохранены — сбрасываем черновик и перезагружаем iframe. */
export function refreshPreview(): void {
  lastDraft = null;
  for (const fn of Array.from(listeners)) { try { fn(); } catch { /* ignore */ } }
}

export function subscribePreviewRefresh(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
