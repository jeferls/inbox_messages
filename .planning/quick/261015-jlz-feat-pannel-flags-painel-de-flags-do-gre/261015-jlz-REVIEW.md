---
phase: 261015-jlz-feat-pannel-flags
reviewed: 2026-10-15T00:00:00Z
depth: quick
files_reviewed: 9
files_reviewed_list:
  - docker-compose.yml
  - public/flags.html
  - public/flags.js
  - src/app.js
  - src/routes/flags-panel.routes.js
  - src/services/flags-panel.service.js
  - src/services/global-flags.service.js
  - src/services/global-settings.service.js
  - tests/flags-panel.test.js
findings:
  critical: 0
  warning: 7
  info: 4
  total: 11
status: issues_found
---

# Quick 261015-jlz: Code Review Report

**Reviewed:** 2026-10-15
**Depth:** quick (full read of the 8 changed source files plus the test file; the 15 nav-link HTML edits were skimmed)
**Status:** issues_found

## Summary

The focus areas hold up.

- **SQL injection:** none found. Every value is a bound parameter. The only interpolation is the `id`/`email` column name in `addUserFlag`, chosen from a regex-validated boolean.
- **Secret leakage:** `DB_PASSWORD` stays inside `resolveDbConfig` and `createConnection`. Responses expose only `db: {host, port, database}`, `envFile`, `seederFile` and `backPath`. mysql2 error text includes the user name but not the password.
- **XSS in `flags.js`:** none. All dynamic content goes through `textContent` or `dataset`, with no `innerHTML`.
- **docker exec argv:** safe. `forgetBackCache` passes an array to `Cmd` with no shell. The key is `feature_flag_` plus a flag matching `[A-Za-z0-9_.-]{1,50}`, so it cannot start with `-`.
- **Connection leaks:** none. `withDb` closes the connection in `finally`.

The weak spots are the trust model of the user-typed path and the production guard.

## Warnings

### WR-01: The typed path is an unauthenticated filesystem probe and arbitrary-`.env` loader

**File:** `src/services/flags-panel.service.js:53-72` (route `src/routes/flags-panel.routes.js:15-19`)
**Issue:**
- `path.resolve(input)` accepts any absolute path or `..` traversal.
- The server listens on all interfaces (`app.listen(PORT)`) and has no auth and no CORS.
- Any LAN client can therefore make the server read a `.env.dev`, `.env` or `GlobalFlagSeeder.php` from any directory it can see.
- The differing 400 messages ("Caminho não encontrado: ...", ".env não encontrado em ...") work as a file-existence oracle.
- If the path exists, the candidate `path.join(backPath, '..', '.env.dev')` reaches one level above it. Inside the container, with the mount at `/greenn-back`, that is `/.env.dev`.
- The same client can then connect with whatever credentials that file holds, to any host in `LOCAL_HOSTS`, and run the toggle, insert and delete operations.

**Fix:** Constrain the input to the known roots. Resolve it, then require it to equal or sit under the real path of `/greenn-back` (the mount) or an allow-list from an env var such as `GREENN_BACK_PATH`.
```js
const ROOTS = [process.env.GREENN_BACK_ROOT || '/greenn-back'].map((r) => fs.realpathSync(r));
const real = fs.realpathSync(typed);
if (!ROOTS.some((r) => real === r || real.startsWith(r + path.sep))) throw fail(400, 'Caminho fora do greenn-back permitido');
```
Return a single generic error for every not-found case, and drop the `..` candidate.

### WR-02: The production guard is easy to bypass or silently satisfied

**File:** `src/services/flags-panel.service.js:75-89`
**Issue:**
- The guard trusts only `APP_ENV` and `DB_HOST` from the same file it is about to use.
- A missing `APP_ENV` passes, and `DB_HOST` falls back to `127.0.0.1`.
- `localhost` and `127.0.0.1` also pass when they are an SSH tunnel to a production or replica RDS, which is a common workflow.
- `DB_DATABASE` is not checked.
- Only `production` and `prod` are rejected, so `.env` (the third fallback candidate) from a staging or live checkout passes.

**Fix:**
- Require `APP_ENV` to be explicitly in `['local', 'dev', 'development', 'testing']` (fail closed) instead of blocklisting two strings.
- Pin the allowed database names (`greenn`, via an env var).
- Drop the plain `.env` fallback, or apply the same allow-list to it.

### WR-03: The UI toggles and mutates against the live path input, not the path that was loaded

**File:** `public/flags.js:91, 110, 133, 143` (`currentPath()` and `backPathInput.value`)
**Issue:** The list is loaded for path A. If the user edits the input to path B without clicking Load, the next toggle, remove or add acts on B's database while the screen still shows A's flags. This is a data-integrity hazard when two checkouts or worktrees exist. The user can easily change the input without pressing Load.
**Fix:** Store `state.loadedPath = path` on a successful `load()` and use it in `toggle`, `loadUsers`, remove and add. Alternatively, reset `state.flags` and hide the panels on `input` events of the path field.

