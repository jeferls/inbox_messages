#!/usr/bin/env bash
# Points the local greenn-back and gateway at the Iugu mock of this project, and back.
#
#   scripts/iugu-mock-patch.sh on|off|status
#   scripts/iugu-mock-patch.sh proxy-on|proxy-off <seller_id>   # IUGU_SEC_PROXY user flag for one seller
#
# "on" rewrites, in the working trees (every changed line carries /* iugu-mock */):
#   greenn-back  config/iugu.php           the hardcoded api.iugu.com URL -> $IUGU_MOCK_HOST/iugu/v1/
#                config/iugu_sec_proxy.php base_url + greenn_token -> the mock's sec-proxy
#                app/Helpers/IuguHelper.php the Utils::checkIsDev() shortcuts that answer canned JSON locally
#   gateway      config/iugu.php           api_url -> $IUGU_MOCK_HOST/iugu/v1/
#                config/iugu_sec_proxy.php base_url + greenn_token (only on branches that have the file)
# Nothing is written unless every replacement matches, and "off" restores the original text. Both
# clear the config cache of greenn-back-php and gateway-php and restart the Iugu queue workers that
# are running. It also makes sure the IUGU_SUBACCOUNT global flag exists. Never commit these files
# while the patch is on.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GREENN_LOCAL_DIR="${GREENN_LOCAL_DIR:-$SCRIPT_DIR/../../greenn-local}"
GREENN_BACK_DIR="${GREENN_BACK_DIR:-$GREENN_LOCAL_DIR/greenn-back}"
GATEWAY_DIR="${GATEWAY_DIR:-$GREENN_LOCAL_DIR/gateway}"
IUGU_MOCK_HOST="${IUGU_MOCK_HOST:-http://svc-inbox_messages}"
IUGU_MOCK_PROXY_GREENN_TOKEN="${IUGU_MOCK_PROXY_GREENN_TOKEN:-iugu-mock-greenn-token}"
PHP_CONTAINER="${PHP_CONTAINER:-greenn-back-php}"
GATEWAY_CONTAINER="${GATEWAY_CONTAINER:-gateway-php}"
MYSQL_CONTAINER="${MYSQL_CONTAINER:-greenn-back-mysql}"
INBOX_CONTAINER="${INBOX_CONTAINER:-svc-inbox_messages}"

MODE="${1:-}"

running() { docker ps --format '{{.Names}}' | grep -qx "$1"; }

mysql_greenn() {
  local user pass db
  user=$(docker exec "$PHP_CONTAINER" printenv DB_USERNAME 2>/dev/null || echo admin)
  pass=$(docker exec "$PHP_CONTAINER" printenv DB_PASSWORD 2>/dev/null || echo secret)
  db=$(docker exec "$PHP_CONTAINER" printenv DB_DATABASE 2>/dev/null || echo greenn)
  docker exec -i "$MYSQL_CONTAINER" mysql -N -u"$user" -p"$pass" "$db" -e "$1" 2>/dev/null
}

# ─── Seller flag (sec-proxy path) ───────────────────────────────────────────

if [ "$MODE" = "proxy-on" ] || [ "$MODE" = "proxy-off" ]; then
  SELLER="${2:-}"
  [[ "$SELLER" =~ ^[0-9]+$ ]] || { echo "usage: iugu-mock-patch.sh $MODE <seller_id>"; exit 2; }
  running "$MYSQL_CONTAINER" || { echo ">> $MYSQL_CONTAINER is not running"; exit 1; }
  if [ "$MODE" = "proxy-on" ]; then
    mysql_greenn "INSERT INTO user_flags (user_id, flag, created_at, updated_at)
                  SELECT $SELLER, 'IUGU_SEC_PROXY', NOW(), NOW() FROM DUAL
                  WHERE NOT EXISTS (SELECT 1 FROM user_flags WHERE user_id = $SELLER AND flag = 'IUGU_SEC_PROXY');"
    echo ">> IUGU_SEC_PROXY on for seller $SELLER (greenn-back and gateway use the mock's sec-proxy for this seller)"
  else
    mysql_greenn "DELETE FROM user_flags WHERE user_id = $SELLER AND flag = 'IUGU_SEC_PROXY';"
    echo ">> IUGU_SEC_PROXY off for seller $SELLER (legacy path: direct API)"
  fi
  docker exec -u www-data "$PHP_CONTAINER" php artisan cache:clear >/dev/null 2>&1 || true
  exit 0
