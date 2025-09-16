import { fileURLToPath } from 'url';
import path from 'path';

export const __filename = fileURLToPath(import.meta.url);
export const __dirname = path.dirname(__filename);

export const PORT = Number(process.env.PORT || 8115);
export const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

// DB path default is project root data.db unless overridden
export const DEFAULT_DB_PATH = path.join(__dirname, '..', '..', 'data.db');
export const DB_PATH = (process.env.DB_PATH && process.env.DB_PATH.trim()) || DEFAULT_DB_PATH;

