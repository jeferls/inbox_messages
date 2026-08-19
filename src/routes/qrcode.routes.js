import { Router } from 'express';
import os from 'node:os';
import QRCode from 'qrcode';

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
