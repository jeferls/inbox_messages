import { IUGU_MOCK } from '../../config/env.js';
import { dispatch, matchRoute, ensureMasterAccount, resolveToken } from './api.js';
import { sealToken, unsealToken, isIuguId } from './ids.js';

/**
 * The sec-proxy protocol as greenn-back (domain/Seller/ACL/Iugu/IuguSecProxyProvider)
 * and the gateway (Domain/Iugu/ACL/IuguSecProxyProvider) speak it:
 *   - every call carries x-greenn-token;
 *   - x-iugu-master: true (master account) or x-iugu-token: <envelope> (sub-account);
 *   - tokens leave the proxy only as v1.<kid>.<payload>.<mac> envelopes;
 *   - bodies are allowlisted, responses rebuilt from allowlists;
 *   - refusals answer { error: { code, message, field?, details? } }.
 * The allowlists mirror the clients' DTOs, since the proxy's own schemas are not in this repo.
 */

const STATUS = {
  token_missing: 401,
  envelope_unauthentic: 401,
  envelope_malformed: 400,
  invalid_account_id: 422,
  invalid_body: 422,
  no_fields: 422,
  field_not_allowed: 422,
  invalid_field: 422,
  malformed_body: 400,
  route_not_allowed: 404,
  token_seal_failed: 502,
  token_unavailable: 502,
  upstream_error: 502,
  upstream_invalid: 502,
  upstream_unavailable: 504,
};

const MAX_SPLITS = 50;

function refuse(code, message, { field, details, status } = {}) {
  const error = { code, message };
  if (field) error.field = field;
  if (details !== undefined) error.details = details;
  return { status: status ?? STATUS[code], body: { error } };
}

function pick(source, keys) {
  const out = {};
  for (const key of keys) if (source && source[key] !== undefined) out[key] = source[key];
  return out;
}

// ─── Response allowlists ──────────────────────────────────────────────────────

const ACCOUNT_KEYS = [
  'id', 'name', 'created_at', 'updated_at', 'can_receive?', 'is_verified?',
  'last_verification_request_status', 'credit_card_verified', 'balance', 'payable_balance',
];

const INVOICE_KEYS = [
  'id', 'status', 'due_date', 'created_at_iso', 'total_cents', 'paid_cents', 'currency', 'payable_with',
  'secure_url', 'split_id', 'paid_at', 'total_paid_cents', 'taxes_paid_cents', 'advance_fee_cents',
];

const CONFIGURATION_KEYS = [
  'account_id', 'per_day_interest', 'fines', 'late_payment_fine', 'auto_advance', 'auto_advance_type',
  'auto_advance_option', 'bank_slip', 'credit_card', 'payment_email_notification',
  'payment_email_notification_receiver', 'early_payment_discount', 'early_payment_discounts',
  'disabled_withdraw', 'customer_minimum_balance_cents', 'auto_withdraw',
];

const CUSTOMER_KEYS = [
  'id', 'email', 'name', 'phone_prefix', 'phone', 'zip_code', 'street', 'number', 'district', 'city', 'state',
  'complement', 'created_at',
];

/** Withholds refunded_at_iso, chargeback_at_iso, protested_at_iso and the invoice's own updated_at. */
export function invoiceAllowlist(invoice) {
  const out = pick(invoice, INVOICE_KEYS);
  if (invoice.credit_card_transaction) out.credit_card_transaction = pick(invoice.credit_card_transaction, ['updated_at']);
  if (invoice.pix) out.pix = pick(invoice.pix, ['qrcode', 'qrcode_text']);
  if (invoice.bank_slip) out.bank_slip = pick(invoice.bank_slip, ['digitable_line', 'barcode_data', 'bank_slip_pdf_url']);
  if (Array.isArray(invoice.items)) out.items = invoice.items.map((i) => pick(i, ['description', 'quantity', 'price_cents']));
  if (Array.isArray(invoice.split_rules)) {
    out.split_rules = invoice.split_rules.map((r) => pick(r, ['recipient_account_id', 'cents', 'permit_aggregated']));
  }
  return out;
}

