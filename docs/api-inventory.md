# OfficeSystem API inventory

Audience: developers implementing the timesheet integration. Purpose: record observed authentication behavior and source-confirmed read contracts without account records or secrets.

## Authentication

- `POST /api/v1/auth/login`: `{username, password, recaptchaToken}`.
- Normal portal login obtains a new token using reCAPTCHA action `login`.
- Authentication uses `accessToken` in a cookie; frontend requests use credentials. The supplied response screenshot shows HttpOnly, Secure, SameSite=Strict, Path=/ and Max-Age=43200.
- Successful frontend login reads `resultData.user`, including `userId` and role information. Work-log requests obtain userId from saved current-user data, rather than decoding the HttpOnly cookie.
- Observed automated login attempts returned HTTP 400 with “reCAPTCHA verification failed.” Username/password validity was not established by that error.

## Read contracts

All paths below have prefix `/api/v1`. These are confirmed in the publicly served frontend service code; seven core resources were also validated over authenticated HTTP on 1 October 2026. Optional resources remain source-confirmed only.

| SDK resource | GET path | Filters seen in frontend |
|---|---|---|
| worklogs | `/timesheet` | `userId`, `month` (1–12), `year`, `page`, `pageSize`, `sort`, `order` |
| checkins | `/timesheet/check-in` | `checkOutFlag`, `dateFrom`, pagination, sort/order |
| favoriteProjects | `/timesheet/project/favorite` | `isActive=Y`, `pageSize=100` |
| projectFunctions | `/timesheet/project-function` | `projectId`, `status=Active`, `isActive=Y`, pagination |
| overtime | `/timesheet/ot` | `year`, `month`, `page`, `pageSize`, `order=asc` (observed live); additional filters pending |
| leaveHistory | `/timesheet/leave` | `page`, `pageSize`, `order=asc` (observed live) |
| leaveBalance | `/timesheet/leave/remain` | `userId` (observed live) |
| holidays | `/timesheet/leave/holiday` | verified `userId`, `startDate`, `endDate` (`YYYY-MM-DD HH:mm:ss`); returns `warnDate`, `warnType`, `holidayRemark`; `SPECIAL_HOLIDAY` supplies holidays and `WEEKLY_DAY_OFF` supplies weekly rest days |
| siteWorktime | `/timesheet/site/worktime` | `userId`, `date=YYYY-MM-DD`; `siteId` used in some flows |
| missingCheckins | `/timesheet/user/miss/check-in` | parameters forwarded by service; precise query contract pending |
| menu | `/auth/menu` | role-specific portal navigation; query contract pending |

Work-log UI consumes an array in `resultData`, total count in `recordsTotal`, and entry fields including `workDate`, checkIn/checkOut and start/end times. Frontend submission models additionally reference timesheetId, projectCode, projectFunctionId, timeTotal, duration and detail; these do not establish a complete read schema.

## Portal areas identified

Timesheet routes include Check In–Out, Work Log, Project Function, Overtime, administrative timesheets and administrative check-in/out. Leave services cover balances, history, attachments, holidays and availability. Permissions and menus determine which areas this account can access; administrative endpoints have not been exercised.

## Deferred writes

The frontend declares create/update work-log, onsite work-log, check-in/out, overtime, favorite-project, project-function and leave operations. They were inventoried without execution. Before adding writes, validate request models, permission rules, date/time conventions, duplicate handling and post-write readback with an explicitly approved operation.

## Live verification

Seven SDK resources returned HTTP success and resultCode `20000`: worklogs, checkins, favoriteProjects, projectFunctions, overtime, leaveBalance and leaveHistory. Portal navigation independently confirmed their GET paths and filters. Menu reads also succeeded during navigation. The authenticated account offers Favorite Project, Project Function, Check In–Out, Work Log, OT and Leave; administrative screens were not exposed in its menu.

