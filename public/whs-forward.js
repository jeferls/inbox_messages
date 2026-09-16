// Aba Webhook Forward: cadastro dos encaminhadores do webhook.site e acompanhamento do que foi reenviado.
(() => {
  const $ = (s) => document.querySelector(s);
  const API = '/api/whs-forward';
  const POLL_MS = 3000;
  let forwarders = [];
  let selectedId = localStorage.getItem('whs-forward:selected') || null;

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ESC[c]);
  const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR') : '–');
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR') : '–');

  async function req(method, path, body) {
    const res = await fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  // ---------- formulário ----------
  const form = $('#fwForm');
  const fields = { id: $('#fwId'), name: $('#fwName'), token: $('#fwToken'), target: $('#fwTarget'), apiKey: $('#fwApiKey'), intervalMs: $('#fwInterval'), autoStart: $('#fwAutoStart') };

  function setFormStatus(msg, ok = true) {
    const el = $('#formStatus');
    el.textContent = msg;
    el.className = `form-status ${msg ? (ok ? 'ok' : 'err') : ''}`;
  }

  function readForm() {
    return {
      name: fields.name.value.trim(),
      token: fields.token.value.trim(),
      target: fields.target.value.trim(),
      apiKey: fields.apiKey.value,
      intervalMs: Number(fields.intervalMs.value) || 3000,
      autoStart: fields.autoStart.checked,
    };
  }

  function fillForm(f) {
    fields.id.value = f?.id || '';
    fields.name.value = f?.name || '';
    fields.token.value = f?.token || '';
    fields.target.value = f?.target || '';
    fields.apiKey.value = f?.apiKey || '';
    fields.intervalMs.value = f?.intervalMs || 3000;
    fields.autoStart.checked = f ? Boolean(f.autoStart) : true;
    $('#formTitle').textContent = f ? `Editando: ${f.name}` : 'Novo encaminhador';
    $('#cancelBtn').hidden = !f;
    setFormStatus('');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = readForm();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(data.target)) {
      setFormStatus('Atenção: dentro do container, localhost é o próprio Greenn-Tools. Use o hostname da greenn-network.', false);
    }
    $('#saveBtn').disabled = true;
    try {
      const id = fields.id.value;
      const saved = id ? await req('PUT', `/forwarders/${id}`, data) : await req('POST', '/forwarders', data);
      selectedId = saved.id;
      localStorage.setItem('whs-forward:selected', selectedId);
      fillForm(null);
      setFormStatus(id ? 'Encaminhador atualizado.' : 'Encaminhador criado. Clique em Iniciar para começar a reenviar.');
      await refresh();
    } catch (err) {
      setFormStatus(err.message, false);
    } finally {
      $('#saveBtn').disabled = false;
    }
  });

  $('#cancelBtn').addEventListener('click', () => fillForm(null));

  $('#checkBtn').addEventListener('click', async () => {
    const { token, apiKey } = readForm();
    if (!token) return setFormStatus('Informe o token.', false);
    $('#checkBtn').disabled = true;
    setFormStatus('Consultando webhook.site…');
    try {
      const info = await req('POST', '/check', { token, apiKey: apiKey === '••••' ? undefined : apiKey });
      setFormStatus(`Token ok: ${info.requests} requisição(ões) capturada(s), última em ${fmtDate(info.lastRequestAt)}.`);
    } catch (err) {
      setFormStatus(err.message, false);
    } finally {
      $('#checkBtn').disabled = false;
    }
  });

  // ---------- lista ----------
  function renderList() {
    const list = $('#fwList');
    if (!forwarders.length) {
      list.innerHTML = '<div class="fw"><span class="muted">Nenhum encaminhador cadastrado. Preencha o formulário ao lado.</span></div>';
      return;
    }
    list.innerHTML = forwarders.map((f) => {
      const dot = f.lastError ? 'err' : f.running ? 'on' : '';
      const state = f.lastError ? 'com erro' : f.running ? 'rodando' : 'parado';
      return `
        <div class="fw ${f.id === selectedId ? 'selected' : ''}" data-id="${esc(f.id)}">
          <div class="fw-head">
            <span class="dot ${dot}" title="${esc(state)}"></span>
            <span class="fw-name">${esc(f.name)}</span>
            <span class="muted">${esc(state)}</span>
            <div class="actions">
              ${f.running
                ? `<button data-act="stop">Parar</button>`
                : `<button data-act="start" class="primary">Iniciar</button><button data-act="backfill" title="Reenvia também o histórico já capturado no webhook.site">Iniciar com histórico</button>`}
              <button data-act="edit">Editar</button>
              <button data-act="reset" title="Esquece o que já foi reenviado e limpa o log">Zerar</button>
              <button data-act="delete" class="danger">Excluir</button>
            </div>
          </div>
          <div class="fw-meta">
            <span>Origem</span><code>https://webhook.site/${esc(f.token)}</code>
            <span>Destino</span><code>${esc(f.target)}</code>
            <span>Consulta</span><span>a cada ${esc(f.intervalMs)}ms · última ${fmtTime(f.lastPollAt)}${f.hasApiKey ? ' · com Api-Key' : ''}${f.autoStart ? ' · sobe com o servidor' : ''}</span>
          </div>
          <div class="fw-stats">
            <span class="stat">reenviadas: ${f.forwarded}</span>
            <span class="stat ${f.failed ? 'err' : ''}">falhas: ${f.failed}</span>
            <span class="stat">ignoradas/vistas: ${f.seen}</span>
          </div>
          ${f.lastError ? `<div class="fw-error">${esc(f.lastError)}</div>` : ''}
        </div>`;
    }).join('');
  }

  $('#fwList').addEventListener('click', async (e) => {
    const card = e.target.closest('.fw[data-id]');
    if (!card) return;
    const id = card.dataset.id;
    const btn = e.target.closest('button[data-act]');
    if (!btn) {
      selectedId = id;
      localStorage.setItem('whs-forward:selected', id);
      renderList();
      loadLog();
      return;
    }
    const f = forwarders.find((x) => x.id === id);
    try {
      switch (btn.dataset.act) {
        case 'start': await req('POST', `/forwarders/${id}/start`, {}); break;
        case 'backfill':
          if (!confirm(`Reenviar também todo o histórico já capturado em webhook.site/${f.token} para ${f.target}?`)) return;
          await req('POST', `/forwarders/${id}/start`, { backfill: true });
          break;
        case 'stop': await req('POST', `/forwarders/${id}/stop`); break;
        case 'reset': await req('POST', `/forwarders/${id}/reset`); break;
        case 'edit': fillForm(f); fields.name.focus(); return;
        case 'delete':
          if (!confirm(`Excluir o encaminhador "${f.name}"?`)) return;
          await req('DELETE', `/forwarders/${id}`);
          if (selectedId === id) selectedId = null;
          break;
      }
      selectedId = selectedId || id;
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  });

  // ---------- log ----------
  async function loadLog() {
    const panel = $('#logPanel');
    const f = forwarders.find((x) => x.id === selectedId);
    if (!f) { panel.hidden = true; return; }
    panel.hidden = false;
    $('#logTitle').textContent = `Requisições reenviadas · ${f.name}`;
    try {
      const log = await req('GET', `/forwarders/${f.id}/log`);
      renderLog(log);
    } catch (err) {
      $('#logBody').innerHTML = `<div class="empty-log">${esc(err.message)}</div>`;
    }
  }

  function renderLog(log) {
    if (!log.length) {
      $('#logBody').innerHTML = '<div class="empty-log">Nada reenviado ainda. O que chegar no webhook.site a partir do início aparece aqui.</div>';
      return;
    }
    $('#logBody').innerHTML = `
      <table>
        <thead><tr><th>Quando</th><th>Capturada em</th><th>Método</th><th>Resposta</th><th>Tempo</th><th>Origem</th></tr></thead>
        <tbody>${log.map((e, i) => {
          const st = e.error ? `<span class="status err">${esc(e.error)}</span>` : `<span class="status ${e.ok ? 'ok' : 'err'}">${e.status}</span>`;
          return `
            <tr class="has-detail" data-i="${i}">
              <td>${fmtTime(e.at)}</td><td>${fmtDate(e.createdAt)}</td><td>${esc(e.method)}</td><td>${st}</td><td>${e.ms}ms</td>
              <td class="muted" title="${esc(e.uuid)}">${esc(e.ip || '')}<br><small>${esc(e.uuid?.slice(0, 8))}</small></td>
            </tr>
            <tr class="detail" hidden><td colspan="6"><pre>${esc(e.response || '(sem corpo na resposta)')}</pre></td></tr>`;
        }).join('')}</tbody>
      </table>`;
  }

  $('#logBody').addEventListener('click', (e) => {
    const row = e.target.closest('tr.has-detail');
    if (!row) return;
    const detail = row.nextElementSibling;
    detail.hidden = !detail.hidden;
  });
  $('#refreshLogBtn').addEventListener('click', loadLog);

  // ---------- polling ----------
  async function refresh() {
    try {
      forwarders = await req('GET', '/forwarders');
      if (!forwarders.some((f) => f.id === selectedId)) selectedId = forwarders[0]?.id || null;
      renderList();
      await loadLog();
      $('#pollStatus').textContent = `atualizado ${new Date().toLocaleTimeString('pt-BR')}`;
    } catch (err) {
      $('#pollStatus').textContent = `falha ao consultar: ${err.message}`;
    }
  }

  fillForm(null);
  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
