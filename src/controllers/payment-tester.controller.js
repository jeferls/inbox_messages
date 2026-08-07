import { CHECKOUT_GATEWAY_KEY } from '../config/env.js';
import { ALLOWED_PRODUCT_TYPE, fetchProduct, runPayment } from '../services/payment-tester.service.js';
import { listSellerProducts } from '../services/product-catalog.service.js';

/** Produtos de um seller, para o select da tela. */
export async function listProductsHandler(req, res) {
  const sellerId = Number(req.params.sellerId);

  if (!Number.isInteger(sellerId) || sellerId <= 0) {
    return res.status(400).json({ error: 'sellerId inválido' });
  }

  try {
    const products = await listSellerProducts(sellerId);

    res.json({
      sellerId,
      allowedType: ALLOWED_PRODUCT_TYPE,
      total: products.length,
      products: products.map((product) => ({
        ...product,
        supported: product.type === ALLOWED_PRODUCT_TYPE,
      })),
    });
  } catch (error) {
    res.status(502).json({ error: `Falha ao consultar os produtos: ${error.message}` });
  }
}

/**
 * Carrega o produto e devolve só o que a tela precisa para montar o payload.
 * Serve também como teste de conectividade com o greenn-back antes de disparar um pagamento.
 */
export async function loadProductHandler(req, res) {
  const { backUrl, productId, offerHash } = req.body || {};

  if (!backUrl) return res.status(400).json({ error: "'backUrl' é obrigatório" });
  if (!productId) return res.status(400).json({ error: "'productId' é obrigatório" });

  const { step } = await fetchProduct({ backUrl, productId, offerHash });

  if (!step.ok) {
    return res.status(200).json({
      ok: false,
      status: step.status,
      error: step.error ?? 'Produto não carregou',
      body: step.body,
    });
  }

  const payload = step.body?.data ?? {};
  const checkoutPayment = step.body?.checkout_payment?.data ?? {};

  res.json({
    ok: true,
    status: step.status,
    tokensFound: step.tokensFound,
    durationMs: step.durationMs,
    // A tela usa isto para barrar o pagamento antes de o usuário tentar.
    supported: payload.type === ALLOWED_PRODUCT_TYPE,
    allowedType: ALLOWED_PRODUCT_TYPE,
    product: {
      id: payload.id,
      // O checkout manda o nano_id em `product_id` quando existe; senão cai no id numérico.
      hash: payload.nano_id ?? String(payload.id ?? ''),
      name: payload.name,
      type: payload.type,
      // `checkout_payment.data.amount` já reflete a oferta escolhida; `amount` do produto é o base.
      amount: checkoutPayment.amount ?? payload.amount,
      method: payload.method,
      sellerId: step.body?.safe_seller_id ?? payload.seller_id,
      // `transaction_type` do priority é o tipo do produto (TRANSACTION/SUBSCRIPTION/CONTRACT),
      // não o `type` de topo da resposta — ver payment.ts (transaction_type: product.type).
      transactionType: payload.type,
      maxInstallments: payload.max_installments,
      currency: checkoutPayment.to ?? 'BRL',
    },
  });
}

export async function runPaymentHandler(req, res) {
  const {
    backUrl,
    gatewayUrl,
    gatewayKey,
    productId,
    offerHash,
    payload,
    priority,
    skipPriority,
  } = req.body || {};

  if (!backUrl) return res.status(400).json({ error: "'backUrl' é obrigatório" });
  if (!gatewayUrl && !skipPriority) {
    return res.status(400).json({ error: "'gatewayUrl' é obrigatório quando o priority não é pulado" });
  }
  if (!productId) return res.status(400).json({ error: "'productId' é obrigatório" });
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return res.status(400).json({ error: "'payload' precisa ser um objeto JSON" });
  }

  try {
    const result = await runPayment({
      backUrl,
      gatewayUrl,
      gatewayKey: gatewayKey || CHECKOUT_GATEWAY_KEY,
      productId,
      offerHash,
      payload,
      priority,
      skipPriority: Boolean(skipPriority),
    });

    res.json(result);
  } catch (error) {
    res.status(502).json({ error: `Falha ao executar o pagamento: ${error.message}` });
  }
}
