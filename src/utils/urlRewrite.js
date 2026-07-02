import { CLAIM_PAGE_URL } from '../config/env.js';

// Produção aponta o botão "Acessar Reclamação" do e-mail para o domínio real.
// Localmente interceptamos e trocamos pela página de acompanhamento rodando em CLAIM_PAGE_URL.
const CLAIM_URL_PATTERN = /https?:\/\/reclamacao\.greenn\.com\.br/gi;

export function rewriteClaimUrls(text) {
  if (typeof text !== 'string' || !text) return text;
  return text.replace(CLAIM_URL_PATTERN, CLAIM_PAGE_URL);
}
