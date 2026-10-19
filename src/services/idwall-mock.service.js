// Local IdWall mock (maestro v3 + relatorios v2) used by greenn-back after scripts/idwall-mock-patch.sh.
//
// Outbound calls from greenn-back are answered here with the shapes its helpers read. Every flow or
// report started here schedules its webhooks (IN_PROGRESS, then the configured outcome) back to
// greenn-back, with the delays set on the IdWall tab. Enrichment data is random but stable per
// profile, so repeated reads return the same person or company.

import fs from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { GREENN_BACK_URL, IDWALL_MOCK } from '../config/env.js';

export const FLOW_OUTCOMES = ['FINISHED', 'INVALID', 'WAITING_MANUAL_ACTION', 'CANCELLED', 'NONE'];
export const WEBHOOK_STATUSES = ['IN_PROGRESS', 'FINISHED', 'INVALID', 'WAITING_MANUAL_ACTION', 'CANCELLED'];
export const REPORT_WEBHOOK_STATUSES = ['EM ANALISE', 'CONCLUIDO'];
export const PF_FLOWS = ['basic', 'biometry', 'first_withdraw', 'first_product', 'growth1k', 'growth10k'];
export const PJ_FLOWS = ['company_registration', 'company_enrichment', 'company_growth1k'];
export const ENRICHMENT_MODES = ['ENRICHED', 'UNDER_18', 'EMPTY'];

// Flow ids greenn-back sends once patched. "miommomo" is FLOW_ID_BASIC of greenn-back .env.dev.
const KNOWN_FLOW_IDS = {
  miommomo: 'basic',
  'mock-basic': 'basic',
  'mock-biometry-rg': 'biometry',
  'mock-biometry-cnh': 'biometry',
  'mock-first-withdraw': 'first_withdraw',
  'mock-first-product': 'first_product',
  'mock-growth10k': 'growth10k',
  'mock-growth1k': 'growth1k',
};

const MAX_EVENTS = 1000;

const DEFAULT_SETTINGS = {
  inProgressDelayMs: 3000,
  finalDelayMs: 15000,
  extractionDelayMs: 5000,
  sendInProgress: true,
  documentType: 'CNH',
  enrichmentMode: 'ENRICHED',
  outcomes: Object.fromEntries([...PF_FLOWS, ...PJ_FLOWS].map((flow) => [flow, 'FINISHED'])),
  backUrl: '',
};

// ---------- state ----------
const saved = loadState();
const state = {
  settings: mergeSettings(saved?.settings),
  profiles: saved?.profiles ?? {},
  runs: Array.isArray(saved?.runs) ? saved.runs : [],
  reports: saved?.reports ?? {},
  scheduled: Array.isArray(saved?.scheduled) ? saved.scheduled : [],
  events: Array.isArray(saved?.events) ? saved.events : [],
};
const timers = new Map();

function mergeSettings(settings = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    outcomes: { ...DEFAULT_SETTINGS.outcomes, ...(settings.outcomes ?? {}) },
  };
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(IDWALL_MOCK.stateFile, 'utf8')); } catch { return null; }
}

let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(IDWALL_MOCK.stateFile, JSON.stringify(state, null, 2), () => {});
  }, 150);
  saveTimer.unref?.();
}

const nowIso = () => new Date().toISOString();

function record(event) {
  state.events.unshift({ id: crypto.randomUUID(), at: nowIso(), ...event });
  state.events.length = Math.min(state.events.length, MAX_EVENTS);
  saveState();
}

