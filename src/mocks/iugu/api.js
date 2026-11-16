import { iuguMockGet, iuguMockPut, iuguMockList } from '../../db/index.js';
import { IUGU_MOCK } from '../../config/env.js';
import {
  iuguId,
  iuguApiToken,
  secureId,
  randomDigits,
  nowIso,
  toIugu,
  isoDate,
  brl,
  bankSlipNumbers,
  pixCopyPaste,
} from './ids.js';
import { CARD_SCENARIOS, CARD_BY_LAST4, getSettings, takeFault } from './state.js';
import { queueInvoiceWebhook } from './webhooks.js';

export const KIND = {
  account: 'account',
  invoice: 'invoice',
  customer: 'customer',
  paymentMethod: 'payment_method',
  paymentToken: 'payment_token',
};

const DAY_MS = 24 * 3600 * 1000;
const PRICE_RANGES = ['Até R$ 100,00', 'Entre R$ 100,00 e R$ 500,00', 'Mais que R$ 500,00'];
const PAYABLE_WITH = ['all', 'credit_card', 'bank_slip', 'pix'];
const INVOICE_KEYS = [
  'email', 'due_date', 'items', 'payable_with', 'payer', 'splits', 'order_id', 'expires_in', 'return_url',
  'notification_url', 'cc_emails', 'ensure_workday_due_date', 'customer_id', 'discount_cents', 'fines',
  'late_payment_fine', 'per_day_interest', 'ignore_due_email', 'ignore_canceled_email', 'custom_variables',
  'early_payment_discount', 'early_payment_discounts', 'max_installments_value', 'external_reference',
  'credit_card', 'bank_slip_extra_days', 'payer_name', 'api_token',
];
const CHARGE_KEYS = [
  'method', 'token', 'customer_payment_method_id', 'restrict_payment_method', 'invoice_id', 'email',
  'customer_id', 'order_id', 'months', 'items', 'discount_cents', 'bank_slip_extra_days', 'keep_dunning',
  'soft_descriptor_light', 'payer', 'api_token',
];

const ok = (body, status = 200) => ({ status, body });
const fail = (status, errors) => ({ status, body: { errors } });
const notFound = (what) => fail(404, `${what} Not Found`);
const blank = (field) => fail(422, { [field]: ['não pode ficar em branco'] });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isBlank = (value) => value === undefined || value === null || String(value).trim() === '';

// ─── Accounts ─────────────────────────────────────────────────────────────────

export async function ensureMasterAccount() {
  const existing = await iuguMockGet(KIND.account, IUGU_MOCK.masterAccountId);
  if (existing) return existing;
  return iuguMockPut(KIND.account, IUGU_MOCK.masterAccountId, IUGU_MOCK.masterAccountId, {
    ...newAccount('Conta mestre (mock)'),
    id: IUGU_MOCK.masterAccountId,
    master: true,
    is_verified: true,
    can_receive: true,
    last_verification_request_status: 'accepted',
  });
}

export function newAccount(name, parentId = null) {
  const id = iuguId();
  return {
    id,
    name: name || id,
    master: false,
    parent_id: parentId,
    live_api_token: iuguApiToken(),
    test_api_token: iuguApiToken(),
    user_token: iuguApiToken(),
    revoked_user_tokens: [],
    api_tokens: [],
    is_verified: false,
    can_receive: false,
    last_verification_request_status: null,
    verification: null,
    requested_documents: [],
    documents: [],
    configuration: {},
    bank_accounts: [],
    website: null,
    balance_cents: 0,
    active: true,
    deactivated_at: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
}

async function saveAccount(account) {
  account.updated_at = nowIso();
  return iuguMockPut(KIND.account, account.id, account.id, account);
}

export async function listAccounts() {
  return iuguMockList(KIND.account, { limit: 10000 });
}

/**
 * Resolves a raw token to the account it belongs to.
 * @returns {Promise<null | { account, tier: string, revoked?: boolean }>}
 */
export async function resolveToken(token, { lenient } = {}) {
  const value = String(token ?? '').trim();
  if (!value) return null;
  const accounts = await listAccounts();
  for (const account of accounts) {
    if (account.live_api_token === value) return { account, tier: account.master ? 'master' : 'live' };
    if (account.test_api_token === value) return { account, tier: 'test' };
    if (account.user_token === value) return { account, tier: account.master ? 'master' : 'user' };
    const apiToken = (account.api_tokens ?? []).find((t) => t.token === value);
    if (apiToken) return { account, tier: account.master ? 'master' : apiToken.api_type.toLowerCase() };
    if ((account.revoked_user_tokens ?? []).includes(value)) return { account, tier: 'user', revoked: true };
  }
  if (lenient) return { account: await ensureMasterAccount(), tier: 'master', unknownToken: true };
  return null;
}

function canSee(auth, accountId) {
  return auth.tier === 'master' || auth.account.id === accountId;
}

export function accountView(account) {
  const website = account.website ?? null;
  return {
    id: account.id,
    name: account.name,
    created_at: account.created_at,
    updated_at: account.updated_at,
    'can_receive?': Boolean(account.can_receive),
    'is_verified?': Boolean(account.is_verified),
    last_verification_request_status: account.last_verification_request_status,
    last_verification_request_data: account.verification?.data ?? null,
    last_verification_request_feedback: account.verification?.feedback ?? null,
    change_plan_type: 1,
    subscriptions_trial_period: 0,
    disable_emails: false,
    last_withdraw: null,
    reply_to: null,
    webapp_on_test_mode: false,
    marketplace: Boolean(account.master),
    auto_withdraw: Boolean(account.configuration?.auto_withdraw),
    balance: brl(account.balance_cents),
    protected_balance: brl(0),
    payable_balance: brl(account.balance_cents),
    receivable_balance: brl(0),
    commission_balance: brl(0),
    volume_last_month: brl(0),
    volume_this_month: brl(0),
    taxes_paid_last_month: brl(0),
    taxes_paid_this_month: brl(0),
    custom_logo_url: null,
    custom_logo_small_url: null,
    credit_card_verified: Boolean(account.is_verified),
    is_active: account.active !== false,
    informations: website ? [{ key: 'website', value: website }] : [],
    configuration: account.configuration ?? {},
  };
}

async function createAccount(ctx) {
  const account = newAccount(ctx.body?.name, ctx.auth.account.id);
  await saveAccount(account);
  return ok({
    account_id: account.id,
    name: account.name,
    live_api_token: account.live_api_token,
    test_api_token: account.test_api_token,
    user_token: account.user_token,
  });
}

async function configureAccount(ctx) {
  const account = ctx.auth.account;
  const body = ctx.body ?? {};
  const maxInstallments = body.credit_card?.max_installments;
  if (maxInstallments !== undefined && (Number(maxInstallments) < 1 || Number(maxInstallments) > 18)) {
    return fail(422, { 'credit_card.max_installments': ['deve estar entre 1 e 18'] });
  }
  if (body.auto_advance === true && isBlank(body.auto_advance_type)) {
    return fail(422, { auto_advance_type: ['é obrigatório quando auto_advance é true'] });
  }
  const { api_token, ...configuration } = body;
  account.configuration = { ...(account.configuration ?? {}), ...configuration };
  await saveAccount(account);
  return ok({ account_id: account.id, ...account.configuration });
}

function describeFiles(files) {
  const described = {};
  for (const [key, value] of Object.entries(files ?? {})) {
    const text = String(value ?? '');
    const mime = text.match(/^data:([^;]+);base64,/)?.[1] ?? null;
    described[key] = { bytes: Math.floor((text.replace(/^data:[^,]+,/, '').length * 3) / 4), mime };
  }
  return described;
}

async function requestVerification(ctx) {
  const account = await iuguMockGet(KIND.account, ctx.params.id);
  if (!account) return notFound('Account');
  if (!canSee(ctx.auth, account.id)) return fail(401, 'Unauthorized');
  if (Date.now() - Date.parse(account.created_at) > DAY_MS) {
    return fail(400, 'Só é possível verificar uma subconta em até 24h após sua criação');
  }
  if (account.verification) {
    return fail(400, 'Já existe uma solicitação de verificação para esta conta');
  }
  const body = ctx.body ?? {};
  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) return fail(400, 'Data é obrigatório');
  const files = body.files;
  if (!files || typeof files !== 'object' || Array.isArray(files) || Object.keys(files).length === 0) {
    if (body.data.files) ctx.warnings.push('files veio dentro de data: a Iugu exige files como irmão de data');
    return fail(400, 'Files é obrigatório');
  }

  const errors = {};
  const hasIdentification = files.identification || (files.identification_front && files.identification_back);
  if (!hasIdentification) errors.identification = ['é obrigatório (identification ou identification_front + identification_back)'];
  if (!files.selfie) errors.selfie = ['é obrigatório'];

  const docRules = [];
  if (!files.address_proof) docRules.push(['files.address_proof', 'obrigatório desde o changelog 03/12/2024']);
  if (body.data.price_range && !PRICE_RANGES.includes(body.data.price_range)) {
    docRules.push(['data.price_range', `deve ser um de: ${PRICE_RANGES.join(' | ')}`]);
  }
  if (body.data.estimated_revenue && String(body.data.estimated_revenue).includes(',')) {
    docRules.push(['data.estimated_revenue', 'a doc usa ponto decimal (ex.: "100.00")']);
  }
  if (body.data.number !== undefined && typeof body.data.number !== 'string') {
    docRules.push(['data.number', 'a doc tipa como string']);
  }
  if (body.data.cep && !/^\d{5}-\d{3}$/.test(String(body.data.cep))) docRules.push(['data.cep', 'formato 00000-000']);
  if (body.data.website && !/^https?:\/\//.test(String(body.data.website))) {
    docRules.push(['data.website', 'deve começar com http:// ou https://']);
  }
  if (body.data.account_type && !['Corrente', 'Poupança', 'Pagamento'].includes(body.data.account_type)) {
    docRules.push(['data.account_type', 'deve ser Corrente, Poupança ou Pagamento']);
  }
  if (ctx.auth.tier !== 'user' && ctx.auth.tier !== 'master') {
    docRules.push(['token', `a doc pede o user_token; a chamada usou o token ${ctx.auth.tier}`]);
  }
  for (const [field, message] of docRules) {
    if (ctx.settings.strict) errors[field] = [message];
    else ctx.warnings.push(`${field}: ${message}`);
  }
  if (Object.keys(errors).length) return fail(422, errors);

  const { files: _nested, ...data } = body.data;
  const verificationId = iuguId();
  account.verification = {
    id: verificationId,
    data,
    files: describeFiles(files),
    requested_at: nowIso(),
    token_tier: ctx.auth.tier,
    feedback: null,
  };
  account.last_verification_request_status = 'pending';
  await saveAccount(account);

  const outcome = ctx.settings.verificationOutcome === 'auto' ? 'accepted' : ctx.settings.verificationOutcome;
  if (outcome === 'accepted' || outcome === 'rejected') {
    setTimeout(() => setVerificationOutcome(account.id, outcome).catch(() => {}), 3000);
  }

  return ok({ id: verificationId, data, account_id: account.id, created_at: toIugu() });
}

