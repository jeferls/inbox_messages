import { Router } from 'express';
import {
  listProductsHandler,
  loadProductHandler,
  runPaymentHandler,
} from '../controllers/payment-tester.controller.js';

const router = Router();

router.get('/payment-tester/seller/:sellerId/products', listProductsHandler);
router.post('/payment-tester/product', loadProductHandler);
router.post('/payment-tester/run', runPaymentHandler);

export default router;
