import { Router } from 'express';
import { listRecentSalesHandler, getSaleHandler } from '../controllers/sales.controller.js';

const router = Router();

router.get('/sales', listRecentSalesHandler);
router.get('/sales/:id', getSaleHandler);

export default router;
