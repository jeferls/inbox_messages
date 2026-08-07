// Dispara o webhook da Konduto contra o greenn-back, o mesmo POST que a Konduto faria:
//
//   POST {GREENN_BACK_URL}/konduto/webhook  { order_id, status, timestamp }
//
// Em ambiente local `konduto.skip_signature_validation` está ligado, então o backend aceita
// a chamada sem o header X-Konduto-Signature.

import { GREENN_BACK_URL } from '../config/env.js';

const WEBHOOK_TIMEOUT_MS = 20000;

export async function sendKondutoWebhook({ orderId, status, backUrl }) {
  const base = (backUrl || GREENN_BACK_URL).replace(/\/+$/, '');
  const url = `${base}/konduto/webhook`;
  const payload = {
    order_id: orderId,
    status,
    // A Konduto manda o timestamp em segundos; o backend só valida se é numérico.
    timestamp: Math.floor(Date.now() / 1000),
  };

  const startedAt = Date.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  });

  const text = await response.text();
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
    request: payload,
    body,
    durationMs: Date.now() - startedAt,
  };
}