/** Panel action and auto outcome: accepted makes the account able to receive. */
export async function setVerificationOutcome(accountId, status, { feedback = null, requestedDocuments = [] } = {}) {
  const account = await iuguMockGet(KIND.account, accountId);
  if (!account) return null;
  account.last_verification_request_status = status;
  account.is_verified = status === 'accepted';
  account.can_receive = status === 'accepted';
  if (account.verification) account.verification.feedback = feedback;
  account.requested_documents = status === 'accepted' ? [] : requestedDocuments;
  return saveAccount(account);
}

async function resendDocuments(ctx) {
  const account = ctx.auth.account;
  const files = ctx.body?.files;
  if (!files || typeof files !== 'object' || Array.isArray(files) || Object.keys(files).length === 0) {
    return fail(400, 'Files é obrigatório');
  }
  const requested = account.requested_documents ?? [];
  const notRequested = Object.keys(files).filter((key) => !requested.includes(key));
  if (notRequested.length) {
    const message = `arquivos não pedidos pela análise: ${notRequested.join(', ')}`;
    if (ctx.settings.strict) return fail(422, { files: [message] });
    ctx.warnings.push(message);
  }
  const now = toIugu();
  const items = Object.keys(files).map((kind) => ({ kind, status: 'pending_manual_analysis', created_at: now, updated_at: now }));
  account.documents = [...(account.documents ?? []).filter((d) => !files[d.kind]), ...items];
  account.documents_files = { ...(account.documents_files ?? {}), ...describeFiles(files) };
  await saveAccount(account);
  return ok({ items });
}

async function listDocuments(ctx) {
  return ok({ items: ctx.auth.account.documents ?? [] });
}

async function getAccount(ctx) {
  const account = await iuguMockGet(KIND.account, ctx.params.id);
  if (!account) return notFound('Account');
  if (!canSee(ctx.auth, account.id)) return fail(401, 'Unauthorized');
  return ok(accountView(account));
}

async function updateAccount(ctx) {
  const account = await iuguMockGet(KIND.account, ctx.params.id);
  if (!account) return notFound('Account');
  if (!canSee(ctx.auth, account.id)) return fail(401, 'Unauthorized');
  if (!account.is_verified) {
    if (ctx.settings.strict) return fail(400, 'Conta não verificada');
    ctx.warnings.push('a doc só permite atualizar subconta já verificada');
  }
  const { api_token, ...body } = ctx.body ?? {};
  const outsideSchema = Object.keys(body).filter((key) => !['website', 'name'].includes(key));
  if (outsideSchema.length) ctx.warnings.push(`campos fora do schema de PUT /accounts/{id}: ${outsideSchema.join(', ')}`);
  if (body.website !== undefined) account.website = body.website;
  if (body.name !== undefined) account.name = body.name;
  account.extra_info = { ...(account.extra_info ?? {}), ...body };
  return ok(accountView(await saveAccount(account)));
}

async function bankVerification(ctx) {
  const account = ctx.auth.account;
  const body = ctx.body ?? {};
  for (const field of ['bank', 'agency', 'account', 'account_type']) {
    if (isBlank(body[field])) return blank(field);
  }
  if (!['cc', 'cp', 'cpg'].includes(body.account_type)) return fail(422, { account_type: ['is invalid'] });
  const active = (account.bank_accounts ?? []).find((b) => b.active);
  const same = active
    && String(active.bank) === String(body.bank)
    && String(active.agency) === String(body.agency)
    && String(active.account) === String(body.account)
    && active.account_type === body.account_type;
  if (same) return fail(400, { base: ['Account is already using this bank address'] });
  account.bank_accounts = (account.bank_accounts ?? []).map((b) => ({ ...b, active: false }));
  account.bank_accounts.push({
    id: iuguId(),
    bank: String(body.bank),
    agency: String(body.agency),
    account: String(body.account),
    account_type: body.account_type,
    automatic_validation: body.automatic_validation ?? true,
    status: 'accepted',
    active: true,
    created_at: nowIso(),
  });
  await saveAccount(account);
  return ok({ success: true });
}

