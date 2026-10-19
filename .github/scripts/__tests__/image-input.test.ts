import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import sharp from 'sharp';
import { createRasterImageDecoder, readImage, readLimited, sniffRasterFormat } from '../image-input.mjs';

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
const options = { limitInputPixels: 4096 * 4096, failOn: 'error' };

describe('raster signatures', () => {
  it.each([
    ['png', png], ['jpeg', Buffer.from([255, 216, 255, 224])],
    ['gif', Buffer.from('GIF87a')], ['gif', Buffer.from('GIF89a')],
    ['webp', Buffer.from('RIFF\0\0\0\0WEBP')],
  ])('accepts the %s signature', (format, buffer) => {
    expect(sniffRasterFormat(buffer)).toBe(format);
  });

  it.each([
    svg, Buffer.from('<?xml version="1.0"?><svg/>'), Buffer.concat([Buffer.from([239, 187, 191]), svg]),
    Buffer.from(' \n<svg/>'), Buffer.from('<!DOCTYPE html>'), Buffer.from('RIFF\0\0\0\0AVI '),
    Buffer.from('\0\0\0\x18ftypavif'), Buffer.from('II*\0'), Buffer.from('BM'),
    Buffer.from([0, 0, 1, 0]), Buffer.alloc(0), png.subarray(0, 7), Buffer.from([255, 216]),
    Buffer.from('GIF89'), Buffer.from('RIFF\0\0\0\0WEB'),
    Buffer.from([71, 73, 198, 56, 57, 97]), Buffer.from([210, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]),
  ])('rejects unsupported and truncated bytes without decoding', buffer => {
    expect(sniffRasterFormat(buffer)).toBeNull();
  });
});

describe('bounded image responses', () => {
  it.each(['image/svg+xml', 'image/png'])('rejects SVG labeled %s', async contentType => {
    expect(await readImage(new Response(svg, { headers: { 'content-type': contentType } }), 1024)).toBeNull();
  });

  it('returns admitted bytes and rejects nonimage content', async () => {
    expect(await readImage(new Response(png, { headers: { 'content-type': 'image/png' } }), 1024)).toEqual(png);
    expect(await readImage(new Response(png, { headers: { 'content-type': 'text/html' } }), 1024)).toBeNull();
  });

  it('keeps both declared and streamed byte limits', async () => {
    await expect(readImage(new Response(png, { headers: { 'content-type': 'image/png', 'content-length': '2048' } }), 1024)).rejects.toThrow('exceeds');
    await expect(readImage(new Response(png, { headers: { 'content-type': 'image/png' } }), 4)).rejects.toThrow('exceeds');
    expect(await readLimited(new Response('html'), 10)).toEqual(Buffer.from('html'));
  });

  it('cancels a response rejected by its declared size', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), {
      headers: { 'content-type': 'image/png', 'content-length': '2048' },
    });
    await expect(readImage(response, 1024)).rejects.toThrow('Response exceeds 1024 bytes');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('keeps the size rejection when cancelling the body fails', async () => {
    const cancel = vi.fn().mockRejectedValue(new Error('Cancellation failed'));
    const response = new Response(new ReadableStream({ cancel }), {
      headers: { 'content-type': 'image/png', 'content-length': '2048' },
    });
    await expect(readImage(response, 1024)).rejects.toThrow('Response exceeds 1024 bytes');
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe('native decoder boundary', () => {
  it('never invokes the decoder for SVG, including an existing file buffer', async () => {
    const sharp = vi.fn();
    const decoder = createRasterImageDecoder(sharp, options);
    await expect(decoder.metadata(svg)).rejects.toThrow('Unsupported');
    await expect(decoder.pipeline(svg)).rejects.toThrow('Unsupported');
    expect(sharp).not.toHaveBeenCalled();
  });

  it('preserves decoder limits and exposes the validated pipeline', async () => {
    const image = { metadata: vi.fn().mockResolvedValue({ format: 'png', width: 64, height: 64 }) };
    const sharp = vi.fn().mockReturnValue(image);
    const decoder = createRasterImageDecoder(sharp, options);
    expect(await decoder.metadata(png)).toMatchObject({ format: 'png', width: 64 });
    expect(await decoder.pipeline(png)).toBe(image);
    expect(sharp).toHaveBeenCalledWith(png, options);
  });

  it('rejects a decoded format that disagrees with the admitted signature', async () => {
    const decoder = createRasterImageDecoder(vi.fn().mockReturnValue({ metadata: vi.fn().mockResolvedValue({ format: 'svg' }) }), options);
    await expect(decoder.metadata(png)).rejects.toThrow('does not match');
    await expect(decoder.pipeline(png)).rejects.toThrow('does not match');
  });

  it('routes every production Sharp call through the guarded decoder', () => {
    const source = fs.readFileSync('.github/scripts/fetch-web-icons.mjs', 'utf8');
    expect(source).not.toMatch(/\bsharp\s*\(/);
    expect(source).toContain('createRasterImageDecoder(sharp,');
  });

  it.each(['png', 'jpeg', 'gif', 'webp'] as const)('keeps real %s raster processing usable', async format => {
    // Only task-generated pixels enter the native library, never SVG or a download.
    const buffer = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#224466' } }).toFormat(format).toBuffer();
    const decoder = createRasterImageDecoder(sharp, options);
    expect(await decoder.metadata(buffer)).toMatchObject({ format, width: 2, height: 2 });
    const output = await (await decoder.pipeline(buffer)).resize(1, 1).png().toBuffer();
    expect(await decoder.metadata(output)).toMatchObject({ format: 'png', width: 1, height: 1 });
  });
});
