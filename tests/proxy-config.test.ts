import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
// @ts-expect-error Standalone Node deployment utility has no declaration file.
import { parseArguments, renderProxyConfig } from '../scripts/render-proxy-config.mjs';
const config = { domain: 'studio.example.invalid', certificate: '/etc/tls/cert.pem', key: '/etc/tls/key.pem', 'api-port': '4174', 'notes-port': '4175', mode: 'separate' };
const args = Object.entries(config).flatMap(([k, v]) => [`--${k}`, v]);
describe('standalone proxy configuration contract', () => {
  it('generates deterministic stdout without reading missing TLS files', () => {
    const run = spawnSync(process.execPath, ['scripts/render-proxy-config.mjs', ...args], { encoding: 'utf8' });
    expect(run.status).toBe(0); expect(run.stderr).toBe(''); expect(run.stdout).toBe(renderProxyConfig(config));
    expect(renderProxyConfig(config)).toBe(renderProxyConfig(config));
  });
  it('keeps the checked-in reserved-domain example current', () => expect(readFileSync('deploy/hardware-studio-nginx.conf.example', 'utf8')).toBe(renderProxyConfig(config)));
  it.each(['separate', 'shared'])('preserves both socket families and routes in %s mode', mode => {
    const text = renderProxyConfig({ ...config, mode });
    const notes = mode === 'shared' ? '4174' : '4175';
    expect(text).toContain(`location = /collab {\n      proxy_pass http://127.0.0.1:${notes};`);
    expect(text).toContain(`location ^~ /collab/ {\n      proxy_pass http://127.0.0.1:${notes};`);
    expect(text).toContain('location ^~ /api/rooms/ {\n      proxy_pass http://127.0.0.1:4174;');
    expect(text).toContain('location / {\n      proxy_pass http://127.0.0.1:4174;');
    expect(text.match(/proxy_pass http:\/\/127\.0\.0\.1:\d+;/g)).toHaveLength(4);
    expect(text).not.toMatch(/\brewrite\b|\btry_files\b/);
  });
  it('sets exact body, header, streaming and no-cache contract without including other configs', () => {
    const text = renderProxyConfig(config);
    for (const directive of ['client_max_body_size 13000000;', 'proxy_http_version 1.1;', 'proxy_set_header Authorization $http_authorization;', 'proxy_set_header Upgrade $http_upgrade;', 'proxy_set_header Connection $connection_upgrade;', 'proxy_read_timeout 3600s;', 'proxy_pass_request_headers on;', 'proxy_pass_request_body on;', 'proxy_buffering off;', 'proxy_request_buffering off;', 'proxy_ignore_headers X-Accel-Buffering;', 'proxy_cache off;', 'proxy_store off;', 'proxy_next_upstream off;', 'add_header Cache-Control "no-store" always;']) expect(text).toContain(directive);
    expect(text).not.toMatch(/^\s*include\s/m);
    expect(text).not.toMatch(/proxy_set_header\s+(X-Forwarded|X-Real-IP)/);
  });
  it('discards request/error logging at top level and HTTP scope', () => {
    const text = renderProxyConfig(config);
    expect(text.match(/^\s*error_log .+;$/gm)?.map((x: string) => x.trim())).toEqual(['error_log /dev/null crit;', 'error_log /dev/null crit;']);
    expect(text.match(/^\s*access_log .+;$/gm)?.map((x: string) => x.trim())).toEqual(['access_log off;']);
    expect(text).not.toContain('log_format');
  });
  it.each(['', 'localhost', '*.example.com', 'https://example.com', 'evil.com;return 200;', 'evil.com\n}', '$host.example', 'x..com', '1.2.3.4', '-x.example', 'a'.repeat(64)+'.example'])('rejects domain %s', domain => expect(() => renderProxyConfig({ ...config, domain })).toThrow());
  it.each(['relative.pem', '/etc/key;foo', '/etc/key\n.pem', '/etc/$secret', '/etc/../key', '/etc/key file', '/etc/key"', '/etc/'])('rejects unsafe TLS path %s', key => expect(() => renderProxyConfig({ ...config, key })).toThrow());
  it.each(['0', '65536', '1.5', '04174', '4174;foo', ' 4174'])('rejects port %s', port => expect(() => renderProxyConfig({ ...config, 'api-port': port })).toThrow());
  it('rejects missing, extra, duplicate options and unsupported modes', () => {
    for (const input of [[], args.slice(2), [...args, '--extra', 'x'], ['--domain', 'x', ...args.slice(0, 10)], args.map(x => x === '--domain' ? '--unknown' : x)]) expect(() => parseArguments(input)).toThrow();
    expect(() => renderProxyConfig({ ...config, mode: 'auto' })).toThrow();
    expect(() => renderProxyConfig({ ...config, 'notes-port': '4174' })).toThrow();
    expect(() => renderProxyConfig({ ...config, extra: 'x' })).toThrow();
  });
  it.each(['80', '443'])('rejects active upstream collision with listener %s', port => {
    for (const mode of ['shared', 'separate']) expect(() => renderProxyConfig({ ...config, mode, 'api-port': port })).toThrow();
    expect(() => renderProxyConfig({ ...config, 'notes-port': port })).toThrow();
    const shared = renderProxyConfig({ ...config, mode: 'shared', 'notes-port': port });
    expect(shared.match(/proxy_pass http:\/\/127\.0\.0\.1:4174;/g)).toHaveLength(4);
  });
  it('CLI rejection prints no supplied values or partial configuration', () => {
    const run = spawnSync(process.execPath, ['scripts/render-proxy-config.mjs', ...args, '--secret', 'PRIVATE_TEST_VALUE'], { encoding: 'utf8' });
    expect(run.status).toBe(1); expect(run.stdout).toBe(''); expect(run.stderr).not.toContain('PRIVATE_TEST_VALUE');
  });
});
