const postbackForm = document.getElementById('postbackForm');
const sendPostbackBtn = document.getElementById('sendPostbackBtn');
const postbackStatusLine = document.getElementById('postbackStatusLine');
const resultBox = document.getElementById('resultBox');
const resultStatus = document.getElementById('resultStatus');
const resultBody = document.getElementById('resultBody');

const ENV_URLS = {
  local: 'http://greenn-back-nginx',
  staging: 'https://apiadm-staging.greenn.com.br',
};

const baseUrlInput = document.getElementById('baseUrl');
const envRadios = document.querySelectorAll('input[name="envTarget"]');

envRadios.forEach((radio) => {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    envRadios.forEach((r) => r.closest('.env-option').classList.toggle('active', r === radio));
    baseUrlInput.value = ENV_URLS[radio.value];
    document.body.classList.toggle('env-staging-active', radio.value === 'staging');
    applyEnvToSaleSelect(radio.value);
  });
});

// Select das últimas sales: só existe no ambiente local (a lista vem do MySQL do greenn-back).
// Em staging a tela mantém o comportamento antigo, com o transaction_id informado na mão.
const saleSelect = document.getElementById('saleSelect');
const saleSelectWrap = document.getElementById('saleSelectWrap');
const saleIdInput = document.getElementById('saleId');
const saleLookupHint = document.getElementById('saleLookupHint');

const SALE_HINT_DEFAULT = 'Importa o transaction_id da venda escolhida.';
let recentSalesLoaded = false;

function currentEnv() {
  return document.querySelector('input[name="envTarget"]:checked')?.value ?? 'local';
}

function setSaleHint(msg, isError = false) {
  saleLookupHint.textContent = msg || SALE_HINT_DEFAULT;
  saleLookupHint.style.color = isError ? '#b91c1c' : '#6b7280';
}

function formatSaleOption(sale) {
  const amount = sale.amount != null ? `R$ ${Number(sale.amount).toFixed(2)}` : '';
  const transaction = sale.transactionId ? ` — ${sale.transactionId}` : ' — sem transaction_id';
  return `#${sale.id} — ${sale.status ?? '?'} ${amount}${transaction}`.trim();
}

async function loadRecentSales() {
  if (recentSalesLoaded) return;
  try {
    const res = await fetch('/api/sales?limit=30');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? res.status);

    saleSelect.innerHTML = '<option value="">Selecione uma sale...</option>';
    for (const sale of data.sales ?? []) {
      const opt = document.createElement('option');
      opt.value = String(sale.id);
      opt.textContent = formatSaleOption(sale);
      opt.dataset.transactionId = sale.transactionId ?? '';
      saleSelect.appendChild(opt);
    }
    recentSalesLoaded = true;
  } catch (err) {
    setSaleHint(`Não foi possível carregar as sales: ${err.message}`, true);
  }
}

function applyTransactionId(saleId, transactionId) {
  if (!transactionId) {
    setSaleHint(`A sale #${saleId} não tem transaction_id.`, true);
    return;
  }
  transactionIdInput.value = transactionId;
  updatePayloadFromInputs();
  renderPayload();
  setSaleHint(`transaction_id importado da sale #${saleId}.`);
}

let lookupTimer = null;
let lookupSeq = 0;

async function lookupSale(saleId) {
  const seq = ++lookupSeq;
  try {
    const res = await fetch(`/api/sales/${encodeURIComponent(saleId)}`);
    const data = await res.json();
    if (seq !== lookupSeq) return;
    if (!res.ok) {
      setSaleHint(res.status === 404 ? 'Sale não encontrada.' : `Falha na busca: ${data.error ?? res.status}`, true);
      return;
    }
    applyTransactionId(data.id, data.transactionId);
  } catch (err) {
    if (seq === lookupSeq) setSaleHint(`Falha na busca: ${err.message}`, true);
  }
}

function applyEnvToSaleSelect(env) {
  const isLocal = env === 'local';
  saleSelectWrap.hidden = !isLocal;
  if (!isLocal) {
    clearTimeout(lookupTimer);
    setSaleHint('');
    return;
  }
  loadRecentSales();
}

const transactionIdInput = document.getElementById('transactionId');
const statusInput = document.getElementById('status');
const eventInput = document.getElementById('event');
const integrationInput = document.getElementById('integration');
const payloadTextarea = document.getElementById('payloadJson');
const jsonErrorEl = document.getElementById('jsonError');

