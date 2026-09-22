import { Router } from 'express';

const router = Router();

const CORRECTION_TYPES = ['RECONCILED_WITHOUT_ADJUSTMENTS', 'RECONCILED_WITH_ADJUSTMENTS'];

// Mock do PATCH /receivable/reconciliation/tw da TAG: confirmação da conciliação de liquidação (SLC).
// O greenn-back só verifica se a resposta foi 2xx.
router.patch('/receivable/reconciliation/tw', (req, res) => {
  const { conciliationKey, CORRECTION_TYPE: correctionType } = req.body || {};

  if (!conciliationKey || typeof conciliationKey !== 'string') {
    return res.status(400).json({ error: 'conciliationKey is required' });
  }
  if (!CORRECTION_TYPES.includes(correctionType)) {
    return res.status(400).json({ error: `CORRECTION_TYPE must be one of: ${CORRECTION_TYPES.join(', ')}` });
  }

  console.log(`[tag-mock] settlement conciliation confirmed key=${conciliationKey} correctionType=${correctionType}`);

  res.json({ conciliationKey, correctionType, status: 'RECONCILED', reconciledAt: new Date().toISOString() });
});

export default router;
