/**
 * Reading a file's indentation habit.
 *
 * The level number is the only thing that carries structure, so indentation is
 * decoration — which is exactly why it has to be measured rather than assumed.
 * The corpus carries the same family tree written five ways, so the answer for
 * each is known independently of the code that produces it.
 */

import { describe, expect, it } from 'vitest';

import type { Structure } from '../src/cst.ts';
import { analyze, detectIndentation } from '../src/index.ts';
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

describe('files indented with both', () => {
  // Tabs for the first two levels and spaces beyond — the shape two editors with
  // different habits leave behind. Three widths, because a tab is the one thing a
  // file never states: the answer has to come from the spaces each file happens
  // to use, and a rule that only ever met one width would not be a rule.
  for (const width of [2, 4, 8] as const) {
    describe(`a tab standing for ${width} columns`, () => {
      const indentation = detectIndentation(text(`style/indent-mixed-${width}.ged`));

      it('resolves the tab against the spaces', () => {
        expect(indentation.style).toBe('mixed');
        expect(indentation.tabWidth).toBe(width);
        expect(indentation.width).toBe(width);
      });

      it('finds the file consistent once the tab is resolved', () => {
        // Every level lands on a multiple of the unit; the inconsistency is only
        // in the characters used, not in the shape they describe.
        expect(indentation.consistent).toBe(true);
        expect(indentation.exceptions).toEqual([]);
      });
    });
  }

  it('tells the three widths apart', () => {
    // The files differ only in how many spaces follow the tabs. Reading them all
    // as one default width — 8, say, which is what a terminal would show — would
    // report two of the three as inconsistent.
    const widths = [2, 4, 8].map(
      (width) => detectIndentation(text(`style/indent-mixed-${width}.ged`)).tabWidth,
    );
    expect(widths).toEqual([2, 4, 8]);
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

/** The same family tree, written seven ways. */
const STYLES = [
  'style/indent-1-space.ged',
  'style/indent-2-spaces.ged',
  'style/indent-4-spaces.ged',
  'style/indent-tabs.ged',
  'style/indent-mixed-2.ged',
  'style/indent-mixed-4.ged',
  'style/indent-mixed-8.ged',
] as const;

describe('indentation and parsing', () => {
  it('leaves every indented fixture free of errors', () => {
    // Whatever the leading whitespace, the file has to parse and validate the
    // same: the indentation is decoration, and the parser must treat it as such.
    for (const name of STYLES) {
      const analysis = analyze(fixture(name).bytes);
      const errors = analysis.diagnostics.filter((d) => d.severity === 'error');
      expect(errors, `${name}: ${errors.map((d) => d.message).join('; ')}`).toEqual([]);
    }
  });

  it('builds the same tree from every one of them', () => {
    // The load-bearing claim of the whole feature. The level number states the
    // hierarchy and the whitespace states nothing, so a file's shape cannot
    // depend on how far its lines were pushed across — including in the mixed
    // files, where a reader's eye is being told something the parser ignores.
    const shape = (name: string): string => {
      const lines: string[] = [];
      const walk = (node: Structure, depth: number): void => {
        lines.push(`${'  '.repeat(depth)}${node.tag}${node.payload ? ` = ${node.payload}` : ''}`);
        for (const inner of node.children) walk(inner, depth + 1);
      };
      // The header is skipped: each file's NOTE describes that file's own
      // indentation, which is the one thing they are meant not to share.
      for (const record of analyze(fixture(name).bytes).document.records) {
        if (record.tag !== 'HEAD') walk(record, 0);
      }
      return lines.join('\n');
    };

    const [first, ...rest] = STYLES;
    const expected = shape(first!);
    // Two levels of nesting appear in every file and are what a naive reader of
    // the indentation would get wrong, so the comparison is worth something.
    expect(expected).toContain('    TIME = 09:22:41');
    for (const name of rest) {
      expect(shape(name), `${name} parses to a different tree`).toBe(expected);
    }
  });
});
