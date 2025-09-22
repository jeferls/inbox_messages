const listEl = document.getElementById('list');
const refreshBtn = document.getElementById('refreshBtn');
const clearBtn = document.getElementById('clearBtn');
const logsBtn = document.getElementById('logsBtn');
const searchInput = document.getElementById('searchInput');
const unreadOnly = document.getElementById('unreadOnly');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const pageInfo = document.getElementById('pageInfo');
const totalSpan = document.getElementById('totalSpan');

const emptyDetail = document.getElementById('emptyDetail');
const detailCard = document.getElementById('detailCard');
const detailTitle = document.getElementById('detailTitle');
const detailRecipient = document.getElementById('detailRecipient');
const detailDate = document.getElementById('detailDate');
const detailBody = document.getElementById('detailBody');

// Logs modal elements
const logsModal = document.getElementById('logsModal');
const logsContent = document.getElementById('logsContent');
const logsRefreshBtn = document.getElementById('logsRefreshBtn');
const logsClearBtn = document.getElementById('logsClearBtn');
const logsCloseBtn = document.getElementById('logsCloseBtn');

const state = {
  page: 0,
  limit: 10,
  search: '',
  unread: false,
  total: 0,
};

async function fetchEmails() {
  const params = new URLSearchParams();
  params.set('limit', String(state.limit));
  params.set('page', String(state.page));
  if (state.search) params.set('search', state.search);
  if (state.unread) params.set('unread', '1');
  const res = await fetch(`/api/emails?${params.toString()}`);
  if (!res.ok) throw new Error('Falha ao buscar emails');
  return res.json();
}

function renderList(items) {
  // Remove itens antigos, mas mantém o cabeçalho da lista
  const children = Array.from(listEl.children);
  for (const el of children) {
    if (el.id !== 'listHeader') el.remove();
  }
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Nenhum email ainda';
    listEl.appendChild(empty);
    return;
  }
  for (const item of items) {
    const div = document.createElement('div');
    div.className = 'item ' + (item.read ? 'read' : 'unread');
    div.dataset.id = item.id;
    div.innerHTML = `
      <div class="top">
        <span class="title">${escapeHtml(item.title)}</span>
        <time>${fmtDate(item.created_at)}</time>
      </div>
      <div class="sub">Para: ${escapeHtml(item.recipient)}</div>
    `;
    div.addEventListener('click', () => openEmail(item.id));
    listEl.appendChild(div);
  }
}

async function openEmail(id) {
  const res = await fetch(`/api/emails/${id}`);
  if (!res.ok) return alert('Falha ao abrir email');
  const email = await res.json();
  showDetail(email);
  // Atualiza listagem para refletir como lido
  await load();
}

function showDetail(email) {
  emptyDetail.hidden = true;
  detailCard.hidden = false;
  detailTitle.textContent = email.title;
  detailRecipient.textContent = `Para: ${email.recipient}`;
  detailDate.textContent = fmtDate(email.created_at);
  // Renderiza HTML do email com sanitização
  const bodyRaw = email.body_email ?? email.body;
  const safeHtml = sanitizeHtml(bodyRaw);
  detailBody.innerHTML = safeHtml;
  enhanceEmailBody(detailBody);
}

async function clearAll() {
  if (!confirm('Tem certeza que deseja apagar todos os emails?')) return;
  const res = await fetch('/api/emails', { method: 'DELETE' });
  if (!res.ok) return alert('Falha ao limpar');
  // Reseta UI
  detailCard.hidden = true;
  emptyDetail.hidden = false;
  await load();
}

async function load() {
  try {
    const data = await fetchEmails();
    state.total = data.total || 0;
    totalSpan.textContent = `${state.total} email${state.total === 1 ? '' : 's'}`;
    const totalPages = Math.max(1, Math.ceil(state.total / state.limit));
    const currentPage = Math.min(state.page + 1, totalPages);
    pageInfo.textContent = `${currentPage}/${totalPages}`;
    prevBtn.disabled = state.page <= 0;
    nextBtn.disabled = state.page + 1 >= totalPages;
    renderList(data.items || []);
  } catch (e) {
    console.error(e);
  }
}

