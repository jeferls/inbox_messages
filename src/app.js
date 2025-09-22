import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { ALLOWED_ORIGIN, BODY_LIMIT } from './config/env.js';
import { logLine } from './utils/logger.js';
import crypto from 'node:crypto';
import { dbInit } from './db/index.js';
import emailsRoutes from './routes/emails.routes.js';
import healthRoutes from './routes/health.routes.js';
import logsRoutes from './routes/logs.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Atribui ID de correlação e log básico de headers antes dos parsers
app.use((req, res, next) => {
  try { req._reqId = req.headers['x-request-id'] || crypto.randomUUID(); } catch { req._reqId = String(Date.now()) + Math.random().toString(36).slice(2); }
  try { res.setHeader('X-Request-Id', req._reqId); } catch {}
  const cl = req.headers['content-length'] || '-';
  const te = req.headers['transfer-encoding'] || '-';
  const ct = req.headers['content-type'] || '-';
  req._dbgStart = process.hrtime.bigint();
  console.log('[in]', req._reqId, req.method, req.originalUrl, 'cl=', cl, 'te=', te, 'ct=', ct);
  // log to file too
  logLine('info', '[in]', { reqId: req._reqId, method: req.method, url: req.originalUrl, cl, te, ct }).catch(() => {});
  next();
});

// Sem limite prático por padrão (BODY_LIMIT = Infinity). ATENÇÃO: pode consumir muita memória.
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT, parameterLimit: Number.MAX_SAFE_INTEGER }));

// Após parsing, loga tamanho estimado (se possível) e tempo decorrido até aqui
app.use((req, _res, next) => {
  try {
    const start = req._dbgStart || process.hrtime.bigint();
    const durMs = Number((process.hrtime.bigint() - start) / BigInt(1e6));
    const ct = (req.headers['content-type'] || '').toString();
    let size = null;
    const cl = req.headers['content-length'];
    if (cl && !Number.isNaN(Number(cl))) {
      size = Number(cl);
    } else if (/json/i.test(ct) && req.body != null) {
      try { size = Buffer.byteLength(JSON.stringify(req.body)); } catch {}
    } else if (/x-www-form-urlencoded/i.test(ct) && req.body != null) {
      try { size = Buffer.byteLength(new URLSearchParams(req.body).toString()); } catch {}
    }
    console.log('[in-read]', req._reqId, req.method, req.originalUrl, 'size=', size ?? '-', 'durMs=', durMs);
    logLine('info', '[in-read]', { reqId: req._reqId, method: req.method, url: req.originalUrl, size: size ?? null, durMs }).catch(() => {});
  } catch {}
  next();
});

// CORS simples
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Arquivos estáticos
app.use(express.static(path.join(__dirname, '..', 'public')));

// Inicializa DB (top-level await OK em ESM)
await dbInit();

// Rotas
app.use('/api', healthRoutes);
app.use('/api', emailsRoutes);
app.use('/api', logsRoutes);

// Tratativa explícita para payload grande: retorna JSON amigável
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    const limitDesc = (typeof BODY_LIMIT === 'number' || BODY_LIMIT === Infinity)
      ? 'sem limite (Infinity)'
      : String(BODY_LIMIT);
    const meta = {
      length: err.length ?? null,
      limit: err.limit ?? null,
      contentLengthHeader: req.headers['content-length'] || null,
      url: req.originalUrl,
      method: req.method,
    };
    console.warn('413 Payload Too Large', { reqId: req._reqId, ...meta });
    logLine('warn', '413 Payload Too Large', { reqId: req._reqId, ...meta }).catch(() => {});
    return res.status(413).json({ error: 'Payload Too Large', limit: limitDesc, ...meta });
  }
  next(err);
});

// (X-Request-Id já incluído no primeiro middleware)

export default app;
