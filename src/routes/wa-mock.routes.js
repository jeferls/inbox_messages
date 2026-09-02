import { Router } from 'express';
import {
  clearHandler,
  configHandler,
  eventsHandler,
  graphMessagesHandler,
  graphUnsupportedHandler,
  inboundHandler,
  stateHandler,
  templatesHandler,
} from '../controllers/wa-mock.controller.js';

const router = Router();

// Endpoint que substitui a WhatsApp Cloud API (base https://graph.facebook.com/v20.0)
router.post('/:version(v\\d+(?:\\.\\d+)?)/:phoneNumberId/messages', graphMessagesHandler);
router.all('/:version(v\\d+(?:\\.\\d+)?)/*', graphUnsupportedHandler);

// Endpoints internos usados pela aba WhatsApp
router.get('/api/wa-mock/events', eventsHandler);
router.get('/api/wa-mock/state', stateHandler);
router.get('/api/wa-mock/templates', templatesHandler);
router.post('/api/wa-mock/inbound', inboundHandler);
router.post('/api/wa-mock/config', configHandler);
router.post('/api/wa-mock/clear', clearHandler);

export default router;