const shapes = {
  createAccount: (b) => ({
    account_id: b.account_id,
    name: b.name,
    live_api_token: sealToken(b.live_api_token),
    test_api_token: sealToken(b.test_api_token),
    user_token: sealToken(b.user_token),
  }),
  account: (b) => pick(b, ACCOUNT_KEYS),
  configuration: (b, meta) => ({ ...pick(b, CONFIGURATION_KEYS), account_id: meta.accountId }),
  verification: (b) => pick(b, ['account_id', 'id', 'created_at']),
  documents: (b) => pick(b, ['items']),
  domicile: (b, meta) => ({ account_id: meta.accountId, success: b.success }),
  deactivation: (b) => pick(b, ['success', 'message']),
  invoice: (b) => invoiceAllowlist(b),
  invoicePage: (b) => ({ items: (b.items ?? []).map(invoiceAllowlist), totalItems: b.totalItems ?? null }),
  apiToken: (b) => ({ ...pick(b, ['id', 'api_type', 'description', 'created_at', 'account_id']), token: sealToken(b.token) }),
  apiTokenListing: (b) => {
    const accounts = {};
    for (const [accountId, entry] of Object.entries(b.accounts ?? {})) {
      const safe = {};
      for (const [field, value] of Object.entries(entry ?? {})) {
        if (field === 'token' || field.endsWith('_token')) safe[field] = sealToken(value);
        else if (field.endsWith('_status') || ['id', 'api_type', 'description', 'created_at'].includes(field)) safe[field] = value;
      }
      accounts[accountId] = safe;
    }
    return { referrer_id: b.referrer_id ?? null, accounts };
  },
  renewedUserToken: (b) => ({ new_user_token: sealToken(b.new_user_token), account_id: b.account_id }),
  charge: (b) => pick(b, ['message', 'status', 'info_message', 'success', 'invoice_id', 'LR', 'brand']),
  customer: (b) => pick(b, CUSTOMER_KEYS),
  paymentToken: (b) => pick(b, ['id', 'method']),
  paymentMethod: (b) => ({
    ...pick(b, ['id', 'description', 'item_type', 'customer_id']),
    data: pick(b.data ?? {}, ['brand', 'display_number', 'year', 'month']),
  }),
};

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * mode: master | sub | sub_or_master | none. keys: allowed body keys (null = any).
 * body: required (default for writes) | empty | none.
 */
