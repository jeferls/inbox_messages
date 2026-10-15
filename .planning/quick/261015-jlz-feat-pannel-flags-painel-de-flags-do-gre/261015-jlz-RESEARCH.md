# Quick 261015-jlz - Research (integracao no codebase)

**Researched:** 2026-10-15 | **Escopo:** so integracao; sem survey de dominio. Tudo abaixo e `[VERIFIED: leitura do arquivo nesta sessao]` salvo nota `[ASSUMED]`.
Sem pacotes novos (mysql2 + express ja existem; parser de .env inline). Package Legitimacy Audit: n/a.

## Constraints (CONTEXT.md D1-D6 vigentes; ver o arquivo CONTEXT). CLAUDE.md: responder em pt-BR; UI em pt-BR.

## 1. Rotas / controllers / services (padrao a copiar)

- Registro: `src/app.js:94-110` -> `app.use('/api', xRoutes)`; import no topo `src/app.js:8-31`. Novo: `import flagsPanelRoutes from './routes/flags-panel.routes.js'` + `app.use('/api', flagsPanelRoutes);` junto de `src/app.js:110`.
- Rota: `src/routes/konduto.routes.js:9-16` (Router + `router.get('/konduto/flag', handler)`), handler em controller `src/controllers/konduto.controller.js:12-32` (valida body -> 400; try/catch -> `res.status(502).json({ error: \`Falha ...: ${error.message}\` })`). Mensagens de erro em pt-BR.
- **Ja existe** `src/services/global-flags.service.js` (`getGlobalFlag/setGlobalFlag`, SQL parametrizado, so Konduto usa) e `src/services/greenn-db.js:10-19` (`getGreennPool()` = pool unico com `GREENN_DB` de `src/config/env.js:37-43`: `GREENN_DB_HOST` default `greenn-back-mysql`, `GREENN_DB_PORT` 3306, user `admin`/`secret`, db `greenn`).
- **Nao reutilizar `getGreennPool()` no painel**: a conexao do painel vem do .env digitado pelo usuario (dinamica). Usar `mysql.createConnection({host,port,user,password,database})` (`import mysql from 'mysql2/promise'`) por requisicao, `try/finally conn.end()`. Mesmas queries do padrao: `INSERT INTO global_flags (flag, created_at, updated_at) VALUES (?, NOW(), NOW())` e `DELETE FROM global_flags WHERE flag = ?` (`global-flags.service.js:44,49`); guard idempotente `SELECT id ... LIMIT 1` antes do INSERT (`:41-47`).
- `global-flags.service.js` NAO limpa cache (ok p/ Konduto; so `GlobalFlag::cachedCheck` cacheia). Nao mexer; o painel limpa cache sozinho.
- Sugestao de arquivos: `src/services/flags-panel.service.js` (parsers puros exportados + DB), `src/controllers/flags-panel.controller.js`, `src/routes/flags-panel.routes.js`.

## 2. Docker / cache

- Padrao exato (copiar): `src/services/global-settings.service.js:25-37`:
  ```js
  if (isDockerAvailable()) { const out = await execInContainer(GREENN_BACK_CONTAINER, ['php','artisan','cache:forget', key]);
    cacheCleared = out.exitCode === 0; if (!cacheCleared) cacheError = out.stderr || out.stdout; } else cacheError = 'socket do Docker indisponível';
  ```
  Imports: `execInContainer, isDockerAvailable` de `./docker.service.js` (`docker.service.js:53,75`), `GREENN_BACK_CONTAINER` de `src/config/env.js:56` (default `greenn-back-php`, env override). `execInContainer` lanca erro se container nao existe/parado (`docker.service.js:54-56`) -> capturar e devolver como `warning` (D2 nao-fatal). Cmd e array (sem shell) -> sem injecao, mas ainda validar o nome da flag.
- Chave real: `src/app/GlobalFlag.php` (greenn-back) `Cache::remember('feature_flag_'.$flag, now()->addHour(), ...)`. Logo `cache:forget feature_flag_<FLAG>`. `artisan cache:forget` usa o store default + prefixo do app (`src/config/cache.php:21` `'default' => env('CACHE_DRIVER','file')`, `:114` prefix `env('CACHE_PREFIX', Str::slug(APP_NAME)...)`), mesma config que `Cache::remember` usa dentro do mesmo container -> acerta a chave. `.env.dev.template`: `CACHE_DRIVER=file` (cache fica no storage do `greenn-back-php`, entao precisa ser nesse container). Valor real do .env.dev nao lido (guard de segredos).
- `FlagHelper::exists` (`src/app/Helpers/FlagHelper.php`) NAO cacheia: consulta `GlobalFlag`/`UserFlag` direto. `UserFlag` tem `UserScope` global (so no Eloquent; SQL direto ignora). **Conclusao: user_flags nao precisam de cache:forget; so global.** Unico consumidor de `cachedCheck` encontrado: `PasswordRecoveryController` (flag `captcha`) - o forget e inofensivo para as demais.
- Rodando no host (`npm run dev`): `isDockerAvailable()` = `fs.existsSync('/var/run/docker.sock')` (`:75-77`), normalmente true no host tambem.

