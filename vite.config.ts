import { defineConfig } from 'vite-plus';

/**
 * Paths the toolchain must leave byte-for-byte alone.
 *
 * `syntaxes/` is generated — reformatting it would put the committed file out of
 * step with the generator, and CI checks the two match. `vendor/` and `fixtures/`
 * are pinned upstream snapshots whose value is being unmodified copies.
 */
const IGNORED = [
  'syntaxes/**',
  'vendor/**',
  'fixtures/**',
  // Build output, and the VS Code builds the integration harnesses download.
  // The web one is a full VS Code web distribution: linting it fails outright
  // and formatting it takes longer than the rest of the toolchain put together.
  'dist/**',
  '.vscode-test/**',
  '.vscode-test-web/**',
  '.vscode/**',
  '.github/**',
  '**/*.generated.ts',
];

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    // The fixture corpus is large; tokenizing every file takes a few seconds.
    testTimeout: 30_000,
  },

  lint: {
    ignorePatterns: IGNORED,
    plugins: ['typescript'],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
    overrides: [
      {
        // The generators are CLIs: printing progress is the point. So is the web
        // test runner, whose console output is the only report of the run.
        files: ['packages/grammar/src/build.ts', 'packages/*/scripts/**', 'test/web/**'],
        env: { node: true },
        rules: { 'no-console': 'off' },
      },
      {
        files: ['packages/*/test/**'],
        plugins: ['vitest'],
        rules: { 'typescript/no-explicit-any': 'off' },
      },
    ],
  },

  fmt: {
    ignorePatterns: IGNORED,
    singleQuote: true,
    semi: true,
  },

  run: {
    tasks: {
      // Regenerate the committed grammar from the pinned spec registry.
      grammar: {
        command: 'node --experimental-strip-types packages/grammar/src/build.ts',
        input: ['vendor/registries/**', 'packages/grammar/src/**'],
        output: ['syntaxes/gedcom.tmLanguage.json'],
      },
      // Regenerate the parser's embedded specification model. Embedded rather
      // than read from disk because packages/core must run in a browser worker.
      spec: {
        command: 'node --experimental-strip-types packages/core/scripts/build-spec.ts',
        input: ['vendor/registries/**', 'packages/core/scripts/**'],
        output: ['packages/core/src/spec/model.generated.ts'],
      },
      // Bundle both extension hosts. Four outputs; see tsdown.config.ts.
      // `bundle` is kept as an alias because nothing else in the repo is called
      // build, and reaching for `vp run build` is the reflex.
      build: {
        // dist/ is emptied first rather than relying on tsdown's per-target
        // clean: several targets share an output directory, so cleaning from
        // within them would race. A stale bundle here is not inert — it is a
        // plausible-looking file that an older manifest may still point at.
        command: [
          "node -e \"require('node:fs').rmSync('dist',{recursive:true,force:true})\"",
          'tsdown',
        ],
        input: ['packages/*/src/**', 'test/web/**', 'tsdown.config.ts'],
        output: ['dist/**'],
      },
      bundle: {
        command: 'vp run build',
      },
      // Render the grammar through real theme palettes, to look at.
      preview: {
        command: 'node --experimental-strip-types packages/grammar/scripts/preview.ts',
        input: ['syntaxes/**', 'packages/grammar/src/themes.ts', 'packages/grammar/scripts/**'],
        output: ['dist/preview/**'],
      },
      // Integration tests in a real VS Code. These cover what unit tests
      // cannot: that the manifest wires up and the bundles actually load.
      'test:vscode': {
        command: 'vscode-test --label stable',
        input: ['dist/**', 'test/integration/**', 'package.json'],
      },
      // The same tests against Insiders, which is where bug reports come from
      // and which no test here had ever run against. Deliberately outside
      // `verify`: Insiders is rebuilt daily, so a failure is a lead to follow
      // rather than a reason to stop a commit.
      'test:vscode:insiders': {
        command: 'vscode-test --label insiders',
      },
      // Launches the extension in the web extension host, in a browser, for
      // eyeballing what only the web host can show — CSP behaviour in the graph
      // panel, and the language server running in a nested worker.
      'dev:web': {
        command:
          'vscode-test-web --browser=chromium --quality=stable --extensionDevelopmentPath=. fixtures',
      },
      // The same host, headless, asserting rather than eyeballing. This is the
      // only automated coverage of the worker host: no Node builtins, the server
      // in a nested worker loaded by URL, and the panel under a stricter CSP.
      //
      // `--quality=stable` is not a detail. The default is `insiders`, which
      // downloads whichever build is newest on the day — so the same commit
      // passes and fails depending on when it runs, and a broken insiders build
      // hangs the harness before it invokes any test module, printing nothing.
      // Stable is also what readers of GEDCOM files actually run.
      'test:web': {
        command: [
          'vp run build',
          'vscode-test-web --browser=chromium --headless --quality=stable --extensionDevelopmentPath=. --extensionTestsPath=./dist/web-tests/index.cjs fixtures',
        ],
      },
      // Full gate: generated artifacts are refreshed before tests read them, and
      // bundling last catches anything that only breaks when packaged.
      verify: {
        command: [
          'vp run grammar',
          'vp run spec',
          'vp test',
          'vp check',
          'vp run build',
          'vp run test:vscode',
          'vp run test:web',
        ],
      },
    },
  },
});
