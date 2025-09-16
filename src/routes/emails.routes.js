import { Router } from 'express';
import { createEmail, listEmailsHandler, getEmailHandler, clearEmailsHandler } from '../controllers/emails.controller.js';

const router = Router();

router.post('/emails', createEmail);
router.post('/send', createEmail);
router.get('/emails', listEmailsHandler);
router.get('/emails/:id', getEmailHandler);
router.delete('/emails', clearEmailsHandler);

export default router;

