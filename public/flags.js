const LS_KEY = 'flags-panel:backPath';

const backPathInput = document.getElementById('backPath');
const loadBtn = document.getElementById('loadBtn');
const statusLine = document.getElementById('statusLine');
const flagError = document.getElementById('flagError');
const flagList = document.getElementById('flagList');
const flagWarning = document.getElementById('flagWarning');
const flagFilter = document.getElementById('flagFilter');

const byUserBtn = document.getElementById('byUserBtn');

const flagUsersModal = document.getElementById('flagUsersModal');
const flagUsersTitle = document.getElementById('flagUsersTitle');
const flagUsersForm = document.getElementById('flagUsersForm');
const flagUsersNote = document.getElementById('flagUsersNote');
const flagUsersList = document.getElementById('flagUsersList');

const userModal = document.getElementById('userModal');
const userSearchForm = document.getElementById('userSearchForm');
const userAddForm = document.getElementById('userAddForm');
const userRemoveAll = document.getElementById('userRemoveAll');
const userNote = document.getElementById('userNote');
const userFlagList = document.getElementById('userFlagList');
const flagOptions = document.getElementById('flagOptions');

// loadedPath: path do último Carregar com sucesso; toda escrita usa ele, não o input (que pode ter sido editado).
const state = { flags: [], info: null, loadedPath: '', selectedFlag: null, selectedUser: null };
const currentPath = () => state.loadedPath;

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
      body: JSON.stringify({ path: currentPath(), flag, enabled: input.checked }),
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

function openModal(modal) {
  modal.hidden = false;
  modal.querySelector('input')?.focus();
}

function closeModal(modal) {
  modal.hidden = true;
}

for (const modal of [flagUsersModal, userModal]) {
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.matches('[data-close]')) closeModal(modal);
  });
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') [flagUsersModal, userModal].forEach(closeModal);
});

function setNote(node, message, isError = false) {
  node.textContent = message || '';
  node.style.color = isError ? '#b91c1c' : '';
}

// Desabilita o botão do form enquanto a requisição roda (evita duplicar no clique duplo).
async function submitting(form, fn) {
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    await fn();
  } finally {
    btn.disabled = false;
  }
}

function listRow(text, removeId) {
  const row = el('div', 'user-row');
  row.append(el('span', 'mono', text));
  const rm = el('button', 'danger', 'Remover');
  rm.type = 'button';
  rm.dataset.remove = removeId;
  row.append(rm);
  return row;
}

async function removeById(id, message) {
  if (!confirm(message)) return false;
  await api('DELETE', '/api/flags-panel/user-flags', { path: currentPath(), id });
  return true;
}

// ---- Modal: usuários de uma flag ----

async function loadFlagUsers(flag) {
  const data = await api('GET', `/api/flags-panel/user-flags?path=${encodeURIComponent(currentPath())}&flag=${encodeURIComponent(flag)}`);
  if (state.selectedFlag !== flag) return; // resposta atrasada de outra flag
  flagUsersList.replaceChildren();
  if (data.items.length === 0) flagUsersList.append(el('div', 'empty', 'Nenhum usuário com essa flag'));
  for (const item of data.items) {
    flagUsersList.append(listRow(`user_id ${item.user_id} - ${item.email || 'sem e-mail'} - ${item.created_at}`, item.id));
  }
}

async function openFlagUsers(flag) {
  state.selectedFlag = flag;
  flagUsersTitle.textContent = `Usuários com a flag ${flag}`;
  flagUsersList.replaceChildren(el('div', 'empty', 'Carregando...'));
  setNote(flagUsersNote, '');
  flagUsersForm.reset();
  openModal(flagUsersModal);
  try {
    await loadFlagUsers(flag);
  } catch (error) {
    setNote(flagUsersNote, error.message, true);
  }
}

flagUsersForm.addEventListener('submit', (e) => {
  e.preventDefault();
  submitting(flagUsersForm, async () => {
    try {
      const user = flagUsersForm.elements.user.value;
      const data = await api('POST', '/api/flags-panel/user-flags', { path: currentPath(), flag: state.selectedFlag, user });
      setNote(flagUsersNote, data.alreadyExisted ? `${data.email || data.user_id} já tinha essa flag` : `${data.email || data.user_id} adicionado`);
      flagUsersForm.reset();
      await loadFlagUsers(state.selectedFlag);
    } catch (error) {
      setNote(flagUsersNote, error.message, true);
    }
  });
});

