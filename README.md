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
