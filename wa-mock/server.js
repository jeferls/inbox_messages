'use strict';
// wa-mock — mock local da WhatsApp Cloud API + UI de preview.
// Zero dependências. Node >= 18.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3333);
const STATE_FILE = path.join(__dirname, '.mock-state.json');
const TEMPLATES_FILE = path.join(__dirname, 'templates.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const APP_SECRET = process.env.APP_SECRET || '';
const DELIVERED_DELAY_MS = Number(process.env.DELIVERED_DELAY_MS || 600);

// ---------- estado ----------
const saved = loadState();
const state = {
  config: {
    webhookUrl: pick(process.env.WEBHOOK_URL, saved?.config?.webhookUrl, ''),
    phoneNumberId: pick(process.env.PHONE_NUMBER_ID, saved?.config?.phoneNumberId, '123456789012345'),
    displayPhone: pick(process.env.DISPLAY_PHONE, saved?.config?.displayPhone, '5511999990000'),
    businessName: pick(process.env.BUSINESS_NAME, saved?.config?.businessName, 'Empresa'),
    contactName: pick(process.env.CONTACT_NAME, saved?.config?.contactName, 'Cliente Teste'),
    defaultWaId: pick(process.env.CONTACT_WA_ID, saved?.config?.defaultWaId, '5511988887777'),
  },
  messages: Array.isArray(saved?.messages) ? saved.messages : [],
};

function pick(...vals) { return vals.find((v) => v !== undefined && v !== null && v !== ''); }

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return null; }
}

let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), () => {});
  }, 150);
}

function loadTemplates() {
  try { return JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8')); } catch (e) { return { __error: e.message }; }
}

// ---------- SSE ----------
const clients = new Set();
function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(data);
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000).unref();

// ---------- helpers ----------
const now = () => Math.floor(Date.now() / 1000);
const newId = () => 'wamid.' + Buffer.from(crypto.randomUUID()).toString('base64url');

function upsert(msg) {
  const i = state.messages.findIndex((m) => m.id === msg.id);
  if (i >= 0) state.messages[i] = msg; else state.messages.push(msg);
  saveState();
  broadcast({ type: 'message', message: msg });
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...cors() });
  res.end(JSON.stringify(body));
}

function metaError(res, status, message, code = 100) {
  json(res, status, { error: { message: `(#${code}) ${message}`, type: 'OAuthException', code, fbtrace_id: crypto.randomUUID() } });
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 1e6) { reject(new Error('Body maior que 1MB')); req.destroy(); } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---------- webhook (mock -> seu backend) ----------
function webhookEnvelope(value) {
  const { phoneNumberId, displayPhone } = state.config;
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA_MOCK',
      changes: [{
        value: { messaging_product: 'whatsapp', metadata: { display_phone_number: displayPhone, phone_number_id: phoneNumberId }, ...value },
        field: 'messages',
      }],
    }],
  };
}

async function forwardWebhook(kind, value, msg) {
  const url = state.config.webhookUrl;
  if (!url) return;
  const body = JSON.stringify(webhookEnvelope(value));
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'wa-mock/1.0' };
  if (APP_SECRET) headers['X-Hub-Signature-256'] = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(body).digest('hex');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  let result;
  try {
    const r = await fetch(url, { method: 'POST', headers, body, signal: ctrl.signal });
    result = { ok: r.ok, status: r.status, kind };
  } catch (e) {
    result = { ok: false, error: e.name === 'AbortError' ? 'timeout' : (e.cause?.code || e.message), kind };
  } finally { clearTimeout(t); }
  if (msg) { msg.webhook = { ...(msg.webhook || {}), [kind]: result }; upsert(msg); }
  broadcast({ type: 'toast', ok: result.ok, text: result.ok ? `Webhook ${kind} → ${result.status}` : `Webhook ${kind} falhou: ${result.error || result.status}` });
}

function sendStatusWebhook(msg, status) {
  forwardWebhook('status', {
    statuses: [{ id: msg.id, status, timestamp: String(now()), recipient_id: msg.wa_id, conversation: { id: 'conv_mock', origin: { type: 'utility' } } }],
  }, null);
}

function setStatus(msg, status) {
  msg.status = status;
  msg[`${status}_at`] = now();
  upsert(msg);
  sendStatusWebhook(msg, status);
}

