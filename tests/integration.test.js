import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

// Isola banco em arquivo temporário antes de carregar o app
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inbox-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');

const { default: app } = await import('../src/app.js');

const server = app.listen(0);
const address = server.address();
const baseURL = `http://127.0.0.1:${address.port}`;

test('GET /api/health', async () => {
  const res = await fetch(`${baseURL}/api/health`);
  assert.equal(res.ok, true);
  const body = await res.json();
  assert.equal(body.ok, true);
});

test('emails flow: create, list, get (marks read), delete-all', async () => {
  // Create
  const createRes = await fetch(`${baseURL}/api/emails`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Teste', recipient: 'user@example.com', body: 'Olá mundo' })
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  assert.ok(created?.id);

  // List
  const listRes = await fetch(`${baseURL}/api/emails?limit=10`);
  assert.equal(listRes.ok, true);
  const list = await listRes.json();
  assert.ok(list.total >= 1);
  assert.ok(Array.isArray(list.items));

  // Get by id (marks as read)
  const getRes = await fetch(`${baseURL}/api/emails/${created.id}`);
  assert.equal(getRes.ok, true);
  const got = await getRes.json();
  assert.equal(got.id, created.id);
  assert.equal(got.read, 1);

  // Delete all
  const delRes = await fetch(`${baseURL}/api/emails`, { method: 'DELETE' });
  assert.equal(delRes.ok, true);
  const del = await delRes.json();
  assert.equal(del.ok, true);

  // List again should be empty
  const listRes2 = await fetch(`${baseURL}/api/emails?limit=10`);
  const list2 = await listRes2.json();
  assert.equal(list2.total, 0);
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