let currentPayload = buildPayloadFromInputs();
renderPayload();

saleSelect.addEventListener('change', () => {
  const opt = saleSelect.selectedOptions[0];
  if (!opt?.value) return;
  saleIdInput.value = opt.value;
  applyTransactionId(opt.value, opt.dataset.transactionId);
});

saleIdInput.addEventListener('input', () => {
  if (currentEnv() !== 'local') return;
  const value = saleIdInput.value.trim();
  if (saleSelect.value !== value) saleSelect.value = '';
  clearTimeout(lookupTimer);
  if (!/^\d+$/.test(value)) {
    setSaleHint('');
    return;
  }
  setSaleHint('Buscando transaction_id...');
  lookupTimer = setTimeout(() => lookupSale(value), 400);
});

applyEnvToSaleSelect(currentEnv());

[transactionIdInput, statusInput, eventInput, integrationInput].forEach((input) => {
  input.addEventListener('input', () => {
    updatePayloadFromInputs();
    renderPayload();
  });
});

payloadTextarea.addEventListener('input', () => {
  try {
    const parsed = JSON.parse(payloadTextarea.value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    currentPayload = parsed;
    jsonErrorEl.hidden = true;
    syncInputsFromPayload();
  } catch {
    jsonErrorEl.hidden = false;
  }
});

function buildPayloadFromInputs() {
  const payload = {
    id: transactionIdInput.value.trim(),
    current_status: statusInput.value.trim(),
    status: statusInput.value.trim(),
    event: eventInput.value.trim() || 'payment_status_change',
  };
  const integration = integrationInput.value.trim();
  if (integration) payload.integration = integration;
  return payload;
}

function updatePayloadFromInputs() {
  if (!currentPayload || typeof currentPayload !== 'object') currentPayload = {};
  currentPayload.id = transactionIdInput.value.trim();
  currentPayload.current_status = statusInput.value.trim();
  currentPayload.status = statusInput.value.trim();
  currentPayload.event = eventInput.value.trim();

  const integration = integrationInput.value.trim();
  if (integration) {
    currentPayload.integration = integration;
  } else {
    delete currentPayload.integration;
  }
}

function syncInputsFromPayload() {
  const id = currentPayload.id ?? currentPayload.transaction?.id ?? '';
  const status = currentPayload.current_status ?? currentPayload.status ?? '';
  transactionIdInput.value = id;
  statusInput.value = status;
  eventInput.value = currentPayload.event ?? '';
  integrationInput.value = currentPayload.integration ?? '';
}

function renderPayload() {
  payloadTextarea.value = JSON.stringify(currentPayload, null, 2);
  jsonErrorEl.hidden = true;
}

postbackForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const baseUrl = baseUrlInput.value.trim();
  if (!baseUrl) {
    setStatus('Informe a base da URL', true);
    return;
  }

  let payload;
  try {
    payload = JSON.parse(payloadTextarea.value);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('not an object');
  } catch {
    jsonErrorEl.hidden = false;
    setStatus('JSON do webhook inválido', true);
    return;
  }

  sendPostbackBtn.disabled = true;
  setStatus('Enviando...');
  resultBox.hidden = true;

  try {
    const res = await fetch('/api/postback-gateway/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl, payload }),
    });
    const data = await res.json();

    if (!res.ok) {
      setStatus(`Erro: ${data.error ?? res.status}`, true);
      showResult(false, data);
      return;
    }

    setStatus(`Concluído em ${new Date().toLocaleTimeString()}`);
    showResult(data.ok, data);
  } catch (err) {
    setStatus(`Falha na requisição: ${err.message}`, true);
  } finally {
    sendPostbackBtn.disabled = false;
  }
});

function setStatus(msg, isError = false) {
  postbackStatusLine.textContent = msg;
  postbackStatusLine.style.color = isError ? '#b91c1c' : '#6b7280';
}

function showResult(ok, data) {
  resultBox.hidden = false;
  resultStatus.className = `result-status ${ok ? 'ok' : 'err'}`;
  resultStatus.textContent = ok
    ? `Sucesso — HTTP ${data.status} — ${data.requestUrl ?? ''}`
    : `Falha — HTTP ${data.status ?? '?'} — ${data.requestUrl ?? ''}`;
  const shown = { requestBody: data.requestBody, response: data.body };
  resultBody.textContent = JSON.stringify(shown, null, 2);
}
