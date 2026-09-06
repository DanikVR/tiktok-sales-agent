# TikTok Sales Agent — turn a TikTok profile into a Claude shopping agent

[![Hosted edition](https://img.shields.io/badge/hosted%20edition-comag.vibevox.pro-2F7D5A?logo=googlechrome&logoColor=white)](https://comag.vibevox.pro/?utm_source=github&utm_medium=badge&utm_campaign=tiktok-sales-agent)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

You sell on TikTok: the products live in your videos, the prices are said out loud, and every DM asks the same questions. This repo reads a **public TikTok profile**, turns the last 10–100 videos into a **product catalog** (speech, on-screen text and mentioned prices included), and puts a **Claude sales agent** in front of it — as a widget on your site, as a shareable chat page (`/c/<slug>`) you can put in your bio, and as an owner console with staged, approved edits.

Built on Anthropic's [*The anatomy of effective commerce agents*](https://claude.com/blog/the-anatomy-of-effective-commerce-agents) patterns: one agent loop, tools over your data, server-issued product IDs, fenced third-party text, staged merchant writes.

> **No server?** The hosted edition does the same from a cabinet: **[comag.vibevox.pro](https://comag.vibevox.pro/?utm_source=github&utm_medium=readme&utm_campaign=tiktok-sales-agent)**. Author: **[t.me/GuruAppSheet](https://t.me/GuruAppSheet)**.

## How the TikTok import works

```
@yourshop ──► yt-dlp --impersonate chrome (public profile, flat playlist)  ──► last N posts
             ──► TikTok oEmbed (caption, cover)                             ──► "fast" depth
             ──► video ≤3 min / ≤60 MB → Gemini: speech, on-screen text, frame description, prices ──► "deep" depth
             ──► Claude emit_catalog (strict tool schema) ──► products / services with prices or "price on request"
             ──► covers saved locally (TikTok CDN links expire) ──► commerce_posts for "show me examples / reviews / offers"
```

- **What the owner provides:** only `@profile` or a profile link. No TikTok login, no cookies.
- **Depth:** *fast* (captions + covers) or *deep* (downloads each video to a temp folder, Gemini returns transcript, on-screen text and mentioned prices, the file is deleted). 100 posts deep ≈ 10–12 minutes.
- **Prices:** only when said explicitly; otherwise the product is created with *price on request* and the agent collects a lead instead of inventing a number.
- **Posts stay searchable:** the agent's `search_posts` / `present_posts` tools show the original videos when a shopper asks for examples or reviews.

Code: `server/src/commerce/social.ts` (`tiktokFetchProfile`, `startSocialAnalysis`, `analyzeVideo`), `posts.ts`, console card `web/src/pages/commerce/SocialImportCard.tsx`.

## Quick start

```bash
git clone https://github.com/DanikVR/tiktok-sales-agent.git && cd tiktok-sales-agent
cp .env.example .env        # ANTHROPIC_API_KEY, ADMIN_TOKEN, APP_SECRET; GEMINI_API_KEY for deep analysis
docker compose up --build   # Postgres + app (+ yt-dlp, curl_cffi, ffmpeg inside the image) → http://localhost:3001
```

Open `http://localhost:3001/commerce` → *Settings → Sources → TikTok* → paste `@profile` → choose 10 / 25 / 50 / 100 posts and *fast* / *deep* → *Analyze*. When it finishes, the catalog page shows the products; the widget snippet and the `/c/<slug>` link are in *Widget*.

Without Docker you need `yt-dlp` with `curl_cffi` (`pip install yt-dlp curl_cffi`) and `ffmpeg` on PATH: without browser impersonation TikTok returns an empty list to server IPs.

## Requirements

Node.js 20+, Postgres 13+, Anthropic API key; for deep analysis a Gemini API key, `yt-dlp` + `curl_cffi` + `ffmpeg`.

## Everything else

The agent, the owner console, the widget, the site crawlers (Shopify, WooCommerce, Magento, JSON-LD, feeds), guardrails and the API are the same as in the core repository — see **[effective-commerce-agents](https://github.com/DanikVR/effective-commerce-agents)** for the full README, the mapping to Anthropic's [*The anatomy of effective commerce agents*](https://claude.com/blog/the-anatomy-of-effective-commerce-agents), configuration and the security model. This repository is a complete copy of that code with the TikTok importer front and centre, so you can clone it alone.

## Hosted edition

**[comag.vibevox.pro](https://comag.vibevox.pro/?utm_source=github&utm_medium=readme&utm_campaign=tiktok-sales-agent)** runs this agent for you: connect a TikTok profile in the cabinet, get the widget and the share page, notifications in Telegram, 108 interface languages, updates and support. Contact the author: **[t.me/GuruAppSheet](https://t.me/GuruAppSheet)**.

## License

Apache-2.0 © DanikVR. Built on the patterns and guardrails of [anthropics/commerce-agents](https://github.com/anthropics/commerce-agents) (Apache-2.0), see [NOTICE](NOTICE). Russian README: [README.ru.md](README.ru.md).
