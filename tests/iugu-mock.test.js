import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

// Fake gateway postback that records the Iugu webhooks.
const webhooks = [];
const gateway = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    webhooks.push({ url: req.url, type: req.headers['content-type'], form: Object.fromEntries(new URLSearchParams(raw)) });
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
  });
});
await new Promise((resolve) => gateway.listen(0, resolve));

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inbox-iugu-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.IUGU_MOCK_WEBHOOK_URL = `http://127.0.0.1:${gateway.address().port}/api/postback?integration=iugu`;

const { default: app } = await import('../src/app.js');
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MASTER = 'master-token-from-env';
const GREENN = 'iugu-mock-greenn-token';

const basic = (token) => ({ authorization: `Basic ${Buffer.from(`${token}:`).toString('base64')}` });

async function call(method, url, { body, headers = {}, raw } = {}) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: body !== undefined || raw !== undefined ? { 'content-type': 'application/json', ...headers } : headers,
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

const proxy = (method, url, { envelope, master, body, raw } = {}) => call(method, `/iugu-proxy/iugu${url}`, {
  body,
  raw,
  headers: {
    'x-greenn-token': GREENN,
    ...(master ? { 'x-iugu-master': 'true' } : {}),
    ...(envelope ? { 'x-iugu-token': envelope } : {}),
  },
});

test.after(() => { server.close(); gateway.close(); });

test('settings: webhooks immediately, nothing automatic', async () => {
  const res = await call('PUT', '/api/iugu-mock/settings', { body: { autoWebhooks: true } });
  assert.equal(res.status, 200);
});

let sub;

test('direct: subaccount creation, configuration, KYC and bank domicile', async () => {
  const created = await call('POST', '/iugu/v1/v1/marketplace/create_account?api_token=' + MASTER, { body: {} });
  assert.equal(created.status, 200);
  assert.match(created.body.account_id, /^[0-9A-F]{32}$/);
  sub = created.body;

  const configured = await call('POST', '/iugu/v1/v1/accounts/configuration?api_token=' + sub.live_api_token, {
    body: { auto_withdraw: false, auto_advance: false, disabled_withdraw: true, fines: false, credit_card: { installments: true, max_installments: 12 } },
  });
  assert.equal(configured.status, 200);
  assert.equal(configured.body.account_id, sub.account_id);

  const nested = await call('POST', `/iugu/v1/v1/accounts/${sub.account_id}/request_verification?api_token=${sub.live_api_token}`, {
    body: { data: { name: 'Seller', files: { selfie: 'x' } } },
  });
  assert.equal(nested.status, 400);
  assert.equal(nested.body.errors, 'Files é obrigatório');

  const verified = await call('POST', `/iugu/v1/v1/accounts/${sub.account_id}/request_verification?api_token=${sub.live_api_token}`, {
    body: { data: { name: 'Seller', price_range: '5000,00' }, files: { identification: 'aGVsbG8=', selfie: 'aGVsbG8=' } },
  });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.account_id, sub.account_id);

  const again = await call('POST', `/iugu/v1/v1/accounts/${sub.account_id}/request_verification?api_token=${sub.live_api_token}`, {
    body: { data: { name: 'Seller' }, files: { identification: 'a', selfie: 'a' } },
  });
  assert.equal(again.status, 400);

  const domicile = { bank: '509', agency: '0001', account: '12345-6', account_type: 'cc' };
  const first = await call('POST', '/iugu/v1/v1/bank_verification?api_token=' + sub.user_token, { body: domicile });
  assert.deepEqual(first.body, { success: true });
  const second = await call('POST', '/iugu/v1/v1/bank_verification?api_token=' + sub.user_token, { body: domicile });
  assert.equal(second.status, 400);
  assert.deepEqual(second.body.errors.base, ['Account is already using this bank address']);

  const account = await call('GET', `/iugu/v1/accounts/${sub.account_id}`, { headers: basic(sub.live_api_token) });
  assert.equal(account.body['is_verified?'], false);
  assert.equal(account.body.last_verification_request_status, 'pending');
});

