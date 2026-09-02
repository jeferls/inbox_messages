// Aba WhatsApp: UI do mock da WhatsApp Cloud API (portada do wa-mock).
// API mock: POST /v20.0/{phoneNumberId}/messages · internos: /api/wa-mock/*
(() => {
const $ = (s) => document.querySelector(s);
let cfg = {}, templates = {}, messages = [], current = null, mode = localStorage.getItem('wa-mock:mode') || 'in';

// ---------- util ----------
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ESC[c]);
const trunc = (s, n = 90) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; };
const pad = (n) => String(n).padStart(2, '0');
const time = (ts) => { const d = new Date(ts * 1000); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dayKey = (ts) => new Date(ts * 1000).toDateString();
function dayLabel(ts) {
  const d = new Date(ts * 1000), today = new Date(), y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Hoje';
  if (d.toDateString() === y.toDateString()) return 'Ontem';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function fmtPhone(n) {
  n = String(n).replace(/\D/g, '');
  const m = n.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : `+${n}`;
}
const contactLabel = (waId) => (waId === cfg.defaultWaId && cfg.contactName) ? cfg.contactName : fmtPhone(waId);

// ---------- formatação WhatsApp ----------
function inline(s) {
  const urls = [];
  s = s.replace(/https?:\/\/[^\s<]+/g, (u) => { urls.push(u); return `\u0000${urls.length - 1}\u0000`; });
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  const rule = (ch, tag) => {
    const re = new RegExp(`(^|[\\s(>])\\${ch}(?!\\s)([^${ch}\\n]*?[^\\s${ch}])\\${ch}(?=$|[\\s).,!?:;<])`, 'g');
    s = s.replace(re, `$1<${tag}>$2</${tag}>`);
  };
  rule('*', 'b'); rule('_', 'i'); rule('~', 's');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => `<a href="${urls[i]}" target="_blank" rel="noopener">${urls[i]}</a>`);
}
function fmt(text) {
  const blocks = [];
  const s = esc(text).replace(/```([\s\S]+?)```/g, (m, c) => { blocks.push(c); return `\u0001${blocks.length - 1}\u0001`; });
  let html = '', list = null, m;
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const line of s.split('\n')) {
    if ((m = line.match(/^[*-]\s+(.*)$/))) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; continue; }
    if ((m = line.match(/^\d+\.\s+(.*)$/))) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; continue; }
    close();
    if ((m = line.match(/^&gt;\s?(.*)$/))) { html += `<blockquote>${inline(m[1])}</blockquote>`; continue; }
    html += inline(line) + '<br>';
  }
  close();
  return html.replace(/<br>$/, '')
    .replace(/\u0001(\d+)\u0001/g, (m, i) => `<pre>${blocks[i].replace(/^\n|\n$/g, '')}</pre>`)
    .replace(/<\/pre><br>/g, '</pre>');
}

// ---------- renderização ----------
const TICK = '<path d="M1 5.5l3.5 3.5L11 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
const TICK2 = '<path d="M5.5 5.5l3.5 3.5L15.5 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
const ticks = (st) => `<span class="ticks" title="${esc(st)}"><svg viewBox="0 0 16 11">${TICK}${st !== 'sent' ? TICK2 : ''}</svg></span>`;
const body = (html) => `<div class="body">${html}</div>`;
const ph = (label, cls = '') => `<div class="ph ${cls}">${esc(label)}</div>`;
function btnHtml(act, data, icon, label) {
  const attrs = Object.entries(data).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
  return `<button class="btn" data-act="${act}"${attrs}><span class="bi">${icon}</span>${esc(label)}</button>`;
}

function media(type, o = {}) {
  const cap = o.caption ? body(fmt(o.caption)) : '';
  switch (type) {
    case 'image': return `<div class="media">${o.link ? `<img src="${esc(o.link)}" alt="">` : ph(`Imagem · id ${o.id || '?'}`)}</div>${cap}`;
    case 'video': return `<div class="media">${o.link ? `<video src="${esc(o.link)}" controls></video>` : ph(`Vídeo · id ${o.id || '?'}`)}</div>${cap}`;
    case 'sticker': return `<div class="media">${o.link ? `<img class="sticker" src="${esc(o.link)}" alt="">` : ph('Sticker', 'sticker')}</div>`;
    case 'audio': return `<div class="audio"><span class="play"></span><span class="bar"></span><span class="dur">0:00</span></div>`;
    case 'document': {
      const name = o.filename || (o.link ? decodeURIComponent(o.link.split('/').pop().split('?')[0]) : 'Documento');
      const ext = name.includes('.') ? name.split('.').pop().toUpperCase().slice(0, 4) : 'DOC';
      return `<div class="doc"><span class="ico">${esc(ext)}</span><span class="fn">${esc(name)}</span></div>${cap}`;
    }
    case 'location':
      return `<div class="loc"><div class="map"></div>${(o.name || o.address) ? body(`<b>${esc(o.name || '')}</b>${o.address ? `<div class="muted small">${esc(o.address)}</div>` : ''}`) : ''}<div class="body muted small">${esc(o.latitude)}, ${esc(o.longitude)}</div></div>`;
    default: return body(`<pre>${esc(JSON.stringify(o, null, 2))}</pre>`);
  }
}

