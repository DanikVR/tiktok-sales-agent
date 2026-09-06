/**
 * VibeVox — отправка письма КЛИЕНТУ (канал «email» единого ответа, #3).
 *
 * Переиспользует тот же SMTP, что и письма авторизации (Hostinger 465, env
 * SMTP_HOST/PORT/USER/PASS). null-безопасно: если SMTP не настроен — возвращаем
 * { ok:false } без падения (диспетчер откатится на приватную заметку оператору).
 */
import nodemailer from 'nodemailer';

function buildTransport() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465 → SSL/TLS (Hostinger); 587 → STARTTLS
    auth: { user, pass },
  });
}

export interface SendEmailResult {
  ok: boolean;
  error?: string;
}

/** Вложение письма: nodemailer скачает файл по `path` (URL) и приложит под именем `filename`. */
export interface EmailAttachment {
  filename: string;
  path: string;            // абсолютный URL (напр. data_url вложения Chatwoot)
  contentType?: string | null;
}

/**
 * Письмо клиенту от имени компании (fromName) на его email.
 * @param to          email получателя
 * @param subject     тема
 * @param text        текст (plain); html соберём из него (перенос строк → <br>)
 * @param fromName    отображаемое имя отправителя (название компании/виджета)
 * @param attachments вложения (картинка/видео/файл) — nodemailer скачивает по URL и прикладывает
 */
export async function sendClientEmail(
  to: string,
  subject: string,
  text: string,
  fromName?: string,
  attachments?: EmailAttachment[],
): Promise<SendEmailResult> {
  const transport = buildTransport();
  if (!transport) return { ok: false, error: 'SMTP не настроен на сервере' };
  if (!to || !/.+@.+\..+/.test(to)) return { ok: false, error: 'Некорректный email получателя' };
  const from = process.env.SMTP_FROM || process.env.SMTP_USER!;
  const html = String(text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
  const atts = Array.isArray(attachments)
    ? attachments.filter((a) => a?.path).map((a) => ({
        filename: a.filename || 'attachment',
        path: a.path,                                    // nodemailer сам скачает http(s)-URL
        ...(a.contentType ? { contentType: a.contentType } : {}),
      }))
    : [];
  try {
    await transport.sendMail({
      from: fromName ? `"${fromName.replace(/"/g, '')}" <${from}>` : from,
      to,
      subject: subject || 'Сообщение',
      text: text || '',
      html,
      ...(atts.length ? { attachments: atts } : {}),
    });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}
