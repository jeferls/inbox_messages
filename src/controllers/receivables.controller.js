import crypto from 'node:crypto';
import {
  createReceivableProcess,
  deleteAllReceivableProcesses,
  deleteReceivableProcessByKey,
  getReceivableProcessByKey,
  listReceivableProcessPayloadResponses,
  queryReceivableProcesses,
  updateReceivableProcessRequestByKey,
  updateReceivableProcessResponseByKey,
  updateReceivableProcessByKey,
} from '../db/index.js';

function comboKey({ originalAssetHolder, dueDate, paymentScheme }) {
  return `${String(originalAssetHolder ?? '')}::${String(dueDate ?? '')}::${String(paymentScheme ?? '')}`;
}

function settlementComboKey({ originalAssetHolder, settlementDate, paymentScheme }) {
  return `${String(originalAssetHolder ?? '')}::${String(settlementDate ?? '')}::${String(paymentScheme ?? '')}`;
}

function buildNewStoredReceivable(item, createdAt) {
  const amount = Number(item?.amount ?? 0);
  const prePaidAmount = Number(item?.prePaidAmount ?? 0);
  const committedAmount = Number(item?.committedAmount ?? 0);
  const settledAmount = Number(item?.settledAmount ?? 0);
  const balanceAmount = Number(item?.balanceAmount ?? Math.max(0, amount - settledAmount));
  const uncommittedAmount = Number(item?.uncommittedAmount ?? Math.max(0, balanceAmount - committedAmount));
  const lastUpdated = new Date().toISOString();

  return {
    key: crypto.randomUUID().replaceAll('-', ''),
    reference: item?.reference ?? null,
    dueDate: item?.dueDate ?? null,
    paymentScheme: item?.paymentScheme ?? null,
    debtor: item?.debtor ?? item?.bankAccount?.documentNumber ?? null,
    originalAssetHolderDocumentType: item?.originalAssetHolderDocumentType ?? null,
    originalAssetHolder: item?.originalAssetHolder ?? null,
    amount,
    prePaidAmount,
    createdAt,
    lastUpdated,
    settlementObligations: [
      {
        key: item?.settlementObligationKey || crypto.randomUUID().replaceAll('-', ''),
        totalAmount: amount,
        settledAmount,
        balanceAmount,
        committedAmount,
        uncommittedAmount,
        prePaidAmount,
        expectedSettlementDate: item?.expectedSettlementDate ?? item?.dueDate ?? null,
        originalAssetHolder: item?.originalAssetHolder ?? null,
        originalHolderDocumentType: item?.originalAssetHolderDocumentType ?? null,
        assetHolderDocumentType: item?.assetHolderDocumentType ?? item?.originalAssetHolderDocumentType ?? null,
        assetHolder: item?.assetHolder ?? item?.originalAssetHolder ?? null,
        lastUpdated,
        settlements: [],
      },
    ],
  };
}

function applyAmountOnlyUpdate(receivable, amount) {
  const nextAmount = Number(amount ?? 0);
  const next = { ...receivable, amount: nextAmount };
  if (Array.isArray(next.settlementObligations) && next.settlementObligations.length > 0) {
    const first = { ...next.settlementObligations[0] };
    first.totalAmount = nextAmount;
    if (!Array.isArray(first.settlements)) first.settlements = [];
    next.settlementObligations = [first, ...next.settlementObligations.slice(1)];
  }
  return next;
}