const PROXY_ROUTES = [
  { method: 'POST', pattern: '/v1/marketplace/create_account', mode: 'master', keys: ['name'], body: 'empty', shape: shapes.createAccount },
  { method: 'POST', pattern: '/v1/marketplace/deactivate', mode: 'master', keys: ['account_id'], shape: shapes.deactivation },
  { method: 'POST', pattern: '/v1/accounts/configuration', mode: 'sub', keys: CONFIGURATION_KEYS.filter((k) => k !== 'account_id'), shape: shapes.configuration },
  { method: 'POST', pattern: '/v1/accounts/:id/request_verification', mode: 'sub', keys: ['data', 'files'], shape: shapes.verification },
  { method: 'PUT', pattern: '/v1/account/documents', mode: 'sub', keys: ['files'], shape: shapes.documents },
  { method: 'GET', pattern: '/v1/accounts/:id', mode: 'sub', shape: shapes.account },
  { method: 'PUT', pattern: '/v1/accounts/:id', mode: 'sub', keys: ['id', 'website'], shape: shapes.account },
  { method: 'POST', pattern: '/v1/bank_verification', mode: 'sub', keys: ['bank', 'account_type', 'account', 'agency', 'automatic_validation'], shape: shapes.domicile },
  { method: 'POST', pattern: '/v1/profile/renew_access_token', mode: 'sub', body: 'none', shape: shapes.renewedUserToken },
  { method: 'POST', pattern: '/v1/proxy/seal_token', mode: 'master', keys: ['account_id', 'token'], local: 'seal' },
  { method: 'GET', pattern: '/v1/invoices', mode: 'sub', query: ['limit', 'start', 'created_at_from'], shape: shapes.invoicePage },
  { method: 'POST', pattern: '/v1/invoices', mode: 'sub', keys: ['email', 'order_id', 'payable_with', 'items', 'payer', 'due_date', 'expires_in', 'splits'], shape: shapes.invoice },
  { method: 'GET', pattern: '/v1/invoices/:id', mode: 'sub_or_master', shape: shapes.invoice },
  { method: 'PUT', pattern: '/v1/invoices/:id/cancel', mode: 'sub', body: 'none', shape: shapes.invoice },
  { method: 'POST', pattern: '/v1/invoices/:id/refund', mode: 'sub', keys: [], body: 'empty', shape: shapes.invoice },
  { method: 'POST', pattern: '/v1/charge', mode: 'sub', keys: ['invoice_id', 'email', 'order_id', 'customer_payment_method_id', 'customer_id', 'token', 'months', 'payer'], shape: shapes.charge },
  { method: 'POST', pattern: '/v1/customers', mode: 'sub', keys: ['email', 'name', 'phone_prefix', 'phone', 'cpf_cnpj', 'zip_code', 'street', 'number', 'district', 'city', 'state', 'complement', 'notes'], shape: shapes.customer },
  { method: 'POST', pattern: '/v1/customers/:id/payment_methods', mode: 'sub', keys: ['description', 'token', 'set_as_default'], shape: shapes.paymentMethod },
  { method: 'POST', pattern: '/v1/payment_token', mode: 'none', keys: ['account_id', 'method', 'test', 'data'], shape: shapes.paymentToken },
  { method: 'POST', pattern: '/v1/:account_id/api_tokens', mode: 'master', keys: ['api_type', 'description'], shape: shapes.apiToken },
  { method: 'GET', pattern: '/v1/:account_id/api_tokens', mode: 'master', shape: shapes.apiTokenListing },
];

function findNull(value, path = '') {
  if (value === null) return path || '(body)';
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const found = findNull(value[i], `${path}[${i}]`);
      if (found) return found;
    }
  } else if (typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      const found = findNull(inner, path ? `${path}.${key}` : key);
      if (found) return found;
    }
  }
  return null;
}

function parseBody(route, rawBody) {
  const text = typeof rawBody === 'string' ? rawBody.trim() : '';
  if (route.method === 'GET' || route.body === 'none') return { body: null };
  if (text === '') {
    return route.body === 'empty' ? { body: {} } : { error: refuse('invalid_body', 'Corpo JSON obrigatório') };
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { error: refuse('malformed_body', 'Corpo não é JSON válido') };
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: refuse('invalid_body', 'O corpo deve ser um objeto JSON (nunca [])') };
  }
  const nullField = findNull(body);
  if (nullField) return { error: refuse('invalid_field', 'null não é aceito em campos tipados', { field: nullField }) };
  if (route.keys) {
    const extra = Object.keys(body).find((key) => !route.keys.includes(key));
    if (extra) return { error: refuse('field_not_allowed', `Campo não permitido nesta rota: ${extra}`, { field: extra }) };
  }
  if (route.body !== 'empty' && route.keys && route.keys.length && Object.keys(body).length === 0) {
    return { error: refuse('no_fields', 'Nenhum campo enviado') };
  }
  if (Array.isArray(body.splits)) {
    if (body.splits.length > MAX_SPLITS) return { error: refuse('invalid_field', `Máximo de ${MAX_SPLITS} splits`, { field: 'splits' }) };
    if (body.splits.some((s) => !(Number(s.cents) > 0))) return { error: refuse('invalid_field', 'split com cents <= 0', { field: 'splits.cents' }) };
  }
  return { body };
}

async function resolveMode(route, headers) {
  const master = String(headers['x-iugu-master'] ?? '').toLowerCase() === 'true';
  const envelope = headers['x-iugu-token'];
  if (route.mode === 'none') return { token: null, label: 'none' };
  if (master && route.mode !== 'sub') {
    const account = await ensureMasterAccount();
    return { token: account.live_api_token, label: 'master' };
  }
  if (!envelope) {
    return { error: refuse('token_missing', route.mode === 'master' ? 'Rota exige x-iugu-master: true' : 'Rota exige x-iugu-token') };
  }
  if (route.mode === 'master') return { error: refuse('token_missing', 'Rota exige x-iugu-master: true') };
  const unsealed = unsealToken(envelope);
  if (!unsealed.ok) return { error: refuse(unsealed.code, 'Envelope de token inválido') };
  return { token: unsealed.token, label: 'envelope' };
}

