<script setup>
import { computed, onMounted, ref } from 'vue';
import { closeClaim, postClaimAnswer, resendClaimSecret, verifyClaim } from './api.js';

const params = new URLSearchParams(window.location.search);
const claimId = params.get('id');
const secret = params.get('secret');
const document = params.get('document') || params.get('doc');

const loading = ref(true);
const errorMsg = ref('');
const resendMsg = ref('');
const claimRows = ref([]);
const answers = ref([]);

const replyText = ref('');
const replyFile = ref(null);
const sending = ref(false);
const sendError = ref('');

const closing = ref(false);
const closeMsg = ref('');

const claim = computed(() => claimRows.value[0] || null);
const attachments = computed(() => {
  const set = new Set(claimRows.value.map((r) => r.attachment).filter(Boolean));
  return Array.from(set);
});
const sortedAnswers = computed(() =>
  [...answers.value].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0)),
);

const STATUS_LABELS = {
  open: 'Aberta',
  close_solicitation: 'Solicitação de encerramento enviada',
  closed: 'Encerrada',
  answered: 'Respondida',
};

function statusLabel(status) {
  return STATUS_LABELS[status] || status || '—';
}

function fmtDate(s) {
  if (!s) return '';
  try {
    return new Date(s).toLocaleString('pt-BR');
  } catch {
    return s;
  }
}

function flattenAttachmentLinks(list) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => (typeof item === 'string' ? item : item?.attachment)).filter(Boolean);
}

async function load() {
  loading.value = true;
  errorMsg.value = '';
  const { ok, body } = await verifyClaim(claimId, secret, document);
  loading.value = false;

  if (!ok || !body) {
    errorMsg.value = 'Não foi possível carregar a reclamação.';
    return;
  }
  if (!body.claim) {
    // Corpo de erro de validação, ex: { secret: [...] } ou { claim: [...] }
    const firstKey = Object.keys(body)[0];
    errorMsg.value = Array.isArray(body[firstKey]) ? body[firstKey][0] : 'Link inválido ou expirado.';
    return;
  }

  claimRows.value = body.claim;
  answers.value = body.answers || [];
}

async function requestNewLink() {
  resendMsg.value = 'Enviando...';
  const { ok } = await resendClaimSecret(claimId);
  resendMsg.value = ok ? 'Um novo link de acesso foi enviado para o seu email.' : 'Falha ao reenviar o link.';
}

async function sendReply() {
  if (!replyText.value.trim()) return;
  sending.value = true;
  sendError.value = '';
  const { ok, body } = await postClaimAnswer({
    claimId,
    answer: replyText.value.trim(),
    file: replyFile.value,
  });
  sending.value = false;

  if (!ok || body?.success === false) {
    sendError.value = 'Falha ao enviar a resposta. Tente novamente.';
    return;
  }

  replyText.value = '';
  replyFile.value = null;
  await load();
}

function onFileChange(e) {
  replyFile.value = e.target.files?.[0] || null;
}

async function requestClose() {
  if (!confirm('Deseja realmente solicitar o encerramento desta reclamação?')) return;
  closing.value = true;
  closeMsg.value = '';
  const { ok, body } = await closeClaim(claimId, secret, document);
  closing.value = false;

  if (ok) {
    closeMsg.value = 'Solicitação de encerramento enviada.';
    await load();
  } else {
    const firstKey = body ? Object.keys(body)[0] : null;
    closeMsg.value = firstKey && Array.isArray(body[firstKey]) ? body[firstKey][0] : 'Falha ao solicitar encerramento.';
  }
}

