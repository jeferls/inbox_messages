const searchInput = document.getElementById('searchInput');
const statusTabs = document.getElementById('statusTabs');
const reloadBtn = document.getElementById('reloadBtn');
const subsBody = document.getElementById('subsBody');
const totalLabel = document.getElementById('totalLabel');
const pageInfo = document.getElementById('pageInfo');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const listError = document.getElementById('listError');

const STATUSES = [
  'created',
  'trialing',
  'paid',
  'unpaid',
  'ended',
  'canceled',
  'pending_payment',
  'processing',
];

// Cores do badge por status da assinatura e da cobrança.
const STATUS_TONE = {
  paid: 'st-ok',
  trialing: 'st-ok',
  created: 'st-neutral',
  processing: 'st-warn',
  pending_payment: 'st-warn',
  waiting_payment: 'st-warn',
  pending_refund: 'st-warn',
  unpaid: 'st-err',
  canceled: 'st-err',
  refused: 'st-err',
  chargedback: 'st-err',
  ended: 'st-neutral',
};


// O comando ignora assinaturas nesses status (mesma regra do RecurrenceBySubscriptionId).
const NO_RECURRENCE_STATUSES = ['canceled', 'ended', 'created'];

const DEFAULT_STATUS = 'paid';

const LIMIT = 50;
let currentStatus = DEFAULT_STATUS;
let page = 0;
let total = 0;
let searchTimer = null;
const openCharges = new Set();

for (const status of STATUSES) {
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.className = `tab${status === DEFAULT_STATUS ? ' active' : ''}`;
  tab.dataset.status = status;
  tab.setAttribute('role', 'tab');
  tab.innerHTML = `${status} <span class="tab-count" data-count="${status}">0</span>`;
  tab.addEventListener('click', () => {
    if (currentStatus === status) return;
    currentStatus = status;
    page = 0;
    statusTabs.querySelectorAll('.tab').forEach((el) => el.classList.toggle('active', el === tab));
    load();
  });
  statusTabs.appendChild(tab);
}

reloadBtn.addEventListener('click', () => load());
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { page = 0; load(); }, 400);
});
prevBtn.addEventListener('click', () => { if (page > 0) { page -= 1; load(); } });
nextBtn.addEventListener('click', () => {
  if ((page + 1) * LIMIT < total) { page += 1; load(); }
});

load();

