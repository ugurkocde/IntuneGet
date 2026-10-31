import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createInflateRaw } from 'node:zlib';
import manifest from '../scripts/tool-manifest.json';
import { crc32 } from './intunewin-writer';

/** Fixed ceilings for the pinned toolkit, including actual decompressed bytes. */
export const TOOLKIT_LIMITS = Object.freeze({ entries: 4096, archiveBytes: 128 * 1024 * 1024,
  entryBytes: 64 * 1024 * 1024, totalBytes: 256 * 1024 * 1024 });

interface ToolkitFile { name: string; bytes: Buffer; sha256: string }
export interface ToolkitMap {
  files: Map<string, ToolkitFile>;
  directories: Map<string, string>;
}
interface Entry {
  name: string; directory: boolean; offset: number; start: number; end: number;
  flags: number; method: number; crc: number; size: number; compressed: number;
}
const fold = (name: string) => name.toUpperCase();
const hash = (bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();

function range(start: number, length: number, end: number): number {
  if (start < 0 || length < 0 || !Number.isSafeInteger(start + length) || start + length > end) {
    throw new Error('Malformed or truncated toolkit ZIP');
  }
  return start + length;
}

/** Same name/ancestor rules as Get-PackagerArchiveMap in tool-integrity.ps1. */
function archiveName(bytes: Buffer, utf8: boolean): { name: string; directory: boolean } {
  if (!utf8 && bytes.some(byte => byte > 127)) throw new Error('Unsupported legacy ZIP path encoding');
  const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes).replace(/\\/g, '/');
  const name = raw.replace(/\/+$/, ''), parts = name.split('/');
  if (bytes.length > 1024 || parts.length > 64) throw new Error('Toolkit path exceeds fixed resource bound');
  if (!name || raw.startsWith('/') || /[<>:"|?*\x00]/.test(raw) ||
      parts.some(part => !part || part === '.' || part === '..' ||
        /[. ]$|^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(part))) {
    throw new Error('Unsafe path in pinned toolkit archive');
  }
  return { name, directory: raw.endsWith('/') };
}

function extraFields(bytes: Buffer): void {
  for (let at = 0; at < bytes.length;) {
    range(at, 4, bytes.length);
    const id = bytes.readUInt16LE(at), length = bytes.readUInt16LE(at + 2);
    if (id === 1) throw new Error('ZIP64 toolkit archives are unsupported');
    at = range(at + 4, length, bytes.length);
  }
}

/** Parse only ZIP32 single-disk store/deflate records with matching local headers. */
function entries(bytes: Buffer): Entry[] {
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557)) {
    if (bytes.readUInt32LE(end) === 0x06054b50 && end + 22 + bytes.readUInt16LE(end + 20) === bytes.length) break;
    end--;
  }
  if (end < Math.max(0, bytes.length - 65557)) throw new Error('Malformed toolkit ZIP end record');
  const count = bytes.readUInt16LE(end + 10), centralSize = bytes.readUInt32LE(end + 12), central = bytes.readUInt32LE(end + 16);
  if (count === 0xffff || centralSize === 0xffffffff || central === 0xffffffff) throw new Error('ZIP64 is unsupported');
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 8) !== count) {
    throw new Error('Split toolkit ZIP disks are unsupported');
  }
  if (!count || count > TOOLKIT_LIMITS.entries) throw new Error('Toolkit entry count exceeds fixed bound');
  if (range(central, centralSize, end) !== end) throw new Error('Malformed toolkit central directory size');
  const result: Entry[] = []; let at = central, declaredTotal = 0;
  for (let i = 0; i < count; i++) {
    range(at, 46, end);
    if (bytes.readUInt32LE(at) !== 0x02014b50) throw new Error('Malformed toolkit central header');
    const flags = bytes.readUInt16LE(at + 8), method = bytes.readUInt16LE(at + 10);
    const crc = bytes.readUInt32LE(at + 16), compressed = bytes.readUInt32LE(at + 20), size = bytes.readUInt32LE(at + 24);
    const nameSize = bytes.readUInt16LE(at + 28), extraSize = bytes.readUInt16LE(at + 30), commentSize = bytes.readUInt16LE(at + 32);
    const offset = bytes.readUInt32LE(at + 42), attributes = bytes.readUInt32LE(at + 38);
    if (bytes.readUInt16LE(at + 6) >= 45 || [compressed, size, offset].includes(0xffffffff)) throw new Error('ZIP64 is unsupported');
    if (bytes.readUInt16LE(at + 34)) throw new Error('Split ZIP disk is unsupported');
    if (flags & ~0x080e || (method === 0 && (flags & 6))) throw new Error('Encrypted or unsupported toolkit ZIP flags');
    if (![0, 8].includes(method)) throw new Error('Unsupported toolkit compression method');
    if (size > TOOLKIT_LIMITS.entryBytes || (declaredTotal += size) > TOOLKIT_LIMITS.totalBytes) throw new Error('Toolkit size exceeds fixed bound');
    const nameStart = at + 46, nameEnd = range(nameStart, nameSize, end), extraEnd = range(nameEnd, extraSize, end);
    const nameBytes = bytes.subarray(nameStart, nameEnd), parsed = archiveName(nameBytes, !!(flags & 0x800));
    extraFields(bytes.subarray(nameEnd, extraEnd));
    const type = (attributes >>> 16) & 0xf000;
    if (type && type !== (parsed.directory ? 0x4000 : 0x8000)) throw new Error('Toolkit ZIP special file type or inconsistent attributes');
    if (attributes & 0x448 || (!parsed.directory && (attributes & 0x10))) throw new Error('Toolkit ZIP special file attributes');
    if (parsed.directory && (size || crc)) throw new Error('Toolkit directory contains file data');
    range(offset, 30, central);
    if (bytes.readUInt32LE(offset) !== 0x04034b50 || bytes.readUInt16LE(offset + 4) >= 45 ||
        bytes.readUInt16LE(offset + 6) !== flags || bytes.readUInt16LE(offset + 8) !== method) throw new Error('Toolkit local header mismatch');
    const localNameSize = bytes.readUInt16LE(offset + 26), localExtraSize = bytes.readUInt16LE(offset + 28);
    const localNameEnd = range(offset + 30, localNameSize, central), start = range(localNameEnd, localExtraSize, central);
    if (!nameBytes.equals(bytes.subarray(offset + 30, localNameEnd))) throw new Error('Toolkit local path mismatch');
    extraFields(bytes.subarray(localNameEnd, start));
    for (const [field, expected] of [[14, crc], [18, compressed], [22, size]]) {
      const actual = bytes.readUInt32LE(offset + field);
      if (actual !== expected && (!(flags & 8) || actual !== 0)) throw new Error('Toolkit local size or CRC mismatch');
    }
    let finish = range(start, compressed, central);
    if (flags & 8) {
      range(finish, 12, central);
      const signature = bytes.readUInt32LE(finish) === 0x08074b50;
      const dd = finish + (signature ? 4 : 0); range(dd, 12, central);
      if (bytes.readUInt32LE(dd) !== crc || bytes.readUInt32LE(dd + 4) !== compressed || bytes.readUInt32LE(dd + 8) !== size) {
        throw new Error('Toolkit ZIP descriptor mismatch');
      }
      finish = dd + 12;
    }
    result.push({ ...parsed, offset, start, end: finish, flags, method, crc, size, compressed });
    at = range(extraEnd, commentSize, end);
  }
  if (at !== end) throw new Error('Toolkit central directory has trailing records');
  let next = 0;
  for (const entry of [...result].sort((a, b) => a.offset - b.offset)) {
    if (entry.offset !== next) throw new Error('Toolkit ZIP overlapping or unlisted local records');
    next = entry.end;
  }
  if (next !== central) throw new Error('Toolkit ZIP has unlisted trailing data');
  return result;
}

