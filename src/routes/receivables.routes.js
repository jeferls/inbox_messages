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
  runReceivableUnitProcessHandler,
  resetReceivableUnitTablesHandler,
  getSlcSettlementFlowHandler,
  setSlcSettlementFlowHandler,
  listReceivableUnitsHandler,
  getReceivableUnitHandler,
  listSaleStatementUnitsHandler,
  backdateSaleStatementUnitHandler,
  updateReceivableProcessHandler,
} from '../controllers/receivables.controller.js';

const router = Router();

router.post('/slc/v1/receivables', createReceivableProcessHandler);
router.get('/slc/v1/receivables', listReceivableProcessesHandler);
router.delete('/slc/v1/receivables', deleteAllReceivableProcessesHandler);
router.patch('/slc/v1/receivables/settlement', patchReceivableSettlementHandler);
router.get('/tag/conciliation/files', listConciliationFilesHandler);
router.post('/tag/conciliation/webhook', sendConciliationWebhookHandler);
router.post('/tag/receivable-units/process', runReceivableUnitProcessHandler);
router.post('/tag/receivable-units/reset', resetReceivableUnitTablesHandler);
router.get('/tag/settlement-flow', getSlcSettlementFlowHandler);
router.put('/tag/settlement-flow', setSlcSettlementFlowHandler);
router.get('/tag/receivable-units', listReceivableUnitsHandler);
router.get('/tag/receivable-units/:id', getReceivableUnitHandler);
router.get('/tag/sale-statement-units', listSaleStatementUnitsHandler);
router.post('/tag/sale-statement-units/:id/backdate', backdateSaleStatementUnitHandler);
router.get('/slc/v1/receivables/:processKey', getReceivableProcessHandler);
router.put('/slc/v1/receivables/:processKey', updateReceivableProcessHandler);
router.delete('/slc/v1/receivables/:processKey', deleteReceivableProcessHandler);

export default router;
