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
  });
});

const transactionIdInput = document.getElementById('transactionId');
const statusInput = document.getElementById('status');
const eventInput = document.getElementById('event');
const integrationInput = document.getElementById('integration');
const payloadTextarea = document.getElementById('payloadJson');
const jsonErrorEl = document.getElementById('jsonError');

let currentPayload = buildPayloadFromInputs();
renderPayload();

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
