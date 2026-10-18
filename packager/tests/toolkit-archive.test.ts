import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crc32 } from '../src/intunewin-writer';
import { readPinnedToolkitArchive, initializePinnedToolkit, assertToolkitTree, TOOLKIT_LIMITS } from '../src/toolkit-archive';

const pin = vi.hoisted(() => ({ sha256: '', extractDir: 'PSAppDeployToolkit' }));
vi.mock('../scripts/tool-manifest.json', () => ({ default: { psadtTemplate: pin } }));
const temporary: string[] = [];
beforeEach(() => { pin.sha256 = ''; });
afterEach(async () => { for (const p of temporary.splice(0)) await fs.rm(p, { recursive: true, force: true }); });

interface Entry {
  name: string; content?: Buffer; method?: number; flags?: number; mode?: number;
  descriptor?: boolean; signedDescriptor?: boolean; size?: number; crc?: number; extra?: Buffer; compressed?: Buffer;
}

// Small independent synthetic ZIP builder; never imports or runs toolkit content.
function archive(entries: Entry[] = [], includeLayout = true): Buffer {
  const all: Entry[] = [...(includeLayout ? [
    { name: 'Invoke-AppDeployToolkit.exe', content: Buffer.from('fake wrapper, never executable') },
    { name: 'PSAppDeployToolkit/', mode: 0o40700 },
    { name: 'PSAppDeployToolkit/module.txt', content: Buffer.from('fake module'), method: 8 },
  ] : []), ...entries,
  ];
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const e of all) {
    const name = Buffer.from(e.name), content = e.content ?? Buffer.alloc(0), method = e.method ?? 0;
    const compressed = e.compressed ?? (method === 8 ? deflateRawSync(content) : content);
    const crc = e.crc ?? crc32(content), size = e.size ?? content.length;
    const flags = (e.flags ?? 0x800) | (e.descriptor ? 8 : 0), extra = e.extra ?? Buffer.alloc(0);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50); l.writeUInt16LE(20, 4);
    l.writeUInt16LE(flags, 6); l.writeUInt16LE(method, 8);
    if (!e.descriptor) { l.writeUInt32LE(crc, 14); l.writeUInt32LE(compressed.length, 18); l.writeUInt32LE(size, 22); }
    l.writeUInt16LE(name.length, 26); l.writeUInt16LE(extra.length, 28);
    const signed = e.signedDescriptor !== false, dd = Buffer.alloc(e.descriptor ? (signed ? 16 : 12) : 0);
    if (e.descriptor) { const start = signed ? 4 : 0; if (signed) dd.writeUInt32LE(0x08074b50); dd.writeUInt32LE(crc, start); dd.writeUInt32LE(compressed.length, start + 4); dd.writeUInt32LE(size, start + 8); }
    local.push(l, name, extra, compressed, dd);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(0x314, 4); c.writeUInt16LE(20, 6);
    c.writeUInt16LE(flags, 8); c.writeUInt16LE(method, 10); c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(compressed.length, 20); c.writeUInt32LE(size, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt16LE(extra.length, 30);
    c.writeUInt32LE(((e.mode ?? 0o100600) << 16) >>> 0, 38); c.writeUInt32LE(offset, 42);
    central.push(c, name, extra); offset += l.length + name.length + extra.length + compressed.length + dd.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(all.length, 8); end.writeUInt16LE(all.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function pinned(bytes: Buffer): Buffer { pin.sha256 = crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(); return bytes; }
async function directory() { const p = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'intuneget-toolkit-test-')); temporary.push(p); return p; }
function centralOffset(bytes: Buffer) { return bytes.readUInt32LE(bytes.length - 6); }