async function deactivateAccount(ctx) {
  const accountId = ctx.body?.account_id;
  if (isBlank(accountId)) return fail(400, 'account_id é obrigatório');
  const account = await iuguMockGet(KIND.account, accountId);
  if (!account) return notFound('Account');
  if (!canSee(ctx.auth, account.id)) return fail(401, 'Unauthorized');
  if (account.active === false) return fail(400, 'A conta já está desativada');
  if (Number(account.balance_cents) > 0) return fail(400, 'A conta possui saldo e não pode ser desativada');
  account.active = false;
  account.is_verified = false;
  account.can_receive = false;
  account.last_verification_request_status = 'unverified';
  account.deactivated_at = nowIso();
  await saveAccount(account);
  const invoices = await iuguMockList(KIND.invoice, { accountId: account.id, limit: 10000 });
  for (const invoice of invoices.filter((i) => ['pending', 'in_analysis'].includes(i.status))) {
    await transition(invoice, 'canceled', { canceled_at: toIugu() });
  }
  return ok({ success: true, message: 'Conta em processo de desativação' });
}

async function createApiToken(ctx) {
  const account = await iuguMockGet(KIND.account, ctx.params.account_id);
  if (!account) return notFound('Account');
  const rawType = String(ctx.body?.api_type ?? '');
  const apiType = rawType.toUpperCase();
  if (!['LIVE', 'TEST'].includes(apiType)) return fail(422, { api_type: ['is invalid'] });
  if (rawType !== apiType) {
    if (ctx.settings.strict) return fail(422, { api_type: ['deve ser LIVE ou TEST em maiúsculas'] });
    ctx.warnings.push('api_type deve ir em maiúsculas (LIVE/TEST)');
  }
  const entry = {
    id: iuguId(),
    token: iuguApiToken(),
    api_type: apiType,
    description: ctx.body?.description ?? null,
    created_at: toIugu(),
    status: 'active',
  };
  account.api_tokens = [...(account.api_tokens ?? []), entry];
  // The listing shows the latest token of each type; older ones stay valid (no automatic revocation).
  if (apiType === 'LIVE') account.live_api_token = entry.token;
  else account.test_api_token = entry.token;
  await saveAccount(account);
  return ok({ ...entry, account_id: account.id });
}

async function listApiTokens(ctx) {
  const account = await iuguMockGet(KIND.account, ctx.params.account_id);
  if (!account) return notFound('Account');
  return ok({
    referrer_id: (await ensureMasterAccount()).id,
    accounts: {
      [account.id]: {
        live_token: account.live_api_token,
        live_token_status: 'active',
        test_token: account.test_api_token,
        test_token_status: 'active',
        user_token: account.user_token,
      },
    },
  });
}

async function renewUserToken(ctx) {
  if (ctx.auth.revoked || ctx.auth.unknownToken || ctx.auth.tier !== 'user') return fail(400, 'Unauthorized');
  const account = ctx.auth.account;
  account.revoked_user_tokens = [...(account.revoked_user_tokens ?? []), account.user_token];
  account.user_token = iuguApiToken();
  await saveAccount(account);
  return ok({ new_user_token: account.user_token, account_id: account.id });
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

function normalizePayableWith(value, warnings) {
  if (value === undefined || value === null) return ['all'];
  if (!Array.isArray(value)) {
    warnings.push(`payable_with veio como ${typeof value}; o schema da doc pede array`);
    return [String(value)];
  }
  return value.map(String);
}

function allows(invoice, method) {
  return invoice.payable_with.includes('all') || invoice.payable_with.includes(method);
}

async function buildInvoice(ctx, body, { createdByCharge = false } = {}) {
  const { settings, warnings } = ctx;
  const account = ctx.auth.account;
  const errors = {};

  if (isBlank(body.email)) errors.email = ['não pode ficar em branco'];
  if (isBlank(body.due_date)) errors.due_date = ['não pode ficar em branco'];
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.due_date))) {
    const message = `due_date "${body.due_date}" fora do formato AAAA-MM-DD da doc`;
    if (settings.strict) errors.due_date = [message];
    else warnings.push(message);
  }
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) errors.items = ['não pode ficar em branco'];
  for (const item of items) {
    if (!Number.isInteger(Number(item.price_cents)) || Number(item.price_cents) < 100) {
      errors['items.price_cents'] = ['deve ser maior ou igual a 100'];
    }
    if (isBlank(item.description)) errors['items.description'] = ['não pode ficar em branco'];
  }
  const payableWith = normalizePayableWith(body.payable_with, warnings);
  if (payableWith.some((m) => !PAYABLE_WITH.includes(m))) errors.payable_with = ['is invalid'];
  if (body.expires_in !== undefined && (Number(body.expires_in) < 0 || Number(body.expires_in) > 120)) {
    errors.expires_in = ['deve estar entre 0 e 120'];
  }

  const payer = body.payer ?? null;
  const needsPayer = payableWith.includes('bank_slip') || payableWith.includes('all');
  if (needsPayer && (isBlank(payer?.cpf_cnpj) || isBlank(payer?.name))) {
    errors['payer.cpf_cnpj'] = ['payer com cpf_cnpj e name é obrigatório para boleto'];
  }
  if (payableWith.includes('pix') && isBlank(payer?.cpf_cnpj)) {
    const message = 'a doc exige payer para Pix; cpf_cnpj ausente';
    if (settings.strict) errors['payer.cpf_cnpj'] = [message];
    else warnings.push(message);
  }
  if (payer?.name && String(payer.name).length > 140) errors['payer.name'] = ['máximo de 140 caracteres'];
  if (payer?.phone && /^\+/.test(String(payer.phone))) {
    const message = 'payer.phone em E.164; a doc espera phone_prefix (DDD) + phone separados';
    if (settings.strict) errors['payer.phone'] = [message];
    else warnings.push(message);
  }

  const foreign = Object.keys(body).filter((key) => !INVOICE_KEYS.includes(key));
  if (foreign.length) warnings.push(`campos que não existem em POST /invoices: ${foreign.join(', ')}`);

  const totalCents = items.reduce((sum, item) => sum + Number(item.price_cents || 0) * Number(item.quantity || 1), 0);

  // Splits
  const splitRules = [];
  let splitIgnored = false;
  for (const split of Array.isArray(body.splits) ? body.splits : []) {
    const recipient = await iuguMockGet(KIND.account, String(split.recipient_account_id ?? ''));
    if (!recipient) {
      errors.splits = [`recipient_account_id ${split.recipient_account_id} não é uma conta iugu`];
      continue;
    }
    if (recipient.id === account.id) {
      const message = `a conta emissora (${account.id}) está entre os recebedores do split; a doc proíbe`;
      if (settings.strict) errors.splits = [message];
      else warnings.push(message);
    }
    splitRules.push({
      recipient_account_id: recipient.id,
      cents: split.cents !== undefined ? Number(split.cents) : null,
      percent: split.percent !== undefined ? Number(split.percent) : null,
      permit_aggregated: Boolean(split.permit_aggregated),
      credit_card_cents: split.credit_card_cents ?? null,
      bank_slip_cents: split.bank_slip_cents ?? null,
      pix_cents: split.pix_cents ?? null,
    });
  }
  const splitTotal = splitRules.reduce(
    (sum, rule) => sum + (rule.cents ?? Math.round((totalCents * (rule.percent ?? 0)) / 100)),
    0
  );
  if (splitRules.length && splitTotal >= totalCents) {
    splitIgnored = true;
    warnings.push(`soma dos splits (${splitTotal}) >= total (${totalCents}): a Iugu ignora o split e tudo fica na conta emissora`);
  }

  if (body.order_id && settings.strict) {
    const others = await iuguMockList(KIND.invoice, { accountId: account.id, limit: 10000 });
    if (others.some((i) => i.order_id === body.order_id && i.status !== 'canceled')) {
      errors.order_id = ['já está em uso'];
    }
  }

  if (Object.keys(errors).length) return { error: fail(422, errors) };

  const id = iuguId();
  const secure = secureId();
  const secureUrl = `${IUGU_MOCK.publicUrl}/iugu/faturas/${secure}`;
  const now = new Date();
  const invoice = {
    id,
    account_id: account.id,
    account_name: account.name,
    secure_id: secure,
    secure_url: secureUrl,
    order_id: body.order_id ?? null,
    email: body.email,
    due_date: String(body.due_date),
    expires_in: body.expires_in ?? null,
    status: 'pending',
    payable_with: payableWith,
    items: items.map((item) => ({
      id: iuguId(),
      description: item.description,
      quantity: Number(item.quantity || 1),
      price_cents: Number(item.price_cents),
      created_at: toIugu(now),
      updated_at: toIugu(now),
    })),
    total_cents: totalCents,
    payer,
    customer_id: body.customer_id ?? null,
    split_id: splitRules.length ? iuguId() : null,
    split_rules: splitRules,
    split_ignored: splitIgnored,
    created_by_charge: createdByCharge,
    legacy_extras: Object.fromEntries(foreign.map((key) => [key, body[key]])),
    paid_cents: null,
    total_paid_cents: 0,
    taxes_paid_cents: null,
    advance_fee_cents: null,
    refunded_cents: 0,
    installments: null,
    payment_method: null,
    credit_card_transaction: null,
    pix: null,
    bank_slip: null,
    created_at: now.toISOString(),
    created_at_iso: toIugu(now),
    updated_at: toIugu(now),
    paid_at: null,
    authorized_at_iso: null,
    canceled_at_iso: null,
    expired_at_iso: null,
    refunded_at_iso: null,
    chargeback_at_iso: null,
    protested_at_iso: null,
    logs: [{ id: iuguId(), description: 'Fatura criada!', notes: 'Fatura criada pelo mock', created_at: toIugu(now) }],
    warnings: [...warnings],
  };
  if (allows(invoice, 'pix')) {
    invoice.pix = {
      qrcode: `${IUGU_MOCK.publicUrl}/iugu/pix/${id}.png`,
      qrcode_text: pixCopyPaste(id, totalCents),
      status: 'qr_code_created',
      payer_cpf_cnpj: null,
      payer_name: null,
      end_to_end_id: null,
      end_to_end_refund_id: null,
    };
  }
  if (allows(invoice, 'bank_slip')) {
    invoice.bank_slip = {
      ...bankSlipNumbers(),
      barcode: `${IUGU_MOCK.publicUrl}/iugu/faturas/${secure}/barcode`,
      bank_slip_url: `${secureUrl}.pdf`,
      bank_slip_pdf_url: `${secureUrl}.pdf`,
      bank_slip_bank: 341,
      bank_slip_status: 'registered',
      bank_slip_error_code: null,
      bank_slip_error_message: null,
      recipient_cpf_cnpj: null,
    };
  }
  return { invoice };
}

