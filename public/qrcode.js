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

const SERVICE_BY_PORT = {
  8080: 'greenn-adm',
  81: 'greenn-back (API)',
  82: 'gateway',
  3000: 'new-checkout',
  8115: 'Greenn Tools',
  6002: 'claim-page',
};

// Nome legivel do destino: servico pela porta e, quando for uma oferta, o produto
function targetName(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return '—'; }
  const service = SERVICE_BY_PORT[parsed.port] || `porta ${parsed.port || '80'}`;
  const offerLabel = offerEl.selectedIndex > 0 ? offerEl.options[offerEl.selectedIndex].textContent : '';
  if (parsed.port === '3000' && offerLabel) return `${service} — ${offerLabel}`;
  const path = parsed.pathname !== '/' ? ` — ${parsed.pathname}` : '';
  return service + path;
}

async function generate() {
  const url = urlEl.value.trim();
  const statusEl = $('status');
  if (!url) {
    statusEl.textContent = 'Informe o IP/host da máquina na rede local.';
    statusEl.className = 'qr-status err';
    $('qrImg').removeAttribute('src');
    $('qrTargetName').textContent = '—';
    $('qrLink').textContent = '—';
    return;
  }
  $('qrTargetName').textContent = targetName(url);
  localStorage.setItem(LS_HOST, hostEl.value.trim());
  $('qrImg').src = `/api/qrcode.png?size=320&text=${encodeURIComponent(url)}`;
  $('qrLink').href = url;
  $('qrLink').textContent = url;
  statusEl.textContent = 'Aponte a câmera do celular (mesma rede Wi-Fi).';
  statusEl.className = 'qr-status';
}

targetEl.addEventListener('change', () => {
  if (targetEl.value !== 'custom') portEl.value = targetEl.value;
  urlManual = false;
  syncUrl();
});

[hostEl, portEl, pathEl].forEach((el) => el.addEventListener('input', () => { urlManual = false; syncUrl(); }));
urlEl.addEventListener('input', () => { urlManual = true; });

$('qrForm').addEventListener('submit', (e) => { e.preventDefault(); generate(); });

// ── Ofertas do checkout ─────────────────────────────────────────────────────
// O new-checkout abre por /{product_id}?offer={hash}. Listamos as ofertas ativas
// do seller (com filtro opcional por produto) para montar o link sem ir ao MySQL.
const offerEl = $('offer');
const sellerEl = $('sellerId');
const productEl = $('productId');
const LS_SELLER = 'qrcode:seller';
const LS_PRODUCT = 'qrcode:product';

function setOfferPlaceholder(text) {
  offerEl.innerHTML = '';
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = text;
  offerEl.append(blank);
}

async function loadOffers() {
  const sellerId = sellerEl.value.trim();
  if (!/^\d+$/.test(sellerId)) {
    offerEl.disabled = true;
    setOfferPlaceholder('— informe o seller_id —');
    return;
  }
  const productId = productEl.value.trim();
  if (productId && !/^\d+$/.test(productId)) {
    offerEl.disabled = true;
    setOfferPlaceholder('— product_id inválido —');
    return;
  }
  localStorage.setItem(LS_SELLER, sellerId);
  localStorage.setItem(LS_PRODUCT, productId);
  offerEl.disabled = true;
  setOfferPlaceholder('— carregando... —');
  try {
    const query = `seller_id=${encodeURIComponent(sellerId)}` + (productId ? `&product_id=${encodeURIComponent(productId)}` : '');
    const res = await fetch(`/api/qrcode/checkout-offers?${query}`);
    const data = await res.json();
    if (!res.ok) {
      setOfferPlaceholder(`— ${data.error || 'falha ao carregar'} —`);
      return;
    }
    const scope = productId ? `produto ${productId}` : `seller ${sellerId}`;
    if (!data.offers?.length) {
      setOfferPlaceholder(`— nenhuma oferta ativa para o ${scope} —`);
      return;
    }
    setOfferPlaceholder(`— ${data.offers.length} ofertas do ${scope} —`);
    for (const o of data.offers) {
      const opt = document.createElement('option');
      // o checkout resolve o produto pelo id numerico; a oferta vai em ?offer=<hash>
      opt.value = `${o.product_id}?offer=${o.hash}`;
      const price = Number(o.amount);
      const tag = o.is_default ? ' (padrão)' : '';
      // produtos fora de APPROVED (REVISION, etc.) abrem no checkout, mas convem sinalizar
      const status = o.product_status && o.product_status !== 'APPROVED' ? ` [${o.product_status}]` : '';
      opt.textContent = `[${o.product_id}]${status} ${o.product_name} • ${o.offer_name}${tag} • R$ ${Number.isFinite(price) ? price.toFixed(2) : o.amount}`;
      offerEl.append(opt);
    }
    offerEl.disabled = false;
  } catch (err) {
    setOfferPlaceholder(`— falha ao carregar: ${err.message} —`);
  }
}

