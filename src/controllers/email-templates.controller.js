import { insertEmail } from '../db/index.js';
import { rewriteClaimUrls } from '../utils/urlRewrite.js';
import { isDockerAvailable } from '../services/docker.service.js';
import { listTemplates, renderTemplates } from '../services/email-templates.service.js';

// Fake recipient chosen by the audience the template is written for.
function recipientFor(label) {
  if (/seller|manager|admin|report|internal/.test(label)) return 'joao@exemplo.com';
  if (/affiliate/.test(label)) return 'carlos.afiliado@exemplo.com';
  return 'maria@exemplo.com';
}

function dockerUnavailable(res) {
  return res.status(503).json({ error: 'Socket do Docker não está montado neste container' });
}

export async function listTemplatesHandler(_req, res) {
  if (!isDockerAvailable()) return dockerUnavailable(res);
  try {
    res.json({ templates: await listTemplates() });
  } catch (error) {
    res.status(502).json({ error: `Falha ao listar os templates: ${error.message}` });
  }
}

/** Renders the chosen templates (all when `labels` is empty) and stores each one as an inbox email. */
export async function sendTemplatesHandler(req, res) {
  if (!isDockerAvailable()) return dockerUnavailable(res);

  const { labels, recipient } = req.body || {};
  if (labels != null && !Array.isArray(labels)) {
    return res.status(400).json({ error: "'labels' precisa ser uma lista" });
  }
  const forcedRecipient = typeof recipient === 'string' && recipient.trim() ? recipient.trim() : null;

  try {
    const rendered = await renderTemplates(labels || []);
    const results = [];
    for (const item of rendered) {
      if (!item.ok) {
        results.push({ label: item.label, ok: false, error: item.error });
        continue;
      }
      const to = forcedRecipient || recipientFor(item.label);
      const created = await insertEmail({ title: item.label, recipient: to, body: rewriteClaimUrls(item.html) });
      results.push({ label: item.label, ok: true, id: created.id, recipient: to });
    }
    res.json({ sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
  } catch (error) {
    res.status(502).json({ error: `Falha ao renderizar os templates: ${error.message}` });
  }
}
