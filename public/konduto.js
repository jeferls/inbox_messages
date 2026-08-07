const flagToggle = document.getElementById('flagToggle');
const flagStatus = document.getElementById('flagStatus');
const flagDot = document.getElementById('flagDot');
const flagMeta = document.getElementById('flagMeta');
const flagError = document.getElementById('flagError');

const confirmModal = document.getElementById('confirmModal');
const confirmTitle = document.getElementById('confirmTitle');
const confirmMessage = document.getElementById('confirmMessage');
const confirmOkBtn = document.getElementById('confirmOkBtn');
const confirmCancelBtn = document.getElementById('confirmCancelBtn');

const tabs = [...document.querySelectorAll('.tab')];
const tabCounts = document.querySelectorAll('.tab-count');
const searchInput = document.getElementById('searchInput');
const reloadBtn = document.getElementById('reloadBtn');
const analysesBody = document.getElementById('analysesBody');
const actionsHeader = document.getElementById('actionsHeader');
const totalLabel = document.getElementById('totalLabel');
const pageInfo = document.getElementById('pageInfo');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const webhookResult = document.getElementById('webhookResult');

const PAGE_SIZE = 25;

let currentEnabled = false;
let currentGroup = 'pending';
let page = 0;
let totalPages = 1;
let searchTimer = null;

loadFlag();
loadAnalyses();

flagToggle.addEventListener('change', async () => {
  const desired = flagToggle.checked;

  // O switch só muda de verdade depois do PUT: volta ao estado real enquanto confirma.
  flagToggle.checked = currentEnabled;

  const confirmed = await askConfirmation({
    title: desired ? 'Ativar KONDUTO_ENABLED?' : 'Desativar KONDUTO_ENABLED?',
    message: desired
      ? 'A global flag <strong>KONDUTO_ENABLED</strong> será criada e a análise antifraude passará a valer para <strong>todos os usuários</strong> deste ambiente.'
      : 'A global flag <strong>KONDUTO_ENABLED</strong> será removida. A análise antifraude só continuará ativa para os sellers que tiverem a flag individual.',
    okLabel: desired ? 'Ativar' : 'Desativar',
    danger: !desired,
  });

  if (!confirmed) return;

  await saveFlag(desired);
});

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    if (tab.dataset.group === currentGroup) return;

    currentGroup = tab.dataset.group;
    tabs.forEach((other) => other.classList.toggle('active', other === tab));
    page = 0;
    loadAnalyses();
  });
});

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page = 0;
    loadAnalyses();
  }, 300);
});

reloadBtn.addEventListener('click', () => loadAnalyses());

prevBtn.addEventListener('click', () => {
  if (page === 0) return;
  page -= 1;
  loadAnalyses();
});

nextBtn.addEventListener('click', () => {
  if (page + 1 >= totalPages) return;
  page += 1;
  loadAnalyses();
});

async function loadFlag() {
  setBusy(true);

  try {
    const res = await fetch('/api/konduto/flag');
    const data = await res.json();

    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

    applyState(data);
    hideError();
  } catch (error) {
    showError(`Não foi possível ler a flag: ${error.message}`);
    flagStatus.textContent = 'Indisponível';
    flagStatus.className = 'flag-status off';
    flagDot.className = 'flag-dot off';
    flagDot.title = 'Estado da flag indisponível';
  } finally {
    setBusy(false);
  }
}

