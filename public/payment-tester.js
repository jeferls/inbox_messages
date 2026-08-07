const ENV_URLS = {
  local: { back: 'http://greenn-back-nginx', gateway: 'http://gateway-nginx' },
  staging: {
    back: 'https://apiadm-staging.greenn.com.br',
    gateway: 'https://gateway-staging.greenn.com.br',
  },
};

const CARD_PRESETS = {
  visa: { number: '4111111111111111', cvv: '123', month: '12', year: '2030' },
  master: { number: '5555555555554444', cvv: '123', month: '12', year: '2030' },
};

// Métodos que passam pela tokenização de cartão no priority.
const CARD_METHODS = ['CREDIT_CARD', 'TWO_CREDIT_CARDS', 'DEBIT_CARD'];
// Métodos em que o greenn-back aceita `installments` (payment.ts L573-574).
const INSTALLMENT_METHODS = ['CREDIT_CARD', 'TWO_CREDIT_CARDS', 'DEBIT_CARD', 'BOLETO'];

// Erros recorrentes que confundem quem está testando — a causa nunca está no payload.
const ERROR_HINTS = {
  DUPLICATE_PURCHASE:
    'O greenn-back bloqueia nova compra do mesmo produto quando já existe uma venda paga nos ' +
    'últimos 7 dias com o mesmo celular, o mesmo e-mail ou o mesmo IP (PaymentValidation::duplicatePurchase). ' +
    'A regra de IP pega qualquer teste feito desta máquina: use outro produto, ou ligue ' +
    'DISABLE_DUPLICATE_SALE em user_settings para o seller.',
};

const $ = (id) => document.getElementById(id);

const form = $('paymentForm');
const payloadTextarea = $('payloadJson');
const jsonErrorEl = $('jsonError');
const productBadge = $('productBadge');
const stepsEl = $('steps');
const placeholderEl = $('placeholder');
const verdictEl = $('verdict');

// Dados do produto carregados do greenn-back; alimentam o payload e o priority.
let loadedProduct = null;
let currentPayload = null;

// ---------------------------------------------------------------- ambiente

const envRadios = document.querySelectorAll('input[name="envTarget"]');
envRadios.forEach((radio) => {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    envRadios.forEach((r) => r.closest('.env-option').classList.toggle('active', r === radio));
    $('backUrl').value = ENV_URLS[radio.value].back;
    $('gatewayUrl').value = ENV_URLS[radio.value].gateway;
    document.body.classList.toggle('env-staging-active', radio.value === 'staging');
  });
});

// ---------------------------------------------------------------- payload

function currentMethod() {
  return $('method').value;
}

/**
 * CPF com dígitos verificadores válidos. O gateway rejeita CPF malformado
 * antes mesmo de tentar a cobrança (INVALID_CLIENT_DATA).
 */
