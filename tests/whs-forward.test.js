import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inbox-whs-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');

// webhook.site falso: um token com duas requisições capturadas
const TOKEN = '11111111-2222-3333-4444-555555555555';
const captured = [
  { uuid: 'b', method: 'POST', created_at: '2026-09-02 10:00:02', ip: '1.1.1.1', headers: { 'content-type': ['application/json'], host: ['webhook.site'] }, query: { source: 'certta' }, content: '{"event":"second"}' },
  { uuid: 'a', method: 'POST', created_at: '2026-09-02 10:00:01', ip: '1.1.1.1', headers: { 'content-type': ['application/json'] }, query: {}, content: '{"event":"first"}' },
];
const whs = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('Content-Type', 'application/json');
  if (url.pathname === `/token/${TOKEN}`) return res.end(JSON.stringify({ uuid: TOKEN, created_at: '2026-09-01 00:00:00' }));
  if (url.pathname === `/token/${TOKEN}/requests`) return res.end(JSON.stringify({ data: captured, total: captured.length, is_last_page: true }));
  res.statusCode = 404; res.end('{}');
}).listen(0);
process.env.WHS_BASE_URL = `http://127.0.0.1:${whs.address().port}`;

// destino local: guarda o que recebeu
const received = [];
const target = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => { received.push({ method: req.method, url: req.url, headers: req.headers, body }); res.end('{"ok":true}'); });
}).listen(0);
const TARGET = `http://127.0.0.1:${target.address().port}/webhooks/certta?env=local`;

const { default: app } = await import('../src/app.js');
const server = app.listen(0);
const baseURL = `http://127.0.0.1:${server.address().port}/api/whs-forward`;
const call = (method, p, body) => fetch(`${baseURL}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('POST /check valida o token no webhook.site', async () => {
  const res = await call('POST', '/check', { token: TOKEN });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).requests, 2);
});

test('POST /forwarders valida entrada', async () => {
  assert.equal((await call('POST', '/forwarders', { token: 'x', target: 'http://a' })).status, 400);
  assert.equal((await call('POST', '/forwarders', { token: TOKEN, target: 'ftp://a' })).status, 400);
});

test('start sem histórico ignora o que já existe; com histórico reenvia em ordem cronológica', async () => {
  const created = await (await call('POST', '/forwarders', { name: 't', token: TOKEN, target: TARGET, intervalMs: 1000 })).json();
  assert.ok(created.id);

  let f = await (await call('POST', `/forwarders/${created.id}/start`, {})).json();
  assert.equal(f.running, true);
  await sleep(300);
  assert.equal(received.length, 0, 'não deve reenviar o histórico sem backfill');
  await call('POST', `/forwarders/${created.id}/stop`);

  f = await (await call('POST', `/forwarders/${created.id}/start`, { backfill: true })).json();
  await sleep(500);
  assert.equal(received.length, 2);
  assert.equal(received[0].body, '{"event":"first"}');
  assert.equal(received[1].body, '{"event":"second"}');
  assert.equal(received[1].url, '/webhooks/certta?env=local&source=certta');
  assert.equal(received[1].headers['content-type'], 'application/json');
  assert.equal(received[1].headers['x-whs-request-id'], 'b');
  assert.equal(received[1].headers.host.startsWith('127.0.0.1'), true, 'host original não é repassado');

  const log = await (await call('GET', `/forwarders/${created.id}/log`)).json();
  assert.equal(log.length, 2);
  assert.equal(log[0].status, 200);

  await call('POST', `/forwarders/${created.id}/stop`);
  const list = await (await call('GET', '/forwarders')).json();
  assert.equal(list[0].running, false);
  assert.equal(list[0].forwarded, 2);
  assert.equal((await call('DELETE', `/forwarders/${created.id}`)).status, 200);
});

test.after(() => { server.close(); whs.close(); target.close(); });
