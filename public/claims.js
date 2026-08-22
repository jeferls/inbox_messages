const claimForm = document.getElementById('claimForm');
const sendClaimBtn = document.getElementById('sendClaimBtn');
const claimStatusLine = document.getElementById('claimStatusLine');
const resultBox = document.getElementById('resultBox');
const resultStatus = document.getElementById('resultStatus');
const resultBody = document.getElementById('resultBody');

const trackBox = document.getElementById('trackBox');
const trackBtn = document.getElementById('trackBtn');
const trackStatusLine = document.getElementById('trackStatusLine');
const trackLinkWrap = document.getElementById('trackLinkWrap');
const trackLink = document.getElementById('trackLink');

const FIELDS = ['sale_id', 'client_id', 'subjective', 'category', 'objective', 'description'];

const ENV_URLS = {
  local: 'http://greenn-back-nginx',
  staging: 'https://apipay-staging.greenn.com.br',
};

const baseUrlInput = document.getElementById('baseUrl');
const envRadios = document.querySelectorAll('input[name="envTarget"]');

envRadios.forEach((radio) => {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    envRadios.forEach((r) => r.closest('.env-option').classList.toggle('active', r === radio));
    baseUrlInput.value = ENV_URLS[radio.value];
    document.body.classList.toggle('env-staging-active', radio.value === 'staging');
    applyEnvToSaleSelect(radio.value);
  });
});

// Select das últimas sales: só existe no ambiente local (a lista vem do MySQL do greenn-back).
// Em staging a tela mantém o comportamento antigo, apenas com os campos digitados na mão.
const saleSelect = document.getElementById('saleSelect');
const saleSelectWrap = document.getElementById('saleSelectWrap');
const saleIdInput = document.getElementById('sale_id');
const clientIdInput = document.getElementById('client_id');
const saleLookupHint = document.getElementById('saleLookupHint');

let recentSalesLoaded = false;

function currentEnv() {
  return document.querySelector('input[name="envTarget"]:checked')?.value ?? 'local';
}

function setSaleHint(msg, isError = false) {
  saleLookupHint.textContent = msg;
  saleLookupHint.style.color = isError ? '#b91c1c' : '#6b7280';
}

function formatSaleOption(sale) {
  const amount = sale.amount != null ? `R$ ${Number(sale.amount).toFixed(2)}` : '';
  const client = sale.clientName ? ` — ${sale.clientName}` : '';
  return `#${sale.id} — ${sale.status ?? '?'} ${amount}${client}`.trim();
}

async function loadRecentSales() {
  if (recentSalesLoaded) return;
  try {
    const res = await fetch('/api/claims/sales?limit=30');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? res.status);

    saleSelect.innerHTML = '<option value="">Selecione uma sale...</option>';
    for (const sale of data.sales ?? []) {
      const opt = document.createElement('option');
      opt.value = String(sale.id);
      opt.textContent = formatSaleOption(sale);
      opt.dataset.clientId = String(sale.clientId ?? '');
      saleSelect.appendChild(opt);
    }
    recentSalesLoaded = true;
  } catch (err) {
    setSaleHint(`Não foi possível carregar as sales: ${err.message}`, true);
  }
}

saleSelect.addEventListener('change', () => {
  const opt = saleSelect.selectedOptions[0];
  if (!opt?.value) return;
  saleIdInput.value = opt.value;
  clientIdInput.value = opt.dataset.clientId ?? '';
  setSaleHint(`client_id preenchido a partir da sale #${opt.value}.`);
});

let lookupTimer = null;
let lookupSeq = 0;

async function lookupSale(saleId) {
  const seq = ++lookupSeq;
  try {
    const res = await fetch(`/api/claims/sales/${encodeURIComponent(saleId)}`);
    const data = await res.json();
    if (seq !== lookupSeq) return;
    if (!res.ok) {
      setSaleHint(res.status === 404 ? 'Sale não encontrada.' : `Falha na busca: ${data.error ?? res.status}`, true);
      return;
    }
    clientIdInput.value = data.clientId ?? '';
    setSaleHint(`client_id preenchido a partir da sale #${data.id}.`);
  } catch (err) {
    if (seq === lookupSeq) setSaleHint(`Falha na busca: ${err.message}`, true);
  }
}