onMounted(() => {
  if (!claimId || !secret) {
    loading.value = false;
    errorMsg.value = 'Link inválido: parâmetros ausentes.';
    return;
  }
  load();
});
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1>Acompanhar Reclamação</h1>
    </header>

    <main class="page-main">
      <div v-if="loading" class="state-box">Carregando...</div>

      <div v-else-if="errorMsg" class="state-box error">
        <p>{{ errorMsg }}</p>
        <button @click="requestNewLink">Reenviar link de acesso</button>
        <p v-if="resendMsg" class="hint">{{ resendMsg }}</p>
      </div>

      <template v-else-if="claim">
        <section class="claim-card">
          <div class="claim-card-top">
            <div>
              <div class="claim-title">Reclamação Nº {{ claim.id }} — Pedido Nº {{ claim.sale_id }}</div>
              <span class="status-badge" :data-status="claim.status">{{ statusLabel(claim.status) }}</span>
            </div>
          </div>

          <dl class="claim-fields">
            <dt>Categoria</dt>
            <dd>{{ claim.category }}</dd>
            <dt>Assunto</dt>
            <dd>{{ claim.subjective }}</dd>
            <dt>Objetivo</dt>
            <dd>{{ claim.objective }}</dd>
            <dt>Descrição</dt>
            <dd>{{ claim.description }}</dd>
          </dl>

          <div v-if="claim.seller_contact?.email || claim.seller_contact?.telephone" class="seller-contact">
            <strong>Contato do vendedor:</strong>
            <span v-if="claim.seller_contact.email">{{ claim.seller_contact.email }}</span>
            <span v-if="claim.seller_contact.telephone">{{ claim.seller_contact.telephone }}</span>
          </div>

          <div v-if="attachments.length" class="attachments">
            <strong>Anexos da abertura:</strong>
            <a v-for="(url, i) in attachments" :key="i" :href="url" target="_blank" rel="noopener noreferrer nofollow">Anexo {{ i + 1 }}</a>
          </div>

          <div class="claim-actions">
            <button class="danger" :disabled="closing || claim.status === 'close_solicitation'" @click="requestClose">
              {{ claim.status === 'close_solicitation' ? 'Encerramento solicitado' : 'Solicitar encerramento' }}
            </button>
            <span v-if="closeMsg" class="hint">{{ closeMsg }}</span>
          </div>
        </section>

        <section class="timeline">
          <h2>Histórico</h2>
          <div v-if="!sortedAnswers.length" class="empty">Nenhuma resposta ainda.</div>
          <div
            v-for="a in sortedAnswers"
            :key="a.id"
            class="msg"
            :class="a.type === 'CLIENT' ? 'msg-client' : 'msg-seller'"
          >
            <div class="msg-meta">
              <strong>{{ a.type === 'CLIENT' ? (a.client?.name || 'Você') : (a.user?.name || 'Vendedor') }}</strong>
              <time>{{ fmtDate(a.created_at) }}</time>
            </div>
            <p class="msg-text">{{ a.answer }}</p>
            <div v-if="flattenAttachmentLinks(a.attachment_answers).length" class="attachments">
              <a
                v-for="(url, i) in flattenAttachmentLinks(a.attachment_answers)"
                :key="i"
                :href="url"
                target="_blank"
                rel="noopener noreferrer nofollow"
              >Anexo {{ i + 1 }}</a>
            </div>
          </div>
        </section>

        <section class="reply-box">
          <h2>Responder</h2>
          <textarea v-model="replyText" rows="4" placeholder="Escreva sua mensagem..."></textarea>
          <input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" @change="onFileChange" />
          <div class="reply-actions">
            <button :disabled="sending || !replyText.trim()" @click="sendReply">
              {{ sending ? 'Enviando...' : 'Enviar resposta' }}
            </button>
            <span v-if="sendError" class="hint error-text">{{ sendError }}</span>
          </div>
        </section>
      </template>
    </main>
  </div>
</template>

<style scoped>
* { box-sizing: border-box; }
.page { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #1f2937; max-width: 720px; margin: 0 auto; padding: 16px; }
.page-header h1 { font-size: 20px; margin: 0 0 16px; }
.state-box { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 20px; text-align: center; color: #6b7280; }
.state-box.error { color: #b91c1c; }
.hint { display: block; margin-top: 8px; font-size: 13px; color: #6b7280; }
.error-text { color: #b91c1c; }

.claim-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 18px; margin-bottom: 20px; }
.claim-title { font-weight: 700; font-size: 16px; margin-bottom: 6px; }
.status-badge { display: inline-block; font-size: 12px; font-weight: 600; padding: 2px 10px; border-radius: 12px; background: #eff6ff; color: #1d4ed8; }
.status-badge[data-status="close_solicitation"] { background: #fef3c7; color: #92400e; }
.status-badge[data-status="closed"] { background: #f3f4f6; color: #374151; }

.claim-fields { margin: 14px 0 0; }
.claim-fields dt { font-size: 12px; font-weight: 600; color: #6b7280; margin-top: 10px; }
.claim-fields dd { margin: 2px 0 0; font-size: 14px; }

.seller-contact { margin-top: 14px; font-size: 13px; color: #374151; display: flex; gap: 10px; flex-wrap: wrap; }

.attachments { margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; font-size: 13px; }
.attachments a { color: #2563eb; text-decoration: underline; }

.claim-actions { margin-top: 16px; display: flex; align-items: center; gap: 10px; }

.timeline { margin-bottom: 20px; }
.timeline h2 { font-size: 15px; margin: 0 0 10px; }
.empty { color: #6b7280; font-size: 13px; }
.msg { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; background: #fff; }
.msg-client { border-color: #93c5fd; background: #eff6ff; }
.msg-meta { display: flex; justify-content: space-between; font-size: 12px; color: #6b7280; margin-bottom: 4px; }
.msg-text { margin: 0; font-size: 14px; white-space: pre-wrap; word-break: break-word; }

.reply-box { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 18px; }
.reply-box h2 { font-size: 15px; margin: 0 0 10px; }
.reply-box textarea { width: 100%; padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 6px; font-family: inherit; font-size: 14px; resize: vertical; }
.reply-box input[type="file"] { margin-top: 8px; font-size: 13px; }
.reply-actions { margin-top: 10px; display: flex; align-items: center; gap: 10px; }

button { padding: 8px 14px; border: 1px solid #d1d5db; background: #fff; border-radius: 6px; cursor: pointer; font-size: 14px; }
button:hover:not(:disabled) { background: #f3f4f6; }
button:disabled { opacity: 0.6; cursor: not-allowed; }
button.danger { border-color: #ef4444; color: #b91c1c; }
button.danger:hover:not(:disabled) { background: #fee2e2; }
</style>
