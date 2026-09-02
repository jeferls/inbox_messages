import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inbox-wa-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');

const { default: app } = await import('../src/app.js');

const server = app.listen(0);
const baseURL = `http://127.0.0.1:${server.address().port}`;
const post = (p, body) => fetch(`${baseURL}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('POST /v20.0/:id/messages aceita payload da Cloud API', async () => {
  const res = await post('/v20.0/123/messages', { messaging_product: 'whatsapp', to: '5511988887777', type: 'text', text: { body: 'oi' } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.match(body.messages[0].id, /^wamid\./);

  const state = await (await fetch(`${baseURL}/api/wa-mock/state`)).json();
  assert.equal(state.messages.at(-1).payload.text.body, 'oi');
  assert.ok(state.templates.pagamento_confirmado);
});

test('POST /v20.0/:id/messages responde erro no formato Meta', async () => {
  const res = await post('/v20.0/123/messages', { to: '1', type: 'text' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error.message, /^\(#100\)/);
});

test('POST /v20.0/... não suportado', async () => {
  const res = await post('/v20.0/123/media', {});
  assert.equal(res.status, 400);
});

test('POST /api/wa-mock/inbound registra mensagem do cliente', async () => {
  const res = await post('/api/wa-mock/inbound', { message: { type: 'text', text: { body: 'cliente' } } });
  assert.equal(res.status, 200);
  assert.match((await res.json()).id, /^wamid\./);
});

test.after(() => server.close());
