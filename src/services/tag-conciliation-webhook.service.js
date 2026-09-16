// Dispara a notificação de conciliação de liquidação da TAG contra o greenn-back,
// o mesmo POST que a TAG faria ao detectar não conformidades (Res. BCB 514, art. 11):
//
//   POST {GREENN_BACK_URL}/webhook/tag-notification  { documentNumber, conciliationKey, urls }
//
// Os CSVs ficam num bucket GCS público que simula o bucket da TAG.

import crypto from 'node:crypto';
import { GREENN_BACK_URL, TAG_CONCILIATION } from '../config/env.js';

const WEBHOOK_TIMEOUT_MS = 20000;

export function listConciliationFiles() {
  return TAG_CONCILIATION.files.map((name) => ({
    name,
    url: `${TAG_CONCILIATION.bucketUrl}/${name}`,
  }));
}

export async function sendTagConciliationWebhook({ documentNumber, urls, backUrl }) {
  const base = (backUrl || GREENN_BACK_URL).replace(/\/+$/, '');
  const url = `${base}/webhook/tag-notification`;
  const payload = {
    documentNumber,
    conciliationKey: crypto.randomUUID(),
    urls,
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
