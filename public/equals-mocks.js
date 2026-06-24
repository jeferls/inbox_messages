const CONFIG_KEYS = ['adquirentes', 'bandeiras', 'formas-de-pagamento', 'meios-de-captura'];

// ─── Tabs ─────────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');

    if (tab.dataset.tab === 'transacoes') loadTransactions();
  });
});

// ─── Config panels ────────────────────────────────────────────────────────────

async function loadAllConfig() {
  const res = await fetch('/api/equals-mock/config');
  if (!res.ok) return;
  const all = await res.json();

  for (const key of CONFIG_KEYS) {
    const ta = document.getElementById(`json-${key}`);
    if (ta && all[key]) {
      ta.value = JSON.stringify(all[key].data, null, 2);
      setStatus(key, `Atualizado em ${formatDate(all[key].updatedAt)}`);
    }
  }
}

function setStatus(key, msg, isError = false) {
  const el = document.getElementById(`status-${key}`);
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? '#b91c1c' : '#6b7280';
}

CONFIG_KEYS.forEach((key) => {
  document.getElementById(`save-${key}`)?.addEventListener('click', () => saveConfig(key));
  document.getElementById(`reset-${key}`)?.addEventListener('click', () => resetConfig(key));
});

async function saveConfig(key) {
  const ta = document.getElementById(`json-${key}`);
  let data;
  try {
    data = JSON.parse(ta.value);
  } catch {
    setStatus(key, 'JSON inválido', true);
    return;
  }
  if (!Array.isArray(data)) {
    setStatus(key, 'Deve ser um array JSON', true);
    return;
  }
  setStatus(key, 'Salvando...');
  const res = await fetch(`/api/equals-mock/config/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  if (res.ok) {
    const saved = await res.json();
    ta.value = JSON.stringify(saved.data, null, 2);
    setStatus(key, `Salvo em ${formatDate(new Date().toISOString())}`);
  } else {
    const err = await res.json().catch(() => ({}));
    setStatus(key, `Erro: ${err.error ?? res.status}`, true);
  }
}

async function resetConfig(key) {
  if (!confirm(`Restaurar "${key}" para o padrão?`)) return;
  setStatus(key, 'Restaurando...');
  const res = await fetch(`/api/equals-mock/config/${encodeURIComponent(key)}/reset`, { method: 'POST' });
  if (res.ok) {
    const saved = await res.json();
    const ta = document.getElementById(`json-${key}`);
    ta.value = JSON.stringify(saved.data, null, 2);
    setStatus(key, `Restaurado em ${formatDate(new Date().toISOString())}`);
  } else {
    setStatus(key, 'Erro ao restaurar', true);
  }
}

// ─── Transactions panel ───────────────────────────────────────────────────────

let txnPage = 0;
const TXN_LIMIT = 10;
let txnTotal = 0;

document.getElementById('refresh-transacoes')?.addEventListener('click', loadTransactions);
document.getElementById('clear-transacoes')?.addEventListener('click', clearTransactions);
document.getElementById('prev-transacoes')?.addEventListener('click', () => {
  if (txnPage > 0) { txnPage--; loadTransactions(); }
});
document.getElementById('next-transacoes')?.addEventListener('click', () => {
  if ((txnPage + 1) * TXN_LIMIT < txnTotal) { txnPage++; loadTransactions(); }
});

async function loadTransactions() {
  const offset = txnPage * TXN_LIMIT;
  const res = await fetch(`/api/equals-mock/transactions?limit=${TXN_LIMIT}&offset=${offset}`);
  if (!res.ok) return;
  const { items, total } = await res.json();
  txnTotal = total;

  document.getElementById('txn-total').textContent = `${total} transações`;

  const totalPages = Math.max(1, Math.ceil(total / TXN_LIMIT));
  document.getElementById('page-info-transacoes').textContent = `${txnPage + 1}/${totalPages}`;

  const list = document.getElementById('transacoes-list');
  if (items.length === 0) {
    list.innerHTML = '<div class="empty">Nenhuma transação recebida ainda. Execute o comando <code>equals:report-sales</code> no greenn-back.</div>';
    return;
  }

  list.innerHTML = items.map((txn) => `
    <div class="txn-item" data-txn-id="${txn.id}" data-txn-date="${txn.createdAt}" data-txn-payload='${escapeAttr(JSON.stringify(txn.payload))}'>
      <div class="txn-item-header">
        <span>#${txn.id} — ${formatDate(txn.createdAt)}</span>
        <span class="txn-count-badge">${Array.isArray(txn.payload) ? txn.payload.length : 1} venda(s)</span>
      </div>
      <div style="font-size:12px;color:#9ca3af;margin-top:4px">Clique para visualizar o JSON completo</div>
    </div>
  `).join('');

  list.querySelectorAll('.txn-item').forEach((el) => {
    el.addEventListener('click', () => openTxnModal(el.dataset));
  });
}

async function clearTransactions() {
  if (!confirm('Limpar todas as transações recebidas?')) return;
  const res = await fetch('/api/equals-mock/transactions', { method: 'DELETE' });
  if (res.ok) {
    txnPage = 0;
    loadTransactions();
  }
}

// ─── Transaction Modal ────────────────────────────────────────────────────────

const txnModal = document.getElementById('txn-modal');
const txnModalBody = document.getElementById('txn-modal-body');
const txnModalTitle = document.getElementById('txn-modal-title');

document.getElementById('txn-modal-close')?.addEventListener('click', closeTxnModal);
txnModal?.addEventListener('click', (e) => { if (e.target === txnModal) closeTxnModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTxnModal(); });

function openTxnModal({ txnId, txnDate, txnPayload }) {
  let parsed;
  try { parsed = JSON.parse(txnPayload); } catch { parsed = txnPayload; }
  const count = Array.isArray(parsed) ? parsed.length : 1;
  txnModalTitle.textContent = `Lote #${txnId} — ${formatDate(txnDate)} — ${count} venda(s)`;
  txnModalBody.innerHTML = syntaxHighlightJson(JSON.stringify(parsed, null, 2));
  txnModal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeTxnModal() {
  txnModal.classList.remove('open');
  document.body.style.overflow = '';
}

function syntaxHighlightJson(json) {
  const escaped = json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped.replace(
    /("(?:[^"\\]|\\.)*")(\s*:)|("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b)|(\bnull\b)|([{}\[\],:])/g,
    (match, key, colon, str, num, bool, nil, punct) => {
      if (key && colon) return `<span class="json-key">${key}</span><span class="json-punct">${colon}</span>`;
      if (str)   return `<span class="json-str">${str}</span>`;
      if (num)   return `<span class="json-num">${num}</span>`;
      if (bool)  return `<span class="json-bool">${bool}</span>`;
      if (nil)   return `<span class="json-null">${nil}</span>`;
      if (punct) return `<span class="json-punct">${punct}</span>`;
      return match;
    }
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return iso;
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}

// ─── Init ─────────────────────────────────────────────────────────────────────

loadAllConfig();
