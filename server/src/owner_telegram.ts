/**
 * In the hosted edition the owner also has a personal Telegram bot bound to the whole account.
 * Self-hosted: owner notifications go through commerce/notify.ts (COMMERCE_TELEGRAM_BOT_TOKEN or the
 * bot token saved in the console), so this hook is a no-op kept for source compatibility.
 */
export async function sendOwnerNotification(_tenantId: string, _text: string): Promise<void> { /* handled by commerce/notify.ts */ }