saleIdInput.addEventListener('input', () => {
  if (currentEnv() !== 'local') return;
  const value = saleIdInput.value.trim();
  if (saleSelect.value !== value) saleSelect.value = '';
  clearTimeout(lookupTimer);
  if (!/^\d+$/.test(value)) {
    setSaleHint('');
    return;
  }
  setSaleHint('Buscando client_id...');
  lookupTimer = setTimeout(() => lookupSale(value), 400);
});

function applyEnvToSaleSelect(env) {
  const isLocal = env === 'local';
  saleSelectWrap.hidden = !isLocal;
  if (!isLocal) {
    setSaleHint('');
    clearTimeout(lookupTimer);
    return;
  }
  loadRecentSales();
}

applyEnvToSaleSelect(currentEnv());

const randomizeBtn = document.getElementById('randomizeBtn');

const CLAIM_TEMPLATES = [
  {
    category: 'Entrega',
    subjective: 'Produto não chegou',
    objective: 'Quero a resolução do problema',
    description: 'Fiz a compra há mais de 10 dias e o produto ainda não chegou até o momento, gostaria de uma solução rápida para esse problema por favor.',
  },
  {
    category: 'Entrega',
    subjective: 'Pedido chegou com atraso',
    objective: 'Quero um reembolso do frete',
    description: 'O prazo de entrega informado no site era de 5 dias úteis, mas o produto só chegou depois de 15 dias. Gostaria de ser reembolsado pelo valor pago no frete.',
  },
  {
    category: 'Produto',
    subjective: 'Produto veio com defeito',
    objective: 'Quero a troca do produto',
    description: 'Recebi o produto, mas ao testar percebi que ele não liga e apresenta defeito de fabricação. Gostaria de solicitar a troca por uma unidade sem defeito.',
  },
  {
    category: 'Produto',
    subjective: 'Produto diferente do anunciado',
    objective: 'Quero devolver o produto e ser reembolsado',
    description: 'O produto que recebi não corresponde à descrição e às fotos apresentadas no anúncio. Gostaria de devolvê-lo e receber o reembolso integral do valor pago.',
  },
  {
    category: 'Pagamento',
    subjective: 'Cobrança em duplicidade',
    objective: 'Quero o estorno do valor cobrado a mais',
    description: 'Percebi que fui cobrado duas vezes pela mesma compra no meu cartão de crédito. Peço que seja feito o estorno do valor duplicado o quanto antes.',
  },
  {
    category: 'Reembolso',
    subjective: 'Reembolso não foi processado',
    objective: 'Quero receber meu reembolso',
    description: 'Cancelei minha compra há mais de 7 dias e até agora não recebi o reembolso do valor pago. Já entrei em contato com o suporte, mas não obtive resposta.',
  },
  {
    category: 'Atendimento',
    subjective: 'Falta de resposta do suporte',
    objective: 'Quero um retorno da equipe de atendimento',
    description: 'Enviei diversas mensagens para o suporte relatando um problema com meu pedido e não obtive nenhuma resposta há mais de 5 dias. Preciso de um retorno urgente.',
  },
  {
    category: 'Entrega',
    subjective: 'Pedido cancelado sem aviso',
    objective: 'Quero entender o motivo do cancelamento',
    description: 'Meu pedido foi cancelado automaticamente sem nenhuma justificativa ou aviso prévio. Gostaria de saber o motivo e, se possível, que o pedido seja restabelecido.',
  },
  {
    category: 'Produto',
    subjective: 'Faltou item no pedido',
    objective: 'Quero receber o item faltante',
    description: 'Meu pedido chegou incompleto, faltando um dos itens comprados. Gostaria que o item faltante fosse enviado o quanto antes ou que o valor correspondente fosse reembolsado.',
  },
  {
    category: 'Pagamento',
    subjective: 'Cartão foi cobrado, mas pedido não foi confirmado',
    objective: 'Quero a confirmação do pedido ou o estorno do valor',
    description: 'O valor da compra foi debitado do meu cartão, porém não recebi nenhuma confirmação do pedido nem código de rastreio. Preciso que o pedido seja confirmado ou que o valor seja estornado.',
  },
];