/** Hash the whole immutable byte snapshot against the shipped pin before parsing. */
export async function readPinnedToolkitArchive(archive: Buffer): Promise<ToolkitMap> {
  const pin = manifest.psadtTemplate.sha256;
  if (!/^[A-F0-9]{64}$/.test(pin)) throw new Error('Invalid shipped toolkit hash pin');
  if (archive.length > TOOLKIT_LIMITS.archiveBytes) throw new Error('Toolkit archive exceeds fixed bound');
  const bytes = Buffer.from(archive);
  if (hash(bytes) !== pin) throw new Error('TOOL_HASH_MISMATCH: toolkit archive differs from the shipped pin');
  const records = entries(bytes), seen = new Set<string>();
  const map: ToolkitMap = { files: new Map(), directories: new Map() };
  let total = 0;
  for (const entry of records) {
    const key = fold(entry.name);
    if (seen.has(key)) throw new Error('Duplicate normalized toolkit path');
    seen.add(key);
    const parts = entry.name.split('/');
    for (let i = 1; i < parts.length; i++) {
      const name = parts.slice(0, i).join('/'); map.directories.set(fold(name), name);
    }
    if (entry.directory) map.directories.set(key, entry.name);
    const content = bytes.subarray(entry.start, entry.start + entry.compressed), chunks: Buffer[] = [];
    let size = 0, crc = 0;
    const accept = (chunk: Buffer) => {
      size += chunk.length; total += chunk.length;
      if (size > entry.size || size > TOOLKIT_LIMITS.entryBytes || total > TOOLKIT_LIMITS.totalBytes) throw new Error('Toolkit decompression exceeds size bound');
      crc = crc32(chunk, crc); chunks.push(chunk);
    };
    if (entry.method === 0) accept(content);
    else {
      const inflater = createInflateRaw({ chunkSize: 16 * 1024 });
      try {
        inflater.end(content);
        for await (const chunk of inflater) accept(chunk as Buffer);
        if (inflater.bytesWritten !== content.length) throw new Error('Toolkit compressed stream has trailing data');
      } finally { inflater.destroy(); }
    }
    if (size !== entry.size || crc !== entry.crc) throw new Error('Toolkit expanded size or CRC mismatch');
    if (!entry.directory) {
      const expanded = Buffer.concat(chunks, size);
      map.files.set(key, { name: entry.name, bytes: expanded, sha256: hash(expanded) });
    }
  }
  for (const key of map.files.keys()) if (map.directories.has(key)) throw new Error('Toolkit file and directory collide');
  if (!map.files.has('INVOKE-APPDEPLOYTOOLKIT.EXE') || !map.directories.has('PSAPPDEPLOYTOOLKIT')) throw new Error('Pinned toolkit archive has an invalid layout');
  return map;
}

