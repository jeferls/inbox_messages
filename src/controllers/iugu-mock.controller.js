import QRCode from 'qrcode';
import {
  iuguMockGet,
  iuguMockPut,
  iuguMockList,
  iuguMockCount,
  iuguMockClear,
  insertIuguMockRequest,
  listIuguMockRequests,
  clearIuguMockRequests,
} from '../db/index.js';
import { IUGU_MOCK } from '../config/env.js';
import {
  KIND,
  dispatch,
  ensureMasterAccount,
  newAccount,
  accountView,
  invoiceView,
  setVerificationOutcome,
  payInvoice,
  transition,
  ROUTES,
} from '../mocks/iugu/api.js';
import { handleProxy, invoiceAllowlist } from '../mocks/iugu/proxy.js';
import { sealToken, toIugu, brl } from '../mocks/iugu/ids.js';
import { CARD_SCENARIOS, CARD_BY_LAST4, FAULT_KINDS, getSettings, updateSettings } from '../mocks/iugu/state.js';
import { sendInvoiceWebhook } from '../mocks/iugu/webhooks.js';
import { logLine } from '../utils/logger.js';

// ─── Request logging ──────────────────────────────────────────────────────────

/** Keeps the log readable: base64 files collapse to their size and card data is masked. */
function sanitize(value, key = '') {
  if (typeof value === 'string') {
    if (['number', 'verification_value'].includes(key)) return value.replace(/\d(?=\d{4})/g, '*');
    if (value.length > 300 && /^(data:[^,]+,)?[A-Za-z0-9+/=\s]+$/.test(value.slice(0, 400))) {
      return `<base64 ~${Math.floor((value.length * 3) / 4)} bytes>`;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v, k)]));
  }
  return value;
}

