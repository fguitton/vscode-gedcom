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
 * running one. Run with `npx vscode-test`, or `npx vscode-test --label insiders`
 * for the build most bug reports arrive from.
 */

const shared = {
  files: 'test/integration/**/*.test.mjs',
  workspaceFolder: './fixtures',
  mocha: {
    ui: 'bdd',
    timeout: 60_000,
  },
};

export default defineConfig([
  {
    ...shared,
    label: 'stable',
    version: 'stable',
  },
  {
    // The build people actually report bugs from, and the one this repository
    // could not answer questions about: issue #5 came from Insiders on Linux,
    // and nothing here had ever run against Insiders at all.
    //
    // Kept as a separate label rather than added to the default run, and not
    // part of `vp run verify`. Insiders is whatever was built that day, so a
    // failure here is a lead to follow rather than a reason to fail a commit —
    // the same reason the web tests pin `--quality=stable`.
    ...shared,
    label: 'insiders',
    version: 'insiders',
  },
]);
