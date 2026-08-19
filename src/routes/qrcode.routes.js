import { Router } from 'express';
import os from 'node:os';
import QRCode from 'qrcode';
import { getGreennPool } from '../services/greenn-db.js';

const router = Router();

// IPs de rede local do host (ignora loopback e faixas internas do Docker)
router.get('/qrcode/hosts', (req, res) => {
  const ips = [];
  // Em container o IP da LAN não é visível: permite informar via env LAN_HOST
  if (process.env.LAN_HOST) ips.push({ iface: 'env', address: process.env.LAN_HOST });
  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (/^(docker|br-|veth|lo)/.test(name)) continue;
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (/^172\.(1[6-9]|2\d|3[01])\./.test(a.address)) continue;
      ips.push({ iface: name, address: a.address });
    }
  }
  res.json({ ips });
});

// Produtos de um seller com suas ofertas ativas. O checkout abre por
// /{product_id} (id numerico) e a oferta especifica vai em ?offer=<hash>.
router.get('/qrcode/checkout-offers', async (req, res) => {
  const sellerId = Number(req.query.seller_id);
  if (!Number.isInteger(sellerId) || sellerId <= 0) {
    return res.status(400).json({ error: 'Informe um seller_id válido' });
  }

  // Filtro opcional: restringe a um produto do proprio seller
  const hasProductFilter = req.query.product_id != null && String(req.query.product_id).trim() !== '';
  const productId = Number(req.query.product_id);
  if (hasProductFilter && (!Number.isInteger(productId) || productId <= 0)) {
    return res.status(400).json({ error: 'product_id inválido' });
  }

  try {
    const params = [sellerId];
    if (hasProductFilter) params.push(productId);

    const [rows] = await getGreennPool().query(
      `SELECT p.id AS product_id, p.name AS product_name, p.status AS product_status,
              o.hash, o.name AS offer_name, o.amount, o.default AS is_default
         FROM products_has_offers o
         JOIN products p ON p.id = o.product_id AND p.deleted_at IS NULL
        WHERE o.deleted_at IS NULL
          AND p.status = 'APPROVED'
          AND p.seller_id = ?
          ${hasProductFilter ? 'AND p.id = ?' : ''}
        ORDER BY p.id DESC, o.id DESC
        LIMIT 100`,
      params,
    );
    res.json({ sellerId, productId: hasProductFilter ? productId : null, offers: rows });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

router.get('/qrcode.png', async (req, res) => {
  const text = String(req.query.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Parâmetro "text" é obrigatório' });
  const size = Math.min(Math.max(Number(req.query.size) || 320, 96), 1024);
  try {
    const buf = await QRCode.toBuffer(text, { type: 'png', width: size, margin: 2, errorCorrectionLevel: 'M' });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

export default router;
