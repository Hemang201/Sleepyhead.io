/**
 * Bundles the Worker into one ESM file for deployment.
 *
 * `wrangler dev` compiles worker/index.ts on its own; the deployed platform
 * uploads prebuilt modules, so this produces the exact artifact that ships.
 * Dependencies (the auth SDK and its JWT library) are bundled in: the
 * runtime has no package manager.
 */
import { build } from 'esbuild';
import { mkdirSync, statSync } from 'node:fs';

const OUT = 'dist-worker/index.js';
mkdirSync('dist-worker', { recursive: true });

const result = await build({
  entryPoints: ['worker/index.ts'],
  outfile: OUT,
  bundle: true,
  format: 'esm',
  target: 'es2022',
  // Workers run web APIs only; "browser" resolution picks the web build of the
  // auth SDK's JWT dependency instead of its Node build.
  platform: 'browser',
  conditions: ['workerd', 'worker', 'browser', 'import', 'default'],
  mainFields: ['module', 'main'],
  minify: true,
  legalComments: 'none',
  metafile: true,
  logLevel: 'warning',
});

const bytes = statSync(OUT).size;
const inputs = Object.entries(result.metafile.outputs[OUT]?.inputs ?? {})
  .sort((a, b) => b[1].bytesInOutput - a[1].bytesInOutput)
  .slice(0, 5)
  .map(([name, info]) => `${name} (${(info.bytesInOutput / 1024).toFixed(1)} kB)`);

console.log(`Worker bundle: ${OUT} — ${(bytes / 1024).toFixed(1)} kB`);
console.log(`Largest inputs: ${inputs.join(', ')}`);
