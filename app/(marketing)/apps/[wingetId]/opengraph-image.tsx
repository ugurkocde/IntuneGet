import { ImageResponse } from 'next/og';
import { getCatalogSource } from '@/lib/catalog';
import { resolveCatalogIconUrl } from '@/lib/catalog/seo';

export const revalidate = 86400;
export const alt = 'Deploy this app to Microsoft Intune with IntuneGet';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

async function loadIconDataUri(iconUrl: string): Promise<string | null> {
  try {
    const res = await fetch(iconUrl);
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || 'image/png';
    if (!type.startsWith('image/')) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > 1024 * 1024) return null;
    return `data:${type};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

export default async function OpenGraphImage({
  params,
}: {
  params: Promise<{ wingetId: string }>;
}) {
  const { wingetId } = await params;
  let id = wingetId;
  try {
    id = decodeURIComponent(wingetId);
  } catch {
    // keep the raw segment
  }

  const details = await getCatalogSource()
    .getAppByWingetId(id)
    .catch(() => null);
  const app = details?.app ?? null;
  const name = app?.name ?? 'Windows apps';
  const publisher = app?.publisher ?? '';
  const icon = app ? await loadIconDataUri(resolveCatalogIconUrl(app)) : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          backgroundColor: '#080d17',
          backgroundImage:
            'radial-gradient(circle at 85% 15%, rgba(34, 211, 238, 0.18) 0%, rgba(8, 13, 23, 0) 55%)',
          color: '#f8fafc',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
          {icon ? (
            <img
              src={icon}
              alt=""
              width={140}
              height={140}
              style={{ borderRadius: 28, backgroundColor: '#ffffff', padding: 14 }}
            />
          ) : (
            <div
              style={{
                width: 140,
                height: 140,
                borderRadius: 28,
                backgroundColor: 'rgba(34, 211, 238, 0.15)',
                border: '2px solid rgba(34, 211, 238, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 72,
                fontWeight: 700,
                color: '#22d3ee',
              }}
            >
              {name.charAt(0).toUpperCase()}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 30, color: '#22d3ee', fontWeight: 600 }}>Deploy</div>
            <div
              style={{
                fontSize: name.length > 28 ? 52 : 64,
                fontWeight: 700,
                lineHeight: 1.1,
                maxWidth: 850,
              }}
            >
              {name}
            </div>
            <div style={{ fontSize: 34, color: '#94a3b8' }}>to Microsoft Intune</div>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 28,
            color: '#94a3b8',
          }}
        >
          <div style={{ display: 'flex' }}>{publisher ? `by ${publisher}` : ''}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: 6,
                backgroundColor: '#22d3ee',
              }}
            />
            <div style={{ fontWeight: 700, color: '#f8fafc' }}>IntuneGet</div>
            <div>packaged and uploaded automatically</div>
          </div>
        </div>
      </div>
    ),
    size
  );
}
