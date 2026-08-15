/**
 * What each exporter is known to do, pinned against a real export.
 *
 * These fixtures are not exempted from the corpus invariants because they are
 * "wrong and uninteresting" — they are pinned here instead, to an exact count of
 * exact diagnostics. A quirk we stop handling fails; a diagnostic we start
 * emitting wrongly fails too. An exemption can only rot.
 */

import { describe, expect, it } from 'vitest';

import { analyze, exporterName, exporterProfile, exporterProfiles } from '../src/index.ts';
import { fixture } from './corpus.ts';

const of = (name: string) => analyze(fixture(name).bytes);

const counts = (name: string): Record<string, number> => {
  const tally: Record<string, number> = {};
  for (const d of of(name).diagnostics) tally[d.code] = (tally[d.code] ?? 0) + 1;
  return tally;
};

describe('recognising the exporter', () => {
  it('reads the program out of HEAD.SOUR', () => {
    expect(exporterName(of('exporter/my-heritage.ged').document)).toBe('MYHERITAGE');
    expect(exporterName(of('exporter/wikitree.ged').document)).toBe('WikiTree');
  });

  it('matches a profile for each', () => {
    expect(exporterProfile(of('exporter/my-heritage.ged').document)?.id).toBe('myheritage');
    expect(exporterProfile(of('exporter/wikitree.ged').document)?.id).toBe('wikitree');
  });

  it('claims nothing about a program it does not know', () => {
    // Royal92 is a 1992 PAF export, and PAF has no profile here.
    expect(exporterProfile(of('v5/Royal92.ged').document)).toBeUndefined();
  });
});

describe('MyHeritage', () => {
  const NAME = 'exporter/my-heritage.ged';

  it('repairs the line breaks it writes inside payloads, and says so', () => {
    // It emits CONC and never CONT, so a value spanning lines arrives as text
    // with no level number. Every one of those is repaired and reported.
    const tally = counts(NAME);
    expect(tally['exporter-repair']).toBe(18);
    expect(tally['malformed-line']).toBeUndefined();
  });

  it('reports the confidence code it invents', () => {
    expect(counts(NAME)['enum-value-unknown']).toBe(7);
  });

  it('keeps the repair visible rather than silent', () => {
    const repairs = of(NAME).diagnostics.filter((d) => d.code === 'exporter-repair');
    for (const repair of repairs) expect(repair.severity).toBe('information');
  });
});

describe('the ambiguous case, which is not repaired', () => {
  const NAME = 'exporter/my-heritage.ged';

  it('leaves a continuation that could be a real line as a line', () => {
    // `1 NAME This is not a NAME line, it is the text of the note above.` is a
    // perfectly good GEDCOM line and perfectly good prose, and nothing in the
    // file settles which was meant. Repairing it would invent a reading of
    // somebody's data; the rule is deliberately confined to lines that could not
    // be structure at all.
    const analysis = of(NAME);
    const line = analysis.text
      .split('\n')
      .findIndex((text) => text.startsWith('1 NAME This is not a NAME line'));
    expect(line).toBeGreaterThan(0);

    const repaired = analysis.diagnostics.some(
      (d) => d.code === 'exporter-repair' && d.span.line === line,
    );
    expect(repaired).toBe(false);

    // It was read as structure — the wrong reading, and the honest one.
    const structure = analysis.document.structures.find((s) => s.span.line === line);
    expect(structure?.tag).toBe('NAME');
  });
});

describe('WikiTree', () => {
  const NAME = 'exporter/wikitree.ged';

  it('needs no repair, because rejoining is all its bug requires', () => {
    // WikiTree splits a multibyte character across a CONC boundary. The halves
    // are meaningless apart and correct together, and CONC folding already joins
    // them — so the profile asks for no repair at all.
    expect(exporterProfile(of(NAME).document)?.repairsContinuations).toBe(false);
    expect(counts(NAME)['exporter-repair']).toBeUndefined();
  });

  it('lexes every line, the split character notwithstanding', () => {
    expect(counts(NAME)['malformed-line']).toBeUndefined();
  });
});

describe('attributing a deviation to the exporter', () => {
  it('names the program in the message rather than blaming the reader', () => {
    const quay = of('exporter/my-heritage.ged').diagnostics.find(
      (d) => d.code === 'enum-value-unknown',
    );
    expect(quay?.message).toContain('MyHeritage Family Tree Builder writes this');
  });

  it(`still reports it, since a reputation is not a reason to hide a fault`, () => {
    expect(counts('exporter/my-heritage.ged')['enum-value-unknown']).toBe(7);
  });

  it('leaves a file from an unknown program exactly as it was', () => {
    const royal = of('v5/Royal92.ged').diagnostics;
    expect(royal.every((d) => !d.message.includes('writes this'))).toBe(true);
  });
});

describe('a header that may be lying', () => {
  it('is recorded for the programs known to do it, and acted on for none', () => {
    const ftm = exporterProfiles().find((p) => p.id === 'ftm');
    expect(ftm?.headerMayLie?.about).toBe('both');
    // Nothing in the pipeline consults it: the file does not say which release
    // wrote it, so a silent override would swap one wrong answer for another.
    expect(ftm?.repairsContinuations).toBe(false);
  });
});