async function sealLocally(body) {
  const accountId = String(body.account_id ?? '');
  const token = String(body.token ?? '');
  if (!isIuguId(accountId)) return refuse('invalid_account_id', 'account_id inválido', { field: 'account_id' });
  if (!token) return refuse('invalid_field', 'token é obrigatório', { field: 'token' });
  const resolved = await resolveToken(token, { lenient: false });
  if (!resolved || resolved.revoked || resolved.account.id !== accountId) {
    return refuse('upstream_validation', 'Token não pertence à conta', { status: 401, details: 'Unauthorized' });
  }
  return { status: 200, body: { token: sealToken(token), account_id: accountId } };
}

/**
 * @returns {Promise<{ status: number, body: any, route: string | null, auth: string, accountId?: string, invoiceId?: string, warnings: string[] }>}
 */
export async function handleProxy({ method, path, query = {}, rawBody, headers }) {
  const warnings = [];
  if (headers['x-greenn-token'] !== IUGU_MOCK.proxyGreennToken) {
    return { ...refuse('token_missing', 'x-greenn-token ausente ou inválido', { status: 401 }), route: null, auth: 'none', warnings };
  }
  const match = matchRoute(PROXY_ROUTES, method, path);
  if (!match) return { ...refuse('route_not_allowed', `${method} ${path} não é exposta pelo proxy`), route: null, auth: 'none', warnings };
  const { route, params } = match;

  for (const key of ['id', 'account_id']) {
    if (params[key] !== undefined && !isIuguId(params[key])) {
      return { ...refuse('invalid_account_id', `${key} inválido no caminho`, { field: key }), route: route.pattern, auth: 'none', warnings };
    }
  }
  if (route.query) {
    const extra = Object.keys(query).find((key) => !route.query.includes(key));
    if (extra) return { ...refuse('field_not_allowed', `Query não permitida: ${extra}`, { field: extra }), route: route.pattern, auth: 'none', warnings };
  }

  const parsed = parseBody(route, rawBody);
  if (parsed.error) return { ...parsed.error, route: route.pattern, auth: 'none', warnings };

  const mode = await resolveMode(route, headers);
  if (mode.error) return { ...mode.error, route: route.pattern, auth: 'none', warnings };

  if (route.local === 'seal') {
    return { ...(await sealLocally(parsed.body)), route: route.pattern, auth: mode.label, warnings };
  }

  const upstream = await dispatch({
    channel: 'proxy',
    method,
    path: path.replace(/^\/v1/, ''),
    query,
    body: parsed.body,
    token: mode.token,
    headers,
  });
  warnings.push(...upstream.warnings, `upstream ${upstream.status} (${upstream.route ?? 'sem rota'})`);
  const meta = { route: route.pattern, auth: mode.label, accountId: upstream.accountId, invoiceId: upstream.invoiceId, warnings };

  if (upstream.timedOut) return { ...refuse('upstream_unavailable', 'A Iugu não respondeu a tempo'), ...meta };
  if (upstream.status >= 500) return { ...refuse('upstream_error', `A Iugu respondeu HTTP ${upstream.status}`), ...meta };
  if (upstream.status >= 400) {
    const errors = upstream.body?.errors;
    return {
      ...refuse('upstream_validation', typeof errors === 'string' ? errors : 'A Iugu recusou a requisição', {
        status: upstream.status,
        details: errors,
      }),
      ...meta,
    };
  }
  if (!upstream.body || typeof upstream.body !== 'object' || Array.isArray(upstream.body)) {
    return { ...refuse('upstream_invalid', 'A Iugu respondeu um corpo que o proxy não reconhece'), ...meta };
  }
  return { status: upstream.status, body: route.shape(upstream.body, meta), ...meta };
}
