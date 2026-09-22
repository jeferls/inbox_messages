import { getGreennPool } from './greenn-db.js';

/** Últimas N sale_statement_units com a available_date do account_statement relacionado. */
export async function listLatestSaleStatementUnits(limit = 20) {
  const [rows] = await getGreennPool().query(
    `SELECT ssu.id, ssu.sale_id, ssu.account_statement_id, ast.available_date
       FROM sale_statement_units ssu
       LEFT JOIN account_statements ast ON ast.id = ssu.account_statement_id
      ORDER BY ssu.id DESC
      LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({ ...r, available_date: toDateString(r.available_date) }));
}

/**
 * Move a available_date do account_statement da unit para dois dias atrás (hoje em
 * America/Sao_Paulo, menos 2), o que faz a UR ficar elegível para settlement.
 */
export async function backdateAvailableDate(saleStatementUnitId) {
  const targetDate = daysAgoInSaoPaulo(2);
  const [result] = await getGreennPool().query(
    `UPDATE account_statements ast
       JOIN sale_statement_units ssu ON ssu.account_statement_id = ast.id
        SET ast.available_date = ?
      WHERE ssu.id = ?`,
    [targetDate, saleStatementUnitId],
  );
  return { updated: result.affectedRows > 0, availableDate: targetDate };
}

function daysAgoInSaoPaulo(days) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function toDateString(value) {
  if (!value) return null;
  if (value instanceof Date) return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(value);
  return String(value).slice(0, 10);
}

// Ordem respeita as FKs entre elas. Nenhuma outra tabela referencia estas, então
// account_statements, payment_arrangements, withdraw_slcs e slc_sales não são tocadas.
export const UR_RESET_TABLES = [
  'slc_anticipation_reports_attempts',
  'slc_anticipation_reports',
  'slc_centralizer_groups',
  'slc_settlement_group_roots',
  'slc_pos_settlement_groups',
  'slc_settlement_conciliation_items',
  'slc_settlement_conciliations',
  'tag_ur_alerts',
  'reconciliation_receivables_units',
  'sale_statement_units',
  'settlements',
  'settlement_obligation_payments',
  'settlement_obligations',
  'receivable_unit',
];

/** Esvazia as tabelas de UR, settlement e SLC ligadas a settlement, devolvendo quantas linhas cada uma tinha. */
export async function resetReceivableUnitTables() {
  const conn = await getGreennPool().getConnection();
  try {
    const counts = {};
    for (const table of UR_RESET_TABLES) {
      const [[row]] = await conn.query(`SELECT COUNT(*) AS total FROM \`${table}\``);
      counts[table] = row.total;
    }

    // TRUNCATE zera o auto_increment e é bem mais rápido que DELETE nas tabelas grandes;
    // as FKs entre elas exigem desligar a checagem só nesta conexão.
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    try {
      for (const table of UR_RESET_TABLES) {
        await conn.query(`TRUNCATE TABLE \`${table}\``);
      }
    } finally {
      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    }

    return counts;
  } finally {
    conn.release();
  }
}
