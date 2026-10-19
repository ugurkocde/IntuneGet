/** Byte-level admission before invoking any native image decoder. */
export function sniffRasterFormat(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'jpeg';
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.toString('latin1', 0, 6))) return 'gif';
  if (buffer.length >= 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export async function readLimited(response, maxBytes) {
  const declared = Number.parseInt(response.headers.get('content-length') || '0', 10);
  if (declared > maxBytes) {
    try {
      await response.body?.cancel();
    } catch {
      // Cleanup failure must not replace the size-limit rejection.
    }
    throw new Error(`Response exceeds ${maxBytes} bytes`);
  }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Response exceeds ${maxBytes} bytes`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

export async function readImage(response, maxBytes) {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.startsWith('image/')) return null;
  const buffer = await readLimited(response, maxBytes);
  return sniffRasterFormat(buffer) ? buffer : null;
}

/** Every call, including metadata and existing files, passes the same guard. */
export function createRasterImageDecoder(sharpFn, options) {
  async function load(buffer) {
    const format = sniffRasterFormat(buffer);
    if (!format) throw new Error('Unsupported icon image format');
    const image = sharpFn(buffer, options);
    const metadata = await image.metadata();
    if (metadata.format !== format) throw new Error('Icon image format does not match its signature');
    return { image, metadata };
  }
  return {
    metadata: async buffer => (await load(buffer)).metadata,
    pipeline: async buffer => (await load(buffer)).image,
  };
}
