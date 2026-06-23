import { Router } from 'express';
import {
  getAllConfigHandler,
  getConfigHandler,
  updateConfigHandler,
  resetConfigHandler,
  listReceivedTransactionsHandler,
  clearReceivedTransactionsHandler,
} from '../controllers/equals-mock.controller.js';

const router = Router();

router.get('/equals-mock/config', getAllConfigHandler);
router.get('/equals-mock/config/:key', getConfigHandler);
router.put('/equals-mock/config/:key', updateConfigHandler);
router.post('/equals-mock/config/:key/reset', resetConfigHandler);
router.get('/equals-mock/transactions', listReceivedTransactionsHandler);
router.delete('/equals-mock/transactions', clearReceivedTransactionsHandler);

export default router;
