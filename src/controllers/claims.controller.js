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

