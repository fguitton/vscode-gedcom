/**
 * Per-verb hovers.
 *
 * The rule these are written against: a hover must answer the question the line
 * provokes, not restate the tag. Each test below names the question.
 */

import { describe, expect, it } from 'vitest';

import { analyzeDocument, hover } from '../src/features.ts';

/**
 * The markdown of the hover over `target`, on the first line containing `needle`.
 *
 * The two are separate because a position has to land inside the token being
 * asked about, and a needle written to identify a line usually starts at the
 * level digit — which belongs to no span at all.
 */
function hoverText(source: string, needle: string, target = needle): string {
  const analysis = analyzeDocument(source);

  for (const [line, text] of source.split('\n').entries()) {
    if (!text.includes(needle)) continue;

    const character = text.indexOf(target);
    if (character < 0) throw new Error(`${target} is not on the line matching ${needle}`);

    const result = hover(analysis, { line, character: character + 1 });
    const contents = result?.contents;
    return contents && typeof contents === 'object' && 'value' in contents ? contents.value : '';
  }

  throw new Error(`no line containing ${needle}`);
}

const PERSON = [
  '0 HEAD',
  '1 GEDC',
  '2 VERS 7.0',
  '1 PLAC',
  '2 FORM City, County, Country',
  '0 @I1@ INDI',
  '1 NAME John Henry /Smith/ Jr',
  '1 SEX M',
  '1 BIRT',
  '2 DATE 12 AUG 1901',
  '1 CENS',
  '2 DATE 2 APR 1911',
  '2 AGE 9y',
  '2 PLAC Chelsea, Middlesex, England',
  '3 MAP',
  '4 LATI N51.4875',
  '4 LONG W0.1687',
  '1 DEAT',
  '2 DATE 3 MAR 1975',
  '2 AGE 40y',
  '1 FAMS @F1@',
  '0 @I2@ INDI',
  '1 NAME Jane /Doe/',
  '0 @F1@ FAM',
  '1 HUSB @I1@',
  '1 WIFE @I2@',
  '1 CHIL @I3@',
  '1 NCHI 3',
  '0 @I3@ INDI',
  '0 TRLR',
  '',
].join('\n');

describe('dates', () => {
  it('answers "what day was that" for an exact date', () => {
    expect(hoverText(PERSON, 'DATE 12 AUG 1901')).toContain('Monday');
  });

  it('answers "how old were they" for an event date', () => {
    const text = hoverText(PERSON, 'DATE 2 APR 1911');
    expect(text).toMatch(/Census at \*\*9 years\*\* old/);
  });

  it('does not put an age on the birth it is measured from', () => {
    expect(hoverText(PERSON, 'DATE 12 AUG 1901')).not.toMatch(/old/);
  });

  it('answers "is this date asserted" for a qualified one', () => {
    const source = '0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @I1@ INDI\n1 BIRT\n2 DATE ABT 1901\n0 TRLR\n';
    expect(hoverText(source, 'DATE ABT 1901')).toMatch(/Approximate/);
  });

  it('answers "is this maintained" for a bookkeeping date', () => {
    const source = [
      '0 HEAD',
      '1 GEDC',
      '2 VERS 7.0',
      '0 @I1@ INDI',
      '1 CHAN',
      '2 DATE 1 JAN 2010',
      '0 TRLR',
      '',
    ].join('\n');
    expect(hoverText(source, 'DATE 1 JAN 2010')).toMatch(/Last changed \*\*\d+ years ago\*\*/);
  });
});

describe('ages', () => {
  it('reads the notation out', () => {
    expect(hoverText(PERSON, 'AGE 9y')).toContain('9 years');
  });

  it('confirms an age the dates agree with', () => {
    expect(hoverText(PERSON, 'AGE 9y')).toMatch(/Consistent/);
  });

  it('flags an age the dates contradict, which nothing else checks', () => {
    // Born 1901, died 1975 — the record says 40, the dates say 73.
    const text = hoverText(PERSON, 'AGE 40y');
    expect(text).toContain('⚠️');
    expect(text).toContain('73 years');
  });
});

describe('enumerated values', () => {
  it('answers "what does this code mean"', () => {
    expect(hoverText(PERSON, 'SEX M')).toContain('male');
  });

  it('explains the confidence codes, which are bare numbers', () => {
    const source = [
      '0 HEAD',
      '1 GEDC',
      '2 VERS 7.0',
      '0 @I1@ INDI',
      '1 SOUR @S1@',
      '2 QUAY 3',
      '0 @S1@ SOUR',
      '0 TRLR',
      '',
    ].join('\n');
    const text = hoverText(source, 'QUAY 3');
    expect(text).toContain('primary');
    expect(text).toMatch(/[Dd]irect and primary evidence/);
  });

  it('lists the alternatives when the value is not one of them', () => {
    const source = '0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @I1@ INDI\n1 SEX Q\n0 TRLR\n';
    expect(hoverText(source, 'SEX Q')).toMatch(/Expected one of.*`M`/);
  });
});

describe('places', () => {
  it('answers "which of these is the county"', () => {
    const text = hoverText(PERSON, 'PLAC Chelsea');
    expect(text).toContain('**City:** Chelsea');
    expect(text).toContain('**County:** Middlesex');
    expect(text).toContain('**Country:** England');
  });

  it('gives coordinates a reader can check against a map', () => {
    const text = hoverText(PERSON, 'LATI N51.4875');
    expect(text).toContain('51.4875° north');
  });
});

