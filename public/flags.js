const LS_KEY = 'flags-panel:backPath';

const backPathInput = document.getElementById('backPath');
const loadBtn = document.getElementById('loadBtn');
const statusLine = document.getElementById('statusLine');
const flagError = document.getElementById('flagError');
const flagList = document.getElementById('flagList');
const flagWarning = document.getElementById('flagWarning');
const flagFilter = document.getElementById('flagFilter');

const userFlagsPanel = document.getElementById('userFlagsPanel');
const userFlagsTitle = document.getElementById('userFlagsTitle');
const userFlagsList = document.getElementById('userFlagsList');
const userForm = document.getElementById('userForm');
const userRef = document.getElementById('userRef');

const state = { flags: [], info: null, selectedFlag: null };
const currentPath = () => backPathInput.value.trim();

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

function showError(message) {
  flagError.textContent = message;
  flagError.hidden = !message;
}

function showWarning(message) {
  flagWarning.textContent = message;
  flagWarning.hidden = !message;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderStatus() {
  if (!state.info) return;
  const on = state.flags.filter((f) => f.enabled).length;
  const { db, envFile, seederFile } = state.info;
  statusLine.textContent = `Banco ${db.host}:${db.port}/${db.database} - .env: ${envFile} - seeder: ${seederFile} - ${state.flags.length} flags (${on} ligadas)`;
}

function render() {
  flagList.replaceChildren();
  const term = flagFilter.value.trim().toLowerCase();
  const visible = state.flags.filter((f) => f.flag.toLowerCase().includes(term));
  if (visible.length === 0) {
    flagList.append(el('div', 'empty', 'Nenhuma flag encontrada'));
    return;
  }
  for (const f of visible) {
    const row = el('div', 'flag-row');
    row.append(el('span', 'mono', f.flag));
    if (!f.inSeeder) row.append(el('span', 'badge st-pending', 'fora do seeder'));

    const label = el('label', 'switch');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.flag = f.flag;
    input.checked = f.enabled;
    label.append(input, el('span', 'slider'));
    const usersBtn = el('button', '', 'Usuários');
    usersBtn.type = 'button';
    usersBtn.dataset.users = f.flag;
    row.append(usersBtn, label);
    flagList.append(row);
  }
}

async function toggle(input) {
  const flag = input.dataset.flag;
  input.disabled = true;
  showError('');
  showWarning('');
  try {
    const res = await fetch('/api/flags-panel/flag', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: backPathInput.value.trim(), flag, enabled: input.checked }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    state.flags.find((f) => f.flag === flag).enabled = data.enabled;
    renderStatus();
    if (data.cacheError) showWarning(`Flag gravada, mas o cache não foi limpo: ${data.cacheError}`);
  } catch (error) {
    input.checked = !input.checked;
    showError(`Não foi possível atualizar a flag: ${error.message}`);
  } finally {
    input.disabled = false;
  }
}

async function loadUsers(flag) {
  state.selectedFlag = flag;
  showError('');
  try {
    const data = await api('GET', `/api/flags-panel/user-flags?path=${encodeURIComponent(currentPath())}&flag=${encodeURIComponent(flag)}`);
    userFlagsPanel.hidden = false;
    userFlagsTitle.textContent = `Usuários com a flag ${flag}`;
    userFlagsList.replaceChildren();
    if (data.items.length === 0) userFlagsList.append(el('div', 'empty', 'Nenhum usuário com essa flag'));
    for (const item of data.items) {
      const row = el('div', 'user-row');
      row.append(el('span', 'mono', `#${item.id} - user_id ${item.user_id} - ${item.email || 'sem e-mail'} - ${item.created_at}`));
      const rm = el('button', 'danger', 'Remover');
      rm.type = 'button';
      rm.dataset.remove = item.id;
      row.append(rm);
      userFlagsList.append(row);
    }
  } catch (error) {
    showError(error.message);
  }
}

userFlagsList.addEventListener('click', async (e) => {
  const id = e.target.dataset?.remove;
  if (!id || !confirm('Remover este usuário da flag?')) return;
  try {
    await api('DELETE', '/api/flags-panel/user-flags', { path: currentPath(), id });
    loadUsers(state.selectedFlag);
  } catch (error) {
    showError(error.message);
  }
});

userForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = await api('POST', '/api/flags-panel/user-flags', { path: currentPath(), flag: state.selectedFlag, user: userRef.value });
    statusLine.textContent = data.alreadyExisted ? 'Usuário já tinha essa flag' : 'Usuário adicionado';
    userRef.value = '';
    loadUsers(state.selectedFlag);
  } catch (error) {
    showError(error.message);
  }
});

async function load() {
  const path = backPathInput.value.trim();
  showError('');
  try {
    const res = await fetch('/api/flags-panel/flags?path=' + encodeURIComponent(path));
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    localStorage.setItem(LS_KEY, path);
    state.flags = data.flags;
    state.info = data;
    renderStatus();
    render();
  } catch (error) {
    showError(error.message);
  }
}

flagList.addEventListener('click', (e) => {
  if (e.target.dataset?.users) loadUsers(e.target.dataset.users);
});
flagList.addEventListener('change', (e) => {
  if (e.target.matches('input[data-flag]')) toggle(e.target);
});
flagFilter.addEventListener('input', render);
loadBtn.addEventListener('click', load);
backPathInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') load();
});

backPathInput.value = localStorage.getItem(LS_KEY) || '';
if (backPathInput.value) load();
