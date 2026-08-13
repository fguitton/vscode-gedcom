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
        // The generators are CLIs: printing progress is the point.
        files: ['packages/grammar/src/build.ts', 'packages/*/scripts/**'],
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
        command: 'tsdown',
        input: ['packages/*/src/**', 'tsdown.config.ts'],
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
        command: 'vscode-test',
        input: ['dist/**', 'test/integration/**', 'package.json'],
      },
      // Launches the extension in the web extension host, in a browser, for
      // eyeballing what only the web host can show — CSP behaviour in the graph
      // panel, and the language server running in a nested worker.
      'dev:web': {
        command: 'vscode-test-web --browserType=chromium --extensionDevelopmentPath=. fixtures',
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
        ],
      },
    },
  },
});
