import http from 'node:http';
import fs from 'node:fs';

const SOCKET_PATH = process.env.DOCKER_SOCKET || '/var/run/docker.sock';

// Containers que o `make mobile` reconfigura para o IP da LAN
const MOBILE_CONTAINERS = [
  { name: 'greenn-adm-node', label: 'greenn-adm', envKey: 'VUE_APP_API_HOST' },
  { name: 'new-checkout-node', label: 'new-checkout', envKey: 'API_HOST' },
];

function request(method, path, payload = null, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const data = payload == null ? null : JSON.stringify(payload);
    const headers = data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {};
    const req = http.request({ socketPath: SOCKET_PATH, method, path, headers, timeout }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({ status: res.statusCode, body: buffer.toString('utf8'), buffer });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout ao falar com o Docker')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// O stream do `exec` vem multiplexado: blocos de 8 bytes de cabeçalho (tipo + tamanho)
// seguidos do conteúdo. Sem TTY é assim que stdout e stderr chegam juntos.
function demultiplex(buffer) {
  let stdout = '';
  let stderr = '';
  let offset = 0;

  while (offset + 8 <= buffer.length) {
    const type = buffer[offset];
    const size = buffer.readUInt32BE(offset + 4);
    const chunk = buffer.slice(offset + 8, offset + 8 + size).toString('utf8');
    if (type === 2) stderr += chunk;
    else stdout += chunk;
    offset += 8 + size;
  }

  // Se o daemon devolveu texto puro (container com TTY), usa como está.
  if (!stdout && !stderr && buffer.length) stdout = buffer.toString('utf8');
  return { stdout, stderr };
}

// Executa um comando dentro de um container já em execução e devolve a saída.
export async function execInContainer(container, cmd, { timeout = 120000 } = {}) {
  const info = await inspect(container);
  if (!info) throw new Error(`container ${container} não existe`);
  if (info.State?.Running !== true) throw new Error(`container ${container} não está rodando`);

  const created = await request('POST', `/containers/${encodeURIComponent(container)}/exec`, {
    AttachStdout: true,
    AttachStderr: true,
    Cmd: cmd,
  });
  if (created.status !== 201) throw new Error(`Docker respondeu ${created.status}: ${created.body}`);

  const execId = JSON.parse(created.body).Id;
  const started = await request('POST', `/exec/${execId}/start`, { Detach: false, Tty: false }, timeout);
  if (started.status !== 200) throw new Error(`Docker respondeu ${started.status}: ${started.body}`);

  const inspectExec = await request('GET', `/exec/${execId}/json`);
  const exitCode = inspectExec.status === 200 ? JSON.parse(inspectExec.body).ExitCode : null;

  return { exitCode, ...demultiplex(started.buffer) };
}

export function isDockerAvailable() {
  return fs.existsSync(SOCKET_PATH);
}

async function inspect(name) {
  const { status, body } = await request('GET', `/containers/${encodeURIComponent(name)}/json`);
  if (status === 404) return null;
  if (status !== 200) throw new Error(`Docker respondeu ${status}: ${body}`);
  return JSON.parse(body);
}

export async function mobileStatus() {
  const services = [];
  for (const svc of MOBILE_CONTAINERS) {
    const info = await inspect(svc.name);
    if (!info) {
      services.push({ ...svc, exists: false, running: false, apiHost: null });
      continue;
    }
    const env = info.Config?.Env || [];
    const entry = env.find((e) => e.startsWith(`${svc.envKey}=`));
    services.push({
      name: svc.name,
      label: svc.label,
      exists: true,
      running: info.State?.Running === true,
      apiHost: entry ? entry.slice(svc.envKey.length + 1) : null,
    });
  }
  return services;
}

export async function mobileAction(action) {
  const dockerAction = action === 'up' ? 'start' : 'stop';
  const results = [];
  for (const svc of MOBILE_CONTAINERS) {
    const info = await inspect(svc.name);
    if (!info) {
      results.push({ name: svc.name, ok: false, error: 'container não existe — rode `make mobile-all` uma vez' });
      continue;
    }
    const { status, body } = await request('POST', `/containers/${encodeURIComponent(svc.name)}/${dockerAction}`);
    // 204 = ok, 304 = já estava no estado desejado
    if (status === 204 || status === 304) {
      results.push({ name: svc.name, ok: true, alreadyInState: status === 304 });
    } else {
      results.push({ name: svc.name, ok: false, error: `Docker respondeu ${status}: ${body}` });
    }
  }
  return results;
}
