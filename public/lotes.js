const lotesList = document.getElementById('lotesList');
const loteDetail = document.getElementById('loteDetail');
const lotesTotal = document.getElementById('lotesTotal');
const lotesPageInfo = document.getElementById('lotesPageInfo');
const refreshLotesBtn = document.getElementById('refreshLotesBtn');
const prevLotesBtn = document.getElementById('prevLotesBtn');
const nextLotesBtn = document.getElementById('nextLotesBtn');

const state = {
  page: 0,
  limit: 20,
  total: 0,
  selectedNumCtrlCip: null,
};

async function fetchLotes() {
  const params = new URLSearchParams();
  params.set('limit', String(state.limit));
  params.set('page', String(state.page));
  const res = await fetch(`/api/slc/v1/liquidacoes-antecipacao?${params.toString()}`);
  if (!res.ok) throw new Error('Falha ao buscar lotes');
  return res.json();
}

async function fetchProcessamento(numCtrlCip) {
  const res = await fetch(`/api/slc/v1/liquidacoes/${encodeURIComponent(numCtrlCip)}/processamento`);
  if (!res.ok) throw new Error('Falha ao buscar processamento');
  return res.json();
}

async function deleteLote(numCtrlCip) {
  const res = await fetch(`/api/slc/v1/liquidacoes/${encodeURIComponent(numCtrlCip)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const body = await safeJson(res);
    throw new Error(body?.error || 'Falha ao deletar lote');
  }
}

function renderLotes(items) {
  lotesList.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Nenhum lote encontrado';
    lotesList.appendChild(empty);
    return;
  }

  for (const item of items) {
    const el = document.createElement('div');
    el.className = 'lote-item';
    if (item.numCtrlCip === state.selectedNumCtrlCip) el.classList.add('selected');
    el.innerHTML = `
      <div class="lote-main">${escapeHtml(item.numCtrlCip)}</div>
      <div class="lote-sub">Criado em: ${fmtDate(item.createdAt)}</div>
    `;
    el.addEventListener('click', () => openLote(item.numCtrlCip));
    lotesList.appendChild(el);
  }
}

async function openLote(numCtrlCip) {
  state.selectedNumCtrlCip = numCtrlCip;
  loteDetail.innerHTML = '<div class="empty">Carregando processamento...</div>';
  try {
    const processamento = await fetchProcessamento(numCtrlCip);
    const acto = Array.isArray(processamento.grupoPontoVendaActo)
      ? processamento.grupoPontoVendaActo.length
      : 0;
    const recsdo = Array.isArray(processamento.grupoPontoVendaRecsdo)
      ? processamento.grupoPontoVendaRecsdo.length
      : 0;

    loteDetail.innerHTML = `
      <div><strong>numCtrlCip:</strong> ${escapeHtml(numCtrlCip)}</div>
      <div class="status-line">Situação: ${escapeHtml(processamento.situacao || '-')} • Acto: ${acto} • Recsdo: ${recsdo}</div>
      <div class="detail-actions">
        <button id="deleteLoteBtn" class="danger">Deletar lote</button>
      </div>
      <pre class="json-box">${escapeHtml(JSON.stringify(processamento, null, 2))}</pre>
    `;

    const deleteBtn = document.getElementById('deleteLoteBtn');
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`Deseja realmente deletar o lote ${numCtrlCip}?`)) return;
      deleteBtn.disabled = true;
      try {
        await deleteLote(numCtrlCip);
        state.selectedNumCtrlCip = null;
        loteDetail.innerHTML = '<div class="empty">Lote deletado com sucesso</div>';
        await load();
      } catch (error) {
        alert(error.message || 'Falha ao deletar');
        deleteBtn.disabled = false;
      }
    });
  } catch (error) {
    loteDetail.innerHTML = `<div class="empty">${escapeHtml(error.message || 'Erro ao carregar')}</div>`;
  }

  await load(false);
}

async function load(keepSelection = true) {
  try {
    const data = await fetchLotes();
    state.total = data.total || 0;
    lotesTotal.textContent = `${state.total} lote${state.total === 1 ? '' : 's'}`;
    const totalPages = Math.max(1, Math.ceil(state.total / state.limit));
    const currentPage = Math.min(state.page + 1, totalPages);
    lotesPageInfo.textContent = `${currentPage}/${totalPages}`;
    prevLotesBtn.disabled = state.page <= 0;
    nextLotesBtn.disabled = state.page + 1 >= totalPages;

    renderLotes(data.items || []);

    if (!keepSelection && state.selectedNumCtrlCip) {
      const selectedStillVisible = (data.items || []).some((it) => it.numCtrlCip === state.selectedNumCtrlCip);
      if (!selectedStillVisible) state.selectedNumCtrlCip = null;
    }
  } catch (error) {
    lotesList.innerHTML = `<div class="empty">${escapeHtml(error.message || 'Erro ao carregar lotes')}</div>`;
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

refreshLotesBtn.addEventListener('click', () => load());
prevLotesBtn.addEventListener('click', () => {
  if (state.page > 0) {
    state.page -= 1;
    load();
  }
});
nextLotesBtn.addEventListener('click', () => {
  state.page += 1;
  load();
});

load();