async function saveFlag(enabled) {
  setBusy(true);

  try {
    const res = await fetch('/api/konduto/flag', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

    applyState(data);
    hideError();
  } catch (error) {
    showError(`Não foi possível atualizar a flag: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

function applyState(data) {
  currentEnabled = Boolean(data.enabled);
  flagToggle.checked = currentEnabled;
  flagStatus.textContent = currentEnabled ? 'Ativada' : 'Desativada';
  flagStatus.className = `flag-status ${currentEnabled ? 'on' : 'off'}`;
  // O ponto no cabeçalho é o único sinal da flag quando o bloco está fechado.
  flagDot.className = `flag-dot ${currentEnabled ? 'on' : 'off'}`;
  flagDot.title = `KONDUTO_ENABLED ${currentEnabled ? 'ativada' : 'desativada'}`;

  if (!currentEnabled) {
    flagMeta.textContent = 'Nenhuma linha em global_flags para esta flag.';
    return;
  }

  const row = data.rows?.[0];
  const duplicates = (data.rows?.length ?? 0) > 1 ? ` • ${data.rows.length} linhas duplicadas` : '';
  flagMeta.textContent = row ? `Linha #${row.id} • criada em ${formatDate(row.createdAt)}${duplicates}` : '';
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('pt-BR');
}

function setBusy(busy) {
  flagToggle.disabled = busy;
}

function showError(message) {
  flagError.textContent = message;
  flagError.hidden = false;
}

function hideError() {
  flagError.hidden = true;
  flagError.textContent = '';
}

/** Modal de confirmação — resolve true/false conforme o botão clicado. */
function askConfirmation({ title, message, okLabel, danger = false }) {
  confirmTitle.textContent = title;
  confirmMessage.innerHTML = message;
  confirmOkBtn.className = danger ? 'danger' : '';
  confirmOkBtn.textContent = okLabel;
  confirmModal.hidden = false;

  return new Promise((resolve) => {
    const finish = (result) => {
      confirmModal.hidden = true;
      confirmOkBtn.removeEventListener('click', onOk);
      confirmCancelBtn.removeEventListener('click', onCancel);
      confirmModal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKeydown);
      resolve(result);
    };

    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    const onBackdrop = (event) => {
      if (event.target === confirmModal) finish(false);
    };
    const onKeydown = (event) => {
      if (event.key === 'Escape') finish(false);
    };

    confirmOkBtn.addEventListener('click', onOk);
    confirmCancelBtn.addEventListener('click', onCancel);
    confirmModal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKeydown);
    confirmOkBtn.focus();
  });
}

async function loadAnalyses() {
  const params = new URLSearchParams({ group: currentGroup, limit: String(PAGE_SIZE), page: String(page) });
  const search = searchInput.value.trim();

  if (search) params.set('search', search);

  actionsHeader.hidden = currentGroup !== 'pending';
  renderMessageRow('Carregando...');

  try {
    const res = await fetch(`/api/konduto/analyses?${params}`);
    const data = await res.json();

    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

    totalPages = Math.max(1, Math.ceil(data.total / data.limit));
    page = data.page;
    updateTabCounts(data.counts);
    totalLabel.textContent = `${data.total} ${data.total === 1 ? 'análise' : 'análises'}`;
    pageInfo.textContent = `${page + 1}/${totalPages}`;
    prevBtn.disabled = page === 0;
    nextBtn.disabled = page + 1 >= totalPages;

    renderAnalyses(data.analyses);
  } catch (error) {
    renderMessageRow(`Falha ao carregar: ${error.message}`);
  }
}

function updateTabCounts(counts = {}) {
  tabCounts.forEach((element) => {
    element.textContent = String(counts[element.dataset.count] ?? 0);
  });
}

function renderMessageRow(message) {
  analysesBody.replaceChildren(createMessageRow(message));
}

function createMessageRow(message) {
  const tr = document.createElement('tr');
  tr.className = 'empty-row';
  const td = document.createElement('td');
  td.colSpan = currentGroup === 'pending' ? 5 : 4;
  td.textContent = message;
  tr.append(td);
  return tr;
}

function renderAnalyses(analyses) {
  if (!analyses.length) {
    renderMessageRow('Nenhuma análise encontrada.');
    return;
  }

  analysesBody.replaceChildren(...analyses.map(buildAnalysisRow));
}

function buildAnalysisRow(analysis) {
  const tr = document.createElement('tr');

  tr.append(
    cell(String(analysis.saleId)),
    cell(analysis.orderId, 'mono'),
    badgeCell(analysis.status),
    cell(analysis.recommendation || '-'),
  );

  // Aprovar/reprovar só faz sentido em quem ainda não foi decidido.
  if (currentGroup === 'pending') tr.append(actionsCell(analysis));

  return tr;
}

function cell(text, className) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function badgeCell(status) {
  const td = document.createElement('td');
  const span = document.createElement('span');
  span.className = `badge ${badgeClass(status)}`;
  span.textContent = status;
  td.append(span);
  return td;
}

function badgeClass(status) {
  const value = String(status).toUpperCase();

  if (['APPROVED', 'PAID'].includes(value)) return 'st-approved';
  if (['PENDING', 'REVIEW', 'PROCESSING', 'WAITING_PAYMENT'].includes(value)) return 'st-pending';
  if (['DECLINED', 'NOT_AUTHORIZED', 'CANCELED', 'FRAUD', 'REFUSED', 'CHARGEBACK'].includes(value)) return 'st-blocked';

  return 'st-neutral';
}

function actionsCell(analysis) {
  const td = document.createElement('td');
  const wrap = document.createElement('div');
  wrap.className = 'row-actions';

  const approveBtn = document.createElement('button');
  approveBtn.type = 'button';
  approveBtn.className = 'btn-approve';
  approveBtn.textContent = 'Aprovar';
  approveBtn.addEventListener('click', () => triggerWebhook(analysis, 'APPROVED', wrap));

  const declineBtn = document.createElement('button');
  declineBtn.type = 'button';
  declineBtn.className = 'btn-decline';
  declineBtn.textContent = 'Reprovar';
  declineBtn.addEventListener('click', () => triggerWebhook(analysis, 'DECLINED', wrap));

  wrap.append(approveBtn, declineBtn);
  td.append(wrap);
  return td;
}

async function triggerWebhook(analysis, status, actionsWrap) {
  const approving = status === 'APPROVED';
  const noPendingWarning = analysis.pendingTransaction
    ? ''
    : '<br /><br />Esta análise <strong>não tem transação pendente</strong>: o backend deve responder 422 sem alterar nada.';

  const confirmed = await askConfirmation({
    title: approving ? 'Aprovar análise?' : 'Reprovar análise?',
    message:
      `Será disparado o webhook da Konduto com <strong>${status}</strong> para o pedido ` +
      `<strong>${escapeHtml(analysis.orderId)}</strong> (venda ${analysis.saleId}).` +
      noPendingWarning,
    okLabel: approving ? 'Aprovar' : 'Reprovar',
    danger: !approving,
  });

  if (!confirmed) return;

  const buttons = [...actionsWrap.querySelectorAll('button')];
  buttons.forEach((button) => (button.disabled = true));

  try {
    const res = await fetch('/api/konduto/analyses/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: analysis.orderId, status }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

    showWebhookResult(analysis, status, data);
    await loadAnalyses();
  } catch (error) {
    showWebhookResult(analysis, status, { ok: false, error: error.message });
  } finally {
    buttons.forEach((button) => (button.disabled = false));
  }
}

function showWebhookResult(analysis, status, result) {
  const ok = Boolean(result.ok);
  const head = ok
    ? `Webhook ${status} aceito para ${analysis.orderId} (HTTP ${result.status}, ${result.durationMs}ms)`
    : `Webhook ${status} recusado para ${analysis.orderId}${result.status ? ` (HTTP ${result.status})` : ''}`;

  webhookResult.className = `webhook-result ${ok ? 'ok' : 'err'}`;
  webhookResult.replaceChildren();

  const title = document.createElement('strong');
  title.textContent = head;

  const body = document.createElement('pre');
  body.textContent = JSON.stringify(result.body ?? result.error ?? result, null, 2);

  webhookResult.append(title, body);
  webhookResult.hidden = false;
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value);
  return div.innerHTML;
}
