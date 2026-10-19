import {
  cancelRun,
  getRun,
  listScenarios,
  preflight,
  startRun,
  startWorkers,
} from '../services/idwall-regression.service.js';

export const listScenariosHandler = (_req, res) => res.json(listScenarios());
export const getRunHandler = (_req, res) => res.json(getRun());

export async function preflightHandler(_req, res) {
  try {
    res.json(await preflight());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export function startRunHandler(req, res) {
  try {
    res.status(202).json(startRun(req.body?.ids));
  } catch (error) {
    res.status(409).json({ error: error.message });
  }
}

export function cancelRunHandler(_req, res) {
  if (!cancelRun()) return res.status(409).json({ error: 'Nenhuma execução em andamento' });
  res.json({ ok: true });
}

export async function startWorkersHandler(_req, res) {
  try {
    res.json({ started: await startWorkers() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
