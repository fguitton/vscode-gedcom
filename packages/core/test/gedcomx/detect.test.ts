import { describe, expect, it } from 'vitest';
import { detectGedcomXFormat, isGedcomX } from '../../src/gedcomx/detect.ts';

describe('GEDCOM X detection', () => {
  it('detects GEDCOM X JSON with persons array', () => {
    const json = JSON.stringify({
      persons: [
        {
          id: 'P-1',
          gender: { type: 'http://gedcomx.org/Male' },
          names: [{ nameForms: [{ fullText: 'John Doe' }] }],
        },
      ],
    });
    expect(isGedcomX(json)).toBe(true);
    expect(detectGedcomXFormat(json)).toBe('json');
  });

  it('detects GEDCOM X JSON with relationships array', () => {
    const json = JSON.stringify({
      relationships: [
        {
          id: 'R-1',
          type: 'http://gedcomx.org/Couple',
          person1: { resource: '#P-1' },
          person2: { resource: '#P-2' },
        },
      ],
    });
    expect(isGedcomX(json)).toBe(true);
    expect(detectGedcomXFormat(json)).toBe('json');
  });

  it('detects GEDCOM X JSON from Uint8Array bytes', () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        attribution: { changeMessage: 'FamilySearch update' },
        persons: [{ id: 'P-1' }],
      }),
    );
    expect(isGedcomX(bytes)).toBe(true);
    expect(detectGedcomXFormat(bytes)).toBe('json');
  });

  it('detects GEDCOM X XML', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gedcomx xmlns="http://gedcomx.org/v1/">
  <person id="P-1">
    <gender type="http://gedcomx.org/Male"/>
  </person>
</gedcomx>`;
    expect(isGedcomX(xml)).toBe(true);
    expect(detectGedcomXFormat(xml)).toBe('xml');
  });

  it('returns false/null for traditional line-based GEDCOM', () => {
    const gedcom = `0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @I1@ INDI\n1 NAME John /Doe/\n0 TRLR`;
    expect(isGedcomX(gedcom)).toBe(false);
    expect(detectGedcomXFormat(gedcom)).toBe(null);
  });

  it('returns false/null for unrelated JSON', () => {
    const json = JSON.stringify({ name: 'package', version: '1.0.0' });
    expect(isGedcomX(json)).toBe(false);
    expect(detectGedcomXFormat(json)).toBe(null);
  });

  it('returns false/null for unrelated XML', () => {
    const xml = `<root><child>value</child></root>`;
    expect(isGedcomX(xml)).toBe(false);
    expect(detectGedcomXFormat(xml)).toBe(null);
  });
});
