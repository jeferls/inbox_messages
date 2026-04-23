import {
  createLiquidacaoAntecipacao,
  deleteLiquidacaoAntecipacaoByNumCtrlCip,
  getLiquidacaoAntecipacaoProcessamentoByNumCtrlCip,
  queryLiquidacoesAntecipacao,
} from '../db/index.js';

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
    const pontosVenda = payload?.grupoSLC0912Centrlz?.grupoSLC0912PontoVenda;
    if (!Array.isArray(pontosVenda) || pontosVenda.length === 0) {
      return res.status(400).json({
        error: 'Campo grupoSLC0912Centrlz.grupoSLC0912PontoVenda deve ser uma lista com ao menos 1 item',
      });
    }

    if (pontosVenda.length > 1000) {
      return res.status(400).json({
        error: 'Campo grupoSLC0912Centrlz.grupoSLC0912PontoVenda suporta no maximo 1000 itens',
      });
    }

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
