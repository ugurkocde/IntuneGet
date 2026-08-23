import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The icon tree is checked out on windows-2025 by every extraction shard, and
 * Windows filesystems are case-insensitive. Two package directories differing
 * only in case therefore become one directory holding whichever blob git wrote
 * last, and the shard's `git diff --name-only` reports the other path. That
 * leaves the checkout permanently dirty and can package the wrong files.
 *
 * It happened: TromoSM.FluxLAN and tromoSM.FluxLan, WenAnLin.Wenget and
 * WenanLin.wenget, all four left behind when a winget id changed case.
 */

const ICONS_DIR = path.join(process.cwd(), 'public', 'icons');

describe('icon directories', () => {
  it('has no two package directories differing only by case', () => {
    if (!fs.existsSync(ICONS_DIR)) return;

    const byLower = new Map<string, string[]>();
    for (const entry of fs.readdirSync(ICONS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const key = entry.name.toLowerCase();
      if (!byLower.has(key)) byLower.set(key, []);
      byLower.get(key)!.push(entry.name);
    }

    // A case-insensitive filesystem cannot even surface both names, so this
    // only catches the collision where it can be observed. CI runs on Linux,
    // which is exactly where it is visible.
    const collisions = [...byLower.values()].filter(names => names.length > 1);
    expect(collisions, `case-colliding icon directories: ${JSON.stringify(collisions)}`).toEqual([]);
  });
});
