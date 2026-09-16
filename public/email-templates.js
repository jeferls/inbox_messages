const groupsEl = document.getElementById('groups');
const listError = document.getElementById('listError');
const selectedLabel = document.getElementById('selectedLabel');
const recipientInput = document.getElementById('recipientInput');
const selectAllBtn = document.getElementById('selectAllBtn');
const selectNoneBtn = document.getElementById('selectNoneBtn');
const sendSelectedBtn = document.getElementById('sendSelectedBtn');
const sendAllBtn = document.getElementById('sendAllBtn');
const reloadBtn = document.getElementById('reloadBtn');
const resultsPanel = document.getElementById('resultsPanel');
const resultsTitle = document.getElementById('resultsTitle');
const resultsBody = document.getElementById('resultsBody');

let templates = [];

loadTemplates();

selectAllBtn.addEventListener('click', () => setAll(true));
selectNoneBtn.addEventListener('click', () => setAll(false));
reloadBtn.addEventListener('click', loadTemplates);
sendSelectedBtn.addEventListener('click', () => send(selectedLabels()));
sendAllBtn.addEventListener('click', () => send([]));
groupsEl.addEventListener('change', updateSelection);

async function loadTemplates() {
  listError.hidden = true;
  groupsEl.innerHTML = '<div class="empty">Carregando templates...</div>';
  try {
    const res = await fetch('/api/email-templates');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    templates = data.templates;
    renderGroups();
  } catch (error) {
    groupsEl.innerHTML = '';
    listError.textContent = `Não foi possível listar os templates: ${error.message}`;
    listError.hidden = false;
  }
  updateSelection();
}

// Groups by the folder right under emails/ (account, orders, subscriptions...).
function renderGroups() {
  const groups = new Map();
  for (const t of templates) {
    const folder = t.view.split('.')[1];
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder).push(t);
  }

  groupsEl.innerHTML = '';
  for (const [folder, items] of groups) {
    const group = document.createElement('div');
    group.className = 'group';

    const head = document.createElement('div');
    head.className = 'group-head';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.dataset.group = folder;
    head.append(toggle, document.createTextNode(folder), Object.assign(document.createElement('span'), { className: 'count', textContent: `(${items.length})` }));

    const list = document.createElement('div');
    list.className = 'items';
    for (const t of items) {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = t.label;
      cb.dataset.folder = folder;
      const code = document.createElement('code');
      code.textContent = t.view.replace(`emails.${folder}.`, '');
      label.append(cb, code);
      if (t.variant) label.append(Object.assign(document.createElement('span'), { className: 'variant', textContent: `[${t.variant}]` }));
      list.append(label);
    }

    toggle.addEventListener('change', () => {
      list.querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.checked = toggle.checked; });
      updateSelection();
    });

    group.append(head, list);
    groupsEl.append(group);
  }
}

function itemCheckboxes() {
  return [...groupsEl.querySelectorAll('input[data-folder]')];
}

function selectedLabels() {
  return itemCheckboxes().filter((cb) => cb.checked).map((cb) => cb.value);
}

function setAll(checked) {
  groupsEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.checked = checked; });
  updateSelection();
}

function updateSelection() {
  const count = selectedLabels().length;
  selectedLabel.textContent = `${count} selecionado${count === 1 ? '' : 's'}`;
  sendSelectedBtn.disabled = count === 0;
  // Group toggle mirrors its items.
  groupsEl.querySelectorAll('input[data-group]').forEach((toggle) => {
    const items = itemCheckboxes().filter((cb) => cb.dataset.folder === toggle.dataset.group);
    const checked = items.filter((cb) => cb.checked).length;
    toggle.checked = checked === items.length;
    toggle.indeterminate = checked > 0 && checked < items.length;
  });
}

async function send(labels) {
  const total = labels.length || templates.length;
  setBusy(true, `Renderizando ${total} template${total === 1 ? '' : 's'}...`);
  resultsPanel.hidden = true;

  try {
    const res = await fetch('/api/email-templates/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels, recipient: recipientInput.value.trim() || null }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    renderResults(data);
  } catch (error) {
    resultsTitle.textContent = 'Falha no envio';
    resultsBody.innerHTML = '';
    const tr = resultsBody.insertRow();
    const td = tr.insertCell();
    td.colSpan = 4;
    td.className = 'error-text';
    td.textContent = error.message;
    resultsPanel.hidden = false;
  } finally {
    setBusy(false);
  }
}

function renderResults({ sent, failed, results }) {
  resultsTitle.textContent = `${sent} enviado${sent === 1 ? '' : 's'} para o Inbox` + (failed ? `, ${failed} com erro` : '');
  resultsBody.innerHTML = '';
  // Errors first so they are visible without scrolling.
  for (const r of [...results].sort((a, b) => Number(a.ok) - Number(b.ok))) {
    const tr = resultsBody.insertRow();
    const label = tr.insertCell();
    const code = document.createElement('code');
    code.textContent = r.label;
    label.append(code);
    const status = tr.insertCell();
    status.innerHTML = `<span class="pill ${r.ok ? 'ok' : 'err'}">${r.ok ? 'OK' : 'ERRO'}</span>`;
    tr.insertCell().textContent = r.recipient || '';
    const detail = tr.insertCell();
    if (r.ok) {
      detail.textContent = `Inbox #${r.id}`;
    } else {
      detail.className = 'error-text';
      detail.textContent = r.error;
    }
  }
  resultsPanel.hidden = false;
}

function setBusy(busy, message = '') {
  [sendSelectedBtn, sendAllBtn, reloadBtn, selectAllBtn, selectNoneBtn].forEach((b) => { b.disabled = busy; });
  if (!busy) updateSelection();
  if (busy) selectedLabel.textContent = message;
}
