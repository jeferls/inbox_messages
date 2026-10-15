import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  parseEnv,
  parseSeederFlags,
  isValidFlag,
  locateProject,
  resolveDbConfig,
  withDb,
} from '../src/services/flags-panel.service.js';

test('parseSeederFlags extrai nomes, ignora comentarios e deduplica', () => {
  const php = `<?php
    $flags = [
      '3DS',
      'feature.client_search.use_opensearch',
      "show-button-redirect-club",
      // 'COMENTADA',
      'bank_account_remove',
      '3DS',
    ];
    foreach ($flags as $flagName) {}`;
  assert.deepEqual(parseSeederFlags(php), [
    '3DS',
    'feature.client_search.use_opensearch',
    'show-button-redirect-club',
    'bank_account_remove',
  ]);
  assert.throws(() => parseSeederFlags('<?php echo 1;'), { status: 400 });
});

test('parseEnv trata aspas, export, comentarios e = no valor', () => {
  const env = parseEnv(
    ['', '# c', 'export DB_HOST=greenn-back-mysql', 'DB_PASSWORD="se#cret=1"', "DB_USERNAME='admin'", 'APP_KEY=base64:abc=', 'DB_PORT=3306 # porta'].join('\n'),
  );
  assert.equal(env.DB_HOST, 'greenn-back-mysql');
  assert.equal(env.DB_PASSWORD, 'se#cret=1');
  assert.equal(env.DB_USERNAME, 'admin');
  assert.equal(env.APP_KEY, 'base64:abc=');
  assert.equal(env.DB_PORT, '3306');
});

test('isValidFlag', () => {
  for (const ok of ['3DS', 'feature.client_search.use_opensearch', 'show-button-redirect-club', 'a'.repeat(50)]) assert.equal(isValidFlag(ok), true, ok);
  for (const bad of ['', 'a b', "x';DROP", 'a'.repeat(51), null, 5, undefined]) assert.equal(isValidFlag(bad), false, String(bad));
});

test('resolveDbConfig aplica fallback de host e guard D-05', () => {
  const base = { DB_HOST: 'greenn-back-mysql', DB_PORT: '3306', DB_USERNAME: 'u', DB_PASSWORD: 'p', DB_DATABASE: 'greenn' };
  let c = resolveDbConfig(base, { inContainer: false });
  assert.equal(c.host, '127.0.0.1');
  assert.equal(c.port, 3301);
  c = resolveDbConfig(base, { inContainer: true });
  assert.equal(c.host, 'greenn-back-mysql');
  assert.equal(c.port, 3306);
  c = resolveDbConfig({ ...base, DB_HOST: 'localhost', DB_PORT: '3307' }, { inContainer: false });
  assert.deepEqual([c.host, c.port], ['localhost', 3307]);
  assert.throws(() => resolveDbConfig({ ...base, APP_ENV: 'production' }, { inContainer: false }), { status: 400 });
  assert.throws(() => resolveDbConfig({ ...base, APP_ENV: 'PROD' }, { inContainer: false }), { status: 400 });
  assert.throws(() => resolveDbConfig({ ...base, DB_HOST: 'db.prod.aws.com' }, { inContainer: false }), { status: 400 });
});

test('locateProject resolve raiz do repo, raiz Laravel e mount /greenn-back', () => {
  const seeder = '/r/greenn-back/src/database/seeders/GlobalFlagSeeder.php';
  const env = '/r/greenn-back/.env.dev';
  const exists = (set) => (p) => set.has(p);
  const full = new Set(['/r/greenn-back', '/r/greenn-back/src', env, seeder]);
  for (const input of ['/r/greenn-back', '/r/greenn-back/src']) {
    const r = locateProject(input, exists(full));
    assert.equal(r.envFile, env);
    assert.equal(r.seederFile, seeder);
  }
  const mount = new Set(['/greenn-back', '/greenn-back/.env.dev', '/greenn-back/src/database/seeders/GlobalFlagSeeder.php']);
  assert.equal(locateProject('/home/x/greenn-back', exists(mount)).backPath, '/greenn-back');
  assert.throws(() => locateProject('/nada', exists(new Set())), { status: 400 });
  assert.throws(() => locateProject('', exists(full)), { status: 400 });
});

// ---- e2e: precisa de MySQL de dev + greenn-back-php; ligue com FLAGS_PANEL_E2E=<path do greenn-back> ----
const E2E = process.env.FLAGS_PANEL_E2E;
const skip = E2E ? false : 'defina FLAGS_PANEL_E2E=<path do greenn-back>';
const SMOKE = 'zz-flags-panel-smoke';

