// Scenarios of the PR2 regression plan (plano-testes-pr2-regressao.md). Each one creates its own
// sellers, fires the real trigger (Eloquent event, controller or queue message) and checks the
// effect: user_checks, the queue each message went to and the IdWall traffic seen by the mock.
//
// PHP snippets run inside `php artisan tinker` and must `return` an array.

import { getReportData, seedBiometry, updateSettings } from './idwall-mock.service.js';

const finished = (check) => check?.status === 'completed' && check?.result === 'FINISHED';

// The branch kept the split of the old queues: enrichment triggers on one, verification on the other.
const LEGACY_QUEUE = { _identity_enrichment: '_idwall_enrichment', _identity_verification: '_event_idwall' };

/** The call and queue a trigger publishes to: StartIdentityFlow on the branch, IdWallHelper::startFlow on production. */
function routing(t, queue) {
  return t.mode === 'legacy'
    ? { call: 'IdWallHelper::startFlow', queue: LEGACY_QUEUE[queue] ?? queue }
    : { call: 'StartIdentityFlow::handle', queue };
}

/** Checks that a flow was published to the expected queue (per routing mode). */
async function expectPublished(t, userId, flow, queue) {
  const expected = routing(t, queue);
  const found = (await t.publishes(userId)).filter((p) => p.call === expected.call && p.flow === flow);
  const queues = [...new Set(found.map((p) => p.queue))].join(', ') || 'nenhuma publicação';
  t.check(`${expected.call.split('::')[0]}(${flow}) publicado em ${expected.queue}`, found.length > 0 && found.every((p) => p.queue === expected.queue), expected.queue, queues);
  return found;
}

/** Checks that the mock received the flow and answered both webhooks with 2xx from greenn-back. */
function expectIdwallRoundTrip(t, userId, flow) {
  const events = t.mockEvents(userId);
  const started = events.find((e) => e.summary.startsWith(`POST flow ${flow} · user ${userId}`) && !e.summary.includes('E00'));
  t.check(`Mock recebeu POST flow ${flow}`, Boolean(started), 'chamada ao flow', started ? started.summary : 'nenhuma chamada');
  const hooks = events.filter((e) => e.kind === 'webhook' && e.summary.includes(`user ${userId} · ${flow}`));
  const ok = hooks.length > 0 && hooks.every((h) => h.response?.ok);
  t.check(`Webhooks de ${flow} aceitos pelo greenn-back`, ok, 'HTTP 200', hooks.map((h) => `${h.summary.split(' · ')[0]} → ${h.response?.status}`).join('; ') || 'nenhum');
}

async function expectCheck(t, userId, flow, result, status) {
  const check = await t.checkFor(userId, flow);
  t.check(`user_checks.${flow} = ${status}/${result}, provider NULL`,
    check?.result === result && check?.status === status && check?.provider === null,
    `${status}/${result}/provider NULL`, check ? `${check.status}/${check.result}/provider ${check.provider}` : 'sem linha');
  return check;
}

const waitResult = (t, userId, flow, results = ['FINISHED'], timeout = 90000) =>
  t.waitFor(`Aguardar ${flow} com resultado ${results.join(' ou ')}`, async () => results.includes((await t.checkFor(userId, flow))?.result), timeout);

// Local databases differ: bank account and achievement ids are looked up, never hardcoded.
const BANK_ACCOUNT = String.raw`(\DB::table('users_has_bank_accounts')->value('id') ?? throw new \RuntimeException('nenhuma conta em users_has_bank_accounts para o saque'))`;
const achievement = (label) => String.raw`\App\Achievements::where('label', '${label}')->orderBy('id')->value('id')`;

const productFor = (id) => String.raw`\App\Product::factory()->create(['seller_id' => ${id}]); return ['ok' => true];`;

