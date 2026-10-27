import { Router } from 'express';
import {
  cancelRunHandler,
  getRunHandler,
  listScenariosHandler,
  preflightHandler,
  startRunHandler,
  startWorkersHandler,
} from '../controllers/idwall-regression.controller.js';

const router = Router();

router.get('/idwall-regression/scenarios', listScenariosHandler);
router.get('/idwall-regression/preflight', preflightHandler);
router.post('/idwall-regression/workers', startWorkersHandler);
router.get('/idwall-regression/run', getRunHandler);
router.post('/idwall-regression/run', startRunHandler);
router.post('/idwall-regression/run/cancel', cancelRunHandler);

export default router;
