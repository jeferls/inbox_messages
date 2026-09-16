Inbox Messages

Descrição
- Serviço simples de “inbox” para armazenar e consultar mensagens (e-mails simulados) via API HTTP.
- Implementado em Node.js/Express com persistência em SQLite.

Arquitetura Resumida
- Aplicação Node.js escuta na porta definida por `PORT` (padrão 8115 ao rodar localmente).
- Em Docker, por padrão o container escuta na porta 80 e é mapeado para a porta 8115 do host.
- Banco SQLite em arquivo, com caminho configurável via `DB_PATH` (montado em volume no Docker).

Como Subir com Docker Compose
- Pré-requisito: Docker e Docker Compose.
- Comandos:
  - `make up` (ou) `docker compose up -d --build`
  - A aplicação ficará acessível em `http://localhost:8115` (saúde em `http://localhost:8115/api/health`).

Arquivos Importantes
- `docker-compose.yml`
  - Serviço `inbox_messages` com `container_name: svc-inbox_messages`.
  - Porta mapeada: `8115:80` (host:container).
  - Variáveis de ambiente padrão:
    - `NODE_ENV=production`
    - `PORT=80` (porta interna do container)
    - `DB_PATH=/data/data.db` (persistência fora do container via volume)
    - `ALLOWED_ORIGIN=*` (CORS simples; ajuste conforme necessidade)
- `Dockerfile`
  - Base `node:22-alpine` com `EXPOSE 80`.
- `src/app.js`
  - Configura Express (JSON, CORS, estáticos) e monta rotas de API.
- `src/server.js`
  - Lê `PORT` e inicia o servidor.
- `src/config/env.js`
  - Centraliza leitura de `PORT`, `ALLOWED_ORIGIN` e `DB_PATH` (padrão: `data.db` na raiz).
- `src/db/index.js`
  - Inicializa SQLite e expõe operações (CRUD e consultas) sobre `emails`.
- `src/routes/*.routes.js`
  - Rotas de API (`/api/health`, `/api/emails`, etc.).
- `src/controllers/*.controller.js`
  - Handlers das rotas com validações e respostas.

Executando Localmente (sem Docker)
- Pré-requisito: Node.js 20+.
- Instalação e execução:
  - `npm install`
  - `PORT=8115 npm start` (ou simplesmente `npm start` para usar o padrão 8115)
  - Acesse `http://localhost:8115/api/health`

Variáveis de Ambiente
- `PORT`
  - Porta da aplicação. Padrão: 8115 local. No Docker Compose, é forçada para 80 dentro do container e exposta em 8115 no host.
- `DB_PATH`
  - Caminho para o arquivo SQLite. No Docker: `/data/data.db` (volume persistente `inbox_data`).
- `ALLOWED_ORIGIN`
  - Origem permitida para CORS. Padrão: `*` (liberado). Ajuste para a origem do seu frontend.

API HTTP
- Saúde
  - `GET /api/health`
  - Retorna `{ ok: true }` para indicar que o serviço está no ar.

- Criar mensagem (enviar “email”)
  - `POST /api/emails`
  - Alias: `POST /api/send`
  - Corpo JSON (campos aceitos – use um alias):
    - `title` ou `titulo` (string, obrigatório)
    - `recipient` ou `destinatario` ou `to_address` (string, obrigatório)
    - `body` ou `body_email` (string, obrigatório)
  - Exemplo:
    ```sh
    curl -X POST http://localhost:8115/api/emails \
      -H 'Content-Type: application/json' \
      -d '{"title":"Boas-vindas","recipient":"user@exemplo.com","body":"Olá!"}'
    ```

- Listar mensagens (com paginação, busca e filtro)
  - `GET /api/emails`
  - Query params:
    - `limit` (1–100, padrão 20)
    - `offset` (>= 0) ou `page` (>= 0)
    - `search` (texto para buscar em título, destinatário e corpo)
    - `unread` (booleano: `true/1/yes/on` para apenas não lidas)
  - Exemplo:
    ```sh
    curl 'http://localhost:8115/api/emails?limit=10&search=boas'
    ```

