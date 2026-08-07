const API = '/api/gateway-mocks/worldpay';

const GROUP_LABELS = {
  iso8583: 'Recusas do emissor (ISO8583)',
  last_event: 'Status da transação (lastEvent)',
  gateway_error: 'Erros do gateway',
  http_error: 'Falhas de transporte',
  timeout: 'Falhas de transporte',
};

const GROUP_ORDER = ['last_event', 'iso8583', 'gateway_error', 'http_error'];

let scenarios = [];
let activeSlug = null;

// ─── Tabs ─────────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');

    if (tab.dataset.tab === 'transactions') loadTransactions();
  });
});

// ─── Catálogo ─────────────────────────────────────────────────────────────────

async function loadScenarios() {
  const res = await fetch(`${API}/scenarios`);
  if (!res.ok) return setStatus('scenarios', 'Falha ao carregar o catálogo', true);

  const data = await res.json();
  scenarios = data.scenarios ?? [];
  activeSlug = data.active ?? null;

  renderActive();
  renderScenarios();
}

function renderActive() {
  const active = scenarios.find((s) => s.slug === activeSlug);
  document.getElementById('active-name').textContent = active?.name ?? '—';
  document.getElementById('active-slug').textContent = active?.slug ?? '';
}

function expectedText(expected) {
  const status = expected?.status;

  if (!status) {
    return `<span class="status-text status-other">sem resposta</span> ${escapeHtml(expected?.note ?? '')}`;
  }

  const cls = status === 'paid' ? 'status-paid' : status === 'refused' ? 'status-refused' : 'status-other';
  const reason = expected?.refuseReason ? ` · ${escapeHtml(expected.refuseReason)}` : '';

  return `<span class="status-text ${cls}">${escapeHtml(status)}</span>${reason}`;
}

function renderScenarios() {
  const grouped = new Map();

  for (const scenario of scenarios) {
    const groupKey = scenario.type === 'timeout' ? 'http_error' : scenario.type;
    if (!grouped.has(groupKey)) grouped.set(groupKey, []);
    grouped.get(groupKey).push(scenario);
  }

  const keys = [...GROUP_ORDER.filter((k) => grouped.has(k)), ...[...grouped.keys()].filter((k) => !GROUP_ORDER.includes(k))];

  document.getElementById('scenarios-list').innerHTML = keys.map((key) => `
    <div class="group-title">${escapeHtml(GROUP_LABELS[key] ?? key)}</div>
    <table class="scenario-table">
      <tbody>${grouped.get(key).map(renderRow).join('')}</tbody>
    </table>
  `).join('');

  document.querySelectorAll('[data-activate]').forEach((btn) => {
    btn.addEventListener('click', () => activateScenario(btn.dataset.activate));
  });
}

function renderRow(scenario) {
  const isActive = scenario.slug === activeSlug;
  const code = scenario.code ?? scenario.lastEvent ?? '';

  return `
    <tr class="${isActive ? 'is-active' : ''}">
      <td class="col-name">${escapeHtml(scenario.name)}</td>
      <td class="col-code">${escapeHtml(code)}</td>
      <td class="col-expected">${expectedText(scenario.expected)}</td>
      <td class="col-action">
        ${isActive
          ? '<span class="active-mark">ativo</span>'
          : `<button data-activate="${escapeAttr(scenario.slug)}">Ativar</button>`}
      </td>
    </tr>
  `;
}

async function activateScenario(slug) {
  setStatus('scenarios', 'Ativando...');
  const res = await fetch(`${API}/active`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario: slug }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return setStatus('scenarios', err.error ?? 'Falha ao ativar', true);
  }

  const data = await res.json();
  activeSlug = data.active;
  renderActive();
  renderScenarios();
  setStatus('scenarios', `Cenário ativo: ${data.scenario?.name ?? data.active}`);
}

// ─── Histórico ────────────────────────────────────────────────────────────────

const TXN_LIMIT = 10;
let txnPage = 0;
let txnTotal = 0;
let txnItems = [];

document.getElementById('refresh-transactions')?.addEventListener('click', loadTransactions);
document.getElementById('clear-transactions')?.addEventListener('click', clearTransactions);
document.getElementById('prev-transactions')?.addEventListener('click', () => {
  if (txnPage > 0) { txnPage--; loadTransactions(); }
});
document.getElementById('next-transactions')?.addEventListener('click', () => {
  if ((txnPage + 1) * TXN_LIMIT < txnTotal) { txnPage++; loadTransactions(); }
});

