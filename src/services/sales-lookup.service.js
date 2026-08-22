// Consultas de sales no MySQL do greenn-back usadas pelas telas que precisam preencher
// campos a partir de uma venda existente (Reclamações e Postback Gateway).

import { getGreennPool } from './greenn-db.js';

function mapSale(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name,
    transactionId: row.transaction_id,
    status: row.status,
    amount: row.amount,
    createdAt: row.created_at,
  };
}

export async function listRecentSales(limit = 30) {
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const [rows] = await getGreennPool().query(
    `SELECT s.id, s.client_id, s.transaction_id, s.status, s.amount, s.created_at, c.name AS client_name
       FROM sales s
       LEFT JOIN clients c ON c.id = s.client_id
      ORDER BY s.id DESC
      LIMIT ?`,
    [safeLimit],
  );

  return rows.map(mapSale);
}

export async function findSaleById(id) {
  const [rows] = await getGreennPool().query(
    `SELECT s.id, s.client_id, s.transaction_id, s.status, s.amount, s.created_at, c.name AS client_name
       FROM sales s
       LEFT JOIN clients c ON c.id = s.client_id
      WHERE s.id = ?
      LIMIT 1`,
    [id],
  );

  return rows.length ? mapSale(rows[0]) : null;
}
