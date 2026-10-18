import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Writable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createDeflateRaw } from 'node:zlib';

const ZIP_LIMIT = 0xffffffff;
const MAX_FILES = 65534;
const MAX_PATH_BYTES = 200;
const PAYLOAD_NAME = 'IntunePackage.intunewin';

export interface NativePackagingResult {
  intunewinPath: string;
  encryptedContentPath: string;
  unencryptedContentSize: number;
  encryptedContentSize: number;
  encryptionInfo: {
    encryptionKey: string;
    macKey: string;
    initializationVector: string;
    mac: string;
    profileIdentifier: string;
    fileDigest: string;
    fileDigestAlgorithm: string;
  };
}

const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  let value = byte;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

/** CRC32, with the previous finalized CRC accepted for incremental input. */
export function crc32(bytes: Uint8Array, previous = 0): number {
  let crc = previous ^ 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

export function validateArchivePath(name: string): string {
  const normalized = name.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (!normalized || Buffer.byteLength(normalized) > MAX_PATH_BYTES ||
      normalized.startsWith('/') || /[<>:"|?*\x00-\x1f\x7f]/.test(normalized) ||
      parts.some(part => !part || part === '.' || part === '..' ||
        /[. ]$|^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(part))) {
    throw new Error('Unsafe or unsupported archive path; use a Windows packager');
  }
  return normalized;
}

export function assertZip32(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value >= ZIP_LIMIT) {
    throw new Error('ZIP64 is unsupported; use a Windows packager');
  }
}

async function writeAll(handle: fs.promises.FileHandle, bytes: Buffer, position: number): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, position + offset);
    if (!bytesWritten) throw new Error('Package write made no progress');
    offset += bytesWritten;
  }
}

function sink(handle: fs.promises.FileHandle, start: number, onBytes?: (chunk: Buffer) => void) {
  let position = start;
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      try {
        assertZip32(position + chunk.length);
        onBytes?.(chunk);
      } catch (error) {
        callback(error as Error);
        return;
      }
      writeAll(handle, chunk, position).then(() => {
        position += chunk.length;
        callback();
      }, callback);
    },
  });
  return { stream, position: () => position };
}

interface InputFile { name: string; file: string; stat: fs.Stats }