The October work-log and overtime reads returned empty arrays, so their populated record schemas remain unverified. The other core resources returned arrays with records. No create/update/delete actions were performed. The twelve-hour session behavior is based on the supplied cookie attributes; expiry was not tested by waiting.

A repeatable structural report is in `read-verification.jsonl`. It contains query-key names and response-field names, without account identifiers or record values. Date-filter semantics, broader pagination behavior, optional resources and exports still require further validation.

## Past check-in creation contract

Implemented `POST /api/v1/timesheet/user/check-in` from the user-supplied request. Body fields: checkOutFlag, specialCaseCode, status, remark, startTime, endTime, duration, reasonLate, projectCode, projectFunctionId and workDate. Times use HH:mm; workDate uses YYYY-MM-DD; duration is a string representing hours. The authenticated cookie identifies the user; no userId field is added.

SDK preparation and default preview perform no network activity. Explicit submission uses the existing session cookie. The request shape and transport are covered by mocked tests; no live POST was executed. Server-side duplicate/date eligibility rules and the successful write response schema remain unverified.

## Headless authentication result

On 1 October 2026, a fresh Chrome headless context used credentials loaded at runtime, waited for the reCAPTCHA script and a twelve-second initialization delay, then submitted normal portal login. The portal returned HTTP 400 and reported reCAPTCHA verification failure. No authenticated headless session was created. Existing authenticated sessions can still be used through direct HTTP reads. Browser-login support now exposes headless and visible modes; unattended renewal remains unverified.

## Session renewal investigation

The downloaded main bundle and lazy-loaded bundles contain no refreshToken, refresh-token, /auth/refresh or silentRefresh reference. Declared authentication operations cover login, logout, menu and password/email flows. Saved portal storage has an accessToken cookie and currentUser/menu data, with no refresh cookie or refresh credential found.

The current access token has a twelve-hour interval between iat and exp, matching the cookie lifetime. Authenticated GET requests to auth/menu and timesheet/check-in succeeded but returned no Set-Cookie header or token/session renewal header. These reads did not renew the token. The frontend presents a session-expired dialog and returns to login rather than performing a refresh.

No usable refresh mechanism was found in the inspected client or observed reads. This does not prove the backend lacks an undocumented endpoint; backend documentation or operator confirmation would be needed to establish one. Extending only a locally stored cookie expiry would not change the signed token expiry and is not a renewal mechanism.

## Repeated staff-onsite project reads

The supplied network capture shows incrementing page numbers for GET /api/v1/master/projects-all/staff-onsite with pageSize=10, sort=projectName, order=asc and currentSite=Y. Frontend code confirms a sequential pagination loop: it starts at page 1, accumulates available projects, increments the page, and stops when a page has fewer than pageSize entries or accumulated entries reach recordsTotal. It then filters already-favorited projects out of that list.

A live read returned an array of projects with recordsTotal=235 and an ETag, but no Set-Cookie header. A conditional read also returned no Set-Cookie header. At ten entries per page, fetching 235 projects requires 24 pages, matching the supplied capture. The observed repeated calls are consistent with loading the available-project list; they do not provide evidence of access-token renewal. The capture's HTTP 304 responses indicate cache revalidation, not a new session token. An undocumented server-side idle timer cannot be ruled out from these observations, but the signed access-token expiry is unchanged without a replacement token.

## Additional login diagnosis

Both headless and visible automated login were tested while retaining the previous browser's reCAPTCHA storage and removing portal authentication. The tests waited for the actual grecaptcha.ready callback. Both returned HTTP 400, resultCode 40001 and a reCAPTCHA rejection; neither reported a lockout code. This rules out an uninitialized script as the sole explanation for these attempts, but does not establish the server's score, hostname/action checks or verification error reason. Those require server-side verification diagnostics.

The SDK now offers a session-first connect method, checked live against the existing session, plus an optional dedicated browser profile. Neither feature promises successful unattended renewal. No timesheet writes were executed during diagnosis.
