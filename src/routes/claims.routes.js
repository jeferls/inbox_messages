import { Router } from 'express';
import {
  sendClaimHandler,
  resendClaimSecretHandler,
  listRecentSalesHandler,
  getSaleHandler,
} from '../controllers/claims.controller.js';

const router = Router();

router.post('/claims/send', sendClaimHandler);
router.get('/claims/secret', resendClaimSecretHandler);
router.get('/claims/sales', listRecentSalesHandler);
router.get('/claims/sales/:id', getSaleHandler);

export default router;
