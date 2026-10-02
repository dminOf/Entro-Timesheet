# Working on Entro Timesheet

## Purpose and architecture

This project provides a Node.js ES-module SDK and CLI for the OfficeSystem timesheet portal, plus a local browser UI. Use Node 22 or newer. The SDK talks to the portal over HTTP after normal browser authentication; the local UI runs with the included Node server. Installation into an existing Bun web server remains an optional alternative.

- `src/client.js`: exported `EntroClient`, read-resource allowlist, authenticated HTTP transport, session loading, and past-check-in preparation/submission. Responses retain the portal's envelope. Pagination is explicit.
- `src/browser-login.js`: Playwright/Chrome login and private browser storage. The portal requires fresh reCAPTCHA verification; do not bypass it or assume unattended login succeeds. `connect()` validates a saved session and only starts login for a missing or expired session.
- `src/cli.js`: login, resource reads using `key=value` filters, and `checkin-create`. Creation defaults to preview; `--submit` explicitly sends a write.
- `src/local-login.js` and `src/portal-views.js`: session status, entry options, account-specific lookups, and presentation of the seven read views without exposing internal record identifiers.
- `src/entry-draft.js`: weekday/date eligibility and draft validation, including project/function membership. Selected work hours remain independent of elapsed time.
- `src/holidays.js` and `data/public-holidays-2026.json`: account-specific local holiday master, seeded with the company calendar for 2026 and portal holidays for other years. Changes remain local; stale saves are rejected.
- `src/submissions.js`: server-side batch submission service with private account-specific journals, duplicate protection, and uncertain-outcome handling. The entry-page review dialog exposes creation after explicit user submission. Never assume the adapter is read-only.
- `src/local-api.js`: shared local API handler used by both server options; owns localhost, same-origin and write-header guards.
- `src/local-server.js`: standalone Node HTTP server; binds only to `127.0.0.1` and serves an explicit public-asset list, never the whole checkout.
- `local-login/`: committed HTML/CSS/JavaScript portal, Jspreadsheet entry grid, optional Bun route templates, and installer. Frontend libraries come from locked npm dependencies.
- `docs/api-inventory.md`: observed API contracts and their verification limits. `docs/read-verification.jsonl` stores response structure only, without account record values.
- `test/`: Node's built-in test runner; transport tests use mocked HTTP calls.

## Development and verification

Prerequisites:

- Node 22+ and npm for the SDK, installer and tests.
- Google Chrome installed on the machine for browser-assisted login. The login code uses Playwright's `channel: 'chrome'`; installing this package does not install Chrome, and downloading Playwright's bundled Chromium is not required for login.
- No Bun installation or separate web-server checkout is required for the standalone UI. Bun is needed only for the optional shared-server adapter.

Run all SDK/CLI commands from this repository's root so the CLI saves the session at the path the local UI reads. For a fresh checkout on macOS, Windows or Linux:

```sh
npm ci
npm test
# Complete the normal portal login in the Chrome window; this saves the session.
npm run login -- --manual
npm start
```

Open `http://localhost:3000/entro-login/` for read views or `http://localhost:3000/entro-login/entry.html` for the entry grid. Keep the server terminal running; stop it with Ctrl+C. If port 3000 is occupied, use `npm start -- --port 3001` and the printed URL. `ENTRO_PORT` is also supported. The server is local to the machine and serves assets from this checkout; no install/copy step or frontend build is required. Restart the standalone server after server-side code changes; frontend changes appear on refresh. Each person must authenticate their own account. Never distribute an existing `.private/` directory or use another person’s saved session.

The page can load without a session and will show that authentication is needed. After a successful CLI login, use **Verify session** and refresh the views. Browser login, portal reads and verification require network access to `https://ofs.entro-lab.com`; tests are offline.

Before delivery, run `npm test`, start the standalone server on a free port and confirm both pages and their vendor assets load. Use mocked API responses to verify writes. Do not submit real timesheets as a setup check. If Chrome is missing, install Chrome before attempting login; the frontend itself does not need Chrome specifically. If login or session verification fails, keep the error private and use the normal manual login flow rather than modifying reCAPTCHA.

### Optional shared Bun server

Use this only when the machine already has a shared web server. Its router must support app folders, nested static assets, an `index.ts` handler and `/api/*` requests handled by `api.ts`. Use one server option at a time for a checkout, even on different ports: submission serialization is scoped to a single process, so two servers must not submit against the same private journal concurrently. Install/update with:

```sh
npm run setup:local-login
```

