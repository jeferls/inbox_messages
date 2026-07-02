import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const PORT = process.env.PORT || 80;
// Container-to-container: dentro da rede greenn-network o hostname do serviço funciona.
const BACKEND_URL = process.env.GREENN_BACK_URL || 'http://greenn-back-nginx';

// Proxy simples: repassa bytes crus e o Content-Type original (preserva boundary de multipart).
app.use('/api', express.raw({ type: '*/*', limit: '20mb' }), async (req, res) => {
  try {
    const headers = {};
    if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
    if (req.headers['accept']) headers['Accept'] = req.headers['accept'];

    const upstream = await fetch(`${BACKEND_URL}${req.originalUrl}`, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
    });

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    res.send(buf);
  } catch (e) {
    res.status(502).json({ error: `Proxy error: ${e.message}` });
  }
});

app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => console.log(`claim-page ouvindo em http://localhost:${PORT}`));
