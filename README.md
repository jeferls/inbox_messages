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

Persistência (SQLite)
- Em Docker, o banco é salvo no volume `inbox_data` montado em `/data` dentro do container.
- Localmente (sem Docker), o arquivo padrão é `data.db` na raiz do projeto.

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
