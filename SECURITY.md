# Security

## Reporting

Found a way for a shopper message, a crawled page or a social post to make the agent leak data, bypass the cart gates, execute a merchant write without approval, or reach the admin API without `ADMIN_TOKEN`? Please write privately first: **[t.me/GuruAppSheet](https://t.me/GuruAppSheet)**. You will get an answer within two working days and a fix before any public write-up.

## What the server guarantees

- The admin API and the console require `Authorization: Bearer ADMIN_TOKEN`; the widget API is public but rate-limited and cannot read or change anything beyond its own conversation.
- Prices, stock and product IDs come only from the database; the cart accepts only IDs issued to the current session; merchant writes are staged and re-validated at apply time.
- Untrusted text is fenced before it reaches the model; outbound requests refuse private networks and re-check every redirect.
- Saved API keys are encrypted at rest (AES-256-GCM with `APP_SECRET`).

## Out of scope

The stores the agent crawls, the social networks it imports from, and the hosted edition at comag.vibevox.pro are not part of this repository. Reports about the hosted edition are welcome at the same address.