export function getState() {
  return {
    settings: state.settings,
    defaults: { backUrl: GREENN_BACK_URL, webhookTokenSet: IDWALL_MOCK.webhookToken !== '' },
    profiles: Object.values(state.profiles).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    runs: [...state.runs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    reports: Object.values(state.reports).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    scheduled: [...state.scheduled].sort((a, b) => a.dueAt - b.dueAt),
    events: state.events,
  };
}

export function updateSettings(input = {}) {
  const next = mergeSettings({ ...state.settings, ...input, outcomes: { ...state.settings.outcomes, ...(input.outcomes ?? {}) } });

  for (const key of ['inProgressDelayMs', 'finalDelayMs', 'extractionDelayMs']) {
    const value = Number(next[key]);
    if (!Number.isFinite(value) || value < 0) throw new Error(`'${key}' must be a non-negative number`);
    next[key] = value;
  }
  if (next.finalDelayMs < next.inProgressDelayMs) throw new Error("'finalDelayMs' must be >= 'inProgressDelayMs'");
  if (!['CNH', 'RG'].includes(next.documentType)) throw new Error("'documentType' must be CNH or RG");
  if (!ENRICHMENT_MODES.includes(next.enrichmentMode)) throw new Error(`'enrichmentMode' must be one of ${ENRICHMENT_MODES.join(', ')}`);
  for (const [flow, outcome] of Object.entries(next.outcomes)) {
    if (!FLOW_OUTCOMES.includes(outcome)) throw new Error(`outcome of '${flow}' must be one of ${FLOW_OUTCOMES.join(', ')}`);
  }
  next.sendInProgress = Boolean(next.sendInProgress);
  next.backUrl = String(next.backUrl ?? '').trim();

  state.settings = next;
  saveState();
  return state.settings;
}

export function resetState() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  Object.assign(state, { profiles: {}, runs: [], reports: {}, scheduled: [], events: [] });
  saveState();
}

// ---------- scheduler ----------
function schedule(type, delayMs, payload) {
  const job = { id: crypto.randomUUID(), type, createdAt: Date.now(), dueAt: Date.now() + delayMs, payload };
  state.scheduled.push(job);
  arm(job);
  saveState();
  return job;
}

function arm(job) {
  const timer = setTimeout(() => runJob(job.id), Math.max(0, job.dueAt - Date.now()));
  timer.unref?.();
  timers.set(job.id, timer);
}

export function cancelScheduled(id) {
  const index = state.scheduled.findIndex((job) => job.id === id);
  if (index === -1) return false;
  clearTimeout(timers.get(id));
  timers.delete(id);
  state.scheduled.splice(index, 1);
  saveState();
  return true;
}

async function runJob(id) {
  const index = state.scheduled.findIndex((job) => job.id === id);
  timers.delete(id);
  if (index === -1) return;
  const [job] = state.scheduled.splice(index, 1);
  saveState();

  try {
    if (job.type === 'flow-webhook') await deliverFlowStatus(job.payload);
    else if (job.type === 'report-webhook') await deliverReportStatus(job.payload);
    else if (job.type === 'extraction') completeExtraction(job.payload.ref);
  } catch (error) {
    record({ kind: 'error', summary: `${job.type} failed: ${error.message}` });
  }
}

// Jobs survive a restart of the container: the remaining ones are re-armed on load.
for (const job of state.scheduled) arm(job);

// ---------- webhooks to greenn-back ----------
function backUrl() {
  return (state.settings.backUrl || GREENN_BACK_URL).replace(/\/+$/, '');
}

async function postToBack(path, payload, headers = {}) {
  const url = `${backUrl()}${path}`;
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(IDWALL_MOCK.webhookTimeoutMs),
    });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 2000); }
    return { ok: response.ok, status: response.status, url, body, durationMs: Date.now() - startedAt };
  } catch (error) {
    return { ok: false, status: 0, url, body: error.message, durationMs: Date.now() - startedAt };
  }
}

export async function sendFlowWebhook({ userId, flowId, status }) {
  const payload = { flowId, profileRef: String(userId), status };
  const headers = IDWALL_MOCK.webhookToken ? { 'secret-token': IDWALL_MOCK.webhookToken } : {};
  const result = await postToBack('/api/idwall/webhook', payload, headers);
  record({ kind: 'webhook', summary: `webhook ${status} · user ${userId} · ${flowName(flowId)}`, request: payload, response: result });
  return { request: payload, ...result };
}

