import { fileURLToPath } from 'url';
import path from 'path';

export const __filename = fileURLToPath(import.meta.url);
export const __dirname = path.dirname(__filename);

export const PORT = Number(process.env.PORT || 8115);
export const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
// BODY_LIMIT: tamanho máximo aceito pelo body parser.
// Aceita valores como '10mb', '1gb'. Se for '0', '-1' ou 'infinity', tratamos como sem limite (Infinity).
// Padrão: sem limite (Infinity) conforme solicitado.
export const BODY_LIMIT = (() => {
  const raw = process.env.BODY_LIMIT?.trim();
  if (!raw) return Infinity;
  const lc = raw.toLowerCase();
  if (raw === '0' || raw === '-1' || lc === 'infinity') return Infinity;
  return raw;
})();

// DB path default is project root data.db unless overridden
export const DEFAULT_DB_PATH = path.join(__dirname, '..', '..', 'data.db');
export const DB_PATH = (process.env.DB_PATH && process.env.DB_PATH.trim()) || DEFAULT_DB_PATH;

// Logs
export const LOG_DIR = (process.env.LOG_DIR && process.env.LOG_DIR.trim()) || path.join(__dirname, '..', '..', 'logs');
export const LOG_FILE = (process.env.LOG_FILE && process.env.LOG_FILE.trim()) || path.join(LOG_DIR, 'app.log');
export const LOG_MAX_TAIL_BYTES = Number(process.env.LOG_MAX_TAIL_BYTES || 1024 * 1024 * 2); // 2MB
