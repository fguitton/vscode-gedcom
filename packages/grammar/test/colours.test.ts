/**
 * The colour design, checked against real theme palettes.
 *
 * The scope mapping makes a claim that scope names alone cannot verify: that the
 * semantic classes come out *visibly different* in the themes people actually
 * use. A mapping can be impeccable and still collapse to one colour, and the
 * narrower the palette the likelier that is — which is why GitHub's Primer, the
 * narrowest of the three, is the one that matters most here.
 *
 * `vp run preview` renders the same data as a page to look at.
 */

import { describe, expect, it } from 'vitest';

import { resolve, THEMES } from '../src/themes.ts';
import { tokenize } from './tokenizer.ts';

/** Semantic class to a line exercising it, and the tag to sample. */
const SAMPLES: readonly (readonly [string, string, string])[] = [
  ['envelope', '0 HEAD', 'HEAD'],
  ['record', '0 @I1@ INDI', 'INDI'],
  ['event', '1 BIRT', 'BIRT'],
  ['attribute', '1 NAME John /Smith/', 'NAME'],
  ['linkage', '1 FAMS @F1@', 'FAMS'],
  ['evidence', '2 PAGE p.42', 'PAGE'],
];

async function colourOf(line: string, tag: string, theme: (typeof THEMES)[number]) {
  const tokens = await tokenize(line);
  const column = line.indexOf(tag);
  const token = tokens.find((t) => t.startIndex <= column && column < t.endIndex)!;
  return resolve(token.scopes, theme).color;
}

describe.each(THEMES.map((t) => [t.name, t] as const))('%s', (_name, theme) => {
  it('gives every semantic class its own colour', async () => {
    const colours = new Map<string, string>();
    for (const [className, line, tag] of SAMPLES) {
      colours.set(className, await colourOf(line, tag, theme));
    }

    const distinct = new Set(colours.values());
    expect(
      distinct.size === SAMPLES.length ? [] : [...colours].map(([k, v]) => `${k}=${v}`),
    ).toEqual([]);
  });

  it('does not leave a class on the default foreground', async () => {
    // A class resolving to the plain text colour is one the theme has no rule
    // for, which means the mapping picked a scope that theme does not know.
    for (const [className, line, tag] of SAMPLES) {
      const colour = await colourOf(line, tag, theme);
      expect(`${className}:${colour}`).not.toBe(`${className}:${theme.foreground}`);
    }
  });

  it('separates a cross-reference definition from a use', async () => {
    const definition = await colourOf('0 @I1@ INDI', 'I1', theme);
    const reference = await colourOf('1 FAMS @F1@', 'F1', theme);
    expect(definition).not.toBe(reference);
  });

  it('keeps payload text distinct from the tag introducing it', async () => {
    const tag = await colourOf('1 NAME John /Smith/', 'NAME', theme);
    const payload = await colourOf('1 NAME John /Smith/', 'John', theme);
    expect(tag).not.toBe(payload);
  });
});

describe('documented collapses', () => {
  it('gives administrative tags the attribute colour, by design', async () => {
    // De-emphasis is what administrative wants and no honest scope provides it;
    // this asserts the compromise stays deliberate rather than drifting.
    for (const theme of THEMES) {
      const administrative = await colourOf('1 CHAN', 'CHAN', theme);
      const attribute = await colourOf('1 NAME x', 'NAME', theme);
      expect(administrative).toBe(attribute);
    }
  });
});
