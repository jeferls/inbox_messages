import { Router } from 'express';
import { LOG_FILE, LOG_MAX_TAIL_BYTES } from '../config/env.js';
import { tailLogBytes, clearLogs } from '../utils/logger.js';

const router = Router();

// GET /api/logs?bytes=65536
router.get('/logs', async (req, res) => {
  try {
    const q = Number(req.query.bytes || 65536);
    const max = Math.max(1, Math.min(LOG_MAX_TAIL_BYTES, Number.isFinite(q) ? q : 65536));
    const text = await tailLogBytes(max);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(text);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Falha ao obter logs' });
  }
});

// DELETE /api/logs (truncate)
router.delete('/logs', async (_req, res) => {
  try {
    await clearLogs();
    res.json({ ok: true, file: LOG_FILE });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Falha ao limpar logs' });
  }
});

export default router;

