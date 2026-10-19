// IdWall tab, "Regressão" view: preflight, scenario selection and a live view of the run (polled every second).
(() => {
  const API = '/api/idwall-regression';
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STATUS_LABEL = { pending: 'pendente', running: 'rodando', passed: 'passou', failed: 'falhou', error: 'erro', skipped: 'pulado', cancelled: 'cancelado' };
  const RUN_LABEL = { preflight: 'Pré-voo', running: 'Executando', done: 'Concluída', blocked: 'Bloqueada no pré-voo', cancelled: 'Cancelada', error: 'Erro', interrupted: 'Interrompida (o inbox reiniciou)' };
  const STEP_ICON = { ok: '✓', fail: '✕', info: 'i', run: '…' };

  let scenarios = [];
  let run = null;
  let selectedId = null;
  let pollTimer = null;

  async function request(method, path, body) {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  // ---------- view switcher ----------
  function showView(view) {
    for (const b of document.querySelectorAll('.iw-switcher button')) b.classList.toggle('active', b.dataset.view === view);
    $('mockView').hidden = view !== 'mock';
    $('regressionView').hidden = view !== 'regression';
    try { localStorage.setItem('idwall-view', view); } catch {}
    if (view === 'regression') refresh();
  }
  document.querySelector('.iw-switcher').addEventListener('click', (e) => {
    const button = e.target.closest('button[data-view]');
    if (button) showView(button.dataset.view);
  });

  // ---------- preflight ----------
  function renderPreflight(checks) {
    $('regPreflightList').innerHTML = checks.map((c) => `
      <li>
        <span style="color:${c.ok ? 'var(--ok)' : 'var(--bad)'};font-weight:700;">${c.ok ? '✓' : '✕'}</span>
        <div><div>${esc(c.label)}</div><div class="d">${esc(c.detail)}</div>
        ${c.fix === 'start-workers' ? '<div class="fix"><button class="iw-btn ghost sm" data-action="start-workers">Iniciar workers</button></div>' : c.fix ? `<div class="d" style="color:var(--warn)">${esc(c.fix)}</div>` : ''}
        </div>
      </li>`).join('');
  }

  async function runPreflight() {
    $('regPreflightList').innerHTML = '<li class="iw-muted">Verificando…</li>';
    try {
      renderPreflight(await request('GET', '/preflight'));
    } catch (error) {
      $('regPreflightList').innerHTML = `<li style="color:var(--bad)">${esc(error.message)}</li>`;
    }
  }

  // ---------- scenarios ----------
  function scenarioStatus(id) {
    return run?.scenarios?.find((s) => s.id === id)?.status ?? null;
  }

  function renderScenarios() {
    const checked = new Set([...document.querySelectorAll('#regScenarioList input:checked')].map((i) => i.value));
    const first = !document.querySelector('#regScenarioList input');
    $('regScenarioList').innerHTML = scenarios.map((s) => {
      const status = scenarioStatus(s.id);
      return `<li class="iw-scenario ${s.id === selectedId ? 'selected' : ''}" data-id="${esc(s.id)}">
        <input type="checkbox" value="${esc(s.id)}" ${first || checked.has(s.id) ? 'checked' : ''} />
        <div><div class="t"><span class="id">${esc(s.id)}</span>${esc(s.title)}</div><div class="c">${esc(s.priority)} · ${esc(s.covers.join(', '))}</div></div>
        ${status ? `<span class="iw-st ${esc(status)}">${esc(STATUS_LABEL[status] || status)}</span>` : ''}
      </li>`;
    }).join('');
  }

  function selectedIds() {
    return [...document.querySelectorAll('#regScenarioList input:checked')].map((i) => i.value);
  }

  // ---------- run view ----------
  function fmtTime(iso) { return iso ? new Date(iso).toLocaleTimeString('pt-BR') : ''; }
  function fmtDuration(ms) {
    if (ms == null) return '';
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}min ${s % 60}s`;
  }

  function renderNow() {
    const status = run?.status;
    $('regStatus').className = `iw-reg-status ${status === 'done' && run.scenarios.some((s) => ['failed', 'error'].includes(s.status)) ? 'failed' : (status || '')}`;
    const MODE = { branch: 'branch com o adapter', legacy: 'production / legado' };
    $('regStatus').textContent = run ? `${RUN_LABEL[status] || status}${run.mode ? ` · ${MODE[run.mode] || run.mode}` : ''}` : 'Nenhuma execução';
    $('regBadge').hidden = !['preflight', 'running'].includes(status);
    $('regCancel').disabled = !['preflight', 'running'].includes(status);
    $('regRun').disabled = ['preflight', 'running'].includes(status);

    if (!run) {
      $('regCurrentTitle').textContent = 'Escolha os cenários e clique em executar.';
      $('regCurrentStep').textContent = '';
      $('regCounts').innerHTML = '';
      $('regProgress').style.width = '0%';
      $('regElapsed').textContent = '';
      return;
    }

    const current = run.scenarios.find((s) => s.id === run.current?.scenario);
    if (current) {
      $('regCurrentTitle').innerHTML = `<span class="id">${esc(current.id)}</span>${esc(current.title)}`;
      $('regCurrentStep').innerHTML = run.current.step ? `<span class="spin"></span>${esc(run.current.step)}` : '';
    } else if (status === 'blocked') {
      $('regCurrentTitle').textContent = 'O pré-voo encontrou pendências: veja a lista ao lado.';
      $('regCurrentStep').textContent = '';
    } else if (status === 'preflight') {
      $('regCurrentTitle').textContent = 'Verificando o ambiente…';
      $('regCurrentStep').innerHTML = '<span class="spin"></span>patch, workers, nginx e configuração do provedor';
    } else {
      const failed = run.scenarios.filter((s) => ['failed', 'error'].includes(s.status)).map((s) => s.id);
      $('regCurrentTitle').textContent = failed.length ? `Concluída com falhas em ${failed.join(', ')}` : 'Todos os cenários executados passaram';
      $('regCurrentStep').textContent = '';
    }

    const total = run.scenarios.length;
    const passed = run.scenarios.filter((s) => s.status === 'passed').length;
    const failed = run.scenarios.filter((s) => ['failed', 'error'].includes(s.status)).length;
    const finished = run.scenarios.filter((s) => !['pending', 'running'].includes(s.status)).length;
    $('regCounts').innerHTML = `<span class="p"><b>${passed}</b>passaram</span><span class="f"><b>${failed}</b>falharam</span><span class="w"><b>${total - finished}</b>restantes</span>`;
    $('regProgress').style.width = `${(finished / Math.max(1, total)) * 100}%`;
    const end = run.finishedAt ? new Date(run.finishedAt) : new Date();
    $('regElapsed').textContent = `iniciada às ${fmtTime(run.startedAt)} · ${fmtDuration(end - new Date(run.startedAt))}`;
    if (run.preflight?.length) renderPreflight(run.preflight);
  }

  function renderDetail() {
    if ($('regFollow').checked && run?.current?.scenario) selectedId = run.current.scenario;
    const meta = scenarios.find((s) => s.id === selectedId);
    const entry = run?.scenarios?.find((s) => s.id === selectedId);
    if (!meta) {
      $('regDetailTitle').textContent = 'Passos';
      $('regDetailMeta').innerHTML = 'Clique num cenário para ver o que ele testa.';
      $('regSteps').innerHTML = '';
      return;
    }
    $('regDetailTitle').innerHTML = `<span class="iw-mono" style="color:var(--muted)">${esc(meta.id)}</span> ${esc(meta.title)}`;
    $('regDetailMeta').innerHTML = `${esc(meta.description)}<br/>Cobre ${meta.covers.map((c) => `<code>${esc(c)}</code>`).join(' ')}${entry?.sellers?.length ? ` · sellers ${entry.sellers.map((s) => `<code>${esc(s)}</code>`).join(' ')}` : ''}${entry?.durationMs != null ? ` · ${fmtDuration(entry.durationMs)}` : ''}`;
    const steps = entry?.steps ?? [];
    const box = $('regSteps');
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
    box.innerHTML = steps.length
      ? steps.map((st) => `<li class="iw-step ${esc(st.status)} ${st.check ? 'check' : ''}">
          <span class="time">${fmtTime(st.at)}</span>
          <span class="ic">${STEP_ICON[st.status] || '·'}</span>
          <div><div class="l">${esc(st.label)}</div>${st.detail ? `<div class="dt">${esc(st.detail)}</div>` : ''}</div>
        </li>`).join('')
      : `<li class="iw-empty"><b>${entry ? 'Aguardando' : 'Ainda não executado'}</b>${entry ? 'O cenário começa quando chegar a vez dele.' : 'Selecione e execute para ver os passos aqui.'}</li>`;
    if ($('regFollow').checked && atBottom) box.scrollTop = box.scrollHeight;
  }

  async function refresh() {
    try {
      if (!scenarios.length) scenarios = await request('GET', '/scenarios');
      run = await request('GET', '/run');
      renderNow();
      renderScenarios();
      renderDetail();
    } catch (error) {
      $('regMsg').textContent = error.message;
      $('regMsg').className = 'iw-msg err';
    }
    clearTimeout(pollTimer);
    const active = ['preflight', 'running'].includes(run?.status);
    pollTimer = setTimeout(refresh, active ? 1000 : 5000);
  }

  // ---------- wiring ----------
  $('regPreflight').addEventListener('click', runPreflight);
  $('regPreflightList').addEventListener('click', async (e) => {
    if (e.target.dataset?.action !== 'start-workers') return;
    e.target.disabled = true;
    try {
      const { started } = await request('POST', '/workers');
      e.target.textContent = started.length ? `iniciados: ${started.length}` : 'já estavam rodando';
      setTimeout(runPreflight, 4000);
    } catch (error) {
      e.target.textContent = error.message;
    }
  });

  $('regScenarioList').addEventListener('click', (e) => {
    if (e.target.matches('input')) return;
    const item = e.target.closest('.iw-scenario');
    if (!item) return;
    selectedId = item.dataset.id;
    $('regFollow').checked = false;
    renderScenarios();
    renderDetail();
  });

  $('regSelectAll').addEventListener('change', (e) => {
    for (const input of document.querySelectorAll('#regScenarioList input')) input.checked = e.target.checked;
  });

  $('regRun').addEventListener('click', async () => {
    const ids = selectedIds();
    if (!ids.length) {
      $('regMsg').textContent = 'Selecione ao menos um cenário.';
      $('regMsg').className = 'iw-msg err';
      return;
    }
    try {
      $('regFollow').checked = true;
      run = await request('POST', '/run', { ids });
      $('regMsg').textContent = '';
      refresh();
    } catch (error) {
      $('regMsg').textContent = error.message;
      $('regMsg').className = 'iw-msg err';
    }
  });

  $('regCancel').addEventListener('click', async () => {
    await request('POST', '/run/cancel').catch(() => {});
    refresh();
  });

  let initial = 'mock';
  try { initial = localStorage.getItem('idwall-view') || 'mock'; } catch {}
  showView(initial);
  if (initial !== 'regression') refresh();
})();