function fmtDate(s) {
  try {
    // s está em UTC textual do SQLite; mostra local
    const d = new Date(s + 'Z');
    return d.toLocaleString();
  } catch {
    return s;
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

refreshBtn.addEventListener('click', load);
clearBtn.addEventListener('click', clearAll);
logsBtn.addEventListener('click', () => {
  if (logsModal.hidden) openLogs(); else closeLogs();
});
prevBtn.addEventListener('click', () => { if (state.page > 0) { state.page -= 1; load(); } });
nextBtn.addEventListener('click', () => { state.page += 1; load(); });
searchInput.addEventListener('input', debounce(() => { state.page = 0; state.search = searchInput.value.trim(); load(); }, 250));
unreadOnly.addEventListener('change', () => { state.page = 0; state.unread = unreadOnly.checked; load(); });

// Atualização automática a cada 5s
setInterval(load, 5000);

load();

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

// Sanitiza HTML de forma segura; usa DOMPurify se disponível
function sanitizeHtml(raw) {
  let str = String(raw ?? '');

  // Se veio HTML completo (doctype/html/body), extrai apenas o conteúdo do <body>
  // Isso evita que tags de documento virem texto dentro do fragmento
  if (/(<\s*!doctype)|(<\s*html[\s>])|(<\s*body[\s>])/i.test(str)) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(str, 'text/html');
      if (doc && doc.body) {
        str = doc.body.innerHTML;
      }
    } catch {}
  }

  // Caso o conteúdo tenha vindo HTML-encodado (ex.: &lt;p&gt;...), decodifica uma vez
  if (str.includes('&lt;') && !str.includes('<')) {
    try {
      const tmp = document.createElement('div');
      tmp.innerHTML = str;
      str = tmp.textContent || tmp.innerText || str;
    } catch {}
  }

  // Normaliza tags malformadas comuns (ex.: "</  p>" -> "</p>", "<  p>" -> "<p>")
  try {
    // Remove espaços entre "</" e o nome da tag e antes de ">" em tags de fechamento
    str = str.replace(/<\s*\/\s*([a-z0-9:-]+)\s*>/gi, '</$1>');
    // Remove espaços logo após "<" antes do nome da tag em tags de abertura
    str = str.replace(/<\s+([a-z0-9:-])/gi, '<$1');
  } catch {}
  if (window.DOMPurify && typeof window.DOMPurify.sanitize === 'function') {
    try {
      return window.DOMPurify.sanitize(str, { USE_PROFILES: { html: true } });
    } catch {
      // cai no fallback abaixo
    }
  }
  // Fallback simples (menos robusto) caso DOMPurify não carregue
  let s = str;
  s = s.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<(iframe|object|embed|link|meta)[^>]*>[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/ on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/\b(href|src)\s*=\s*(["'])?javascript:[^"'>\s]+\2/gi, '$1="#"');
  return s;
}

// Ajustes pós-render para experiência segura
function enhanceEmailBody(container) {
  try {
    // Links em nova aba e seguros
    const links = container.querySelectorAll('a[href]');
    for (const a of links) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer nofollow';
    }
    // Evita navegação acidental por formulários
    const forms = container.querySelectorAll('form');
    for (const f of forms) {
      f.addEventListener('submit', (e) => e.preventDefault());
    }
  } catch {}
}

// Logs UI
async function openLogs() {
  logsModal.hidden = false;
  await refreshLogs();
}

function closeLogs() {
  logsModal.hidden = true;
}

async function refreshLogs() {
  try {
    logsContent.textContent = 'Carregando...';
    const res = await fetch('/api/logs?bytes=262144'); // 256KB tail
    const text = await res.text();
    logsContent.textContent = text || '(vazio)';
  } catch (e) {
    logsContent.textContent = 'Falha ao carregar logs';
  }
}

async function clearLogs() {
  if (!confirm('Deseja apagar o arquivo de logs?')) return;
  const res = await fetch('/api/logs', { method: 'DELETE' });
  if (!res.ok) return alert('Falha ao apagar logs');
  await refreshLogs();
}

logsRefreshBtn?.addEventListener('click', refreshLogs);
logsClearBtn?.addEventListener('click', clearLogs);
logsCloseBtn?.addEventListener('click', closeLogs);

// Fecha ao clicar fora do card
logsModal?.addEventListener('click', (e) => {
  if (e.target === logsModal) closeLogs();
});

// Fecha com ESC
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !logsModal.hidden) closeLogs();
});