async function saveInvoice(invoice) {
  invoice.updated_at = toIugu();
  return iuguMockPut(KIND.invoice, invoice.id, invoice.account_id, invoice);
}

function log(invoice, description, notes = null) {
  invoice.logs = [...(invoice.logs ?? []), { id: iuguId(), description, notes, created_at: toIugu() }];
}

/** Changes status, saves and (when enabled) sends invoice.status_changed. */
export async function transition(invoice, status, fields = {}, { event = 'invoice.status_changed', delayMs } = {}) {
  Object.assign(invoice, fields, { status });
  log(invoice, `Status alterado para ${status}`);
  const saved = await saveInvoice(invoice);
  await queueInvoiceWebhook(saved, event, { delayMs });
  return saved;
}

function taxesFor(invoice, method, months = 1) {
  const total = invoice.total_cents;
  if (method === 'pix') return Math.round(total * 0.0099);
  if (method === 'bank_slip') return 300;
  return Math.round(total * (months > 1 ? 0.0319 : 0.0251)) + 30;
}

async function creditAccounts(invoice, sign = 1) {
  const net = (invoice.paid_cents ?? invoice.total_cents) - (invoice.taxes_paid_cents ?? 0);
  const rules = invoice.split_ignored ? [] : invoice.split_rules ?? [];
  let distributed = 0;
  for (const rule of rules) {
    const cents = rule.cents ?? Math.round((invoice.total_cents * (rule.percent ?? 0)) / 100);
    const recipient = await iuguMockGet(KIND.account, rule.recipient_account_id);
    if (!recipient) continue;
    recipient.balance_cents = Number(recipient.balance_cents || 0) + sign * cents;
    await saveAccount(recipient);
    distributed += cents;
  }
  const owner = await iuguMockGet(KIND.account, invoice.account_id);
  if (owner) {
    owner.balance_cents = Number(owner.balance_cents || 0) + sign * (net - distributed);
    await saveAccount(owner);
  }
}

/** Marks an invoice paid (charge, panel or auto-pay) and moves the money. */
export async function payInvoice(invoice, { method, card = null, months = null, delayMs } = {}) {
  const paidAt = new Date();
  const payMethod = method ?? (allows(invoice, 'pix') ? 'pix' : 'bank_slip');
  const account = await iuguMockGet(KIND.account, invoice.account_id);
  const installments = Number(months || 1);
  invoice.payment_method = `iugu_${payMethod}`;
  invoice.paid_cents = invoice.total_cents;
  invoice.total_paid_cents = invoice.total_cents;
  invoice.taxes_paid_cents = taxesFor(invoice, payMethod, installments);
  invoice.installments = payMethod === 'credit_card' ? installments : null;
  invoice.advance_fee_cents =
    payMethod === 'credit_card' && account?.configuration?.auto_advance
      ? Math.round(invoice.total_cents * 0.0199 * installments)
      : null;
  invoice.financial_return_dates =
    payMethod === 'credit_card'
      ? Array.from({ length: installments }, (_, i) => ({
          id: iuguId(),
          installment: i + 1,
          amount: brl(Math.round(invoice.total_cents / installments)),
          return_date: isoDate(new Date(paidAt.getTime() + (i + 1) * 30 * DAY_MS)),
          status: 'pending',
        }))
      : null;
  if (payMethod === 'pix' && invoice.pix) {
    invoice.pix = {
      ...invoice.pix,
      status: 'qr_code_paid',
      payer_cpf_cnpj: invoice.payer?.cpf_cnpj ?? null,
      payer_name: invoice.payer?.name ?? null,
      end_to_end_id: `E${randomDigits(8)}${isoDate(paidAt).replace(/-/g, '')}${randomDigits(11)}`,
    };
  }
  if (card) {
    invoice.credit_card_transaction = {
      ...card,
      status: 'captured',
      message: 'Autorizado',
      lr: '00',
      tid: randomDigits(20),
      updated_at: toIugu(paidAt),
    };
    invoice.authorized_at_iso = toIugu(paidAt);
  }
  await creditAccounts(invoice, 1);
  return transition(invoice, 'paid', { paid_at: toIugu(paidAt) }, { delayMs });
}

