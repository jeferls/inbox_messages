import {
  DEFAULT_ACCOUNT_ID,
  KNOWN_STATUSES,
  SIGNATURE_MODES,
  getWithdraw,
  maskSecret,
  sendTransfeeraWebhook,
} from '../services/transfeera-webhook.service.js';
import { TRANSFEERA_WEBHOOK_SECRET } from '../config/env.js';

function parseWithdrawId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Padrões da tela: status conhecidos, modos e o segredo da env (mascarado). */
export function getConfigHandler(_req, res) {
  res.json({
    statuses: Object.keys(KNOWN_STATUSES),
    modes: SIGNATURE_MODES,
    defaultAccountId: DEFAULT_ACCOUNT_ID,
    envSecret: maskSecret(TRANSFEERA_WEBHOOK_SECRET),
  });
}

export async function getWithdrawHandler(req, res) {
  const id = parseWithdrawId(req.params.id);
  if (!id) return res.status(400).json({ error: "'id' precisa ser um inteiro positivo" });

  try {
    const withdraw = await getWithdraw(id);
    if (!withdraw) return res.status(404).json({ error: `Saque ${id} não encontrado` });
    res.json(withdraw);
  } catch (error) {
    res.status(502).json({ error: `Falha ao consultar o saque: ${error.message}` });
  }
}

/** Dispara o webhook de transferência para um saque com o modo de assinatura escolhido. */
export async function sendWebhookHandler(req, res) {
  const { withdrawId, status, mode, secret, accountId, backUrl } = req.body || {};
  const id = parseWithdrawId(withdrawId);

  if (!id) return res.status(400).json({ error: "'withdrawId' precisa ser um inteiro positivo" });

  if (typeof status !== 'string' || !status.trim() || status.length > 64) {
    return res.status(400).json({ error: "'status' é obrigatório (até 64 caracteres)" });
  }

  if (!SIGNATURE_MODES.includes(mode)) {
    return res.status(400).json({ error: `'mode' precisa ser um de: ${SIGNATURE_MODES.join(', ')}` });
  }

  try {
    // A resposta do backend vai como 200 mesmo quando ele recusa (401/500):
    // a tela mostra status e corpo para comparar antes/depois da correção.
    res.json(
      await sendTransfeeraWebhook({
        withdrawId: id,
        status: status.trim(),
        mode,
        secret: typeof secret === 'string' ? secret.trim() : '',
        accountId: typeof accountId === 'string' ? accountId.trim() : '',
        backUrl,
      }),
    );
  } catch (error) {
    res.status(error.statusCode || 502).json({ error: `Falha ao disparar o webhook: ${error.message}` });
  }
}
