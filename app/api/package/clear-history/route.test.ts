import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const fixture = vi.hoisted(() => ({ archive: vi.fn(), user: { userId: 'owner' } as { userId: string } | null }));
vi.mock('@/lib/auth-utils', () => ({ parseAccessToken: async () => fixture.user }));
vi.mock('@/lib/db', () => ({ getDatabase: () => ({ jobs: { deleteByUserIdAndStatuses: fixture.archive } }) }));
import { POST } from './route';

const call = (body: unknown = {}) => POST(new NextRequest('http://localhost/api/package/clear-history', {
 method: 'POST', headers: { Authorization: 'Bearer fixture-token', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));
beforeEach(() => { fixture.user = { userId: 'owner' }; fixture.archive.mockReset().mockResolvedValue(2); });

it('archives stopped jobs with the other terminal jobs for the authenticated owner', async () => {
 const response = await call({ userId: 'other' });
 expect(response.status).toBe(200);
 expect(await response.json()).toEqual({ success: true, archivedCount: 2 });
 expect(fixture.archive).toHaveBeenCalledWith('owner', expect.arrayContaining(['qa_failed', 'failed', 'cancelled', 'completed', 'deployed', 'duplicate_skipped']));
 expect(fixture.archive.mock.calls[0][1]).not.toContain('awaiting_qa');
});

it('accepts a request to archive only stopped deployments', async () => {
 expect((await call({ statuses: ['qa_failed'] })).status).toBe(200);
 expect(fixture.archive).toHaveBeenCalledWith('owner', ['qa_failed']);
});

it('rejects active or unknown statuses without archiving anything', async () => {
 expect((await call({ statuses: ['queued', 'unknown'] })).status).toBe(400);
 expect(fixture.archive).not.toHaveBeenCalled();
});

it('requires authentication without archiving anything', async () => {
 fixture.user = null;
 expect((await call()).status).toBe(401);
 expect(fixture.archive).not.toHaveBeenCalled();
});