function scheduleAutoPay(invoice, settings) {
  if (!settings.autoPaySeconds || allows(invoice, 'credit_card')) return;
  setTimeout(async () => {
    const fresh = await iuguMockGet(KIND.invoice, invoice.id);
    if (fresh?.status === 'pending') await payInvoice(fresh, { delayMs: 0 }).catch(() => {});
  }, settings.autoPaySeconds * 1000);
}

export function invoiceView(invoice) {
  const refundable = ['paid', 'partially_refunded'].includes(invoice.status) && invoice.payment_method !== 'iugu_bank_slip';
  const card = invoice.credit_card_transaction;
  return {
    id: invoice.id,
    account_id: invoice.account_id,
    account_name: invoice.account_name,
    due_date: invoice.due_date,
    currency: 'BRL',
    discount_cents: null,
    email: invoice.email,
    items_total_cents: invoice.total_cents,
    notification_url: null,
    return_url: null,
    status: invoice.status,
    tax_cents: null,
    total_cents: invoice.total_cents,
    total_paid_cents: invoice.total_paid_cents,
    taxes_paid_cents: invoice.taxes_paid_cents,
    paid_at: invoice.paid_at,
    paid_cents: invoice.paid_cents,
    cc_emails: null,
    financial_return_date: invoice.financial_return_dates?.[0]?.return_date ?? null,
    payable_with: invoice.payable_with.length === 1 ? invoice.payable_with[0] : invoice.payable_with,
    overpaid_cents: null,
    ignore_due_email: null,
    ignore_canceled_email: null,
    advance_fee_cents: invoice.advance_fee_cents,
    commission_cents: null,
    early_payment_discount: false,
    order_id: invoice.order_id,
    updated_at: invoice.updated_at,
    credit_card_brand: card?.brand ?? null,
    credit_card_bin: card?.bin ?? null,
    credit_card_last_4: card?.last4 ?? null,
    credit_card_captured_at: card?.status === 'captured' ? card.updated_at : null,
    credit_card_tid: card?.tid ?? null,
    external_reference: null,
    max_installments_value: null,
    payer_name: invoice.payer?.name ?? null,
    payer_email: invoice.payer?.email ?? invoice.email,
    payer_cpf_cnpj: invoice.payer?.cpf_cnpj ?? null,
    payer_phone: invoice.payer?.phone ?? null,
    payer_phone_prefix: invoice.payer?.phone_prefix ?? null,
    payer_address_zip_code: invoice.payer?.address?.zip_code ?? null,
    payer_address_street: invoice.payer?.address?.street ?? null,
    payer_address_district: invoice.payer?.address?.district ?? null,
    payer_address_city: invoice.payer?.address?.city ?? null,
    payer_address_state: invoice.payer?.address?.state ?? null,
    payer_address_number: invoice.payer?.address?.number ?? null,
    payer_address_complement: invoice.payer?.address?.complement ?? null,
    payer_address_country: 'Brasil',
    secure_id: invoice.secure_id,
    secure_url: invoice.secure_url,
    customer_id: invoice.customer_id,
    customer_ref: invoice.payer?.name ?? null,
    customer_name: invoice.payer?.name ?? null,
    user_id: null,
    total: brl(invoice.total_cents),
    taxes_paid: brl(invoice.taxes_paid_cents ?? 0),
    total_paid: brl(invoice.total_paid_cents ?? 0),
    total_overpaid: brl(0),
    commission: brl(0),
    fines_on_occurrence_day: brl(0),
    total_on_occurrence_day: brl(invoice.total_cents),
    fines_on_occurrence_day_cents: 0,
    total_on_occurrence_day_cents: invoice.total_cents,
    refunded_cents: invoice.refunded_cents ?? 0,
    remaining_captured_cents: (invoice.paid_cents ?? 0) - (invoice.refunded_cents ?? 0),
    advance_fee: invoice.advance_fee_cents == null ? null : brl(invoice.advance_fee_cents),
    paid: brl(invoice.paid_cents ?? 0),
    original_payment_id: null,
    double_payment_id: null,
    per_day_interest: false,
    per_day_interest_value: null,
    interest: null,
    discount: null,
    created_at: invoice.created_at_iso,
    created_at_iso: invoice.created_at_iso,
    authorized_at: invoice.authorized_at_iso,
    authorized_at_iso: invoice.authorized_at_iso,
    expired_at: invoice.expired_at_iso,
    expired_at_iso: invoice.expired_at_iso,
    refunded_at: invoice.refunded_at_iso,
    refunded_at_iso: invoice.refunded_at_iso,
    canceled_at: invoice.canceled_at_iso,
    canceled_at_iso: invoice.canceled_at_iso,
    protested_at: invoice.protested_at_iso,
    protested_at_iso: invoice.protested_at_iso,
    chargeback_at: invoice.chargeback_at_iso,
    chargeback_at_iso: invoice.chargeback_at_iso,
    occurrence_date: invoice.paid_at ? invoice.paid_at.slice(0, 10) : null,
    refundable,
    installments: invoice.installments,
    transaction_number: card ? Number(card.tid?.slice(-6) ?? 0) : null,
    payment_method: invoice.payment_method,
    financial_return_dates: invoice.financial_return_dates ?? null,
    bank_slip: invoice.bank_slip,
    pix: invoice.pix,
    items: invoice.items,
    early_payment_discounts: [],
    variables: [
      { variable: 'payment_data.transaction_number', value: card?.tid ?? null },
      { variable: 'payer.name', value: invoice.payer?.name ?? null },
    ],
    custom_variables: [],
    logs: invoice.logs ?? [],
    credit_card_transaction: card
      ? { status: card.status, message: card.message, lr: card.lr, brand: card.brand, bin: card.bin, last4: card.last4, tid: card.tid, updated_at: card.updated_at }
      : null,
    split_id: invoice.split_id,
    split_rules: invoice.split_rules?.length ? invoice.split_rules : null,
  };
}

async function findOwnedInvoice(ctx, id) {
  const invoice = await iuguMockGet(KIND.invoice, id);
  if (!invoice || !canSee(ctx.auth, invoice.account_id)) return null;
  ctx.invoiceId = invoice.id;
  return invoice;
}

async function createInvoice(ctx) {
  const { invoice, error } = await buildInvoice(ctx, ctx.body ?? {});
  if (error) return error;
  const saved = await saveInvoice(invoice);
  ctx.invoiceId = saved.id;
  scheduleAutoPay(saved, ctx.settings);
  return ok(invoiceView(saved));
}

async function getInvoice(ctx) {
  const invoice = await findOwnedInvoice(ctx, ctx.params.id);
  if (!invoice) return notFound('Invoice');
  return ok(invoiceView(invoice));
}

async function listInvoices(ctx) {
  const q = ctx.query ?? {};
  const limit = Math.min(Number(q.limit) || 100, 100);
  if (Number(q.limit) > 100) ctx.warnings.push(`limit ${q.limit} sobrescrito para 100 (máximo da doc)`);
  const start = Number(q.start) || 0;
  const all = await iuguMockList(KIND.invoice, { accountId: ctx.auth.account.id, limit: 100000 });
  let filtered = all;
  if (q.created_at_from) {
    if (!String(q.created_at_from).includes('T')) {
      const message = 'created_at_from sem hora; a doc pede AAAA-MM-DDThh:mm:ss-03:00';
      if (ctx.settings.strict) return fail(422, { created_at_from: [message] });
      ctx.warnings.push(message);
    }
    const from = Date.parse(q.created_at_from);
    if (!Number.isNaN(from)) filtered = filtered.filter((i) => Date.parse(i.created_at) >= from);
  }
  if (q.created_at_to) {
    const to = Date.parse(q.created_at_to);
    if (!Number.isNaN(to)) filtered = filtered.filter((i) => Date.parse(i.created_at) <= to);
  }
  if (q.status_filter) filtered = filtered.filter((i) => i.status === q.status_filter);
  const terms = {};
  for (const invoice of all) terms[invoice.status] = (terms[invoice.status] ?? 0) + 1;
  return ok({
    facets: {
      status: {
        _type: 'terms',
        missing: 0,
        total: all.length,
        other: 0,
        terms: Object.entries(terms).map(([term, count]) => ({ term, count })),
      },
    },
    // As documented: the account's total, regardless of the filters.
    totalItems: all.length,
    items: filtered.slice(start, start + limit).map(invoiceView),
  });
}