export const SCENARIOS = [
  {
    id: 'R-01',
    title: 'Primeiro produto: basic → first_product + enriquecimento PF',
    covers: ['A-08', 'A-17', 'A-36', 'A-29d', 'A-23'],
    priority: 'P0',
    description: 'ProductObserver publica basic em _identity_enrichment; basic FINISHED encadeia first_product e enrichProfile; dados enriquecidos gravados iguais ao mock.',
    async run(t) {
      const id = await t.seller('R-01 primeiro produto');
      await t.step('Gatilho: criar o primeiro produto', () => t.php(productFor(id)));
      await waitResult(t, id, 'basic');
      await waitResult(t, id, 'first_product');
      await expectPublished(t, id, 'basic', '_identity_enrichment');
      // The profile is created on sign-up (IdWallHelper::create on _event_idwall) or, when that queue has
      // no consumer, by startFlow after a GET 404: either way it must exist before the flow starts.
      const events = t.mockEvents(id);
      const created = events.findIndex((e) => e.summary === `POST profile · user ${id}`);
      const flowStart = events.findIndex((e) => e.summary.startsWith(`POST flow basic · user ${id}`));
      t.check('Perfil criado antes do flow (A-36)', created !== -1 && created < flowStart,
        'POST profile antes do POST flow', events.slice(0, 4).map((e) => e.summary).join('; '));
      expectIdwallRoundTrip(t, id, 'basic');
      await expectCheck(t, id, 'basic', 'FINISHED', 'completed');
      await expectPublished(t, id, 'first_product', '_identity_verification');
      const enrich = (await t.publishes(id)).filter((p) => p.call === 'IdWallHelper::enrichProfile');
      t.check('enrichProfile publicado em _idwall_enrichment', enrich.length === 1 && enrich[0].queue === '_idwall_enrichment', '_idwall_enrichment', enrich.map((p) => p.queue).join(', ') || 'nenhum');
      expectIdwallRoundTrip(t, id, 'first_product');

      await t.waitFor('Aguardar o enriquecimento gravar o endereço', async () => (await t.sql('SELECT address_id FROM users WHERE id = ?', [id]))[0]?.address_id, 30000);
      const source = t.mockEvents(id).find((e) => e.summary.startsWith('GET profile-enrichment'))?.response?.body?.data?.profileSourcesData?.[0]?.sourceData;
      const [user] = await t.sql('SELECT u.name, a.zip_code, a.street, a.number, a.city, a.state FROM users u JOIN addresses a ON a.id = u.address_id WHERE u.id = ?', [id]);
      const settings = Object.fromEntries((await t.sql("SELECT `key`, value FROM users_settings WHERE user_id = ? AND `key` IN ('MOTHER_NAME','BIRTH_DATE','IS_POLITICALLY_EXPOSED_PERSON')", [id])).map((r) => [r.key, r.value]));
      const address = source?.contacts?.addresses?.[0] ?? {};
      const [d, m, y] = String(source?.personal?.birthDate ?? '').split('/');
      t.check('Endereço igual ao do mock', user?.zip_code === address.zipCode && user?.street === address.street && String(user?.number) === address.detail && user?.city === address.city && user?.state === address.state,
        `${address.zipCode} ${address.street}, ${address.detail} - ${address.city}/${address.state}`, `${user?.zip_code} ${user?.street}, ${user?.number} - ${user?.city}/${user?.state}`);
      t.check('Nome da mãe igual ao do mock', settings.MOTHER_NAME === source?.affiliations?.[0]?.name, source?.affiliations?.[0]?.name, settings.MOTHER_NAME);
      t.check('Nascimento convertido de d/m/Y', settings.BIRTH_DATE === `${y}-${m}-${d}`, `${y}-${m}-${d}`, settings.BIRTH_DATE);
      t.check('PEP gravado como 0', settings.IS_POLITICALLY_EXPOSED_PERSON === '0', '0', settings.IS_POLITICALLY_EXPOSED_PERSON);
    },
  },
  {
    id: 'R-02',
    title: 'Co-produção do primeiro produto',
    covers: ['A-09'],
    priority: 'P0',
    description: 'CoSellerObserver publica basic em _identity_enrichment.',
    async run(t) {
      const owner = await t.seller('R-02 dono do produto', { flag: false });
      const id = await t.seller('R-02 coprodutor');
      await t.step('Gatilho: virar co-produtor', () => t.php(String.raw`
        $p = \App\Product::factory()->create(['seller_id' => ${owner}]);
        \App\CoSeller::create(['product_id' => $p->id, 'user_id' => ${id}, 'percentage' => 10]);
        return ['product' => $p->id];`));
      await waitResult(t, id, 'basic');
      await expectPublished(t, id, 'basic', '_identity_enrichment');
      expectIdwallRoundTrip(t, id, 'basic');
      await waitResult(t, id, 'first_product');
    },
  },
  {
    id: 'R-03',
    title: 'Afiliação ao primeiro produto',
    covers: ['A-10'],
    priority: 'P0',
    description: 'AffiliateHasProductsObserver publica basic em _identity_enrichment.',
    async run(t) {
      const owner = await t.seller('R-03 dono do produto', { flag: false });
      const id = await t.seller('R-03 afiliado');
      await t.step('Gatilho: virar afiliado', () => t.php(String.raw`
        $p = \App\Product::factory()->create(['seller_id' => ${owner}]);
        \App\AffiliateHasProducts::create(['product_id' => $p->id, 'seller_id' => ${owner}, 'affiliate_id' => ${id}, 'hash' => uniqid('reg')]);
        return ['product' => $p->id];`));
      await waitResult(t, id, 'basic');
      await expectPublished(t, id, 'basic', '_identity_enrichment');
      expectIdwallRoundTrip(t, id, 'basic');
      await waitResult(t, id, 'first_product');
    },
  },
  {
    id: 'R-04',
    title: 'Configuração salva por seller em ativação',
    covers: ['A-07'],
    priority: 'P0',
    description: 'UserSettingsObserver (USER_ACTIVATION, com produto, sem basic) publica basic em _identity_verification.',
    async run(t) {
      const id = await t.seller('R-04 configuracao', {
        php: String.raw`\App\UserFlag::create(['user_id' => $u->id, 'flag' => 'USER_ACTIVATION']); \App\Product::factory()->create(['seller_id' => $u->id]);`,
      });
      await t.step('Gatilho: salvar uma configuração autenticado', () => t.php(String.raw`
        \Illuminate\Support\Facades\Auth::setUser(\App\User::find(${id}));
        \App\UserSettings::create(['user_id' => ${id}, 'key' => 'REGRESSION_NEUTRAL_KEY', 'value' => '1']);
        return ['ok' => true];`));
      await waitResult(t, id, 'basic');
      await expectPublished(t, id, 'basic', '_identity_verification');
      expectIdwallRoundTrip(t, id, 'basic');
      await waitResult(t, id, 'first_product');
    },
  },
  {
    id: 'R-05',
    title: 'Primeiro e segundo saque',
    covers: ['A-01', 'A-02'],
    priority: 'P0',
    description: 'WithdrawObserver publica first_withdraw em _identity_verification só no primeiro saque.',
    async run(t) {
      const id = await t.seller('R-05 saque');
      await t.step('Gatilho: primeiro saque', () => t.php(String.raw`\App\Withdraw::create(['user_id' => ${id}, 'account_id' => ${BANK_ACCOUNT}, 'amount' => 10]); return ['ok' => true];`));
      await waitResult(t, id, 'first_withdraw');
      await expectPublished(t, id, 'first_withdraw', '_identity_verification');
      expectIdwallRoundTrip(t, id, 'first_withdraw');
      await expectCheck(t, id, 'first_withdraw', 'FINISHED', 'completed');
      await t.step('Gatilho: segundo saque', () => t.php(String.raw`\App\Withdraw::create(['user_id' => ${id}, 'account_id' => ${BANK_ACCOUNT}, 'amount' => 20]); return ['ok' => true];`));
      await t.sleep(8000, 'Aguardar 8s por publicações indevidas');
      const found = (await t.publishes(id)).filter((p) => p.flow === 'first_withdraw');
      t.check('Segundo saque não publica first_withdraw de novo (A-02)', found.length === 1, '1 publicação', `${found.length} publicação(ões)`);
    },
  },
  {
    id: 'R-06',
    title: 'Conquistas growth1k, growth10k e conquista maior',
    covers: ['A-03', 'A-05', 'A-06'],
    priority: 'P0',
    description: 'SalesAchievementsObserver publica growth1k/growth10k em _identity_verification; não publica growth1k para quem já tem growth10k.',
    async run(t) {
      const g1 = await t.seller('R-06 growth1k');
      const g10 = await t.seller('R-06 growth10k');
      const bigger = await t.seller('R-06 conquista maior');
      await t.step('Gatilho: conquistas growth1k e growth10k', () => t.php(String.raw`
        \App\SalesAchievements::create(['seller_id' => ${g1}, 'achievement_id' => ${achievement('growth1k')}]);
        \App\SalesAchievements::create(['seller_id' => ${g10}, 'achievement_id' => ${achievement('growth10k')}]);
        \App\SalesAchievements::withoutEvents(fn () => \App\SalesAchievements::create(['seller_id' => ${bigger}, 'achievement_id' => ${achievement('growth10k')}]));
        \App\SalesAchievements::create(['seller_id' => ${bigger}, 'achievement_id' => ${achievement('growth1k')}]);
        return ['ok' => true];`));
      await waitResult(t, g1, 'growth1k');
      await waitResult(t, g10, 'growth10k');
      await expectPublished(t, g1, 'growth1k', '_identity_verification');
      expectIdwallRoundTrip(t, g1, 'growth1k');
      await expectPublished(t, g10, 'growth10k', '_identity_verification');
      expectIdwallRoundTrip(t, g10, 'growth10k');
      const none = (await t.publishes(bigger)).filter((p) => p.call === routing(t, '_identity_verification').call);
      t.check('growth1k não publicado para quem já tem growth10k (A-06)', none.length === 0, 'nenhuma publicação', `${none.length} publicação(ões)`);
    },
  },
  {
    id: 'R-07',
    title: 'Seller sem a flag idwall',
    covers: ['A-14'],
    priority: 'P0',
    description: 'O gatilho publica, mas o legado não chama a IdWall. O placeholder basic criado pelo checkFlow é comportamento de production.',
    async run(t) {
      const id = await t.seller('R-07 sem flag', { flag: false });
      await t.step('Gatilho: criar o primeiro produto', () => t.php(productFor(id)));
      await t.sleep(10000, 'Aguardar 10s');
      await expectPublished(t, id, 'basic', '_identity_enrichment');
      const calls = t.mockEvents(id).filter((e) => e.summary.startsWith('POST flow'));
      t.check('Nenhum fluxo iniciado na IdWall', calls.length === 0, 'nenhum POST flow', `${calls.length} chamada(s)`);
      const basic = await t.checkFor(id, 'basic');
      t.info('Linha basic do seller (placeholder do checkFlow, igual a production)', basic ? `${basic.status}/${basic.result}` : 'sem linha');
    },
  },
  {
    id: 'R-08',
    title: 'basic INVALID desativa o seller',
    covers: ['A-18'],
    priority: 'P0',
    settings: { outcomes: { basic: 'INVALID' } },
    description: 'Resultado INVALID grava completed/INVALID, desativa o seller e não encadeia first_product.',
    async run(t) {
      const id = await t.seller('R-08 basic invalido');
      await t.step('Gatilho: criar o primeiro produto', () => t.php(productFor(id)));
      await waitResult(t, id, 'basic', ['INVALID']);
      expectIdwallRoundTrip(t, id, 'basic');
      await expectCheck(t, id, 'basic', 'INVALID', 'completed');
      const [user] = await t.sql('SELECT is_disabled FROM users WHERE id = ?', [id]);
      t.check('Seller desativado', Number(user?.is_disabled) === 1, 'is_disabled = 1', `is_disabled = ${user?.is_disabled}`);
      await t.sleep(5000, 'Aguardar 5s por encadeamento indevido');
      t.check('first_product não publicado', !(await t.publishes(id)).some((p) => p.flow === 'first_product'), 'sem first_product', 'ver publicações');
    },
  },
  {
    id: 'R-09',
    title: 'basic WAITING_MANUAL_ACTION adiciona a tag',
    covers: ['A-19'],
    priority: 'P1',
    settings: { outcomes: { basic: 'WAITING_MANUAL_ACTION' } },
    description: 'Resultado WAITING_MANUAL_ACTION grava validating e adiciona AWAITING_BASIC_REVIEW, sem desativar.',
    async run(t) {
      const id = await t.seller('R-09 basic manual');
      await t.step('Gatilho: criar o primeiro produto', () => t.php(productFor(id)));
      await waitResult(t, id, 'basic', ['WAITING_MANUAL_ACTION']);
      await expectCheck(t, id, 'basic', 'WAITING_MANUAL_ACTION', 'validating');
      const tags = (await t.sql('SELECT t.name FROM user_tags ut JOIN tags t ON t.id = ut.tag_id WHERE ut.user_id = ?', [id])).map((r) => r.name);
      t.check('Tag AWAITING_BASIC_REVIEW', tags.includes('AWAITING_BASIC_REVIEW'), 'AWAITING_BASIC_REVIEW', tags.join(', ') || 'nenhuma');
      const [user] = await t.sql('SELECT is_disabled FROM users WHERE id = ?', [id]);
      t.check('Seller continua ativo', Number(user?.is_disabled) === 0, 'is_disabled = 0', `is_disabled = ${user?.is_disabled}`);
    },
  },
  {
    id: 'R-10',
    title: 'Cadeia PJ completa e company_growth1k',
    covers: ['A-22', 'A-26', 'A-27', 'A-04'],
    priority: 'P0',
    description: 'first_product → company_registration → company_enrichment → dados da empresa; depois growth1k publica company_growth1k com o company_id.',
    async run(t) {
      const company = await t.step('Criar empresa', () => t.php(String.raw`$c = \App\Company::factory()->create(); return ['id' => $c->id, 'cnpj' => $c->cnpj];`));
      const id = await t.seller('R-10 cadeia pj', { php: String.raw`$u->company_id = ${company.id}; $u->save();` });
      await t.step('Gatilho: criar o primeiro produto', () => t.php(productFor(id)));
      await waitResult(t, id, 'company_registration', ['FINISHED'], 120000);
      await expectPublished(t, id, 'company_registration', '_identity_verification');
      const reports = t.mockEvents(company.cnpj).filter((e) => e.summary.startsWith('POST relatorios'));
      t.check('Relatório company_registration com o CNPJ da empresa', reports.some((e) => e.summary.includes('company_registration')), company.cnpj, reports.map((e) => e.summary).join('; ') || 'nenhum');
      await waitResult(t, id, 'company_enrichment', ['FINISHED'], 120000);
      const enrichment = await t.checkFor(id, 'company_enrichment');
      const hooks = t.mockEvents(enrichment?.external_id).filter((e) => e.kind === 'webhook');
      t.check('webhook-report EM ANALISE e CONCLUIDO aceitos', hooks.length >= 2 && hooks.every((h) => h.response?.ok), '2 webhooks 200', hooks.map((h) => `${h.summary.split(' · ')[0]} → ${h.response?.status}`).join('; '));

      const dados = getReportData(enrichment.external_id).body.result;
      if (await t.hasConsumer('_event_idwall')) {
        await t.waitFor('Aguardar updateCompanyData pelo worker de _event_idwall', async () =>
          (await t.sql('SELECT name FROM companies WHERE id = ?', [company.id]))[0]?.name === dados.cnpj.nome_empresarial, 60000);
      } else {
        await t.step('updateCompanyData (fila _event_idwall sem consumidor: execução direta)', () => t.php(String.raw`
          \App\Helpers\IdWallHelper::updateCompanyData(\App\Company::withoutGlobalScopes()->find(${company.id}), '${enrichment.external_id}');
          return ['ok' => true];`));
      }
      const [row] = await t.sql('SELECT name, fantasy_name, zip_code, city, state FROM companies WHERE id = ?', [company.id]);
      const address = dados.enderecos[0];
      t.check('Empresa atualizada com os dados do relatório', row?.name === dados.cnpj.nome_empresarial && row?.fantasy_name === dados.cnpj.nome_fantasia && row?.zip_code === address.cep && row?.city === address.cidade && row?.state === address.estado,
        `${dados.cnpj.nome_empresarial} / ${address.cep} ${address.cidade}-${address.estado}`, `${row?.name} / ${row?.zip_code} ${row?.city}-${row?.state}`);

      await t.step('Gatilho: conquista growth1k', () => t.php(String.raw`\App\SalesAchievements::create(['seller_id' => ${id}, 'achievement_id' => ${achievement('growth1k')}]); return ['ok' => true];`));
      await waitResult(t, id, 'company_growth1k', ['FINISHED'], 90000);
      await expectPublished(t, id, 'company_growth1k', '_identity_verification');
    },
  },
  {
    id: 'R-11',
    title: 'Biometria pelo SDK da IdWall',
    covers: ['A-24'],
    priority: 'P0',
    description: 'update-profile → extração CNH → flow biometry → FINISHED → first_product em _identity_verification e proposta PF em _celcoin_account.',
    async run(t) {
      const id = await t.seller('R-11 biometria');
      await t.step('Gatilho: enviar o sdk_token (IdWallController@updateProfile)', async () => {
        const result = await t.php(String.raw`
          \Illuminate\Support\Facades\Auth::setUser(\App\User::find(${id}));
          $r = app(\App\Http\Controllers\IdWallController::class)->updateProfile(\Illuminate\Http\Request::create('/api/idwall/update-profile', 'POST', ['sdk_token' => 'sdk-regressao-${id}']));
          return ['response' => json_decode($r->getContent(), true)];`);
        if (!result.response?.success) throw new Error(`resposta ${JSON.stringify(result.response)}`);
        return 'success: true';
      });
      await t.waitFor('Aguardar a extração do documento no mock', () => t.mockState().profiles.find((p) => p.ref === String(id))?.profileExtraction?.status === 'EXTRACTED', 30000);
      if (await t.hasConsumer('_event_idwall')) {
        t.info('startFlow(biometry) segue pelo worker de _event_idwall');
      } else {
        await t.step('startFlow(biometry) (fila _event_idwall sem consumidor: execução direta)', () => t.php(String.raw`return \App\Helpers\IdWallHelper::startFlow(\App\User::find(${id}), 'biometry');`));
      }
      await waitResult(t, id, 'biometry');
      expectIdwallRoundTrip(t, id, 'biometry');
      await expectCheck(t, id, 'biometry', 'FINISHED', 'completed');
      await expectPublished(t, id, 'first_product', '_identity_verification');
      const proposal = (await t.publishes(id)).filter((p) => p.call === 'CelcoinBankAccountFacade::createCelcoinPFProposal');
      t.check('Proposta PF da Celcoin publicada em _celcoin_account', proposal.length === 1 && proposal[0].queue === '_celcoin_account', '_celcoin_account', proposal.map((p) => p.queue).join(', ') || 'nenhuma');
      await waitResult(t, id, 'first_product');
    },
  },
  {
    id: 'R-12',
    title: 'Documentos pela IdWall (Celcoin PF)',
    covers: ['A-30', 'A-32'],
    priority: 'P0',
    description: 'Sem imagens do provedor, os documentos vêm do perfil da IdWall: frente, verso e selfie. Não envia nada à Celcoin.',
    async run(t) {
      const id = await t.seller('R-12 documentos');
      await t.step('Biometria pronta no mock (perfil com documento CNH)', () => { seedBiometry(String(id), 'CNH'); });
      const result = await t.step('Montar os documentos (parseFormatIdwallDocument)', () => t.php(String.raw`
        $provider = class_exists(\Domain\Seller\Actions\GetSellerDocumentImages::class) ? app(\Domain\Seller\Actions\GetSellerDocumentImages::class)->handle(${id}) : null;
        $idWall = \Domain\IdWall\Helpers\IdWallHelper::get(${id});
        $doc = \Domain\BaasBankAccount\Celcoin\Helpers\CelcoinHelper::parseFormatIdwallDocument($idWall, ${id});
        return ['provider' => $provider, 'images' => array_map(fn ($i) => ['name' => $i['name'] ?? null, 'type' => $i['content_type'] ?? null], $doc['images'] ?? []),
          'has' => \Domain\BaasBankAccount\Celcoin\Helpers\CelcoinHelper::userHasIdWallDocuments(${id})];`));
      t.check('Sem imagens do provedor', result.provider === null, 'null', JSON.stringify(result.provider));
      const names = Object.values(result.images ?? {}).map((i) => i.name);
      t.check('Frente, verso e selfie montadas', ['CNH FRONT', 'CNH BACK', 'FACE 1'].every((n) => names.includes(n)), 'CNH FRONT, CNH BACK, FACE 1', names.join(', '));
      const files = t.mockEvents(`${id}-`).filter((e) => e.summary.startsWith('GET files/'));
      t.check('Imagens baixadas do mock da IdWall', files.length >= 3, '3 downloads', `${files.length} download(s)`);
      t.check('userHasIdWallDocuments = true', result.has === true, 'true', String(result.has));
    },
  },
  {
    id: 'R-13',
    title: 'Enriquecimento PF de menor de 18 e sem dados',
    covers: ['A-29e', 'A-29f'],
    priority: 'P1',
    // Without this, the FINISHED webhook of first_product can arrive after enrichProfile and overwrite
    // its INVALID (IdWallController upserts the result): a race present on production too.
    settings: { outcomes: { first_product: 'NONE' } },
    description: 'UNDER_18 e lista vazia gravam first_product como INVALID. O mock não manda resultado final do first_product, para que só o enriquecimento decida (ver a corrida descrita no código).',
    async run(t) {
      for (const mode of ['UNDER_18', 'EMPTY']) {
        updateSettings({ enrichmentMode: mode });
        t.info(`Enriquecimento PF: ${mode}`);
        const id = await t.seller(`R-13 enriquecimento ${mode}`);
        await t.step('Gatilho: criar o primeiro produto', () => t.php(productFor(id)));
        await waitResult(t, id, 'first_product', ['INVALID', 'FINISHED']);
        const check = await t.checkFor(id, 'first_product');
        t.check(`${mode}: first_product INVALID`, check?.result === 'INVALID', 'INVALID', check?.result);
        await t.waitFor('Aguardar a fila de webhooks do mock esvaziar', () => t.mockState().scheduled.length === 0, 60000);
      }
    },
  },
  {
    id: 'R-14',
    title: 'Mesmo fluxo publicado duas vezes',
    covers: ['A-37'],
    priority: 'P1',
    description: 'O segundo pedido recebe E001 e é tratado como sucesso: um só fluxo na IdWall.',
    async run(t) {
      const id = await t.seller('R-14 duplicado');
      await t.step('Publicar o início do basic duas vezes seguidas', () => t.php(String.raw`
        foreach ([1, 2] as $_) {
          ${t.mode === 'legacy'
            ? String.raw`\App\Helpers\Queue::publish('_event_idwall', \App\Helpers\IdWallHelper::class, 'startFlow', \App\User::find(${id}), 'basic');`
            : String.raw`\App\Helpers\Queue::publish('_identity_verification', \Domain\Seller\Actions\StartIdentityFlow::class, 'handle', ['user_id' => ${id}, 'flow' => 'basic']);`}
        }
        return ['ok' => true];`));
      await waitResult(t, id, 'basic');
      const flows = t.mockEvents(id).filter((e) => e.summary.startsWith(`POST flow basic · user ${id}`));
      t.check('Um fluxo iniciado e um E001', flows.filter((e) => !e.summary.includes('E001')).length === 1, '1 início + E001', flows.map((e) => e.summary.replace(/.* user \d+ /, '')).join('; '));
      await expectCheck(t, id, 'basic', 'FINISHED', 'completed');
    },
  },
  {
    id: 'R-15',
    title: 'Mensagem antiga de production na fila _idwall_enrichment',
    covers: ['D-01'],
    priority: 'P0',
    description: 'Mensagem no formato de production (IdWallHelper::startFlow com o User) é consumida pela branch e segue a cadeia.',
    async run(t) {
      const id = await t.seller('R-15 fila antiga');
      await t.step('Publicar no formato antigo (IdWallHelper::startFlow, basic)', () => t.php(String.raw`
        \App\Helpers\Queue::publish('_idwall_enrichment', \App\Helpers\IdWallHelper::class, 'startFlow', \App\User::find(${id}), 'basic');
        return ['ok' => true];`));
      await waitResult(t, id, 'basic');
      expectIdwallRoundTrip(t, id, 'basic');
      await expectPublished(t, id, 'first_product', '_identity_verification');
    },
  },
];

