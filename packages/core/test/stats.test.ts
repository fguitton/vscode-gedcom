/**
 * Whole-file statistics.
 *
 * What a reader wants on opening an unfamiliar file, and what the header refuses
 * to tell them. The date range is the part with a real judgement in it: a single
 * placeholder year would otherwise define the span for the whole file.
 */

import { describe, expect, it } from 'vitest';

import { analyze } from '../src/index.ts';
import { statistics } from '../src/stats.ts';
import { bytes } from './corpus.ts';

const FILE = [
  '0 HEAD',
  '1 GEDC',
  '2 VERS 7.0',
  '0 @I1@ INDI',
  '1 BIRT',
  '2 DATE 12 AUG 1901',
  '1 DEAT',
  '2 DATE 3 MAR 1975',
  '1 FAMS @F1@',
  '1 SOUR @S1@',
  '0 @I2@ INDI',
  '1 BIRT',
  '2 DATE 1899',
  '1 FAMS @F1@',
  '0 @F1@ FAM',
  '1 HUSB @I1@',
  '1 WIFE @I2@',
  '0 @S1@ SOUR',
  '0 @S2@ SOUR',
  '0 TRLR',
  '',
].join('\n');

const analysis = analyze(bytes(FILE));

describe('statistics', () => {
  it('counts records by tag', () => {
    const stats = statistics(analysis);
    expect(stats.records).toEqual({ HEAD: 1, INDI: 2, FAM: 1, SOUR: 2, TRLR: 1 });
    expect(stats.total).toBe(7);
  });

  it('reports the span the dates cover', () => {
    const stats = statistics(analysis);
    expect(stats.earliest).toBe(1899);
    expect(stats.latest).toBe(1975);
  });

  it('counts records nothing points at', () => {
    // @S2@ is cited nowhere; @F1@ and @S1@ both are.
    const stats = statistics(analysis);
    expect(stats.unreferenced).toBe(1);
  });

  it('counts dangling pointers', () => {
    const broken = analyze(
      bytes('0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @I1@ INDI\n1 FAMS @NOPE@\n0 TRLR\n'),
    );
    expect(statistics(broken).dangling).toBe(1);
  });

  it('does not count @VOID@ as dangling, since it leads nowhere by design', () => {
    const voided = analyze(
      bytes('0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @I1@ INDI\n1 FAMS @VOID@\n0 TRLR\n'),
    );
    expect(statistics(voided).dangling).toBe(0);
  });

  it('ignores implausible years, which would otherwise define the span', () => {
    const withJunk = analyze(
      bytes(
        [
          '0 HEAD',
          '1 GEDC',
          '2 VERS 7.0',
          '0 @I1@ INDI',
          '1 BIRT',
          '2 DATE 1 JAN 0001',
          '1 DEAT',
          '2 DATE 1 JAN 3000',
          '1 CENS',
          '2 DATE 1901',
          '0 TRLR',
          '',
        ].join('\n'),
      ),
    );

    const stats = statistics(withJunk);
    expect(stats.earliest).toBe(1901);
    expect(stats.latest).toBe(1901);
  });

  it('has no span for a file with no dates', () => {
    const dateless = analyze(bytes('0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @I1@ INDI\n0 TRLR\n'));
    const stats = statistics(dateless);
    expect(stats.earliest).toBeUndefined();
    expect(stats.latest).toBeUndefined();
  });
});