## 3. Paginas publicas

- **Nav duplicada** em 15 HTMLs (todos exceto `device.html`): bloco `.sidebar-nav` com `<a class="sidebar-link" href="/x.html">`; ultimo link e `<a class="sidebar-link" href="/whs-forward.html">Webhook Forward</a>` (ex. `public/lotes.html:27`, `claims.html:61`). Nao ha arquivo de nav compartilhado: adicionar `<a class="sidebar-link" href="/flags.html">Flags</a>` apos essa linha em **todos os 15** (`sed`/loop; whs-forward.html incluido) e na nova pagina com `active`.
- Esqueleto de pagina: `public/lotes.html:1-69` (`.app-shell > nav.sidebar + .app-content > .page-shell > .page-header(h1 + .page-actions) + .panel`), scripts no fim: `<script src="/x.js?v=1"></script><script src="/tab-badge.js?v=1"></script>`. Cada pagina tem `<style>` inline (linha 8) alem de `/styles.css`.
- `styles.css` global: `.page-shell/.page-header/.page-actions/.panel/.panel-header/.empty/.status-line/button/button.danger/input[type=search]` (`styles.css:40-47,53,102-118`). **Switch NAO esta no styles.css**: esta inline em `public/konduto.html:50-57` (`.switch`, `.slider`) + `.flag-status`/`.flag-meta`/`.flag-error` (`:46-48,59-60`) + `.badge` (`:94`, variantes `.st-approved` verde / `.st-pending` ambar). Copiar para `<style>` de flags.html (ou promover a styles.css; copiar e mais barato). Markup do switch: `public/konduto.html:208-211` (`label.switch > input[type=checkbox] + span.slider`).
- Markup/JS do toggle de referencia: `public/konduto.js:112-130` (fetch PUT -> `applyState`, `setBusy` desabilita o input). localStorage: `qrcode.js:27,71` (`localStorage.getItem/setItem(LS_KEY)`).
- Nao existe tabela estilizada global: usar lista de linhas flex dentro de `.panel` (como `.lote-item` `styles.css:108-111`) ou `<table>` com CSS inline.

## 4. .env / seeder

- **Sem dotenv** nas deps (`package.json`: express, mysql2, qrcode, sqlite3). Parser inline (~8 linhas): ignorar `#`/vazias, `^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$`, tirar aspas simples/duplas e comentario inline so se fora de aspas. Exportar `parseEnv(text)` puro.
- greenn-back layout: o env de dev e `greenn-back/.env.dev` na **raiz do repo** (nao em `src/`), injetado como `env_file` nos containers (`docker-compose.dev.yml:13,63`); Laravel app em `greenn-back/src/` (`./src:/var/www`, `:15`). Chaves relevantes (so nomes, via `.env.dev.template:28-41,66`): `APP_ENV` (template `local`), `DB_CONNECTION`, `DB_HOST` (template `greenn-back-mysql`), `DB_PORT` (template `3306`), `DB_DATABASE` (`greenn`), `DB_USERNAME`, `DB_PASSWORD`, `CACHE_DRIVER` (`file`). NUNCA logar/retornar `DB_PASSWORD` na API/UI.
- Ordem de busca recomendada para o path digitado `P` (resolvido por D1): env = `P/.env.dev`, `P/../.env.dev`, `P/.env` ; seeder = `P/src/database/seeders/GlobalFlagSeeder.php` ou `P/database/seeders/GlobalFlagSeeder.php` (cobre path na raiz do repo e path direto na raiz Laravel). `[ASSUMED]` que existe `src/.env` alternativo; guard de segredos impediu checar - tratar so como fallback e erro claro se nada achado.
- Seeder: `src/database/seeders/GlobalFlagSeeder.php` tem `$flags = [` ... `];` (linhas ~31-111; 114 linhas total) e depois `foreach ($flags as $flagName)`. Itens sao strings entre aspas simples, uma por linha, **mistura de MAIUSCULAS e minusculas, pontos, `-` e `_`** (ex.: `'3DS'`, `'feature.client_search.use_opensearch'`, `'show-button-redirect-club'`, `'bank_account_remove'`). Regex: pegar o bloco com `/\$flags\s*=\s*\[([\s\S]*?)\]\s*;/`, depois `/'((?:[^'\\]|\\.)*)'/g` por item (remover linhas `//` antes). Dedup preservando ordem. Validar nome `^[A-Za-z0-9_.\-]{1,50}$` (`flag` e varchar(50); maior no seeder tem exatamente 50 chars). `user_flags`: `id, user_id unsignedBigInteger FK users.id, flag varchar(50), timestamps` (`src/database/migrations/2023_09_15_122055_create_user_flags_table.php:17-22`). Sem unique -> checar duplicata antes do INSERT. Email -> `SELECT id FROM users WHERE email = ? LIMIT 1`.