let baseURL;
let server;
if (E2E) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inbox-flags-'));
  process.env.DB_PATH = path.join(tmpDir, 'test.db');
  const { default: app } = await import('../src/app.js');
  server = app.listen(0);
  baseURL = `http://127.0.0.1:${server.address().port}`;
}
const call = (method, p, body) =>
  fetch(`${baseURL}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const q = (o) => new URLSearchParams(o).toString();

test('e2e: GET /flags lista estado sem vazar senha', { skip }, async () => {
  const res = await call('GET', `/api/flags-panel/flags?${q({ path: E2E })}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.flags.length > 0);
  for (const f of body.flags) {
    assert.equal(typeof f.flag, 'string');
    assert.equal(typeof f.enabled, 'boolean');
    assert.equal(typeof f.inSeeder, 'boolean');
  }
  assert.deepEqual(Object.keys(body.db), ['host', 'port', 'database']);
  assert.equal((await call('GET', '/flags.html')).status, 200);
});

test('e2e: toggle global grava, esquece cache e valida entrada', { skip }, async () => {
  try {
    let res = await call('PUT', '/api/flags-panel/flag', { path: E2E, flag: SMOKE, enabled: true });
    assert.equal(res.status, 200);
    let body = await res.json();
    assert.equal(body.enabled, true);
    assert.equal(typeof body.cacheCleared, 'boolean');
    let list = await (await call('GET', `/api/flags-panel/flags?${q({ path: E2E })}`)).json();
    const row = list.flags.find((f) => f.flag === SMOKE);
    assert.deepEqual([row.inSeeder, row.enabled], [false, true]);

    res = await call('PUT', '/api/flags-panel/flag', { path: E2E, flag: SMOKE, enabled: false });
    assert.equal((await res.json()).enabled, false);
    list = await (await call('GET', `/api/flags-panel/flags?${q({ path: E2E })}`)).json();
    assert.equal(list.flags.some((f) => f.flag === SMOKE), false);

    assert.equal((await call('PUT', '/api/flags-panel/flag', { path: E2E, flag: "x';DROP", enabled: true })).status, 400);
    assert.equal((await call('PUT', '/api/flags-panel/flag', { path: E2E, flag: SMOKE, enabled: 'sim' })).status, 400);
  } finally {
    await call('PUT', '/api/flags-panel/flag', { path: E2E, flag: SMOKE, enabled: false });
  }
});

test('e2e: user_flags listar/adicionar/remover', { skip }, async (t) => {
  const [[user]] = await withDb(E2E, (c) => c.query('SELECT id, email FROM users WHERE email IS NOT NULL ORDER BY id LIMIT 1'));
  if (!user) return t.skip('sem usuario no banco de dev');
  try {
    let res = await call('POST', '/api/flags-panel/user-flags', { path: E2E, flag: SMOKE, user: user.email });
    assert.equal(res.status, 200);
    let body = await res.json();
    assert.equal(body.alreadyExisted, false);
    assert.equal(Number(body.user_id), Number(user.id));
    const rowId = body.id;

    body = await (await call('POST', '/api/flags-panel/user-flags', { path: E2E, flag: SMOKE, user: String(user.id) })).json();
    assert.equal(body.alreadyExisted, true);

    body = await (await call('GET', `/api/flags-panel/user-flags?${q({ path: E2E, flag: SMOKE })}`)).json();
    assert.ok(body.items.some((i) => i.email === user.email));

    res = await call('DELETE', '/api/flags-panel/user-flags', { path: E2E, id: rowId });
    assert.equal(res.status, 200);
    body = await (await call('GET', `/api/flags-panel/user-flags?${q({ path: E2E, flag: SMOKE })}`)).json();
    assert.equal(body.items.length, 0);

    assert.equal((await call('POST', '/api/flags-panel/user-flags', { path: E2E, flag: SMOKE, user: 'nao-existe@example.invalid' })).status, 404);
    assert.equal((await call('POST', '/api/flags-panel/user-flags', { path: E2E, flag: SMOKE, user: 'abc' })).status, 400);
    assert.equal((await call('DELETE', '/api/flags-panel/user-flags', { path: E2E, id: 'x' })).status, 400);
  } finally {
    await withDb(E2E, (c) => c.query('DELETE FROM user_flags WHERE flag = ?', [SMOKE]));
  }
});

after(() => {
  server?.close();
});