function paramValue(p) {
  switch (p.type) {
    case 'text': return p.text ?? '';
    case 'currency': return p.currency?.fallback_value ?? '';
    case 'date_time': return p.date_time?.fallback_value ?? '';
    case 'payload': return p.payload ?? '';
    case 'coupon_code': return p.coupon_code ?? '';
    default: return p[p.type]?.link || '';
  }
}
function subst(text, params = []) {
  let s = String(text ?? '');
  params.forEach((p, i) => {
    const key = p.parameter_name ? `{{${p.parameter_name}}}` : `{{${i + 1}}}`;
    s = s.split(key).join(paramValue(p));
  });
  return s;
}

function renderTemplate(t = {}) {
  const def = templates?.[t.name];
  const comps = t.components || [];
  const comp = (type) => comps.filter((c) => c.type === type);
  if (!def) return { main: body(`<div class="tpl-missing">Template <b>${esc(t.name)}</b> não está em templates.json</div><pre>${esc(JSON.stringify(t, null, 2))}</pre>`) };

  let html = '';
  const hp = comp('header')[0]?.parameters?.[0];
  const hdrType = def.header?.type || hp?.type;
  if (hdrType === 'text') html += `<div class="hdr">${fmt(subst(def.header?.text, comp('header')[0]?.parameters))}</div>`;
  else if (hdrType) html += media(hdrType, hp?.[hp.type] || {});
  html += body(fmt(subst(def.body, comp('body')[0]?.parameters)));
  if (def.footer) html += `<div class="ftr">${esc(def.footer)}</div>`;

  const btnComps = comp('button');
  const btns = (def.buttons || []).map((b, i) => {
    const bp = btnComps.find((c) => Number(c.index) === i)?.parameters?.[0];
    switch ((b.type || '').toUpperCase()) {
      case 'URL': return btnHtml('url', { url: subst(b.url, bp ? [{ type: 'text', text: paramValue(bp) }] : []) }, '↗', b.text);
      case 'QUICK_REPLY': return btnHtml('tpl', { payload: bp ? paramValue(bp) : b.text, text: b.text }, '↩', b.text);
      case 'PHONE_NUMBER': return btnHtml('phone', { phone: b.phone_number || '' }, '✆', b.text);
      case 'COPY_CODE': return btnHtml('copy', { code: bp ? paramValue(bp) : (b.example || '') }, '⧉', b.text || 'Copiar código');
      case 'FLOW': return btnHtml('noop', {}, '▤', b.text);
      default: return btnHtml('noop', {}, '•', b.text || b.type);
    }
  });
  if (btns.length) html += `<div class="btns">${btns.join('')}</div>`;
  return { main: html };
}

function renderInteractive(it = {}, msgId) {
  let html = '';
  if (it.header) html += it.header.type === 'text' ? `<div class="hdr">${fmt(it.header.text)}</div>` : media(it.header.type, it.header[it.header.type]);
  if (it.body?.text) html += body(fmt(it.body.text));
  if (it.footer?.text) html += `<div class="ftr">${esc(it.footer.text)}</div>`;
  const a = it.action || {};
  let after = '', attached = '';
  switch (it.type) {
    case 'button':
      after = `<div class="reply-btns">${(a.buttons || []).map((b) => `<button class="pill" data-act="reply" data-id="${esc(b.reply?.id)}" data-title="${esc(b.reply?.title)}">${esc(b.reply?.title)}</button>`).join('')}</div>`;
      break;
    case 'list': attached = btnHtml('list', { msg: msgId }, '☰', a.button || 'Ver opções'); break;
    case 'cta_url': attached = btnHtml('url', { url: a.parameters?.url || '' }, '↗', a.parameters?.display_text || 'Abrir'); break;
    case 'flow': attached = btnHtml('noop', {}, '▤', a.parameters?.flow_cta || 'Abrir'); break;
    case 'location_request_message': attached = btnHtml('noop', {}, '⌖', 'Enviar localização'); break;
  }
  if (attached) html += `<div class="btns">${attached}</div>`;
  return { main: html, after };
}

