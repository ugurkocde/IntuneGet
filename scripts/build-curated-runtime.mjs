#!/usr/bin/env node
import { build } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'output/curated/runtime');
await mkdir(output, { recursive: true });
// Vite is already locked through Vitest. No network, server secrets, Next.js
// routes or database client are included in this deterministic QA module.
await build({
  configFile: false, root, publicDir: false,
  resolve: { alias: { '@': root } },
  build: {
    outDir: output, emptyOutDir: false, minify: false,
    lib: { entry: resolve(root, 'lib/curated-catalog/verification-runtime.ts'), formats: ['es'], fileName: () => 'profile-runtime.mjs' },
    rollupOptions: { external: id => id.startsWith('node:') },
  },
});
const { CURATED_APPS, QA_PSADT_TOOLCHAIN } = await import(pathToFileURL(resolve(output, 'profile-runtime.mjs')).href);
await writeFile(resolve(output, 'policy.json'), `${JSON.stringify({ apps: CURATED_APPS, toolchain: QA_PSADT_TOOLCHAIN }, null, 2)}\n`);
