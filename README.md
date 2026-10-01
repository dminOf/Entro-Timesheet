# Entro timesheet SDK

Node.js SDK with read APIs and past check-in creation for OfficeSystem. Requires Node 22+ and Chrome for browser-assisted login.

The portal requires a fresh reCAPTCHA token, then authenticates API requests with an HttpOnly `accessToken` cookie. A historical login payload cannot supply a reusable reCAPTCHA token. Browser-assisted login lets the portal perform its normal authentication flow; subsequent reads run directly over HTTP.

## Setup and login

```sh
npm install
# Supply ENTRO_USERNAME and ENTRO_PASSWORD through your shell or a private .env.
node --env-file=.env src/cli.js login --headless
# Visible browser fallback (credentials still supplied via environment):
node --env-file=.env src/cli.js login --headed
# Alternatively, enter credentials yourself in the browser:
npm run login -- --manual
```

Headless login is the default. A fresh headless attempt on 1 October 2026 returned HTTP 400 because the portal rejected reCAPTCHA; unattended login is therefore not confirmed. Use `--headed` or `--manual` when this occurs. No browser fingerprint changes or reCAPTCHA bypass are applied.

Login waits for the reCAPTCHA script and allows it time to initialize before submitting. If verification fails, complete normal login in the opened browser. Visible browser login waits up to three minutes; headless login uses a sixty-second operation timeout and reports rejection immediately. It saves a private, ignored session file; the portal cookie screenshot indicates a twelve-hour lifetime. An expired session requires another login. Automated reCAPTCHA acceptance is not guaranteed.

## Local timesheet portal

