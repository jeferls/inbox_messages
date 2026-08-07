import { getGlobalFlag, setGlobalFlag } from '../services/global-flags.service.js';
import { ANALYSIS_GROUPS, listAnalyses } from '../services/konduto-analysis.service.js';
import { sendKondutoWebhook } from '../services/konduto-webhook.service.js';

// A flag lida pelo backend em `config('konduto.user_flag')`.
const KONDUTO_FLAG = 'KONDUTO_ENABLED';

// Os dois status que as ações da tela disparam. O backend aceita outros
// (NOT_AUTHORIZED, CANCELED, FRAUD, PENDING), mas aqui só interessam aprovar/reprovar.
const WEBHOOK_STATUSES = ['APPROVED', 'DECLINED'];

export async function getKondutoFlagHandler(_req, res) {
  try {
    res.json(await getGlobalFlag(KONDUTO_FLAG));
  } catch (error) {
    res.status(502).json({ error: `Falha ao consultar a flag: ${error.message}` });
  }
}

export async function setKondutoFlagHandler(req, res) {
  const { enabled } = req.body || {};

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: "'enabled' precisa ser booleano" });
  }

  try {
    res.json(await setGlobalFlag(KONDUTO_FLAG, enabled));
  } catch (error) {
    res.status(502).json({ error: `Falha ao atualizar a flag: ${error.message}` });
  }
}

export async function listAnalysesHandler(req, res) {
  const { group, search, limit, page } = req.query;

  if (group && !ANALYSIS_GROUPS[group]) {
    return res.status(400).json({ error: `Aba inválida. Use uma de: ${Object.keys(ANALYSIS_GROUPS).join(', ')}` });
  }

  try {
    res.json(await listAnalyses({ group, search, limit, page }));
  } catch (error) {
    res.status(502).json({ error: `Falha ao consultar as análises: ${error.message}` });
  }
}

/** Dispara o webhook da Konduto para uma análise (aprovar ou reprovar). */
export async function sendWebhookHandler(req, res) {
  const { orderId, status, backUrl } = req.body || {};

  if (!orderId || typeof orderId !== 'string') {
    return res.status(400).json({ error: "'orderId' é obrigatório" });
  }

  if (!WEBHOOK_STATUSES.includes(status)) {
    return res.status(400).json({ error: `'status' precisa ser um de: ${WEBHOOK_STATUSES.join(', ')}` });
  }

  try {
    // O resultado do backend vai como 200 mesmo quando ele recusa (422/400):
    // a tela mostra o corpo da resposta para o usuário entender o motivo.
    res.json(await sendKondutoWebhook({ orderId, status, backUrl }));
  } catch (error) {
    res.status(502).json({ error: `Falha ao disparar o webhook: ${error.message}` });
  }
}
