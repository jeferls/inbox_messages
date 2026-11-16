(() => {
  const API = '/api/iugu-mock';
  const $ = (id) => document.getElementById(id);
  const state = { overview: null, accounts: [], detail: null };

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const json = (value) => `<pre>${esc(JSON.stringify(value, null, 2))}</pre>`;
  const date = (value) => (value ? new Date(value).toLocaleString('pt-BR') : '—');

  async function api(method, path, body) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function pill(text, tone) {
    return `<span class="pill pill-${tone}">${esc(text)}</span>`;
  }

  const STATUS_TONE = {
    paid: 'green', externally_paid: 'green', pending: 'amber', in_analysis: 'amber', canceled: 'gray', expired: 'gray',
    refunded: 'blue', partially_refunded: 'blue', chargeback: 'red', in_protest: 'red',
  };
  const statusPill = (status) => pill(status, STATUS_TONE[status] ?? 'gray');

  function kycPill(account) {
    if (account.master) return pill('mestre', 'blue');
    if (!account.active) return pill('desativada', 'gray');
    const status = account.last_verification_request_status;
    if (status === 'accepted') return pill('aprovado', 'green');
    if (status === 'rejected') return pill('rejeitado', 'red');
    if (status === 'pending') return pill('em análise', 'amber');
    return pill('não enviado', 'gray');
  }

  function copyButton(value) {
    return value ? `<button class="copy" data-copy="${esc(value)}">copiar</button>` : '';
  }

  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-copy]');
    if (!target) return;
    event.stopPropagation();
    navigator.clipboard?.writeText(target.dataset.copy);
    target.textContent = 'copiado';
    setTimeout(() => { target.textContent = 'copiar'; }, 1200);
  });

  // ─── Tabs ────────────────────────────────────────────────────────────────────

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${tab.dataset.tab}`));
      if (tab.dataset.tab === 'invoices') loadInvoices();
      if (tab.dataset.tab === 'requests') loadRequests();
    });
  });

  // ─── Overview / settings ─────────────────────────────────────────────────────

  async function loadOverview() {
    const overview = await api('GET', '/overview');
    state.overview = overview;
    $('conn-direct').textContent = overview.connection.directUrl;
    $('conn-proxy').textContent = overview.connection.proxyBaseUrl;
    $('conn-token').textContent = overview.connection.proxyGreennToken;
    $('conn-webhook').textContent = overview.settings.webhookUrl;
    $('count-accounts').textContent = overview.counts.accounts;
    $('count-invoices').textContent = overview.counts.invoices;

    const s = overview.settings;
    $('s-cardScenario').innerHTML = `<option value="auto">Automático (pelos 4 últimos dígitos)</option>${Object.entries(overview.cardScenarios)
      .map(([key, value]) => `<option value="${key}">${esc(value.label)} (LR ${value.lr})</option>`)
      .join('')}`;
    $('card-hint').innerHTML = `Automático: final ${Object.entries(overview.cardByLast4)
      .map(([last4, key]) => `<b>${last4}</b> = ${esc(overview.cardScenarios[key].label)}`)
      .join(' · ')}; qualquer outro final aprova. Por request: header <code>X-Mock-Scenario</code>.`;
    $('s-cardScenario').value = s.cardScenario;
    $('s-verificationOutcome').value = s.verificationOutcome === 'auto' ? 'accepted' : s.verificationOutcome;
    $('s-autoPaySeconds').value = s.autoPaySeconds;
    $('s-autoWebhooks').checked = s.autoWebhooks;
    $('s-webhookUrl').value = s.webhookUrl;
    $('s-strict').checked = s.strict;
    $('s-lenientAuth').checked = s.lenientAuth;
    $('s-fault-route').innerHTML = `<option value="">Nenhuma</option><option value="*">Todas as rotas</option>${overview.routes
      .map((r) => `<option value="${r.name}">${esc(r.name)} — ${r.method} ${esc(r.path)}</option>`)
      .join('')}`;
    $('s-fault-kind').innerHTML = Object.entries(overview.faultKinds).map(([key, label]) => `<option value="${key}">${esc(label)}</option>`).join('');
    $('s-fault-route').value = s.fault?.route ?? '';
    if (s.fault) {
      $('s-fault-kind').value = s.fault.kind;
      $('s-fault-remaining').value = s.fault.remaining;
      $('s-fault-channel').value = s.fault.channel ?? 'any';
    }
  }

  $('save-settings').addEventListener('click', async () => {
    const route = $('s-fault-route').value;
    try {
      await api('PUT', '/settings', {
        cardScenario: $('s-cardScenario').value,
        verificationOutcome: $('s-verificationOutcome').value,
        autoPaySeconds: Number($('s-autoPaySeconds').value) || 0,
        autoWebhooks: $('s-autoWebhooks').checked,
        webhookUrl: $('s-webhookUrl').value.trim(),
        strict: $('s-strict').checked,
        lenientAuth: $('s-lenientAuth').checked,
        fault: route
          ? { route, kind: $('s-fault-kind').value, remaining: Number($('s-fault-remaining').value) || 1, channel: $('s-fault-channel').value }
          : null,
      });
      $('status-settings').textContent = 'Salvo.';
      await loadOverview();
    } catch (err) {
      $('status-settings').textContent = err.message;
    }
  });

  $('reset-data').addEventListener('click', async () => {
    if (!confirm('Apagar todas as subcontas, faturas, clientes, cartões e o histórico do mock?')) return;
    await api('DELETE', '/data');
    $('status-settings').textContent = 'Dados apagados.';
    await refreshAll();
  });

  // ─── Accounts ────────────────────────────────────────────────────────────────

  async function loadAccounts() {
    const { items } = await api('GET', '/accounts');
    state.accounts = items;
    $('count-accounts').textContent = items.length;
    $('accounts-body').innerHTML = items.length
      ? items.map((a) => `
        <tr class="clickable" data-account="${a.id}">
          <td class="mono">${esc(a.id)}${copyButton(a.id)}</td>
          <td>${esc(a.name)}${a.website ? `<div class="muted">${esc(a.website)}</div>` : ''}</td>
          <td>${kycPill(a)}</td>
          <td>${a.can_receive ? pill('sim', 'green') : pill('não', 'gray')}</td>
          <td>${esc(a.balance)}</td>
          <td class="muted">${a.bank_account ? `${esc(a.bank_account.bank)} ag ${esc(a.bank_account.agency)} cc ${esc(a.bank_account.account)} (${esc(a.bank_account.account_type)})` : '—'}</td>
          <td>${a.invoices ?? 0}</td>
          <td class="muted">${date(a.created_at)}</td>
        </tr>`).join('')
      : '<tr><td colspan="8" class="muted">Nenhuma subconta ainda.</td></tr>';
    const filter = $('filter-account');
    const current = filter.value;
    filter.innerHTML = `<option value="">Todas as contas</option>${items.map((a) => `<option value="${a.id}">${esc(a.name)} (${a.id.slice(0, 8)}…)</option>`).join('')}`;
    filter.value = current;
  }

  $('accounts-body').addEventListener('click', (event) => {
    const row = event.target.closest('[data-account]');
    if (row) openAccount(row.dataset.account);
  });
  $('refresh-accounts').addEventListener('click', loadAccounts);
  $('create-account').addEventListener('click', async () => {
    try {
      const account = await api('POST', '/accounts', { name: $('new-account-name').value.trim() || undefined });
      $('status-accounts').textContent = `Subconta ${account.id} criada.`;
      $('new-account-name').value = '';
      await loadAccounts();
    } catch (err) {
      $('status-accounts').textContent = err.message;
    }
  });

  // ─── Invoices ────────────────────────────────────────────────────────────────

  async function loadInvoices() {
    const params = new URLSearchParams();
    if ($('filter-account').value) params.set('account_id', $('filter-account').value);
    if ($('filter-status').value) params.set('status', $('filter-status').value);
    if ($('filter-q').value.trim()) params.set('q', $('filter-q').value.trim());
    const { items } = await api('GET', `/invoices?${params}`);
    const names = Object.fromEntries(state.accounts.map((a) => [a.id, a.name]));
    $('invoices-body').innerHTML = items.length
      ? items.map((i) => `
        <tr class="clickable" data-invoice="${i.id}">
          <td class="mono">${esc(i.id)}${copyButton(i.id)}${i.order_id ? `<div class="muted">order ${esc(i.order_id)}</div>` : ''}</td>
          <td>${esc(names[i.account_id] ?? i.account_id.slice(0, 8))}</td>
          <td>${statusPill(i.status)}${i.lr && i.lr !== '00' ? `<div class="muted">LR ${esc(i.lr)}</div>` : ''}</td>
          <td class="muted">${esc(i.payment_method ?? i.payable_with.join(', '))}${i.installments ? ` · ${i.installments}x` : ''}${i.card_last4 ? ` · final ${esc(i.card_last4)}` : ''}</td>
          <td>${esc(i.total)}${i.refunded_cents ? `<div class="muted">estornado ${(i.refunded_cents / 100).toFixed(2)}</div>` : ''}</td>
          <td>${esc(i.payer_name ?? i.email)}</td>
          <td>${i.splits ? `${i.splits}${i.split_ignored ? ' ' + pill('ignorado', 'red') : ''}` : '—'}</td>
          <td>${i.warnings ? pill(i.warnings, 'amber') : '—'}</td>
          <td class="muted">${date(i.created_at)}</td>
        </tr>`).join('')
      : '<tr><td colspan="9" class="muted">Nenhuma fatura.</td></tr>';
  }

  $('invoices-body').addEventListener('click', (event) => {
    const row = event.target.closest('[data-invoice]');
    if (row) openInvoice(row.dataset.invoice);
  });
  $('refresh-invoices').addEventListener('click', loadInvoices);
  ['filter-account', 'filter-status'].forEach((id) => $(id).addEventListener('change', loadInvoices));
  let searchTimer;
  $('filter-q').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadInvoices, 300);
  });

  // ─── Requests ────────────────────────────────────────────────────────────────

  function requestItem(r) {
    const tone = r.status >= 500 || r.status === 0 ? 'red' : r.status >= 400 ? 'amber' : 'green';
    return `<details class="req-item">
      <summary>${pill(r.channel, r.channel === 'proxy' ? 'blue' : r.channel === 'webhook' ? 'amber' : 'gray')}
        ${pill(r.status || 'erro', tone)} <b>${esc(r.method)}</b> <span class="mono">${esc(r.path)}</span>
        <span class="muted">${esc(r.route ?? '')} · ${esc(r.auth ?? '')} · ${r.duration_ms ?? '—'}ms · ${date(r.created_at)}</span>
        ${r.warnings?.length ? pill(`${r.warnings.length} aviso(s)`, 'amber') : ''}</summary>
      ${r.warnings?.length ? `<ul class="warn-list">${r.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      <div class="muted" style="margin-top:8px">Request</div>${json(r.request_body)}
      <div class="muted" style="margin-top:8px">Response</div>${json(r.response_body)}
    </details>`;
  }

  async function loadRequests() {
    const channel = $('filter-channel').value;
    const data = await api('GET', `/requests?limit=100${channel ? `&channel=${channel}` : ''}`);
    $('count-requests').textContent = data.total;
    $('requests-list').innerHTML = data.items.length ? data.items.map(requestItem).join('') : '<p class="muted">Nenhuma requisição registrada.</p>';
  }

  $('refresh-requests').addEventListener('click', loadRequests);
  $('filter-channel').addEventListener('change', loadRequests);
  $('clear-requests').addEventListener('click', async () => {
    await api('DELETE', '/requests');
    await loadRequests();
  });

  // ─── Detail modal ────────────────────────────────────────────────────────────

  function openModal(title, actions, tabs) {
    $('detail-title').textContent = title;
    $('detail-actions').innerHTML = actions.map((a) => `<button data-act="${a.key}" class="${a.danger ? 'danger' : ''}">${esc(a.label)}</button>`).join('');
    $('detail-actions').style.display = actions.length ? 'flex' : 'none';
    $('detail-tabs').innerHTML = tabs.map((t, i) => `<button class="modal-tab ${i === 0 ? 'active' : ''}" data-view="${i}">${esc(t.label)}</button>`).join('');
    state.detail = { actions, tabs };
    $('detail-body').innerHTML = tabs[0].render();
    $('detail-modal').classList.add('open');
  }

  $('detail-tabs').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-view]');
    if (!tab) return;
    document.querySelectorAll('#detail-tabs .modal-tab').forEach((t) => t.classList.toggle('active', t === tab));
    $('detail-body').innerHTML = state.detail.tabs[Number(tab.dataset.view)].render();
  });
  $('detail-actions').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-act]');
    if (!button) return;
    const action = state.detail.actions.find((a) => a.key === button.dataset.act);
    try {
      button.disabled = true;
      await action.run();
    } catch (err) {
      alert(err.message);
    } finally {
      button.disabled = false;
    }
  });
  $('detail-close').addEventListener('click', () => $('detail-modal').classList.remove('open'));
  $('detail-modal').addEventListener('click', (event) => {
    if (event.target.id === 'detail-modal') $('detail-modal').classList.remove('open');
  });

  function kv(rows) {
    return `<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
  }

  async function openAccount(id) {
    const d = await api('GET', `/accounts/${id}`);
    const a = d.stored;
    const act = (body) => async () => {
      await api('POST', `/accounts/${id}/actions`, body);
      await refreshAll();
      await openAccount(id);
    };
    const actions = a.master ? [] : [
      { key: 'approve', label: 'Aprovar KYC', run: act({ action: 'verify', status: 'accepted' }) },
      {
        key: 'reject',
        label: 'Rejeitar KYC',
        run: async () => {
          const docs = prompt('Documentos a pedir de novo (separados por vírgula), ex.: address_proof,selfie', 'address_proof');
          if (docs === null) return;
          const feedback = prompt('Motivo exibido em last_verification_request_feedback', 'Documento ilegível') ?? null;
          await act({ action: 'verify', status: 'rejected', feedback, requested_documents: docs.split(',').map((s) => s.trim()).filter(Boolean) })();
        },
      },
      { key: 'reset', label: 'Permitir novo KYC', run: act({ action: 'reset_verification' }) },
      {
        key: 'balance',
        label: 'Definir saldo',
        run: async () => {
          const value = prompt('Saldo em reais', ((a.balance_cents ?? 0) / 100).toFixed(2));
          if (value !== null) await act({ action: 'balance', balance_cents: Math.round(Number(value.replace(',', '.')) * 100) })();
        },
      },
      { key: 'age', label: 'Envelhecer 25h (janela de 24h)', run: act({ action: 'age', hours: 25 }) },
      ...(a.active === false ? [{ key: 'reactivate', label: 'Reativar', run: act({ action: 'reactivate' }) }] : []),
    ];
    const tokenRow = (label, raw, sealed) => [label, `<span class="mono">${esc(raw)}</span>${copyButton(raw)}<div class="muted mono">${esc(sealed)}${copyButton(sealed)}</div>`];
    openModal(`Subconta ${a.name} · ${a.id}`, actions, [
      {
        label: 'Resumo',
        render: () => kv([
          ['account_id', `<span class="mono">${esc(a.id)}</span>${copyButton(a.id)}`],
          ['Nome', esc(a.name)],
          ['KYC', `${kycPill(d.summary)} ${a.verification?.feedback ? esc(a.verification.feedback) : ''}`],
          ['Pode receber', a.can_receive ? 'sim' : 'não'],
          ['Saldo', esc(d.summary.balance)],
          ['Site', esc(a.website ?? '—')],
          ['Documentos pedidos', esc((a.requested_documents ?? []).join(', ') || '—')],
          tokenRow('live_api_token (cru / envelope)', a.live_api_token, d.sealed.live_api_token),
          tokenRow('user_token (cru / envelope)', a.user_token, d.sealed.user_token),
          tokenRow('test_api_token (cru / envelope)', a.test_api_token, d.sealed.test_api_token),
          ['Tokens revogados', esc((a.revoked_user_tokens ?? []).length)],
          ['Criada', date(a.created_at)],
          ['Atualizada', date(a.updated_at)],
        ]),
      },
      {
        label: 'KYC enviado',
        render: () => (a.verification
          ? `${kv([
            ['ID da verificação', esc(a.verification.id)],
            ['Enviado em', date(a.verification.requested_at)],
            ['Token usado', esc(a.verification.token_tier)],
            ['Arquivos', Object.entries(a.verification.files).map(([k, f]) => `${esc(k)} (${f.bytes} bytes${f.mime ? `, ${esc(f.mime)}` : ''})`).join('<br>')],
          ])}<div class="muted" style="margin:10px 0 4px">data</div>${json(a.verification.data)}`
          : '<p class="muted">Nenhum request_verification recebido.</p>'),
      },
      { label: 'Configuração e domicílio', render: () => `${json({ configuration: a.configuration, bank_accounts: a.bank_accounts, documents: a.documents })}` },
      { label: `Faturas (${d.invoices.length})`, render: () => (d.invoices.length ? `<table class="data"><tbody>${d.invoices.map((i) => `<tr><td class="mono">${esc(i.id)}</td><td>${statusPill(i.status)}</td><td>${esc(i.total)}</td><td class="muted">${date(i.created_at)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Sem faturas.</p>') },
      { label: 'GET /accounts (Iugu)', render: () => json(d.iugu) },
      { label: 'Armazenado', render: () => json(a) },
      { label: `Requisições (${d.requests.length})`, render: () => d.requests.map(requestItem).join('') || '<p class="muted">Nada.</p>' },
    ]);
  }

  async function openInvoice(id) {
    const d = await api('GET', `/invoices/${id}`);
    const i = d.stored;
    const act = (body) => async () => {
      await api('POST', `/invoices/${id}/actions`, body);
      await refreshAll();
      await openInvoice(id);
    };
    const s = i.status;
    const actions = [];
    if (s === 'pending') {
      if (i.pix) actions.push({ key: 'pay_pix', label: 'Pagar Pix', run: act({ action: 'pay', method: 'pix' }) });
      if (i.bank_slip) actions.push({ key: 'pay_slip', label: 'Pagar boleto', run: act({ action: 'pay', method: 'bank_slip' }) });
      actions.push({ key: 'expire', label: 'Expirar', run: act({ action: 'expire' }) });
      actions.push({ key: 'ext', label: 'Pago externamente', run: act({ action: 'externally_paid' }) });
    }
    if (s === 'in_analysis') {
      actions.push({ key: 'approve', label: 'Aprovar análise', run: act({ action: 'approve_analysis' }) });
      actions.push({ key: 'refuse', label: 'Recusar análise', run: act({ action: 'refuse_analysis' }), danger: true });
    }
    if (['pending', 'in_analysis', 'expired'].includes(s)) actions.push({ key: 'cancel', label: 'Cancelar', run: act({ action: 'cancel' }), danger: true });
    if (['paid', 'partially_refunded'].includes(s)) {
      actions.push({ key: 'refund', label: 'Estornar total', run: act({ action: 'refund' }) });
      actions.push({
        key: 'refund_partial',
        label: 'Estorno parcial',
        run: async () => {
          const value = prompt('Valor do estorno em reais', '1.00');
          if (value !== null) await act({ action: 'refund', amount_cents: Math.round(Number(value.replace(',', '.')) * 100) })();
        },
      });
      actions.push({ key: 'protest', label: 'Contestação (in_protest)', run: act({ action: 'protest' }) });
    }
    if (['paid', 'partially_refunded', 'in_protest'].includes(s)) actions.push({ key: 'cb', label: 'Chargeback', run: act({ action: 'chargeback' }), danger: true });
    actions.push({ key: 'wh', label: 'Reenviar webhook', run: act({ action: 'webhook', event: 'invoice.status_changed' }) });

    const card = i.credit_card_transaction;
    openModal(`Fatura ${i.id}`, actions, [
      {
        label: 'Resumo',
        render: () => `${kv([
          ['transaction_id (id)', `<span class="mono">${esc(i.id)}</span>${copyButton(i.id)}`],
          ['Status', statusPill(s)],
          ['Conta', `<span class="mono">${esc(i.account_id)}</span> ${esc(i.account_name ?? '')}`],
          ['Total', esc(d.summary.total)],
          ['Meio', esc(i.payment_method ?? i.payable_with.join(', '))],
          ['Parcelas', esc(i.installments ?? '—')],
          ['Cartão', card ? `${esc(card.brand)} final ${esc(card.last4)} · ${esc(card.status)} · LR ${esc(card.lr)} · ${esc(card.message)}` : '—'],
          ['order_id', esc(i.order_id ?? '—')],
          ['Pagador', esc([i.payer?.name, i.payer?.cpf_cnpj, i.payer?.phone].filter(Boolean).join(' · ') || i.email)],
          ['Vencimento', esc(i.due_date)],
          ['Taxas', esc(i.taxes_paid_cents ?? '—')],
          ['advance_fee_cents', esc(i.advance_fee_cents ?? 'null')],
          ['Estornado (centavos)', esc(i.refunded_cents ?? 0)],
          ['Split', i.split_rules?.length ? `${i.split_rules.map((r) => `${esc(r.recipient_account_id)}: ${esc(r.cents ?? `${r.percent}%`)}`).join('<br>')}${i.split_ignored ? `<div>${pill('ignorado pela Iugu (soma >= total)', 'red')}</div>` : ''}` : '—'],
          ['Pix copia e cola', i.pix ? `<span class="mono">${esc(i.pix.qrcode_text)}</span>${copyButton(i.pix.qrcode_text)}` : '—'],
          ['Linha digitável', i.bank_slip ? `<span class="mono">${esc(i.bank_slip.digitable_line)}</span>${copyButton(i.bank_slip.digitable_line)}` : '—'],
          ['Página da fatura', `<a href="${esc(i.secure_url.replace(/^https?:\/\/[^/]+/, ''))}" target="_blank">abrir</a>`],
          ['Criada', date(i.created_at)],
          ['Paga', esc(i.paid_at ?? '—')],
        ])}${i.warnings?.length ? `<div class="muted" style="margin-top:12px">Divergências com a doc</div><ul class="warn-list">${i.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}`,
      },
      { label: 'GET /invoices (Iugu)', render: () => json(d.iugu) },
      { label: 'Visto pelo sec-proxy', render: () => `<p class="muted">Campos fora da allowlist (refunded_at_iso, chargeback_at_iso, protested_at_iso, updated_at...) não chegam a quem usa o proxy.</p>${json(d.proxy)}` },
      { label: 'Armazenado', render: () => json(i) },
      { label: `Requisições e webhooks (${d.requests.length})`, render: () => d.requests.map(requestItem).join('') || '<p class="muted">Nada.</p>' },
    ]);
  }

  async function refreshAll() {
    await loadOverview();
    await loadAccounts();
    if ($('panel-invoices').classList.contains('active')) await loadInvoices();
    if ($('panel-requests').classList.contains('active')) await loadRequests();
  }

  refreshAll().then(() => {
    const invoice = location.hash.match(/invoice=([0-9A-F]{32})/i)?.[1];
    if (invoice) openInvoice(invoice);
  });
})();