async function regularPath(directory: string): Promise<void> {
  for (let current = path.resolve(directory); ; current = path.dirname(current)) {
    try { const stat = await fs.promises.lstat(current); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Toolkit requires regular directories without links'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (current === path.dirname(current)) break;
  }
}

/** Exact complete tree check, including extra/missing directories and file hashes. */
export async function assertToolkitTree(directory: string, map: ToolkitMap): Promise<void> {
  await regularPath(directory);
  const files = new Set<string>(), dirs = new Set<string>();
  async function visit(root: string, prefix: string): Promise<void> {
    for (const item of await fs.promises.readdir(root, { withFileTypes: true })) {
      const name = prefix + item.name, key = fold(name), file = path.join(root, item.name);
      const stat = await fs.promises.lstat(file);
      if (stat.isSymbolicLink()) throw new Error('Toolkit integrity refuses links');
      if (stat.isDirectory()) {
        if (!map.directories.has(key) || dirs.has(key)) throw new Error('Unexpected toolkit directory');
        dirs.add(key); await visit(file, name + '/');
      } else if (stat.isFile()) {
        const expected = map.files.get(key);
        if (!expected || files.has(key)) throw new Error('Unexpected toolkit file');
        if (stat.size !== expected.bytes.length) throw new Error('Toolkit file hash mismatch');
        const handle = await fs.promises.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
        try {
          const opened = await handle.stat();
          if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== expected.bytes.length) throw new Error('Toolkit file hash mismatch');
          const digest = crypto.createHash('sha256'); let size = 0;
          for await (const chunk of handle.createReadStream({ autoClose: false, start: 0, end: expected.bytes.length })) {
            size += chunk.length;
            if (size > expected.bytes.length) throw new Error('Toolkit file grew beyond expected size');
            digest.update(chunk);
          }
          const after = await handle.stat();
          if (size !== expected.bytes.length || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || digest.digest('hex').toUpperCase() !== expected.sha256) throw new Error('Toolkit file hash mismatch');
        } finally { await handle.close(); }
        files.add(key);
      } else throw new Error('Toolkit integrity refuses special files');
    }
  }
  await visit(directory, '');
  if (files.size !== map.files.size || dirs.size !== map.directories.size) throw new Error('Toolkit integrity found missing files or directories');
}

/** Standalone initialization only; never runs a toolkit payload or changes Windows routing. */
export async function initializePinnedToolkit(archive: Buffer, toolsDirectory: string): Promise<string> {
  const map = await readPinnedToolkitArchive(archive);
  if (manifest.psadtTemplate.extractDir !== 'PSAppDeployToolkit') throw new Error('Invalid shipped toolkit directory');
  const root = path.resolve(toolsDirectory);
  if (root === path.parse(root).root) throw new Error('Tools directory cannot be a filesystem root');
  await regularPath(root); await fs.promises.mkdir(root, { recursive: true, mode: 0o700 }); await regularPath(root);
  const destination = path.join(root, manifest.psadtTemplate.extractDir);
  let exists = true;
  try { await fs.promises.lstat(destination); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; exists = false; }
  if (exists) { await assertToolkitTree(destination, map); return destination; }
  const stage = await fs.promises.mkdtemp(path.join(root, '.staging-'));
  // Resolve each directory spelling through the case-insensitive archive map,
  // so a valid Windows archive also produces one directory on a Linux host.
  const physical = (name: string, directory: boolean) => name.split('/').map((part, i, parts) =>
    i < parts.length - 1 || directory ? map.directories.get(fold(parts.slice(0, i + 1).join('/')))!.split('/').at(-1)! : part);
  // Like the Windows verifier, retain failed private staging rather than delete a
  // configurable cache tree. It is never reused as a verified toolkit.
  for (const name of [...map.directories.values()].sort((a, b) => a.length - b.length)) {
    await fs.promises.mkdir(path.join(stage, ...physical(name, true)), { recursive: true, mode: 0o700 });
  }
  for (const file of map.files.values()) {
    await fs.promises.writeFile(path.join(stage, ...physical(file.name, false)), file.bytes, { flag: 'wx', mode: 0o600 });
  }
  await assertToolkitTree(stage, map);
  await fs.promises.rename(stage, destination);
  return destination;
}
