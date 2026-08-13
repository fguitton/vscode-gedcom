/**
 * Inlay hints, code lenses and document links.
 *
 * All three answer the same complaint: a GEDCOM file is mostly identifiers and
 * codes, and reading it means constantly leaving the line you are on. The tests
 * here are about what appears where, since that is the whole of the feature.
 */

import { describe, expect, it } from 'vitest';

import {
  analyzeDocument,
  codeLenses,
  defaultSettings,
  documentLinks,
  inlayHints,
  resolveSettings,
  type Settings,
} from '../src/features.ts';

const URI = 'file:///tree.ged';

const SOURCE = [
  '0 HEAD', //                             0
  '1 GEDC', //                             1
  '2 VERS 7.0', //                         2
  '1 LANG en-GB', //                       3
  '0 @I1@ INDI', //                        4
  '1 NAME John /Smith/', //                5
  '1 SEX M', //                            6
  '1 BIRT', //                             7
  '2 DATE 12 AUG 1901', //                 8
  '1 CENS', //                             9
  '2 DATE 2 APR 1911', //                 10
  '1 DEAT', //                            11
  '2 DATE 3 MAR 1975', //                 12
  '1 FAMS @F1@', //                       13
  '1 SOUR @S1@', //                       14
  '2 QUAY 3', //                          15
  '0 @I2@ INDI', //                        16
  '1 NAME Jane /Doe/', //                 17
  '1 SEX F', //                           18
  '1 FAMS @F1@', //                       19
  '0 @F1@ FAM', //                        20
  '1 HUSB @I1@', //                       21
  '1 WIFE @I2@', //                       22
  '1 CHIL @VOID@', //                     23
  '0 @S1@ SOUR', //                       24
  '1 TITL Parish register', //            25
  '1 WWW https://example.org/parish', //  26
  '0 @R1@ REPO', //                       27
  '1 NAME County Archive', //             28
  '1 EMAIL archive@example.org', //       29
  '0 TRLR', //                            30
  '',
].join('\n');

const analysis = analyzeDocument(SOURCE);

const WHOLE = { start: { line: 0, character: 0 }, end: { line: 40, character: 0 } };

/**
 * The hint rendered on a line, if any.
 *
 * Trimmed, because every hint carries a leading indent so it does not read as
 * part of the payload it annotates; the indent has its own test.
 */
const hintOn = (line: number, settings: Settings = defaultSettings) => {
  const label = inlayHints(analysis, WHOLE, settings).find(
    (hint) => hint.position.line === line,
  )?.label;
  return typeof label === 'string' ? label.trim() : label;
};

describe('inlay hints', () => {
  it('resolves a pointer to what it names', () => {
    // The single biggest win: every pointer stops being an opaque token.
    expect(hintOn(13)).toBe('John Smith + Jane Doe');
    expect(hintOn(21)).toBe('John Smith');
    expect(hintOn(14)).toBe('Parish register');
  });

  it('leaves @VOID@ alone, since it names nothing by design', () => {
    expect(hintOn(23)).toBeUndefined();
  });

  it('explains an enumerated value', () => {
    expect(hintOn(6)).toBe('male');
    expect(hintOn(18)).toBe('female');
    expect(hintOn(15)).toBe('primary');
  });

  it('names a language tag', () => {
    expect(hintOn(3)).toBe('British English');
  });

  it('says what the event did, not just how old they were', () => {
    // `age 4` beside a death date is true and cold; the verb is the fact the
    // reader is actually taking in.
    expect(hintOn(12)).toBe('died age 73');
    expect(hintOn(10)).toBe('recorded age 9');
  });

  it('sets the hint apart from the payload it annotates', () => {
    // Butted up against the line, a hint reads as though the file itself said
    // `1 SEX M male`.
    const hint = inlayHints(analysis, WHOLE, defaultSettings).find(
      (candidate) => candidate.position.line === 6,
    );
    expect(hint?.label).toMatch(/^\s{2,}male$/);
    expect(hint?.paddingLeft).toBe(true);
  });

  it('does not put an age on the birth it is measured from', () => {
    expect(hintOn(8)).toBeUndefined();
  });

  it('places the hint at the end of the payload', () => {
    const hint = inlayHints(analysis, WHOLE, defaultSettings).find(
      (candidate) => candidate.position.line === 13,
    );
    expect(hint?.position.character).toBe(SOURCE.split('\n')[13]!.length);
    expect(hint?.paddingLeft).toBe(true);
  });

  it('honours the range, so a long file only computes what is on screen', () => {
    const hints = inlayHints(
      analysis,
      { start: { line: 13, character: 0 }, end: { line: 15, character: 0 } },
      defaultSettings,
    );
    expect(hints.map((hint) => hint.position.line).sort((a, b) => a - b)).toEqual([13, 14, 15]);
  });

  it('can be turned off one kind at a time', () => {
    const noPointers = resolveSettings({ inlayHints: { pointers: false } });
    expect(hintOn(13, noPointers)).toBeUndefined();
    // The other kinds keep working.
    expect(hintOn(6, noPointers)).toBe('male');

    const none = resolveSettings({ inlayHints: { pointers: false, values: false, ages: false } });
    expect(inlayHints(analysis, WHOLE, none)).toEqual([]);
  });

  it('shows at most one hint per line', () => {
    const lines = inlayHints(analysis, WHOLE, defaultSettings).map((hint) => hint.position.line);
    expect(new Set(lines).size).toBe(lines.length);
  });
});