### WR-04: `addUserFlag` can create duplicates (check-then-insert race, no unique key)

**File:** `src/services/flags-panel.service.js:146-148`, `public/flags.js:140-150`
**Issue:**
- The comment says `user_flags` has no unique key.
- A double-click or double-submit runs two SELECT-then-INSERT sequences concurrently. The submit button is not disabled, so both pass the dup check and insert twice.
- `setGlobalFlag` (`src/services/global-flags.service.js`) has the same pattern, though it was already there.

**Fix:** Disable the submit button while the request is pending. Server side, run the pair inside a transaction with `SELECT ... FOR UPDATE`, or use `INSERT ... SELECT ... WHERE NOT EXISTS (...)`.

### WR-05: `conn.end()` in `finally` can mask the real result or error

**File:** `src/services/flags-panel.service.js:99-101`
**Issue:** If the connection has already dropped, `await conn.end()` throws. That replaces a successful `fn` result, or the original error, with a connection error. A toggle that was applied then reports as a 502. Queries also have no timeout, so a locked table hangs the request. `connectTimeout` covers only the handshake.
**Fix:**
```js
} finally {
  await conn.end().catch(() => conn.destroy());
}
```
Optionally pass `{ sql, timeout: 10000 }` to queries.

### WR-06: `parseSeederFlags` does not strip block or `#` comments and cuts at the first `];`

**File:** `src/services/flags-panel.service.js:45-48`
**Issue:**
- Only `//` comments are removed. Flags inside a `/* ... */` or `# ...` comment are listed as real seeder flags.
- The lazy `([\s\S]*?)\]\s*;` stops at the first `];` and truncates the list if a string or nested array contains one.
- `isValidFlag` silently drops names longer than 50 characters. A seeded flag can vanish from the panel with no warning.

**Fix:** Also strip `/\/\*[\s\S]*?\*\//g` and `/^\s*#.*$/gm`. Surface dropped names (for example `ignored: [...]` in the response) instead of discarding them.

### WR-07: `parseEnv` mishandles escaped quotes in double-quoted values

**File:** `src/services/flags-panel.service.js:31-34`
**Issue:** A value such as `DB_PASSWORD="ab\"cd"` is cut at the escaped quote, because `indexOf(quote, 1)` ignores backslashes. The panel then connects with a wrong password and gets a confusing `Access denied`. The test covers only `#` and `=` inside quotes.
**Fix:** For double quotes, scan with `/^"((?:[^"\\]|\\.)*)"/` and unescape `\\"`, `\\\\` and `\\$`. Add a test case.

## Info

### IN-01: The `/greenn-back` mount exposes the entire repo and creates a host directory when the path is wrong

**File:** `docker-compose.yml:25-26`
**Issue:** The whole repo, including every `.env*` file, is mounted read-only into the container. The `docker.sock` mount already grants more, so this is marginal. If `GREENN_BACK_PATH` is wrong, Docker creates an empty root-owned directory on the host and `locateProject` then fails with a vague message.
**Fix:** Mount only what is needed (`.env.dev` and the seeder file), or document the variable. Consider `create_host_path: false` in long-form volume syntax.

### IN-02: In-container `DB_HOST=127.0.0.1` or `localhost` cannot work

**File:** `src/services/flags-panel.service.js:81-85`
**Issue:** Inside the container, loopback is the container itself, so only `greenn-back-mysql` is usable. Other allowed hosts yield an ECONNREFUSED 502 with no hint. `viaHost` also ignores `DB_PORT` for the host-side mapping (hard-coded 3301).
**Fix:** When `inContainer` and the host is loopback, map it to `greenn-back-mysql:3306`, or return a clear 400. Move 3301 to a named constant or env variable.

### IN-03: `flags.js` UI robustness

**File:** `public/flags.js:26, 129-138, 169-174`
**Issue:**
- `api()` and `toggle()` call `res.json()` unguarded. A non-JSON error body (413, proxy HTML) surfaces as "Unexpected token <".
- `loadUsers` responses can arrive out of order, so a stale flag's list can overwrite a newer one.
- `toggle()` duplicates `api()` instead of using it.

**Fix:** Use `api()` in `toggle`, wrap the JSON parse with a fallback to `HTTP ${status}`, and ignore a response if `state.selectedFlag !== flag`.

### IN-04: The test suite does not cover the risky paths without E2E

**File:** `tests/flags-panel.test.js:75-84`
**Issue:**
- There are no unit tests for `..` or traversal inputs in `locateProject`, a missing `APP_ENV`, a `DB_HOST` that is unset, or case variants (`Production`).
- There are no tests for `addUserFlag`, `removeUserFlag` or the route layer without a live database.
- The e2e tests are skipped unless `FLAGS_PANEL_E2E` is set, so CI never exercises SQL or the secret-leak assertion.

**Fix:** Add pure-function tests for the guard and path cases (they need no database). Mock `withDb` for the route and validation tests.

---

_Reviewed: 2026-10-15_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: quick_
