import {
  MetaError,
  addSseClient,
  clearMessages,
  getState,
  loadTemplates,
  receiveInbound,
  sendGraphMessage,
  updateConfig,
} from '../services/wa-mock.service.js';

/** Endpoint que substitui graph.facebook.com/v20.0/{phoneNumberId}/messages. */
export function graphMessagesHandler(req, res) {
  try {
    res.json(sendGraphMessage(req.body || {}, req.params.phoneNumberId));
  } catch (error) {
    if (error instanceof MetaError) return res.status(error.status).json(error.toJSON());
    res.status(500).json(new MetaError(error.message, 500, 1).toJSON());
  }
}

/** Qualquer outro caminho /vXX.X/... da Graph API: erro no formato Meta. */
export function graphUnsupportedHandler(req, res) {
  res.status(400).json(new MetaError(`Endpoint não suportado pelo mock: ${req.method} ${req.path}`).toJSON());
}

export function eventsHandler(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  addSseClient(res, (cleanup) => req.on('close', cleanup));
}

export function stateHandler(_req, res) {
  res.json(getState());
}

export function templatesHandler(_req, res) {
  res.json(loadTemplates());
}

export function inboundHandler(req, res) {
  const body = req.body || {};
  if (!body.message?.type) return res.status(400).json({ error: 'message.type obrigatório' });
  res.json(receiveInbound(body));
}

export function configHandler(req, res) {
  res.json(updateConfig(req.body || {}));
}

export function clearHandler(_req, res) {
  clearMessages();
  res.json({ ok: true });
}
