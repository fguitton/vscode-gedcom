/**
 * Enumerated value meanings.
 *
 * Every value the registry admits should have a meaning, or the feature has holes
 * exactly where a reader is most likely to look. The coverage test below is what
 * keeps that true as the registry moves.
 */

import { describe, expect, it } from 'vitest';

import { describeEnumValue, enumSetFor, meaningOf } from '../src/enums.ts';
import { MODELS } from '../src/spec/model.generated.ts';

/** Sets whose values are event tags, named by the registry rather than by us. */
const TAG_VALUED = new Set(['DATA-EVEN', 'SOUR-EVEN', 'NO']);

describe('coverage of the registry', () => {
  it('describes every value of every fixed-meaning enumeration', () => {
    const missing: string[] = [];

    for (const [set, values] of Object.entries(MODELS['7.0']!.enums)) {
      if (TAG_VALUED.has(set)) continue;
      for (const value of values) {
        if (!describeEnumValue(set, value)) missing.push(`${set}.${value}`);
      }
    }

    expect(missing).toEqual([]);
  });
});

describe('describeEnumValue', () => {
  it('explains the confidence codes, which are pure numbers otherwise', () => {
    expect(describeEnumValue('QUAY', '3')?.label).toBe('primary');
    expect(describeEnumValue('QUAY', '0')?.note).toMatch(/[Uu]nreliable/);
  });

  it('covers the whole of SEX, not only the two common values', () => {
    expect(describeEnumValue('SEX', 'M')?.label).toBe('male');
    expect(describeEnumValue('SEX', 'F')?.label).toBe('female');
    expect(describeEnumValue('SEX', 'X')?.label).toBe('neither');
    expect(describeEnumValue('SEX', 'U')?.label).toBe('unknown');
  });

  it('is case-insensitive and ignores surrounding space', () => {
    expect(describeEnumValue('PEDI', ' adopted ')?.label).toBe('adopted');
  });

  it('has nothing to say about a value outside the set', () => {
    expect(describeEnumValue('SEX', 'Z')).toBeUndefined();
    expect(describeEnumValue('NOT_A_SET', 'M')).toBeUndefined();
  });
});

describe('enumSetFor', () => {
  it('prefers the registry slug, which already carries the context', () => {
    expect(enumSetFor('FAMC-STAT', 'STAT')).toBe('FAMC-STAT');
  });

  it('falls back to the tag for 5.5.1 files, which have no modelled enumerations', () => {
    expect(enumSetFor(undefined, 'SEX')).toBe('SEX');
    expect(enumSetFor(null, 'QUAY')).toBe('QUAY');
  });

  it('distinguishes STAT by its parent, because the two are unrelated', () => {
    expect(enumSetFor(undefined, 'STAT', 'FAMC')).toBe('FAMC-STAT');
    expect(enumSetFor(undefined, 'STAT', 'SLGC')).toBe('ord-STAT');
  });

  it('maps the 5.5.1 spelling of ROLE', () => {
    // 5.5.1 called it RELA; GEDCOM 7 renamed it to ROLE without changing the set.
    expect(enumSetFor(undefined, 'RELA')).toBe('ROLE');
  });

  it('does not claim TYPE is a name type outside NAME', () => {
    expect(enumSetFor(undefined, 'TYPE', 'NAME')).toBe('NAME-TYPE');
    expect(enumSetFor(undefined, 'TYPE', 'EVEN')).toBeUndefined();
  });
});

describe('meaningOf', () => {
  it('resolves a value from its position in the tree', () => {
    expect(meaningOf('FAMC-STAT', 'STAT', 'PROVEN')?.label).toBe('proven');
    expect(meaningOf(undefined, 'PEDI', 'FOSTER', 'FAMC')?.label).toBe('foster');
  });

  it('says nothing where the payload is not enumerated', () => {
    expect(meaningOf(undefined, 'NAME', 'John /Smith/')).toBeUndefined();
  });
});
