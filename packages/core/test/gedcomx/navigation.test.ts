import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  findGedcomXDefinition,
  findGedcomXLinks,
  findGedcomXReferences,
  getGedcomXIdentifierAt,
} from '../../src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', '..', '..', '..', 'fixtures', 'gedcomx');
const sampleJson = readFileSync(join(fixturesDir, 'familysearch-tree.json'), 'utf8');
const sampleXml = readFileSync(join(fixturesDir, 'familysearch-tree.xml'), 'utf8');

describe('GEDCOM X Navigation Engine (Ctrl+Click, Go to Definition, References)', () => {
  describe('findGedcomXDefinition', () => {
    it('finds person definition in JSON', () => {
      const def = findGedcomXDefinition(sampleJson, 'KWQS-BB1');
      expect(def).not.toBeNull();
      // "id": "KWQS-BB1" is on line index 11 (line 12)
      expect(def?.line).toBe(11);
    });

    it('finds person definition from #hash reference in XML', () => {
      const def = findGedcomXDefinition(sampleXml, '#KWQS-BB1');
      expect(def).not.toBeNull();
      // <person id="KWQS-BB1"> is on line index 6 (line 7)
      expect(def?.line).toBe(6);
    });

    it('finds agent definition in XML', () => {
      const def = findGedcomXDefinition(sampleXml, '#agent_fs');
      expect(def).not.toBeNull();
      expect(def?.line).toBe(151);
    });

    it('returns null for non-existent IDs', () => {
      expect(findGedcomXDefinition(sampleJson, 'NON_EXISTENT')).toBeNull();
    });
  });

  describe('getGedcomXIdentifierAt', () => {
    it('identifies reference under cursor in JSON', () => {
      // In JSON, line index 175 has "resource": "#KWQS-BB1"
      const lines = sampleJson.split('\n');
      const relLine = lines.findIndex((l) => l.includes('"resource": "#KWQS-BB1"'));
      expect(relLine).toBeGreaterThan(0);

      const id = getGedcomXIdentifierAt(sampleJson, relLine, 25);
      expect(id).toBe('KWQS-BB1');
    });

    it('identifies definition under cursor in XML', () => {
      // Line index 6 has <person id="KWQS-BB1">
      const id = getGedcomXIdentifierAt(sampleXml, 6, 18);
      expect(id).toBe('KWQS-BB1');
    });
  });

  describe('findGedcomXReferences', () => {
    it('finds all pointers to a person in JSON', () => {
      const refs = findGedcomXReferences(sampleJson, 'KWQS-BB1');
      expect(refs.length).toBeGreaterThanOrEqual(2);
      // All refs should have line numbers where "resource": "#KWQS-BB1" occurs
      const lines = sampleJson.split('\n');
      for (const ref of refs) {
        expect(lines[ref.line]).toContain('KWQS-BB1');
      }
    });

    it('finds all pointers to an agent in XML', () => {
      const refs = findGedcomXReferences(sampleXml, 'agent_fs');
      expect(refs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('findGedcomXLinks', () => {
    it('extracts clickable internal and external links', () => {
      const links = findGedcomXLinks(sampleJson);
      expect(links.length).toBeGreaterThan(0);

      const internalLink = links.find((l) => l.target === '#agent_fs');
      expect(internalLink).toBeDefined();
      expect(internalLink?.isInternal).toBe(true);
      expect(internalLink?.targetLine).toBeDefined();
    });
  });
});
