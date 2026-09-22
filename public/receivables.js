const listEl = document.getElementById('receivablesList');
const detailEl = document.getElementById('receivableDetail');
const totalEl = document.getElementById('receivablesTotal');
const pageInfoEl = document.getElementById('receivablesPageInfo');
const refreshBtn = document.getElementById('refreshReceivablesBtn');
const searchKeyInput = document.getElementById('searchKeyInput');
const clearAllBtn = document.getElementById('clearAllReceivablesBtn');
const prevBtn = document.getElementById('prevReceivablesBtn');
const nextBtn = document.getElementById('nextReceivablesBtn');

const state = {
  page: 0,
  limit: 20,
  total: 0,
  key: '',
  selectedProcessKey: null,
};

async function fetchProcesses() {
  const params = new URLSearchParams();
  params.set('limit', String(state.limit));
  params.set('page', String(state.page));
  if (state.key) params.set('key', state.key);
  const res = await fetch(`/api/slc/v1/receivables?${params.toString()}`);
  if (!res.ok) throw new Error('Falha ao carregar processos');
  return res.json();
}

async function fetchProcess(processKey) {
  const res = await fetch(`/api/slc/v1/receivables/${encodeURIComponent(processKey)}`);
  if (!res.ok) throw new Error('Falha ao carregar processo');
  return res.json();
}

async function saveProcess(processKey, payload) {
  const res = await fetch(`/api/slc/v1/receivables/${encodeURIComponent(processKey)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await safeJson(res);
    throw new Error(body?.error || 'Falha ao salvar processo');
  }
  return res.json();
}

async function deleteProcess(processKey) {
  const res = await fetch(`/api/slc/v1/receivables/${encodeURIComponent(processKey)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const body = await safeJson(res);
    throw new Error(body?.error || 'Falha ao deletar processo');
  }
}

async function deleteAllProcesses() {
  const res = await fetch('/api/slc/v1/receivables', { method: 'DELETE' });
  if (!res.ok) {
    const body = await safeJson(res);
    throw new Error(body?.error || 'Falha ao limpar processos');
  }
  return res.json();
}

function renderList(items) {
  listEl.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Nenhum processo encontrado';
    listEl.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'lote-item';
    if (item.processKey === state.selectedProcessKey) row.classList.add('selected');
    row.innerHTML = `
      <div class="lote-main">${escapeHtml(item.processKey)}</div>
      <div class="lote-sub">Criado em: ${escapeHtml(fmtDate(item.createdAt))}</div>
    `;
    row.addEventListener('click', () => openProcess(item.processKey));
    listEl.appendChild(row);
  }
}

async function openProcess(processKey) {
  state.selectedProcessKey = processKey;
  detailEl.innerHTML = '<div class="empty">Carregando processo...</div>';
  try {
    const item = await fetchProcess(processKey);
    const requestJson = JSON.stringify(item.request || {}, null, 2);
    const responseJson = JSON.stringify(item.response || {}, null, 2);
    detailEl.innerHTML = `
      <div><strong>processKey:</strong> ${escapeHtml(item.processKey)}</div>
      <div class="status-line">Criado em: ${escapeHtml(fmtDate(item.createdAt))}</div>
      <label class="json-label" for="taReq">Request</label>
      <textarea id="taReq" class="json-edit" spellcheck="false"></textarea>
      <label class="json-label" for="taRes">Response</label>
      <textarea id="taRes" class="json-edit" spellcheck="false"></textarea>
      <div class="detail-actions">
        <button id="saveProcessBtn" type="button">Salvar alterações</button>
        <button id="deleteProcessBtn" class="danger" type="button">Deletar</button>
      </div>
    `;

    const taReq = document.getElementById('taReq');
    const taRes = document.getElementById('taRes');
    taReq.value = requestJson;
    taRes.value = responseJson;

    const saveBtn = document.getElementById('saveProcessBtn');
    const deleteBtn = document.getElementById('deleteProcessBtn');
    saveBtn.addEventListener('click', async () => {
      let requestObj;
      let responseObj;
      try {
        requestObj = JSON.parse(taReq.value);
      } catch {
        alert('JSON inválido em Request');
        return;
      }
      try {
        responseObj = JSON.parse(taRes.value);
      } catch {
        alert('JSON inválido em Response');
        return;
      }

      saveBtn.disabled = true;
      try {
        await saveProcess(processKey, { request: requestObj, response: responseObj });
        alert('Processo atualizado com sucesso');
        await openProcess(processKey);
      } catch (error) {
        alert(error.message || 'Falha ao salvar');
        saveBtn.disabled = false;
      }
    });

    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`Deseja deletar o processo ${processKey}?`)) return;
      deleteBtn.disabled = true;
      try {
        await deleteProcess(processKey);
        state.selectedProcessKey = null;
        detailEl.innerHTML = '<div class="empty">Processo deletado com sucesso</div>';
        await load();
      } catch (error) {
        alert(error.message || 'Falha ao deletar');
        deleteBtn.disabled = false;
      }
    });
  } catch (error) {
    detailEl.innerHTML = `<div class="empty">${escapeHtml(error.message || 'Erro ao carregar')}</div>`;
  }

  await load(false);
}

