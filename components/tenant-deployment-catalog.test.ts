import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppCard } from './AppCard';
import { AppListItem } from './AppListItem';
import { FeaturedApps } from './FeaturedApps';
import { AppCollection } from './AppCollection';
import { TenantDeploymentBadge } from './TenantDeploymentBadge';
import type { NormalizedPackage } from '@/types/winget';

const fixture = vi.hoisted(() => ({ id: 'Fixture.App', name: 'Fixture App', publisher: 'Fixture', version: '1.0', category: 'utilities', popularityRank: 1 }));
vi.mock('@/hooks/useQuickAdd', () => ({ useQuickAdd: () => ({ quickAdd: vi.fn(), isLoading: false }) }));
vi.mock('@/stores/cart-store', () => ({ useCartStore: () => false }));
vi.mock('@/hooks/use-packages', () => ({ usePackagesByCategory: () => ({ data: { packages: [fixture] }, isLoading: false }) }));
vi.mock('@/hooks/use-near-viewport', () => ({ useNearViewport: () => ({ ref: { current: null }, near: true }) }));
vi.mock('@/components/AppIcon', () => ({ AppIcon: () => null }));
vi.mock('@/components/qa/QaBadge', () => ({ QaBadge: () => null }));

const pkg = fixture as NormalizedPackage;
const render = renderToStaticMarkup;
describe('early tenant deployment warning', () => {
  it('omits the badge when no tenant deployment exists', () => {
    expect(render(createElement(TenantDeploymentBadge, {}))).toBe('');
  });
  it('shows a warning even when deployer attribution is absent', () => {
    expect(render(createElement(TenantDeploymentBadge, { deployedBy: null }))).toContain('Deployed in this tenant');
  });
  for (const [name, view] of [
    ['grid', () => createElement(AppCard, { package: pkg, tenantDeployedBy: 'colleague@example.test' })],
    ['list', () => createElement(AppListItem, { package: pkg, tenantDeployedBy: 'colleague@example.test' })],
    ['featured', () => createElement(FeaturedApps, { packages: [pkg], tenantDeployments: new Map([[pkg.id, 'colleague@example.test']]) })],
    ['collection', () => createElement(AppCollection, { category: 'utilities', tenantDeployments: new Map([[pkg.id, 'colleague@example.test']]) })],
  ] as const) {
    it(`shows the teammate warning in ${name} without blocking selection`, () => {
      const html = render(view());
      expect(html).toContain('Deployed in this tenant by colleague@example.test');
      expect(html).toContain('Quick add Fixture App');
      const selectButton = html.match(/<button[^>]*aria-label="Quick add Fixture App"[^>]*>/)?.[0];
      expect(selectButton).toBeDefined();
      expect(selectButton).not.toContain('disabled=');
    });
  }
  it('keeps the personal deployment edit action', () => {
    const html = render(createElement(AppCard, { package: pkg, isDeployed: true, tenantDeployedBy: null }));
    expect(html).toContain('Edit Config');
    expect(html).not.toContain('Quick add Fixture App');
  });
});
