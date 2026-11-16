import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import definitions from './definitions.json';

it('binds committed curated execution metadata to the exact reviewed definition identity', () => {
  const root = path.join(process.cwd(), 'catalog/curated/evidence');
  const files = readdirSync(root, { recursive: true }).map(String).filter(file => file.endsWith('.json'));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const evidence = JSON.parse(readFileSync(path.join(root, file), 'utf8'));
    const input = evidence.profile.workflowInput;
    const definition = definitions.find(app => app.packageId === input.wingetId);
    expect(definition, file).toBeDefined();
    expect(input.displayName, file).toBe(definition!.name);
    expect(input.publisher, file).toBe(definition!.publisher);
  }
});
