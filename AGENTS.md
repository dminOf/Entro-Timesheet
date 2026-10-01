# Working on Entro Timesheet

## Purpose and architecture

This project provides a Node.js ES-module SDK and CLI for the OfficeSystem timesheet portal, plus a local browser UI. Use Node 22 or newer. The SDK talks to the portal over HTTP after normal browser authentication; the local UI is installed into an existing Bun web server rather than starting a server of its own.

- `src/client.js`: exported `EntroClient`, read-resource allowlist, authenticated HTTP transport, session loading, and past-check-in preparation/submission. Responses retain the portal's envelope. Pagination is explicit.
- `src/browser-login.js`: Playwright/Chrome login and private browser storage. The portal requires fresh reCAPTCHA verification; do not bypass it or assume unattended login succeeds. `connect()` validates a saved session and only starts login for a missing or expired session.
- `src/cli.js`: login, resource reads using `key=value` filters, and `checkin-create`. Creation defaults to preview; `--submit` explicitly sends a write.
- `src/local-login.js` and `src/portal-views.js`: session status, entry options, account-specific lookups, and presentation of the seven read views without exposing internal record identifiers.
- `src/entry-draft.js`: weekday/date eligibility and draft validation, including project/function membership. Selected work hours remain independent of elapsed time.
- `src/holidays.js` and `data/public-holidays-2026.json`: account-specific local holiday master, seeded with the company calendar for 2026 and portal holidays for other years. Changes remain local; stale saves are rejected.
- `src/submissions.js`: server-side batch submission service with private account-specific journals, duplicate protection, and uncertain-outcome handling. The adapter exposes this service even though the current entry-page UI remains a preview. Never assume the adapter is read-only.
- `local-login/`: compact HTML/CSS/JavaScript portal, Jspreadsheet entry grid, Bun route templates, and installer.
- `docs/api-inventory.md`: observed API contracts and their verification limits. `docs/read-verification.jsonl` stores response structure only, without account record values.
- `test/`: Node's built-in test runner; transport tests use mocked HTTP calls.

## Development and verification

```sh
npm ci
npm test
npm run setup:local-login
```

The installer copies adapters and frontend assets into the existing web server's `apps/entro-login` directory. Set `ENTRO_WEB_APPS_DIR` to override its machine-specific default. Installed adapters reference this checkout, so reinstall after moving the repository or changing server-side modules. The shared server is a separate prerequisite; this repository does not contain its launcher.

Use `.env.example` as a variable-name template. Login can use `node --env-file=.env src/cli.js login --headed`, or `npm run login -- --manual`. A normal portal login in an unrelated browser does not import a session into the SDK. Reuse `.private/session.json` between logins; changing a local cookie expiry does not renew the signed portal token.

Run `npm test` after relevant changes. `npm run verify:reads` requires a real authenticated session and performs live reads; it is not an offline test. Keep any live account output private. Do not run live timesheet writes just to verify a change. Treat mocked write tests as contract verification, not proof that the portal accepted an entry.

## Write safeguards

Preserve preview-by-default behavior in the SDK and CLI. Actual past-check-in writes require `dryRun: false` or `--submit`. Server-side batch submission must retain date/holiday checks, fresh eligibility checks, project/function validation, account serialization, and persistent duplicate protection. Do not automatically retry a write with an uncertain result; inspect check-in history first. Keep localhost restrictions, same-origin checks, the custom request header, request-size limits, and sanitized errors in the local API adapter.

## Secrets and private data

Never commit tokens, passwords, API keys, session cookies, browser profiles, authenticated captures, account records, or private submission journals. Credentials must come from runtime environment variables or ignored private files. Keep `.private/`, `.env` and other actual environment files, `.playwright-mcp/`, and `node_modules/` ignored. Only empty credential placeholders belong in `.env.example`. Use synthetic credentials in tests. Do not print secret values when scanning files or debugging authentication.

Before committing, review the staged file list and run a redacted secret scan against the staged contents. Exclude browser captures and preview screenshots unless separately reviewed for private data. Use this repository's HTTPS remote for the `dminOf` GitHub account; do not switch to an unverified default SSH identity.

## UI and documentation conventions

Keep enterprise screens compact: small spacing, subtle corner radii, restrained typography, and small consistent outline icons with accessible labels. Images must open in an accessible in-page lightbox with Escape-to-close, contained focus, and focus restoration. Preserve scroll position.

User-facing views and documents should contain only information needed to use the product. Keep tokens, internal identifiers, operational paths, raw account responses, and engineering execution details out of those surfaces. Put necessary implementation evidence in developer documentation. Check visible content and metadata for audience leakage before delivery.