async function load() {
  listError.hidden = true;
  subsBody.innerHTML = '<tr class="empty-row"><td colspan="6">Carregando...</td></tr>';

  const params = new URLSearchParams({ limit: String(LIMIT), page: String(page) });
  params.set('status', currentStatus);
  if (searchInput.value.trim()) params.set('search', searchInput.value.trim());

  try {
    const res = await fetch(`/api/subscriptions?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? res.status);

    total = data.total ?? 0;
    openCharges.clear();
    render(data.subscriptions ?? []);
    updateStatusCounts(data.counts ?? {});
  } catch (err) {
    subsBody.innerHTML = '<tr class="empty-row"><td colspan="6">Não foi possível carregar as assinaturas.</td></tr>';
    listError.textContent = `Falha ao carregar: ${err.message}`;
    listError.hidden = false;
  }
}

function updateStatusCounts(counts) {
  for (const el of statusTabs.querySelectorAll('.tab-count')) {
    el.textContent = counts[el.dataset.count] ?? 0;
  }
}

function render(subscriptions) {
  if (!subscriptions.length) {
    subsBody.innerHTML = '<tr class="empty-row"><td colspan="6">Nenhuma assinatura encontrada.</td></tr>';
  } else {
    subsBody.innerHTML = subscriptions.map(rowHtml).join('');
    subsBody.querySelectorAll('button[data-charges]').forEach((btn) => {
      btn.addEventListener('click', () => toggleCharges(btn.dataset.charges, btn));
    });
    subsBody.querySelectorAll('button[data-recurrence]').forEach((btn) => {
      btn.addEventListener('click', () => runRecurrence(btn.dataset.recurrence, btn));
    });
  }

  totalLabel.textContent = `${total} assinatura${total === 1 ? '' : 's'}`;
  const pages = Math.max(Math.ceil(total / LIMIT), 1);
  pageInfo.textContent = `${page + 1}/${pages}`;
  prevBtn.disabled = page === 0;
  nextBtn.disabled = (page + 1) * LIMIT >= total;
}

// "9 de 12" quando o plano define um total de cobranças; só a contagem quando é ilimitado.
function chargesLabel(sub) {
  const done = sub.chargesCount ?? 0;
  return sub.planCharges ? `${done} de ${sub.planCharges}` : String(done);
}

function periodHtml(sub) {
  return sub.currentPeriodStart || sub.currentPeriodEnd
    ? `${formatDate(sub.currentPeriodStart)}<div class="sub">até ${formatDate(sub.currentPeriodEnd)}</div>`
    : '-';
}

function rowHtml(sub) {
  const period = periodHtml(sub);
  const payment = `${escapeHtml(sub.paymentMethod ?? '-')}<div class="sub">${escapeHtml(sub.gateway ?? '-')}</div>`;

  return `
    <tr data-sub-id="${escapeHtml(sub.id)}">
      <td class="mono">${escapeHtml(sub.id)}<div class="sub">${escapeHtml(sub.type ?? '')} • ${formatDate(sub.createdAt)}</div></td>
      <td class="col-status">${badge(sub.status)}</td>
      <td>${payment}</td>
      <td class="col-period">${period}</td>
      <td class="col-charges">${chargesLabel(sub)}</td>
      <td>
        <div class="row-actions">
          <button type="button" data-charges="${escapeHtml(sub.id)}">Cobranças</button>
          <button type="button" class="btn-recurrence" data-recurrence="${escapeHtml(sub.id)}"${recurrenceDisabled(sub)}>Recorrência</button>
        </div>
      </td>
    </tr>
  `;
}

function recurrenceDisabled(sub) {
  if (!NO_RECURRENCE_STATUSES.includes(sub.status)) return '';
  return ` disabled title="O comando ignora assinaturas com status ${sub.status}"`;
}

// Executa `command:RecurrenceBySubscriptionId --id=<id>` no container de assinaturas.
async function runRecurrence(subscriptionId, btn) {
  const row = btn.closest('tr');
  const previousCharges = row.querySelector('.col-charges')?.textContent ?? '0';

  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Executando...';
  listError.hidden = true;

  try {
    const res = await fetch(`/api/subscriptions/${encodeURIComponent(subscriptionId)}/recurrence`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? res.status);
    if (!data.ok) throw new Error(`comando terminou com exit ${data.exitCode}`);

    // O comando só publica na fila: a cobrança e o novo status aparecem alguns instantes depois.
    refreshRow(subscriptionId, parseInt(previousCharges, 10) || 0);
  } catch (err) {
    listError.textContent = `Falha ao rodar a recorrência de ${subscriptionId}: ${err.message}`;
    listError.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

async function refreshRow(subscriptionId, previousCharges, attempts = 8, delayMs = 1000) {
  for (let i = 0; i < attempts; i += 1) {
    await sleep(delayMs);

    const row = subsBody.querySelector(`tr[data-sub-id="${cssEscape(subscriptionId)}"]`);
    if (!row) return;

    let sub;
    try {
      const params = new URLSearchParams({ search: subscriptionId, limit: '1' });
      const res = await fetch(`/api/subscriptions?${params}`);
      if (!res.ok) continue;
      const data = await res.json();
      sub = (data.subscriptions ?? []).find((item) => item.id === subscriptionId);
    } catch {
      continue;
    }
    if (!sub) continue;

    row.querySelector('.col-status').innerHTML = badge(sub.status);
    row.querySelector('.col-charges').textContent = chargesLabel(sub);
    row.querySelector('.col-period').innerHTML = periodHtml(sub);

    // A lista aberta é recarregada a cada tentativa, não só quando a contagem muda: o status
    // da cobrança ainda pode mudar depois de ela aparecer.
    if (openCharges.has(subscriptionId)) await loadCharges(subscriptionId);

    if ((sub.chargesCount ?? 0) > previousCharges) return;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function toggleCharges(subscriptionId, btn) {
  const row = btn.closest('tr');

  if (openCharges.has(subscriptionId)) {
    openCharges.delete(subscriptionId);
    chargesRowOf(subscriptionId)?.remove();
    return;
  }

  openCharges.add(subscriptionId);
  const chargesRow = document.createElement('tr');
  chargesRow.className = 'charges-row';
  chargesRow.dataset.chargesOf = subscriptionId;
  chargesRow.innerHTML = '<td colspan="6"><div class="charges-inner">Carregando cobranças...</div></td>';
  row.after(chargesRow);

  await loadCharges(subscriptionId);
}

function chargesRowOf(subscriptionId) {
  return subsBody.querySelector(`tr.charges-row[data-charges-of="${cssEscape(subscriptionId)}"]`);
}

// Recarrega o conteúdo da lista de cobranças já aberta, sem fechar o colapse.
async function loadCharges(subscriptionId) {
  const inner = chargesRowOf(subscriptionId)?.querySelector('.charges-inner');
  if (!inner) return;

  try {
    const res = await fetch(`/api/subscriptions/${encodeURIComponent(subscriptionId)}/charges`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? res.status);
    inner.innerHTML = chargesHtml(data.charges ?? []);
  } catch (err) {
    inner.textContent = `Falha ao carregar cobranças: ${err.message}`;
  }
}

function chargesHtml(charges) {
  if (!charges.length) return 'Nenhuma cobrança registrada.';

  const rows = charges.map((charge) => `
    <tr>
      <td class="mono">${escapeHtml(charge.id)}</td>
      <td>${badge(charge.paymentStatus)}</td>
      <td>${charge.amount != null ? formatMoney(charge.amount) : '-'}</td>
      <td>${escapeHtml(charge.paymentMethod ?? '-')} / ${escapeHtml(charge.gateway ?? '-')}</td>
      <td class="mono">${escapeHtml(charge.transactionId ?? '-')}</td>
      <td>${formatDate(charge.expectedDate)}</td>
      <td>${formatDate(charge.paidAt)}</td>
    </tr>
  `).join('');

  return `
    <table class="charges-table">
      <thead>
        <tr>
          <th>Cobrança</th><th>Status</th><th>Valor</th><th>Pagamento</th>
          <th>Transaction ID</th><th>Prevista</th><th>Paga em</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function badge(status) {
  if (!status) return '-';
  const tone = STATUS_TONE[status] ?? 'st-neutral';
  return `<span class="badge ${tone}">${escapeHtml(status)}</span>`;
}

function formatMoney(value, currency) {
  const code = currency && currency.length === 3 ? currency : 'BRL';
  try {
    return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: code });
  } catch {
    return `${code} ${Number(value).toFixed(2)}`;
  }
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('pt-BR');
}

function cssEscape(value) {
  return window.CSS?.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value);
  return div.innerHTML;
}
