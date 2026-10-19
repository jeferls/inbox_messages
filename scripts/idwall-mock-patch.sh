#!/usr/bin/env bash
# Points the local greenn-back at the IdWall mock of this project, and back.
#
#   scripts/idwall-mock-patch.sh on|off|status
#
# "on" rewrites, in the greenn-back working tree:
#   - the hardcoded IdWall base URLs (api-v3 / api-v2) to $IDWALL_MOCK_HOST/idwall/v3|v2;
#   - the local/staging shortcuts that return a canned profile instead of calling IdWall;
#   - empty FLOW_ID_* / COMPANY_* values (config/idwall.php and IdWallHelper::flowUser) to mock ids, so flows
#     and webhooks resolve.
# Every changed line carries /* idwall-mock */. Nothing is written unless every replacement matches,
# and "off" restores the original text. Both also clear the config cache and restart the identity queue
# workers (on starts them), so no worker keeps the old IdWall URLs. Never commit these files while the patch is on.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GREENN_BACK_DIR="${GREENN_BACK_DIR:-$SCRIPT_DIR/../../greenn-local/greenn-back}"
IDWALL_MOCK_HOST="${IDWALL_MOCK_HOST:-http://svc-inbox_messages}"
PHP_CONTAINER="${PHP_CONTAINER:-greenn-back-php}"

[ -d "$GREENN_BACK_DIR/src" ] || { echo ">> greenn-back not found at $GREENN_BACK_DIR (set GREENN_BACK_DIR)"; exit 1; }

python3 - "$1" "$GREENN_BACK_DIR/src" "$IDWALL_MOCK_HOST" <<'PY'
import sys

mode, src, host = sys.argv[1], sys.argv[2], sys.argv[3].rstrip('/')
M = '/* idwall-mock */'

def flow(key, mock):
    return (f"env('{key}') =>", f"{M} (env('{key}') ?: '{mock}') =>", 1)

def matrix(name, key, mock):
    return (f"'{name}' => env('{key}'),", f"'{name}' => {M} (env('{key}') ?: '{mock}'),", 1)

# (file, [(original, patched, expected occurrences)])
PATCHES = [
    ('app/Helpers/IdWallHelper.php', [
        ("private static $url = 'https://api-v3.idwall.co';", f"private static $url = '{host}/idwall/v3'; {M}", 1),
        ("private static $urlReport = 'https://api-v2.idwall.co';", f"private static $urlReport = '{host}/idwall/v2'; {M}", 1),
        ("if(env('APP_ENV') == 'local'){", f"if({M} false && env('APP_ENV') == 'local'){{", 1),
        # flowUser reads FLOW_ID_* straight from env, and only FLOW_ID_BASIC is set locally.
        ("$flowId = env('FLOW_ID_'.strtoupper($flow).'_RG');",
         f"$flowId = {M} (env('FLOW_ID_'.strtoupper($flow).'_RG') ?: 'mock-'.str_replace('_', '-', $flow).'-rg');", 1),
        ("$flowId = env('FLOW_ID_'.strtoupper($flow).'_CNH');",
         f"$flowId = {M} (env('FLOW_ID_'.strtoupper($flow).'_CNH') ?: 'mock-'.str_replace('_', '-', $flow).'-cnh');", 1),
        ("$flowId = env('FLOW_ID_'.strtoupper($flow));",
         f"$flowId = {M} (env('FLOW_ID_'.strtoupper($flow)) ?: 'mock-'.str_replace('_', '-', $flow));", 1),
    ]),
    ('domain/IdWall/Helpers/IdWallHelper.php', [
        ("private static $url = 'https://api-v3.idwall.co';", f"private static $url = '{host}/idwall/v3'; {M}", 1),
        ("if(app()->environment(['local', 'staging'])){", f"if({M} false && app()->environment(['local', 'staging'])){{", 2),
    ]),
    ('config/idwall.php', [
        flow('FLOW_ID_BIOMETRY_RG', 'mock-biometry-rg'),
        flow('FLOW_ID_BIOMETRY_CNH', 'mock-biometry-cnh'),
        flow('FLOW_ID_FIRST_WITHDRAW', 'mock-first-withdraw'),
        flow('FLOW_ID_FIRST_PRODUCT', 'mock-first-product'),
        flow('FLOW_ID_GROWTH10K', 'mock-growth10k'),
        flow('FLOW_ID_GROWTH1K', 'mock-growth1k'),
        matrix('company_registration', 'COMPANY_REGISTRATION', 'mock-company-registration'),
        matrix('company_enrichment', 'COMPANY_ENRICHMENT', 'mock-company-enrichment'),
        matrix('company_growth1k', 'COMPANY_GROWTH1K', 'mock-company-growth1k'),
    ]),
]

