export async function sendPostbackHandler(req, res) {
  try {
    const { baseUrl, payload } = req.body || {};
    if (!baseUrl || typeof baseUrl !== 'string') {
      return res.status(400).json({ error: "'baseUrl' é obrigatório" });
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return res.status(400).json({ error: "'payload' precisa ser um objeto JSON" });
    }
    if (!payload.id) {
      return res.status(400).json({ error: "o campo 'id' é obrigatório no payload" });
    }

    const url = `${baseUrl.replace(/\/+$/, '')}/gateway/webhook`;
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });

    const text = await upstream.text();
    let body = text;
    try { body = JSON.parse(text); } catch {}

    res.status(200).json({
      requestUrl: url,
      requestBody: payload,
      status: upstream.status,
      ok: upstream.ok,
      body,
    });
  } catch (e) {
    res.status(502).json({ error: `Falha ao chamar postback gateway: ${e.message}` });
  }
}
