import { insertEmail, queryEmails, getEmailById, markEmailRead, deleteAllEmails } from '../db/index.js';
import { rewriteClaimUrls } from '../utils/urlRewrite.js';

function apiEmail(row) {
  if (!row || typeof row !== 'object') return row;
  return { ...row, to_address: row.recipient, body_email: row.body };
}

export async function createEmail(req, res) {
  try {
    const { titulo, title, destinatario, recipient, to_address, body, body_email } = req.body || {};
    const finalTitle = (title ?? titulo ?? '').toString().trim();
    const finalRecipient = (recipient ?? destinatario ?? to_address ?? '').toString().trim();
    const finalBody = (body ?? body_email ?? '').toString();

    if (!finalTitle || !finalRecipient || !finalBody) {
      return res.status(400).json({ error: 'Campos obrigatórios: titulo/title, destinatario/recipient/to_address, body/body_email' });
    }

    const created = await insertEmail({ title: finalTitle, recipient: finalRecipient, body: rewriteClaimUrls(finalBody) });
    res.status(201).json(apiEmail(created));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao salvar email' });
  }
}

export async function listEmailsHandler(req, res) {
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
    let offset = Math.max(0, Number(req.query.offset) || 0);
    const page = req.query.page != null ? Math.max(0, Number(req.query.page) || 0) : null;
    if (page != null) offset = page * limit;

    const rawSearch = (req.query.search || '').toString().trim();
    const search = rawSearch.length ? rawSearch : undefined;
    const unread = ['1', 'true', 'yes', 'on'].includes(String(req.query.unread).toLowerCase());

    const result = await queryEmails({ limit, offset, search, unread });
    const items = (result.items || []).map(apiEmail);
    res.json({ ...result, items, limit, offset });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar emails' });
  }
}

export async function getEmailHandler(req, res) {
  try {
    const id = Number(req.params.id);
    const email = await getEmailById(id);
    if (!email) return res.status(404).json({ error: 'Email não encontrado' });
    await markEmailRead(id);
    const updated = { ...email, read: 1 };
    res.json(apiEmail(updated));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao obter email' });
  }
}

export async function clearEmailsHandler(req, res) {
  try {
    await deleteAllEmails();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao limpar emails' });
  }
}


// Formato da API de envio do Mailtrap (POST /api/send/:inboxId), usado pelo messages em ambiente
// local (Helpers/Email.php → sendByMailTrap). Resposta imita a do Mailtrap: { success, message_ids }.
export async function createMailtrapEmail(req, res) {
  try {
    const { from, to, subject, text, html } = req.body || {};
    const recipient = (Array.isArray(to) ? to[0]?.email : to?.email ?? '').toString().trim();
    const finalTitle = (subject ?? '').toString().trim();
    const finalBody = (html ?? text ?? '').toString();
    if (!finalTitle || !recipient || !finalBody) {
      return res.status(400).json({ success: false, errors: ['Campos obrigatórios: subject, to[0].email, text ou html'] });
    }
    const created = await insertEmail({ title: finalTitle, recipient, body: rewriteClaimUrls(finalBody) });
    return res.status(200).json({ success: true, message_ids: [String(created.id)] });
  } catch (err) {
    return res.status(500).json({ success: false, errors: [String(err)] });
  }
}
