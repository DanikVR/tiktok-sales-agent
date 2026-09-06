# TikTok Sales Agent — агент-продавец на Claude из профиля TikTok

[![Хостед-версия](https://img.shields.io/badge/hosted%20edition-comag.vibevox.pro-2F7D5A?logo=googlechrome&logoColor=white)](https://comag.vibevox.pro/?utm_source=github&utm_medium=badge&utm_campaign=tiktok-sales-agent)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Вы продаёте через TikTok: товары живут в видео, цены называются голосом, а в личку приходят одни и те же вопросы. Этот репозиторий читает **публичный профиль TikTok**, превращает последние 10–100 видео в **каталог товаров** (с речью, текстом на экране и названными ценами) и ставит перед ним **агента-продавца на Claude**: виджет на сайте, страница чата `/c/<slug>` для ссылки в био и кабинет владельца с правками через подтверждение.

Построено на паттернах статьи Anthropic [*The anatomy of effective commerce agents*](https://claude.com/blog/the-anatomy-of-effective-commerce-agents): один цикл агента, инструменты поверх ваших данных, id товаров только с сервера, fence вокруг стороннего текста, staged-правки владельца.

> **Без сервера?** Хостед-версия делает то же из кабинета: **[comag.vibevox.pro](https://comag.vibevox.pro/?utm_source=github&utm_medium=readme&utm_campaign=tiktok-sales-agent)**. Автор: **[t.me/GuruAppSheet](https://t.me/GuruAppSheet)**.

## Как устроен импорт из TikTok

```
@магазин ──► yt-dlp --impersonate chrome (публичный профиль)  ──► последние N постов
          ──► TikTok oEmbed (подпись, обложка)                 ──► глубина «быстро»
          ──► видео ≤3 мин / ≤60 МБ → Gemini: речь, текст на экране, описание кадра, цены ──► глубина «глубоко»
          ──► Claude emit_catalog (строгая схема) ──► товары и услуги с ценой или «цена по запросу»
          ──► обложки сохраняются локально (ссылки CDN истекают) ──► commerce_posts для «покажи примеры / отзывы / акции»
```

- **От владельца** нужен только `@профиль` или ссылка. Без входа в TikTok и без cookies.
- **Глубина:** *быстро* (подписи и обложки) или *глубоко* (каждое видео скачивается во временную папку, Gemini возвращает расшифровку, текст на экране и цены, файл удаляется). 100 постов глубоко ≈ 10–12 минут.
- **Цены** только если названы явно; иначе товар создаётся с «ценой по запросу», и агент собирает заявку, а не выдумывает число.
- **Посты остаются в поиске:** инструменты `search_posts` / `present_posts` показывают оригинальные видео, когда покупатель просит примеры или отзывы.

Код: `server/src/commerce/social.ts` (`tiktokFetchProfile`, `startSocialAnalysis`, `analyzeVideo`), `posts.ts`, карточка кабинета `web/src/pages/commerce/SocialImportCard.tsx`.

## Быстрый старт

```bash
git clone https://github.com/DanikVR/tiktok-sales-agent.git && cd tiktok-sales-agent
cp .env.example .env        # ANTHROPIC_API_KEY, ADMIN_TOKEN, APP_SECRET; GEMINI_API_KEY для глубокого анализа
docker compose up --build   # Postgres + приложение (yt-dlp, curl_cffi, ffmpeg внутри образа) → http://localhost:3001
```

Откройте `http://localhost:3001/commerce` → «Настройки → Источники → TikTok» → вставьте `@профиль` → 10 / 25 / 50 / 100 постов, «быстро» или «глубоко» → «Анализировать». Готовые товары появятся в «Каталоге», сниппет виджета и ссылка `/c/<slug>` — в «Виджете».

Без Docker нужны `yt-dlp` с `curl_cffi` (`pip install yt-dlp curl_cffi`) и `ffmpeg` в PATH: без имперсонации браузера TikTok отдаёт серверным IP пустой список.

## Требования

Node.js 20+, Postgres 13+, ключ Anthropic API; для глубокого анализа ключ Gemini, `yt-dlp` + `curl_cffi` + `ffmpeg`.

## Всё остальное

Агент, кабинет владельца, виджет, обходчики сайтов (Shopify, WooCommerce, Magento, JSON-LD, фиды), гардрейлы и API те же, что в основном репозитории — полный README, соответствие статье Anthropic [*The anatomy of effective commerce agents*](https://claude.com/blog/the-anatomy-of-effective-commerce-agents), настройка и модель безопасности: **[effective-commerce-agents](https://github.com/DanikVR/effective-commerce-agents)**. Этот репозиторий — полная копия того кода с импортом из TikTok на первом плане, его можно клонировать отдельно.

## Хостед-версия

**[comag.vibevox.pro](https://comag.vibevox.pro/?utm_source=github&utm_medium=readme&utm_campaign=tiktok-sales-agent)** запускает этого агента за вас: подключаете профиль TikTok в кабинете, получаете виджет и страницу для пересылки, уведомления в Telegram, 108 языков интерфейса, обновления и поддержку. Связь с автором: **[t.me/GuruAppSheet](https://t.me/GuruAppSheet)**.

## Лицензия

Apache-2.0 © DanikVR. Построено на паттернах и гардрейлах [anthropics/commerce-agents](https://github.com/anthropics/commerce-agents) (Apache-2.0), см. [NOTICE](NOTICE). English: [README.md](README.md).