describe('names', () => {
  it('answers "which part is the surname"', () => {
    const text = hoverText(PERSON, 'NAME John Henry');
    expect(text).toContain('**Given:** John Henry');
    expect(text).toContain('**Surname:** Smith');
    expect(text).toContain('**Suffix:** Jr');
  });

  it('says so when no surname is marked', () => {
    const source = '0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @I1@ INDI\n1 NAME Pocahontas\n0 TRLR\n';
    expect(hoverText(source, 'NAME Pocahontas')).toMatch(/No surname is marked/);
  });
});

describe('counts', () => {
  it('answers "how many are still missing"', () => {
    // The family claims three children and records one.
    const text = hoverText(PERSON, 'NCHI 3');
    expect(text).toContain('**3** claimed');
    expect(text).toContain('2 missing');
  });
});

describe('the header', () => {
  it('answers "what is in this file"', () => {
    const text = hoverText(PERSON, '0 HEAD', 'HEAD');
    expect(text).toContain('3 individuals');
    expect(text).toContain('1 family');
    expect(text).toMatch(/1901.*1975/);
  });
});

describe('payload types', () => {
  it('never shows the registry spelling of a type', () => {
    for (const needle of ['NAME John Henry', 'SEX M', 'DATE 12 AUG 1901', 'PLAC Chelsea']) {
      const text = hoverText(PERSON, needle);
      expect(text).not.toContain('XMLSchema');
      expect(text).not.toContain('type-');
    }
  });

  it('describes the payload and gives an example', () => {
    expect(hoverText(PERSON, 'DATE 12 AUG 1901')).toMatch(/date.*for example/i);
  });

  it('says when a structure takes no payload of its own', () => {
    expect(hoverText(PERSON, '1 BIRT', 'BIRT')).toMatch(/Y.*asserts the event took place/);
  });

  it('says how many times a structure may appear', () => {
    expect(hoverText(PERSON, 'SEX M')).toMatch(/Optional, at most one/);
  });
});

describe('migration', () => {
  it('answers "what should I write instead" for a removed tag', () => {
    const source = [
      '0 HEAD',
      '1 GEDC',
      '2 VERS 7.0',
      '0 @I1@ INDI',
      '1 NAME John /Smith/',
      '2 ROMN Smith',
      '0 TRLR',
      '',
    ].join('\n');

    const text = hoverText(source, 'ROMN Smith');
    expect(text).toContain('removed in GEDCOM 7');
    expect(text).toContain('`TRAN`');
  });
});

describe('pointers', () => {
  it('describes the record rather than restating the tag', () => {
    const text = hoverText(PERSON, 'HUSB @I1@', '@I1@');
    expect(text).toContain('John Henry Smith');
    expect(text).toMatch(/1 spouse/);
  });
});

describe('plain English', () => {
  it('leads with the name of the structure, not its tag', () => {
    expect(hoverText(PERSON, '1 FAMS', 'FAMS')).toContain('**Family spouse**');
  });

  it('says what a pointer points at in words', () => {
    // `Takes a pointer to a NOTE record` asks the reader to already know the
    // vocabulary they came here to look up.
    const source = [
      '0 HEAD',
      '1 GEDC',
      '2 VERS 7.0',
      '0 @I1@ INDI',
      '1 ASSO @I2@',
      '2 ROLE OTHER',
      '0 @I2@ INDI',
      '0 TRLR',
      '',
    ].join('\n');

    const text = hoverText(source, '1 ASSO', 'ASSO');
    expect(text).toContain('**Associates**');
    expect(text).toMatch(/Points at an? \*\*Individual\*\* record/);
  });

  it('qualifies a maintenance date instead of copying it', () => {
    const source = [
      '0 HEAD',
      '1 GEDC',
      '2 VERS 7.0',
      '0 @I1@ INDI',
      '1 CHAN',
      '2 DATE 1 JAN 2010',
      '0 TRLR',
      '',
    ].join('\n');

    const text = hoverText(source, '1 CHAN', 'CHAN');
    expect(text).toMatch(/Last changed on \*\*1 JAN 2010\*\* — \d+ years ago\./);
  });

  it('writes an event as a sentence rather than as its fields', () => {
    const text = hoverText(PERSON, '1 CENS', 'CENS');
    expect(text).toMatch(/^.*[Cc]ensus recorded on \*\*2 APR 1911\*\* at \*\*Chelsea/m);
  });
});

describe('tags whose payload is plain text', () => {
  const source = [
    '0 HEAD',
    '1 GEDC',
    '2 VERS 7.0',
    '0 @I1@ INDI',
    '1 OCCU Lighthouse keeper',
    '1 NPFX Dr',
    '1 SEX F',
    '0 TRLR',
    '',
  ].join('\n');

  it('says what the tag is for instead of that it holds text', () => {
    // The registry gives labels and payload types and no prose, so a hover built
    // from it alone answered `1 OCCU Lighthouse keeper` with "Text." — a fact the
    // reader could see for themselves.
    const text = hoverText(source, '1 OCCU', 'OCCU');
    expect(text).toContain('**Occupation**');
    expect(text).toContain('The trade or profession');
    expect(text).not.toContain('Text.');
  });

  it('distinguishes the tags a reader confuses', () => {
    const text = hoverText(source, '1 NPFX', 'NPFX');
    expect(text).toContain('standing before the name');
  });

  it('still names a payload type worth naming', () => {
    // Dropping the payload line is only right where it said nothing. A date, an
    // integer or an enumerated value is a constraint on what may be written.
    const dated = hoverText(
      [
        '0 HEAD',
        '1 GEDC',
        '2 VERS 7.0',
        '0 @I1@ INDI',
        '1 BIRT',
        '2 DATE 1 JAN 1900',
        '0 TRLR',
        '',
      ].join('\n'),
      '2 DATE',
      'DATE',
    );
    expect(dated).toMatch(/for example/);
  });
});
