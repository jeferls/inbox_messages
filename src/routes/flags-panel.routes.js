import { Router } from 'express';
import { listFlags } from '../services/flags-panel.service.js';

const router = Router();

// Erros com `status` são de entrada/guard; os demais são falha de banco (502).
async function send(res, promise) {
  try {
    res.json(await promise);
  } catch (e) {
    res.status(e.status || 502).json({ error: e.status ? e.message : `Falha no banco do greenn-back: ${e.message}` });
  }
}

router.get('/flags-panel/flags', (req, res) => send(res, listFlags(req.query.path)));

export default router;