async function record(channel, req, result, startedAt, requestBody) {
  try {
    await insertIuguMockRequest({
      channel,
      method: req.method,
      path: req.originalUrl,
      route: result.route ?? null,
      auth: result.auth ?? null,
      accountId: result.accountId ?? null,
      invoiceId: result.invoiceId ?? null,
      status: result.status,
      requestBody: sanitize(requestBody),
      responseBody: sanitize(result.body),
      warnings: result.warnings,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    logLine('warn', 'iugu-mock: failed to record request', { error: String(err?.message ?? err) }).catch(() => {});
  }
}

function normalizePath(path) {
  return path.replace(/\/{2,}/g, '/');
}

function extractToken(req) {
  const header = String(req.headers.authorization ?? '');
  if (/^basic /i.test(header)) {
    return Buffer.from(header.slice(6).trim(), 'base64').toString('utf8').split(':')[0] || null;
  }
  if (/^bearer /i.test(header)) return header.slice(7).trim() || null;
  return req.query?.api_token || req.body?.api_token || null;
}

// ─── Direct API (IUGU_API_URL / config('iugu.api_url')) ───────────────────────

export async function directApiHandler(req, res) {
  const startedAt = Date.now();
  // greenn-back joins '/v1/...' to a base that already ends in /v1, and some calls add a
  // second slash: both reach the same route here.
  const path = normalizePath(req.path).replace(/^\/v1(?=\/|$)/, '').replace(/^\/v1(?=\/|$)/, '') || '/';
  const { api_token, ...query } = req.query ?? {};
  const body = ['GET', 'DELETE'].includes(req.method) ? null : req.body ?? null;
  const result = await dispatch({
    channel: 'direct',
    method: req.method,
    path,
    query,
    body,
    token: extractToken(req),
    headers: req.headers,
  });
  await record('direct', req, result, startedAt, body);
  res.status(result.status).json(result.body);
}

// ─── sec-proxy (IUGU_SEC_PROXY_BASE_URL + /iugu) ──────────────────────────────

export async function proxyHandler(req, res) {
  const startedAt = Date.now();
  const rawBody = req.rawBody ?? (req.body && Object.keys(req.body).length ? JSON.stringify(req.body) : '');
  const result = await handleProxy({
    method: req.method,
    path: normalizePath(req.path),
    query: req.query ?? {},
    rawBody,
    headers: req.headers,
  });
  let requestBody = null;
  try {
    requestBody = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    requestBody = rawBody;
  }
  await record('proxy', req, result, startedAt, requestBody);
  res.status(result.status).json(result.body);
}

// ─── Public pages: invoice, bank slip barcode and Pix QR code ─────────────────

async function invoiceBySecureId(secure) {
  const invoices = await iuguMockList(KIND.invoice, { limit: 100000 });
  return invoices.find((invoice) => invoice.secure_id === secure) ?? null;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export async function invoicePageHandler(req, res) {
  const secure = String(req.params.secure).replace(/\.pdf$/, '');
  const invoice = await invoiceBySecureId(secure);
  if (!invoice) return res.status(404).send('Fatura não encontrada');
  const payable = invoice.status === 'pending';
  res.type('html').send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fatura ${escapeHtml(invoice.id)}</title><link rel="stylesheet" href="/styles.css"></head>
<body style="max-width:640px;margin:24px auto;padding:0 16px;font-family:system-ui,sans-serif">
<h1 style="font-size:20px">Fatura iugu (mock)</h1>
<p><b>${escapeHtml(brl(invoice.total_cents))}</b> · status <b>${escapeHtml(invoice.status)}</b> · vencimento ${escapeHtml(invoice.due_date)}</p>
<p style="font-family:monospace;font-size:12px">${escapeHtml(invoice.id)}</p>
${invoice.pix ? `<h2 style="font-size:16px">Pix</h2><img src="/iugu/pix/${escapeHtml(invoice.id)}.png" width="200" height="200" alt="QR Code Pix"><p style="word-break:break-all;font-family:monospace;font-size:12px">${escapeHtml(invoice.pix.qrcode_text)}</p>` : ''}
${invoice.bank_slip ? `<h2 style="font-size:16px">Boleto</h2><p style="font-family:monospace">${escapeHtml(invoice.bank_slip.digitable_line)}</p>` : ''}
${payable ? `<button id="pay" style="padding:10px 16px">Simular pagamento</button>
<script>document.getElementById('pay').onclick=async()=>{const r=await fetch('/api/iugu-mock/invoices/${escapeHtml(invoice.id)}/actions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'pay'})});location.reload();};</script>` : ''}
<p><a href="/gateway-mocks-iugu.html#invoice=${escapeHtml(invoice.id)}">Abrir no painel do mock</a></p>
</body></html>`);
}

export async function pixQrHandler(req, res) {
  const invoice = await iuguMockGet(KIND.invoice, String(req.params.id).replace(/\.png$/, ''));
  if (!invoice?.pix) return res.status(404).send('Not Found');
  res.type('png').send(await QRCode.toBuffer(invoice.pix.qrcode_text, { width: 300, margin: 1 }));
}

export async function barcodeHandler(req, res) {
  const invoice = await invoiceBySecureId(req.params.secure);
  if (!invoice?.bank_slip) return res.status(404).send('Not Found');
  const digits = invoice.bank_slip.barcode_data;
  let x = 0;
  const bars = [];
  for (const digit of digits) {
    const width = 1 + (Number(digit) % 3);
    if (Number(digit) % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${width}" height="60"/>`);
    x += width + 1;
  }
  res.type('image/svg+xml').send(`<svg xmlns="http://www.w3.org/2000/svg" width="${x}" height="60">${bars.join('')}</svg>`);
}

// ─── Panel API ────────────────────────────────────────────────────────────────

function accountSummary(account, invoiceCount = null) {
  return {
    id: account.id,
    name: account.name,
    master: Boolean(account.master),
    active: account.active !== false,
    is_verified: Boolean(account.is_verified),
    can_receive: Boolean(account.can_receive),
    last_verification_request_status: account.last_verification_request_status,
    balance_cents: account.balance_cents ?? 0,
    balance: brl(account.balance_cents ?? 0),
    bank_account: (account.bank_accounts ?? []).find((b) => b.active) ?? null,
    website: account.website ?? null,
    invoices: invoiceCount,
    created_at: account.created_at,
    updated_at: account.updated_at,
  };
}

function invoiceSummary(invoice) {
  return {
    id: invoice.id,
    account_id: invoice.account_id,
    account_name: invoice.account_name,
    status: invoice.status,
    payable_with: invoice.payable_with,
    payment_method: invoice.payment_method,
    total_cents: invoice.total_cents,
    total: brl(invoice.total_cents),
    refunded_cents: invoice.refunded_cents ?? 0,
    email: invoice.email,
    payer_name: invoice.payer?.name ?? null,
    order_id: invoice.order_id,
    installments: invoice.installments,
    lr: invoice.credit_card_transaction?.lr ?? null,
    card_last4: invoice.credit_card_transaction?.last4 ?? null,
    splits: (invoice.split_rules ?? []).length,
    split_ignored: Boolean(invoice.split_ignored),
    warnings: (invoice.warnings ?? []).length,
    secure_url: invoice.secure_url,
    created_at: invoice.created_at,
    paid_at: invoice.paid_at,
  };
}

export async function overviewHandler(_req, res) {
  const master = await ensureMasterAccount();
  res.json({
    settings: await getSettings(),
    cardScenarios: CARD_SCENARIOS,
    cardByLast4: CARD_BY_LAST4,
    faultKinds: Object.fromEntries(Object.entries(FAULT_KINDS).map(([key, value]) => [key, value.label])),
    routes: ROUTES.map((r) => ({ name: r.name, method: r.method, path: `/v1${r.pattern}` })),
    counts: {
      accounts: await iuguMockCount(KIND.account),
      invoices: await iuguMockCount(KIND.invoice),
      customers: await iuguMockCount(KIND.customer),
      payment_methods: await iuguMockCount(KIND.paymentMethod),
    },
    master: accountSummary(master),
    connection: {
      directUrl: 'http://svc-inbox_messages/iugu/v1/',
      proxyBaseUrl: 'http://svc-inbox_messages/iugu-proxy',
      proxyGreennToken: IUGU_MOCK.proxyGreennToken,
      publicUrl: IUGU_MOCK.publicUrl,
    },
  });
}

export async function listAccountsHandler(_req, res) {
  await ensureMasterAccount();
  const accounts = await iuguMockList(KIND.account, { limit: 10000 });
  const items = [];
  for (const account of accounts) items.push(accountSummary(account, await iuguMockCount(KIND.invoice, account.id)));
  items.sort((a, b) => (a.master === b.master ? 0 : a.master ? -1 : 1));
  res.json({ items });
}

export async function getAccountHandler(req, res) {
  const account = await iuguMockGet(KIND.account, req.params.id);
  if (!account) return res.status(404).json({ error: 'Conta não encontrada' });
  const invoices = await iuguMockList(KIND.invoice, { accountId: account.id, limit: 200 });
  const requests = await listIuguMockRequests({ accountId: account.id, limit: 50 });
  res.json({
    summary: accountSummary(account, invoices.length),
    stored: account,
    iugu: accountView(account),
    sealed: {
      live_api_token: sealToken(account.live_api_token),
      test_api_token: sealToken(account.test_api_token),
      user_token: sealToken(account.user_token),
    },
    invoices: invoices.map(invoiceSummary),
    requests: requests.items,
  });
}

export async function createAccountHandler(req, res) {
  const account = newAccount(req.body?.name, IUGU_MOCK.masterAccountId);
  res.status(201).json(accountSummary(await iuguMockPut(KIND.account, account.id, account.id, account), 0));
}

export async function accountActionHandler(req, res) {
  const account = await iuguMockGet(KIND.account, req.params.id);
  if (!account) return res.status(404).json({ error: 'Conta não encontrada' });
  const { action } = req.body ?? {};
  if (action === 'verify') {
    const status = req.body.status === 'rejected' ? 'rejected' : 'accepted';
    const requested = Array.isArray(req.body.requested_documents) ? req.body.requested_documents : [];
    const saved = await setVerificationOutcome(account.id, status, { feedback: req.body.feedback ?? null, requestedDocuments: requested });
    return res.json(accountSummary(saved));
  }
  if (action === 'balance') {
    account.balance_cents = Math.round(Number(req.body.balance_cents) || 0);
  } else if (action === 'age') {
    // Pushes created_at back to exercise the 24h verification window.
    account.created_at = new Date(Date.now() - (Number(req.body.hours) || 25) * 3600 * 1000).toISOString();
  } else if (action === 'reset_verification') {
    account.verification = null;
    account.last_verification_request_status = null;
    account.is_verified = false;
    account.can_receive = false;
  } else if (action === 'reactivate') {
    account.active = true;
    account.deactivated_at = null;
  } else {
    return res.status(400).json({ error: `Ação desconhecida: ${action}` });
  }
  res.json(accountSummary(await iuguMockPut(KIND.account, account.id, account.id, account)));
}

export async function listInvoicesHandler(req, res) {
  const { account_id: accountId, status, q } = req.query ?? {};
  let invoices = await iuguMockList(KIND.invoice, { accountId: accountId || undefined, limit: 2000 });
  if (status) invoices = invoices.filter((invoice) => invoice.status === status);
  if (q) {
    const needle = String(q).toLowerCase();
    invoices = invoices.filter((invoice) =>
      [invoice.id, invoice.order_id, invoice.email, invoice.payer?.name, invoice.payer?.cpf_cnpj]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    );
  }
  res.json({ items: invoices.map(invoiceSummary) });
}

export async function getInvoiceHandler(req, res) {
  const invoice = await iuguMockGet(KIND.invoice, req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Fatura não encontrada' });
  const requests = await listIuguMockRequests({ invoiceId: invoice.id, limit: 100 });
  const view = invoiceView(invoice);
  res.json({ summary: invoiceSummary(invoice), stored: invoice, iugu: view, proxy: invoiceAllowlist(view), requests: requests.items });
}

export async function invoiceActionHandler(req, res) {
  const invoice = await iuguMockGet(KIND.invoice, req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Fatura não encontrada' });
  const { action } = req.body ?? {};
  const now = toIugu();
  const delay = { delayMs: 0 };
  const owner = await iuguMockGet(KIND.account, invoice.account_id);
  const debitOwner = async (cents) => {
    if (!owner) return;
    owner.balance_cents = Number(owner.balance_cents || 0) - cents;
    await iuguMockPut(KIND.account, owner.id, owner.id, owner);
  };
  const requireStatus = (...statuses) => {
    if (statuses.includes(invoice.status)) return true;
    res.status(400).json({ error: `Ação ${action} exige status ${statuses.join('/')}; atual: ${invoice.status}` });
    return false;
  };

  let saved;
  switch (action) {
    case 'pay':
      if (!requireStatus('pending')) return;
      saved = await payInvoice(invoice, { method: req.body.method, ...delay });
      break;
    case 'approve_analysis':
      if (!requireStatus('in_analysis')) return;
      saved = await payInvoice(invoice, { method: 'credit_card', card: invoice.pending_card, months: invoice.installments, ...delay });
      break;
    case 'refuse_analysis':
      if (!requireStatus('in_analysis')) return;
      invoice.credit_card_transaction = { ...(invoice.credit_card_transaction ?? {}), status: 'unauthorized', message: 'Recusado pelo antifraude', lr: '59', updated_at: now };
      saved = await transition(invoice, 'canceled', { canceled_at_iso: now }, delay);
      break;
    case 'expire':
      if (!requireStatus('pending')) return;
      saved = await transition(invoice, 'expired', { expired_at_iso: now }, delay);
      break;
    case 'cancel':
      if (!requireStatus('pending', 'in_analysis', 'expired')) return;
      saved = await transition(invoice, 'canceled', { canceled_at_iso: now }, delay);
      break;
    case 'refund': {
      if (!requireStatus('paid', 'partially_refunded')) return;
      const remaining = (invoice.paid_cents ?? 0) - (invoice.refunded_cents ?? 0);
      const amount = Math.min(remaining, Math.round(Number(req.body.amount_cents) || remaining));
      await debitOwner(amount);
      invoice.refunded_cents = (invoice.refunded_cents ?? 0) + amount;
      const fully = invoice.refunded_cents >= (invoice.paid_cents ?? 0);
      saved = await transition(invoice, fully ? 'refunded' : 'partially_refunded', { refunded_at_iso: now }, { event: 'invoice.refund', delayMs: 0 });
      break;
    }
    case 'chargeback':
      if (!requireStatus('paid', 'partially_refunded', 'in_protest')) return;
      await debitOwner((invoice.paid_cents ?? 0) - (invoice.refunded_cents ?? 0));
      saved = await transition(invoice, 'chargeback', { chargeback_at_iso: now }, delay);
      break;
    case 'protest':
      if (!requireStatus('paid', 'partially_refunded')) return;
      saved = await transition(invoice, 'in_protest', { protested_at_iso: now }, delay);
      break;
    case 'externally_paid':
      if (!requireStatus('pending', 'expired')) return;
      saved = await transition(invoice, 'externally_paid', { paid_at: now }, delay);
      break;
    case 'webhook': {
      const result = await sendInvoiceWebhook(invoice, req.body.event || 'invoice.status_changed');
      return res.json({ webhook: result, summary: invoiceSummary(invoice) });
    }
    default:
      return res.status(400).json({ error: `Ação desconhecida: ${action}` });
  }
  res.json(invoiceSummary(saved));
}

export async function listRequestsHandler(req, res) {
  const { limit, offset, channel, account_id: accountId, invoice_id: invoiceId } = req.query ?? {};
  res.json(
    await listIuguMockRequests({
      limit: Math.min(Number(limit) || 50, 500),
      offset: Number(offset) || 0,
      channel: channel || undefined,
      accountId: accountId || undefined,
      invoiceId: invoiceId || undefined,
    })
  );
}

export async function clearRequestsHandler(_req, res) {
  res.json({ removed: await clearIuguMockRequests() });
}

export async function getSettingsHandler(_req, res) {
  res.json(await getSettings());
}

export async function updateSettingsHandler(req, res) {
  res.json(await updateSettings(req.body ?? {}));
}

export async function resetHandler(_req, res) {
  const removed = await iuguMockClear();
  await ensureMasterAccount();
  res.json({ removed });
}
