import { Router } from 'express';
import http from 'node:http';
import https from 'node:https';

const router = Router();

// Verifica se uma URL pode ser aberta dentro de um iframe (preview de dispositivo)
router.get('/embed-check', (req, res) => {
  let target;
  try {
    target = new URL(String(req.query.url || ''));
  } catch {
    return res.status(400).json({ error: 'URL inválida' });
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return res.status(400).json({ error: 'Protocolo não suportado' });
  }

  const client = target.protocol === 'https:' ? https : http;
  const reqOut = client.request(target, { method: 'GET', timeout: 8000 }, (out) => {
    out.destroy();
    const xfo = out.headers['x-frame-options'] || null;
    const csp = out.headers['content-security-policy'] || null;
    const frameAncestors = csp ? (csp.match(/frame-ancestors[^;]*/i) || [null])[0] : null;
    const blocked = Boolean(xfo) || Boolean(frameAncestors && !/\*/.test(frameAncestors));
    res.json({ status: out.statusCode, blocked, xFrameOptions: xfo, frameAncestors });
  });
  reqOut.on('timeout', () => reqOut.destroy(new Error('timeout')));
  reqOut.on('error', (err) => res.status(502).json({ error: String(err?.message || err) }));
  reqOut.end();
});

export default router;
