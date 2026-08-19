const $ = (id) => document.getElementById(id);
const LS_HOST = 'qrcode:host';

const targetEl = $('target');
const hostEl = $('host');
const portEl = $('port');
const pathEl = $('path');
const urlEl = $('url');

let urlManual = false;

function buildUrl() {
  const host = hostEl.value.trim();
  const port = portEl.value.trim();
  let p = pathEl.value.trim();
  if (p && !p.startsWith('/')) p = '/' + p;
  if (!host) return '';
  return `http://${host}${port ? ':' + port : ''}${p}`;
}

function syncUrl() {
  if (urlManual) return;
  urlEl.value = buildUrl();
}

async function detectHost() {
  const saved = localStorage.getItem(LS_HOST);
  if (saved) return saved;
  const current = location.hostname;
  if (current && !['localhost', '127.0.0.1', '::1'].includes(current)) return current;
  try {
    const res = await fetch('/api/qrcode/hosts');
    const data = await res.json();
    if (data.ips && data.ips.length) return data.ips[0].address;
  } catch {}
  return '';
}

async function generate() {
  const url = urlEl.value.trim();
  const statusEl = $('status');
  if (!url) {
    $('result').hidden = false;
    statusEl.textContent = 'Informe o IP/host da máquina na rede local.';
    statusEl.className = 'qr-status err';
    $('qrImg').removeAttribute('src');
    return;
  }
  localStorage.setItem(LS_HOST, hostEl.value.trim());
  $('qrImg').src = `/api/qrcode.png?size=320&text=${encodeURIComponent(url)}`;
  $('qrLink').href = url;
  $('qrLink').textContent = url;
  statusEl.textContent = 'Aponte a câmera do celular (mesma rede Wi-Fi).';
  statusEl.className = 'qr-status';
  $('result').hidden = false;
}

targetEl.addEventListener('change', () => {
  if (targetEl.value !== 'custom') portEl.value = targetEl.value;
  urlManual = false;
  syncUrl();
});

[hostEl, portEl, pathEl].forEach((el) => el.addEventListener('input', () => { urlManual = false; syncUrl(); }));
urlEl.addEventListener('input', () => { urlManual = true; });

$('qrForm').addEventListener('submit', (e) => { e.preventDefault(); generate(); });

$('copyBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(urlEl.value.trim()); $('status').textContent = 'URL copiada.'; } catch {}
});

$('openBtn').addEventListener('click', () => {
  const url = urlEl.value.trim();
  if (url) window.open(url, '_blank', 'noopener');
});

// ── Ambiente mobile (greenn-adm + new-checkout) ─────────────────────────────
const svcList = $('svcList');
const svcMsg = $('svcMsg');
let svcBusy = false;

function setSvcMsg(text, isErr) {
  svcMsg.textContent = text || '';
  svcMsg.className = isErr ? 'svc-msg err' : 'svc-msg';
}

function renderServices(services) {
  svcList.innerHTML = '';
  const ip = hostEl.value.trim();
  const running = services.filter((s) => s.running).length;
  const stale = services.filter((s) => s.running && ip && s.apiHost && !s.apiHost.includes(ip));
  const missing = services.filter((s) => !s.exists);
  let summary = `${running}/${services.length} no ar`;
  if (ip) summary += ` • IP ${ip}`;
  if (missing.length) summary += ' • container faltando: rode o comando acima';
  else if (stale.length) summary += ' • IP desatualizado: rode o comando acima';
  $('svcSummary').textContent = summary;
  for (const s of services) {
    const item = document.createElement('div');
    item.className = 'svc-item';

    const dot = document.createElement('span');
    dot.className = 'svc-dot ' + (s.running ? 'running' : 'exited');

    const info = document.createElement('div');
    info.className = 'svc-grow';
    const name = document.createElement('div');
    name.className = 'svc-name';
    name.textContent = s.label;
    const meta = document.createElement('div');
    meta.className = 'svc-meta';
    if (!s.exists) {
      meta.textContent = 'container não existe — rode `make mobile-all`';
    } else if (!s.running) {
      meta.textContent = 'parado';
    } else if (ip && s.apiHost && !s.apiHost.includes(ip)) {
      meta.textContent = `no ar, mas apontando para ${s.apiHost} — rode \`make mobile-all\``;
    } else {
      meta.textContent = s.apiHost ? `no ar • API ${s.apiHost}` : 'no ar';
    }
    info.append(name, meta);
    item.append(dot, info);
    svcList.append(item);
  }
}

async function loadServices() {
  try {
    const res = await fetch('/api/docker/mobile');
    const data = await res.json();
    if (!res.ok) {
      svcList.innerHTML = '';
      setSvcMsg(data.error || 'Falha ao consultar o Docker', true);
      return;
    }
    renderServices(data.services || []);
  } catch (err) {
    setSvcMsg('Falha ao consultar o Docker: ' + err.message, true);
  }
}

async function svcAction(action) {
  if (svcBusy) return;
  svcBusy = true;
  $('svcUp').disabled = $('svcDown').disabled = true;
  setSvcMsg(action === 'up' ? 'Subindo...' : 'Parando...');
  try {
    const res = await fetch(`/api/docker/mobile/${action}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'falhou');
    const fails = (data.results || []).filter((r) => !r.ok);
    setSvcMsg(fails.length ? fails.map((f) => `${f.name}: ${f.error}`).join(' | ') : 'Pronto.', fails.length > 0);
  } catch (err) {
    setSvcMsg(err.message, true);
  } finally {
    svcBusy = false;
    $('svcUp').disabled = $('svcDown').disabled = false;
    await loadServices();
  }
}

$('svcUp').addEventListener('click', () => svcAction('up'));
$('svcDown').addEventListener('click', () => svcAction('down'));
$('svcRefresh').addEventListener('click', loadServices);
setInterval(() => { if (!svcBusy) loadServices(); }, 10000);

$('cmdCopy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('cmdText').textContent.trim());
    $('cmdCopy').textContent = 'Copiado';
    setTimeout(() => { $('cmdCopy').textContent = 'Copiar'; }, 1500);
  } catch {}
});

(async () => {
  loadServices();
  hostEl.value = await detectHost();
  if (!hostEl.value) {
    $('hostHint').textContent = 'Não foi possível detectar o IP (app em container). Informe manualmente, ex.: 192.168.0.10';
    $('cfgBox').open = true;
  }
  syncUrl();
  if (hostEl.value) generate();
})();

