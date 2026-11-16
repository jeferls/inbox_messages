import { Router } from 'express';
import {
  directApiHandler,
  proxyHandler,
  invoicePageHandler,
  pixQrHandler,
  barcodeHandler,
  overviewHandler,
  listAccountsHandler,
  getAccountHandler,
  createAccountHandler,
  accountActionHandler,
  listInvoicesHandler,
  getInvoiceHandler,
  invoiceActionHandler,
  listRequestsHandler,
  clearRequestsHandler,
  getSettingsHandler,
  updateSettingsHandler,
  resetHandler,
} from '../controllers/iugu-mock.controller.js';

const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

const router = Router();

// Public pages linked from secure_url, pix.qrcode and bank_slip.barcode
router.get('/iugu/faturas/:secure/barcode', wrap(barcodeHandler));
router.get('/iugu/faturas/:secure', wrap(invoicePageHandler));
router.get('/iugu/pix/:id', wrap(pixQrHandler));

// sec-proxy: IUGU_SEC_PROXY_BASE_URL=http://svc-inbox_messages/iugu-proxy (the clients add /iugu)
router.all(/^\/iugu-proxy\/iugu(\/.*)?$/, (req, res, next) => {
  req.url = req.url.replace(/^\/iugu-proxy\/iugu/, '') || '/';
  wrap(proxyHandler)(req, res, next);
});

// Direct API: IUGU_API_URL / config('iugu.api_url') = http://svc-inbox_messages/iugu/v1/
router.all(/^\/iugu\/v1(\/.*)?$/, (req, res, next) => {
  req.url = req.url.replace(/^\/iugu/, '') || '/';
  wrap(directApiHandler)(req, res, next);
});

// Panel
router.get('/api/iugu-mock/overview', wrap(overviewHandler));
router.get('/api/iugu-mock/accounts', wrap(listAccountsHandler));
router.post('/api/iugu-mock/accounts', wrap(createAccountHandler));
router.get('/api/iugu-mock/accounts/:id', wrap(getAccountHandler));
router.post('/api/iugu-mock/accounts/:id/actions', wrap(accountActionHandler));
router.get('/api/iugu-mock/invoices', wrap(listInvoicesHandler));
router.get('/api/iugu-mock/invoices/:id', wrap(getInvoiceHandler));
router.post('/api/iugu-mock/invoices/:id/actions', wrap(invoiceActionHandler));
router.get('/api/iugu-mock/requests', wrap(listRequestsHandler));
router.delete('/api/iugu-mock/requests', wrap(clearRequestsHandler));
router.get('/api/iugu-mock/settings', wrap(getSettingsHandler));
router.put('/api/iugu-mock/settings', wrap(updateSettingsHandler));
router.delete('/api/iugu-mock/data', wrap(resetHandler));

export default router;
