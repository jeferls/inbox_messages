import {
  WEBHOOK_STATUSES,
  REPORT_WEBHOOK_STATUSES,
  buildImage,
  cancelScheduled,
  createProfile,
  createReport,
  getEnrichment,
  getProfile,
  getReport,
  getReportData,
  getState,
  listProfileFlows,
  recordImageRead,
  resetState,
  seedBiometry,
  sendFlowWebhook,
  sendReportWebhook,
  startFlow,
  updateProfile,
  updateSettings,
} from '../services/idwall-mock.service.js';
import { getRun } from '../services/idwall-regression.service.js';

// The regression run owns the mock settings and state while it is active.
function regressionRunning(res) {
  if (!['preflight', 'running'].includes(getRun()?.status)) return false;
  res.status(409).json({ error: 'A regressão está em execução: aguarde terminar ou cancele antes de alterar o mock.' });
  return true;
}

const reply = (res, { status, body }) => res.status(status).json(body);
const isSdk = (req) => req.path.endsWith('/sdk');

// ---------- IdWall API (called by greenn-back) ----------
export const createProfileHandler = (req, res) => reply(res, createProfile(req.body, { sdk: isSdk(req) }));
export const updateProfileHandler = (req, res) => reply(res, updateProfile(req.params.ref, req.body, { sdk: isSdk(req) }));
export const getProfileHandler = (req, res) => reply(res, getProfile(req.params.ref));
export const startFlowHandler = (req, res) => reply(res, startFlow(req.params.ref, req.params.flowId));
export const getEnrichmentHandler = (req, res) => reply(res, getEnrichment(req.params.ref));
export const createReportHandler = (req, res) => reply(res, createReport(req.body));
export const getReportHandler = (req, res) => reply(res, getReport(req.params.numero));
export const getReportDataHandler = (req, res) => reply(res, getReportData(req.params.numero));

export function listProfileFlowsHandler(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.max(1, Number(req.query.limit) || 100);
  reply(res, listProfileFlows(req.params.ref, page, limit));
}

export function getImageHandler(req, res) {
  // The IdWall tab loads thumbnails with ?preview=1; only greenn-back reads go to the timeline.
  if (req.query.preview === undefined) recordImageRead(req.params.name);
  res.type('image/png').send(buildImage(req.params.name));
}

// ---------- IdWall tab ----------
export const getStateHandler = (_req, res) => res.json(getState());

export function updateSettingsHandler(req, res) {
  if (regressionRunning(res)) return;
  try {
    res.json(updateSettings(req.body || {}));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}

export function resetStateHandler(_req, res) {
  if (regressionRunning(res)) return;
  resetState();
  res.json({ ok: true });
}

export function cancelScheduledHandler(req, res) {
  if (!cancelScheduled(req.params.id)) return res.status(404).json({ error: 'Agendamento não encontrado' });
  res.json({ ok: true });
}

export function seedBiometryHandler(req, res) {
  try {
    res.json(seedBiometry(String(req.params.ref), req.body?.documentType));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}

/** Manual webhook: the flowId must be a key of config('idwall.flows') in greenn-back. */
export async function sendFlowWebhookHandler(req, res) {
  const { userId, flowId, status } = req.body || {};

  if (!userId || !flowId) return res.status(400).json({ error: "'userId' e 'flowId' são obrigatórios" });
  if (!WEBHOOK_STATUSES.includes(status)) {
    return res.status(400).json({ error: `'status' precisa ser um de: ${WEBHOOK_STATUSES.join(', ')}` });
  }

  res.json(await sendFlowWebhook({ userId, flowId, status }));
}

export async function sendReportWebhookHandler(req, res) {
  const { protocolo, status } = req.body || {};

  if (!protocolo) return res.status(400).json({ error: "'protocolo' é obrigatório" });
  if (!REPORT_WEBHOOK_STATUSES.includes(status)) {
    return res.status(400).json({ error: `'status' precisa ser um de: ${REPORT_WEBHOOK_STATUSES.join(', ')}` });
  }

  res.json(await sendReportWebhook({ protocolo, status }));
}
