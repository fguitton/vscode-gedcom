/**
 * Reading a file's indentation habit.
 *
 * The level number is the only thing that carries structure, so indentation is
 * decoration — which is exactly why it has to be measured rather than assumed.
 * The corpus carries the same family tree written five ways, so the answer for
 * each is known independently of the code that produces it.
 */

import { describe, expect, it } from 'vitest';

import { detectIndentation } from '../src/index.ts';
import { analyze } from '../src/index.ts';
import { fixture } from './corpus.ts';

const text = (name: string): string => new TextDecoder().decode(fixture(name).bytes);

describe('files indented with spaces', () => {
  // The same content at one, two and four spaces per level: the unit has to come
  // from the file rather than from a default that happens to suit one of them.
  const cases: readonly [string, number][] = [
    ['style/indent-1-space.ged', 1],
    ['style/indent-2-spaces.ged', 2],
    ['style/indent-4-spaces.ged', 4],
  ];

  for (const [name, width] of cases) {
    it(`reads ${width} space${width === 1 ? '' : 's'} per level from ${name}`, () => {
      const indentation = detectIndentation(text(name));
      expect(indentation.style).toBe('spaces');
      expect(indentation.width).toBe(width);
      expect(indentation.consistent).toBe(true);
      expect(indentation.exceptions).toEqual([]);
      // Nothing to infer: no tab appears, so no width is claimed for one.
      expect(indentation.tabWidth).toBeUndefined();
    });
  }
});

describe('a file indented with tabs', () => {
  const indentation = detectIndentation(text('style/indent-tabs.ged'));

  it('counts a tab as one level', () => {
    expect(indentation.style).toBe('tabs');
    expect(indentation.width).toBe(1);
    expect(indentation.consistent).toBe(true);
  });

  it('claims no width for the tab', () => {
    // A file indented with tabs alone never says what one stands for, and
    // guessing eight would be inventing evidence the file does not carry.
    expect(indentation.tabWidth).toBeUndefined();
  });
});

describe('a file indented with both', () => {
  // Tabs for the first two levels, eight spaces beyond — the shape two editors
  // with different habits leave behind.
  const indentation = detectIndentation(text('style/indent-mixed.ged'));

  it('resolves the tab against the spaces', () => {
    expect(indentation.style).toBe('mixed');
    expect(indentation.tabWidth).toBe(8);
    expect(indentation.width).toBe(8);
  });

  it('finds the file consistent once the tab is resolved', () => {
    // Every level lands on a multiple of eight columns; the inconsistency is
    // only in the characters used, not in the shape they describe.
    expect(indentation.consistent).toBe(true);
    expect(indentation.exceptions).toEqual([]);
  });
});

describe('files that do not indent', () => {
  it('reports no style for a flat file', () => {
    const indentation = detectIndentation(
      ['0 HEAD', '1 GEDC', '2 VERS 7.0', '0 TRLR', ''].join('\n'),
    );
    expect(indentation.style).toBe('none');
    expect(indentation.consistent).toBe(true);
  });

  it('reports no style for an empty file', () => {
    expect(detectIndentation('').style).toBe('none');
  });
});

describe('a file that indents inconsistently', () => {
  const FILE = [
    '0 HEAD',
    '  1 GEDC',
    '    2 VERS 7.0',
    '0 @I1@ INDI',
    '   1 NAME John /Smith/', // three spaces where the file uses two
    '0 TRLR',
    '',
  ].join('\n');

  it('names the lines that break the habit', () => {
    const indentation = detectIndentation(FILE);
    expect(indentation.width).toBe(2);
    expect(indentation.consistent).toBe(false);
    expect(indentation.exceptions).toEqual([4]);
  });
});

describe('indentation and parsing', () => {
  it('leaves every indented fixture free of errors', () => {
    // Whatever the leading whitespace, the file has to parse and validate the
    // same: the indentation is decoration, and the parser must treat it as such.
    for (const name of [
      'style/indent-1-space.ged',
      'style/indent-2-spaces.ged',
      'style/indent-4-spaces.ged',
      'style/indent-tabs.ged',
      'style/indent-mixed.ged',
    ]) {
      const analysis = analyze(fixture(name).bytes);
      const errors = analysis.diagnostics.filter((d) => d.severity === 'error');
      expect(errors, `${name}: ${errors.map((d) => d.message).join('; ')}`).toEqual([]);
    }
  });
});
