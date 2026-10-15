# Quick Task 261015-jlz — Context (locked decisions)

## Task
New "Flags" panel in inbox_messages (Express + static `public/*.html|js` pages) to manage greenn-back feature flags on the local DEV database. Branch: `feat/pannel-flags`.

## Requirements
1. Panel has an input for the greenn-back project path. Server reads the dev `.env` there (DB_HOST, DB_PORT, DB_DATABASE, DB_USERNAME, DB_PASSWORD) and the seeder at `src/database/seeders/GlobalFlagSeeder.php` (greenn-back repo root has `src/` = Laravel app; also accept a path pointing directly at the Laravel root).
2. Parse flag names from the `$flags = [ ... ];` array in GlobalFlagSeeder (single-quoted strings; names include dots, dashes, lowercase).
3. For each flag show a switch: ON = row exists in `global_flags` (`flag` varchar(50)); toggling ON = INSERT (`flag`, created_at, updated_at), OFF = DELETE WHERE flag = ?. Parameterized queries only.
4. Allow inserting into `user_flags` (user_id bigint FK users.id, flag varchar(50), timestamps) for a chosen flag + user (accept user id or email, resolve email via `users`). Also list current user_flags for a flag and allow removing them.

## Decisions
- D1 Docker path: docker-compose mounts `${GREENN_BACK_PATH:-../greenn-back}` read-only at `/greenn-back`. Server resolves the typed host path: if it exists as-is use it (npm run dev on host); otherwise fall back to `/greenn-back` mount. Persist last path in localStorage on the client.
- D2 Cache: `App\GlobalFlag::cachedCheck` caches `feature_flag_<FLAG>` for 1h. After each global toggle run `php artisan cache:forget feature_flag_<FLAG>` in container `greenn-back-php` via the docker socket (already mounted; see existing `src/routes/docker.routes.js` for how the project talks to docker). Failure to clear cache is non-fatal: return a warning shown in UI.
- D3 Show flags that exist in `global_flags` but NOT in the seeder, with a "fora do seeder" badge (reminder that the rule is: every flag goes in the seeder).
- D4 DB connection: reuse `mysql2` (already a dependency) and the existing GREENN_DB pattern in `src/config/env.js`. The .env DB_HOST `greenn-back-mysql` resolves inside greenn-network (container). When running on host and host is `greenn-back-mysql`, fallback to 127.0.0.1:3301 (see greenn-local CLAUDE.md: MySQL mapped on 3301).
- D5 Safety: refuse to operate if the .env APP_ENV is `production` or DB_HOST looks remote (not greenn-back-mysql/localhost/127.0.0.1). Dev-only tool.
- D6 UI follows the existing pages (`public/*.html` + `public/styles.css`, nav pattern used by other tabs). Add a search/filter box. Text in pt-BR.
