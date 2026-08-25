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
