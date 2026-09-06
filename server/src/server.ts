/**
 * effective-commerce-agents — self-hosted server.
 *
 *   /api/commerce/w/:slug/*   public widget API (no auth, rate-limited)
 *   /api/commerce/*           owner console API (Authorization: Bearer ADMIN_TOKEN)
 *   /comag.js                 one-line widget loader for any site
 *   /embed/commerce/:slug     widget iframe page, /c/:slug hosted chat page, /console owner console
 *
 * Hosted edition with multi-tenant cabinet, billing and support: https://comag.vibevox.pro
 */
import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { migrate } from './migrate.js';
import { ADMIN_TOKEN, getCommerceTelegramBotToken } from './config.js';
import commerceRouter, { commercePublicRouter, commerceHostedPage, commerceServiceWorker } from './commerce/router.js';
import { ensurePlatformWebhook } from './commerce/notify.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = fs.existsSync(path.resolve(here, '../../web')) ? path.resolve(here, '../..') : path.resolve(here, '../../..');
const WEB_DIST = path.join(ROOT, 'web', 'dist');
const PORT = Number(process.env.PORT || 3001);

async function main() {
  if (!ADMIN_TOKEN) console.warn('[server] ADMIN_TOKEN is empty — the owner console is disabled until you set it in .env');
  await migrate();

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  // Public widget API first (no auth), then the owner API (Bearer ADMIN_TOKEN).
  app.use('/api/commerce', commercePublicRouter);
  app.use('/api/commerce', commerceRouter);
  app.use('/api/uploads', express.static(path.join(ROOT, 'uploads'), { maxAge: '1h' }));

  // Widget loader + built console/widget (web/dist). Run `npm run build` in web/ first.
  app.get('/comag.js', (_req, res) => res.sendFile(path.join(ROOT, 'public', 'comag.js')));
  app.get('/c/sw.js', commerceServiceWorker);
  app.get('/c/:slug', commerceHostedPage(path.join(WEB_DIST, 'index.html')));
  app.use(express.static(WEB_DIST, { index: false, maxAge: '1h' }));
  app.get(['/', '/console', '/console/*', '/commerce', '/commerce/*', '/embed/commerce/:slug'], (_req, res) => {
    const index = path.join(WEB_DIST, 'index.html');
    if (!fs.existsSync(index)) return res.status(503).send('web/dist is not built yet: cd web && npm install && npm run build');
    res.set('Cache-Control', 'no-cache');
    return res.sendFile(index);
  });

  app.listen(PORT, () => {
    console.log(`[server] http://localhost:${PORT}  console: /console  widget: <script async src="http://localhost:${PORT}/comag.js" data-shop="<slug>"></script>`);
    if (getCommerceTelegramBotToken()) setTimeout(() => { ensurePlatformWebhook().catch(() => {}); }, 3000);
  });
}

main().catch((e) => { console.error('[server] fatal:', e); process.exit(1); });