export async function sendReportWebhook({ protocolo, status }) {
  const payload = { dados: { status, protocolo } };
  const result = await postToBack('/api/idwall/webhook-report', payload);
  record({ kind: 'webhook', summary: `webhook-report ${status} · ${protocolo}`, request: payload, response: result });
  return { request: payload, ...result };
}

async function deliverFlowStatus({ runId, status }) {
  const run = state.runs.find((item) => item.id === runId);
  if (!run) return;
  run.status = status;
  run.updatedAt = nowIso();
  run.stages.push({ status, updatedAt: run.updatedAt });
  saveState();
  await sendFlowWebhook({ userId: run.userId, flowId: run.flowId, status });
}

async function deliverReportStatus({ numero, status }) {
  const report = state.reports[numero];
  if (!report) return;
  report.status = status;
  if (status === 'CONCLUIDO') Object.assign(report, reportResult(report.outcome));
  report.updatedAt = nowIso();
  saveState();
  await sendReportWebhook({ protocolo: numero, status });
}

// FINISHED → VALID; INVALID/CANCELLED → INVALID reviewed by a person; WAITING_MANUAL_ACTION → INVALID not reviewed.
function reportResult(outcome) {
  if (outcome === 'FINISHED') return { resultado: 'VALID', validado_manualmente: false };
  if (outcome === 'WAITING_MANUAL_ACTION') return { resultado: 'INVALID', validado_manualmente: false };
  return { resultado: 'INVALID', validado_manualmente: true };
}

// ---------- maestro v3: profiles ----------
export function flowName(flowId) {
  if (KNOWN_FLOW_IDS[flowId]) return KNOWN_FLOW_IDS[flowId];
  return String(flowId).replace(/^mock-/, '').replace(/-(rg|cnh)$/, '').replace(/-/g, '_');
}