## 5. Testes

- `npm test` = `node --test` (`package.json`), arquivos `tests/*.test.js` (ESM): `import test from 'node:test'; import assert from 'node:assert/strict';` (`tests/wa-mock.test.js:1-2`). Os existentes sobem o app inteiro (`await import('../src/app.js')`, `app.listen(0)`, `DB_PATH` temporario - `:7-12`).
- Para parsers puros: NAO importar `app.js` (dispara `dbInit` SQLite). Importar so o service: `import { parseSeederFlags, parseEnv, resolveDbConfig } from '../src/services/flags-panel.service.js'` (import de `config/env.js` e inofensivo; pool/conexao so em runtime). Criar `tests/flags-panel.test.js` com `test('...', () => { assert.deepEqual(...) })`. Casos: seeder com mistura maiuscula/minuscula/ponto/hifen, comentario `//`, dedup, aspas simples; env com aspas, `#`, `export`, valor com `=`; `resolveDbConfig` (host `greenn-back-mysql` fora do container -> `127.0.0.1:3301`; `APP_ENV=production` -> erro; host remoto -> erro). Manter parsers/guards como funcoes puras com `inContainer` injetado (nao ler `/.dockerenv` dentro da funcao) para teste determinista.

## 6. Pitfalls

- **Compose** `inbox_messages/docker-compose.yml:8-24`: servico `inbox_messages` tem `volumes` com `inbox_data:/data` e o docker.sock; adicionar `- ${GREENN_BACK_PATH:-../greenn-back}:/greenn-back:ro`. `../greenn-back` e relativo ao compose = `greenn-local/greenn-back` (irmao de `inbox_messages`). O container roda `NODE_ENV=production`, root, imagem alpine; mount `:ro` expoe `.env.dev` ao container (aceitavel p/ dev; so lemos).
- Path host vs container: path digitado `/home/<user>/.../greenn-back` nao existe no container -> `fs.existsSync` falso -> fallback `/greenn-back` (D1). Normalizar com `path.resolve`, nunca concatenar `..` vindo do cliente sem resolver; ler apenas os 2 arquivos conhecidos (nada de path livre = sem leitura arbitraria).
- Host MySQL: `.env.dev` traz `DB_HOST=greenn-back-mysql` + `DB_PORT=3306` (portas internas). Fora do container o host nao resolve -> usar `127.0.0.1:3301` (porta mapeada, `greenn-local/CLAUDE.md`). Detectar "dentro do container" com `fs.existsSync('/.dockerenv')` (ou `process.env.NODE_ENV==='production'`/DNS lookup falhando); no container manter `greenn-back-mysql:3306`. Se `DB_HOST` for `localhost/127.0.0.1` usar como esta; em ambos os casos a porta do .env so vale se host nao for o do container.
- D5 guard: recusar se `APP_ENV` in (`production`, `prod`) ou host nao for `greenn-back-mysql|localhost|127.0.0.1` - rodar antes de qualquer conexao e antes de devolver dados.
- Env var nomes `GREENN_DB_*` ja existem e NAO devem ser reaproveitados para o painel (caminho dinamico via .env). Nao persistir senha em localStorage/resposta; so o path vai para localStorage.
- `getGlobalFlag` retorna linhas duplicadas; DELETE por `flag` remove todas (ok). Uma flag no banco e fora do seeder: listar via `SELECT DISTINCT flag FROM global_flags` e marcar "fora do seeder" (D3).
- Nao ha trailing-slash/ordem fixa de rotas: `app.use('/api', ...)` -- usar prefixo `/flags-panel/...` para nao colidir com `/konduto/flag`.
- Ao adicionar o link na nav, lembrar do 15o arquivo (`whs-forward.html`) e bump de `?v=` nao e necessario (pagina nova).

## Validation

| Comportamento | Teste | Comando |
|---|---|---|
| parse seeder / parse env / resolveDbConfig+guard D5 | unit `tests/flags-panel.test.js` (novo, Wave 0) | `node --test tests/flags-panel.test.js` |
| toggle/INSERT/DELETE/cache:forget | manual (precisa MySQL+Docker locais) | UI `http://localhost:8115/flags.html` |

## Assumptions

| # | Claim | Risco |
|---|---|---|
| A1 | Pode existir `greenn-back/src/.env` alternativo ao `.env.dev` (guard impediu verificar) | baixo: fallback na ordem de busca |
| A2 | `/.dockerenv` existe no container alpine do inbox_messages | baixo: Docker cria sempre; teste injeta flag |
| A3 | `CACHE_DRIVER` real do .env.dev = `file` como no template | baixo: `cache:forget` funciona com qualquer driver no mesmo container |
