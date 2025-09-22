import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { ALLOWED_ORIGIN, BODY_LIMIT } from './config/env.js';
import { dbInit } from './db/index.js';
import emailsRoutes from './routes/emails.routes.js';
import healthRoutes from './routes/health.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Aceita payloads grandes; valor configurável via env BODY_LIMIT (padrão: 100mb)
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

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

export default app;

