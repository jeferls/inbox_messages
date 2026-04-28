import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

// Isola banco em arquivo temporário antes de carregar o app
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inbox-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');

const { default: app } = await import('../src/app.js');

const server = app.listen(0);
const address = server.address();
const baseURL = `http://127.0.0.1:${address.port}`;

test('GET /api/health', async () => {
  const res = await fetch(`${baseURL}/api/health`);
  assert.equal(res.ok, true);
  const body = await res.json();
  assert.equal(body.ok, true);
});

test('emails flow: create, list, get (marks read), delete-all', async () => {
  // Create
  const createRes = await fetch(`${baseURL}/api/emails`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Teste', recipient: 'user@example.com', body: 'Olá mundo' })
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  assert.ok(created?.id);

  // List
  const listRes = await fetch(`${baseURL}/api/emails?limit=10`);
  assert.equal(listRes.ok, true);
  const list = await listRes.json();
  assert.ok(list.total >= 1);
  assert.ok(Array.isArray(list.items));

  // Get by id (marks as read)
  const getRes = await fetch(`${baseURL}/api/emails/${created.id}`);
  assert.equal(getRes.ok, true);
  const got = await getRes.json();
  assert.equal(got.id, created.id);
  assert.equal(got.read, 1);

  // Delete all
  const delRes = await fetch(`${baseURL}/api/emails`, { method: 'DELETE' });
  assert.equal(delRes.ok, true);
  const del = await delRes.json();
  assert.equal(del.ok, true);

  // List again should be empty
  const listRes2 = await fetch(`${baseURL}/api/emails?limit=10`);
  const list2 = await listRes2.json();
  assert.equal(list2.total, 0);
});

test('liquidacoes: delete all lots', async () => {
  const minimalPayload = {
    grupoSLC0912Centrlz: {
      grupoSLC0912PontoVenda: [{ numCtrlCreddrPontoVenda: '99999999901234567890' }],
    },
  };

  const createRes = await fetch(`${baseURL}/api/slc/v1/liquidacoes-antecipacao`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(minimalPayload),
  });
  assert.equal(createRes.status, 201);

  const delAllRes = await fetch(`${baseURL}/api/slc/v1/liquidacoes-antecipacao`, {
    method: 'DELETE',
  });
  assert.equal(delAllRes.status, 200);
  const delBody = await delAllRes.json();
  assert.equal(delBody.ok, true);
  assert.ok(Number(delBody.deleted) >= 1);

  const listRes = await fetch(`${baseURL}/api/slc/v1/liquidacoes-antecipacao?limit=50`);
  const list = await listRes.json();
  assert.equal(list.total, 0);
});

test('liquidacoes antecipacao flow: create lot and get processing', async () => {
  const grupoSLC0912PontoVenda = Array.from({ length: 1000 }, (_, idx) => ({
    numCtrlCreddrPontoVenda: `12345678901234567${String(idx).padStart(3, '0')}`,
    ispbIfLiquidPontoVenda: '12345678',
    codPontoVenda: `12345678901234567890${String(idx).padStart(5, '0')}`,
    nomePontoVenda: `Nome do Ponto de Venda ${idx + 1}`,
    tpPessoaPontoVenda: 'J',
    cnpjCpfPontoVenda: `282189550001${String(idx).padStart(2, '0')}`,
    codInstitdrArrajPgto: '003',
    tpProdLiquidCarts: '01',
    indrFormaTransf: '3',
    codMoeda: '001',
    tpPontoVenda: 'EC',
    tpVlrPgto: 'MP',
    dtPgto: '2024-07-20',
    vlrPgto: 1000.55,
    formaPgto: null,
    numCtrlPgto: null,
  }));

  const payload = {
    cnpjBaseCreddr: '12345678',
    cnpjCreddr: '12345678901234',
    ispbIfDevdr: '10066408',
    ispbIfCredr: '01234567',
    agCreddr: '0002',
    ctCreddr: 2345678900,
    nomCreddr: 'Nome do Credenciador',
    grupoSLC0912Centrlz: {
      numCtrlCreddrCentrlz: '12345678901234567890',
      tpPessoaCentrlz: 'J',
      cnpjCpfCentrlz: '12345678901234',
      codCentrlz: '1234567891234567891236548',
      tpCt: 'CC',
      agCentrlz: '1234',
      ctCentrlz: 12345678,
      ctPgtoCentrlz: null,
      grupoSLC0912PontoVenda,
    },
  };

  const createRes = await fetch(`${baseURL}/api/slc/v1/liquidacoes-antecipacao`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  assert.match(created.numCtrlCip, /^[0-9]{20}$/);

  const getRes = await fetch(`${baseURL}/api/slc/v1/liquidacoes/${created.numCtrlCip}/processamento`);
  assert.equal(getRes.status, 200);
  const processamento = await getRes.json();

  assert.equal(processamento.situacao, 'F');
  assert.ok(Array.isArray(processamento.grupoPontoVendaActo));
  assert.ok(Array.isArray(processamento.grupoPontoVendaRecsdo));

  const totalProcessados =
    processamento.grupoPontoVendaActo.length + processamento.grupoPontoVendaRecsdo.length;
  assert.equal(totalProcessados, 1000);

  const listRes = await fetch(`${baseURL}/api/slc/v1/liquidacoes-antecipacao?limit=10`);
  assert.equal(listRes.status, 200);
  const list = await listRes.json();
  assert.ok(Array.isArray(list.items));
  assert.ok(list.items.some((item) => item.numCtrlCip === created.numCtrlCip));

  const getLoteRes = await fetch(`${baseURL}/api/slc/v1/liquidacoes/${created.numCtrlCip}`);
  assert.equal(getLoteRes.status, 200);
  const loteFull = await getLoteRes.json();
  assert.equal(loteFull.numCtrlCip, created.numCtrlCip);
  assert.equal(loteFull.requisicao.cnpjBaseCreddr, '12345678');
  assert.equal(loteFull.processamento.situacao, 'F');

  const processamentoEditado = { ...processamento, situacao: 'P', observacaoEdicao: 'teste-integracao' };
  const putRes = await fetch(`${baseURL}/api/slc/v1/liquidacoes/${created.numCtrlCip}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ processamento: processamentoEditado }),
  });
  assert.equal(putRes.status, 200);
  const atualizado = await putRes.json();
  assert.equal(atualizado.processamento.situacao, 'P');
  assert.equal(atualizado.processamento.observacaoEdicao, 'teste-integracao');

  const getProc2 = await fetch(`${baseURL}/api/slc/v1/liquidacoes/${created.numCtrlCip}/processamento`);
  assert.equal(getProc2.status, 200);
  const proc2 = await getProc2.json();
  assert.equal(proc2.situacao, 'P');

  const deleteRes = await fetch(`${baseURL}/api/slc/v1/liquidacoes/${created.numCtrlCip}`, {
    method: 'DELETE',
  });
  assert.equal(deleteRes.status, 200);
  const deleted = await deleteRes.json();
  assert.equal(deleted.ok, true);

  const getAfterDeleteRes = await fetch(`${baseURL}/api/slc/v1/liquidacoes/${created.numCtrlCip}/processamento`);
  assert.equal(getAfterDeleteRes.status, 404);
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

