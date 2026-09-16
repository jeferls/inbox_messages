import { Router } from 'express';
import {
  createReceivableProcessHandler,
  deleteAllReceivableProcessesHandler,
  deleteReceivableProcessHandler,
  getReceivableProcessHandler,
  listConciliationFilesHandler,
  listReceivableProcessesHandler,
  sendConciliationWebhookHandler,
  patchReceivableSettlementHandler,
  updateReceivableProcessHandler,
} from '../controllers/receivables.controller.js';

const router = Router();

router.post('/slc/v1/receivables', createReceivableProcessHandler);
router.get('/slc/v1/receivables', listReceivableProcessesHandler);
router.delete('/slc/v1/receivables', deleteAllReceivableProcessesHandler);
router.patch('/slc/v1/receivables/settlement', patchReceivableSettlementHandler);
router.get('/tag/conciliation/files', listConciliationFilesHandler);
router.post('/tag/conciliation/webhook', sendConciliationWebhookHandler);
router.get('/slc/v1/receivables/:processKey', getReceivableProcessHandler);
router.put('/slc/v1/receivables/:processKey', updateReceivableProcessHandler);
router.delete('/slc/v1/receivables/:processKey', deleteReceivableProcessHandler);

export default router;