describe('pinned toolkit archive', () => {
  it('checks the entire shipped pin before attempting to parse even a malformed archive', async () => {
    pin.sha256 = 'A'.repeat(64);
    await expect(readPinnedToolkitArchive(Buffer.from('not zip'))).rejects.toThrow('TOOL_HASH_MISMATCH');
    pin.sha256 = 'invalid';
    await expect(readPinnedToolkitArchive(archive())).rejects.toThrow('pin');
  });

  it('reads store, deflate, validated descriptors and backslash paths with Windows map semantics', async () => {
    const bytes = pinned(archive([{ name: 'Extra\\file.txt', content: Buffer.from('descriptor'), method: 8, descriptor: true }]));
    const map = await readPinnedToolkitArchive(bytes);
    expect(map.files.get('EXTRA/FILE.TXT')?.sha256).toBe(crypto.createHash('sha256').update('descriptor').digest('hex').toUpperCase());
    expect([...map.directories.keys()].sort()).toEqual(['EXTRA', 'PSAPPDEPLOYTOOLKIT']);
    const root = await directory(), destination = await initializePinnedToolkit(bytes, root);
    await expect(fs.readFile(path.join(destination, 'Extra', 'file.txt'), 'utf8')).resolves.toBe('descriptor');
    await expect(initializePinnedToolkit(bytes, root)).resolves.toBe(destination);
  });

  it('supports unsigned descriptors, deflated empty directories and shared case-insensitive parents', async () => {
    const bytes = pinned(archive([{ name: 'Case/first', content: Buffer.from('a'), descriptor: true, signedDescriptor: false },
      { name: 'case/second', content: Buffer.from('b') }, { name: 'DeflatedEmpty/', mode: 0o40700, method: 8 }]));
    const root = await directory(), destination = await initializePinnedToolkit(bytes, root);
    await expect(assertToolkitTree(destination, await readPinnedToolkitArchive(bytes))).resolves.toBeUndefined();
    expect((await fs.readdir(destination)).filter(x => x.toUpperCase() === 'CASE')).toHaveLength(1);
  });

  it.each(['../escape', '/root', 'C:/drive', 'a/../b', 'a/./b', 'a//b', 'a\0b', 'a:b', 'CON.txt', 'dir./x', 'dir /x', '', './', '\\absolute'])('rejects unsafe path %j before extraction', async name => {
    const bytes = pinned(archive([{ name, content: Buffer.from('x') }]));
    await expect(readPinnedToolkitArchive(bytes)).rejects.toThrow(/path|layout/i);
  });

  it.each([
    [{ name: 'a.txt' }, { name: 'A.TXT' }],
    [{ name: 'a\\b.txt' }, { name: 'A/b.txt' }],
    [{ name: 'a' }, { name: 'a/b' }],
    [{ name: 'a/', mode: 0o40700 }, { name: 'A' }],
  ])('rejects case, normalized and file/directory collisions', async (...entries) => {
    await expect(readPinnedToolkitArchive(pinned(archive(entries)))).rejects.toThrow(/collid|duplicate/i);
  });

  it.each([0o120777, 0o010600, 0o020600, 0o060600, 0o140600])('rejects Unix special file type %i', async mode => {
    await expect(readPinnedToolkitArchive(pinned(archive([{ name: 'special', mode }])))).rejects.toThrow(/special|type/i);
  });

  it('rejects DOS reparse attributes and inconsistent directory attributes', async () => {
    const bytes = archive(), offset = centralOffset(bytes); bytes.writeUInt32LE(0x400, offset + 38);
    await expect(readPinnedToolkitArchive(pinned(bytes))).rejects.toThrow(/special|attribute/i);
    await expect(readPinnedToolkitArchive(pinned(archive([{ name: 'directory/', mode: 0o100600 }])))).rejects.toThrow(/type|attribute/i);
  });

  it.each([1, 0x40, 0x2000, 0x10])('rejects encryption and unsupported flag %i', async flags => {
    await expect(readPinnedToolkitArchive(pinned(archive([{ name: 'bad', flags }])))).rejects.toThrow(/flag|encrypt/i);
  });

  it('rejects methods other than store and deflate', async () => {
    await expect(readPinnedToolkitArchive(pinned(archive([{ name: 'bad', method: 12 }])))).rejects.toThrow(/method/i);
  });

  it('rejects ZIP64 versions, sentinel counts and extra fields', async () => {
    const version = archive(); version.writeUInt16LE(45, centralOffset(version) + 6);
    const count = archive(); count.writeUInt16LE(0xffff, count.length - 12);
    for (const bytes of [version, count, archive([{ name: 'bad', extra: Buffer.from([1, 0, 0, 0]) }])]) {
      await expect(readPinnedToolkitArchive(pinned(bytes))).rejects.toThrow(/ZIP64/i);
    }
  });

  it('rejects split disks, oversized counts, bounds and archive framing', async () => {
    const disk = archive(); disk.writeUInt16LE(1, disk.length - 18);
    const count = archive(); count.writeUInt16LE(TOOLKIT_LIMITS.entries + 1, count.length - 12); count.writeUInt16LE(TOOLKIT_LIMITS.entries + 1, count.length - 14);
    const huge = archive([{ name: 'huge', size: TOOLKIT_LIMITS.entryBytes + 1 }]);
    const trailing = Buffer.concat([archive(), Buffer.from('trailing')]);
    for (const bytes of [disk, count, huge, trailing]) await expect(readPinnedToolkitArchive(pinned(bytes))).rejects.toThrow();
    await expect(readPinnedToolkitArchive(pinned(archive(Array.from({ length: 5 }, (_, i) => ({ name: 'total' + i, size: TOOLKIT_LIMITS.entryBytes })))))).rejects.toThrow(/bound/i);
    await expect(readPinnedToolkitArchive(pinned(archive([{ name: 'a/'.repeat(65) + 'deep' }])))).rejects.toThrow(/bound/i);
    await expect(readPinnedToolkitArchive(pinned(archive([{ name: 'long'.repeat(300) }])))).rejects.toThrow(/bound/i);
    await expect(readPinnedToolkitArchive(pinned(archive([{ name: 'other' }], false)))).rejects.toThrow(/layout/i);
  });

  it('checks each expanded CRC and stops a lying deflate stream at its declared output bound', async () => {
    await expect(readPinnedToolkitArchive(pinned(archive([{ name: 'crc', content: Buffer.from('bad crc'), crc: 1 }])))).rejects.toThrow(/CRC/i);
    await expect(readPinnedToolkitArchive(pinned(archive([{ name: 'bomb', method: 8, content: Buffer.alloc(1024 * 1024), size: 1 }])))).rejects.toThrow(/bound|size/i);
    await expect(readPinnedToolkitArchive(pinned(archive([{ name: 'truncated', method: 8, compressed: Buffer.from([3]), size: 50 }])))).rejects.toThrow();
    const compressed = Buffer.concat([deflateRawSync(Buffer.from('ok')), Buffer.from('hidden')]);
    await expect(readPinnedToolkitArchive(pinned(archive([{ name: 'extra', method: 8, content: Buffer.from('ok'), compressed }])))).rejects.toThrow(/compressed|trailing/i);
  });

  it('rejects mismatched local names, flags, sizes and overlapping offsets', async () => {
    for (const field of ['name', 'flags', 'size', 'offset'] as const) {
      const bytes = archive(), central = centralOffset(bytes);
      if (field === 'name') bytes[30] ^= 1;
      if (field === 'flags') bytes.writeUInt16LE(0, 6);
      if (field === 'size') bytes.writeUInt32LE(0, 22);
      if (field === 'offset') bytes.writeUInt32LE(1, central + 42);
      await expect(readPinnedToolkitArchive(pinned(bytes))).rejects.toThrow();
    }
  });

  it('rejects descriptors missing or disagreeing with the central CRC and sizes', async () => {
    for (const field of [0, 4, 8, 12]) {
      const bytes = archive([{ name: 'descriptor', content: Buffer.from('x'), descriptor: true }]);
      const descriptor = centralOffset(bytes) - 16; bytes[descriptor + field] ^= 1;
      await expect(readPinnedToolkitArchive(pinned(bytes))).rejects.toThrow(/descriptor/i);
    }
  });

  it('rejects a malformed and truncated corpus without creating a tools directory', async () => {
    const complete = archive();
    for (let size = 0; size < complete.length; size++) {
      await expect(readPinnedToolkitArchive(pinned(complete.subarray(0, size)))).rejects.toThrow();
    }
    for (const size of [22, 64, 300]) await expect(readPinnedToolkitArchive(pinned(Buffer.alloc(size, 0xa5)))).rejects.toThrow();
    const root = await directory(), destination = path.join(root, 'not-created');
    await expect(initializePinnedToolkit(pinned(Buffer.from('malformed')), destination)).rejects.toThrow();
    await expect(fs.stat(destination)).rejects.toThrow();
  });

  it('refuses missing layout, missing/extra/changed tree entries and case collisions', async () => {
    const bytes = pinned(archive()), map = await readPinnedToolkitArchive(bytes), root = await directory();
    const destination = await initializePinnedToolkit(bytes, root);
    const target = path.join(destination, 'PSAppDeployToolkit', 'module.txt');
    await fs.writeFile(target, 'changed'); await expect(assertToolkitTree(destination, map)).rejects.toThrow(/hash/i);
    await fs.writeFile(target, 'fake module'); await fs.writeFile(path.join(destination, 'extra'), 'extra');
    await expect(assertToolkitTree(destination, map)).rejects.toThrow(/unexpected/i);
    await fs.unlink(path.join(destination, 'extra')); await fs.unlink(target);
    await expect(assertToolkitTree(destination, map)).rejects.toThrow(/missing/i);
    await expect(initializePinnedToolkit(bytes, root)).rejects.toThrow(/missing/i);
    expect((await fs.readdir(root)).some(x => x.startsWith('.staging-'))).toBe(false);
  });

  it('refuses linked tools ancestors and linked cached toolkit entries', async () => {
    const bytes = pinned(archive()), root = await directory(), real = path.join(root, 'real'), link = path.join(root, 'link');
    await fs.mkdir(real); await fs.symlink(real, link, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(initializePinnedToolkit(bytes, path.join(link, 'tools'))).rejects.toThrow(/regular|link/i);
    const destination = await initializePinnedToolkit(bytes, real); const child = path.join(destination, 'PSAppDeployToolkit');
    await fs.rm(child, { recursive: true }); await fs.symlink(root, child, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(initializePinnedToolkit(bytes, real)).rejects.toThrow(/regular|link/i);
  });

  it.skipIf(process.platform !== 'win32')('matches the unchanged PowerShell archive map and complete per-file tree verifier', async () => {
    const root = await directory(), bytes = pinned(archive([{ name: 'Empty/', mode: 0o40700 }]));
    const zip = path.join(root, 'synthetic.zip'); await fs.writeFile(zip, bytes);
    const destination = await initializePinnedToolkit(bytes, path.join(root, 'tools'));
    const verifier = path.resolve('packager/scripts/tool-integrity.ps1');
    const script = "$ErrorActionPreference='Stop'; . $env:INTUNEGET_TEST_VERIFIER; $map=Get-PackagerArchiveMap $env:INTUNEGET_TEST_ZIP; Assert-PackagerToolkitTree $env:INTUNEGET_TEST_TREE $map; @{ files=@($map.Files.Keys | Sort-Object); directories=@($map.Directories | Sort-Object); hashes=@($map.Files.Values | Sort-Object) } | ConvertTo-Json -Compress";
    const env = { ...process.env, INTUNEGET_TEST_VERIFIER: verifier, INTUNEGET_TEST_ZIP: zip, INTUNEGET_TEST_TREE: destination };
    for (const k of Object.keys(env)) if (/TOKEN|SECRET|PASSWORD|PRIVATE_KEY|GIT_CONFIG_VALUE/i.test(k)) delete env[k as keyof typeof env];
    const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], { env, encoding: 'utf8', windowsHide: true, timeout: 20000 });
    expect(result.status, result.stderr).toBe(0);
    const windows = JSON.parse(result.stdout), map = await readPinnedToolkitArchive(bytes);
    expect(windows.files.map((x: string) => x.toUpperCase()).sort()).toEqual([...map.files.keys()].sort());
    expect(windows.directories.map((x: string) => x.toUpperCase()).sort()).toEqual([...map.directories.keys()].sort());
    expect(windows.hashes.sort()).toEqual([...map.files.values()].map(x => x.sha256).sort());
  });
});
