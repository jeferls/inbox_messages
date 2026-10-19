// IdWall tab: settings, manual webhooks and live view of the mock state (polled every 2s).
(() => {
  const API = '/api/idwall-mock';
  const POLL_MS = 2000;
  const FLOWS = [
    ...['basic', 'biometry', 'first_withdraw', 'first_product', 'growth1k', 'growth10k'].map((flow) => ({ flow, group: 'PF' })),
    ...['company_registration', 'company_enrichment', 'company_growth1k'].map((flow) => ({ flow, group: 'PJ' })),
  ];
  const OUTCOMES = ['FINISHED', 'INVALID', 'WAITING_MANUAL_ACTION', 'CANCELLED', 'NONE'];
  const OUTCOME_LABEL = { NONE: 'Sem resultado', WAITING_MANUAL_ACTION: 'MANUAL' };
  const KIND = {
    inbound: { icon: '←', dir: 'greenn-back → mock' },
    webhook: { icon: '→', dir: 'mock → greenn-back' },
    timer: { icon: '⏱', dir: 'evento interno' },
    error: { icon: '!', dir: 'erro' },
  };

  const $ = (id) => document.getElementById(id);
  const openEvents = new Set();
  let settingsLoaded = false;
  let eventFilter = 'all';
  let lastState = null;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const badge = (value) => (value ? `<span class="iw-badge s-${esc(String(value).replace(/\s+/g, '_'))}">${esc(value)}</span>` : '<span class="iw-muted">-</span>');
  const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR') : '-');
  const ago = (iso) => {
    const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (seconds < 60) return `há ${seconds}s`;
    if (seconds < 3600) return `há ${Math.round(seconds / 60)} min`;
    return `às ${time(iso)}`;
  };
  const empty = (title, text) => `<div class="iw-empty"><b>${esc(title)}</b>${esc(text)}</div>`;

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

  // ---------- tabs ----------
  for (const group of document.querySelectorAll('[data-tabs]')) {
    const card = group.closest('.iw-card');
    group.addEventListener('click', (e) => {
      const tab = e.target.closest('.iw-tab');
      if (!tab) return;
      for (const t of group.querySelectorAll('.iw-tab')) t.classList.toggle('active', t === tab);
      for (const pane of card.querySelectorAll('.iw-pane')) pane.hidden = pane.dataset.pane !== tab.dataset.tab;
    });
  }

  // ---------- settings ----------
  function renderOutcomeSelects() {
    $('outcomes').innerHTML = FLOWS.map(({ flow, group }) => `
      <div class="iw-outcome">
        <span><span class="flow">${esc(flow)}</span><span class="group">${group}</span></span>
        <select class="iw-input" data-flow="${esc(flow)}">
          ${OUTCOMES.map((o) => `<option value="${o}">${esc(OUTCOME_LABEL[o] || o)}</option>`).join('')}
        </select>
      </div>`).join('');
    $('outcomes').addEventListener('change', (e) => { e.target.dataset.value = e.target.value; });
  }

  function fillSettings(settings, defaults) {
    $('inProgressDelay').value = settings.inProgressDelayMs / 1000;
    $('finalDelay').value = settings.finalDelayMs / 1000;
    $('extractionDelay').value = settings.extractionDelayMs / 1000;
    $('documentType').value = settings.documentType;
    $('enrichmentMode').value = settings.enrichmentMode;
    $('sendInProgress').checked = settings.sendInProgress;
    $('backUrl').value = settings.backUrl;
    $('backUrl').placeholder = defaults.backUrl;
    for (const select of $('outcomes').querySelectorAll('select')) {
      select.value = settings.outcomes[select.dataset.flow] || 'FINISHED';
      select.dataset.value = select.value;
    }
  }

  function showMessage(el, text, ok = true) {
    el.textContent = text;
    el.className = `iw-msg ${ok ? 'ok' : 'err'}`;
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.textContent = ''; }, 5000);
  }

  async function saveSettings(e) {
    const button = e.currentTarget;
    const outcomes = {};
    for (const select of $('outcomes').querySelectorAll('select')) outcomes[select.dataset.flow] = select.value;
    button.disabled = true;
    try {
      await request('PUT', '/settings', {
        inProgressDelayMs: Number($('inProgressDelay').value) * 1000,
        finalDelayMs: Number($('finalDelay').value) * 1000,
        extractionDelayMs: Number($('extractionDelay').value) * 1000,
        documentType: $('documentType').value,
        enrichmentMode: $('enrichmentMode').value,
        sendInProgress: $('sendInProgress').checked,
        backUrl: $('backUrl').value,
        outcomes,
      });
      showMessage($('settingsMsg'), 'Salvo. Vale para os próximos fluxos e relatórios.');
      refresh();
    } catch (error) {
      showMessage($('settingsMsg'), error.message, false);
    } finally {
      button.disabled = false;
    }
  }

  // ---------- manual actions ----------
  async function runManual(button, action) {
    const box = $('manualResult');
    button.disabled = true;
    try {
      const result = await action();
      const ok = result.ok !== false;
      const head = result.status !== undefined ? `HTTP ${result.status || 'sem resposta'}` : 'OK';
      box.textContent = `${head}${result.body ? ` · ${JSON.stringify(result.body).slice(0, 300)}` : ''}`;
      box.className = `iw-result ${ok ? 'ok' : 'err'}`;
    } catch (error) {
      box.textContent = error.message;
      box.className = 'iw-result err';
    } finally {
      button.disabled = false;
      refresh();
    }
  }

  // ---------- rendering ----------
  function table(headers, rows, emptyHtml) {
    if (!rows.length) return emptyHtml;
    return `<table class="iw-table"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  function describeJob(job, state) {
    if (job.type === 'extraction') return { title: 'Extração do documento', meta: `perfil do user ${job.payload.ref}`, status: 'EXTRACTED' };
    if (job.type === 'report-webhook') {
      const report = state.reports.find((r) => r.numero === job.payload.numero);
      return { title: 'webhook-report', meta: `${report?.flow ?? 'relatório'} · cnpj ${report?.cnpj ?? '-'}`, status: job.payload.status };
    }
    const run = state.runs.find((r) => r.id === job.payload.runId);
    return { title: 'webhook', meta: `user ${run?.userId ?? '-'} · ${run?.flow ?? '-'} · ${run?.flowId ?? ''}`, status: job.payload.status };
  }

  function renderScheduled(state) {
    const jobs = state.scheduled;
    if (!jobs.length) {
      $('scheduled').innerHTML = empty('Nenhum webhook na fila', 'Quando o greenn-back iniciar um fluxo ou relatório, os envios aparecem aqui com a contagem regressiva.');
      return;
    }
    $('scheduled').innerHTML = jobs.map((job) => {
      const remaining = Math.max(0, Math.ceil((job.dueAt - Date.now()) / 1000));
      const total = Math.max(1, job.dueAt - (job.createdAt ?? job.dueAt - 1));
      const progress = Math.min(100, Math.max(0, ((Date.now() - (job.createdAt ?? Date.now())) / total) * 100));
      const { title, meta, status } = describeJob(job, state);
      return `<div class="iw-job">
        <div class="eta">${remaining}<small>seg</small></div>
        <div class="what">${esc(title)} ${badge(status)}<div class="meta">${esc(meta)}</div><div class="iw-bar"><i style="width:${progress.toFixed(1)}%"></i></div></div>
        <button class="iw-btn ghost sm" data-cancel="${esc(job.id)}">Cancelar</button>
      </div>`;
    }).join('');
  }

  function renderRuns(runs) {
    $('runsCount').textContent = runs.length;
    $('runs').innerHTML = table(
      ['User', 'Fluxo', 'Flow id', 'Status', 'Resultado configurado', 'Etapas', 'Atualizado'],
      runs.map((run) => [
        `<b>${esc(run.userId)}</b>`, esc(run.flow), `<span class="iw-mono">${esc(run.flowId)}</span>`, badge(run.status), badge(run.outcome),
        `<span class="iw-muted">${run.stages.length}</span>`, `<span class="iw-muted">${time(run.updatedAt)}</span>`,
      ]),
      empty('Nenhum fluxo iniciado', 'Os fluxos aparecem quando o greenn-back chama POST /maestro/profile/{id}/flow/{flowId}.'),
    );
  }

  function renderReports(reports) {
    $('reportsCount').textContent = reports.length;
    $('reports').innerHTML = table(
      ['Número', 'Fluxo', 'CNPJ', 'Status', 'Resultado', 'Validado manualmente', 'Atualizado'],
      reports.map((r) => [
        `<span class="iw-mono" title="${esc(r.numero)}">${esc(r.numero.slice(0, 8))}…</span> <button class="iw-btn ghost sm" data-copy="${esc(r.numero)}">copiar</button>`,
        esc(r.flow), `<span class="iw-mono">${esc(r.cnpj)}</span>`, badge(r.status), badge(r.resultado),
        r.resultado ? (r.validado_manualmente ? 'sim' : 'não') : '<span class="iw-muted">-</span>', `<span class="iw-muted">${time(r.updatedAt)}</span>`,
      ]),
      empty('Nenhum relatório de empresa', 'Os relatórios aparecem quando o greenn-back chama POST /relatorios.'),
    );
  }

  function renderProfiles(profiles) {
    $('profilesCount').textContent = profiles.length;
    $('profiles').innerHTML = table(
      ['User', 'Nome', 'SDK', 'Extração', 'Documento', 'Imagens', 'Atualizado'],
      profiles.map((p) => [
        `<b>${esc(p.ref)}</b>`, esc(p.personal?.name || '-'), p.sdkToken ? 'sim' : '<span class="iw-muted">não</span>',
        badge(p.profileExtraction?.status), esc(p.profileExtraction?.documentType || '-'),
        p.images.length
          ? `<div class="iw-thumbs">${p.images.map((img) => {
            const url = `/idwall/v3${img.imageToken.replace('idwall:', '')}?preview=1`;
            return `<a href="${esc(url)}" target="_blank" title="${esc(img.name)}"><img src="${esc(url)}" alt="${esc(img.name)}" loading="lazy" /></a>`;
          }).join('')}</div>`
          : '<span class="iw-muted">-</span>',
        `<span class="iw-muted">${time(p.updatedAt)}</span>`,
      ]),
      empty('Nenhum perfil', 'Os perfis aparecem quando o greenn-back cria o perfil do seller, ou pelo disparo manual "Biometria pronta".'),
    );
  }

  function renderEvents(events) {
    $('eventsCount').textContent = events.length;
    const visible = eventFilter === 'all' ? events : events.filter((e) => e.kind === eventFilter);
    if (!visible.length) {
      $('events').innerHTML = `<li>${empty('Sem eventos', 'As chamadas do greenn-back e os webhooks enviados aparecem aqui.')}</li>`;
      return;
    }
    $('events').innerHTML = visible.map((event) => {
      const kind = KIND[event.kind] || KIND.timer;
      const http = event.response
        ? `<span class="iw-http ${event.response.ok ? 'ok' : 'err'}">${event.response.status || 'falhou'}</span>`
        : '<span></span>';
      const details = event.request || event.response
        ? `<details data-event="${esc(event.id)}" ${openEvents.has(event.id) ? 'open' : ''}><summary>ver payload</summary><pre>${esc(JSON.stringify({ request: event.request, response: event.response }, null, 2))}</pre></details>`
        : '';
      return `<li class="iw-event k-${esc(event.kind)}">
        <span class="t">${time(event.at)}</span>
        <span class="ic">${kind.icon}</span>
        <div class="body"><div class="line">${esc(event.summary)}</div><div class="dir">${kind.dir}</div>${details}</div>
        ${http}
      </li>`;
    }).join('');
  }

  function renderKpis(state) {
    const next = state.scheduled[0];
    $('kpiScheduled').textContent = state.scheduled.length;
    $('kpiNext').textContent = next ? `próximo em ${Math.max(0, Math.ceil((next.dueAt - Date.now()) / 1000))}s` : 'nenhum na fila';

    const running = state.runs.filter((r) => r.status === 'IN_PROGRESS').length;
    $('kpiRunning').textContent = running;
    $('kpiRuns').textContent = `${state.runs.length} fluxo(s) no total`;

    $('kpiReports').textContent = state.reports.length;
    $('kpiReportsSub').textContent = `${state.reports.filter((r) => r.status === 'EM ANALISE').length} em análise`;

    $('kpiProfiles').textContent = state.profiles.length;
    $('kpiProfilesSub').textContent = `${state.profiles.filter((p) => p.images.length).length} com documento`;

    const last = state.events.find((e) => e.kind === 'webhook');
    if (last) {
      $('kpiLast').textContent = last.response?.status || 'falhou';
      $('kpiLast').style.color = last.response?.ok ? 'var(--ok)' : 'var(--bad)';
      $('kpiLastSub').textContent = `${ago(last.at)} · ${last.summary}`;
    } else {
      $('kpiLast').textContent = '-';
      $('kpiLast').style.color = '';
      $('kpiLastSub').textContent = 'nenhum enviado';
    }

    $('backUrlChip').textContent = state.settings.backUrl || state.defaults.backUrl;
  }

  function setLive(ok) {
    $('liveDot').className = `iw-dot ${ok ? 'live' : 'down'}`;
    $('liveText').textContent = ok ? 'mock no ar' : 'mock fora do ar';
  }

  function render(state) {
    renderKpis(state);
    renderScheduled(state);
    renderRuns(state.runs);
    renderReports(state.reports);
    renderProfiles(state.profiles);
    renderEvents(state.events);
  }

  async function refresh() {
    try {
      const state = await request('GET', '/state');
      lastState = state;
      setLive(true);
      if (!settingsLoaded) {
        fillSettings(state.settings, state.defaults);
        settingsLoaded = true;
      }
      render(state);
    } catch {
      setLive(false);
    }
  }

  // ---------- wiring ----------
  renderOutcomeSelects();
  $('saveSettings').addEventListener('click', saveSettings);

  $('sendFlowWh').addEventListener('click', (e) => runManual(e.currentTarget, () => request('POST', '/webhooks/flow', {
    userId: $('whUser').value.trim(), flowId: $('whFlowId').value.trim(), status: $('whStatus').value,
  })));

  $('sendReportWh').addEventListener('click', (e) => runManual(e.currentTarget, () => request('POST', '/webhooks/report', {
    protocolo: $('whProtocolo').value.trim(), status: $('whReportStatus').value,
  })));

  $('seedBiometry').addEventListener('click', (e) => {
    const ref = $('bioUser').value.trim();
    if (!ref) {
      $('manualResult').textContent = 'Informe o user id.';
      $('manualResult').className = 'iw-result err';
      return;
    }
    runManual(e.currentTarget, () => request('POST', `/profiles/${encodeURIComponent(ref)}/biometry`, { documentType: $('bioDocType').value }));
  });

  $('scheduled').addEventListener('click', async (e) => {
    const id = e.target.closest('[data-cancel]')?.dataset.cancel;
    if (!id) return;
    await request('DELETE', `/scheduled/${id}`).catch(() => {});
    refresh();
  });

  $('reports').addEventListener('click', (e) => {
    const value = e.target.closest('[data-copy]')?.dataset.copy;
    if (!value) return;
    navigator.clipboard?.writeText(value);
    $('whProtocolo').value = value;
    e.target.textContent = 'copiado';
  });

  document.querySelector('.iw-filters').addEventListener('click', (e) => {
    const button = e.target.closest('.iw-filter');
    if (!button) return;
    eventFilter = button.dataset.filter;
    for (const b of document.querySelectorAll('.iw-filter')) b.classList.toggle('active', b === button);
    if (lastState) renderEvents(lastState.events);
  });

  $('events').addEventListener('toggle', (e) => {
    const id = e.target.dataset?.event;
    if (!id) return;
    if (e.target.open) openEvents.add(id); else openEvents.delete(id);
  }, true);

  $('resetState').addEventListener('click', async () => {
    if (!window.confirm('Limpar perfis, fluxos, relatórios, agendamentos e eventos do mock?')) return;
    await request('DELETE', '/state').catch((error) => window.alert(error.message));
    refresh();
  });

  refresh();
  setInterval(refresh, POLL_MS);
})();
