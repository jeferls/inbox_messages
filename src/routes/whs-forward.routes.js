import { Router } from 'express';
import {
  checkHandler,
  createHandler,
  deleteHandler,
  listHandler,
  logHandler,
  resetHandler,
  startHandler,
  stopHandler,
  updateHandler,
} from '../controllers/whs-forward.controller.js';

const router = Router();

router.get('/whs-forward/forwarders', listHandler);
router.post('/whs-forward/forwarders', createHandler);
router.put('/whs-forward/forwarders/:id', updateHandler);
router.delete('/whs-forward/forwarders/:id', deleteHandler);
router.post('/whs-forward/forwarders/:id/start', startHandler);
router.post('/whs-forward/forwarders/:id/stop', stopHandler);
router.post('/whs-forward/forwarders/:id/reset', resetHandler);
router.get('/whs-forward/forwarders/:id/log', logHandler);
router.post('/whs-forward/check', checkHandler);

export default router;