flagUsersList.addEventListener('click', async (e) => {
  const id = e.target.dataset?.remove;
  if (!id) return;
  try {
    if (!(await removeById(id, 'Remover este usuário da flag?'))) return;
    setNote(flagUsersNote, 'Usuário removido da flag');
    await loadFlagUsers(state.selectedFlag);
  } catch (error) {
    setNote(flagUsersNote, error.message, true);
  }
});

// ---- Modal: flags de um usuário ----

async function loadUserFlags(user) {
  const data = await api('GET', `/api/flags-panel/user-flags?path=${encodeURIComponent(currentPath())}&user=${encodeURIComponent(user)}`);
  state.selectedUser = user;
  userModal.querySelector('h2').textContent = `Flags de ${data.email || 'user_id ' + data.user_id} (user_id ${data.user_id})`;
  userAddForm.hidden = false;
  userRemoveAll.hidden = data.items.length === 0;
  userFlagList.replaceChildren();
  if (data.items.length === 0) userFlagList.append(el('div', 'empty', 'Esse usuário não tem nenhuma flag'));
  for (const item of data.items) userFlagList.append(listRow(`${item.flag} - ${item.created_at}`, item.id));
}

function resetUserModal() {
  state.selectedUser = null;
  userModal.querySelector('h2').textContent = 'Flags por usuário';
  userSearchForm.reset();
  userAddForm.reset();
  userAddForm.hidden = true;
  userRemoveAll.hidden = true;
  userFlagList.replaceChildren();
  setNote(userNote, '');
}

byUserBtn.addEventListener('click', () => {
  resetUserModal();
  flagOptions.replaceChildren(...state.flags.map((f) => Object.assign(document.createElement('option'), { value: f.flag })));
  openModal(userModal);
});

userSearchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  submitting(userSearchForm, async () => {
    setNote(userNote, '');
    try {
      await loadUserFlags(userSearchForm.elements.user.value.trim());
    } catch (error) {
      userAddForm.hidden = true;
      userRemoveAll.hidden = true;
      userFlagList.replaceChildren();
      setNote(userNote, error.message, true);
    }
  });
});

userAddForm.addEventListener('submit', (e) => {
  e.preventDefault();
  submitting(userAddForm, async () => {
    try {
      const flag = userAddForm.elements.flag.value.trim();
      const data = await api('POST', '/api/flags-panel/user-flags', { path: currentPath(), flag, user: state.selectedUser });
      setNote(userNote, data.alreadyExisted ? `Usuário já tinha a flag ${flag}` : `Flag ${flag} adicionada`);
      userAddForm.reset();
      await loadUserFlags(state.selectedUser);
    } catch (error) {
      setNote(userNote, error.message, true);
    }
  });
});

userFlagList.addEventListener('click', async (e) => {
  const id = e.target.dataset?.remove;
  if (!id) return;
  try {
    if (!(await removeById(id, 'Remover esta flag do usuário?'))) return;
    setNote(userNote, 'Flag removida do usuário');
    await loadUserFlags(state.selectedUser);
  } catch (error) {
    setNote(userNote, error.message, true);
  }
});

userRemoveAll.addEventListener('click', async () => {
  if (!confirm('Remover TODAS as flags deste usuário?')) return;
  try {
    const data = await api('DELETE', '/api/flags-panel/user-flags', { path: currentPath(), user: state.selectedUser });
    setNote(userNote, `${data.removed} flag(s) removida(s)`);
    await loadUserFlags(state.selectedUser);
  } catch (error) {
    setNote(userNote, error.message, true);
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
    state.loadedPath = path;
    byUserBtn.disabled = false;
    state.flags = data.flags;
    state.info = data;
    renderStatus();
    render();
  } catch (error) {
    showError(error.message);
  }
}

flagList.addEventListener('click', (e) => {
  if (e.target.dataset?.users) openFlagUsers(e.target.dataset.users);
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
