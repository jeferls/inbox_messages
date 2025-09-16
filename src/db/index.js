import sqlite3 from 'sqlite3';
import { DB_PATH } from '../config/env.js';

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

