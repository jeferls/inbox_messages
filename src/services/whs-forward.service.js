// Encaminhador do webhook.site: lê as requisições capturadas em um token do webhook.site e
// reenvia para uma URL local (ex.: webhook da Certta no greenn-back). Serve para receber em
// ambiente local webhooks de provedores que só aceitam URL pública.
//
// Cada encaminhador roda um loop próprio (setTimeout encadeado). O que já foi reenviado fica
// registrado (uuid + data) para não duplicar entre reinícios. Config e estado ficam em
// WHS_FORWARD_STATE_FILE, ao lado do SQLite.

import fs from 'node:fs';
import crypto from 'node:crypto';
import { WHS_BASE_URL, WHS_FORWARD_STATE_FILE } from '../config/env.js';

const LOG_LIMIT = 200;
const SEEN_LIMIT = 500;
const MAX_PAGES = 10;

// headers que descrevem a conexão original — não podem ser repassados
const HOP_BY_HOP = new Set([
  'host', 'content-length', 'connection', 'keep-alive', 'transfer-encoding',
  'accept-encoding', 'upgrade', 'proxy-authorization', 'proxy-authenticate', 'te', 'trailer',
]);

/** @type {Map<string, { cfg: object, state: { seen: string[], since: string|null }, rt: object }>} */
const forwarders = new Map();

// ---------- persistência ----------
function loadFile() {
  try { return JSON.parse(fs.readFileSync(WHS_FORWARD_STATE_FILE, 'utf8')); } catch { return { forwarders: [], state: {} }; }
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const data = { forwarders: [], state: {} };
    for (const [id, f] of forwarders) {
      data.forwarders.push(f.cfg);
      data.state[id] = { seen: f.state.seen.slice(-SEEN_LIMIT), since: f.state.since };
    }
    fs.writeFile(WHS_FORWARD_STATE_FILE, JSON.stringify(data, null, 2), () => {});
  }, 150);
  saveTimer.unref?.();
}

function newRuntime() {
  return { running: false, polling: false, timer: null, lastPollAt: null, lastError: null, forwarded: 0, failed: 0, log: [] };
}

const persisted = loadFile();
for (const cfg of persisted.forwarders || []) {
  const st = persisted.state?.[cfg.id] || {};
  forwarders.set(cfg.id, { cfg, state: { seen: st.seen || [], since: st.since || null }, rt: newRuntime() });
}

// ---------- validação ----------
function normalize(input, current = {}) {
  const cfg = { ...current };
  if ('name' in input) cfg.name = String(input.name ?? '').trim();
  if ('token' in input) cfg.token = String(input.token ?? '').trim();
  if ('target' in input) cfg.target = String(input.target ?? '').trim();
  if ('apiKey' in input) cfg.apiKey = String(input.apiKey ?? '').trim();
  if ('intervalMs' in input) cfg.intervalMs = Number(input.intervalMs);
  if ('autoStart' in input) cfg.autoStart = Boolean(input.autoStart);

  if (!cfg.token || !/^[0-9a-f-]{36}$/i.test(cfg.token)) throw new ValidationError("'token' precisa ser o UUID do webhook.site");
  if (!cfg.target) throw new ValidationError("'target' é obrigatório");
  try { const u = new URL(cfg.target); if (!/^https?:$/.test(u.protocol)) throw new Error(); } catch { throw new ValidationError("'target' precisa ser uma URL http(s)"); }
  if (!Number.isFinite(cfg.intervalMs) || cfg.intervalMs < 1000) cfg.intervalMs = 3000;
  cfg.name = cfg.name || cfg.token.slice(0, 8);
  cfg.apiKey = cfg.apiKey || '';
  cfg.autoStart = cfg.autoStart ?? true;
  return cfg;
}

export class ValidationError extends Error {}

