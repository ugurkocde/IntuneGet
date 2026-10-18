import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertZip32, crc32, validateArchivePath, writeIntunewinPackage } from '../src/intunewin-writer';
import reference from './fixtures/intunewin-format.json';

const temporary: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of temporary.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'intuneget-writer-test-'));
  temporary.push(root);
  const input = path.join(root, 'input'), output = path.join(root, 'output');
  await fs.mkdir(path.join(input, 'Files'), { recursive: true });
  await fs.mkdir(path.join(input, 'EmptyDir'));
  const files = {
    'Invoke-AppDeployToolkit.exe': 'Synthetic format fixture. This is not an executable.\n',
    'Files/payload.txt': 'IntuneGet synthetic payload for native writer comparison.\n',
    'Files/empty.txt': '',
  };
  for (const [name, bytes] of Object.entries(files)) await fs.writeFile(path.join(input, name), bytes);
  return { root, input, output, files };
}

// Independent ZIP reader used only on small synthetic output, with central and
// local header, CRC, sizes, offsets and end record checks.
function unzip(bytes: Buffer): Map<string, Buffer> {
  const end = bytes.length - 22;
  expect(bytes.readUInt32LE(end)).toBe(0x06054b50);
  expect(bytes.readUInt16LE(end + 4)).toBe(0);
  const count = bytes.readUInt16LE(end + 10);
  let central = bytes.readUInt32LE(end + 16);
  expect(central + bytes.readUInt32LE(end + 12)).toBe(end);
  const result = new Map<string, Buffer>();
  for (let index = 0; index < count; index++) {
    expect(bytes.readUInt32LE(central)).toBe(0x02014b50);
    const flags = bytes.readUInt16LE(central + 8), method = bytes.readUInt16LE(central + 10);
    expect(flags & 1).toBe(0);
    expect(flags & 8).toBe(0);
    const compressed = bytes.readUInt32LE(central + 20), size = bytes.readUInt32LE(central + 24);
    const nameLength = bytes.readUInt16LE(central + 28);
    const name = bytes.subarray(central + 46, central + 46 + nameLength).toString('utf8').replace(/\\/g, '/');
    const local = bytes.readUInt32LE(central + 42);
    expect(bytes.readUInt32LE(local)).toBe(0x04034b50);
    expect(bytes.readUInt16LE(local + 6)).toBe(flags);
    expect(bytes.readUInt16LE(local + 8)).toBe(method);
    expect(bytes.readUInt32LE(local + 14)).toBe(bytes.readUInt32LE(central + 16));
    expect(bytes.readUInt32LE(local + 18)).toBe(compressed);
    expect(bytes.readUInt32LE(local + 22)).toBe(size);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    expect(start + compressed).toBeLessThanOrEqual(bytes.readUInt32LE(end + 16));
    const content = bytes.subarray(start, start + compressed);
    const uncompressed = method === 8 ? inflateRawSync(content) : content;
    expect([0, 8]).toContain(method);
    expect(uncompressed.length).toBe(size);
    expect(crc32(uncompressed)).toBe(bytes.readUInt32LE(central + 16));
    expect(result.has(name)).toBe(false);
    result.set(name, uncompressed);
    central += 46 + nameLength + bytes.readUInt16LE(central + 30) + bytes.readUInt16LE(central + 32);
  }
  expect(central).toBe(end);
  return result;
}