test('direct: pix invoice paid from the panel sends the gateway webhook', async () => {
  const invoice = await call('POST', '/iugu/v1/invoices', {
    headers: basic(sub.live_api_token),
    body: { email: 'buyer@example.com', due_date: '2030-01-10', payable_with: 'pix', items: [{ description: 'Curso', quantity: 1, price_cents: 1990 }], payer: { name: 'Buyer', cpf_cnpj: '12345678909' } },
  });
  assert.equal(invoice.status, 200);
  assert.match(invoice.body.id, /^[0-9A-F]{32}$/);
  assert.match(invoice.body.pix.qrcode_text, /^000201/);
  assert.equal(invoice.body.status, 'pending');

  const paid = await call('POST', `/api/iugu-mock/invoices/${invoice.body.id}/actions`, { body: { action: 'pay' } });
  assert.equal(paid.body.status, 'paid');
  await sleep(300);
  const hook = webhooks.find((w) => w.form['data[id]'] === invoice.body.id);
  assert.ok(hook, 'webhook sent');
  assert.equal(hook.form.event, 'invoice.status_changed');
  assert.equal(hook.form['data[status]'], 'paid');
  assert.match(hook.type, /x-www-form-urlencoded/);

  const partial = await call('POST', `/iugu/v1/invoices/${invoice.body.id}/refund`, { headers: basic(sub.live_api_token), body: { partial_value_refund_cents: 100 } });
  assert.equal(partial.status, 400);

  const refunded = await call('POST', `/iugu/v1/invoices/${invoice.body.id}/refund`, { headers: basic(sub.live_api_token), body: {} });
  assert.equal(refunded.body.status, 'refunded');
  assert.ok(refunded.body.refunded_at_iso);

  const other = await call('GET', `/iugu/v1//invoices/${invoice.body.id}`, { headers: basic(MASTER) });
  assert.equal(other.status, 200, 'master reads sub-account invoices, double slash tolerated');
});

test('direct: card charge approved and refused by the last four digits', async () => {
  const tokenize = (number) => call('POST', '/iugu/v1/payment_token', {
    body: { account_id: sub.account_id, method: 'credit_card', test: true, data: { number, verification_value: '123', first_name: 'Ana', last_name: 'Silva', month: '12', year: '2035' } },
  });
  const customer = await call('POST', '/iugu/v1/customers', { headers: basic(sub.live_api_token), body: { email: 'ana@example.com', name: 'Ana' } });
  assert.equal(customer.status, 200);

  for (const [number, approved] of [['4111111111111111', true], ['4111111111110002', false]]) {
    const token = await tokenize(number);
    assert.equal(token.status, 200);
    const pm = await call('POST', `/iugu/v1/customers/${customer.body.id}/payment_methods`, {
      headers: basic(sub.live_api_token),
      body: { description: 'Cartão', token: token.body.id },
    });
    assert.equal(pm.status, 200);
    const invoice = await call('POST', '/iugu/v1/invoices', {
      headers: basic(sub.live_api_token),
      body: { email: 'ana@example.com', due_date: '2030-01-10', payable_with: 'credit_card', items: [{ description: 'Curso', quantity: 1, price_cents: 5000 }], customer_payment_method_id: pm.body.id, months: 2 },
    });
    assert.equal(invoice.status, 200);
    const charge = await call('POST', '/iugu/v1/charge', {
      headers: basic(sub.live_api_token),
      body: { invoice_id: invoice.body.id, customer_payment_method_id: pm.body.id, months: 2, order_id: 'other-order' },
    });
    assert.equal(charge.status, 200);
    assert.equal(charge.body.success, approved);
    assert.equal(charge.body.LR, approved ? '00' : '05');
    if (!approved) assert.equal(charge.body.errors, 'Transação negada');
  }

  const log = await call('GET', '/api/iugu-mock/requests?channel=direct&limit=200');
  const invoiceCreate = log.body.items.find((r) => r.route === 'invoices.create' && r.warnings.some((w) => w.includes('customer_payment_method_id')));
  assert.ok(invoiceCreate, 'legacy keys in /invoices flagged');
});

