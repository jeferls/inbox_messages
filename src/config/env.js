import { fileURLToPath } from 'url';
import path from 'path';

export const __filename = fileURLToPath(import.meta.url);
export const __dirname = path.dirname(__filename);

export const PORT = Number(process.env.PORT || 8115);
export const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
// BODY_LIMIT: tamanho máximo aceito pelo body parser.
// Aceita valores como '10mb', '1gb'. Se for '0', '-1' ou 'infinity', tratamos como sem limite (Infinity).
// Padrão: sem limite (Infinity) conforme solicitado.
export const BODY_LIMIT = (() => {
  const raw = process.env.BODY_LIMIT?.trim();
  if (!raw) return Infinity;
  const lc = raw.toLowerCase();
  if (raw === '0' || raw === '-1' || lc === 'infinity') return Infinity;
  return raw;
})();

// DB path default is project root data.db unless overridden
export const DEFAULT_DB_PATH = path.join(__dirname, '..', '..', 'data.db');
export const DB_PATH = (process.env.DB_PATH && process.env.DB_PATH.trim()) || DEFAULT_DB_PATH;

// Página local de acompanhamento de reclamação (substitui links de https://reclamacao.greenn.com.br
// nos e-mails recebidos, para que o botão do e-mail aponte para o ambiente local)
export const CLAIM_PAGE_URL = (process.env.CLAIM_PAGE_URL && process.env.CLAIM_PAGE_URL.trim()) || 'http://localhost:6002';

// Chave usada para assinar o header X-Greenn-Gateway das rotas /checkout/* do gateway.
// O padrão é a chave do ambiente local (CHECKOUT_GATEWAY_KEY do .env.development do new-checkout);
// para apontar a aba de testes de pagamento para outro ambiente, sobrescreva por variável.
export const CHECKOUT_GATEWAY_KEY =
  (process.env.CHECKOUT_GATEWAY_KEY && process.env.CHECKOUT_GATEWAY_KEY.trim()) ||
  'axyx895259612402ca5e854d0682f5315';

// Banco do greenn-back, usado só para leitura no catálogo de produtos da aba de testes
// de pagamento (não existe endpoint público que liste produtos por seller).
export const GREENN_DB = {
  host: process.env.GREENN_DB_HOST?.trim() || 'greenn-back-mysql',
  port: Number(process.env.GREENN_DB_PORT || 3306),
  user: process.env.GREENN_DB_USER?.trim() || 'admin',
  password: process.env.GREENN_DB_PASSWORD?.trim() || 'secret',
  database: process.env.GREENN_DB_NAME?.trim() || 'greenn',
};

// greenn-back visto de dentro da greenn-network (usado para disparar o webhook da Konduto).
// Do host o mesmo backend responde em http://localhost:81.
// Banco do sistema de assinaturas (mesmo servidor MySQL, database separado).
export const GREENN_SUBSCRIPTION_DB_NAME =
  process.env.GREENN_SUBSCRIPTION_DB_NAME?.trim() || 'greenn-subscription';

// Container do serviço de assinaturas, onde os comandos de recorrência são executados.
export const SUBSCRIPTION_CONTAINER =
  process.env.SUBSCRIPTION_CONTAINER?.trim() || 'assinaturas-php';

export const GREENN_BACK_URL =
  (process.env.GREENN_BACK_URL && process.env.GREENN_BACK_URL.trim()) || 'http://greenn-back-nginx';

// Logs
export const LOG_DIR = (process.env.LOG_DIR && process.env.LOG_DIR.trim()) || path.join(__dirname, '..', '..', 'logs');
export const LOG_FILE = (process.env.LOG_FILE && process.env.LOG_FILE.trim()) || path.join(LOG_DIR, 'app.log');
export const LOG_MAX_TAIL_BYTES = Number(process.env.LOG_MAX_TAIL_BYTES || 1024 * 1024 * 2); // 2MB

// Mock da WhatsApp Cloud API (aba WhatsApp). O que a UI salva vale como padrão;
// variáveis de ambiente, quando definidas, sobrescrevem.
export const WA_MOCK = {
  env: {
    webhookUrl: process.env.WA_MOCK_WEBHOOK_URL?.trim(),
    phoneNumberId: process.env.WA_MOCK_PHONE_NUMBER_ID?.trim(),
    displayPhone: process.env.WA_MOCK_DISPLAY_PHONE?.trim(),
    businessName: process.env.WA_MOCK_BUSINESS_NAME?.trim(),
    contactName: process.env.WA_MOCK_CONTACT_NAME?.trim(),
    defaultWaId: process.env.WA_MOCK_CONTACT_WA_ID?.trim(),
  },
  defaults: {
    webhookUrl: '',
    phoneNumberId: '123456789012345',
    displayPhone: '5511999990000',
    businessName: 'Greenn',
    contactName: 'Cliente Teste',
    defaultWaId: '5511988887777',
  },
  // Se definido, assina o webhook com X-Hub-Signature-256
  appSecret: process.env.WA_MOCK_APP_SECRET?.trim() || '',
  deliveredDelayMs: Number(process.env.WA_MOCK_DELIVERED_DELAY_MS || 600),
  // O callback do messages publica no RabbitMQ de forma síncrona e pode passar de 5s
  webhookTimeoutMs: Number(process.env.WA_MOCK_WEBHOOK_TIMEOUT_MS || 20000),
};
// Conversas ficam ao lado do SQLite (no Docker, dentro do volume /data)
export const WA_MOCK_STATE_FILE = path.join(path.dirname(DB_PATH), 'wa-mock-state.json');
export const WA_MOCK_TEMPLATES_FILE = path.join(__dirname, '..', 'mocks', 'whatsapp', 'templates.json');
