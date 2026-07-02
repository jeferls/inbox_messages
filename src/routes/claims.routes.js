import { Router } from 'express';
import { sendClaimHandler, resendClaimSecretHandler } from '../controllers/claims.controller.js';

const router = Router();

router.post('/claims/send', sendClaimHandler);
router.get('/claims/secret', resendClaimSecretHandler);

export default router;
