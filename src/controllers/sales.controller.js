import { listRecentSales, findSaleById } from '../services/sales-lookup.service.js';

export async function listRecentSalesHandler(req, res) {
  try {
    res.json({ sales: await listRecentSales(req.query.limit) });
  } catch (e) {
    res.status(502).json({ error: `Falha ao listar sales: ${e.message}` });
  }
}

export async function getSaleHandler(req, res) {
  try {
    const saleId = Number(req.params.id);
    if (!Number.isInteger(saleId) || saleId <= 0) {
      return res.status(400).json({ error: "'id' inválido" });
    }

    const sale = await findSaleById(saleId);
    if (!sale) return res.status(404).json({ error: 'Sale não encontrada' });

    res.json(sale);
  } catch (e) {
    res.status(502).json({ error: `Falha ao buscar sale: ${e.message}` });
  }
}
