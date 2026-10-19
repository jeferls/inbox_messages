// Runs the PR2 regression plan (IdWall flows without an identity provider) against the local
// greenn-back, using the IdWall mock of this project. Scenarios run one at a time; every step and
// check is kept in memory (and in a JSON file) so the IdWall tab can follow the run live.
//
// greenn-back is driven through `docker exec greenn-back-php php artisan tinker`, the database is
// read through the greenn pool, queue routing comes from the Queue.publish lines of laravel.log
// and IdWall traffic from the mock state.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DB_PATH, GREENN_BACK_URL } from '../config/env.js';
import { execInContainer, isDockerAvailable, startDetachedInContainer } from './docker.service.js';
import { getGreennPool } from './greenn-db.js';
import { getState as getMockState, updateSettings as updateMockSettings } from './idwall-mock.service.js';
import { SCENARIOS } from './idwall-regression.scenarios.js';

const PHP_CONTAINER = process.env.IDWALL_REGRESSION_PHP_CONTAINER || 'greenn-back-php';
const LARAVEL_LOG = '/var/www/storage/logs/laravel.log';
const RABBIT_API = process.env.IDWALL_REGRESSION_RABBIT_API || 'http://greenn-back-rabbitmq:15672/api';
const RABBIT_AUTH = 'Basic ' + Buffer.from(process.env.IDWALL_REGRESSION_RABBIT_AUTH || 'greenn-dev:password').toString('base64');
const RUN_FILE = path.join(path.dirname(DB_PATH), 'idwall-regression-run.json');
export const WORKER_QUEUES = ['_identity_verification', '_identity_enrichment', '_idwall_enrichment', '_status_report_idwall'];

// Fast, predictable mock settings for the run; scenarios override only what they test.
const BASE_SETTINGS = {
  inProgressDelayMs: 2000,
  finalDelayMs: 6000,
  extractionDelayMs: 3000,
  sendInProgress: true,
  documentType: 'CNH',
  enrichmentMode: 'ENRICHED',
  outcomes: Object.fromEntries(
    ['basic', 'biometry', 'first_withdraw', 'first_product', 'growth1k', 'growth10k', 'company_registration', 'company_enrichment', 'company_growth1k']
      .map((flow) => [flow, 'FINISHED']),
  ),
};

let run = loadRun();
let cancelRequested = false;

function loadRun() {
  let saved = null;
  try { saved = JSON.parse(fs.readFileSync(RUN_FILE, 'utf8')); } catch { return null; }
  // A run cannot survive a restart of the process: show it as interrupted instead of running forever.
  if (saved && ['preflight', 'running'].includes(saved.status)) {
    saved.status = 'interrupted';
    saved.current = null;
    for (const s of saved.scenarios ?? []) if (['pending', 'running'].includes(s.status)) s.status = 'skipped';
  }
  return saved;
}

// Synchronous on purpose: async writes can land out of order and leave an old state on disk.
function saveRun() {
  try { fs.writeFileSync(RUN_FILE, JSON.stringify(run, null, 2)); } catch { /* the in-memory run is the source of truth */ }
}

export function listScenarios() {
  return SCENARIOS.map(({ id, title, covers, priority, description }) => ({ id, title, covers, priority, description }));
}

export function getRun() {
  return run;
}

export function cancelRun() {
  if (!run || !['preflight', 'running'].includes(run.status)) return false;
  cancelRequested = true;
  return true;
}

class CancelledError extends Error {}

// ---------- greenn-back access ----------
async function php(code, { timeout = 120000 } = {}) {
  const wrapped = `$__result = (function () { ${code} })(); echo PHP_EOL.'__R__'.json_encode($__result).PHP_EOL;`;
  const { stdout, stderr, exitCode } = await execInContainer(PHP_CONTAINER, ['php', 'artisan', 'tinker', '--execute', wrapped], { timeout });
  const line = `${stdout}\n${stderr}`.split('\n').reverse().find((l) => l.startsWith('__R__'));
  if (!line) {
    const error = `${stdout}\n${stderr}`.split('\n').filter((l) => /Exception|Error/.test(l)).slice(0, 3).join(' | ');
    throw new Error(`tinker sem resultado (exit ${exitCode}): ${error || stdout.slice(-300)}`);
  }
  return JSON.parse(line.slice(5));
}

