// Extração dos campos que o mock precisa ecoar de volta na resposta.
//
// O corpo é o XML `paymentService` que a gateway monta em WorldpayService::buildChargeXml:
// orderCode, amount (value/currencyCode/exponent) e thirdPartyData/instalments. Leitura por
// regex de propósito — o projeto não tem dependência de parser XML e o formato é fixo.

function attr(xml, element, attribute) {
  const match = new RegExp(`<${element}\\b[^>]*\\b${attribute}\\s*=\\s*"([^"]*)"`, 'i').exec(xml);
  return match ? match[1] : null;
}

function tag(xml, element) {
  const match = new RegExp(`<${element}\\b[^>]*>([\\s\\S]*?)</${element}>`, 'i').exec(xml);
  return match ? match[1].trim() : null;
}

export function parseChargeRequest(rawXml) {
  const xml = typeof rawXml === 'string' ? rawXml : '';

  return {
    merchantCode: attr(xml, 'paymentService', 'merchantCode') ?? 'GREENNECOMBR',
    version: attr(xml, 'paymentService', 'version') ?? '1.4',
    orderCode: attr(xml, 'order', 'orderCode') ?? 'UNKNOWN-ORDER',
    amount: attr(xml, 'amount', 'value') ?? '0',
    currencyCode: attr(xml, 'amount', 'currencyCode') ?? 'BRL',
    exponent: attr(xml, 'amount', 'exponent') ?? '2',
    installments: tag(xml, 'instalments') ?? '1',
    tokenNumber: tag(xml, 'tokenNumber'),
    has3ds: /<additional3DSData\b/i.test(xml),
  };
}
