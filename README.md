# InfoFilter

InfoFilter is a Tiny Tiny RSS-inspired feed reader and aggregator built with Node.js, Express, MongoDB, and the Bulma CSS framework.

## Included features

- Session-based authentication with admin and user roles
- Feed subscriptions with categories/folders
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

Default login comes from `.env`:

- Email: `ADMIN_EMAIL`
- Password: `ADMIN_PASSWORD`

## Important notes

- This project recreates a large amount of tt-rss behavior, but it is still a greenfield Node/Mongo implementation rather than a line-by-line port.
- Feed updates rely on `rss-parser`, so some edge-case feeds may need adapter or plugin work for parity with upstream tt-rss.
- Public generated feeds are exposed at `/public/feeds/:key`.

## Source inspiration

- Upstream repo: [tt-rss/tt-rss](https://github.com/tt-rss/tt-rss)
- Documentation: [tt-rss.org](https://tt-rss.org/)
