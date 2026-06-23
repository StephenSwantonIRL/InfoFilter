# InfoFilter

InfoFilter is a Tiny Tiny RSS-inspired feed reader and aggregator built with Node.js, Express, MongoDB, and the Bulma CSS framework.

## Included features

- Session-based authentication with admin and user roles
- Feed subscriptions with categories/folders
- AI-generated scraper rules for sources without official feeds, including preview verification and repair fallback
- Newsletter-backed sources via IMAP mailbox ingestion and AI extraction
- Bluesky profile sources via the public Bluesky AppView
- Article import, unread/starred/published/archive state, notes, and tags
- Regex-driven content filters with tag, score, read, publish, delete, and label actions
- Labels and generated public feeds in Atom or JSON Feed format
- OPML import/export
- A tt-rss-style JSON API with login, feeds, headlines, counters, labels, and subscription operations
- Plugin registry stubs and scheduled background feed updates
- Bulma-based reader, preferences, and admin interfaces

## Quick start

1. Copy `.env.example` to `.env` and adjust the values.
2. Install dependencies with `npm install`.
3. Start MongoDB locally.
4. Seed the default admin account with `npm run seed`.
5. Start the app with `npm run dev`.

Optional for AI sources:

- Set `OPENAI_API_KEY` in `.env`
- Optionally set `OPENAI_MODEL` if you do not want the default
- Install browser support with `npm install` so Playwright is available for rendered-source fetching

Optional for newsletter sources:

- Configure `IMAP_HOST`, `IMAP_PORT`, `IMAP_SECURE`, `IMAP_USER`, and `IMAP_PASSWORD` in `.env`
- If your mail path uses a self-signed or intercepted certificate chain, set `IMAP_REJECT_UNAUTHORIZED=false` only if you trust that environment
- Point newsletter subscriptions at that mailbox

Default login comes from `.env`:

- Email: `ADMIN_EMAIL`
- Password: `ADMIN_PASSWORD`

## Important notes

- This project recreates a large amount of tt-rss behavior, but it is still a greenfield Node/Mongo implementation rather than a line-by-line port.
- Feed updates rely on `rss-parser`, so some edge-case feeds may need adapter or plugin work for parity with upstream tt-rss.
- Public generated feeds are exposed at `/public/feeds/:key`.
- AI sources are created from `Preferences > AI Sources`. The app proposes deterministic selectors, shows a verification preview, and only saves the source after you confirm the extracted items.
- AI sources support `auto`, `direct`, and `browser-rendered` fetch modes. Use browser mode for JS-heavy or bot-protected sites, and optionally provide a selector to wait for before previewing.
- AI rule generation supports a primary model plus fallback models via `OPENAI_MODEL` and `OPENAI_FALLBACK_MODELS`.
- If a generated rule returns no preview items, the AI Sources panel now shows rendered-page debug details, including candidate containers, sample links, and rule match counts to help refine guidance or wait settings.
- Newsletter sources are created from `Preferences > Newsletter Sources`. They match incoming emails by sender and/or subject, can also handle forwarded newsletters by inspecting original sender/subject inside the forwarded message, preview extracted stories from the latest matching email, and then refresh from the mailbox like any other source.
- Bluesky sources are created from `Preferences > Bluesky Sources`. They preview public posts from a profile handle, can include or exclude replies and reposts, and refresh using the public Bluesky AppView at `https://public.api.bsky.app`.

## Source inspiration

- Upstream repo: [tt-rss/tt-rss](https://github.com/tt-rss/tt-rss)
- Documentation: [tt-rss.org](https://tt-rss.org/)
