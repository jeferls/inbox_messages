import { getGreennPool } from '../services/greenn-db.js';

const FIELDS = ['sale_id', 'client_id', 'subjective', 'category', 'objective', 'description'];

export async function sendClaimHandler(req, res) {
  try {
    const { baseUrl } = req.body || {};
    if (!baseUrl || typeof baseUrl !== 'string') {
      return res.status(400).json({ error: "'baseUrl' é obrigatório" });
    }

    const form = new FormData();
    for (const field of FIELDS) {
      form.append(field, String(req.body?.[field] ?? ''));
    }

    const url = `${baseUrl.replace(/\/+$/, '')}/api/claim`;
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: form,
    });

    const text = await upstream.text();
    let body = text;
    try { body = JSON.parse(text); } catch {}

    res.status(200).json({
      requestUrl: url,
      status: upstream.status,
      ok: upstream.ok,
      body,
    });
  } catch (e) {
    res.status(502).json({ error: `Falha ao chamar API de reclamações: ${e.message}` });
  }
}

export async function resendClaimSecretHandler(req, res) {
  try {
    const { baseUrl, claimId } = req.query;
    if (!baseUrl || !claimId) {
      return res.status(400).json({ error: "'baseUrl' e 'claimId' são obrigatórios" });
    }

    const url = `${String(baseUrl).replace(/\/+$/, '')}/api/claim/secret?id=${encodeURIComponent(claimId)}`;
    const upstream = await fetch(url, { headers: { Accept: 'application/json' } });

    const text = await upstream.text();
    let body = text;
    try { body = JSON.parse(text); } catch {}

    res.status(200).json({
      requestUrl: url,
      status: upstream.status,
      ok: upstream.ok,
      body,
    });
  } catch (e) {
    res.status(502).json({ error: `Falha ao reenviar secret: ${e.message}` });
  }
}

// Lista as sales mais recentes do MySQL local para o select da tela (staging não tem acesso ao banco).
export async function listRecentSalesHandler(req, res) {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    const pool = getGreennPool();
    const [rows] = await pool.query(
      `SELECT s.id, s.client_id, s.status, s.amount, s.created_at, c.name AS client_name
         FROM sales s
         LEFT JOIN clients c ON c.id = s.client_id
        ORDER BY s.id DESC
        LIMIT ?`,
      [limit],
    );

    res.json({
      sales: rows.map((row) => ({
        id: row.id,
        clientId: row.client_id,
        clientName: row.client_name,
        status: row.status,
        amount: row.amount,
        createdAt: row.created_at,
      })),
    });
  } catch (e) {
    res.status(502).json({ error: `Falha ao listar sales: ${e.message}` });
  }
}

// Usado quando o sale_id é digitado manualmente: devolve o client_id para preencher o formulário.
export async function getSaleHandler(req, res) {
  try {
    const saleId = Number(req.params.id);
    if (!Number.isInteger(saleId) || saleId <= 0) {
      return res.status(400).json({ error: "'id' inválido" });
    }

    const pool = getGreennPool();
    const [rows] = await pool.query(
      `SELECT s.id, s.client_id, s.status, s.amount, c.name AS client_name
         FROM sales s
         LEFT JOIN clients c ON c.id = s.client_id
        WHERE s.id = ?
        LIMIT 1`,
      [saleId],
    );

    if (!rows.length) return res.status(404).json({ error: 'Sale não encontrada' });

    res.json({
      id: rows[0].id,
      clientId: rows[0].client_id,
      clientName: rows[0].client_name,
      status: rows[0].status,
      amount: rows[0].amount,
    });
  } catch (e) {
    res.status(502).json({ error: `Falha ao buscar sale: ${e.message}` });
  }
}
