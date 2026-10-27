// Painel de flags do greenn-back (banco de DEV local).
//
// O usuário informa o path do greenn-back; daqui leem-se o `.env.dev` (credenciais do MySQL) e o
// `GlobalFlagSeeder.php` (lista de flags). A conexão vem do .env digitado — não do GREENN_DB —
// e só é aberta depois do guard de ambiente (APP_ENV / DB_HOST locais). A senha nunca sai daqui.

import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { setGlobalFlag } from './global-flags.service.js';
import { forgetBackCache } from './global-settings.service.js';

// Erros com `status` são de entrada/guard (a rota devolve a mensagem); sem `status` = falha de banco.
const fail = (status, message) => Object.assign(new Error(message), { status });

const LOCAL_HOSTS = ['greenn-back-mysql', 'localhost', '127.0.0.1'];

/** `global_flags.flag` é varchar(50). */
export function isValidFlag(name) {
  return typeof name === 'string' && /^[A-Za-z0-9_.\-]{1,50}$/.test(name);
}

/** Parser mínimo de .env (sem dotenv): aspas, `export`, comentário inline fora de aspas. */
export function parseEnv(text) {
  const env = {};
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2];
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      const end = value.indexOf(quote, 1);
      value = end === -1 ? value.slice(1) : value.slice(1, end);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    env[m[1]] = value;
  }
  return env;
}

/** Nomes do array `$flags = [ ... ];` do GlobalFlagSeeder, sem comentários e sem duplicatas. */
export function parseSeederFlags(text) {
  const block = String(text).match(/\$flags\s*=\s*\[([\s\S]*?)\]\s*;/);
  if (!block) throw fail(400, 'Array $flags não encontrado no GlobalFlagSeeder.php');
  const body = block[1].replace(/\/\/.*$/gm, '');
  const names = [...body.matchAll(/'([^'\\]*)'|"([^"\\]*)"/g)].map((m) => m[1] ?? m[2]).filter(isValidFlag);
  return [...new Set(names)];
}

/** Resolve o path digitado (raiz do repo, raiz Laravel ou mount /greenn-back) e acha .env + seeder. */
export function locateProject(input, exists = fs.existsSync) {
  if (typeof input !== 'string' || !input.trim()) throw fail(400, 'Informe o caminho do greenn-back');
  const typed = path.resolve(input.trim());
  const backPath = exists(typed) ? typed : exists('/greenn-back') ? '/greenn-back' : null;
  if (!backPath) throw fail(400, `Caminho não encontrado: ${typed}`);

  const first = (candidates, what) => {
    const found = candidates.find((c) => exists(c));
    if (!found) throw fail(400, `${what} não encontrado em ${candidates[0]}`);
    return found;
  };
  return {
    backPath,
    envFile: first([path.join(backPath, '.env.dev'), path.join(backPath, '..', '.env.dev'), path.join(backPath, '.env')], '.env'),
    seederFile: first(
      [path.join(backPath, 'src/database/seeders/GlobalFlagSeeder.php'), path.join(backPath, 'database/seeders/GlobalFlagSeeder.php')],
      'GlobalFlagSeeder.php',
    ),
  };
}

/** Guard D-05 + host do MySQL (fora do container o hostname da greenn-network não resolve: 127.0.0.1:3301). */
export function resolveDbConfig(env, { inContainer }) {
  if (['production', 'prod'].includes(String(env.APP_ENV || '').toLowerCase())) {
    throw fail(400, 'APP_ENV=production no .env: o painel só opera em dev');
  }
  const host = env.DB_HOST || '127.0.0.1';
  if (!LOCAL_HOSTS.includes(host)) throw fail(400, `DB_HOST (${host}) não parece local - recusado`);
  const viaHost = host === 'greenn-back-mysql' && !inContainer;
  return {
    host: viaHost ? '127.0.0.1' : host,
    port: viaHost ? 3301 : Number(env.DB_PORT || 3306),
    user: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    database: env.DB_DATABASE,
  };
}

/** Abre uma conexão por requisição com o banco do .env digitado; nunca loga a config. */
export async function withDb(input, fn) {
  const project = locateProject(input);
  const env = parseEnv(fs.readFileSync(project.envFile, 'utf8'));
  const cfg = resolveDbConfig(env, { inContainer: fs.existsSync('/.dockerenv') });
  const conn = await mysql.createConnection({ ...cfg, connectTimeout: 5000 });
  try {
    return await fn(conn, { ...project, db: { host: cfg.host, port: cfg.port, database: cfg.database } });
  } finally {
    await conn.end();
  }
}

