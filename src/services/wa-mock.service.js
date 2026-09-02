// Mock local da WhatsApp Cloud API (portado do projeto wa-mock).
//
// O backend troca a base `https://graph.facebook.com/v20.0` por `http://localhost:8115/v20.0`:
// o envio de mensagens é aceito no formato Meta e aparece na aba WhatsApp. O que o "cliente"
// faz na UI (texto, botão, item de lista) vira webhook no formato Meta para WA_MOCK.webhookUrl,
// incluindo os statuses sent → delivered → read.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { WA_MOCK, WA_MOCK_STATE_FILE, WA_MOCK_TEMPLATES_FILE } from '../config/env.js';

const CONFIG_KEYS = ['webhookUrl', 'phoneNumberId', 'displayPhone', 'businessName', 'contactName', 'defaultWaId'];

// ---------- estado ----------
const saved = loadState();
const state = {
  config: Object.fromEntries(CONFIG_KEYS.map((k) => [k, pick(WA_MOCK.env[k], saved?.config?.[k], WA_MOCK.defaults[k])])),
  messages: Array.isArray(saved?.messages) ? saved.messages : [],
};

function pick(...vals) { return vals.find((v) => v !== undefined && v !== null && v !== ''); }

function loadState() {
  try { return JSON.parse(fs.readFileSync(WA_MOCK_STATE_FILE, 'utf8')); } catch { return null; }
}

let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(WA_MOCK_STATE_FILE, JSON.stringify(state, null, 2), () => {});
  }, 150);
  saveTimer.unref?.();
}

/** Relido a cada chamada: editar templates.json não exige reiniciar. */
export function loadTemplates() {
  try { return JSON.parse(fs.readFileSync(WA_MOCK_TEMPLATES_FILE, 'utf8')); } catch (e) { return { __error: e.message }; }
}

// ---------- SSE ----------
const clients = new Set();
function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(data);
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000).unref();

export function addSseClient(res, onClose) {
  res.write(`data: ${JSON.stringify({ type: 'hello' })}\n\n`);
  clients.add(res);
  onClose(() => clients.delete(res));
}

// ---------- helpers ----------
const now = () => Math.floor(Date.now() / 1000);
const newId = () => 'wamid.' + Buffer.from(crypto.randomUUID()).toString('base64url');

function upsert(msg) {
  const i = state.messages.findIndex((m) => m.id === msg.id);
  if (i >= 0) state.messages[i] = msg; else state.messages.push(msg);
  saveState();
  broadcast({ type: 'message', message: msg });
}

export class MetaError extends Error {
  constructor(message, status = 400, code = 100) { super(message); this.status = status; this.code = code; }
  toJSON() {
    return { error: { message: `(#${this.code}) ${this.message}`, type: 'OAuthException', code: this.code, fbtrace_id: crypto.randomUUID() } };
  }
}

// ---------- webhook (mock -> backend) ----------
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
  if (WA_MOCK.appSecret) headers['X-Hub-Signature-256'] = 'sha256=' + crypto.createHmac('sha256', WA_MOCK.appSecret).update(body).digest('hex');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), WA_MOCK.webhookTimeoutMs);
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

// ---------- operações ----------
/** POST /v20.0/{phoneNumberId}/messages — lança MetaError em payload inválido. */
export function sendGraphMessage(body, phoneNumberId) {
  if (body.messaging_product !== 'whatsapp') throw new MetaError('O parâmetro messaging_product é obrigatório e deve ser "whatsapp"');

  // marcar como lida: { status: "read", message_id }
  if (body.status === 'read') {
    const target = state.messages.find((m) => m.id === body.message_id);
    if (!target) throw new MetaError(`message_id não encontrado: ${body.message_id}`);
    target.read_by_business = true;
    upsert(target);
    return { success: true };
  }

  if (!body.to) throw new MetaError('O parâmetro "to" é obrigatório');
  if (!body.type) throw new MetaError('O parâmetro "type" é obrigatório');
  if (!body[body.type] && body.type !== 'reaction') throw new MetaError(`Objeto "${body.type}" ausente no payload`);

  const msg = { id: newId(), direction: 'out', wa_id: String(body.to), phone_number_id: phoneNumberId, timestamp: now(), status: 'sent', payload: body };
  upsert(msg);
  sendStatusWebhook(msg, 'sent');
  setTimeout(() => { if (msg.status === 'sent') setStatus(msg, 'delivered'); }, WA_MOCK.deliveredDelayMs).unref?.();

  return { messaging_product: 'whatsapp', contacts: [{ input: String(body.to), wa_id: String(body.to) }], messages: [{ id: msg.id, message_status: 'accepted' }] };
}

/** Mensagem "do cliente" registrada pela UI: vira webhook para o backend. */
export function receiveInbound({ wa_id, message }) {
  const waId = String(wa_id || state.config.defaultWaId);
  const m = message || {};
  const msg = { id: newId(), direction: 'in', wa_id: waId, timestamp: now(), payload: m };
  upsert(msg);

  // cliente respondeu -> tudo que foi entregue a ele vira "lido"
  for (const out of state.messages) {
    if (out.direction === 'out' && out.wa_id === waId && out.status !== 'read') setStatus(out, 'read');
  }

  const inbound = { from: waId, id: msg.id, timestamp: String(msg.timestamp), type: m.type, ...m };
  forwardWebhook('message', { contacts: [{ profile: { name: state.config.contactName }, wa_id: waId }], messages: [inbound] }, msg);

  return { id: msg.id };
}

export function getState() {
  return { config: state.config, messages: state.messages, templates: loadTemplates(), appSecret: Boolean(WA_MOCK.appSecret) };
}

export function updateConfig(body) {
  for (const k of CONFIG_KEYS) if (k in body) state.config[k] = String(body[k] ?? '');
  saveState();
  broadcast({ type: 'config', config: state.config });
  return state.config;
}

export function clearMessages() {
  state.messages = [];
  saveState();
  broadcast({ type: 'clear' });
}
