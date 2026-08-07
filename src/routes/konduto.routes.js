import { Router } from 'express';
import {
  getKondutoFlagHandler,
  listAnalysesHandler,
  sendWebhookHandler,
  setKondutoFlagHandler,
} from '../controllers/konduto.controller.js';

const router = Router();

router.get('/konduto/flag', getKondutoFlagHandler);
router.put('/konduto/flag', setKondutoFlagHandler);
router.get('/konduto/analyses', listAnalysesHandler);
router.post('/konduto/analyses/webhook', sendWebhookHandler);

export default router;
