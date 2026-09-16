import {
  NotFoundError,
  ValidationError,
  checkToken,
  create,
  getLog,
  list,
  remove,
  reset,
  start,
  stop,
  update,
} from '../services/whs-forward.service.js';

function handle(res, fn) {
  return Promise.resolve()
    .then(fn)
    .then((data) => res.json(data ?? { ok: true }))
    .catch((error) => {
      if (error instanceof ValidationError) return res.status(400).json({ error: error.message });
      if (error instanceof NotFoundError) return res.status(404).json({ error: error.message });
      res.status(502).json({ error: error.message });
    });
}

export const listHandler = (_req, res) => handle(res, () => list());
export const createHandler = (req, res) => handle(res, () => create(req.body || {}));
export const updateHandler = (req, res) => handle(res, () => update(req.params.id, req.body || {}));
export const deleteHandler = (req, res) => handle(res, () => { remove(req.params.id); });
export const startHandler = (req, res) => handle(res, () => start(req.params.id, { backfill: Boolean(req.body?.backfill) }));
export const stopHandler = (req, res) => handle(res, () => stop(req.params.id));
export const resetHandler = (req, res) => handle(res, () => reset(req.params.id));
export const logHandler = (req, res) => handle(res, () => getLog(req.params.id));
export const checkHandler = (req, res) => handle(res, () => checkToken(req.body || {}));
