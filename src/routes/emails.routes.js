import { Router } from 'express';
import { createEmail, listEmailsHandler, getEmailHandler, clearEmailsHandler } from '../controllers/emails.controller.js';
import { insertEmail, appendEmailBody, deleteEmailById } from '../db/index.js';
import { logLine } from '../utils/logger.js';

const router = Router();

router.post('/emails', createEmail);
router.post('/send', createEmail);
// Streaming de corpo grande: POST /api/emails/stream?title=...&recipient=...
router.post('/emails/stream', async (req, res) => {
  const title = (req.query.title || '').toString().trim();
  const recipient = (req.query.recipient || req.query.to || '').toString().trim();
  if (!title || !recipient) {
    return res.status(400).json({ error: 'Parâmetros obrigatórios: title e recipient (query string)' });
  }
  const reqId = req._reqId || '-';
  const ct = req.headers['content-type'] || '-';
  const cl = req.headers['content-length'] || null;
  await logLine('info', 'stream-start', { reqId, title, recipient, ct, cl }).catch(() => {});

  try {
    const created = await insertEmail({ title, recipient, body: '' });
    const id = created.id;
    let buffered = '';
    let bytes = 0;
    let chunks = 0;
    const FLUSH_AT = 64 * 1024; // 64KB
    req.setEncoding('utf8');

    req.on('data', async (chunk) => {
      chunks += 1;
      bytes += Buffer.byteLength(chunk);
      buffered += chunk;
      if (buffered.length >= FLUSH_AT) {
        req.pause();
        const toWrite = buffered;
        buffered = '';
        try { await appendEmailBody(id, toWrite); }
        finally { req.resume(); }
      }
    });

    req.on('aborted', async () => {
      await deleteEmailById(id).catch(() => {});
      await logLine('warn', 'stream-aborted', { reqId, id, bytes, chunks }).catch(() => {});
    });

    req.on('end', async () => {
      try {
        if (buffered.length) await appendEmailBody(id, buffered);
        await logLine('info', 'stream-end', { reqId, id, bytes, chunks }).catch(() => {});
        res.status(201).json({ ...created, id });
      } catch (e) {
        await deleteEmailById(id).catch(() => {});
        await logLine('error', 'stream-fail-end', { reqId, id, error: String(e) }).catch(() => {});
        res.status(500).json({ error: 'Falha ao finalizar upload' });
      }
    });

    req.on('error', async (e) => {
      await deleteEmailById(id).catch(() => {});
      await logLine('error', 'stream-error', { reqId, id, error: String(e) }).catch(() => {});
      try { res.status(500).json({ error: 'Falha no upload' }); } catch {}
    });
  } catch (err) {
    await logLine('error', 'stream-init-error', { reqId, error: String(err) }).catch(() => {});
    res.status(500).json({ error: 'Erro ao iniciar upload' });
  }
});
router.get('/emails', listEmailsHandler);
router.get('/emails/:id', getEmailHandler);
router.delete('/emails', clearEmailsHandler);

export default router;