async function buildStoredReceivablesResponse(payload) {
  const receivables = Array.isArray(payload?.receivables) ? payload.receivables : [];
  const createdAt = new Date().toISOString();
  const processKey = crypto.randomUUID();
  const existingRows = await listReceivableProcessPayloadResponses();
  const existingRowsByProcessKey = new Map(existingRows.map((row) => [row.processKey, row]));
  const existingMap = new Map();
  let hasNewReceivable = false;
  let firstMatchedProcessKey = null;

  for (const row of existingRows) {
    const list = Array.isArray(row.payloadResponse?.receivables) ? row.payloadResponse.receivables : [];
    for (let idx = 0; idx < list.length; idx += 1) {
      const r = list[idx];
      const key = comboKey({
        originalAssetHolder: r?.originalAssetHolder,
        dueDate: r?.dueDate,
        paymentScheme: r?.paymentScheme,
      });
      if (!existingMap.has(key)) {
        existingMap.set(key, { processKey: row.processKey, receivableIndex: idx, receivable: r });
      }
    }
  }

  const pendingUpdates = new Map();
  const responseReceivables = receivables.map((item) => {
    const key = comboKey({
      originalAssetHolder: item?.originalAssetHolder,
      dueDate: item?.dueDate,
      paymentScheme: item?.paymentScheme,
    });
    const existing = existingMap.get(key);
    if (!existing) {
      const created = buildNewStoredReceivable(item, createdAt);
      existingMap.set(key, { processKey: processKey, receivableIndex: -1, receivable: created });
      hasNewReceivable = true;
      return created;
    }

    if (!firstMatchedProcessKey) firstMatchedProcessKey = existing.processKey;

    const updatedExisting = applyAmountOnlyUpdate(existing.receivable, item?.amount);
    existing.receivable = updatedExisting;

    const processEntry = pendingUpdates.get(existing.processKey) || null;
    if (!processEntry) {
      const row = existingRows.find((r) => r.processKey === existing.processKey);
      if (row?.payloadResponse || row?.payloadRequest) {
        pendingUpdates.set(existing.processKey, {
          payloadResponse: row?.payloadResponse ? JSON.parse(JSON.stringify(row.payloadResponse)) : null,
          payloadRequest: row?.payloadRequest ? JSON.parse(JSON.stringify(row.payloadRequest)) : null,
        });
      }
    }
    const target = pendingUpdates.get(existing.processKey);
    if (target?.payloadResponse && Array.isArray(target.payloadResponse.receivables) && target.payloadResponse.receivables[existing.receivableIndex]) {
      target.payloadResponse.receivables[existing.receivableIndex] = updatedExisting;
    }
    if (target?.payloadRequest && Array.isArray(target.payloadRequest.receivables)) {
      const idxReq = target.payloadRequest.receivables.findIndex((r) => comboKey({
        originalAssetHolder: r?.originalAssetHolder,
        dueDate: r?.dueDate,
        paymentScheme: r?.paymentScheme,
      }) === key);
      if (idxReq >= 0) {
        const reqItem = { ...target.payloadRequest.receivables[idxReq] };
        reqItem.amount = Number(item?.amount ?? 0);
        target.payloadRequest.receivables[idxReq] = reqItem;
      }
    }

    return updatedExisting;
  });

  for (const [existingProcessKey, updateData] of pendingUpdates.entries()) {
    if (updateData?.payloadResponse) {
      await updateReceivableProcessResponseByKey(existingProcessKey, updateData.payloadResponse);
    }
    if (updateData?.payloadRequest) {
      await updateReceivableProcessRequestByKey(existingProcessKey, updateData.payloadRequest);
    }
  }

  const reusedOnly = !hasNewReceivable && Boolean(firstMatchedProcessKey);
  const baseProcessKey = reusedOnly ? firstMatchedProcessKey : processKey;
  const baseCreatedAt = reusedOnly
    ? existingRowsByProcessKey.get(firstMatchedProcessKey)?.payloadResponse?.createdAt ?? createdAt
    : createdAt;

  return {
    receivables: responseReceivables,
    extractionReferenceDate: payload?.extractionReferenceDate ?? null,
    recipient: payload?.recipient ?? null,
    recipientDocumentType: payload?.recipientDocumentType ?? null,
    processKey: baseProcessKey,
    createdAt: baseCreatedAt,
    _shouldCreateProcess: !reusedOnly,
  };
}

function buildCreateApiResponseFromStored(stored) {
  const receivables = Array.isArray(stored?.receivables) ? stored.receivables : [];
  return {
    receivables: receivables.map((item) => ({
      key: item?.key ?? null,
      debtor: item?.debtor ?? null,
      originalAssetHolder: item?.originalAssetHolder ?? null,
      dueDate: item?.dueDate ?? null,
      paymentScheme: item?.paymentScheme ?? null,
      reference: item?.reference ?? null,
      settlements: [
        {
          key: crypto.randomUUID(),
          assetHolder: item?.originalAssetHolder ?? null,
          reference: `L_${Math.floor(Math.random() * 1000000)}`,
        },
      ],
      // Mantém também settlementObligations para compatibilidade com consumidores
      // que esperam essa estrutura já no POST inicial.
      settlementObligations: Array.isArray(item?.settlementObligations)
        ? item.settlementObligations.map((obligation) => ({
            ...obligation,
            settlements: Array.isArray(obligation?.settlements) ? obligation.settlements : [],
          }))
        : [],
    })),
    processKey: stored?.processKey ?? null,
    createdAt: stored?.createdAt ?? null,
  };
}

function validateReceivablesRequest(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'Body deve ser um objeto JSON';
  }
  if (!Array.isArray(payload.receivables) || payload.receivables.length === 0) {
    return 'Campo receivables deve ser uma lista com ao menos 1 item';
  }
  return null;
}

