import { Router } from 'express';
import {
  getEqualsListing,
  postEqualsTransacoes,
  getEqualsTransacoes,
  getEqualsTransacoesStatus,
} from '../controllers/equals-mock.controller.js';

const router = Router();

router.get('/adquirentes', getEqualsListing('adquirentes'));
router.get('/bandeiras', getEqualsListing('bandeiras'));
router.get('/formas-de-pagamento', getEqualsListing('formas-de-pagamento'));
router.get('/meios-de-captura', getEqualsListing('meios-de-captura'));
router.get('/transacoes/status', getEqualsTransacoesStatus);
router.get('/transacoes', getEqualsTransacoes);
router.post('/transacoes', postEqualsTransacoes);

export default router;