function renderOut(p, id) {
  switch (p.type) {
    case 'text': return { main: body(fmt(p.text?.body)) };
    case 'image': case 'video': case 'audio': case 'document': case 'sticker': case 'location': return { main: media(p.type, p[p.type]) };
    case 'template': return renderTemplate(p.template);
    case 'interactive': return renderInteractive(p.interactive, id);
    case 'contacts': return { main: body((p.contacts || []).map((c) => `<b>${esc(c.name?.formatted_name || 'Contato')}</b><div class="muted small">${esc(c.phones?.[0]?.phone || '')}</div>`).join('')) };
    default: return { main: body(`<pre>${esc(JSON.stringify(p, null, 2))}</pre>`) };
  }
}
function renderIn(p) {
  switch (p.type) {
    case 'text': return { main: body(fmt(p.text?.body)) };
    case 'interactive': {
      const r = p.interactive?.button_reply || p.interactive?.list_reply || {};
      return { main: body(`${esc(r.title)}${r.description ? `<div class="muted small">${esc(r.description)}</div>` : ''}`) };
    }
    case 'button': return { main: body(esc(p.button?.text)) };
    default: return { main: body(`<pre>${esc(JSON.stringify(p, null, 2))}</pre>`) };
  }
}

function summary(p = {}) {
  switch (p.type) {
    case 'text': return esc(trunc(p.text?.body));
    case 'interactive': return esc(trunc(p.interactive?.body?.text || p.interactive?.button_reply?.title || p.interactive?.list_reply?.title || 'Interativa'));
    case 'button': return esc(p.button?.text);
    case 'template': return `Template: ${esc(p.template?.name)}`;
    default: return `${esc(p.type)}`;
  }
}
function renderQuote(id) {
  const q = messages.find((m) => m.id === id);
  const who = !q ? '?' : q.direction === 'out' ? cfg.businessName : contactLabel(q.wa_id);
  return `<div class="quote"><b>${esc(who)}</b>${q ? summary(q.payload) : '<i>mensagem não encontrada</i>'}</div>`;
}
function webhookBadge(m) {
  const w = m.webhook?.message; if (!w) return '';
  return `<span class="wh ${w.ok ? 'ok' : 'err'}" title="Entrega do webhook">webhook ${w.ok ? w.status : (w.error || w.status)}</span>`;
}

function renderMsg(m, tail, reacts) {
  const p = m.payload || {};
  const cls = ['msg', m.direction, tail ? 'tail gap' : '', m.status === 'read' ? 'read' : '', reacts?.length ? 'has-react' : ''].join(' ');
  const ctxId = p.context?.message_id || p.context?.id;
  const inner = m.direction === 'out' ? renderOut(p, m.id) : renderIn(p);
  const meta = `<div class="meta">${webhookBadge(m)}${time(m.timestamp)}${m.direction === 'out' ? ticks(m.status) : ''}</div>`;
  const react = reacts?.length ? `<div class="react">${esc(reacts.join(''))}</div>` : '';
  return `<div class="${cls}" data-id="${m.id}"><div class="col"><div class="bubble">${ctxId ? renderQuote(ctxId) : ''}${inner.main}${meta}${react}</div>${inner.after || ''}</div></div>`;
}

function renderAll() {
  renderHeader();
  const chat = $('#chat');
  const nearBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 120;
  const list = messages.filter((m) => m.wa_id === current).sort((a, b) => a.timestamp - b.timestamp);
  const reactions = {}, items = [];
  for (const m of list) {
    const r = m.payload?.type === 'reaction' ? m.payload.reaction : null;
    if (r?.message_id) { reactions[r.message_id] = r.emoji ? [r.emoji] : []; continue; }
    items.push(m);
  }
  let html = '', lastDay = null, lastDir = null;
  for (const m of items) {
    const day = dayKey(m.timestamp);
    if (day !== lastDay) { html += `<div class="day"><span>${dayLabel(m.timestamp)}</span></div>`; lastDay = day; lastDir = null; }
    html += renderMsg(m, m.direction !== lastDir, reactions[m.id]);
    lastDir = m.direction;
  }
  chat.innerHTML = html || `<div class="empty">Nenhuma mensagem nesta conversa.<br>Envie um POST do seu backend para<code>${esc(endpoint())}</code>ou escreva abaixo — <b>Cliente</b> simula o que chega, <b>Empresa</b> e <b>JSON</b> passam pela API mock.</div>`;
  if (nearBottom) chat.scrollTop = chat.scrollHeight;
}

