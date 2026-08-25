// Assinaturas do sistema de recorrência. Ficam em um database separado no mesmo MySQL do
// greenn-back, então reaproveitamos o pool qualificando as tabelas pelo nome do banco.

import { getGreennPool } from './greenn-db.js';
import { GREENN_SUBSCRIPTION_DB_NAME } from '../config/env.js';

export const SUBSCRIPTION_STATUSES = [
  'created',
  'trialing',
  'paid',
  'unpaid',
  'ended',
  'canceled',
  'pending_payment',
  'processing',
];

const MAX_LIMIT = 200;
const DB = `\`${GREENN_SUBSCRIPTION_DB_NAME.replace(/`/g, '')}\``;

export async function listSubscriptions({ status, search, limit = 50, page = 0 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), MAX_LIMIT);
  const safePage = Math.max(Number(page) || 0, 0);
  const offset = safePage * safeLimit;

  const where = [];
  const params = [];

  if (status && SUBSCRIPTION_STATUSES.includes(status)) {
    where.push('s.status = ?');
    params.push(status);
  }

  const term = search ? String(search).trim() : '';
  if (term) {
    where.push('(s.id LIKE ? OR c.name LIKE ? OR c.email LIKE ? OR p.name LIKE ?)');
    params.push(`%${term}%`, `%${term}%`, `%${term}%`, `%${term}%`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const fromSql = `FROM ${DB}.subscriptions s
       LEFT JOIN ${DB}.plans p ON p.id = s.plan_id
       LEFT JOIN ${DB}.customers c ON c.id = s.customer_id`;

  const pool = getGreennPool();

  const [countRows] = await pool.query(`SELECT COUNT(*) AS total ${fromSql} ${whereSql}`, params);

  // Contadores por status ignoram o filtro de status, mas respeitam a busca.
  const searchWhere = term ? 'WHERE (s.id LIKE ? OR c.name LIKE ? OR c.email LIKE ? OR p.name LIKE ?)' : '';
  const searchParams = term ? [`%${term}%`, `%${term}%`, `%${term}%`, `%${term}%`] : [];
  const [statusRows] = await pool.query(
    `SELECT s.status, COUNT(*) AS total ${fromSql} ${searchWhere} GROUP BY s.status`,
    searchParams,
  );

  const [rows] = await pool.query(
    `SELECT s.id, s.type, s.status, s.gateway, s.payment_method, s.installments, s.currency,
            s.started_at, s.finished_at, s.canceled_at, s.next_charge_at,
            s.current_period_start, s.current_period_end, s.created_at,
            p.id AS plan_id, p.name AS plan_name, p.price AS plan_price,
            p.interval AS plan_interval, p.interval_count AS plan_interval_count,
            p.charges AS plan_charges,
            c.id AS customer_id, c.name AS customer_name, c.email AS customer_email,
            (SELECT COUNT(*) FROM ${DB}.subscription_charges ch
              WHERE ch.subscription_id = s.id AND ch.deleted_at IS NULL) AS charges_count
       ${fromSql}
       ${whereSql}
      ORDER BY s.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, safeLimit, offset],
  );

  const counts = Object.fromEntries(SUBSCRIPTION_STATUSES.map((s) => [s, 0]));
  for (const row of statusRows) counts[row.status] = row.total;

  return {
    total: countRows[0]?.total ?? 0,
    counts,
    limit: safeLimit,
    page: safePage,
    subscriptions: rows.map((row) => ({
      id: row.id,
      type: row.type,
      status: row.status,
      gateway: row.gateway,
      paymentMethod: row.payment_method,
      installments: row.installments,
      currency: row.currency,
      // Preço do plano é gravado em centavos.
      planPrice: row.plan_price == null ? null : row.plan_price / 100,
      planId: row.plan_id,
      planName: row.plan_name,
      planInterval: row.plan_interval,
      planIntervalCount: row.plan_interval_count,
      // Total de cobranças previsto no plano (null = sem limite).
      planCharges: row.plan_charges,
      customerId: row.customer_id,
      customerName: row.customer_name,
      customerEmail: row.customer_email,
      chargesCount: row.charges_count,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      canceledAt: row.canceled_at,
      nextChargeAt: row.next_charge_at,
      currentPeriodStart: row.current_period_start,
      currentPeriodEnd: row.current_period_end,
      createdAt: row.created_at,
    })),
  };
}

export async function listSubscriptionCharges(subscriptionId) {
  const [rows] = await getGreennPool().query(
    `SELECT id, payment_status, payment_method, gateway, amount, original_amount,
            current_installment, transaction_id, expected_date, paid_at, created_at
       FROM ${DB}.subscription_charges
      WHERE subscription_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 100`,
    [subscriptionId],
  );

  return rows.map((row) => ({
    id: row.id,
    paymentStatus: row.payment_status,
    paymentMethod: row.payment_method,
    gateway: row.gateway,
    // Valores das cobranças também são gravados em centavos.
    amount: row.amount == null ? null : row.amount / 100,
    originalAmount: row.original_amount == null ? null : row.original_amount / 100,
    installment: row.current_installment,
    transactionId: row.transaction_id,
    expectedDate: row.expected_date,
    paidAt: row.paid_at,
    createdAt: row.created_at,
  }));
}

// Antes de rodar a recorrência manual, joga a última cobrança e o fim do período atual para
// o mês passado — sem isso a assinatura ainda não está "vencida" e o comando não cobra.
export async function backdateRecurrenceDates(subscriptionId) {
  const pool = getGreennPool();

  const [chargeResult] = await pool.query(
    `UPDATE ${DB}.subscription_charges
        SET created_at = DATE_SUB(NOW(), INTERVAL 1 MONTH)
      WHERE subscription_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [subscriptionId],
  );

  const [subscriptionResult] = await pool.query(
    `UPDATE ${DB}.subscriptions
        SET current_period_end = DATE_SUB(NOW(), INTERVAL 1 MONTH)
      WHERE id = ?`,
    [subscriptionId],
  );

  // Depois dos updates a "última cobrança" já é outra linha, então devolvemos a data aplicada.
  const [rows] = await pool.query('SELECT DATE_SUB(NOW(), INTERVAL 1 MONTH) AS backdated_to');

  return {
    chargeUpdated: chargeResult.affectedRows > 0,
    subscriptionUpdated: subscriptionResult.affectedRows > 0,
    backdatedTo: rows[0]?.backdated_to ?? null,
  };
}