async function regularDirectory(directory: string, allowMissing = false): Promise<void> {
  for (let current = path.resolve(directory); ; current = path.dirname(current)) {
    try {
      const stat = await fs.promises.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Package paths must be regular directories');
    } catch (error) {
      if (!allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (current === path.dirname(current)) break;
  }
}

async function collectFiles(root: string): Promise<InputFile[]> {
  await regularDirectory(root);
  const seen = new Set<string>();
  const files: InputFile[] = [];
  let total = 0;
  async function visit(directory: string, prefix: string): Promise<void> {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      if (entry.name.includes('\\')) throw new Error('Package entry name contains a literal backslash');
      const name = validateArchivePath(prefix + entry.name);
      const folded = name.toUpperCase();
      if (seen.has(folded)) throw new Error('Case-insensitive archive path collision');
      seen.add(folded);
      if (seen.size > MAX_FILES) throw new Error('Too many package entries; ZIP64 is unsupported');
      const file = path.join(directory, entry.name);
      const stat = await fs.promises.lstat(file);
      if (stat.isSymbolicLink()) throw new Error('Package refuses symbolic links');
      if (stat.isDirectory()) {
        // The Windows reference includes empty directories, without creating
        // redundant entries for directories that already contain files.
        if ((await fs.promises.readdir(file)).length === 0) files.push({ name, file, stat });
        else await visit(file, name + '/');
      }
      else if (stat.isFile()) {
        assertZip32(stat.size);
        total += stat.size;
        assertZip32(total);
        files.push({ name, file, stat });
      } else throw new Error('Package refuses special files');
    }
  }
  await visit(root, '');
  return files;
}

interface ZipEntry { name: Buffer; crc: number; size: number; compressed: number; offset: number; method: number }

class ZipWriter {
  private position = 0;
  private entries: ZipEntry[] = [];
  constructor(private handle: fs.promises.FileHandle) {}

  private async append(bytes: Buffer): Promise<void> {
    assertZip32(this.position + bytes.length);
    await writeAll(this.handle, bytes, this.position);
    this.position += bytes.length;
  }

  async add(name: string, source: Buffer | InputFile, compressed: boolean): Promise<void> {
    if (this.entries.length >= MAX_FILES) throw new Error('Too many package entries; ZIP64 is unsupported');
    const directory = !Buffer.isBuffer(source) && source.stat.isDirectory();
    const filename = Buffer.from(validateArchivePath(name) + (directory ? '/' : ''), 'utf8');
    const offset = this.position;
    if (compressed && (directory || Buffer.isBuffer(source))) throw new Error('Invalid ZIP entry mode');
    const method = compressed ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0x21, 12); // 1980-01-01, reproducible ZIP timestamp.
    local.writeUInt16LE(filename.length, 26);
    await this.append(local);
    await this.append(filename);
    const start = this.position;
    let crc = 0;
    let size = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        try { assertZip32(size); } catch (error) { callback(error as Error); return; }
        crc = crc32(chunk, crc);
        callback(null, chunk);
      },
    });
    if (Buffer.isBuffer(source) || directory) {
      // XML is small and generated here, never installer content.
      const bytes = Buffer.isBuffer(source) ? source : Buffer.alloc(0);
      crc = crc32(bytes);
      size = bytes.length;
      await this.append(bytes);
    } else {
      const target = sink(this.handle, start);
      const opened = await fs.promises.open(source.file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      try {
        const before = await opened.stat();
        if (!before.isFile() || before.dev !== source.stat.dev || before.ino !== source.stat.ino ||
            before.size !== source.stat.size || before.mtimeMs !== source.stat.mtimeMs) {
          throw new Error('Package source changed before reading');
        }
        const input = opened.createReadStream({ autoClose: false });
        if (compressed) await pipeline(input, meter, createDeflateRaw(), target.stream);
        else await pipeline(input, meter, target.stream);
        this.position = target.position();
        const after = await opened.stat();
        if (size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
          throw new Error('Package source changed while reading');
        }
      } finally { await opened.close(); }
    }
    const compressedSize = this.position - start;
    assertZip32(compressedSize);
    const fields = Buffer.alloc(12);
    fields.writeUInt32LE(crc, 0);
    fields.writeUInt32LE(compressedSize, 4);
    fields.writeUInt32LE(size, 8);
    await writeAll(this.handle, fields, offset + 14);
    this.entries.push({ name: filename, crc, size, compressed: compressedSize, offset, method });
  }

  async finish(): Promise<number> {
    const start = this.position;
    for (const entry of this.entries) {
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(0x800, 8);
      central.writeUInt16LE(entry.method, 10);
      central.writeUInt16LE(0x21, 14);
      central.writeUInt32LE(entry.crc, 16);
      central.writeUInt32LE(entry.compressed, 20);
      central.writeUInt32LE(entry.size, 24);
      central.writeUInt16LE(entry.name.length, 28);
      central.writeUInt32LE(entry.offset, 42);
      await this.append(central);
      await this.append(entry.name);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(this.position - start, 12);
    end.writeUInt32LE(start, 16);
    await this.append(end);
    return this.position;
  }
}

async function zipFile(filename: string, add: (zip: ZipWriter) => Promise<void>): Promise<number> {
  const handle = await fs.promises.open(filename, 'wx', 0o600);
  try {
    const zip = new ZipWriter(handle);
    await add(zip);
    return await zip.finish();
  } finally { await handle.close(); }
}

const xmlEscape = (text: string) => text.replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);

/**
 * Standalone native container writer. It does not enable Linux job processing.
 * The caller supplies an already staged package; this function never runs it.
 */
