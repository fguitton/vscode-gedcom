/**
 * Bundles the extension for both hosts.
 *
 * Four outputs, because the two hosts have genuinely different contracts:
 *
 *  - **Node** loads `main` as CommonJS. ESM extensions are supported from VS Code
 *    1.101, but this extension's floor is 1.91, so CommonJS it is.
 *  - **Browser** loads `browser` inside a web worker where module imports and
 *    `importScripts` are both unavailable. Everything must be in one file, with
 *    `require('vscode')` left alone — the host shims that one specifier and
 *    nothing else.
 *  - The **browser server** is loaded by URL as a nested worker, so it is emitted
 *    as an IIFE that runs on load rather than a module that exports something.
 *
 * `packages/core` is bundled into all four. It has no dependencies and no Node
 * builtins, which is exactly what makes one parser serve both hosts.
 */

import { defineConfig } from 'tsdown';

const shared = {
  dts: false,
  sourcemap: true,
  clean: false,
  // The host provides this module; bundling it would break the extension.
  external: ['vscode'],
  // VS Code loads these by the exact path in the manifest, so the extension must
  // not vary with the module format tsdown chose.
  outputOptions: { entryFileNames: '[name].js' },
};

/**
 * The language client and server packages gate their `./node` and `./browser`
 * subpaths behind matching export conditions, with no `default` to fall back on.
 * Resolution therefore fails unless the condition is named explicitly.
 */
const conditions = (platform: 'node' | 'browser') => ({
  inputOptions: {
    resolve: {
      conditionNames: [platform, 'import', 'require', 'default'],
    },
  },
});

export default defineConfig([
  {
    ...shared,
    ...conditions('node'),
    entry: { extension: 'packages/client/src/node.ts' },
    outDir: 'dist/node',
    format: 'cjs',
    platform: 'node',
    clean: true,
  },
  {
    ...shared,
    ...conditions('node'),
    entry: { server: 'packages/server/src/node.ts' },
    outDir: 'dist/node',
    format: 'cjs',
    platform: 'node',
  },
  {
    ...shared,
    ...conditions('browser'),
    entry: { extension: 'packages/client/src/browser.ts' },
    outDir: 'dist/browser',
    format: 'cjs',
    platform: 'browser',
  },
  {
    ...shared,
    ...conditions('browser'),
    entry: { server: 'packages/server/src/browser.ts' },
    outDir: 'dist/browser',
    format: 'iife',
    platform: 'browser',
  },
]);