export async function createReceivableProcessHandler(req, res) {
  try {
    const payload = req.body || {};
    const errMsg = validateReceivablesRequest(payload);
    if (errMsg) return res.status(400).json({ error: errMsg });

    const generated = await buildStoredReceivablesResponse(payload);
    const { _shouldCreateProcess, ...storedPayload } = generated;
    const publicResponse = buildCreateApiResponseFromStored(generated);
    if (_shouldCreateProcess) {
      await createReceivableProcess({
        processKey: generated.processKey,
        payloadRequest: payload,
        payloadResponse: storedPayload,
      });
    }

    return res.status(_shouldCreateProcess ? 201 : 200).json(publicResponse);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao criar processo de receivable' });
  }
}

export async function listReceivableProcessesHandler(req, res) {
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
    let offset = Math.max(0, Number(req.query.offset) || 0);
    const page = req.query.page != null ? Math.max(0, Number(req.query.page) || 0) : null;
    const key = (req.query.key || '').toString().trim() || undefined;
    if (page != null) offset = page * limit;

    const result = await queryReceivableProcesses({ limit, offset, key });
    return res.json({ ...result, limit, offset, key: key ?? null });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao listar processos de receivable' });
  }
}

export async function getReceivableProcessHandler(req, res) {
  try {
    const { processKey } = req.params;
    if (!processKey) return res.status(400).json({ error: 'processKey e obrigatorio' });

    const row = await getReceivableProcessByKey(processKey);
    if (!row) return res.status(404).json({ error: 'Processo nao encontrado' });
    return res.json(row);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao buscar processo de receivable' });
  }
}

export async function updateReceivableProcessHandler(req, res) {
  try {
    const { processKey } = req.params;
    if (!processKey) return res.status(400).json({ error: 'processKey e obrigatorio' });

    const body = req.body || {};
    const hasRequest = Object.prototype.hasOwnProperty.call(body, 'request');
    const hasResponse = Object.prototype.hasOwnProperty.call(body, 'response');
    if (!hasRequest && !hasResponse) {
      return res.status(400).json({ error: 'Envie ao menos um dos campos: request, response' });
    }
    if (hasRequest && (body.request == null || typeof body.request !== 'object' || Array.isArray(body.request))) {
      return res.status(400).json({ error: 'Campo request deve ser um objeto JSON' });
    }
    if (hasResponse && (body.response == null || typeof body.response !== 'object' || Array.isArray(body.response))) {
      return res.status(400).json({ error: 'Campo response deve ser um objeto JSON' });
    }

    const updated = await updateReceivableProcessByKey(processKey, {
      payloadRequest: hasRequest ? body.request : undefined,
      payloadResponse: hasResponse ? body.response : undefined,
    });
    if (!updated) return res.status(404).json({ error: 'Processo nao encontrado' });

    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao atualizar processo de receivable' });
  }
}

export async function deleteReceivableProcessHandler(req, res) {
  try {
    const { processKey } = req.params;
    if (!processKey) return res.status(400).json({ error: 'processKey e obrigatorio' });

    const deleted = await deleteReceivableProcessByKey(processKey);
    if (!deleted) return res.status(404).json({ error: 'Processo nao encontrado' });

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao deletar processo de receivable' });
  }
}

export async function deleteAllReceivableProcessesHandler(_req, res) {
  try {
    const deleted = await deleteAllReceivableProcesses();
    return res.json({ ok: true, deleted });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao apagar processos de receivable' });
  }
}

function ensureSettlementObligation(receivable) {
  const nextReceivable = { ...receivable };
  const obligation = Array.isArray(nextReceivable.settlementObligations) && nextReceivable.settlementObligations.length
    ? { ...nextReceivable.settlementObligations[0] }
    : {
        key: crypto.randomUUID().replaceAll('-', ''),
        totalAmount: Number(nextReceivable.amount ?? 0),
        settledAmount: 0,
        balanceAmount: Number(nextReceivable.amount ?? 0),
        committedAmount: 0,
        uncommittedAmount: Number(nextReceivable.amount ?? 0),
        prePaidAmount: Number(nextReceivable.prePaidAmount ?? 0),
        expectedSettlementDate: nextReceivable.dueDate ?? null,
        originalAssetHolder: nextReceivable.originalAssetHolder ?? null,
        originalHolderDocumentType: nextReceivable.originalAssetHolderDocumentType ?? null,
        assetHolderDocumentType: nextReceivable.originalAssetHolderDocumentType ?? null,
        assetHolder: nextReceivable.originalAssetHolder ?? null,
        lastUpdated: new Date().toISOString(),
      };

  const settlements = Array.isArray(obligation.settlements) ? obligation.settlements.map((s) => ({ ...s })) : [];
  obligation.settlements = settlements;
  nextReceivable.settlementObligations = [obligation, ...(nextReceivable.settlementObligations || []).slice(1)];
  return nextReceivable;
}

