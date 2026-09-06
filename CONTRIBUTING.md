# Contributing

Thanks for looking. A few practical notes before you open a PR.

- **What lives here:** the shopping and merchant agents, the catalog importers, the widget and the owner console — the self-hosted edition of the agent behind [comag.vibevox.pro](https://comag.vibevox.pro). Multi-tenant cabinet, billing and 108-language dictionaries stay in the hosted edition.
- **Guardrails are not optional.** Anything that lets the model put a price, a stock level or a product ID into the conversation that the server did not issue, or lets a merchant write skip staging, will not be merged.
- **Evals wanted.** The article this repo follows treats snapshot evals as the core of the workflow; the repo has none yet. A `tests/` folder with constructed session states and graded outcomes is the most valuable PR you can send.
- **Check before pushing:** `cd server && npm run check`, `cd web && npm run check`, then a real session: crawl a store, ask the widget for a product, stage and apply one merchant change.
- **Language.** Code, comments and docs in English (the code was translated from Russian; leftover Russian comments are fair game for a cleanup PR).

Questions: [t.me/GuruAppSheet](https://t.me/GuruAppSheet).
