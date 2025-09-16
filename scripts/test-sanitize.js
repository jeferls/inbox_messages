// Quick test for sanitizeHtml normalization behavior (Node-only approximation)
function sanitizeHtmlNode(raw) {
  let str = String(raw ?? '');
  try {
    str = str.replace(/<\s*\/\s*([a-z0-9:-]+)\s*>/gi, '</$1>');
    str = str.replace(/<\s+([a-z0-9:-])/gi, '<$1');
  } catch {}
  // Fallback-only sanitization (no DOMPurify here)
  let s = str;
  s = s.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<(iframe|object|embed|link|meta)[^>]*>[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/ on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/\b(href|src)\s*=\s*(["'])?javascript:[^"'>\s]+\2/gi, '$1="#"');
  return s;
}

const input = '<p>Olá! Este é um teste.</  p><p>Clique em <a href="https://google.com.br">Venha</a>.</p>';
const output = sanitizeHtmlNode(input);
console.log('INPUT :', input);
console.log('OUTPUT:', output);
