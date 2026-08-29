import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analyzeText,
  calculateKinship,
  detectGedcomXFormat,
  gedcomXToGedcom7,
  individualTimeline,
  isGedcomX,
  neighbourhood,
  recordAt,
} from '../../src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', '..', '..', '..', 'fixtures', 'gedcomx');

describe('GEDCOM X test fixtures', () => {
  it('processes Emma Bocock Recipe Book fixture (JSON)', () => {
    const content = readFileSync(join(fixturesDir, 'emma-bocock.json'), 'utf8');
    expect(isGedcomX(content)).toBe(true);
    expect(detectGedcomXFormat(content)).toBe('json');

    const gedcom7 = gedcomXToGedcom7(content);
    expect(gedcom7).toContain('0 @I_P_1@ INDI');
    expect(gedcom7).toContain('1 NAME Emma /Bocock/');
    expect(gedcom7).toContain('1 SEX F');
    expect(gedcom7).toContain('1 BIRT');
    expect(gedcom7).toContain('2 DATE 23 JUN 1843');
    expect(gedcom7).toContain('2 PLAC Gainsborough, Lincolnshire, England');
    expect(gedcom7).toContain('0 @I_P_2@ INDI');
    expect(gedcom7).toContain('1 OCCU Labourer');
    expect(gedcom7).toContain('0 @F_R_1@ FAM');
    expect(gedcom7).toContain('1 HUSB @I_P_2@');
    expect(gedcom7).toContain('1 WIFE @I_P_3@');
    expect(gedcom7).toContain('1 CHIL @I_P_1@');

    const analysis = analyzeText(content);
    expect(analysis.version).toBe('7.0');
    expect(analysis.document.records.length).toBeGreaterThanOrEqual(5);

    const kinship = calculateKinship(analysis, 'I_P_2', 'I_P_1');
    expect(kinship).not.toBeNull();
    expect(kinship?.description.toLowerCase()).toContain('daughter');
  });

  it('processes multi-generational FamilySearch Tree fixture (JSON)', () => {
    const content = readFileSync(join(fixturesDir, 'familysearch-tree.json'), 'utf8');
    expect(isGedcomX(content)).toBe(true);
    expect(detectGedcomXFormat(content)).toBe('json');

    const analysis = analyzeText(content);
    expect(analysis.xrefs.definitions.has('I_KWQS_BB1')).toBe(true);
    expect(analysis.xrefs.definitions.has('I_KWQS_BB5')).toBe(true);

    // Test exact cursor line mapping (negative lines in attribution vs person records)
    expect(recordAt(analysis, 0)).toBeNull();
    expect(recordAt(analysis, 7)).toBeNull(); // inside attribution
    expect(recordAt(analysis, 8)).toBeNull(); // inside attribution modified timestamp
    expect(recordAt(analysis, 12)).toBe('I_KWQS_BB1'); // Henry Taylor
    expect(recordAt(analysis, 25)).toBe('I_KWQS_BB1'); // Inside Henry Taylor name parts
    expect(recordAt(analysis, 50)).toBe('I_KWQS_BB2'); // Clara Adams
    expect(recordAt(analysis, 75)).toBe('I_KWQS_BB3'); // Arthur Taylor
    expect(recordAt(analysis, 115)).toBe('I_KWQS_BB4'); // Eleanor Vance
    expect(recordAt(analysis, 140)).toBe('I_KWQS_BB5'); // Grace Taylor
    expect(recordAt(analysis, 170)).toBe('F_REL_COUPLE_1'); // Relationship Couple
    expect(recordAt(analysis, 215)).toBe('U_agent_fs'); // Agent

    // Test tree navigation
    const graph = neighbourhood(analysis, 'I_KWQS_BB3', { depth: 2 });
    expect(graph.nodes.length).toBe(5);

    // Test kinship (Grandfather <-> Granddaughter)
    const kinship = calculateKinship(analysis, 'I_KWQS_BB1', 'I_KWQS_BB5');
    expect(kinship).not.toBeNull();
    expect(kinship?.description.toLowerCase()).toContain('granddaughter');

    // Test timeline
    const timeline = individualTimeline(analysis, 'I_KWQS_BB1');
    expect(timeline.some((e) => e.year === 1850)).toBe(true);
    expect(timeline.some((e) => e.year === 1920)).toBe(true);
  });

  it('processes multi-generational FamilySearch Tree fixture (XML)', () => {
    const content = readFileSync(join(fixturesDir, 'familysearch-tree.xml'), 'utf8');
    expect(isGedcomX(content)).toBe(true);
    expect(detectGedcomXFormat(content)).toBe('xml');

    const analysis = analyzeText(content);
    expect(analysis.xrefs.definitions.has('I_KWQS_BB1')).toBe(true);
    expect(analysis.xrefs.definitions.has('I_KWQS_BB5')).toBe(true);

    // Test exact cursor line mapping in XML
    expect(recordAt(analysis, 0)).toBeNull();
    expect(recordAt(analysis, 4)).toBeNull(); // inside <attribution>
    expect(recordAt(analysis, 7)).toBe('I_KWQS_BB1'); // <person id="KWQS-BB1">
    expect(recordAt(analysis, 18)).toBe('I_KWQS_BB1'); // inside Henry Taylor birth date
    expect(recordAt(analysis, 35)).toBe('I_KWQS_BB2'); // <person id="KWQS-BB2">
    expect(recordAt(analysis, 60)).toBe('I_KWQS_BB3'); // <person id="KWQS-BB3">
    expect(recordAt(analysis, 85)).toBe('I_KWQS_BB4'); // <person id="KWQS-BB4">
    expect(recordAt(analysis, 100)).toBe('I_KWQS_BB5'); // <person id="KWQS-BB5">
    expect(recordAt(analysis, 120)).toBe('F_R_1'); // <relationship type="http://gedcomx.org/Couple">
    expect(recordAt(analysis, 152)).toBe('U_agent_fs'); // <agent id="agent_fs">



    const kinship = calculateKinship(analysis, 'I_KWQS_BB1', 'I_KWQS_BB5');
    expect(kinship).not.toBeNull();
    expect(kinship?.description.toLowerCase()).toContain('granddaughter');
  });

  describe('negative control validation (non-GEDCOM files)', () => {
    it('rejects npm package.json fixture', () => {
      const content = readFileSync(join(fixturesDir, 'negative-controls', 'package.json'), 'utf8');
      expect(isGedcomX(content)).toBe(false);
      expect(detectGedcomXFormat(content)).toBeNull();
    });

    it('rejects REST API JSON response fixture', () => {
      const content = readFileSync(
        join(fixturesDir, 'negative-controls', 'rest-api-response.json'),
        'utf8',
      );
      expect(isGedcomX(content)).toBe(false);
      expect(detectGedcomXFormat(content)).toBeNull();
    });

    it('rejects Maven pom.xml fixture', () => {
      const content = readFileSync(join(fixturesDir, 'negative-controls', 'pom.xml'), 'utf8');
      expect(isGedcomX(content)).toBe(false);
      expect(detectGedcomXFormat(content)).toBeNull();
    });

    it('rejects SVG graphic fixture', () => {
      const content = readFileSync(join(fixturesDir, 'negative-controls', 'sample.svg'), 'utf8');
      expect(isGedcomX(content)).toBe(false);
      expect(detectGedcomXFormat(content)).toBeNull();
    });

    it('rejects RSS feed XML fixture', () => {
      const content = readFileSync(join(fixturesDir, 'negative-controls', 'rss-feed.xml'), 'utf8');
      expect(isGedcomX(content)).toBe(false);
      expect(detectGedcomXFormat(content)).toBeNull();
    });
  });
});
