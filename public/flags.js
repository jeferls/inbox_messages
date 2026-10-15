const LS_KEY = 'flags-panel:backPath';

const backPathInput = document.getElementById('backPath');
const loadBtn = document.getElementById('loadBtn');
const statusLine = document.getElementById('statusLine');
const flagError = document.getElementById('flagError');
const flagList = document.getElementById('flagList');

const state = { flags: [], info: null };

function showError(message) {
  flagError.textContent = message;
  flagError.hidden = !message;
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
  if (state.flags.length === 0) {
    flagList.append(el('div', 'empty', 'Nenhuma flag encontrada'));
    return;
  }
  for (const f of state.flags) {
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

loadBtn.addEventListener('click', load);
backPathInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') load();
});

backPathInput.value = localStorage.getItem(LS_KEY) || '';
if (backPathInput.value) load();