export async function writeIntunewinPackage(
  packageDir: string, setupFile: string, outputDir: string,
): Promise<NativePackagingResult> {
  if (validateArchivePath(setupFile).includes('/')) throw new Error('Setup file must be at the package root');
  if (!setupFile.toLowerCase().endsWith('.exe')) throw new Error('Native setup must be an EXE wrapper');
  if (path.parse(setupFile).name.toUpperCase() === 'INTUNEPACKAGE') {
    throw new Error('Setup basename conflicts with the encrypted payload name');
  }
  const root = path.resolve(packageDir);
  const output = path.resolve(outputDir);
  const relative = path.relative(root, output);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Output directory must be outside the package');
  }
  const files = await collectFiles(root);
  if (!files.some(file => file.name === setupFile && file.stat.isFile())) throw new Error('Setup file is missing');
  await regularDirectory(output, true);
  await fs.promises.mkdir(output, { recursive: true, mode: 0o700 });
  await regularDirectory(output);
  const stage = await fs.promises.mkdtemp(path.join(output, '.intunewin-'));
  const destination = path.join(output, 'intunewin-' + crypto.randomUUID());
  try {
    const innerPath = path.join(stage, 'content.zip');
    const unencryptedContentSize = await zipFile(innerPath, async zip => {
      for (const file of files) await zip.add(file.name, file, file.stat.isFile() && file.stat.size > 0);
    });
    // Hash after ZIP header sizes and CRCs have been patched.
    const digest = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(innerPath)) digest.update(chunk);
    const key = crypto.randomBytes(32), macKey = crypto.randomBytes(32), iv = crypto.randomBytes(16);
    const payloadPath = path.join(stage, PAYLOAD_NAME);
    const handle = await fs.promises.open(payloadPath, 'wx', 0o600);
    let encryptedContentSize: number;
    let mac: Buffer;
    try {
      await writeAll(handle, Buffer.concat([Buffer.alloc(32), iv]), 0);
      const hmac = crypto.createHmac('sha256', macKey).update(iv);
      const target = sink(handle, 48, chunk => { hmac.update(chunk); });
      await pipeline(fs.createReadStream(innerPath), crypto.createCipheriv('aes-256-cbc', key, iv), target.stream);
      encryptedContentSize = target.position();
      mac = hmac.digest();
      await writeAll(handle, mac, 0);
    } finally { await handle.close(); }
    const encryptionInfo = {
      encryptionKey: key.toString('base64'), macKey: macKey.toString('base64'),
      initializationVector: iv.toString('base64'), mac: mac.toString('base64'),
      profileIdentifier: 'ProfileVersion1', fileDigest: digest.digest('base64'), fileDigestAlgorithm: 'SHA256',
    };
    const xml = '<ApplicationInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ToolVersion="1.0.0.0">\r\n' +
      '  <Name>' + xmlEscape(setupFile) + '</Name>\r\n' +
      '  <UnencryptedContentSize>' + unencryptedContentSize + '</UnencryptedContentSize>\r\n' +
      '  <FileName>' + PAYLOAD_NAME + '</FileName>\r\n' +
      '  <SetupFile>' + xmlEscape(setupFile) + '</SetupFile>\r\n  <EncryptionInfo>\r\n' +
      Object.entries(encryptionInfo).map(([name, value]) =>
        '    <' + name[0].toUpperCase() + name.slice(1) + '>' + xmlEscape(value) +
        '</' + name[0].toUpperCase() + name.slice(1) + '>').join('\r\n') +
      '\r\n  </EncryptionInfo>\r\n</ApplicationInfo>';
    const container = path.parse(setupFile).name + '.intunewin';
    const payloadStat = await fs.promises.lstat(payloadPath);
    await zipFile(path.join(stage, container), async zip => {
      await zip.add('IntuneWinPackage/Contents/' + PAYLOAD_NAME,
        { name: PAYLOAD_NAME, file: payloadPath, stat: payloadStat }, false);
      await zip.add('IntuneWinPackage/Metadata/Detection.xml', Buffer.from(xml), false);
    });
    await fs.promises.unlink(innerPath);
    await fs.promises.rename(stage, destination);
    return {
      intunewinPath: path.join(destination, container),
      encryptedContentPath: path.join(destination, PAYLOAD_NAME),
      unencryptedContentSize, encryptedContentSize, encryptionInfo,
    };
  } catch (error) {
    // This private random directory was created by this invocation only.
    try {
      const artifacts = await fs.promises.readdir(stage);
      for (const name of artifacts) await fs.promises.unlink(path.join(stage, name));
      await fs.promises.rmdir(stage);
    } catch {
      // A cleanup failure must not replace the packaging failure. The caller
      // still owns the job directory and its final cleanup.
    }
    throw error;
  }
}
