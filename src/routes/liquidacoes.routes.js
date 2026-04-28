import { Router } from 'express';
import {
  createLiquidacaoAntecipacaoHandler,
  deleteAllLiquidacoesAntecipacaoHandler,
  deleteLiquidacaoAntecipacaoHandler,
  getLiquidacaoAntecipacaoByIdHandler,
  getLiquidacaoProcessamentoHandler,
  listLiquidacoesAntecipacaoHandler,
  updateLiquidacaoAntecipacaoHandler,
} from '../controllers/liquidacoes.controller.js';

const router = Router();

router.post('/slc/v1/liquidacoes-antecipacao', createLiquidacaoAntecipacaoHandler);
router.get('/slc/v1/liquidacoes-antecipacao', listLiquidacoesAntecipacaoHandler);
router.delete('/slc/v1/liquidacoes-antecipacao', deleteAllLiquidacoesAntecipacaoHandler);
router.get('/slc/v1/liquidacoes/:numCtrlCip/processamento', getLiquidacaoProcessamentoHandler);
router.get('/slc/v1/liquidacoes/:numCtrlCip', getLiquidacaoAntecipacaoByIdHandler);
router.put('/slc/v1/liquidacoes/:numCtrlCip', updateLiquidacaoAntecipacaoHandler);
router.delete('/slc/v1/liquidacoes/:numCtrlCip', deleteLiquidacaoAntecipacaoHandler);

export default router;
