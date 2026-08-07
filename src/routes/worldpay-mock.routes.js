import express, { Router } from 'express';
import { BODY_LIMIT } from '../config/env.js';
import {
  paymentServiceHandler,
  listScenariosHandler,
  getActiveScenarioHandler,
  setActiveScenarioHandler,
  listTransactionsHandler,
  clearTransactionsHandler,
} from '../controllers/worldpay-mock.controller.js';

const router = Router();

// A gateway envia text/xml; o express.json global não consome esse corpo, então o parser
// de texto entra aqui, na rota.
const xmlBody = express.text({
  type: ['text/xml', 'application/xml', 'text/plain', 'application/x-www-form-urlencoded'],
  limit: BODY_LIMIT === Infinity ? '100mb' : BODY_LIMIT,
});

// Endpoint que substitui a API da Worldpay (WORLDPAY_API_URL)
router.post('/worldpay/paymentService', xmlBody, paymentServiceHandler);
router.post('/worldpay/paymentService/:scenario', xmlBody, paymentServiceHandler);

// Catálogo e histórico
router.get('/api/gateway-mocks/worldpay/scenarios', listScenariosHandler);
router.get('/api/gateway-mocks/worldpay/active', getActiveScenarioHandler);
router.put('/api/gateway-mocks/worldpay/active', setActiveScenarioHandler);
router.get('/api/gateway-mocks/worldpay/transactions', listTransactionsHandler);
router.delete('/api/gateway-mocks/worldpay/transactions', clearTransactionsHandler);

export default router;
