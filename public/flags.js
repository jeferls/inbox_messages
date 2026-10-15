const LS_KEY = 'flags-panel:backPath';

const backPathInput = document.getElementById('backPath');
const loadBtn = document.getElementById('loadBtn');
const statusLine = document.getElementById('statusLine');
const flagError = document.getElementById('flagError');
const flagList = document.getElementById('flagList');
const flagWarning = document.getElementById('flagWarning');
const flagFilter = document.getElementById('flagFilter');

const state = { flags: [], info: null };

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
    row.append(label);
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
