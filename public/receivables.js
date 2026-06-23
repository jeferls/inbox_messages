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
