import http from 'node:http';
import fs from 'node:fs';

const SOCKET_PATH = process.env.DOCKER_SOCKET || '/var/run/docker.sock';

// Containers que o `make mobile` reconfigura para o IP da LAN
const MOBILE_CONTAINERS = [
  { name: 'greenn-adm-node', label: 'greenn-adm', envKey: 'VUE_APP_API_HOST' },
  { name: 'new-checkout-node', label: 'new-checkout', envKey: 'API_HOST' },
];

function request(method, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: SOCKET_PATH, method, path, timeout: 30000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout ao falar com o Docker')));
    req.on('error', reject);
    req.end();
  });
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
