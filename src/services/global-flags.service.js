// Leitura e escrita da tabela `global_flags` do greenn-back.
//
// Não existe endpoint para ligar/desligar uma global flag: no backend a tabela é populada
// por seeder e consultada por `FlagHelper::exists()` / `GlobalFlag::cachedCheck()`. Como esta
// ferramenta é local e já conversa com o MySQL pela greenn-network (mesmo caminho do catálogo
// de produtos), o toggle escreve direto na tabela.

import { getGreennPool } from './greenn-db.js';

/**
 * Estado atual da flag. A flag está "ligada" quando existe uma linha para ela —
 * é exatamente o que `FlagHelper::exists()` avalia no backend.
 */
export async function getGlobalFlag(flag, db = getGreennPool()) {
  const [rows] = await db.query(
    'SELECT id, flag, created_at, updated_at FROM global_flags WHERE flag = ? ORDER BY id ASC',
    [flag],
  );

  return {
    flag,
    enabled: rows.length > 0,
    // Linhas duplicadas não quebram o backend (ele só checa existência), mas são úteis de ver aqui.
    rows: rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
}

/**
 * Liga (insere a linha) ou desliga (remove todas as linhas da flag).
 * `db` é um pool (padrão) ou uma conexão avulsa (painel de flags, que usa o .env digitado).
 * Idempotente: ligar uma flag já ligada não cria duplicata.
 */
export async function setGlobalFlag(flag, enabled, db = getGreennPool()) {
  if (enabled) {
    const [existing] = await db.query('SELECT id FROM global_flags WHERE flag = ? LIMIT 1', [flag]);

    if (existing.length === 0) {
      await db.query('INSERT INTO global_flags (flag, created_at, updated_at) VALUES (?, NOW(), NOW())', [flag]);
    }
  } else {
    await db.query('DELETE FROM global_flags WHERE flag = ?', [flag]);
  }

  return getGlobalFlag(flag, db);
}