fi

# ─── Source patches ──────────────────────────────────────────────────────────

python3 - "$MODE" "$GREENN_BACK_DIR/src" "$GATEWAY_DIR/src" "$IUGU_MOCK_HOST" "$IUGU_MOCK_PROXY_GREENN_TOKEN" <<'PY'
import os
import sys

mode, back, gateway, host, greenn_token = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4].rstrip('/'), sys.argv[5]
M = '/* iugu-mock */'
api_url = f'{host}/iugu/v1/'
proxy_url = f'{host}/iugu-proxy'

proxy_pairs = [
    ("'base_url' => rtrim((string) env('IUGU_SEC_PROXY_BASE_URL', ''), '/'),", f"'base_url' => {M} '{proxy_url}',", 1),
    ("'greenn_token' => env('IUGU_SEC_PROXY_GREENN_TOKEN'),", f"'greenn_token' => {M} '{greenn_token}',", 1),
]

# (root, file, [(original, patched, expected occurrences)], optional)
PATCHES = [
    (back, 'config/iugu.php', [
        ("$urlDefault = 'https://api.iugu.com/v1/';", f"$urlDefault = '{api_url}'; {M}", 1),
    ], False),
    (back, 'config/iugu_sec_proxy.php', proxy_pairs, False),
    (back, 'app/Helpers/IuguHelper.php', [
        # createSubAccount, configureAccount, subAccountVerification, deleteAccount, updateAccount, createDomicile
        ("if (Utils::checkIsDev()) {", f"if ({M} false && Utils::checkIsDev()) {{", 6),
    ], False),
    (gateway, 'config/iugu.php', [
        ("'api_url' => env('IUGU_API_URL'),", f"'api_url' => {M} '{api_url}',", 1),
    ], False),
    (gateway, 'config/iugu_sec_proxy.php', proxy_pairs, True),
]

def path(root, rel):
    return os.path.join(root, rel)

def read(root, rel):
    with open(path(root, rel), encoding='utf-8') as fh:
        return fh.read()

def label(root, rel):
    return ('greenn-back' if root == back else 'gateway') + '/' + rel

if mode == 'status':
    for root, rel, _, optional in PATCHES:
        if not os.path.exists(path(root, rel)):
            print(f'{label(root, rel)}: not present on this branch')
            continue
        print(f'{label(root, rel)}: {read(root, rel).count(M)} patched line(s)')
    sys.exit(0)

if mode not in ('on', 'off'):
    print('usage: iugu-mock-patch.sh on|off|status | proxy-on|proxy-off <seller_id>')
    sys.exit(2)

results = {}
for root, rel, pairs, optional in PATCHES:
    if not os.path.exists(path(root, rel)):
        if optional:
            print(f'>> {label(root, rel)} not present on this branch: skipped (the gateway sec-proxy path needs a branch that has it)')
            continue
        print(f'>> {label(root, rel)} not found. Nothing was changed.')
        sys.exit(1)
    text = read(root, rel)
    if mode == 'on' and M in text:
        print(f'>> {label(root, rel)} is already patched (run "off" first)')
        sys.exit(1)
    for original, patched, count in pairs:
        old, new = (original, patched) if mode == 'on' else (patched, original)
        found = text.count(old)
        if mode == 'off' and found == 0:
            continue
        if found != count:
            print(f'>> {label(root, rel)}: expected {count} match(es) of {old!r}, found {found}. Nothing was changed.')
            sys.exit(1)
        text = text.replace(old, new)
    if mode == 'off' and M in text:
        print(f'>> {label(root, rel)}: a patched line was edited by hand; restore it manually. Nothing was changed.')
        sys.exit(1)
    results[path(root, rel)] = text

for file, text in results.items():
    with open(file, 'w', encoding='utf-8') as fh:
        fh.write(text)
