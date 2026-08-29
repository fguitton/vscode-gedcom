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

    const kinship = calculateKinship(analysis, 'I_KWQS_BB1', 'I_KWQS_BB5');
    expect(kinship).not.toBeNull();
    expect(kinship?.description.toLowerCase()).toContain('granddaughter');
  });
});
