// Leitura e escrita da tabela `global_settings` do greenn-back (key/value).
// O backend cacheia a leitura por 30 min (Cache::remember), então a escrita também
// esvazia a chave no cache do container para a mudança valer na hora.

import { getGreennPool } from './greenn-db.js';
import { execInContainer, isDockerAvailable } from './docker.service.js';
import { GREENN_BACK_CONTAINER } from '../config/env.js';

export async function getGlobalSetting(key) {
  const [rows] = await getGreennPool().query('SELECT value FROM global_settings WHERE `key` = ? LIMIT 1', [key]);
  return { key, exists: rows.length > 0, value: rows[0]?.value ?? null };
}

/** Esvazia `key` no cache do container do greenn-back. Falha não é fatal: volta em `cacheError`. */
export async function forgetBackCache(key) {
  let cacheCleared = false;
  let cacheError = null;
  if (isDockerAvailable()) {
    try {
      const out = await execInContainer(GREENN_BACK_CONTAINER, ['php', 'artisan', 'cache:forget', key]);
      cacheCleared = out.exitCode === 0;
      if (!cacheCleared) cacheError = out.stderr || out.stdout;
    } catch (e) {
      cacheError = e.message;
    }
  } else {
    cacheError = 'socket do Docker indisponível';
  }
  return { cacheCleared, cacheError };
}

export async function setGlobalSetting(key, value) {
  const conn = await getGreennPool().getConnection();
  try {
    const [result] = await conn.query('UPDATE global_settings SET value = ?, updated_at = NOW() WHERE `key` = ?', [value, key]);
    if (result.affectedRows === 0) {
      await conn.query('INSERT INTO global_settings (`key`, value, created_at, updated_at) VALUES (?, ?, NOW(), NOW())', [key, value]);
    }
  } finally {
    conn.release();
  }

  return { ...(await getGlobalSetting(key)), ...(await forgetBackCache(key)) };
}
