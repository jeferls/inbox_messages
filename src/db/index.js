import sqlite3 from 'sqlite3';
import { DB_PATH } from '../config/env.js';
import crypto from 'node:crypto';
import { rewriteClaimUrls } from '../utils/urlRewrite.js';

let db;

export async function dbInit() {
  sqlite3.verbose();
  db = new sqlite3.Database(DB_PATH);

  await run(`
    CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      recipient TEXT NOT NULL,
      body TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS liquidacoes_antecipacao (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      num_ctrl_cip TEXT NOT NULL UNIQUE,
      payload_requisicao TEXT NOT NULL,
      payload_processamento TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS receivables_processes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      process_key TEXT NOT NULL UNIQUE,
      payload_request TEXT NOT NULL,
      payload_response TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await normalizeAllReceivableProcessPayloadResponses();
  await rewriteExistingEmailClaimUrls();

  await run(`
    CREATE TABLE IF NOT EXISTS equals_mock_config (
      config_key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS equals_received_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Mocks de gateway: cenário ativo por gateway e histórico de request/response.
  await run(`
    CREATE TABLE IF NOT EXISTS gateway_mock_state (
      gateway TEXT PRIMARY KEY,
      scenario TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS gateway_mock_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gateway TEXT NOT NULL,
      scenario TEXT NOT NULL,
      scenario_source TEXT NOT NULL,
      reference TEXT,
      amount TEXT,
      currency TEXT,
      installments TEXT,
      request_headers TEXT NOT NULL,
      request_body TEXT NOT NULL,
      response_status INTEGER NOT NULL,
      response_body TEXT NOT NULL,
      duration_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await run(`CREATE INDEX IF NOT EXISTS idx_gateway_mock_tx_gateway ON gateway_mock_transactions (gateway, id DESC)`);

  // Iugu mock: every object (accounts, invoices, customers, tokens...) as JSON keyed by kind + id.
  await run(`
    CREATE TABLE IF NOT EXISTS iugu_mock_objects (
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      account_id TEXT,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      PRIMARY KEY (kind, id)
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_iugu_mock_objects_account ON iugu_mock_objects (kind, account_id)`);

  await run(`
    CREATE TABLE IF NOT EXISTS iugu_mock_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      route TEXT,
      auth TEXT,
      account_id TEXT,
      invoice_id TEXT,
      status INTEGER NOT NULL,
      request_body TEXT,
      response_body TEXT,
      warnings TEXT,
      duration_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_iugu_mock_requests_invoice ON iugu_mock_requests (invoice_id)`);

  await seedEqualsDefaults();
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, function (err, row) {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, function (err, rows) {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function randomDigits(length) {
  const bytes = crypto.randomBytes(length);
  let output = '';
  for (let i = 0; i < length; i += 1) {
    output += String(bytes[i] % 10);
  }
  return output;
}

export async function insertEmail({ title, recipient, body }) {
  const res = await run(
    `INSERT INTO emails (title, recipient, body) VALUES (?, ?, ?)`,
    [title, recipient, body]
  );
  const row = await get(`SELECT * FROM emails WHERE id = ?`, [res.lastID]);
  return row;
}

export async function listEmails() {
  return all(`SELECT * FROM emails ORDER BY datetime(created_at) DESC, id DESC`);
}

export async function getEmailById(id) {
  return get(`SELECT * FROM emails WHERE id = ?`, [id]);
}

export async function markEmailRead(id) {
  await run(`UPDATE emails SET read = 1 WHERE id = ?`, [id]);
}

export async function deleteAllEmails() {
  await run(`DELETE FROM emails`);
}

export async function deleteEmailById(id) {
  await run(`DELETE FROM emails WHERE id = ?`, [id]);
}

export async function appendEmailBody(id, chunk) {
  // Concatena chunk no corpo em atualização incremental
  await run(`UPDATE emails SET body = COALESCE(body, '') || ? WHERE id = ?`, [chunk, id]);
}

export async function updateEmailBody(id, body) {
  await run(`UPDATE emails SET body = ? WHERE id = ?`, [body, id]);
}

export async function queryEmails({ limit = 50, offset = 0, search, unread = false }) {
  const where = [];
  const params = [];
  if (search) {
    where.push('(title LIKE ? OR recipient LIKE ? OR body LIKE ?)');
    const pattern = `%${search}%`;
    params.push(pattern, pattern, pattern);
  }
  if (unread) {
    where.push('read = 0');
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const base = `FROM emails ${whereSql}`;

  const totalRow = await get(`SELECT COUNT(*) as count ${base}`, params);
  const items = await all(
    `SELECT * ${base} ORDER BY datetime(created_at) DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, Number(limit), Number(offset)]
  );

  return { items, total: totalRow?.count ?? 0 };
}

export async function createLiquidacaoAntecipacao({ payloadRequisicao, payloadProcessamento }) {
  const maxRetries = 10;
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const numCtrlCip = randomDigits(20);
    try {
      await run(
        `INSERT INTO liquidacoes_antecipacao (num_ctrl_cip, payload_requisicao, payload_processamento) VALUES (?, ?, ?)`,
        [numCtrlCip, JSON.stringify(payloadRequisicao), JSON.stringify(payloadProcessamento)]
      );
      return { numCtrlCip };
    } catch (error) {
      if (error?.code !== 'SQLITE_CONSTRAINT') {
        throw error;
      }
    }
  }

  throw new Error('Falha ao gerar numCtrlCip unico');
}

function parseJsonOrNull(text) {
  if (text == null || text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeReceivablePayloadResponse(payloadResponse) {
  if (!payloadResponse || typeof payloadResponse !== 'object') {
    return { normalized: payloadResponse, changed: false };
  }

  const next = JSON.parse(JSON.stringify(payloadResponse));
  let changed = false;
  const receivables = Array.isArray(next.receivables) ? next.receivables : null;
  if (!receivables) return { normalized: next, changed };

  for (const receivable of receivables) {
    if (!Array.isArray(receivable?.settlementObligations)) continue;
    for (const obligation of receivable.settlementObligations) {
      if (!Array.isArray(obligation?.settlements)) {
        obligation.settlements = [];
        changed = true;
      }
    }
  }

  return { normalized: next, changed };
}

async function normalizeAllReceivableProcessPayloadResponses() {
  const rows = await all(
    `SELECT process_key, payload_response
     FROM receivables_processes`
  );

  for (const row of rows) {
    const parsed = parseJsonOrNull(row.payload_response);
    const { normalized, changed } = normalizeReceivablePayloadResponse(parsed);
    if (!changed) continue;

    await run(
      `UPDATE receivables_processes
       SET payload_response = ?
       WHERE process_key = ?`,
      [JSON.stringify(normalized), row.process_key]
    );
  }
}

async function rewriteExistingEmailClaimUrls() {
  const rows = await all(`SELECT id, body FROM emails WHERE body LIKE '%reclamacao.greenn.com.br%'`);
  for (const row of rows) {
    const rewritten = rewriteClaimUrls(row.body);
    if (rewritten !== row.body) {
      await run(`UPDATE emails SET body = ? WHERE id = ?`, [rewritten, row.id]);
    }
  }
}

export async function getLiquidacaoAntecipacaoByNumCtrlCip(numCtrlCip) {
  const row = await get(
    `SELECT num_ctrl_cip, created_at, payload_requisicao, payload_processamento
     FROM liquidacoes_antecipacao WHERE num_ctrl_cip = ?`,
    [numCtrlCip]
  );
  if (!row) return null;

  return {
    numCtrlCip: row.num_ctrl_cip,
    createdAt: row.created_at,
    requisicao: parseJsonOrNull(row.payload_requisicao),
    processamento: parseJsonOrNull(row.payload_processamento),
  };
}

export async function getLiquidacaoAntecipacaoProcessamentoByNumCtrlCip(numCtrlCip) {
  const row = await get(
    `SELECT payload_processamento FROM liquidacoes_antecipacao WHERE num_ctrl_cip = ?`,
    [numCtrlCip]
  );
  if (!row) return null;

  return parseJsonOrNull(row.payload_processamento);
}

export async function updateLiquidacaoAntecipacaoByNumCtrlCip(numCtrlCip, { payloadRequisicao, payloadProcessamento }) {
  const existing = await get(
    `SELECT payload_requisicao, payload_processamento FROM liquidacoes_antecipacao WHERE num_ctrl_cip = ?`,
    [numCtrlCip]
  );
  if (!existing) return null;

  const nextRequisicao =
    payloadRequisicao !== undefined ? JSON.stringify(payloadRequisicao) : existing.payload_requisicao;
  const nextProcessamento =
    payloadProcessamento !== undefined ? JSON.stringify(payloadProcessamento) : existing.payload_processamento;

  await run(
    `UPDATE liquidacoes_antecipacao
     SET payload_requisicao = ?, payload_processamento = ?
     WHERE num_ctrl_cip = ?`,
    [nextRequisicao, nextProcessamento, numCtrlCip]
  );

  return getLiquidacaoAntecipacaoByNumCtrlCip(numCtrlCip);
}

export async function queryLiquidacoesAntecipacao({ limit = 20, offset = 0 }) {
  const totalRow = await get(`SELECT COUNT(*) as count FROM liquidacoes_antecipacao`);
  const rows = await all(
    `SELECT num_ctrl_cip, created_at FROM liquidacoes_antecipacao
     ORDER BY datetime(created_at) DESC, id DESC
     LIMIT ? OFFSET ?`,
    [Number(limit), Number(offset)]
  );

  const items = rows.map((row) => ({
    numCtrlCip: row.num_ctrl_cip,
    createdAt: row.created_at,
  }));

  return {
    items,
    total: totalRow?.count ?? 0,
  };
}

export async function deleteLiquidacaoAntecipacaoByNumCtrlCip(numCtrlCip) {
  const result = await run(
    `DELETE FROM liquidacoes_antecipacao WHERE num_ctrl_cip = ?`,
    [numCtrlCip]
  );
  return (result?.changes ?? 0) > 0;
}

export async function deleteAllLiquidacoesAntecipacao() {
  const result = await run(`DELETE FROM liquidacoes_antecipacao`);
  return result?.changes ?? 0;
}

export async function createReceivableProcess({ processKey, payloadRequest, payloadResponse }) {
  await run(
    `INSERT INTO receivables_processes (process_key, payload_request, payload_response) VALUES (?, ?, ?)`,
    [processKey, JSON.stringify(payloadRequest), JSON.stringify(payloadResponse)]
  );
  return { processKey };
}

export async function getReceivableProcessByKey(processKey) {
  const row = await get(
    `SELECT process_key, created_at, payload_request, payload_response
     FROM receivables_processes
     WHERE process_key = ?`,
    [processKey]
  );
  if (!row) return null;

  const rawResponse = parseJsonOrNull(row.payload_response);
  const { normalized: normalizedResponse, changed } = normalizeReceivablePayloadResponse(rawResponse);
  if (changed) {
    await run(
      `UPDATE receivables_processes
       SET payload_response = ?
       WHERE process_key = ?`,
      [JSON.stringify(normalizedResponse), processKey]
    );
  }

  return {
    processKey: row.process_key,
    createdAt: row.created_at,
    request: parseJsonOrNull(row.payload_request),
    response: normalizedResponse,
  };
}

export async function queryReceivableProcesses({ limit = 20, offset = 0, key }) {
  const where = [];
  const params = [];
  if (key) {
    where.push(`(process_key LIKE ? OR payload_response LIKE ?)`);
    const pattern = `%${key}%`;
    params.push(pattern, pattern);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const totalRow = await get(
    `SELECT COUNT(*) as count FROM receivables_processes ${whereSql}`,
    params
  );
  const rows = await all(
    `SELECT process_key, created_at
     FROM receivables_processes
     ${whereSql}
     ORDER BY datetime(created_at) DESC, id DESC
     LIMIT ? OFFSET ?`,
    [...params, Number(limit), Number(offset)]
  );

  return {
    items: rows.map((row) => ({ processKey: row.process_key, createdAt: row.created_at })),
    total: totalRow?.count ?? 0,
  };
}

export async function updateReceivableProcessByKey(processKey, { payloadRequest, payloadResponse }) {
  const existing = await get(
    `SELECT payload_request, payload_response
     FROM receivables_processes
     WHERE process_key = ?`,
    [processKey]
  );
  if (!existing) return null;

  const nextRequest = payloadRequest !== undefined ? JSON.stringify(payloadRequest) : existing.payload_request;
  const nextResponse = payloadResponse !== undefined ? JSON.stringify(payloadResponse) : existing.payload_response;

  await run(
    `UPDATE receivables_processes
     SET payload_request = ?, payload_response = ?
     WHERE process_key = ?`,
    [nextRequest, nextResponse, processKey]
  );

  return getReceivableProcessByKey(processKey);
}

export async function deleteReceivableProcessByKey(processKey) {
  const result = await run(`DELETE FROM receivables_processes WHERE process_key = ?`, [processKey]);
  return (result?.changes ?? 0) > 0;
}

export async function deleteAllReceivableProcesses() {
  const result = await run(`DELETE FROM receivables_processes`);
  return result?.changes ?? 0;
}

export async function listReceivableProcessPayloadResponses() {
  const rows = await all(
    `SELECT process_key, payload_request, payload_response
     FROM receivables_processes
     ORDER BY id DESC`
  );

  const out = [];
  for (const row of rows) {
    const parsedReq = parseJsonOrNull(row.payload_request);
    const parsedRes = parseJsonOrNull(row.payload_response);
    const { normalized, changed } = normalizeReceivablePayloadResponse(parsedRes);
    if (changed) {
      await run(
        `UPDATE receivables_processes
         SET payload_response = ?
         WHERE process_key = ?`,
        [JSON.stringify(normalized), row.process_key]
      );
    }

    out.push({
      processKey: row.process_key,
      payloadRequest: parsedReq,
      payloadResponse: normalized,
    });
  }

  return out.filter((row) => row.payloadResponse && typeof row.payloadResponse === 'object');
}

export async function updateReceivableProcessResponseByKey(processKey, payloadResponse) {
  await run(
    `UPDATE receivables_processes
     SET payload_response = ?
     WHERE process_key = ?`,
    [JSON.stringify(payloadResponse), processKey]
  );
}

export async function updateReceivableProcessRequestByKey(processKey, payloadRequest) {
  await run(
    `UPDATE receivables_processes
     SET payload_request = ?
     WHERE process_key = ?`,
    [JSON.stringify(payloadRequest), processKey]
  );
}

const EQUALS_DEFAULT_CONFIGS = {
  adquirentes: [
    { id: 1, nome: 'Cielo' },
    { id: 2, nome: 'Rede' },
    { id: 3, nome: 'Pagarme' },
    { id: 4, nome: 'PayPal' },
    { id: 5, nome: 'Pix' },
    { id: 6, nome: 'Ebanx' },
    { id: 7, nome: 'Stripe' },
    { id: 8, nome: 'Iugu' },
    { id: 9, nome: 'MercadoPago' },
    { id: 10, nome: 'Asaas' },
    { id: 11, nome: 'Dlocal' },
    { id: 12, nome: 'Worldpay' },
    { id: 13, nome: 'Efi' },
  ],
  bandeiras: [
    { id: 1, nome: 'Visa' },
    { id: 2, nome: 'Mastercard' },
    { id: 3, nome: 'Amex' },
    { id: 4, nome: 'Elo' },
    { id: 5, nome: 'Hipercard' },
    { id: 6, nome: 'Diners' },
    { id: 7, nome: 'JCB' },
  ],
  'formas-de-pagamento': [
    { id: 'CC', descricao: 'Cartão de Crédito' },
    { id: 'PI', descricao: 'Pagamento Instantâneo' },
    { id: 'BC', descricao: 'Boleto Bancário' },
    { id: 'CD', descricao: 'Cartão de Débito' },
  ],
  'meios-de-captura': [
    { id: 1, nome: 'POS' },
    { id: 2, nome: 'TEF' },
    { id: 3, nome: 'e-commerce' },
    { id: 4, nome: 'Mobile' },
    { id: 5, nome: 'Manual' },
  ],
};

async function seedEqualsDefaults() {
  for (const [key, data] of Object.entries(EQUALS_DEFAULT_CONFIGS)) {
    await run(
      `INSERT OR IGNORE INTO equals_mock_config (config_key, data) VALUES (?, ?)`,
      [key, JSON.stringify(data)]
    );
  }
}

export async function getEqualsConfig(configKey) {
  const row = await get(`SELECT data FROM equals_mock_config WHERE config_key = ?`, [configKey]);
  return row ? parseJsonOrNull(row.data) : null;
}

export async function getAllEqualsConfig() {
  const rows = await all(
    `SELECT config_key, data, updated_at FROM equals_mock_config ORDER BY config_key`
  );
  const result = {};
  for (const row of rows) {
    result[row.config_key] = { data: parseJsonOrNull(row.data), updatedAt: row.updated_at };
  }
  return result;
}

export async function setEqualsConfig(configKey, data) {
  await run(
    `INSERT INTO equals_mock_config (config_key, data, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(config_key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    [configKey, JSON.stringify(data)]
  );
  return getEqualsConfig(configKey);
}

export async function resetEqualsConfig(configKey) {
  const defaults = EQUALS_DEFAULT_CONFIGS[configKey];
  if (!defaults) return null;
  return setEqualsConfig(configKey, defaults);
}

export async function insertEqualsReceivedTransaction(payload) {
  const res = await run(
    `INSERT INTO equals_received_transactions (payload) VALUES (?)`,
    [JSON.stringify(payload)]
  );
  return { id: res.lastID };
}

export async function listEqualsReceivedTransactions({ limit = 20, offset = 0 } = {}) {
  const totalRow = await get(`SELECT COUNT(*) as count FROM equals_received_transactions`);
  const rows = await all(
    `SELECT id, payload, created_at FROM equals_received_transactions ORDER BY id DESC LIMIT ? OFFSET ?`,
    [Number(limit), Number(offset)]
  );
  return {
    items: rows.map((r) => ({ id: r.id, payload: parseJsonOrNull(r.payload), createdAt: r.created_at })),
    total: totalRow?.count ?? 0,
  };
}

export async function clearEqualsReceivedTransactions() {
  const result = await run(`DELETE FROM equals_received_transactions`);
  return result?.changes ?? 0;
}

// ─── Mocks de gateway ────────────────────────────────────────────────────────

export async function getGatewayMockScenario(gateway) {
  const row = await get(`SELECT scenario FROM gateway_mock_state WHERE gateway = ?`, [gateway]);
  return row?.scenario ?? null;
}

export async function setGatewayMockScenario(gateway, scenario) {
  await run(
    `INSERT INTO gateway_mock_state (gateway, scenario, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(gateway) DO UPDATE SET scenario = excluded.scenario, updated_at = excluded.updated_at`,
    [gateway, scenario]
  );
  return getGatewayMockScenario(gateway);
}

export async function insertGatewayMockTransaction({
  gateway,
  scenario,
  scenarioSource,
  reference = null,
  amount = null,
  currency = null,
  installments = null,
  requestHeaders,
  requestBody,
  responseStatus,
  responseBody,
  durationMs = null,
}) {
  const res = await run(
    `INSERT INTO gateway_mock_transactions
       (gateway, scenario, scenario_source, reference, amount, currency, installments,
        request_headers, request_body, response_status, response_body, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      gateway,
      scenario,
      scenarioSource,
      reference,
      amount,
      currency,
      installments,
      JSON.stringify(requestHeaders ?? {}),
      requestBody ?? '',
      Number(responseStatus),
      responseBody ?? '',
      durationMs == null ? null : Number(durationMs),
    ]
  );
  return { id: res.lastID };
}

export async function listGatewayMockTransactions({ gateway, limit = 20, offset = 0, scenario } = {}) {
  const where = [];
  const params = [];

  if (gateway) {
    where.push('gateway = ?');
    params.push(gateway);
  }
  if (scenario) {
    where.push('scenario = ?');
    params.push(scenario);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const totalRow = await get(`SELECT COUNT(*) as count FROM gateway_mock_transactions ${whereSql}`, params);
  const rows = await all(
    `SELECT id, gateway, scenario, scenario_source, reference, amount, currency, installments,
            request_headers, request_body, response_status, response_body, duration_ms, created_at
       FROM gateway_mock_transactions ${whereSql}
      ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, Number(limit), Number(offset)]
  );

  return {
    items: rows.map((r) => ({
      id: r.id,
      gateway: r.gateway,
      scenario: r.scenario,
      scenarioSource: r.scenario_source,
      reference: r.reference,
      amount: r.amount,
      currency: r.currency,
      installments: r.installments,
      requestHeaders: parseJsonOrNull(r.request_headers),
      requestBody: r.request_body,
      responseStatus: r.response_status,
      responseBody: r.response_body,
      durationMs: r.duration_ms,
      createdAt: r.created_at,
    })),
    total: totalRow?.count ?? 0,
  };
}

export async function clearGatewayMockTransactions(gateway) {
  const result = gateway
    ? await run(`DELETE FROM gateway_mock_transactions WHERE gateway = ?`, [gateway])
    : await run(`DELETE FROM gateway_mock_transactions`);
  return result?.changes ?? 0;
}

// ─── Iugu mock ────────────────────────────────────────────────────────────────

function parseIuguRow(row) {
  if (!row) return null;
  return { ...JSON.parse(row.data), _created_at: row.created_at, _updated_at: row.updated_at };
}

function stripIuguMeta(data) {
  const { _created_at, _updated_at, ...rest } = data;
  return rest;
}

export async function iuguMockGet(kind, id) {
  return parseIuguRow(await get(`SELECT * FROM iugu_mock_objects WHERE kind = ? AND id = ?`, [kind, id]));
}

export async function iuguMockPut(kind, id, accountId, data) {
  await run(
    `INSERT INTO iugu_mock_objects (kind, id, account_id, data)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(kind, id) DO UPDATE SET
       account_id = excluded.account_id,
       data = excluded.data,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    [kind, id, accountId ?? null, JSON.stringify(stripIuguMeta(data))]
  );
  return iuguMockGet(kind, id);
}

export async function iuguMockList(kind, { accountId, limit = 500, offset = 0 } = {}) {
  const where = ['kind = ?'];
  const params = [kind];
  if (accountId) {
    where.push('account_id = ?');
    params.push(accountId);
  }
  const rows = await all(
    `SELECT * FROM iugu_mock_objects WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return rows.map(parseIuguRow);
}

export async function iuguMockCount(kind, accountId) {
  const row = accountId
    ? await get(`SELECT COUNT(*) AS count FROM iugu_mock_objects WHERE kind = ? AND account_id = ?`, [kind, accountId])
    : await get(`SELECT COUNT(*) AS count FROM iugu_mock_objects WHERE kind = ?`, [kind]);
  return row?.count ?? 0;
}

/** Clears every Iugu object except the settings, and the request log. */
export async function iuguMockClear() {
  const objects = await run(`DELETE FROM iugu_mock_objects WHERE kind <> 'settings'`);
  const requests = await run(`DELETE FROM iugu_mock_requests`);
  return { objects: objects?.changes ?? 0, requests: requests?.changes ?? 0 };
}

export async function insertIuguMockRequest({
  channel,
  method,
  path,
  route = null,
  auth = null,
  accountId = null,
  invoiceId = null,
  status,
  requestBody = null,
  responseBody = null,
  warnings = null,
  durationMs = null,
}) {
  await run(
    `INSERT INTO iugu_mock_requests
       (channel, method, path, route, auth, account_id, invoice_id, status, request_body, response_body, warnings, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      channel,
      method,
      path,
      route,
      auth,
      accountId,
      invoiceId,
      status,
      requestBody == null ? null : JSON.stringify(requestBody),
      responseBody == null ? null : JSON.stringify(responseBody),
      warnings && warnings.length ? JSON.stringify(warnings) : null,
      durationMs,
    ]
  );
}

export async function listIuguMockRequests({ limit = 50, offset = 0, accountId, invoiceId, channel } = {}) {
  const where = [];
  const params = [];
  if (accountId) {
    where.push('account_id = ?');
    params.push(accountId);
  }
  if (invoiceId) {
    where.push('invoice_id = ?');
    params.push(invoiceId);
  }
  if (channel) {
    where.push('channel = ?');
    params.push(channel);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await all(
    `SELECT * FROM iugu_mock_requests ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const totalRow = await get(`SELECT COUNT(*) AS count FROM iugu_mock_requests ${clause}`, params);
  const parse = (value) => (value == null ? null : JSON.parse(value));
  return {
    items: rows.map((row) => ({
      ...row,
      request_body: parse(row.request_body),
      response_body: parse(row.response_body),
      warnings: parse(row.warnings) ?? [],
    })),
    total: totalRow?.count ?? 0,
  };
}

export async function clearIuguMockRequests() {
  const result = await run(`DELETE FROM iugu_mock_requests`);
  return result?.changes ?? 0;
}
