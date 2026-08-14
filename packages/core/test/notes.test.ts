/**
 * Notes carrying markup, and the two ways a long one is split.
 *
 * Raised in issue #2: a MyHeritage export whose `NOTE` holds HTML, broken across
 * `CONC` lines in the middle of a URL. It looks corrupt on screen, and the
 * question it prompted — whether such a value is specification-compliant — has a
 * different answer in each generation. These fixtures pin both.
 */

import { describe, expect, it } from 'vitest';

import { analyze } from '../src/index.ts';
import { fixture } from './corpus.ts';

const notes = (name: string, xref: string): string[] => {
  const analysis = analyze(fixture(name).bytes);
  const record = analysis.xrefs.definitions.get(xref);
  return (record?.children ?? []).filter((c) => c.tag === 'NOTE').map((c) => c.payload ?? '');
};

describe('GEDCOM 5.5.1', () => {
  const NAME = 'notes/html-5.5.1.ged';

  it('joins CONC with nothing between, so a split URL comes out whole', () => {
    // This is the whole reason the screenshot looked broken. CONC exists because
    // 5.5.1 caps a line at 255 characters, and it concatenates with *no*
    // separator — so an exporter may split anywhere at all, including the middle
    // of a word or a URL, and only the rejoined payload means anything.
    const [first, second] = notes(NAME, 'I1');

    expect(first).toContain('https://en.wikipedia.org/wiki/Consolidated_Gold_Fields');
    expect(first).not.toContain('\n');
    expect(second).toContain(
      'https://find-and-update.company-information.service.gov.uk/advanced-search/get-results',
    );
  });

  it('accepts a note written inline rather than as a pointer', () => {
    // `NOTE_STRUCTURE` is defined twice in 5.5.1 — pointing at a note record, or
    // carrying the text in place — and the registry we generate from models only
    // the first. Every inline note in every MyHeritage, Ancestry and PAF export
    // was reported as a broken pointer until this fixture was written.
    const analysis = analyze(fixture(NAME).bytes);
    const pointers = analysis.diagnostics.filter((d) => d.code === 'malformed-pointer');
    expect(pointers.map((d) => `line ${d.span.line + 1}: ${d.message}`)).toEqual([]);
  });

  it('has nothing to say about the markup either way', () => {
    // Well formed, unclosed, crossed, and bare angle brackets used as arithmetic.
    // To 5.5.1 a note is character data; markup in it is characters like any
    // other, and no rule in the specification inspects them.
    const errors = analyze(fixture(NAME).bytes).diagnostics.filter((d) => d.severity === 'error');
    expect(errors.map((d) => `line ${d.span.line + 1}: ${d.message}`)).toEqual([]);
  });
});

describe('GEDCOM 7.0', () => {
  const NAME = 'notes/html-7.0.ged';

  it('declares markup with MIME rather than leaving it to be guessed', () => {
    const analysis = analyze(fixture(NAME).bytes);
    const record = analysis.xrefs.definitions.get('I1');
    const declared = (record?.children ?? [])
      .filter((c) => c.tag === 'NOTE')
      .map((c) => c.children.find((sub) => sub.tag === 'MIME')?.payload);

    // Two declared HTML, one undeclared — which means text/plain, so its markup
    // is content — and one declared plain.
    expect(declared).toEqual(['text/html', 'text/html', undefined, 'text/plain']);
  });

  it('carries line breaks with CONT, which is all 7.0 has', () => {
    // CONC was removed in 7.0 along with the line-length limit that made it
    // necessary, so a payload is split only where a line break is meant.
    const [, , undeclared] = notes(NAME, 'I1');
    expect(undeclared).toContain('\n');
  });

  it('accepts both an inline note and a pointer to a shared one', () => {
    // 7.0 split the two spellings apart: NOTE holds text, SNOTE points at a
    // record. What 5.5.1 wrote one way now has two tags, which is why the
    // pointer-or-text ambiguity does not arise here at all.
    const analysis = analyze(fixture(NAME).bytes);
    const record = analysis.xrefs.definitions.get('I2');
    expect(record?.children.some((c) => c.tag === 'SNOTE')).toBe(true);
    expect(analysis.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});
