/**
 * Non-Latin content in the grammar.
 *
 * GEDCOM syntax is ASCII, but payloads are not — names, places and notes are the
 * bulk of any real file and are written in whatever script the family used. The
 * grammar must never lose a line because its payload is not Latin, and must stay
 * at least as permissive as the parser in packages/core.
 */

import { describe, expect, it } from 'vitest';

import { leafScope, tokenize } from './tokenizer.ts';

const NAMES = [
  ['Japanese', '山田 /太郎/', '太郎'],
  ['Chinese', '/李/ 小龍', '李'],
  ['Arabic', 'محمد /الخوارزمي/', 'الخوارزمي'],
  ['Hebrew', 'משה /רבינו/', 'רבינו'],
  ['Greek', 'Αρχιμήδης /Συρακούσιος/', 'Συρακούσιος'],
  ['Cyrillic', 'Пётр /Чайковский/', 'Чайковский'],
  ['Devanagari', '/गांधी/ मोहनदास', 'गांधी'],
  ['Vietnamese', 'Nguyễn /Trãi/', 'Trãi'],
  ['astral plane', '𒀭𒂗𒆠 /𒌷𒀖/', '𒌷𒀖'],
] as const;

describe('payloads in any script', () => {
  it.each(NAMES)('scopes a %s surname', async (_script, payload, surname) => {
    const line = `1 NAME ${payload}`;
    const tokens = await tokenize(line);
    const column = line.indexOf(surname);
    const token = tokens.find((t) => t.startIndex <= column && column < t.endIndex);
    expect(leafScope(token!)).toBe('string.quoted.other.surname.gedcom');
  });

  it.each(NAMES)('never marks a %s line invalid', async (_script, payload) => {
    const tokens = await tokenize(`1 NAME ${payload}`);
    expect(tokens.filter((t) => leafScope(t).startsWith('invalid'))).toEqual([]);
  });

  it('scopes a non-Latin note payload as a payload', async () => {
    const line = '1 NOTE 第一行です';
    const tokens = await tokenize(line);
    const column = line.indexOf('第');
    const token = tokens.find((t) => t.startIndex <= column && column < t.endIndex);
    expect(leafScope(token!)).toBe('string.unquoted.payload.gedcom');
  });
});

describe('non-Latin cross-references', () => {
  it('scopes a non-Latin xref definition', async () => {
    // Neither specification permits this, but files in the wild contain it, and
    // the parser accepts it. The grammar must not be the stricter of the two.
    const line = '0 @家族1@ FAM';
    const tokens = await tokenize(line);
    const column = line.indexOf('家');
    const token = tokens.find((t) => t.startIndex <= column && column < t.endIndex);
    expect(leafScope(token!)).toBe('entity.name.type.xref.gedcom');
  });

  it('scopes a non-Latin pointer reference', async () => {
    const line = '1 FAMS @家族1@';
    const tokens = await tokenize(line);
    const column = line.indexOf('家');
    const token = tokens.find((t) => t.startIndex <= column && column < t.endIndex);
    expect(leafScope(token!)).toBe('variable.other.xref.gedcom');
  });

  it('still refuses to read a date escape as a pointer', async () => {
    // The reason the xref pattern constrains its first character at all.
    const line = '2 DATE @#DJULIAN@ 1401';
    const tokens = await tokenize(line);
    const column = line.indexOf('@#');
    const token = tokens.find((t) => t.startIndex <= column && column < t.endIndex);
    expect(leafScope(token!)).toBe('constant.language.calendar.gedcom');
  });

  it('still refuses to read a doubled at-sign as a pointer', async () => {
    const line = '0 @N1@ SNOTE @@ leading';
    const tokens = await tokenize(line);
    const column = line.indexOf('@@');
    const token = tokens.find((t) => t.startIndex <= column && column < t.endIndex);
    expect(leafScope(token!)).toBe('constant.character.escape.gedcom');
  });
});