async function sql(query, params = []) {
  const [rows] = await getGreennPool().query(query, params);
  return rows;
}

async function userChecks(userId) {
  return sql('SELECT id, flow, version, status, result, provider, external_id FROM user_checks WHERE user_id = ? ORDER BY id', [userId]);
}

/** Identity-related Queue.publish calls for a user, oldest first. */
async function publishes(userId) {
  const cmd = `tail -c 8000000 ${LARAVEL_LOG} | grep -a 'Queue.publish' | grep -a -E 'StartIdentityFlow|IdWallHelper|CelcoinBankAccountFacade' | grep -a -E '"user_id":${userId}[,}]|"id":${userId},|\\[${userId}\\]' || true`;
  const { stdout } = await execInContainer(PHP_CONTAINER, ['sh', '-c', cmd], { timeout: 60000 });
  return stdout.split('\n').filter(Boolean).map((line) => {
    try {
      const data = JSON.parse(line.slice(line.indexOf('{')));
      const args = data.__args ?? [];
      const flow = args[0]?.flow ?? args.find((a) => typeof a === 'string') ?? null;
      return {
        at: line.slice(1, 20),
        queue: data.queue,
        call: `${String(data.__class).split('\\').pop()}::${data.__function}`,
        flow,
      };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function mockEvents(...needles) {
  const keys = needles.filter(Boolean).map(String);
  return getMockState().events
    .filter((e) => keys.some((k) => e.summary.includes(k) || JSON.stringify(e.request ?? {}).includes(k)))
    .reverse();
}

async function rabbitQueues() {
  const response = await fetch(`${RABBIT_API}/queues`, { headers: { authorization: RABBIT_AUTH }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`RabbitMQ respondeu ${response.status}`);
  return response.json();
}

/**
 * 'branch' when greenn-back has the adapter wiring (StartIdentityFlow), 'legacy' on production, where
 * the triggers still publish IdWallHelper::startFlow on the old queues. Same scenarios, same effects.
 */
async function detectMode() {
  const { exitCode } = await execInContainer(PHP_CONTAINER, ['test', '-f', 'domain/Seller/Actions/StartIdentityFlow.php']);
  return exitCode === 0 ? 'branch' : 'legacy';
}

export const MODE_LABEL = { branch: 'branch com o adapter (StartIdentityFlow)', legacy: 'production / legado (IdWallHelper::startFlow)' };

// ---------- preflight ----------
export async function preflight() {
  const checks = [];
  const add = (label, ok, detail, fix = null) => checks.push({ label, ok, detail, fix });

  add('Docker acessível pelo inbox', isDockerAvailable(), isDockerAvailable() ? '/var/run/docker.sock' : 'socket do Docker não montado');
  if (!isDockerAvailable()) return checks;

  try {
    const mode = await detectMode();
    add('Código do greenn-back', true, MODE_LABEL[mode]);
    const { stdout } = await execInContainer(PHP_CONTAINER, ['sh', '-c', "ps -o etime=,args= | grep 'artisan work' | grep -v grep || true"]);
    add('Workers reiniciados depois da troca de branch', true,
      'workers carregam o código ao subir: depois de trocar de branch rode "make idwall-mock-off && make idwall-mock-on" (reinicia todos). Rodando há: '
      + (stdout.trim().split('\n').filter(Boolean).map((l) => l.trim().split(/\s+/)[0]).join(', ') || 'nenhum'));
  } catch (error) {
    add('Código do greenn-back', false, error.message);
  }

  try {
    const { stdout } = await execInContainer(PHP_CONTAINER, ['sh', '-c', 'grep -c "idwall-mock" app/Helpers/IdWallHelper.php domain/IdWall/Helpers/IdWallHelper.php config/idwall.php || true']);
    const counts = Object.fromEntries(stdout.trim().split('\n').map((l) => l.split(':')).map(([f, n]) => [f, Number(n)]));
    const ok = counts['app/Helpers/IdWallHelper.php'] >= 6 && counts['domain/IdWall/Helpers/IdWallHelper.php'] >= 3 && counts['config/idwall.php'] >= 9;
    add('Patch do mock aplicado no greenn-back', ok, JSON.stringify(counts), ok ? null : 'Rode "make idwall-mock-on" no inbox_messages');
  } catch (error) {
    add('Patch do mock aplicado no greenn-back', false, error.message);
  }

  try {
    const response = await fetch(`${GREENN_BACK_URL}/api/idwall/webhook-report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ dados: { status: 'EM ANALISE', protocolo: 'preflight-probe' } }),
      signal: AbortSignal.timeout(15000),
    });
    add('greenn-back recebe webhooks', response.ok, `${GREENN_BACK_URL} → HTTP ${response.status}`,
      response.status === 502 ? 'nginx com IP antigo do PHP: docker restart greenn-back-nginx' : null);
  } catch (error) {
    add('greenn-back recebe webhooks', false, error.message);
  }

  try {
    const queues = await rabbitQueues();
    const missing = WORKER_QUEUES.filter((name) => !(queues.find((q) => q.name === name)?.consumers > 0));
    add('Workers das filas de identidade', missing.length === 0, missing.length ? `sem consumidor: ${missing.join(', ')}` : WORKER_QUEUES.join(', '),
      missing.length ? 'start-workers' : null);
  } catch (error) {
    add('Workers das filas de identidade', false, error.message);
  }

  try {
    const settings = await sql("SELECT `key` FROM global_settings WHERE `key` LIKE 'IDENTITY%'");
    add('Nenhum provedor configurado', settings.length === 0, settings.length ? settings.map((s) => s.key).join(', ') : 'global_settings sem IDENTITY_*');
    const [{ total }] = await sql("SELECT COUNT(*) AS total FROM global_flags WHERE flag = 'idwall'");
    add('Flag idwall não é global', total === 0, total ? 'existe global flag idwall: o cenário "sem flag" perde sentido' : 'só por seller');
  } catch (error) {
    add('Banco do greenn-back', false, error.message);
  }

  return checks;
}

export async function startWorkers() {
  const queues = await rabbitQueues().catch(() => []);
  const started = [];
  for (const name of WORKER_QUEUES) {
    if (queues.find((q) => q.name === name)?.consumers > 0) continue;
    await startDetachedInContainer(PHP_CONTAINER, ['php', 'artisan', 'work', name]);
    started.push(name);
  }
  return started;
}

// ---------- run ----------
export function startRun(ids) {
  if (run && ['preflight', 'running'].includes(run.status)) throw new Error('Já existe uma execução em andamento');
  const selected = ids?.length ? SCENARIOS.filter((s) => ids.includes(s.id)) : SCENARIOS;
  if (!selected.length) throw new Error('Nenhum cenário selecionado');

  cancelRequested = false;
  run = {
    id: crypto.randomUUID(),
    status: 'preflight',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    current: null,
    preflight: [],
    scenarios: selected.map(({ id, title, covers, priority }) => ({
      id, title, covers, priority, status: 'pending', steps: [], sellers: [], startedAt: null, durationMs: null,
    })),
  };
  saveRun();
  execute(selected).catch((error) => {
    run.status = 'error';
    run.error = error.message;
    run.finishedAt = new Date().toISOString();
    saveRun();
  });
  return run;
}

async function execute(selected) {
  run.preflight = await preflight();
  if (run.preflight.some((c) => !c.ok)) {
    run.status = 'blocked';
    run.finishedAt = new Date().toISOString();
    saveRun();
    return;
  }

  run.status = 'running';
  run.mode = await detectMode();
  const original = getMockState().settings;
  saveRun();

  try {
    for (const scenario of selected) {
      const entry = run.scenarios.find((s) => s.id === scenario.id);
      if (cancelRequested) {
        entry.status = 'skipped';
        continue;
      }
      await runScenario(scenario, entry);
    }
  } finally {
    updateMockSettings(original);
    run.current = null;
    run.status = cancelRequested ? 'cancelled' : 'done';
    run.finishedAt = new Date().toISOString();
    saveRun();
  }
}

async function runScenario(scenario, entry) {
  entry.status = 'running';
  entry.startedAt = new Date().toISOString();
  run.current = { scenario: scenario.id, step: null };
  saveRun();
  const started = Date.now();
  const t = createContext(entry);

  try {
    updateMockSettings({ ...BASE_SETTINGS, ...(scenario.settings ?? {}), outcomes: { ...BASE_SETTINGS.outcomes, ...(scenario.settings?.outcomes ?? {}) } });
    t.info('Mock configurado', describeSettings(scenario.settings));
    await scenario.run(t);
    // A chain still running would receive the next scenario's mock settings.
    await t.waitFor('Aguardar a fila de webhooks do mock esvaziar', () => getMockState().scheduled.length === 0, 60000);
    entry.status = entry.steps.some((s) => s.status === 'fail') ? 'failed' : 'passed';
  } catch (error) {
    entry.status = error instanceof CancelledError ? 'cancelled' : 'error';
    t.record({ label: error instanceof CancelledError ? 'Cancelado' : 'Erro na execução', status: 'fail', detail: error.message });
  } finally {
    entry.durationMs = Date.now() - started;
    saveRun();
  }
}

function describeSettings(settings = {}) {
  const parts = [];
  for (const [flow, outcome] of Object.entries(settings.outcomes ?? {})) parts.push(`${flow} → ${outcome}`);
  if (settings.enrichmentMode) parts.push(`enriquecimento ${settings.enrichmentMode}`);
  return parts.length ? parts.join(', ') : 'todos os fluxos → FINISHED; IN_PROGRESS 2s, resultado 6s';
}

function createContext(entry) {
  const record = (step) => {
    entry.steps.push({ at: new Date().toISOString(), ...step });
    run.current = { scenario: entry.id, step: step.label };
    saveRun();
    return entry.steps[entry.steps.length - 1];
  };
  const guard = () => { if (cancelRequested) throw new CancelledError('execução cancelada'); };

  return {
    mode: run.mode,
    record,
    php,
    sql,
    userChecks,
    publishes,
    mockEvents,
    mockState: getMockState,
    info(label, detail = '') { return record({ label, status: 'info', detail }); },

    async step(label, fn) {
      guard();
      const step = record({ label, status: 'run', detail: '' });
      try {
        const result = await fn();
        step.status = 'ok';
        if (typeof result === 'string') step.detail = result;
        else if (result?.detail) step.detail = result.detail;
        saveRun();
        return result;
      } catch (error) {
        step.status = 'fail';
        step.detail = error.message;
        saveRun();
        throw error;
      }
    },

    check(label, ok, expected, actual) {
      return record({ label, status: ok ? 'ok' : 'fail', detail: ok ? String(actual ?? expected ?? '') : `esperado: ${expected} · obtido: ${actual}`, check: true });
    },

    async waitFor(label, condition, timeoutMs = 90000, intervalMs = 1500) {
      guard();
      const step = record({ label, status: 'run', detail: '' });
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        guard();
        if (await condition()) {
          step.status = 'ok';
          step.detail = `${Math.round((Date.now() - started) / 1000)}s`;
          saveRun();
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
      step.status = 'fail';
      step.detail = `tempo esgotado (${Math.round(timeoutMs / 1000)}s)`;
      saveRun();
      throw new Error(`${label}: tempo esgotado`);
    },

    async sleep(ms, label) {
      guard();
      if (label) record({ label, status: 'info', detail: `${ms / 1000}s` });
      await new Promise((resolve) => setTimeout(resolve, ms));
    },

    /** Creates a seller with the idwall flag (unless flag: false) and records its id. */
    async seller(label, { flag = true, php: extra = '' } = {}) {
      const result = await php(`
        $u = \\App\\User::factory()->create(['type' => 'SELLER', 'name' => 'regressao ${label}', 'email' => 'regressao.'.uniqid('', true).'@example.test']);
        ${flag ? "\\App\\UserFlag::create(['user_id' => $u->id, 'flag' => 'idwall']);" : ''}
        ${extra}
        return ['id' => $u->id];
      `);
      entry.sellers.push(result.id);
      record({ label: `Seller criado: ${result.id}`, status: 'info', detail: label });
      return result.id;
    },

    async hasConsumer(queue) {
      const queues = await rabbitQueues();
      return (queues.find((q) => q.name === queue)?.consumers ?? 0) > 0;
    },

    async checkFor(userId, flow) {
      return (await userChecks(userId)).find((c) => c.flow === flow) ?? null;
    },
  };
}