async function cancelInvoice(ctx) {
  const invoice = await findOwnedInvoice(ctx, ctx.params.id);
  if (!invoice) return notFound('Invoice');
  if (!['pending', 'in_analysis', 'expired'].includes(invoice.status)) {
    return fail(400, `Fatura com status ${invoice.status} não pode ser cancelada`);
  }
  const saved = await transition(invoice, 'canceled', { canceled_at_iso: toIugu() });
  return ok(invoiceView(saved));
}

async function refundInvoice(ctx) {
  const invoice = await findOwnedInvoice(ctx, ctx.params.id);
  if (!invoice) return notFound('Invoice');
  if (!['paid', 'partially_refunded'].includes(invoice.status)) {
    return fail(400, `Fatura com status ${invoice.status} não pode ser reembolsada`);
  }
  const method = invoice.payment_method;
  if (method === 'iugu_bank_slip') return fail(400, 'Faturas pagas por boleto não podem ser reembolsadas pela iugu');
  const paidAt = Date.parse(invoice.paid_at ?? invoice.created_at);
  const maxDays = method === 'iugu_pix' ? 90 : 180;
  if (Date.now() - paidAt > maxDays * DAY_MS) return fail(400, `Prazo de reembolso de ${maxDays} dias expirado`);

  const remaining = (invoice.paid_cents ?? 0) - (invoice.refunded_cents ?? 0);
  const partial = ctx.body?.partial_value_refund_cents;
  let amount = remaining;
  if (partial !== undefined && partial !== null) {
    if (method === 'iugu_pix') return fail(400, 'Reembolso parcial disponível somente para cartão de crédito');
    amount = Number(partial);
    if (!Number.isInteger(amount) || amount <= 0 || amount > remaining) {
      return fail(422, { partial_value_refund_cents: ['valor inválido para o saldo capturado'] });
    }
  }
  const owner = await iuguMockGet(KIND.account, invoice.account_id);
  if (owner && Number(owner.balance_cents) < amount) {
    const message = `saldo da conta (${owner.balance_cents}) menor que o reembolso (${amount}): a Iugu não realiza`;
    if (ctx.settings.strict) return fail(400, 'Saldo insuficiente para realizar o reembolso');
    ctx.warnings.push(message);
  }
  if (owner) {
    owner.balance_cents = Number(owner.balance_cents || 0) - amount;
    await saveAccount(owner);
  }
  invoice.refunded_cents = (invoice.refunded_cents ?? 0) + amount;
  const fully = invoice.refunded_cents >= (invoice.paid_cents ?? 0);
  if (invoice.pix && fully) invoice.pix = { ...invoice.pix, end_to_end_refund_id: `D${randomDigits(31)}` };
  const saved = await transition(
    invoice,
    fully ? 'refunded' : 'partially_refunded',
    { refunded_at_iso: toIugu() },
    { event: 'invoice.refund' }
  );
  return ok(invoiceView(saved));
}

// ─── Charge ───────────────────────────────────────────────────────────────────

function pickScenario(ctx, card) {
  const forced = ctx.headers?.['x-mock-scenario'];
  if (forced && CARD_SCENARIOS[forced]) return { key: forced, ...CARD_SCENARIOS[forced] };
  if (ctx.settings.cardScenario !== 'auto' && CARD_SCENARIOS[ctx.settings.cardScenario]) {
    return { key: ctx.settings.cardScenario, ...CARD_SCENARIOS[ctx.settings.cardScenario] };
  }
  const key = CARD_BY_LAST4[card?.last4] ?? 'approved';
  return { key, ...CARD_SCENARIOS[key] };
}

async function resolveCard(ctx, body) {
  if (body.customer_payment_method_id) {
    const pm = await iuguMockGet(KIND.paymentMethod, body.customer_payment_method_id);
    if (!pm) return { error: fail(422, { customer_payment_method_id: ['forma de pagamento não encontrada'] }) };
    return { card: pm.card, source: pm.id };
  }
  if (body.token) {
    const token = await iuguMockGet(KIND.paymentToken, body.token);
    if (!token) return { error: fail(422, { token: ['inválido'] }) };
    if (token.used) {
      if (ctx.settings.strict) return { error: fail(422, { token: ['já utilizado'] }) };
      ctx.warnings.push('token de pagamento reutilizado (a Iugu aceita uso único)');
    }
    await iuguMockPut(KIND.paymentToken, token.id, token.account_id, { ...token, used: true });
    return { card: token.card, source: token.id };
  }
  return { card: null };
}

async function charge(ctx) {
  const body = ctx.body ?? {};
  const foreign = Object.keys(body).filter((key) => !CHARGE_KEYS.includes(key));
  if (foreign.length) ctx.warnings.push(`campos que não existem em POST /charge: ${foreign.join(', ')}`);

  let invoice;
  if (body.invoice_id) {
    invoice = await findOwnedInvoice(ctx, body.invoice_id);
    if (!invoice) return notFound('Invoice');
    if (invoice.status !== 'pending') return fail(400, `Fatura com status ${invoice.status} não pode ser cobrada`);
    const ignored = ['items', 'splits', 'due_date', 'payable_with', 'discount_cents'].filter((k) => body[k] !== undefined);
    if (ignored.length) ctx.warnings.push(`com invoice_id a Iugu ignora: ${ignored.join(', ')}`);
    if (body.order_id && invoice.order_id && body.order_id !== invoice.order_id) {
      ctx.warnings.push(`order_id do /charge (${body.order_id}) difere do da fatura (${invoice.order_id}): anula a proteção contra pagamento duplicado`);
    }
  } else {
    const built = await buildInvoice(
      ctx,
      { ...body, due_date: isoDate(), payable_with: body.method === 'bank_slip' ? ['bank_slip'] : ['credit_card'] },
      { createdByCharge: true }
    );
    if (built.error) return built.error;
    invoice = await saveInvoice(built.invoice);
    ctx.invoiceId = invoice.id;
  }

  if (body.method === 'bank_slip') {
    return ok({
      message: null,
      errors: {},
      success: true,
      url: invoice.secure_url,
      pdf: `${invoice.secure_url}.pdf`,
      identification: invoice.bank_slip?.digitable_line ?? null,
      invoice_id: invoice.id,
    });
  }

  const { card, error } = await resolveCard(ctx, body);
  if (error) return error;
  if (!card) return fail(422, { token: ['token ou customer_payment_method_id é obrigatório'] });

  const months = body.months === undefined || body.months === null ? null : Number(body.months);
  if (months !== null) {
    if (months === 1) ctx.warnings.push('months=1: a doc pede para não enviar months em 1x');
    if (months < 1 || months > 12) return fail(422, { months: ['deve estar entre 2 e 12'] });
    if (months > 1 && invoice.total_cents / months < 500) {
      const message = 'parcela abaixo de R$ 5,00';
      if (ctx.settings.strict) return fail(422, { months: [message] });
      ctx.warnings.push(message);
    }
  }

  const scenario = pickScenario(ctx, card);
  const base = { url: invoice.secure_url, pdf: `${invoice.secure_url}.pdf`, identification: null, invoice_id: invoice.id };

  if (!scenario.approved) {
    invoice.credit_card_transaction = {
      ...card,
      status: 'unauthorized',
      message: scenario.message,
      lr: scenario.lr,
      tid: randomDigits(20),
      updated_at: toIugu(),
    };
    log(invoice, `Cobrança negada (LR ${scenario.lr})`, scenario.message);
    if (invoice.created_by_charge && !body.keep_dunning) {
      await transition(invoice, 'canceled', { canceled_at_iso: toIugu() });
    } else {
      await saveInvoice(invoice);
    }
    // Declines answer 2xx with success false; the gateway reads LR and message.
    return ok({ ...base, message: scenario.message, errors: scenario.message, success: false, LR: scenario.lr, status: 'unauthorized' });
  }

  if (scenario.analysis) {
    invoice.credit_card_transaction = { ...card, status: 'in_analysis', message: scenario.message, lr: '00', tid: randomDigits(20), updated_at: toIugu() };
    invoice.installments = months;
    invoice.pending_card = card;
    await transition(invoice, 'in_analysis', {}, { delayMs: 3000 });
    return ok({ ...base, message: scenario.message, errors: {}, success: true, LR: '00', brand: card.brand, bin: card.bin, last4: card.last4, status: 'in_analysis', info_message: 'Transação em análise' });
  }

  await payInvoice(invoice, { method: 'credit_card', card, months, delayMs: 3000 });
  return ok({
    ...base,
    message: 'Autorizado',
    errors: {},
    success: true,
    LR: '00',
    brand: card.brand,
    bin: card.bin,
    last4: card.last4,
    issuer: 'MOCK BANK S.A.',
    reversible: 'true',
    token: card.token_id ?? null,
    status: 'captured',
    info_message: null,
  });
}

