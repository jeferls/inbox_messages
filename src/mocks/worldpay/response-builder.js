// Montagem das respostas XML da Worldpay (WPG), no mesmo formato que a API real devolve.
//
// Referência dos formatos: fixtures reais de integração WPG (alphagov/pay-connector) e o que o
// WorldpayService::parseCharge lê — reply.orderStatus.payment.lastEvent, ISO8583ReturnCode,
// AuthorisationId e reply.error.

const DOCTYPE = `<!DOCTYPE paymentService PUBLIC "-//WorldPay//DTD WorldPay PaymentService v1//EN"
                                "http://dtd.worldpay.com/paymentService_v1.dtd">`;

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function envelope(request, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
${DOCTYPE}
<paymentService version="${escapeXml(request.version)}" merchantCode="${escapeXml(request.merchantCode)}">
  <reply>
${body}
  </reply>
</paymentService>`;
}

function dateElement(now = new Date()) {
  return `<date dayOfMonth="${now.getDate()}" month="${now.getMonth() + 1}" year="${now.getFullYear()}" `
    + `hour="${now.getHours()}" minute="${now.getMinutes()}" second="${now.getSeconds()}"/>`;
}

/**
 * Resposta com orderStatus — usada tanto no sucesso quanto na recusa do emissor.
 * O que muda é o lastEvent e a presença do ISO8583ReturnCode.
 */
function buildOrderStatus(request, { lastEvent, iso8583 = null, now = new Date() }) {
  const amountElement = `<amount value="${escapeXml(request.amount)}" currencyCode="${escapeXml(request.currencyCode)}" `
    + `exponent="${escapeXml(request.exponent)}" debitCreditIndicator="credit"/>`;

  const isoElement = iso8583
    ? `\n          <ISO8583ReturnCode code="${escapeXml(iso8583.code)}" description="${escapeXml(iso8583.description)}"/>`
    : '';

  const body = `    <orderStatus orderCode="${escapeXml(request.orderCode)}">
      <payment>
        <paymentMethod>ECMC_CREDIT-SSL</paymentMethod>
        <paymentMethodDetail>
          <card type="creditcard"/>
        </paymentMethodDetail>
        ${amountElement}
        <lastEvent>${escapeXml(lastEvent)}</lastEvent>${isoElement}
        <AuthorisationId id="427853"/>
        <CVCResultCode description="NOT SUPPLIED BY SHOPPER"/>
        <AVSResultCode description="NOT CHECKED BY ACQUIRER"/>
        <issuerCountryCode>BR</issuerCountryCode>
        <balance accountType="IN_PROCESS_AUTHORISED">
          ${amountElement}
        </balance>
        <cardNumber>5154********4922</cardNumber>
        <instalments>${escapeXml(request.installments)}</instalments>
        <riskScore value="1"/>
      </payment>
      ${dateElement(now)}
    </orderStatus>`;

  return envelope(request, body);
}

/**
 * Erro de gateway: a resposta não traz orderStatus, só <error code="N">.
 */
function buildGatewayError(request, { code, description }) {
  const body = `    <error code="${escapeXml(code)}"><![CDATA[${description ?? ''}]]></error>`;

  return envelope(request, body);
}

/**
 * @returns {{ httpStatus: number, contentType: string, body: string, delayMs: number }}
 */
export function buildResponse(scenario, request, { now = new Date() } = {}) {
  switch (scenario.type) {
    case 'iso8583':
      return {
        httpStatus: 200,
        contentType: 'text/xml',
        delayMs: 0,
        body: buildOrderStatus(request, {
          lastEvent: scenario.lastEvent ?? 'REFUSED',
          iso8583: { code: scenario.code, description: scenario.description },
          now,
        }),
      };

    case 'last_event':
      return {
        httpStatus: 200,
        contentType: 'text/xml',
        delayMs: 0,
        body: buildOrderStatus(request, { lastEvent: scenario.lastEvent, now }),
      };

    case 'gateway_error':
      return {
        httpStatus: 200,
        contentType: 'text/xml',
        delayMs: 0,
        body: buildGatewayError(request, { code: scenario.code, description: scenario.description }),
      };

    case 'http_error':
      return {
        httpStatus: scenario.httpStatus ?? 500,
        contentType: 'text/xml',
        delayMs: 0,
        body: buildGatewayError(request, { code: '1', description: scenario.description ?? 'Internal error' }),
      };

    case 'timeout':
      return {
        httpStatus: 200,
        contentType: 'text/xml',
        delayMs: (scenario.delaySeconds ?? 65) * 1000,
        body: buildOrderStatus(request, { lastEvent: 'AUTHORISED', now }),
      };

    default:
      throw new Error(`Tipo de cenário desconhecido: ${scenario.type}`);
  }
}
