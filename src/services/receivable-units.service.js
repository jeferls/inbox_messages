import { getGreennPool } from './greenn-db.js';

// mysql2 devolve DATE/TIMESTAMP como Date; a tela só precisa do texto como está no banco.
function normalizeRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v instanceof Date ? v.toISOString().replace('T', ' ').slice(0, 19) : v;
  }
  return out;
}

const normalizeRows = (rows) => rows.map(normalizeRow);

/** Lista paginada de receivable_unit com o resumo das relações. */
export async function listReceivableUnits({ limit = 20, page = 0, search = '' } = {}) {
  const pool = getGreennPool();
  const where = [];
  const params = [];
  const term = String(search || '').trim();

  if (term) {
    if (/^\d+$/.test(term)) {
      where.push('(ru.id = ? OR ru.user_id = ? OR ru.id IN (SELECT receivable_unit_id FROM sale_statement_units WHERE sale_id = ?))');
      params.push(term, term, term);
    } else {
      where.push('(ru.`key` LIKE ? OR ru.reference LIKE ?)');
      params.push(`%${term}%`, `%${term}%`);
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM receivable_unit ru ${whereSql}`, params);

  const [rows] = await pool.query(
    `SELECT ru.id, ru.\`key\`, ru.reference, ru.user_id, ru.dueDate, ru.amount, ru.pre_paid_amount,
            ru.debtor, ru.original_asset_holder, ru.created_at,
            pa.name AS payment_arrangement, pa.code AS payment_arrangement_code,
            u.name AS user_name,
            (SELECT COUNT(*) FROM settlement_obligations so WHERE so.receivable_unit_id = ru.id) AS obligations_count,
            (SELECT COALESCE(SUM(so.settled_amount), 0) FROM settlement_obligations so WHERE so.receivable_unit_id = ru.id) AS settled_amount,
            (SELECT COUNT(*) FROM settlements s JOIN settlement_obligations so ON so.id = s.settlement_obligation_id WHERE so.receivable_unit_id = ru.id) AS settlements_count,
            (SELECT GROUP_CONCAT(DISTINCT ssu.sale_id ORDER BY ssu.sale_id) FROM sale_statement_units ssu WHERE ssu.receivable_unit_id = ru.id) AS sale_ids,
            (SELECT COUNT(*) FROM tag_ur_alerts a WHERE a.ur_id = ru.id) AS alerts_count
       FROM receivable_unit ru
       LEFT JOIN payment_arrangements pa ON pa.id = ru.payment_arrangement_id
       LEFT JOIN users u ON u.id = ru.user_id
       ${whereSql}
      ORDER BY ru.id DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, page * limit],
  );

  return { total, limit, page, items: normalizeRows(rows) };
}

/** Registro completo de uma UR com todas as relações. */
export async function getReceivableUnitDetail(id) {
  const pool = getGreennPool();
  const [[unit]] = await pool.query('SELECT * FROM receivable_unit WHERE id = ?', [id]);
  if (!unit) return null;

  const [[paymentArrangement]] = await pool.query('SELECT * FROM payment_arrangements WHERE id = ?', [unit.payment_arrangement_id]);
  const [[user]] = await pool.query('SELECT id, name, email, cpf_cnpj FROM users WHERE id = ?', [unit.user_id]);
  const [obligations] = await pool.query('SELECT * FROM settlement_obligations WHERE receivable_unit_id = ? ORDER BY id', [id]);

  const obligationIds = obligations.map((o) => o.id);
  let settlements = [];
  let payments = [];
  if (obligationIds.length) {
    [settlements] = await pool.query('SELECT * FROM settlements WHERE settlement_obligation_id IN (?) ORDER BY id', [obligationIds]);
    [payments] = await pool.query('SELECT * FROM settlement_obligation_payments WHERE settlement_obligation_id IN (?) ORDER BY id', [obligationIds]);
  }

  const slc = await loadSlcForSettlements(pool, settlements.map((s) => s.id));

  const [saleStatementUnits] = await pool.query(
    `SELECT ssu.*, s.status AS sale_status, s.method AS sale_method, s.total AS sale_total, s.installments AS sale_installments,
            s.created_at AS sale_created_at, ast.type AS statement_type, ast.balance AS statement_balance,
            ast.available_date AS statement_available_date
       FROM sale_statement_units ssu
       LEFT JOIN sales s ON s.id = ssu.sale_id
       LEFT JOIN account_statements ast ON ast.id = ssu.account_statement_id
      WHERE ssu.receivable_unit_id = ?
      ORDER BY ssu.id`,
    [id],
  );
  const [alerts] = await pool.query('SELECT * FROM tag_ur_alerts WHERE ur_id = ? ORDER BY id', [id]);
  const [reconciliations] = await pool.query('SELECT * FROM reconciliation_receivables_units WHERE receivable_unit_id = ? ORDER BY id', [id]);

  return {
    unit: normalizeRow(unit),
    paymentArrangement: paymentArrangement ? normalizeRow(paymentArrangement) : null,
    user: user ? normalizeRow(user) : null,
    settlementObligations: normalizeRows(obligations),
    settlements: normalizeRows(settlements),
    settlementObligationPayments: normalizeRows(payments),
    slc,
    saleStatementUnits: normalizeRows(saleStatementUnits),
    alerts: normalizeRows(alerts),
    reconciliations: normalizeRows(reconciliations),
  };
}

const emptyIn = (ids) => (ids.length ? ids : [0]);

/** Registros SLC ligados aos settlements: grupos POS, reports de antecipação (com tentativas, grupos e raiz) e conciliações. */
async function loadSlcForSettlements(pool, settlementIds) {
  const result = {
    posSettlementGroups: [],
    anticipationReports: [],
    anticipationReportAttempts: [],
    centralizerGroups: [],
    settlementGroupRoots: [],
    conciliationItems: [],
    conciliations: [],
  };
  if (!settlementIds.length) return result;

  const [posGroups] = await pool.query('SELECT * FROM slc_pos_settlement_groups WHERE settlement_id IN (?) ORDER BY id', [settlementIds]);
  const [reports] = await pool.query(
    'SELECT * FROM slc_anticipation_reports WHERE settlement_id IN (?) OR slc_pos_settlement_group_id IN (?) ORDER BY id',
    [settlementIds, emptyIn(posGroups.map((g) => g.id))],
  );

  let attempts = [];
  let centralizerGroups = [];
  let roots = [];
  if (reports.length) {
    [attempts] = await pool.query('SELECT * FROM slc_anticipation_reports_attempts WHERE slc_anticipation_report_id IN (?) ORDER BY id', [reports.map((r) => r.id)]);
    const centralizerIds = [...new Set(reports.map((r) => r.slc_centralizer_group_id).filter(Boolean))];
    if (centralizerIds.length) {
      [centralizerGroups] = await pool.query('SELECT * FROM slc_centralizer_groups WHERE id IN (?) ORDER BY id', [centralizerIds]);
      const rootIds = [...new Set(centralizerGroups.map((g) => g.slc_settlement_group_root_id).filter(Boolean))];
      if (rootIds.length) [roots] = await pool.query('SELECT * FROM slc_settlement_group_roots WHERE id IN (?) ORDER BY id', [rootIds]);
    }
  }

  // settlement_ids é texto (lista JSON ou separada por vírgula), então o match é por conteúdo.
  const conds = settlementIds.map(() => '(JSON_VALID(settlement_ids) AND JSON_CONTAINS(settlement_ids, JSON_ARRAY(?))) OR FIND_IN_SET(?, REPLACE(REPLACE(REPLACE(settlement_ids, "[", ""), "]", ""), " ", ""))');
  const condParams = settlementIds.flatMap((id) => [id, String(id)]);
  const [items] = await pool.query(`SELECT * FROM slc_settlement_conciliation_items WHERE ${conds.join(' OR ')} ORDER BY id`, condParams);
  let conciliations = [];
  if (items.length) {
    [conciliations] = await pool.query('SELECT * FROM slc_settlement_conciliations WHERE id IN (?) ORDER BY id', [[...new Set(items.map((i) => i.conciliation_id))]]);
  }

  result.posSettlementGroups = normalizeRows(posGroups);
  result.anticipationReports = normalizeRows(reports);
  result.anticipationReportAttempts = normalizeRows(attempts);
  result.centralizerGroups = normalizeRows(centralizerGroups);
  result.settlementGroupRoots = normalizeRows(roots);
  result.conciliationItems = normalizeRows(items);
  result.conciliations = normalizeRows(conciliations);
  return result;
}