describe('standalone native intunewin format', () => {
  it('matches the Windows reference structure and decrypts back to every source file', async () => {
    const { input, output, files } = await fixture();
    const result = await writeIntunewinPackage(input, 'Invoke-AppDeployToolkit.exe', output);
    const outer = unzip(await fs.readFile(result.intunewinPath));
    expect([...outer.keys()]).toEqual(reference.outerEntries);
    const xml = outer.get('IntuneWinPackage/Metadata/Detection.xml')!.toString();
    const value = (name: string) => xml.match(new RegExp('<' + name + '>([^<]*)</' + name + '>'))![1];
    expect(value('Name')).toBe(reference.setupFile);
    expect(value('SetupFile')).toBe(reference.setupFile);
    expect(value('FileName')).toBe(reference.payloadName);
    expect(value('ProfileIdentifier')).toBe(reference.profileIdentifier);
    expect(value('FileDigestAlgorithm')).toBe(reference.fileDigestAlgorithm);
    expect(xml).toContain('ToolVersion="1.0.0.0"');
    const payload = await fs.readFile(result.encryptedContentPath);
    expect(payload.equals(outer.get('IntuneWinPackage/Contents/IntunePackage.intunewin')!)).toBe(true);
    expect(payload.length).toBe(result.encryptedContentSize);
    const encryption = result.encryptionInfo;
    const key = Buffer.from(encryption.encryptionKey, 'base64'), macKey = Buffer.from(encryption.macKey, 'base64');
    const iv = Buffer.from(encryption.initializationVector, 'base64'), mac = Buffer.from(encryption.mac, 'base64');
    expect(key.length).toBe(32); expect(macKey.length).toBe(32); expect(iv.length).toBe(16);
    expect(payload.subarray(0, 32).equals(mac)).toBe(true);
    expect(payload.subarray(32, 48).equals(iv)).toBe(true);
    expect(crypto.createHmac('sha256', macKey).update(payload.subarray(32)).digest().equals(mac)).toBe(true);
    const decrypt = crypto.createDecipheriv('aes-256-cbc', key, iv);
    const inner = Buffer.concat([decrypt.update(payload.subarray(48)), decrypt.final()]);
    expect(inner.length).toBe(result.unencryptedContentSize);
    expect(Number(value('UnencryptedContentSize'))).toBe(inner.length);
    expect(payload.length).toBe(48 + 16 * (Math.floor(inner.length / 16) + 1));
    expect(crypto.createHash('sha256').update(inner).digest('base64')).toBe(encryption.fileDigest);
    for (const [name, text] of Object.entries(encryption)) {
      expect(value(name[0].toUpperCase() + name.slice(1))).toBe(text);
    }
    const contents = unzip(inner);
    expect([...contents.keys()].sort()).toEqual([...Object.keys(files), 'EmptyDir/'].sort());
    for (const [name, content] of Object.entries(files)) expect(contents.get(name)!.toString()).toBe(content);
    // These CRCs were derived independently from the pinned Windows tool,
    // rather than from the native writer's checksum implementation.
    for (const [name, expected] of Object.entries(reference.fileCrc32)) {
      expect(crc32(contents.get(name)!)).toBe(expected);
    }
    expect(contents.get('EmptyDir/')!.length).toBe(0);
    expect(await fs.readdir(path.dirname(result.intunewinPath))).toEqual(expect.arrayContaining([
      'IntunePackage.intunewin', 'Invoke-AppDeployToolkit.intunewin',
    ]));
    expect(await fs.readdir(path.dirname(result.intunewinPath))).not.toContain('content.zip');
  });

  it('uses fresh encryption material and independent private destinations on repeat runs', async () => {
    const { input, output } = await fixture();
    const first = await writeIntunewinPackage(input, 'Invoke-AppDeployToolkit.exe', output);
    const second = await writeIntunewinPackage(input, 'Invoke-AppDeployToolkit.exe', output);
    expect(first.intunewinPath).not.toBe(second.intunewinPath);
    expect(first.encryptionInfo.encryptionKey).not.toBe(second.encryptionInfo.encryptionKey);
    expect(first.encryptionInfo.macKey).not.toBe(second.encryptionInfo.macKey);
    expect(first.encryptionInfo.initializationVector).not.toBe(second.encryptionInfo.initializationVector);
    expect(first.encryptionInfo.fileDigest).toBe(second.encryptionInfo.fileDigest);
  });

  it('leaves no staged or final package after an encryption failure', async () => {
    const { input, output } = await fixture();
    vi.spyOn(crypto, 'createCipheriv').mockImplementation(() => { throw new Error('synthetic crypto failure'); });
    await expect(writeIntunewinPackage(input, 'Invoke-AppDeployToolkit.exe', output)).rejects.toThrow('synthetic');
    expect(await fs.readdir(output)).toEqual([]);
  });

  it('refuses a missing setup file and an output directory inside the input', async () => {
    const { input, output } = await fixture();
    await expect(writeIntunewinPackage(input, 'missing.exe', output)).rejects.toThrow('missing');
    await expect(writeIntunewinPackage(input, 'Invoke-AppDeployToolkit.exe', path.join(input, 'out')))
      .rejects.toThrow('outside');
  });

  it('refuses a directory junction or symbolic link without traversing it', async () => {
    const { input, output, root } = await fixture();
    const other = path.join(root, 'outside');
    await fs.mkdir(other);
    await fs.writeFile(path.join(other, 'private.txt'), 'must not enter the package');
    await fs.symlink(other, path.join(input, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(writeIntunewinPackage(input, 'Invoke-AppDeployToolkit.exe', output)).rejects.toThrow(/links/);
  });

  it('refuses a linked output ancestor before creating directories outside the job', async () => {
    const { input, root } = await fixture();
    const outside = path.join(root, 'outside');
    await fs.mkdir(outside);
    const link = path.join(root, 'linked-output');
    await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(writeIntunewinPackage(input, 'Invoke-AppDeployToolkit.exe', path.join(link, 'new-output')))
      .rejects.toThrow('regular directories');
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it('escapes XML metadata and retains UTF-8 names and multi-chunk binary content', async () => {
    const { input, output } = await fixture();
    const setup = "Setup &'.exe";
    await fs.rename(path.join(input, 'Invoke-AppDeployToolkit.exe'), path.join(input, setup));
    const content = crypto.randomBytes(256 * 1024);
    await fs.writeFile(path.join(input, 'Files', 'caf\u00e9.bin'), content);
    const result = await writeIntunewinPackage(input, setup, output);
    const outer = unzip(await fs.readFile(result.intunewinPath));
    const xml = outer.get('IntuneWinPackage/Metadata/Detection.xml')!.toString();
    expect(xml).toContain('<SetupFile>Setup &amp;&apos;.exe</SetupFile>');
    const encrypted = await fs.readFile(result.encryptedContentPath);
    const cipher = crypto.createDecipheriv('aes-256-cbc',
      Buffer.from(result.encryptionInfo.encryptionKey, 'base64'),
      Buffer.from(result.encryptionInfo.initializationVector, 'base64'));
    const contents = unzip(Buffer.concat([cipher.update(encrypted.subarray(48)), cipher.final()]));
    expect(contents.get('Files/caf\u00e9.bin')!.equals(content)).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('rejects case collisions on a case-sensitive host', async () => {
    const { input, output } = await fixture();
    await fs.writeFile(path.join(input, 'SAME.txt'), 'first');
    await fs.writeFile(path.join(input, 'same.txt'), 'second');
    await expect(writeIntunewinPackage(input, 'Invoke-AppDeployToolkit.exe', output)).rejects.toThrow('collision');
  });
});

describe('native ZIP primitives', () => {
  it('matches the standard CRC32 vector, including incremental and empty inputs', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    expect(crc32(Buffer.from(''))).toBe(0);
    expect(crc32(Buffer.from('56789'), crc32(Buffer.from('1234')))).toBe(0xcbf43926);
  });
  it.each(['', '../a', '/a', 'C:\\a', 'folder/../a', 'folder/./a', 'folder//a',
    'a\u0000b', 'a:b', 'con.txt', 'folder/NUL', 'name.', 'name ', 'x'.repeat(201)])(
    'rejects unsafe or unsupported name %j', name => expect(() => validateArchivePath(name)).toThrow(),
  );
  it('normalizes backslashes and preserves safe Unicode names', () => {
    expect(validateArchivePath('Files\\payload.txt')).toBe('Files/payload.txt');
    expect(validateArchivePath('Files/caf\u00e9.txt')).toBe('Files/caf\u00e9.txt');
  });
  it.each([-1, NaN, Infinity, 0xffffffff, 0x100000000, 1.5])(
    'rejects ZIP64 and invalid sizes %s', size => expect(() => assertZip32(size)).toThrow(),
  );
  it('accepts the largest supported ZIP32 value', () => expect(() => assertZip32(0xfffffffe)).not.toThrow());
});
