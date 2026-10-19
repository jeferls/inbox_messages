import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

// Fake greenn-back that records the webhooks the mock sends.
const received = [];
const back = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    received.push({ path: req.url, body: JSON.parse(raw || '{}') });
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"success":true}');
  });
});
await new Promise((resolve) => back.listen(0, resolve));

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inbox-idwall-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.GREENN_BACK_URL = `http://127.0.0.1:${back.address().port}`;

const { default: app } = await import('../src/app.js');
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const call = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};

test.after(() => { server.close(); back.close(); });

test('settings use short delays for the test', async () => {
  const res = await call('PUT', '/api/idwall-mock/settings', { inProgressDelayMs: 30, finalDelayMs: 120, extractionDelayMs: 30 });
  assert.equal(res.status, 200);
  assert.equal(res.body.finalDelayMs, 120);
});

test('profile: create, duplicate is 406 with the message greenn-back recognizes, unknown is 404', async () => {
  assert.equal((await call('POST', '/idwall/v3/maestro/profile', { ref: '501', personal: { name: 'Ana Lima', birthDate: '1990-04-12' } })).status, 201);
  const dup = await call('POST', '/idwall/v3/maestro/profile', { ref: '501' });
  assert.equal(dup.status, 406);
  assert.equal(dup.body.message, 'Profile "501" already exists');
  assert.equal((await call('GET', '/idwall/v3/maestro/profile/999')).status, 404);
});

test('flow: IN_PROGRESS then FINISHED webhooks with the flowId greenn-back sent', async () => {
  received.length = 0;
  const res = await call('POST', '/idwall/v3/maestro/profile/501/flow/miommomo');
  assert.equal(res.status, 200);

  const again = await call('POST', '/idwall/v3/maestro/profile/501/flow/miommomo');
  assert.equal(again.body.semantic.code, 'E001');

  await sleep(250);
  const flow = received.filter((w) => w.path === '/api/idwall/webhook').map((w) => w.body);
  assert.deepEqual(flow, [
    { flowId: 'miommomo', profileRef: '501', status: 'IN_PROGRESS' },
    { flowId: 'miommomo', profileRef: '501', status: 'FINISHED' },
  ]);

  const flows = await call('GET', '/idwall/v3/maestro/profile/501/profileFlows?page=1&limit=100');
  assert.equal(flows.body.data[0].flowName, 'basic');
  assert.equal(flows.body.data[0].status, 'FINISHED');
  assert.equal(flows.body.pagination.pages, 1);
});

test('flow without profile answers E004', async () => {
  const res = await call('POST', '/idwall/v3/maestro/profile/404404/flow/mock-first-product');
  assert.equal(res.body.semantic.code, 'E004');
});

test('sdk capture extracts the document and serves PNG images', async () => {
  await call('POST', '/idwall/v3/maestro/profile/sdk', { ref: '502', sdkToken: 'sdk-1' });
  assert.equal((await call('GET', '/idwall/v3/maestro/profile/502')).body.data.profileExtraction.status, 'EXTRACTING');

  await sleep(80);
  const { data } = (await call('GET', '/idwall/v3/maestro/profile/502')).body;
  assert.deepEqual(data.profileExtraction, { status: 'EXTRACTED', documentType: 'CNH' });
  assert.ok(data.images.some((img) => img.category === 'FACE' && img.name === 'FACE 1'));

  const image = await fetch(`${base}/idwall/v3${data.images[0].imageToken.replace('idwall:', '')}`);
  assert.equal(image.headers.get('content-type'), 'image/png');
  const bytes = Buffer.from(await image.arrayBuffer());
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
});

test('PF enrichment has the shape greenn-back reads and is stable per profile', async () => {
  const first = await call('GET', '/idwall/v3/maestro/profile-enrichment/by-profile-ref/501');
  const source = first.body.data.profileSourcesData[0].sourceData;
  assert.equal(source.personal.name, 'Ana Lima');
  assert.equal(source.personal.birthDate, '12/04/1990');
  assert.equal(source.contacts.addresses[0].isMain, true);
  assert.ok(source.contacts.addresses[0].zipCode && source.contacts.addresses[0].street);
  assert.equal(source.affiliations[0].relationshipType, 'MOTHER');

  const second = await call('GET', '/idwall/v3/maestro/profile-enrichment/by-profile-ref/501');
  assert.deepEqual(second.body, first.body);
});

test('company report: invalid CNPJ, webhook-report sequence and data', async () => {
  const invalid = await call('POST', '/idwall/v2/relatorios', { matriz: 'mock-company-registration', parametros: { cnpj_numero: '123' } });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.message, 'Parâmetro "cnpj_numero" não é válido.');

  received.length = 0;
  const created = await call('POST', '/idwall/v2/relatorios', { matriz: 'mock-company-registration', parametros: { cnpj_numero: '12.345.678/0001-90' } });
  const { numero } = created.body.result;
  assert.equal((await call('GET', `/idwall/v2/relatorios/${numero}`)).body.result.resultado, null);

  await sleep(250);
  assert.deepEqual(received.map((w) => w.body), [
    { dados: { status: 'EM ANALISE', protocolo: numero } },
    { dados: { status: 'CONCLUIDO', protocolo: numero } },
  ]);
  const report = (await call('GET', `/idwall/v2/relatorios/${numero}`)).body.result;
  assert.equal(report.resultado, 'VALID');

  const dados = (await call('GET', `/idwall/v2/relatorios/${numero}/dados`)).body.result;
  assert.ok(dados.cnpj.nome_empresarial && dados.cnpj.nome_fantasia);
  assert.equal(dados.enderecos[0].principal, true);
});

test('company outcome WAITING_MANUAL_ACTION concludes as INVALID not reviewed', async () => {
  await call('PUT', '/api/idwall-mock/settings', { outcomes: { company_enrichment: 'WAITING_MANUAL_ACTION' } });
  const { numero } = (await call('POST', '/idwall/v2/relatorios', { matriz: 'mock-company-enrichment', parametros: { cnpj_numero: '12345678000190' } })).body.result;

  await sleep(250);
  const report = (await call('GET', `/idwall/v2/relatorios/${numero}`)).body.result;
  assert.equal(report.resultado, 'INVALID');
  assert.equal(report.validado_manualmente, false);
});

test('manual webhook validates the status', async () => {
  const bad = await call('POST', '/api/idwall-mock/webhooks/flow', { userId: '501', flowId: 'miommomo', status: 'DONE' });
  assert.equal(bad.status, 400);

  const ok = await call('POST', '/api/idwall-mock/webhooks/flow', { userId: '501', flowId: 'miommomo', status: 'INVALID' });
  assert.equal(ok.body.ok, true);
  assert.deepEqual(ok.body.request, { flowId: 'miommomo', profileRef: '501', status: 'INVALID' });
});