function randomCpf() {
  const digits = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));

  for (let round = 0; round < 2; round++) {
    const firstWeight = digits.length + 1;
    const sum = digits.reduce((acc, digit, i) => acc + digit * (firstWeight - i), 0);
    const rest = (sum * 10) % 11;
    digits.push(rest >= 10 ? 0 : rest);
  }

  const s = digits.join('');
  return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}`;
}

/**
 * Cliente novo a cada geração. Celular, e-mail e documento precisam ser inéditos:
 * repetir qualquer um deles em um produto já comprado cai em DUPLICATE_PURCHASE.
 */
function fillRandomClient() {
  const n = Math.floor(Math.random() * 100000);
  $('clientName').value = `Cliente Teste ${n}`;
  $('clientEmail').value = `teste.${n}.${Date.now()}@example.com`;
  $('clientPhone').value = `+55119${String(n).padStart(8, '0').slice(0, 8)}`;
  $('clientDocument').value = randomCpf();
}

function randomUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function buildPayload() {
  const method = currentMethod();
  const amount = Number($('amount').value) || 0;
  const installments = String(Number($('installments').value) || 1);
  const isCard = CARD_METHODS.includes(method);

  // Sem produto carregado ainda, cai no que estiver digitado: o campo aceita id numérico
  // ou nano_id, e `products[].product_id` é sempre o id numérico.
  const typedId = $('productId').value.trim();
  const numericId = Number(typedId);

  const payload = {
    method,
    amount,
    total: amount,
    product_id: loadedProduct?.hash ?? typedId,
    products: [
      {
        product_id: loadedProduct?.id ?? (Number.isNaN(numericId) ? typedId : numericId),
        product_offer: $('offerHash').value.trim(),
      },
    ],
    name: $('clientName').value.trim(),
    email: $('clientEmail').value.trim(),
    cellphone: $('clientPhone').value.trim(),
    document: $('clientDocument').value.trim(),
    uuid: randomUuid(),
    country_code: 'BR',
    zipcode: null,
    street: '',
    number: '',
    complement: '',
    neighborhood: '',
    city: '',
    state: '',
    language: 'pt',
    metas: {},
    upsell_id: null,
    wpp_id: null,
    reuse_credit_card: true,
    assoc_ticket: false,
    parent_id: null,
    order_bumps_not_selected: [],
    currency_data: { local_currency: 'BRL', base_currency: 'BRL' },
    client_id: null,
    gateway: null,
    is_international: false,
    is_3ds_transaction_required: false,
    dfReferenceId: '',
    check_contract_terms: false,
  };

  if (INSTALLMENT_METHODS.includes(method)) {
    payload.installments = installments;
  }

  if (isCard) {
    // Placeholders: id/brand/dígitos são substituídos pela resposta do priority.
    // amount e total são preservados de cá, como o checkout real faz.
    const perCard = method === 'TWO_CREDIT_CARDS' ? amount / 2 : amount;
    const count = method === 'TWO_CREDIT_CARDS' ? 2 : 1;
    payload.cards = Array.from({ length: count }, () => ({
      id: null,
      last_digits: null,
      first_digits: null,
      customer: null,
      amount: perCard.toFixed(2),
      total: perCard.toFixed(2),
      brand: null,
      is_v5: true,
    }));
  }

  return payload;
}

function buildPriority() {
  const method = currentMethod();
  const isCard = CARD_METHODS.includes(method);

  const card = {
    country: 'BR',
    holder_name: $('cardHolder').value.trim(),
    number: $('cardNumber').value.replace(/\s/g, ''),
    exp_month: $('cardMonth').value.trim(),
    exp_year: $('cardYear').value.trim(),
    cvv: $('cardCvv').value.trim(),
    costumer: null,
  };

  return {
    system: 'CHECKOUT',
    payment_method: method,
    action: isCard ? 'CARD' : null,
    attempts: [],
    installments: Number($('installments').value) || 1,
    cards: isCard ? Array(method === 'TWO_CREDIT_CARDS' ? 2 : 1).fill(card) : [],
    seller_id: loadedProduct?.sellerId ?? null,
    transaction_type: loadedProduct?.transactionType ?? 'TRANSACTION',
    is_bump: false,
    data3ds: null,
    pre_priority_3ds: 'success',
    is_international: false,
    is_pix_automatic: false,
    product_id: String(loadedProduct?.id ?? $('productId').value.trim()),
    email_customer: $('clientEmail').value.trim(),
  };
}

function renderPayload() {
  currentPayload = buildPayload();
  payloadTextarea.value = JSON.stringify(currentPayload, null, 2);
  jsonErrorEl.hidden = true;
}

payloadTextarea.addEventListener('input', () => {
  try {
    const parsed = JSON.parse(payloadTextarea.value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    currentPayload = parsed;
    jsonErrorEl.hidden = true;
  } catch {
    jsonErrorEl.hidden = false;
  }
});

// Campos que alteram o payload o regeram — a edição manual só sobrevive até o próximo toque.
['method', 'amount', 'installments', 'clientName', 'clientEmail', 'clientPhone', 'clientDocument', 'offerHash']
  .forEach((id) => $(id).addEventListener('input', renderPayload));

$('method').addEventListener('change', () => {
  const isCard = CARD_METHODS.includes(currentMethod());
  $('cardFields').hidden = !isCard;
  renderPayload();
});

$('resetPayloadBtn').addEventListener('click', renderPayload);

$('cardPreset').addEventListener('change', () => {
  const preset = CARD_PRESETS[$('cardPreset').value];
  if (!preset) return;
  $('cardNumber').value = preset.number;
  $('cardCvv').value = preset.cvv;
  $('cardMonth').value = preset.month;
  $('cardYear').value = preset.year;
});

$('randomClientBtn').addEventListener('click', () => {
  fillRandomClient();
  renderPayload();
});

// ---------------------------------------------------------------- produto

$('loadProductBtn').addEventListener('click', async () => {
  const btn = $('loadProductBtn');
  btn.disabled = true;
  setLine('loadStatusLine', 'Carregando...');

  try {
    const res = await fetch('/api/payment-tester/product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        backUrl: $('backUrl').value.trim(),
        productId: $('productId').value.trim(),
        offerHash: $('offerHash').value.trim(),
      }),
    });
    const data = await res.json();

    if (!res.ok || !data.ok) {
      loadedProduct = null;
      showBadge(false, data.error ?? `HTTP ${data.status ?? res.status}`);
      setLine('loadStatusLine', '');
      return;
    }

    // Só compra avulsa: um produto de assinatura fica visível, mas não habilita a execução.
    if (!data.supported) {
      loadedProduct = null;
      showBadge(
        false,
        `${data.product.name} — tipo ${data.product.type}. Esta ferramenta só executa compras de ` +
          `produtos ${data.allowedType}; escolha outro produto.`,
      );
      setLine('loadStatusLine', `${data.durationMs}ms`);
      return;
    }

    loadedProduct = data.product;
    $('amount').value = data.product.amount ?? $('amount').value;
    showBadge(
      true,
      `${data.product.name} — ${data.product.type} — ${data.product.currency} ${data.product.amount} ` +
        `— seller ${data.product.sellerId} — ${data.tokensFound} tokens anti-bot`,
    );
    setLine('loadStatusLine', `${data.durationMs}ms`);
    renderPayload();
  } catch (err) {
    showBadge(false, `Falha na requisição: ${err.message}`);
    setLine('loadStatusLine', '');
  } finally {
    btn.disabled = false;
  }
});

function showBadge(ok, message) {
  productBadge.hidden = false;
  productBadge.className = `product-badge ${ok ? 'ok' : 'err'}`;
  productBadge.textContent = message;
}

// ---------------------------------------------------------------- catálogo do seller

// Produtos do seller listado, indexados por id, para achar as ofertas ao trocar de produto.
let catalog = new Map();

$('listProductsBtn').addEventListener('click', async () => {
  const sellerId = $('sellerId').value.trim();
  if (!sellerId) {
    showSellerBadge(false, 'Informe o user id do seller.');
    return;
  }

  const btn = $('listProductsBtn');
  btn.disabled = true;

  try {
    const res = await fetch(`/api/payment-tester/seller/${encodeURIComponent(sellerId)}/products`);
    const data = await res.json();

    if (!res.ok) {
      showSellerBadge(false, data.error ?? `HTTP ${res.status}`);
      return;
    }

    fillProductSelect(data.products ?? []);

    const usable = (data.products ?? []).filter((p) => p.supported).length;
    showSellerBadge(
      usable > 0,
      `${data.total} produto(s) com oferta — ${usable} do tipo ${data.allowedType}.`,
    );
  } catch (err) {
    showSellerBadge(false, `Falha na requisição: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
});

