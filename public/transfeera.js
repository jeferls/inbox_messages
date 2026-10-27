const withdrawIdInput = document.getElementById('withdrawId');
const statusSelect = document.getElementById('statusSelect');
const statusCustom = document.getElementById('statusCustom');
const accountIdInput = document.getElementById('accountId');
const secretInput = document.getElementById('secretInput');
const secretHint = document.getElementById('secretHint');
const lookupBtn = document.getElementById('lookupBtn');
const sendBtn = document.getElementById('sendBtn');
const withdrawBox = document.getElementById('withdrawBox');
const resultBox = document.getElementById('result');
const historyBody = document.getElementById('historyBody');

const CUSTOM = '__custom__';
const MODE_LABELS = { valid: 'válida', invalid: 'inválida', missing: 'sem header', stale: 'timestamp antigo', malformed: 'malformado' };

// Histórico só em memória: some ao recarregar a página.
const history = [];

loadConfig();

statusSelect.addEventListener('change', () => {
  statusCustom.hidden = statusSelect.value !== CUSTOM;
});

lookupBtn.addEventListener('click', async () => {
  const id = withdrawIdInput.value.trim();
  if (!id) return showWithdrawError('Informe o withdraw id.');

  setBusy(true);
  try {
    renderWithdraw(await requestJson(`/api/transfeera/withdrawals/${encodeURIComponent(id)}`));
  } catch (error) {
    showWithdrawError(error.message);
  } finally {
    setBusy(false);
  }
});

sendBtn.addEventListener('click', async () => {
  const withdrawId = withdrawIdInput.value.trim();
  const status = statusSelect.value === CUSTOM ? statusCustom.value.trim() : statusSelect.value;
  const mode = document.querySelector('input[name="mode"]:checked').value;

  if (!withdrawId) return showResult(false, '<strong>Informe o withdraw id.</strong>');
  if (!status) return showResult(false, '<strong>Informe o status.</strong>');

  setBusy(true);
  try {
    const data = await requestJson('/api/transfeera/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        withdrawId,
        status,
        mode,
        accountId: accountIdInput.value.trim(),
        secret: secretInput.value,
      }),
    });

    renderWithdraw(data.withdrawAfter);
    renderResult(data);
    addHistory({ at: new Date(), withdrawId, status, data });
  } catch (error) {
    showResult(false, `<strong>${escapeHtml(error.message)}</strong>`);
  } finally {
    setBusy(false);
  }
});

async function loadConfig() {
  try {
    const config = await requestJson('/api/transfeera/config');
    statusSelect.innerHTML = [
      ...config.statuses.map((s) => `<option value="${s}">${s}</option>`),
      `<option value="${CUSTOM}">Outro (texto livre)</option>`,
    ].join('');
    accountIdInput.value = config.defaultAccountId;
    secretHint.textContent = config.envSecret
      ? `Env TRANSFEERA_WEBHOOK_SECRET: ${config.envSecret}`
      : 'Env TRANSFEERA_WEBHOOK_SECRET não definida: informe o segredo aqui.';
  } catch (error) {
    showResult(false, `<strong>Falha ao carregar a configuração: ${escapeHtml(error.message)}</strong>`);
  }
}

async function requestJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

function renderWithdraw(w) {
  withdrawBox.hidden = false;
  if (!w) {
    withdrawBox.innerHTML = '<span class="changed">Saque não encontrado.</span>';
    return;
  }
  withdrawBox.innerHTML = `
    <dl class="kv">
      <dt>id</dt><dd>${escapeHtml(w.id)}</dd>
      <dt>status</dt><dd>${escapeHtml(w.status)}</dd>
      <dt>amount</dt><dd>${escapeHtml(w.amount)}</dd>
      <dt>updated_at</dt><dd>${escapeHtml(formatDate(w.updated_at))}</dd>
    </dl>`;
}

function showWithdrawError(message) {
  withdrawBox.hidden = false;
  withdrawBox.innerHTML = `<span class="changed">${escapeHtml(message)}</span>`;
}

function renderResult(data) {
  const before = data.withdrawBefore?.status ?? '—';
  const after = data.withdrawAfter?.status ?? '—';
  const changed = before !== after;

  showResult(
    data.ok,
    `
    <div class="transition">HTTP ${data.status} • ${data.durationMs} ms • modo ${MODE_LABELS[data.mode] || data.mode}</div>
    <div class="transition ${changed ? 'changed' : ''}">Status do saque: ${escapeHtml(before)} → ${escapeHtml(after)}${changed ? ' (alterado)' : ' (sem alteração)'}</div>
    <div>Segredo: ${escapeHtml(data.secret.masked || '(vazio)')} (${data.secret.source}) • ${escapeHtml(data.url)}</div>
    <h3>Resposta</h3>
    <pre>${escapeHtml(typeof data.body === 'string' ? data.body : JSON.stringify(data.body, null, 2))}</pre>
    <h3>Headers enviados</h3>
    <pre>${escapeHtml(JSON.stringify(data.request.headers, null, 2))}</pre>
    <h3>Payload enviado (corpo exato)</h3>
    <pre>${escapeHtml(data.request.body)}</pre>`,
  );
}

function showResult(ok, html) {
  resultBox.hidden = false;
  resultBox.className = `result ${ok ? 'ok' : 'err'}`;
  resultBox.innerHTML = html;
}

function addHistory(entry) {
  history.unshift(entry);
  history.length = Math.min(history.length, 20);

  historyBody.innerHTML = history
    .map((h, i) => {
      const before = h.data.withdrawBefore?.status ?? '—';
      const after = h.data.withdrawAfter?.status ?? '—';
      return `<tr data-index="${i}">
        <td>${h.at.toLocaleTimeString('pt-BR')}</td>
        <td>${escapeHtml(h.withdrawId)}</td>
        <td>${escapeHtml(h.status)}</td>
        <td>${MODE_LABELS[h.data.mode] || escapeHtml(h.data.mode)}</td>
        <td>${h.data.status}</td>
        <td class="${before !== after ? 'changed' : ''}">${escapeHtml(before)} → ${escapeHtml(after)}</td>
        <td>${h.data.durationMs} ms</td>
      </tr>`;
    })
    .join('');
}

// Clicar numa linha do histórico reabre o resultado daquele disparo.
historyBody.addEventListener('click', (event) => {
  const row = event.target.closest('tr[data-index]');
  if (row) renderResult(history[Number(row.dataset.index)].data);
});

function setBusy(busy) {
  lookupBtn.disabled = busy;
  sendBtn.disabled = busy;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('pt-BR');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
