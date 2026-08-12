/**
 * Targeted scope assertions. Each block corresponds to a defect in the grammar
 * this replaces, so a regression fails loudly and by name.
 */

import { describe, expect, it } from 'vitest';

import { leafScope, tokenize, tokenAt } from './tokenizer.ts';

/** Scope of the token covering `needle`'s first occurrence on `line`. */
async function scopeOf(text: string, needle: string, line = 0): Promise<string> {
  const tokens = await tokenize(text);
  const source = text.split(/\r\n|\r|\n/)[line]!;
  const column = source.indexOf(needle);
  if (column < 0) throw new Error(`"${needle}" not found on line ${line}`);
  const token = tokenAt(tokens, line, column);
  if (!token) throw new Error(`no token at line ${line}, column ${column}`);
  return leafScope(token);
}

describe('line structure', () => {
  it('scopes the level as a number', async () => {
    expect(await scopeOf('0 HEAD', '0')).toBe('constant.numeric.integer.level.gedcom');
  });

  it('scopes a known tag', async () => {
    expect(await scopeOf('0 HEAD', 'HEAD')).toBe('entity.name.tag.gedcom');
  });

  it('distinguishes extension tags from unknown tags', async () => {
    expect(await scopeOf('1 _UID 4F2A', '_UID')).toBe('entity.name.tag.extension.gedcom');
    expect(await scopeOf('1 ZZTOP something', 'ZZTOP')).toBe('entity.name.tag.unknown.gedcom');
  });

  it('recognises an extension tag on a record line', async () => {
    // fixtures/v7/enum-ext.ged: `0 @3@ _LOC`
    expect(await scopeOf('0 @3@ _LOC', '_LOC')).toBe('entity.name.tag.extension.gedcom');
  });

  it('scopes CONT and CONC as continuations, not ordinary tags', async () => {
    expect(await scopeOf('2 CONT more text', 'CONT')).toBe('keyword.control.continuation.gedcom');
    expect(await scopeOf('2 CONC more text', 'CONC')).toBe('keyword.control.continuation.gedcom');
  });

  it('keeps significant leading whitespace inside a CONT payload', async () => {
    // The spec encodes a payload's own leading spaces after the single delimiter.
    const tokens = await tokenize('2 CONT   indented');
    const payload = tokens.find((t) => leafScope(t) === 'string.unquoted.payload.gedcom');
    expect(payload?.text).toBe('  indented');
  });
});

describe('cross-references', () => {
  it('distinguishes a definition from a reference', async () => {
    // The previous grammar gave both the same scope, so no theme could tell an
    // xref declaration from a use of it.
    expect(await scopeOf('0 @I1@ INDI', 'I1')).toBe('entity.name.type.xref.gedcom');
    expect(await scopeOf('1 FAMS @F1@', 'F1')).toBe('variable.other.xref.gedcom');
  });

  it('scopes @VOID@ as a language constant', async () => {
    expect(await scopeOf('1 SUBM @VOID@', 'VOID')).toBe('constant.language.void.gedcom');
  });

  it('accepts 5.5.1 xrefs containing spaces', async () => {
    // fixtures/v5/xref-case.ged. 5.5.1's pointer_string admits any non-at char.
    expect(await scopeOf('0 @NoTe ref@ NOTE mixed', 'NoTe ref')).toBe(
      'entity.name.type.xref.gedcom',
    );
  });

  it('does not treat a bare at-sign in text as a pointer', async () => {
    // The single defect most responsible for the old grammar's runaway highlighting.
    expect(await scopeOf('0 @N07@ SNOTE single @ internal', 'single @ internal')).toBe(
      'string.unquoted.payload.gedcom',
    );
  });

  it('scopes the doubled at-sign escape', async () => {
    expect(await scopeOf('0 @N01@ SNOTE @@ one leading', '@@')).toBe(
      'constant.character.escape.gedcom',
    );
  });
});

describe('regression: state must not leak across lines', () => {
  it('tokenizes the line after an unpaired at-sign correctly', async () => {
    const text = ['0 @N1@ NOTE me@example.com is my email', '0 @I1@ INDI'].join('\n');
    // Under the previous grammar the stray @ opened a pointer that consumed
    // everything below it. The second line must still parse as a record.
    expect(await scopeOf(text, 'I1', 1)).toBe('entity.name.type.xref.gedcom');
    expect(await scopeOf(text, 'INDI', 1)).toBe('entity.name.tag.gedcom');
  });

  it('handles CR-only line endings', async () => {
    const text = '0 HEAD\r1 GEDC\r2 VERS 7.0\r0 TRLR';
    expect(await scopeOf(text, 'TRLR', 3)).toBe('entity.name.tag.gedcom');
  });
});

describe('personal names', () => {
  it('scopes the surname as a delimited string, never a regular expression', async () => {
    expect(await scopeOf('1 NAME John /Smith/', 'Smith')).toBe(
      'string.quoted.other.surname.gedcom',
    );
    expect(await scopeOf('1 NAME John /Smith/', '/')).toBe(
      'punctuation.definition.surname.begin.gedcom',
    );
  });

  it('handles a surname-first name', async () => {
    // fixtures/v7/enum-ext.ged: `1 NAME /Family/ Personal`
    expect(await scopeOf('1 NAME /Family/ Personal', 'Family')).toBe(
      'string.quoted.other.surname.gedcom',
    );
  });
});

describe('dates', () => {
  it('scopes months, numbers and range keywords', async () => {
    expect(await scopeOf('2 DATE 12 AUG 1401', 'AUG')).toBe('constant.language.month.gedcom');
    expect(await scopeOf('2 DATE 12 AUG 1401', '1401')).toBe('constant.numeric.date.gedcom');
    expect(await scopeOf('2 DATE BET 1401 AND 1408', 'BET')).toBe('keyword.operator.date.gedcom');
    expect(await scopeOf('2 DATE BET 1401 AND 1408', 'AND')).toBe('keyword.operator.date.gedcom');
  });

  it('scopes the GEDCOM 7 bare calendar keyword', async () => {
    expect(await scopeOf('2 DATE JULIAN 1401', 'JULIAN')).toBe('constant.language.calendar.gedcom');
  });

  it('scopes the 5.5.1 date escape form', async () => {
    expect(await scopeOf('2 DATE @#DJULIAN@ 1401', '@#DJULIAN@')).toBe(
      'constant.language.calendar.gedcom',
    );
  });

  it('scopes the BCE epoch', async () => {
    expect(await scopeOf('2 DATE 1401 BCE', 'BCE')).toBe('constant.language.epoch.gedcom');
  });
});

describe('malformed input', () => {
  it('flags a line that is not a GEDCOM line', async () => {
    expect(await scopeOf('this is not gedcom', 'this')).toBe('invalid.illegal.line.gedcom');
  });

  it('leaves blank lines alone', async () => {
    const tokens = await tokenize('0 HEAD\n\n0 TRLR');
    const illegal = tokens.filter((t) => leafScope(t).startsWith('invalid'));
    expect(illegal).toEqual([]);
  });
});