// ─── Customers, cards and tokens ──────────────────────────────────────────────

function cardBrand(number) {
  if (/^(4011|4312|4389|4514|4576|5041|5066|5067|509|6277|6362|6363|650|6516|6550)/.test(number)) return 'ELO';
  if (/^(606282|3841)/.test(number)) return 'HIPERCARD';
  if (/^3[47]/.test(number)) return 'AMEX';
  if (/^3(0[0-5]|[68])/.test(number)) return 'DINERS';
  if (/^4/.test(number)) return 'VISA';
  if (/^(5[1-5]|2[2-7])/.test(number)) return 'MASTERCARD';
  return 'UNKNOWN';
}

function luhn(number) {
  let sum = 0;
  let double = false;
  for (let i = number.length - 1; i >= 0; i -= 1) {
    let digit = Number(number[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

async function createPaymentToken(ctx) {
  const body = ctx.body ?? {};
  if (isBlank(body.account_id)) return blank('account_id');
  if (!(await iuguMockGet(KIND.account, String(body.account_id)))) {
    if (!ctx.settings.lenientAuth) return fail(422, { account_id: ['is invalid'] });
    ctx.warnings.push(`account_id ${body.account_id} não existe no mock`);
  }
  if (body.method !== 'credit_card') return fail(422, { method: ['is invalid'] });
  const data = body.data ?? {};
  const number = String(data.number ?? '').replace(/\D/g, '');
  const errors = {};
  if (number.length < 13 || number.length > 19 || (ctx.settings.strict && !luhn(number))) errors.number = ['não é válido'];
  if (!/^\d{3,4}$/.test(String(data.verification_value ?? ''))) errors.verification_value = ['não é válido'];
  if (isBlank(data.first_name)) errors.first_name = ['não pode ficar em branco'];
  if (isBlank(data.last_name)) errors.last_name = ['não pode ficar em branco'];
  const month = Number(data.month);
  const year = Number(String(data.year ?? '').length === 2 ? `20${data.year}` : data.year);
  if (!(month >= 1 && month <= 12)) errors.month = ['não é válido'];
  const now = new Date();
  if (!year || year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) {
    errors.year = ['cartão expirado'];
  }
  if (Object.keys(errors).length) return fail(422, errors);

  const id = iuguId();
  const holder = `${data.first_name} ${data.last_name}`.trim().toUpperCase();
  const card = {
    token_id: id,
    brand: cardBrand(number),
    bin: number.slice(0, 6),
    last4: number.slice(-4),
    holder_name: holder,
    month,
    year,
    display_number: `XXXX-XXXX-XXXX-${number.slice(-4)}`,
  };
  await iuguMockPut(KIND.paymentToken, id, String(body.account_id), {
    id,
    account_id: String(body.account_id),
    method: 'credit_card',
    test: Boolean(body.test),
    card,
    used: false,
    created_at: nowIso(),
  });
  return ok({
    id,
    method: 'credit_card',
    test: Boolean(body.test),
    extra_info: { bin: card.bin, year, month, brand: card.brand, holder_name: holder, display_number: card.display_number },
  });
}

function customerView(customer) {
  return {
    id: customer.id,
    email: customer.email,
    name: customer.name,
    notes: customer.notes ?? null,
    cpf_cnpj: customer.cpf_cnpj ?? null,
    phone_prefix: customer.phone_prefix ?? null,
    phone: customer.phone ?? null,
    zip_code: customer.zip_code ?? null,
    number: customer.number ?? null,
    street: customer.street ?? null,
    city: customer.city ?? null,
    state: customer.state ?? null,
    district: customer.district ?? null,
    complement: customer.complement ?? null,
    default_payment_method_id: customer.default_payment_method_id ?? null,
    proxy_payments_from_customer_id: null,
    created_at: customer.created_at,
    updated_at: customer.updated_at,
    custom_variables: [],
  };
}

async function createCustomer(ctx) {
  const body = ctx.body ?? {};
  if (isBlank(body.email)) return blank('email');
  if (isBlank(body.name)) return blank('name');
  const { api_token, ...fields } = body;
  const customer = { ...fields, id: iuguId(), account_id: ctx.auth.account.id, created_at: toIugu(), updated_at: toIugu() };
  await iuguMockPut(KIND.customer, customer.id, customer.account_id, customer);
  return ok(customerView(customer));
}

async function getCustomer(ctx) {
  const customer = await iuguMockGet(KIND.customer, ctx.params.id);
  if (!customer || !canSee(ctx.auth, customer.account_id)) return notFound('Customer');
  return ok(customerView(customer));
}

function paymentMethodView(pm) {
  return {
    id: pm.id,
    description: pm.description,
    item_type: 'credit_card',
    customer_id: pm.customer_id,
    data: {
      holder_name: pm.card.holder_name,
      display_number: pm.card.display_number,
      brand: pm.card.brand,
      month: pm.card.month,
      year: pm.card.year,
      bin: pm.card.bin,
      last_digits: pm.card.last4,
    },
  };
}

async function createPaymentMethod(ctx) {
  const customer = await iuguMockGet(KIND.customer, ctx.params.id);
  if (!customer || !canSee(ctx.auth, customer.account_id)) return notFound('Customer');
  const body = ctx.body ?? {};
  if (isBlank(body.description)) return blank('description');
  if (isBlank(body.token)) return blank('token');
  const token = await iuguMockGet(KIND.paymentToken, body.token);
  if (!token) return fail(422, { token: ['inválido'] });
  if (token.used) {
    if (ctx.settings.strict) return fail(422, { token: ['já utilizado'] });
    ctx.warnings.push('token de pagamento reutilizado');
  }
  await iuguMockPut(KIND.paymentToken, token.id, token.account_id, { ...token, used: true });
  const pm = {
    id: iuguId(),
    customer_id: customer.id,
    account_id: customer.account_id,
    description: body.description,
    card: token.card,
    created_at: nowIso(),
  };
  await iuguMockPut(KIND.paymentMethod, pm.id, customer.account_id, pm);
  if (body.set_as_default || !customer.default_payment_method_id) {
    await iuguMockPut(KIND.customer, customer.id, customer.account_id, { ...customer, default_payment_method_id: pm.id });
  }
  return ok(paymentMethodView(pm));
}

async function listPaymentMethods(ctx) {
  const customer = await iuguMockGet(KIND.customer, ctx.params.id);
  if (!customer || !canSee(ctx.auth, customer.account_id)) return notFound('Customer');
  const all = await iuguMockList(KIND.paymentMethod, { accountId: customer.account_id, limit: 10000 });
  return ok(all.filter((pm) => pm.customer_id === customer.id).map(paymentMethodView));
}

async function zeroAuth(ctx) {
  const token = await iuguMockGet(KIND.paymentToken, String(ctx.body?.token ?? ''));
  if (!token) return fail(422, { token: ['inválido'] });
  if (!['VISA', 'MASTERCARD', 'ELO'].includes(token.card.brand)) return ok({ code: '57', message: 'Bandeira Inválida', valid: false });
  const scenario = pickScenario(ctx, token.card);
  if (!scenario.approved) return ok({ code: scenario.lr, message: scenario.message, valid: false });
  return ok({ code: '00', message: 'Transação autorizada', valid: true });
}

// ─── Routing ──────────────────────────────────────────────────────────────────

/** auth: any (any known token), master (master only), user, none (no token). */
export const ROUTES = [
  { method: 'POST', pattern: '/marketplace/create_account', name: 'accounts.create', auth: 'master', handler: createAccount },
  { method: 'POST', pattern: '/marketplace/deactivate', name: 'accounts.deactivate', auth: 'any', handler: deactivateAccount },
  { method: 'POST', pattern: '/accounts/configuration', name: 'accounts.configuration', auth: 'any', handler: configureAccount },
  { method: 'POST', pattern: '/accounts/:id/request_verification', name: 'accounts.verification', auth: 'any', handler: requestVerification },
  { method: 'PUT', pattern: '/account/documents', name: 'accounts.documents.resend', auth: 'any', handler: resendDocuments },
  { method: 'GET', pattern: '/account/documents', name: 'accounts.documents.list', auth: 'any', handler: listDocuments },
  { method: 'GET', pattern: '/accounts/:id', name: 'accounts.get', auth: 'any', handler: getAccount },
  { method: 'PUT', pattern: '/accounts/:id', name: 'accounts.update', auth: 'any', handler: updateAccount },
  { method: 'POST', pattern: '/bank_verification', name: 'bank_verification.create', auth: 'any', handler: bankVerification },
  { method: 'POST', pattern: '/profile/renew_access_token', name: 'user_token.renew', auth: 'any', handler: renewUserToken },
  { method: 'POST', pattern: '/invoices', name: 'invoices.create', auth: 'any', handler: createInvoice },
  { method: 'GET', pattern: '/invoices', name: 'invoices.list', auth: 'any', handler: listInvoices },
  { method: 'GET', pattern: '/invoices/:id', name: 'invoices.get', auth: 'any', handler: getInvoice },
  { method: 'PUT', pattern: '/invoices/:id/cancel', name: 'invoices.cancel', auth: 'any', handler: cancelInvoice },
  { method: 'POST', pattern: '/invoices/:id/refund', name: 'invoices.refund', auth: 'any', handler: refundInvoice },
  { method: 'POST', pattern: '/charge', name: 'charge', auth: 'any', handler: charge },
  { method: 'POST', pattern: '/customers', name: 'customers.create', auth: 'any', handler: createCustomer },
  { method: 'GET', pattern: '/customers/:id', name: 'customers.get', auth: 'any', handler: getCustomer },
  { method: 'POST', pattern: '/customers/:id/payment_methods', name: 'payment_methods.create', auth: 'any', handler: createPaymentMethod },
  { method: 'GET', pattern: '/customers/:id/payment_methods', name: 'payment_methods.list', auth: 'any', handler: listPaymentMethods },
  { method: 'POST', pattern: '/payment_token', name: 'payment_token.create', auth: 'none', handler: createPaymentToken },
  { method: 'POST', pattern: '/zero_auth', name: 'zero_auth', auth: 'any', handler: zeroAuth },
  { method: 'POST', pattern: '/:account_id/api_tokens', name: 'api_tokens.create', auth: 'master', handler: createApiToken },
  { method: 'GET', pattern: '/:account_id/api_tokens', name: 'api_tokens.list', auth: 'master', handler: listApiTokens },
];

export function matchRoute(routes, method, path) {
  const parts = path.split('/').filter(Boolean);
  for (const route of routes) {
    if (route.method !== method) continue;
    const pattern = route.pattern.split('/').filter(Boolean);
    if (pattern.length !== parts.length) continue;
    const params = {};
    let matched = true;
    for (let i = 0; i < pattern.length; i += 1) {
      if (pattern[i].startsWith(':')) params[pattern[i].slice(1)] = decodeURIComponent(parts[i]);
      else if (pattern[i] !== parts[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }
  return null;
}

/**
 * Runs one Iugu API call.
 * @returns {Promise<{ status: number, body: any, route?: string, accountId?: string, invoiceId?: string, warnings: string[], auth?: string, timedOut?: boolean }>}
 */
export async function dispatch({ channel = 'direct', method, path, query = {}, body = null, token = null, headers = {} }) {
  const warnings = [];
  const match = matchRoute(ROUTES, method, path);
  if (!match) return { status: 404, body: { errors: 'Not Found' }, warnings };
  const { route, params } = match;
  const settings = await getSettings();

  const fault = await takeFault(route.name, channel);
  if (fault?.timeout) {
    await sleep(fault.timeoutMs);
    return { status: 504, body: { errors: 'Gateway Timeout' }, route: route.name, warnings: ['timeout simulado'], timedOut: true };
  }
  if (fault) return { status: fault.status, body: fault.body, route: route.name, warnings: [`falha simulada ${fault.status}`] };

  let auth = null;
  if (route.auth !== 'none') {
    if (!token) return { status: 401, body: { errors: 'Unauthorized' }, route: route.name, warnings };
    auth = await resolveToken(token, { lenient: settings.lenientAuth });
    if (!auth || (auth.revoked && route.name !== 'user_token.renew')) {
      return { status: 401, body: { errors: 'Unauthorized' }, route: route.name, warnings };
    }
    if (auth.unknownToken) warnings.push('token desconhecido tratado como conta mestre (lenientAuth)');
    if (route.auth === 'master' && auth.tier !== 'master') {
      return { status: 401, body: { errors: 'Unauthorized' }, route: route.name, warnings };
    }
    if (auth.account.active === false && auth.tier !== 'master') {
      return { status: 401, body: { errors: 'Conta desativada' }, route: route.name, warnings };
    }
  }

  const ctx = { channel, method, path, params, query, body, headers, auth, settings, warnings, invoiceId: null };
  const result = await route.handler(ctx);
  if (result.status < 300 && route.name === 'invoices.create') ctx.invoiceId = result.body.id;
  return {
    ...result,
    route: route.name,
    accountId: auth?.account?.id ?? null,
    invoiceId: ctx.invoiceId ?? params.id ?? null,
    auth: auth ? auth.tier : 'none',
    warnings,
  };
}