export function createProfile(body = {}, { sdk = false } = {}) {
  const ref = String(body.ref ?? '').trim();
  if (!ref) return { status: 400, body: { message: 'body.ref is required' } };
  if (state.profiles[ref]) return { status: 406, body: { message: `Profile "${ref}" already exists` } };

  const profile = {
    ref,
    personal: body.personal ?? {},
    contacts: body.contacts ?? {},
    sdkToken: body.sdkToken ?? null,
    profileExtraction: { status: 'NOT_INITIATED', documentType: null },
    images: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  state.profiles[ref] = profile;
  if (sdk && profile.sdkToken) startExtraction(profile);
  record({ kind: 'inbound', summary: `POST profile${sdk ? '/sdk' : ''} · user ${ref}`, request: body });
  saveState();
  return { status: 201, body: { result: 'OK', data: { ref } } };
}

export function updateProfile(ref, body = {}, { sdk = false } = {}) {
  const profile = state.profiles[ref];
  if (!profile) return { status: 404, body: { message: `Profile "${ref}" not found` } };

  profile.personal = body.personal ?? profile.personal;
  profile.contacts = body.contacts ?? profile.contacts;
  if (body.sdkToken) profile.sdkToken = body.sdkToken;
  profile.updatedAt = nowIso();
  if (sdk && body.sdkToken) startExtraction(profile);
  record({ kind: 'inbound', summary: `PUT profile${sdk ? '/sdk' : ''} · user ${ref}`, request: body });
  saveState();
  return { status: 200, body: { result: 'OK', data: { ref } } };
}

export function getProfile(ref) {
  const profile = state.profiles[ref];
  record({ kind: 'inbound', summary: `GET profile · user ${ref}${profile ? '' : ' (404)'}` });
  if (!profile) return { status: 404, body: { message: `Profile "${ref}" not found` } };

  return {
    status: 200,
    body: {
      data: {
        ref: profile.ref,
        personal: profile.personal,
        contacts: profile.contacts,
        profileExtraction: profile.profileExtraction,
        images: profile.images,
      },
    },
  };
}

// The SDK capture extracts the document asynchronously; greenn-back polls the profile until EXTRACTED.
function startExtraction(profile) {
  profile.profileExtraction = { status: 'EXTRACTING', documentType: null };
  schedule('extraction', state.settings.extractionDelayMs, { ref: profile.ref });
}

function completeExtraction(ref, documentType = state.settings.documentType) {
  const profile = state.profiles[ref];
  if (!profile) return;
  profile.profileExtraction = { status: 'EXTRACTED', documentType };
  profile.images = buildImages(ref, documentType);
  profile.updatedAt = nowIso();
  record({ kind: 'timer', summary: `document extracted (${documentType}) · user ${ref}` });
  saveState();
}

/** Creates (or completes) a profile with an extracted document, without going through the SDK. */
export function seedBiometry(ref, documentType = state.settings.documentType) {
  if (!['CNH', 'RG'].includes(documentType)) throw new Error("'documentType' must be CNH or RG");
  if (!state.profiles[ref]) {
    state.profiles[ref] = {
      ref,
      personal: {},
      contacts: {},
      sdkToken: 'seeded-by-mock',
      profileExtraction: { status: 'NOT_INITIATED', documentType: null },
      images: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
  }
  completeExtraction(ref, documentType);
  return state.profiles[ref];
}

function buildImages(ref, documentType) {
  const token = (name) => `idwall:/files/${encodeURIComponent(ref)}-${name}.png`;
  return [
    { category: documentType, documentSide: 'FRONT', name: `${documentType} FRONT`, imageToken: token('front') },
    { category: documentType, documentSide: 'BACK', name: `${documentType} BACK`, imageToken: token('back') },
    // greenn-back takes the selfie only when category = FACE and name = "FACE 1".
    { category: 'FACE', documentSide: 'NONE', name: 'FACE 1', imageToken: token('face') },
  ];
}

// ---------- maestro v3: flows ----------
export function startFlow(ref, flowId) {
  const flow = flowName(flowId);
  if (!state.profiles[ref]) {
    record({ kind: 'inbound', summary: `POST flow ${flow} · user ${ref} (E004, no profile)` });
    return { status: 404, body: { semantic: { code: 'E004', message: `Profile "${ref}" not found` } } };
  }

  const running = state.runs.find((run) => run.userId === ref && run.flowId === flowId && run.status === 'IN_PROGRESS');
  if (running) {
    record({ kind: 'inbound', summary: `POST flow ${flow} · user ${ref} (E001, already running)` });
    return { status: 400, body: { semantic: { code: 'E001', message: 'Flow already running for this profile' } } };
  }

  const outcome = state.settings.outcomes[flow] ?? 'FINISHED';
  const run = {
    id: crypto.randomUUID(),
    userId: ref,
    flowId,
    flow,
    outcome,
    status: 'IN_PROGRESS',
    stages: [{ status: 'IN_PROGRESS', updatedAt: nowIso() }],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  state.runs.push(run);
  record({ kind: 'inbound', summary: `POST flow ${flow} · user ${ref} → ${outcome}` });

  if (state.settings.sendInProgress) schedule('flow-webhook', state.settings.inProgressDelayMs, { runId: run.id, status: 'IN_PROGRESS' });
  if (outcome !== 'NONE') schedule('flow-webhook', state.settings.finalDelayMs, { runId: run.id, status: outcome });
  saveState();

  return { status: 200, body: { data: { flowId, profileRef: ref, status: 'IN_PROGRESS' } } };
}

export function listProfileFlows(ref, page = 1, limit = 100) {
  const runs = state.runs
    .filter((run) => run.userId === ref)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const pages = Math.max(1, Math.ceil(runs.length / limit));
  const data = runs.slice((page - 1) * limit, page * limit).map((run) => ({
    flowId: run.flowId,
    flowName: run.flow,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    stages: run.stages,
  }));
  return { status: 200, body: { data, pagination: { page, pages, limit, total: runs.length } } };
}

// ---------- maestro v3: enrichment ----------
export function getEnrichment(ref) {
  const mode = state.settings.enrichmentMode;
  record({ kind: 'inbound', summary: `GET profile-enrichment · user ${ref} (${mode})` });
  if (mode === 'EMPTY') return { status: 200, body: { data: { profileSourcesData: [] } } };

  // Generated once per profile: greenn-back updates the profile between reads, and the data must not drift.
  const profile = state.profiles[ref];
  const sourceData = profile?.enrichment ?? buildEnrichment(ref, profile);
  if (profile && !profile.enrichment) profile.enrichment = sourceData;
  const personal = mode === 'UNDER_18' ? { ...sourceData.personal, birthDate: yearsAgo(16) } : sourceData.personal;

  const body = { data: { profileSourcesData: [{ enrichmentStatus: mode, sourceData: { ...sourceData, personal } }] } };
  state.events[0].response = { ok: true, status: 200, body };
  saveState();
  return { status: 200, body };
}

function buildEnrichment(ref, profile) {
  const rnd = seeded(`pf:${ref}`);
  const address = pickOne(rnd, ADDRESSES);
  const detail = String(10 + Math.floor(rnd() * 1990));
  const mother = `${pickOne(rnd, MOTHER_NAMES)} ${pickOne(rnd, LAST_NAMES)}`;
  const randomName = `${pickOne(rnd, FIRST_NAMES)} ${pickOne(rnd, LAST_NAMES)} ${pickOne(rnd, LAST_NAMES)}`;
  const randomBirthDate = randomAdultBirthDate(rnd);

  return {
    personal: {
      name: profile?.personal?.name || randomName,
      birthDate: toBrDate(profile?.personal?.birthDate) ?? randomBirthDate,
      pep: false,
    },
    contacts: { addresses: [{ isMain: true, ...address, detail }] },
    affiliations: [{ relationshipType: 'MOTHER', name: mother }],
  };
}

// ---------- relatorios v2 (companies) ----------
export function createReport(body = {}) {
  const cnpj = String(body?.parametros?.cnpj_numero ?? '').replace(/\D/g, '');
  if (cnpj.length !== 14) {
    record({ kind: 'inbound', summary: `POST relatorios · invalid cnpj "${body?.parametros?.cnpj_numero ?? ''}"` });
    return { status: 400, body: { message: 'Parâmetro "cnpj_numero" não é válido.' } };
  }

  const matriz = String(body.matriz ?? '');
  const flow = flowName(matriz || 'company');
  const outcome = state.settings.outcomes[flow] ?? 'FINISHED';
  const numero = crypto.randomUUID();
  state.reports[numero] = {
    numero,
    matriz,
    flow,
    cnpj,
    outcome,
    status: 'EM ANALISE',
    resultado: null,
    validado_manualmente: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  record({ kind: 'inbound', summary: `POST relatorios ${flow} · cnpj ${cnpj} → ${outcome}`, request: body });

  if (state.settings.sendInProgress) schedule('report-webhook', state.settings.inProgressDelayMs, { numero, status: 'EM ANALISE' });
  if (outcome !== 'NONE') schedule('report-webhook', state.settings.finalDelayMs, { numero, status: 'CONCLUIDO' });
  saveState();

  return { status: 200, body: { result: { numero } } };
}

export function getReport(numero) {
  const report = state.reports[numero];
  record({ kind: 'inbound', summary: `GET relatorios/${numero}${report ? ` (${report.status})` : ' (404)'}` });
  if (!report) return { status: 404, body: { message: 'Relatório não encontrado' } };

  return {
    status: 200,
    body: {
      result: {
        numero: report.numero,
        matriz: report.matriz,
        status: report.status,
        resultado: report.resultado,
        validado_manualmente: report.validado_manualmente,
      },
    },
  };
}

export function getReportData(numero) {
  const report = state.reports[numero];
  record({ kind: 'inbound', summary: `GET relatorios/${numero}/dados${report ? '' : ' (404)'}` });
  if (!report) return { status: 404, body: { message: 'Relatório não encontrado' } };

  const rnd = seeded(`pj:${report.cnpj}`);
  const brand = `${pickOne(rnd, COMPANY_WORDS)} ${pickOne(rnd, COMPANY_WORDS)}`;
  const address = pickOne(rnd, ADDRESSES);

  const body = {
      result: {
        cnpj: {
          numero: report.cnpj,
          nome_empresarial: `${brand.toUpperCase()} ${pickOne(rnd, ['LTDA', 'EIRELI', 'S.A.', 'ME'])}`,
          nome_fantasia: brand,
        },
        enderecos: [
          {
            principal: true,
            cep: address.zipCode,
            logradouro: address.street,
            numero: String(10 + Math.floor(rnd() * 1990)),
            bairro: address.neighborhood,
            cidade: address.city,
            estado: address.state,
          },
        ],
      },
  };
  state.events[0].response = { ok: true, status: 200, body };
  saveState();
  return { status: 200, body };
}

// ---------- images ----------
/** Solid-color PNG whose color comes from the file name, so each document side looks different. */
export function buildImage(name, width = 320, height = 200) {
  const hash = crypto.createHash('sha1').update(name).digest();
  const [r, g, b] = [hash[0], hash[1], hash[2]];
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function recordImageRead(name) {
  record({ kind: 'inbound', summary: `GET files/${name}` });
}

// ---------- random data ----------
function seeded(key) {
  let seed = crypto.createHash('sha256').update(key).digest().readUInt32BE(0);
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pickOne = (rnd, list) => list[Math.floor(rnd() * list.length)];
const pad = (n) => String(n).padStart(2, '0');

function randomAdultBirthDate(rnd) {
  const year = 1960 + Math.floor(rnd() * 40);
  return `${pad(1 + Math.floor(rnd() * 28))}/${pad(1 + Math.floor(rnd() * 12))}/${year}`;
}

function yearsAgo(years) {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

// greenn-back parses the enrichment birthDate as d/m/Y; the profile may carry Y-m-d.
function toBrDate(value) {
  if (!value) return null;
  const iso = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return /^\d{2}\/\d{2}\/\d{4}$/.test(value) ? value : null;
}

const FIRST_NAMES = ['Ana', 'Bruno', 'Carla', 'Diego', 'Eduarda', 'Felipe', 'Gabriela', 'Henrique', 'Isabela', 'João', 'Larissa', 'Marcos', 'Natália', 'Otávio', 'Patrícia', 'Rafael'];
const LAST_NAMES = ['Silva', 'Souza', 'Oliveira', 'Pereira', 'Costa', 'Rodrigues', 'Almeida', 'Nascimento', 'Lima', 'Araújo', 'Fernandes', 'Carvalho', 'Gomes', 'Martins'];
const MOTHER_NAMES = ['Maria', 'Rosa', 'Helena', 'Lúcia', 'Teresa', 'Aparecida', 'Sandra', 'Cristina', 'Vera', 'Fátima'];
const COMPANY_WORDS = ['Verde', 'Horizonte', 'Aurora', 'Prisma', 'Atlas', 'Nexo', 'Vértice', 'Raiz', 'Lumen', 'Ponto', 'Digital', 'Cursos', 'Educação', 'Saber'];
const ADDRESSES = [
  { zipCode: '01310-100', street: 'Avenida Paulista', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP' },
  { zipCode: '20040-002', street: 'Rua da Assembleia', neighborhood: 'Centro', city: 'Rio de Janeiro', state: 'RJ' },
  { zipCode: '30130-010', street: 'Avenida Afonso Pena', neighborhood: 'Centro', city: 'Belo Horizonte', state: 'MG' },
  { zipCode: '80020-310', street: 'Rua XV de Novembro', neighborhood: 'Centro', city: 'Curitiba', state: 'PR' },
  { zipCode: '90010-150', street: 'Rua dos Andradas', neighborhood: 'Centro Histórico', city: 'Porto Alegre', state: 'RS' },
  { zipCode: '40020-000', street: 'Avenida Sete de Setembro', neighborhood: 'Centro', city: 'Salvador', state: 'BA' },
  { zipCode: '74015-010', street: 'Avenida Goiás', neighborhood: 'Setor Central', city: 'Goiânia', state: 'GO' },
  { zipCode: '60060-440', street: 'Avenida Santos Dumont', neighborhood: 'Aldeota', city: 'Fortaleza', state: 'CE' },
];
