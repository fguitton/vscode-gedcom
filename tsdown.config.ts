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
};

/**
 * Anything the extension host loads as a module must be named `.cjs`.
 *
 * The repository is `"type": "module"`, and both hosts read that field — by
 * different routes, to the same conclusion.
 *
 * Node reads a bare `.js` under a `"type": "module"` package as ESM, and these
 * bundles are CommonJS, so it throws `ReferenceError: exports is not defined in
 * ES module scope`. The web worker host reaches the same verdict by its own rule:
 *
 *     _isESM(extension, path) {
 *       return path?.endsWith('.mjs')
 *         || (extension?.type === 'module' && !path?.endsWith('.cjs'));
 *     }
 *
 * and then `_loadESMModule` throws outright, because the worker host supports no
 * ESM at all. In both cases `.cjs` is the escape hatch, and in both cases the
 * fetch preserves the suffix — the host appends `.js` only to a path with no
 * extension of its own.
 *
 * Neither failure is reachable from a unit test: nothing but a running extension
 * host ever loads these files.
 */
const moduleOutput = { outputOptions: { entryFileNames: '[name].cjs' } };

/**
 * The browser *server* is the exception, and stays `.js`.
 *
 * It is not loaded as a module by anything. Our own client passes its URL to
 * `new Worker()`, and a worker script must be served with a JavaScript MIME type
 * — which static file servers key off the extension.
 */
const workerOutput = { outputOptions: { entryFileNames: '[name].js' } };

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
    ...moduleOutput,
    entry: { extension: 'packages/client/src/node.ts' },
    outDir: 'dist/node',
    format: 'cjs',
    platform: 'node',
    clean: true,
  },
  {
    ...shared,
    ...conditions('node'),
    ...moduleOutput,
    entry: { server: 'packages/server/src/node.ts' },
    outDir: 'dist/node',
    format: 'cjs',
    platform: 'node',
  },
  {
    ...shared,
    ...conditions('browser'),
    ...moduleOutput,
    entry: { extension: 'packages/client/src/browser.ts' },
    outDir: 'dist/browser',
    format: 'cjs',
    platform: 'browser',
  },
  {
    ...shared,
    ...conditions('browser'),
    ...workerOutput,
    entry: { server: 'packages/server/src/browser.ts' },
    outDir: 'dist/browser',
    format: 'iife',
    platform: 'browser',
  },
  /**
   * The web integration tests.
   *
   * `@vscode/test-web` loads `--extensionTestsPath` through the same code path
   * as an extension entry point, and calls the `run` export. So this is bundled
   * exactly like the browser client, `.cjs` suffix included — the host resolves
   * the owning extension to decide the module kind, and finds this one.
   */
  {
    ...shared,
    ...conditions('browser'),
    ...moduleOutput,
    entry: { index: 'test/web/index.ts' },
    outDir: 'dist/web-tests',
    format: 'cjs',
    platform: 'browser',
  },
]);
