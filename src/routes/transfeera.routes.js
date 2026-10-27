import { Router } from 'express';
import { getConfigHandler, getWithdrawHandler, sendWebhookHandler } from '../controllers/transfeera.controller.js';

const router = Router();

router.get('/transfeera/config', getConfigHandler);
router.get('/transfeera/withdrawals/:id', getWithdrawHandler);
router.post('/transfeera/webhook', sendWebhookHandler);

export default router;
