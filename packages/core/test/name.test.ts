/**
 * Personal names.
 *
 * The slashes exist because no rule picks the family name out of a corpus that
 * spans every naming convention there is. The tests below are deliberately drawn
 * from conventions that break the naive "last word is the surname" reading.
 */

import { describe, expect, it } from 'vitest';

import { parsePersonalName } from '../src/name.ts';

describe('parsePersonalName', () => {
  it('splits on the surname slashes', () => {
    expect(parsePersonalName('John /Smith/')).toEqual({
      given: 'John',
      surname: 'Smith',
      display: 'John Smith',
    });
  });

  it('reads a suffix after the surname', () => {
    expect(parsePersonalName('John Henry /Smith/ Jr')).toEqual({
      given: 'John Henry',
      surname: 'Smith',
      suffix: 'Jr',
      display: 'John Henry Smith Jr',
    });
  });

  it('handles a surname that is not last', () => {
    expect(parsePersonalName('/Wang/ Xiaoming')).toEqual({
      surname: 'Wang',
      suffix: 'Xiaoming',
      display: 'Wang Xiaoming',
    });
  });

  it('handles a multi-word surname', () => {
    expect(parsePersonalName('Maria /García Lorca/').surname).toBe('García Lorca');
  });

  it('handles a surname particle inside the slashes', () => {
    expect(parsePersonalName('Ludwig /van Beethoven/').surname).toBe('van Beethoven');
  });

  it('treats an unslashed payload as a name with no surname marked', () => {
    // Mononyms are real, and plenty of exporters simply never wrote the slashes.
    expect(parsePersonalName('Pocahontas')).toEqual({
      given: 'Pocahontas',
      display: 'Pocahontas',
    });
  });

  it('handles a surname with no given name', () => {
    expect(parsePersonalName('/Smith/')).toEqual({ surname: 'Smith', display: 'Smith' });
  });

  it('handles non-Latin scripts, which the format is full of', () => {
    expect(parsePersonalName('太郎 /山田/')).toEqual({
      given: '太郎',
      surname: '山田',
      display: '太郎 山田',
    });
  });

  it('collapses the whitespace the slashes leave behind', () => {
    expect(parsePersonalName('John  /Smith/  Jr').display).toBe('John Smith Jr');
  });

  it('survives an empty payload', () => {
    expect(parsePersonalName('')).toEqual({ display: '' });
  });
});
