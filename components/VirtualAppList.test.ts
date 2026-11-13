import { describe, expect, it } from 'vitest';
import { APP_GRID_TEMPLATE_COLUMNS, gridColumnsForWidth } from './VirtualAppList';

describe('gridColumnsForWidth', () => {
  it.each([
    // [list width in px, expected columns, where that width occurs]
    [288, 1, '320 px phone'],
    [358, 1, '390 px phone'],
    [416, 1, '1024 px screen with the sidebar and the catalog filter panel'],
    [543, 1, 'just under two cards'],
    [544, 2, 'exactly two cards and one gap'],
    [672, 2, '1280 px screen with the sidebar and the catalog filter panel'],
    [736, 2, '768 px tablet'],
    [823, 2, 'just under three cards'],
    [824, 3, 'exactly three cards and two gaps'],
    [832, 3, '1440 px screen with the sidebar and the catalog filter panel'],
    [1312, 3, '1920 px screen: never more than three columns'],
  ])('fits a %i px list with %i column(s) (%s)', (width, columns) => {
    expect(gridColumnsForWidth(width)).toBe(columns);
  });

  it('never returns less than one column', () => {
    expect(gridColumnsForWidth(0)).toBe(1);
    expect(gridColumnsForWidth(-10)).toBe(1);
    expect(gridColumnsForWidth(Number.NaN)).toBe(1);
  });

  it('keeps every card at least 264 px wide once there is more than one column', () => {
    for (let width = 544; width <= 2000; width += 7) {
      const columns = gridColumnsForWidth(width);
      const cardWidth = (width - (columns - 1) * 16) / columns;
      expect(cardWidth).toBeGreaterThanOrEqual(264);
    }
  });
});

describe('APP_GRID_TEMPLATE_COLUMNS', () => {
  it('states the same minimum card width and column cap for placeholders', () => {
    expect(APP_GRID_TEMPLATE_COLUMNS).toContain('264px');
    expect(APP_GRID_TEMPLATE_COLUMNS).toContain('(100% - 32px) / 3');
  });
});
