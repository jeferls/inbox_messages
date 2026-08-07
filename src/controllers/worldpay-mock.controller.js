import {
  getGatewayMockScenario,
  setGatewayMockScenario,
  insertGatewayMockTransaction,
  listGatewayMockTransactions,
  clearGatewayMockTransactions,
} from '../db/index.js';
import {
  AUTHORISED_SCENARIO,
  findScenario,
  listScenarios,
} from '../mocks/worldpay/scenarios.js';
import { parseChargeRequest } from '../mocks/worldpay/request-parser.js';
import { buildResponse } from '../mocks/worldpay/response-builder.js';
import { logLine } from '../utils/logger.js';

const GATEWAY = 'worldpay';

/**
 * Precedência do cenário: rota > header > cenário ativo > authorised.
 * Assim dá para fixar um cenário por URL (um por ambiente) ou trocar em runtime pela API,
 * sem reiniciar a gateway.
 */
async function resolveScenario(req) {
  const fromPath = findScenario(req.params?.scenario);
  if (fromPath) return { scenario: fromPath, source: 'path' };

  const fromHeader = findScenario(req.headers['x-mock-scenario']);
  if (fromHeader) return { scenario: fromHeader, source: 'header' };

  const active = await getGatewayMockScenario(GATEWAY);
  const fromState = findScenario(active);
  if (fromState) return { scenario: fromState, source: 'active' };

  return { scenario: findScenario(AUTHORISED_SCENARIO), source: 'default' };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Endpoint que a gateway chama (aponte WORLDPAY_API_URL para cá) ───────────

export async function paymentServiceHandler(req, res) {
  const startedAt = process.hrtime.bigint();
  const requestBody = typeof req.body === 'string' ? req.body : String(req.body ?? '');

  try {
    const requested = req.params?.scenario ?? req.headers['x-mock-scenario'] ?? null;
    const { scenario, source } = await resolveScenario(req);

    if (requested && !findScenario(requested)) {
      return res.status(404).json({
        error: `Cenário '${requested}' não existe`,
        scenarios: listScenarios().map((s) => s.name),
      });
    }

    const parsed = parseChargeRequest(requestBody);
    const response = buildResponse(scenario, parsed);

    if (response.delayMs > 0) {
      await sleep(response.delayMs);
    }

    const durationMs = Number((process.hrtime.bigint() - startedAt) / BigInt(1e6));

    await insertGatewayMockTransaction({
      gateway: GATEWAY,
      scenario: scenario.slug,
      scenarioSource: source,
      reference: parsed.orderCode,
      amount: parsed.amount,
      currency: parsed.currencyCode,
      installments: parsed.installments,
      requestHeaders: req.headers,
      requestBody,
      responseStatus: response.httpStatus,
      responseBody: response.body,
      durationMs,
    });

    logLine('info', '[worldpay-mock]', {
      reqId: req._reqId,
      scenario: scenario.slug,
      source,
      orderCode: parsed.orderCode,
      httpStatus: response.httpStatus,
      durationMs,
    }).catch(() => {});

    res.status(response.httpStatus);
    res.type(response.contentType);
    return res.send(response.body);
  } catch (e) {
    logLine('error', '[worldpay-mock] falha', { reqId: req._reqId, error: e.message }).catch(() => {});
    return res.status(500).json({ error: e.message });
  }
}

// ─── Gestão do catálogo ──────────────────────────────────────────────────────

export async function listScenariosHandler(req, res) {
  try {
    const active = await getGatewayMockScenario(GATEWAY);
    res.json({
      gateway: GATEWAY,
      active: active ?? AUTHORISED_SCENARIO,
      total: listScenarios().length,
      scenarios: listScenarios(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function getActiveScenarioHandler(req, res) {
  try {
    const active = (await getGatewayMockScenario(GATEWAY)) ?? AUTHORISED_SCENARIO;
    res.json({ gateway: GATEWAY, active, scenario: findScenario(active) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function setActiveScenarioHandler(req, res) {
  try {
    const requested = req.body?.scenario;
    const scenario = findScenario(requested);

    if (!scenario) {
      return res.status(400).json({
        error: `Cenário '${requested ?? ''}' não existe`,
        scenarios: listScenarios().map((s) => s.name),
      });
    }

    await setGatewayMockScenario(GATEWAY, scenario.slug);
    res.json({ gateway: GATEWAY, active: scenario.slug, scenario });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function listTransactionsHandler(req, res) {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));
    const offset = Math.max(0, Number(req.query.offset ?? 0));
    const scenario = findScenario(req.query.scenario)?.slug;
    const result = await listGatewayMockTransactions({ gateway: GATEWAY, limit, offset, scenario });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function clearTransactionsHandler(req, res) {
  try {
    const deleted = await clearGatewayMockTransactions(GATEWAY);
    res.json({ ok: true, deleted });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
