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
  staging: 'http://apipay-staging.greenn.com.br',
};

const baseUrlInput = document.getElementById('baseUrl');
const envRadios = document.querySelectorAll('input[name="envTarget"]');

envRadios.forEach((radio) => {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    envRadios.forEach((r) => r.closest('.env-option').classList.toggle('active', r === radio));
    baseUrlInput.value = ENV_URLS[radio.value];
    document.body.classList.toggle('env-staging-active', radio.value === 'staging');
  });
});

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
