import { Router } from 'express';
import {
  createLiquidacaoAntecipacaoHandler,
  deleteLiquidacaoAntecipacaoHandler,
  getLiquidacaoProcessamentoHandler,
  listLiquidacoesAntecipacaoHandler,
} from '../controllers/liquidacoes.controller.js';

const router = Router();

router.post('/slc/v1/liquidacoes-antecipacao', createLiquidacaoAntecipacaoHandler);
router.get('/slc/v1/liquidacoes-antecipacao', listLiquidacoesAntecipacaoHandler);
router.get('/slc/v1/liquidacoes/:numCtrlCip/processamento', getLiquidacaoProcessamentoHandler);
router.delete('/slc/v1/liquidacoes/:numCtrlCip', deleteLiquidacaoAntecipacaoHandler);

export default router;