export function listFlags(input) {
  return withDb(input, async (conn, project) => {
    const seeded = parseSeederFlags(fs.readFileSync(project.seederFile, 'utf8'));
    const [rows] = await conn.query('SELECT DISTINCT flag FROM global_flags');
    const on = new Set(rows.map((r) => r.flag));
    const flags = seeded.map((flag) => ({ flag, enabled: on.has(flag), inSeeder: true }));
    for (const flag of on) if (!seeded.includes(flag)) flags.push({ flag, enabled: true, inSeeder: false });
    return { backPath: project.backPath, envFile: project.envFile, seederFile: project.seederFile, db: project.db, flags };
  });
}

/** Liga/desliga a flag global e esquece `feature_flag_<FLAG>` (GlobalFlag::cachedCheck). Cache é não-fatal. */
export async function toggleFlag(input, flag, enabled) {
  if (!isValidFlag(flag)) throw fail(400, 'Nome de flag inválido');
  if (typeof enabled !== 'boolean') throw fail(400, "'enabled' precisa ser booleano");
  const state = await withDb(input, (conn) => setGlobalFlag(flag, enabled, conn));
  return { ...state, ...(await forgetBackCache(`feature_flag_${flag}`)) };
}

const ID_RE = /^\d+$/;

export async function listUserFlags(input, flag) {
  if (!isValidFlag(flag)) throw fail(400, 'Nome de flag inválido');
  return withDb(input, async (conn) => {
    const [items] = await conn.query(
      'SELECT uf.id, uf.user_id, u.email, uf.created_at FROM user_flags uf LEFT JOIN users u ON u.id = uf.user_id WHERE uf.flag = ? ORDER BY uf.id DESC',
      [flag],
    );
    return { flag, items };
  });
}

/** `user` = ID numérico ou e-mail; resolve para a linha de `users` ou lança 400/404. */
async function findUser(conn, user) {
  const ref = String(user ?? '').trim();
  const byId = ID_RE.test(ref);
  if (!byId && !ref.includes('@')) throw fail(400, 'Informe o ID numérico ou o e-mail do usuário');
  const [[found]] = await conn.query(`SELECT id, email FROM users WHERE ${byId ? 'id' : 'email'} = ? LIMIT 1`, [ref]);
  if (!found) throw fail(404, 'Usuário não encontrado');
  return found;
}

export async function listFlagsOfUser(input, user) {
  return withDb(input, async (conn) => {
    const found = await findUser(conn, user);
    const [items] = await conn.query('SELECT id, flag, created_at FROM user_flags WHERE user_id = ? ORDER BY flag', [found.id]);
    return { user_id: found.id, email: found.email, items };
  });
}

/** user_flags não tem unique, então checa duplicata antes do INSERT. Sem cache (FlagHelper não cacheia). */
export async function addUserFlag(input, flag, user) {
  if (!isValidFlag(flag)) throw fail(400, 'Nome de flag inválido');
  return withDb(input, async (conn) => {
    const found = await findUser(conn, user);
    const out = { user_id: found.id, email: found.email, flag };
    // Sem unique em user_flags: o lock nomeado serializa check+insert entre requisições concorrentes.
    const lock = `flags-panel:${found.id}:${flag}`;
    const [[{ ok }]] = await conn.query('SELECT GET_LOCK(?, 5) AS ok', [lock]);
    if (ok !== 1) throw fail(409, 'Outra gravação desse usuário/flag está em andamento, tente de novo');
    try {
      const [[dup]] = await conn.query('SELECT id FROM user_flags WHERE user_id = ? AND flag = ? LIMIT 1', [found.id, flag]);
      if (dup) return { id: dup.id, ...out, alreadyExisted: true };
      const [r] = await conn.query('INSERT INTO user_flags (user_id, flag, created_at, updated_at) VALUES (?, ?, NOW(), NOW())', [found.id, flag]);
      return { id: r.insertId, ...out, alreadyExisted: false };
    } finally {
      await conn.query('SELECT RELEASE_LOCK(?)', [lock]);
    }
  });
}

export async function removeUserFlag(input, id) {
  if (!ID_RE.test(String(id))) throw fail(400, 'ID inválido');
  return withDb(input, async (conn) => {
    const [r] = await conn.query('DELETE FROM user_flags WHERE id = ?', [id]);
    if (r.affectedRows === 0) throw fail(404, 'Registro de user_flags não encontrado');
    return { removed: true, id };
  });
}

/** Remove todas as user_flags de um usuário. */
export async function removeAllUserFlags(input, user) {
  return withDb(input, async (conn) => {
    const found = await findUser(conn, user);
    const [r] = await conn.query('DELETE FROM user_flags WHERE user_id = ?', [found.id]);
    return { removed: r.affectedRows, user_id: found.id };
  });
}
