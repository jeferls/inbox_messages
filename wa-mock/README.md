# wa-mock

Mock local da **WhatsApp Cloud API** com preview visual das mensagens no estilo do app.
Zero dependências — só Node 18+.

```bash
node server.js
# http://localhost:3333
```

## Como funciona

```
seu backend ──POST /v20.0/{PHONE_NUMBER_ID}/messages──▶ wa-mock ──▶ UI (bolha verde, ✓✓)
seu backend ◀──POST {WEBHOOK_URL} (formato Meta)──────── wa-mock ◀── você digita/clica na UI
```

1. No backend, troque a base URL `https://graph.facebook.com/v20.0` por `http://localhost:3333/v20.0`.
   Qualquer token é aceito. O payload e a resposta seguem o formato da Cloud API
   (`messaging_product`, `to`, `type`, `text|template|interactive|image|...` → `{ contacts, messages: [{ id }] }`).
2. Erros seguem o formato Meta: `{ "error": { "message": "(#100) ...", "code": 100 } }`.
3. Mensagens que você envia na UI como **Cliente** (texto, clique em botão, item de lista)
   viram webhook no formato Meta para `WEBHOOK_URL` — incluindo `statuses` (`sent` → `delivered` → `read`).
   `read` acontece quando o cliente responde.

## UI

- **Cliente** — simula o que o cliente digita (dispara webhook).
- **Empresa** — envia texto pela API mock, como se fosse o backend.
- **JSON** — cole um payload da Cloud API. O menu *Exemplos…* preenche texto formatado, templates,
  botões, lista, CTA, mídia, localização, resposta citando, reação e "marcar como lida".
- Botões e listas são clicáveis: geram o webhook de `button_reply` / `list_reply` / `button`.
- ⚙ — webhook, números, nomes, endpoint para copiar, limpar conversa.

Suporta a formatação nativa: `*negrito*`, `_itálico_`, `~riscado~`, `` `código` ``, ```` ```bloco``` ````,
listas `- ` / `1. `, citação `> ` e links.

## Templates

O envio de template só carrega os parâmetros — o texto vem de `templates.json`:

```json
"pagamento_confirmado": {
  "header": { "type": "text", "text": "Pagamento confirmado" },
  "body": "Olá {{1}}, recebemos *{{2}}* do pedido {{3}}.",
  "footer": "Não responda",
  "buttons": [
    { "type": "URL", "text": "Ver pedido", "url": "https://exemplo.com/pedido/{{1}}" },
    { "type": "QUICK_REPLY", "text": "Falar com suporte" }
  ]
}
```

Parâmetros posicionais (`{{1}}`) e nomeados (`parameter_name` → `{{nome}}`) funcionam.
Header pode ser `text`, `image`, `document` ou `video`. Botões: `URL`, `QUICK_REPLY`,
`PHONE_NUMBER`, `COPY_CODE`, `FLOW`. O arquivo é relido a cada envio — sem reiniciar.
Template ausente aparece como card vermelho com o payload recebido.

## Variáveis de ambiente

| Var | Default | |
|---|---|---|
| `PORT` | `3333` | |
| `WEBHOOK_URL` | — | Endpoint do seu backend que recebe webhooks |
| `APP_SECRET` | — | Se definido, assina o webhook com `X-Hub-Signature-256` |
| `PHONE_NUMBER_ID` | `123456789012345` | Aparece em `metadata.phone_number_id` |
| `DISPLAY_PHONE` | `5511999990000` | `metadata.display_phone_number` |
| `BUSINESS_NAME` | `Empresa` | Nome nas citações |
| `CONTACT_NAME` / `CONTACT_WA_ID` | `Cliente Teste` / `5511988887777` | Cliente padrão |
| `DELIVERED_DELAY_MS` | `600` | Atraso do status `delivered` |

Env sobrescreve o que foi salvo pela UI. Estado fica em `.mock-state.json` (apague para zerar).

## Exemplo rápido

```bash
curl -X POST http://localhost:3333/v20.0/123456789012345/messages \
  -H 'Content-Type: application/json' -H 'Authorization: Bearer qualquer' \
  -d '{"messaging_product":"whatsapp","to":"5511988887777","type":"text","text":{"body":"Olá *Maria*, pedido _#4821_ aprovado."}}'
```

## Endpoints internos

`GET /mock/state` · `GET /mock/events` (SSE) · `GET /mock/templates` ·
`POST /mock/inbound` · `POST /mock/config` · `POST /mock/clear`

## Limitações

Uma conversa por número (`to`), sem upload de mídia (`/media` retorna erro), sem preview de link,
sem grupos. Mídia por `id` aparece como placeholder; por `link` é renderizada.
