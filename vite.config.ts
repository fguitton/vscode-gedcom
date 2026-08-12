import { defineConfig } from 'vite-plus';

/**
 * Paths the toolchain must leave byte-for-byte alone.
 *
 * `syntaxes/` is generated — reformatting it would put the committed file out of
 * step with the generator, and CI checks the two match. `vendor/` and `fixtures/`
 * are pinned upstream snapshots whose value is being unmodified copies.
 */
const IGNORED = ['syntaxes/**', 'vendor/**', 'fixtures/**', '.vscode/**', '.github/**'];

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
        // The grammar builder is a CLI: printing progress is the point.
        files: ['packages/grammar/src/build.ts'],
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
      // Full gate: the grammar must be regenerated before tests read it.
      verify: {
        command: ['vp run grammar', 'vp test', 'vp check'],
      },
    },
  },
});
