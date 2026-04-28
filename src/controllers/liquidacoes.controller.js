import {
  createLiquidacaoAntecipacao,
  deleteAllLiquidacoesAntecipacao,
  deleteLiquidacaoAntecipacaoByNumCtrlCip,
  getLiquidacaoAntecipacaoByNumCtrlCip,
  getLiquidacaoAntecipacaoProcessamentoByNumCtrlCip,
  queryLiquidacoesAntecipacao,
  updateLiquidacaoAntecipacaoByNumCtrlCip,
} from '../db/index.js';

function validateRequisicaoPayload(payload) {
  const pontosVenda = payload?.grupoSLC0912Centrlz?.grupoSLC0912PontoVenda;
  if (!Array.isArray(pontosVenda) || pontosVenda.length === 0) {
    return 'Campo grupoSLC0912Centrlz.grupoSLC0912PontoVenda deve ser uma lista com ao menos 1 item';
  }
  if (pontosVenda.length > 1000) {
    return 'Campo grupoSLC0912Centrlz.grupoSLC0912PontoVenda suporta no maximo 1000 itens';
  }
  return null;
}

function randomDigits(length) {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += Math.floor(Math.random() * 10);
  }
  return out;
}

function buildProcessamentoFromPayload(payload) {
  const pontosVenda = payload?.grupoSLC0912Centrlz?.grupoSLC0912PontoVenda;
  const dtHrUltAlt = new Date().toISOString();
  const grupoPontoVendaActo = [];
  const grupoPontoVendaRecsdo = [];

  for (const ponto of pontosVenda) {
    const numCtrlCreddrPontoVenda = ponto?.numCtrlCreddrPontoVenda;
    if (!numCtrlCreddrPontoVenda) continue;

    if (Math.random() < 0.7) {
      grupoPontoVendaActo.push({
        numCtrlCreddrPontoVenda,
        nuLiquid: randomDigits(21),
      });
    } else {
      grupoPontoVendaRecsdo.push({
        numCtrlCreddrPontoVenda,
        atrbtErr: 'GrupoPontoVenda.DtPgto',
        codErro: 'ESLC0128',
      });
    }
  }

  return {
    situacao: 'F',
    dtHrUltAlt,
    grupoPontoVendaActo,
    grupoPontoVendaRecsdo,
  };
}

export async function createLiquidacaoAntecipacaoHandler(req, res) {
  try {
    const payload = req.body || {};
    const errMsg = validateRequisicaoPayload(payload);
    if (errMsg) return res.status(400).json({ error: errMsg });

    const processamento = buildProcessamentoFromPayload(payload);
    const created = await createLiquidacaoAntecipacao({
      payloadRequisicao: payload,
      payloadProcessamento: processamento,
    });

    return res.status(201).json(created);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao criar lote de liquidacao antecipacao' });
  }
}

export async function getLiquidacaoProcessamentoHandler(req, res) {
  try {
    const { numCtrlCip } = req.params;
    if (!numCtrlCip) {
      return res.status(400).json({ error: 'numCtrlCip e obrigatorio' });
    }

    const processamento = await getLiquidacaoAntecipacaoProcessamentoByNumCtrlCip(numCtrlCip);
    if (!processamento) {
      return res.status(404).json({ error: 'Lote nao encontrado' });
    }

    return res.json(processamento);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao buscar processamento do lote' });
  }
}

export async function listLiquidacoesAntecipacaoHandler(req, res) {
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
    let offset = Math.max(0, Number(req.query.offset) || 0);
    const page = req.query.page != null ? Math.max(0, Number(req.query.page) || 0) : null;
    if (page != null) offset = page * limit;

    const result = await queryLiquidacoesAntecipacao({ limit, offset });
    return res.json({ ...result, limit, offset });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao listar lotes' });
  }
}

export async function deleteAllLiquidacoesAntecipacaoHandler(req, res) {
  try {
    const deleted = await deleteAllLiquidacoesAntecipacao();
    return res.json({ ok: true, deleted });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao apagar todos os lotes' });
  }
}

export async function deleteLiquidacaoAntecipacaoHandler(req, res) {
  try {
    const { numCtrlCip } = req.params;
    if (!numCtrlCip) {
      return res.status(400).json({ error: 'numCtrlCip e obrigatorio' });
    }

    const deleted = await deleteLiquidacaoAntecipacaoByNumCtrlCip(numCtrlCip);
    if (!deleted) {
      return res.status(404).json({ error: 'Lote nao encontrado' });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao deletar lote' });
  }
}

export async function getLiquidacaoAntecipacaoByIdHandler(req, res) {
  try {
    const { numCtrlCip } = req.params;
    if (!numCtrlCip) {
      return res.status(400).json({ error: 'numCtrlCip e obrigatorio' });
    }

    const lote = await getLiquidacaoAntecipacaoByNumCtrlCip(numCtrlCip);
    if (!lote) {
      return res.status(404).json({ error: 'Lote nao encontrado' });
    }

    return res.json(lote);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao buscar lote' });
  }
}

export async function updateLiquidacaoAntecipacaoHandler(req, res) {
  try {
    const { numCtrlCip } = req.params;
    if (!numCtrlCip) {
      return res.status(400).json({ error: 'numCtrlCip e obrigatorio' });
    }

    const body = req.body || {};
    const hasRequisicao = Object.prototype.hasOwnProperty.call(body, 'requisicao');
    const hasProcessamento = Object.prototype.hasOwnProperty.call(body, 'processamento');

    if (!hasRequisicao && !hasProcessamento) {
      return res.status(400).json({
        error: 'Envie ao menos um dos campos: requisicao, processamento',
      });
    }

    if (hasRequisicao) {
      if (body.requisicao == null || typeof body.requisicao !== 'object' || Array.isArray(body.requisicao)) {
        return res.status(400).json({ error: 'Campo requisicao deve ser um objeto JSON' });
      }
      const errMsg = validateRequisicaoPayload(body.requisicao);
      if (errMsg) return res.status(400).json({ error: errMsg });
    }

    if (hasProcessamento) {
      if (body.processamento == null || typeof body.processamento !== 'object' || Array.isArray(body.processamento)) {
        return res.status(400).json({ error: 'Campo processamento deve ser um objeto JSON' });
      }
    }

    const existing = await getLiquidacaoAntecipacaoByNumCtrlCip(numCtrlCip);
    if (!existing) {
      return res.status(404).json({ error: 'Lote nao encontrado' });
    }

    const updated = await updateLiquidacaoAntecipacaoByNumCtrlCip(numCtrlCip, {
      payloadRequisicao: hasRequisicao ? body.requisicao : undefined,
      payloadProcessamento: hasProcessamento ? body.processamento : undefined,
    });

    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao atualizar lote' });
  }
}
