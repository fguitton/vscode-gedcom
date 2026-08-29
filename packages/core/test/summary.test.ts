import { describe, expect, it } from 'vitest';
import {
  analyzeText,
  formatHeaderSummary,
  formatRecordReferences,
  formatRecordSummary,
  formatTreeLensTitle,
  summarizeRecord,
} from '../src/index.ts';

const SAMPLE_GEDCOM = `0 HEAD
1 GEDC
2 VERS 7.0
0 @I1@ INDI
1 NAME John /Smith/
1 SEX M
1 BIRT
2 DATE 12 AUG 1901
1 FAMS @F1@
0 @I2@ INDI
1 NAME Jane /Doe/
1 SEX F
1 FAMS @F1@
0 @I3@ INDI
1 NAME Jimmy /Smith/
1 FAMC @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
0 @S1@ SOUR
1 TITL Parish Register of St Mary
0 TRLR`;

describe('shared summary and CodeLens line builders', () => {
  const analysis = analyzeText(SAMPLE_GEDCOM);

  it('formats header summary correctly', () => {
    const header = formatHeaderSummary(analysis);
    expect(header).toContain('3 individuals');
    expect(header).toContain('1 family');
    expect(header).toContain('1 source');
  });

  it('summarizes individual records with facts, lifespans, and family shapes', () => {
    const summaryI1 = formatRecordSummary(analysis, 'I1');
    expect(summaryI1).toContain('John Smith');
    expect(summaryI1).toContain('Male');
    expect(summaryI1).toContain('1 spouse');
    expect(summaryI1).toContain('1 child');

    const summaryF1 = formatRecordSummary(analysis, 'F1');
    expect(summaryF1).toContain('John Smith + Jane Doe');
    expect(summaryF1).toContain('1 child');

    const summaryS1 = formatRecordSummary(analysis, 'S1');
    expect(summaryS1).toBe('Parish Register of St Mary');
  });

  it('formats reference counts accurately', () => {
    const refsI1 = formatRecordReferences(analysis, 'I1');
    expect(refsI1.count).toBe(1);
    expect(refsI1.title).toBe('1 reference');

    const refsS1 = formatRecordReferences(analysis, 'S1');
    expect(refsS1.count).toBe(0);
    expect(refsS1.title).toBe('0 references');
  });

  it('formats tree lens title consistently with icon', () => {
    expect(formatTreeLensTitle()).toBe('$(type-hierarchy) Show in Tree');
  });

  it('formats summarizeRecord for individual and family', () => {
    const indi = analysis.xrefs.definitions.get('I1')!;
    expect(summarizeRecord(indi, analysis)).toBe('John Smith');

    const fam = analysis.xrefs.definitions.get('F1')!;
    expect(summarizeRecord(fam, analysis)).toBe('John Smith + Jane Doe');
  });
});
