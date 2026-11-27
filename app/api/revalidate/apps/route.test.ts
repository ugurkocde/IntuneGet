import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ revalidatePath }));

import { POST } from './route';

function post(body: unknown) {
  return new NextRequest('https://test.invalid/api/revalidate/apps', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  revalidatePath.mockClear();
  vi.stubEnv('CALLBACK_SECRET', '');
  vi.stubEnv('NODE_ENV', 'test');
});

describe('POST /api/revalidate/apps', () => {
  it('revalidates each app page once and skips invalid ids', async () => {
    const response = await POST(post({
      wingetIds: ['Google.Chrome', 'Google.Chrome', 'not an id', 'Mozilla.Firefox', 'Mozilla.Firefox'],
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      revalidated: ['Google.Chrome', 'Mozilla.Firefox'],
      skipped: ['not an id'],
    });
    expect(revalidatePath).toHaveBeenCalledTimes(2);
    expect(revalidatePath).toHaveBeenNthCalledWith(1, '/apps/Google.Chrome');
    expect(revalidatePath).toHaveBeenNthCalledWith(2, '/apps/Mozilla.Firefox');
  });

  it('rejects an empty list before purging any page', async () => {
    const response = await POST(post({ wingetIds: [] }));
    expect(response.status).toBe(400);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('rejects more than 50 ids before purging any page', async () => {
    const wingetIds = Array.from({ length: 51 }, (_, index) => `Vendor.App${index}`);
    const response = await POST(post({ wingetIds }));
    expect(response.status).toBe(400);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
