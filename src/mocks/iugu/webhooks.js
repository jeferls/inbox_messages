import { insertIuguMockRequest } from '../../db/index.js';
import { IUGU_MOCK } from '../../config/env.js';
import { getSettings } from './state.js';

/** Default wait before a webhook goes out: the caller must have saved its charge first. */
const DEFAULT_DELAY_MS = 3000;

/** Iugu sends gatilhos as application/x-www-form-urlencoded with `event` and `data[...]`. */
export function invoiceWebhookForm(invoice, event) {
  const form = new URLSearchParams();
  form.set('event', event);
  form.set('data[id]', invoice.id);
  form.set('data[status]', invoice.status);
  form.set('data[account_id]', invoice.account_id);
  if (invoice.payment_method) form.set('data[payment_method]', invoice.payment_method);
  if (invoice.paid_at) form.set('data[paid_at]', invoice.paid_at);
  if (invoice.paid_cents != null) form.set('data[paid_cents]', String(invoice.paid_cents));
  if (invoice.payer?.cpf_cnpj) form.set('data[payer_cpf_cnpj]', invoice.payer.cpf_cnpj);
  if (event === 'invoice.refund') form.set('data[refunded_cents]', String(invoice.refunded_cents ?? 0));
  return form;
}

export async function sendInvoiceWebhook(invoice, event, { url } = {}) {
  const settings = await getSettings();
  const target = url || settings.webhookUrl;
  const form = invoiceWebhookForm(invoice, event);
  const startedAt = Date.now();
  let status = 0;
  let responseBody = null;
  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(IUGU_MOCK.webhookTimeoutMs),
    });
    status = res.status;
    const text = await res.text();
    try {
      responseBody = JSON.parse(text);
    } catch {
      responseBody = text.slice(0, 4000);
    }
  } catch (err) {
    responseBody = { error: String(err?.message ?? err) };
  }
  await insertIuguMockRequest({
    channel: 'webhook',
    method: 'POST',
    path: target,
    route: event,
    accountId: invoice.account_id,
    invoiceId: invoice.id,
    status,
    requestBody: Object.fromEntries(form.entries()),
    responseBody,
    durationMs: Date.now() - startedAt,
  });
  return { status, body: responseBody };
}

/** Fire-and-forget when autoWebhooks is on. */
export async function queueInvoiceWebhook(invoice, event, { delayMs } = {}) {
  const settings = await getSettings();
  if (!settings.autoWebhooks) return;
  const wait = delayMs ?? DEFAULT_DELAY_MS;
  setTimeout(() => {
    sendInvoiceWebhook(invoice, event).catch(() => {});
  }, wait);
}
