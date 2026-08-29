import { describe, expect, it } from 'vitest';
import { gedcomXToGedcom7 } from '../../src/gedcomx/to-gedcom7.ts';
import { gedcomToGedcomX } from '../../src/gedcomx/from-gedcom.ts';
import type { Gedcomx } from '../../src/gedcomx/types.ts';
import { parse } from '../../src/parser.ts';

describe('GEDCOM X <-> GEDCOM 7 bidirectional conversion', () => {
  const familyDoc: Gedcomx = {
    persons: [
      {
        id: 'P-1',
        gender: { type: 'http://gedcomx.org/Male' },
        names: [
          {
            nameForms: [
              {
                fullText: 'John /Smith/',
                parts: [
                  { type: 'http://gedcomx.org/Given', value: 'John' },
                  { type: 'http://gedcomx.org/Surname', value: 'Smith' },
                ],
              },
            ],
          },
        ],
        facts: [
          {
            type: 'http://gedcomx.org/Birth',
            date: { original: '10 MAY 1880' },
            place: { original: 'London, England' },
          },
        ],
      },
      {
        id: 'P-2',
        gender: { type: 'http://gedcomx.org/Female' },
        names: [
          {
            nameForms: [
              {
                fullText: 'Mary /Jones/',
                parts: [
                  { type: 'http://gedcomx.org/Given', value: 'Mary' },
                  { type: 'http://gedcomx.org/Surname', value: 'Jones' },
                ],
              },
            ],
          },
        ],
        facts: [
          {
            type: 'http://gedcomx.org/Birth',
            date: { original: '15 AUG 1882' },
          },
        ],
      },
      {
        id: 'P-3',
        gender: { type: 'http://gedcomx.org/Male' },
        names: [
          {
            nameForms: [
              {
                fullText: 'William /Smith/',
                parts: [
                  { type: 'http://gedcomx.org/Given', value: 'William' },
                  { type: 'http://gedcomx.org/Surname', value: 'Smith' },
                ],
              },
            ],
          },
        ],
        facts: [
          {
            type: 'http://gedcomx.org/Birth',
            date: { original: '1905' },
          },
        ],
      },
    ],
    relationships: [
      {
        id: 'R-COUPLE-1',
        type: 'http://gedcomx.org/Couple',
        person1: { resource: '#P-1' },
        person2: { resource: '#P-2' },
        facts: [
          {
            type: 'http://gedcomx.org/Marriage',
            date: { original: '1904' },
            place: { original: 'London, England' },
          },
        ],
      },
      {
        id: 'R-PC-1',
        type: 'http://gedcomx.org/ParentChild',
        person1: { resource: '#P-1' },
        person2: { resource: '#P-3' },
      },
      {
        id: 'R-PC-2',
        type: 'http://gedcomx.org/ParentChild',
        person1: { resource: '#P-2' },
        person2: { resource: '#P-3' },
      },
    ],
  };

  it('converts GEDCOM X to valid GEDCOM 7.0 structure', () => {
    const gedcom7 = gedcomXToGedcom7(familyDoc);

    expect(gedcom7).toContain('0 HEAD');
    expect(gedcom7).toContain('1 GEDC');
    expect(gedcom7).toContain('2 VERS 7.0');

    expect(gedcom7).toContain('0 @I_P_1@ INDI');
    expect(gedcom7).toContain('1 NAME John /Smith/');
    expect(gedcom7).toContain('1 SEX M');
    expect(gedcom7).toContain('1 BIRT');
    expect(gedcom7).toContain('2 DATE 10 MAY 1880');
    expect(gedcom7).toContain('2 PLAC London, England');
    expect(gedcom7).toContain('1 FAMS @F_R_COUPLE_1@');

    expect(gedcom7).toContain('0 @I_P_2@ INDI');
    expect(gedcom7).toContain('1 NAME Mary /Jones/');
    expect(gedcom7).toContain('1 SEX F');
    expect(gedcom7).toContain('1 FAMS @F_R_COUPLE_1@');

    expect(gedcom7).toContain('0 @I_P_3@ INDI');
    expect(gedcom7).toContain('1 NAME William /Smith/');
    expect(gedcom7).toContain('1 FAMC @F_R_COUPLE_1@');

    expect(gedcom7).toContain('0 @F_R_COUPLE_1@ FAM');
    expect(gedcom7).toContain('1 HUSB @I_P_1@');
    expect(gedcom7).toContain('1 WIFE @I_P_2@');
    expect(gedcom7).toContain('1 CHIL @I_P_3@');
    expect(gedcom7).toContain('1 MARR');
    expect(gedcom7).toContain('2 DATE 1904');
    expect(gedcom7).toContain('0 TRLR');

    // Verify it parses cleanly with standard GEDCOM parser
    const doc = parse(gedcom7);
    expect(doc.records.length).toBe(6); // HEAD, 3 INDI, 1 FAM, TRLR
    expect(doc.diagnostics.length).toBe(0);
  });

  it('converts GEDCOM 7 / 5.5.1 to GEDCOM X structure', () => {
    const gedcomSource = `0 HEAD
1 GEDC
2 VERS 7.0
0 @I1@ INDI
1 NAME George /Washington/
2 GIVN George
2 SURN Washington
1 SEX M
1 BIRT
2 DATE 22 FEB 1732
2 PLAC Pope's Creek, Virginia
1 DEAT
2 DATE 14 DEC 1799
1 FAMS @F1@
0 @I2@ INDI
1 NAME Martha /Dandridge/
2 GIVN Martha
2 SURN Dandridge
1 SEX F
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 6 JAN 1759
0 TRLR
`;

    const gx = gedcomToGedcomX(gedcomSource);
    expect(gx.persons?.length).toBe(2);
    const george = gx.persons?.find((p) => p.id === 'I1');
    expect(george).toBeDefined();
    expect(george?.gender?.type).toBe('http://gedcomx.org/Male');
    expect(george?.names?.[0]?.nameForms?.[0]?.fullText).toBe('George /Washington/');
    expect(
      george?.facts?.some(
        (f) => f.type === 'http://gedcomx.org/Birth' && f.date?.original === '22 FEB 1732',
      ),
    ).toBe(true);

    expect(gx.relationships?.length).toBe(1);
    const rel = gx.relationships?.[0];
    expect(rel?.type).toBe('http://gedcomx.org/Couple');
    expect(rel?.person1?.resource).toBe('#I1');
    expect(rel?.person2?.resource).toBe('#I2');
    expect(rel?.facts?.[0]?.type).toBe('http://gedcomx.org/Marriage');
    expect(rel?.facts?.[0]?.date?.original).toBe('6 JAN 1759');
  });
});
