import { defineConfig } from '@vscode/test-cli';

/**
 * Headless integration tests, run in a real VS Code against the built bundles.
 *
 * These cover what unit tests cannot: that the manifest wires up, the extension
 * activates, the server starts, and the contributions VS Code reads at load time
 * are actually well-formed. Everything about *behaviour* is tested in the
 * packages, where it runs in milliseconds without downloading an editor.
 *
 * Tests are plain JavaScript so there is no build step between editing one and
 * running it. Run with `npx vscode-test`.
 */
export default defineConfig({
  files: 'test/integration/**/*.test.mjs',
  workspaceFolder: './fixtures',
  version: 'stable',
  mocha: {
    ui: 'bdd',
    timeout: 60_000,
  },
});
