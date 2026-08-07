// Executa um pagamento de checkout inteiro por API, sem browser e sem preencher formulário.
//
// Reproduz a mesma sequência que o new-checkout faz no navegador:
//
//   1. GET  {back}/api/product/test-checkout/{id}[/offer/{hash}]
//      Além dos dados do produto, a resposta traz nos headers os tokens anti-bot
//      (Controller-Token-, RequestRay-Token-, Firewall-Token-, Cache-Token-, Trans-Token-).
//      Sem eles o POST /payment é barrado. Ver new-checkout composables/useApi.ts.
//
//   2. POST {gateway}/api/checkout/priority
//      Escolhe o gateway e tokeniza o cartão. Exige o header X-Greenn-Gateway.
//
//   3. POST {back}/api/payment
//      O pagamento em si, com os tokens do passo 1 e o cartão tokenizado do passo 2.
//
// A mutação de `cards` entre o passo 2 e o 3 (card cru → HashCard) espelha o que o
// store de pagamento do checkout faz em handleResponsePriority.

import crypto from 'node:crypto';

const md5 = (value) => crypto.createHash('md5').update(value).digest('hex');

// Tokens anti-bot que o greenn-back devolve no GET do produto e exige de volta no POST /payment.
const ANTI_BOT_HEADERS = [
  'controller-token-',
  'requestray-token-',
  'firewall-token-',
  'cache-token-',
  'trans-token-',
];

const CARD_METHODS = ['CREDIT_CARD', 'TWO_CREDIT_CARDS', 'DEBIT_CARD'];

// A ferramenta é só para compra avulsa. SUBSCRIPTION e CONTRACT abrem recorrência
// (e, no ambiente local, esbarram em migration pendente de subscription_charges).
export const ALLOWED_PRODUCT_TYPE = 'TRANSACTION';

/**
 * Token do header X-Greenn-Gateway. Mesmo algoritmo de
 * new-checkout utils/useGenerateGatewayToken.ts: md5 iterado sobre chave+salt,
 * com o salt e a contagem de iterações concatenados no fim para o servidor refazer a conta.
 */
export function generateGatewayToken(apiKey) {
  const salt = Math.floor(1000 + Math.random() * 9000).toString();
  const iterations = Math.floor(1 + Math.random() * 10);

  let hashed = apiKey + salt;
  for (let i = 0; i < iterations; i++) hashed = md5(hashed);

  return hashed + salt + iterations;
}

const stripTrailingSlash = (url) => String(url || '').replace(/\/+$/, '');

async function readBody(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Envolve um fetch em um registro de passo — sempre devolve o que aconteceu, inclusive
 * em falha de rede, para a tela conseguir mostrar onde o fluxo parou.
 */
async function runStep({ name, url, method = 'GET', headers = {}, body = null }) {
  const startedAt = process.hrtime.bigint();
  const step = { name, url, method, requestBody: body, requestHeaders: headers };

  try {
    const response = await fetch(url, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    step.status = response.status;
    step.ok = response.ok;
    step.body = await readBody(response);
    step.responseHeaders = Object.fromEntries(response.headers.entries());
  } catch (error) {
    step.status = null;
    step.ok = false;
    step.error = error.message;
  }

  step.durationMs = Number((process.hrtime.bigint() - startedAt) / BigInt(1e6));
  return step;
}

/** Passo 1 — produto + tokens anti-bot. */
export async function fetchProduct({ backUrl, productId, offerHash, query = {} }) {
  let path = `${stripTrailingSlash(backUrl)}/api/product/test-checkout/${productId}`;
  if (offerHash) path += `/offer/${offerHash}`;

  const search = new URLSearchParams(
    Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  ).toString();

  const step = await runStep({ name: 'produto', url: search ? `${path}?${search}` : path });

  const tokens = {};
  for (const header of ANTI_BOT_HEADERS) {
    const value = step.responseHeaders?.[header];
    if (value) tokens[header] = value;
  }
  step.tokensFound = Object.keys(tokens).length;

  return { step, tokens };
}

/** Passo 2 — gateway prioritário + tokenização do cartão. */
async function callPriority({ gatewayUrl, gatewayKey, dataGateway }) {
  return runStep({
    name: 'priority',
    url: `${stripTrailingSlash(gatewayUrl)}/api/checkout/priority`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Greenn-Gateway': generateGatewayToken(gatewayKey),
    },
    body: dataGateway,
  });
}

/**
 * Aplica no payload o que só existe depois do priority: o gateway escolhido, o parent_id
 * e os cartões tokenizados. Os campos amount/total de cada cartão são preservados —
 * o priority não os devolve, e é assim que o checkout real também faz.
 */
function applyPriorityToPayload(payload, priorityBody, isCardMethod) {
  const patched = { ...payload };

  if (priorityBody?.gateway) patched.gateway = priorityBody.gateway;
  if (priorityBody?.parent_id != null) patched.parent_id = priorityBody.parent_id;

  if (!isCardMethod || !Array.isArray(priorityBody?.cards)) return patched;

  patched.cards = priorityBody.cards.map((tokenized, index) => {
    const original = payload.cards?.[index] ?? {};
    const data = tokenized.data ?? {};

    const month = data.month?.toString().padStart(2, '0');
    const year = data.year?.toString();

    return {
      id: tokenized.id,
      last_digits: data.last_digits,
      first_digits: data.first_digits,
      customer: tokenized.customer_id ?? null,
      amount: original.amount,
      total: original.total,
      brand: data.brand,
      is_v5: true,
      ...(month && year ? { expiration_date: `${month}/${year}` } : {}),
    };
  });

  return patched;
}

/** Passo 3 — o pagamento. */
async function callPayment({ backUrl, payload, tokens, sessionId }) {
  return runStep({
    name: 'payment',
    url: `${stripTrailingSlash(backUrl)}/api/payment`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Session-Id': sessionId,
      ...tokens,
    },
    body: payload,
  });
}