test('proxy: envelopes, allowlisted invoice and refusal envelope', async () => {
  const created = await proxy('POST', '/v1/marketplace/create_account', { master: true, raw: '{}' });
  assert.equal(created.status, 200);
  const segments = created.body.live_api_token.split('.');
  assert.equal(segments.length, 4);
  assert.equal(segments[0], 'v1');

  const noToken = await proxy('GET', `/v1/accounts/${created.body.account_id}`);
  assert.equal(noToken.status, 401);
  assert.equal(noToken.body.error.code, 'token_missing');

  const tampered = await proxy('GET', `/v1/accounts/${created.body.account_id}`, { envelope: `${created.body.live_api_token}x` });
  assert.equal(tampered.body.error.code, 'envelope_unauthentic');

  const account = await proxy('GET', `/v1/accounts/${created.body.account_id}`, { envelope: created.body.live_api_token });
  assert.equal(account.status, 200);
  assert.deepEqual(Object.keys(account.body).sort(), [
    'balance', 'can_receive?', 'created_at', 'credit_card_verified', 'id', 'is_verified?',
    'last_verification_request_status', 'name', 'payable_balance', 'updated_at',
  ]);

  const list = await proxy('POST', '/v1/invoices', { envelope: created.body.live_api_token, raw: '[]' });
  assert.equal(list.body.error.code, 'invalid_body');

  const withNull = await proxy('POST', '/v1/invoices', { envelope: created.body.live_api_token, body: { email: 'a@b.c', expires_in: null } });
  assert.equal(withNull.body.error.code, 'invalid_field');
  assert.equal(withNull.body.error.field, 'expires_in');

  const invoice = await proxy('POST', '/v1/invoices', {
    envelope: created.body.live_api_token,
    body: { email: 'a@b.c', due_date: '2030-01-10', payable_with: 'pix', items: [{ description: 'X', quantity: 1, price_cents: 1000 }], payer: { name: 'B', cpf_cnpj: '12345678909' } },
  });
  assert.equal(invoice.status, 200);
  await call('POST', `/api/iugu-mock/invoices/${invoice.body.id}/actions`, { body: { action: 'pay' } });
  await call('POST', `/api/iugu-mock/invoices/${invoice.body.id}/actions`, { body: { action: 'chargeback' } });

  const read = await proxy('GET', `/v1/invoices/${invoice.body.id}`, { envelope: created.body.live_api_token });
  assert.equal(read.body.status, 'chargeback');
  assert.equal(read.body.chargeback_at_iso, undefined, 'withheld by the allowlist');
  assert.equal(read.body.updated_at, undefined, 'withheld by the allowlist');

  const direct = await call('GET', `/iugu/v1/invoices/${invoice.body.id}`, { headers: basic(MASTER) });
  assert.ok(direct.body.chargeback_at_iso, 'present on the direct API');

  const missing = await proxy('GET', '/v1/invoices/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', { envelope: created.body.live_api_token });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'upstream_validation');
});

test('proxy: user token renewal and revoked token', async () => {
  const created = await proxy('POST', '/v1/marketplace/create_account', { master: true, raw: '{}' });
  const renewed = await proxy('POST', '/v1/profile/renew_access_token', { envelope: created.body.user_token });
  assert.equal(renewed.status, 200);
  assert.equal(renewed.body.account_id, created.body.account_id);
  assert.notEqual(renewed.body.new_user_token, created.body.user_token);

  const revoked = await proxy('POST', '/v1/profile/renew_access_token', { envelope: created.body.user_token });
  assert.equal(revoked.status, 400);
  assert.equal(revoked.body.error.code, 'upstream_validation');
  assert.equal(revoked.body.error.details, 'Unauthorized');
});

test('proxy: seal a legacy raw token', async () => {
  const sealed = await proxy('POST', '/v1/proxy/seal_token', { master: true, body: { account_id: sub.account_id, token: sub.live_api_token } });
  assert.equal(sealed.status, 200);
  assert.equal(sealed.body.account_id, sub.account_id);
  const read = await proxy('GET', `/v1/accounts/${sub.account_id}`, { envelope: sealed.body.token });
  assert.equal(read.status, 200);
});

test('fault injection: invoice read answers 500 on the direct API and upstream_error on the proxy', async () => {
  await call('PUT', '/api/iugu-mock/settings', { body: { fault: { route: 'invoices.get', kind: 'http_500', remaining: 2, channel: 'any' } } });
  const accounts = await call('GET', '/api/iugu-mock/invoices');
  const id = accounts.body.items[0].id;
  const direct = await call('GET', `/iugu/v1/invoices/${id}`, { headers: basic(MASTER) });
  assert.equal(direct.status, 500);
  const viaProxy = await proxy('GET', `/v1/invoices/${id}`, { master: true });
  assert.equal(viaProxy.status, 502);
  assert.equal(viaProxy.body.error.code, 'upstream_error');
  const back = await call('GET', `/iugu/v1/invoices/${id}`, { headers: basic(MASTER) });
  assert.equal(back.status, 200, 'fault consumed');
});

test('panel: accounts and invoices with the full data', async () => {
  const accounts = await call('GET', '/api/iugu-mock/accounts');
  assert.ok(accounts.body.items.length >= 3);
  assert.equal(accounts.body.items[0].master, true);
  const detail = await call('GET', `/api/iugu-mock/accounts/${sub.account_id}`);
  assert.equal(detail.body.stored.verification.data.price_range, '5000,00');
  assert.ok(detail.body.stored.verification.files.selfie.bytes > 0);
  assert.ok(detail.body.sealed.live_api_token.startsWith('v1.'));
  const invoices = await call('GET', `/api/iugu-mock/invoices?account_id=${sub.account_id}`);
  assert.ok(invoices.body.items.length >= 3);
  const invoice = await call('GET', `/api/iugu-mock/invoices/${invoices.body.items[0].id}`);
  assert.ok(invoice.body.iugu.secure_url);
  assert.ok(Array.isArray(invoice.body.requests));
  const page = await fetch(invoice.body.iugu.secure_url.replace('http://localhost:8115', base));
  assert.equal(page.status, 200);
});
