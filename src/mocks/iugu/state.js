import { iuguMockGet, iuguMockPut } from '../../db/index.js';
import { IUGU_MOCK } from '../../config/env.js';

/**
 * Card outcomes. `lr` follows the acquirer codes Iugu relays in `LR`, which
 * ClassifyIuguDeclineCode on the gateway turns into a decline type.
 */
export const CARD_SCENARIOS = {
  approved: { label: 'Aprovado', lr: '00', message: 'Autorizado', approved: true },
  in_analysis: { label: 'Em análise (antifraude)', lr: '00', message: 'Em análise', approved: true, analysis: true },
  refused: { label: 'Negado genérico', lr: '05', message: 'Transação negada' },
  insufficient_funds: { label: 'Saldo insuficiente', lr: '51', message: 'Saldo insuficiente' },
  expired_card: { label: 'Cartão vencido', lr: '54', message: 'Cartão vencido' },
  not_permitted: { label: 'Transação não permitida', lr: '57', message: 'Transação não permitida para o cartão' },
  invalid_card: { label: 'Cartão inválido', lr: '14', message: 'Cartão inválido' },
  suspected_fraud: { label: 'Suspeita de fraude', lr: '59', message: 'Suspeita de fraude' },
};

/** With cardScenario = auto, the last four digits of the card pick the outcome. */
export const CARD_BY_LAST4 = {
  '0002': 'refused',
  '0010': 'in_analysis',
  '0014': 'invalid_card',
  '0051': 'insufficient_funds',
  '0054': 'expired_card',
  '0057': 'not_permitted',
  '0059': 'suspected_fraud',
};

/** Faults the next calls of a route answer with, to exercise the error branches. */
export const FAULT_KINDS = {
  http_500: { label: 'HTTP 500 da Iugu', status: 500, body: { errors: 'Internal Server Error' } },
  http_502: { label: 'HTTP 502 da Iugu', status: 502, body: { errors: 'Bad Gateway' } },
  http_401: { label: 'HTTP 401 Unauthorized', status: 401, body: { errors: 'Unauthorized' } },
  http_422: { label: 'HTTP 422 validação', status: 422, body: { errors: { base: ['Erro de validação simulado'] } } },
  timeout: { label: 'Timeout (sem resposta)', timeout: true },
};

export const DEFAULT_SETTINGS = {
  // auto | any CARD_SCENARIOS key
  cardScenario: 'auto',
  // auto | accepted | rejected | manual: what happens to a KYC after request_verification
  verificationOutcome: 'manual',
  autoWebhooks: true,
  webhookUrl: IUGU_MOCK.webhookUrl,
  // Enforces documented rules our code does not follow today (price_range enum, address_proof,
  // due_date as AAAA-MM-DD, phone_prefix, api_type casing, refund needs balance...).
  strict: false,
  // Unknown tokens act as the master account (the local .env.dev carries a real master key).
  lenientAuth: true,
  // Pix and bank slip invoices are paid N seconds after creation (0 = only by hand).
  autoPaySeconds: 0,
  // { route: '<route name>' | '*', kind: <FAULT_KINDS key>, remaining: n, channel: 'any'|'direct'|'proxy' }
  fault: null,
  timeoutMs: 65000,
};

export async function getSettings() {
  const stored = await iuguMockGet('settings', 'default');
  const { _created_at, _updated_at, ...rest } = stored ?? {};
  return { ...DEFAULT_SETTINGS, ...rest };
}

export async function updateSettings(patch) {
  const current = await getSettings();
  const next = { ...current };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (patch[key] !== undefined) next[key] = patch[key];
  }
  if (next.cardScenario !== 'auto' && !CARD_SCENARIOS[next.cardScenario]) next.cardScenario = 'auto';
  if (!['auto', 'accepted', 'rejected', 'manual'].includes(next.verificationOutcome)) next.verificationOutcome = 'manual';
  if (next.fault && !FAULT_KINDS[next.fault.kind]) next.fault = null;
  next.autoPaySeconds = Math.max(0, Number(next.autoPaySeconds) || 0);
  next.timeoutMs = Math.max(1000, Number(next.timeoutMs) || DEFAULT_SETTINGS.timeoutMs);
  await iuguMockPut('settings', 'default', null, next);
  return next;
}

/**
 * Consumes one shot of the configured fault when it matches this call.
 * @returns {null | { status?: number, body?: any, timeout?: boolean }}
 */
export async function takeFault(routeName, channel) {
  const settings = await getSettings();
  const fault = settings.fault;
  if (!fault || !FAULT_KINDS[fault.kind]) return null;
  if (fault.route !== '*' && fault.route !== routeName) return null;
  if (fault.channel && fault.channel !== 'any' && fault.channel !== channel) return null;
  const remaining = Number(fault.remaining ?? 1);
  if (remaining <= 0) return null;
  await updateSettings({ fault: remaining - 1 > 0 ? { ...fault, remaining: remaining - 1 } : null });
  return { ...FAULT_KINDS[fault.kind], timeoutMs: settings.timeoutMs };
}