/**
 * Lê o resultado do POST /payment. O greenn-back responde 200 mesmo quando a venda é
 * recusada — o que importa é o `success` de cada item em `sales`.
 */
function summarize(paymentStep) {
  if (!paymentStep.ok) {
    return { approved: false, summary: `Falha HTTP ${paymentStep.status ?? '-'}` };
  }

  const sales = paymentStep.body?.sales;
  if (!Array.isArray(sales) || sales.length === 0) {
    return { approved: false, summary: 'Resposta sem vendas' };
  }

  const approved = sales.every((sale) => sale.success);
  const parts = sales.map((sale) => {
    const label = sale.success ? 'aprovada' : `recusada (${sale.code ?? sale.status ?? '?'})`;
    return `venda ${sale.sale_id ?? '?'} ${label}`;
  });

  return { approved, summary: parts.join(' • '), sales };
}

/**
 * Roda o fluxo inteiro. Devolve sempre a lista de passos executados, mesmo em falha,
 * para a tela poder mostrar exatamente onde parou.
 */
export async function runPayment({
  backUrl,
  gatewayUrl,
  gatewayKey,
  productId,
  offerHash,
  payload,
  priority,
  skipPriority = false,
}) {
  const steps = [];
  const sessionId = crypto.randomUUID();

  const { step: productStep, tokens } = await fetchProduct({ backUrl, productId, offerHash });
  steps.push(productStep);

  if (!productStep.ok) {
    return { steps, approved: false, summary: 'Não foi possível carregar o produto' };
  }
  if (productStep.tokensFound === 0) {
    return {
      steps,
      approved: false,
      summary: 'O produto carregou mas não devolveu os tokens anti-bot — o POST /payment seria barrado',
    };
  }

  const productType = productStep.body?.data?.type;
  if (productType !== ALLOWED_PRODUCT_TYPE) {
    return {
      steps,
      approved: false,
      summary:
        `Produto do tipo ${productType ?? 'desconhecido'} — esta ferramenta só executa compras ` +
        `de produtos ${ALLOWED_PRODUCT_TYPE}.`,
    };
  }

  let finalPayload = payload;
  const isCardMethod = CARD_METHODS.includes(payload.method);

  if (!skipPriority) {
    const priorityStep = await callPriority({ gatewayUrl, gatewayKey, dataGateway: priority });
    steps.push(priorityStep);

    if (!priorityStep.ok) {
      return { steps, approved: false, summary: 'O priority gateway recusou a requisição' };
    }

    finalPayload = applyPriorityToPayload(payload, priorityStep.body, isCardMethod);
  }

  const paymentStep = await callPayment({ backUrl, payload: finalPayload, tokens, sessionId });
  steps.push(paymentStep);

  return { steps, sessionId, finalPayload, ...summarize(paymentStep) };
}
