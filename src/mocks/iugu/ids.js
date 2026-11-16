import crypto from 'node:crypto';
import { IUGU_MOCK } from '../../config/env.js';

/** Iugu ids (invoice, account, customer, payment method, token): 32 uppercase hex chars. */
export function iuguId() {
  return crypto.randomBytes(16).toString('hex').toUpperCase();
}

/** Iugu API tokens are 32 hex chars as well. */
export function iuguApiToken() {
  return crypto.randomBytes(16).toString('hex').toUpperCase();
}

/** The invoice secure_id: a lowercase uuid plus a 4-char suffix, as in faturas.iugu.com links. */
export function secureId() {
  return `${crypto.randomUUID()}-${crypto.randomBytes(2).toString('hex')}`;
}

export function randomDigits(length) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += String(bytes[i] % 10);
  return out;
}

export function isIuguId(value) {
  return typeof value === 'string' && /^[0-9A-F]{32}$/i.test(value);
}

export function nowIso() {
  return new Date().toISOString();
}

/** Iugu answers *_iso in the account timezone; the mock keeps -03:00. */
export function toIugu(date = new Date()) {
  const shifted = new Date(date.getTime() - 3 * 3600 * 1000);
  return shifted.toISOString().replace(/\.\d{3}Z$/, '-03:00');
}

export function isoDate(date = new Date()) {
  return toIugu(date).slice(0, 10);
}

export function brl(cents) {
  const value = (Number(cents || 0) / 100).toFixed(2);
  const [int, dec] = value.split('.');
  const sign = int.startsWith('-') ? '-' : '';
  const digits = int.replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}R$ ${digits},${dec}`;
}

// ─── Bank slip and Pix ────────────────────────────────────────────────────────

export function bankSlipNumbers() {
  return {
    digitable_line: randomDigits(47),
    barcode_data: randomDigits(44),
  };
}

function crc16(payload) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function emvField(id, value) {
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

/** A well-formed (CRC-valid) Pix copy-and-paste string pointing at a fake PSP. */
export function pixCopyPaste(invoiceId, amountCents) {
  const account = emvField('00', 'br.gov.bcb.pix') + emvField('25', `qr.iugu-mock.local/pix/${invoiceId.toLowerCase()}`);
  const body =
    emvField('00', '01') +
    emvField('01', '12') +
    emvField('26', account) +
    emvField('52', '0000') +
    emvField('53', '986') +
    emvField('54', (amountCents / 100).toFixed(2)) +
    emvField('58', 'BR') +
    emvField('59', 'IUGU MOCK') +
    emvField('60', 'SAO PAULO') +
    emvField('62', emvField('05', '***'));
  const withCrcId = `${body}6304`;
  return withCrcId + crc16(withCrcId);
}

// ─── sec-proxy token envelopes ────────────────────────────────────────────────

const ENVELOPE_KID = 'mock';

function mac(payload) {
  return crypto.createHmac('sha256', IUGU_MOCK.envelopeSecret).update(payload).digest('hex').slice(0, 24);
}

/**
 * The proxy never hands out a raw token: it answers `v1.<kid>.<payload>.<mac>`, the
 * four-segment shape IuguTokenEnvelope::matches() accepts in greenn-back.
 */
export function sealToken(rawToken) {
  const payload = Buffer.from(String(rawToken), 'utf8').toString('base64url');
  return `v1.${ENVELOPE_KID}.${payload}.${mac(`${ENVELOPE_KID}.${payload}`)}`;
}

/** @returns {{ ok: true, token: string } | { ok: false, code: 'envelope_malformed' | 'envelope_unauthentic' }} */
export function unsealToken(envelope) {
  const value = String(envelope ?? '').trim();
  const segments = value.split('.');
  if (!value.startsWith('v1.') || segments.length !== 4 || segments.includes('')) {
    return { ok: false, code: 'envelope_malformed' };
  }
  const [, kid, payload, signature] = segments;
  const expected = mac(`${kid}.${payload}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (kid !== ENVELOPE_KID || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, code: 'envelope_unauthentic' };
  }
  return { ok: true, token: Buffer.from(payload, 'base64url').toString('utf8') };
}

export function isEnvelope(value) {
  const segments = String(value ?? '').split('.');
  return String(value ?? '').startsWith('v1.') && segments.length === 4 && !segments.includes('');
}

export function maskToken(token) {
  const value = String(token ?? '');
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
