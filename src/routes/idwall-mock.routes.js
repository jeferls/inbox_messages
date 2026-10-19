import { Router } from 'express';
import {
  cancelScheduledHandler,
  createProfileHandler,
  createReportHandler,
  getEnrichmentHandler,
  getImageHandler,
  getProfileHandler,
  getReportDataHandler,
  getReportHandler,
  getStateHandler,
  listProfileFlowsHandler,
  resetStateHandler,
  seedBiometryHandler,
  sendFlowWebhookHandler,
  sendReportWebhookHandler,
  startFlowHandler,
  updateProfileHandler,
  updateSettingsHandler,
} from '../controllers/idwall-mock.controller.js';

const router = Router();

// Replaces https://api-v3.idwall.co (maestro) once greenn-back is patched
router.post('/idwall/v3/maestro/profile', createProfileHandler);
router.post('/idwall/v3/maestro/profile/sdk', createProfileHandler);
router.get('/idwall/v3/maestro/profile/:ref', getProfileHandler);
router.put('/idwall/v3/maestro/profile/:ref', updateProfileHandler);
router.put('/idwall/v3/maestro/profile/:ref/sdk', updateProfileHandler);
router.post('/idwall/v3/maestro/profile/:ref/flow/:flowId', startFlowHandler);
router.get('/idwall/v3/maestro/profile/:ref/profileFlows', listProfileFlowsHandler);
router.get('/idwall/v3/maestro/profile-enrichment/by-profile-ref/:ref', getEnrichmentHandler);
router.get('/idwall/v3/files/:name', getImageHandler);

// Replaces https://api-v2.idwall.co (relatorios)
router.post('/idwall/v2/relatorios', createReportHandler);
router.get('/idwall/v2/relatorios/:numero', getReportHandler);
router.get('/idwall/v2/relatorios/:numero/dados', getReportDataHandler);

// IdWall tab
router.get('/api/idwall-mock/state', getStateHandler);
router.put('/api/idwall-mock/settings', updateSettingsHandler);
router.delete('/api/idwall-mock/state', resetStateHandler);
router.delete('/api/idwall-mock/scheduled/:id', cancelScheduledHandler);
router.post('/api/idwall-mock/profiles/:ref/biometry', seedBiometryHandler);
router.post('/api/idwall-mock/webhooks/flow', sendFlowWebhookHandler);
router.post('/api/idwall-mock/webhooks/report', sendReportWebhookHandler);

export default router;
