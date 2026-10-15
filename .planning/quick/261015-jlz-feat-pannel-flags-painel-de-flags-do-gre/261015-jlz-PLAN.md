---
phase: 261015-jlz
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/services/flags-panel.service.js
  - src/routes/flags-panel.routes.js
  - src/app.js
  - src/services/global-flags.service.js
  - src/services/global-settings.service.js
  - tests/flags-panel.test.js
  - public/flags.html
  - public/flags.js
  - docker-compose.yml
  - public/claims.html
  - public/email-templates.html
  - public/equals-mocks.html
  - public/gateway-mocks.html
  - public/gateway-mocks-worldpay.html
  - public/index.html
  - public/konduto.html
  - public/lotes.html
  - public/payment-tester.html
  - public/postback-gateway.html
  - public/qrcode.html
  - public/receivables.html
  - public/recorrencia.html
  - public/whatsapp.html
  - public/whs-forward.html
autonomous: true
requirements: [R1, R2, R3, R4]

estimate:
  tokens: 85000
  raw_tokens: 85000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "Digitar o path do greenn-back (raiz do repo ou raiz Laravel src/) e clicar Carregar lista as flags do GlobalFlagSeeder, cada uma com um switch que reflete se existe linha em global_flags (R1, R2, R3)"
    - "Ligar um switch faz INSERT em global_flags e desligar faz DELETE WHERE flag = ?; depois de cada toggle roda cache:forget feature_flag_<FLAG> no greenn-back-php e, se falhar, a UI mostra aviso sem desfazer a gravacao (R3, D-02)"
    - "Flags que estao em global_flags mas fora do seeder aparecem com o badge 'fora do seeder' (D-03)"
    - "Para uma flag e possivel listar os user_flags, adicionar um usuario por ID ou e-mail e remover uma linha (R4)"
    - "O painel recusa operar se o .env tiver APP_ENV production/prod ou DB_HOST fora de greenn-back-mysql/localhost/127.0.0.1, e DB_PASSWORD nunca aparece em resposta da API (D-05)"
    - "No host, DB_HOST=greenn-back-mysql vira 127.0.0.1:3301; no container, um path digitado inexistente cai no mount /greenn-back (D-01, D-04)"
    - "O ultimo path volta preenchido ao reabrir a pagina, ha filtro de busca, e todas as abas tem o link 'Flags' na nav (D-01, D-06)"
  artifacts:
    - path: src/services/flags-panel.service.js
      provides: "parsers puros + guard + acesso ao banco do path digitado"
      exports: [parseEnv, parseSeederFlags, isValidFlag, locateProject, resolveDbConfig, withDb, listFlags, toggleFlag, listUserFlags, addUserFlag, removeUserFlag]
    - path: src/routes/flags-panel.routes.js
      provides: "GET/PUT /api/flags-panel/flags|flag e GET/POST/DELETE /api/flags-panel/user-flags"
    - path: tests/flags-panel.test.js
      provides: "testes node:test dos parsers/guards + e2e opcional via FLAGS_PANEL_E2E"
    - path: public/flags.html
      provides: "aba Flags (nav, input de path, filtro, lista, painel de user_flags)"
    - path: public/flags.js
      provides: "logica da aba: localStorage, toggle, filtro, user_flags"
  key_links:
    - from: public/flags.js
      to: /api/flags-panel/*
      via: fetch
      pattern: "/api/flags-panel/"
    - from: src/app.js
      to: src/routes/flags-panel.routes.js
      via: "app.use('/api', flagsPanelRoutes)"
      pattern: "flagsPanelRoutes"
    - from: src/services/flags-panel.service.js
      to: src/services/global-flags.service.js
      via: "setGlobalFlag(flag, enabled, conn) com a conexao do .env digitado"
      pattern: "setGlobalFlag\\("
    - from: src/services/flags-panel.service.js
      to: src/services/global-settings.service.js
      via: "forgetBackCache('feature_flag_' + flag)"
      pattern: "forgetBackCache"
    - from: docker-compose.yml
      to: /greenn-back
      via: "volume ${GREENN_BACK_PATH:-../greenn-back}:/greenn-back:ro"
      pattern: "/greenn-back:ro"
---

<objective>
Nova aba "Flags" no inbox_messages para gerenciar as feature flags do greenn-back no banco de DEV local: o usuario digita o path do greenn-back, o servidor le o `.env` de dev e o `GlobalFlagSeeder.php` dali, lista as flags com um switch por flag (INSERT/DELETE em `global_flags` + `cache:forget`) e permite listar/adicionar/remover `user_flags` por flag.

IDs: R1..R4 = itens 1..4 de "## Requirements" do CONTEXT; D-01..D-06 = decisoes D1..D6 do CONTEXT (travadas).

Purpose: ligar/desligar flags de dev sem abrir cliente MySQL nem rodar seeder, com a mesma conexao que o greenn-back usa.
Output: `src/services/flags-panel.service.js`, `src/routes/flags-panel.routes.js`, `public/flags.html`, `public/flags.js`, `tests/flags-panel.test.js`, mount no `docker-compose.yml`, link "Flags" na nav das 15 abas.

Source audit:

| Source | ID | Item | Task | Status |
|---|---|---|---|---|
| GOAL | - | painel de flags do greenn-back (descricao da quick task) | 1-3 | COVERED |
| REQ | R1 | input de path; le .env de dev + GlobalFlagSeeder (raiz repo ou raiz Laravel) | 1 | COVERED |
| REQ | R2 | parse do array `$flags` (aspas simples, pontos, hifens, maiusc/minusc) | 1 | COVERED |
| REQ | R3 | switch por flag: INSERT/DELETE parametrizado em global_flags | 1 (estado), 2 (toggle) | COVERED |
| REQ | R4 | user_flags: listar, adicionar (ID ou e-mail), remover | 3 | COVERED |
| CONTEXT | D-01 | path host vs mount /greenn-back, localStorage, volume no compose | 1, 2 | COVERED |
| CONTEXT | D-02 | cache:forget feature_flag_<FLAG> via docker, falha nao-fatal com aviso | 2 | COVERED |
| CONTEXT | D-03 | badge "fora do seeder" | 1 | COVERED |
| CONTEXT | D-04 | mysql2 + formato GREENN_DB; fallback 127.0.0.1:3301 no host | 1 | COVERED |
| CONTEXT | D-05 | recusa APP_ENV production / DB_HOST remoto | 1 | COVERED |
| CONTEXT | D-06 | pagina no padrao public/*.html, nav, filtro, pt-BR | 1, 2 | COVERED |
| RESEARCH | s1 | reusar global-flags.service (SQL idempotente) com conexao dinamica | 2 | COVERED |
| RESEARCH | s2 | padrao cache:forget de global-settings.service; user_flags sem cache | 2 | COVERED |
| RESEARCH | s4 | parser .env inline (sem dotenv), ordem de busca env/seeder, regex de nome, user_flags sem unique | 1, 3 | COVERED |
| RESEARCH | s5 | testes puros sem importar app.js; inContainer injetado | 1 | COVERED |
| RESEARCH | s6 | nunca devolver DB_PASSWORD; nao reaproveitar GREENN_DB_*; prefixo /flags-panel | 1 | COVERED |
</objective>

<execution_context>
@~/.claude/gsd-core/workflows/execute-plan.md
@~/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/quick/261015-jlz-feat-pannel-flags-painel-de-flags-do-gre/261015-jlz-CONTEXT.md
@.planning/quick/261015-jlz-feat-pannel-flags-painel-de-flags-do-gre/261015-jlz-RESEARCH.md

@src/services/global-flags.service.js
@src/services/global-settings.service.js
@src/services/greenn-db.js
@src/routes/docker.routes.js
@tests/wa-mock.test.js
@public/lotes.html

Interfaces ja existentes (nao reler para confirmar):
- `src/services/docker.service.js`: `execInContainer(container, cmdArray, { timeout })` -> `{ exitCode, stdout, stderr }` (lanca se o container nao existe/parado); `isDockerAvailable()` -> boolean.
- `src/config/env.js`: `GREENN_BACK_CONTAINER` (default `greenn-back-php`); `GREENN_DB` = `{ host, port, user, password, database }` (formato a imitar, valores NAO reaproveitados - D-04).
- `src/app.js:54` ja tem `express.json()` global; rotas registradas em `src/app.js:94-110`.
- `public/konduto.html`: CSS `.switch/.slider` (linhas 50-57), `.flag-error` (60), `.badge` + `.st-pending` (94-96); markup do switch `label.switch > input[type=checkbox] + span.slider`. `public/konduto.js:112-130`: padrao fetch + `setBusy`.
- Ambiente real desta maquina: `../greenn-back/.env.dev` e `../greenn-back/src/database/seeders/GlobalFlagSeeder.php` existem; `greenn-back-mysql` publica 3306 em 3301 no host; `greenn-back-php` esta up. NAO leia `.env.dev` na conversa (guard de segredos) - o codigo le em runtime.
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: Tracer "carregar flags do path digitado" - service + rota GET + aba Flags listando estado</name>
  <files>src/services/flags-panel.service.js, tests/flags-panel.test.js, src/routes/flags-panel.routes.js, src/app.js, public/flags.html, public/flags.js</files>
  <precondition>`node_modules/` existe no checkout (se nao existir, rodar `npm ci` - instala so as deps ja travadas no package-lock, nenhuma nova) e o container `greenn-back-mysql` esta up com 3306 publicada em 3301.</precondition>
  <behavior>
    - parseSeederFlags: texto PHP com `$flags = [ '3DS', 'feature.client_search.use_opensearch', 'show-button-redirect-club', // 'COMENTADA', 'bank_account_remove', '3DS', ];` retorna exatamente `['3DS','feature.client_search.use_opensearch','show-button-redirect-club','bank_account_remove']` (comentario `//` ignorado, dedup preservando ordem); texto sem `$flags = [` lanca erro.
    - parseEnv: ignora linhas vazias e `#`; aceita `export DB_HOST=greenn-back-mysql`; `DB_PASSWORD="se#cret=1"` -> `se#cret=1`; `DB_USERNAME='admin'` -> `admin`; `APP_KEY=base64:abc=` -> `base64:abc=`; `DB_PORT=3306 # porta` -> `3306`.
    - isValidFlag: true para `3DS`, `feature.client_search.use_opensearch`, `show-button-redirect-club`; false para `''`, `a b`, `x';DROP`, string de 51 chars, nao-string.
    - resolveDbConfig: `DB_HOST=greenn-back-mysql` com `inContainer:false` -> host `127.0.0.1`, port `3301`; com `inContainer:true` -> `greenn-back-mysql`, `3306`; `DB_HOST=localhost DB_PORT=3307` -> `localhost`, `3307`; `APP_ENV=production` (ou `prod`) lanca erro com `status` 400; `DB_HOST=db.prod.aws.com` lanca erro com `status` 400 (D-05).
    - locateProject (exists fake via Set): path na raiz do repo `/r/greenn-back` -> envFile `/r/greenn-back/.env.dev`, seederFile `/r/greenn-back/src/database/seeders/GlobalFlagSeeder.php`; path na raiz Laravel `/r/greenn-back/src` -> envFile `/r/greenn-back/.env.dev`, seederFile `/r/greenn-back/src/database/seeders/GlobalFlagSeeder.php`; path inexistente com `/greenn-back` existente -> backPath `/greenn-back` (D-01); nada existente ou input vazio -> erro `status` 400.
    - e2e (so com `FLAGS_PANEL_E2E=<path>`): `GET /api/flags-panel/flags?path=<path>` -> 200, `flags.length > 0`, cada item com `flag` string e `enabled`/`inSeeder` booleanos, `Object.keys(body.db)` = `['host','port','database']` (sem senha); `GET /flags.html` -> 200.
  </behavior>
  <action>
RED primeiro: criar `tests/flags-panel.test.js` (ESM, `import test from 'node:test'; import assert from 'node:assert/strict';`) com os casos de `<behavior>`, importando so `../src/services/flags-panel.service.js` (nunca `app.js` no topo - dispara o dbInit do SQLite). Bloco e2e: se `process.env.FLAGS_PANEL_E2E` estiver definido, seguir o bootstrap de `tests/wa-mock.test.js:1-12` (DB_PATH em `fs.mkdtemp(os.tmpdir())`, `await import('../src/app.js')`, `app.listen(0)`, fechar o server no fim); senao os testes e2e ficam com `{ skip: 'defina FLAGS_PANEL_E2E=<path do greenn-back>' }`. Rodar e ver falhar.

GREEN - `src/services/flags-panel.service.js` (cabecalho de comentario curto em pt-BR, no estilo de `global-flags.service.js`):
- Helper interno `fail(status, message)` = `Object.assign(new Error(message), { status })`. Erros com `status` sao de entrada/guard (a rota devolve a mensagem como esta); sem `status` = falha de banco (502).
- `isValidFlag(name)`: string e `/^[A-Za-z0-9_.\-]{1,50}$/` (flag e varchar(50)).
- `parseEnv(text)`: por linha; pular vazias e iniciadas por `#`; regex `^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$`; valor iniciado por aspa simples/dupla = conteudo ate a aspa de fechamento; senao cortar ` #...` inline e `trim()`. Retorna objeto. Sem dotenv (RESEARCH s4).
- `parseSeederFlags(text)`: bloco via `/\$flags\s*=\s*\[([\s\S]*?)\]\s*;/` (sem match -> `fail(400, 'Array $flags nao encontrado no GlobalFlagSeeder.php')`, com acentos na mensagem real); remover `//...` ate o fim da linha (seguro: nomes validos nao tem `/`); extrair strings entre aspas simples ou duplas; filtrar com `isValidFlag`; dedup com `Set` preservando ordem (R2).
- `locateProject(input, exists = fs.existsSync)`: input vazio -> 400 "Informe o caminho do greenn-back"; `p = path.resolve(input.trim())`; `backPath = exists(p) ? p : exists('/greenn-back') ? '/greenn-back' : fail(400, ...)` (D-01). envFile = primeiro existente entre `backPath/.env.dev`, `backPath/../.env.dev`, `backPath/.env`; seederFile = primeiro entre `backPath/src/database/seeders/GlobalFlagSeeder.php`, `backPath/database/seeders/GlobalFlagSeeder.php`; faltando algum -> 400 com o caminho procurado. Usar `path.join` sobre o path ja resolvido; so esses nomes fixos sao lidos (nada de arquivo livre vindo do cliente).
- `resolveDbConfig(env, { inContainer })` (D-04, D-05): `APP_ENV` em minusculas em `production|prod` -> 400 "APP_ENV=production no .env: o painel so opera em dev"; `host = env.DB_HOST || '127.0.0.1'`, fora de `greenn-back-mysql|localhost|127.0.0.1` -> 400 "DB_HOST ... nao parece local - recusado"; `greenn-back-mysql` com `!inContainer` -> `127.0.0.1:3301` (porta publicada, CLAUDE.md do greenn-local); senao `Number(env.DB_PORT || 3306)`. Retorna `{ host, port, user: env.DB_USERNAME, password: env.DB_PASSWORD, database: env.DB_DATABASE }` - mesmo formato de `GREENN_DB` (D-04), mas sem usar `GREENN_DB_*` nem `getGreennPool()` (conexao vem do .env digitado, RESEARCH s1).
- `withDb(input, fn)`: `locateProject` -> `parseEnv(fs.readFileSync(envFile, 'utf8'))` -> `resolveDbConfig(env, { inContainer: fs.existsSync('/.dockerenv') })` (guard roda antes de conectar) -> `mysql.createConnection({ ...cfg, connectTimeout: 5000 })` (`import mysql from 'mysql2/promise'`) -> `try { return await fn(conn, { ...project, db: { host, port, database } }) } finally { await conn.end() }`. Nunca logar `cfg`.
- `listFlags(input)`: le o seeder (`parseSeederFlags`), `SELECT DISTINCT flag FROM global_flags`; flags do seeder com `{ flag, enabled: set.has(flag), inSeeder: true }` + flags so do banco com `{ flag, enabled: true, inSeeder: false }` (D-03) no fim. Retorna `{ backPath, envFile, seederFile, db: { host, port, database }, flags }` - `db` nunca carrega user/senha.

`src/routes/flags-panel.routes.js`: `Router` com handlers inline (idioma de `src/routes/docker.routes.js`, sem controller). Helper local `send(res, promise)` -> `res.json(data)`; no catch `res.status(e.status || 502).json({ error: e.status ? e.message : 'Falha no banco do greenn-back: ' + e.message })`. Rota `GET /flags-panel/flags` -> `listFlags(req.query.path)`. Em `src/app.js`: `import flagsPanelRoutes from './routes/flags-panel.routes.js';` junto dos imports e `app.use('/api', flagsPanelRoutes);` logo apos `app.use('/api', whsForwardRoutes);`.

`public/flags.html`: esqueleto de `public/lotes.html` (head com `/styles.css`, `.app-shell > nav.sidebar` com a nav completa copiada e `<a class="sidebar-link active" href="/flags.html">Flags</a>` apos o link de Webhook Forward, `.app-content > .page-shell`). Header: `h1` "Flags do greenn-back"; `.page-actions` com `input#backPath` (texto de exemplo `/caminho/para/greenn-local/greenn-back`, largura ~420px) e `button#loadBtn type="button"` "Carregar". Abaixo: `.status-line#statusLine`, `div.flag-error#flagError` oculto, `.panel` com `div#flagList`. `<style>` inline: copiar `.switch/.slider`, `.flag-error`, `.badge` + `.st-pending` de `public/konduto.html` e criar `.flag-row` (flex, gap, borda inferior, padding 8px 12px) e `.mono`. Scripts no fim: `/flags.js?v=1` e `/tab-badge.js?v=1`. Textos em pt-BR (D-06).

`public/flags.js`: `LS_KEY = 'flags-panel:backPath'`; ao abrir, preencher `#backPath` com o salvo e chamar `load()` se houver valor (D-01). `load()`: `fetch('/api/flags-panel/flags?path=' + encodeURIComponent(path))`; erro -> mostrar `data.error` em `#flagError`; ok -> `localStorage.setItem`, guardar `state.flags`, `#statusLine` = "Banco host:port/database - .env: <envFile> - seeder: <seederFile> - N flags (M ligadas)", `render()`. `render()` monta cada `.flag-row` com `createElement` + `textContent` (nunca innerHTML com nome de flag/e-mail): nome `.mono`, badge `.badge.st-pending` "fora do seeder" quando `!inSeeder`, `label.switch > input[type=checkbox][data-flag]` com `checked = enabled` + `span.slider`. O handler de mudanca do switch entra na Task 2 deste mesmo plano. Enter no input dispara `load()`.
  </action>
  <verify>
    <automated>node --test tests/flags-panel.test.js && FLAGS_PANEL_E2E=../greenn-back node --test tests/flags-panel.test.js</automated>
  </verify>
  <done>Testes puros passam sem MySQL; com `FLAGS_PANEL_E2E=../greenn-back` o GET real devolve as flags do seeder com estado do banco e `db` sem senha; `http://localhost:<porta>/flags.html` abre a aba listando as flags com switch e badge "fora do seeder".</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Toggle global (INSERT/DELETE + cache:forget), filtro, nav em todas as abas e mount no compose</name>
  <files>src/services/global-flags.service.js, src/services/global-settings.service.js, src/services/flags-panel.service.js, src/routes/flags-panel.routes.js, tests/flags-panel.test.js, public/flags.html, public/flags.js, docker-compose.yml, public/claims.html, public/email-templates.html, public/equals-mocks.html, public/gateway-mocks.html, public/gateway-mocks-worldpay.html, public/index.html, public/konduto.html, public/lotes.html, public/payment-tester.html, public/postback-gateway.html, public/qrcode.html, public/receivables.html, public/recorrencia.html, public/whatsapp.html, public/whs-forward.html</files>
  <behavior>
    - e2e (com `FLAGS_PANEL_E2E`): `PUT /api/flags-panel/flag` `{ path, flag: 'zz-flags-panel-smoke', enabled: true }` -> 200, `enabled === true`, `typeof cacheCleared === 'boolean'`; GET lista contem `zz-flags-panel-smoke` com `inSeeder:false, enabled:true`; PUT `enabled:false` -> 200 `enabled === false` e o GET nao contem mais a flag (limpeza no `finally`, deixa o banco como estava).
    - PUT com `flag: "x';DROP"` -> 400; PUT com `enabled: 'sim'` -> 400.
  </behavior>
  <action>
Reuso em vez de duplicar (nota do planning_context + RESEARCH s1/s2):
- `src/services/global-flags.service.js`: `getGlobalFlag(flag, db = getGreennPool())` e `setGlobalFlag(flag, enabled, db = getGreennPool())`, usando `db.query(...)` direto (serve para pool e para conexao; trocar o par `getConnection()/release()` - nao ha transacao, a semantica nao muda). SQL identico ao atual (SELECT guard idempotente, `INSERT INTO global_flags (flag, created_at, updated_at) VALUES (?, NOW(), NOW())`, `DELETE FROM global_flags WHERE flag = ?`) (R3). `setGlobalFlag` retorna `getGlobalFlag(flag, db)`. Chamadas da Konduto continuam sem o 3o argumento.
- `src/services/global-settings.service.js`: extrair o bloco de cache de `setGlobalSetting` para `export async function forgetBackCache(key)` -> `{ cacheCleared, cacheError }` (mesmo corpo: `isDockerAvailable()`, `execInContainer(GREENN_BACK_CONTAINER, ['php','artisan','cache:forget', key])`, try/catch, 'socket do Docker indisponivel' com acento como hoje); `setGlobalSetting` passa a usar `{ ...(await getGlobalSetting(key)), ...(await forgetBackCache(key)) }` - comportamento igual.

`src/services/flags-panel.service.js`: `toggleFlag(input, flag, enabled)`: `isValidFlag` senao 400; `typeof enabled !== 'boolean'` -> 400 "'enabled' precisa ser booleano"; `withDb(input, conn => setGlobalFlag(flag, enabled, conn))`; depois (fora do withDb) `forgetBackCache('feature_flag_' + flag)` - chave de `GlobalFlag::cachedCheck` (D-02); retorna `{ ...estado, cacheCleared, cacheError }`. Falha no cache nunca vira erro HTTP (D-02 nao-fatal). argv em array, sem shell; nome ja validado. user_flags NAO limpam cache (RESEARCH s2).

`src/routes/flags-panel.routes.js`: `PUT /flags-panel/flag` -> `toggleFlag(req.body?.path, req.body?.flag, req.body?.enabled)`.

`public/flags.js`: delegacao de `change` em `#flagList` para `input[data-flag]`: desabilitar o input durante a chamada (padrao `setBusy` de `public/konduto.js:112-130`), `PUT /api/flags-panel/flag` com `{ path, flag, enabled: input.checked }`; sucesso -> atualizar `enabled` em `state.flags` e o contador do status; se `cacheError`, mostrar em `div.flag-warning#flagWarning` (ambar): "Flag gravada, mas o cache nao foi limpo: <cacheError>" (D-02); erro -> reverter `input.checked`, mostrar em `#flagError`. Filtro (D-06): `input[type=search]#flagFilter` "Filtrar flags..." acima da lista, `render()` filtra `state.flags` por `flag.toLowerCase().includes(termo)` e mostra "Nenhuma flag encontrada" (`.empty`) quando vazio. `public/flags.html`: adicionar `#flagFilter`, `#flagWarning` e o CSS `.flag-warning` (fundo `#fffbeb`, cor `#92400e`, borda `#fde68a`, como `.st-pending`).

Nav (D-06): nos 15 HTMLs com sidebar (todos em `public/*.html` exceto `device.html` e `flags.html`), inserir uma linha `<a class="sidebar-link" href="/flags.html">Flags</a>` logo apos a linha que contem `href="/whs-forward.html">Webhook Forward</a>` (casa tanto `sidebar-link` quanto `sidebar-link active` em `whs-forward.html`), mesma indentacao - um `sed -i -E` com captura do espaco inicial resolve. Nao mexer em `?v=` de scripts.

`docker-compose.yml` (D-01): em `services.inbox_messages.volumes`, adicionar `- ${GREENN_BACK_PATH:-../greenn-back}:/greenn-back:ro` com comentario pt-BR ("greenn-back somente leitura para a aba Flags: .env.dev e GlobalFlagSeeder"). Nao recriar o container (o usuario sobe quando quiser).

Teste: adicionar o caso e2e de toggle de `<behavior>` em `tests/flags-panel.test.js` (flag `zz-flags-panel-smoke`, `try/finally` desligando).
  </action>
  <verify>
    <automated>node --test tests/flags-panel.test.js && FLAGS_PANEL_E2E=../greenn-back node --test tests/flags-panel.test.js && docker compose -f docker-compose.yml config --quiet && test "$(grep -l 'href="/flags.html"' public/*.html | wc -l)" -eq 16 && grep -q '/greenn-back:ro' docker-compose.yml</automated>
  </verify>
  <done>Switch liga/desliga a flag no banco de dev, o cache `feature_flag_<FLAG>` e esquecido no `greenn-back-php` (ou aparece aviso ambar se falhar), filtro funciona, as 16 paginas (15 + flags.html) tem o link Flags, compose valida com o mount `:ro`, e a aba Konduto segue chamando `setGlobalFlag`/`getGlobalFlag` sem mudanca de assinatura obrigatoria.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: user_flags por flag - listar, adicionar por ID/e-mail, remover</name>
  <files>src/services/flags-panel.service.js, src/routes/flags-panel.routes.js, tests/flags-panel.test.js, public/flags.html, public/flags.js</files>
  <behavior>
    - e2e (com `FLAGS_PANEL_E2E`): pegar um usuario real via `withDb(E2E, c => c.query('SELECT id, email FROM users WHERE email IS NOT NULL ORDER BY id LIMIT 1'))` (sem usuario -> skip). `POST /api/flags-panel/user-flags` `{ path, flag: 'zz-flags-panel-smoke', user: <email> }` -> 200, `alreadyExisted:false`, `user_id` = id; repetir com `user: String(id)` -> 200 `alreadyExisted:true`; `GET /api/flags-panel/user-flags?path&flag` contem a linha com o e-mail; `DELETE /api/flags-panel/user-flags` `{ path, id }` -> 200; GET seguinte vazio para esse usuario. Limpeza no `finally` via `withDb` (`DELETE FROM user_flags WHERE flag = ?`).
    - POST com `user: 'nao-existe@example.invalid'` -> 404; com `user: 'abc'` -> 400; DELETE com `id: 'x'` -> 400.
  </behavior>
  <action>
`src/services/flags-panel.service.js` (R4), tudo parametrizado, via `withDb`:
- `listUserFlags(input, flag)`: `isValidFlag` senao 400; `SELECT uf.id, uf.user_id, u.email, uf.created_at FROM user_flags uf LEFT JOIN users u ON u.id = uf.user_id WHERE uf.flag = ? ORDER BY uf.id DESC` -> `{ flag, items }`.
- `addUserFlag(input, flag, user)`: `isValidFlag` senao 400; `ref = String(user ?? '').trim()`; `/^\d+$/` -> `SELECT id, email FROM users WHERE id = ? LIMIT 1`; contem `@` -> `... WHERE email = ? LIMIT 1`; senao 400 "Informe o ID numerico ou o e-mail do usuario" (com acentos). Sem usuario -> 404 "Usuario nao encontrado". `user_flags` nao tem unique (RESEARCH s4): `SELECT id FROM user_flags WHERE user_id = ? AND flag = ? LIMIT 1`; existe -> `{ id, user_id, email, flag, alreadyExisted: true }`; senao `INSERT INTO user_flags (user_id, flag, created_at, updated_at) VALUES (?, ?, NOW(), NOW())` -> `{ id: insertId, user_id, email, flag, alreadyExisted: false }`. Sem cache:forget (FlagHelper::exists nao cacheia user_flags).
- `removeUserFlag(input, id)`: `/^\d+$/` em `String(id)` senao 400; `DELETE FROM user_flags WHERE id = ?`; `affectedRows === 0` -> 404 "Registro de user_flags nao encontrado"; senao `{ removed: true, id }`.

`src/routes/flags-panel.routes.js`: `GET /flags-panel/user-flags` (`req.query.path`, `req.query.flag`), `POST /flags-panel/user-flags` (`body.path, body.flag, body.user`), `DELETE /flags-panel/user-flags` (`body.path, body.id`), todos via `send`.

`public/flags.html` + `public/flags.js`: cada `.flag-row` ganha `button type="button"` "Usuarios" (`data-users`) que define `state.selectedFlag` e carrega `GET /api/flags-panel/user-flags`. Novo `.panel#userFlagsPanel` (oculto ate escolher uma flag) com `.panel-header` "Usuarios com a flag <nome>" (via `textContent`), lista de linhas `#id - user_id - e-mail (ou "sem e-mail") - created_at` com `button.danger type="button"` "Remover" (pede `confirm()` antes do DELETE), e `<form>` com `input#userRef` ("ID ou e-mail do usuario") + `button type="submit"` "Adicionar". Sucesso -> recarregar a lista; `alreadyExisted` -> `.status-line` "Usuario ja tinha essa flag"; erro -> `#flagError`. Tudo com `textContent`/`createElement`; textos em pt-BR com acentos (D-06). Trocar o `?v=1` de `/flags.js` nao e necessario (pagina nova no mesmo PR).

Teste: adicionar os casos de `<behavior>` em `tests/flags-panel.test.js`.
  </action>
  <verify>
    <automated>node --test tests/flags-panel.test.js && FLAGS_PANEL_E2E=../greenn-back node --test tests/flags-panel.test.js</automated>
  </verify>
  <done>Na aba Flags, "Usuarios" de uma flag lista os user_flags com e-mail, "Adicionar" aceita ID ou e-mail (404 para usuario inexistente, sem duplicar se ja tiver), "Remover" apaga a linha apos confirmacao; e2e completo passa e deixa o banco de dev como estava.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser -> /api/flags-panel/* | path do greenn-back, nome de flag, ID/e-mail e id de user_flags chegam do cliente sem autenticacao (ferramenta local, mesma exposicao das demais abas, ex. Konduto) |
| servidor -> filesystem | path digitado decide de onde ler o .env (com senha do banco) e o seeder |
| servidor -> MySQL de dev | credenciais do .env lido; escrita em global_flags/user_flags |
| servidor -> docker socket | `php artisan cache:forget` dentro do `greenn-back-php` |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-261015-jlz-01 | Tampering | flags-panel.service SQL | high | mitigate | Somente queries com `?` (mysql2); `isValidFlag` `^[A-Za-z0-9_.\-]{1,50}$`; user ID `^\d+$` ou e-mail com `@`; id de user_flags `^\d+$` (Tasks 1-3, testado em tests/flags-panel.test.js) |
| T-261015-jlz-02 | Elevation of Privilege | resolveDbConfig | high | mitigate | Guard D-05 antes de conectar: recusa APP_ENV production/prod e DB_HOST fora de greenn-back-mysql/localhost/127.0.0.1 (teste unitario) |
| T-261015-jlz-03 | Information Disclosure | listFlags / rotas | high | mitigate | Resposta expoe so `db: { host, port, database }`; `cfg` nunca logado nem devolvido; localStorage guarda so o path; e2e checa as chaves de `db` |
| T-261015-jlz-04 | Information Disclosure | locateProject | medium | mitigate | `path.resolve` + leitura apenas de nomes fixos (`.env.dev`, `../.env.dev`, `.env`, `GlobalFlagSeeder.php`); conteudo do .env nunca volta ao cliente, so e usado para conectar |
| T-261015-jlz-05 | Tampering | cache:forget via docker | medium | mitigate | `execInContainer` com argv em array (sem shell) e flag ja validada por `isValidFlag`; falha vira aviso, nao erro |
| T-261015-jlz-06 | Tampering | public/flags.js (XSS) | medium | mitigate | Nomes de flag, e-mails e mensagens renderizados com `textContent`/`createElement`, nunca `innerHTML` com dado do banco/seeder |
| T-261015-jlz-07 | Denial of Service | withDb | low | mitigate | `connectTimeout: 5000` e `conn.end()` em `finally` (conexao por requisicao, sem pool vazando) |
| T-261015-jlz-08 | Spoofing | /api/flags-panel/* sem auth, CORS `ALLOWED_ORIGIN=*` | low | accept | Ferramenta de dev local; mesmo modelo das abas existentes (Konduto escreve em global_flags igual); guard D-05 limita o alvo ao banco local |
| T-261015-jlz-SC | Tampering | npm installs | low | accept | Nenhum pacote novo; `npm ci` (se `node_modules/` faltar) instala apenas o que ja esta no package-lock |
</threat_model>

<verification>
- `node --test tests/flags-panel.test.js` verde sem MySQL (e2e em skip).
- `FLAGS_PANEL_E2E=../greenn-back node --test tests/flags-panel.test.js` verde com o ambiente local (MySQL 3301, greenn-back-php up) e banco de dev igual ao de antes (flag/usuario de smoke removidos).
- `docker compose -f docker-compose.yml config --quiet` ok; `grep -l 'href="/flags.html"' public/*.html | wc -l` = 16.
- Checagem manual opcional: `PORT=8199 npm run dev` (8115 ja e o container) e abrir `http://localhost:8199/flags.html` com `../greenn-back`.
</verification>

<success_criteria>
- Aba Flags lista as flags do GlobalFlagSeeder do path digitado com switch refletindo global_flags, badge "fora do seeder" para as extras e filtro.
- Toggle grava INSERT/DELETE parametrizado e esquece `feature_flag_<FLAG>`; falha de cache vira aviso.
- user_flags: listar/adicionar (ID ou e-mail)/remover por flag.
- Guard D-05 bloqueia .env de producao/host remoto; senha nunca sai na API.
- Konduto e global settings continuam funcionando com os services refatorados.
</success_criteria>

<output>
Create `.planning/quick/261015-jlz-feat-pannel-flags-painel-de-flags-do-gre/261015-jlz-SUMMARY.md` when done
</output>