// ---------- webhook.site ----------
async function api(cfg, pathname, params = {}) {
  const url = new URL(`${WHS_BASE_URL}/token/${cfg.token}${pathname}`);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  const headers = { Accept: 'application/json' };
  if (cfg.apiKey) headers['Api-Key'] = cfg.apiKey;
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (r.status === 429) throw new Error('rate limit (429) do webhook.site — aumente o intervalo');
  if (!r.ok) throw new Error(`webhook.site ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

/** Valida token/apiKey sem criar nada: devolve o resumo do token no webhook.site. */
export async function checkToken({ token, apiKey }) {
  const cfg = normalize({ token, apiKey, target: 'http://x' });
  const info = await api(cfg, '');
  const reqs = await api(cfg, '/requests', { sorting: 'newest', page: 1, per_page: 1 });
  return { uuid: info.uuid, createdAt: info.created_at, requests: reqs.total ?? reqs.data?.length ?? 0, lastRequestAt: reqs.data?.[0]?.created_at ?? null };
}

/** Busca páginas do mais novo para o mais antigo até achar algo já visto. */
async function fetchNew(f) {
  const fresh = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await api(f.cfg, '/requests', { sorting: 'newest', page, date_from: f.state.since ?? undefined });
    for (const req of res.data || []) {
      if (f.state.seen.includes(req.uuid)) return fresh;
      fresh.push(req);
    }
    if (res.is_last_page || !res.data?.length) break;
  }
  return fresh;
}

function buildHeaders(req) {
  const out = {};
  for (const [name, values] of Object.entries(req.headers || {})) {
    if (HOP_BY_HOP.has(name.toLowerCase())) continue;
    out[name] = Array.isArray(values) ? values.join(', ') : String(values);
  }
  out['x-forwarded-by'] = 'greenn-tools/whs-forward';
  out['x-whs-request-id'] = req.uuid;
  out['x-whs-created-at'] = req.created_at;
  return out;
}

function buildUrl(cfg, req) {
  const url = new URL(cfg.target);
  // preserva a query original sem sobrescrever a do target
  for (const [k, v] of Object.entries(req.query || {})) url.searchParams.append(k, v);
  return url;
}

function pushLog(f, entry) {
  f.rt.log.push({ at: new Date().toISOString(), ...entry });
  if (f.rt.log.length > LOG_LIMIT) f.rt.log.splice(0, f.rt.log.length - LOG_LIMIT);
}

async function forward(f, req) {
  const method = (req.method || 'POST').toUpperCase();
  const hasBody = !['GET', 'HEAD'].includes(method);
  const started = Date.now();
  const base = { uuid: req.uuid, createdAt: req.created_at, method, ip: req.ip, size: req.size ?? (req.content?.length ?? 0) };
  try {
    const r = await fetch(buildUrl(f.cfg, req), {
      method,
      headers: buildHeaders(req),
      body: hasBody ? (req.content ?? '') : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const body = await r.text().catch(() => '');
    pushLog(f, { ...base, ok: r.ok, status: r.status, ms: Date.now() - started, response: body.slice(0, 500) });
    f.rt.forwarded += 1;
    return true;
  } catch (e) {
    pushLog(f, { ...base, ok: false, status: null, ms: Date.now() - started, error: e.cause?.code || e.message });
    f.rt.failed += 1;
    return false; // não marca como visto: tenta de novo no próximo ciclo
  }
}

async function tick(f) {
  if (f.rt.polling) return;
  f.rt.polling = true;
  try {
    const fresh = await fetchNew(f);
    f.rt.lastPollAt = new Date().toISOString();
    f.rt.lastError = null;
    // do mais antigo para o mais novo, preservando a ordem cronológica
    for (const req of fresh.reverse()) {
      if (!f.rt.running) break;
      if (await forward(f, req)) {
        f.state.seen.push(req.uuid);
        f.state.since = req.created_at;
      }
    }
    if (fresh.length) save();
  } catch (e) {
    f.rt.lastError = e.message;
  } finally {
    f.rt.polling = false;
    if (f.rt.running) {
      f.rt.timer = setTimeout(() => tick(f), f.cfg.intervalMs);
      f.rt.timer.unref?.();
    }
  }
}

// ---------- API do serviço ----------
function get(id) {
  const f = forwarders.get(id);
  if (!f) throw new NotFoundError(`Encaminhador não encontrado: ${id}`);
  return f;
}
export class NotFoundError extends Error {}

function view(f) {
  const { timer, polling, log, ...rt } = f.rt;
  return { ...f.cfg, apiKey: f.cfg.apiKey ? '••••' : '', hasApiKey: Boolean(f.cfg.apiKey), ...rt, seen: f.state.seen.length, since: f.state.since, lastEvents: log.slice(-5).reverse() };
}

export function list() { return [...forwarders.values()].map(view); }
export function getLog(id) { return get(id).rt.log.slice().reverse(); }

export function create(input) {
  const cfg = normalize(input);
  cfg.id = crypto.randomUUID().slice(0, 8);
  cfg.createdAt = new Date().toISOString();
  const f = { cfg, state: { seen: [], since: null }, rt: newRuntime() };
  forwarders.set(cfg.id, f);
  save();
  return view(f);
}

export function update(id, input) {
  const f = get(id);
  // apiKey mascarada na UI: só troca se vier um valor novo
  if (input.apiKey === '••••') delete input.apiKey;
  const cfg = normalize(input, f.cfg);
  const tokenChanged = cfg.token !== f.cfg.token;
  f.cfg = cfg;
  if (tokenChanged) f.state = { seen: [], since: null };
  save();
  return view(f);
}

export function remove(id) {
  const f = get(id);
  stop(id);
  forwarders.delete(f.cfg.id);
  save();
}

/**
 * Inicia o loop. Por padrão ignora o histórico já existente no webhook.site e reenvia só o que
 * chegar daqui em diante; com backfill=true reenvia o histórico (do mais antigo para o mais novo).
 */
export async function start(id, { backfill = false } = {}) {
  const f = get(id);
  if (f.rt.running) return view(f);
  if (backfill) {
    f.state = { seen: [], since: null };
  } else if (!f.state.since) {
    const res = await api(f.cfg, '/requests', { sorting: 'newest', page: 1 });
    f.state.seen = (res.data || []).map((r) => r.uuid);
    f.state.since = res.data?.[0]?.created_at ?? null;
  }
  save();
  f.rt.running = true;
  f.rt.lastError = null;
  tick(f);
  return view(f);
}

export function stop(id) {
  const f = get(id);
  f.rt.running = false;
  clearTimeout(f.rt.timer);
  f.rt.timer = null;
  return view(f);
}

/** Esquece o que já foi visto: o próximo start volta a ignorar (ou reenviar, com backfill) o histórico. */
export function reset(id) {
  const f = get(id);
  f.state = { seen: [], since: null };
  f.rt.log = [];
  f.rt.forwarded = 0;
  f.rt.failed = 0;
  save();
  return view(f);
}

/** Sobe automaticamente os encaminhadores marcados com autoStart (chamado no boot). */
export async function autoStart() {
  for (const f of forwarders.values()) {
    if (!f.cfg.autoStart) continue;
    try { await start(f.cfg.id); } catch (e) { f.rt.lastError = e.message; }
  }
}
