# Inbox Messages

Ferramenta local (Node.js + Express + SQLite) com Inbox de e-mails e mocks de integrações para o ambiente `greenn-local`.

## Pré-requisitos

- Docker e Docker Compose
- Node.js 20+ (apenas para rodar sem Docker)

## Subindo com Docker

```sh
make up        # cria a rede greenn-network (se não existir) e sobe os containers com build
make down      # para e remove os containers
make logs      # logs do inbox_messages
make rebuild   # rebuild sem cache
```

| Serviço | Container | URL |
|---|---|---|
| Inbox | `svc-inbox_messages` | http://localhost:8115 (saúde: `/api/health`) |
| Página de reclamação | `svc-claim-page` | http://localhost:6002 |

Acesso pelo celular (mesma rede Wi-Fi):

```sh
make mobile                     # sobe com o IP da LAN (QR Code em http://<ip>:8115/qrcode.html)
make mobile-all                 # idem + reconfigura greenn-adm e new-checkout para o IP da LAN
make mobile LAN_IP=192.168.0.10 # se o IP não for detectado
```

## Rodando sem Docker

```sh
npm install
npm start      # ou: npm run dev (nodemon)
npm test
```

Sobe em http://localhost:8115 com o banco em `./data.db`.

## Configuração

Variáveis definidas no `docker-compose.yml` (podem ser passadas pelo shell ao rodar `make up`):

| Variável | Padrão | Uso |
|---|---|---|
| `PORT` | `8115` (local) / `80` (Docker) | Porta da aplicação |
| `DB_PATH` | `./data.db` / `/data/data.db` | Arquivo SQLite (volume `inbox_data` no Docker) |
| `ALLOWED_ORIGIN` | `*` | Origem permitida no CORS |
| `LAN_HOST` | vazio | IP da LAN para a página de QR Code (preenchido por `make mobile`) |
| `WA_MOCK_WEBHOOK_URL` | `http://messages-nginx/api/whatsapp/callback` | Destino dos webhooks do mock do WhatsApp |
| `TRANSFEERA_WEBHOOK_SECRET` | vazio | Igual ao `TRANSFEERA_WEBHOOK_TRANSFER_SECRET` do greenn-back |
| `IDWALL_MOCK_WEBHOOK_TOKEN` | vazio | Igual ao `IDWALL_WEBHOOK_TOKEN` do greenn-back |

Demais variáveis são opcionais e têm padrão em `src/config/env.js` (banco do greenn-back, containers, mock do WhatsApp, webhook.site, TAG etc.).

Requisitos do ambiente:

- Rede Docker externa `greenn-network` (criada pelo `make up`).
- Socket do Docker montado (`/var/run/docker.sock`, já no compose) para as abas que executam comandos em outros containers.
- Containers do `greenn-local` de pé quando usar as abas integradas (`greenn-back-nginx`, `greenn-back-php`, `greenn-back-mysql`, `messages-nginx`).

## Integração com o greenn-local

No `messages` do `greenn-local` (`templates/messages.env.dev.template`):

```env
URL_WHATSAPP_META=http://svc-inbox_messages/v20.0/<phone_number_id>/messages
MAILTRAP_API_URL=http://svc-inbox_messages
```

Mock da IdWall no greenn-back (patch local, não commitar):

```sh
make idwall-mock-on
make idwall-mock-off
make idwall-mock-status
```

Mock da Iugu no greenn-back e na gateway (patch local, não commitar). Painel em http://localhost:8115/gateway-mocks-iugu.html:

```sh
make iugu-mock-on                     # rebuild do inbox + patch + config:clear + workers da Iugu reiniciados
make iugu-mock-proxy-on SELLER=123    # seller no caminho do sec-proxy (user flag IUGU_SEC_PROXY)
make iugu-mock-proxy-off SELLER=123   # seller de volta ao caminho legado (API direta)
make iugu-mock-status
make iugu-mock-off
```

| Caminho | URL no mock | Quem usa |
|---|---|---|
| API direta | `http://svc-inbox_messages/iugu/v1/` | `IuguHelper` e comandos do greenn-back, `IuguService` legado da gateway |
| sec-proxy | `http://svc-inbox_messages/iugu-proxy` (+ `/iugu/v1/...`), `x-greenn-token: iugu-mock-greenn-token` | `IuguSecProxyProvider` do greenn-back e da gateway, com a flag `IUGU_SEC_PROXY` |
| Webhooks | `POST http://gateway-nginx/api/postback?integration=iugu` (form-urlencoded) | `WebhookController` da gateway |

- IDs no formato da Iugu (32 hex maiúsculos) para conta, fatura (`transaction_id`), cliente, forma de pagamento e token.
- Cartão: o final do número decide o resultado (`0002` negado, `0051` saldo insuficiente, `0010` em análise...; o resto aprova). Dá para fixar um cenário na aba Configurações ou por request com o header `X-Mock-Scenario`.
- Pix e boleto ficam `pending` até pagar pelo painel, pela página da fatura (`secure_url`) ou após N segundos (configurável).
- O proxy devolve tokens só como envelope `v1.<kid>.<payload>.<mac>`, recusa `null`, `[]` e campos fora da allowlist, e reconstrói os responses só com os campos que os clientes leem (por isso `refunded_at_iso`, `chargeback_at_iso` e `updated_at` não chegam por ele).
- O modo estrito recusa o que a documentação da Iugu proíbe e o código hoje envia; desligado, só registra o aviso na requisição e na fatura.
- O caminho do sec-proxy na gateway só existe em branches que têm `src/config/iugu_sec_proxy.php`; sem o arquivo o patch pula essa parte.
