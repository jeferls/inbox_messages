// Análises antifraude gravadas em `sale_konduto_analysis` no banco do greenn-back.
//
// Não há endpoint que liste essas análises. A tela junta cada análise com a venda e com a
// transação pendente correspondente: o webhook do backend resolve o pedido por
// `pending_transactions.konduto_order_id`, então sem transação pendente a ação não tem efeito.

import { getGreennPool } from './greenn-db.js';

// Os sete status do enum agrupados em três abas. O agrupamento acompanha os scopes do
// model `SaleKondutoAnalysis` (approved / blocked / pending), com NOT_ANALYZED junto das
// pendentes para que nenhuma análise fique fora das abas.
export const ANALYSIS_GROUPS = {
  pending: ['PENDING', 'NOT_ANALYZED'],
  approved: ['APPROVED'],
  declined: ['DECLINED', 'NOT_AUTHORIZED', 'CANCELED', 'FRAUD'],
};

export const DEFAULT_GROUP = 'pending';

const MAX_LIMIT = 200;

export async function listAnalyses({ group = DEFAULT_GROUP, search, limit = 50, page = 0 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), MAX_LIMIT);
  const safePage = Math.max(Number(page) || 0, 0);
  const offset = safePage * safeLimit;

  const safeGroup = ANALYSIS_GROUPS[group] ? group : DEFAULT_GROUP;
  const groupStatuses = ANALYSIS_GROUPS[safeGroup];

  // A busca vale tanto para a listagem quanto para os contadores das abas.
  const searchWhere = [];
  const searchParams = [];
  const term = search ? String(search).trim() : '';

  if (term) {
    searchWhere.push('(a.konduto_order_id LIKE ? OR CAST(a.sale_id AS CHAR) = ?)');
    searchParams.push(`%${term}%`, term);
  }

  const where = [
    `a.konduto_status IN (${groupStatuses.map(() => '?').join(', ')})`,
    ...searchWhere,
  ];
  const params = [...groupStatuses, ...searchParams];

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const searchWhereSql = searchWhere.length ? `WHERE ${searchWhere.join(' AND ')}` : '';
  const pool = getGreennPool();

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM sale_konduto_analysis a ${whereSql}`,
    params,
  );

  const [statusCounts] = await pool.query(
    `SELECT a.konduto_status, COUNT(*) AS total
       FROM sale_konduto_analysis a
       ${searchWhereSql}
      GROUP BY a.konduto_status`,
    searchParams,
  );

  const [rows] = await pool.query(
    `SELECT a.id, a.sale_id, a.konduto_order_id, a.konduto_status, a.konduto_score,
            a.konduto_recommendation, a.store_name, a.konduto_analyzed_at, a.updated_at,
            s.amount AS sale_amount, s.status AS sale_status,
            pt.id AS pending_transaction_id, pt.status AS pending_transaction_status
       FROM sale_konduto_analysis a
       LEFT JOIN sales s ON s.id = a.sale_id
       LEFT JOIN pending_transactions pt ON pt.konduto_order_id = a.konduto_order_id
       ${whereSql}
      ORDER BY a.id DESC
      LIMIT ? OFFSET ?`,
    [...params, safeLimit, offset],
  );

  return {
    group: safeGroup,
    total: countRows[0]?.total ?? 0,
    counts: countByGroup(statusCounts),
    limit: safeLimit,
    page: safePage,
    analyses: rows.map((row) => ({
      id: row.id,
      saleId: row.sale_id,
      orderId: row.konduto_order_id,
      status: row.konduto_status,
      score: row.konduto_score,
      recommendation: row.konduto_recommendation,
      storeName: row.store_name,
      analyzedAt: row.konduto_analyzed_at,
      updatedAt: row.updated_at,
      saleAmount: row.sale_amount,
      saleStatus: row.sale_status,
      // Sem transação pendente o webhook devolve 422: a tela avisa antes de o usuário tentar.
      pendingTransaction: row.pending_transaction_id
        ? { id: row.pending_transaction_id, status: row.pending_transaction_status }
        : null,
    })),
  };
}

/** Totais por aba, a partir do COUNT por status. */
function countByGroup(statusCounts) {
  const totals = Object.fromEntries(Object.keys(ANALYSIS_GROUPS).map((group) => [group, 0]));

  for (const row of statusCounts) {
    const group = Object.keys(ANALYSIS_GROUPS).find((key) => ANALYSIS_GROUPS[key].includes(row.konduto_status));

    if (group) totals[group] += Number(row.total);
  }

  return totals;
}