- Obter por ID (marca como lida)
  - `GET /api/emails/:id`
  - Exemplo:
    ```sh
    curl http://localhost:8115/api/emails/1
    ```

- Apagar todas as mensagens
  - `DELETE /api/emails`
  - Exemplo:
    ```sh
    curl -X DELETE http://localhost:8115/api/emails
    ```

- Criar lote de liquidações de antecipação
  - `POST /api/slc/v1/liquidacoes-antecipacao`
  - Corpo JSON: objeto com os dados do lote, incluindo `grupoSLC0912Centrlz.grupoSLC0912PontoVenda` (até 1000 itens)
  - Resposta:
    ```json
    { "numCtrlCip": "12345678901234567890" }
    ```

- Consultar processamento do lote
  - `GET /api/slc/v1/liquidacoes/:numCtrlCip/processamento`
  - Resposta exemplo:
    ```json
    {
      "situacao": "F",
      "dtHrUltAlt": "2022-01-05T10:00:00Z",
      "grupoPontoVendaActo": [
        {
          "numCtrlCreddrPontoVenda": "12345678901234567890",
          "nuLiquid": "123456789012345678901"
        }
      ],
      "grupoPontoVendaRecsdo": [
        {
          "numCtrlCreddrPontoVenda": "12345678901234567891",
          "atrbtErr": "GrupoPontoVenda.DtPgto",
          "codErro": "ESLC0128"
        }
      ]
    }
    ```

- Listar lotes de liquidação
  - `GET /api/slc/v1/liquidacoes-antecipacao?limit=20&page=0`

- Apagar todos os lotes
  - `DELETE /api/slc/v1/liquidacoes-antecipacao`
  - Resposta: `{ "ok": true, "deleted": <número de linhas removidas> }`

- Obter lote completo (requisição + processamento)
  - `GET /api/slc/v1/liquidacoes/:numCtrlCip`
  - Resposta: `{ "numCtrlCip", "createdAt", "requisicao", "processamento" }`

- Atualizar lote salvo
  - `PUT /api/slc/v1/liquidacoes/:numCtrlCip`
  - Corpo JSON: envie `requisicao` e/ou `processamento` (ao menos um)
  - Se `requisicao` for enviada, aplica as mesmas regras de validação do POST (1 a 1000 pontos de venda)

- Deletar lote de liquidação
  - `DELETE /api/slc/v1/liquidacoes/:numCtrlCip`

- Tela web de lotes
  - Acesse `http://localhost:8115/lotes.html`
  - Permite listar lotes, editar requisição e processamento, deletar um lote ou limpar todos os lotes

- Criar processo de receivables
  - `POST /api/slc/v1/receivables`
  - Corpo JSON: `processReference` e `receivables` (lista com ao menos 1 item)
  - Gera `processKey` UUID e retorna payload no modelo de receivables com `createdAt`

- Listar processos de receivables
  - `GET /api/slc/v1/receivables?limit=20&page=0`

- Obter processo de receivables
  - `GET /api/slc/v1/receivables/:processKey`
  - Resposta: `{ "processKey", "createdAt", "request", "response" }`

- Atualizar processo de receivables
  - `PUT /api/slc/v1/receivables/:processKey`
  - Corpo JSON: `request` e/ou `response` (ao menos um)

- Deletar processo de receivables
  - `DELETE /api/slc/v1/receivables/:processKey`

- Apagar todos os processos de receivables
  - `DELETE /api/slc/v1/receivables`
  - Resposta: `{ "ok": true, "deleted": <número de linhas removidas> }`

- Tela web de receivables
  - Acesse `http://localhost:8115/receivables.html`
  - Permite listar, editar request/response, deletar um processo ou limpar todos

