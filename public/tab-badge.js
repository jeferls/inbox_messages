// Marca a aba do navegador quando chega e-mail novo: ponto vermelho no favicon e
// contador no título. Carregado em todas as telas, para que o aviso apareça mesmo
// quando você está em outra aba da ferramenta.
//
// "Novo" = e-mail ainda não lido. O Inbox marca como lido ao abrir o e-mail
// (GET /api/emails/:id), então o aviso some sozinho depois que você lê.

(() => {
  const BASE_TITLE = 'Greenn-Tools';
  const POLL_MS = 10000;

  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/png';
  document.head.append(link);

  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');

  let lastUnread = null;

  drawFavicon(0);
  poll();
  setInterval(poll, POLL_MS);
  // Ao voltar para a aba, atualiza na hora em vez de esperar o próximo ciclo.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) poll();
  });

  async function poll() {
    try {
      const res = await fetch('/api/emails?unread=1&limit=1', { cache: 'no-store' });
      if (!res.ok) return;

      const data = await res.json();
      apply(Number(data.total) || 0);
    } catch {
      // Servidor fora do ar não deve poluir o console de todas as telas.
    }
  }

  function apply(unread) {
    if (unread === lastUnread) return;

    lastUnread = unread;
    document.title = unread > 0 ? `(${unread}) ${BASE_TITLE}` : BASE_TITLE;
    drawFavicon(unread);
  }

  function drawFavicon(unread) {
    ctx.clearRect(0, 0, 32, 32);

    // Base: quadrado arredondado com o "G" da Greenn.
    ctx.fillStyle = '#111827';
    roundedRect(2, 2, 28, 28, 7);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 19px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('G', 16, 17);

    if (unread > 0) {
      // Anel escuro para o ponto não se perder sobre o "G".
      ctx.fillStyle = '#111827';
      ctx.beginPath();
      ctx.arc(24, 8, 8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(24, 8, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    link.href = canvas.toDataURL('image/png');
  }

  function roundedRect(x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
  }
})();