// ---------- handlers ----------
function handleGraphMessages(res, body, phoneNumberId) {
  if (body.messaging_product !== 'whatsapp') return metaError(res, 400, 'O parâmetro messaging_product é obrigatório e deve ser "whatsapp"');

  // marcar como lida: { status: "read", message_id }
  if (body.status === 'read') {
    const target = state.messages.find((m) => m.id === body.message_id);
    if (!target) return metaError(res, 400, `message_id não encontrado: ${body.message_id}`);
    target.read_by_business = true;
    upsert(target);
    return json(res, 200, { success: true });
  }

  if (!body.to) return metaError(res, 400, 'O parâmetro "to" é obrigatório');
  if (!body.type) return metaError(res, 400, 'O parâmetro "type" é obrigatório');
  if (!body[body.type] && body.type !== 'reaction') return metaError(res, 400, `Objeto "${body.type}" ausente no payload`);

  const msg = { id: newId(), direction: 'out', wa_id: String(body.to), phone_number_id: phoneNumberId, timestamp: now(), status: 'sent', payload: body };
  upsert(msg);
  sendStatusWebhook(msg, 'sent');
  setTimeout(() => { if (msg.status === 'sent') setStatus(msg, 'delivered'); }, DELIVERED_DELAY_MS);

  json(res, 200, { messaging_product: 'whatsapp', contacts: [{ input: String(body.to), wa_id: String(body.to) }], messages: [{ id: msg.id, message_status: 'accepted' }] });
}

function handleInbound(res, body) {
  const waId = String(body.wa_id || state.config.defaultWaId);
  const m = body.message || {};
  if (!m.type) return json(res, 400, { error: 'message.type obrigatório' });

  const msg = { id: newId(), direction: 'in', wa_id: waId, timestamp: now(), payload: m };
  upsert(msg);

  // cliente respondeu -> tudo que foi entregue a ele vira "lido"
  for (const out of state.messages) {
    if (out.direction === 'out' && out.wa_id === waId && out.status !== 'read') setStatus(out, 'read');
  }

  const inbound = { from: waId, id: msg.id, timestamp: String(msg.timestamp), type: m.type, ...m };
  forwardWebhook('message', { contacts: [{ profile: { name: state.config.contactName }, wa_id: waId }], messages: [inbound] }, msg);

  json(res, 200, { id: msg.id });
}

function serveStatic(res, urlPath) {
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { error: 'not found' });
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

const GRAPH_RE = /^\/(?:v\d+(?:\.\d+)?\/)?([^/]+)\/messages\/?$/;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (req.method === 'OPTIONS') { res.writeHead(204, cors()); return res.end(); }

  if (req.method === 'GET') {
    if (p === '/mock/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...cors() });
      res.write(`data: ${JSON.stringify({ type: 'hello' })}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (p === '/mock/state') return json(res, 200, { config: state.config, messages: state.messages, templates: loadTemplates(), port: PORT, appSecret: Boolean(APP_SECRET) });
    if (p === '/mock/templates') return json(res, 200, loadTemplates());
    if (p.startsWith('/mock/')) return json(res, 404, { error: 'not found' });
    if (GRAPH_RE.test(p) || /^\/v\d+/.test(p)) return metaError(res, 400, `Endpoint não suportado pelo mock: GET ${p}`);
    return serveStatic(res, p);
  }

  if (req.method === 'POST') {
    let body;
    try { body = JSON.parse((await readBody(req)) || '{}'); }
    catch (e) { return metaError(res, 400, `JSON inválido: ${e.message}`); }

    const graph = p.match(GRAPH_RE);
    if (graph) return handleGraphMessages(res, body, graph[1]);
    if (/^\/v\d+/.test(p)) return metaError(res, 400, `Endpoint não suportado pelo mock: POST ${p}`);

    if (p === '/mock/inbound') return handleInbound(res, body);
    if (p === '/mock/config') {
      const allowed = ['webhookUrl', 'phoneNumberId', 'displayPhone', 'businessName', 'contactName', 'defaultWaId'];
      for (const k of allowed) if (k in body) state.config[k] = String(body[k] ?? '');
      saveState();
      broadcast({ type: 'config', config: state.config });
      return json(res, 200, state.config);
    }
    if (p === '/mock/clear') {
      state.messages = [];
      saveState();
      broadcast({ type: 'clear' });
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'not found' });
  }

  json(res, 405, { error: 'method not allowed' });
});

server.listen(PORT, () => {
  const { phoneNumberId, webhookUrl } = state.config;
  console.log(`wa-mock rodando em http://localhost:${PORT}`);
  console.log(`  API mock:  POST http://localhost:${PORT}/v20.0/${phoneNumberId}/messages`);
  console.log(`  Webhook:   ${webhookUrl || '(não configurado — defina WEBHOOK_URL ou use as configurações da UI)'}`);
  console.log(`  Templates: ${TEMPLATES_FILE}`);
});