offerEl.addEventListener('change', () => {
  if (!offerEl.value) return;
  targetEl.value = '3000';
  portEl.value = '3000';
  pathEl.value = '/' + offerEl.value;
  urlManual = false;
  syncUrl();
  generate();
});

$('offerLoad').addEventListener('click', loadOffers);
[sellerEl, productEl].forEach((el) => el.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); loadOffers(); }
}));
$('offerOpen').addEventListener('click', () => {
  const url = urlEl.value.trim();
  if (offerEl.value && url) window.open(url, '_blank', 'noopener');
});

$('copyBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(urlEl.value.trim()); $('status').textContent = 'URL copiada.'; } catch {}
});

$('openBtn').addEventListener('click', () => {
  const url = urlEl.value.trim();
  if (url) window.open(url, '_blank', 'noopener');
});

// Volta tudo ao padrao: descarta o que ficou salvo no navegador e redetecta o IP
async function resetToDefaults() {
  [LS_HOST, LS_SELLER, LS_PRODUCT].forEach((k) => localStorage.removeItem(k));
  targetEl.value = '8080';
  portEl.value = '8080';
  pathEl.value = '';
  urlEl.value = '';
  urlManual = false;
  sellerEl.value = '';
  productEl.value = '';
  offerEl.disabled = true;
  setOfferPlaceholder('— informe o seller_id —');
  $('devModel').value = '390x844';
  $('cfgBox').open = false;
  hostEl.value = await detectHost();
  syncUrl();
  generate();
  $('status').textContent = 'Valores padrão restaurados.';
}

$('resetBtn').addEventListener('click', resetToDefaults);

// ── Preview no celular (abre em aba nova) ───────────────────────────────────
// A aba e servida pelo host do alvo: assim o wrapper e o app ficam no mesmo site
// e o cookie de sessao continua first-party (senao o Chrome descarta e o login cai).
function devSize() {
  return $('devModel').value.split('x').map(Number);
}

function sameSiteUrl(path, targetUrl) {
  const t = new URL(targetUrl);
  return `${location.protocol}//${t.hostname}${location.port ? ':' + location.port : ''}${path}`;
}

$('devFramed').addEventListener('click', () => {
  const url = urlEl.value.trim();
  if (!url) return;
  const [w, h] = devSize();
  const wrapper = sameSiteUrl('/device.html', url) + `?url=${encodeURIComponent(url)}&model=${$('devModel').value}`;
  window.open(wrapper, 'preview-framed', `width=${w + 90},height=${h + 190}`);
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

// Permite abrir a pagina ja apontada para uma URL: ?url=... (ou ?port=/?path=)
function applyQueryParams() {
  const params = new URLSearchParams(location.search);
  const url = params.get('url');
  const port = params.get('port');
  const path = params.get('path');
  if (port) {
    portEl.value = port;
    targetEl.value = [...targetEl.options].some((o) => o.value === port) ? port : 'custom';
  }
  if (path) pathEl.value = path;
  if (url) {
    urlEl.value = url;
    urlManual = true;
  }
  return { hasUrl: Boolean(url || port || path) };
}

(async () => {
  loadServices();
  sellerEl.value = localStorage.getItem(LS_SELLER) || '';
  productEl.value = localStorage.getItem(LS_PRODUCT) || '';
  if (sellerEl.value) loadOffers();
  hostEl.value = await detectHost();
  if (!hostEl.value) {
    $('hostHint').textContent = 'Não foi possível detectar o IP (app em container). Informe manualmente, ex.: 192.168.0.10';
    $('cfgBox').open = true;
  }
  const q = applyQueryParams();
  if (!q.hasUrl) syncUrl();
  if (urlEl.value.trim()) generate();
})();

