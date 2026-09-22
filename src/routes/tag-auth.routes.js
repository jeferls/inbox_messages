import { Router } from 'express';

const router = Router();

// Mock do POST /token da TAG: o greenn-back só lê access_token e guarda por 1 dia.
router.post('/token', (_req, res) => {
  res.json({ access_token: 'mock-tag-token', token_type: 'Bearer', expires_in: 86400 });
});

export default router;
