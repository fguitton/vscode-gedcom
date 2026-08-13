/**
 * The grammar as GitHub actually renders it.
 *
 * This repository used to approximate GitHub's palette by hand, which made the
 * central claim of the colour design — that the semantic classes stay distinct
 * where the palette is narrowest — one nobody could check. It ran the grammar
 * through a theme written from memory and reported six distinct colours.
 *
 * Running it through GitHub's own highlighter and GitHub's own published colours
 * reports four. The tests below record what is really there, including the two
 * collapses the approximation was hiding.
 */

import { describe, expect, it } from 'vitest';

import { highlight, palette, type PrettyLightsToken } from '../src/prettylights.ts';

/** Semantic class, a line exercising it, and the token to sample. */
const SAMPLES: readonly (readonly [string, string, string])[] = [
  ['envelope', '0 HEAD', 'HEAD'],
  ['record', '0 @I1@ INDI', 'INDI'],
  ['event', '1 BIRT', 'BIRT'],
  ['attribute', '1 NAME John /Smith/', 'NAME'],
  ['linkage', '1 FAMS @F1@', 'FAMS'],
  ['evidence', '2 PAGE p.42', 'PAGE'],
];

/** The highlighted run covering a substring of a line. */
async function runAt(line: string, needle: string): Promise<PrettyLightsToken | undefined> {
  const column = line.indexOf(needle);
  const runs = await highlight(line);

  let offset = 0;
  for (const run of runs) {
    if (offset <= column && column < offset + run.text.length) return run;
    offset += run.text.length;
  }
  return undefined;
}

const classesAt = async (line: string, needle: string): Promise<string> =>
  (await runAt(line, needle))?.classes.join(' ') ?? '';

describe('the grammar reaches GitHub at all', () => {
  it('is accepted by GitHub’s highlighter as written', async () => {
    // The committed grammar is what Linguist vendors, so if starry-night cannot
    // load it neither can github.com.
    const runs = await highlight('0 HEAD\n1 GEDC\n2 VERS 7.0\n0 TRLR\n');
    expect(runs.length).toBeGreaterThan(0);
  });

  it('classifies rather than passing the text through unmarked', async () => {
    const runs = await highlight('0 @I1@ INDI\n1 NAME John /Smith/\n1 FAMS @F1@\n');
    const classified = runs.filter((run) => run.classes.length > 0);
    expect(classified.length).toBeGreaterThan(6);
  });
});

describe('PrettyLights classes', () => {
  it('gives the envelope a keyword and records an entity name', async () => {
    expect(await classesAt('0 HEAD', 'HEAD')).toBe('pl-k');
    expect(await classesAt('0 @I1@ INDI', 'INDI')).toBe('pl-en');
  });

  it('marks a malformed payload as invalid, which is the point of those rules', async () => {
    // `pl-ii` is what GitHub paints red-on-dark. The payload-shape rules would be
    // pointless if they arrived on github.com looking like ordinary text.
    expect(await classesAt('1 ASSO @I1@ df', '@I1@ df')).toBe('pl-ii');
    expect(await classesAt('1 SEX Q', 'Q')).toBe('pl-ii');
  });

  it('nests a date keyword inside its payload', async () => {
    // The payload is a string and the qualifier a keyword within it, which is
    // how GitHub renders an interpolation — and why `ABT` stays visible.
    expect(await classesAt('2 DATE ABT 1901', 'ABT')).toBe('pl-s pl-k');
  });
});

describe.each(['light', 'dark'] as const)('the %s palette', (theme) => {
  const colours = palette(theme);

  const colourOf = async (line: string, needle: string): Promise<string> =>
    colours.colourOf((await runAt(line, needle))?.classes ?? []);

  it('separates a cross-reference definition from a use', async () => {
    const definition = await colourOf('0 @I1@ INDI', 'I1');
    const reference = await colourOf('1 FAMS @F1@', 'F1');
    expect(definition).not.toBe(reference);
  });

  it('keeps payload text distinct from the tag introducing it', async () => {
    expect(await colourOf('1 NAME John /Smith/', 'NAME')).not.toBe(
      await colourOf('1 NAME John /Smith/', 'John'),
    );
  });

  it('paints an invalid payload differently from a valid one', async () => {
    expect(await colourOf('1 SEX Q', 'Q')).not.toBe(await colourOf('1 SEX M', 'M'));
  });
});

describe('what GitHub cannot separate', () => {
  /**
   * Recorded rather than asserted away. Primer has fewer buckets than this
   * grammar has semantic classes, so some collapse — and knowing exactly which
   * is more useful than a test that passes because it was written to.
   *
   * Both of these were invisible under the hand-written approximation.
   */
  it('renders evidence exactly like an attribute', async () => {
    // `markup.quote` and `entity.name.tag` both map to `pl-ent`, so a citation
    // and a name are the same colour on github.com.
    expect(await classesAt('2 PAGE p.42', 'PAGE')).toBe('pl-ent');
    expect(await classesAt('1 NAME John /Smith/', 'NAME')).toBe('pl-ent');
  });

  it('leaves linkage tags indistinguishable from ordinary text', async () => {
    // `variable.other` maps to `pl-smi`, which Primer colours its near-black in
    // light and a near-white in dark. The design intent survives — a linkage tag
    // and the pointer after it match — but on github.com they match by both
    // being, to the eye, unpainted.
    const light = palette('light');
    const linkage = async (colours: ReturnType<typeof palette>) =>
      colours.colourOf((await runAt('1 FAMS @F1@', 'FAMS'))?.classes ?? []);

    expect(await linkage(light)).toBe(light.foreground);

    // Dark is a shade apart rather than identical, and far too close to read as
    // a different colour: #f0f6fc against a #e6edf3 foreground.
    const dark = palette('dark');
    expect(distance(await linkage(dark), dark.foreground)).toBeLessThan(20);
  });

  it('collapses six semantic classes into four colours, or five in dark', async () => {
    // The approximation reported six in both. Asserted exactly, so that
    // improving the scope mapping fails here and forces these notes to be
    // rewritten rather than quietly going stale.
    const distinct = async (theme: 'light' | 'dark') => {
      const colours = palette(theme);
      const seen = new Set<string>();
      for (const [, line, needle] of SAMPLES) {
        seen.add(colours.colourOf((await runAt(line, needle))?.classes ?? []));
      }
      return seen.size;
    };

    expect(await distinct('light')).toBe(4);
    expect(await distinct('dark')).toBe(5);
  });
});

/** Rough channel distance, enough to tell "a shade off" from "another colour". */
function distance(a: string, b: string): number {
  const channels = (hex: string) =>
    [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
  const [x, y] = [channels(a), channels(b)];
  return Math.max(...x.map((value, index) => Math.abs(value - y[index]!)));
}
