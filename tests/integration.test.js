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

test('GET /holiday/check/:date', async () => {
  const res = await fetch(`${baseURL}/holiday/check/2026-05-01`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.isHoliday, false);
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

test('receivables flow: create, list, get, update, delete and delete-all', async () => {
  const payload = {
    processReference: null,
    receivables: [
      {
        id: 11,
        key: 'processing',
        reference: 'UR_UPy87wFHAN0NIZSLt8JIFwHPvgdBrII6',
        user_id: 278,
        dueDate: '2026-04-16',
        originalAssetHolderDocumentType: 'CPF',
        originalAssetHolder: '60100036015',
        paymentScheme: 'MCC',
        amount: 1325,
        prePaidAmount: 0,
        bankAccount: {
          branch: '4593',
          account: '0000000',
          accountDigit: '7',
          accountType: 'CC',
          documentType: 'CPF',
          documentNumber: '60100036015',
          ispb: '00000000',
        },
      },
    ],
  };

  const createRes = await fetch(`${baseURL}/api/slc/v1/receivables`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  assert.match(created.processKey, /^[0-9a-f-]{36}$/i);
  assert.ok(Array.isArray(created.receivables));
  assert.equal(created.receivables.length, 1);
  assert.notEqual(created.receivables[0].key, 'processing');
  assert.match(created.receivables[0].key, /^[0-9a-f]{32}$/i);
  assert.ok(Array.isArray(created.receivables[0].settlements));
  assert.equal(created.receivables[0].settlements.length, 1);
  assert.ok(Array.isArray(created.receivables[0].settlementObligations));
  assert.ok(Array.isArray(created.receivables[0].settlementObligations[0].settlements));

  const listRes = await fetch(`${baseURL}/api/slc/v1/receivables?limit=10`);
  assert.equal(listRes.status, 200);
  const list = await listRes.json();
  assert.ok(Array.isArray(list.items));
  assert.ok(list.items.some((x) => x.processKey === created.processKey));

  const listByKeyRes = await fetch(`${baseURL}/api/slc/v1/receivables?limit=10&key=${created.processKey}`);
  assert.equal(listByKeyRes.status, 200);
  const listByKey = await listByKeyRes.json();
  assert.ok(Array.isArray(listByKey.items));
  assert.ok(listByKey.items.some((x) => x.processKey === created.processKey));

  const getRes = await fetch(`${baseURL}/api/slc/v1/receivables/${created.processKey}`);
  assert.equal(getRes.status, 200);
  const full = await getRes.json();
  assert.equal(full.processKey, created.processKey);
  assert.equal(full.request.processReference, null);
  assert.equal(full.response.processKey, created.processKey);
  assert.ok(Array.isArray(full.response.receivables?.[0]?.settlementObligations));
  assert.ok(Array.isArray(full.response.receivables?.[0]?.settlementObligations?.[0]?.settlements));
  assert.equal(full.response.receivables?.[0]?.settlementObligations?.[0]?.settlements?.length, 0);

  const settlementPayload = {
    idempotencyKey: null,
    settlements: [
      {
        reference: 'ST_TEST_001',
        originalAssetHolder: '60100036015',
        assetHolderDocumentType: 'CPF',
        assetHolder: '60100036015',
        settlementDate: '2026-04-16',
        amount: 21014,
        settlementObligationDate: '2026-04-16',
        paymentScheme: 'MCC',
        bankAccount: {
          branch: '4593',
          account: '0000000',
          accountDigit: '7',
          accountType: 'CC',
          documentType: 'CPF',
          documentNumber: '60100036015',
          ispb: '00000000',
        },
      },
    ],
  };

  const patchSettlementRes = await fetch(`${baseURL}/receivable/settlement`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settlementPayload),
  });
  assert.equal(patchSettlementRes.status, 200);
  const patchSettlementBody = await patchSettlementRes.json();
  assert.ok(Array.isArray(patchSettlementBody.settlements));
  assert.equal(patchSettlementBody.settlements.length, 1);
  assert.match(String(patchSettlementBody.processKey), /^[0-9a-f-]{36}$/i);
  assert.ok(patchSettlementBody.createdAt);

  const getAfterSettlementRes = await fetch(`${baseURL}/api/slc/v1/receivables/${created.processKey}`);
  assert.equal(getAfterSettlementRes.status, 200);
  const afterSettlement = await getAfterSettlementRes.json();
  const obligation = afterSettlement.response.receivables[0].settlementObligations[0];
  assert.equal(obligation.settledAmount, 21014);
  assert.equal(obligation.committedAmount, 21014);
  assert.equal(obligation.balanceAmount, obligation.totalAmount - 21014);
  assert.equal(obligation.uncommittedAmount, obligation.totalAmount - 21014);
  assert.ok(Array.isArray(obligation.settlements));
  assert.equal(obligation.settlements.length, 1);

  const patchSettlementAgainRes = await fetch(`${baseURL}/receivable/settlement`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...settlementPayload,
      settlements: [{ ...settlementPayload.settlements[0], amount: 99999 }],
    }),
  });
  assert.equal(patchSettlementAgainRes.status, 200);
  const patchSettlementAgainBody = await patchSettlementAgainRes.json();
  assert.ok(Array.isArray(patchSettlementAgainBody.settlements));
  assert.equal(patchSettlementAgainBody.settlements.length, 1);

  const getAfterSettlementAgainRes = await fetch(`${baseURL}/api/slc/v1/receivables/${created.processKey}`);
  const afterSettlementAgain = await getAfterSettlementAgainRes.json();
  const obligationAgain = afterSettlementAgain.response.receivables[0].settlementObligations[0];
  assert.equal(obligationAgain.settlements.length, 1);
  assert.equal(obligationAgain.settlements[0].amount, 21014);

  const sameComboPayload = {
    processReference: 'again',
    receivables: [
      {
        reference: 'UR_DIFFERENT_SHOULD_NOT_OVERRIDE',
        dueDate: '2026-04-16',
        originalAssetHolder: '60100036015',
        paymentScheme: 'MCC',
        amount: 9999,
        bankAccount: { documentNumber: '00000000000' },
      },
    ],
  };
  const createSameComboRes = await fetch(`${baseURL}/api/slc/v1/receivables`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sameComboPayload),
  });
  assert.equal(createSameComboRes.status, 200);
  const sameComboCreated = await createSameComboRes.json();
  assert.equal(sameComboCreated.receivables[0].key, created.receivables[0].key);
  assert.equal(sameComboCreated.receivables[0].reference, created.receivables[0].reference);

  const getOldAfterSameComboRes = await fetch(`${baseURL}/api/slc/v1/receivables/${created.processKey}`);
  assert.equal(getOldAfterSameComboRes.status, 200);
  const oldAfterSameCombo = await getOldAfterSameComboRes.json();
  assert.equal(oldAfterSameCombo.response.receivables[0].key, created.receivables[0].key);
  assert.equal(oldAfterSameCombo.response.receivables[0].amount, 9999);
  assert.equal(oldAfterSameCombo.request.receivables[0].amount, 9999);

  const updatedResponse = { ...full.response, processKey: full.response.processKey, status: 'UPDATED' };
  const putRes = await fetch(`${baseURL}/api/slc/v1/receivables/${created.processKey}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: updatedResponse }),
  });
  assert.equal(putRes.status, 200);
  const updated = await putRes.json();
  assert.equal(updated.response.status, 'UPDATED');

  const delOneRes = await fetch(`${baseURL}/api/slc/v1/receivables/${created.processKey}`, {
    method: 'DELETE',
  });
  assert.equal(delOneRes.status, 200);
  const delOne = await delOneRes.json();
  assert.equal(delOne.ok, true);

  const createRes2 = await fetch(`${baseURL}/api/slc/v1/receivables`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(createRes2.status, 201);

  const delAllRes = await fetch(`${baseURL}/api/slc/v1/receivables`, { method: 'DELETE' });
  assert.equal(delAllRes.status, 200);
  const delAll = await delAllRes.json();
  assert.equal(delAll.ok, true);
  assert.ok(Number(delAll.deleted) >= 1);
});

test('receivable direct endpoint flow: create via /receivable', async () => {
  const payload = {
    processReference: null,
    receivables: [
      {
        id: 21,
        reference: 'UR_DIRECT_001',
        dueDate: '2026-04-17',
        originalAssetHolder: '99999999999999',
        paymentScheme: 'GCC',
        bankAccount: { documentNumber: '88888888888888' },
      },
    ],
  };

  const createRes = await fetch(`${baseURL}/receivable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  assert.match(created.processKey, /^[0-9a-f-]{36}$/i);

  const getRes = await fetch(`${baseURL}/receivable/${created.processKey}`);
  assert.equal(getRes.status, 200);
  const got = await getRes.json();
  assert.equal(got.processKey, created.processKey);
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});


test('POST /api/send/:inboxId aceita o formato da API do Mailtrap', async () => {
  const res = await fetch(`${baseURL}/api/send/3897690`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: { email: 'no-reply@greenn.com.br', name: 'Greenn' }, to: [{ email: 'cliente@exemplo.com' }], subject: 'Pedido aprovado', text: 'Olá!' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.message_ids.length, 1);
});