function fillProductSelect(products) {
  catalog = new Map(products.map((product) => [String(product.id), product]));

  const select = $('productSelect');
  select.innerHTML = '';
  select.disabled = products.length === 0;

  const first = document.createElement('option');
  first.value = '';
  first.textContent = products.length ? 'Selecione um produto…' : 'Nenhum produto com oferta';
  select.appendChild(first);

  for (const product of products) {
    const option = document.createElement('option');
    option.value = String(product.id);
    option.textContent = `[${product.type}] ${product.name} — #${product.id}`;
    // Mantém visível o que existe, mas impede escolher o que a ferramenta não executa.
    option.disabled = !product.supported;
    select.appendChild(option);
  }

  // Já deixa o primeiro produto elegível escolhido — é o caso comum.
  const firstUsable = products.find((product) => product.supported);
  if (firstUsable) {
    select.value = String(firstUsable.id);
    applyProductSelection();
  } else {
    $('offerSelect').innerHTML = '<option value="">Selecione um produto…</option>';
    $('offerSelect').disabled = true;
  }
}

$('productSelect').addEventListener('change', applyProductSelection);

function applyProductSelection() {
  const product = catalog.get($('productSelect').value);
  const offerSelect = $('offerSelect');

  offerSelect.innerHTML = '';
  offerSelect.disabled = !product;

  if (!product) {
    offerSelect.innerHTML = '<option value="">Selecione um produto…</option>';
    return;
  }

  $('productId').value = String(product.id);

  for (const offer of product.offers) {
    const option = document.createElement('option');
    option.value = offer.hash;
    const label = offer.name ? `${offer.name} — ` : '';
    option.textContent = `${label}R$ ${offer.amount}${offer.isDefault ? ' (padrão)' : ''}`;
    offerSelect.appendChild(option);
  }

  // Seleção explícita: não dependemos do select escolher sozinho a primeira option.
  const preferred = product.offers.find((offer) => offer.isDefault) ?? product.offers[0];
  if (preferred) offerSelect.value = preferred.hash;

  applyOfferSelection();
}