function contacts() {
  const set = new Set([cfg.defaultWaId, ...messages.map((m) => m.wa_id)].filter(Boolean));
  if (current) set.add(current);
  return [...set];
}
function renderHeader() {
  const label = contactLabel(current);
  $('#contactName').textContent = label;
  $('#contactSub').textContent = fmtPhone(current);
  $('#avatar').textContent = label[0]?.toUpperCase() || '#';
  const list = contacts(), sel = $('#contactSelect');
  sel.hidden = list.length < 2;
  sel.innerHTML = list.map((w) => `<option value="${esc(w)}"${w === current ? ' selected' : ''}>${esc(contactLabel(w))}</option>`).join('');
}
const endpoint = () => `${location.origin}/v20.0/${cfg.phoneNumberId}/messages`;

// ---------- API ----------
const post = (url, data) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
async function sendInbound(message, ctxId) {
  if (ctxId) message.context = { from: cfg.displayPhone, id: ctxId };
  const r = await post('/api/wa-mock/inbound', { wa_id: current, message });
  if (!r.ok) toast('Falha ao registrar mensagem do cliente', false);
}
async function sendGraph(payload) {
  const r = await post(`/v20.0/${cfg.phoneNumberId}/messages`, payload);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) toast(data.error?.message || `Erro ${r.status}`, false);
  return r.ok;
}
async function reloadTemplates() { templates = await (await fetch('/api/wa-mock/templates')).json(); }

// ---------- eventos ----------
$('#chat').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const d = b.dataset, ctx = b.closest('.msg')?.dataset.id;
  switch (d.act) {
    case 'url': if (d.url) window.open(d.url, '_blank', 'noopener'); break;
    case 'copy': navigator.clipboard?.writeText(d.code || ''); toast('Código copiado', true); break;
    case 'phone': toast(`Ligar para ${d.phone}`, true); break;
    case 'reply': sendInbound({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: d.id, title: d.title } } }, ctx); break;
    case 'tpl': sendInbound({ type: 'button', button: { payload: d.payload, text: d.text } }, ctx); break;
    case 'list': openSheet(d.msg); break;
  }
});

function openSheet(msgId) {
  const a = messages.find((x) => x.id === msgId)?.payload?.interactive?.action; if (!a) return;
  $('#sheet').dataset.msg = msgId;
  $('#sheet').innerHTML = `<div class="grab"></div><h3>${esc(a.button || 'Opções')}</h3>` + (a.sections || []).map((sec) =>
    `${sec.title ? `<div class="sec">${esc(sec.title)}</div>` : ''}${(sec.rows || []).map((r) =>
      `<button class="row-item" data-id="${esc(r.id)}" data-title="${esc(r.title)}" data-desc="${esc(r.description || '')}">${esc(r.title)}${r.description ? `<small>${esc(r.description)}</small>` : ''}</button>`).join('')}`).join('');
  $('#sheetBg').hidden = false;
}
$('#sheetBg').addEventListener('click', (e) => {
  const b = e.target.closest('.row-item');
  if (b) {
    const d = b.dataset, list_reply = { id: d.id, title: d.title };
    if (d.desc) list_reply.description = d.desc;
    sendInbound({ type: 'interactive', interactive: { type: 'list_reply', list_reply } }, $('#sheet').dataset.msg);
  }
  if (b || e.target === $('#sheetBg')) $('#sheetBg').hidden = true;
});

$('#contactSelect').addEventListener('change', (e) => switchContact(e.target.value));
function switchContact(waId) { current = String(waId); localStorage.setItem('wa-mock:contact', current); renderAll(); }

// composer
const input = $('#input');
function setMode(m) {
  mode = m; localStorage.setItem('wa-mock:mode', m);
  document.querySelectorAll('.modes [data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  input.classList.toggle('json', m === 'json');
  $('#examples').hidden = m !== 'json';
  input.placeholder = m === 'in' ? 'Mensagem do cliente' : m === 'out' ? 'Texto enviado pela empresa' : 'Payload da Cloud API (Ctrl+Enter envia)';
  autosize();
}
document.querySelectorAll('.modes [data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 200) + 'px'; }
input.addEventListener('input', autosize);
input.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (mode === 'json' ? (e.ctrlKey || e.metaKey) : !e.shiftKey) { e.preventDefault(); send(); }
});
$('#send').addEventListener('click', send);

