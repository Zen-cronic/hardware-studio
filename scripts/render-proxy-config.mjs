import { posix as path } from 'node:path';
import { pathToFileURL } from 'node:url';

const invalid = () => { throw new Error('Invalid proxy configuration; supply every documented option exactly once.'); };
const keys = ['domain', 'certificate', 'key', 'api-port', 'notes-port', 'mode'];
export function parseArguments(args) {
  const result = {};
  if (args.length !== keys.length * 2) invalid();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index].replace(/^--/, '');
    if (args[index] !== `--${key}` || !keys.includes(key) || Object.hasOwn(result, key)) invalid();
    result[key] = args[index + 1];
  }
  return result;
}
const validPath = value => typeof value === 'string' && /^\/[A-Za-z0-9_./-]+$/.test(value) && path.normalize(value) === value && !value.endsWith('/') && value !== '/';
const validPort = value => typeof value === 'string' && /^[1-9][0-9]{0,4}$/.test(value) && Number(value) <= 65535;
export function renderProxyConfig(config) {
  if (!config || Object.keys(config).length !== keys.length || keys.some(key => typeof config[key] !== 'string')) invalid();
  const domain = config.domain;
  if (domain.length > 253 || !domain.includes('.') || !domain.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) || /^[0-9.]+$/.test(domain)) invalid();
  if (!validPath(config.certificate) || !validPath(config.key) || config.certificate === config.key) invalid();
  if (!validPort(config['api-port']) || !validPort(config['notes-port']) || !['shared', 'separate'].includes(config.mode)) invalid();
  if (['80', '443'].includes(config['api-port']) || (config.mode === 'separate' && ['80', '443'].includes(config['notes-port']))) invalid();
  if (config.mode === 'separate' && config['api-port'] === config['notes-port']) invalid();
  const api = config['api-port'], notes = config.mode === 'shared' ? api : config['notes-port'];
  const location = (selector, port) => `    location ${selector} {\n      proxy_pass http://127.0.0.1:${port};\n    }`;
  return `# Generated standalone configuration; review and validate on the selected host before use.
# No includes: do not merge into a configuration with inherited logging/cache overrides.
worker_processes auto;
error_log /dev/null crit;
events { worker_connections 1024; }
http {
  access_log off;
  error_log /dev/null crit;
  server_tokens off;
  map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
  }
  client_max_body_size 13000000;
  proxy_http_version 1.1;
  proxy_set_header Host $http_host;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection $connection_upgrade;
  proxy_set_header Authorization $http_authorization;
  proxy_pass_request_headers on;
  proxy_pass_request_body on;
  proxy_read_timeout 3600s;
  proxy_send_timeout 3600s;
  proxy_buffering off;
  proxy_request_buffering off;
  proxy_ignore_headers X-Accel-Buffering;
  proxy_cache off;
  proxy_store off;
  proxy_next_upstream off;
  proxy_redirect off;
  add_header Cache-Control "no-store" always;
  server {
    listen 80;
    server_name ${domain};
    return 308 https://${domain}$request_uri;
  }
  server {
    listen 443 ssl;
    server_name ${domain};
    ssl_certificate ${config.certificate};
    ssl_certificate_key ${config.key};
    ssl_protocols TLSv1.2 TLSv1.3;
${location('= /collab', notes)}
${location('^~ /collab/', notes)}
${location('^~ /api/rooms/', api)}
${location('/', api)}
  }
}
`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.stdout.write(renderProxyConfig(parseArguments(process.argv.slice(2)))); }
  catch { console.error('Invalid proxy configuration; supply every documented option exactly once.'); process.exitCode = 1; }
}