$('offerSelect').addEventListener('change', applyOfferSelection);

function applyOfferSelection() {
  const product = catalog.get($('productSelect').value);
  const offer = product?.offers.find((o) => o.hash === $('offerSelect').value);
  if (!offer) return;

  $('offerHash').value = offer.hash;
  $('amount').value = offer.amount;

  // Trocar de produto invalida o que foi carregado antes; força um novo "Carregar produto".
  loadedProduct = null;
  productBadge.hidden = true;
  renderPayload();
}

function showSellerBadge(ok, message) {
  const badge = $('sellerBadge');
  badge.hidden = false;
  badge.className = `product-badge ${ok ? 'ok' : 'err'}`;
  badge.textContent = message;
}

// ---------------------------------------------------------------- cenário worldpay

async function loadScenarios() {
  try {
    const [scenariosRes, activeRes] = await Promise.all([
      fetch('/api/gateway-mocks/worldpay/scenarios'),
      fetch('/api/gateway-mocks/worldpay/active'),
    ]);
    if (!scenariosRes.ok) return;

    const { scenarios = [] } = await scenariosRes.json();
    const active = activeRes.ok ? (await activeRes.json()).active : null;

    const select = $('worldpayScenario');
    for (const scenario of scenarios) {
      const option = document.createElement('option');
      option.value = scenario.slug;
      option.textContent =
        `${scenario.name} — ${scenario.description}` +
        (scenario.slug === active ? ' (ativo)' : '');
      select.appendChild(option);
    }
  } catch {
    // O seletor é opcional: sem o mock disponível, a aba segue funcionando.
  }
}

async function applyScenario(slug) {
  if (!slug) return;
  await fetch('/api/gateway-mocks/worldpay/active', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario: slug }),
  });
}

