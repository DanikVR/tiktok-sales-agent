/**
 * Шифрование Enterprise-секретов (Gemini API key, Chatwoot URL/token и др.).
 *
 * Использует тот же ключ APP_SECRET и алгоритм AES-256-GCM, что и
 * `utils/crypto.ts` для SIP-паролей — единая инфраструктура секретов.
 *
 * Формат шифротекста: `ciphertext:iv:authTag` (hex, через двоеточие).
 * Это совместимо с SIP-секретами; никаких изменений в формате нет.
 *
 * ВАЖНО: при пустой / NULL входной строке возвращаем NULL — не шифруем
 * "пустоту", чтобы не путать схему БД лишним мусором.
 */

import crypto from 'crypto';

function getKey(): Buffer {
  const rawKey = process.env.APP_SECRET;
  if (!rawKey) {
    throw new Error('Критическая ошибка: APP_SECRET не задан в env (AES-256-GCM for stored API keys).');
  }
  return crypto.createHash('sha256').update(rawKey).digest();
}

/**
 * Шифрует произвольную строку. Возвращает строку формата ciphertext:iv:authTag,
 * либо null если на вход пришло пустое значение.
 */
export function encryptSecret(plain: string | null | undefined): string | null {
  if (!plain) return null;
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plain, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${encrypted}:${iv.toString('hex')}:${authTag}`;
}

/**
 * Дешифрует строку ciphertext:iv:authTag. Возвращает null при пустом input
 * или при ошибке (битый формат / сменился ключ) — без throw, чтобы не валить
 * вызывающий код при единичном повреждении записи в БД.
 */
export function decryptSecret(encrypted: string | null | undefined): string | null {
  if (!encrypted) return null;
  try {
    const parts = encrypted.split(':');
    if (parts.length !== 3) return null;
    const [ciphertext, ivHex, authTagHex] = parts;
    const key = getKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.warn('[tenant_settings/encryption] Ошибка дешифровки:', (err as Error).message);
    return null;
  }
}

/** Маска для отображения секрета на клиенте. */
export const SECRET_MASK = '********************************';
