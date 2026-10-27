import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSignatureHeader,
  buildTransferPayload,
  maskSecret,
  signTransfeera,
} from '../src/services/transfeera-webhook.service.js';

const SECRET = 'test-secret';
const BODY = '{"a":1}';
const T = 1700000000;
const NOW = T * 1000;

test('signTransfeera: HMAC-SHA256 hex de `${t}.${rawBody}` (vetor fixo)', () => {
  assert.equal(signTransfeera(T, BODY, SECRET), '8cb2c3355fca388e9ac2caec004f4d5d7045d74937ab5faad61dc11682247a9f');
});

test('header válido assina com o timestamp atual', () => {
  assert.equal(buildSignatureHeader('valid', { rawBody: BODY, secret: SECRET, now: NOW }), `t=${T},v1=8cb2c3355fca388e9ac2caec004f4d5d7045d74937ab5faad61dc11682247a9f`);
});

test('header inválido mantém o formato com v1 aleatório', () => {
  const header = buildSignatureHeader('invalid', { rawBody: BODY, secret: SECRET, now: NOW });
  const match = header.match(/^t=(\d+),v1=([0-9a-f]{64})$/);
  assert.ok(match);
  assert.equal(Number(match[1]), T);
  assert.notEqual(match[2], signTransfeera(T, BODY, SECRET));
});

test('modo sem header devolve null', () => {
  assert.equal(buildSignatureHeader('missing', { rawBody: BODY, secret: SECRET, now: NOW }), null);
});

test('timestamp antigo: t = agora - 1h e assinatura válida para esse t', () => {
  const old = T - 3600;
  assert.equal(
    buildSignatureHeader('stale', { rawBody: BODY, secret: SECRET, now: NOW }),
    `t=${old},v1=${signTransfeera(old, BODY, SECRET)}`,
  );
});

test('header malformado não segue t=...,v1=...', () => {
  const header = buildSignatureHeader('malformed', { rawBody: BODY, secret: SECRET, now: NOW });
  assert.doesNotMatch(header, /^t=\d+,v1=[0-9a-f]{64}$/);
});

test('modo desconhecido lança erro', () => {
  assert.throws(() => buildSignatureHeader('xpto', { rawBody: BODY, secret: SECRET, now: NOW }));
});

test('payload: integration_id, valor, returned_date só em DEVOLVIDO e pix_end2end_id com 32 chars', () => {
  const withdraw = { id: 185, amount: 95.01 };
  const finalizado = buildTransferPayload({ withdraw, status: 'FINALIZADO' });
  const devolvido = buildTransferPayload({ withdraw, status: 'DEVOLVIDO' });

  assert.equal(finalizado.object, 'Transfer');
  assert.equal(finalizado.data.integration_id, '185');
  assert.equal(finalizado.data.value, 95.01);
  assert.equal(finalizado.data.returned_date, null);
  assert.ok(devolvido.data.returned_date);
  assert.match(finalizado.data.pix_end2end_id, /^E[0-9A-Za-z]{31}$/);
});

test('maskSecret não expõe o segredo inteiro', () => {
  const masked = maskSecret('abcdefghijklmnopqrstuvwxyz');
  assert.equal(masked, 'abcd********wxyz');
  assert.equal(maskSecret('short'), '*****');
});
