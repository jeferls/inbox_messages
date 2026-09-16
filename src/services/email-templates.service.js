import { execInContainer } from './docker.service.js';
import { GREENN_BACK_CONTAINER } from '../config/env.js';

// Renders greenn-back's Blade email templates with fake data. The PHP script below runs inside
// the greenn-back-php container (Laravel bootstrapped, locale pt_BR) so the output is exactly
// what the backend would send; nothing in greenn-back is changed and no real records are needed.
const SCRIPT_PATH = '/tmp/inbox-email-templates.php';

const RENDER_SCRIPT = String.raw`<?php
require '/var/www/vendor/autoload.php';
$app = require '/var/www/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
app()->setLocale('pt_BR');

$carbon = \Carbon\Carbon::parse('2026-09-16 14:30:00');
$charge = fn ($seq, $amount) => (object) ['sequence' => $seq, 'amount' => $amount];
$installments = [
    ['status' => 'paid', 'amount' => 97.0, 'current_installments' => 1, 'expected_date' => '2026-09-16'],
    ['status' => 'pending', 'amount' => 97.0, 'current_installments' => 2, 'expected_date' => '2026-10-16'],
];
$slcItem = ['reference' => 'REF-1', 'reason' => 'Conta inválida', 'processed_at' => '16/09/2026', 'item_id' => 1, 'ispb_credor' => '00000000', 'expected_date' => '16/09/2026', 'amount' => '100,00', 'status' => 'failed', 'error_code' => 'E01', 'current_installments' => 1];

$data = [
    'name' => 'Maria Oliveira', 'fullName' => 'Maria Oliveira da Silva', 'userName' => 'Maria Oliveira', 'client_name' => 'Maria Oliveira',
    'seller_name' => 'João Vendedor', 'sellerName' => 'João Vendedor', 'author' => 'João Vendedor', 'attendant' => 'Ana Suporte',
    'email' => 'maria@exemplo.com', 'client_email' => 'maria@exemplo.com', 'seller_email' => 'joao@exemplo.com', 'sellerEmail' => 'joao@exemplo.com', 'recipient' => 'client',
    'client_document' => '123.456.789-00', 'document' => '123.456.789-00', 'masked_document' => '123.***.***-00', 'doc' => '123.456.789-00',
    'client_cellphone' => '(11) 99999-1234', 'client_id' => 1234,
    'product' => 'Curso Completo de Marketing Digital', 'product_name' => 'Curso Completo de Marketing Digital', 'productName' => 'Curso Completo de Marketing Digital', 'product_id' => 4521,
    'offer' => 'Oferta Black Friday', 'offerName' => 'Oferta Black Friday', 'offerGroupName' => 'Grupo Premium',
    'sale_id' => 987654, 'sell_number' => 987654, 'id' => 987654, 'order' => 987654, 'transaction_id' => 'TX-2026-000987654', 'sale_arn' => '74123456789012345678901',
    'refund_id' => 55321, 'claim_id' => 7788, 'antecipation_id' => 3344, 'idTicket' => 'TCK-00123', 'contract_id' => 6677, 'seller_id' => 4455,
    'amount' => '497,00', 'currency_symbol' => 'R$', 'currencySymbol' => 'R$', 'installments' => 12, 'method' => 'CREDIT_CARD', 'method_text' => 'Cartão de crédito',
    'card_last_digits' => '4242', 'period' => 'mês', 'percentage' => '10%', 'shipping_amount' => 25.90, 'shipping_selected' => ['frete' => 'Sedex', 'price' => '25,90'],
    'date' => '16/09/2026', 'datetime' => '16/09/2026 14:30', 'dateTime' => '16/09/2026 14:30', 'sale_date' => '16/09/2026', 'refund_date' => '16/09/2026', 'purchaseDate' => '16/09/2026',
    'subscription_date' => '16/09/2026', 'reference_date' => '16/09/2026', 'keep_access_until' => '16/10/2026', 'address_confirm_date' => '20/09/2026', 'confirmBy' => '20/09/2026',
    'accepted_at' => '16/09/2026 14:30', 'accepted_ip' => '187.10.20.30', 'ip' => '187.10.20.30', 'browser' => 'Chrome 129 / Linux',
    'time' => '14:30', 'hour' => '14', 'minute' => '30', 'days' => 7, 'carbon' => $carbon, 'c' => $carbon,
    'start_date' => '2026-10-01', 'startDate' => '01/10/2026', 'start_time' => '19:00', 'end_time' => '22:00',
    'event_date' => '01/10/2026', 'event_time' => '19:00', 'event_local' => 'Centro de Convenções, São Paulo - SP', 'event_mode' => 'presential', 'mode' => 'presential',
    'event_url' => 'https://exemplo.com/evento', 'evtUrl' => 'https://exemplo.com/evento', 'location' => 'Centro de Convenções, São Paulo - SP', 'loc' => 'Centro de Convenções, São Paulo - SP',
    'isContinuousEventType' => false, 'continuousDates' => [['date' => '01/10/2026', 'startTime' => '19:00', 'endTime' => '22:00'], ['date' => '02/10/2026', 'startTime' => '19:00', 'endTime' => '22:00']],
    'link' => 'https://app.greenn.com.br/exemplo', 'url' => 'https://app.greenn.com.br/exemplo', 'ctaUrl' => 'https://app.greenn.com.br/exemplo', 'manage_link' => 'https://app.greenn.com.br/assinaturas',
    'portalUrl' => 'https://app.greenn.com.br', 'report_url' => 'https://app.greenn.com.br/relatorio', 'boleto_url' => 'https://app.greenn.com.br/boleto/123',
    'qrcode' => 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=pix-exemplo',
    'code' => '483921', 'token' => 'abc123token', 'secret' => 'S3CR3T-KEY', 'is_token' => false,
    'type' => 'solicitation', 'title' => 'Título do e-mail', 'emailTitle' => 'Título do e-mail', 'message' => 'Mensagem de exemplo enviada pelo cliente.',
    'question' => 'Esse produto tem certificado?', 'answer' => 'Sim, o certificado é emitido ao final do curso.', 'reason' => 'Motivo fictício para demonstração.', 'motive' => 'Motivo fictício para demonstração.',
    'observation' => 'Observação fictícia para demonstração.', 'stock' => 3, 'affiliate' => 'Carlos Afiliado', 'delay' => ['value' => '3 dias', 'flagExist' => true],
    'trial' => 7, 'is_pix_automatic' => false, 'isSubscription' => true, 'recurring_subscription' => true, 'contract_ended' => false, 'contract' => 6677, 'client' => 'Maria Oliveira',
    'contract_offer' => (object) ['amount' => '97,00'], 'contract_installments' => $installments,
    'contract_terms' => ['client' => 'Maria Oliveira', 'offer' => 'Oferta Black Friday', 'contract_offer' => (object) ['amount' => '97,00'], 'contract_installments' => $installments],
    'custom_charges' => [$charge(1, '197,00'), $charge(2, '97,00'), $charge(3, '97,00')],
    'address' => 'Rua das Flores, 123 - Centro, São Paulo - SP', 'addr' => ['street' => 'Rua das Flores', 'number' => '123', 'complement' => 'Apto 45', 'neighborhood' => 'Centro', 'city' => 'São Paulo', 'state' => 'SP', 'zip_code' => '01001-000'],
    'city' => 'São Paulo', 'state' => 'SP', 'country' => 'Brasil', 'is_temporary_address' => false, 'isTemp' => false,
    'accountData' => ['type' => 'Conta corrente', 'name' => 'João Vendedor', 'cpf_cnpj' => '12.345.678/0001-90', 'bank_number' => '001', 'bank_name' => 'Banco do Brasil', 'agency' => '1234', 'agency_dv' => '5', 'account' => '67890', 'account_dv' => '1'],
    'userData' => ['name' => 'João Vendedor', 'email' => 'joao@exemplo.com', 'cpf_cnpj' => '12.345.678/0001-90', 'company' => ['name' => 'Empresa Exemplo LTDA', 'cnpj' => '12.345.678/0001-90']],
    'milestone' => '7', 'deadlineKey' => 'days_7', 'deadlineText' => '7 dias', 'assign_ticket' => true, 'sale_header_label' => null, 'sale_header_src' => null,
    'reversalKey' => 'default', 'reversalText' => 'Estorno fictício',
    'failureSections' => [['title' => 'Falhas de processamento', 'items' => [$slcItem]]],
    'report_issue_items' => [$slcItem], 'pending_or_error_items' => [$slcItem + ['status' => 'pending']],
    'sectionItems' => [], 'sectionCount' => 0, 'sectionSubtitle' => '', 'mark' => '✔',
];

// Extra renders for templates whose layout changes with the input.
$variants = [
    'emails.orders.refunded.client' => ['refund' => ['type' => 'refund'], 'processed' => ['type' => 'processed']],
    'emails.orders.success.paid.client' => ['boleto' => ['method' => 'BOLETO']],
    'emails.events.local_remember' => ['online' => ['event_mode' => 'online', 'mode' => 'online']],
    'emails.claims.avaliation' => ['user' => ['type' => 'user']],
];
// Templates that need a different type for a variable than the shared data above.
$overrides = [
    'emails.subscriptions.changed.client' => ['amount' => 497.0],
    'emails.orders.success.paid.contract' => ['contract_installments' => [
        ['status' => (object) ['value' => 'paid'], 'amount' => 97.0, 'current_installments' => 1, 'expected_date' => '2026-09-16'],
        ['status' => (object) ['value' => 'refused'], 'amount' => 97.0, 'current_installments' => 2, 'expected_date' => '2026-10-16'],
    ]],
];

$base = '/var/www/resources/views/emails';
$views = [];
foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($base)) as $file) {
    if (!str_ends_with($file->getFilename(), '.blade.php')) continue;
    $rel = substr($file->getPathname(), strlen($base) + 1);
    if (str_starts_with($rel, 'layouts/')) continue;
    $views[] = 'emails.' . str_replace(['/', '.blade.php'], ['.', ''], $rel);
}
sort($views);

$mode = $argv[1] ?? 'list';
if ($mode === 'list') {
    echo json_encode(array_map(fn ($v) => ['view' => $v, 'variants' => array_keys($variants[$v] ?? [])], $views), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$wanted = json_decode($argv[2] ?? '[]', true) ?: [];
foreach ($views as $view) {
    $renders = ['' => []] + ($variants[$view] ?? []);
    foreach ($renders as $variant => $override) {
        $label = $view . ($variant ? " [$variant]" : '');
        if ($wanted && !in_array($label, $wanted, true)) continue;
        try {
            $html = html_entity_decode(view($view, array_merge($data, $overrides[$view] ?? [], $override))->render());
            $line = ['label' => $label, 'ok' => true, 'html' => $html];
        } catch (\Throwable $e) {
            $line = ['label' => $label, 'ok' => false, 'error' => $e->getMessage()];
        }
        echo json_encode($line, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), "\n";
    }
}
`;

async function runScript(mode, arg = '', timeout = 60000) {
  // Writes the script through a heredoc and runs it; the exec API has no stdin.
  const shell = `cat > ${SCRIPT_PATH} <<'PHPEOF'\n${RENDER_SCRIPT}\nPHPEOF\nphp ${SCRIPT_PATH} "$1" "$2"`;
  const result = await execInContainer(GREENN_BACK_CONTAINER, ['sh', '-c', shell, 'sh', mode, arg], { timeout });
  if (result.exitCode !== 0) {
    throw new Error(`php exited with ${result.exitCode}: ${(result.stderr || result.stdout).slice(0, 2000)}`);
  }
  return result.stdout;
}

/** Lists every email template with its variants: [{ label, view, variant }]. */
export async function listTemplates() {
  const views = JSON.parse(await runScript('list'));
  return views.flatMap(({ view, variants }) => [
    { label: view, view, variant: null },
    ...variants.map((variant) => ({ label: `${view} [${variant}]`, view, variant })),
  ]);
}

/** Renders the given labels (all when empty): [{ label, ok, html | error }]. */
export async function renderTemplates(labels = []) {
  const out = await runScript('render', JSON.stringify(labels), 300000);
  return out
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}
