import { Router } from 'express';
import { listTemplatesHandler, sendTemplatesHandler } from '../controllers/email-templates.controller.js';

const router = Router();

router.get('/email-templates', listTemplatesHandler);
router.post('/email-templates/send', sendTemplatesHandler);

export default router;
