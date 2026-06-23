import { Router } from 'express';
import {
  createReceivableProcessHandler,
  deleteAllReceivableProcessesHandler,
  deleteReceivableProcessHandler,
  getReceivableProcessHandler,
  listReceivableProcessesHandler,
  patchReceivableSettlementHandler,
  updateReceivableProcessHandler,
} from '../controllers/receivables.controller.js';

const router = Router();

router.post('/receivable', createReceivableProcessHandler);
router.get('/receivable', listReceivableProcessesHandler);
router.delete('/receivable', deleteAllReceivableProcessesHandler);
router.patch('/receivable/settlement', patchReceivableSettlementHandler);
router.get('/receivable/:processKey', getReceivableProcessHandler);
router.put('/receivable/:processKey', updateReceivableProcessHandler);
router.delete('/receivable/:processKey', deleteReceivableProcessHandler);

export default router;