def read(rel):
    with open(f'{src}/{rel}', encoding='utf-8') as fh:
        return fh.read()

if mode == 'status':
    for rel, _ in PATCHES:
        print(f'{rel}: {read(rel).count(M)} patched line(s)')
    sys.exit(0)

if mode not in ('on', 'off'):
    print('usage: idwall-mock-patch.sh on|off|status')
    sys.exit(2)

results = {}
for rel, pairs in PATCHES:
    text = read(rel)
    if mode == 'on' and M in text:
        print(f'>> {rel} is already patched (run "off" first)')
        sys.exit(1)
    for original, patched, count in pairs:
        old, new = (original, patched) if mode == 'on' else (patched, original)
        found = text.count(old)
        if mode == 'off' and found == 0:
            continue
        if found != count:
            print(f'>> {rel}: expected {count} match(es) of {old!r}, found {found}. Nothing was changed.')
            sys.exit(1)
        text = text.replace(old, new)
    if mode == 'off' and M in text:
        print(f'>> {rel}: a patched line was edited by hand; restore it manually. Nothing was changed.')
        sys.exit(1)
    results[rel] = text

for rel, text in results.items():
    with open(f'{src}/{rel}', 'w', encoding='utf-8') as fh:
        fh.write(text)
print(f'>> IdWall mock patch {mode.upper()} ({host})')
PY

IDENTITY_QUEUES="_identity_verification _identity_enrichment _idwall_enrichment _status_report_idwall"
# Also runs IdWallHelper (create, update, updateCompanyData, biometry): restarted when running, never started
# here, since a stopped one may hold a backlog of old messages.
LEGACY_QUEUES="_event_idwall"
GREENN_BACK_LOCAL_URL="${GREENN_BACK_LOCAL_URL:-http://localhost:81}"

php_running() { docker ps --format '{{.Names}}' | grep -qx "$PHP_CONTAINER"; }
worker_running() { docker exec "$PHP_CONTAINER" sh -c "ps -o args | grep -v grep | grep -q 'artisan work $1\$'"; }

# A worker keeps the IdWallHelper it loaded at boot: without a restart it would keep calling the
# real IdWall after "on" (or the mock after "off").
restart_workers() {
  local mode=$1
  for q in $IDENTITY_QUEUES $LEGACY_QUEUES; do
    if worker_running "$q"; then
      docker exec "$PHP_CONTAINER" pkill -f "artisan work $q\$" || true
      docker exec -d "$PHP_CONTAINER" php artisan work "$q"
      echo ">> worker $q restarted"
    elif [ "$mode" = "on" ] && [ "${LEGACY_QUEUES#*$q}" = "$LEGACY_QUEUES" ]; then
      docker exec -d "$PHP_CONTAINER" php artisan work "$q"
      echo ">> worker $q started"
    fi
  done
}

webhook_probe() {
  curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -H 'accept: application/json' \
    -d '{"dados":{"status":"EM ANALISE","protocolo":"idwall-mock-probe"}}' "$GREENN_BACK_LOCAL_URL/api/idwall/webhook-report" || true
}

if ! php_running; then
  echo ">> $PHP_CONTAINER is not running: config cache, workers and webhook checks skipped."
  exit 0
fi

if [ "$1" = "status" ]; then
  for q in $IDENTITY_QUEUES $LEGACY_QUEUES; do worker_running "$q" && echo "worker $q: running" || echo "worker $q: stopped"; done
  echo "greenn-back webhook endpoint: HTTP $(webhook_probe)"
  exit 0
fi

docker exec "$PHP_CONTAINER" php artisan config:clear >/dev/null && echo ">> config cache cleared in $PHP_CONTAINER"
restart_workers "$1"

if [ "$1" = "on" ]; then
  code=$(webhook_probe)
  if [ "$code" = "502" ]; then
    # nginx resolved the PHP container once; a recreated container gets another IP.
    docker restart greenn-back-nginx >/dev/null && sleep 2 && code=$(webhook_probe)
    echo ">> greenn-back-nginx restarted (it pointed at an old PHP container IP)"
  fi
  echo ">> greenn-back webhook endpoint: HTTP $code"
  if [ -n "$(docker exec "$PHP_CONTAINER" printenv IDWALL_WEBHOOK_TOKEN 2>/dev/null)" ]; then
    echo ">> WARNING: IDWALL_WEBHOOK_TOKEN is set in greenn-back. Start the inbox with IDWALL_MOCK_WEBHOOK_TOKEN set to the same value, or the webhooks are rejected."
  fi
fi
git -C "$GREENN_BACK_DIR" status --short -- src/app/Helpers/IdWallHelper.php src/domain/IdWall/Helpers/IdWallHelper.php src/config/idwall.php
