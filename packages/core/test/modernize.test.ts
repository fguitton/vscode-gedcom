import { describe, expect, it } from 'vitest';
import { upgradeToGedcom7 } from '../src/index.ts';

describe('upgradeToGedcom7', () => {
  it('upgrades 5.5.1 header to 7.0 and strips CHAR', () => {
    const input = [
      '0 HEAD',
      '1 GEDC',
      '2 VERS 5.5.1',
      '1 CHAR UTF-8',
      '0 @I1@ INDI',
      '1 NAME John /Smith/',
      '0 TRLR',
    ].join('\n');

    const result = upgradeToGedcom7(input);
    expect(result.text).toContain('2 VERS 7.0');
    expect(result.text).not.toContain('1 CHAR');
    expect(result.modifications).toBeGreaterThan(0);
  });

  it('converts CONC lines to CONT', () => {
    const input = [
      '0 HEAD',
      '1 GEDC',
      '2 VERS 5.5.1',
      '0 @I1@ INDI',
      '1 NOTE First line',
      '2 CONC  continued part',
      '0 TRLR',
    ].join('\n');

    const result = upgradeToGedcom7(input);
    expect(result.text).toContain('2 CONT  continued part');
    expect(result.text).not.toContain('CONC');
  });

  it('converts RELA tags to ROLE', () => {
    const input = [
      '0 HEAD',
      '1 GEDC',
      '2 VERS 5.5.1',
      '0 @I1@ INDI',
      '1 ASSO @I2@',
      '2 RELA GODP',
      '0 TRLR',
    ].join('\n');

    const result = upgradeToGedcom7(input);
    expect(result.text).toContain('2 ROLE GODP');
    expect(result.text).not.toContain('RELA');
  });

  it('synthesizes HEAD.SCHMA for extension tags', () => {
    const input = [
      '0 HEAD',
      '1 GEDC',
      '2 VERS 5.5.1',
      '0 @I1@ INDI',
      '1 _CUSTOM_TAG value',
      '0 TRLR',
    ].join('\n');

    const result = upgradeToGedcom7(input);
    expect(result.text).toContain('1 SCHMA');
    expect(result.text).toContain('2 TAG _CUSTOM_TAG http://gedcom.io/terms/v7/_CUSTOM_TAG');
  });

  it('ensures trailing TRLR', () => {
    const input = ['0 HEAD', '1 GEDC', '2 VERS 5.5.1', '0 @I1@ INDI', '1 NAME John /Smith/'].join(
      '\n',
    );

    const result = upgradeToGedcom7(input);
    expect(result.text).toContain('0 TRLR');
  });
});