async function send() {
  const v = input.value.trim(); if (!v) return;
  let ok = true;
  if (mode === 'in') await sendInbound({ type: 'text', text: { body: v } });
  else if (mode === 'out') ok = await sendGraph({ messaging_product: 'whatsapp', recipient_type: 'individual', to: current, type: 'text', text: { preview_url: false, body: v } });
  else {
    let p; try { p = JSON.parse(v); } catch (e) { return toast(`JSON inválido: ${e.message}`, false); }
    p.messaging_product ??= 'whatsapp'; p.to ??= current;
    if (p.type === 'template') await reloadTemplates();
    ok = await sendGraph(p);
    if (ok && String(p.to) !== current) switchContact(p.to);
  }
  if (ok) { input.value = ''; autosize(); }
}

// exemplos (modo JSON)
const lastId = (dir) => [...messages].reverse().find((m) => m.wa_id === current && (!dir || m.direction === dir))?.id || 'wamid.ID_DA_MENSAGEM';
const EXAMPLES = {
  'Texto formatado': () => ({ type: 'text', text: { preview_url: false, body: 'Olá *Maria*! Seu pedido _#4821_ foi aprovado ✅\n\nResumo:\n- Plano Pro\n- 12x de R$ 49,90\n\n1. Acesse o link\n2. Faça login\n\n> Guarde este número para o suporte\n\nCódigo: ```GRN-4821-X```\nAcesse https://exemplo.com/acesso' } }),
  'Template (posicional)': () => ({ type: 'template', template: { name: 'pagamento_confirmado', language: { code: 'pt_BR' }, components: [
    { type: 'body', parameters: [{ type: 'text', text: 'Maria' }, { type: 'currency', currency: { fallback_value: 'R$ 149,90', code: 'BRL', amount_1000: 149900 } }, { type: 'text', text: '#4821' }] },
    { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '4821' }] },
    { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'SUPORTE_4821' }] } ] } }),
  'Template (nomeado + doc)': () => ({ type: 'template', template: { name: 'boleto_disponivel', language: { code: 'pt_BR' }, components: [
    { type: 'header', parameters: [{ type: 'document', document: { link: 'https://exemplo.com/boleto-4821.pdf', filename: 'boleto-4821.pdf' } }] },
    { type: 'body', parameters: [{ type: 'text', parameter_name: 'nome', text: 'Maria' }, { type: 'text', parameter_name: 'valor', text: 'R$ 149,90' }, { type: 'text', parameter_name: 'vencimento', text: '05/09/2026' }] },
    { type: 'button', sub_type: 'copy_code', index: '0', parameters: [{ type: 'coupon_code', coupon_code: '34191790010104351004791020150008196610000014990' }] } ] } }),
  'Botões de resposta': () => ({ type: 'interactive', interactive: { type: 'button', header: { type: 'text', text: 'Confirmar pagamento' }, body: { text: 'Encontramos um pagamento de *R$ 149,90* pendente. Deseja confirmar?' }, footer: { text: 'Expira em 24h' }, action: { buttons: [
    { type: 'reply', reply: { id: 'confirmar', title: 'Confirmar' } }, { type: 'reply', reply: { id: 'cancelar', title: 'Cancelar' } }, { type: 'reply', reply: { id: 'ajuda', title: 'Falar com atendente' } } ] } } }),
  'Lista': () => ({ type: 'interactive', interactive: { type: 'list', header: { type: 'text', text: 'Central de ajuda' }, body: { text: 'Escolha um assunto para continuar.' }, footer: { text: 'Atendimento 24h' }, action: { button: 'Ver opções', sections: [
    { title: 'Pagamentos', rows: [{ id: 'pg_status', title: 'Status do pagamento', description: 'Consultar aprovação e prazo' }, { id: 'pg_reembolso', title: 'Reembolso', description: 'Solicitar ou acompanhar' }] },
    { title: 'Acesso', rows: [{ id: 'ac_login', title: 'Problemas de login' }, { id: 'ac_senha', title: 'Redefinir senha' }] } ] } } }),
  'CTA URL': () => ({ type: 'interactive', interactive: { type: 'cta_url', body: { text: 'Sua nota fiscal está disponível.' }, action: { name: 'cta_url', parameters: { display_text: 'Baixar nota fiscal', url: 'https://exemplo.com/nf/4821' } } } }),
  'Imagem com legenda': () => ({ type: 'image', image: { link: `${location.origin}/wa-sample.svg`, caption: 'Comprovante do pedido *#4821*' } }),
  'Documento': () => ({ type: 'document', document: { link: 'https://exemplo.com/contrato-4821.pdf', filename: 'contrato-4821.pdf', caption: 'Contrato assinado' } }),
  'Áudio': () => ({ type: 'audio', audio: { id: 'MEDIA_ID_123' } }),
  'Localização': () => ({ type: 'location', location: { latitude: -23.5614, longitude: -46.6559, name: 'Av. Paulista, 1000', address: 'Bela Vista, São Paulo - SP' } }),
  'Resposta (citando)': () => ({ context: { message_id: lastId() }, type: 'text', text: { body: 'Sobre essa mensagem: já está resolvido 👍' } }),
  'Reação': () => ({ type: 'reaction', reaction: { message_id: lastId('in'), emoji: '❤️' } }),
  'Marcar como lida': () => ({ status: 'read', message_id: lastId('in') }),
};
const exSel = $('#examples');
exSel.innerHTML += Object.keys(EXAMPLES).map((k) => `<option>${esc(k)}</option>`).join('');
exSel.addEventListener('change', () => {
  if (!exSel.value) return;
  input.value = JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: current, ...EXAMPLES[exSel.value]() }, null, 2);
  exSel.value = ''; autosize(); input.focus();
});

