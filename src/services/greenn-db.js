// Pool único de leitura/escrita no MySQL do greenn-back, compartilhado pelas telas que
// precisam de dados que não têm endpoint público (catálogo de produtos, global flags,
// análises da Konduto). É uso local, pela greenn-network.

import mysql from 'mysql2/promise';
import { GREENN_DB } from '../config/env.js';

let pool = null;

export function getGreennPool() {
  pool ??= mysql.createPool({
    ...GREENN_DB,
    waitForConnections: true,
    connectionLimit: 4,
    // Sem isso o driver devolve DECIMAL como string (o valor da oferta chega como "97.00").
    decimalNumbers: true,
  });

  return pool;
}

// Tabelas opcionais (ex.: tag_ur_alerts) podem não existir em bancos locais desatualizados.
export async function tableExists(pool, table) {
  const [[row]] = await pool.query(
    'SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
    [table],
  );
  return row.total > 0;
}
