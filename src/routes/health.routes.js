import { Router } from 'express';

const router = Router();

router.get('/health', (req, res) => {
  res.json({ ok: true });
});

export default router;