// ---------------------------------------------------------------- execução

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  let payload;
  try {
    payload = JSON.parse(payloadTextarea.value);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('not an object');
  } catch {
    jsonErrorEl.hidden = false;
    setLine('runStatusLine', 'Payload inválido', true);
    return;
  }

  // O priority precisa do seller_id, que só vem do produto carregado. Sem ele a resposta
  // é um "Unable to select any Gateway" que não explica nada.
  if (!$('skipPriority').checked && !loadedProduct) {
    setLine('runStatusLine', 'Clique em “Carregar produto” antes de executar', true);
    placeholderEl.hidden = false;
    return;
  }

  const btn = $('runBtn');
  btn.disabled = true;
  setLine('runStatusLine', 'Executando...');
  verdictEl.hidden = true;
  stepsEl.innerHTML = '';
  placeholderEl.hidden = true;

  const startedAt = Date.now();

  try {
    await applyScenario($('worldpayScenario').value);

    const res = await fetch('/api/payment-tester/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        backUrl: $('backUrl').value.trim(),
        gatewayUrl: $('gatewayUrl').value.trim(),
        gatewayKey: $('gatewayKey').value.trim() || undefined,
        productId: $('productId').value.trim(),
        offerHash: $('offerHash').value.trim(),
        payload,
        priority: buildPriority(),
        skipPriority: $('skipPriority').checked,
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      setLine('runStatusLine', data.error ?? `HTTP ${res.status}`, true);
      placeholderEl.hidden = false;
      return;
    }

    renderResult(data);
    setLine('runStatusLine', `${Date.now() - startedAt}ms`);
  } catch (err) {
    setLine('runStatusLine', `Falha na requisição: ${err.message}`, true);
    placeholderEl.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

function renderResult(data) {
  verdictEl.hidden = false;
  verdictEl.className = `verdict ${data.approved ? 'ok' : 'err'}`;
  $('verdictTitle').textContent = data.approved ? 'Pagamento aprovado' : 'Pagamento não aprovado';

  const sub = $('verdictSub');
  sub.textContent = data.summary ?? '';

  const hint = (data.sales ?? []).map((sale) => ERROR_HINTS[sale.code]).find(Boolean);
  if (hint) {
    const hintEl = document.createElement('div');
    hintEl.style.marginTop = '8px';
    hintEl.textContent = hint;
    sub.appendChild(hintEl);
  }

  stepsEl.innerHTML = '';
  for (const step of data.steps ?? []) {
    stepsEl.appendChild(renderStep(step));
  }
}

function renderStep(step) {
  const wrapper = document.createElement('div');
  wrapper.className = 'step';

  const head = document.createElement('div');
  head.className = 'step-head';

  const dot = document.createElement('span');
  dot.className = `step-dot ${step.ok ? 'ok' : 'err'}`;

  const name = document.createElement('span');
  name.className = 'step-name';
  name.textContent = step.name;

  const url = document.createElement('span');
  url.className = 'step-url';
  url.textContent = step.url;

  const meta = document.createElement('span');
  meta.className = 'step-meta';
  meta.textContent = `${step.status ?? 'erro'} • ${step.durationMs}ms`;

  head.append(dot, name, url, meta);

  const body = document.createElement('pre');
  body.className = 'step-body';
  body.hidden = step.ok;
  body.textContent = JSON.stringify(
    {
      ...(step.error ? { error: step.error } : {}),
      ...(step.requestBody ? { request: step.requestBody } : {}),
      response: step.body,
    },
    null,
    2,
  );

  head.addEventListener('click', () => {
    body.hidden = !body.hidden;
  });

  wrapper.append(head, body);
  return wrapper;
}

function setLine(id, message, isError = false) {
  const el = $(id);
  el.textContent = message;
  el.style.color = isError ? '#b91c1c' : '#6b7280';
}

// ---------------------------------------------------------------- init

// Cliente novo já na abertura: com dados fixos, o segundo teste seguido no mesmo
// produto cairia em DUPLICATE_PURCHASE sem motivo aparente.
fillRandomClient();
renderPayload();
loadScenarios();