Equals API Mock
- Simula a API da Equals (https://apiequalsvendainterna.docs.apiary.io) localmente para testar o comando `equals:report-sales` do greenn-back sem depender da API real.

- Configuração no greenn-back:
  - Defina `EQUALS_API_BASE_URL=http://localhost:8115/equals-api` no `.env.dev`
  - O mock aceita qualquer credencial Basic Auth (sem validação)

- Endpoints simulados (montados em `/equals-api`):
  - `GET /equals-api/adquirentes` — lista de adquirentes (Pagarme, Cielo, Rede, PayPal, etc.)
  - `GET /equals-api/bandeiras` — lista de bandeiras (Visa, Mastercard, Amex, Elo, etc.)
  - `GET /equals-api/formas-de-pagamento` — formas de pagamento (Cartão de Crédito, PIX, Boleto, Débito)
  - `GET /equals-api/meios-de-captura` — meios de captura (e-commerce, POS, TEF, etc.)
  - `POST /equals-api/transacoes` — recebe o batch de vendas e armazena para inspeção
  - `GET /equals-api/transacoes` — retorna `{ "transacoes": [] }` (mock vazio)
  - `GET /equals-api/transacoes/status` — retorna `{ "status": "ok", "processado": true }`

- API de gerenciamento (montada em `/api/equals-mock`):
  - `GET /api/equals-mock/config` — retorna todas as configurações de listas
  - `GET /api/equals-mock/config/:key` — retorna uma configuração específica
  - `PUT /api/equals-mock/config/:key` — atualiza uma lista (corpo: `{ "data": [...] }`)
  - `POST /api/equals-mock/config/:key/reset` — restaura a lista ao padrão
  - `GET /api/equals-mock/transactions` — lista transações recebidas (query: `limit`, `offset`)
  - `DELETE /api/equals-mock/transactions` — limpa todas as transações recebidas

- Tela web de edição dos mocks:
  - Acesse `http://localhost:8115/equals-mocks.html`
  - Permite editar as 4 listas (adquirentes, bandeiras, formas de pagamento, meios de captura) via textarea JSON
  - Visualizar e limpar as transações recebidas com paginação

Worldpay Mock (charge)
- Substitui a API XML da Worldpay (WPG `paymentService`) para testar cenários de recusa no fluxo de
  charge da gateway, sem depender do sandbox real. Cada cenário do catálogo devolve um XML específico.

- Configuração na gateway (`gateway/.env.dev`):
  - `WORLDPAY_API_URL=http://svc-inbox_messages/worldpay/paymentService` (container-to-container, ambos na `greenn-network`)
  - Ou, para fixar um cenário por URL: `.../worldpay/paymentService/fraud`
  - Mantenha `WORLDPAY_MOCK_CHARGE_ENABLED=false` — o mock aqui substitui a API, não o código da gateway.

- Como escolher o cenário (precedência):
  1. Rota — `POST /worldpay/paymentService/:scenario`
  2. Header — `X-Mock-Scenario: Teste Fraud`
  3. Cenário ativo — definido via `PUT /api/gateway-mocks/worldpay/active`
  4. Padrão — `authorised`

  O nome é aceito em qualquer forma: `Teste Fraud`, `teste-fraud`, `FRAUD` ou `fraud`.

- Endpoints:
  - `POST /worldpay/paymentService` — recebe o XML da gateway e devolve o XML do cenário
  - `POST /worldpay/paymentService/:scenario` — idem, fixando o cenário pela URL
  - `GET /api/gateway-mocks/worldpay/scenarios` — catálogo completo, com o resultado esperado de cada teste
  - `GET /api/gateway-mocks/worldpay/active` — cenário ativo
  - `PUT /api/gateway-mocks/worldpay/active` — define o ativo (corpo: `{ "scenario": "Teste Fraud" }`)
  - `GET /api/gateway-mocks/worldpay/transactions` — request e response persistidos (query: `limit`, `offset`, `scenario`)
  - `DELETE /api/gateway-mocks/worldpay/transactions` — limpa o histórico

- Tipos de cenário:
  - `iso8583` — `lastEvent REFUSED` + `ISO8583ReturnCode` (recusa do emissor)
  - `last_event` — `lastEvent` arbitrário (`AUTHORISED`, `CANCELLED`, `EXPIRED`, `ERROR`, ...)
  - `gateway_error` — `<reply><error code="N">` sem `orderStatus`
  - `http_error` — resposta HTTP não-2xx
  - `timeout` — segura a resposta além do timeout da gateway (vira `GATEWAY_TIMEOUT` 504)

- Exemplo:
  ```bash
  curl -X PUT http://localhost:8115/api/gateway-mocks/worldpay/active \
    -H 'Content-Type: application/json' -d '{"scenario":"Teste Fraud"}'

  # a próxima cobrança na gateway volta REFUSED / 34 - FRAUD SUSPICION
  curl http://localhost:8115/api/gateway-mocks/worldpay/transactions?limit=1
  ```

- Arquivos:
  - `src/mocks/worldpay/scenarios.js` — catálogo (adicionar cenário é adicionar item nesse array)
  - `src/mocks/worldpay/response-builder.js` — montagem do XML por tipo de cenário
  - `src/mocks/worldpay/request-parser.js` — extrai orderCode/amount/parcelas do XML recebido
  - `src/controllers/worldpay-mock.controller.js`, `src/routes/worldpay-mock.routes.js`

Persistência (SQLite)
- Em Docker, o banco é salvo no volume `inbox_data` montado em `/data` dentro do container.
- Localmente (sem Docker), o arquivo padrão é `data.db` na raiz do projeto.
- Tabelas dos mocks de gateway: `gateway_mock_state` (cenário ativo por gateway) e
  `gateway_mock_transactions` (request e response de cada chamada, com headers, status e duração).

Comandos Úteis (Makefile)
- `make up`     — sobe stack com build e garante rede `greenn-network`.
- `make down`   — derruba a stack.
- `make logs`   — segue logs do container `svc-inbox_messages`.
- `make rebuild`— rebuild sem cache e sobe.
- `make clean-cache` — limpa cache de build do Docker.

Notas
- O serviço responde CORS para a origem configurada (padrão: `*`). Ajuste `ALLOWED_ORIGIN` conforme o seu frontend.
- Em produção, considere restringir CORS, proteger endpoints e ajustar políticas de acesso.
Desenvolvimento (hot-reload)
- Pré-requisito: Node.js 20+.
- Instalação e execução:
  - `npm install`
  - `npm run dev` (usa nodemon para reiniciar ao salvar em `src/`)
  - Acesse `http://localhost:8115/api/health` (ajuste `PORT` se necessário)

Testes
- Usa o runner nativo do Node (`node --test`).
- Comandos:
  - `npm test`
- O teste de integração sobe a aplicação em porta efêmera e usa um banco SQLite temporário.

Mock da WhatsApp Cloud API (aba WhatsApp)
- Página: `http://localhost:8115/whatsapp.html`. Preview visual das mensagens no estilo do app, com botões e listas clicáveis.
- No backend, troque a base `https://graph.facebook.com/v20.0` por `http://localhost:8115/v20.0` (de dentro da `greenn-network`: `http://svc-inbox_messages/v20.0`). Qualquer token é aceito; payload e resposta seguem o formato da Cloud API, erros também (`{ error: { message: "(#100) ...", code: 100 } }`).
  ```sh
  curl -X POST http://localhost:8115/v20.0/123456789012345/messages \
    -H 'Content-Type: application/json' -H 'Authorization: Bearer qualquer' \
    -d '{"messaging_product":"whatsapp","to":"5511988887777","type":"text","text":{"body":"Olá *Maria*, pedido _#4821_ aprovado."}}'
  ```
- O que o **Cliente** faz na UI (texto, clique em botão, item de lista) vira webhook no formato Meta para `WA_MOCK_WEBHOOK_URL` (configurável também pela engrenagem da página), incluindo `statuses` (`sent` → `delivered` → `read`).
- Templates: só os parâmetros vão no envio; o texto vem de `src/mocks/whatsapp/templates.json` (relido a cada envio). Template ausente aparece como card vermelho com o payload.
- Endpoints internos: `GET /api/wa-mock/state`, `GET /api/wa-mock/events` (SSE), `GET /api/wa-mock/templates`, `POST /api/wa-mock/inbound`, `POST /api/wa-mock/config`, `POST /api/wa-mock/clear`.
- Variáveis (opcionais; sobrescrevem o que a UI salvou): `WA_MOCK_WEBHOOK_URL`, `WA_MOCK_APP_SECRET` (assina com `X-Hub-Signature-256`), `WA_MOCK_PHONE_NUMBER_ID`, `WA_MOCK_DISPLAY_PHONE`, `WA_MOCK_BUSINESS_NAME`, `WA_MOCK_CONTACT_NAME`, `WA_MOCK_CONTACT_WA_ID`, `WA_MOCK_DELIVERED_DELAY_MS`, `WA_MOCK_WEBHOOK_TIMEOUT_MS` (padrão 20s).
- Estado (conversas e config) fica em `wa-mock-state.json` ao lado do SQLite (`/data` no Docker). Limitações: uma conversa por número, sem upload de mídia, sem grupos.

Integração com o messages (greenn-local)
- greenn-back → messages (`http://messages-nginx/api/send` e `api/whatsapp/send`) → mocks desta ferramenta. Configuração feita em `greenn-local` (template `templates/messages.env.dev.template` e `dev-overlay/messages`):
  - `URL_WHATSAPP_META=http://svc-inbox_messages/v20.0/<phone_number_id>/messages` → aba WhatsApp.
  - `MAILTRAP_API_URL=http://svc-inbox_messages` → e-mails caem no Inbox via `POST /api/send/:inboxId` (formato da API do Mailtrap: `from`, `to[]`, `subject`, `text|html`).
  - Container `messages-worker` roda os workers das filas `_send_message_email`, `_send_message_whatsapp` e `_postback_whatsapp`.
- Volta: o mock envia o webhook para `WA_MOCK_WEBHOOK_URL` (padrão `http://messages-nginx/api/whatsapp/callback`), e o messages repassa aos postbacks do greenn-back.

Webhook Forward (webhook.site → local)
- Página: `http://localhost:8115/whs-forward.html`. Lê as requisições capturadas em um token do webhook.site e reenvia para uma URL local, preservando método, headers, query e corpo (headers hop-by-hop removidos; adiciona `x-whs-request-id` e `x-whs-created-at`).
- Uso: cadastre `https://webhook.site/<token>` no provedor (Certta, gateway…), crie o encaminhador com esse token e o destino visto de dentro do container (ex.: `http://greenn-back-nginx/api/...`) e clique em Iniciar. Sem histórico, só o que chegar dali em diante é reenviado; "Iniciar com histórico" reenvia o que já estava capturado, do mais antigo para o mais novo.
- O que já foi reenviado fica registrado em `whs-forward.json` (ao lado do SQLite) para não duplicar entre reinícios. Encaminhadores marcados com "Subir junto com o servidor" voltam a rodar sozinhos.
- API: `GET/POST /api/whs-forward/forwarders`, `PUT/DELETE /api/whs-forward/forwarders/:id`, `POST .../:id/start` (`{ backfill: true }` para histórico), `POST .../:id/stop`, `POST .../:id/reset`, `GET .../:id/log`, `POST /api/whs-forward/check`.
- Variáveis: `WHS_BASE_URL` (padrão `https://webhook.site`). Sem Api-Key o webhook.site limita a frequência de consulta; abaixo de 3s pode responder 429.

E-mails do greenn-back (templates com dados fictícios)
- Página: `http://localhost:8115/email-templates.html`. Lista todos os templates de `resources/views/emails/` do greenn-back (exceto `layouts/`), agrupados por pasta. "Enviar todos" ou "Enviar selecionados" renderiza cada template dentro do container `greenn-back-php` com um conjunto fixo de dados fictícios e grava o HTML no Inbox, com o nome da view como título. Não passa pelo fluxo de envio do backend e não precisa de vendas reais.
- Templates com layout condicional aparecem mais de uma vez, com a variante entre colchetes (ex.: `emails.orders.success.paid.client [boleto]`). Destinatário é escolhido pelo público do template (cliente, vendedor ou afiliado); o campo opcional força um só destinatário.
- Requer o socket do Docker montado (já está no `docker-compose.yml`) e o container do greenn-back de pé.
- API: `GET /api/email-templates` (lista) e `POST /api/email-templates/send` com `{ labels?: string[], recipient?: string }` (`labels` vazio envia todos). Resposta: `{ sent, failed, results: [{ label, ok, id | error, recipient }] }`.
- Variáveis: `GREENN_BACK_CONTAINER` (padrão `greenn-back-php`). Os dados fictícios ficam em `src/services/email-templates.service.js`.
