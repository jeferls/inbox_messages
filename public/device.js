const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const targetUrl = params.get('url') || '';
let landscape = false;

if (params.get('model')) {
  const opt = [...$('model').options].find((o) => o.value === params.get('model'));
  if (opt) $('model').value = opt.value;
}

function size() {
  const [w, h] = $('model').value.split('x').map(Number);
  return landscape ? [h, w] : [w, h];
}

function apply() {
  const [w, h] = size();
  const zoom = Number($('zoom').value);
  const frame = $('frame');
  frame.style.width = w + 'px';
  frame.style.height = h + 'px';
  // `zoom` reserva o espaco no layout, entao a moldura nunca vaza da janela
  $('phone').style.zoom = zoom;
  $('info').textContent = `${w}×${h} • ${Math.round(zoom * 100)}% • ${targetUrl}`;
  document.title = `Preview ${w}×${h}`;
}

// Se o wrapper e o alvo estao em hosts diferentes, o cookie de login do alvo vira
// cookie de terceiro e o Chrome bloqueia — oferece o mesmo preview no host certo.
function checkSameSite() {
  let target;
  try { target = new URL(targetUrl); } catch { return false; }
  if (target.hostname === location.hostname) return false;
  const href = `${location.protocol}//${target.hostname}${location.port ? ':' + location.port : ''}${location.pathname}${location.search}`;
  $('warn').textContent = `Preview em "${location.hostname}" e serviço em "${target.hostname}": o Chrome trata como sites diferentes e bloqueia o cookie de login. Abra por aqui: `;
  const a = document.createElement('a');
  a.href = href;
  a.textContent = href;
  a.style.color = '#93c5fd';
  $('warn').append(a);
  return true;
}

async function checkEmbed() {
  if (!targetUrl) return;
  if (checkSameSite()) return;
  try {
    const res = await fetch(`/api/embed-check?url=${encodeURIComponent(targetUrl)}`);
    const data = await res.json();
    if (!res.ok) {
      $('warn').textContent = `Não consegui acessar ${targetUrl}: ${data.error || res.status}. O serviço está de pé?`;
    } else if (data.blocked) {
      $('warn').textContent = `Este serviço recusa ser exibido em iframe (${data.xFrameOptions || data.frameAncestors}). Use "Abrir sem moldura".`;
    } else {
      $('warn').textContent = '';
    }
  } catch {
    /* preview segue mesmo sem a checagem */
  }
}

$('model').addEventListener('change', apply);
$('zoom').addEventListener('change', apply);
$('rotate').addEventListener('click', () => { landscape = !landscape; apply(); });
$('reload').addEventListener('click', () => { if (targetUrl) $('frame').setAttribute('src', targetUrl); });
$('raw').addEventListener('click', () => { if (targetUrl) window.open(targetUrl, '_blank', 'noopener'); });

if (targetUrl) {
  $('frame').src = targetUrl;
} else {
  $('warn').textContent = 'Nenhuma URL informada. Use ?url=http://192.168.0.10:3000/...';
}
apply();
checkEmbed();
