import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { LOG_DIR, LOG_FILE } from '../config/env.js';

let ready = false;

async function ensureReady() {
  if (ready) return;
  await fsp.mkdir(LOG_DIR, { recursive: true }).catch(() => {});
  // Ensure file exists
  try { await fsp.access(LOG_FILE, fs.constants.F_OK); }
  catch { await fsp.writeFile(LOG_FILE, '', 'utf8').catch(() => {}); }
  ready = true;
}

export async function logLine(level, message, meta) {
  try {
    await ensureReady();
    const ts = new Date().toISOString();
    const base = typeof message === 'string' ? message : JSON.stringify(message);
    const extra = meta ? ' ' + JSON.stringify(meta) : '';
    const line = `[${ts}] ${level.toUpperCase()} ${base}${extra}\n`;
    await fsp.appendFile(LOG_FILE, line, 'utf8');
  } catch {
    // swallow logging errors
  }
}

export async function tailLogBytes(maxBytes) {
  await ensureReady();
  const stat = await fsp.stat(LOG_FILE).catch(() => null);
  if (!stat) return '';
  const size = stat.size;
  const start = Math.max(0, size - maxBytes);
  return new Promise((resolve, reject) => {
    let data = '';
    const stream = fs.createReadStream(LOG_FILE, { start, end: size - 1, encoding: 'utf8' });
    stream.on('data', (chunk) => { data += chunk; });
    stream.on('end', () => resolve(data));
    stream.on('error', reject);
  });
}

export async function clearLogs() {
  await ensureReady();
  await fsp.truncate(LOG_FILE, 0);
}

export { LOG_FILE };

