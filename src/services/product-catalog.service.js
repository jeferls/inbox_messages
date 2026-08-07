// Catálogo de produtos por seller, lido direto do banco do greenn-back.
//
// Não há endpoint público que liste produtos de um seller arbitrário: `GET /api/product`
// exige autenticação e devolve apenas os produtos do usuário autenticado. Como esta
// ferramenta é de uso local e já conversa com os containers pela greenn-network, a leitura
// direta é o caminho mais curto — e é só leitura.

import { getGreennPool } from './greenn-db.js';

/**
 * Produtos do seller, mais recentes primeiro, com as ofertas ativas de cada um.
 * Produtos sem oferta ficam de fora: sem oferta não há o que comprar.
 */
export async function listSellerProducts(sellerId) {
  const [rows] = await getGreennPool().query(
    `SELECT p.id, p.nano_id, p.name, p.type, p.status,
            o.hash AS offer_hash, o.name AS offer_name, o.amount AS offer_amount, o.default AS offer_default
       FROM products p
       JOIN products_has_offers o
         ON o.product_id = p.id AND o.deleted_at IS NULL
      WHERE p.seller_id = ?
        AND p.deleted_at IS NULL
      ORDER BY p.id DESC, o.default DESC, o.id ASC`,
    [sellerId],
  );

  // Uma linha por oferta — agrupa mantendo a ordem decrescente de produto.
  const byProduct = new Map();

  for (const row of rows) {
    if (!byProduct.has(row.id)) {
      byProduct.set(row.id, {
        id: row.id,
        hash: row.nano_id ?? String(row.id),
        name: row.name,
        type: row.type,
        status: row.status,
        offers: [],
      });
    }

    byProduct.get(row.id).offers.push({
      hash: row.offer_hash,
      name: row.offer_name,
      amount: row.offer_amount,
      isDefault: Boolean(row.offer_default),
    });
  }

  return [...byProduct.values()];
}