function recalcObligation(obligation) {
  const totalAmount = Number(obligation.totalAmount ?? 0);
  const settlements = Array.isArray(obligation.settlements) ? obligation.settlements : [];
  const sum = settlements.reduce((acc, s) => acc + Number(s?.amount ?? 0), 0);

  obligation.settledAmount = sum;
  obligation.balanceAmount = totalAmount - sum;
  obligation.committedAmount = sum;
  obligation.uncommittedAmount = totalAmount - sum;
}

export async function patchReceivableSettlementHandler(req, res) {
  try {
    const payload = req.body || {};
    const settlements = Array.isArray(payload.settlements) ? payload.settlements : null;
    if (!settlements || settlements.length === 0) {
      return res.status(400).json({ error: 'Campo settlements deve ser uma lista com ao menos 1 item' });
    }

    const rows = await listReceivableProcessPayloadResponses();
    const processByKey = new Map(rows.map((r) => [r.processKey, r]));
    const receivableIndex = new Map();

    for (const row of rows) {
      const list = Array.isArray(row.payloadResponse?.receivables) ? row.payloadResponse.receivables : [];
      for (let i = 0; i < list.length; i += 1) {
        const r = list[i];
        const key = comboKey({
          originalAssetHolder: r?.originalAssetHolder,
          dueDate: r?.dueDate,
          paymentScheme: r?.paymentScheme,
        });
        if (!receivableIndex.has(key)) {
          receivableIndex.set(key, { processKey: row.processKey, receivableIndex: i });
        }
      }
    }

    // Valida primeiro para evitar update parcial
    const missing = [];
    for (const s of settlements) {
      const key = comboKey({
        originalAssetHolder: s?.originalAssetHolder,
        dueDate: s?.settlementDate,
        paymentScheme: s?.paymentScheme,
      });
      if (!receivableIndex.has(key)) {
        missing.push({
          originalAssetHolder: s?.originalAssetHolder ?? null,
          settlementDate: s?.settlementDate ?? null,
          paymentScheme: s?.paymentScheme ?? null,
        });
      }
    }
    if (missing.length) {
      return res.status(404).json({
        error: 'Receivable nao encontrado para uma ou mais settlements',
        missing,
      });
    }

    const pending = new Map();
    const responseSettlements = [];

    for (const s of settlements) {
      const lookupKey = comboKey({
        originalAssetHolder: s?.originalAssetHolder,
        dueDate: s?.settlementDate,
        paymentScheme: s?.paymentScheme,
      });
      const hit = receivableIndex.get(lookupKey);
      const processRow = processByKey.get(hit.processKey);
      if (!processRow?.payloadResponse) continue;

      if (!pending.has(hit.processKey)) {
        pending.set(hit.processKey, JSON.parse(JSON.stringify(processRow.payloadResponse)));
      }

      const payloadResponse = pending.get(hit.processKey);
      const receivable = payloadResponse.receivables[hit.receivableIndex];
      const receivablePrepared = ensureSettlementObligation(receivable);
      payloadResponse.receivables[hit.receivableIndex] = receivablePrepared;
      const obligation = receivablePrepared.settlementObligations[0];
      const settlementsArr = obligation.settlements;

      const sKey = settlementComboKey({
        originalAssetHolder: s?.originalAssetHolder,
        settlementDate: s?.settlementDate,
        paymentScheme: s?.paymentScheme,
      });
      const existing = settlementsArr.find((x) => settlementComboKey({
        originalAssetHolder: x?.originalAssetHolder,
        settlementDate: x?.settlementDate,
        paymentScheme: x?.paymentScheme,
      }) === sKey);

      if (existing) {
        // Não permitir atualizar amount da settlement existente
        responseSettlements.push({
          key: existing.key,
          reference: existing.reference ?? null,
        });
        recalcObligation(obligation);
        continue;
      }

      const createdSettlement = {
        key: crypto.randomUUID(),
        reference: s?.reference ?? null,
        originalAssetHolder: s?.originalAssetHolder ?? null,
        paymentScheme: s?.paymentScheme ?? null,
        assetHolderDocumentType: s?.assetHolderDocumentType ?? null,
        assetHolder: s?.assetHolder ?? null,
        amount: Number(s?.amount ?? 0),
        settlementDate: s?.settlementDate ?? null,
        bankAccount: s?.bankAccount ?? null,
        lastUpdated: new Date().toISOString(),
        isRejected: false,
      };
      settlementsArr.push(createdSettlement);
      recalcObligation(obligation);
      responseSettlements.push({
        key: createdSettlement.key,
        reference: createdSettlement.reference,
      });
    }

    for (const [processKey, updatedPayloadResponse] of pending.entries()) {
      await updateReceivableProcessResponseByKey(processKey, updatedPayloadResponse);
    }

    return res.json({
      settlements: responseSettlements,
      processKey: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao registrar settlement' });
  }
}
