import { Router } from 'express';
import { sendPostbackHandler } from '../controllers/postback-gateway.controller.js';

const router = Router();

router.post('/postback-gateway/send', sendPostbackHandler);

export default router;
