import {
  getEqualsConfig,
  getAllEqualsConfig,
  setEqualsConfig,
  resetEqualsConfig,
  insertEqualsReceivedTransaction,
  listEqualsReceivedTransactions,
  clearEqualsReceivedTransactions,
} from '../db/index.js';

// ─── Mock API endpoints (simulates the real Equals API) ───────────────────────

export function getEqualsListing(listKey) {
  return async (req, res) => {
    try {
      const data = await getEqualsConfig(listKey);
      if (!data) return res.status(404).json({ error: `Config '${listKey}' not found` });
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  };
}

export async function postEqualsTransacoes(req, res) {
  try {
    const payload = req.body;
    if (Array.isArray(payload) && payload.length > 0) {
      await insertEqualsReceivedTransaction(payload);
    }
    res.json({ success: true, received: Array.isArray(payload) ? payload.length : 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function getEqualsTransacoes(req, res) {
  res.json({ transacoes: [] });
}

export async function getEqualsTransacoesStatus(req, res) {
  res.json({ status: 'ok', processado: true });
}

// ─── Management endpoints (for the UI at /equals-mocks.html) ──────────────────

export async function getAllConfigHandler(req, res) {
  try {
    const config = await getAllEqualsConfig();
    res.json(config);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function getConfigHandler(req, res) {
  try {
    const { key } = req.params;
    const data = await getEqualsConfig(key);
    if (!data) return res.status(404).json({ error: 'Config not found' });
    res.json({ key, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function updateConfigHandler(req, res) {
  try {
    const { key } = req.params;
    const { data } = req.body;
    if (!Array.isArray(data)) {
      return res.status(400).json({ error: "'data' must be an array" });
    }
    const saved = await setEqualsConfig(key, data);
    res.json({ key, data: saved });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function resetConfigHandler(req, res) {
  try {
    const { key } = req.params;
    const saved = await resetEqualsConfig(key);
    if (!saved) return res.status(404).json({ error: `No default for key '${key}'` });
    res.json({ key, data: saved });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function listReceivedTransactionsHandler(req, res) {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));
    const offset = Math.max(0, Number(req.query.offset ?? 0));
    const result = await listEqualsReceivedTransactions({ limit, offset });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function clearReceivedTransactionsHandler(req, res) {
  try {
    const deleted = await clearEqualsReceivedTransactions();
    res.json({ ok: true, deleted });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
