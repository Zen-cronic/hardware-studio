import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, symlink, realpath, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error Standalone Node deployment utility has no declaration file.
import { checkDataVolume, configuration, parseMountInfo } from '../scripts/data-volume-guard.mjs';

const env = { DATA_DIR: '/volume/data', DATA_MOUNT_PATH: '/volume', DATA_MOUNT_SOURCE: '/dev/vdb', DATA_MOUNT_ROOT: '/', DATA_MOUNT_MIN_FREE_BYTES: '4096', DATA_MOUNT_MIN_FREE_INODES: '2' };
const table = '1 0 8:1 / / rw - ext4 /dev/vda rw\n2 1 8:2 / /volume rw - ext4 /dev/vdb rw';
const io = (overrides = {}) => ({ platform: 'linux', realpath: async (p: string) => p, stat: async () => ({ dev: 2, isDirectory: () => true }), mountInfo: async () => table, statfs: async () => ({ bavail: 1n, bsize: 4096n, ffree: 2n, files: 100n }), ...overrides });
describe('persistent volume startup guard', () => {
  it('accepts an exact writable mount at the configured pressure boundaries', async () => expect(await checkDataVolume(env, io())).toEqual({ ok: true }));
  it.each(Object.keys(env))('requires explicit %s', key => expect(() => configuration({ ...env, [key]: undefined })).toThrow('INVALID_CONFIGURATION'));
  it.each(['-1', '1.5', ' 2', '1e3'])('rejects invalid floors %s', value => expect(() => configuration({ ...env, DATA_MOUNT_MIN_FREE_BYTES: value })).toThrow());
  it('rejects root fallback and relative/noncanonical paths', () => {
    for (const mount of ['/', 'volume', '/volume/../other']) expect(() => configuration({ ...env, DATA_MOUNT_PATH: mount })).toThrow();
  });
  it('refuses unsupported hosts without inspection', async () => expect(checkDataVolume(env, io({ platform: 'darwin', mountInfo: () => { throw Error('must not inspect'); } }))).rejects.toThrow('UNSUPPORTED_PLATFORM'));
  it.each([
    ['missing', '1 0 8:1 / / rw - ext4 /dev/vda rw', 'MOUNT_MISSING'],
    ['wrong source', table.replace('/dev/vdb', '/dev/vdc'), 'MOUNT_IDENTITY'],
    ['wrong bind root', table.replace('8:2 / /volume', '8:2 /other /volume'), 'MOUNT_IDENTITY'],
    ['readonly mount', table.replace('/volume rw', '/volume ro'), 'READ_ONLY'],
    ['readonly superblock', table.replace('/dev/vdb rw', '/dev/vdb ro'), 'READ_ONLY'],
    ['nested', table + '\n3 2 8:3 / /volume/data rw - ext4 /dev/vdc rw', 'NESTED_MOUNT'],
    ['stacked', table + '\n3 2 8:3 / /volume rw - ext4 /dev/vdc rw', 'MOUNT_MISSING_OR_AMBIGUOUS'],
    ['malformed', 'invalid', 'FILESYSTEM_INSPECTION_FAILED'],
  ])('rejects %s', async (_, text, code) => expect(checkDataVolume(env, io({ mountInfo: async () => text }))).rejects.toThrow(code));
  it('decodes kernel escapes and supports explicit bind roots', async () => {
    const escaped = table.replace('8:2 / /volume', '8:2 /bound\\040root /my\\040volume');
    expect(parseMountInfo(escaped)[1].root).toBe('/bound root');
    await expect(checkDataVolume({ ...env, DATA_DIR: '/my volume/data', DATA_MOUNT_PATH: '/my volume', DATA_MOUNT_ROOT: '/bound root' }, io({ mountInfo: async () => escaped }))).resolves.toEqual({ ok: true });
  });
  it('rejects outside and symlink-canonicalized paths', async () => {
    await expect(checkDataVolume({ ...env, DATA_DIR: '/volume-other/data' }, io())).rejects.toThrow('DATA_PATH_ESCAPE');
    await expect(checkDataVolume(env, io({ realpath: async () => '/elsewhere' }))).rejects.toThrow('DATA_PATH_ESCAPE');
  });
  it('checks actual temporary directory symlink resolution without writes by the guard', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'volume-guard-'));
    try {
      await mkdir(join(temp, 'mount')); await mkdir(join(temp, 'outside')); await symlink(join(temp, 'outside'), join(temp, 'mount', 'data'));
      const canonical = await realpath(temp);
      await expect(checkDataVolume({ ...env, DATA_MOUNT_PATH: join(canonical, 'mount'), DATA_DIR: join(canonical, 'mount', 'data') }, io({ realpath, stat }))).rejects.toThrow('DATA_PATH_ESCAPE');
    } finally { await rm(temp, { recursive: true, force: true }); }
  });
  it('fails inspection, non-directory and device mismatches', async () => {
    await expect(checkDataVolume(env, io({ statfs: async () => { throw Error('private detail'); } }))).rejects.toThrow('FILESYSTEM_INSPECTION_FAILED');
    await expect(checkDataVolume(env, io({ stat: async () => ({ dev: 2, isDirectory: () => false }) }))).rejects.toThrow('NOT_DIRECTORY');
    await expect(checkDataVolume(env, io({ stat: async (p: string) => ({ dev: p === '/volume' ? 1 : 2, isDirectory: () => true }) }))).rejects.toThrow('DEVICE_MISMATCH');
  });
  it.each([{ bavail: 0n }, { ffree: 1n }, { files: 0n }, { bsize: 0n }, { bavail: -1n }])('fails closed for unavailable or insufficient space', async values => {
    await expect(checkDataVolume(env, io({ statfs: async () => ({ bavail: 1n, bsize: 4096n, ffree: 2n, files: 100n, ...values }) }))).rejects.toThrow();
  });
});
