import sqlite3 from 'sqlite3';
import { DB_PATH } from '../config/env.js';
import crypto from 'node:crypto';

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

export async function getLiquidacaoAntecipacaoProcessamentoByNumCtrlCip(numCtrlCip) {
  const row = await get(
    `SELECT payload_processamento FROM liquidacoes_antecipacao WHERE num_ctrl_cip = ?`,
    [numCtrlCip]
  );
  if (!row) return null;

  try {
    return JSON.parse(row.payload_processamento);
  } catch {
    return null;
  }
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
