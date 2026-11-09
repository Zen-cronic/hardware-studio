import { realpath, readFile, stat, statfs } from 'node:fs/promises';
import { posix as path } from 'node:path';
import { pathToFileURL } from 'node:url';

const fail = (code) => { throw new Error(code); };
const absolute = (value) => {
  if (typeof value !== 'string' || !value.startsWith('/') || /[\0\r\n]/.test(value) || path.normalize(value) !== value) fail('INVALID_CONFIGURATION');
  return value;
};
const number = (value) => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) fail('INVALID_CONFIGURATION');
  return BigInt(value);
};
const inside = (child, parent) => child === parent || child.startsWith(parent === '/' ? '/' : `${parent}/`);
const decode = (value) => value.replace(/\\(040|011|012|134)/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));

export function configuration(env) {
  const mount = absolute(env.DATA_MOUNT_PATH);
  if (mount === '/') fail('ROOT_MOUNT_FORBIDDEN');
  if (typeof env.DATA_MOUNT_SOURCE !== 'string' || !env.DATA_MOUNT_SOURCE || /[\0\r\n]/.test(env.DATA_MOUNT_SOURCE)) fail('INVALID_CONFIGURATION');
  return { data: absolute(env.DATA_DIR), mount, source: env.DATA_MOUNT_SOURCE, root: absolute(env.DATA_MOUNT_ROOT), minBytes: number(env.DATA_MOUNT_MIN_FREE_BYTES), minInodes: number(env.DATA_MOUNT_MIN_FREE_INODES) };
}

export function parseMountInfo(text) {
  return text.trim().split('\n').map(line => {
    const parts = line.split(' '), separator = parts.indexOf('-');
    if (separator < 6 || parts.length !== separator + 4 || !/^\d+$/.test(parts[0]) || !/^\d+:\d+$/.test(parts[2])) fail('MOUNT_INSPECTION_FAILED');
    return { id: parts[0], root: decode(parts[3]), mount: decode(parts[4]), options: parts[5].split(','), source: decode(parts[separator + 2]), superOptions: parts[separator + 3].split(',') };
  });
}

const system = {
  platform: process.platform,
  realpath,
  stat,
  statfs: p => statfs(p, { bigint: true }),
  mountInfo: () => readFile('/proc/self/mountinfo', 'utf8'),
};

export async function checkDataVolume(env, io = system) {
  const config = configuration(env);
  if (io.platform !== 'linux') fail('UNSUPPORTED_PLATFORM');
  let canonicalMount, canonicalData, mountStat, dataStat, mounts, space;
  try {
    [canonicalMount, canonicalData] = await Promise.all([io.realpath(config.mount), io.realpath(config.data)]);
    [mountStat, dataStat] = await Promise.all([io.stat(canonicalMount), io.stat(canonicalData)]);
    mounts = parseMountInfo(await io.mountInfo());
    space = await io.statfs(canonicalData);
  } catch { fail('FILESYSTEM_INSPECTION_FAILED'); }
  if (canonicalMount !== config.mount || canonicalData !== config.data || !inside(canonicalData, canonicalMount)) fail('DATA_PATH_ESCAPE');
  if (!mountStat.isDirectory() || !dataStat.isDirectory()) fail('NOT_DIRECTORY');
  const matches = mounts.filter(m => m.mount === canonicalMount);
  if (matches.length !== 1) fail('MOUNT_MISSING_OR_AMBIGUOUS');
  const selected = matches[0];
  if (selected.source !== config.source || selected.root !== config.root) fail('MOUNT_IDENTITY_MISMATCH');
  if (mounts.some(m => m.id !== selected.id && inside(m.mount, canonicalMount) && inside(canonicalData, m.mount))) fail('NESTED_MOUNT');
  if (!selected.options.includes('rw') || selected.options.includes('ro') || !selected.superOptions.includes('rw') || selected.superOptions.includes('ro')) fail('READ_ONLY_MOUNT');
  if (mountStat.dev !== dataStat.dev) fail('DEVICE_MISMATCH');
  for (const key of ['bavail', 'bsize', 'ffree', 'files']) if (typeof space[key] !== 'bigint' || space[key] < 0n) fail('SPACE_INSPECTION_FAILED');
  if (space.bsize === 0n || space.files === 0n) fail('SPACE_INSPECTION_FAILED');
  if (space.bavail * space.bsize < config.minBytes || space.ffree < config.minInodes) fail('STORAGE_PRESSURE');
  return { ok: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await checkDataVolume(process.env); console.log('Data volume guard passed.'); }
  catch (error) { const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'INSPECTION_FAILED'; console.error(`Data volume guard refused startup: ${code}`); process.exitCode = 1; }
}
