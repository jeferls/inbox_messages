// Dispara o webhook de transferência da Transfeera contra o greenn-back, assinado como a
// Transfeera assina (docs.transfeera.dev, "Verificação da assinatura"):
//
//   POST {GREENN_BACK_URL}/api/withdraw/group/webhook
//   Transfeera-Signature: t=<unix timestamp>,v1=<HMAC-SHA256 hex de `${t}.${rawBody}`>
//
// O corpo é serializado uma única vez: a mesma string assinada é a enviada.
// Os modos de assinatura além de "valid" existem para provar o antes/depois do SUS-202.

import crypto from 'node:crypto';
import { GREENN_BACK_URL, TRANSFEERA_WEBHOOK_SECRET } from '../config/env.js';
import { getGreennPool } from './greenn-db.js';

const WEBHOOK_TIMEOUT_MS = 20000;
const STALE_SECONDS = 3600;

export const DEFAULT_ACCOUNT_ID = '6f2d1c3a-8b4e-4f7a-9c2d-1e5b7a9c3d40';

export const SIGNATURE_MODES = ['valid', 'invalid', 'missing', 'stale', 'malformed'];

// Status que o handler do greenn-back trata; qualquer outro texto é aceito como livre.
export const KNOWN_STATUSES = {
  FINALIZADO: 'Transferência finalizada',
  TRANSFERIDO: 'Transferência realizada',
  FALHA: 'Falha na transferência',
  DEVOLVIDO: 'Transferência devolvida',
};

export function signTransfeera(timestamp, rawBody, secret) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

/** Monta o header Transfeera-Signature do modo pedido; `null` quando o modo é sem header. */
export function buildSignatureHeader(mode, { rawBody, secret, now = Date.now() }) {
  const t = Math.floor(now / 1000);

  switch (mode) {
    case 'valid':
      return `t=${t},v1=${signTransfeera(t, rawBody, secret)}`;
    case 'invalid':
      return `t=${t},v1=${crypto.randomBytes(32).toString('hex')}`;
    case 'missing':
      return null;
    case 'stale': {
      const old = t - STALE_SECONDS;
      return `t=${old},v1=${signTransfeera(old, rawBody, secret)}`;
    }
    case 'malformed':
      return `assinatura-malformada-${t}`;
    default:
      throw new Error(`Modo de assinatura inválido: ${mode}`);
  }
}

export function maskSecret(secret) {
  if (!secret) return '';
  if (secret.length <= 8) return '*'.repeat(secret.length);
  return `${secret.slice(0, 4)}${'*'.repeat(8)}${secret.slice(-4)}`;
}

function randomAlnum(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.randomBytes(length), (b) => chars[b % chars.length]).join('');
}

// E + ISPB (8) + yyyyMMddHHmm (12) + 11 alfanuméricos = 32 caracteres.
function pixEndToEndId(date) {
  const stamp = date.toISOString().replace(/[-:T]/g, '').slice(0, 12);
  return `E13935893${stamp}${randomAlnum(11)}`;
}

export function buildTransferPayload({ withdraw, status, accountId, now = new Date() }) {
  const iso = now.toISOString();
  const day = iso.slice(0, 10);
  const transferId = crypto.randomUUID();

  return {
    id: crypto.randomUUID(),
    version: 'v1',
    account_id: accountId || DEFAULT_ACCOUNT_ID,
    object: 'Transfer',
    date: iso,
    data: {
      id: transferId,
      value: withdraw.amount,
      status,
      status_description: KNOWN_STATUSES[status] || status,
      error: null,
      integration_id: String(withdraw.id),
      idempotency_key: crypto.randomUUID(),
      created_at: iso,
      payment_date: day,
      finish_date: iso,
      transfer_date: iso,
      returned_date: status === 'DEVOLVIDO' ? iso : null,
      batch_id: crypto.randomUUID(),
      receipt_url: `https://api.transfeera.com/transfer/${transferId}/receipt`,
      bank_receipt_url: `https://api.transfeera.com/transfer/${transferId}/bank_receipt`,
      pix_end2end_id: pixEndToEndId(now),
      authorization_code: randomAlnum(12).toUpperCase(),
      payment_method: 'PIX',
    },
  };
}

export async function getWithdraw(id) {
  const [rows] = await getGreennPool().query(
    'SELECT id, status, amount, updated_at FROM withdrawals WHERE id = ?',
    [id],
  );
  return rows[0] || null;
}

export async function sendTransfeeraWebhook({ withdrawId, status, mode, secret, accountId, backUrl }) {
  const withdrawBefore = await getWithdraw(withdrawId);
  if (!withdrawBefore) {
    const error = new Error(`Saque ${withdrawId} não encontrado em withdrawals`);
    error.statusCode = 404;
    throw error;
  }

  const effectiveSecret = secret || TRANSFEERA_WEBHOOK_SECRET;
  if (!effectiveSecret && (mode === 'valid' || mode === 'stale')) {
    const error = new Error('Segredo não configurado: defina TRANSFEERA_WEBHOOK_SECRET ou informe na tela');
    error.statusCode = 400;
    throw error;
  }

  const base = (backUrl || GREENN_BACK_URL).replace(/\/+$/, '');
  const url = `${base}/api/withdraw/group/webhook`;
  const payload = buildTransferPayload({ withdraw: withdrawBefore, status, accountId });
  const rawBody = JSON.stringify(payload);
  const signature = buildSignatureHeader(mode, { rawBody, secret: effectiveSecret });

  const headers = { 'content-type': 'application/json' };
  if (signature !== null) headers['Transfeera-Signature'] = signature;

  const startedAt = Date.now();
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: rawBody,
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  });

  const text = await response.text();
  const durationMs = Date.now() - startedAt;
  let body;

  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  return {
    ok: response.ok,
    status: response.status,
    url,
    mode,
    secret: { source: secret ? 'tela' : 'env', masked: maskSecret(effectiveSecret) },
    request: { headers, body: rawBody },
    body,
    durationMs,
    withdrawBefore,
    withdrawAfter: await getWithdraw(withdrawId),
  };
}