describe('code lenses', () => {
  const lensesOn = (line: number) =>
    codeLenses(analysis, URI, defaultSettings)
      .filter((lens) => lens.range.start.line === line)
      .map((lens) => lens.command?.title);

  it('summarises the dataset above the header', () => {
    const [title] = lensesOn(0);
    expect(title).toContain('2 INDI');
    expect(title).toContain('1901–1975');
  });

  it('summarises a person by their shape in the tree', () => {
    expect(lensesOn(4)[0]).toContain('1 spouse');
  });

  it('offers the references as an action', () => {
    const lens = codeLenses(analysis, URI, defaultSettings).find(
      (candidate) =>
        candidate.range.start.line === 4 && /reference/.test(candidate.command?.title ?? ''),
    );

    // @I1@ is named once, by the HUSB line of @F1@.
    expect(lens?.command?.title).toBe('1 reference');
    expect(lens?.command?.command).toBe('gedcom.showReferences');
    // The client converts these to real vscode types before peeking them.
    expect(lens?.command?.arguments?.[0]).toBe(URI);
    expect(Array.isArray(lens?.command?.arguments?.[2])).toBe(true);
  });

  it('leaves a record nothing points at inert rather than peeking nothing', () => {
    const lens = codeLenses(analysis, URI, defaultSettings).find(
      (candidate) =>
        candidate.range.start.line === 27 && candidate.command?.title === '0 references',
    );
    expect(lens?.command?.command).toBe('');
  });

  it('links a person and a family into the graph panel', () => {
    const lens = codeLenses(analysis, URI, defaultSettings).find(
      (candidate) => candidate.range.start.line === 20 && candidate.command?.title === 'graph',
    );
    expect(lens?.command?.command).toBe('gedcom.showGraph');
    expect(lens?.command?.arguments).toEqual([URI, 20]);
  });

  it('can be turned off', () => {
    expect(codeLenses(analysis, URI, resolveSettings({ codeLens: { enabled: false } }))).toEqual(
      [],
    );
  });
});

describe('document links', () => {
  const links = documentLinks(analysis);

  it('links a web address', () => {
    const link = links.find((candidate) => candidate.range.start.line === 26);
    expect(link?.target).toBe('https://example.org/parish');
  });

  it('turns an email address into a mailto', () => {
    const link = links.find((candidate) => candidate.range.start.line === 29);
    expect(link?.target).toBe('mailto:archive@example.org');
  });

  it('does not link a payload that merely contains text', () => {
    // A NAME is not an address, and 5.5.1 notes are full of at-signs.
    expect(links.some((link) => link.range.start.line === 5)).toBe(false);
    expect(links.some((link) => link.range.start.line === 25)).toBe(false);
  });
});

describe('settings', () => {
  it('keeps the defaults a partial section leaves out', () => {
    const settings = resolveSettings({ strictness: 'strict', inlayHints: { ages: false } });
    expect(settings.strictness).toBe('strict');
    expect(settings.inlayHints).toEqual({ pointers: true, values: true, ages: false });
    expect(settings.codeLens).toEqual({ enabled: true });
  });

  it('falls back to the defaults entirely when the client sends nothing', () => {
    expect(resolveSettings(undefined)).toEqual(defaultSettings);
  });
});
