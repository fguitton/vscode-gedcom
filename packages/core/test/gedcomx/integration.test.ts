import { describe, expect, it } from 'vitest';
import {
  analyzeText,
  buildFanChart,
  calculateKinship,
  individualTimeline,
  neighbourhood,
  recordDetails,
} from '../../src/index.ts';

describe('GEDCOM X full pipeline integration', () => {
  const sampleGedcomXJson = JSON.stringify({
    persons: [
      {
        id: 'P-1',
        gender: { type: 'http://gedcomx.org/Male' },
        names: [
          {
            nameForms: [{ fullText: 'Grandfather /Smith/' }],
          },
        ],
        facts: [
          {
            type: 'http://gedcomx.org/Birth',
            date: { original: '1850' },
            place: { original: 'London' },
          },
        ],
      },
      {
        id: 'P-2',
        gender: { type: 'http://gedcomx.org/Female' },
        names: [
          {
            nameForms: [{ fullText: 'Grandmother /Jones/' }],
          },
        ],
        facts: [
          {
            type: 'http://gedcomx.org/Birth',
            date: { original: '1855' },
          },
        ],
      },
      {
        id: 'P-3',
        gender: { type: 'http://gedcomx.org/Male' },
        names: [
          {
            nameForms: [{ fullText: 'Father /Smith/' }],
          },
        ],
        facts: [
          {
            type: 'http://gedcomx.org/Birth',
            date: { original: '1880' },
          },
        ],
      },
      {
        id: 'P-4',
        gender: { type: 'http://gedcomx.org/Female' },
        names: [
          {
            nameForms: [{ fullText: 'Mother /Taylor/' }],
          },
        ],
        facts: [
          {
            type: 'http://gedcomx.org/Birth',
            date: { original: '1885' },
          },
        ],
      },
      {
        id: 'P-5',
        gender: { type: 'http://gedcomx.org/Male' },
        names: [
          {
            nameForms: [{ fullText: 'Son /Smith/' }],
          },
        ],
        facts: [
          {
            type: 'http://gedcomx.org/Birth',
            date: { original: '1910' },
          },
          {
            type: 'http://gedcomx.org/Death',
            date: { original: '1985' },
          },
        ],
      },
    ],
    relationships: [
      {
        id: 'R-1',
        type: 'http://gedcomx.org/Couple',
        person1: { resource: '#P-1' },
        person2: { resource: '#P-2' },
      },
      {
        id: 'R-2',
        type: 'http://gedcomx.org/ParentChild',
        person1: { resource: '#P-1' },
        person2: { resource: '#P-3' },
      },
      {
        id: 'R-3',
        type: 'http://gedcomx.org/ParentChild',
        person1: { resource: '#P-2' },
        person2: { resource: '#P-3' },
      },
      {
        id: 'R-4',
        type: 'http://gedcomx.org/Couple',
        person1: { resource: '#P-3' },
        person2: { resource: '#P-4' },
      },
      {
        id: 'R-5',
        type: 'http://gedcomx.org/ParentChild',
        person1: { resource: '#P-3' },
        person2: { resource: '#P-5' },
      },
      {
        id: 'R-6',
        type: 'http://gedcomx.org/ParentChild',
        person1: { resource: '#P-4' },
        person2: { resource: '#P-5' },
      },
    ],
  });

  it('analyzes GEDCOM X seamlessly into CST and Xrefs', () => {
    const analysis = analyzeText(sampleGedcomXJson);
    expect(analysis.version).toBe('7.0');
    expect(analysis.document.records.length).toBeGreaterThanOrEqual(7); // HEAD, 5 INDI, 2 FAM
    expect(analysis.xrefs.definitions.has('I_P_1')).toBe(true);
    expect(analysis.xrefs.definitions.has('I_P_5')).toBe(true);
  });

  it('renders family tree neighbourhood directly from GEDCOM X data', () => {
    const analysis = analyzeText(sampleGedcomXJson);
    const graph = neighbourhood(analysis, 'I_P_3', { depth: 2 });
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.nodes.some((n) => n.xref === 'I_P_3')).toBe(true);
    expect(graph.nodes.some((n) => n.xref === 'I_P_5')).toBe(true);
  });

  it('calculates kinship between individuals in GEDCOM X data', () => {
    const analysis = analyzeText(sampleGedcomXJson);
    const kinship = calculateKinship(analysis, 'I_P_1', 'I_P_5');
    expect(kinship).not.toBeNull();
    expect(kinship?.description.toLowerCase()).toContain('grandfather');
  });

  it('builds fan chart on GEDCOM X data', () => {
    const analysis = analyzeText(sampleGedcomXJson);
    const fan = buildFanChart(analysis, 'I_P_5', 3);
    expect(fan.rootXref).toBe('I_P_5');
    expect(fan.nodes.length).toBeGreaterThanOrEqual(3);
  });

  it('generates individual timeline and record details from GEDCOM X', () => {
    const analysis = analyzeText(sampleGedcomXJson);
    const timeline = individualTimeline(analysis, 'I_P_5');
    expect(timeline.length).toBeGreaterThanOrEqual(2); // Birth & Death
    expect(timeline.some((t) => t.year === 1910)).toBe(true);
    expect(timeline.some((t) => t.year === 1985)).toBe(true);

    const details = recordDetails(analysis, 'I_P_5');
    expect(details?.title).toContain('Son Smith');
  });
});