print(f'>> Iugu mock patch {mode.upper()} (direct {api_url}, sec-proxy {proxy_url})')
PY

# ─── Containers ──────────────────────────────────────────────────────────────

IUGU_QUEUES="_iugu_recipient _iugu_configure_account _iugu_update_status_recipient _iugu_seal_recipient_tokens _iugu_renew_user_tokens _iugu_regenerate_live_tokens _reconcile_iugu"

worker_running() { docker exec "$PHP_CONTAINER" sh -c "ps -o args | grep -v grep | grep -q 'artisan work $1\$'"; }

# A worker keeps the config it loaded at boot: without a restart it would keep calling the real Iugu.
restart_workers() {
  for q in $IUGU_QUEUES; do
    if worker_running "$q"; then
      docker exec "$PHP_CONTAINER" pkill -f "artisan work $q\$" || true
      docker exec -d -u www-data "$PHP_CONTAINER" php artisan work "$q"
      echo ">> worker $q restarted"
    fi
  done
}

probe() {
  # From inside the PHP container, so the greenn-network DNS is the one in use.
  docker exec "$1" sh -c "curl -s -o /dev/null -w '%{http_code}' '$IUGU_MOCK_HOST/api/iugu-mock/settings' 2>/dev/null || wget -q -O /dev/null -S '$IUGU_MOCK_HOST/api/iugu-mock/settings' 2>&1 | awk '/HTTP\\//{print \$2}' | tail -1" || true
}

if [ "$MODE" = "status" ]; then
  if running "$PHP_CONTAINER"; then
    for q in $IUGU_QUEUES; do worker_running "$q" && echo "worker $q: running"; done
    echo "greenn-back -> mock: HTTP $(probe "$PHP_CONTAINER")"
    echo "IUGU_SEC_PROXY sellers: $(mysql_greenn "SELECT IFNULL(GROUP_CONCAT(user_id), '-') FROM user_flags WHERE flag = 'IUGU_SEC_PROXY';" || echo '?')"
  fi
  running "$GATEWAY_CONTAINER" && echo "gateway -> mock: HTTP $(probe "$GATEWAY_CONTAINER")"
  running "$INBOX_CONTAINER" || echo ">> WARNING: $INBOX_CONTAINER is not running (make up)"
  exit 0
fi

for c in "$PHP_CONTAINER" "$GATEWAY_CONTAINER"; do
  if running "$c"; then
    docker exec -u www-data "$c" php artisan config:clear >/dev/null 2>&1 && echo ">> config cache cleared in $c" || echo ">> could not clear the config cache in $c"
  else
    echo ">> $c is not running: config cache not cleared"
  fi
done

if running "$PHP_CONTAINER"; then
  restart_workers
  if [ "$MODE" = "on" ]; then
    if [ "$(mysql_greenn "SELECT COUNT(*) FROM global_flags WHERE flag = 'IUGU_SUBACCOUNT';" || echo 0)" = "0" ]; then
      mysql_greenn "INSERT INTO global_flags (flag, created_at, updated_at) VALUES ('IUGU_SUBACCOUNT', NOW(), NOW());"
      echo ">> IUGU_SUBACCOUNT global flag created"
    fi
    echo ">> greenn-back -> mock: HTTP $(probe "$PHP_CONTAINER")"
  fi
fi
if [ "$MODE" = "on" ]; then
  running "$GATEWAY_CONTAINER" && echo ">> gateway -> mock: HTTP $(probe "$GATEWAY_CONTAINER")"
  running "$INBOX_CONTAINER" || echo ">> WARNING: $INBOX_CONTAINER is not running: run make up in inbox_messages"
  echo ">> Panel: http://localhost:8115/gateway-mocks-iugu.html"
  echo ">> sec-proxy for a seller: make iugu-mock-proxy-on SELLER=<id>"
fi

git -C "$GREENN_BACK_DIR" status --short -- src/config/iugu.php src/config/iugu_sec_proxy.php src/app/Helpers/IuguHelper.php
git -C "$GATEWAY_DIR" status --short -- src/config/iugu.php src/config/iugu_sec_proxy.php
