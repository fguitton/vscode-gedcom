import { describe, expect, it } from 'vitest';
import { analyzeText, buildKeywordTooltip, buildRecordTooltip } from '../src/index.ts';

const SAMPLE_GEDCOM = `0 HEAD
1 GEDC
2 VERS 7.0
0 @I1@ INDI
1 NAME John /Smith/
1 SEX M
1 BIRT
2 DATE 12 AUG 1901
2 PLAC London, England
1 DEAT
2 DATE 4 NOV 1975
2 PLAC Oxford, England
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
1 MARR
2 DATE 1925
2 PLAC London, England
0 @S1@ SOUR
1 TITL Parish Register of St Mary
1 AUTH Church of England
0 TRLR`;

describe('syntax-independent tooltip builders', () => {
  const analysis = analyzeText(SAMPLE_GEDCOM);

  describe('buildRecordTooltip', () => {
    it('builds rich individual card with vital facts and relationships', () => {
      const card = buildRecordTooltip(analysis, 'I1');
      expect(card).toContain('### 👤 John Smith *(1901–1975)*');
      expect(card).toContain('`@I1@`');
      expect(card).toContain('Male (♂)');
      expect(card).toContain('- **Birth:** 12 AUG 1901 in London, England');
      expect(card).toContain('- **Death:** 4 NOV 1975 in Oxford, England');
      expect(card).toContain('**Spouse(s):** Jane Doe');
      expect(card).toContain('**Children:** Jimmy Smith');
    });

    it('builds rich family card with husband, wife, marriage, and children', () => {
      const card = buildRecordTooltip(analysis, 'F1');
      expect(card).toContain('### 👨‍👩‍👧 Family `@F1@`');
      expect(card).toContain('- **Husband:** John Smith');
      expect(card).toContain('- **Wife:** Jane Doe');
      expect(card).toContain('- **Marriage:** 1925 in London, England');
      expect(card).toContain('**Children (1):** Jimmy Smith');
    });

    it('builds rich source card with title and author', () => {
      const card = buildRecordTooltip(analysis, 'S1');
      expect(card).toContain('### 📜 Parish Register of St Mary');
      expect(card).toContain('- **Author:** Church of England');
    });

    it('handles non-existent records gracefully', () => {
      const card = buildRecordTooltip(analysis, 'NON_EXISTENT');
      expect(card).toContain('no matching record found');
    });
  });

  describe('buildKeywordTooltip', () => {
    it('returns keyword tooltips for GEDCOM tags, GEDCOM X URIs, and JSON/XML members', () => {
      const indi = buildKeywordTooltip('INDI');
      expect(indi).toBeDefined();
      expect(indi).toContain('### Individual / Person');
      expect(indi).toContain('- **GEDCOM 7 Tag:** `INDI`');
      expect(indi).toContain('- **GEDCOM X URI:** `http://gedcomx.org/Person`');
      expect(indi).toContain('- **JSON / XML:** `persons / <person>`');

      const person = buildKeywordTooltip('person');
      expect(person).toBeDefined();
      expect(person).toContain('Individual / Person');

      const birth = buildKeywordTooltip('http://gedcomx.org/Birth');
      expect(birth).toBeDefined();
      expect(birth).toContain('Birth Fact');
      expect(birth).toContain('BIRT');

      const place = buildKeywordTooltip('place');
      expect(place).toBeDefined();
      expect(place).toContain('Place / Jurisdiction');

      const attribution = buildKeywordTooltip('attribution');
      expect(attribution).toBeDefined();
      expect(attribution).toContain('Attribution & Provenance');
    });

    it('returns undefined for unknown terms', () => {
      expect(buildKeywordTooltip('completely_unknown_token_12345')).toBeUndefined();
    });
  });
});