function applyRandomClaimTemplate() {
  const template = CLAIM_TEMPLATES[Math.floor(Math.random() * CLAIM_TEMPLATES.length)];
  document.getElementById('category').value = template.category;
  document.getElementById('subjective').value = template.subjective;
  document.getElementById('objective').value = template.objective;
  document.getElementById('description').value = template.description;
}

randomizeBtn.addEventListener('click', applyRandomClaimTemplate);

let lastClaimId = null;

claimForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const baseUrl = document.getElementById('baseUrl').value.trim();
  if (!baseUrl) {
    setStatus('Informe a base da URL', true);
    return;
  }

  const payload = { baseUrl };
  for (const field of FIELDS) {
    payload[field] = document.getElementById(field).value;
  }

  sendClaimBtn.disabled = true;
  setStatus('Enviando...');
  resultBox.hidden = true;
  trackBox.hidden = true;
  trackLinkWrap.hidden = true;

  try {
    const res = await fetch('/api/claims/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      setStatus(`Erro: ${data.error ?? res.status}`, true);
      showResult(false, data);
      return;
    }

    setStatus(`Concluído em ${new Date().toLocaleTimeString()}`);
    showResult(data.ok, data);

    const claimId = data.body?.data?.id;
    if (data.ok && claimId) {
      lastClaimId = claimId;
      trackBox.hidden = false;
      trackStatusLine.textContent = '';
    }
  } catch (err) {
    setStatus(`Falha na requisição: ${err.message}`, true);
  } finally {
    sendClaimBtn.disabled = false;
  }
});

trackBtn.addEventListener('click', async () => {
  if (!lastClaimId) return;
  const baseUrl = document.getElementById('baseUrl').value.trim();

  trackBtn.disabled = true;
  trackLinkWrap.hidden = true;
  setTrackStatus('Enviando email de acesso...');

  try {
    const res = await fetch(`/api/claims/secret?baseUrl=${encodeURIComponent(baseUrl)}&claimId=${encodeURIComponent(lastClaimId)}`);
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setTrackStatus('Falha ao solicitar o email de acesso.', true);
      return;
    }

    setTrackStatus('Email enviado, procurando no Inbox...');
    const link = await pollForTrackingLink(lastClaimId);
    if (link) {
      trackLink.href = link;
      trackLink.textContent = link;
      trackLinkWrap.hidden = false;
      setTrackStatus('Link encontrado.');
    } else {
      setTrackStatus('Email ainda não chegou. Confira a aba Inbox em instantes.');
    }
  } catch (err) {
    setTrackStatus(`Falha: ${err.message}`, true);
  } finally {
    trackBtn.disabled = false;
  }
});

async function pollForTrackingLink(claimId, attempts = 6, delayMs = 500) {
  const marker = `id=${claimId}&`;
  for (let i = 0; i < attempts; i += 1) {
    const res = await fetch(`/api/emails?limit=5&search=${encodeURIComponent(marker)}`);
    if (res.ok) {
      const data = await res.json();
      for (const item of data.items || []) {
        const full = await fetch(`/api/emails/${item.id}`).then((r) => (r.ok ? r.json() : null));
        const link = extractTrackingLink(full?.body_email ?? full?.body, claimId);
        if (link) return link;
      }
    }
    await sleep(delayMs);
  }
  return null;
}

function extractTrackingLink(body, claimId) {
  if (!body) return null;
  const re = new RegExp(`https?://[^"'\\s]*acompanhar\\?id=${claimId}[^"'\\s]*`, 'i');
  const match = body.match(re);
  return match ? match[0].replace(/&amp;/g, '&') : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setStatus(msg, isError = false) {
  claimStatusLine.textContent = msg;
  claimStatusLine.style.color = isError ? '#b91c1c' : '#6b7280';
}

function setTrackStatus(msg, isError = false) {
  trackStatusLine.textContent = msg;
  trackStatusLine.style.color = isError ? '#b91c1c' : '#6b7280';
}

function showResult(ok, data) {
  resultBox.hidden = false;
  resultStatus.className = `result-status ${ok ? 'ok' : 'err'}`;
  resultStatus.textContent = ok
    ? `Sucesso — HTTP ${data.status} — ${data.requestUrl ?? ''}`
    : `Falha — HTTP ${data.status ?? '?'} — ${data.requestUrl ?? ''}`;
  resultBody.textContent = typeof data.body === 'string' ? data.body : JSON.stringify(data.body, null, 2);
}