// configurações
const FIELDS = ['webhookUrl', 'phoneNumberId', 'displayPhone', 'businessName', 'contactName', 'defaultWaId'];
function fillCfg() {
  for (const f of FIELDS) $(`#f_${f}`).value = cfg[f] || '';
  $('#endpoint').textContent = endpoint();
}
$('#openCfg').addEventListener('click', () => { fillCfg(); $('#cfg').hidden = false; });
$('#closeCfg').addEventListener('click', () => { $('#cfg').hidden = true; });
$('#copyEndpoint').addEventListener('click', () => { navigator.clipboard?.writeText(endpoint()); toast('Endpoint copiado', true); });
$('#saveCfg').addEventListener('click', async () => {
  const data = {}; for (const f of FIELDS) data[f] = $(`#f_${f}`).value.trim();
  const r = await post('/api/wa-mock/config', data);
  if (r.ok) { cfg = await r.json(); toast('Configurações salvas', true); $('#cfg').hidden = true; renderAll(); }
});
$('#clearChat').addEventListener('click', async () => {
  if (!confirm('Apagar todas as mensagens de todas as conversas?')) return;
  await post('/api/wa-mock/clear', {}); $('#cfg').hidden = true;
});

function toast(text, ok = true) {
  const el = document.createElement('div');
  el.className = `toast${ok ? '' : ' err'}`; el.textContent = text;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ---------- boot ----------
function upsert(msg) { const i = messages.findIndex((m) => m.id === msg.id); if (i >= 0) messages[i] = msg; else messages.push(msg); }
function listen() {
  const es = new EventSource('/api/wa-mock/events');
  es.onmessage = async (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === 'message') {
      if (ev.message.payload?.type === 'template') await reloadTemplates();
      upsert(ev.message);
      if (ev.message.direction === 'out' && ev.message.wa_id !== current && !messages.some((m) => m.wa_id === current)) switchContact(ev.message.wa_id);
      renderAll();
    } else if (ev.type === 'clear') { messages = []; renderAll(); }
    else if (ev.type === 'config') { cfg = ev.config; fillCfg(); renderAll(); }
    else if (ev.type === 'toast') toast(ev.text, ev.ok);
  };
}
(async () => {
  const s = await (await fetch('/api/wa-mock/state')).json();
  cfg = s.config; templates = s.templates; messages = s.messages;
  current = localStorage.getItem('wa-mock:contact') || cfg.defaultWaId;
  $('#secretInfo').textContent = s.appSecret ? 'ativa (WA_MOCK_APP_SECRET definido, header X-Hub-Signature-256)' : 'desativada (defina WA_MOCK_APP_SECRET para assinar)';
  setMode(mode); fillCfg(); renderAll(); listen();
  $('#chat').scrollTop = $('#chat').scrollHeight;
})();
})();
