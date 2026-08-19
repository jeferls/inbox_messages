import { Router } from 'express';
import { mobileStatus, mobileAction, isDockerAvailable } from '../services/docker.service.js';

const router = Router();

router.get('/docker/mobile', async (req, res) => {
  if (!isDockerAvailable()) {
    return res.status(503).json({ error: 'Socket do Docker não está montado neste container' });
  }
  try {
    res.json({ services: await mobileStatus() });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

router.post('/docker/mobile/:action', async (req, res) => {
  const { action } = req.params;
  if (action !== 'up' && action !== 'down') return res.status(400).json({ error: 'Ação inválida' });
  if (!isDockerAvailable()) {
    return res.status(503).json({ error: 'Socket do Docker não está montado neste container' });
  }
  try {
    res.json({ results: await mobileAction(action) });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

export default router;
