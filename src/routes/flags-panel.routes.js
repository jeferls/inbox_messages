import { Router } from 'express';
import { listFlags, toggleFlag, listUserFlags, listFlagsOfUser, addUserFlag, removeUserFlag, removeAllUserFlags } from '../services/flags-panel.service.js';

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
router.put('/flags-panel/flag', (req, res) => send(res, toggleFlag(req.body?.path, req.body?.flag, req.body?.enabled)));
router.get('/flags-panel/user-flags', (req, res) =>
  send(res, req.query.user ? listFlagsOfUser(req.query.path, req.query.user) : listUserFlags(req.query.path, req.query.flag)));
router.post('/flags-panel/user-flags', (req, res) => send(res, addUserFlag(req.body?.path, req.body?.flag, req.body?.user)));
router.delete('/flags-panel/user-flags', (req, res) =>
  send(res, req.body?.user ? removeAllUserFlags(req.body.path, req.body.user) : removeUserFlag(req.body?.path, req.body?.id)));

export default router;
