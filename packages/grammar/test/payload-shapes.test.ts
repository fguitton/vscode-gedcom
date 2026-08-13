/**
 * Payload shapes the grammar can check on its own.
 *
 * TextMate cannot ask what a structure's context is, so it can only judge a
 * payload where the tag pins its shape in *every* context and in both
 * generations. That is a small set, and the value of these tests is mostly in
 * guarding the other direction: a rule that fires on a correct file is far worse
 * than one that misses an error, because the parser catches the error anyway.
 */

import { describe, expect, it } from 'vitest';

import { leafScope, tokenize } from './tokenizer.ts';

/** The scope of the payload on a single line. */
async function payloadScope(line: string): Promise<string> {
  const tokens = await tokenize(line);
  return leafScope(tokens[tokens.length - 1]!);
}

const ILLEGAL = 'invalid.illegal.value.gedcom';

describe('pointers', () => {
  it('marks a payload that is not exactly a pointer', async () => {
    expect(await payloadScope('1 ASSO @I1@ df')).toBe('invalid.illegal.pointer.gedcom');
    expect(await payloadScope('1 FAMC nonsense')).toBe('invalid.illegal.pointer.gedcom');
  });

  it('leaves a well-formed pointer alone', async () => {
    expect(await payloadScope('1 ASSO @I1@')).toBe('punctuation.definition.xref.end.gedcom');
  });

  it('does not touch a tag that is a pointer only sometimes', async () => {
    // SOUR is a pointer under INDI and free text under HEAD. A grammar cannot
    // tell which, so it must not guess.
    expect(await payloadScope('1 SOUR MYPROG')).toBe('string.unquoted.payload.gedcom');
  });
});

describe('enumerated payloads', () => {
  it('marks a value outside the set', async () => {
    expect(await payloadScope('1 SEX Q')).toBe(ILLEGAL);
    expect(await payloadScope('2 QUAY 9')).toBe(ILLEGAL);
    expect(await payloadScope('2 PEDI wrong')).toBe(ILLEGAL);
    expect(await payloadScope('1 RESN nope')).toBe(ILLEGAL);
  });

  it('accepts every value the specification defines', async () => {
    for (const line of ['1 SEX M', '1 SEX F', '1 SEX U', '1 SEX X']) {
      expect(await payloadScope(line)).toBe('string.unquoted.payload.gedcom');
    }
    for (const line of ['2 QUAY 0', '2 QUAY 1', '2 QUAY 2', '2 QUAY 3']) {
      expect(await payloadScope(line)).toBe('string.unquoted.payload.gedcom');
    }
  });

  it('accepts the lower case 5.5.1 wrote its values in', async () => {
    expect(await payloadScope('2 PEDI adopted')).toBe('string.unquoted.payload.gedcom');
    expect(await payloadScope('1 RESN confidential')).toBe('string.unquoted.payload.gedcom');
  });

  it('accepts a list where the specification allows one', async () => {
    expect(await payloadScope('1 RESN CONFIDENTIAL, LOCKED')).toBe(
      'string.unquoted.payload.gedcom',
    );
  });

  it('accepts extension values, which GEDCOM 7 permits anywhere an enum goes', async () => {
    expect(await payloadScope('1 SEX _CUSTOM')).toBe('string.unquoted.payload.gedcom');
    expect(await payloadScope('2 PEDI https://example.org/pedi')).toBe(
      'string.unquoted.payload.gedcom',
    );
  });

  it('keeps the tag coloured even when the payload is wrong', async () => {
    // The error is in the payload; recolouring the whole line as text would lose
    // the reader's place rather than point at the problem.
    const tokens = await tokenize('1 SEX Q');
    expect(tokens.some((token) => leafScope(token).startsWith('entity.name.tag'))).toBe(true);
  });
});

describe('numeric payloads', () => {
  it('marks a count that is not a number', async () => {
    expect(await payloadScope('1 NCHI three')).toBe(ILLEGAL);
    expect(await payloadScope('1 NMR many')).toBe(ILLEGAL);
  });

  it('leaves a number alone', async () => {
    expect(await payloadScope('1 NCHI 3')).toBe('string.unquoted.payload.gedcom');
    expect(await payloadScope('1 NCHI 0')).toBe('string.unquoted.payload.gedcom');
  });
});

describe('ages and times', () => {
  it('accepts every form of the age notation', async () => {
    for (const line of [
      '2 AGE 20y',
      '2 AGE 20y 6m',
      '2 AGE 20y 6m 3w 2d',
      '2 AGE < 8y',
      '2 AGE > 30y',
      '2 AGE CHILD',
      '2 AGE INFANT',
      '2 AGE STILLBORN',
    ]) {
      expect(await payloadScope(line)).toBe('string.unquoted.payload.gedcom');
    }
  });

  it('marks an age that is not one', async () => {
    expect(await payloadScope('2 AGE old')).toBe(ILLEGAL);
    expect(await payloadScope('2 AGE about 20')).toBe(ILLEGAL);
  });

  it('accepts a time, in either notation', async () => {
    for (const line of ['2 TIME 14:30', '2 TIME 14:30:00', '2 TIME 14:30:00.5', '2 TIME 2:30 PM']) {
      expect(await payloadScope(line)).toBe('string.unquoted.payload.gedcom');
    }
  });

  it('marks a time that is not one', async () => {
    expect(await payloadScope('2 TIME half past')).toBe(ILLEGAL);
  });
});

describe('the rules stay out of the way', () => {
  it('never fires on a tag name appearing inside text', async () => {
    expect(await payloadScope('1 NOTE SEX is a tag and AGE is another')).toBe(
      'string.unquoted.payload.gedcom',
    );
  });

  it('never fires on a lower case tag, which is a different problem', async () => {
    expect(await payloadScope('1 sex m')).toBe('string.unquoted.payload.gedcom');
  });
});
