// Catálogo de cenários de teste da Worldpay (WPG — paymentService XML).
//
// Cada cenário descreve a resposta que o mock devolve e o que o gateway deve produzir a
// partir dela, para que a lista sirva tanto de menu de testes quanto de documentação.
//
// type:
//   iso8583      → <lastEvent>REFUSED</lastEvent> + <ISO8583ReturnCode> (recusa do emissor)
//   last_event   → <lastEvent> arbitrário, sem ISO8583 (exercita o mapa config/worldpay.status)
//   gateway_error→ <reply><error code="N"> sem orderStatus (erro do gateway)
//   http_error   → resposta HTTP não-2xx (cai no $response->failed() do makeRequest)
//   timeout      → segura a resposta além do timeout do gateway (ConnectionException → 504)

export const AUTHORISED_SCENARIO = 'authorised';

export const WORLDPAY_SCENARIOS = [
  // ─── Sucesso ────────────────────────────────────────────────────────────────
  {
    slug: 'authorised',
    name: 'Teste Authorised',
    type: 'last_event',
    lastEvent: 'AUTHORISED',
    description: 'Transação autorizada',
    expected: { status: 'paid', refuseReason: null, errorCode: null },
  },
  {
    slug: 'pending',
    name: 'Teste Pending',
    type: 'last_event',
    lastEvent: 'IN_PROCESS_AUTHORISED',
    description: 'Autorização em processamento',
    expected: { status: 'waiting_payment', refuseReason: null, errorCode: null },
  },

  // ─── Recusas do emissor (ISO8583) ───────────────────────────────────────────
  {
    slug: 'refused',
    name: 'Teste Refused',
    type: 'iso8583',
    code: '5',
    description: 'REFUSED',
    expected: { status: 'refused', refuseReason: '5 - REFUSED', errorCode: '5' },
  },
  {
    slug: 'insufficient-funds',
    name: 'Teste Insufficient Funds',
    type: 'iso8583',
    code: '51',
    description: 'LIMIT EXCEEDED',
    expected: { status: 'refused', refuseReason: '51 - LIMIT EXCEEDED', errorCode: '51' },
  },
  {
    slug: 'fraud',
    name: 'Teste Fraud',
    type: 'iso8583',
    code: '34',
    description: 'FRAUD SUSPICION',
    expected: { status: 'refused', refuseReason: '34 - FRAUD SUSPICION', errorCode: '34' },
  },
  {
    slug: 'security-breach',
    name: 'Teste Security Breach',
    type: 'iso8583',
    code: '97',
    description: 'SECURITY BREACH',
    expected: { status: 'refused', refuseReason: '97 - SECURITY BREACH', errorCode: '97' },
  },
  {
    slug: 'card-expired',
    name: 'Teste Card Expired',
    type: 'iso8583',
    code: '33',
    description: 'CARD EXPIRED',
    expected: { status: 'refused', refuseReason: '33 - CARD EXPIRED', errorCode: '33' },
  },
  {
    slug: 'invalid-amount',
    name: 'Teste Invalid Amount',
    type: 'iso8583',
    code: '13',
    description: 'INVALID AMOUNT',
    expected: { status: 'refused', refuseReason: '13 - INVALID AMOUNT', errorCode: '13' },
  },
  {
    slug: 'invalid-security-code',
    name: 'Teste Invalid Security Code',
    type: 'iso8583',
    code: '55',
    description: 'INVALID SECURITY CODE',
    expected: { status: 'refused', refuseReason: '55 - INVALID SECURITY CODE', errorCode: '55' },
  },
  {
    slug: 'lost-card',
    name: 'Teste Lost Card',
    type: 'iso8583',
    code: '41',
    description: 'LOST CARD',
    expected: { status: 'refused', refuseReason: '41 - LOST CARD', errorCode: '41' },
  },
  {
    slug: 'stolen-card',
    name: 'Teste Stolen Card',
    type: 'iso8583',
    code: '43',
    description: 'STOLEN CARD, PICK UP',
    expected: { status: 'refused', refuseReason: '43 - STOLEN CARD, PICK UP', errorCode: '43' },
  },
  {
    slug: 'restricted-card',
    name: 'Teste Restricted Card',
    type: 'iso8583',
    code: '62',
    description: 'RESTRICTED CARD',
    expected: { status: 'refused', refuseReason: '62 - RESTRICTED CARD', errorCode: '62' },
  },
  {
    slug: 'card-blocked',
    name: 'Teste Card Blocked',
    type: 'iso8583',
    code: '76',
    description: 'CARD BLOCKED',
    expected: { status: 'refused', refuseReason: '76 - CARD BLOCKED', errorCode: '76' },
  },
  {
    slug: 'closed-account',
    name: 'Teste Closed Account',
    type: 'iso8583',
    code: '46',
    description: 'CLOSED ACCOUNT',
    expected: { status: 'refused', refuseReason: '46 - CLOSED ACCOUNT', errorCode: '46' },
  },
  {
    slug: 'transaction-not-permitted',
    name: 'Teste Transaction Not Permitted',
    type: 'iso8583',
    code: '58',
    description: 'TRANSACTION NOT PERMITTED',
    expected: { status: 'refused', refuseReason: '58 - TRANSACTION NOT PERMITTED', errorCode: '58' },
  },
  {
    slug: 'issuer-unreachable',
    name: 'Teste Issuer Unreachable',
    type: 'iso8583',
    code: '91',
    description: 'CREDITCARD ISSUER TEMPORARILY NOT REACHABLE',
    expected: {
      status: 'refused',
      refuseReason: '91 - CREDITCARD ISSUER TEMPORARILY NOT REACHABLE',
      errorCode: '91',
    },
  },
  {
    slug: 'issuer-timeout',
    name: 'Teste Issuer Timeout',
    type: 'iso8583',
    code: '68',
    description: 'TRANSACTION TIMED OUT',
    expected: { status: 'refused', refuseReason: '68 - TRANSACTION TIMED OUT', errorCode: '68' },
  },
  {
    slug: 'duplicate-request',
    name: 'Teste Duplicate Request',
    type: 'iso8583',
    code: '94',
    description: 'DUPLICATE REQUEST ERROR',
    expected: { status: 'refused', refuseReason: '94 - DUPLICATE REQUEST ERROR', errorCode: '94' },
  },

  // ─── Outros lastEvent ───────────────────────────────────────────────────────
  {
    slug: 'error',
    name: 'Teste Error',
    type: 'last_event',
    lastEvent: 'ERROR',
    description: 'Falha de processamento no gateway',
    expected: { status: 'refused', refuseReason: null, errorCode: null },
  },
  {
    slug: 'cancelled',
    name: 'Teste Cancelled',
    type: 'last_event',
    lastEvent: 'CANCELLED',
    description: 'Transação cancelada',
    expected: { status: 'refunded', refuseReason: null, errorCode: null },
  },
  {
    slug: 'expired',
    name: 'Teste Expired',
    type: 'last_event',
    lastEvent: 'EXPIRED',
    description: 'Transação expirada',
    expected: { status: 'refused', refuseReason: null, errorCode: null },
  },

  // ─── Erros do gateway (sem orderStatus) ─────────────────────────────────────
  {
    slug: 'gateway-error',
    name: 'Teste Gateway Error',
    type: 'gateway_error',
    code: '7',
    description: 'Invalid payment details',
    expected: { status: 'refused', refuseReason: '7 - Erro da WORLDPAY', errorCode: '7' },
  },
  {
    slug: 'parse-error',
    name: 'Teste Parse Error',
    type: 'gateway_error',
    code: '5',
    description: 'Duplicate Order',
    expected: { status: 'refused', refuseReason: '5 - WORLDPAY PARSE CHARGE ERROR', errorCode: '5' },
  },
  {
    slug: 'security-violation',
    name: 'Teste Security Violation',
    type: 'gateway_error',
    code: '4',
    description: 'Security violation',
    // Só 5 e 7 têm tratamento explícito no parseCharge; os demais viram REFUSED sem refuse_reason.
    expected: { status: 'refused', refuseReason: null, errorCode: '4' },
  },

  // ─── Falhas de transporte ───────────────────────────────────────────────────
  {
    slug: 'http-500',
    name: 'Teste HTTP 500',
    type: 'http_error',
    httpStatus: 500,
    description: 'Internal Server Error',
    expected: { status: null, refuseReason: null, errorCode: null, note: 'cai no $response->failed() do makeRequest' },
  },
  {
    slug: 'timeout',
    name: 'Teste Timeout',
    type: 'timeout',
    // O gateway usa config('worldpay.http_timeout', 60); 65s garante o estouro.
    delaySeconds: 65,
    description: 'Sem resposta dentro do timeout',
    expected: { status: null, refuseReason: null, errorCode: null, note: 'ConnectionException → GATEWAY_TIMEOUT 504' },
  },
];

/**
 * Normaliza o nome informado para o slug do catálogo: aceita "Teste Fraud",
 * "teste-fraud", "FRAUD", "fraud" e "Teste Invalid Amount" indistintamente.
 */
export function normalizeScenarioKey(value) {
  if (value == null) return null;

  const normalized = String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^\s*testes?\s+/, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '');

  return normalized || null;
}

export function findScenario(value) {
  const key = normalizeScenarioKey(value);
  if (!key) return null;

  return WORLDPAY_SCENARIOS.find((scenario) => scenario.slug === key) ?? null;
}

export function listScenarios() {
  return WORLDPAY_SCENARIOS.map((scenario) => ({
    slug: scenario.slug,
    name: scenario.name,
    type: scenario.type,
    code: scenario.code ?? null,
    lastEvent: scenario.lastEvent ?? null,
    description: scenario.description,
    expected: scenario.expected,
  }));
}