The installer copies adapters, frontend assets and spreadsheet library files into the existing web server's `apps/entro-login` directory. The default apps directory on this machine is `/Users/dushyantmin/code/general/web_server/apps`. For another checkout of that server, set the **parent apps directory**, not the `entro-login` subdirectory:

```sh
ENTRO_WEB_APPS_DIR=/absolute/path/to/shared-web-server/apps npm run setup:local-login
```

If the shared server is already running, it discovers the app without restarting. Do not modify its router or restart it just to install/update this app. When setting up a stopped server on this machine, run these commands in a separate terminal:

```sh
cd /Users/dushyantmin/code/general/web_server
bun install
bun run start
```

Installed Bun adapters reference absolute paths in this checkout, so reinstall after moving the repository, changing server-side modules or changing frontend assets. Editing source frontend files does not update the Bun adapter’s installed copies until the installer runs. This restriction does not apply to `npm start`.

### Authentication and private state

Manual login does not require credential environment variables. To supply credentials automatically, copy `.env.example` to an ignored `.env`, restrict its permissions and enter values locally. npm scripts do not automatically load `.env`; either export variables in the shell or pass Node's env-file option:

```sh
cp .env.example .env
chmod 600 .env
# After entering credentials in .env:
node --env-file=.env src/cli.js login --headed
```

Headless login is supported but has been rejected by reCAPTCHA in live checks; do not assume unattended authentication works or repeatedly retry rejected logins. Manual login also requires the portal to accept its normal reCAPTCHA verification. A normal portal login in an unrelated browser does not import a session into the SDK; the local page's portal link opens login but does not capture that browser's cookie. A personal-profile import bridge is not implemented. Optional SDK profile retention must use a dedicated private directory, never the user's personal Chrome profile.

Reuse `.private/session.json` between logins. The UI reads this file from the repository even if an access token is exported in the shell; token-only environment authentication is supported by SDK/CLI calls. The observed cookie lifetime is twelve hours; no refresh-token/automatic extension flow has been verified. Authenticate again after expiry, then use **Verify session** and refresh the views. Changing a local cookie expiry does not renew the signed portal token.

The account-specific holiday master lives under `.private/holidays/`, and submission receipts/duplicate guards live under `.private/submissions/`. Keep these local records when updating the app; reinstalling adapters preserves them. Do not delete receipts as a routine reset, since they retain protection against repeat or uncertain writes. Unsaved entry drafts stay in page memory and are lost on a full reload.

Run `npm test` after relevant changes. `npm run verify:reads` requires a real authenticated session and performs live reads; it is not an offline test. Keep any live account output private. Do not run live timesheet writes just to verify a change. Treat mocked write tests as contract verification, not proof that the portal accepted an entry.

## Write safeguards

Preserve preview-by-default behavior in the SDK and CLI. Actual past-check-in writes require `dryRun: false` or `--submit`. Server-side batch submission must retain date/holiday checks, fresh eligibility checks, project/function validation, account serialization, and persistent duplicate protection. Do not automatically retry a write with an uncertain result; inspect check-in history first. Keep localhost restrictions, same-origin checks, the custom request header, request-size limits, and sanitized errors in both local server options. Keep the standalone server bound to loopback and its asset list explicit; never add whole-directory static serving for the repository or expose it to the network.

## Secrets and private data

Never commit tokens, passwords, API keys, session cookies, browser profiles, authenticated captures, account records, or private submission journals. Credentials must come from runtime environment variables or ignored private files. Keep `.private/`, `.env` and other actual environment files, `.playwright-mcp/`, and `node_modules/` ignored. Only empty credential placeholders belong in `.env.example`. Use synthetic credentials in tests. Do not print secret values when scanning files or debugging authentication.

Before committing, review the staged file list and run a redacted secret scan against the staged contents. Exclude browser captures and preview screenshots unless separately reviewed for private data. Use this repository's HTTPS remote for the `dminOf` GitHub account; do not switch to an unverified default SSH identity.

## UI and documentation conventions

Keep enterprise screens compact: small spacing, subtle corner radii, restrained typography, and small consistent outline icons with accessible labels. Images must open in an accessible in-page lightbox with Escape-to-close, contained focus, and focus restoration. Preserve scroll position.

User-facing views and documents should contain only information needed to use the product. Keep tokens, internal identifiers, operational paths, raw account responses, and engineering execution details out of those surfaces. Put necessary implementation evidence in developer documentation. Check visible content and metadata for audience leakage before delivery.