async function loadTransactions() {
  const offset = txnPage * TXN_LIMIT;
  const res = await fetch(`${API}/transactions?limit=${TXN_LIMIT}&offset=${offset}`);
  if (!res.ok) return setStatus('transactions', 'Falha ao carregar', true);

  const { items, total } = await res.json();
  txnItems = items;
  txnTotal = total;

  document.getElementById('txn-total').textContent = `${total} chamada(s)`;
  const totalPages = Math.max(1, Math.ceil(total / TXN_LIMIT));
  document.getElementById('page-info-transactions').textContent = `${txnPage + 1}/${totalPages}`;

  const list = document.getElementById('transactions-list');
  if (items.length === 0) {
    list.innerHTML = '<div class="empty">Nenhuma chamada recebida ainda. Faça uma cobrança na gateway com o <code>WORLDPAY_API_URL</code> apontando para cá.</div>';
    return;
  }

  list.innerHTML = items.map((txn) => `
    <div class="txn-item" data-txn-id="${txn.id}">
      <div class="txn-item-header">
        <span>#${txn.id} — ${escapeHtml(txn.scenario)} <span class="scenario-code">${escapeHtml(txn.scenarioSource)}</span></span>
        <span class="txn-count-badge">HTTP ${txn.responseStatus}</span>
      </div>
      <div class="txn-meta">
        ${escapeHtml(txn.reference ?? '-')} · ${escapeHtml(txn.amount ?? '-')} ${escapeHtml(txn.currency ?? '')}
        · ${escapeHtml(txn.installments ?? '-')}x · ${txn.durationMs ?? '-'}ms · ${formatDate(txn.createdAt)}
      </div>
      <div class="txn-meta" style="margin-top:4px">Clique para ver request e response</div>
    </div>
  `).join('');

  list.querySelectorAll('.txn-item').forEach((el) => {
    el.addEventListener('click', () => openTxnModal(Number(el.dataset.txnId)));
  });
}

async function clearTransactions() {
  if (!confirm('Limpar todo o histórico de chamadas?')) return;
  const res = await fetch(`${API}/transactions`, { method: 'DELETE' });
  if (res.ok) {
    txnPage = 0;
    loadTransactions();
  }
}

// ─── Modal ────────────────────────────────────────────────────────────────────

const txnModal = document.getElementById('txn-modal');
const txnModalBody = document.getElementById('txn-modal-body');
const txnModalTitle = document.getElementById('txn-modal-title');
let currentTxn = null;

document.getElementById('txn-modal-close')?.addEventListener('click', closeTxnModal);
txnModal?.addEventListener('click', (e) => { if (e.target === txnModal) closeTxnModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTxnModal(); });

document.querySelectorAll('.modal-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.modal-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    renderModalView(tab.dataset.view);
  });
});

function openTxnModal(id) {
  currentTxn = txnItems.find((t) => t.id === id);
  if (!currentTxn) return;

  txnModalTitle.textContent = `#${currentTxn.id} — ${currentTxn.scenario} — HTTP ${currentTxn.responseStatus}`;
  document.querySelectorAll('.modal-tab').forEach((t, i) => t.classList.toggle('active', i === 0));
  renderModalView('request');
  txnModal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function renderModalView(view) {
  if (!currentTxn) return;

  if (view === 'headers') {
    txnModalBody.innerHTML = escapeHtml(JSON.stringify(currentTxn.requestHeaders ?? {}, null, 2));
    return;
  }

  const xml = view === 'response' ? currentTxn.responseBody : currentTxn.requestBody;
  txnModalBody.innerHTML = highlightXml(xml ?? '');
}

function closeTxnModal() {
  txnModal.classList.remove('open');
  document.body.style.overflow = '';
}

function highlightXml(xml) {
  return escapeHtml(xml)
    .replace(/(&lt;\/?)([\w:.-]+)/g, '$1<span class="xml-tag">$2</span>')
    .replace(/([\w:.-]+)=(&quot;[^&]*&quot;)/g, '<span class="xml-attr">$1</span>=<span class="xml-val">$2</span>');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setStatus(key, msg, isError = false) {
  const el = document.getElementById(`status-${key}`);
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? '#b91c1c' : '#6b7280';
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return iso;
  }
}

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}

// ─── Init ─────────────────────────────────────────────────────────────────────

loadScenarios();
