/**
 * Structural invariants that hold for every GEDCOM file, checked across the whole
 * fixture corpus.
 *
 * The first test is the important one. GEDCOM is strictly line-oriented, so no
 * tokenizer state may ever survive a line boundary. The previous grammar violated
 * this — it used `begin`/`end` pairs on `@` and on tag names — which is why a
 * single unescaped at-sign in a note re-coloured every following line in the file.
 * A grammar that passes this test cannot regress that way.
 */

import { describe, expect, it } from 'vitest';

import { fixtures } from './fixtures.ts';
import { leafScope, tokenize, tokenizeWithState } from './tokenizer.ts';

const corpus = fixtures();

describe('tokenizer state never escapes a line', () => {
  it.each(corpus.map((f) => f.name))('%s leaves the rule stack at depth 1', async (name) => {
    const fixture = corpus.find((f) => f.name === name)!;
    const lines = await tokenizeWithState(fixture.text);

    const leaked = lines.filter((l) => l.stack.depth !== 1);
    expect(leaked.map((l) => `line ${l.index + 1} (depth ${l.stack.depth}): ${l.line}`)).toEqual(
      [],
    );
  });

  it('survives the pathological at-sign fixture without leaking scope', async () => {
    // v5/atsign.ged is the exact shape that broke the previous grammar: notes
    // containing bare, doubled and escape-form at-signs.
    const fixture = corpus.find((f) => f.name === 'v5/atsign.ged')!;
    const lines = await tokenizeWithState(fixture.text);
    expect(lines.every((l) => l.stack.depth === 1)).toBe(true);
  });
});

describe('every line is recognised as a GEDCOM line', () => {
  it.each(corpus.map((f) => f.name))('%s has no unrecognised lines', async (name) => {
    const fixture = corpus.find((f) => f.name === name)!;
    const tokens = await tokenize(fixture.text);

    const illegal = tokens
      .filter((t) => leafScope(t).startsWith('invalid.illegal.line'))
      .map((t) => `line ${t.line + 1}: ${t.text}`);

    expect(illegal).toEqual([]);
  });

  it.each(corpus.map((f) => f.name))('%s scopes a level on every content line', async (name) => {
    const fixture = corpus.find((f) => f.name === name)!;
    const tokens = await tokenize(fixture.text);

    const contentLines = new Set(
      fixture.text
        .split(/\r\n|\r|\n/)
        .map((line, index) => (line.trim().length > 0 ? index : -1))
        .filter((index) => index >= 0),
    );

    const linesWithLevel = new Set(
      tokens
        .filter((t) => leafScope(t) === 'constant.numeric.integer.level.gedcom')
        .map((t) => t.line),
    );

    const missing = [...contentLines].filter((line) => !linesWithLevel.has(line));
    expect(missing.map((l) => `line ${l + 1}`)).toEqual([]);
  });
});

describe('scope naming', () => {
  it('uses only conventional TextMate root scopes', async () => {
    // `text.*` is reserved for top-level document grammars; the previous grammar
    // used `text.gedcom` for delimiters and payloads, which no theme colours well.
    const allowedRoots = new Set([
      'comment',
      'constant',
      'entity',
      'invalid',
      'keyword',
      'markup',
      'meta',
      'punctuation',
      'source',
      'storage',
      'string',
      'support',
      'variable',
    ]);

    const seen = new Set<string>();
    for (const fixture of corpus) {
      for (const token of await tokenize(fixture.text)) {
        for (const scope of token.scopes) seen.add(scope);
      }
    }

    const bad = [...seen].filter((scope) => !allowedRoots.has(scope.split('.')[0]!));
    expect(bad).toEqual([]);
  });

  it('never scopes a payload as a regular expression', async () => {
    // The previous grammar scoped `/surname/` as string.regexp, so themes rendered
    // every surname as a regex literal.
    const seen = new Set<string>();
    for (const fixture of corpus) {
      for (const token of await tokenize(fixture.text)) {
        for (const scope of token.scopes) seen.add(scope);
      }
    }
    expect([...seen].filter((s) => s.includes('string.regexp'))).toEqual([]);
  });
});
