import {
  listSubscriptions,
  listSubscriptionCharges,
  backdateRecurrenceDates,
} from '../services/subscriptions.service.js';
import { execInContainer, isDockerAvailable } from '../services/docker.service.js';
import { SUBSCRIPTION_CONTAINER } from '../config/env.js';

export async function listSubscriptionsHandler(req, res) {
  try {
    const { status, search, limit, page } = req.query;
    res.json(await listSubscriptions({ status, search, limit, page }));
  } catch (e) {
    res.status(502).json({ error: `Falha ao listar assinaturas: ${e.message}` });
  }
}

export async function listSubscriptionChargesHandler(req, res) {
  try {
    res.json({ charges: await listSubscriptionCharges(req.params.id) });
  } catch (e) {
    res.status(502).json({ error: `Falha ao listar cobranças: ${e.message}` });
  }
}

// Roda o mesmo comando que a fila de recorrência dispara em produção:
// `php artisan command:RecurrenceBySubscriptionId --id=<id>` no container de assinaturas.
export async function runRecurrenceHandler(req, res) {
  const subscriptionId = String(req.params.id || '');
  if (!/^[A-Za-z0-9_-]+$/.test(subscriptionId)) {
    return res.status(400).json({ error: "'id' inválido" });
  }

  if (!isDockerAvailable()) {
    return res.status(503).json({ error: 'Socket do Docker não está montado neste container' });
  }

  const command = ['php', 'artisan', 'command:RecurrenceBySubscriptionId', `--id=${subscriptionId}`];

  try {
    const backdate = await backdateRecurrenceDates(subscriptionId);
    const result = await execInContainer(SUBSCRIPTION_CONTAINER, command);
    res.json({
      ok: result.exitCode === 0,
      backdate,
      container: SUBSCRIPTION_CONTAINER,
      command: command.join(' '),
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  } catch (e) {
    res.status(502).json({ error: `Falha ao executar o comando: ${e.message}` });
  }
}
