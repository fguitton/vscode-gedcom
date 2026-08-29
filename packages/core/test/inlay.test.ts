import { describe, expect, it } from 'vitest';

import { formatAgeHint, formatValueHint, HINT_INDENT } from '../src/inlay.ts';

describe('formatValueHint', () => {
  it('formats Female correctly across GEDCOM tags and GEDCOM X URIs', () => {
    expect(formatValueHint('http://gedcomx.org/Female')).toBe('Female');
    expect(formatValueHint('Female')).toBe('Female');
    expect(formatValueHint('female')).toBe('Female');
    expect(formatValueHint('F')).toBe('Female');
  });

  it('formats Male correctly across GEDCOM tags and GEDCOM X URIs', () => {
    expect(formatValueHint('http://gedcomx.org/Male')).toBe('Male');
    expect(formatValueHint('Male')).toBe('Male');
    expect(formatValueHint('male')).toBe('Male');
    expect(formatValueHint('M')).toBe('Male');
  });

  it('formats relationship types consistently', () => {
    expect(formatValueHint('http://gedcomx.org/Couple')).toBe('Couple');
    expect(formatValueHint('Couple')).toBe('Couple');
    expect(formatValueHint('http://gedcomx.org/ParentChild')).toBe('Parent-Child');
    expect(formatValueHint('ParentChild')).toBe('Parent-Child');
    expect(formatValueHint('http://gedcomx.org/AdoptiveParent')).toBe('Adoptive Parent');
  });

  it('returns undefined for unrecognized values', () => {
    expect(formatValueHint('')).toBeUndefined();
    expect(formatValueHint('SomeRandomValue')).toBeUndefined();
  });
});

describe('formatAgeHint', () => {
  it('calculates event ages with appropriate verbs', () => {
    const hint = formatAgeHint('1882', '1952', 'http://gedcomx.org/Death');
    expect(hint?.label).toBe('Died age 70');
  });
});

describe('HINT_INDENT', () => {
  it('is three non-breaking spaces', () => {
    expect(HINT_INDENT).toBe('\u00A0\u00A0\u00A0');
  });
});