async function load(keepSelection = true) {
  try {
    const data = await fetchProcesses();
    state.total = data.total || 0;
    totalEl.textContent = `${state.total} processo${state.total === 1 ? '' : 's'}`;
    const totalPages = Math.max(1, Math.ceil(state.total / state.limit));
    const currentPage = Math.min(state.page + 1, totalPages);
    pageInfoEl.textContent = `${currentPage}/${totalPages}`;
    prevBtn.disabled = state.page <= 0;
    nextBtn.disabled = state.page + 1 >= totalPages;
    renderList(data.items || []);

    if (!keepSelection && state.selectedProcessKey) {
      const visible = (data.items || []).some((x) => x.processKey === state.selectedProcessKey);
      if (!visible) state.selectedProcessKey = null;
    }
  } catch (error) {
    listEl.innerHTML = `<div class="empty">${escapeHtml(error.message || 'Falha ao carregar')}</div>`;
  }
}

function fmtDate(s) {
  try {
    const d = new Date(`${s}Z`);
    return d.toLocaleString();
  } catch {
    return s || '-';
  }
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

refreshBtn.addEventListener('click', async () => {
  if (state.selectedProcessKey) {
    await openProcess(state.selectedProcessKey);
    return;
  }
  await load();
});
searchKeyInput.addEventListener('input', debounce(() => {
  state.page = 0;
  state.key = searchKeyInput.value.trim();
  load();
}, 250));
clearAllBtn.addEventListener('click', async () => {
  if (!confirm('Tem certeza que deseja apagar todos os processos?')) return;
  clearAllBtn.disabled = true;
  try {
    const result = await deleteAllProcesses();
    state.selectedProcessKey = null;
    detailEl.innerHTML = '<div class="empty">Todos os processos foram removidos</div>';
    await load();
    alert(result.deleted != null ? `Removidos ${result.deleted} processo(s).` : 'Processos removidos');
  } catch (error) {
    alert(error.message || 'Falha ao remover');
  } finally {
    clearAllBtn.disabled = false;
  }
});
prevBtn.addEventListener('click', () => {
  if (state.page > 0) {
    state.page -= 1;
    load();
  }
});
nextBtn.addEventListener('click', () => {
  state.page += 1;
  load();
});

load();

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

// --- Conciliação de liquidação (notificação da TAG) ---
const conciliationDocEl = document.getElementById('conciliationDocumentNumber');
const conciliationFileEl = document.getElementById('conciliationFile');
const conciliationAllEl = document.getElementById('conciliationAllFiles');
const sendConciliationBtn = document.getElementById('sendConciliationBtn');
const conciliationResultEl = document.getElementById('conciliationResult');

let conciliationFiles = [];

async function loadConciliationFiles() {
  try {
    const res = await fetch('/api/tag/conciliation/files');
    if (!res.ok) throw new Error('Falha ao carregar CSVs');
    const data = await res.json();
    conciliationFiles = data.files || [];
    conciliationDocEl.value = data.defaultDocumentNumber || '';
    conciliationFileEl.replaceChildren();
    for (const file of conciliationFiles) {
      const opt = document.createElement('option');
      opt.value = file.url;
      opt.textContent = file.name;
      conciliationFileEl.appendChild(opt);
    }
  } catch (error) {
    showConciliationResult({ ok: false, error: error.message });
  }
}

conciliationAllEl.addEventListener('change', () => {
  conciliationFileEl.disabled = conciliationAllEl.checked;
});

sendConciliationBtn.addEventListener('click', async () => {
  const documentNumber = conciliationDocEl.value.trim();
  const urls = conciliationAllEl.checked
    ? conciliationFiles.map((f) => f.url)
    : [conciliationFileEl.value].filter(Boolean);

  if (!documentNumber) {
    alert('Informe o documentNumber');
    return;
  }
  if (!urls.length) {
    alert('Nenhum CSV selecionado');
    return;
  }

  sendConciliationBtn.disabled = true;
  try {
    const res = await fetch('/api/tag/conciliation/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentNumber, urls }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    showConciliationResult(data);
  } catch (error) {
    showConciliationResult({ ok: false, error: error.message });
  } finally {
    sendConciliationBtn.disabled = false;
  }
});

function showConciliationResult(result) {
  const ok = Boolean(result.ok);
  const key = result.request?.conciliationKey;
  const head = ok
    ? `Notificação aceita (HTTP ${result.status}, ${result.durationMs}ms) — conciliationKey ${key}`
    : `Notificação recusada${result.status ? ` (HTTP ${result.status})` : ''}${key ? ` — conciliationKey ${key}` : ''}`;

  conciliationResultEl.className = `webhook-result ${ok ? 'ok' : 'err'}`;
  conciliationResultEl.replaceChildren();

  const title = document.createElement('strong');
  title.textContent = head;
  conciliationResultEl.appendChild(title);

  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(
    result.error ? { error: result.error } : { url: result.url, request: result.request, response: result.body },
    null,
    2,
  );
  conciliationResultEl.appendChild(pre);
  conciliationResultEl.hidden = false;
}

loadConciliationFiles();

const processUrDryRunEl = document.getElementById('processUrDryRun');
const processUrDateEl = document.getElementById('processUrDate');
const runProcessUrBtn = document.getElementById('runProcessUrBtn');
const processUrResultEl = document.getElementById('processUrResult');

processUrDryRunEl.addEventListener('change', () => {
  processUrDateEl.disabled = !processUrDryRunEl.checked;
  if (!processUrDryRunEl.checked) processUrDateEl.value = '';
});

runProcessUrBtn.addEventListener('click', async () => {
  const dryRun = processUrDryRunEl.checked;
  const date = processUrDateEl.value || null;

  if (!dryRun && !confirm('Sem --dry-run o comando publica na fila _tag_process_users. Continuar?')) return;

  runProcessUrBtn.disabled = true;
  try {
    const res = await fetch('/api/tag/receivable-units/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun, date }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    showProcessUrResult(data);
  } catch (error) {
    showProcessUrResult({ ok: false, error: error.message });
  } finally {
    runProcessUrBtn.disabled = false;
  }
});

const resetUrTablesBtn = document.getElementById('resetUrTablesBtn');

resetUrTablesBtn.addEventListener('click', async () => {
  const msg = 'Isso esvazia (TRUNCATE) as tabelas de UR, settlements e SLC ligadas a settlements no banco greenn local:\n\n'
    + 'receivable_unit, settlement_obligations, settlement_obligation_payments, settlements, sale_statement_units, '
    + 'reconciliation_receivables_units, tag_ur_alerts, slc_pos_settlement_groups, slc_anticipation_reports (+attempts), '
    + 'slc_centralizer_groups, slc_settlement_group_roots, slc_settlement_conciliations (+items).\n\nContinuar?';
  if (!confirm(msg)) return;

  resetUrTablesBtn.disabled = true;
  try {
    const res = await fetch('/api/tag/receivable-units/reset', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    const lines = Object.entries(data.cleared).map(([table, total]) => `${table}: ${total}`);
    showProcessUrResult({ ok: true, exitCode: 0, command: 'limpeza das tabelas de UR', stdout: lines.join('\n') });
    loadSaleStatementUnits();
  } catch (error) {
    showProcessUrResult({ ok: false, error: error.message });
  } finally {
    resetUrTablesBtn.disabled = false;
  }
});

function showProcessUrResult(result) {
  const ok = Boolean(result.ok);
  processUrResultEl.className = `webhook-result ${ok ? 'ok' : 'err'}`;
  processUrResultEl.replaceChildren();

  const title = document.createElement('strong');
  title.textContent = result.error
    ? `Falha: ${result.error}`
    : `${ok ? 'Comando concluído' : 'Comando falhou'} (exit ${result.exitCode}) — ${result.command}`;
  processUrResultEl.appendChild(title);

  const pre = document.createElement('pre');
  pre.textContent = result.error
    ? ''
    : [result.stdout, result.stderr ? `--- stderr ---\n${result.stderr}` : ''].filter(Boolean).join('\n');
  if (pre.textContent) processUrResultEl.appendChild(pre);
  processUrResultEl.hidden = false;
}

const ssuSelectEl = document.getElementById('ssuSelect');
const ssuRefreshBtn = document.getElementById('ssuRefreshBtn');
const ssuConfirmBtn = document.getElementById('ssuConfirmBtn');
const ssuResultEl = document.getElementById('ssuResult');

async function loadSaleStatementUnits() {
  try {
    const res = await fetch('/api/tag/sale-statement-units');
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    ssuSelectEl.replaceChildren();
    for (const unit of data.units || []) {
      const opt = document.createElement('option');
      opt.value = unit.id;
      opt.textContent = String(unit.sale_id ?? '-');
      opt.title = `unit ${unit.id} · account_statement ${unit.account_statement_id ?? '-'} · available_date ${unit.available_date ?? '-'}`;
      ssuSelectEl.appendChild(opt);
    }
  } catch (error) {
    showSsuResult({ ok: false, error: error.message });
  }
}

ssuRefreshBtn.addEventListener('click', loadSaleStatementUnits);

ssuConfirmBtn.addEventListener('click', async () => {
  const id = ssuSelectEl.value;
  if (!id) {
    alert('Selecione uma sale');
    return;
  }

  ssuConfirmBtn.disabled = true;
  try {
    const res = await fetch(`/api/tag/sale-statement-units/${encodeURIComponent(id)}/backdate`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    showSsuResult({ ...data, saleId: ssuSelectEl.selectedOptions[0]?.textContent });
    loadSaleStatementUnits();
  } catch (error) {
    showSsuResult({ ok: false, error: error.message });
  } finally {
    ssuConfirmBtn.disabled = false;
  }
});

function showSsuResult(result) {
  const ok = Boolean(result.ok);
  ssuResultEl.className = `webhook-result ${ok ? 'ok' : 'err'}`;
  ssuResultEl.textContent = ok
    ? `sale ${result.saleId}: available_date ajustada para ${result.availableDate}`
    : `Falha: ${result.error}`;
  ssuResultEl.hidden = false;
}

loadSaleStatementUnits();

const slcFlowToggle = document.getElementById('slcFlowToggle');
const slcFlowValue = document.getElementById('slcFlowValue');
const slcFlowAlert = document.getElementById('slcFlowAlert');

function renderSlcFlow(flow) {
  const on = flow.effective === 'TAG_SETTLEMENT';
  slcFlowToggle.checked = on;
  slcFlowToggle.disabled = false;
  slcFlowValue.textContent = flow.effective;
  slcFlowValue.className = `flow-value ${on ? 'on' : 'off'}`;

  if (!flow.exists) {
    slcFlowAlert.textContent = `sem global setting: o backend assume ${flow.default}`;
    slcFlowAlert.hidden = false;
  } else if (flow.value !== flow.effective) {
    slcFlowAlert.textContent = `valor "${flow.value}" não reconhecido: o backend assume ${flow.default}`;
    slcFlowAlert.hidden = false;
  } else {
    slcFlowAlert.hidden = true;
  }
}

async function loadSlcFlow() {
  try {
    const res = await fetch('/api/tag/settlement-flow');
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    renderSlcFlow(data);
  } catch (error) {
    slcFlowValue.textContent = 'indisponível';
    slcFlowAlert.textContent = `não foi possível ler a setting: ${error.message}`;
    slcFlowAlert.hidden = false;
  }
}

slcFlowToggle.addEventListener('change', async () => {
  const enabled = slcFlowToggle.checked;
  slcFlowToggle.disabled = true;
  try {
    const res = await fetch('/api/tag/settlement-flow', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    renderSlcFlow(data);
    if (!data.cacheCleared) {
      slcFlowAlert.textContent = `setting salva, mas o cache do backend não foi limpo (${data.cacheError}); pode levar até 30 min`;
      slcFlowAlert.hidden = false;
    }
  } catch (error) {
    slcFlowToggle.checked = !enabled;
    slcFlowToggle.disabled = false;
    slcFlowAlert.textContent = `falha ao atualizar: ${error.message}`;
    slcFlowAlert.hidden = false;
  }
});

loadSlcFlow();

// --- URs (receivable_unit) ---
const urSearchInput = document.getElementById('urSearchInput');
const urRefreshBtn = document.getElementById('urRefreshBtn');
const urTotalEl = document.getElementById('urTotal');
const urPrevBtn = document.getElementById('urPrevBtn');
const urNextBtn = document.getElementById('urNextBtn');
const urPageInfo = document.getElementById('urPageInfo');
const urTableBody = document.getElementById('urTableBody');
const urModal = document.getElementById('urModal');
const urModalTitle = document.getElementById('urModalTitle');
const urModalBody = document.getElementById('urModalBody');
const urModalCloseBtn = document.getElementById('urModalCloseBtn');

const UR_LIMIT = 20;
let urPage = 0;
let urTotal = 0;

const fmtMoney = (v) => (v == null ? '-' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 }));

async function loadReceivableUnits() {
  const params = new URLSearchParams({ limit: UR_LIMIT, page: urPage, search: urSearchInput.value.trim() });
  try {
    const res = await fetch(`/api/tag/receivable-units?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    urTotal = data.total;
    renderReceivableUnits(data.items);
  } catch (error) {
    urTableBody.replaceChildren();
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 13;
    td.textContent = `Falha ao listar: ${error.message}`;
    tr.appendChild(td);
    urTableBody.appendChild(tr);
  }
  const pages = Math.max(1, Math.ceil(urTotal / UR_LIMIT));
  urTotalEl.textContent = `${urTotal} URs`;
  urPageInfo.textContent = `${urPage + 1}/${pages}`;
  urPrevBtn.disabled = urPage === 0;
  urNextBtn.disabled = urPage + 1 >= pages;
}

function renderReceivableUnits(items) {
  urTableBody.replaceChildren();
  if (!items.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 13;
    td.textContent = 'Nenhuma UR encontrada';
    tr.appendChild(td);
    urTableBody.appendChild(tr);
    return;
  }
  for (const ur of items) {
    const tr = document.createElement('tr');
    const cells = [
      [ur.id], [`${ur.user_id}${ur.user_name ? ` · ${ur.user_name}` : ''}`], [ur.payment_arrangement ?? ur.payment_arrangement_code ?? '-'],
      [ur.dueDate?.slice(0, 10) ?? '-'], [fmtMoney(ur.amount), 'num'], [fmtMoney(ur.pre_paid_amount), 'num'],
      [fmtMoney(ur.settled_amount), 'num'], [ur.obligations_count, 'num'], [ur.settlements_count, 'num'],
      [ur.alerts_count, 'num'], [ur.sale_ids ?? '-'], [ur.reference ?? '-'],
    ];
    for (const [text, cls] of cells) {
      const td = document.createElement('td');
      td.textContent = text ?? '-';
      if (cls) td.className = cls;
      tr.appendChild(td);
    }
    const td = document.createElement('td');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Detalhar';
    btn.addEventListener('click', () => openReceivableUnit(ur.id));
    td.appendChild(btn);
    tr.appendChild(td);
    urTableBody.appendChild(tr);
  }
}

function kvGrid(obj) {
  const grid = document.createElement('div');
  grid.className = 'kv-grid';
  for (const [k, v] of Object.entries(obj || {})) {
    const key = document.createElement('div');
    key.className = 'k';
    key.textContent = k;
    const val = document.createElement('div');
    val.className = 'v';
    val.textContent = v == null ? '-' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    grid.append(key, val);
  }
  return grid;
}

function rowsTable(rows) {
  if (!rows.length) {
    const p = document.createElement('p');
    p.className = 'status-line';
    p.textContent = 'nenhum registro';
    return p;
  }
  const wrap = document.createElement('div');
  wrap.className = 'ur-table-wrap';
  const table = document.createElement('table');
  table.className = 'ur-table';
  const cols = Object.keys(rows[0]);
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const c of cols) {
    const th = document.createElement('th');
    th.textContent = c;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const c of cols) {
      const td = document.createElement('td');
      const v = row[c];
      td.textContent = v == null ? '-' : typeof v === 'object' ? JSON.stringify(v) : String(v);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  wrap.appendChild(table);
  return wrap;
}

function section(title, node) {
  const h = document.createElement('h3');
  h.textContent = title;
  return [h, node];
}

async function openReceivableUnit(id) {
  urModalTitle.textContent = `UR #${id}`;
  urModalBody.replaceChildren();
  urModalBody.textContent = 'Carregando...';
  urModal.hidden = false;
  try {
    const res = await fetch(`/api/tag/receivable-units/${id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    urModalTitle.textContent = `UR #${id} · ${data.unit.reference ?? data.unit.key}`;
    urModalBody.replaceChildren(
      ...section('receivable_unit', kvGrid(data.unit)),
      ...section('payment_arrangement', kvGrid(data.paymentArrangement)),
      ...section('user', kvGrid(data.user)),
      ...section(`settlement_obligations (${data.settlementObligations.length})`, rowsTable(data.settlementObligations)),
      ...section(`settlements (${data.settlements.length})`, rowsTable(data.settlements)),
      ...section(`settlement_obligation_payments (${data.settlementObligationPayments.length})`, rowsTable(data.settlementObligationPayments)),
      ...section(`sale_statement_units + sales + account_statements (${data.saleStatementUnits.length})`, rowsTable(data.saleStatementUnits)),
      ...section(`slc_pos_settlement_groups (${data.slc.posSettlementGroups.length})`, rowsTable(data.slc.posSettlementGroups)),
      ...section(`slc_anticipation_reports (${data.slc.anticipationReports.length})`, rowsTable(data.slc.anticipationReports)),
      ...section(`slc_anticipation_reports_attempts (${data.slc.anticipationReportAttempts.length})`, rowsTable(data.slc.anticipationReportAttempts)),
      ...section(`slc_centralizer_groups (${data.slc.centralizerGroups.length})`, rowsTable(data.slc.centralizerGroups)),
      ...section(`slc_settlement_group_roots (${data.slc.settlementGroupRoots.length})`, rowsTable(data.slc.settlementGroupRoots)),
      ...section(`slc_settlement_conciliation_items (${data.slc.conciliationItems.length})`, rowsTable(data.slc.conciliationItems)),
      ...section(`slc_settlement_conciliations (${data.slc.conciliations.length})`, rowsTable(data.slc.conciliations)),
      ...section(`tag_ur_alerts (${data.alerts.length})`, rowsTable(data.alerts)),
      ...section(`reconciliation_receivables_units (${data.reconciliations.length})`, rowsTable(data.reconciliations)),
    );
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(data, null, 2);
    urModalBody.append(...section('JSON completo', pre));
  } catch (error) {
    urModalBody.textContent = `Falha ao carregar: ${error.message}`;
  }
}

urModalCloseBtn.addEventListener('click', () => { urModal.hidden = true; });
urModal.addEventListener('click', (e) => { if (e.target === urModal) urModal.hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !urModal.hidden) urModal.hidden = true; });

urRefreshBtn.addEventListener('click', () => { urPage = 0; loadReceivableUnits(); });
urSearchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { urPage = 0; loadReceivableUnits(); } });
urPrevBtn.addEventListener('click', () => { if (urPage > 0) { urPage -= 1; loadReceivableUnits(); } });
urNextBtn.addEventListener('click', () => { urPage += 1; loadReceivableUnits(); });

loadReceivableUnits();
