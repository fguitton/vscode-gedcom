import { describe, expect, it } from 'vitest';
import { analyze } from '../src/index.ts';
import { bytes } from './corpus.ts';

describe('plausibility checks', () => {
  it('flags death year before birth year', () => {
    const source = [
      '0 HEAD',
      '1 GEDC',
      '2 VERS 7.0',
      '0 @I1@ INDI',
      '1 NAME John /Smith/',
      '1 BIRT',
      '2 DATE 1950',
      '1 DEAT',
      '2 DATE 1920',
      '0 TRLR',
    ].join('\n');

    const analysis = analyze(bytes(source));
    const diag = analysis.diagnostics.find((d) => d.code === 'death-before-birth');
    expect(diag).toBeDefined();
    expect(diag?.message).toContain('Death year (1920) is before birth year (1950)');
  });

  it('flags implausible mother childbearing ages', () => {
    const source = [
      '0 HEAD',
      '1 GEDC',
      '2 VERS 7.0',
      '0 @M@ INDI',
      '1 NAME Mother /Smith/',
      '1 BIRT',
      '2 DATE 1900',
      '1 FAMS @F1@',
      '0 @C@ INDI',
      '1 NAME Child /Smith/',
      '1 BIRT',
      '2 DATE 1908', // Mother was 8 years old
      '1 FAMC @F1@',
      '0 @F1@ FAM',
      '1 WIFE @M@',
      '1 CHIL @C@',
      '0 TRLR',
    ].join('\n');

    const analysis = analyze(bytes(source));
    const diag = analysis.diagnostics.find((d) => d.code === 'implausible-parent-age');
    expect(diag).toBeDefined();
    expect(diag?.message).toContain('Mother was 8 years old');
  });

  it('flags marriage before spouse birth', () => {
    const source = [
      '0 HEAD',
      '1 GEDC',
      '2 VERS 7.0',
      '0 @H@ INDI',
      '1 NAME Groom /Smith/',
      '1 BIRT',
      '2 DATE 1900',
      '1 FAMS @F1@',
      '0 @F1@ FAM',
      '1 HUSB @H@',
      '1 MARR',
      '2 DATE 1890', // Marriage before birth
      '0 TRLR',
    ].join('\n');

    const analysis = analyze(bytes(source));
    const diag = analysis.diagnostics.find((d) => d.code === 'marriage-before-birth');
    expect(diag).toBeDefined();
    expect(diag?.message).toContain('Marriage year (1890) is before');
  });

  it('hints on living person born > 120 years ago without death record', () => {
    const source = [
      '0 HEAD',
      '1 GEDC',
      '2 VERS 7.0',
      '0 @I1@ INDI',
      '1 NAME Ancient /Ancestor/',
      '1 BIRT',
      '2 DATE 1850',
      '0 TRLR',
    ].join('\n');

    const analysis = analyze(bytes(source));
    const diag = analysis.diagnostics.find((d) => d.code === 'implausible-lifespan');
    expect(diag).toBeDefined();
    expect(diag?.severity).toBe('hint');
  });
});