Open [the local workspace](http://localhost:3000/entro-login/). It shows seven read views: check-in history, work logs, favorite projects, project functions, overtime, leave requests and leave balance. Account and session controls are in the top-right corner.

Views use the saved SDK session. Tables support pagination and filtering within the current page; work logs and overtime also support month/year selection. Work logs resolve project and function names from the account's project reads. Tokens, internal record identifiers and audit metadata are kept off the page. Session status checks are local; upstream reads run when a view is opened, refreshed or changed.

The [Timesheet entry page](http://localhost:3000/entro-login/entry.html) uses [Jspreadsheet CE](https://bossanova.uk/jspreadsheet/docs) for Excel-style editing, clipboard paste, dropdowns and undo/redo. It lists dates reported by the portal's missing-check-in API alongside public holidays, excluding weekends and future dates. Dates with existing attendance records are not offered for entry. It starts with the latest month containing gaps.

The **Holidays** button opens the public holiday master. The initial 2026 calendar contains the 19 dates and Thai holiday names from the supplied company announcement for year 2569, including substitute holidays. Holiday rows are grey, read-only and excluded from selection, bulk fill and review. Add, edit or remove dates in the master, then save changes to update the grid. Holiday changes persist locally per account; they never update the upstream portal. Other years are initially populated from the account's portal holiday calendar when loaded.

Fill rows individually or apply the bulk values to all dates in the selected month or only checked rows. A top checkbox selects every date in that month. The review dialog shows selected entries before submission. Project/function, time and half-hour duration validation follow the supplied past-check-in form; elapsed time and selected work hours remain separate.

This is a form design preview: drafts live in page memory, survive month changes, and reset on a page reload. Submission is disabled in the form, so no entries are created by using it. The local API does expose a guarded batch submission route; calling that route can create real past check-ins. See `AGENTS.md` for the server-side safeguards.

Install or update the shared local web-server adapters with:

```sh
npm run setup:local-login
```

The portal link opens the real login page in your browser. Signing in there does not automatically replace the saved SDK session; importing a session from your own browser profile still needs a browser bridge. No generic login window is launched from the local portal.

## Session-first SDK connection

```js
import {EntroClient} from 'entro-timesheet-sdk';
const client = await EntroClient.connect({
  sessionPath: '.private/session.json',
  headless: false, // Visible login when the saved session is missing or expired.
  profilePath: '.private/browser-profile', // Optional dedicated browser profile.
});
const response = await client.checkins({page: 1, pageSize: 10});
```

`connect` checks a saved session against the portal before returning it. Valid sessions require no browser. A missing, expired or HTTP-401 session triggers normal browser login; service outages and permission errors are reported without attempting login again. Credentials come from the environment. With visible login, a rejected automated submission leaves the browser open briefly for you to complete normal sign-in.

The optional profile retains normal browser state between logins. Use a dedicated, private directory, never your personal Chrome profile. Profile retention is not a confirmed solution for unattended reCAPTCHA acceptance.

## Programmatic browser login

```js
import {EntroClient} from 'entro-timesheet-sdk';
const {client} = await EntroClient.loginWithBrowser({
  headless: true, // Credentials come from ENTRO_USERNAME / ENTRO_PASSWORD.
  sessionPath: '.private/session.json', // Optional; omit to keep session in memory.
});
const response = await client.checkins({page: 1, pageSize: 10});
```

The browser closes after authentication. Subsequent API calls use HTTP directly. For the visible fallback, set `headless: false`; to enter credentials manually, also set `manual: true`. Browser login returns `{client, user}` like direct API login. It does not overwrite a saved session if authentication fails.

Reuse an existing session with `EntroClient.fromStorageState('.private/session.json')`; this requires no browser. Once the session expires, authenticate again. Cookie reuse supports local automation between logins, but does not establish automatic renewal beyond the portal's session lifetime.

## Read

```sh
npm run read -- worklogs month=10 year=2026 page=1 pageSize=20
npm run read -- checkins page=1 pageSize=20 checkOutFlag=false
npm run read -- favoriteProjects isActive=Y pageSize=100
npm run read -- projectFunctions projectId=YOUR_PROJECT_ID status=Active
```

```js
import {EntroClient} from 'entro-timesheet-sdk';
const client = await EntroClient.fromStorageState('.private/session.json');
const response = await client.worklogs({month: 10, year: 2026, page: 1, pageSize: 20});
console.log(response.resultData);
```

All reads preserve the API envelope, including `resultCode`, `resultData` and `recordsTotal`. Pagination is explicit; one call retrieves one page. Past check-in creation is available with preview enabled by default. Credentials can also be supplied directly to `EntroClient.login`, together with a fresh `recaptchaToken`; that method returns `{client, user}`. `ENTRO_ACCESS_TOKEN` supports an existing cookie without browser login.

See [API inventory](docs/api-inventory.md) for endpoint confidence, filters and discovery limits. CLI output contains your requested records; handle it as private account data.

## Past check-in entries

`createPastCheckin` targets `POST /api/v1/timesheet/user/check-in`, using the existing authenticated cookie. This operation is distinct from a current-day check-in or a work-log creation.

```js
const entry = {
  workDate: '2026-03-16', startTime: '08:30', endTime: '17:30', duration: '8',
  projectCode: 'YOUR_PROJECT_ID', projectFunctionId: 'YOUR_FUNCTION_ID',
  remark: 'Work description',
};
const preview = await client.createPastCheckin(entry); // No request sent.
// When ready to submit:
// const response = await client.createPastCheckin(entry, {dryRun: false});
```

Defaults match the supplied portal payload: `checkOutFlag: true`, `status: "pending"`, `specialCaseCode: null`, and `reasonLate: null`. Duration is sent as a string and remains independent of elapsed time: 08:30–17:30 may have duration 8. `projectCode` contains the project identifier used by the portal; use favorite-project and project-function reads to choose matching identifiers.

To preview without any login or session, use `preparePastCheckin(entry)` or save the entry as JSON and run:

```sh
node src/cli.js checkin-create entry.json
# Explicit submission, when wanted:
# node src/cli.js checkin-create entry.json --submit
```

Preview output contains the method, URL and body, without credentials. Local validation checks date/time formats, positive duration, required project/function identifiers and known fields. Server rules for eligible dates, duplicates, project/function membership and approval remain authoritative. Submission performs one request without retries; if its outcome is uncertain, inspect existing records before resubmitting.

This write contract is based on the supplied portal request and has been tested with mocked transport only. No live creation request has been sent.

## Verification

```sh
npm test
```

Transport tests cover cookie authentication, query serialization, HTTP/application failures, login-cookie extraction, and rejection of unknown resources. Live reads for seven core resources passed using the authenticated session on 1 October 2026. Run `npm run verify:reads` to repeat structural checks without printing record values. Work-log userId is populated from the saved session; token-only clients must provide it explicitly.
